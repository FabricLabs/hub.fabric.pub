'use strict';

const assert = require('assert');
const { looksLikeBulkSecurityAdvisory } = require('../functions/bulkSecurityAdvisory');

describe('looksLikeBulkSecurityAdvisory', function () {
  it('drops GitHub security_advisory webhook bodies', function () {
    assert.strictEqual(looksLikeBulkSecurityAdvisory({
      security_advisory: {
        ghsa_id: 'GHSA-xxxx-yyyy-zzzz',
        summary: 'Malicious code in @zalastax/nolb-foo (npm)'
      }
    }), true);
  });

  it('drops zalastax package names on metadata', function () {
    assert.strictEqual(looksLikeBulkSecurityAdvisory({
      name: '@zalastax/nolb-abcdef',
      mime: 'application/json'
    }), true);
  });

  it('drops UTF-8 JSON buffers', function () {
    const buf = Buffer.from(JSON.stringify({
      security_advisory: { summary: 'Malicious code in @foo/bar (npm)', type: 'malware' }
    }), 'utf8');
    assert.strictEqual(looksLikeBulkSecurityAdvisory(buf), true);
  });

  it('allows ordinary documents', function () {
    assert.strictEqual(looksLikeBulkSecurityAdvisory({
      name: 'readme.md',
      mime: 'text/markdown'
    }), false);
    assert.strictEqual(looksLikeBulkSecurityAdvisory(Buffer.from('hello fabric', 'utf8')), false);
  });

  it('drops JSON arrays of advisory objects', function () {
    assert.strictEqual(looksLikeBulkSecurityAdvisory([
      { name: 'readme.md' },
      { security_advisory: { ghsa_id: 'GHSA-aaaa-bbbb-cccc' } }
    ]), true);
    assert.strictEqual(looksLikeBulkSecurityAdvisory(JSON.stringify([
      { security_advisory: { type: 'malware' } }
    ])), true);
    assert.strictEqual(looksLikeBulkSecurityAdvisory([{ name: 'readme.md' }]), false);
  });
});
