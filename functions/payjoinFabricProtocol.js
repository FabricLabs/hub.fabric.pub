'use strict';

/**
 * Fabric Hub Payjoin / payments protocol metadata for `GET …/payjoin` capabilities.
 * - **BIP 78 (classic HTTP Payjoin)** is what this Hub implements today (POST PSBT to `…/sessions/:id/proposals`).
 * - **BIP 77 (async / “Payjoin 2.0”)** adds directory + OHTTP + encrypted mailboxes; fields here are an
 *   **extensibility stub** so clients can negotiate future versions without breaking BIP21 `pj=`.
 *
 * Privacy: complements on-chain privacy (common-input ownership, output alignment) are **partial**.
 * Mitigations align with public Payjoin project guidance (probing, wallet fingerprinting). Broader Bitcoin
 * privacy discussion (e.g. efficiency and deployment hurdles for stronger guarantees) applies at the
 * ecosystem layer—not specific to this receiver implementation.
 *
 * **joinmarket-clientserver**: coordinates P2P coinjoins via its own control protocol (IRC + follow-on);
 * it does **not** POST BIP78 bodies to arbitrary merchant `pj=` URLs. Interop with this Hub is primarily
 * at the **Bitcoin transaction** layer when another tool assembles a multi-party tx or when wallets use
 * standard BIP21+pj= against this HTTP receiver.
 */

const FABRIC_PAYJOIN_PROFILE_VERSION = 1;

const RECEIVER_MODES = Object.freeze({
  BIP78_HTTP_PSBT: 'bip78_http_psbt',
  BIP77_ASYNC_DIRECTORY: 'bip77_async_directory_stub'
});

/**
 * @param {object} [opts]
 * @param {string} [opts.endpointBasePath]
 * @param {boolean} [opts.joinmarketTaprootTemplate]
 * @param {boolean} [opts.beaconFederationLeafConfigured]
 * @returns {object}
 */
function buildFabricPayjoinProtocolProfile (opts = {}) {
  const endpointBasePath = String(opts.endpointBasePath || '/services/payjoin').replace(/\/+$/, '') || '/services/payjoin';
  return {
    fabricProfileVersion: FABRIC_PAYJOIN_PROFILE_VERSION,
    monetaryStandard: 'bitcoin_l1',
    canonicalPaymentsApi: {
      payjoinRestBasePath: endpointBasePath,
      onchainPaymentsPostPath: '/payments',
      legacyAliases: {
        payjoin: ['/payments/payjoin', '/services/bitcoin/payjoin'],
        onchainPaymentsPost: ['/services/bitcoin/payments']
      }
    },
    receiver: {
      activeModes: [RECEIVER_MODES.BIP78_HTTP_PSBT],
      roadmapModes: [
        {
          id: RECEIVER_MODES.BIP77_ASYNC_DIRECTORY,
          status: 'not_implemented',
          summary: 'BIP 77: async payjoin via directory + E2E encryption + OHTTP (privacy for metadata).',
          clientHint: 'Until implemented, use sync BIP78 POST to proposals URL from BIP21 pj=.'
        }
      ],
      httpProposal: {
        methods: ['POST'],
        acceptedContentTypes: ['text/plain'],
        bodyEncoding: 'psbt_base64_or_raw',
        joinmarketClientserverNote:
          'joinmarket.py / clientserver use a distinct coinjoin coordination stack; makers do not by default ' +
            'expose a BIP78 HTTPS endpoint. Use this Hub receiver with BIP21+pj= wallets (payjoin-cli, compatible mobile wallets) ' +
            'or integrate at the raw transaction / PSBT layer.'
      }
    },
    privacy: {
      designGoals: ['weakenCommonInputOwnershipHeuristic', 'limitOutputAlignmentLeakage'],
      mitigations: [
        {
          id: 'session_ttl_and_minimums',
          summary: 'Short-lived Payjoin sessions and sane minimum amounts reduce gratuitous probing surface.'
        },
        {
          id: 'acp_coinputs',
          summary: 'SIGHASH_ALL|ANYONECANPAY lets the receiver add inputs without invalidating payer output commitments (Hub ACP boost).'
        },
        {
          id: 'wallet_fingerprint_uniformity',
          summary: 'Match feerates, witness templates, and version fields where possible; mixed fingerprints erode payjoin ambiguity.'
        }
      ],
      knownLimitations: [
        'A motivated adversary can still correlate timing, round structure, or peer behaviour.',
        'Receiver learns payer input structure for sessions they process (trust / HTTPS model).',
        'Broader Bitcoin privacy literature (e.g. ecosystem hurdles to stronger on-chain privacy) applies: payjoin is a tool, not a complete anonymity layer.'
      ]
    },
    extensions: {
      joinmarketTaprootReceiveTemplate: !!opts.joinmarketTaprootTemplate,
      beaconFederationReserveLeaf: !!opts.beaconFederationLeafConfigured
    }
  };
}

module.exports = {
  FABRIC_PAYJOIN_PROFILE_VERSION,
  RECEIVER_MODES,
  buildFabricPayjoinProtocolProfile
};
