'use strict';

const assert = require('assert');
const { describeHubRpcFailure } = require('../functions/hubRpcHints');

describe('hubRpcHints', function () {
  it('describeHubRpcFailure appends restart hint for method not found', function () {
    const s = describeHubRpcFailure('Method not found: Foo', 'ignored');
    assert.ok(/Method not found: Foo/.test(s));
    assert.ok(/Restart the Hub/.test(s));
    assert.ok(/services\/hub\.js/.test(s));
    assert.ok(!/ignored/.test(s));
  });

  it('describeHubRpcFailure appends transport hint otherwise', function () {
    const s = describeHubRpcFailure('Network down', 'Try again.');
    assert.strictEqual(s, 'Network down Try again.');
  });

  it('describeHubRpcFailure omits empty transport hint', function () {
    assert.strictEqual(describeHubRpcFailure('oops', ''), 'oops');
    assert.strictEqual(describeHubRpcFailure('oops', '   '), 'oops');
  });
});
