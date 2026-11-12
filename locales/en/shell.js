'use strict';

const { BRAND_MARK } = require('./brand');

module.exports = {
  brandHomeLabel: `Hub home, ${BRAND_MARK}`,
  nav: {
    label: 'Main sections',
    home: 'Home',
    peers: 'Peers',
    documents: 'Documents',
    settings: 'Settings',
    contracts: 'Contracts',
    more: 'More',
    moreTitle: 'Bitcoin, settings, and other pages',
    moreLabel: 'More pages and tools',
    features: 'Features',
    notifications: 'Notifications',
    activityLog: 'Activity log',
    bitcoin: 'Bitcoin',
    treasury: 'Treasury',
    treasuryTitle: 'Deposits this Hub manages: Payjoin when Payments is on, otherwise Lightning',
    payments: 'Payments',
    invoices: 'Invoices',
    lightning: 'Lightning',
    explorer: 'Explorer',
    faucet: 'Faucet (regtest)',
    bitcoinResources: 'Bitcoin API',
    crowdfunds: 'Crowdfunds',
    statechain: 'Statechain',
    admin: 'Admin',
    collaboration: 'Collaboration',
    beaconFederation: 'Beacon Federation',
    federations: 'Federations',
    security: 'Security',
    distributedManifest: 'Distributed manifest (JSON)',
    federationVault: 'Federation vault (JSON)',
    openSettings: 'Open settings',
    openSettingsTitle: 'Hub address and advanced mode'
  },
  notifications: {
    label: 'Notifications',
    titleEmpty: 'Notifications: wallet, Payjoin, and Hub messages',
    titleCount: (n) => `${n} notification${n === 1 ? '' : 's'}. Open Notifications.`,
    badgeTitle: (n) => `${n} notification${n === 1 ? '' : 's'}`
  },
  wallet: {
    menuIntro: 'Jump to your wallet, or start a deposit or withdrawal.',
    open: 'Wallet',
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    chipLocked: 'Unlock for balance',
    chipIdle: 'Wallet',
    labelLocked: 'Wallet: unlock your identity to show the balance',
    labelWatchOnly: 'Wallet: open transactions (watch-only)',
    labelLoggedOut: 'Wallet: log in to track a balance',
    labelLoading: 'Wallet: loading balance',
    labelReady: 'Wallet balance. Opens the wallet menu.',
    titleLocked: 'Unlock your identity to show your wallet balance here.',
    titleWatchOnly: 'Import your full key or unlock to track your wallet balance.',
    titleLoggedOut: 'Log in to track your wallet balance.',
    titleLoading: 'Loading your wallet balance…',
    titleReady: 'Hover for wallet actions: open the wallet, deposit, or withdraw.',
    mempool: (n) => `Mempool ${n}`,
    mempoolTitle: 'Transactions waiting in this Hub’s mempool. Opens the Bitcoin dashboard.'
  },
  identity: {
    login: 'Log in',
    locked: 'Locked',
    watchOnly: 'Watch-only',
    fallback: 'Identity',
    menuTitle: 'Identity menu',
    profile: 'Your profile',
    profileTitle: 'Open your peer profile (the same page as clicking your name in chat)',
    profileLockedTitle: 'Unlock your identity to open your profile',
    manage: 'Manage identity',
    manageTitle: 'Create, restore, lock, or export your Fabric keys',
    sign: 'Sign a message',
    connection: 'Hub connection',
    connectionTitle: 'Hub address and connection options',
    lock: 'Lock identity',
    destroy: 'Remove identity',
    buttonTitleLocked: 'Unlock your identity with your password',
    buttonTitleWatchOnly: 'Watch-only identity. Import your full key or use desktop signing.',
    buttonTitleLogin: 'Log in',
    buttonLabelLocked: 'Locked. Unlock your Fabric identity.',
    buttonLabelWatchOnly: 'Watch-only Fabric identity. Open options.',
    buttonTitlePassport: 'Logged in with Fabric Passport. Your keys stay in Passport.',
    buttonLabelPassport: 'Fabric identity from Passport. Open identity options.',
    buttonLabelLogin: 'Log in or create a Fabric identity'
  },
  notFound: {
    title: 'Page not found',
    body: 'There is no page at',
    hubHint: 'Use the menu at the top to find your way: Home, Documents, Contracts, and More.',
    activityHint: 'The bell opens your notifications; the full activity log is under More → Activity log.',
    clientHint: 'This site serves the Hub app without a Hub behind it. Home and Settings have your identity and local wallet.',
    goHome: 'Go to Home',
    settings: 'Settings',
    treasury: 'Treasury',
    statechain: 'Statechain'
  },
  bootstrap: {
    loadingSession: 'Loading your session…',
    checking: 'Checking Hub configuration…',
    checkingDetail: 'Asking this server whether it runs a Hub. This happens before the live connection opens.',
    timedOut: 'Could not tell whether this server runs a Hub.',
    timedOutDetail: 'The Hub did not answer in time. Try again once it is reachable; setup is not skipped.',
    retry: 'Try again'
  },
  connection: {
    connected: 'Connected. Waiting for the Hub to send its status…',
    opening: 'Connecting to the Hub…',
    reconnecting: 'Reconnecting to the Hub…'
  },
  setupGate: {
    title: 'Hub setup',
    body: 'Enter the setup secret the operator configured on the server to open first-time setup.',
    developerHint: 'Set on the server as FABRIC_HUB_SETUP_UI_SECRET.',
    label: 'Setup secret',
    submit: 'Continue to setup',
    missing: 'Enter the setup secret from the operator.',
    invalid: 'That setup secret is not correct.',
    failed: 'Could not verify the setup secret. Try again.'
  },
  identityModal: {
    accountNote: 'Your balance in the top bar and Bitcoin receive and send use the same account number as the Fabric account you pick here',
    accountPath: 'under your master key',
    close: 'Close'
  },
  settingsModal: {
    title: 'Settings',
    advanced: 'Advanced mode',
    advancedHint: 'Shows operator pages (Peers, Contracts, the More menu, and extra activity views) when this site has a live Hub. Without one they stay hidden.',
    address: 'Hub address',
    addressPlaceholder: 'host:port, e.g. localhost:7777, or https://host:port',
    addressHint: 'The app reconnects to this address.',
    addressRequired: 'Enter a Hub address.',
    addressInvalid: 'That is not a valid Hub address. Use host:port or a full https:// URL.',
    cancel: 'Cancel',
    save: 'Save'
  },
  signModal: {
    title: 'Sign and verify a message',
    messageToSign: 'Message to sign',
    messageToSignPlaceholder: 'Type the message to sign',
    publicKey: 'Public key (hex)',
    signature: 'Signature',
    copy: 'Copy',
    verifyTitle: 'Verify a signature',
    verifyIntro: 'Paste a message, public key, and signature to check them. Messages signed in the desktop app appear here the same way as ones signed in this browser.',
    message: 'Message',
    messagePlaceholder: 'The message that was signed',
    publicKeyPlaceholder: 'Compressed public key (66 hex characters)',
    signatureHex: 'Signature (hex)',
    signaturePlaceholder: 'Signature (128 hex characters)',
    valid: 'Signature is valid.',
    invalid: 'Signature is not valid for this message and key.',
    close: 'Close',
    sign: 'Sign',
    verify: 'Verify'
  },
  destroyModal: {
    title: 'Remove identity',
    body: 'This removes your identity and all documents from this browser. It cannot be undone. Make sure you have backed up your recovery phrase first.',
    cancel: 'Cancel',
    confirm: 'Remove'
  },
  federationInvite: {
    declined: 'A peer declined your federation invite.',
    acceptedNoKey: 'A peer accepted your federation invite, but their reply did not include a public key.',
    acceptedNoAdmin: (pk) => `A peer accepted your federation invite (key ${pk}…). Add them as a validator under More → Federations.`,
    accepted: 'A peer accepted your federation invite.',
    addValidator: 'Add as validator',
    dismiss: 'Dismiss',
    addFailed: 'Could not add the validator.',
    added: 'Validator added to the federation.'
  },
  faucetFunded: (sats) => `Added ${sats} sats to your key from this Hub’s faucet.`,
  bridgeErrors: {
    notReady: 'Not connected to the Hub yet. Try again in a moment.',
    htlcUnavailable: 'Unlocking paid documents is not available in this browser.',
    claimUnavailable: 'Claiming is not available right now.'
  },
  footer: {
    label: 'Hub status',
    visitorKeyTitle: 'This Hub’s node key. Log in to use peer tools.',
    keyTitle: 'This Hub’s node key'
  },
  alerts: {
    label: 'Hub alerts',
    previous: 'Previous alert',
    next: 'Next alert',
    dismiss: 'Dismiss alert'
  },
  visitorGate: {
    title: 'Log in with a Fabric identity',
    body: 'This page uses your keys and this Hub’s wallet tools. Create or unlock an identity to continue.',
    openIdentity: 'Log in',
    security: 'Security',
    home: 'Home'
  },
  clientNeedsHub: {
    title: 'This page needs a Hub',
    body: 'Peers, documents, contracts, Bitcoin, and activity come from a running Hub. This site only serves the app.',
    hint: 'Your identity and local wallet work here. When you have a Hub, enter its address in Settings.',
    home: 'Home',
    settings: 'Settings'
  }
};
