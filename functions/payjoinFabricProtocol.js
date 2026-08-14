'use strict';

/**
 * Fabric Hub Payjoin / payments protocol metadata for `GET …/payjoin` capabilities.
 * - **BIP 78 (classic HTTP Payjoin)** — absolute BIP21 `pj=`, POST PSBT as `text/plain`,
 *   optional Hub ACP co-input, response `text/plain` payjoined PSBT (JSON path retained for UI/RPC).
 * - **BIP 77 (async)** — Hub-local experimental opaque mailbox (enqueue / poll / markDelivered),
 *   modeled on CONTRACT_MESSAGE queue semantics. Not a public Payjoin Directory + HPKE + OHTTP yet.
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

const FABRIC_PAYJOIN_PROFILE_VERSION = 2;

const RECEIVER_MODES = Object.freeze({
  BIP78_HTTP_PSBT: 'bip78_http_psbt',
  BIP77_ASYNC_MAILBOX: 'bip77_async_mailbox_experimental'
});

/**
 * @param {object} [opts]
 * @param {string} [opts.endpointBasePath]
 * @param {boolean} [opts.joinmarketTaprootTemplate]
 * @param {boolean} [opts.beaconFederationLeafConfigured]
 * @param {boolean} [opts.autoAcpBoost]
 * @param {string} [opts.publicOrigin]
 * @param {boolean} [opts.bip77MailboxExperimental]
 * @returns {object}
 */
function buildFabricPayjoinProtocolProfile (opts = {}) {
  const endpointBasePath = String(opts.endpointBasePath || '/services/payjoin').replace(/\/+$/, '') || '/services/payjoin';
  const bip77Experimental = opts.bip77MailboxExperimental !== false;
  const roadmapOrActive = bip77Experimental
    ? {
        activeModes: [RECEIVER_MODES.BIP78_HTTP_PSBT, RECEIVER_MODES.BIP77_ASYNC_MAILBOX],
        roadmapModes: [
          {
            id: 'bip77_directory_ohttp_hpke',
            status: 'not_implemented',
            summary: 'Full BIP 77: public Payjoin Directory + E2E HPKE + OHTTP (metadata privacy).',
            clientHint: 'Until shipped, use Hub-local experimental mailboxes or sync BIP78 pj= POST.'
          }
        ]
      }
    : {
        activeModes: [RECEIVER_MODES.BIP78_HTTP_PSBT],
        roadmapModes: [
          {
            id: RECEIVER_MODES.BIP77_ASYNC_MAILBOX,
            status: 'not_implemented',
            summary: 'BIP 77 Hub-local async mailbox (opaque enqueue/poll).',
            clientHint: 'Until enabled, use sync BIP78 POST to proposals URL from BIP21 pj=.'
          }
        ]
      };

  return {
    fabricProfileVersion: FABRIC_PAYJOIN_PROFILE_VERSION,
    monetaryStandard: 'bitcoin_l1',
    canonicalPaymentsApi: {
      payjoinRestBasePath: endpointBasePath,
      onchainPaymentsPostPath: '/payments',
      legacyAliases: {
        payjoin: ['/payments/payjoin', '/services/bitcoin/payjoin'],
        onchainPaymentsPost: ['/services/bitcoin/payments']
      },
      mailboxesPath: `${endpointBasePath}/mailboxes`
    },
    receiver: {
      ...roadmapOrActive,
      httpProposal: {
        methods: ['POST'],
        acceptedContentTypes: ['text/plain', 'application/json'],
        responseContentTypes: ['text/plain', 'application/json'],
        bodyEncoding: 'psbt_base64_or_raw',
        absolutePjRequired: true,
        publicOrigin: opts.publicOrigin ? String(opts.publicOrigin) : undefined,
        autoAcpBoost: !!opts.autoAcpBoost,
        joinmarketClientserverNote:
          'joinmarket.py / clientserver use a distinct coinjoin coordination stack; makers do not by default ' +
            'expose a BIP78 HTTPS endpoint. Use this Hub receiver with BIP21+pj= wallets (payjoin-cli, compatible mobile wallets) ' +
            'or integrate at the raw transaction / PSBT layer.'
      },
      asyncMailbox: bip77Experimental
        ? {
            status: 'experimental',
            summary: 'Hub-local opaque PSBT mailbox (enqueue / poll / markDelivered). Delivery ack ≠ Payjoin settled.',
            semantics: 'mirrors_contract_message_queue',
            paths: {
              create: `POST ${endpointBasePath}/mailboxes`,
              enqueue: `PUT ${endpointBasePath}/mailboxes/:id`,
              poll: `GET ${endpointBasePath}/mailboxes/:id`,
              delivered: `POST ${endpointBasePath}/mailboxes/:id/delivered`
            },
            notYet: ['payjoin_directory', 'hpke', 'ohttp']
          }
        : undefined
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
        'Experimental BIP77 mailbox is Hub-local (no OHTTP/HPKE); directory metadata privacy is not provided.',
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
