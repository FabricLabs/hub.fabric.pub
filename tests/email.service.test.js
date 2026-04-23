'use strict';

const assert = require('assert');
const EmailService = require('../services/email');

describe('EmailService', function () {
  it('resolves smtp when host is set', function () {
    const s = new EmailService({ host: '127.0.0.1' });
    assert.strictEqual(s.getTransportMode(), 'smtp');
  });

  it('resolves postmark when key is set and host is absent', function () {
    const s = new EmailService({ key: 'x'.repeat(20), host: null });
    assert.strictEqual(s.getTransportMode(), 'postmark');
  });

  it('honors explicit transport postmark', function () {
    const s = new EmailService({ transport: 'postmark', key: 'k', host: 'smtp.example.com' });
    assert.strictEqual(s.getTransportMode(), 'postmark');
  });

  it('returns null when not configured', function () {
    const s = new EmailService({ host: null, key: null, transport: null });
    assert.strictEqual(s.getTransportMode(), null);
  });
});
