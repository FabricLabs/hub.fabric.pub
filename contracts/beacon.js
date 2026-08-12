'use strict';

/**
 * Hub Beacon — `@fabric/core/types/beacon` with Hub defaults.
 * Epoch seal + sidechain digests live in core; Hub wires Bitcoin / Filesystem /
 * federation, and retries durable finalize when a round is already `ready`.
 */

const CoreBeacon = require('@fabric/core/types/beacon');
const Message = require('@fabric/core/types/message');
const beaconFederationSigning = require('@fabric/core/functions/beaconFederationSigning');

class Beacon extends CoreBeacon {
  constructor (settings = {}) {
    super(Object.assign({ name: 'HUB:BEACON' }, settings));
  }

  /**
   * Core `addSignature` marks the round `ready` before Hub persist. A crash or
   * persist failure then makes retries hit `round not open`. Finalize the
   * existing ready round instead of reopening it for new signatures.
   * @param {string} commitmentDigest
   * @param {string} pubkey
   * @param {string} signatureHex
   * @returns {Promise<object>}
   */
  async submitFederationEpochSignature (commitmentDigest, pubkey, signatureHex) {
    const digest = String(commitmentDigest || '').trim();
    const pending = this._pendingEpochRounds.get(digest);
    if (pending && (pending.status === 'ready' || pending.status === 'sealed')) {
      return this._finalizeReadyFederationRound(digest, pending);
    }
    const result = await super.submitFederationEpochSignature(
      commitmentDigest,
      pubkey,
      signatureHex
    );
    if (result && result.status === 'error' && result.message === 'round not open') {
      const round = this._pendingEpochRounds.get(digest);
      if (round && (round.status === 'ready' || round.status === 'sealed')) {
        return this._finalizeReadyFederationRound(digest, round);
      }
    }
    return result;
  }

  /**
   * @param {string} digest
   * @param {object} round
   * @returns {Promise<object>}
   * @private
   */
  async _finalizeReadyFederationRound (digest, round) {
    if (this._epochAlreadySealed(digest, round)) {
      this._pendingEpochRounds.delete(digest);
      try {
        const doc = beaconFederationSigning.loadPendingDoc(this.fs);
        delete doc.rounds[digest];
        await beaconFederationSigning.persistPendingDoc(this.fs, doc);
      } catch (_) { /* ignore */ }
      return {
        status: 'success',
        sealed: true,
        commitmentDigest: digest,
        payload: round.payload,
        federationWitness: round.witness
      };
    }

    const message = Message.fromVector(['BEACON_EPOCH', JSON.stringify(round.payload)]);
    if (this.key && this.key.private) message.signWithKey(this.key);
    const entry = {
      type: 'BEACON_EPOCH',
      payload: round.payload,
      id: message.id || null,
      federationWitness: round.witness
    };
    this._epochChain.append(entry);
    await this._persistEpochChain();

    this._pendingEpochRounds.delete(digest);
    try {
      const doc = beaconFederationSigning.loadPendingDoc(this.fs);
      delete doc.rounds[digest];
      await beaconFederationSigning.persistPendingDoc(this.fs, doc);
    } catch (_) { /* ignore */ }

    this.emit('epoch', entry.payload);
    return {
      status: 'success',
      sealed: true,
      commitmentDigest: digest,
      payload: entry.payload,
      federationWitness: entry.federationWitness
    };
  }

  /**
   * @param {string} digest
   * @param {object} round
   * @returns {boolean}
   * @private
   */
  _epochAlreadySealed (digest, round) {
    try {
      const msgs = typeof this._epochChain.toBeaconMessages === 'function'
        ? this._epochChain.toBeaconMessages()
        : [];
      return msgs.some((e) => {
        if (!e || !e.payload) return false;
        try {
          return beaconFederationSigning.epochCommitmentDigestHex(e.payload) === digest;
        } catch (_) {
          const clock = round && round.payload && round.payload.clock;
          return clock != null && e.payload.clock === clock;
        }
      });
    } catch (_) {
      return false;
    }
  }
}

Beacon.BEACON_CHAIN_PATH = CoreBeacon.BEACON_CHAIN_PATH;
Beacon.SATS_PER_BTC = CoreBeacon.SATS_PER_BTC;

module.exports = Beacon;
