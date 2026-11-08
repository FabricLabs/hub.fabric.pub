'use strict';

const assert = require('assert');
const mv = require('../functions/fabricMessageView');

const CONTRACT = 'c0ffee'.repeat(10) + 'abcd';
const FED = 'fed0'.repeat(16);

function log () {
  const frame = (n) => String(n).repeat(64).slice(0, 64);
  return [
    { id: 'm1', seq: 1, type: 'CONTRACT_PUBLISH', created: '2026-01-01T00:00:00.000Z', parent: mv.ZERO_PARENT, frameId: frame(1), payload: { contractId: CONTRACT, author: '02' + 'a'.repeat(64) } },
    { id: 'm2', seq: 2, type: 'FederationContractInvite', created: '2026-01-02T00:00:00.000Z', parent: frame(1), frameId: frame(2), payload: { invite: { federationId: FED } } },
    { id: 'm3', seq: 3, type: 'ChatMessage', created: '2026-01-03T00:00:00.000Z', parent: frame(2), frameId: frame(3), payload: { content: 'hello world' } },
    { id: 'm4', seq: 4, type: 'CONTRACT_MESSAGE', created: '2026-01-04T00:00:00.000Z', parent: frame(3), frameId: frame(4), payload: { contract: CONTRACT } }
  ];
}

describe('fabricMessageView', function () {
  it('labels types and links entries', function () {
    assert.strictEqual(mv.messageLabel('FederationContractInvite'), 'Federation contract invite');
    assert.strictEqual(mv.messageLabel('CONTRACT_PUBLISH'), 'Contract publish');
    assert.strictEqual(mv.messageLabel(''), 'Message');
    assert.strictEqual(mv.messageHref({ id: 'm1', frameId: 'abc' }), '/messages/abc');
    assert.strictEqual(mv.messageHref({ id: 'm1' }), '/messages/m1');
    assert.strictEqual(mv.parentOf({ parent: mv.ZERO_PARENT }), null);
  });

  it('reads refs and authors from payloads, one level down', function () {
    const [publish, invite] = log();
    assert.deepStrictEqual(mv.entryRefs(publish), [CONTRACT]);
    assert.deepStrictEqual(mv.entryRefs(invite), [FED]);
    assert.strictEqual(mv.entryAuthor(publish), '02' + 'a'.repeat(64));
    assert.strictEqual(mv.entryAuthor(invite), null);
  });

  it('pages newest first with type, contract, author, and text filters', function () {
    const all = mv.filterMessages(log());
    assert.deepStrictEqual(all.messages.map((m) => m.seq), [4, 3, 2, 1]);
    assert.strictEqual(all.total, 4);
    assert.deepStrictEqual(all.types, { CONTRACT_PUBLISH: 1, FederationContractInvite: 1, ChatMessage: 1, CONTRACT_MESSAGE: 1 });

    const page = mv.filterMessages(log(), { limit: 2 });
    assert.deepStrictEqual([page.messages.map((m) => m.seq), page.more, page.next], [[4, 3], true, 3]);
    const older = mv.filterMessages(log(), { limit: 2, before: page.next });
    assert.deepStrictEqual([older.messages.map((m) => m.seq), older.more], [[2, 1], false]);

    assert.deepStrictEqual(mv.filterMessages(log(), { type: 'ChatMessage,CONTRACT_PUBLISH' }).messages.map((m) => m.seq), [3, 1]);
    assert.deepStrictEqual(mv.filterMessages(log(), { contract: CONTRACT.slice(0, 12) }).messages.map((m) => m.seq), [4, 1]);
    assert.deepStrictEqual(mv.filterMessages(log(), { contract: FED }).messages.map((m) => m.seq), [2]);
    assert.deepStrictEqual(mv.filterMessages(log(), { author: 'a'.repeat(64) }).messages.map((m) => m.seq), [1]);
    assert.deepStrictEqual(mv.filterMessages(log(), { q: 'HELLO' }).messages.map((m) => m.seq), [3]);
    assert.strictEqual(mv.filterMessages(log(), { limit: 10000 }).messages.length, 4);
  });

  it('finds an entry by frame id, log id, or unique prefix', function () {
    const entries = log();
    assert.strictEqual(mv.findMessage(entries, 'm2').seq, 2);
    assert.strictEqual(mv.findMessage(entries, '3'.repeat(64)).seq, 3);
    assert.strictEqual(mv.findMessage(entries, '4'.repeat(12)).seq, 4);
    assert.strictEqual(mv.findMessage(entries, '4'.repeat(11)), null, 'short prefixes do not match');
    assert.strictEqual(mv.findMessage(entries, 'nope'), null);
  });

  it('builds a record with parent, children, and chain', function () {
    const r = mv.messageRecord(log(), '3'.repeat(64));
    assert.strictEqual(r.label, 'Chat message');
    assert.deepStrictEqual(r.payload, { content: 'hello world' });
    assert.strictEqual(r.parentMessage.seq, 2);
    assert.strictEqual(r.parentHref, `/messages/${'2'.repeat(64)}`);
    assert.deepStrictEqual(r.children.map((c) => c.seq), [4]);
    assert.deepStrictEqual(r.chain.map((c) => c.seq), [2, 1]);
    assert.deepStrictEqual(mv.parentChain(log(), 'm4', 1).map((c) => c.seq), [3]);
    const genesis = mv.messageRecord(log(), 'm1');
    assert.strictEqual(genesis.parentMessage, null);
    assert.deepStrictEqual(genesis.chain, []);
    assert.strictEqual(mv.messageRecord(log(), 'missing'), null);
  });
});
