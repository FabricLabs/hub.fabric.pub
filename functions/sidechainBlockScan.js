'use strict';

function normalizeSidechainScanCfg (cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const magicHex = String(c.opReturnMagicHex != null ? c.opReturnMagicHex : 'fab100')
    .toLowerCase()
    .replace(/^0x/, '');
  const watch = new Set(
    Array.isArray(c.watchAddresses)
      ? c.watchAddresses.map((a) => String(a).trim()).filter(Boolean)
      : []
  );
  const recordTimelocks = c.recordTimelocks !== false;
  return { magicHex, watch, recordTimelocks };
}

/**
 * Parse a `getblock` verbosity-2 JSON object (same shape as Bitcoin Core RPC) without calling RPC.
 * Used by tests with fixture blocks and by {@link scanBlockForSidechainSignals}.
 *
 * @param {object} block - `getblock` result with `tx` array (decoded transactions)
 * @param {number} height - chain height of this block
 * @param {object} cfg - `{ opReturnMagicHex?, watchAddresses?, recordTimelocks? }`
 * @returns {object[]} signal objects
 */
function parseVerboseBlockForSidechainSignals (block, height, cfg) {
  const { magicHex, watch, recordTimelocks } = normalizeSidechainScanCfg(cfg);
  const txs = Array.isArray(block && block.tx) ? block.tx : [];
  const signals = [];

  for (const tx of txs) {
    const txid = tx.txid;
    if (!txid) continue;

    const vouts = Array.isArray(tx.vout) ? tx.vout : [];
    let matchedThisTx = false;

    for (const vout of vouts) {
      const spk = vout.scriptPubKey || {};
      const hex = typeof spk.hex === 'string' ? spk.hex.toLowerCase() : '';
      const typ = spk.type;

      const addr = spk.address || (Array.isArray(spk.addresses) ? spk.addresses[0] : null);
      if (addr && watch.has(addr)) {
        const valueBtc = Number(vout.value);
        const valueSats = Number.isFinite(valueBtc) ? Math.round(valueBtc * 1e8) : null;
        signals.push({
          kind: 'watch_address_out',
          txid,
          vout: vout.n,
          address: addr,
          valueSats
        });
        matchedThisTx = true;
      }

      if (magicHex && typ === 'nulldata' && hex.includes(magicHex)) {
        signals.push({
          kind: 'op_return_magic',
          txid,
          vout: vout.n,
          scriptHex: hex
        });
        matchedThisTx = true;
      }
    }

    if (recordTimelocks && matchedThisTx && tx.locktime != null && Number(tx.locktime) > 0) {
      signals.push({
        kind: 'timelock_marker',
        txid,
        locktime: Number(tx.locktime),
        seenAtHeight: height,
        note: 'Non-zero locktime; enforce maturation in federation policy (e.g. currentHeight >= fundingHeight + N).'
      });
    }
  }

  return signals;
}

/**
 * Per-block L1 scan for "sidechain" / playnet signals (deposits, commitments, timelock-bearing txs).
 * Kept in the Hub as policy glue; heavy parsing can move to @fabric/core later.
 *
 * @param {object} bitcoin - Fabric {@link Bitcoin} with `_makeRPCRequest`
 * @param {string} blockHash
 * @param {number} height
 * @param {object} cfg - `{ opReturnMagicHex?, watchAddresses?, recordTimelocks? }`
 * @returns {Promise<{ blockHash: string, height: number, signals: object[] }>}
 */
async function scanBlockForSidechainSignals (bitcoin, blockHash, height, cfg) {
  const block = await bitcoin._makeRPCRequest('getblock', [blockHash, 2]);
  const signals = parseVerboseBlockForSidechainSignals(block, height, cfg);
  return { blockHash, height, signals };
}

module.exports = {
  scanBlockForSidechainSignals,
  parseVerboseBlockForSidechainSignals
};
