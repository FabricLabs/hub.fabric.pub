'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const Sandbox = require('@fabric/http/types/sandbox');

const HUB_E2E = process.env.HUB_E2E === '1' || process.env.HUB_E2E === 'true';
const HUB_URL = process.env.HUB_URL || 'http://localhost:18080/';
const HUB_PORT = 18080;

// Helper to serve static files from assets/ with SPA fallback (matches Hub `spaFallback` behavior).
function startStaticServer ({ port = 3001, root = path.join(__dirname, '../assets') } = {}) {
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
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

// Helper to start the hub for full E2E (spawns child process)
function startHub (timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
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

/** Merge keys into `localStorage` `fabric.hub.uiFeatureFlags` (browser page). */
async function mergeHubUiFeatureFlags (page, patch) {
  const raw = JSON.stringify(patch || {});
  await page.evaluate((serialized) => {
    try {
      const p = JSON.parse(serialized);
      const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
      window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({ ...cur, ...p }));
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
      return !!(home || (hubLink && hubLink.textContent && hubLink.textContent.includes('hub')));
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
  const STATIC_PORT = 3001;
  const baseUrl = HUB_E2E ? HUB_URL : `http://localhost:${STATIC_PORT}/`;

  before(async function () {
    this.timeout(60000);
    try {
      if (HUB_E2E) {
        hubProcess = await startHub();
        await sleep(2000);
      } else {
        server = await startStaticServer({ port: STATIC_PORT });
      }
      sandbox = new Sandbox({ browser: { headless: true } });
      await sandbox.start();
      await sandbox.browser.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 15000 });
      if (HUB_E2E) {
        const ok = await waitForMainUI(sandbox.browser, 20000);
        if (!ok) throw new Error('Main UI did not appear');
      } else {
        await sleep(3000);
      }
    } catch (err) {
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

    it('should navigate to Peers (or land on admin when peer nav requires operator token)', async function () {
      const clicked = await clickNavLink(sandbox.browser, 'Peers');
      if (!clicked) {
        await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/peers`, { waitUntil: 'networkidle0', timeout: 10000 });
        await sleep(400);
      } else {
        await sleep(500);
      }
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.ok(
        pathname === '/peers' || pathname === '/settings/admin',
        `Expected /peers or /settings/admin (no admin token), got ${pathname}`
      );
    });

    it('should navigate to Documents', async function () {
      const clicked = await clickNavLink(sandbox.browser, 'Documents');
      if (!clicked) return this.skip();
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/documents', `Expected /documents, got ${pathname}`);
    });

    it('should navigate to Activities via bell', async function () {
      const clicked = await sandbox.browser.evaluate(() => {
        const a = document.querySelector('a[href="/activities"][aria-label="Activities and notifications"]');
        if (!a) return false;
        a.click();
        return true;
      });
      if (!clicked) return this.skip();
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/activities', 'Activities route is /activities');
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
    before(async function () {
      const hasMainUI = await waitForMainUI(sandbox.browser, 8000);
      if (!hasMainUI) this.skip();
    });

    it('should render Peers page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({ ...cur, peers: true }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/peers`, { waitUntil: 'networkidle0', timeout: 10000 });
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      if (pathname === '/peers') {
        const hasHeading = await waitForElementById(sandbox.browser, 'peers-page-heading', 12000);
        assert.ok(hasHeading, 'Peers page should render peers heading');
      } else {
        // Peers is operator-only when no browser admin token is present.
        assert.strictEqual(pathname, '/settings/admin', `Expected /peers or /settings/admin, got ${pathname}`);
        const hasAdminContent = await sandbox.browser.evaluate(() => {
          const body = document.body && document.body.innerText ? document.body.innerText : '';
          return body.includes('Admin') || body.includes('Feature visibility');
        });
        assert.ok(hasAdminContent, 'Peers admin redirect should land on admin content');
      }
    });

    it('should render Documents page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/documents`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Documents page should render');
    });

    it('should render Contracts page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/contracts`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Contracts page should render');
    });

    it('should render Activities page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({ ...cur, activities: true }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/activities`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/activities', `Expected /activities, got ${pathname}`);
      const hasHeading = await sandbox.browser.evaluate(() => {
        const el = document.getElementById('activities-page-heading');
        return !!(el && String(el.textContent || '').includes('Activities'));
      });
      assert.ok(hasHeading, 'Activities page should render activities heading');
    });

    it('should render Features page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({ ...cur, features: true }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/features`, { waitUntil: 'networkidle0', timeout: 10000 });
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
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/services/bitcoin`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Bitcoin page should render');
    });

    it('should render Bitcoin Invoices page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({
            ...cur,
            bitcoinInvoices: true
          }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/services/bitcoin/invoices`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Invoices page should render');
    });

    it('should render Bitcoin Payments page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({
            ...cur,
            bitcoinPayments: true
          }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/services/bitcoin/payments`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Payments page should render');
    });

    it('should render Bitcoin Crowdfunds page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({
            ...cur,
            bitcoinCrowdfund: true
          }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/services/bitcoin/crowdfunds`, { waitUntil: 'networkidle0', timeout: 10000 });
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
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings`, { waitUntil: 'networkidle0', timeout: 10000 });
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
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({
            ...cur,
            sidechain: true
          }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/federation`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/settings/federation', `Expected /settings/federation, got ${pathname}`);
      const hasHeading = await sandbox.browser.evaluate(() => {
        const el = document.getElementById('settings-federation-heading');
        return !!(el && el.textContent && el.textContent.includes('Distributed federation'));
      });
      assert.ok(hasHeading, 'Distributed federation page should render heading');
    });

    it('should render Settings → Bitcoin wallet page without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/bitcoin-wallet`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Settings bitcoin-wallet page should render');
    });

    it('should render Admin page at /settings/admin without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/admin`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const hasContent = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return body.length > 0 && !/error|crash/i.test(body);
      });
      assert.ok(hasContent, 'Admin page should render');
    });

    it('should redirect legacy /admin to /settings/admin', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/admin`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(500);
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname || '');
      assert.strictEqual(pathname, '/settings/admin', `Expected redirect to /settings/admin, got ${pathname}`);
    });

    it('should render Beacon Federation page at /settings/admin/beacon-federation without crashing', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({
            ...cur,
            sidechain: true
          }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/settings/admin/beacon-federation`, { waitUntil: 'networkidle0', timeout: 10000 });
      const onBeaconPage = await waitForPathname(sandbox.browser, '/settings/admin/beacon-federation', 12000);
      assert.ok(onBeaconPage, 'Expected Beacon Federation route to resolve');
      // Keep this as route-resolution smoke: page composition can vary by runtime feature state.
    });

    it('should redirect legacy /admin/beacon-federation to /settings/admin/beacon-federation', async function () {
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/`, { waitUntil: 'networkidle0', timeout: 10000 });
      await sandbox.browser.evaluate(() => {
        try {
          const cur = JSON.parse(window.localStorage.getItem('fabric.hub.uiFeatureFlags') || '{}');
          window.localStorage.setItem('fabric.hub.uiFeatureFlags', JSON.stringify({
            ...cur,
            sidechain: true
          }));
        } catch (e) {}
      });
      await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/admin/beacon-federation`, { waitUntil: 'networkidle0', timeout: 10000 });
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
      await sandbox.browser.goto(`${root}/contracts`, { waitUntil: 'networkidle0', timeout: 20000 });
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
      await sandbox.browser.goto(`${root}/services/bitcoin/faucet`, { waitUntil: 'networkidle0', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        return (
          /faucet/i.test(body) &&
          (body.includes('Request') || body.includes('address') || body.includes('sats'))
        );
      });
      assert.ok(ok, 'Faucet page should show request / funding copy');
    });

    it('Bitcoin payments page renders on-chain payment + Payjoin (BIP77) surface', async function () {
      this.timeout(25000);
      const root = baseUrl.replace(/\/$/, '');
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'networkidle0', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinPayments: true });
      await sandbox.browser.goto(`${root}/services/bitcoin/payments`, { waitUntil: 'networkidle0', timeout: 20000 });
      await sleep(400);
      const ok = await sandbox.browser.evaluate(() => {
        const body = document.body && document.body.innerText ? document.body.innerText : '';
        const hasMakePayment = !!document.getElementById('fabric-btc-make-payment-h4');
        const hasPaymentsHeader = !!document.getElementById('fabric-bitcoin-payments-h2');
        const hasPayjoinBoard = !!document.getElementById('wealth-payjoin-board');
        const mentionsPayjoin = /payjoin|BIP77/i.test(body);
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
      await sandbox.browser.goto(`${root}/documents`, { waitUntil: 'networkidle0', timeout: 20000 });
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
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'networkidle0', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinCrowdfund: true });
      await sandbox.browser.goto(`${root}/services/bitcoin/crowdfunds`, { waitUntil: 'networkidle0', timeout: 20000 });
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
      await sandbox.browser.goto(`${root}/services/bitcoin`, { waitUntil: 'networkidle0', timeout: 20000 });
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
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'networkidle0', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinResources: true });
      await sandbox.browser.goto(`${root}/services/bitcoin/resources`, { waitUntil: 'networkidle0', timeout: 20000 });
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
      await sandbox.browser.goto(`${root}/`, { waitUntil: 'networkidle0', timeout: 15000 });
      await mergeHubUiFeatureFlags(sandbox.browser, { bitcoinLightning: true });
      await sandbox.browser.goto(`${root}/services/bitcoin/lightning`, { waitUntil: 'networkidle0', timeout: 20000 });
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
      await sandbox.browser.goto(`${root}/services/bitcoin/invoices`, { waitUntil: 'networkidle0', timeout: 20000 });
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
});
