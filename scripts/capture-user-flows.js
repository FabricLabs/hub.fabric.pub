'use strict';

/**
 * Capture Hub UI user-flow screenshots → assets/screenshots/ + docs/USER_FLOWS.md
 *
 *   npm run screenshots
 *   npm run screenshots:l1   # HUB_SCREENSHOTS_L1=1 (needs bitcoind)
 *
 * Env:
 *   HUB_URL                 — attach to running Hub instead of spawning (optional)
 *   FABRIC_HUB_ADMIN_TOKEN  — required when attaching to a configured Hub
 *   HUB_SCREENSHOTS_L1=1    — include L1 Document Exchange / Payjoin / Crowdfund shots
 *   HUB_SCREENSHOTS_PORT    — HTTP port when spawning (default 18081)
 *   HUB_SCREENSHOTS_SKIP_BUILD=1 — skip webpack (assets already built)
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');

const Sandbox = require('@fabric/http/types/sandbox');
const { FIXTURE_XPRV } = require('@fabric/core/constants');
const Key = require('@fabric/core/types/key');

const {
  SHOTS,
  BITCOIN_FLAGS,
  shotsForRun,
  renderUserFlowsMarkdown
} = require('./lib/screenshotFlows');

const ROOT = path.join(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'assets', 'screenshots');
const DOCS_PATH = path.join(ROOT, 'docs', 'USER_FLOWS.md');
const INDEX_PATH = path.join(OUT_ROOT, 'INDEX.json');

const INCLUDE_L1 = process.env.HUB_SCREENSHOTS_L1 === '1'
  || process.env.HUB_SCREENSHOTS_L1 === 'true';
const ATTACH_URL = (process.env.HUB_URL || '').trim();
const HUB_PORT = Number(process.env.HUB_SCREENSHOTS_PORT || 18081);
const DEFAULT_GOTO = { waitUntil: 'load', timeout: 30000 };
const VIEWPORT = { width: 1440, height: 900 };

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log (...args) {
  console.log('[screenshots]', ...args);
}

function bitcoindOnPath () {
  try {
    execSync('command -v bitcoind', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

async function waitForHttpOk (url, timeoutMs = 60000) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok || res.status === 403) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(400);
  }
  throw new Error(`Hub not ready at ${url}: ${lastErr && lastErr.message}`);
}

function startHubProcess ({ withBitcoin }) {
  const runsRoot = path.join(ROOT, 'stores', 'screenshot-runs');
  fs.mkdirSync(runsRoot, { recursive: true });
  const hubUserData = fs.mkdtempSync(path.join(runsRoot, 'run-'));
  const fabricPort = Number(process.env.FABRIC_PORT || 17778);
  const env = {
    ...process.env,
    FABRIC_HUB_USER_DATA: hubUserData,
    FABRIC_BITCOIN_ENABLE: withBitcoin ? 'true' : 'false',
    FABRIC_BITCOIN_MANAGED: withBitcoin ? 'true' : 'false',
    FABRIC_PORT: String(fabricPort),
    FABRIC_HUB_PORT: String(HUB_PORT),
    PORT: String(HUB_PORT),
    FABRIC_LIGHTNING_STUB: 'true',
    FABRIC_HUB_INTERFACE: '127.0.0.1'
  };
  if (withBitcoin) {
    env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
  }
  const hub = spawn('node', ['scripts/hub.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  hub.stderr.on('data', (c) => {
    stderr += c.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });
  hub.stdout.on('data', () => {});
  hub.on('exit', (code, signal) => {
    if (code && code !== 0) {
      log('Hub process exited', { code, signal, stderrTail: stderr.slice(-2000) });
    }
  });
  hub._screenshotUserData = hubUserData;
  hub._screenshotStderr = () => stderr;
  return hub;
}

async function bootstrapHub (hubOrigin, { withBitcoin }) {
  const root = String(hubOrigin || '').replace(/\/$/, '');
  const res = await fetch(`${root}/settings`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /settings failed: ${res.status}`);
  const data = await res.json();
  if (data.needsSetup) {
    const boot = await fetch(`${root}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        NODE_NAME: 'Screenshot Capture Hub',
        BITCOIN_MANAGED: !!withBitcoin,
        LIGHTNING_MANAGED: false,
        BITCOIN_HOST: '127.0.0.1',
        BITCOIN_RPC_PORT: withBitcoin ? '20444' : '18443',
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
  throw new Error('Hub already configured; set FABRIC_HUB_ADMIN_TOKEN or use a fresh datadir');
}

async function rpc (baseUrl, method, params, adminToken) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/services/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${JSON.stringify(j)}`);
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  const r = j.result;
  if (r && r.status === 'error') throw new Error(r.message || 'RPC result error');
  return r;
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
      let idLocal = null;
      try {
        const rawId = window.localStorage.getItem('fabric.identity.local');
        if (rawId) idLocal = JSON.parse(rawId);
      } catch (e) { /* ignore */ }
      if (idLocal && typeof idLocal === 'object') {
        if (!st.identity || typeof st.identity !== 'object') st.identity = {};
        st.identity.local = idLocal;
      }
      window.localStorage.setItem(key, JSON.stringify(st));
      window.localStorage.setItem('fabric.hub.adminToken', t);
      window.dispatchEvent(new CustomEvent('fabricHubAdminTokenSaved', { detail: { ok: true } }));
    } catch (e) { /* ignore */ }
  }, token);
  await page.reload({ ...DEFAULT_GOTO });
}

