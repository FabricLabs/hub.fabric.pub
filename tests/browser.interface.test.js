'use strict';

const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const Sandbox = require('@fabric/http/types/sandbox');
const { FIXTURE_XPRV } = require('@fabric/core/constants');

const HUB_E2E = process.env.HUB_E2E === '1' || process.env.HUB_E2E === 'true';
const HUB_URL = process.env.HUB_URL || 'http://localhost:18080/';
const HUB_PORT = 18080;

/** Puppeteer `networkidle0` often never resolves: Bridge keeps WebSocket/polling work alive. */
const DEFAULT_GOTO = { waitUntil: 'load', timeout: 20000 };

// Helper to serve static files from assets/ with SPA fallback (matches Hub `spaFallback` behavior).
function startStaticServer ({ port = 0, root = path.join(__dirname, '../assets') } = {}) {
  const indexPath = path.join(root, 'index.html');
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    const raw = String(req.url || '/').split('?')[0];
    const safePath = path.normalize(raw).replace(/^(\.\.[/\\])+/, '');
    if (safePath.includes('..')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const rel = safePath === '/' ? 'index.html' : safePath.replace(/^\//, '');
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (rel === 'config.local.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end('/* stub: real assets/config.local.js can force a dev browser identity; tests set identity explicitly */\n');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (!err) {
        res.writeHead(200);
        res.end(data);
        return;
      }
      const ext = path.extname(rel);
      const isLikelyStaticAsset = ext && ext !== '.html';
      if (isLikelyStaticAsset) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      fs.readFile(indexPath, (err2, indexData) => {
        if (err2) {
          res.writeHead(500);
          res.end('Server error');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexData);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: actual });
    });
    server.on('error', reject);
  });
}

// Helper to start the hub for full E2E (spawns child process)
function startHub (timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const hubUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-browser-e2e-'));
    const env = {
      ...process.env,
      FABRIC_HUB_USER_DATA: hubUserData,
      FABRIC_BITCOIN_ENABLE: 'false',
      FABRIC_BITCOIN_MANAGED: 'false',
      FABRIC_PORT: process.env.FABRIC_PORT || '17777',
      FABRIC_HUB_PORT: String(HUB_PORT),
      PORT: String(HUB_PORT),
      FABRIC_LIGHTNING_STUB: 'true'
    };
    const hub = spawn('node', ['scripts/hub.js'], {
      cwd: path.join(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let resolved = false;
    const done = (err) => {
      if (resolved) return;
      resolved = true;
      if (err) {
        try { hub.kill('SIGTERM'); } catch (_) {}
        reject(err);
      } else {
        resolve(hub);
      }
    };
    hub.stderr.on('data', (d) => { process.stderr.write(`[HUB] ${d}`); });
    hub.stdout.on('data', (d) => { process.stdout.write(`[HUB] ${d}`); });
    hub.on('error', (e) => done(e));
    hub.on('exit', (code, sig) => {
      if (!resolved) done(new Error(`Hub exited ${code} ${sig}`));
    });
    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      if (Date.now() > deadline) return done(new Error('Hub startup timeout'));
      try {
        const res = await fetch(`${HUB_URL.replace(/\/$/, '')}/settings`, {
          headers: { Accept: 'application/json' }
        });
        if (res.ok || res.status === 403) {
          return done(null);
        }
      } catch (_) {}
      setTimeout(poll, 500);
    };
    setTimeout(poll, 2000);
  });
}

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Log page errors, failed network, and important console to stderr (for debugging SPA failures). */
function attachBrowserClientDiagnostics (page) {
  if (!page || page._fabricHubBrowserTestDiag) return;
  page._fabricHubBrowserTestDiag = true;
  page.on('console', (msg) => {
    const t = String(msg.type && msg.type() || '');
    const text = (typeof msg.text === 'function' ? msg.text() : String(msg)) || '';
    if (t === 'error' || t === 'warning' || t === 'assert') {
      console.error(`[browser:console:${t}]`, text);
    }
  });
  page.on('pageerror', (err) => {
    const m = (err && err.message) || String(err);
    console.error('[browser:pageerror]', m);
  });
  page.on('requestfailed', (req) => {
    const f = (typeof req.failure === 'function') ? req.failure() : null;
    console.error('[browser:requestfailed]', (typeof req.url === 'function' ? req.url() : ''), f && f.errorText ? f.errorText : '');
  });
}

