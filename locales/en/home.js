'use strict';

const { BRAND_NAME, BRAND_TAGLINE } = require('./brand');
const { plural } = require('./common');

const featureVisibility = 'Admin → Feature visibility';

module.exports = {
  backHome: 'Back to home',
  featureVisibility,
  home: {
    promo: {
      dismiss: 'Dismiss',
      title: `This is a ${BRAND_NAME}`,
      intro: `A ${BRAND_NAME} is your own node on the Fabric network: peer-to-peer messaging, document storage, Bitcoin, and shared multisig vaults, all running on your own hardware.`,
      visiting: 'You are viewing someone else’s Hub. Everything here runs on their node. To own your data and identity, run your own.',
      runYourOwn: 'Run your own Hub',
      desktop: 'Desktop',
      desktopBody: `Download the ${BRAND_NAME} desktop app. One installer sets up the Hub, a Bitcoin node, and the app on macOS, Windows, or Linux.`,
      desktopCta: 'Get the desktop app',
      developer: 'Developer',
      developerBody: 'Clone the repository and run it yourself. The Hub is a Node.js service with a React app, Bitcoin RPC, and Fabric peer-to-peer networking built in.',
      production: 'Production',
      productionBody: 'Deploy on a VPS or home server for always-on peering, document hosting, and Bitcoin services on your LAN or the public internet.',
      github: 'View on GitHub',
      browseDocuments: 'Browse documents',
      explore: 'Explore this Hub'
    },
    health: {
      title: 'Node health',
      refresh: 'Refresh node health',
      loading: 'Loading node health…',
      loadFailed: 'Could not load node health. Check that the Hub is running, then refresh.',
      host: 'Host',
      uptime: 'Hub uptime',
      uptimeTitle: 'Time since the Hub process last started',
      cpu: 'Hub CPU',
      cpuTitle: 'CPU used by the Hub process, averaged across all cores',
      cpuValue: (pct, cores) => `${pct} (${plural(cores, 'core')})`,
      load: 'System load (1, 5, 15 min)',
      loadTitle: 'Average number of processes running or waiting on this machine over the last 1, 5, and 15 minutes. It covers the whole machine, not just the Hub; compare it with the number of CPU cores.',
      memory: 'Hub memory',
      memoryTitle: 'Memory held by the Hub process',
      disk: 'Disk',
      diskValue: (used, total, pct) => `${used} of ${total} used${pct ? ` (${pct})` : ''}`,
      free: 'Free',
      dns: 'DNS',
      dnsTitle: 'Whether this machine can resolve public hostnames',
      services: 'Local services',
      servicesValue: (ok, total) => `${ok} of ${total} reachable`,
      checkedAt: (time) => `Checked ${time}`
    },
    client: {
      title: `${BRAND_NAME} app`,
      body: 'This site serves the Hub app without a Hub behind it. Your identity, keys, and local wallet run in this browser.',
      bodyMesh: 'Documents and public chat come from seed Hubs.',
      identity: 'Identity',
      downloads: 'Downloads',
      settings: 'Settings',
      localWallet: 'Local wallet',
      documents: 'Documents',
      footerMesh: 'Documents lists the files that seed Hubs and mesh peers share.',
      footerMeshDeveloper: 'Add seed origins with FABRIC_HUB_SEEDS in config.local.js.',
      footerNoHub: 'When you have a Hub, enter its address in Settings (the cog in the top bar).'
    },
    loading: {
      preparing: 'Preparing a connection to this Hub.',
      nextStatus: 'Next, the Hub sends its network status: peers, documents, and node ID.',
      bridgeFirst: 'The app has to connect to the Hub before status can load.',
      headerWaitingData: 'Connected. Waiting for Hub data…',
      headerConnecting: 'Connecting to the Hub…',
      headerReconnecting: 'Reconnecting to the Hub…',
      headerDefault: 'Waiting for network status…',
      lead: 'Connecting to the Hub…',
      retry: 'Request status again',
      stuckHint: 'If this does not change, check that the Hub is running and reachable, then try again.'
    },
    network: {
      title: 'Node and network',
      updated: (time) => `Updated ${time}`,
      refresh: 'Refresh network status',
      fabricId: 'Fabric ID',
      listen: 'Listen address',
      contract: 'Contract ID',
      peers: 'Peers',
      peersValue: (connected, known) => `${connected} connected of ${known} known`,
      managePeers: 'Manage peers',
      browserPeers: 'Browser peers',
      browserPeersMesh: (n) => `${n} on the mesh`,
      documents: 'Documents',
      documentsValue: (n) => `${Number(n) || 0} published`,
      copyNodeId: 'Copy node ID',
      copyNodeIdTitle: 'Copy this Hub’s Fabric ID and listen address'
    },
    bitcoin: {
      title: 'Bitcoin',
      available: 'Available',
      network: 'Network',
      height: 'Block height',
      tip: 'Chain tip',
      mempool: 'Mempool',
      mempoolValue: (n, size) => `${plural(n, 'transaction')}${size ? ` (${size})` : ''}`,
      dashboard: 'Bitcoin dashboard',
      lightning: 'Lightning',
      wallet: 'Wallet',
      unavailable: 'Bitcoin is not available on this Hub.'
    },
    quickLinks: {
      title: 'Quick links'
    },
    adminToken: {
      title: 'Admin token not saved',
      before: 'Add the admin token for this Hub in',
      link: 'Settings',
      after: 'to see peer details, full statistics, and operator controls.'
    },
    peersHidden: {
      title: 'Peers are hidden',
      before: 'Turn on Peers under',
      link: featureVisibility
    },
    shoutbox: {
      title: 'Public mesh shoutbox',
      notifications: 'Notifications',
      visitor: 'Messages here are public and unencrypted. Log in to see notifications, activity, and delegation.'
    },
    connect: {
      title: 'Connect to a browser peer',
      peerId: 'Peer ID',
      submit: 'Connect'
    }
  },
  features: {
    title: 'Features',
    intro: `${BRAND_NAME} is ${BRAND_TAGLINE}. Your identity uses standard Bitcoin keys, created and kept in your browser. Documents covers storage: publish, distribute, and encrypt files. Contracts covers execution: deterministic programs with an optional Bitcoin-backed registry.`,
    operatorBefore: 'The',
    operatorBitcoin: 'Bitcoin',
    operatorMiddle: 'dashboard is part of every Hub. Notifications, the activity log, this page, the block explorer, and other areas follow',
    operatorAdmin: 'Admin',
    operatorAfter: '→ Feature visibility. The shortcuts below appear only for areas that are turned on.',
    visitor: 'Log in with a Fabric identity to see operator shortcuts for this Hub.',
    client: 'This site serves the Hub app without a Hub behind it. Downloads, your local wallet, and Settings work here; everything else needs a Hub.',
    security: {
      title: 'Security',
      body: 'A portable identity in your browser using standard Bitcoin keys, a password lock, and end-to-end encrypted documents',
      operatorBefore: ', plus optional desktop signing in',
      link: 'Security & delegation'
    },
    collaboration: {
      title: 'Collaboration',
      body: 'Fabric peers, the browser mesh, chat, and document workflows: publish, distribute, and share encrypted files.',
      sharedBefore: 'Shared',
      sidechainLink: 'sidechain',
      sharedAfter: 'state and',
      sidechainOff: `Shared sidechain state (turn on Sidechain under ${featureVisibility}) and`,
      contractsLink: 'Contracts',
      contractsAfter: '(storage and execution) run on the same Hub.',
      signedOut: 'Contracts and sidechain tools open after you log in on a live Hub.'
    },
    bitcoin: {
      title: 'Bitcoin',
      body: 'Regtest tools, invoices, Payjoin payments, and Lightning when it is turned on. Beacon epochs anchor Hub state to Bitcoin; contract runs produce their own deterministic commitment, separate from Federation signatures',
      seeBefore: '— see',
      beaconLink: 'Beacon Federation',
      sidechainOff: `— turn on Sidechain under ${featureVisibility} to see the Beacon Federation walkthrough.`
    },
    identityButton: (label) => `Identity: ${label}`,
    identityButtonTitle: 'Open the identity manager to create, restore, unlock, or import a key',
    downloads: 'Downloads',
    localWallet: 'Local wallet',
    sidechain: 'Sidechain',
    notificationsTitle: 'Wallet, Payjoin, and Hub alerts (the bell in the top bar)',
    activityLogTitle: 'Hub messages, chat, and Bitcoin blocks',
    beaconTitle: 'Bitcoin-anchored Beacon epochs, the manifest, and Federation signatures',
    federationsTitle: 'Multisig validator policy (k-of-n)',
    lightningTitle: 'Create, decode, and pay Lightning invoices through the Hub',
    explorerTitle: 'Recent blocks and the mempool',
    crowdfundsTitle: 'Taproot campaign vaults, donation PSBTs, and Payjoin to a campaign',
    securityTitle: 'Desktop signing sessions and delegation tokens'
  },
  downloads: {
    title: 'Downloads',
    description: `Desktop installers for the ${BRAND_NAME} app. Open a folder to browse it, or download a file straight from this site.`
  },
  notifications: {
    title: 'Notifications',
    activityLogTitle: 'Hub messages, chat, and Bitcoin blocks',
    securityTitle: 'Desktop signing sessions, delegation tokens, and session history',
    bitcoinTitle: 'Bitcoin dashboard',
    summary: 'Short-lived wallet, Payjoin, and Hub alerts. This is the same list as the bell in the top bar.',
    summaryActivity: 'Hub messages, chat, and Bitcoin blocks are in the activity log.',
    summaryActivityOff: `Hub messages, chat, and Bitcoin blocks are in the activity log; turn on Activities under ${featureVisibility} to open it.`
  },
  inApp: {
    title: 'In-app notifications',
    empty: 'No notifications yet. Wallet, Payjoin, and Hub alerts appear here.',
    intro: 'Wallet, Payjoin, and Hub alerts. Open a link, copy the details, or dismiss them.',
    copy: 'Copy details',
    dismiss: 'Dismiss notification',
    clearAll: 'Clear all'
  },
  activities: {
    title: 'Activities',
    summary: 'Hub messages, chat, Bitcoin blocks, and network events. Wallet, Payjoin, and other short alerts are in Notifications (the bell in the top bar).',
    notificationsTitle: 'Wallet, Payjoin, and Hub alerts (the same list as the bell)',
    securityTitle: 'Desktop signing sessions, delegation tokens, and session history',
    bitcoinTitle: 'Bitcoin dashboard',
    paymentsTitle: 'Payjoin and payments',
    invoicesTitle: 'Create and track invoices',
    resourcesTitle: 'Bitcoin HTTP endpoints and payment verification',
    crowdfundsTitle: 'Taproot campaign vaults',
    filterLabel: 'Filter activity by type',
    show: 'Show',
    filters: {
      all: 'All',
      chat: 'Chat',
      bitcoin: 'Bitcoin',
      documents: 'Documents',
      network: 'Network'
    }
  },
  stream: {
    title: 'Activity stream',
    signingTitle: 'Signing requests',
    olderMessages: (n) => `Scroll up for ${plural(n, 'older message')}`,
    viewTransaction: 'View transaction',
    transactionPagesOff: `Turn on block and transaction pages under ${featureVisibility} to open this transaction.`,
    blockPagesOff: `Turn on block and transaction pages under ${featureVisibility} to open this block.`,
    purge: 'Remove from activity log',
    purgeTitle: 'Remove this entry from the Hub activity log. Needs the admin token for this Hub.',
    purgeDocumentTitle: 'Remove this entry and unpublish the document from this Hub. Needs the admin token for this Hub.',
    signing: 'Signing',
    delegationChannelTitle: 'Delegation requests share this stream with public chat',
    waitingDesktop: '— waiting for the Fabric Hub desktop app…',
    approved: '— approved',
    rejected: '— rejected',
    timedOut: '— timed out',
    noPreview: 'No preview',
    sending: '(sending…)',
    queued: '(queued)',
    peersOff: `Turn on Peers under ${featureVisibility} to open peer pages.`,
    extendedKey: 'This is an extended public key, not a peer page.',
    peersNeedAdmin: 'Add the admin token for this Hub to open peer pages.',
    webrtc: 'WebRTC',
    webrtcTitle: 'Delivered over the browser mesh',
    deliveredTo: (n) => `Delivered to ${n}`,
    deliveredToTitle: 'Peers this message reached',
    from: (id) => `From ${id}`,
    fromTitle: 'Mesh peer that passed this message on',
    newChainTip: 'New chain tip',
    newBlock: 'New block',
    block: 'Block',
    transactions: (n) => plural(n, 'transaction'),
    signingEmpty: 'No signing requests yet.',
    signingEmptyAlertsBefore: 'Wallet, Payjoin, and other short alerts are on the',
    signingEmptyAlertsLink: 'Notifications',
    signingEmptyAlertsAfter: 'page (the bell in the top bar).',
    signingEmptyActivitiesOff: `Turn on Activities under ${featureVisibility} to see the full feed and alerts.`,
    signingEmptySecurityBefore: 'Open',
    signingEmptySecurityLink: 'Security & delegation',
    signingEmptySecurityAfter: 'to list or revoke desktop signing sessions.',
    empty: 'No activity yet. Chat, document events, and Bitcoin blocks appear here once the Hub and network are active.',
    emptyFiltered: (filter) => `No ${filter} activity yet.`,
    shoutboxNote: 'Public chat goes to every peer on the mesh unencrypted, and relays can read it. Do not post anything private here.',
    shoutboxDeveloper: 'Public chat is a cleartext P2P_CHAT_MESSAGE flood. Confidential traffic uses onion-sealed SendOnion or sealed GroupChat on contracts; peering and gossip remain the main mesh transport.',
    meshDebug: ({ connected, self, peers, lastDelivered, recipients }) =>
      `WebRTC mesh: ${connected} connected | self ${self} | peers [${peers}] | last delivered to ${lastDelivered} | recipients [${recipients}]`,
    chatDisabled: {
      password_locked: 'Your identity is locked. Unlock it with your password to chat.',
      watch_only: 'Watch-only identities cannot chat. Import your full key or use desktop signing.',
      none: 'Log in with a Fabric identity to chat.',
      unlocked: 'Unlock your identity to chat.'
    },
    chatAction: {
      password_locked: 'Unlock',
      watch_only: 'Import full key',
      none: 'Log in',
      unlocked: 'Unlock'
    },
    composeHint: {
      password_locked: {
        before: 'To unlock, click Locked in the top bar, or open',
        after: '→ Fabric identity, and enter your password.'
      },
      unlocked: {
        before: 'To unlock, click Locked in the top bar, or open',
        after: '→ Fabric identity, and enter your password.'
      },
      watch_only: {
        before: 'To import your full key or use desktop signing, open the identity menu in the top bar, or',
        after: '→ Fabric identity.'
      },
      none: {
        before: 'To create or restore a key, click Log in in the top bar, or open',
        after: '→ Fabric identity.'
      },
      settings: 'Settings'
    }
  },
  chatInput: {
    label: 'Message',
    placeholder: 'Type a message…',
    send: 'Send message'
  }
};
