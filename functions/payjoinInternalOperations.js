'use strict';

/**
 * @fileoverview Hub operations that can settle through Payjoin, and whether
 * each one does on this Hub.
 *
 * `payjoin.internal.enable` (env `FABRIC_PAYJOIN_INTERNAL=1`, off by default)
 * turns internal Payjoin on; `payjoin.internal.operations.<id> = false` turns
 * one operation back off. Only `implemented` operations can be enabled;
 * `stub` operations have a hook in place and always answer
 * `{ payjoin: false, reason: 'stub' }`; `not-applicable` ones say why Payjoin
 * does not fit.
 */

const STATUS = Object.freeze({
  IMPLEMENTED: 'implemented',
  STUB: 'stub',
  NOT_APPLICABLE: 'not-applicable'
});

const OPERATIONS = Object.freeze([
  {
    id: 'walletSend',
    role: 'sender',
    status: STATUS.IMPLEMENTED,
    description: 'Hub wallet payments (sendpayment, POST /services/bitcoin/payments, bridge payments) to a BIP21 URI with pj=.'
  },
  {
    id: 'distributeInvoice',
    role: 'receiver',
    status: STATUS.IMPLEMENTED,
    description: 'CreateDistributeInvoice returns a BIP21 URI with pj= for the invoice address.'
  },
  {
    id: 'crowdfundingDonation',
    role: 'receiver',
    status: STATUS.STUB,
    description: 'Crowdfunding donations to a campaign address.',
    reason: 'Campaign addresses are 2-of-2 Taproot; the Hub alone cannot contribute to them yet.'
  },
  {
    id: 'identityPayment',
    role: 'receiver',
    status: STATUS.STUB,
    description: 'Per-identity payment requests (/services/bitcoin/payments).',
    reason: 'The browser wallet already pays pj= URIs; a Hub-held receive session per identity is not built yet.'
  },
  {
    id: 'faucet',
    role: 'receiver',
    status: STATUS.STUB,
    description: 'Regtest faucet top-ups of a browser key.',
    reason: 'Regtest only; nothing to gain until a browser receiver exists.'
  },
  {
    id: 'bip77Directory',
    role: 'transport',
    status: STATUS.STUB,
    description: 'BIP77 async Payjoin through an OHTTP relay and Payjoin directory (/services/payjoin/v2/*).',
    reason: 'No HPKE / OHTTP implementation; the Hub-local mailbox is experimental and unauthenticated by design.'
  },
  {
    id: 'batching',
    role: 'receiver',
    status: STATUS.STUB,
    description: 'Receiver output substitution to batch Hub payouts into a proposal.',
    reason: 'Output substitution is not implemented; senders may also forbid it.'
  },
  {
    id: 'consolidation',
    role: 'receiver',
    status: STATUS.STUB,
    description: 'Contribute several small Hub coins to consolidate the wallet.',
    reason: 'The Hub contributes one coin per proposal.'
  },
  {
    id: 'inventoryHtlc',
    role: 'sender',
    status: STATUS.NOT_APPLICABLE,
    description: 'Funding a document inventory HTLC.',
    reason: 'The payee is a script, not a receiver wallet that could contribute.'
  },
  {
    id: 'federationWithdrawal',
    role: 'sender',
    status: STATUS.NOT_APPLICABLE,
    description: 'Federation vault withdrawals.',
    reason: 'Threshold PSBTs are built and signed by every member; a receiver input would need another signing round.'
  },
  {
    id: 'coinjoin',
    role: 'sender',
    status: STATUS.NOT_APPLICABLE,
    description: 'Coinjoin market rounds.',
    reason: 'Coinjoin is its own multi-party protocol.'
  },
  {
    id: 'fidelityBond',
    role: 'sender',
    status: STATUS.NOT_APPLICABLE,
    description: 'Funding and redeeming fidelity bonds.',
    reason: 'The Hub pays itself.'
  }
]);

/** @private */
function internalSettings (payjoinSettings = {}) {
  const s = payjoinSettings && typeof payjoinSettings === 'object' ? payjoinSettings : {};
  return s.internal && typeof s.internal === 'object' ? s.internal : {};
}

/**
 * @param {string} id
 * @returns {(Object|null)}
 */
function getOperation (id) {
  return OPERATIONS.find((op) => op.id === id) || null;
}

/**
 * True when operation `id` should settle through Payjoin on this Hub.
 * @param {Object} payjoinSettings Hub `settings.payjoin`
 * @param {string} id
 * @returns {boolean}
 */
function operationEnabled (payjoinSettings, id) {
  const op = getOperation(id);
  if (!op || op.status !== STATUS.IMPLEMENTED) return false;
  if (!payjoinSettings || payjoinSettings.enable === false) return false;
  const internal = internalSettings(payjoinSettings);
  if (internal.enable !== true) return false;
  const overrides = internal.operations && typeof internal.operations === 'object' ? internal.operations : {};
  return overrides[id] !== false;
}

/**
 * Every operation with `enabled` for this Hub.
 * @param {Object} payjoinSettings Hub `settings.payjoin`
 * @returns {Object[]}
 */
function listOperations (payjoinSettings) {
  return OPERATIONS.map((op) => Object.assign({}, op, { enabled: operationEnabled(payjoinSettings, op.id) }));
}

module.exports = {
  STATUS,
  OPERATIONS,
  getOperation,
  operationEnabled,
  listOperations
};
