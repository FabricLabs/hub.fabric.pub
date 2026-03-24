'use strict';

/**
 * Optional Schnorr signatures (BIP340-style via @fabric/core Key.signSchnorr) on federation invite / response JSON.
 * Canonical payload excludes signature fields so peers can verify without trusting unsigned chat content.
 */

const Key = require('@fabric/core/types/key');

const SIG_HEX = 'fabricSchnorrSigHex';
const PK_HEX = 'fabricSignerPubkeyHex';

function _stripSigFields (obj) {
  const o = { ...obj };
  delete o[SIG_HEX];
  delete o[PK_HEX];
  return o;
}

/** Stable JSON for signing: sorted keys, signature fields omitted. */
function federationInviteCanonicalJson (obj) {
  const stripped = _stripSigFields(obj);
  const keys = Object.keys(stripped).sort();
  const out = {};
  for (const k of keys) out[k] = stripped[k];
  return JSON.stringify(out);
}

/**
 * @param {object} payload — invite or response object (without sig fields yet)
 * @param {import('@fabric/core/types/key')} signerKey
 * @returns {object} payload + fabricSignerPubkeyHex + fabricSchnorrSigHex
 */
function signFederationContractPayload (payload, signerKey) {
  if (!payload || typeof payload !== 'object') throw new Error('payload object required');
  if (!signerKey || typeof signerKey.signSchnorr !== 'function') throw new Error('signer Key required');
  const canon = federationInviteCanonicalJson(payload);
  const sig = signerKey.signSchnorr(canon);
  const pk = signerKey.public && typeof signerKey.public.encodeCompressed === 'function'
    ? signerKey.public.encodeCompressed('hex')
    : null;
  if (!pk) throw new Error('signer public key unavailable');
  return Object.assign({}, payload, {
    [PK_HEX]: pk,
    [SIG_HEX]: sig.toString('hex')
  });
}

/**
 * @param {object} parsed — JSON.parse result
 * @returns {{ ok: boolean, error?: string }}
 */
function verifyFederationContractPayloadSignature (parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'not an object' };
  const sigHex = parsed[SIG_HEX];
  const pkHex = parsed[PK_HEX];
  if (!sigHex || typeof sigHex !== 'string') return { ok: false, error: 'missing fabricSchnorrSigHex' };
  if (!pkHex || typeof pkHex !== 'string') return { ok: false, error: 'missing fabricSignerPubkeyHex' };
  let verifier;
  try {
    verifier = new Key({ public: pkHex.replace(/^0x/i, '') });
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'invalid public key' };
  }
  const canon = federationInviteCanonicalJson(parsed);
  const ok = verifier.verifySchnorr(canon, Buffer.from(sigHex.replace(/^0x/i, ''), 'hex'));
  return ok ? { ok: true } : { ok: false, error: 'signature verification failed' };
}

module.exports = {
  SIG_HEX,
  PK_HEX,
  federationInviteCanonicalJson,
  signFederationContractPayload,
  verifyFederationContractPayloadSignature
};
