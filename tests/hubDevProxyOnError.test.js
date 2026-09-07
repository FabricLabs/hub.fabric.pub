'use strict';

const assert = require('assert');
const { hubDevProxyOnError } = require('../functions/hubDevProxyOnError');

describe('hubDevProxyOnError', function () {
  it('writes JSON 502 so /settings is not SPA HTML', function () {
    const chunks = [];
    const res = {
      headersSent: false,
      writeHead (status, headers) {
        this.statusCode = status;
        this.headers = headers;
      },
      end (body) {
        chunks.push(String(body));
      }
    };
    hubDevProxyOnError(new Error('ECONNREFUSED'), {}, res);
    assert.strictEqual(res.statusCode, 502);
    assert.ok(String(res.headers['Content-Type']).includes('application/json'));
    const json = JSON.parse(chunks.join(''));
    assert.strictEqual(json.error, 'hub-unreachable');
  });

  it('uses Express res.json when present', function () {
    let payload = null;
    const res = {
      headersSent: false,
      status (code) {
        this.statusCode = code;
        return this;
      },
      json (obj) {
        payload = obj;
        return this;
      }
    };
    hubDevProxyOnError(new Error('connect ECONNREFUSED'), {}, res);
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(payload.error, 'hub-unreachable');
  });
});
