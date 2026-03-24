'use strict';

const assert = require('assert');
const {
  safeBriefMessage,
  safeUrlForLog
} = require('../functions/fabricSafeLog');

describe('fabricSafeLog', () => {
  it('safeBriefMessage prefers string .message / .error', () => {
    assert.strictEqual(safeBriefMessage('x'), 'x');
    assert.strictEqual(safeBriefMessage({ message: 'm' }, 'f'), 'm');
    assert.strictEqual(safeBriefMessage({ error: 'e' }, 'f'), 'e');
    assert.strictEqual(safeBriefMessage({ foo: 'bar' }, 'f'), 'f');
  });

  it('safeUrlForLog strips query and hash', () => {
    assert.strictEqual(
      safeUrlForLog('wss://hub.example.com:8443/path?token=secret&x=1#frag'),
      'hub.example.com:8443/path'
    );
    assert.strictEqual(safeUrlForLog(''), '(empty)');
  });
});
