#!/usr/bin/env node
'use strict';

/**
 * Optional smoke test: JSON-RPC to a Bitcoin Core mainnet node (e.g. LAN @ 192.168.50.5).
 * Does not start the Hub. Exits 0 when skipped; exits 1 on failure when enabled.
 *
 * Enable: FABRIC_MAINNET_RPC_SMOKE=1
 * Env: BITCOIN_RPC_HOST (default 192.168.50.5), BITCOIN_RPC_PORT (8332),
 *      BITCOIN_RPC_USER, BITCOIN_RPC_PASSWORD
 */

const http = require('http');

if (process.env.FABRIC_MAINNET_RPC_SMOKE !== '1' && process.env.FABRIC_MAINNET_RPC_SMOKE !== 'true') {
  console.log('[mainnet-smoke] Skip (set FABRIC_MAINNET_RPC_SMOKE=1 to probe mainnet RPC).');
  process.exit(0);
}

const host = process.env.BITCOIN_RPC_HOST || '192.168.50.5';
const port = Number(process.env.BITCOIN_RPC_PORT || 8332);
const user = process.env.BITCOIN_RPC_USER || '';
const pass = process.env.BITCOIN_RPC_PASSWORD || '';

function rpcPost (body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const auth = user ? Buffer.from(`${user}:${pass}`).toString('base64') : '';
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host,
      port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload, 'utf8'),
        ...(auth ? { Authorization: `Basic ${auth}` } : {})
      },
      timeout: 20000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, json: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('RPC request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

async function main () {
  console.log(`[mainnet-smoke] getblockchaininfo -> http://${host}:${port}/`);
  const r = await rpcPost({
    jsonrpc: '2.0',
    id: 1,
    method: 'getblockchaininfo',
    params: []
  });

  if (r.status !== 200) {
    console.error('[mainnet-smoke] HTTP', r.status, r.raw && r.raw.slice(0, 200));
    process.exit(1);
  }
  if (r.json && r.json.error) {
    console.error('[mainnet-smoke] RPC error:', r.json.error);
    process.exit(1);
  }
  const info = r.json && r.json.result;
  if (!info || typeof info.blocks !== 'number') {
    console.error('[mainnet-smoke] Unexpected response:', r.raw && r.raw.slice(0, 300));
    process.exit(1);
  }
  if (info.chain !== 'main') {
    console.error('[mainnet-smoke] Expected chain "main", got:', info.chain);
    process.exit(1);
  }

  console.log('[mainnet-smoke] OK mainnet height', info.blocks, 'headers', info.headers);
  process.exit(0);
}

main().catch((err) => {
  console.error('[mainnet-smoke]', err.message || err);
  process.exit(1);
});
