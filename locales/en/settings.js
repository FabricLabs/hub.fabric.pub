'use strict';

module.exports = {
  home: {
    title: 'Settings',
    summaryHub: 'Manage your Fabric identity and Bitcoin wallet, and open the tools for this Hub.',
    summaryVisitor: 'Log in with a Fabric identity to manage this Hub. Your identity and Bitcoin wallet stay in this browser. Hub tools appear here after you log in.',
    summaryClient: 'This site serves the Hub app without a Hub behind it. Your identity and Bitcoin wallet work in this browser. When you have a Hub, enter its address with the settings button in the top bar.',
    documents: {
      title: 'Documents',
      body: 'Publish documents, distribute them to peers, and browse the documents in this browser.'
    },
    contracts: {
      title: 'Contracts',
      body: 'Storage and execution contracts. When this Hub runs Bitcoin, execution contracts can also be registered on-chain.'
    },
    peers: {
      title: 'Peers',
      body: 'Fabric peers connected to this Hub and the browser WebRTC mesh.'
    },
    features: {
      title: 'Features tour',
      body: 'An overview of what the Hub does, with a shortcut to each area.'
    },
    notifications: {
      title: 'Notifications',
      body: 'Recent wallet, Payjoin, and Hub notifications.'
    },
    activities: {
      title: 'Activity log',
      body: 'Hub messages, chat, and Bitcoin blocks, with filters.'
    },
    identity: {
      title: 'Fabric identity',
      body: 'Create, unlock, or import your Fabric keys, or export a backup. Your public profile is the page that opens when someone clicks your name in chat.'
    },
    wallet: {
      title: 'Bitcoin wallet',
      body: 'Your Bitcoin addresses and balance, and how they derive from your Fabric identity.'
    },
    bitcoin: {
      title: 'Bitcoin dashboard',
      body: 'This Hub’s Bitcoin status, regtest tools, explorer, Payjoin, and Lightning. Some pages appear only when turned on under Admin → Feature visibility.'
    },
    collaboration: {
      title: 'Collaboration',
      body: 'Contacts, including ones from peers, multisig groups, and email invitations.'
    },
    security: {
      title: 'Security',
      body: 'Your Passport sign-in to this Hub, and the apps linked to sign with it.'
    },
    signing: {
      title: 'Signing rules',
      body: 'What this Hub signs for your linked signers without asking you.'
    },
    admin: {
      title: 'Admin',
      body: 'Hub health, the work queue, network access, Beacon, and Feature visibility. Needs the admin token.'
    },
    statechain: {
      title: 'Statechain',
      body: 'This Hub’s shared state and the history of changes to it.'
    },
    beaconFederation: {
      title: 'Beacon Federation',
      body: 'Epochs anchored to Bitcoin, cooperative signing, and the Taproot vault.'
    },
    federations: {
      title: 'Federations',
      body: 'Validator keys and the signing threshold for state changes and Beacon epochs.'
    },
    bitcoinResources: {
      title: 'Bitcoin API',
      body: 'Verify Bitcoin payments and browse this Hub’s Bitcoin and Lightning API responses.'
    }
  },

  admin: {
    home: 'Home',
    settings: 'Settings',
    title: 'Admin',
    summary: 'Tools for the person who runs this Hub: health, the work queue, network access, and which parts of the Hub are shown. Most people only need Settings and the Bitcoin dashboard.',
    flags: {
      promo: 'Promo banner on Home for visitors who are not logged in',
      advancedMode: 'Advanced mode: power-user navigation and tools',
      peers: 'Peers and WebRTC: navigation, pages, and the Home network card',
      peersAdmin: 'Peers (needs the admin token in this browser)',
      activities: 'Notifications bell, activity log, and Home activity sections',
      features: 'Features tour: page, More menu entry, and Home shortcut',
      sidechain: 'Statechain, Federation settings, and Beacon Federation',
      bitcoinPayments: 'Bitcoin: payments and Payjoin (page, links, and balance chip)',
      bitcoinInvoices: 'Bitcoin: invoices',
      bitcoinResources: 'Bitcoin: API browser',
      bitcoinExplorer: 'Bitcoin: block and transaction pages',
      bitcoinLightning: 'Bitcoin: Lightning pages and channel details',
      bitcoinCrowdfund: 'Bitcoin: Taproot crowdfunds on the dashboard'
    },
    routeBlocked: {
      title: 'This page is turned off in this browser',
      flagOff: (label) => `${label} is turned off under Feature visibility below. Turn it on, then open the page again.`,
      flagOffNoToken: (label) => `${label} is turned off in this browser. Add the admin token below to change Feature visibility.`,
      openAgain: 'Open the page again',
      peersReady: 'The admin token is saved. You can open Peers now.',
      openPeers: 'Open Peers'
    },
    token: {
      missingTitle: 'Add the admin token',
      missingBody: 'Paste the admin token from first-time setup. It unlocks the work queue, network access, Feature visibility, Beacon, and sends from the Hub wallet.',
      peersBody: 'Peers need the admin token. Paste it below, then open Peers again.',
      present: 'The admin token is saved in this browser.',
      developer: 'The token is created by the first POST /settings during setup and renewed with POST /settings/refresh. This browser keeps it in localStorage (fabric.hub.adminToken).',
      needed: 'Add the admin token above first.'
    },
    health: {
      title: 'Hub health',
      intro: 'Disk space, process load, and whether the services this Hub uses can be reached. Refreshes every 30 seconds.',
      refresh: 'Refresh health',
      updated: (when) => `Updated ${when}`,
      loadFailed: (reason) => `Could not load Hub health (${reason}). Check that the Hub is running, then refresh.`,
      host: 'Host',
      uptime: 'Process uptime',
      cpu: 'Process CPU',
      cpuMeasuring: 'Measuring…',
      cores: 'CPU cores',
      load: 'System load (1, 5, 15 min)',
      memory: 'Memory (RSS)',
      heap: 'Heap used',
      diskPath: 'Disk path',
      diskFree: 'Disk free',
      diskUsed: 'Disk used',
      diskFull: 'Time until disk is full',
      diskFullAround: (when) => `around ${when}`,
      fillRate: (rate) => `Disk fills at about ${rate}/s.`,
      fillRatePending: 'The fill rate appears after a few health checks.',
      dns: 'DNS lookup',
      localServices: 'Local services',
      reachable: (ms) => `reachable (${ms} ms)`,
      unreachable: (reason) => `unreachable (${reason})`,
      noResponse: 'no response',
      noProbes: 'No local services to check.',
      addresses: 'Network addresses',
      noAddresses: 'No network interfaces found.'
    },
    worker: {
      title: 'Fabric work queue',
      intro: 'Paid jobs waiting to run, in the order chosen below. The order is saved on the Hub.',
      refresh: 'Refresh queue',
      runNow: 'Run now',
      clear: 'Clear queue',
      strategyLabel: 'Job order',
      strategies: {
        highest_value_first: 'Highest value first (default)',
        fifo: 'Oldest first',
        oldest_high_value_first: 'Oldest first, highest value breaks ties'
      },
      ready: 'Worker ready',
      strategy: 'Job order',
      length: 'Jobs in queue',
      busy: 'Running a job',
      itemFallback: 'Work item',
      value: 'Value',
      attempts: 'Attempts',
      peer: 'Peer',
      drop: 'Remove job',
      empty: 'The queue is empty.',
      strategyFailed: 'Could not save the job order. Try again.'
    },
    wealth: {
      title: 'Wallet and earnings',
      intro: 'The Hub wallet balance, plus what this Hub has earned through Payjoin, storage contracts, and paid document transfers.',
      network: 'Network',
      unknown: 'Unknown',
      balance: 'Wallet balance',
      height: 'Chain height',
      counts: 'Transactions by type',
      totals: 'Totals by type',
      payjoin: 'Payjoin proposals',
      payjoinDeposit: 'Payjoin deposits',
      inventoryHtlcFund: 'Document transfer payments (HTLC funded)',
      inventoryHtlcClaim: 'Document transfer payments (HTLC claimed)',
      storageContract: 'Storage contracts'
    },
    http: {
      title: 'Network access',
      intro: 'Shared mode lets other computers on your network open this Hub; your firewall still applies. When it is off, only this computer can. Changing it restarts the Hub’s web server right away, and open pages reconnect.',
      developer: 'Saved as HTTP_SHARED_MODE in stores/hub/STATE. On binds 0.0.0.0; off binds 127.0.0.1. When FABRIC_HUB_INTERFACE or INTERFACE is set, the bind address follows it, and the saved flag applies once those are unset.',
      label: 'Share this Hub on the local network',
      loading: 'Loading the current setting…',
      needToken: 'Add the admin token above to change network access.',
      loadFailed: (reason) => `Could not load the network setting (${reason}). Refresh the page to try again.`,
      saveFailed: (reason) => `Could not save the network setting (${reason}). Try again.`,
      rebinding: 'The web server is restarting on the new address. Open pages will reconnect.',
      envControlled: 'Saved. The server environment sets the address for now; this setting applies after a restart without it.'
    },
    privateNetwork: {
      title: 'Private network',
      intro: 'Join a private Bitcoin and Fabric network, such as the regtest network started by npm run deploy. Paste its network-profile.json and this Hub connects its Bitcoin node and Fabric peer to the network’s nodes now and at every start.',
      developer: 'Saved as BITCOIN_ADDNODES and FABRIC_PEERS in stores/hub/STATE. Saved Fabric peers replace the default public seeds; Bitcoin targets are added with addnode. Remove them in the fields below to leave the network.',
      profileLabel: 'Network profile (network-profile.json)',
      profilePlaceholder: 'Paste the contents of stores/local-network/regtest/network-profile.json',
      importButton: 'Import profile',
      addnodesLabel: 'Bitcoin nodes (host:port, one per line)',
      peersLabel: 'Fabric peers (host:port, one per line)',
      saveButton: 'Save',
      loading: 'Loading the current network…',
      needToken: 'Add the admin token above to join a private network.',
      connected: 'connected',
      notConnected: 'not connected',
      imported: (network, count) => `Joined the ${network} network. ${count} Hubs listed in the profile.`,
      saved: 'Saved and applied.',
      failed: (reason) => `Could not apply the network (${reason}).`,
      partial: (list) => `Saved, but some targets could not be reached yet: ${list}.`
    },
    flagsSection: {
      title: 'Feature visibility',
      intro: 'Choose which parts of the Hub are shown. A change applies in this browser right away and is saved to the Hub with your admin token, so other browsers pick it up the next time they load the Hub. Home, Documents, Contracts, Settings, Security, and this Admin page are always available.',
      defaults: 'The defaults suit a document market: Documents, Peers, and Bitcoin invoices and explorer.',
      developer: 'Each browser keeps its own copy of these flags in localStorage and merges it with the defaults saved on the Hub (stores/hub/STATE) when the page loads.',
      preset: 'Use document market preset',
      savedLocal: 'Saved in this browser. Add the admin token to save it for every browser.',
      saveFailed: (reason) => (reason
        ? `Saved in this browser, but the Hub could not save it for other browsers (${reason}). Try again.`
        : 'Saved in this browser, but the Hub could not save it for other browsers. Try again.'),
      saved: 'Saved for every browser that opens this Hub.',
      presetLocal: 'Document market preset applied in this browser. Add the admin token to save it for every browser.',
      presetFailed: (reason) => (reason
        ? `Document market preset applied in this browser, but the Hub could not save it (${reason}). Try again.`
        : 'Document market preset applied in this browser, but the Hub could not save it. Try again.'),
      presetSaved: 'Document market preset saved for every browser that opens this Hub.'
    },
    related: {
      title: 'Related pages',
      beaconTitle: 'Beacon Federation',
      beaconBody: 'Epoch schedule, Fabric messages, cooperative signing, and the Taproot vault on Bitcoin (deposits lock for 144 blocks by default).',
      federationsTitle: 'Federation validators',
      federationsBody: 'Edit the validator keys and threshold saved on this Hub, unless the server environment sets them.',
      bitcoinTitle: 'Bitcoin dashboard',
      bitcoinBody: 'Node status, regtest tools, and the Hub wallet. Payments, invoices, the API browser, explorer, and Lightning follow the Bitcoin toggles above.',
      empty: 'Turn on Statechain or any Bitcoin toggle above to show shortcuts to those pages here.'
    },
    danger: {
      title: 'Danger zone',
      wipeTitle: 'Wipe all local Hub data',
      wipeBody: 'Deletes everything this Hub keeps on disk: setup, documents, Fabric state, local Bitcoin, Lightning, and Payjoin files, and logs. The Hub then stops. Start it again yourself to run first-time setup. This cannot be undone.',
      developer: 'Removes stores/ and logs/ under the Hub data directory, then exits the process.',
      open: 'Wipe local data…',
      confirmTitle: 'Confirm data wipe',
      confirmBody: 'Type the phrase below exactly to confirm. The Hub will stop and delete its local data.',
      phraseLabel: 'Confirmation phrase',
      confirm: 'Wipe all local data and stop',
      started: 'Wiping local data. The Hub will stop.'
    }
  },

  adminToken: {
    title: 'Admin token (regtest)',
    body: 'Paste the admin token from first-time setup so this browser can send payments from the Hub wallet.',
    present: 'The admin token is saved in this browser. You can send from the Hub wallet.',
    label: 'Admin token',
    save: 'Save token'
  },

  trackedContracts: {
    title: 'Tracked application contracts',
    titleEmbedded: 'Pending and accepted contracts',
    intro: 'Applications that publish a contract to this Hub wait here for your review. The Beacon tracks the contracts you accept, and its next epoch seals their combined state.',
    developer: 'Inbound CONTRACT_PUBLISH frames land as pending offers. Accepting one adds its namespace to the Beacon-tracked set; the next epoch seals payload.contracts.stateDigest, the state root of accepted contracts.',
    loading: 'Loading application contracts…',
    loadFailed: 'Could not load application contracts',
    actionFailed: 'Could not update the contract. Try again.',
    stateRoot: 'Contracts state root',
    pending: (n) => `Waiting for review (${n})`,
    pendingEmpty: 'No contracts are waiting for review.',
    accept: 'Accept',
    reject: 'Reject',
    unnamed: 'Unnamed contract',
    version: (v) => `version ${v}`,
    accepted: (n) => `Accepted (${n})`,
    acceptedEmpty: 'No contracts accepted yet, so the Beacon contracts root is empty.',
    untrack: 'Stop tracking',
    stateDigest: 'State digest'
  }
};
