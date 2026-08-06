#!/usr/bin/env node
'use strict';

/**
 * Open a browser tab to the Hub Bitcoin page, verify the UI loads,
 * and optionally trigger a block to confirm ZMQ -> JSONPatch -> UI update.
 * Usage: node scripts/verify-bitcoin-browser.js
 * Requires: Hub running at HUB_URL (default http://localhost:8080)
 */

const puppeteer = require('puppeteer');

const HUB_URL = process.env.HUB_URL || 'http://localhost:8080';
const BITCOIN_PAGE = `${HUB_URL}/services/bitcoin`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('[verify] Launching browser (headed)...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1200, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('BRIDGE') || text.includes('JSONPatch') || text.includes('globalStateUpdate')) {
        console.log('[page]', text);
      }
    });

    console.log('[verify] Navigating to', BITCOIN_PAGE);
    await page.goto(BITCOIN_PAGE, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for page content (Segment or Bitcoin heading)
    await page.waitForSelector('div.ui.segment, h3, [class*="Segment"]', { timeout: 15000 }).catch(() => {});
    await sleep(2000);

    // Look for balance or "Available balance" text
    const hasBalance = await page.evaluate(() => {
      const body = document.body.innerText || '';
      return body.includes('Available balance') || body.includes('BTC') || body.includes('balance');
    });
    console.log('[verify] Page shows balance/status:', hasBalance);

    // Click "Generate block" if present to trigger ZMQ -> broadcast
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find((b) => /generate\s*block/i.test((b.textContent || '').trim()));
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });
    if (clicked) {
      console.log('[verify] Clicked Generate block, waiting for update...');
      await sleep(5000);
    }

    console.log('[verify] Done. Browser will stay open 60s (close window to exit sooner).');
    await sleep(60000);
    await browser.close();
  } catch (err) {
    console.error('[verify]', err.message);
    await browser.close();
    process.exit(1);
  }
}

main();
