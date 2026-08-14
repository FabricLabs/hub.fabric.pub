'use strict';

/**
 * OracleAttestation envelope helpers shared by Hub peering and LiveRelay discovery.
 * Claim builders stay app-specific; this module only signs/verifies the envelope.
 */

const crypto = require('crypto');
const Key = require('@fabric/core/types/key');

const ATTESTATION_TYPE = 'OracleAttestation';
const KIND_PEERING = 'PeeringCapability';

let _canon;
try {
  _canon = require('@fabric/core/functions/fabricCanonicalJson');
} catch (_) {
  _canon = null;
}

/**
 * Deterministic JSON for Schnorr payloads (sorted object keys).
 * Prefer `@fabric/core/functions/fabricCanonicalJson` when available.
 * @param {*} value
 * @returns {string}
 */
function stableStringify (value) {
  if (_canon) {
    if (typeof _canon === 'function') return _canon(value);
    if (typeof _canon.stableStringify === 'function') return _canon.stableStringify(value);
    if (typeof _canon.fabricCanonicalJson === 'function') return _canon.fabricCanonicalJson(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * @param {object} opts
 * @param {object} opts.claim JSON-safe claim object
 * @param {import('@fabric/core/types/key')} opts.key Key with private material for signing
 * @param {string} [opts.kind=KIND_PEERING]
 * @param {{ publicKeyHex?: string, fabricIdentityId?: string|null }} [opts.issuer]
 * @param {string} [opts.oracleNote]
 * @returns {object} OracleAttestation
 */
function buildOracleAttestation (opts = {}) {
  const key = opts.key;
  if (!key || !key.private) {
    throw new Error('buildOracleAttestation: key with private material required');
  }
  const kind = opts.kind || KIND_PEERING;
  const claim = JSON.parse(JSON.stringify(opts.claim || {}));
  const body = { version: 1, kind, claim };
  const signingPayload = stableStringify(body);
  const signature = key.signSchnorr(
    Buffer.isBuffer(signingPayload) ? signingPayload : Buffer.from(signingPayload, 'utf8')
  );
  const issuer = opts.issuer || {
    publicKeyHex: key.pubkey,
    fabricIdentityId: null
  };
  if (!issuer.publicKeyHex) issuer.publicKeyHex = key.pubkey;

  return {
    '@type': ATTESTATION_TYPE,
    version: 1,
    kind,
    oracle: {
      name: 'Oracle',
      resource: kind,
      note: opts.oracleNote ||
        'Attestation follows the Oracle pattern: a signed claim verifiable against issuer.publicKeyHex'
    },
    issuer,
    claim,
    signature: Buffer.isBuffer(signature) ? signature.toString('hex') : String(signature),
    algorithm: 'BIP340-SCHNORR',
    signedAt: new Date().toISOString(),
    claimDigest: crypto.createHash('sha256').update(Buffer.from(signingPayload, 'utf8')).digest('hex')
  };
}

/**
 * @param {object} attestation
 * @returns {boolean}
 */
function verifyOracleAttestation (attestation) {
  try {
    if (!attestation || attestation['@type'] !== ATTESTATION_TYPE) return false;
    if (!attestation.issuer || typeof attestation.issuer.publicKeyHex !== 'string') return false;
    const key = new Key({ pubkey: attestation.issuer.publicKeyHex });
    const body = {
      version: attestation.version,
      kind: attestation.kind,
      claim: attestation.claim
    };
    const signingPayload = stableStringify(body);
    const sig = Buffer.from(String(attestation.signature || ''), 'hex');
    return key.verifySchnorr(
      Buffer.isBuffer(signingPayload) ? signingPayload : Buffer.from(signingPayload, 'utf8'),
      sig
    );
  } catch (_) {
    return false;
  }
}

module.exports = {
  ATTESTATION_TYPE,
  KIND_PEERING,
  stableStringify,
  buildOracleAttestation,
  verifyOracleAttestation
};
