'use strict';

const assert = require('assert');
const {
  dedupeFabricPeers,
  buildWebrtcCombinedRows,
  extractPeerXpub,
  fabricPeerPrimaryLabel,
  fabricPeerRecencyMs,
  sortFabricPeersMostRecentFirst,
  sortFabricPeersByColumn,
  fabricPeerWindowBytes,
  normalizePeerAddressInput,
  findFabricPeerRow,
  peerMeshAliasRegistryPatch,
  peerNicknameRegistryPatch
} = require('../functions/peerIdentity');

const PUB_A = `02${'aa'.repeat(32)}`;
const PUB_B = `03${'bb'.repeat(32)}`;

describe('peerIdentity', () => {
  it('dedupes same id', () => {
    const rows = dedupeFabricPeers([
      { id: 'abc', address: 'h:7777', status: 'disconnected' },
      { id: 'abc', address: 'h:7777', status: 'connected', score: 3 }
    ]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'connected');
    assert.strictEqual(rows[0].score, 3);
  });

  it('dedupes id matching peer address', () => {
    const rows = dedupeFabricPeers([
      { id: '03pub', address: 'host:7777' },
      { id: 'host:7777', address: '03pub' }
    ]);
    assert.strictEqual(rows.length, 1);
  });

  it('dedupes same normalized TCP address', () => {
    const rows = dedupeFabricPeers([
      { id: 'a', address: 'x:7777' },
      { id: 'b', address: 'x' }
    ]);
    assert.strictEqual(rows.length, 1);
  });

  it('merges WebRTC signaling and mesh by id', () => {
    const rows = buildWebrtcCombinedRows(
      [{ id: 'p1', status: 'registered', metadata: { xpub: 'xpub6CUiHzmhGvC7YdAa1FRtWamDJhoP7YJ1dgp6bYxgpUM5tTUg9s1Jt' } }],
      [{ id: 'p1', status: 'connected', direction: 'outbound' }],
      'self'
    );
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0].signaling);
    assert.ok(rows[0].local);
  });

  it('extractPeerXpub reads metadata', () => {
    const x = extractPeerXpub({ metadata: { xpub: 'xpub6CUiHzmhGvC7YdAa1FRtWamDJhoP7YJ1dgp6bYxgpUM5tTUg9s1Jt' } });
    assert.ok(x.startsWith('xpub'));
  });

  it('fabricPeerPrimaryLabel prefers nickname when no mesh alias', () => {
    const l = fabricPeerPrimaryLabel({
      nickname: 'alice',
      id: '03ab',
      metadata: { xpub: 'xpub6CUiHzmhGvC7YdAa1FRtWamDJhoP7YJ1dgp6bYxgpUM5tTUg9s1Jt' }
    });
    assert.strictEqual(l, 'alice');
  });

  it('fabricPeerPrimaryLabel prefers mesh alias over local nickname', () => {
    const l = fabricPeerPrimaryLabel({
      nickname: 'operator-note',
      alias: 'Alice',
      id: PUB_A
    });
    assert.strictEqual(l, 'Alice');
  });

  it('does not collapse distinct identity ids that share a TCP address', () => {
    const rows = dedupeFabricPeers([
      {
        id: 'id14vsxaujx9qwnpyjd0',
        address: 'relay.goon.vc:7777',
        alias: 'Fadingdoughnut0',
        nickname: 'localhost',
        status: 'connected'
      },
      {
        id: 'dc6142cd08a6a3853500',
        address: 'relay.goon.vc:7777',
        alias: 'Fadingdoughnut0',
        nickname: 'Fadingdoughnut0',
        status: 'disconnected'
      }
    ]);
    assert.strictEqual(rows.length, 2);
    const live = rows.find((p) => p.status === 'connected');
    const stale = rows.find((p) => p.status === 'disconnected');
    assert.strictEqual(live.alias, 'Fadingdoughnut0');
    assert.strictEqual(live.nickname, 'localhost');
    assert.strictEqual(stale.alias, null);
    assert.strictEqual(stale.nickname, null);
  });

  it('does not collapse distinct pubkeys that share a TCP address', () => {
    const rows = dedupeFabricPeers([
      { id: PUB_A, publicKey: PUB_A, address: 'hub.fabric.pub:7777', alias: 'Alice', status: 'disconnected' },
      { id: PUB_B, publicKey: PUB_B, address: 'hub.fabric.pub:7777', alias: 'Bob', status: 'connected' }
    ]);
    assert.strictEqual(rows.length, 2);
    const aliases = rows.map((p) => p.alias).sort();
    assert.deepStrictEqual(aliases, ['Alice', 'Bob']);
  });

  it('keeps mesh alias from the connected row and does not copy nickname onto alias', () => {
    const rows = dedupeFabricPeers([
      {
        id: PUB_A,
        publicKey: PUB_A,
        address: 'h:7777',
        alias: 'StaleName',
        nickname: 'local-note',
        status: 'disconnected',
        lastSeen: '2020-01-01T00:00:00.000Z'
      },
      {
        id: PUB_A,
        publicKey: PUB_A,
        address: 'h:7777',
        alias: 'Alice',
        nickname: 'local-note',
        status: 'connected',
        lastSeen: '2026-09-04T00:00:00.000Z'
      }
    ]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].alias, 'Alice');
    assert.strictEqual(rows[0].nickname, 'local-note');
  });

  it('findFabricPeerRow matches cryptographic id before a shared TCP address', () => {
    const peers = [
      { id: PUB_A, publicKey: PUB_A, address: 'hub.fabric.pub:7777', alias: 'Alice', status: 'disconnected' },
      { id: PUB_B, publicKey: PUB_B, address: 'hub.fabric.pub:7777', alias: 'Bob', status: 'connected' }
    ];
    assert.strictEqual(findFabricPeerRow(peers, PUB_A).alias, 'Alice');
    assert.strictEqual(findFabricPeerRow(peers, PUB_B).alias, 'Bob');
    assert.strictEqual(findFabricPeerRow(peers, 'hub.fabric.pub:7777').alias, 'Bob');
  });

  it('peerMeshAliasRegistryPatch never writes nickname', () => {
    const patch = peerMeshAliasRegistryPatch(PUB_A, 'Alice');
    assert.deepStrictEqual(patch, { id: PUB_A, alias: 'Alice' });
    assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'nickname'));
  });

  it('peerNicknameRegistryPatch leaves remote mesh alias untouched', () => {
    const remote = peerNicknameRegistryPatch(PUB_A, 'operator-note', false);
    assert.deepStrictEqual(remote, { id: PUB_A, nickname: 'operator-note' });
    assert.ok(!Object.prototype.hasOwnProperty.call(remote, 'alias'));
    const self = peerNicknameRegistryPatch(PUB_A, 'Hub', true);
    assert.deepStrictEqual(self, { id: PUB_A, nickname: 'Hub', alias: 'Hub' });
  });

  it('normalizePeerAddressInput strips URL prefix and path', function () {
    assert.strictEqual(
      normalizePeerAddressInput('https://hub.fabric.pub:7777/path'),
      'hub.fabric.pub:7777'
    );
    assert.strictEqual(normalizePeerAddressInput('  hub.example.com  '), 'hub.example.com:7777');
  });

  it('fabricPeerRecencyMs prefers the latest lastSeen or lastMessage', function () {
    assert.strictEqual(fabricPeerRecencyMs({
      lastSeen: '2020-01-01T00:00:00.000Z',
      lastMessage: Date.parse('2024-06-01T00:00:00.000Z')
    }), Date.parse('2024-06-01T00:00:00.000Z'));
    assert.ok(fabricPeerRecencyMs({ lastSeen: '2026-08-21T12:00:00.000Z' }) >
      fabricPeerRecencyMs({ lastSeen: 1000 }));
  });

  it('sortFabricPeersMostRecentFirst orders by recency then connected status', function () {
    const sorted = sortFabricPeersMostRecentFirst([
      { id: 'old', address: 'a:7777', lastSeen: '2020-01-01T00:00:00.000Z' },
      { id: 'new', address: 'b:7777', lastSeen: '2026-08-21T00:00:00.000Z' },
      { id: 'mid', address: 'c:7777', lastMessage: Date.parse('2024-06-01T00:00:00.000Z') }
    ]);
    assert.deepStrictEqual(sorted.map((p) => p.id), ['new', 'mid', 'old']);
  });

  it('sortFabricPeersByColumn orders by 10m window then session bytes', function () {
    const rows = [
      { id: 'quiet', address: 'a:7777', bytesIn: 10, bytesOut: 10, windowBytes: 5, budgetBytes: 32768 },
      { id: 'hot', address: 'b:7777', bytesIn: 100, bytesOut: 50, windowBytes: 9000, budgetBytes: 32768 },
      { id: 'mid', address: 'c:7777', bytesIn: 80, bytesOut: 20, windowBytes: 400, budgetBytes: 32768 }
    ];
    const byWindow = sortFabricPeersByColumn(rows, 'window', 'descending');
    assert.deepStrictEqual(byWindow.map((p) => p.id), ['hot', 'mid', 'quiet']);
    const byBytes = sortFabricPeersByColumn(rows, 'bytes', 'descending');
    assert.deepStrictEqual(byBytes.map((p) => p.id), ['hot', 'mid', 'quiet']);
    assert.strictEqual(fabricPeerWindowBytes(rows[1]), 9000);
  });

  it('dedupe keeps the higher bandwidth counters', function () {
    const rows = dedupeFabricPeers([
      { id: 'abc', address: 'h:7777', bytesIn: 10, bytesOut: 1, windowBytes: 4, budgetBytes: 32768 },
      { id: 'abc', address: 'h:7777', bytesIn: 40, bytesOut: 8, windowBytes: 20, budgetBytes: 32768, overBudget: false }
    ]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].bytesIn, 40);
    assert.strictEqual(rows[0].windowBytes, 20);
  });
});
