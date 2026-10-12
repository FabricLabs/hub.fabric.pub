'use strict';

const assert = require('assert');
const federationRegistry = require('../functions/federationRegistry');

describe('federationRegistry', () => {
  it('policy snapshot round-trips signatureScheme', async () => {
    const store = Object.create(null);
    const fs = {
      readFile (p) { return store[p] != null ? store[p] : null; },
      async publish (p, value) {
        store[p] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    };
    await federationRegistry.persistPolicySnapshot(fs, {
      validators: ['02aa'],
      threshold: 1,
      signatureScheme: 'bls',
      source: 'persisted'
    });
    const loaded = federationRegistry.loadPolicySnapshot(fs);
    assert.strictEqual(loaded.signatureScheme, 'bls');
    assert.strictEqual(loaded.threshold, 1);
    await federationRegistry.persistPolicySnapshot(fs, {
      validators: ['02aa'],
      threshold: 1,
      source: 'persisted'
    });
    assert.strictEqual(federationRegistry.loadPolicySnapshot(fs).signatureScheme, 'schnorr');
  });

  it('parseFabricFederationOpReturn reads fabfed + JSON from asm', () => {
    const payloadHex = Buffer.concat([
      Buffer.from('fabfed', 'utf8'),
      Buffer.from(JSON.stringify({ fabricFederation: { id: 'acme', name: 'Acme Fed' } }), 'utf8')
    ]).toString('hex');
    const spk = {
      type: 'nulldata',
      asm: `OP_RETURN ${payloadHex}`
    };
    const out = federationRegistry.parseFabricFederationOpReturn(spk);
    assert.ok(out);
    assert.strictEqual(out.id, 'acme');
    assert.strictEqual(out.name, 'Acme Fed');
  });

  it('extractFederationAnnouncementsFromBlock collects matching tx', () => {
    const payloadHex = Buffer.concat([
      Buffer.from('fabfed', 'utf8'),
      Buffer.from(JSON.stringify({ fabricFederation: { id: 'onchain1' } }), 'utf8')
    ]).toString('hex');
    const block = {
      tx: [{
        txid: 'aa'.repeat(32),
        vout: [{
          n: 0,
          scriptPubKey: { type: 'nulldata', asm: `OP_RETURN ${payloadHex}` }
        }]
      }]
    };
    const anns = federationRegistry.extractFederationAnnouncementsFromBlock(block, 42);
    assert.strictEqual(anns.length, 1);
    assert.strictEqual(anns[0].id, 'onchain1');
    assert.strictEqual(anns[0].txid, 'aa'.repeat(32));
    assert.strictEqual(anns[0].height, 42);
  });
});
