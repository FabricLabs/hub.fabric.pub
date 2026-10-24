'use strict';

const common = require('./common');

const { plural, sats } = common;

const confirmations = (n) => plural(n, 'confirmation');
const sizeBytes = (n) => plural(n, 'byte');
const explorerOff = 'To open this transaction, turn on Bitcoin block and transaction pages in Settings → Admin → Feature visibility.';
const pasteTxidLabel = 'Or paste the transaction ID if you paid from another wallet';

module.exports = {
  list: {
    home: 'Home',
    title: 'Documents',
    countSr: (n) => `${plural(n, 'document')} on this Hub`,
    countTitle: 'Documents on this Hub',
    loadingTitle: 'Loading documents…',
    loadingConnecting: 'Connecting to the Hub…',
    loadingInventories: 'Waiting for file lists from connected peers…',
    loadingCatalog: 'Waiting for the published catalog from the Hub…',
    catalogErrorTitle: 'Could not load the full catalog',
    catalogErrorHint: 'The live connection may still catch up in a moment. If it does not, reload the page.',
    catalogErrorEndpoint: 'JSON-RPC endpoint:',
    catalogErrors: {
      listRefused: (reason) => `The Hub refused the document list: ${reason}`,
      listHttp: (status) => `Could not load the document list (HTTP ${status}).`,
      status: 'Could not load network status from the Hub.',
      noResults: 'The Hub did not return the document list. Check that it is running, then reload the page.',
      emptyResults: 'The Hub returned an empty document list.',
      unreadable: 'The Hub returned a document list this page could not read.',
      refusedFallback: 'request refused'
    },
    identity: {
      titleLocked: 'Unlock your identity to add documents',
      titleWatchOnly: 'Import your full key to add documents',
      titleNone: 'Log in to add documents',
      intro: 'Documents you add here are encrypted with your Fabric key.',
      walletLink: 'Bitcoin wallet & derivation',
      walletSuffix: 'shows which Bitcoin addresses the same identity uses.',
      devSeedIntro: 'Local development: load the same seed phrase as the Hub (FABRIC_SEED if set, else FABRIC_MNEMONIC) into this browser with',
      devSeedIn: 'in',
      devSeedPassphrase: 'Optional BIP39 passphrase:',
      devSeedPush: 'Or set this on the Hub (never on a public host):',
      devAutomation: 'Automation without a browser:'
    },
    add: {
      title: 'Add a document',
      intro: 'Write a text document or choose a file. It stays private in this browser until you publish it. Publish it with a price to sell it: the content is encrypted, and buyers pay that price in sats to get the key.',
      distributeBefore: 'To have other nodes keep a copy, open the document, choose Distribute, and pay the invoice from',
      distributeLink: 'Bitcoin',
      devPricing: 'Priced documents are sealed (ciphertext at rest). Buyers fund an on-chain HTLC whose preimage is the decryption key, through a peer inventory or with Confirm payment and unlock on the document page.',
      newText: 'New text document',
      nameLabel: 'Name',
      namePlaceholder: 'Untitled',
      defaultName: 'Untitled',
      contentLabel: 'Content',
      contentPlaceholder: 'Type or paste text…',
      create: 'Create document',
      fileLabel: 'Or choose a file',
      errorTitle: 'Could not add document'
    },
    catalog: {
      title: 'Catalog',
      summary: 'Your private documents, what this Hub publishes, and files that peers offer.',
      askPeers: 'Ask peers for files',
      askPeersTitle: 'Request file lists from connected peers',
      peerFilesTitle: 'Files from peers',
      peerFilesBody: 'This list shows files offered by connected peers. To publish your own files, open this page on a running Hub.',
      marketTitle: 'Document market',
      market: ({ resell, markupPercent, markupSats, offerCount }) => {
        const extra = markupSats > 0 ? ` plus ${sats(markupSats)}` : '';
        const resellText = resell ? ` and resells files it holds at a ${markupPercent}% markup${extra}` : '';
        const countText = offerCount != null ? ` ${plural(offerCount, 'peer offer')} saved.` : '';
        return `This Hub collects file lists from peers${resellText}. It only sells files it can deliver itself.${countText}`;
      },
      empty: 'No documents yet.',
      showing: (from, to, total) => `Showing ${from}–${to} of ${total}`
    },
    labels: {
      published: 'Published',
      publishedTitle: 'Published on this Hub',
      private: 'Private',
      privateTitle: 'Only in this browser',
      peerFile: 'Peer file',
      peerFileTitle: 'Listed by a connected peer',
      encrypted: 'Encrypted',
      encryptedTitle: 'Encrypted with your key',
      bitcoinBlock: 'Bitcoin block',
      bitcoinBlockTitle: 'Bitcoin block summary this Hub published automatically',
      bitcoinTx: 'Bitcoin transaction',
      bitcoinTxTitle: 'Bitcoin transaction published automatically from an indexed block. Pruned nodes may drop it.',
      storage: 'Storage contract',
      storageTitle: 'Other nodes are paid to keep a copy',
      storagePaymentTitle: 'Storage contract payment',
      unconfirmed: 'Unconfirmed',
      unconfirmedTitle: 'The storage payment is waiting for its first confirmation',
      confirmations,
      paymentUnknown: 'Payment unknown',
      paymentUnknownTitle: 'Could not look up the storage payment on Bitcoin',
      peerOffer: 'Peer offer',
      peerOfferTitle: 'Offered by a connected peer. This Hub does not have the file yet.',
      peerPrice: (amount) => `Peers: ${amount}`,
      peerPriceTitle: 'Lowest price a peer asks',
      priceTitle: 'Price to buy'
    },
    row: {
      sizeBytes,
      author: 'Author',
      authorTitle: 'Document ID of the original author',
      publisher: 'Publisher',
      publisherTitle: 'Peer ID of the Hub that published it',
      notReplicated: 'No other copies',
      notReplicatedTitle: 'Published, but no other node has agreed to keep a copy yet'
    }
  },

  view: {
    backToList: 'Documents',
    headingFallback: 'Document',
    labels: {
      encrypted: 'Encrypted',
      encryptedTitle: 'Encrypted with your key',
      published: 'Published',
      publishedAt: (when) => `Published ${when}`,
      peerOffer: 'Peer offer',
      peerOfferTitle: 'Offered by a peer. This Hub does not have the file.',
      distributed: 'Distributed',
      distributedTitle: 'Other nodes keep a copy under a storage contract'
    },
    load: {
      title: 'Loading document…',
      subtitle: 'Fetching details from the Hub.',
      errorTitle: 'Could not load document',
      http: (status) => (status
        ? `Could not load this document (HTTP ${status}). Try again.`
        : 'Could not load this document. Try again.'),
      refused: 'The Hub refused to load this document.',
      failed: 'Could not load this document from the Hub. Try again.',
      network: 'Could not reach the Hub to load this document. Check your connection, then try again.',
      notFound: 'This document was not found on the Hub.',
      timeout: 'The Hub has not answered yet. Check your connection, then try again.'
    },
    availability: {
      title: 'Where this document lives',
      intro: 'Author is the ID of whoever first created the document. Publisher is the Hub that lists it on the network. Publish it with a price to sell it: the content is encrypted, and buyers pay in sats to get the key.',
      introDistribute: 'Distribute pays other nodes to keep a copy.',
      localTitle: 'In this browser',
      local: (hashPrefix) => (hashPrefix
        ? `This browser holds the document details (content hash ${hashPrefix}…).`
        : 'This browser holds the document details.'),
      publishedTitle: 'Published',
      publishedSince: (when, publisher) => `Listed on the network since ${when}.${publisher ? ` Publisher: ${publisher}.` : ''}`,
      publishedListed: (publisher) => `Listed on this Hub.${publisher ? ` Publisher: ${publisher}.` : ''}`,
      notPublished: 'Not published. Only you can see it until you publish it.',
      storageTitle: 'Storage contract',
      activeContract: 'Active contract',
      activeContractSuffix: '— other nodes are paid to keep a copy.',
      checkingPayment: 'Checking the payment…',
      unconfirmed: 'Unconfirmed',
      paymentTx: 'Payment transaction',
      awaitingConfirmation: '— waiting for confirmation',
      confirmations,
      viewPaymentTx: 'View payment transaction',
      explorerOff,
      noPaymentTx: 'The contract has no payment transaction yet.',
      noContract: 'No storage contract.',
      noContractDistribute: 'No storage contract. Use Distribute to pay other nodes to keep a copy.',
      priceTitle: 'Price',
      price: (amount) => `Buyers pay ${amount} to unlock the content. Payment is an on-chain Bitcoin transaction, not a Lightning invoice.`,
      free: 'Free. Anyone can download it once it is published.',
      devPricing: 'Paid access is an inventory HTLC (P2TR) on L1. Priced content is stored as ciphertext at rest; the HTLC preimage is the decryption key.'
    },
    pieces: {
      title: 'Pieces and providers',
      intro: 'The file is split into sealed pieces. This shows each piece’s fingerprint and the cheapest or fastest peers this Hub has seen offering it.',
      agentButton: 'Let the Hub buy the pieces',
      agentButtonTitle: 'The Hub’s buying agent picks the cheapest or nearest provider for each piece (regtest and signet only)',
      agentNeedsToken: 'Asking the Hub to buy pieces needs the admin token. Add it under Settings → Admin.',
      agentDisabled: 'The Hub’s buying agent is turned off. An operator can turn it on in the Hub settings.',
      agentRefused: 'The buying agent declined this request.',
      agentQueued: (n) => `The Hub will buy ${plural(n, 'piece')} when a plan fits its budget.`
    },
    offers: {
      title: 'Peer offers',
      intro: 'Peers offering this file. This Hub only sells a file it holds itself; peer prices show what it would pay to get a copy.',
      costBasis: 'Cost to get a copy:',
      listedAt: (amount) => `Listed at ${amount}`,
      thisHub: 'This Hub',
      unknownPeer: 'Unknown peer',
      lowest: 'Lowest',
      local: 'Local',
      free: 'Free',
      noPrice: 'No price'
    },
    details: {
      title: 'Details',
      id: 'ID:',
      author: 'Author:',
      authorTitle: 'Document ID of the original author',
      publisher: 'Publisher:',
      publisherTitle: 'Peer ID of the Hub that lists this document',
      publisherNone: 'Shown once published',
      type: 'Type:',
      size: 'Size:',
      sizeBytes
    },
    keyUnlock: {
      title: 'Unlock with key',
      body: 'You paid for this file and it arrived encrypted. Paste the 64-character key from the seller’s on-chain claim to unlock it.',
      paymentHash: 'Payment hash (match it against the on-chain claim):',
      keyLabel: 'Key',
      keyPlaceholder: '64 hex characters',
      button: 'Unlock with key',
      buttonTitle: 'The key is 64 hex characters, the same length as a transaction ID',
      failed: 'Could not unlock with that key. Check it and try again.',
      devIntro: 'This file was sent after an inventory HTLC was funded. The key is the 32-byte preimage in the seller’s on-chain claim witness (Taproot hashlock). Binding depends on how the document was listed:',
      devSealed: 'Priced / sealed: the preimage is the AES content key K; the payment hash is SHA256(K).',
      devLegacy: 'Legacy unsealed: the preimage is SHA256 of the unsigned Fabric DocumentPublish envelope (signature field all zeros, not a signed gossip frame). The invoice contentHash is SHA256(preimage).',
      devHelpers: 'Canonical helpers: @fabric/core/functions/documentPaymentHash (resolveDocumentContentHashHex) and publishedDocumentEnvelope.'
    },
    identity: {
      titleLocked: 'Unlock your identity to publish or buy',
      titleWatchOnly: 'Import your full key to publish or buy',
      titleNone: 'Log in to publish or buy',
      signed: 'Publishing, buying, and distributing are signed with your key in this browser.',
      encrypted: 'Encrypted documents also need your key to preview or download.',
      payments: 'Payments are real Bitcoin transactions. Pay from the Hub wallet (needs the admin token) or from any wallet and paste the transaction ID.',
      walletLink: 'Bitcoin wallet & derivation',
      walletSuffix: 'shows which Bitcoin addresses this identity uses.',
      buttonLocked: 'Unlock identity',
      buttonWatchOnly: 'Import full key',
      buttonNone: common.identity.login,
      devSigning: 'Hub requests are Schnorr-signed in this browser. Hub-wallet payments are broadcast through the Hub’s bitcoind.'
    },
    actions: {
      publish: 'Publish',
      publishing: 'Publishing…',
      published: 'Published',
      publishedTitle: 'This document is published',
      publishTitle: 'Publish this document on the Hub so others can find it',
      priceLabel: 'Price (sats)',
      priceTitle: (defaultSats) => `Price buyers pay once it is published. Default ${defaultSats} sats; enter 0 to publish for free.`,
      buy: (amount) => `Buy (${amount})`,
      buyTitle: 'Pay in sats to unlock this document',
      distribute: 'Distribute',
      distributed: 'Distributed',
      distributeTitle: 'Pay other nodes to keep a copy of this document',
      viewContractTitle: 'View storage contract',
      share: 'Share',
      shareTitle: 'Share a link to this document',
      unpublish: 'Unpublish',
      unpublishTitle: 'Remove this document from the Hub’s published list (needs the admin token)',
      download: 'Download',
      publishErrorTitle: 'Could not publish',
      publishTimeout: 'The Hub has not confirmed the publish yet. Check your connection, then try again.',
      publishFailed: 'Could not publish this document. Try again.'
    },
    share: {
      title: 'Share document',
      body: 'This link keeps the document ID after the # sign, so it is not sent to the server when the page loads.',
      linkLabel: 'Share link',
      copy: 'Copy link',
      permanent: 'Permanent link:'
    },
    unpublish: {
      title: 'Unpublish document',
      body: 'This removes the document from the Hub’s published list, so it no longer shows up on the network. The Hub may still keep its stored copy.',
      documentId: 'Document ID:',
      confirm: 'Unpublish',
      devTombstone: 'Same as EmitTombstone with documentId. The stored file stays under documents/ on the Hub.',
      notConnected: 'Not connected to the Hub yet. Wait a moment, then try again.',
      failed: 'Could not unpublish. Check the admin token and that the document is still published, then try again.'
    },
    identityTitle: {
      locked: 'Your identity is locked',
      watchOnly: 'Your identity is watch-only',
      none: 'You are not logged in'
    },
    distribute: {
      title: 'Distribute document',
      intro: 'Pay in sats to have other nodes keep a copy of this document under a long-term contract. By default they store it for 4 years and must answer random checks that they still have it. Payment is a real Bitcoin transaction; the Hub checks it before the contract starts.',
      needKeyThen: 'Then open Distribute again.',
      noLocalKeyTitle: 'Signing happens outside this browser',
      noLocalKeyBody: 'Invoice and contract requests still reach the Hub through your session. Pay the storage address from any wallet you trust. If you use desktop signing, approve prompts in the Hub app, and on a shared computer end the session under',
      securityLink: 'Security & delegation',
      steps: {
        request: '1. Request invoice',
        pay: '2. Pay',
        confirm: '3. Confirm',
        done: '3. Done'
      },
      successTitle: 'Storage contract created',
      successBody: 'Your payment is confirmed and the document is now distributed.',
      viewContract: 'View contract',
      amountLabel: 'Amount (sats)',
      amountPlaceholder: 'For example, 100000',
      amountInvalid: 'Enter an amount in sats greater than 0.',
      copiesLabel: 'Number of copies',
      durationLabel: 'Duration',
      years: 'years',
      cadenceLabel: 'Check frequency',
      deadlineLabel: 'Response deadline',
      cadence: {
        hourly: 'Hourly',
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly'
      },
      deadline: {
        '1s': '1 second',
        '5s': '5 seconds',
        '10s': '10 seconds',
        '30s': '30 seconds',
        '60s': '60 seconds',
        '10m': '10 minutes',
        '60m': '60 minutes'
      },
      peerTitle: 'Or offer it to a connected peer',
      peerBody: 'Send a private hosting offer to one peer. If they accept, they send back a Bitcoin invoice; pay it to start storage. Offers you receive show up on',
      peerBodyLink: 'Documents',
      peerBodyAfter: 'The Hub must already hold this file, so open or create it here first.',
      noPeersBefore: 'No peers are connected to the Hub. Connect one under',
      noPeersLink: 'Peers',
      peerLabel: 'Peer',
      peerPlaceholder: 'Choose a connected peer',
      sendOffer: 'Send hosting offer',
      offerAmountInvalid: 'Enter an amount in sats above, then send the offer.',
      offerUnavailable: 'Hosting offers are not available yet. Wait for the Hub connection, then try again.',
      offerSent: (ref) => (ref
        ? `Hosting offer sent (${ref}). When the peer accepts, pay their invoice to start storage.`
        : 'Hosting offer sent. When the peer accepts, pay their invoice to start storage.'),
      offerFailed: 'Could not send the hosting offer. Try again.',
      offerTimeout: 'The Hub did not respond in time. Try again.',
      invoiceLabel: 'Storage contract payment',
      payFromHub: 'Pay from Hub wallet',
      payFromHubTitle: 'The Hub pays this invoice from its own Bitcoin wallet. Needs the admin token and your unlocked key.',
      payFromHubNote: 'Pays from the Hub’s wallet and starts the contract in one step. On regtest, mine a block if the check is slow.',
      devPayFromHub: 'Calls POST /services/bitcoin sendpayment on the Hub’s bitcoind, then CreateStorageContract with the returned txid (same as Confirm and distribute).',
      pasteTxidLabel,
      txidPlaceholder: 'Transaction ID',
      openTx: 'Open transaction',
      explorerOff,
      mempoolNote: '— new payments usually show as unconfirmed first. On regtest, mine a block to confirm.',
      checking: 'Checking confirmations…',
      unconfirmed: 'Unconfirmed',
      zeroConfirmations: '— 0 confirmations',
      confirmations,
      notSeen: 'The Hub has not seen this transaction yet. Checking again shortly.',
      txNotFound: 'This Hub has not seen the payment transaction yet.',
      request: 'Request invoice',
      confirm: 'Confirm and distribute',
      invoiceFailed: 'Could not create the storage invoice. Try again.',
      invoiceTimeout: 'The Hub did not send a storage invoice in time. Check that Bitcoin is running, then request the invoice again.',
      contractFailed: 'Could not create the storage contract. Check the transaction ID, then try again.',
      contractSlow: 'Creating the storage contract is taking longer than expected. Check Contracts, or try again.',
      failed: 'Could not start distribution. Try again.',
      unavailable: 'This Hub does not offer distribution.'
    },
    purchase: {
      title: 'Buy document',
      intro: 'Pay the amount below in sats. Once the Hub sees your payment, it sends the key and the document unlocks in this browser.',
      devIntro: 'Priced documents are stored as ciphertext at rest. After verifying the L1 payment the Hub reveals the AES key (the HTLC preimage). Claim on the same Hub returns plaintext; a peer inventory HTLC delivers ciphertext, then unlocks via HTLC_KEY_REVEAL.',
      needKeyThen: 'Then you can finish buying from this browser.',
      confirmHelp: 'If unlocking fails right after you pay, the payment may not be confirmed yet.',
      regtestBefore: 'On regtest, use Generate block on',
      regtestLink: 'Bitcoin',
      resourcesBefore: 'To check a payment by transaction ID, address, and amount, use',
      resourcesLink: 'Bitcoin → Resources',
      resourcesOff: 'An admin can turn on Bitcoin HTTP resources in Settings → Admin to check payments here.',
      successTitle: 'Document unlocked',
      successBody: 'The content matches its fingerprint. You can view or download it now.',
      download: 'Download',
      requesting: 'Requesting payment details…',
      errorHelpBefore: 'This usually means Bitcoin is not running on the Hub, or the document is not published with a price. Check',
      errorHelpLink: 'Bitcoin',
      errorHelpAfter: 'and make sure this document shows Published with a price.',
      invoiceLabel: 'Document purchase',
      payFromHub: 'Pay from Hub wallet',
      payFromHubTitle: 'The Hub pays from its own Bitcoin wallet. Needs the admin token and your unlocked key.',
      payFromHubNote: 'Pays from the Hub’s wallet, then unlocks the document. On regtest, mine a block if the check is slow.',
      devPayFromHub: 'Calls POST /services/bitcoin sendpayment on the Hub’s bitcoind, then claims with the returned txid.',
      pasteTxidLabel,
      txidPlaceholder: 'Transaction ID',
      claim: 'Confirm payment and unlock',
      claimFailed: 'Could not unlock the document. If you just paid, wait for the payment to confirm, then try again.',
      claimFailedAfterPay: 'Payment sent, but the document is not unlocked yet. Wait for the payment to confirm, then choose Confirm payment and unlock.',
      invoiceFailed: 'Could not create a payment request for this document. Try again.',
      invoiceTimeout: 'The Hub did not send a payment request in time. Check that Bitcoin is running and that the document is published with a price, then close this window and try again.',
      unavailable: 'This Hub cannot complete purchases.'
    },
    payment: {
      needSigning: (hint) => `${hint} Paying from this browser needs your signing key.`,
      needsToken: 'Paying from the Hub wallet needs the admin token. Add it under Settings → Admin.',
      invalidInvoice: 'The invoice is missing an address or amount. Request a new one.',
      noTxid: 'The Hub wallet did not return a transaction ID. Check the wallet balance, then try again.'
    },
    contract: {
      loadFailed: 'Could not load the storage contract.',
      txLoadFailed: 'Could not load the payment transaction.',
      txNotFound: 'This Hub has not seen the payment transaction yet.'
    },
    contents: {
      title: 'Contents',
      preview: 'Preview',
      dotSource: 'Graph source (DOT)',
      noPreview: 'No preview for this file type. Download it to open it in another app.',
      decrypt: 'Decrypt and show',
      encryptedWithKey: 'This document is encrypted. Choose Decrypt and show above to view it.',
      encryptedNoKey: (hint) => `This document is encrypted. ${hint}`
    }
  },

  hostingOffers: {
    title: 'Hosting offers',
    pendingCount: (n) => `${n.toLocaleString()} pending`,
    paidCount: (n) => `${n.toLocaleString()} paid`,
    summary: 'Peers can pay you to host their files. Accept an offer to send the peer a payment address; once they pay, a storage contract starts.',
    externalTitle: 'Signing happens outside this browser',
    externalBody: 'This browser has no Fabric private key, so storage contract requests go to the Hub without its signature. Approve any signing prompts in the desktop app. On a shared computer, end the session under',
    securityLink: 'Security & delegation',
    from: (who) => `From ${who}`,
    unknownSender: 'an unknown peer',
    accept: 'Accept',
    decline: 'Decline',
    acceptFailed: 'Could not accept this offer. Try again.',
    bondFailed: 'Could not create the storage contract. Check the transaction ID, then try again.',
    invoiceSentTitle: 'Payment address sent to the peer',
    address: 'Address:',
    amount: 'Amount:',
    txidHint: 'When the peer pays, paste the transaction ID here.',
    txidLabel: 'Transaction ID',
    txidPlaceholder: '64-character transaction ID',
    confirm: 'Confirm payment and start contract',
    paidTitle: 'Paid offers',
    paidSummary: 'These offers are paid and their storage contracts are active.',
    paidListLabel: 'Paid hosting offers',
    paid: 'Paid',
    viewContract: 'View contract',
    empty: 'No hosting offers yet.'
  },

  graphPreview: {
    rendering: 'Rendering graph…',
    errorTitle: 'Graph preview',
    unavailable: 'Graph preview is not available in this build. Download the file to view it.',
    empty: 'Could not draw this graph. The layout came back empty.',
    failed: 'Could not draw this graph. Check the graph source for errors.',
    retry: common.actions.retry,
    alt: 'Graph diagram'
  },

  fileBrowser: {
    defaultTitle: 'Downloads',
    loading: 'Loading files…',
    errorTitle: 'Could not load downloads',
    loadFailed: (status) => `Could not load the list of downloads (${status ? `HTTP ${status}` : 'network error'}). Refresh the page to try again.`,
    errorFallback: 'Could not load the list of downloads. Refresh the page to try again.',
    backToFolder: 'Back to folder',
    parentFolder: 'Parent folder',
    emptyTitle: 'No files here yet',
    emptyBody: 'Desktop installers appear here once they are built. Refresh this page after the build finishes.',
    devBuild: 'Build installers with',
    devBuildOr: 'or',
    devBuildOutput: 'Files are copied into',
    name: 'Name',
    size: 'Size'
  },

  pagination: {
    firstPage: 'First page',
    lastPage: 'Last page'
  }
};
