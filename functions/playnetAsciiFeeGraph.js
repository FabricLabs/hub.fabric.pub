'use strict';

const crypto = require('crypto');

/**
 * ASCII chart: two series over the same x index (e.g. wallet spend order).
 * Each series is normalized to its own max so shapes are visible on one grid.
 *
 * @param {{ satPerVbyte: number, satPerByte: number }[]} points
 * @param {{ width?: number, height?: number, labelVb?: string, labelB?: string }} [opts]
 */
function formatTransactionFeeAsciiGraph (points, opts = {}) {
  const width = Math.max(24, Math.min(100, opts.width || 76));
  const height = Math.max(4, Math.min(18, opts.height || 9));
  const labelVb = opts.labelVb || 'sat/vB';
  const labelB = opts.labelB || 'sat/B';
  if (!Array.isArray(points) || !points.length) {
    return '(no fee samples — graph skipped)\n';
  }

  const vb = points.map((p) => Number(p.satPerVbyte) || 0);
  const bb = points.map((p) => Number(p.satPerByte) || 0);
  const maxVb = Math.max(1e-12, ...vb);
  const maxB = Math.max(1e-12, ...bb);
  const n = points.length;
  const cols = width - 12;
  const grid = [];
  for (let r = 0; r < height; r++) grid.push(Array(cols).fill(' '));

  function plot (series, normMax, char) {
    for (let i = 0; i < n; i++) {
      const col = n <= 1 ? Math.floor(cols / 2) : Math.floor((i / (n - 1)) * (cols - 1));
      const yNorm = Math.min(1, Math.max(0, series[i] / normMax));
      const row = height - 1 - Math.min(height - 1, Math.floor(yNorm * (height - 1)));
      const prev = grid[row][col];
      if (prev === ' ') grid[row][col] = char;
      else if (prev !== char) grid[row][col] = '+';
    }
  }

  plot(vb, maxVb, '·');
  plot(bb, maxB, '█');

  const lines = [];
  lines.push('--- Fee-density vs broadcast order (each series normalized to its own max) ---');
  lines.push(`${labelVb}: · (max ${maxVb.toFixed(4)})  |  ${labelB}: █ (max ${maxB.toFixed(4)})`);
  for (let r = 0; r < height; r++) {
    lines.push(`${' '.repeat(11)}│${grid[r].join('')}`);
  }
  lines.push(`${' '.repeat(11)}└${'─'.repeat(cols)}`);
  lines.push(`${' '.repeat(11)}  sample index → (n=${n})`);
  return lines.join('\n');
}

/**
 * @param {{ offerSatPerByte: number, protocolFeeSatPerByte: number }[]} points
 */
function formatSimulationRevenueAsciiGraph (points, opts = {}) {
  const mapped = (points || []).map((p) => ({
    satPerVbyte: Number(p.offerSatPerByte) || 0,
    satPerByte: Number(p.protocolFeeSatPerByte) || 0
  }));
  return formatTransactionFeeAsciiGraph(mapped, {
    ...opts,
    labelVb: opts.labelVb || 'offer density sat/B (user→host gross)',
    labelB: opts.labelB || 'protocol fee density sat/B (federation)'
  });
}

/** Double-SHA256 little-endian txid check for raw transaction hex. */
function verifyTxidMatchesRawHex (txid, hex) {
  const id = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return false;
  const raw = String(hex || '').trim();
  if (!raw || raw.length % 2 !== 0) return false;
  let buf;
  try {
    buf = Buffer.from(raw, 'hex');
  } catch (_) {
    return false;
  }
  const h1 = crypto.createHash('sha256').update(buf).digest();
  const h2 = crypto.createHash('sha256').update(h1).digest();
  const le = Buffer.from(h2).reverse().toString('hex');
  return le === id;
}

module.exports = {
  formatTransactionFeeAsciiGraph,
  formatSimulationRevenueAsciiGraph,
  verifyTxidMatchesRawHex
};
