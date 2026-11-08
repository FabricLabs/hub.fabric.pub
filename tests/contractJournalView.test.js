'use strict';

const assert = require('assert');
const cj = require('../functions/contractJournalView');
const records = require('../functions/collectionRecords');

const ID = 'ab'.repeat(32);

function application () {
  return {
    contractId: ID,
    status: 'accepted',
    tracked: { contractId: ID, name: 'Goon', version: '1', status: 'accepted', signer: '02' + 'a'.repeat(64) },
    sidechain: { clock: 3, stateDigest: 'd'.repeat(64), parentSealPath: `/namespaces/${ID}` },
    seals: [{ seq: 7, clock: 3, at: '2026-01-03T00:00:00.000Z' }],
    queue: { count: 1, entries: [{ hash: 'q'.repeat(64), type: 'GroupChange', enqueuedAt: '2026-01-04T00:00:00.000Z' }] },
    messages: [{ id: 'm1', seq: 1, type: 'CONTRACT_PUBLISH', created: '2026-01-01T00:00:00.000Z', frameId: 'f'.repeat(64) }]
  };
}

describe('contractJournalView', function () {
  it('turns journal entries into rows with a Fabric link when they have one', function () {
    const rows = cj.journalRows([
      { id: 'a', type: 'GroupChange', at: 1767225600000, fabricMessage: { hash: 'h'.repeat(64) } },
      { type: 'FleetShare', created: '2026-01-02T00:00:00.000Z' }
    ]);
    assert.deepStrictEqual(rows.map((r) => [r.key, r.label, r.fabricHref]), [
      ['a', 'Group change', `/messages/${'h'.repeat(64)}`],
      ['j1', 'Fleet share', null]
    ]);
    assert.strictEqual(rows[0].at, new Date(1767225600000).toISOString());
    const custom = cj.journalRows([{ type: 'X', frameId: 'z' }], { label: () => 'Custom', hrefForHash: (h) => `/collections/fabric-message/${h}` });
    assert.deepStrictEqual([custom[0].label, custom[0].fabricHref], ['Custom', '/collections/fabric-message/z']);
  });

  it('merges log, seal, and queue rows newest first', function () {
    const rows = cj.applicationTimeline(application());
    assert.deepStrictEqual(rows.map((r) => r.source), ['queue', 'seal', 'log']);
    assert.strictEqual(rows[2].fabricHref, `/messages/${'f'.repeat(64)}`);
    assert.strictEqual(rows[1].label, 'Statechain sealed (clock 3)');
    assert.strictEqual(rows[0].label, 'Queued group change');
    assert.deepStrictEqual(cj.applicationTimeline(null), []);
  });

  it('summarizes an application contract', function () {
    const s = cj.applicationSummary(application());
    assert.deepStrictEqual(
      [s.contractId, s.name, s.status, s.clock, s.parentSealPath, s.queued, s.seals, s.messages],
      [ID, 'Goon', 'accepted', 3, `/namespaces/${ID}`, 1, 1, 1]
    );
    assert.strictEqual(cj.applicationSummary({ tracked: { contractId: ID, status: 'pending' } }).clock, null);
  });
});

describe('collectionRecords', function () {
  it('sends Hub kinds to their own pages and others to /collections', function () {
    assert.ok(records.hasCanonicalPage('federation'));
    assert.ok(!records.hasCanonicalPage('group'));
    assert.strictEqual(records.hrefFor('federation', 'abc'), '/federations/abc');
    assert.strictEqual(records.hrefFor('fabric-message', 'abc'), '/messages/abc');
    assert.strictEqual(records.hrefFor('group', 'g 1'), '/collections/group/g%201');
    assert.strictEqual(records.hrefFor('', 'x'), null);
    assert.strictEqual(records.fabricMessageHref('h'), '/messages/h');
    assert.strictEqual(records.kindLabel('fabric-message'), 'Fabric message');
  });

  it('finds the records a payload names', function () {
    const links = records.recordLinks({ contractId: ID, nested: { federationId: 'fed0'.repeat(16) }, document: { id: 'doc123' } });
    assert.deepStrictEqual(links.map((l) => [l.kind, l.href]), [
      ['contract', `/contracts/${ID}`],
      ['document', '/documents/doc123'],
      ['federation', `/federations/${'fed0'.repeat(16)}`]
    ]);
    assert.deepStrictEqual(records.recordLinks(null), []);
  });

  it('loads through a client and marks what it cannot see as missing', async function () {
    const client = {
      getFederation: async (id) => ({ id, name: 'Ops', network: 'regtest' }),
      getContract: async () => ({ contract: null, application: application() }),
      getMessage: async () => { const e = new Error('message not found'); e.status = 404; throw e; }
    };
    const f = await records.load('federation', 'ff', client);
    assert.deepStrictEqual([f.title, f.subtitle, f.links[0].href], ['Ops', 'Federation · regtest', '/federations/ff#messages']);
    const c = await records.load('contract', ID, client);
    assert.deepStrictEqual([c.title, c.subtitle], ['Goon', 'Application contract']);
    const m = await records.load('fabric-message', 'nope', client);
    assert.strictEqual(m.missing, true);
    const shell = await records.load('group', 'g1', client);
    assert.deepStrictEqual([shell.record, shell.missing, shell.href], [null, false, '/collections/group/g1']);
    assert.strictEqual(await records.load('', 'x', client), null);
  });
});
