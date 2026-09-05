'use strict';

const assert = require('assert');
const http = require('http');
const net = require('net');
const { waitForHttpServerListening } = require('../functions/fabricHttpRebind');

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

describe('waitForHttpServerListening', function () {
  it('resolves once the Node HTTP server is bound', async function () {
    const port = await getFreePort();
    const srv = http.createServer();
    const waiting = waitForHttpServerListening(srv, 5000);
    srv.listen(port, '127.0.0.1');
    await waiting;
    assert.strictEqual(srv.listening, true);
    await new Promise((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
  });

  it('rejects when listen has no server', async function () {
    await assert.rejects(
      () => waitForHttpServerListening(null, 100),
      /no server/
    );
  });

  it('rejects when the server never binds before timeout', async function () {
    const srv = http.createServer();
    await assert.rejects(
      () => waitForHttpServerListening(srv, 50),
      /timed out/
    );
  });
});
