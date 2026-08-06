'use strict';

const puppeteer = require('puppeteer');

const HUB_URL = process.env.HUB_URL || 'http://localhost:8080/';
const PAYJOIN_BASE = process.env.PAYJOIN_BASE || '/services/payjoin';
const PAYJOIN_AMOUNT_SATS = Number(process.env.PAYJOIN_AMOUNT_SATS || 25000);

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callJSON (page, path, options = {}) {
  return page.evaluate(async (input) => {
    const url = input.path.startsWith('http')
      ? input.path
      : `${window.location.origin}${input.path}`;

    const response = await fetch(url, {
      method: input.method || 'GET',
      headers: Object.assign(
        { Accept: 'application/json' },
        input.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: input.body ? JSON.stringify(input.body) : undefined
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { raw: text };
    }

    return {
      ok: response.ok,
      status: response.status,
      data
    };
  }, {
    path,
    method: options.method || 'GET',
    body: options.body || null
  });
}

async function waitForPayjoinService (page, timeoutMs = 45000) {
  const started = Date.now();
  let last = null;

  while ((Date.now() - started) < timeoutMs) {
    last = await callJSON(page, PAYJOIN_BASE);
    if (last && last.ok && last.data && last.data.available) return last;
    await sleep(500);
  }

  throw new Error(`Payjoin service did not become available within ${timeoutMs}ms. Last response: ${JSON.stringify(last)}`);
}

function makeDemoPSBT () {
  return 'cHNidP8BAHECAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AQAAAAAAAAAAIgAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
}

async function main () {
  const runId = Date.now();
  const report = {
    startedAt: new Date().toISOString(),
    runId,
    hubUrl: HUB_URL,
    payjoinBase: PAYJOIN_BASE,
    capabilities: null,
    createDeposit: null,
    submitProposal: null,
    sessionAfterJoin: null,
    listSessions: null
  };

  const browser = await puppeteer.launch({ headless: true });
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const tabA = await ctxA.newPage();
  const tabB = await ctxB.newPage();

  try {
    await tabA.goto(HUB_URL, { waitUntil: 'networkidle2' });
    await tabB.goto(HUB_URL, { waitUntil: 'networkidle2' });

    const capabilities = await waitForPayjoinService(tabA, 45000);
    report.capabilities = capabilities.data;

    const createDeposit = await callJSON(tabA, `${PAYJOIN_BASE}/sessions`, {
      method: 'POST',
      body: {
        address: process.env.PAYJOIN_DEPOSIT_ADDRESS || 'bcrt1qpayjoinexample000000000000000000000000000000000',
        amountSats: PAYJOIN_AMOUNT_SATS,
        label: `E2E Payjoin Deposit ${runId}`,
        memo: `verify-payjoin-e2e:${runId}`
      }
    });
    report.createDeposit = createDeposit;
    if (!createDeposit.ok) {
      throw new Error(`Deposit creation failed: ${JSON.stringify(createDeposit.data)}`);
    }

    const session = createDeposit.data && createDeposit.data.session;
    const sessionId = session && session.id ? String(session.id) : '';
    if (!sessionId) throw new Error(`Missing session id in create response: ${JSON.stringify(createDeposit.data)}`);

    const submitProposal = await callJSON(tabB, `${PAYJOIN_BASE}/sessions/${encodeURIComponent(sessionId)}/proposals`, {
      method: 'POST',
      body: {
        psbt: makeDemoPSBT()
      }
    });
    report.submitProposal = submitProposal;
    if (!submitProposal.ok) {
      throw new Error(`Proposal submit failed: ${JSON.stringify(submitProposal.data)}`);
    }

    const sessionAfterJoin = await callJSON(tabA, `${PAYJOIN_BASE}/sessions/${encodeURIComponent(sessionId)}`);
    report.sessionAfterJoin = sessionAfterJoin;
    if (!sessionAfterJoin.ok) {
      throw new Error(`Session fetch failed: ${JSON.stringify(sessionAfterJoin.data)}`);
    }

    const listSessions = await callJSON(tabB, `${PAYJOIN_BASE}/sessions?limit=10&includeExpired=false`);
    report.listSessions = listSessions;
    if (!listSessions.ok) {
      throw new Error(`Session list failed: ${JSON.stringify(listSessions.data)}`);
    }

    const fetched = sessionAfterJoin.data && sessionAfterJoin.data.session ? sessionAfterJoin.data.session : null;
    const proposalCount = Number(fetched && fetched.proposalCount ? fetched.proposalCount : 0);
    const joined = fetched && fetched.status === 'proposal-received' && proposalCount >= 1;
    if (!joined) {
      throw new Error(`Join verification failed; expected proposal-received with >=1 proposal. Got: ${JSON.stringify(fetched)}`);
    }

    report.endedAt = new Date().toISOString();
    report.success = true;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } finally {
    await tabA.close();
    await tabB.close();
    await ctxA.close();
    await ctxB.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[verify-payjoin-e2e] fatal error:', error && error.stack ? error.stack : error);
  process.exit(1);
});