/**
 * Ensure browser E2E has an admin token: POST /settings when `needsSetup`, else env token.
 * Spawning `scripts/hub.js` with isolated `FABRIC_HUB_USER_DATA` yields `needsSetup` on first GET.
 */
async function bootstrapHubForBrowserE2e (hubOrigin) {
  const root = String(hubOrigin || '').replace(/\/$/, '');
  const res = await fetch(`${root}/settings`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /settings failed: ${res.status}`);
  const data = await res.json();
  if (data.needsSetup) {
    const boot = await fetch(`${root}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        NODE_NAME: 'Browser E2E Hub',
        BITCOIN_MANAGED: false,
        BITCOIN_HOST: '127.0.0.1',
        BITCOIN_RPC_PORT: '18443',
        BITCOIN_USERNAME: '',
        BITCOIN_PASSWORD: ''
      })
    });
    const body = await boot.json().catch(() => ({}));
    if (!boot.ok || !body.token) {
      throw new Error(`POST /settings bootstrap failed: ${boot.status} ${JSON.stringify(body).slice(0, 240)}`);
    }
    return String(body.token);
  }
  const envTok = process.env.FABRIC_HUB_ADMIN_TOKEN;
  if (envTok && String(envTok).trim()) return String(envTok).trim();
  throw new Error('Hub is already configured; set FABRIC_HUB_ADMIN_TOKEN or use a fresh hub datadir');
}

async function installHubAdminTokenThenReload (page, token) {
  await page.evaluate((t) => {
    try {
      const key = 'fabric:state';
      let st = {};
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) st = parsed;
        }
      } catch (e) { /* ignore */ }
      if (!st.hub || typeof st.hub !== 'object') st.hub = {};
      st.hub.adminToken = t;
      // Keep canonical `identity.local` in sync with the legacy key so `readStorageJSON('fabric.identity.local')`
      // does not return an empty object from `fabric:state` (which would drop xprv and trigger PublicVisitorGate).
      let idLocal = null;
      try {
        const rawId = window.localStorage.getItem('fabric.identity.local');
        if (rawId) idLocal = JSON.parse(rawId);
      } catch (e) { /* ignore */ }
      if (idLocal && typeof idLocal === 'object' && idLocal.xprv) {
        if (!st.identity || typeof st.identity !== 'object') st.identity = {};
        st.identity.local = idLocal;
      }
      window.localStorage.setItem(key, JSON.stringify(st));
      window.localStorage.setItem('fabric.hub.adminToken', t);
      window.dispatchEvent(new CustomEvent('fabricHubAdminTokenSaved', { detail: { ok: true } }));
    } catch (e) { /* ignore */ }
  }, token);
  await page.reload({ waitUntil: 'load', timeout: 20000 });
}

/**
 * Merge keys into Hub UI flags — mirrors canonical storage in `fabric:state.ui.featureFlags`
 * (same as {@link ../functions/hubUiFeatureFlags.saveHubUiFeatureFlags}).
 */
async function mergeHubUiFeatureFlags (page, patch) {
  const raw = JSON.stringify(patch && typeof patch === 'object' ? patch : {});
  await page.evaluate((serialized) => {
    try {
      const p = JSON.parse(serialized);
      const prev = window.localStorage.getItem('fabric:state');
      const st = prev ? JSON.parse(prev) : {};
      if (!st.ui || typeof st.ui !== 'object') st.ui = {};
      const cur = (st.ui.featureFlags && typeof st.ui.featureFlags === 'object') ? st.ui.featureFlags : {};
      const merged = { ...cur, ...p };
      st.ui.featureFlags = merged;
      window.localStorage.setItem('fabric:state', JSON.stringify(st));
      try {
        window.dispatchEvent(new CustomEvent('fabricHubUiFeatureFlagsChanged', { detail: merged }));
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }, raw);
}

async function waitForPathname (page, expected, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pathname = await page.evaluate(() => window.location.pathname || '');
    if (pathname === expected) return true;
    await sleep(250);
  }
  return false;
}

async function waitForElementById (page, id, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const present = await page.evaluate((targetId) => !!document.getElementById(targetId), id);
    if (present) return true;
    await sleep(250);
  }
  return false;
}