async function mergeHubUiFeatureFlags (page, patch) {
  const raw = JSON.stringify(patch && typeof patch === 'object' ? patch : {});
  await page.evaluate((serialized) => {
    try {
      const p = JSON.parse(serialized);
      let next = null;
      const api = window.__fabricHubUiFeatureFlags;
      if (api && typeof api.setAll === 'function') {
        next = api.setAll(p);
      } else {
        const prev = window.localStorage.getItem('fabric:state');
        const st = prev ? JSON.parse(prev) : {};
        if (!st.ui || typeof st.ui !== 'object') st.ui = {};
        const cur = (st.ui.featureFlags && typeof st.ui.featureFlags === 'object')
          ? st.ui.featureFlags
          : {};
        next = Object.assign({}, cur, p);
        st.ui.featureFlags = next;
        window.localStorage.setItem('fabric:state', JSON.stringify(st));
        try {
          window.dispatchEvent(new CustomEvent('fabricHubUiFeatureFlagsChanged', { detail: next }));
        } catch (e) { /* ignore */ }
      }
      let token = '';
      try {
        token = String(window.localStorage.getItem('fabric.hub.adminToken') || '').trim();
        if (!token) {
          const st = JSON.parse(window.localStorage.getItem('fabric:state') || '{}');
          if (st && st.hub && st.hub.adminToken) token = String(st.hub.adminToken).trim();
        }
      } catch (e) { /* ignore */ }
      if (token && api && typeof api.persist === 'function') {
        try {
          const p = api.persist(next || api.load(), token);
          if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }, raw);
}

async function seedBrowserIdentity (page) {
  const key = new Key({ xprv: FIXTURE_XPRV });
  const xpub = key.xpub;
  await page.evaluate((xp) => {
    try {
      window.localStorage.setItem('fabric.identity.local', JSON.stringify({ xpub: xp }));
      if (window.sessionStorage) window.sessionStorage.removeItem('fabric.identity.unlocked');
    } catch (e) { /* ignore */ }
  }, xpub);
}

async function waitForTestId (page, testId, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate((id) => !!document.querySelector(`[data-testid="${id}"]`), testId);
    if (found) return true;
    await sleep(200);
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

async function waitForMainUI (page, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await page.evaluate(() => {
      const home = Array.from(document.querySelectorAll('a, button')).find(
        (el) => String(el.textContent || '').trim() === 'Home'
      );
      const hasHubShell = !!(
        document.getElementById('fabric-hub-application') ||
        document.getElementById('react-application')
      );
      const app = document.getElementById('application-target');
      const appReady = !!(app && (app.innerHTML || '').length > 50);
      return !!(home || (hasHubShell && appReady));
    });
    if (found) return true;
    await sleep(300);
  }
  return false;
}

async function gotoPath (page, baseUrl, routePath, flags) {
  const root = String(baseUrl).replace(/\/$/, '');
  const target = routePath.startsWith('/') ? routePath : `/${routePath}`;
  await page.goto(`${root}/`, { ...DEFAULT_GOTO });
  await sleep(250);
  if (flags) await mergeHubUiFeatureFlags(page, flags);
  await page.goto(`${root}${target}`, { ...DEFAULT_GOTO });
  await sleep(400);
  if (flags) await mergeHubUiFeatureFlags(page, flags);
  await sleep(200);
}

async function ensureDir (dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function takeShot (page, filePath, { fullPage = true } = {}) {
  await ensureDir(path.dirname(filePath));
  await page.screenshot({ path: filePath, fullPage: !!fullPage, type: 'png' });
}

/**
 * Seed a published document via Hub RPC for list/view shots.
 */
async function seedPublishedDocument (baseUrl, adminToken) {
  const runId = Date.now();
  const contentB64 = Buffer.from(
    `Screenshot capture document (run ${runId})\n`,
    'utf8'
  ).toString('base64');
  const created = await rpc(baseUrl, 'CreateDocument', [{
    name: `screenshot-doc-${runId}.txt`,
    mime: 'text/plain',
    contentBase64: contentB64
  }]);
  const doc = created && created.document;
  if (!doc || !doc.id) throw new Error('CreateDocument: missing id');
  await rpc(baseUrl, 'PublishDocument', [{ id: doc.id, purchasePriceSats: 25 }], adminToken);
  return doc.id;
}

async function listPeerIdsFromPage (page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/peers/"]'));
    const ids = [];
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/peers\/([^/?#]+)/);
      if (m && m[1] && m[1] !== 'undefined') ids.push(decodeURIComponent(m[1]));
    }
    return [...new Set(ids)];
  });
}

async function openFirstPeer (page, baseUrl) {
  const ids = await listPeerIdsFromPage(page);
  if (!ids.length) return null;
  const id = ids[0];
  await gotoPath(page, baseUrl, `/peers/${encodeURIComponent(id)}`, BITCOIN_FLAGS);
  await sleep(500);
  return id;
}

async function openAddPeerModal (page) {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => String(b.textContent || '').trim().includes('Add peer'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) return false;
  await sleep(400);
  return page.evaluate(() => {
    const body = document.body && document.body.innerText ? document.body.innerText : '';
    return body.includes('Add peer') || !!document.querySelector('.ui.modal.visible, .ui.modal.active');
  });
}

async function openDocumentCreateForm (page) {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => String(b.textContent || '').includes('Create Document'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) return false;
  await sleep(300);
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, textarea'));
    const nameInput = inputs.find((el) => {
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      const label = (el.getAttribute('name') || '').toLowerCase();
      return ph.includes('name') || label.includes('name') || el.tagName === 'INPUT';
    });
    if (nameInput && nameInput.tagName === 'INPUT') {
      nameInput.focus();
      nameInput.value = 'screenshot-demo.txt';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const area = document.querySelector('textarea');
    if (area) {
      area.focus();
      area.value = 'Hello from Hub screenshot capture.';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      area.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(200);
  return true;
}

/**
 * Best-effort L1: request inventory from first peer; wait for HTLC panel.
 * When attaching to a live mesh this can populate peer-inventory-htlc.
 */
async function tryRequestPeerInventory (page, baseUrl, adminToken) {
  try {
    const status = await rpc(baseUrl, 'GetNetworkStatus', [], adminToken);
    const peers = status && status.peers;
    let peerId = null;
    if (Array.isArray(peers) && peers.length) {
      peerId = peers[0].id || peers[0].peerId || peers[0].pubkey || null;
    } else if (peers && typeof peers === 'object') {
      peerId = Object.keys(peers)[0] || null;
    }
    if (!peerId) return null;
    try {
      await rpc(baseUrl, 'RequestPeerInventory', [peerId], adminToken);
    } catch (e) {
      log('RequestPeerInventory:', e.message);
    }
    await gotoPath(page, baseUrl, `/peers/${encodeURIComponent(peerId)}`, BITCOIN_FLAGS);
    await sleep(800);
    return peerId;
  } catch (e) {
    log('tryRequestPeerInventory:', e.message);
    return null;
  }
}

async function preparePage (page, baseUrl, adminToken) {
  await page.setViewport(VIEWPORT);
  await page.goto(baseUrl, { ...DEFAULT_GOTO });
  await seedBrowserIdentity(page);
  await page.reload({ ...DEFAULT_GOTO });
  await installHubAdminTokenThenReload(page, adminToken);
  await mergeHubUiFeatureFlags(page, BITCOIN_FLAGS);
  const ok = await waitForMainUI(page, 25000);
  if (!ok) throw new Error('Main UI did not appear after bootstrap');
}

async function runShot (ctx, shot) {
  const { page, baseUrl, adminToken, state } = ctx;
  const outFile = path.join(OUT_ROOT, shot.flow, `${shot.id}.png`);
  const result = {
    id: shot.id,
    flow: shot.flow,
    tier: shot.tier,
    title: shot.title,
    path: `assets/screenshots/${shot.flow}/${shot.id}.png`,
    status: 'ok',
    reason: null,
    capturedAt: new Date().toISOString()
  };

  try {
    switch (shot.action) {
      case 'goto':
        await gotoPath(page, baseUrl, shot.path || '/', BITCOIN_FLAGS);
        break;
      case 'goto-bitcoin-flags':
      case 'goto-sidechain-flags':
        await gotoPath(page, baseUrl, shot.path, BITCOIN_FLAGS);
        break;
      case 'document-create-form':
        await gotoPath(page, baseUrl, '/documents', BITCOIN_FLAGS);
        await waitForBodyText(page, 'Documents', 10000);
        if (!(await openDocumentCreateForm(page))) {
          result.status = 'skipped';
          result.reason = 'Create Document control not found';
          return result;
        }
        break;
      case 'document-published-list': {
        if (!state.documentId) {
          state.documentId = await seedPublishedDocument(baseUrl, adminToken);
          log('seeded document', state.documentId);
        }
        await gotoPath(page, baseUrl, '/documents', BITCOIN_FLAGS);
        await waitForBodyText(page, 'Published', 15000);
        break;
      }
      case 'document-view': {
        if (!state.documentId) {
          state.documentId = await seedPublishedDocument(baseUrl, adminToken);
        }
        await gotoPath(page, baseUrl, `/documents/${encodeURIComponent(state.documentId)}`, BITCOIN_FLAGS);
        await sleep(600);
        break;
      }
      case 'document-market':
        await gotoPath(page, baseUrl, '/documents', BITCOIN_FLAGS);
        await waitForBodyText(page, 'Documents', 10000);
        // Market strip is optional (CDN/client); still capture the page.
        await waitForTestId(page, 'hub-inventory-catalog', 3000);
        break;
      case 'peer-inventory':
      case 'peer-detail':
      case 'peer-chat': {
        await gotoPath(page, baseUrl, '/peers', BITCOIN_FLAGS);
        await waitForTestId(page, 'hub-peers-page', 12000);
        const peerId = await openFirstPeer(page, baseUrl);
        if (!peerId) {
          // Soft: capture peers list as fallback for inventory/detail/chat
          result.reason = 'no peer rows yet; captured peers list';
        }
        break;
      }
      case 'add-peer-modal':
        await gotoPath(page, baseUrl, '/peers', BITCOIN_FLAGS);
        await waitForTestId(page, 'hub-peers-page', 12000);
        if (!(await openAddPeerModal(page))) {
          result.status = 'skipped';
          result.reason = 'Add peer modal not opened';
          return result;
        }
        break;
      case 'peers-topology':
        await gotoPath(page, baseUrl, '/peers', BITCOIN_FLAGS);
        await waitForTestId(page, 'hub-peers-page', 12000);
        await page.evaluate(() => {
          const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,button,a'));
          const t = headings.find((el) => /topology|graph/i.test(String(el.textContent || '')));
          if (t) t.click();
        });
        await sleep(400);
        break;
      case 'htlc-fund':
      case 'htlc-confirm': {
        await tryRequestPeerInventory(page, baseUrl, adminToken);
        const hasHtlc = await waitForTestId(page, 'peer-inventory-htlc', 8000);
        if (!hasHtlc) {
          // Fallback: document purchase invoice chrome on DocumentView (same-hub L1 path)
          if (!state.documentId) {
            try {
              state.documentId = await seedPublishedDocument(baseUrl, adminToken);
            } catch (e) {
              result.status = 'skipped';
              result.reason = `no HTLC panel and seed failed: ${e.message}`;
              return result;
            }
          }
          await gotoPath(page, baseUrl, `/documents/${encodeURIComponent(state.documentId)}`, BITCOIN_FLAGS);
          await sleep(500);
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const buy = buttons.find((b) => /purchase|claim|invoice|buy|unlock/i.test(String(b.textContent || '')));
            if (buy) buy.click();
          });
          await sleep(600);
          result.reason = 'HTLC panel unavailable; captured document purchase / unlock chrome';
        }
        break;
      }
      case 'payjoin-l1':
        await gotoPath(page, baseUrl, '/services/bitcoin/payments', BITCOIN_FLAGS);
        await waitForTestId(page, 'hub-payjoin-board', 15000)
          || waitForTestId(page, 'hub-payjoin-deposit', 5000)
          || waitForBodyText(page, 'Payjoin', 8000);
        break;
      case 'crowdfund-l1':
        await gotoPath(page, baseUrl, '/services/bitcoin/crowdfunds', BITCOIN_FLAGS);
        await waitForTestId(page, 'hub-crowdfund-page', 15000)
          || waitForBodyText(page, 'Crowdfund', 8000);
        break;
      default:
        await gotoPath(page, baseUrl, shot.path || '/', BITCOIN_FLAGS);
    }

    if (shot.waitTestId) {
      await waitForTestId(page, shot.waitTestId, 8000);
    }
    if (shot.waitText) {
      await waitForBodyText(page, shot.waitText, 8000);
    }

    await takeShot(page, outFile, { fullPage: shot.fullPage !== false });
    if (result.reason && result.status === 'ok') {
      // keep reason as soft note
    }
    return result;
  } catch (err) {
    result.status = 'error';
    result.reason = err && err.message ? err.message : String(err);
    log('shot failed', shot.id, result.reason);
    try {
      await takeShot(page, outFile, { fullPage: true });
      result.hadPartial = true;
    } catch (_) { /* ignore */ }
    return result;
  }
}

function maybeBuildBrowser () {
  if (process.env.HUB_SCREENSHOTS_SKIP_BUILD === '1') {
    log('skipping build (HUB_SCREENSHOTS_SKIP_BUILD=1)');
    return;
  }
  const bundle = path.join(ROOT, 'assets', 'bundles', 'browser.min.js');
  if (fs.existsSync(bundle)) {
    log('using existing browser bundle');
    return;
  }
  log('building browser bundle…');
  execFileSync('npm', ['run', 'build:browser'], { cwd: ROOT, stdio: 'inherit' });
}

async function main () {
  maybeBuildBrowser();

  if (INCLUDE_L1 && !bitcoindOnPath() && !ATTACH_URL) {
    console.error('[screenshots] HUB_SCREENSHOTS_L1=1 requires bitcoind on PATH (or HUB_URL to a live Hub with Bitcoin).');
    process.exit(1);
  }

  let hubProcess = null;
  let baseUrl = ATTACH_URL;
  let adminToken = null;
  const withBitcoin = INCLUDE_L1;

  try {
    if (!baseUrl) {
      log('spawning Hub on port', HUB_PORT, withBitcoin ? '(Bitcoin managed)' : '(Bitcoin off)');
      hubProcess = startHubProcess({ withBitcoin });
      baseUrl = `http://127.0.0.1:${HUB_PORT}/`;
      try {
        await waitForHttpOk(`${baseUrl.replace(/\/$/, '')}/settings`, withBitcoin ? 180000 : 90000);
      } catch (readyErr) {
        const tail = hubProcess._screenshotStderr ? hubProcess._screenshotStderr() : '';
        throw new Error(`${readyErr.message}${tail ? `\n--- hub stderr ---\n${tail.slice(-3000)}` : ''}`);
      }
      adminToken = await bootstrapHub(baseUrl, { withBitcoin });
      if (withBitcoin) {
        log('waiting for Bitcoin HTTP…');
        const t0 = Date.now();
        while (Date.now() - t0 < 180000) {
          try {
            const st = await fetch(`${baseUrl.replace(/\/$/, '')}/services/bitcoin`, {
              headers: { Accept: 'application/json' }
            });
            const j = await st.json().catch(() => ({}));
            if (st.ok && j && j.available) break;
          } catch (_) { /* ignore */ }
          await sleep(500);
        }
      }
    } else {
      if (!baseUrl.endsWith('/')) baseUrl += '/';
      adminToken = process.env.FABRIC_HUB_ADMIN_TOKEN
        ? String(process.env.FABRIC_HUB_ADMIN_TOKEN).trim()
        : await bootstrapHub(baseUrl, { withBitcoin: INCLUDE_L1 });
    }

    log('admin token ready; launching browser');
    const sandbox = new Sandbox({
      browser: {
        headless: true,
        viewport: VIEWPORT
      }
    });
    await sandbox.start();
    const page = sandbox.browser;
    await preparePage(page, baseUrl, adminToken);

    const runList = shotsForRun(INCLUDE_L1);
    const state = { documentId: null };
    const results = [];
    const resultsByKey = new Map();

    // Seed document early so empty list shot stays empty: capture empty BEFORE seed
    for (const shot of runList) {
      log('capturing', shot.flow + '/' + shot.id);
      // Seed after empty documents shot
      if (shot.id === '03-document-published' && !state.documentId) {
        /* seed happens inside action */
      }
      const result = await runShot({ page, baseUrl, adminToken, state }, shot);
      results.push(result);
      resultsByKey.set(`${shot.flow}/${shot.id}`, result);
    }

    // Fill INDEX with all SHOTS (including skipped L1 when not run)
    const capturedAt = new Date().toISOString();
    for (const shot of SHOTS) {
      const key = `${shot.flow}/${shot.id}`;
      if (!resultsByKey.has(key)) {
        resultsByKey.set(key, {
          id: shot.id,
          flow: shot.flow,
          tier: shot.tier,
          title: shot.title,
          path: `assets/screenshots/${shot.flow}/${shot.id}.png`,
          status: shot.tier === 'l1' && !INCLUDE_L1 ? 'skipped' : 'not-run',
          reason: shot.tier === 'l1' && !INCLUDE_L1
            ? 'run npm run screenshots:l1 to refresh'
            : 'not in this run',
          capturedAt
        });
      }
    }

    await ensureDir(OUT_ROOT);
    const index = {
      capturedAt,
      includeL1: INCLUDE_L1,
      hubUrl: baseUrl,
      viewport: VIEWPORT,
      shots: [...resultsByKey.values()]
    };
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');

    const md = renderUserFlowsMarkdown(SHOTS, resultsByKey, {
      capturedAt,
      includeL1: INCLUDE_L1
    });
    await ensureDir(path.dirname(DOCS_PATH));
    fs.writeFileSync(DOCS_PATH, md);

    const ok = results.filter((r) => r.status === 'ok').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errored = results.filter((r) => r.status === 'error').length;
    log(`done: ${ok} ok, ${skipped} skipped, ${errored} errors → ${OUT_ROOT}`);
    log('gallery:', DOCS_PATH);

    await sandbox.stop();
    if (errored > 0 && ok === 0) process.exitCode = 1;
  } finally {
    if (hubProcess && hubProcess.kill) {
      try {
        hubProcess.kill('SIGTERM');
      } catch (_) { /* ignore */ }
      await sleep(500);
      try {
        hubProcess.kill('SIGKILL');
      } catch (_) { /* ignore */ }
    }
    if (hubProcess && hubProcess._screenshotUserData) {
      try {
        fs.rmSync(hubProcess._screenshotUserData, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
    }
  }
}

main().catch((err) => {
  console.error('[screenshots] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
