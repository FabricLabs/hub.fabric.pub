'use strict';

/**
 * Lightning (BOLT) payment channel modeled on Fabric's {@link Channel}.
 *
 * `@fabric/core/types/channel` describes bonded value and counterparty for
 * message-settlement semantics. This subclass records Core Lightning (CLN)
 * identifiers used by the Hub's `/services/lightning` integration.
 *
 * **Protocol note:** Inventory L1 HTLC (`functions/inventoryHtlc`) uses Taproot
 * script-path outputs (hashlock + CLTV refund) suitable for regtest/demo. That
 * layout is adjacent to many Lightning P2TR constructions but is **not**
 * BOLT-compatible — Fabric protocol, not L2 `pay_chan`.
 */

const Channel = require('@fabric/core/types/channel');

class LightningChannel extends Channel {
  /**
   * @param {Object} [settings] Passed to Fabric Channel; extended with LN fields.
   * @param {string} [settings.peerId] Remote node id (hex pubkey).
   * @param {string} [settings.shortChannelId] BOLT short_channel_id if known.
   * @param {string} [settings.clnChannelId] CLN internal channel id.
   * @param {string} [settings.lnStatus] offchain | opening | active | closing | closed | unknown
   */
  constructor (settings = {}) {
    const {
      peerId,
      remoteNodeId,
      shortChannelId,
      clnChannelId,
      channelId,
      lnStatus,
      ...rest
    } = settings;

    super(Object.assign({
      kind: 'lightning',
      transport: 'cln',
      mode: settings.mode || 'bidirectional'
    }, rest));

    this._ln = {
      peerId: peerId || remoteNodeId || null,
      shortChannelId: shortChannelId || null,
      clnChannelId: clnChannelId || channelId || null,
      status: lnStatus || 'unknown'
    };
  }

  get lightning () {
    return Object.assign({}, this._ln);
  }

  /**
   * Update CLN-facing metadata and emit commit (inherits Channel behavior).
   * @param {Object} patch Partial fields for _ln
   * @returns {Object} snapshot of lightning state
   */
  setLightningState (patch = {}) {
    if (!patch || typeof patch !== 'object') return this.lightning;
    this._ln = Object.assign(this._ln, patch);
    this.commit();
    return this.lightning;
  }
}

module.exports = LightningChannel;
