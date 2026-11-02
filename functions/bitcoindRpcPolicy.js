'use strict';

/**
 * Access policy for the bitcoind JSON-RPC passthrough on `POST /services/bitcoin`.
 *
 * - Public callers get read-only chain and mempool methods only.
 * - The admin token unlocks every other method (wallet, network, mining).
 * - Methods that read or write files on the Hub host, or stop the node, are never forwarded.
 */

/** Read-only methods anyone may call (no wallet, no host paths, no peer addresses). */
const PUBLIC_BITCOIND_RPC_METHODS = Object.freeze(new Set([
  'decodepsbt',
  'decoderawtransaction',
  'decodescript',
  'estimatesmartfee',
  'getbestblockhash',
  'getblock',
  'getblockchaininfo',
  'getblockcount',
  'getblockfilter',
  'getblockhash',
  'getblockheader',
  'getblockstats',
  'getchaintips',
  'getchaintxstats',
  'getdescriptorinfo',
  'getdifficulty',
  'getmempoolentry',
  'getmempoolinfo',
  'getrawmempool',
  'getrawtransaction',
  'gettxout',
  'gettxoutproof',
  'testmempoolaccept',
  'uptime',
  'validateaddress',
  'verifytxoutproof'
]));

/** Methods refused even with the admin token: host file access or node shutdown. */
const FORBIDDEN_BITCOIND_RPC_METHODS = Object.freeze(new Set([
  'backupwallet',
  'createwallet',
  'dumpprivkey',
  'dumptxoutset',
  'dumpwallet',
  'importwallet',
  'loadtxoutset',
  'loadwallet',
  'restorewallet',
  'savemempool',
  'stop',
  'unloadwallet'
]));

/**
 * @param {string} method bitcoind RPC method name
 * @param {Object} [opts]
 * @param {boolean} [opts.isAdmin] caller presented a valid admin token
 * @returns {{ allowed: boolean, status: number, message: string }}
 */
function bitcoindRpcAccess (method, opts = {}) {
  const name = String(method || '').trim().toLowerCase();
  if (!name) return { allowed: false, status: 400, message: 'method required' };
  if (FORBIDDEN_BITCOIND_RPC_METHODS.has(name)) {
    return { allowed: false, status: 403, message: `bitcoind method "${name}" is not available over the Hub` };
  }
  if (PUBLIC_BITCOIND_RPC_METHODS.has(name)) return { allowed: true, status: 200, message: '' };
  if (opts.isAdmin === true) return { allowed: true, status: 200, message: '' };
  return { allowed: false, status: 403, message: `bitcoind method "${name}" requires the admin token (Authorization: Bearer)` };
}

module.exports = {
  PUBLIC_BITCOIND_RPC_METHODS,
  FORBIDDEN_BITCOIND_RPC_METHODS,
  bitcoindRpcAccess
};