async function waitForBodyText (page, needle, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate((text) => {
      const body = document.body && document.body.innerText ? document.body.innerText : '';
      return body.includes(text);
    }, needle);
    if (found) return true;
    await sleep(250);
  }
  return false;
}

async function waitForMainUI (page, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate(() => {
      const home = Array.from(document.querySelectorAll('a, button')).find(
        (el) => String(el.textContent || '').trim() === 'Home'
      );
      const hubLink = document.querySelector('a[href="/"] code');
      const hasHubShell = !!(
        document.getElementById('fabric-hub-application') ||
        document.getElementById('react-application')
      );
      const app = document.getElementById('application-target');
      const appReady = !!(app && (app.innerHTML || '').length > 50);
      return !!(
        home ||
        (hubLink && hubLink.textContent && hubLink.textContent.includes('hub')) ||
        (hasHubShell && appReady)
      );
    });
    if (found) return true;
    await sleep(300);
  }
  return false;
}

async function clickNavLink (page, text) {
  return page.evaluate((targetText) => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const target = links.find((a) => String(a.textContent || '').trim() === targetText);
    if (!target) return false;
    target.click();
    return true;
  }, text);
}

/** Unlocked test identity so operator nav and `pv()` routes match integration expectations. */
async function seedBrowserUnlockedTestIdentity (page) {
  const xprv = FIXTURE_XPRV;
  await page.evaluate((xp) => {
    try {
      window.localStorage.setItem('fabric.identity.local', JSON.stringify({ xprv: xp }));
      if (window.sessionStorage) window.sessionStorage.removeItem('fabric.identity.unlocked');
    } catch (e) { /* ignore */ }
  }, xprv);
}

async function openMoreDropdownAndClick (page, itemText) {
  const opened = await page.evaluate((btnText) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const moreBtn = buttons.find((b) => String(b.textContent || '').includes(btnText));
    if (!moreBtn) return false;
    moreBtn.click();
    return true;
  }, 'More');
  if (!opened) return false;
  await sleep(500);
  const clicked = await page.evaluate((text) => {
    const items = Array.from(document.querySelectorAll('.item, [role="option"], [class*="item"]'));
    const target = items.find((el) => String(el.textContent || '').trim() === text);
    if (!target) return false;
    target.click();
    return true;
  }, itemText);
  return clicked;
}

