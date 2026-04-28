'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');
const merge = require('lodash.merge');
require('../functions/patchLinkedFabricNodePath');
const Hub = require('../services/hub');
const settings = require('../settings/local');

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

describe('@fabric/hub', function () {
  describe('HTTP Endpoints', function () {
    let hub;
    let server;
    let baseUrl;
    let testFsPath;

    before(async function () {
      this.timeout(30000);

      const [p2pPort, httpPort] = await Promise.all([getFreePort(), getFreePort()]);

      // Use project settings with test overrides: ephemeral ports to avoid EADDRINUSE
      // when another hub or parallel test holds fixed ports.
      // Bitcoin disabled so we don't need bitcoind or regtest lock for HTTP-only tests.
      // Fresh filesystem store under the repo (sandbox-safe; avoids polluted `stores/hub-test`).
      testFsPath = path.join(__dirname, '..', 'stores', `hub-http-test-${process.pid}-${Date.now()}`);
      fs.mkdirSync(testFsPath, { recursive: true });

      hub = new Hub(merge({}, settings, {
        port: p2pPort,
        fs: { path: testFsPath },
        bitcoin: {
          enable: false,
          network: 'regtest'
        },
        http: {
          hostname: 'localhost',
          listen: true,
          port: httpPort
        },
        debug: false
      }));

      await hub.start();

      // Get the HTTP server instance and base URL
      // The HTTP server might be accessed differently, let's try to get the address from the hub
      baseUrl = `http://localhost:${httpPort}`;

      // Wait a moment for the server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    after(async function () {
      this.timeout(10000);
      if (hub) {
        await Promise.race([
          hub.stop(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop() timeout')), 8000))
        ]).catch(() => {});
      }
      if (testFsPath) {
        try {
          fs.rmSync(testFsPath, { recursive: true, force: true });
        } catch (_) {}
      }
    });

    // Helper function to make HTTP requests
    function makeRequest (method, path, data = null, headers = {}) {
      return new Promise((resolve, reject) => {
        const requestUrl = url.parse(`${baseUrl}${path}`);
        const options = {
          hostname: requestUrl.hostname,
          port: requestUrl.port,
          path: requestUrl.path,
          method: method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        };

        const req = http.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              const jsonBody = body ? JSON.parse(body) : {};
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: jsonBody
              });
            } catch (error) {
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: body
              });
            }
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        if (data) {
          req.write(JSON.stringify(data));
        }
        req.end();
      });
    }

    /**
     * Fomantic (Fabric theme) static assets: packed CSS references `themes/...` (unchanged Gulp output).
     */
    function getHttpBuffer (pth) {
      return new Promise((resolve, reject) => {
        const requestUrl = url.parse(`${baseUrl}${pth}`);
        const opt = { hostname: requestUrl.hostname, port: requestUrl.port, path: requestUrl.path, method: 'GET' };
        const req = http.get(opt, (res) => {
          const parts = [];
          res.on('data', (c) => parts.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(parts)
            });
          });
        });
        req.on('error', reject);
      });
    }

    describe('Fomantic static theme (icons + Arvo)', function () {
      it('serves /semantic.min.css with fabric theme font URLs (Gulp + site.variables @fontPath)', async function () {
        const { status, body } = await getHttpBuffer('/semantic.min.css');
        assert.strictEqual(status, 200);
        const s = body.toString('utf8');
        assert.ok(
          s.includes('themes/fabric/assets/fonts/icons.woff2'),
          'expected icon @font-face to use themes/fabric (see fabric globals/site.variables @fontPath)'
        );
        assert.ok(
          !s.includes('themes/default/'),
          'fabric build should not reference themes/default/ in the packed CSS'
        );
      });

      it('serves Fomantic icon woff2 at /themes/fabric/.../icons.woff2 (assets)', async function () {
        const { status, body, headers } = await getHttpBuffer('/themes/fabric/assets/fonts/icons.woff2');
        assert.strictEqual(status, 200);
        assert.ok(body && body.length > 8, 'expected woff2 bytes');
        assert.strictEqual(body.toString('ascii', 0, 4), 'wOF2');
        const ct = (headers['content-type'] || '');
        assert.ok(
          ct.includes('font/woff2'),
          `expected font/woff2 Content-Type (Chromium+nosniff), got: ${ct}`
        );
      });

      it('serves Fabric theme Arvo woff2 at /themes/fabric/.../arvo-normal-400.woff2', async function () {
        const { status, body, headers } = await getHttpBuffer('/themes/fabric/assets/fonts/arvo-normal-400.woff2');
        assert.strictEqual(status, 200);
        assert.ok(body && body.length > 8, 'expected woff2 bytes');
        assert.strictEqual(body.toString('ascii', 0, 4), 'wOF2');
        const ct = (headers['content-type'] || '');
        assert.ok(
          ct.includes('font/woff2'),
          `expected font/woff2 Content-Type (Chromium+nosniff), got: ${ct}`
        );
      });
    });

    describe('/contracts', function () {
      describe('GET /contracts', function () {
        it('should return an ok status and contracts array', async function () {
          const response = await makeRequest('GET', '/contracts');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'ok');
          assert.ok(Array.isArray(response.body.contracts), 'contracts should be an array');
        });

        it('should return JSON content type', async function () {
          const response = await makeRequest('GET', '/contracts');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('json'), 'Should return JSON content type');
        });
      });

      describe('POST /contracts', function () {
        it('should return not implemented error', async function () {
          const contractData = {
            name: 'Test Contract',
            type: 'agreement',
            parties: ['party1', 'party2']
          };

          const response = await makeRequest('POST', '/contracts', contractData);

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Not yet implemented.');
        });

        it('should handle empty request body', async function () {
          const response = await makeRequest('POST', '/contracts', {});

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Not yet implemented.');
        });
      });

      describe('GET /contracts/:id', function () {
        it('should return not found error for unknown contract', async function () {
          const response = await makeRequest('GET', '/contracts/test-contract-id');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'contract not found');
        });
      });
    });

    describe('/peers', function () {
      describe('GET /peers', function () {
        it('should return a list of peers', async function () {
          const response = await makeRequest('GET', '/peers');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(Array.isArray(response.body), 'Response should be an array');
          // Currently returns empty array, but structure should be maintained
        });

        it('should return JSON content type', async function () {
          const response = await makeRequest('GET', '/peers');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('json'), 'Should return JSON content type');
        });
      });

      describe('POST /peers', function () {
        it('should return not implemented error', async function () {
          const response = await makeRequest('POST', '/peers', { name: 'test-peer', address: 'localhost:8080' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Not yet implemented.');
        });

        it('should handle empty request body', async function () {
          const response = await makeRequest('POST', '/peers', {});

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Not yet implemented.');
        });
      });

      describe('GET /peers/:id', function () {
        it('should return not implemented error for specific peer', async function () {
          const response = await makeRequest('GET', '/peers/test-peer-id');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Not yet implemented.');
        });
      });
    });

    describe('/documents', function () {
      describe('GET /documents', function () {
        it('should return documents collection data', async function () {
          const response = await makeRequest('GET', '/documents');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(Array.isArray(response.body), 'Response should be an array');
        });

        it('should return JSON content type', async function () {
          const response = await makeRequest('GET', '/documents');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('json'), 'Should return JSON content type');
        });
      });

      describe('POST /documents', function () {
        it('should return not implemented error', async function () {
          const documentData = {
            title: 'Test Document',
            content: 'This is a test document content',
            author: 'test-author'
          };

          const response = await makeRequest('POST', '/documents', documentData);

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Not yet implemented.');
        });

        it('should handle empty request body', async function () {
          const response = await makeRequest('POST', '/documents', {});

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Not yet implemented.');
        });

        it('should handle malformed JSON', async function () {
          // For malformed JSON, we'll test with a custom request
          const response = await new Promise((resolve, reject) => {
            const requestUrl = url.parse(`${baseUrl}/documents`);
            const options = {
              hostname: requestUrl.hostname,
              port: requestUrl.port,
              path: requestUrl.path,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              }
            };

            const req = http.request(options, (res) => {
              let body = '';
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () => {
                resolve({
                  status: res.statusCode,
                  headers: res.headers,
                  body: body
                });
              });
            });

            req.on('error', (error) => {
              reject(error);
            });

            req.write('{"invalid": json}');
            req.end();
          });

          // The server correctly returns 400 for malformed JSON
          assert.strictEqual(response.status, 400, 'Should return 400 for malformed JSON');
        });
      });

      describe('GET /documents/:id', function () {
        it('should return empty object for an unknown specific document', async function () {
          const response = await makeRequest('GET', '/documents/test-document-id');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.deepStrictEqual(response.body, {}, 'Unknown documents should return an empty object');
        });

        it('should handle non-existent document ID', async function () {
          const response = await makeRequest('GET', '/documents/non-existent-id');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.deepStrictEqual(response.body, {}, 'Non-existent documents should return an empty object');
        });
      });
    });

    describe('Content Type Validation', function () {
      it('should accept JSON content type for POST requests', async function () {
        const response = await makeRequest('POST', '/peers', { test: 'data' }, { 'Content-Type': 'application/json' });

        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.strictEqual(response.body.status, 'error');
        assert.strictEqual(response.body.message, 'Not yet implemented.');
      });

      it('should handle requests without content type header', async function () {
        const response = await makeRequest('POST', '/documents', { test: 'data' }, {});

        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.strictEqual(response.body.status, 'error');
        assert.strictEqual(response.body.message, 'Not yet implemented.');
      });
    });

    describe('Execution contract RPC (mirrors ContractView)', function () {
      it('CreateExecutionContract then RunExecutionContract returns trace and runCommitmentHex', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }

        const program = {
          version: 1,
          steps: [
            { op: 'FabricOpcode', fabricType: 'ChatMessage' },
            { op: 'Push', value: { uiDemo: true } }
          ]
        };

        const createResponse = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 201,
          method: 'CreateExecutionContract',
          params: [{ name: 'http-test-exec', program }]
        }, { Accept: 'application/json' });

        assert.strictEqual(createResponse.status, 200);
        assert.ok(createResponse.body && createResponse.body.result, 'JSON-RPC result');
        const created = createResponse.body.result;
        assert.strictEqual(created.type, 'CreateExecutionContractResult');
        assert.ok(created.id, 'contract id');
        assert.ok(created.contract && created.contract.program, 'persisted contract');

        const runResponse = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 202,
          method: 'RunExecutionContract',
          params: [{ contractId: created.id }]
        }, { Accept: 'application/json' });

        assert.strictEqual(runResponse.status, 200);
        const run = runResponse.body && runResponse.body.result;
        assert.ok(run, 'run result');
        assert.strictEqual(run.type, 'RunExecutionContractResult');
        assert.strictEqual(run.contractId, created.id);
        assert.strictEqual(run.ok, true);
        assert.strictEqual(run.stepsExecuted, program.steps.length);
        assert.ok(Array.isArray(run.trace));
        assert.ok(typeof run.runCommitmentHex === 'string');
        assert.strictEqual(run.runCommitmentHex.length, 64);
      });

      it('CreateExecutionRegistryInvoice returns error when Bitcoin is disabled', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }

        const program = { version: 1, steps: [] };
        const inv = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 302,
          method: 'CreateExecutionRegistryInvoice',
          params: [{ program, amountSats: 1000 }]
        }, { Accept: 'application/json' });

        assert.strictEqual(inv.status, 200);
        assert.ok(inv.body && inv.body.result, 'JSON-RPC result');
        const body = inv.body.result;
        assert.strictEqual(body.status, 'error');
        assert.ok(String(body.message).toLowerCase().includes('bitcoin'), body.message);
      });

      it('AnchorExecutionRunCommitment requires adminToken', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }

        const hex64 = 'a'.repeat(64);
        const anchor = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 303,
          method: 'AnchorExecutionRunCommitment',
          params: [{ commitmentHex: hex64 }]
        }, { Accept: 'application/json' });

        assert.strictEqual(anchor.status, 200);
        assert.ok(anchor.body && anchor.body.result, 'JSON-RPC result');
        const body = anchor.body.result;
        assert.strictEqual(body.status, 'error');
        assert.ok(String(body.message).toLowerCase().includes('admintoken'), body.message);
      });

    });

    describe('Accept Header Response Format', function () {
      describe('JSON responses', function () {
        it('should return JSON when Accept header is application/json', async function () {
          const response = await makeRequest('GET', '/peers', null, { 'Accept': 'application/json' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('application/json'), 'Should return JSON content type');
          assert.ok(Array.isArray(response.body), 'Response should be an array');
        });

        it('should return JSON when Accept header is missing (default)', async function () {
          const response = await makeRequest('GET', '/peers');

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('application/json'), 'Should return JSON content type');
          assert.ok(Array.isArray(response.body), 'Response should be an array');
        });

        it('should return JSON for documents endpoint with application/json Accept header', async function () {
          const response = await makeRequest('GET', '/documents', null, { 'Accept': 'application/json' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('application/json'), 'Should return JSON content type');
          assert.ok(Array.isArray(response.body), 'Response should be an array');
        });

        it('should return JSON for contracts endpoint with application/json Accept header', async function () {
          const response = await makeRequest('GET', '/contracts', null, { 'Accept': 'application/json' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('application/json'), 'Should return JSON content type');
          assert.strictEqual(response.body.status, 'ok');
          assert.ok(Array.isArray(response.body.contracts), 'contracts should be an array');
        });
      });

      describe('HTML responses', function () {
        it('should return HTML when Accept header is text/html', async function () {
          const response = await makeRequest('GET', '/peers', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should return HTML for documents endpoint with text/html Accept header', async function () {
          const response = await makeRequest('GET', '/documents', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should return HTML for contracts endpoint with text/html Accept header', async function () {
          const response = await makeRequest('GET', '/contracts', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should return HTML for POST requests with text/html Accept header', async function () {
          const response = await makeRequest('POST', '/peers', { name: 'test-peer' }, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should return HTML for specific peer with text/html Accept header', async function () {
          const response = await makeRequest('GET', '/peers/test-peer-id', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should return HTML for specific document with text/html Accept header', async function () {
          const response = await makeRequest('GET', '/documents/test-document-id', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should return HTML for specific contract with text/html Accept header', async function () {
          const response = await makeRequest('GET', '/contracts/test-contract-id', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should return HTML shell for React Router paths without explicit API handlers (e.g. /sessions)', async function () {
          const response = await makeRequest('GET', '/sessions', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
          assert.ok(raw.includes('<html'), 'Should serve index.html for SPA refresh');
        });

        it('should return HTML shell for GET /settings with text/html (overview route)', async function () {
          const response = await makeRequest('GET', '/settings', null, { Accept: 'text/html' });
          assert.strictEqual(response.status, 200);
          assert.ok(response.headers['content-type'].includes('text/html'));
          const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
          assert.ok(raw.includes('<html'), 'Should serve SPA shell');
        });

        it('should return HTML shell for GET /settings/security with text/html', async function () {
          const response = await makeRequest('GET', '/settings/security', null, { Accept: 'text/html' });
          assert.strictEqual(response.status, 200);
          assert.ok(response.headers['content-type'].includes('text/html'));
          const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
          assert.ok(raw.includes('<html'), 'Should serve SPA shell');
        });

        it('should return HTML shell for GET /sessions/:id with text/html (session detail)', async function () {
          const response = await makeRequest('GET', '/sessions/test-token', null, { Accept: 'text/html' });
          assert.strictEqual(response.status, 200);
          assert.ok(response.headers['content-type'].includes('text/html'));
          const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
          assert.ok(raw.includes('<html'), 'Should serve SPA shell for refresh on session detail');
        });

        it('should return HTML shell for nested UI paths (e.g. /services/bitcoin/resources)', async function () {
          const response = await makeRequest('GET', '/services/bitcoin/resources', null, { 'Accept': 'text/html' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
          assert.ok(raw.includes('<html'), 'Should serve index.html for SPA refresh');
        });
      });

      describe('Peering service', function () {
        const jsonApi = { Accept: 'application/json' };

        it('GET /services/peering returns verifiable OracleAttestation', async function () {
          const response = await makeRequest('GET', '/services/peering', null, jsonApi);
          assert.strictEqual(response.status, 200);
          assert.strictEqual(response.body.service, 'peering');
          assert.ok(response.body.oracleAttestation);
          const PeeringService = require('../services/peering');
          assert.strictEqual(PeeringService.verifyOracleAttestation(response.body.oracleAttestation), true);
        });

        it('GET /services/peering/attestation returns a valid attestation', async function () {
          const response = await makeRequest('GET', '/services/peering/attestation', null, jsonApi);
          assert.strictEqual(response.status, 200);
          const PeeringService = require('../services/peering');
          assert.strictEqual(PeeringService.verifyOracleAttestation(response.body), true);
        });
      });

      describe('Distributed execution HTTP', function () {
        const jsonApi = { Accept: 'application/json' };

        it('GET /services/distributed/manifest returns JSON manifest', async function () {
          const response = await makeRequest('GET', '/services/distributed/manifest', null, jsonApi);
          assert.strictEqual(response.status, 200);
          assert.strictEqual(response.body.version, 1);
          assert.ok(typeof response.body.programId === 'string');
          assert.ok(
            response.body.hubFabricPeerId === null || typeof response.body.hubFabricPeerId === 'string',
            'hubFabricPeerId is optional operator hint (Fabric pubkey hex)'
          );
          assert.ok(
            response.body.federationVault === undefined ||
              response.body.federationVault === null ||
              typeof response.body.federationVault === 'object',
            'federationVault is an optional summary when validators are configured'
          );
        });

        it('GET /services/distributed/epoch returns beacon summary', async function () {
          const response = await makeRequest('GET', '/services/distributed/epoch', null, jsonApi);
          assert.strictEqual(response.status, 200);
          assert.strictEqual(response.body.service, 'distributed');
          assert.ok(response.body.beacon);
        });

        it('GET /services/distributed/vault returns FederationVaultSummary', async function () {
          const response = await makeRequest('GET', '/services/distributed/vault', null, jsonApi);
          assert.strictEqual(response.status, 200);
          assert.strictEqual(response.body.type, 'FederationVaultSummary');
          assert.ok(['ok', 'no_validators', 'error'].includes(response.body.status));
        });

        it('GET /services/distributed/vault/utxos returns 503 when Bitcoin is disabled', async function () {
          const response = await makeRequest('GET', '/services/distributed/vault/utxos', null, jsonApi);
          assert.strictEqual(response.status, 503);
          assert.strictEqual(response.body.status, 'error');
        });
      });

      describe('Accept header precedence', function () {
        it('should prefer HTML when HTML is listed first with equal priority', async function () {
          const response = await makeRequest('GET', '/peers', null, { 'Accept': 'text/html, application/json' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should prefer HTML when HTML is listed first', async function () {
          const response = await makeRequest('GET', '/peers', null, { 'Accept': 'text/html, application/json;q=0.9' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('text/html'), 'Should return HTML content type');
          assert.ok(typeof response.body === 'string', 'Response should be a string');
          assert.ok(response.body.includes('<html'), 'Response should contain HTML');
        });

        it('should handle wildcard Accept header', async function () {
          const response = await makeRequest('GET', '/peers', null, { 'Accept': '*/*' });

          assert.strictEqual(response.status, 200, 'Should return 200 status');
          assert.ok(response.headers['content-type'].includes('application/json'), 'Should return JSON content type by default');
          assert.ok(Array.isArray(response.body), 'Response should be an array');
        });
      });

      describe('L1 payment verification', function () {
        const jsonApi = { Accept: 'application/json' };

        it('GET /services/bitcoin/transactions/:txid?address&amountSats returns 503 when Bitcoin is disabled (L1 proof)', async function () {
          const tx = 'a'.repeat(64);
          const path = `/services/bitcoin/transactions/${tx}?address=${encodeURIComponent('bcrt1qtest')}&amountSats=1000`;
          const response = await makeRequest('GET', path, null, jsonApi);
          assert.strictEqual(response.status, 503);
          assert.strictEqual(response.body.status, 'error');
          assert.ok(String(response.body.message || '').toLowerCase().includes('bitcoin'), 'error mentions Bitcoin');
        });

        it('POST /payments returns 403 without admin token (Hub wallet spend)', async function () {
          const response = await makeRequest('POST', '/payments', {
            walletId: 'fabric-test-wallet',
            to: 'bcrt1qtest000000000000000000000000000000000000000',
            amountSats: 1000,
            memo: 'hub.http probe'
          }, jsonApi);
          assert.strictEqual(response.status, 403);
          assert.strictEqual(response.body.status, 'error');
          assert.ok(
            String(response.body.message || '').toLowerCase().includes('admin'),
            'error mentions admin token'
          );
        });

        it('POST /services/bitcoin/payments still aliases POST /payments (legacy path)', async function () {
          const response = await makeRequest('POST', '/services/bitcoin/payments', {
            walletId: 'fabric-test-wallet',
            to: 'bcrt1qtest000000000000000000000000000000000000000',
            amountSats: 1000,
            memo: 'hub.http legacy payments path'
          }, jsonApi);
          assert.strictEqual(response.status, 403);
          assert.strictEqual(response.body.status, 'error');
        });
      });

      it('GET /sessions/:sessionId/delegation/audit returns 403 without Bearer token', async function () {
        const response = await makeRequest('GET', '/sessions/not-a-real-token/delegation/audit', null, { Accept: 'application/json' });
        assert.strictEqual(response.status, 403);
        assert.strictEqual(response.body.ok, false);
      });

      it('DELETE /sessions/:sessionId returns 404 for unknown delegation token (loopback)', async function () {
        const response = await makeRequest('DELETE', '/sessions/not-a-delegation-token-xyz', null, { Accept: 'application/json' });
        assert.strictEqual(response.status, 404);
        assert.strictEqual(response.body.ok, false);
      });

      it('desktop login GET /sessions/:id returns signed payload once then 404 (ephemeral session retired)', async function () {
        const create = await makeRequest('POST', '/sessions', { origin: baseUrl }, { Accept: 'application/json' });
        assert.strictEqual(create.status, 200, JSON.stringify(create.body));
        assert.strictEqual(create.body.ok, true);
        const sid = create.body.sessionId;
        assert.ok(typeof sid === 'string' && sid.length > 16);

        const sign = await makeRequest('POST', `/sessions/${encodeURIComponent(sid)}/signatures`, {});
        assert.strictEqual(sign.status, 200, JSON.stringify(sign.body));
        assert.strictEqual(sign.body.ok, true);

        const g1 = await makeRequest('GET', `/sessions/${encodeURIComponent(sid)}`, null, { Accept: 'application/json' });
        assert.strictEqual(g1.status, 200);
        assert.strictEqual(g1.body.status, 'signed');
        assert.ok(g1.body.delegationToken);

        const g2 = await makeRequest('GET', `/sessions/${encodeURIComponent(sid)}`, null, { Accept: 'application/json' });
        assert.strictEqual(g2.status, 404);
        assert.strictEqual(g2.body.ok, false);
      });

      it('should allow document lifecycle RPC calls when activity logging is enabled', async function () {
        // Requires @fabric/http with HTTP JSON-RPC (`jsonRpc` + `POST /services/rpc`). Older pins only expose WebSocket JSONCall.
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }

        const createBody = {
          name: 'activity-log-test.txt',
          mime: 'text/plain',
          contentBase64: Buffer.from('hello-activity-log').toString('base64')
        };

        const createResponse = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 2,
          method: 'CreateDocument',
          params: [createBody]
        }, { Accept: 'application/json' });

        assert.strictEqual(createResponse.status, 200, 'CreateDocument should return 200 status');
        assert.ok(createResponse.body && createResponse.body.result && createResponse.body.result.document, 'CreateDocument should return a document');

        const createdId = createResponse.body.result.document.id;

        const publishResponse = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 3,
          method: 'PublishDocument',
          params: [createdId]
        }, { Accept: 'application/json' });

        assert.strictEqual(publishResponse.status, 200, 'PublishDocument should return 200 status');
      });

      it('RequestPeerInventory returns peer-not-connected without TCP peer', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }
        const r = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 400,
          method: 'RequestPeerInventory',
          params: ['127.0.0.1:59999', 'documents']
        }, { Accept: 'application/json' });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body && r.body.result, 'JSON-RPC result');
        assert.strictEqual(r.body.result.status, 'error');
        assert.ok(String(r.body.result.message).toLowerCase().includes('peer'), r.body.result.message);
      });

      it('RequestPeerInventory with HTLC options still requires connected peer', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }
        const r = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 401,
          method: 'RequestPeerInventory',
          params: ['127.0.0.1:59998', 'documents', {
            buyerRefundPublicKey: '02' + 'a'.repeat(64),
            inventoryRelayTtl: 3,
            inventoryTarget: 'fabric-peer-id-placeholder-test'
          }]
        }, { Accept: 'application/json' });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.result.status, 'error');
        assert.ok(String(r.body.result.message).toLowerCase().includes('peer'), r.body.result.message);
      });

      it('ListDocuments includes id after CreateDocument (HTTP catalog)', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }
        const stamp = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const createResponse = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 500,
          method: 'CreateDocument',
          params: [{
            name: `inventory-catalog-test-${stamp}.txt`,
            mime: 'text/plain',
            contentBase64: Buffer.from(`catalog-probe-${stamp}`).toString('base64')
          }]
        }, { Accept: 'application/json' });

        assert.strictEqual(createResponse.status, 200);
        assert.ok(createResponse.body.result && createResponse.body.result.document, 'CreateDocument returned document');
        const docId = createResponse.body.result.document.id;

        const list = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 501,
          method: 'ListDocuments',
          params: []
        }, { Accept: 'application/json' });
        assert.strictEqual(list.status, 200);
        const res = list.body && list.body.result;
        assert.ok(res && res.type === 'ListDocumentsResult', JSON.stringify(res));
        const ids = (res.documents || []).map((d) => d && d.id).filter(Boolean);
        assert.ok(ids.includes(docId), 'ListDocuments should list created document id');
      });

      it('GetDistributedFederationPolicy JSON-RPC returns policy shape', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }
        const r = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 42,
          method: 'GetDistributedFederationPolicy',
          params: []
        }, { Accept: 'application/json' });
        assert.strictEqual(r.status, 200);
        const res = r.body && r.body.result;
        assert.ok(res && res.type === 'DistributedFederationPolicy');
        assert.ok(Array.isArray(res.validators));
        assert.ok(typeof res.threshold === 'number');
        assert.ok(['env', 'persisted', 'default'].includes(res.source));
        assert.ok(res.filesystem && typeof res.filesystem.registryDocument === 'string');
        assert.ok(typeof res.filesystem.registryEntryCount === 'number');
      });
    });
  });
});
