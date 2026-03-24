'use strict';

const assert = require('assert');
const {
  dedupeFabricPeers,
  buildWebrtcCombinedRows,
  extractPeerXpub,
  fabricPeerPrimaryLabel,
  normalizePeerAddressInput
} = require('../functions/peerIdentity');

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

  it('fabricPeerPrimaryLabel prefers nickname', () => {
    const l = fabricPeerPrimaryLabel({
      nickname: 'alice',
      id: '03ab',
      metadata: { xpub: 'xpub6CUiHzmhGvC7YdAa1FRtWamDJhoP7YJ1dgp6bYxgpUM5tTUg9s1Jt' }
    });
    assert.strictEqual(l, 'alice');
  });

  it('normalizePeerAddressInput strips URL prefix and path', () => {
    assert.strictEqual(
      normalizePeerAddressInput('https://hub.fabric.pub:7777/path'),
      'hub.fabric.pub:7777'
    );
    assert.strictEqual(normalizePeerAddressInput('  hub.example.com  '), 'hub.example.com:7777');
  });
});
