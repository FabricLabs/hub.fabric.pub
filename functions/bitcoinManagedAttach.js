'use strict';

/**
 * Helpers for Hub managed-regtest Bitcoin: attach to an orphan Core instead of
 * spawn-or-die when the datadir lock is held (PM2 crash loop after Hub OOM).
 */

/**
 * @param {*} err
 * @returns {boolean}
 */
function isBitcoinDatadirLockError (err) {
  const msg = err && err.message != null ? String(err.message) : String(err || '');
  return /cannot obtain a lock on directory/i.test(msg) ||
    /bitcoin core is probably already running/i.test(msg);
}

/**
 * Spawn failed before RPC came up — typical when Core exits 1 on a held lock
 * (lock text is on bitcoind stderr, not always on the thrown Error).
 * @param {*} err
 * @returns {boolean}
 */
function isManagedBitcoinSpawnEarlyExit (err) {
  const msg = err && err.message != null ? String(err.message) : String(err || '');
  if (isBitcoinDatadirLockError(msg)) return true;
  return /exited early with code/i.test(msg) ||
    /failed to spawn/i.test(msg) ||
    /failed to create local bitcoin node/i.test(msg);
}

/**
 * Keep Hub's single-port probe restriction without dropping cookie-auth rows.
 * @param {Array<object>} list
 * @param {number} rpcport
 * @returns {Array<object>}
 */
function filterBitcoinRpcProbesForPort (list, rpcport) {
  const port = Number(rpcport);
  const arr = Array.isArray(list) ? list : [];
  if (!Number.isFinite(port) || port <= 0) return arr;
  const filtered = arr.filter((c) => c && Number(c.rpcport) === port);
  return filtered.length ? filtered : arr;
}

/**
 * Wrap Bitcoin#_buildRPCProbeCandidates so Hub still probes only its RPC port
 * but retains cookie credentials from the original builder.
 * @param {object} bitcoin
 * @param {number} rpcport
 * @returns {void}
 */
function wrapBitcoinRpcProbeCandidatesForPort (bitcoin, rpcport) {
  if (!bitcoin || typeof bitcoin._buildRPCProbeCandidates !== 'function') return;
  const orig = bitcoin._buildRPCProbeCandidates.bind(bitcoin);
  bitcoin._buildRPCProbeCandidates = async function () {
    const list = await orig();
    return filterBitcoinRpcProbesForPort(list, rpcport);
  };
}

/**
 * PID Hub spawned (not an attached orphan).
 * @param {object} [hub]
 * @returns {number|null}
 */
function spawnedBitcoindPid (hub) {
  if (!hub) return null;
  const child = hub.bitcoin && hub.bitcoin._nodeProcess;
  if (child && child.pid) return child.pid;
  if (hub._bitcoindPid) return hub._bitcoindPid;
  return null;
}

module.exports = {
  isBitcoinDatadirLockError,
  isManagedBitcoinSpawnEarlyExit,
  filterBitcoinRpcProbesForPort,
  wrapBitcoinRpcProbeCandidatesForPort,
  spawnedBitcoindPid
};
