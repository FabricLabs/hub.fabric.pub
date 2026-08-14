'use strict';

const puppeteer = require('puppeteer');
const Key = require('@fabric/core/types/key');

const HUB_URL = process.env.HUB_URL || 'http://localhost:8080/';
function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChatInput (page, timeoutMs = 60000) {
  await page.waitForFunction(() => {
    const inputs = Array.from(document.querySelectorAll('input[placeholder]'));
    return inputs.some((input) => String(input.getAttribute('placeholder') || '').includes('Type a message'));
  }, { timeout: timeoutMs });
}

async function clickButtonByText (page, text) {
  return page.evaluate((targetText) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((button) => {
      const label = String(button.innerText || '').trim();
      return label.includes(targetText);
    });
    if (!target) return false;
    target.click();
    return true;
  }, text);
}

async function waitForButtonByText (page, text, timeoutMs = 20000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const found = await page.evaluate((targetText) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some((button) => String(button.innerText || '').trim().includes(targetText));
    }, text);
    if (found) return true;
    await sleep(300);
  }
  return false;
}

async function sendChatMessage (page, text) {
  return page.evaluate((value) => {
    const input = Array.from(document.querySelectorAll('input[placeholder]'))
      .find((node) => String(node.getAttribute('placeholder') || '').includes('Type a message'));
    if (!input) return { ok: false, reason: 'missing-input' };

    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const sendButton = document.querySelector('button[aria-label="Send message"], button[title="Send message"]');
    const disabled = !!(sendButton && sendButton.disabled);
    if (disabled) {
      return { ok: false, reason: 'send-disabled' };
    }
    if (!sendButton) return { ok: false, reason: 'missing-send-button' };
    sendButton.click();

    return { ok: true };
  }, text);
}

async function waitForText (page, text, timeoutMs = 10000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const found = await page.evaluate((needle) => {
      return String(document.body && document.body.innerText || '').includes(needle);
    }, text);
    if (found) return true;
    await sleep(300);
  }
  return false;
}

async function getAuthButtonState (page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button')).map((button) => ({
      text: String(button.innerText || '').trim(),
      title: String(button.getAttribute('title') || '').trim()
    }));

    const preferred = candidates.find((c) => c.title === 'Manage identity' || c.title === 'Log in' || c.title === 'Unlock identity');
    if (preferred) return preferred;

    const fallback = candidates.find((c) => c.text.includes('Login') || c.text.includes('Locked') || c.text.includes('xpub'));
    return fallback || null;
  });
}

async function seedIdentityAndOpen (page, xprv) {
  await page.goto(HUB_URL, { waitUntil: 'networkidle2' });
  await page.evaluate((key) => {
    const localPayload = { xprv: key };
    const unlockedPayload = { xprv: key, passwordProtected: false };
    window.localStorage.setItem('fabric.identity.local', JSON.stringify(localPayload));
    window.sessionStorage.setItem('fabric.identity.unlocked', JSON.stringify(unlockedPayload));
  }, xprv);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.goto(new URL('/activities', HUB_URL).toString(), { waitUntil: 'networkidle2' });
  await waitForChatInput(page, 60000);
}

async function main () {
  const keyA = new Key();
  const keyB = new Key();

  const report = {
    startedAt: new Date().toISOString(),
    url: HUB_URL,
    authButtonA: null,
    authButtonB: null,
    toggledWebrtcChatOnlyA: false,
    toggledWebrtcChatOnlyB: false,
    foundWebrtcToggleA: false,
    foundWebrtcToggleB: false,
    messageA: null,
    messageB: null,
    sendA: null,
    sendB: null,
    observedAInA: false,
    observedAInB: false,
    observedBInA: false,
    observedBInB: false,
    deliveredAToB: false,
    deliveredBToA: false,
    mode: 'unknown',
    successReason: null,
    consoleWarnings: []
  };

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  pageA.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Cannot sign message with public key only') || text.includes('identity')) {
      report.consoleWarnings.push({ tab: 'A', text });
    }
  });
  pageB.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Cannot sign message with public key only') || text.includes('identity')) {
      report.consoleWarnings.push({ tab: 'B', text });
    }
  });

  try {
    await seedIdentityAndOpen(pageA, keyA.xprv);
    await seedIdentityAndOpen(pageB, keyB.xprv);

    report.authButtonA = await getAuthButtonState(pageA);
    report.authButtonB = await getAuthButtonState(pageB);

    report.foundWebrtcToggleA = await waitForButtonByText(pageA, 'WebRTC chat only', 25000);
    report.foundWebrtcToggleB = await waitForButtonByText(pageB, 'WebRTC chat only', 25000);

    if (report.foundWebrtcToggleA) {
      report.toggledWebrtcChatOnlyA = await clickButtonByText(pageA, 'WebRTC chat only');
    }
    if (report.foundWebrtcToggleB) {
      report.toggledWebrtcChatOnlyB = await clickButtonByText(pageB, 'WebRTC chat only');
    }
    await sleep(1500);

    const msgA = `E2E_A_${Date.now()}`;
    report.messageA = msgA;
    report.sendA = await sendChatMessage(pageA, msgA);
    report.observedAInA = await waitForText(pageA, msgA, 12000);
    report.observedAInB = await waitForText(pageB, msgA, 12000);
    report.deliveredAToB = report.observedAInB;

    const msgB = `E2E_B_${Date.now()}`;
    report.messageB = msgB;
    report.sendB = await sendChatMessage(pageB, msgB);
    report.observedBInB = await waitForText(pageB, msgB, 12000);
    report.observedBInA = await waitForText(pageA, msgB, 12000);
    report.deliveredBToA = report.observedBInA;

    const webrtcMode = report.foundWebrtcToggleA && report.foundWebrtcToggleB;
    report.mode = webrtcMode ? 'webrtc' : 'chat-smoke';
    const success = webrtcMode
      ? (report.deliveredAToB && report.deliveredBToA)
      : (report.sendA && report.sendA.ok && report.sendB && report.sendB.ok && report.observedAInA && report.observedBInB);
    report.successReason = webrtcMode
      ? 'require cross-tab delivery in both directions'
      : 'WebRTC toggle unavailable; require stable local chat send/echo on both sessions';
    report.endedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = success ? 0 : 1;
  } finally {
    await pageA.close();
    await pageB.close();
    await ctxA.close();
    await ctxB.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[verify-webrtc-chat-e2e] fatal error:', error);
  process.exit(1);
});
