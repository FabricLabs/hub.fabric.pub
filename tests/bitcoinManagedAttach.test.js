'use strict';

const assert = require('assert');
const {
  isBitcoinDatadirLockError,
  isManagedBitcoinSpawnEarlyExit,
  filterBitcoinRpcProbesForPort,
  wrapBitcoinRpcProbeCandidatesForPort,
  spawnedBitcoindPid
} = require('../functions/bitcoinManagedAttach');

describe('bitcoinManagedAttach', function () {
  it('detects Core datadir lock stderr', function () {
    assert.strictEqual(
      isBitcoinDatadirLockError('Cannot obtain a lock on directory .../stores/bitcoin-regtest/regtest. Bitcoin Core is probably already running.'),
      true
    );
    assert.strictEqual(isBitcoinDatadirLockError('ECONNREFUSED'), false);
  });

  it('treats spawn early-exit as attach-eligible', function () {
    assert.strictEqual(
      isManagedBitcoinSpawnEarlyExit(new Error('Bitcoin Core exited early with code 1')),
      true
    );
    assert.strictEqual(
      isManagedBitcoinSpawnEarlyExit(new Error('Failed to create local Bitcoin node')),
      true
    );
    assert.strictEqual(isManagedBitcoinSpawnEarlyExit(new Error('wallet locked')), false);
  });

  it('keeps cookie-auth rows when filtering to the Hub RPC port', function () {
    const list = [
      { host: '127.0.0.1', rpcport: 18443, username: '__cookie__', password: 'secret', source: 'cookie' },
      { host: '127.0.0.1', rpcport: 8332, source: 'mainnet' }
    ];
    const filtered = filterBitcoinRpcProbesForPort(list, 18443);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].username, '__cookie__');
    assert.strictEqual(filterBitcoinRpcProbesForPort([], 18443).length, 0);
    assert.deepStrictEqual(filterBitcoinRpcProbesForPort(list, 99999), list);
  });

  it('wraps _buildRPCProbeCandidates without dropping credentials', async function () {
    const bitcoin = {
      async _buildRPCProbeCandidates () {
        return [
          { host: '127.0.0.1', rpcport: 18443, username: '__cookie__', password: 'x' },
          { host: '127.0.0.1', rpcport: 18332 }
        ];
      }
    };
    wrapBitcoinRpcProbeCandidatesForPort(bitcoin, 18443);
    const list = await bitcoin._buildRPCProbeCandidates();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].username, '__cookie__');
  });

  it('reports only spawned bitcoind PIDs', function () {
    assert.strictEqual(spawnedBitcoindPid(null), null);
    assert.strictEqual(spawnedBitcoindPid({ bitcoin: { _usingExternalNode: true } }), null);
    assert.strictEqual(spawnedBitcoindPid({ bitcoin: { _nodeProcess: { pid: 42 } } }), 42);
    assert.strictEqual(spawnedBitcoindPid({ _bitcoindPid: 9 }), 9);
  });
});
