'use strict';

const merge = require('lodash.merge');

/**
 * Deep-merge Hub settings like lodash.merge, but **`peers` is always replaced** by the
 * rightmost layer that defines it. Plain lodash.merge merges arrays by index, so
 * `{ peers: [] }` failed to clear seeds from `settings/local.js` (`merge →` kept WAN hosts).
 *
 * @param {...Object} layers Non-null objects merged left → right; later keys win for scalars/objects.
 * @returns {Object}
 */
function hubSettingsMerge (...layers) {
  const valid = layers.filter((x) => x && typeof x === 'object');
  if (!valid.length) return {};
  const out = merge({}, ...valid);
  for (let i = valid.length - 1; i >= 0; i--) {
    const L = valid[i];
    if (Object.prototype.hasOwnProperty.call(L, 'peers')) {
      out.peers = Array.isArray(L.peers) ? L.peers.slice() : [];
      break;
    }
  }
  return out;
}

module.exports = { hubSettingsMerge };
