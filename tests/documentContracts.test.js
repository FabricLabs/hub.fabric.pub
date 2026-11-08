'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const {
  buildDocumentRevisionMessage,
  verifyDocumentProvenance
} = require('@fabric/core/functions/documentRevisions');
const DocumentContractsService = require('../services/documentContracts');

const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const version = (text, name = 'note.txt') => ({ id: sha(text), sha256: sha(text), name, mime: 'text/plain', size: text.length });

function memoryFs () {
  const files = new Map();
  return {
    files,
    readFile: (name) => (files.has(name) ? files.get(name) : null),
    publish: async (name, value) => { files.set(name, JSON.stringify(value)); }
  };
}

async function service (opts = {}) {
  const fs = opts.fs || memoryFs();
  const relayed = [];
  const svc = new DocumentContractsService(opts.settings || {});
  svc.attach({ fs, key: opts.key || new Key(), relay: (m) => relayed.push(m) });
  await svc.start();
  return { svc, fs, relayed };
}

describe('DocumentContractsService', function () {
  it('makes a document editable with its earlier versions as revisions', async function () {
    const { svc, relayed } = await service();
    const contract = await svc.create({ history: [version('one'), version('two')] });
    assert.strictEqual(contract.revisions.length, 2);
    assert.strictEqual(contract.head.documentIdentifier, sha('two'));
    assert.strictEqual(contract.editable, true);
    assert.strictEqual(relayed.length, 3, 'publish + two revisions go to the mesh');
    const row = svc.contractFor(sha('one'));
    assert.strictEqual(row.contractId, contract.contractId);
    assert.strictEqual(row.revision, 1);
    assert.strictEqual(row.head, false);
    assert.strictEqual(row.headDocumentId, sha('two'));
    await assert.rejects(svc.create({ history: [version('two')] }), /already belongs/);
  });

  it('appends a revision, and an edit of an older version forks', async function () {
    const { svc } = await service();
    await svc.create({ history: [version('a')] });
    const second = await svc.appendRevision({ previousDocumentId: sha('a'), document: version('b'), note: 'fix typo' });
    assert.strictEqual(second.revision.revision, 2);
    assert.strictEqual(second.revision.note, 'fix typo');
    const fork = await svc.appendRevision({ previousDocumentId: sha('a'), document: version('c') });
    assert.strictEqual(fork.revision.revision, 2);
    const view = svc.get(second.contractId);
    assert.strictEqual(view.revisions.length + view.forks.length, 3);
    assert.ok(svc.contractFor(sha('b')));
    assert.ok(svc.contractFor(sha('c')));
  });

  it('keeps every frame across a restart', async function () {
    const key = new Key();
    const fs = memoryFs();
    const first = await service({ fs, key });
    const contract = await first.svc.create({ history: [version('x')] });
    await first.svc.appendRevision({ previousDocumentId: sha('x'), document: version('y') });
    const again = await service({ fs, key });
    const view = again.svc.get(contract.contractId);
    assert.strictEqual(view.revisions.length, 2);
    assert.strictEqual(again.svc.contractFor(sha('y')).revision, 2);
  });

  it('gives an old version provenance without the later edits, checkable elsewhere', async function () {
    const { svc } = await service();
    await svc.create({ history: [version('v1')] });
    await svc.appendRevision({ previousDocumentId: sha('v1'), document: version('v2') });
    await svc.appendRevision({ previousDocumentId: sha('v2'), document: version('v3') });
    const provenance = svc.provenanceFor(sha('v2'));
    assert.strictEqual(provenance.revision, 2);
    assert.strictEqual(provenance.collection.messages.length, 3, 'publish + revisions 1 and 2');
    const checked = verifyDocumentProvenance(JSON.parse(JSON.stringify(provenance)), { documentIdentifier: sha('v2') });
    assert.strictEqual(checked.ok, true, checked.reason);

    const buyer = await service();
    const kept = await buyer.svc.ingestProvenance(provenance, { documentIdentifier: sha('v2') });
    assert.strictEqual(kept.ok, true);
    assert.strictEqual(buyer.svc.contractFor(sha('v2')).revision, 2);
    assert.strictEqual(buyer.svc.contractFor(sha('v3')), null);
    assert.strictEqual(buyer.svc.get(provenance.contractId).editable, false);
  });

  it('takes mesh frames in any order and refuses revisions by non-editors', async function () {
    const seller = await service();
    const contract = await seller.svc.create({ history: [version('m1')] });
    await seller.svc.appendRevision({ previousDocumentId: sha('m1'), document: version('m2') });
    const frames = seller.svc.frames(contract.contractId);

    const peer = await service();
    const reversed = frames.slice().reverse();
    for (const f of reversed) await peer.svc.ingestFrame(f.hex);
    assert.strictEqual(peer.svc.get(contract.contractId).revisions.length, 2);

    const stranger = new Key();
    const forged = buildDocumentRevisionMessage({
      contract: contract.contractId,
      previous: frames[frames.length - 1].id,
      document: version('m3'),
      revision: 3,
      previousDocumentIdentifier: sha('m2'),
      key: stranger
    });
    const res = await peer.svc.ingestFrame(forged.toBuffer());
    assert.strictEqual(res.accepted, false);
    assert.match(res.reason, /not signed by an editor/);
    assert.strictEqual(peer.svc.get(contract.contractId).revisions.length, 2);
    assert.strictEqual(peer.svc.contractFor(sha('m3')), null);
  });

  it('refuses edits from a Hub that is not an editor', async function () {
    const seller = await service();
    const contract = await seller.svc.create({ history: [version('e1')] });
    const other = await service();
    for (const f of seller.svc.frames(contract.contractId)) await other.svc.ingestFrame(f.hex);
    await assert.rejects(
      other.svc.appendRevision({ previousDocumentId: sha('e1'), document: version('e2') }),
      /not an editor/
    );
  });
});