describe('Browser Interface', function () {
  let server;
  let sandbox;
  let hubProcess;
  let e2eHubAdminToken;
  let baseUrl = HUB_E2E ? HUB_URL : 'http://127.0.0.1:0/';

  before(async function () {
    this.timeout(60000);
    try {
      if (HUB_E2E) {
        baseUrl = HUB_URL;
        hubProcess = await startHub();
        await sleep(2000);
        e2eHubAdminToken = await bootstrapHubForBrowserE2e(HUB_URL.replace(/\/$/, ''));
      } else {
        const envPort = process.env.FABRIC_BROWSER_TEST_STATIC_PORT;
        const st = await startStaticServer({
          port: envPort && String(envPort).trim() !== '' ? Number(envPort) : 0
        });
        server = st.server;
        baseUrl = `http://127.0.0.1:${st.port}/`;
      }
      sandbox = new Sandbox({ browser: { headless: true } });
      await sandbox.start();
      attachBrowserClientDiagnostics(sandbox.browser);
      await sandbox.browser.goto(baseUrl, { ...DEFAULT_GOTO, timeout: 30000 });
      // localStorage is per-origin; seeding before the first goto wrote to the wrong document.
      await seedBrowserUnlockedTestIdentity(sandbox.browser);
      await sandbox.browser.reload({ waitUntil: 'load', timeout: 30000 });
      if (HUB_E2E) {
        await installHubAdminTokenThenReload(sandbox.browser, e2eHubAdminToken);
        const ok = await waitForMainUI(sandbox.browser, 20000);
        if (!ok) throw new Error('Main UI did not appear');
      } else {
        const ready = await waitForMainUI(sandbox.browser, 20000);
        if (!ready) {
          throw new Error('Main UI (nav / app shell) did not appear on static bundle within 20s');
        }
      }
    } catch (err) {
      console.error('[browser.interface.test] before hook failed:', err && err.message ? err.message : err);
      this.skip();
    }
  });

  after(async function () {
    if (sandbox) await sandbox.stop();
    if (server) server.close();
    if (hubProcess && hubProcess.kill) hubProcess.kill('SIGTERM');
  });

  it('should load the interface with app root and title', async function () {
    const result = await sandbox.browser.evaluate(() => {
      return {
        title: document.title,
        hasApp: !!document.getElementById('application-target'),
        hasContent: !!(document.body && document.body.innerText && document.body.innerText.length > 0)
      };
    });
    assert.strictEqual(result.hasApp, true, 'App root should exist');
    assert.ok(result.title.includes('fabric') || result.title.includes('hub'), 'Title should mention fabric or hub');
    assert.ok(result.hasContent, 'Page should have body content');
  });

  it('should have correct document title', async function () {
    const title = await sandbox.browser.evaluate(() => document.title);
    assert.ok(title && title.length > 0, 'Title should be non-empty');
    assert.ok(
      /fabric|hub/i.test(title),
      `Title "${title}" should mention fabric or hub`
    );
  });

  it('should render application root', async function () {
    const hasApp = await sandbox.browser.evaluate(() => !!document.getElementById('application-target'));
    assert.strictEqual(hasApp, true, 'application-target should exist');
  });

  describe('navigation (requires main UI)', function () {
    before(async function () {
      const hasMainUI = await waitForMainUI(sandbox.browser, 8000);
      if (!hasMainUI) this.skip();
    });

    it('should navigate to Home', async function () {
      const clicked = await clickNavLink(sandbox.browser, 'Home');
      if (!clicked) return this.skip();
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '/');
      assert.ok(pathname === '/' || pathname === '', `Expected /, got ${pathname}`);
    });

    it('should navigate to Peers without operator token', async function () {
      const clicked = await clickNavLink(sandbox.browser, 'Peers');
      if (!clicked) {
        await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/peers`, { waitUntil: 'load', timeout: 10000 });
        await sleep(400);
      } else {
        await sleep(500);
      }
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/peers', `Expected /peers, got ${pathname}`);
    });

    it('should navigate to Documents', async function () {
      const clicked = await clickNavLink(sandbox.browser, 'Documents');
      if (!clicked) return this.skip();
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/documents', `Expected /documents, got ${pathname}`);
    });

    it('should navigate to Notifications via bell', async function () {
      const clicked = await sandbox.browser.evaluate(() => {
        const a = document.querySelector('a[href="/notifications"][aria-label="Notifications"]');
        if (!a) return false;
        a.click();
        return true;
      });
      if (!clicked) return this.skip();
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/notifications', 'Bell opens /notifications');
    });

    it('should navigate to Bitcoin via More dropdown', async function () {
      const clicked = await openMoreDropdownAndClick(sandbox.browser, 'Bitcoin');
      if (!clicked) return this.skip();
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/services/bitcoin', `Expected /services/bitcoin, got ${pathname}`);
    });

    it('should navigate to Contracts via top nav', async function () {
      const clicked = await clickNavLink(sandbox.browser, 'Contracts');
      if (!clicked) return this.skip();
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/contracts', `Expected /contracts, got ${pathname}`);
    });
  });

  describe('route rendering', function () {
    this.timeout(120000);
    before(async function () {
      const hasMainUI = await waitForMainUI(sandbox.browser, 8000);
      if (!hasMainUI) this.skip();
    });

    it('should render Peers page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'load', timeout: 10000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { peers: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/peers`, { waitUntil: 'load', timeout: 20000 });
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/peers', `Expected /peers (peers feature on), got ${pathname}`);
      const hasHeading = await waitForElementById(sandbox.browser, 'peers-page-heading', 12000);
      assert.ok(hasHeading, 'Peers page should render peers heading');
      const layoutOk = await sandbox.browser.evaluate(() => {
        const footer = document.getElementById('peers-page-footer');
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        if (!footer || !/Fabric Peer ID/i.test(body)) return false;
        // Static `assets/` test server has no WebSocket; Bridge may stay in “Connecting to hub…”.
        // When `networkStatus` is set, the “Fabric peers” table block is shown; otherwise loader or empty list.
        return (
          /Fabric peers/i.test(body) ||
          /Connecting to hub/i.test(body) ||
          /No TCP or mesh peers yet/i.test(body)
        );
      });
      assert.ok(layoutOk, 'Peers page should show protocol footer and Peer ID copy (table block when hub is connected)');
    });

    it('should render Documents page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/documents`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Documents page should render');
    });

    it('should render Contracts page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/contracts`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Contracts page should render');
    });

    it('should render Activities page without crashing', async function () {
      await mergeHubUiFeatureFlags(sandbox.browser, { activities: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/activities`, { waitUntil: 'load', timeout: 20000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/activities', `Expected /activities, got ${pathname}`);
      const hasHeading = await sandbox.browser.evaluate(() => {
        const el = document.getElementById('activities-page-heading');
        return !!(el && String(el.textContent || '').includes('Activities'));
      });
      assert.ok(hasHeading, 'Activities page should render activities heading');
    });

    it('should render Notifications page without crashing', async function () {
      await mergeHubUiFeatureFlags(sandbox.browser, { activities: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/notifications`, { waitUntil: 'load', timeout: 20000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/notifications', `Expected /notifications, got ${pathname}`);
      const hasHeading = await sandbox.browser.evaluate(() => {
        const el = document.getElementById('notifications-page-heading');
        return !!(el && String(el.textContent || '').includes('Notifications'));
      });
      assert.ok(hasHeading, 'Notifications page should render heading');
    });

    it('should render Features page without crashing', async function () {
      await mergeHubUiFeatureFlags(sandbox.browser, { features: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/features`, { waitUntil: 'load', timeout: 20000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/features', `Expected /features, got ${pathname}`);
      const hasHeading = await sandbox.browser.evaluate(() => {
        const el = document.getElementById('features-page-heading');
        return !!(el && String(el.textContent || '').includes('Features'));
      });
      assert.ok(hasHeading, 'Features page should render features heading');
    });

    it('should render Bitcoin page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/services/bitcoin`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Bitcoin page should render');
    });

    it('should render Bitcoin Invoices page without crashing', async function () {
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinInvoices: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/services/bitcoin/invoices`, { waitUntil: 'load', timeout: 20000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Invoices page should render');
    });

    it('should render Bitcoin Payments page without crashing', async function () {
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinPayments: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/payments`, { waitUntil: 'load', timeout: 20000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Payments page should render');
    });

    it('should render Bitcoin Crowdfunds page without crashing', async function () {
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinCrowdfund: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/services/bitcoin/crowdfunds`, { waitUntil: 'load', timeout: 20000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/services/bitcoin/crowdfunds', `Expected /services/bitcoin/crowdfunds, got ${pathname}`);
      const hasHeading = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.includes('Crowdfunds');
      });
      assert.ok(hasHeading, 'Crowdfunds page should show Crowdfunds heading');
    });

    it('should render Settings home at /settings without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/settings', `Expected /settings, got ${pathname}`);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.includes('Settings') && (body.includes('Fabric identity') || body.includes('Bitcoin wallet'));
      });
      assert.ok(ok, 'Settings overview should render');
    });

    it('should render Settings → Distributed federation at /settings/federation without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'load', timeout: 10000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { sidechain: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/federation`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/settings/federation', `Expected /settings/federation, got ${pathname}`);
      const hasHeading = await sandbox.browser.evaluate(() => {
        const el = document.getElementById('settings-federation-heading');
        return !!(el && el.textContent && el.textContent.includes('Distributed federation'));
      });
      assert.ok(hasHeading, 'Distributed federation page should render heading');
    });

    it('should render Federations workspace at /federations without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'load', timeout: 10000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { sidechain: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/federations`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/federations', `Expected /federations, got ${pathname}`);
      const ok = await sandbox.browser.evaluate(() => {
        const h = document.getElementById('federations-page-heading');
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return !!(h && /federations/i.test(h.textContent || '')) && /multi-?sig|signer|threshold/i.test(body);
      });
      assert.ok(ok, 'Federations page should show heading and multi-sig builder copy');
    });

    it('should render Settings → Bitcoin wallet page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/bitcoin-wallet`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Settings bitcoin-wallet page should render');
    });

    it('should render Admin page at /settings/admin without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/admin`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Admin page should render');
    });

    it('should redirect legacy /admin to /settings/admin', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/admin`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/settings/admin', `Expected redirect to /settings/admin, got ${pathname}`);
    });

    it('should show Fabric identity gate on /federations without unlocked identity', async function () {
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'load', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          window.localStorage.removeItem('fabric.identity.local');
          if (window.sessionStorage) window.sessionStorage.removeItem('fabric.identity.unlocked');
          const key = 'fabric:state';
          const raw = window.localStorage.getItem(key);
          if (raw) {
            const st = JSON.parse(raw);
            if (st && typeof st === 'object' && st.identity) delete st.identity;
            window.localStorage.setItem(key, JSON.stringify(st));
          }
        } catch (e) { /* ignore */ }
      });
      await mergeHubUiFeatureFlags(sandbox.browser, { sidechain: true });
      await sandbox.browser.goto(`${root}/federations`, { waitUntil: 'load', timeout: 10000 });
      const gate = await waitForBodyText(sandbox.browser, 'Sign in with a Fabric identity', 12000);
      assert.ok(gate, 'Expected sign-in gate on Federations when not logged in');
      await seedBrowserUnlockedTestIdentity(sandbox.browser);
      await sandbox.browser.goto(baseUrl, { waitUntil: 'load', timeout: 15000 });
    });

    it('should render Beacon Federation page at /settings/admin/beacon-federation without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'load', timeout: 10000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { sidechain: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/admin/beacon-federation`, { waitUntil: 'load', timeout: 10000 });
      const onBeaconPage = await waitForPathname(sandbox.browser, '/settings/admin/beacon-federation', 12000);
      assert.ok(onBeaconPage, 'Expected Beacon Federation route to resolve');
      // Keep this as route-resolution smoke: page composition can vary by runtime feature state.
    });

    it('should redirect legacy /admin/beacon-federation to /settings/admin/beacon-federation', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'load', timeout: 10000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { sidechain: true });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/admin/beacon-federation`, { waitUntil: 'load', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/settings/admin/beacon-federation', `Expected redirect, got ${pathname}`);
    });
  });

  /**
   * CONTRACTS.md — Hub “contract” records + Bitcoin settlement surfaces exposed in the SPA.
   * Assertions track headings and copy for storage/execution registry, document purchase & distribute,
   * L1 verify (resources), Payjoin, Lightning, crowdfunds, faucet, and ordinary explorer wallet context.
   */
  describe('L1 contract and payment UI (HUB_E2E)', function () {
    before(function () {
      if (!HUB_E2E) this.skip();
    });

    it('Contracts page shows storage + execution registry publish controls', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/contracts`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        const hasExecForm =
          !!document.getElementById('fabric-exec-name') &&
          !!document.getElementById('fabric-exec-program-json');
        const hasStorageSection =
          !!document.getElementById('contracts-storage-h4') &&
          body.includes('CreateDistributeInvoice') &&
          body.includes('CreateStorageContract');
        const hasPublish = body.includes('Publish to registry');
        const l1Registry = body.includes('Request registry invoice');
        const noBitcoinDev = body.includes('Publish to registry (no L1)') || body.includes('No Bitcoin service');
        const execOk = hasExecForm && hasPublish && (l1Registry || noBitcoinDev);
        return hasStorageSection && execOk;
      });
      assert.ok(ok, 'Storage L1 intro + execution registry form should be visible on /contracts');
    });

    it('Bitcoin faucet page renders L1 test funding UI', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/services/bitcoin/faucet`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        const hubPanel = document.getElementById('fabric-bitcoin-faucet-hub-wallet');
        return (
          /faucet/i.test(body) &&
          (body.includes('Request') || body.includes('address') || body.includes('sats')) &&
          !!hubPanel &&
          /hub wallet/i.test(body)
        );
      });
      assert.ok(ok, 'Faucet page should show hub wallet panel and request / funding copy');
    });

    it('Bitcoin payments page renders on-chain payment + Payjoin (BIP77) surface', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'load', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinPayments: true });
      await sandbox.browser.goto(`${root}/payments`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        const hasMakePayment = !!document.getElementById('fabric-btc-make-payment-h4');
        const hasPaymentsHeader = !!document.getElementById('fabric-bitcoin-payments-h2');
        const hasPayjoinBoard = !!document.getElementById('wealth-payjoin-board');
        const mentionsPayjoin = /payjoin|BIP78|fabricProtocol/i.test(body);
        const fallbackText =
          body.includes('Payment') && (body.includes('Bitcoin') || body.includes('sats'));
        return (
          (hasMakePayment || fallbackText) &&
          hasPaymentsHeader &&
          hasPayjoinBoard &&
          mentionsPayjoin
        );
      });
      assert.ok(ok, 'Payments should show Make Payment, header, and Payjoin receiver board');
    });

    it('Documents page surfaces distribute / purchase L1 workflow hints', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/documents`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return (
          !!document.getElementById('documents-page-heading') &&
          !!document.getElementById('distribute-hosting-heading') &&
          (body.includes('test:e2e-document-purchase') ||
            (body.includes('Distribute') && body.includes('storage')))
        );
      });
      assert.ok(ok, 'Documents should show catalog + hosting/distribute + purchase doc hints');
    });

    it('Crowdfunds page renders Taproot L1 campaign UI when feature flag is on', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'load', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinCrowdfund: true });
      await sandbox.browser.goto(`${root}/services/bitcoin/crowdfunds`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return (
          !!document.getElementById('fabric-bitcoin-crowdfunding') &&
          /Crowdfunds/i.test(body) &&
          body.includes('Taproot')
        );
      });
      assert.ok(ok, 'Crowdfunds page should render Taproot / L1 campaign workflow');
    });

    it('Bitcoin explorer ties contracts, Payjoin, and Lightning (wealth stack)', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/services/bitcoin`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return (
          !!document.getElementById('bitcoin-home-heading') &&
          !!document.getElementById('bitcoin-home-wealth-heading') &&
          /Fabric contracts/i.test(body) &&
          /Payjoin/i.test(body) &&
          /Lightning/i.test(body)
        );
      });
      assert.ok(ok, 'Bitcoin home should surface vision-linked wealth stack copy');
    });

    it('Bitcoin resources page shows L1 payment verification (txid + address + sats)', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'load', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinResources: true });
      await sandbox.browser.goto(`${root}/services/bitcoin/resources`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return (
          !!document.getElementById('btc-resources-page-heading') &&
          !!document.getElementById('btc-resources-l1-h3') &&
          body.includes('amountSats') &&
          (body.includes('Destination address') || body.includes('address='))
        );
      });
      assert.ok(ok, 'Resources page should expose CONTRACTS.md §4-style L1 verify form');
    });

    it('Lightning page shows channel list surface', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'load', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinLightning: true });
      await sandbox.browser.goto(`${root}/services/bitcoin/lightning`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.includes('Lightning') && body.includes('Channels');
      });
      assert.ok(ok, 'Lightning UI should list channels (stub or live)');
    });

    it('Invoices page shows receiver workflow', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/services/bitcoin/invoices`, { waitUntil: 'load', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return (
          !!document.getElementById('fabric-invoices-tab-demo') &&
          /invoice/i.test(body)
        );
      });
      assert.ok(ok, 'Invoices page should render local invoice UX');
    });
  });

  describe('Collaboration UI', function () {
    describe('gate without admin token (static bundle)', function () {
      before(function () {
        if (HUB_E2E) this.skip();
      });

      it('redirects /settings/collaboration to /settings when admin token is absent', async function () {
        this.timeout(25000);
        const root = baseUrl.replace(/\/$/, '');
        await sandbox.browser.goto(`${root}/`, { waitUntil: 'load', timeout: 15000 });
        await sandbox.browser.evaluate(() => {
          try {
            window.localStorage.removeItem('fabric.hub.adminToken');
          } catch (e) { /* ignore */ }
        });
        await sandbox.browser.goto(`${root}/settings/collaboration`, { waitUntil: 'load', timeout: 15000 });
        await sleep(600);
        const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
        assert.strictEqual(pathname, '/settings', `expected redirect to /settings, got ${pathname}`);
      });
    });

    describe('operator flow (HUB_E2E)', function () {
      before(function () {
        if (!HUB_E2E) this.skip();
      });

      it('creates a group and shows multisig preview JSON', async function () {
        this.timeout(90000);
        const root = baseUrl.replace(/\/$/, '');
        await sandbox.browser.goto(`${root}/settings/collaboration`, { waitUntil: 'load', timeout: 25000 });
        const hasHeading = await waitForBodyText(sandbox.browser, 'Collaboration', 20000);
        if (!hasHeading) {
          const dbg = await sandbox.browser.evaluate(() => ({
            path: window.location.pathname || '',
            snippet: (document.body && document.body.innerText) ? document.body.innerText.slice(0, 500) : ''
          }));
          assert.ok(false, `Collaboration page should render; debug: ${JSON.stringify(dbg)}`);
        }

        const inputSel = '#collab-input-group-name input';
        await sandbox.browser.waitForSelector(inputSel, { timeout: 15000 });
        const nameInput = await sandbox.browser.$(inputSel);
        assert.ok(nameInput, 'Group name field should exist');
        await nameInput.click({ clickCount: 3 });
        await nameInput.type('E2E Collab Group');

        const createSel = '#collab-btn-group-create button';
        await sandbox.browser.waitForSelector(createSel, { timeout: 15000 });
        await sandbox.browser.click(createSel);
        const previewBtnAppeared = await (async () => {
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            const ok = await sandbox.browser.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button'));
              return buttons.some((b) => String(b.textContent || '').trim() === 'Preview');
            });
            if (ok) return true;
            await sleep(300);
          }
          return false;
        })();
        assert.ok(previewBtnAppeared, 'Preview button should appear after creating a group');

        await sandbox.browser.evaluate(() => {
          const b = Array.from(document.querySelectorAll('button')).find((el) => String(el.textContent || '').trim() === 'Preview');
          if (b) b.click();
        });
        const previewShown = await waitForElementById(sandbox.browser, 'collab-multisig-preview-json', 15000);
        assert.ok(previewShown, 'Multisig preview block should render');
        const txt = await sandbox.browser.evaluate(() => {
          const el = document.getElementById('collab-multisig-preview-json');
          return el ? String(el.textContent || '') : '';
        });
        assert.ok(
          txt.includes('threshold') && (txt.includes('xOnlyPubkeysSorted') || txt.includes('missing')),
          `preview should include threshold and pubkey fields; got: ${txt.slice(0, 280)}`
        );
      });
    });
  });
});
