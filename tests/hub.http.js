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
          hostname: '127.0.0.1',
          interface: '127.0.0.1',
          listen: true,
          port: httpPort
        },
        debug: false
      }));

      await hub.start();

      // Get the HTTP server instance and base URL
      // The HTTP server might be accessed differently, let's try to get the address from the hub
      baseUrl = `http://127.0.0.1:${httpPort}`;

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
        it('should create a contract resource redirect', async function () {
          const contractData = {
            name: 'Test Contract',
            type: 'agreement',
            parties: ['party1', 'party2']
          };

          const response = await makeRequest('POST', '/contracts', contractData);

          assert.strictEqual(response.status, 303, 'Should return 303 redirect');
          assert.ok(response.headers.location, 'Should include Location header');
          assert.ok(response.headers.location.startsWith('/contracts/'), 'Location should target the new contract');
        });

        it('should create an empty contract payload', async function () {
          const response = await makeRequest('POST', '/contracts', {});

          assert.strictEqual(response.status, 303, 'Should return 303 redirect');
          assert.ok(response.headers.location, 'Should include Location header');
          assert.ok(response.headers.location.startsWith('/contracts/'), 'Location should target the new contract');
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
        it('should create a peer resource redirect', async function () {
          const response = await makeRequest('POST', '/peers', { name: 'test-peer', address: 'localhost:8080' });

          assert.strictEqual(response.status, 303, 'Should return 303 redirect');
          assert.ok(response.headers.location, 'Should include Location header');
          assert.ok(response.headers.location.startsWith('/peers/'), 'Location should target the new peer');
        });

        it('should create an empty peer payload', async function () {
          const response = await makeRequest('POST', '/peers', {});

          assert.strictEqual(response.status, 303, 'Should return 303 redirect');
          assert.ok(response.headers.location, 'Should include Location header');
          assert.ok(response.headers.location.startsWith('/peers/'), 'Location should target the new peer');
        });
      });

      describe('GET /peers/:id', function () {
        it('should return not found for unknown peer id', async function () {
          const response = await makeRequest('GET', '/peers/test-peer-id');

          assert.strictEqual(response.status, 404, 'Should return 404 status');
          assert.strictEqual(response.body.status, 'error');
          assert.strictEqual(response.body.message, 'Peer not found');
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
        it('should create a document resource redirect', async function () {
          const documentData = {
            title: 'Test Document',
            content: 'This is a test document content',
            author: 'test-author'
          };

          const response = await makeRequest('POST', '/documents', documentData);

          assert.strictEqual(response.status, 303, 'Should return 303 redirect');
          assert.ok(response.headers.location, 'Should include Location header');
          assert.ok(response.headers.location.startsWith('/documents/'), 'Location should target the new document');
        });

        it('should create an empty document payload', async function () {
          const response = await makeRequest('POST', '/documents', {});

          assert.strictEqual(response.status, 303, 'Should return 303 redirect');
          assert.ok(response.headers.location, 'Should include Location header');
          assert.ok(response.headers.location.startsWith('/documents/'), 'Location should target the new document');
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
        it('should return 404 for unknown document IDs', async function () {
          const response = await makeRequest('GET', '/documents/test-document-id');

          assert.strictEqual(response.status, 404, 'Should return 404 status');
          assert.strictEqual(response.body.error, 'Document not found');
        });

        it('should return 404 for non-existent document IDs', async function () {
          const response = await makeRequest('GET', '/documents/non-existent-id');

          assert.strictEqual(response.status, 404, 'Should return 404 status');
          assert.strictEqual(response.body.error, 'Document not found');
        });
      });
    });

    describe('Content Type Validation', function () {
      it('should accept JSON content type for POST requests', async function () {
        const response = await makeRequest('POST', '/peers', { test: 'data' }, { 'Content-Type': 'application/json' });

        assert.strictEqual(response.status, 303, 'Should return 303 redirect');
        assert.ok(response.headers.location && response.headers.location.startsWith('/peers/'));
      });

      it('should handle requests without content type header', async function () {
        const response = await makeRequest('POST', '/documents', { test: 'data' }, {});

        assert.strictEqual(response.status, 303, 'Should return 303 redirect');
        assert.ok(response.headers.location && response.headers.location.startsWith('/documents/'));
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
        assert.ok(typeof run.programHash === 'string');
        assert.strictEqual(run.programHash.length, 64);
        assert.ok(typeof run.executionRunCommitmentHex === 'string');
        assert.ok(run.fabricProgramRun && run.fabricProgramRun.kind === 'FabricProgramRun');
        assert.strictEqual(run.fabricProgramRun.runCommitmentHex, run.runCommitmentHex);
        assert.strictEqual(run.programHash, created.contract.programDigest);
        assert.strictEqual(run.runner, 'Machine/fabric-execution');
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

          assert.strictEqual(response.status, 303, 'Should return redirect status');
          assert.ok(response.headers.location && response.headers.location.startsWith('/peers/'));
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

        it('GET /services/coinjoin reports the coinjoin market without Bitcoin', async function () {
          const response = await makeRequest('GET', '/services/coinjoin', null, jsonApi);
          assert.strictEqual(response.status, 200);
          assert.strictEqual(response.body.type, 'CoinjoinStatus');
          assert.strictEqual(response.body.available, false);
          assert.ok(response.body.reason, 'says why it is unavailable');
        });

        it('coinjoin rounds, maker terms, and bonds need the admin token', async function () {
          for (const [method, route] of [
            ['POST', '/services/coinjoin/offers'],
            ['POST', '/services/coinjoin/rounds'],
            ['GET', '/services/coinjoin/rounds'],
            ['POST', '/services/coinjoin/bonds'],
            ['GET', '/services/coinjoin/bonds']
          ]) {
            const response = await makeRequest(method, route, method === 'POST' ? { amountSats: 100000 } : null, jsonApi);
            assert.strictEqual(response.status, 401, `${method} ${route}`);
          }
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

        it('GET /payments returns 503 when Bitcoin is disabled', async function () {
          const response = await makeRequest('GET', '/payments?limit=5', null, jsonApi);
          assert.strictEqual(response.status, 503);
          assert.strictEqual(response.body.status, 'error');
        });
      });

      describe('Passport v2 sessions', function () {
        const { FIXTURE_SEED } = require('@fabric/core/constants');
        const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
        const { signAssertion } = require('@fabric/core/functions/passport');
        const MASTER = importSeed(FIXTURE_SEED);

        function cookieFrom (response, name) {
          const list = [].concat(response.headers['set-cookie'] || []);
          for (const line of list) {
            const first = String(line).split(';')[0];
            const eq = first.indexOf('=');
            if (first.slice(0, eq).trim() === name) return first.slice(eq + 1);
          }
          return null;
        }

        async function signIn () {
          const challenge = await makeRequest('POST', '/sessions/challenges', { request: [] }, { Accept: 'application/json', Origin: baseUrl });
          assert.strictEqual(challenge.status, 200, JSON.stringify(challenge.body));
          const binding = cookieFrom(challenge, 'fabric.passport');
          assert.ok(binding, 'binding cookie set');
          const account = deriveAccount(MASTER, { account: 0, network: challenge.body.network });
          const assertion = signAssertion({
            challenge: challenge.body.challenge,
            origin: baseUrl,
            signer: 'passport'
          }, account.identity.key).uri;
          const session = await makeRequest('POST', '/sessions', { assertion }, {
            Accept: 'application/json',
            Origin: baseUrl,
            Cookie: `fabric.passport=${binding}`
          });
          return { challenge, session, account, binding, assertion };
        }

        it('challenge → assertion → /sessions/current → sign out', async function () {
          const { session, account } = await signIn();
          assert.strictEqual(session.status, 200, JSON.stringify(session.body));
          assert.strictEqual(session.body.session.identity.pubkey, account.identity.pubkey.toLowerCase());
          assert.strictEqual(session.body.session.signer, 'passport');
          assert.strictEqual(session.body.session.wallet, undefined, 'no wallet without consent');
          assert.strictEqual(session.body.token, undefined, 'browser clients get a cookie, not a token');
          const token = cookieFrom(session, 'fabric.session');
          assert.ok(token);
          const setCookie = [].concat(session.headers['set-cookie']).join('\n');
          assert.ok(/fabric\.session=[^;]+;[^\n]*HttpOnly/i.test(setCookie));
          assert.ok(/fabric\.session=[^;]+;[^\n]*SameSite=Strict/i.test(setCookie));

          const current = await makeRequest('GET', '/sessions/current', null, { Accept: 'application/json', Cookie: `fabric.session=${token}` });
          assert.strictEqual(current.status, 200);
          assert.strictEqual(current.body.session.identity.id, session.body.session.identity.id);

          const end = await makeRequest('DELETE', '/sessions/current', null, { Accept: 'application/json', Origin: baseUrl, Cookie: `fabric.session=${token}` });
          assert.strictEqual(end.status, 200);
          const after = await makeRequest('GET', '/sessions/current', null, { Accept: 'application/json', Cookie: `fabric.session=${token}` });
          assert.strictEqual(after.status, 401);
        });

        it('refuses an assertion without its binding cookie, and replays', async function () {
          const challenge = await makeRequest('POST', '/sessions/challenges', {}, { Accept: 'application/json', Origin: baseUrl });
          assert.strictEqual(challenge.status, 200);
          const account = deriveAccount(MASTER, { account: 1, network: challenge.body.network });
          const assertion = signAssertion({ challenge: challenge.body.challenge, origin: baseUrl, signer: 'passport' }, account.identity.key).uri;
          const noBinding = await makeRequest('POST', '/sessions', { assertion }, { Accept: 'application/json', Origin: baseUrl });
          assert.notStrictEqual(noBinding.status, 200);

          const ok = await signIn();
          assert.strictEqual(ok.session.status, 200);
          const replay = await makeRequest('POST', '/sessions', { assertion: ok.assertion }, {
            Accept: 'application/json',
            Origin: baseUrl,
            Cookie: `fabric.passport=${ok.binding}`
          });
          assert.notStrictEqual(replay.status, 200, 'each challenge redeems once');
        });

        it('refuses a challenge for an origin that is not pinned', async function () {
          const response = await makeRequest('POST', '/sessions/challenges', {}, { Accept: 'application/json', Origin: 'https://evil.example' });
          assert.strictEqual(response.status, 403);
        });

        it('refuses an assertion redeemed from another origin', async function () {
          const challenge = await makeRequest('POST', '/sessions/challenges', {}, { Accept: 'application/json', Origin: baseUrl });
          const binding = cookieFrom(challenge, 'fabric.passport');
          const account = deriveAccount(MASTER, { account: 2, network: challenge.body.network });
          const assertion = signAssertion({ challenge: challenge.body.challenge, origin: baseUrl, signer: 'passport' }, account.identity.key).uri;
          const response = await makeRequest('POST', '/sessions', { assertion }, {
            Accept: 'application/json',
            Origin: 'https://evil.example',
            Cookie: `fabric.passport=${binding}`
          });
          assert.strictEqual(response.status, 403);
        });
      });

      describe('H1 regression: the Hub key signs nothing for a web page', function () {
        const jsonApi = { Accept: 'application/json' };

        it('POST /sessions/self is not served outside the desktop app', async function () {
          const response = await makeRequest('POST', '/sessions/self', {}, { ...jsonApi, Origin: baseUrl });
          assert.strictEqual(response.status, 404);
        });

        it('the old desktop-login signature route is gone', async function () {
          const response = await makeRequest('POST', '/sessions/anything/signatures', {}, jsonApi);
          assert.notStrictEqual(response.status, 200);
          assert.ok(!response.body || !response.body.signer, 'no Hub signature is returned');
        });

        it('the delegation audit route is gone', async function () {
          const response = await makeRequest('GET', '/sessions/anything/delegation/audit', null, jsonApi);
          assert.notStrictEqual(response.status, 200);
        });

        it('delegation and arbitrary-signing RPC methods are not registered', async function () {
          for (const method of [
            'PostDelegationSignatureMessage',
            'GetDelegationSignatureMessage',
            'ResolveDelegationSignatureMessage',
            'SignArbitraryText'
          ]) {
            const response = await makeRequest('POST', '/services/rpc', {
              jsonrpc: '2.0',
              id: 1,
              method,
              params: [{ message: 'sign me', sessionToken: 'x', sessionId: 'x', messageId: 'x', status: 'approved' }]
            }, jsonApi);
            if (response.status === 404) continue;
            assert.ok(response.body && response.body.error, `${method} must not answer: ${JSON.stringify(response.body)}`);
            assert.ok(!response.body.result, `${method} returned a result`);
          }
        });

        it('no unauthenticated route or RPC makes the root key sign, or reveals it', async function () {
          const root = hub._rootKey;
          if (!root || !root.private) return this.skip();
          assert.ok(hub._fabricKey && hub._fabricKey.pubkey !== root.pubkey, 'the Hub signs with a derived identity key');
          const calls = [];
          const restore = [];
          for (const name of ['sign', 'signSchnorr', 'signSchnorrHash', 'signHash']) {
            if (typeof root[name] !== 'function') continue;
            const original = root[name];
            root[name] = function (...args) {
              calls.push(name);
              return original.apply(this, args);
            };
            restore.push(() => { root[name] = original; });
          }
          const bodies = [];
          try {
            for (const route of ['/services/peering', '/services/peering/attestation', '/services/federations', '/settings']) {
              const response = await makeRequest('GET', route, null, jsonApi);
              bodies.push(JSON.stringify(response.body || ''));
            }
            const challenge = await makeRequest('POST', '/sessions/challenges', {}, { ...jsonApi, Origin: baseUrl });
            bodies.push(JSON.stringify(challenge.body || ''));
            for (const [method, params] of [
              ['GetNetworkStatus', []],
              ['ListPeers', []],
              ['GetPeeringAttestation', []],
              ['ListDocuments', []],
              ['ListTrackedApplicationContracts', []],
              ['GetSidechainState', []],
              ['SubmitChatMessage', [{ content: 'h1 regression', actor: { username: 'test' } }]],
              ['CreateDocument', [{ content: Buffer.from('h1').toString('base64'), name: 'h1.txt', mime: 'text/plain' }]]
            ]) {
              const response = await makeRequest('POST', '/services/rpc', { jsonrpc: '2.0', id: 1, method, params }, jsonApi);
              bodies.push(JSON.stringify(response.body || ''));
            }
          } finally {
            restore.forEach((fn) => fn());
          }
          assert.deepStrictEqual(calls, [], 'the root key signed something');
          const rootPubkey = String(root.pubkey);
          const rootXOnly = rootPubkey.slice(2);
          for (const text of bodies) {
            assert.ok(!text.includes(String(root.xpub)), 'the root xpub is never served');
            assert.ok(!text.includes(rootPubkey) && !text.includes(rootXOnly), 'the root pubkey is never served');
          }
        });

        it('the local signer routes are not served outside the desktop app', async function () {
          for (const [method, route] of [
            ['GET', '/services/fabric/identity'],
            ['POST', '/services/fabric/sign'],
            ['POST', '/services/fabric/link']
          ]) {
            const response = await makeRequest(method, route, method === 'POST' ? {} : null, jsonApi);
            assert.notStrictEqual(response.status, 200, `${method} ${route}`);
          }
        });
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

      it('ListDocumentOffers and RefreshDocumentMarket are off by default', async function () {
        const probe = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 1,
          method: 'GetSetupStatus',
          params: []
        }, { Accept: 'application/json' });
        if (probe.status !== 200 || !(probe.body && probe.body.jsonrpc === '2.0' && probe.body.result)) {
          return this.skip();
        }
        const offers = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 610,
          method: 'ListDocumentOffers',
          params: []
        }, { Accept: 'application/json' });
        assert.strictEqual(offers.status, 200);
        const offerRes = offers.body && offers.body.result;
        assert.ok(offerRes && offerRes.type === 'ListDocumentOffersResult');
        assert.ok(Array.isArray(offerRes.offers));
        assert.strictEqual(offerRes.documentMarket.accumulatePeerInventories, false);

        const refresh = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 611,
          method: 'RefreshDocumentMarket',
          params: []
        }, { Accept: 'application/json' });
        assert.strictEqual(refresh.status, 200);
        const refreshRes = refresh.body && refresh.body.result;
        assert.ok(refreshRes && refreshRes.type === 'RefreshDocumentMarketResult');
        assert.strictEqual(refreshRes.requested, 0);
        assert.ok(String(refreshRes.message || '').toLowerCase().includes('accumulate'));

        const status = await makeRequest('POST', '/services/rpc', {
          jsonrpc: '2.0',
          id: 612,
          method: 'GetNetworkStatus',
          params: []
        }, { Accept: 'application/json' });
        assert.strictEqual(status.status, 200);
        const ns = status.body && status.body.result;
        assert.ok(ns && ns.documentMarket);
        assert.strictEqual(ns.documentMarket.accumulatePeerInventories, false);
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
        assert.ok(res.signatureScheme === 'schnorr' || res.signatureScheme === 'bls');
        assert.ok(['env', 'persisted', 'default'].includes(res.source));
        assert.ok(res.filesystem && typeof res.filesystem.registryDocument === 'string');
        assert.ok(typeof res.filesystem.registryEntryCount === 'number');
      });
    });
  });
});
