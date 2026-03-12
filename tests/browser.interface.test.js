'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

const Sandbox = require('@fabric/http/types/sandbox');

// Helper to serve static files from assets/
function startStaticServer({ port = 3001, root = path.join(__dirname, '../assets') } = {}) {
  const server = http.createServer((req, res) => {
    let filePath = path.join(root, req.url === '/' ? '/index.html' : req.url);
    if (!filePath.startsWith(root)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); res.end('Not found');
      } else {
        res.writeHead(200);
        res.end(data);
      }
    });
  });
  return new Promise(resolve => {
    server.listen(port, () => resolve(server));
  });
}

describe('Browser Interface', function () {
  let server;
  let sandbox;
  const PORT = 3001;
  const URL = `http://localhost:${PORT}/`;

  before(async function () {
    this.timeout(20000);
    server = await startStaticServer({ port: PORT });
    sandbox = new Sandbox({ browser: { headless: true } });
    await sandbox.start();
    await sandbox.browser.goto(URL, { waitUntil: 'networkidle0' });
  });

  after(async function () {
    if (sandbox) await sandbox.stop();
    if (server) server.close();
  });

  xit('should load the interface and define process and Buffer', async function () {
    const result = await sandbox.browser.evaluate(() => {
      return {
        process: typeof process !== 'undefined' && typeof process.version !== 'undefined',
        Buffer: typeof Buffer !== 'undefined' && typeof Buffer.from === 'function',
        title: document.title,
        hasApp: !!document.getElementById('application-target')
      };
    });
    assert.strictEqual(result.process, true, 'process should be defined in browser');
    assert.strictEqual(result.Buffer, true, 'Buffer should be defined in browser');
    assert.strictEqual(result.hasApp, true, 'App root should exist');
    assert.ok(result.title.includes('fabric'), 'Title should mention fabric');
  });
});
