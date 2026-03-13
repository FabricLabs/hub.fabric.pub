'use strict';

const assert = require('assert');
const http = require('http');
const url = require('url');
const merge = require('lodash.merge');
const Hub = require('../services/hub');
const settings = require('../settings/local');

describe('@fabric/hub', function () {
  describe('HTTP Endpoints', function () {
    let hub;
    let server;
    let baseUrl;

    before(async function () {
      this.timeout(30000);

      // Use project settings with test overrides: distinct ports to avoid EADDRINUSE,
      // Bitcoin disabled so we don't need bitcoind or regtest lock for HTTP-only tests.
      hub = new Hub(merge({}, settings, {
        port: 7778,
        bitcoin: {
          enable: false,
          network: 'regtest'
        },
        http: {
          hostname: 'localhost',
          listen: true,
          port: 8082
        },
        debug: false
      }));

      await hub.start();

      // Get the HTTP server instance and base URL
      // The HTTP server might be accessed differently, let's try to get the address from the hub
      baseUrl = `http://localhost:8082`;

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

      it('should allow document lifecycle RPC calls when activity logging is enabled', async function () {
        const createBody = {
          name: 'activity-log-test.txt',
          mime: 'text/plain',
          contentBase64: Buffer.from('hello-activity-log').toString('base64')
        };

        const createResponse = await makeRequest('POST', '/rpc', {
          method: 'CreateDocument',
          params: [createBody]
        }, { 'Accept': 'application/json' });

        assert.strictEqual(createResponse.status, 200, 'CreateDocument should return 200 status');
        assert.ok(createResponse.body && createResponse.body.result && createResponse.body.result.document, 'CreateDocument should return a document');

        const createdId = createResponse.body.result.document.id;

        const publishResponse = await makeRequest('POST', '/rpc', {
          method: 'PublishDocument',
          params: [createdId]
        }, { 'Accept': 'application/json' });

        assert.strictEqual(publishResponse.status, 200, 'PublishDocument should return 200 status');
      });
    });
  });
});
