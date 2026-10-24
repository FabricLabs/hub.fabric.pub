'use strict';

/**
 * Native approval dialog for Passport requests to the Hub local signer
 * (`functions/fabricLocalSignerHub.js` → parentPort → `scripts/desktop.js`).
 * Pure: builds `dialog.showMessageBox` options; button 0 approves.
 */

const APPROVAL_REQUEST = 'fabric-sign-request';
const APPROVAL_RESULT = 'fabric-sign-result';

function shortKey (hex) {
  const h = String(hex || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-8)}` : (h || 'unknown');
}

function plainText (value, max = 200) {
  return String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').trim().slice(0, max);
}

/**
 * @param {object} msg `{ kind, origin, purpose, device, expiresAt }` from the Hub process
 * @returns {object} options for `dialog.showMessageBox`
 */
function fabricSignApprovalDialog (msg = {}) {
  const device = shortKey(msg.device);
  if (msg.kind === 'link') {
    const label = plainText(msg.purpose, 64) || 'a device';
    return {
      type: 'question',
      title: 'Link a device',
      message: `Link “${label}” to this Hub?`,
      detail: `Device key ${device}.\n\nOnce linked, this device can ask the Hub to sign you in to websites. ` +
        'You approve each sign-in here. Only link a device you control.',
      buttons: ['Link device', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
  }
  const origin = plainText(msg.origin, 200) || 'an unknown site';
  const purpose = plainText(msg.purpose, 200);
  const lines = [
    `Requested by your linked device ${device}.`,
    purpose ? `The site says: “${purpose}”` : null,
    'The site receives this Hub’s public key. Nothing else is shared.'
  ].filter(Boolean);
  return {
    type: 'question',
    title: 'Sign in',
    message: `Sign in to ${origin} as this Hub?`,
    detail: lines.join('\n\n'),
    buttons: ['Sign in', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
}

module.exports = {
  APPROVAL_REQUEST,
  APPROVAL_RESULT,
  fabricSignApprovalDialog
};
