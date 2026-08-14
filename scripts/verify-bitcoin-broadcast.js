#!/usr/bin/env node
'use strict';

/**
 * Verify ZMQ -> Hub -> WebSocket JSONPatch flow:
 * 1. Connect to Hub WebSocket
 * 2. Trigger a block generation (causes ZMQ hashblock -> Hub _handleBitcoinBlockUpdate -> broadcast JSONPatch)
 * 3. Assert we receive a JSONPatch message with path /bitcoin and value.balance
 */

const WebSocket = require('ws');
const http = require('http');

const HUB_HTTP = 'http://localhost:8080';
const HUB_WS = 'ws://localhost:8080';
const Message = require('@fabric/core/types/message');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, HUB_HTTP);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.setHeader('Content-Type', 'application/json');
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function main() {
  console.log('[verify] Checking Hub HTTP...');
  const statusRes = await request('GET', '/services/bitcoin').catch((e) => {
    console.error('[verify] Hub not reachable:', e.message);
    process.exit(1);
  });
  if (statusRes.status !== 200) {
    console.error('[verify] Bitcoin status not 200:', statusRes.status);
    process.exit(1);
  }
  const status = statusRes.body;
  if (!status || !status.available) {
    console.error('[verify] Bitcoin not available:', status && status.message);
    process.exit(1);
  }
  console.log('[verify] Hub and Bitcoin OK, height:', status.height);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_WS);
    let gotPatch = false;
    const timeout = setTimeout(() => {
      ws.close();
      if (!gotPatch) {
        console.error('[verify] Timeout: did not receive JSONPatch with /bitcoin');
        process.exit(1);
      }
      resolve();
    }, 25000);

    ws.on('open', async () => {
      console.log('[verify] WebSocket open, generating block to trigger ZMQ -> broadcast...');
      try {
        const gen = await request('POST', '/services/bitcoin/blocks', { count: 1 });
        if (gen.status !== 200) {
          console.error('[verify] Block generation failed:', gen.status, gen.body);
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        console.log('[verify] Block generated, waiting for JSONPatch...');
      } catch (e) {
        console.error('[verify] Block request error:', e.message);
        clearTimeout(timeout);
        ws.close();
        process.exit(1);
      }
    });

    ws.on('message', (raw) => {
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      let message;
      try {
        message = Message.fromBuffer(buffer);
      } catch (e) {
        return;
      }
      if (message.type !== 'JSONPatch') return;
      const bodyRaw = message.body != null ? message.body : (message.data != null && typeof message.data === 'string' ? message.data : (message.data != null ? Buffer.from(message.data).toString('utf8') : null));
      if (bodyRaw == null) return;
      try {
        const patch = JSON.parse(bodyRaw);
        if (patch.path === '/bitcoin' && patch.value) {
          gotPatch = true;
          clearTimeout(timeout);
          console.log('[verify] Received JSONPatch path=/bitcoin');
          console.log('[verify] value.available:', patch.value.available);
          console.log('[verify] value.balance:', patch.value.balance);
          console.log('[verify] value.height:', patch.value.height);
          ws.close();
          resolve();
        }
      } catch (e) {
        // ignore parse errors for other patches
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[verify] WebSocket error:', err.message);
      process.exit(1);
    });
  });
}

main()
  .then(() => {
    console.log('[verify] OK: ZMQ -> Hub -> WebSocket JSONPatch flow verified.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[verify] Failed:', err);
    process.exit(1);
  });
