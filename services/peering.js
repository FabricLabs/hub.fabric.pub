'use strict';

/**
 * Peering HTTP surface for the Hub: discovery metadata and Oracle-style signed
 * attestations over the operator’s Fabric identity key.
 */
const Service = require('@fabric/core/types/service');
const { MAX_PEERS } = require('@fabric/core/constants');

let oracleAttestation;
try {
  oracleAttestation = require('@fabric/http/functions/oracleAttestation');
} catch (_) {
  oracleAttestation = require('../functions/oracleAttestation');
}

let peeringHttp;
try {
  peeringHttp = require('@fabric/http/functions/fabricPeeringHttp');
} catch (_) {
  peeringHttp = null;
}

const {
  ATTESTATION_TYPE,
  KIND_PEERING,
  buildOracleAttestation: signOracleAttestation,
  verifyOracleAttestation,
  stableStringify
} = oracleAttestation;

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

  getCapabilities () {
    let att = null;
    try {
      if (this.hub && this.key && this.key.private) {
        att = this.buildOracleAttestation();
      }
    } catch (_) {
      att = null;
    }
    const claim = (() => {
      try { return JSON.parse(JSON.stringify(this.buildClaim(this.hub))); } catch (_) { return null; }
    })();
    if (peeringHttp && typeof peeringHttp.buildPeeringCapabilitiesBody === 'function') {
      return peeringHttp.buildPeeringCapabilitiesBody({
        available: this.settings.enable !== false,
        endpointBasePath: this.settings.endpointBasePath,
        claim,
        oracleAttestation: att,
        oracleDescription:
          'Signed claims anchored to the Hub secp256k1 identity (see @fabric/core/types/oracle)'
      });
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
      attestationUrl: att ? `${this.settings.endpointBasePath}/attestation` : null,
      claim,
      oracleAttestation: att
    };
  }

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

  buildOracleAttestation () {
    if (!this.key || !this.key.private) {
      throw new Error('PeeringService: identity key required for attestation');
    }
    const hub = this.hub;
    const claim = JSON.parse(JSON.stringify(this.buildClaim(hub)));
    return signOracleAttestation({
      claim,
      key: this.key,
      kind: KIND_PEERING,
      issuer: {
        publicKeyHex: this.key.pubkey,
        fabricIdentityId: hub && hub.agent && hub.agent.identity && hub.agent.identity.id
          ? String(hub.agent.identity.id)
          : null
      }
    });
  }

  static verifyOracleAttestation (attestation) {
    return verifyOracleAttestation(attestation);
  }
}

module.exports = PeeringService;
module.exports.stableStringify = stableStringify;
module.exports.ATTESTATION_TYPE = ATTESTATION_TYPE;
module.exports.KIND_PEERING = KIND_PEERING;
