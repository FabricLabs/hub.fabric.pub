'use strict';

/**
 * Full-stack optional E2E: fresh hub datadir → finish first-time setup **via the Onboarding modal**
 * (unchecked managed Bitcoin/LN → Complete Setup), then open /peers and assert hooks.
 *
 * Run (after `npm run build:browser`): `HUB_E2E_UI_ONBOARDING=1 npx mocha tests/browser.onboardingPeers.e2e.test.js --exit --timeout 120000`
 */

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

require('../functions/patchLinkedFabricNodePath');

const Sandbox = require('@fabric/http/types/sandbox');
const { FIXTURE_XPRV } = require('@fabric/core/constants');

const DEFAULT_GOTO = { waitUntil: 'load', timeout: 35000 };

const RUN = process.env.HUB_E2E_UI_ONBOARDING === '1' || process.env.HUB_E2E_UI_ONBOARDING === 'true';

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

function attachBrowserClientDiagnostics (page) {
  if (!page || page._fabricHubBrowserTestDiag) return;
  page._fabricHubBrowserTestDiag = true;
  page.on('console', (msg) => {
    const t = String((msg.type && msg.type()) || '');
    const text = (typeof msg.text === 'function' ? msg.text() : String(msg)) || '';
    if (t === 'error' || t === 'warning' || t === 'assert') {
      console.error(`[browser:console:${t}]`, text);
    }
  });
  page.on('pageerror', (err) => {
    console.error('[browser:pageerror]', (err && err.message) || String(err));
  });
}

async function waitForHubSettings (originRoot, deadlineMs = 60000) {
  const prefix = originRoot.replace(/\/$/, '');
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${prefix}/settings`, { headers: { Accept: 'application/json' } });
      if (res.ok || res.status === 403) return { prefix };
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('Hub readiness timeout waiting for GET /settings');
}

async function waitForNeedsSetupFalse (prefix, deadlineMs = 75000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${prefix}/settings`, { headers: { Accept: 'application/json' } });
      const j = await res.json();
      if (!j.needsSetup) return true;
    } catch (_) {}
    await sleep(400);
  }
  throw new Error('Hub still reports needsSetup after onboarding submit');
}

async function startHubFresh (httpPort) {
  const hubUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ui-onboarding-e2e-'));
  const p2pPort = await getFreePort();
  const hub = spawn('node', ['scripts/hub.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      FABRIC_HUB_USER_DATA: hubUserData,
      FABRIC_BITCOIN_ENABLE: 'false',
      FABRIC_PORT: String(p2pPort),
      FABRIC_HUB_PORT: String(httpPort),
      PORT: String(httpPort),
      FABRIC_LIGHTNING_STUB: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  hub.stderr.on('data', (d) => { process.stderr.write(`[HUB] ${d}`); });
  hub.stdout.on('data', (d) => { process.stdout.write(`[HUB] ${d}`); });
  const origin = `http://127.0.0.1:${httpPort}`;
  await waitForHubSettings(origin);

  return { hub, hubUserData, origin };
}

async function toggleOffCheckboxByTestId (page, tid) {
  await page.evaluate((id) => {
    const root = document.querySelector(`[data-testid="${id}"]`);
    if (!root) return;
    const inp = root.matches && root.matches('input[type="checkbox"]')
      ? root
      : root.querySelector('input[type="checkbox"]');
    if (!inp || !inp.checked) return;
    inp.click();
  }, tid);
}

async function mergeHubUiPeersFlag (page, on) {
  await page.evaluate((enabled) => {
    try {
      const prev = window.localStorage.getItem('fabric:state');
      const st = prev ? JSON.parse(prev) : {};
      if (!st.ui || typeof st.ui !== 'object') st.ui = {};
      st.ui.featureFlags = { ...(st.ui.featureFlags || {}), peers: enabled };
      window.localStorage.setItem('fabric:state', JSON.stringify(st));
      try {
        window.dispatchEvent(new CustomEvent('fabricHubUiFeatureFlagsChanged', { detail: st.ui.featureFlags }));
      } catch (_) {}
    } catch (_) {}
  }, !!on);
}

async function seedUnlockedFixtureIdentity (page) {
  await page.evaluate((xp) => {
    try {
      window.localStorage.setItem('fabric.identity.local', JSON.stringify({ xprv: xp }));
      if (window.sessionStorage) window.sessionStorage.removeItem('fabric.identity.unlocked');
    } catch (_) {}
  }, FIXTURE_XPRV);
}

async function waitForMainUIPostSetup (page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => {
      const home = [...document.querySelectorAll('a, button')].find(
        (el) => String(el.textContent || '').trim() === 'Home'
      );
      const hubLink = document.querySelector('a[href="/"] code');
      const app = document.getElementById('fabric-hub-application') || document.getElementById('react-application');
      const tgt = document.getElementById('application-target');
      const appReady = !!(tgt && ((tgt.innerHTML || '').length > 800));
      return !!(home || hubLink || (app && appReady));
    });
    if (ok) return true;
    await sleep(400);
  }
  return false;
}

