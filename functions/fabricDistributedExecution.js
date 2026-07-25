'use strict';

/**
 * Thin facade over `@fabric/core` program / federation helpers.
 * Prefer linking local fabric-clean (`npm run link:fabric`).
 *
 * Formerly a vendored copy of types/distributedExecution — execution belongs on
 * Machine + Program; these are protocol helpers only.
 */

let core = null;
try {
  core = {
    fabricCanonicalJson: require('@fabric/core/functions/fabricCanonicalJson'),
    beaconFederationSigning: require('@fabric/core/functions/beaconFederationSigning'),
    fabricProgramManifest: require('@fabric/core/functions/fabricProgramManifest')
  };
} catch (_) {
  core = null;
}

function _canon () {
  if (!core) throw new Error('@fabric/core functions required — npm run link:fabric');
  return core.fabricCanonicalJson;
}

function _fed () {
  if (!core) throw new Error('@fabric/core functions required — npm run link:fabric');
  return core.beaconFederationSigning;
}

function _manifest () {
  if (!core) throw new Error('@fabric/core functions required — npm run link:fabric');
  return core.fabricProgramManifest;
}

function stableStringify (value) {
  const c = _canon();
  return typeof c === 'function' ? c(value) : c.stableStringify(value);
}

function jsonSafe (value) {
  return _canon().jsonSafe(value);
}

function signingStringForBeaconEpoch (epochPayload) {
  return _fed().signingStringForBeaconEpoch(epochPayload);
}

function epochCommitmentDigestHex (epochPayload) {
  return _fed().epochCommitmentDigestHex(epochPayload);
}

function verifyFederationWitnessOnMessage (messageBuffer, witness, validatorPubkeys, threshold) {
  return _fed().verifyFederationWitnessOnMessage(
    messageBuffer,
    witness,
    validatorPubkeys,
    threshold
  );
}

function parseDistributedManifestV1 (raw) {
  return _manifest().parseDistributedManifestV1(raw);
}

function parseProgramManifestV1 (raw) {
  return _manifest().parseProgramManifestV1(raw);
}

module.exports = {
  stableStringify,
  jsonSafe,
  signingStringForBeaconEpoch,
  epochCommitmentDigestHex,
  verifyFederationWitnessOnMessage,
  parseDistributedManifestV1,
  parseProgramManifestV1,
  get BEACON_EPOCH_SIGNING_KIND () {
    return _fed().BEACON_EPOCH_SIGNING_KIND;
  }
};
