'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const Sandbox = require('@fabric/http/types/sandbox');

const ALERTS_HUB_PORT = Number(process.env.FABRIC_HUB_ALERTS_TEST_PORT || 18081);
const FABRIC_P2P_PORT = Number(process.env.FABRIC_HUB_ALERTS_FABRIC_PORT || 17778);
const HUB_URL = `http://127.0.0.1:${ALERTS_HUB_PORT}/`;

function prepareIsolatedHubUserData () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-hub-alerts-'));
  const hubStore = path.join(root, 'stores', 'hub');
  fs.mkdirSync(hubStore, { recursive: true });
  fs.writeFileSync(
    path.join(hubStore, 'settings.json'),
    JSON.stringify({
      NODE_NAME: 'Hub',
      NODE_PERSONALITY: '["helpful"]',
      NODE_TEMPERATURE: '0',
      NODE_GOALS: '[]',
      BITCOIN_NETWORK: 'regtest',
      BITCOIN_MANAGED: 'false',
      LIGHTNING_MANAGED: 'true',
      DISK_ALLOCATION_MB: '1024',
      COST_PER_BYTE_SATS: '0.01',
      IS_CONFIGURED: true
    })
  );
  return root;
}

function startHubWithTestAlerts (userDataRoot, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      FABRIC_BITCOIN_ENABLE: 'false',
      FABRIC_BITCOIN_MANAGED: 'false',
      FABRIC_PORT: String(FABRIC_P2P_PORT),
      FABRIC_HUB_PORT: String(ALERTS_HUB_PORT),
      PORT: String(ALERTS_HUB_PORT),
      FABRIC_LIGHTNING_STUB: 'true',
      FABRIC_HUB_ALERTS_TEST: '1',
      FABRIC_HUB_USER_DATA: userDataRoot
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
    hub.stderr.on('data', (d) => { process.stderr.write(`[HUB-ALERTS] ${d}`); });
    hub.stdout.on('data', (d) => { process.stdout.write(`[HUB-ALERTS] ${d}`); });
    hub.on('error', (e) => done(e));
    hub.on('exit', (code, sig) => {
      if (!resolved) done(new Error(`Hub exited ${code} ${sig}`));
    });
    const base = HUB_URL.replace(/\/$/, '');
    let httpReady = false;
    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      if (Date.now() > deadline) return done(new Error('Hub startup timeout'));
      try {
        if (!httpReady) {
          const s = await fetch(`${base}/settings`, { headers: { Accept: 'application/json' } });
          if (!(s.ok || s.status === 403)) {
            setTimeout(poll, 500);
            return;
          }
          httpReady = true;
        }
        const res = await fetch(`${base}/services/ui-config`, {
          headers: { Accept: 'application/json' }
        });
        if (res.ok) {
          const body = await res.json();
          if (body && Array.isArray(body.alerts) && body.alerts.some((a) => a.id === 'browser-test-alert')) {
            return done(null);
          }
        }
      } catch (_) { /* retry */ }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 2000);
  });
}

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Browser Hub alert stack (E2E)', function () {
  let sandbox;
  let hubProcess;
  let userDataRoot = null;
  this.timeout(120000); before(async function () {
    if (typeof fetch !== 'function') {
      this.skip();
      return;
    }
    try {
      userDataRoot = prepareIsolatedHubUserData();
      hubProcess = await startHubWithTestAlerts(userDataRoot);
      sandbox = new Sandbox({ browser: { headless: true } });
      await sandbox.start();
      await sandbox.browser.goto(HUB_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      let ok = false;
      for (let i = 0; i < 40; i++) {
        ok = await sandbox.browser.evaluate(() => {
          const home = Array.from(document.querySelectorAll('a, button')).find(
            (el) => String(el.textContent || '').trim() === 'Home'
          );
          return !!home;
        });
        if (ok) break;
        await sleep(500);
      }
      if (!ok) throw new Error('Main UI did not appear');
    } catch (e) {
      if (sandbox) await sandbox.stop().catch(() => {});
      if (hubProcess && hubProcess.kill) hubProcess.kill('SIGTERM');
      if (userDataRoot) {
        try {
          fs.rmSync(userDataRoot, { recursive: true, force: true });
        } catch (_) {}
        userDataRoot = null;
      }
      console.error(e);
      this.skip();
    }
  });

  after(async function () {
    try {
      if (sandbox) await sandbox.stop();
    } catch (_) { /* browser may already be closed */ }
    if (hubProcess && hubProcess.kill) hubProcess.kill('SIGTERM');
    if (userDataRoot) {
      try {
        fs.rmSync(userDataRoot, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
    }
  });

  it('shows test alert then dismiss hides it and sets cookie by elementName', async function () {
    const seen = await waitForAlertStack(sandbox.browser, 15000);
    assert.strictEqual(seen.stack, true, 'fabric-hub-alert-stack should render');
    assert.strictEqual(seen.testId, true, 'fabric-hub-alert-browser-test should exist');

    const dismissed = await sandbox.browser.evaluate(() => {
      const btn = document.querySelector('#fabric-hub-alert-browser-test button[aria-label="Dismiss alert"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.strictEqual(dismissed, true, 'dismiss control should exist');

    await sleep(800);

    const after = await sandbox.browser.evaluate(() => {
      const stack = document.getElementById('fabric-hub-alert-stack');
      const testEl = document.getElementById('fabric-hub-alert-browser-test');
      const cookie = typeof document !== 'undefined' ? document.cookie : '';
      return {
        stackGone: !stack,
        testGone: !testEl,
        cookieHasDismiss: cookie.split(';').some((p) => p.trim().startsWith('fabric-hub-alert-browser-test=')),
        localStorage: (() => {
          try {
            const raw = window.localStorage.getItem('fabric.hub.alertDismissals');
            return raw || '';
          } catch (e) {
            return '';
          }
        })()
      };
    });
    assert.strictEqual(after.stackGone, true, 'alert stack should unmount when no alerts');
    assert.strictEqual(after.testGone, true);
    assert.strictEqual(after.cookieHasDismiss, true, 'cookie should use elementName');
    assert.ok(after.localStorage.includes('browser-test-alert'), 'localStorage should record dismissed id');
  });
});

async function waitForAlertStack (page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const v = await page.evaluate(() => ({
      stack: !!document.getElementById('fabric-hub-alert-stack'),
      testId: !!document.getElementById('fabric-hub-alert-browser-test')
    }));
    if (v.stack && v.testId) return v;
    await sleep(300);
  }
  return { stack: false, testId: false };
}
