'use strict';

/**
 * Peering HTTP surface for the Hub: discovery metadata and {@link Oracle}-style signed
 * attestations over the operator’s Fabric identity key. Same envelope shape can be reused
 * by other services (e.g. a price feed signs `kind: 'PriceQuote'` with an `OracleAttestation`).
 *
 * @see {@link https://github.com/FabricLabs/fabric/blob/master/types/oracle.js @fabric/core/types/oracle}
 */
const crypto = require('crypto');
const Service = require('@fabric/core/types/service');
const Key = require('@fabric/core/types/key');
const DistributedExecution = require('../functions/fabricDistributedExecution');
const { MAX_PEERS } = require('@fabric/core/constants');

const stableStringify = DistributedExecution.stableStringify;

const ATTESTATION_TYPE = 'OracleAttestation';
const KIND_PEERING = 'PeeringCapability';

class PeeringService extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Peering',
      enable: true,
      endpointBasePath: '/services/peering'
    }, settings);

    this.key = null;
    this.hub = null;
  }

  attach (deps = {}) {
    if (deps.key) this.key = deps.key;
    if (deps.hub) this.hub = deps.hub;
    return this;
  }

  /**
   * Public snapshot for GET /services/peering: includes a full inline {@link OracleAttestation}
   * when the identity key can sign (same envelope as a price-feed `PriceQuote` attestation).
   */
  getCapabilities () {
    let oracleAttestation = null;
    try {
      if (this.hub && this.key && this.key.private) {
        oracleAttestation = this.buildOracleAttestation();
      }
    } catch (_) {
      oracleAttestation = null;
    }
    return {
      service: 'peering',
      available: this.settings.enable !== false,
      endpointBasePath: this.settings.endpointBasePath,
      attestationType: ATTESTATION_TYPE,
      kind: KIND_PEERING,
      oracle: {
        name: 'Oracle',
        description: 'Signed claims anchored to the Hub secp256k1 identity (see @fabric/core/types/oracle)'
      },
      attestationUrl: oracleAttestation ? `${this.settings.endpointBasePath}/attestation` : null,
      oracleAttestation
    };
  }

  /**
   * Build the live claim object (what the Hub asserts about its peering stack).
   */
  buildClaim (hub) {
    const h = hub || this.hub;
    if (!h || !h.http) {
      return {
        kind: KIND_PEERING,
        version: 1,
        error: 'hub_not_ready'
      };
    }

    const http = h.http;
    const agent = h.agent;
    let webrtcRegistered = 0;
    if (http.webrtcPeers && typeof http.webrtcPeers.size === 'number') {
      webrtcRegistered = http.webrtcPeers.size;
    }
    const p2pConn = agent && agent.connections ? Object.keys(agent.connections).length : 0;
    const maxPeers = (agent && agent.settings && agent.settings.constraints &&
      agent.settings.constraints.peers && agent.settings.constraints.peers.max) || MAX_PEERS;

    return {
      kind: KIND_PEERING,
      version: 1,
      fabricPeerId: agent && agent.id ? String(agent.id) : null,
      fabricIdentityId: agent && agent.identity && agent.identity.id ? String(agent.identity.id) : null,
      hub: {
        alias: h.settings && h.settings.alias ? h.settings.alias : '@fabric/hub',
        clock: http.clock != null ? http.clock : null
      },
      p2p: {
        listenAddress: http.agent ? http.agent.listenAddress : null,
        listening: !!(http.agent && http.agent.listening),
        connections: p2pConn,
        maxPeers
      },
      webrtc: {
        signaling: ['RegisterWebRTCPeer', 'ListWebRTCPeers', 'SendWebRTCSignal', 'RelayFromWebRTC'],
        registeredPeers: webrtcRegistered
      },
      endpoints: {
        rpc: '/services/rpc',
        resources: '/services'
      }
    };
  }

  /**
   * Full {@link Oracle}-style attestation: canonical claim + BIP340 Schnorr signature.
   */
  buildOracleAttestation () {
    if (!this.key || !this.key.private) {
      throw new Error('PeeringService: identity key required for attestation');
    }
    const hub = this.hub;
    // JSON-safe claim only: omit undefined (e.g. p2p.listenAddress) so the signed bytes match
    // what clients get from HTTP/JSON and what verifyOracleAttestation recomputes.
    const claim = JSON.parse(JSON.stringify(this.buildClaim(hub)));
    const body = {
      version: 1,
      kind: KIND_PEERING,
      claim
    };
    const signingPayload = stableStringify(body);
    const signature = this.key.signSchnorr(signingPayload);
    const issuer = {
      publicKeyHex: this.key.pubkey,
      fabricIdentityId: hub && hub.agent && hub.agent.identity && hub.agent.identity.id
        ? String(hub.agent.identity.id)
        : null
    };

    return {
      '@type': ATTESTATION_TYPE,
      version: 1,
      kind: KIND_PEERING,
      oracle: {
        name: 'Oracle',
        resource: KIND_PEERING,
        note: 'Attestation follows the Oracle pattern: a signed claim verifiable against issuer.publicKeyHex'
      },
      issuer,
      claim,
      signature: signature.toString('hex'),
      algorithm: 'BIP340-SCHNORR',
      signedAt: new Date().toISOString(),
      claimDigest: crypto.createHash('sha256').update(Buffer.from(signingPayload, 'utf8')).digest('hex')
    };
  }

  /**
   * Verify an {@link OracleAttestation} produced by this or another Hub (or a price-feed oracle).
   * @param {object} attestation
   * @returns {boolean}
   */
  static verifyOracleAttestation (attestation) {
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
      return key.verifySchnorr(signingPayload, sig);
    } catch (_) {
      return false;
    }
  }
}

module.exports = PeeringService;
module.exports.stableStringify = DistributedExecution.stableStringify;
module.exports.ATTESTATION_TYPE = ATTESTATION_TYPE;
module.exports.KIND_PEERING = KIND_PEERING;
