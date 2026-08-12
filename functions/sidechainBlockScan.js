'use strict';

const { SATS_PER_BTC } = require('../constants');

let fabricHallmark = null;
try {
  fabricHallmark = require('@fabric/core/functions/fabricHallmark');
} catch (_) {
  fabricHallmark = null;
}

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
  const hallmarksScan = !!(c.hallmarksScan || c.scanHallmarks);
  const tipBlockHashHex = c.tipBlockHashHex != null
    ? String(c.tipBlockHashHex).replace(/\s+/g, '').toLowerCase()
    : null;
  return { magicHex, watch, recordTimelocks, hallmarksScan, tipBlockHashHex };
}

/**
 * Extract OP_RETURN push-data hex candidates from a scriptPubKey hex string.
 * @param {string} scriptHex
 * @returns {string[]}
 */
function extractOpReturnPushHexCandidates (scriptHex) {
  const hex = String(scriptHex || '').toLowerCase().replace(/\s+/g, '');
  if (!hex.startsWith('6a') || hex.length < 4) return [];
  const out = [];
  let i = 2;
  while (i < hex.length) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isFinite(op)) break;
    i += 2;
    if (op >= 1 && op <= 75) {
      const byteLen = op;
      const data = hex.slice(i, i + byteLen * 2);
      if (data.length === byteLen * 2) out.push(data);
      i += byteLen * 2;
      continue;
    }
    if (op === 0x4c && i + 2 <= hex.length) {
      const byteLen = parseInt(hex.slice(i, i + 2), 16);
      i += 2;
      const data = hex.slice(i, i + byteLen * 2);
      if (Number.isFinite(byteLen) && data.length === byteLen * 2) out.push(data);
      i += byteLen * 2;
      continue;
    }
    break;
  }
  // Fallback: magic-aligned 40-byte window (c0d3f33d…)
  if (fabricHallmark && fabricHallmark.HALLMARK_MAGIC_HEX) {
    const magic = fabricHallmark.HALLMARK_MAGIC_HEX;
    const idx = hex.indexOf(magic);
    if (idx >= 0) {
      const win = hex.slice(idx, idx + fabricHallmark.HALLMARK_PAYLOAD_LENGTH * 2);
      if (win.length === fabricHallmark.HALLMARK_PAYLOAD_LENGTH * 2) out.push(win);
    }
  }
  return out;
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
  const { magicHex, watch, recordTimelocks, hallmarksScan, tipBlockHashHex } = normalizeSidechainScanCfg(cfg);
  const txs = Array.isArray(block && block.tx) ? block.tx : [];
  const signals = [];
  const tipHash = tipBlockHashHex || (block && block.hash ? String(block.hash).toLowerCase() : null);

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
        const valueSats = Number.isFinite(valueBtc) ? Math.round(valueBtc * SATS_PER_BTC) : null;
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

      if (hallmarksScan && fabricHallmark && typ === 'nulldata' && hex) {
        const candidates = extractOpReturnPushHexCandidates(hex);
        for (const pushHex of candidates) {
          const decoded = fabricHallmark.decodeFabricHallmark(pushHex);
          if (!decoded) continue;
          let tipMatch;
          if (tipHash && /^[0-9a-f]{64}$/.test(tipHash)) {
            tipMatch = fabricHallmark.verifyFabricHallmark(pushHex, { tipBlockHashHex: tipHash });
          }
          signals.push({
            kind: 'fabric_hallmark',
            txid,
            vout: vout.n,
            tipHashSuffixHex: decoded.tipHashSuffixHex,
            commitmentHex: decoded.commitmentHex,
            payloadHex: pushHex,
            tipMatch: tipMatch === undefined ? undefined : !!tipMatch
          });
          matchedThisTx = true;
          break;
        }
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
  parseVerboseBlockForSidechainSignals,
  extractOpReturnPushHexCandidates
};
