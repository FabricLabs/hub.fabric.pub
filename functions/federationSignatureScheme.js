'use strict';

/**
 * Federation witness scheme stored with hub policy.
 * `schnorr` is BIP340. `bls` is BLS12-381 (see `@fabric/core` `functions/bls`).
 *
 * @param {string|boolean|number|null|undefined} value
 * @returns {'schnorr'|'bls'}
 */
function normalizeFederationSignatureScheme (value) {
  if (value === true || value === 1) return 'bls';
  if (value === false || value === 0 || value == null) return 'schnorr';
  const s = String(value).trim().toLowerCase();
  if (s === 'bls' || s === 'bls12-381' || s === 'bls12_381' || s === 'true') return 'bls';
  return 'schnorr';
}

module.exports = {
  normalizeFederationSignatureScheme
};
