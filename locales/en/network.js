'use strict';

const { plural, sats } = require('./common');

const explorerOff = 'Turn on Bitcoin block and transaction pages under Settings → Admin → Feature visibility to open this transaction.';
const range = (from, to, total) => `Showing ${from}–${to} of ${total}`;

module.exports = {
  explorerOff,
  range,
  dotSource: 'Graph source (DOT)',

  peerList: {
    home: 'Home',
    title: 'Peers',
    intro: 'Peers are other Fabric nodes this Hub talks to. Each one has a Fabric Peer ID: the public key it signs every message with, so you can tell who a message really came from. Browsers can also join through this Hub and connect to each other directly.',
    introDeveloper: 'The Fabric Peer ID is a compressed secp256k1 public key, often shown in bech32m form (id1…). Signed P2P Message frames bind to that key; TCP sessions and inventory relay use the same ID once it is confirmed on the wire (Verified ID). Browser rows show the Hub signaling ID until the peer proves its key (ID not yet verified). The Address column uses identity@host:port: the TCP listen address, or the WebRTC signaling host.',
    loading: 'Connecting to the Hub and loading network status…',
    selfLabel: 'This Hub',

    self: {
      heading: 'This Hub',
      online: 'Online',
      paused: 'Paused',
      offline: 'Offline',
      state: 'Network state:',
      stateUnknown: 'unknown',
      pausedHint: 'The Hub is reachable, but peer-to-peer networking is paused until it starts.',
      peerId: 'Fabric Peer ID',
      peerIdTitle: 'The public key this Hub signs its messages with.',
      legacyId: 'Node ID (older format)',
      legacyIdTitle: 'This ID can change. Update the Hub to get a stable Fabric Peer ID.',
      legacyIdNote: 'This Hub runs an older version, so this ID can change. Update the Hub before you share it.',
      listen: 'Listening on',
      copyAddress: 'Copy connection address',
      copyAddressTitle: 'Copy this Hub’s address (public key@host:port) so another Fabric node can connect to it.',
      copied: 'Connection address copied.'
    },

    chain: {
      heading: 'Bitcoin chain',
      height: 'Block height',
      tip: 'Latest block',
      tipExplorerOff: (hash) => `${hash}. Turn on Bitcoin explorer pages under Settings → Admin → Feature visibility to open it.`,
      network: 'Network:',
      mempool: 'Mempool:',
      mempoolCount: (n) => plural(n, 'transaction'),
      inView: 'Peers in view:',
      inViewCount: (n) => `${n} (direct and browser)`,
      relayHeading: 'Block relay',
      relayBody: 'When this Hub sees a new Bitcoin block, it signs a short notice and sends it to its peers, who pass it on. Compare the block height and latest block with your peers to check that you are on the same chain.',
      relayDeveloper: 'On a new tip (ZMQ hashblock) this Hub signs BitcoinBlock P2P messages; peers relay the same wire bytes and drop duplicates. Compare height and tip after addnode or long regtest chains.',
      operatorHint: 'Operators: add the admin token under Settings → Admin to reset the chain on trusted peers from this page.'
    },

    flush: {
      heading: 'Reset chain on trusted peers',
      warning: 'This asks every connected peer with a high trust score to roll its Bitcoin chain back to the block you enter. Use it only on regtest, playnet, signet, or testnet, and only when the other operators expect it.',
      developer: 'Sends a signed P2P_FLUSH_CHAIN to every connected peer whose registry score is above the Hub threshold (default 800). Peers that accept it may rewind toward snapshotBlockHash with invalidateblock.',
      toastHeader: 'Reset chain',
      invalidHash: 'Enter the block hash as 64 hexadecimal characters.',
      sent: 'Reset request sent. Check the Hub logs and each peer’s Bitcoin node.',
      hashLabel: 'Known-good block hash',
      hashPlaceholder: '64-character block hash',
      networkLabel: 'Network',
      labelLabel: 'Log label (optional)',
      labelPlaceholder: 'For example, round-3-baseline',
      useTip: 'Use latest block',
      useTipTitle: 'Fill in the latest block this Hub knows about',
      noTipTitle: 'This Hub has not reported a latest block yet',
      send: 'Send reset request'
    },

    primary: {
      heading: 'Primary Hub',
      body: 'Pick a long-running Hub you trust as your primary peer. It relays new Bitcoin blocks and helps rate other peers. The public Fabric Hub is the default.',
      payjoin: 'Payjoin: this Hub supports BIP 78 deposit sessions. The full Payjoin v2 (BIP 77) directory flow is planned.',
      payjoinLink: 'How Payjoin v2 works',
      payjoinDeveloper: 'Deposit sessions use an absolute pj= URL where enabled. Experimental Hub-local BIP 77 mailboxes are listed under the fabricProtocol capability. The v2 directory with HPKE and OHTTP is not integrated yet.',
      coinsHeading: 'Regtest coins from another Hub',
      coinsBefore: 'Peers do not move Bitcoin. On playnet, if your own',
      coinsFaucet: 'faucet',
      coinsMiddle: 'is empty, connect your Bitcoin node to the others (see',
      coinsBitcoin: 'Bitcoin',
      coinsAfterBitcoin: '→ Network), then ask a Hub that still has funds, such as',
      coinsAfter: 'Use the same receive address shown on your Faucet page.',
      addPrimary: (address) => `Add primary Hub (${address})`,
      addPrimaryTitle: 'Save as your primary peer and connect to it',
      addRelay: (address) => `Add relay (${address})`,
      addRelayTitle: 'Connect to the relay',
      saved: 'Saved primary:',
      savedNote: 'It is starred in the peer list.'
    },

    mesh: {
      heading: 'Browser peers (WebRTC)',
      registered: (n) => `${n} registered`,
      onHub: (n) => `${n} on this Hub`,
      onHubTitle: 'Browsers registered with this Hub. Some may also be linked to this browser.',
      local: (n) => `${n} linked to this browser`,
      yourId: 'Your browser ID:',
      starting: 'Starting…',
      connected: 'Connected:',
      connectedCount: (connected, max) => `${connected} of ${max}`,
      connecting: (n) => `, ${n} connecting`,
      ready: 'Ready:',
      intro: 'Browsers connect to each other directly and use this Hub to find one another. Once a browser proves its Fabric Peer ID, it shows in the peer list under that ID.',
      republish: 'Republish offer',
      republishTitle: 'Announce this browser to the Hub again',
      discover: 'Discover peers',
      discoverTitle: (n) => `Look for browsers to fill ${plural(n, 'free slot')}`,
      slotsFree: (n) => `${plural(n, 'slot')} free`,
      connectById: 'Connect by browser ID…',
      connectByIdTitle: 'Connect to a browser using the ID it registered with this Hub',
      ping: 'Ping browsers',
      pingTitle: 'Send a test ping to every connected browser',
      disconnectAll: 'Disconnect all',
      disconnectAllTitle: 'Disconnect every browser linked to this one',
      note: 'Browser peers appear in the list below with a Browser tag and a trust score. A browser that sends oversized or invalid messages is disconnected automatically.'
    },

    topology: {
      heading: 'Peer topology',
      description: 'Solid lines are peers this Hub is connected to. Dotted lines are peers that other peers reported in about the last 20 minutes. To reach one of those directly, add it as a peer. To ask it for documents, open a connected peer and use Request documents.'
    },

    table: {
      heading: 'Fabric peers',
      inView: (n) => `${n} in view`,
      counts: (direct, browser) => `${plural(direct, 'direct peer')} · ${plural(browser, 'browser peer')}`,
      localOnly: (n) => ` · ${n} linked only to this browser`,
      refreshTitle: 'Refresh the peer list',
      add: 'Add peer',
      emptyBefore: 'No peers yet. When it starts, the Hub connects to its default peers,',
      emptyAnd: 'and',
      emptyAfter: '. Use Add peer to connect to another Fabric node (port 7777). Browsers that join through this Hub also appear here.',
      columns: {
        id: 'Fabric Peer ID',
        address: 'Address',
        status: 'Status',
        bytes: 'Received / sent',
        window: 'Last 10 min / limit',
        windowTitle: 'Data used in the last 10 minutes compared with this peer’s fair share: 1 MiB every 10 minutes, the size of a Bitcoin block, split across 32 peers.',
        seen: 'Last seen',
        actions: 'Actions'
      },
      tags: {
        browser: 'Browser',
        primary: 'Primary',
        verified: 'Verified ID',
        unverified: 'ID not yet verified',
        documents: (n) => plural(n, 'document'),
        trust: (n) => `Trust ${n}`,
        warnings: (n) => plural(n, 'warning')
      },
      icons: {
        browser: 'Browser peer (WebRTC)',
        primary: 'Primary peer',
        verified: 'Fabric Peer ID verified',
        documents: (n) => `Offers ${plural(n, 'document')}`
      },
      status: {
        online: 'Online',
        offline: 'Offline',
        connecting: 'Connecting'
      },
      nicknameTitle: (alias, nickname) => `${alias} (your nickname: ${nickname})`,
      windowCellTitle: (budget) => `Last 10 minutes compared with a ${budget} fair share`,
      windowCellTitleDefault: 'Fair share: 1 MiB every 10 minutes, split across 32 peers',
      disconnectBrowser: 'Disconnect browser peer',
      resync: 'Resync with this peer',
      note: 'Received and sent count the data on each direct connection. The 10-minute limit is a fair share of Bitcoin block bandwidth: 1 MiB every 10 minutes, split across 32 peers (about 32 KiB each). Select a column heading to sort.'
    },

    addModal: {
      title: 'Add peer',
      intro: 'Enter the address of a Fabric node. The default port is 7777. You can paste a full URL.',
      label: 'Peer address',
      placeholder: 'host:port, for example hub.fabric.pub:7777',
      invalid: 'Enter a host or host:port, for example hub.fabric.pub or 127.0.0.1:7777.',
      submit: 'Add peer'
    },

    connectModal: {
      title: 'Connect to a browser',
      intro: 'Enter the ID the other browser registered with this Hub. It starts with fabric-bridge-. After it connects, its messages are listed under its Fabric Peer ID once it proves it.',
      label: 'Browser ID',
      submit: 'Connect'
    },

    footer: {
      heading: 'How peers are verified:',
      body: 'Every Fabric message is signed with the sender’s key and carries a hash of its contents, so changes on the way are detected. A peer’s connection and documents are shown under its Fabric Peer ID once the Hub confirms it.',
      developer: 'Messages are secp256k1-signed envelopes; the header hash is the double SHA-256 of the body. See fabric/docs/MESSAGE_SECURITY.md in the Fabric repository.'
    }
  },

  peerView: {
    back: 'All peers',
    fallbackTitle: 'Peer',
    status: {
      label: 'Status',
      publicKey: 'Public key, not a peer',
      publicKeyTitle: 'An extended public key (BIP32), not a network connection',
      browser: 'Browser peer',
      browserTitle: 'Registered with this Hub for browser connections. No direct connection details yet.',
      resolving: 'Looking up this peer…',
      resolvingTitle: 'Waiting for the Hub to send details for this peer',
      connected: 'Connected',
      disconnected: 'Not connected'
    },
    browserTag: 'Browser',
    publicKeyPrefix: 'Public key',
    actions: {
      refresh: 'Refresh peer details',
      reconnect: (address) => `Reconnect to ${address}`,
      disconnect: 'Disconnect this peer',
      resync: 'Resync chain with this peer',
      nickname: 'Set nickname',
      addContact: 'Add to contacts'
    },
    advanced: {
      title: 'Documents, payments, and invites (advanced)',
      relayLabel: 'Relay to seller (optional)',
      relayPlaceholder: 'Seller’s Fabric Peer ID',
      relayTitle: 'If this peer only relays for someone else, enter the seller’s Fabric Peer ID so the request is passed on.',
      requestDocuments: 'Request documents',
      requestDocumentsTitle: 'Ask this peer which documents it offers',
      requestWithHtlc: 'Request documents (HTLC)',
      requestWithHtlcTitle: 'Ask for documents with a Bitcoin payment lock (HTLC) on priced items. Your key is the refund path.',
      contractLabel: 'Execution contract ID (optional)',
      contractTitle: 'Include an execution contract from the Contracts page in the invite.',
      invite: 'Invite',
      inviteTitle: 'Invite this peer to a federation or execution contract (admin)'
    },
    invite: {
      failed: 'Could not send the invite. Check the contract ID, then try again.',
      sent: (shortId) => `Invite sent (${shortId}…).`,
      sentPlain: 'Invite sent.',
      modalTitle: 'Invite peer to a contract',
      noteLabel: 'Message to the peer (optional)',
      send: 'Send invite'
    },
    contact: {
      noToken: 'Add the Hub admin token under Settings → Admin to save contacts.',
      noPeerId: 'This peer has not shared a Fabric Peer ID yet.',
      notReady: 'Still connecting to the Hub. Try again in a moment.',
      failed: 'Could not add this contact. Try again.',
      added: 'Added to your Collaboration contacts.',
      open: 'Open Collaboration'
    },
    rpc: {
      unreadable: 'The Hub sent an unreadable reply. Check that it is running, then try again.',
      http: (status) => `The Hub returned an error (HTTP ${status}). Try again.`
    },
    tabs: {
      overview: 'Overview',
      chat: (n) => (n > 0 ? `Chat (${n})` : 'Chat'),
      documents: (n) => (n > 0 ? `Documents (${n})` : 'Documents')
    },
    details: {
      connection: 'Connection address',
      copy: 'Copy address',
      copyTitle: 'Copy the public key@host:port address so a Fabric node can connect',
      signalingNote: 'Browsers reach this peer through this Hub. Fabric nodes connect directly when the peer shares a direct address.',
      directNote: 'Fabric nodes can connect with this address.',
      peerId: 'Peer ID',
      publicKey: 'Public key',
      address: 'Address',
      nickname: 'Nickname (only on this Hub)',
      alias: 'Name it shares',
      trust: 'Trust score',
      data: 'Data',
      dataTotals: (received, sent) => `${received} received, ${sent} sent`,
      dataWindow: (used, budget) => `Last 10 min: ${used} of ${budget} fair share`,
      firstSeen: 'First seen',
      lastSeen: 'Last seen',
      socket: 'Connection',
      socketConnected: 'Connected',
      lastMessage: (when) => `last message ${when}`,
      failures: (n) => plural(n, 'failed attempt')
    },
    neighbors: {
      heading: 'Peers it knows about',
      description: 'Other Fabric nodes this peer reported. To ask one of them for documents through this peer, select Use as relay, then Request documents in the advanced panel.',
      openTitle: 'Open peer details',
      useAsRelay: 'Use as relay',
      useAsRelayTitle: 'Send document requests for this peer through the one you are viewing'
    },
    publicKeyRoute: {
      heading: 'This is a public key, not a peer',
      bodyBefore: 'This link uses an extended public key (xpub or tpub), often the sender shown on an activity. Chat and documents need a connected Fabric node. Open',
      peersLink: 'Peers',
      bodyAfter: 'to find one.'
    },
    waiting: {
      heading: 'No details yet',
      bodyBefore: 'The Hub has not sent anything about this peer yet. Select Refresh, or open',
      peersLink: 'Peers',
      bodyAfter: 'and add its address. Details appear here when the Hub answers.',
      slowHeading: 'Still waiting',
      slowBody: 'Check that this browser is connected to the Hub. Add the peer from the Peers page, then open this link again.'
    },
    chat: {
      heading: 'Chat',
      lockedHeading: 'Identity locked',
      watchOnlyHeading: 'Watch-only identity',
      noIdentityHeading: 'No identity',
      received: 'Messages you receive still appear here.',
      offline: 'This peer is offline. Messages are queued and sent when it reconnects.',
      sending: 'sending…',
      queuedTitle: 'This message will be sent when the peer is online.',
      unknownSender: 'unknown',
      empty: 'No messages with this peer yet.',
      placeholder: 'Type a message…',
      placeholderLocked: 'Unlock your identity to send messages',
      placeholderWatchOnly: 'Import your full key to send messages',
      placeholderNoIdentity: 'Log in to send messages',
      sendTitle: (destination) => `Send to ${destination} through the Hub`
    },
    documents: {
      heading: 'Documents this peer offers',
      introBefore: 'Documents published by this peer',
      introAfter: 'Author shows where a document came from, when known. While the peer is connected, open the advanced panel and select Request documents to get its latest list.',
      lastRequest: (when) => `Last request: ${when}`,
      viaHttp: 'sent over HTTP',
      viaWebSocket: 'sent over WebSocket',
      accepted: 'The Hub passed the request to the peer.',
      received: (n) => `${plural(n, 'document')} received.`,
      none: 'Nothing received yet. Wait for a reply, or check the relay target.',
      rawToggle: 'Show raw document list (JSON)',
      fallbackName: 'Document',
      id: 'ID:',
      author: 'author',
      size: (n) => `${(Number(n) || 0).toLocaleString()} bytes`,
      published: 'published',
      empty: 'This peer has not shared a document list yet. While it is connected, use Request documents in the advanced panel.'
    },
    htlc: {
      verifiedHeading: 'Payment verified. The document is on its way.',
      heading: 'Payment check',
      funded: 'Payment accepted. If the document does not arrive, check the connection and try again.',
      document: 'Document',
      transaction: 'Transaction',
      unconfirmed: 'waiting for confirmation',
      tag: 'Payment lock (HTLC)',
      qrAlt: 'QR code to pay with a Bitcoin wallet',
      copyLink: 'Copy payment link',
      copyAddress: 'Copy address',
      payNow: 'Pay now',
      payNowTitle: 'Open the payment link in your Bitcoin wallet',
      payFromHub: 'Pay from Hub wallet',
      payFromHubTitle: 'Pay from this Hub’s Bitcoin wallet (needs the admin token)',
      hubSent: 'The Hub wallet sent the payment. The transaction ID is filled in below; select Confirm payment when you are ready.',
      noTxid: 'The Hub wallet did not return a transaction ID. Check its balance, then try again.',
      hashLine: (hash, height) => `Payment hash ${hash}… · refund after block ${height}`,
      txidLabel: 'Funding transaction ID',
      confirm: 'Confirm payment and receive',
      viewTx: 'View funding transaction'
    },
    nicknameModal: {
      title: 'Set nickname',
      label: 'Nickname (only on this Hub)',
      save: 'Save nickname'
    }
  },

  contractsHome: {
    home: 'Home',
    title: 'Contracts',
    refreshTitle: 'Reload all contract lists',
    intro: 'Contracts are agreements this Hub keeps track of: application contracts that other nodes publish, paid storage for documents, programs anyone can run and check, Taproot crowdfunds, and Lightning channels. When Bitcoin is running, the payments behind them are checked on-chain.',
    sectionsLabel: 'Contract sections',
    sections: {
      application: 'Application',
      storage: 'Storage',
      execution: 'Execution',
      crowdfunds: 'Crowdfunds',
      lightning: 'Lightning',
      beacon: 'Beacon Federation'
    },
    summary: {
      application: 'Application: see below',
      storage: (n) => `Storage: ${n}`,
      execution: (n) => `Execution: ${n}`,
      crowdfunds: (n) => `Crowdfunds: ${n}`,
      channels: (n) => `Channels: ${n}`,
      pending: '…'
    },
    loading: {
      heading: 'Loading contracts…',
      body: (lightning) => `Fetching storage contracts, programs, and crowdfunds${lightning ? ', and Lightning channels' : ''}. Each section fills in as its list arrives.`
    },
    error: {
      heading: 'Could not load contracts',
      fallback: 'Could not load contracts. Check that the Hub is running, then try again.',
      unreadable: 'The Hub sent an unreadable contract list. Try again.'
    },
    application: {
      heading: 'Application contracts',
      infoHeading: 'Namespaces tracked by the Beacon',
      bodyBefore: 'Other nodes can publish application contracts to this Hub. They wait here until an operator accepts them. Accepted contracts are included in the next Beacon checkpoint and can get their own sidechain. Manage co-signing and the federation vault on',
      beaconLink: 'Beacon Federation',
      developer: 'Inbound CONTRACT_PUBLISH offers become pending application contracts. Accepting one adds it to the Beacon contracts.stateDigest for the next epoch and can provision a contract-namespace sidechain.'
    },
    crowdfunds: {
      heading: 'Crowdfunds',
      infoHeading: 'Campaigns on this Hub',
      bodyBefore: 'Crowdfunds collect Bitcoin into a Taproot vault on this Hub. They are listed here next to the other contracts. To manage a campaign, including pledges, Payjoin, payout, and refunds, open',
      link: 'Crowdfunds',
      linkOff: 'Crowdfunds (turn on Bitcoin — Crowdfund under Settings → Admin → Feature visibility)',
      fallbackTitle: 'Campaign',
      tag: 'Crowdfund',
      idTitle: 'Campaign ID',
      vault: 'Vault',
      vaultPending: 'Vault address pending',
      goal: (amount) => `· goal ${sats(amount)}`,
      empty: 'No crowdfunds on this Hub yet.',
      emptyOpen: 'Open',
      emptyOpenAfter: 'to create one.',
      emptyOff: 'Turn on Bitcoin — Crowdfund under Settings → Admin → Feature visibility to add one.'
    },
    storage: {
      heading: 'Storage contracts',
      infoHeading: 'Paid document storage',
      body: 'A storage contract is created after someone pays to keep copies of a document on the network. The payment is checked on Bitcoin before the contract is recorded.',
      flowLabel: 'Steps:',
      flowSteps: 'request a hosting invoice, pay it on Bitcoin, then the Hub records the storage contract.',
      flowRpc: 'Hub methods:',
      flowPay: 'pay',
      developer: 'Execution contracts use an L1 registry fee when Bitcoin is enabled; after publishing you can run them on the Hub and, on regtest, anchor the run commitment (OP_RETURN) with the admin token from the contract page.',
      filterLabel: 'Show:',
      filters: {
        all: 'All',
        new: 'New',
        newTitle: 'First copy stored',
        partial: 'Partly stored',
        partialTitle: 'Some copies stored, not all',
        complete: 'Fully stored',
        completeTitle: 'All requested copies stored'
      },
      tag: 'Storage',
      copies: (accepted, desired) => `${accepted} of ${desired} copies`,
      document: (id) => `Document ${id}`,
      documentFallback: 'Document storage contract',
      transaction: 'Transaction',
      emptyAll: 'No contracts on this Hub yet.',
      empty: {
        all: 'No storage contracts yet.',
        new: 'No new storage contracts.',
        partial: 'No partly stored contracts.',
        complete: 'No fully stored contracts.'
      }
    },
    execution: {
      heading: 'Execution contracts',
      description: 'An execution contract is a small program stored on this Hub. Anyone can run it here or in their own browser and compare the results. When Bitcoin is running, publishing costs a small on-chain fee. Without Bitcoin, for local development, publishing is free.',
      descriptionDeveloper: 'With Bitcoin available, publishing calls CreateExecutionRegistryInvoice for an address, then CreateExecutionContract with the funding txid, over POST /services/rpc (the same surface as Run on Hub on the contract page).',
      checksHeading: 'How runs are checked',
      checksBody: 'Each run produces a fingerprint of every step. If your browser gets the same fingerprint as the Hub, the run is the same. On regtest you can record that fingerprint in a Bitcoin transaction. The Beacon ties the Hub’s state to Bitcoin blocks; the federation panel below shows its policy and live data.',
      checksDeveloper: 'The registry ties a programDigest to an on-chain payment. Runs produce a runCommitmentHex that anyone can recompute; regtest can anchor it with OP_RETURN. Beacon epochs record Bitcoin block hash and height, and sidechain state advances by patches and follows L1 reorgs.',
      checkingHeading: 'Checking Bitcoin…',
      checkingBody: 'Finding out whether publishing needs an on-chain payment.',
      paidHeading: 'Publishing needs a Bitcoin payment',
      paidBefore: 'Select Request registry invoice, pay it (for example from',
      paymentsLink: 'Payments',
      paymentsOff: 'Payments, after turning on Bitcoin — Payments under Settings → Admin → Feature visibility',
      paidAfter: 'on regtest with the admin token), then paste the transaction ID and select Publish to registry.',
      noAdmin: 'This browser does not have the admin token, so it cannot pay from the Hub wallet. Pay from another wallet, or add the admin token under Settings → Admin.',
      noBitcoinHeading: 'No Bitcoin service',
      noBitcoinBody: 'Bitcoin is not available on this Hub, so programs are published without a payment.',
      steps: {
        program: 'Program',
        programDescription: 'Edit the JSON, then request an invoice',
        pay: 'Pay',
        payDescription: 'Pay the registry address',
        publish: 'Publish',
        publishDescription: 'Send the transaction ID to the Hub'
      },
      fields: {
        name: 'Name (optional)',
        namePlaceholder: 'For example, Ping test',
        program: 'Program (JSON)',
        fee: 'Registry fee (sats)',
        txid: 'Funding transaction ID (after you pay)',
        txidPlaceholder: '64-character transaction ID'
      },
      invoice: {
        heading: 'Registry invoice',
        body: 'Pay at least this amount to the Hub address below, then paste the transaction ID.',
        payAtLeast: (amount) => `Pay at least ${sats(amount)} to`,
        network: (name) => `(network: ${name})`,
        copy: 'Copy address',
        digest: 'Program fingerprint:',
        digestNote: 'If you change the program after this, request a new invoice so the fingerprint still matches.'
      },
      requestInvoice: 'Request registry invoice',
      waitTitle: 'Wait until Bitcoin status is known',
      publish: 'Publish to registry',
      reset: 'Reset program',
      feedback: {
        stillChecking: 'Still checking Bitcoin. Try again in a moment.',
        stillCheckingPublish: 'Still checking Bitcoin. Wait a moment, then publish.',
        badJson: 'The program is not valid JSON. Fix it, or select Reset program.',
        badFee: 'Enter a registry fee above 0 sats.',
        invoiceHint: 'Check that the Hub is reachable and Bitcoin is running.',
        invoiceRejected: 'The Hub could not create a registry invoice. Try again.',
        invoiceUnexpected: 'The Hub sent an unexpected reply to the invoice request. Try again.',
        needInvoice: 'Request a registry invoice first, pay it, then enter the transaction ID.',
        needTxid: 'Enter the ID of the Bitcoin transaction that pays the registry invoice.',
        publishHint: 'Check that this page can reach the Hub, then try again.',
        publishRejected: 'The Hub did not publish the program.',
        payBefore: 'Pay from',
        payAfter: '(regtest, needs the admin token) or another wallet, then paste the transaction ID and publish again.',
        payOff: 'Pay from another wallet, or turn on Bitcoin — Payments under Settings → Admin → Feature visibility, then paste the transaction ID and publish again.',
        digestHint: 'If you changed the program after requesting the invoice, request a new invoice so they match.',
        published: 'Program published to the Hub registry.',
        openIt: 'Open it',
        toRun: 'to run it on the Hub.',
        unexpected: 'The Hub sent an unexpected reply. Try again.'
      },
      list: {
        steps: (n) => plural(n, 'step'),
        programFallback: 'Program',
        tag: 'Execution',
        open: 'Open',
        openTitle: 'Open to run it in your browser or on the Hub',
        transactionTitle: 'Open the registry payment on this Hub',
        empty: 'No execution contracts on this Hub yet. Publish one with the form above.'
      }
    },
    lightning: {
      heading: 'Lightning channels',
      manage: 'Manage',
      manageTitle: 'Open the Bitcoin and Lightning dashboard',
      empty: 'No Lightning channels yet. Open one from the Bitcoin page.',
      columns: {
        peer: 'Peer',
        state: 'State',
        capacity: 'Capacity',
        balance: 'Our balance',
        shortId: 'Short channel ID'
      }
    }
  },

  contractView: {
    back: 'All contracts',
    title: 'Contract',
    storageTag: 'Storage',
    executionTag: 'Execution',
    loading: 'Loading contract…',
    error: {
      heading: 'Could not load contract',
      fallback: 'Could not load this contract. Check that the Hub is running, then try again.',
      hint: 'If the link is old, the contract may no longer exist. Use All contracts above to find it.'
    },
    empty: 'This contract has no data. It may no longer exist. Use All contracts above to find another.',
    graph: {
      heading: 'Contract diagram',
      description: 'A diagram of this contract built from the details on this page. It shows nothing that is not already here.',
      none: 'No diagram is available for this program. You can still run it below.'
    },
    about: {
      heading: 'How execution contracts work',
      intro: 'Peers can agree on a program, check that each run gives the same result, and tie the Hub’s state to Bitcoin:',
      registryLabel: 'Registry:',
      registry: 'When Bitcoin is running, a program is published only after an on-chain payment for its exact contents.',
      runLabel: 'Run check:',
      run: 'The Hub returns a fingerprint of each run. Running it in your browser should give the same fingerprint; a difference means the inputs or code differ.',
      checkpointLabel: 'Bitcoin checkpoint (regtest):',
      checkpoint: 'After a successful run on the Hub, an operator can record the fingerprint in a Bitcoin transaction from the Hub wallet.',
      federationLabel: 'Federation:',
      federationBefore: 'Sidechain updates and Beacon checkpoints need signatures from the signer set on',
      federationLink: 'Beacon Federation',
      federationAfter: '. It does not apply to publishing or running programs.',
      developer: 'Registry: an L1 payment to the Hub invoice for a fixed programDigest before CreateExecutionContract accepts the publish. Run: the Hub interpreter returns runCommitmentHex, the hash of the canonical trace. Checkpoint: OP_RETURN of that digest from the Hub wallet. Federation: enforced only for SubmitSidechainStatePatch and Beacon epoch federationWitness fields.'
    },
    registry: {
      heading: 'Paid on Bitcoin',
      body: 'This program was published with a verified on-chain payment to the Hub’s invoice address.',
      checkingHeading: 'Checking the registry payment…',
      checkingBody: 'Comparing the Bitcoin transaction with the registry invoice.',
      verified: 'Registry payment confirmed on Bitcoin',
      failed: 'Payment check did not pass',
      failedBody: 'Check the funding transaction. The Hub may still list the contract if it could not check the payment just now.'
    },
    tx: {
      loadFailed: 'Could not load the transaction.',
      notFound: 'This Hub has no record of the transaction.'
    },
    verifiedBody: (amount, confirmations, inMempool) => `At least ${sats(amount)} reached the invoice address. Confirmations: ${confirmations != null ? confirmations : 'none yet'}${inMempool ? ' (still waiting in the mempool)' : ''}.`,
    noProgram: {
      heading: 'No program to run',
      body: 'This contract record has no program. It may be an old record or a failed publish. Publish it again from the Contracts page.',
      developer: 'The record has no program object. Check contracts/<id>.json in the Hub store.',
      buttonTitle: 'This contract has no program'
    },
    program: {
      heading: 'Program',
      description: 'Run the program in your browser or on the Hub, then compare the two fingerprints. On regtest you can record a successful Hub run in a Bitcoin transaction.',
      developer: 'Run on Hub calls RunExecutionContract through POST /services/rpc (the same methods as WebSocket JSON-RPC). Compare runCommitmentHex with the browser run.',
      runLocal: 'Run in browser',
      runHub: 'Run on Hub'
    },
    hubRun: {
      errorHeading: 'Could not run on the Hub',
      noProgram: 'This contract has no program, so the Hub cannot run it.',
      failed: 'The Hub could not run the program.',
      empty: 'The Hub sent an empty reply. Try again.',
      hint: 'Check that the Hub is reachable, then try again.',
      unreadable: 'The Hub sent an unreadable reply. Check that it is running, then try again.',
      signingHeading: 'Signing request not created',
      signingBody: 'The run finished, but the Hub did not create a signing request for it. See the raw result below.',
      noFingerprintHeading: 'No run fingerprint',
      noFingerprintBody: 'The Hub returned a result without a fingerprint. It may have failed to compute one.',
      rawHeading: 'Raw Hub result (JSON)',
      traceHeading: 'Steps the Hub ran',
      step: (n, op) => `Step ${n}${op ? ` · ${op}` : ''}`
    },
    localRun: {
      ok: 'Browser run finished',
      failed: 'Browser run failed',
      again: 'Run in browser again'
    },
    fingerprint: {
      heading: 'Run fingerprint',
      notOk: 'This run on the Hub did not finish. The fingerprint is shown for comparison, but it can be recorded on Bitcoin only after a successful run.',
      copy: 'Copy fingerprint',
      compare: 'Select Run in browser to compare this fingerprint with your own run.',
      match: 'Matches your browser run.',
      mismatch: 'Does not match your browser run. Reload the page, then run it in the browser again.',
      checking: 'Checking whether this Hub can record it on regtest…',
      needAdminBefore: 'Add the admin token in this browser to record this on regtest. Open',
      needAdminLink: 'Settings',
      anchor: 'Record on regtest',
      anchorNote: 'Uses the Hub wallet and the admin token. Mine a block first if the wallet is empty.',
      anchorUnavailable: 'Recording a run on Bitcoin works only when this Hub runs Bitcoin on regtest.',
      anchorErrorHeading: 'Could not record the run',
      anchorFailed: 'The Hub could not record the run.',
      anchorHint: 'This needs regtest and the admin token. Check the Hub wallet, then try again.',
      noTxid: 'The Hub did not return a transaction ID.',
      viewAnchor: (shortTxid) => `View transaction ${shortTxid}…`
    },
    table: {
      id: 'ID',
      name: 'Name',
      validatedSteps: 'Checked steps',
      digest: 'Program fingerprint',
      registryInvoice: 'Registry invoice address',
      invoiceAmount: 'Invoice amount',
      registryTx: 'Registry payment',
      unconfirmed: 'Unconfirmed',
      confirmations: (n) => plural(n, 'confirmation'),
      statusUnknown: 'Status unknown',
      created: 'Created',
      program: 'Program',
      noProgram: 'This record has no program.'
    },
    storage: {
      heading: 'Details',
      bondHeading: 'Paid on Bitcoin',
      bondBody: 'This contract records the invoice address and amount the Hub checked before storing the document. The check below runs again against Bitcoin.',
      bondDeveloper: 'The CreateDistributeInvoice destination and amount checked when CreateStorageContract ran. The check repeats GET /services/bitcoin/transactions/:txid?address=&amountSats=.',
      checkingHeading: 'Checking the storage payment…',
      checkingBody: 'Comparing the Bitcoin transaction with the storage invoice.',
      verified: 'Storage payment confirmed on Bitcoin',
      failed: 'Payment check did not pass',
      failedBody: 'Check the payment transaction. Older contracts may not have invoice details; the payment link below still works when it is there.',
      legacyHeading: 'Older storage contract',
      legacyBody: 'This contract was created before invoice details were saved, so it cannot be checked automatically. Use the payment link to check it yourself.',
      invoice: 'Storage invoice address',
      invoiceAmount: 'Invoice amount',
      document: 'Document',
      viewDocument: 'View',
      payment: 'Payment',
      amount: 'Amount',
      copies: 'Copies requested',
      duration: 'Duration',
      years: (n) => plural(n, 'year'),
      cadence: 'Proof check schedule',
      deadline: 'Proof deadline',
      created: 'Created'
    }
  },

  collaboration: {
    noToken: {
      heading: 'Admin token required',
      bodyBefore: 'Collaboration needs the Hub admin token from first-time setup. Add it under',
      link: 'Settings → Admin',
      bodyAfter: ', then come back.'
    },
    title: 'Collaboration',
    subtitle: 'Contacts, shared-signing groups, and invitations',
    notReady: 'Still connecting to the Hub. Try again in a moment.',
    remove: 'Remove',
    contacts: {
      heading: 'Contacts',
      needEmailOrPeer: 'Enter an email address, a Fabric Peer ID, or both.',
      email: 'Email',
      emailPlaceholder: 'friend@example.com',
      peerId: 'Fabric Peer ID',
      peerIdPlaceholder: 'id1… (see known peers below)',
      publicKey: 'Public key (optional)',
      publicKeyPlaceholder: 'Hex, 64 or 66 characters',
      add: 'Add contact',
      columns: {
        name: 'Name',
        email: 'Email',
        peerId: 'Fabric Peer ID',
        publicKey: 'Public key',
        actions: 'Actions'
      },
      empty: 'No contacts yet.',
      knownPeers: 'Known peers you can paste:',
      noKnownPeers: 'none yet'
    },
    groups: {
      heading: 'Groups',
      intro: 'A group is a set of keys that sign together. When enough members’ keys are known, the group gets a shared Bitcoin address.',
      name: 'Name',
      threshold: 'Signatures needed (m of n)',
      create: 'Create group',
      memberGroup: 'Group ID',
      memberKey: 'Member public key (hex)',
      addMember: 'Add member',
      columns: {
        name: 'Name',
        id: 'ID',
        threshold: 'Signatures needed',
        members: 'Members',
        actions: 'Actions'
      },
      preview: 'Preview',
      empty: 'No groups yet.'
    },
    preview: {
      heading: (groupId) => `Shared address for ${groupId}`,
      readiness: 'Readiness:',
      missing: (n) => `Missing ${plural(n, 'key')}`,
      ready: 'Ready',
      mOfN: (m, n) => `${m} of ${n}`,
      receiveHeading: 'This group can receive funds',
      receiveAddress: 'Taproot receive address:',
      copyAddress: 'Copy receive address',
      copiedAddress: 'Address copied',
      federationHeading: 'Use as federation',
      federationBody: 'This group can serve as your federation’s signer set. Vault address for the same signers:',
      useForFederation: 'Use this group for the federation',
      noValidators: 'This group has no signer keys yet.',
      saveFailed: 'Could not save the federation signers. Try again.',
      saved: (m, n, groupId) => `Federation set to ${m} of ${n} signers from group ${groupId}.`,
      copyValidators: 'Copy signer keys',
      copiedValidators: 'Signer keys copied',
      openFederation: 'Open federation settings'
    },
    invitations: {
      heading: 'Invitations',
      needRecipient: 'Enter an email address, a recipient Fabric Peer ID, or both.',
      email: 'Email (optional)',
      emailPlaceholder: 'invitee@example.com',
      peer: 'Recipient Fabric Peer ID (optional)',
      peerPlaceholder: 'id1…',
      group: 'Group (optional)',
      groupPlaceholder: 'Choose a group',
      noGroup: 'No group',
      groupOption: (name, id) => `${name} (${id})`,
      send: 'Send invitation',
      columns: {
        email: 'Email',
        recipient: 'Recipient peer',
        group: 'Group',
        status: 'Status',
        expires: 'Expires',
        id: 'ID',
        actions: 'Actions'
      },
      status: {
        accepted: 'Accepted',
        declined: 'Declined',
        expired: 'Expired',
        pending: 'Pending'
      },
      empty: 'No invitations yet.'
    },
    handoff: {
      heading: 'Use this group in a contract',
      bodyBefore: 'Use this preview when you write a contract’s signing policy on the',
      link: 'Contracts',
      bodyAfter: 'page.',
      copyPreview: 'Copy preview (JSON)',
      copiedPreview: 'Preview copied',
      copyFingerprint: 'Copy policy fingerprint',
      copiedFingerprint: 'Fingerprint copied',
      copyDescriptor: 'Copy Taproot descriptor',
      copiedDescriptor: 'Descriptor copied'
    }
  },

  collaborationInvite: {
    title: 'Collaboration invitation',
    body: 'A connected peer invited you to collaborate.',
    recipient: (who) => `Recipient: ${who}.`,
    group: (id) => `Group: ${id}.`,
    from: 'From peer:',
    missingAccept: 'This invitation has no accept link. Ask the sender to invite you again.',
    missingDecline: 'This invitation has no decline link. Ask the sender to invite you again.',
    acceptFailed: (status) => `Could not accept the invitation (HTTP ${status}). Try again.`,
    declineFailed: (status) => `Could not decline the invitation (HTTP ${status}). Try again.`,
    accepted: 'Invitation accepted.',
    declined: 'Invitation declined.',
    toastHeader: 'Collaboration',
    accept: 'Accept',
    decline: 'Decline'
  }
};
