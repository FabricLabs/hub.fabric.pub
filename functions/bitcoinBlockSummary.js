'use strict';

/**
 * Compact block row for explorer lists / horizontal chain scroller (not full getblock).
 * @param {object} block — bitcoind getblock verbosity ≥1
 * @param {object} [stats] — optional getblockstats
 * @returns {object|null}
 */
function summarizeBitcoinBlock (block, stats) {
  if (!block || typeof block !== 'object') return null;
  const hash = block.hash != null ? String(block.hash).trim() : '';
  if (!hash) return null;
  const height = block.height != null && Number.isFinite(Number(block.height))
    ? Number(block.height)
    : null;
  const time = block.time != null && Number.isFinite(Number(block.time))
    ? Number(block.time)
    : null;
  const txCount = Array.isArray(block.tx)
    ? block.tx.length
    : (block.nTx != null && Number.isFinite(Number(block.nTx)) ? Number(block.nTx) : null);
  const size = block.size != null && Number.isFinite(Number(block.size))
    ? Number(block.size)
    : null;
  const weight = block.weight != null && Number.isFinite(Number(block.weight))
    ? Number(block.weight)
    : null;

  const out = {
    hash,
    ...(height != null ? { height } : {}),
    ...(time != null ? { time } : {}),
    ...(txCount != null ? { txCount } : {}),
    ...(size != null ? { size } : {}),
    ...(weight != null ? { weight } : {})
  };

  if (stats && typeof stats === 'object') {
    const subsidy = Number(stats.subsidy || 0);
    const totalfee = Number(stats.totalfee || 0);
    if (Number.isFinite(subsidy) && Number.isFinite(totalfee)) {
      out.rewardSats = Math.round(subsidy + totalfee);
      out.totalFeeSats = Math.round(totalfee);
    }
    if (stats.total_out != null) {
      const totalOut = Number(stats.total_out);
      if (Number.isFinite(totalOut)) out.totalOutSats = Math.round(totalOut);
    }
    if (stats.avgfeerate != null && Number.isFinite(Number(stats.avgfeerate))) {
      // Core reports avgfeerate in sat/vB (integer) on recent versions.
      out.avgFeeRateSatVb = Number(stats.avgfeerate);
    }
  }

  return out;
}

/**
 * Height window for a chain scroller centered on `around`.
 * @param {object} opts
 * @param {number} opts.around
 * @param {number} [opts.before=10] — how many older blocks (lower height)
 * @param {number} [opts.after=2] — how many newer blocks (higher height)
 * @param {number} [opts.tipHeight] — clamp after to tip when known
 * @returns {{ fromHeight: number, toHeight: number }|null}
 */
function bitcoinBlockWindowRange (opts = {}) {
  const around = Math.floor(Number(opts.around));
  if (!Number.isFinite(around) || around < 0) return null;
  const before = Math.max(0, Math.min(50, Math.floor(Number(opts.before != null ? opts.before : 10))));
  const after = Math.max(0, Math.min(50, Math.floor(Number(opts.after != null ? opts.after : 2))));
  let fromHeight = Math.max(0, around - before);
  let toHeight = around + after;
  if (opts.tipHeight != null && Number.isFinite(Number(opts.tipHeight))) {
    toHeight = Math.min(toHeight, Math.max(0, Math.floor(Number(opts.tipHeight))));
  }
  if (toHeight < fromHeight) toHeight = fromHeight;
  return { fromHeight, toHeight };
}

module.exports = {
  summarizeBitcoinBlock,
  bitcoinBlockWindowRange
};
