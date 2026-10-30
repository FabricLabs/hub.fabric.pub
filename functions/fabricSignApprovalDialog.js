'use strict';

/**
 * Native approval dialog for delegation on the desktop Hub
 * (`functions/fabricDelegateHub.js` → parentPort → `scripts/desktop.js`):
 * pairing with a linked signer, and requests from linked signers that no
 * signer rule answered. Pure: builds `dialog.showMessageBox` options; button
 * 0 approves.
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

const SHARE_TEXT = {
  identity: 'this Hub’s Fabric identity (its public key)',
  wallet: 'the account’s wallet public keys, which reveal its balance and history',
  cosigner: 'the account’s cosigner public key'
};

/**
 * @param {object} msg `{ kind, origin, purpose, title, summary, label, from, network, account, shares, code, expiresAt }` from the Hub process
 * @returns {object} options for `dialog.showMessageBox`
 */
function fabricSignApprovalDialog (msg = {}) {
  const from = shortKey(msg.from);
  const label = plainText(msg.label, 64);
  const who = label ? `“${label}” (${from})` : from;
  if (msg.kind === 'link') {
    const code = /^[0-9]{6}$/.test(String(msg.code || '')) ? String(msg.code) : null;
    return {
      type: 'question',
      title: 'Pair with a signer',
      message: `Pair ${label ? `“${label}”` : 'a signer'} with this Hub?`,
      detail: [
        code ? `Pairing code: ${code}\n\nCheck that the other screen shows the same code. If it doesn’t, cancel.` : null,
        `Signer key ${from}.`,
        'Once paired, it can ask this Hub to sign for it: sign-ins, shared-wallet signatures, messages. ' +
          'Each request waits for you here unless one of your signer rules answers it. Only pair with a signer you control.'
      ].filter(Boolean).join('\n\n'),
      buttons: ['Pair', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
  }
  if (msg.kind === 'request') {
    const title = plainText(msg.title, 120) || 'Sign a message';
    const summary = plainText(msg.summary, 300);
    return {
      type: 'question',
      title: 'Signature request',
      message: `${title}?`,
      detail: [
        `Requested by your linked signer ${who}.`,
        summary || null,
        'Only approve if you started this.'
      ].filter(Boolean).join('\n\n'),
      buttons: ['Sign', 'Decline'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
  }
  const origin = plainText(msg.origin, 200) || 'an unknown site';
  const purpose = plainText(msg.purpose, 200);
  const shares = (Array.isArray(msg.shares) && msg.shares.length ? msg.shares : ['identity'])
    .filter((s) => SHARE_TEXT[s]);
  const network = plainText(msg.network, 16);
  const account = Number.isInteger(msg.account) ? msg.account : null;
  const lines = [
    `Requested by your linked signer ${who}.`,
    purpose ? `The site says: “${purpose}”` : null,
    (network || account != null)
      ? `Account ${account != null ? account : 0}${network ? ` on ${network}` : ''}.`
      : null,
    `The site receives ${shares.map((s) => SHARE_TEXT[s]).join('; ')}. Nothing else is shared.`
  ].filter(Boolean);
  return {
    type: 'question',
    title: 'Sign in',
    message: `Sign in to ${origin} as this Hub?`,
    detail: lines.join('\n\n'),
    buttons: ['Sign in', 'Decline'],
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
