'use strict';

/**
 * @fileoverview Pure helpers for the Electron desktop shell: tray status lines, sign-in prompt
 * notifications, and restoring window bounds onto a display that still exists.
 */

const HUB_STATUS_LABELS = Object.freeze({
  starting: 'Starting…',
  running: 'Running',
  restarting: 'Restarting after a crash…',
  stopping: 'Stopping…',
  stopped: 'Stopped',
  external: 'Using the Hub already running on this computer'
});

/**
 * @param {string} status
 * @returns {string}
 */
function hubStatusLabel (status) {
  return HUB_STATUS_LABELS[status] || String(status || 'Unknown');
}

/** @private */
function finiteNumber (value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Bitcoin line for the tray: height, sync progress while catching up, or why it is unavailable.
 * @param {Object|null} bitcoin `GET /services/bitcoin` body
 * @returns {string|null}
 */
function bitcoinStatusLine (bitcoin) {
  if (!bitcoin || typeof bitcoin !== 'object') return null;
  if (!bitcoin.available) return 'Bitcoin: unavailable';
  const chain = bitcoin.blockchain && typeof bitcoin.blockchain === 'object' ? bitcoin.blockchain : {};
  const height = finiteNumber(bitcoin.height != null ? bitcoin.height : chain.blocks);
  const network = bitcoin.network ? ` (${bitcoin.network})` : '';
  const progress = finiteNumber(chain.verificationprogress);
  const syncing = chain.initialblockdownload === true || (progress != null && progress < 0.9999);
  if (syncing && progress != null) {
    return `Bitcoin${network}: syncing ${(progress * 100).toFixed(1)}%${height != null ? ` · block ${height}` : ''}`;
  }
  return `Bitcoin${network}: ${height != null ? `block ${height}` : 'online'}`;
}

/**
 * @param {Object|null} lightning `GET /services/lightning` body
 * @returns {string|null}
 */
function lightningStatusLine (lightning) {
  if (!lightning || typeof lightning !== 'object') return null;
  const status = String(lightning.status || '').toUpperCase();
  if (status === 'NOT_CONFIGURED') return null;
  if (!lightning.available) return 'Lightning: unavailable';
  return status === 'STUB' ? 'Lightning: stub' : 'Lightning: running';
}

/**
 * @param {Object} input
 * @param {string} input.hubStatus
 * @param {Object|null} [input.peering] `GET /services/peering` body
 * @param {Object|null} [input.bitcoin]
 * @param {Object|null} [input.lightning]
 * @returns {string[]}
 */
function trayStatusLines (input = {}) {
  const lines = [`Hub: ${hubStatusLabel(input.hubStatus)}`];
  if (input.hubStatus !== 'running' && input.hubStatus !== 'external') return lines;
  const p2p = input.peering && input.peering.p2p;
  if (p2p && typeof p2p === 'object') {
    const n = finiteNumber(p2p.connections) || 0;
    lines.push(`Fabric: ${n} peer${n === 1 ? '' : 's'}${p2p.listening === false ? ' (not listening)' : ''}`);
  }
  const btc = bitcoinStatusLine(input.bitcoin);
  if (btc) lines.push(btc);
  const ln = lightningStatusLine(input.lightning);
  if (ln) lines.push(ln);
  return lines;
}

/**
 * Saved window bounds if their title bar still lands on a display, otherwise `undefined` so
 * Electron centres a default-sized window.
 * @param {Object|null} saved `{ x, y, width, height }`
 * @param {Array<{ x: number, y: number, width: number, height: number }>} workAreas
 * @param {Object} [min] `{ width, height }`
 * @returns {Object|undefined}
 */
function restorableWindowBounds (saved, workAreas, min = {}) {
  if (!saved || typeof saved !== 'object') return undefined;
  const x = finiteNumber(saved.x);
  const y = finiteNumber(saved.y);
  const width = finiteNumber(saved.width);
  const height = finiteNumber(saved.height);
  if (x == null || y == null || width == null || height == null) return undefined;
  const minWidth = finiteNumber(min.width) || 0;
  const minHeight = finiteNumber(min.height) || 0;
  const bounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(width, minWidth)),
    height: Math.round(Math.max(height, minHeight))
  };
  const titleBar = { x: bounds.x, y: bounds.y, width: bounds.width, height: 40 };
  const visible = (workAreas || []).some((a) => {
    if (!a) return false;
    const overlapX = Math.min(titleBar.x + titleBar.width, a.x + a.width) - Math.max(titleBar.x, a.x);
    const overlapY = Math.min(titleBar.y + titleBar.height, a.y + a.height) - Math.max(titleBar.y, a.y);
    return overlapX >= 100 && overlapY >= 20;
  });
  return visible ? bounds : undefined;
}

module.exports = {
  HUB_STATUS_LABELS,
  bitcoinStatusLine,
  hubStatusLabel,
  lightningStatusLine,
  restorableWindowBounds,
  trayStatusLines
};
