'use strict';

/**
 * Beacon Federation signature rounds — prefer `@fabric/core`.
 * @see @fabric/core/functions/beaconFederationSigning
 */

try {
  module.exports = require('@fabric/core/functions/beaconFederationSigning');
} catch (_) {
  // Fallback when published core tarball lags the local fabric checkout.
  const DistributedExecution = require('./fabricDistributedExecution');

  const FEDERATION_SIGN_REQUEST = 'FederationSignRequest';
  const FEDERATION_SIGN_RESPONSE = 'FederationSignResponse';
  const PENDING_STORE_PATH = 'beacon/PENDING_EPOCH_ROUNDS';

  function emptyDoc () {
    return { version: 1, rounds: {} };
  }

  function loadPendingDoc (fs) {
    if (!fs || typeof fs.readFile !== 'function') return emptyDoc();
    try {
      const raw = fs.readFile(PENDING_STORE_PATH);
      if (!raw) return emptyDoc();
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
      if (!parsed || typeof parsed !== 'object') return emptyDoc();
      const rounds = parsed.rounds && typeof parsed.rounds === 'object' ? parsed.rounds : {};
      return { version: 1, rounds };
    } catch (e) {
      return emptyDoc();
    }
  }

  async function persistPendingDoc (fs, doc) {
    if (!fs || typeof fs.publish !== 'function') return;
    await fs.publish(PENDING_STORE_PATH, {
      version: 1,
      rounds: doc.rounds || {}
    });
  }

  function createRound (epochPayload, policy, initialWitness = null) {
    const commitmentDigest = DistributedExecution.epochCommitmentDigestHex(epochPayload);
    const validators = (policy.validators || []).map((v) => String(v).trim()).filter(Boolean);
    const threshold = Math.max(1, Number(policy.threshold) || 1);
    return {
      commitmentDigest,
      payload: epochPayload,
      validators,
      threshold: Math.min(threshold, validators.length || threshold),
      witness: {
        version: 1,
        signatures: Object.assign({}, (initialWitness && initialWitness.signatures) || {})
      },
      status: 'collecting',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function messageBufferForPayload (payload) {
    return Buffer.from(DistributedExecution.signingStringForBeaconEpoch(payload), 'utf8');
  }

  function roundMeetsThreshold (round) {
    if (!round || !round.validators || !round.validators.length) return true;
    return DistributedExecution.verifyFederationWitnessOnMessage(
      messageBufferForPayload(round.payload),
      round.witness,
      round.validators,
      round.threshold
    );
  }

  function addSignature (round, pubkey, signatureHex) {
    if (!round || round.status === 'sealed') {
      return { ok: false, error: 'round not open' };
    }
    const pk = String(pubkey || '').trim();
    const sig = String(signatureHex || '').trim();
    if (!pk || !sig) return { ok: false, error: 'pubkey and signature required' };
    if (!round.validators.includes(pk)) {
      return { ok: false, error: 'pubkey not in federation validators' };
    }
    const msg = messageBufferForPayload(round.payload);
    const probe = { version: 1, signatures: { [pk]: sig } };
    if (!DistributedExecution.verifyFederationWitnessOnMessage(msg, probe, [pk], 1)) {
      return { ok: false, error: 'invalid Schnorr signature' };
    }
    round.witness.signatures[pk] = sig;
    round.updatedAt = new Date().toISOString();
    const sealed = roundMeetsThreshold(round);
    if (sealed) round.status = 'ready';
    return { ok: true, round, sealed };
  }

  function encodeSignRequest (round) {
    return {
      type: FEDERATION_SIGN_REQUEST,
      version: 1,
      commitmentDigest: round.commitmentDigest,
      epoch: round.payload,
      validators: round.validators.slice(),
      threshold: round.threshold,
      createdAt: round.createdAt
    };
  }

  function encodeSignResponse (commitmentDigest, pubkey, signatureHex) {
    return {
      type: FEDERATION_SIGN_RESPONSE,
      version: 1,
      commitmentDigest: String(commitmentDigest),
      pubkey: String(pubkey),
      signature: String(signatureHex)
    };
  }

  function parseSignResponse (body) {
    if (!body || typeof body !== 'object') return { ok: false, error: 'body required' };
    if (body.type && body.type !== FEDERATION_SIGN_RESPONSE) {
      return { ok: false, error: 'not a FederationSignResponse' };
    }
    const commitmentDigest = body.commitmentDigest != null ? String(body.commitmentDigest) : '';
    const pubkey = body.pubkey != null ? String(body.pubkey) : '';
    const signature = body.signature != null ? String(body.signature) : '';
    if (!commitmentDigest || !pubkey || !signature) {
      return { ok: false, error: 'commitmentDigest, pubkey, signature required' };
    }
    return { ok: true, commitmentDigest, pubkey, signature };
  }

  module.exports = {
    FEDERATION_SIGN_REQUEST,
    FEDERATION_SIGN_RESPONSE,
    PENDING_STORE_PATH,
    loadPendingDoc,
    persistPendingDoc,
    createRound,
    roundMeetsThreshold,
    addSignature,
    encodeSignRequest,
    encodeSignResponse,
    parseSignResponse,
    messageBufferForPayload
  };
}