(RUN ? describe : describe.skip)('browser onboarding modal → peers (HUB_E2E_UI_ONBOARDING)', function () {
  this.timeout(140000);

  let sandbox;
  let hubProc;
  let hubUserData;
  let baseUrl;

  before(async function () {
    assert.ok(global.fetch, 'Node 18+ built-in fetch required for bootstrap probes');
    const httpPort = await getFreePort();
    const st = await startHubFresh(httpPort);
    hubProc = st.hub;
    hubUserData = st.hubUserData;
    baseUrl = st.origin.endsWith('/') ? st.origin : `${st.origin}/`;

    sandbox = new Sandbox({ browser: { headless: true } });
    await sandbox.start();
    attachBrowserClientDiagnostics(sandbox.browser);
    await sandbox.browser.goto(baseUrl, DEFAULT_GOTO);

    await sandbox.browser.waitForSelector('[data-testid="hub-onboarding-modal"]', { timeout: 30000 }).catch(() => {});
    await toggleOffCheckboxByTestId(sandbox.browser, 'hub-onboarding-bitcoin-managed');
    await toggleOffCheckboxByTestId(sandbox.browser, 'hub-onboarding-lightning-managed');

    await sandbox.browser.click('[data-testid="hub-onboarding-complete-setup"]');
    await waitForNeedsSetupFalse(baseUrl.replace(/\/$/, ''));

    await sleep(1500);
    const shell = await waitForMainUIPostSetup(sandbox.browser, 55000);
    assert.ok(shell, 'Main Hub shell did not render after onboarding');

    await seedUnlockedFixtureIdentity(sandbox.browser);
    await sandbox.browser.reload({ ...DEFAULT_GOTO });

    await mergeHubUiPeersFlag(sandbox.browser, true);

    await sandbox.browser.goto(`${baseUrl.replace(/\/$/, '')}/peers`, { ...DEFAULT_GOTO, timeout: 35000 });

    await sandbox.browser.waitForSelector('[data-testid="hub-peers-page"]', { timeout: 25000 }).catch(async () => {
      const pathname = await sandbox.browser.evaluate(() => window.location.pathname);
      throw new Error(`Expected /peers + hub-peers-page; pathname=${pathname}`);
    });
  });

  after(async function () {
    if (sandbox) await sandbox.stop();
    if (hubProc && hubProc.kill) hubProc.kill('SIGTERM');
    if (hubUserData) {
      try {
        fs.rmSync(hubUserData, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  it('exposes automation hooks on Peers after UI setup', async function () {
    const ok = await sandbox.browser.evaluate(() => {
      const root = document.querySelector('[data-testid="hub-peers-page"]');
      const heading = document.getElementById('peers-page-heading');
      return !!(root && heading && /Peers/i.test(heading.innerText || ''));
    });
    assert.strictEqual(ok, true);
  });
});
