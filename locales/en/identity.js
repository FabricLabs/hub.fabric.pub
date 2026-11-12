'use strict';

module.exports = {
  manager: {
    title: 'Fabric identity',
    introPostSetup: 'Create or restore the keys this browser signs with. The Hub starts with account 0 on this Hub’s Bitcoin network; you can switch accounts or networks later from the identity menu without a new recovery phrase.',
    introUses: 'While your key is unlocked in this browser, the Wallet chip in the top bar, Bitcoin receive addresses, and',
    introDocuments: 'documents',
    introDocumentsAfter: '(encrypting, publishing, and paid distribution) use this identity.',
    introDerivation: 'How this Hub derives your Bitcoin addresses is explained under',
    introDerivationLink: 'Bitcoin wallet',
    introReopen: 'To come back here, choose Manage identity in the identity menu, or open',
    introReopenSettings: 'Settings',
    introReopenAfter: '→ Fabric identity.',
    idLabel: 'Fabric ID',
    accountLabel: (n, network) => `Account ${n} on ${network}`,
    passportSigning: 'Signed in with Fabric Passport. Your keys stay in Passport, and this browser holds only a session for your Fabric ID. Passport does not sign Hub actions yet: to send, publish, or chat from this browser, restore your recovery phrase or a backup file here.',
    passportShowWallet: 'Show my wallet here',
    settingsLink: 'Settings',
    securityLink: 'Security',
    signerPassport: 'Fabric Passport',
    signerDesktop: 'Fabric Hub (desktop)',
    devices: {
      title: 'Linked devices',
      intro: 'Passport, Android, Fabric Hub desktop, and this browser can link to each other so they act as one identity.',
      revokeWhere: 'You can also revoke devices on',
      developer: 'Linking uses a fabric://link. Once both sides countersign, each publishes a BIP340-signed IdentityCrossSign Fabric message. Revoking publishes IdentityCrossSignRevoke.',
      revoke: 'Revoke',
      fallbackName: 'Device',
      emptyCanLink: 'No linked devices yet. Use Link another device below, or approve a link from Passport, Android, or Fabric Hub desktop.',
      emptyLocked: 'No linked devices yet. Approve a link from Passport, Android, or Fabric Hub desktop, or unlock your identity with your password to start one from this browser.',
      emptySession: 'No linked devices yet. Approve a link from Passport, Android, or Fabric Hub desktop.',
      revokeFailed: 'Could not revoke the device. Try again.'
    },
    linkDevice: {
      title: 'Link another device',
      intro: 'Start a link here, then approve it on the other device: Passport, GoonCitizen Android, or desktop. Each app keeps its own recovery phrase; linking does not copy it.',
      developer: 'The other device approves the fabric://link or its HTTPS landing page.',
      create: 'Create link',
      scanHint: 'Scan this code with GoonCitizen on your phone or desktop, or open the link in Passport:',
      qrAlt: 'QR code for linking another device',
      copyOpen: 'Copy and open link',
      approvePassport: 'Approve with Passport',
      browserLabel: 'Hub browser',
      linkedFallback: 'Linked device',
      needKey: {
        locked: 'Unlock your identity with your password before linking another device.',
        session: 'A Passport session cannot start a link. Approve it from Passport instead.',
        none: 'Create or restore a Fabric identity before linking another device.'
      },
      prepareFailed: 'Could not prepare the device link. Try again.',
      createFailed: 'Could not create the device link. Try again.',
      timedOut: 'The other device did not approve the link in time. Create a new link and try again.',
      countersignFailed: 'Could not confirm the link with the other device. Create a new link and try again.',
      confirmResponder: (id, pubkeyHex) => `A device asks to link with this identity as one account.\n\nDevice: ${id}\nKey fingerprint: ${String(pubkeyHex).slice(0, 16)}\n\nCheck that the other device shows the same fingerprint. Link it?`,
      declined: 'Link declined. Nothing was signed.'
    },
    keyStatus: {
      label: 'Private key:',
      unlocked: 'unlocked in this browser.',
      lockedPassword: 'locked. Unlock it with your password below.',
      session: 'not in this browser. Your keys stay in Passport.',
      autoLockIn: (n) => `It locks automatically about ${n} after you unlock.`,
      autoLockOff: 'Automatic locking is off. Use Lock identity below when you are done.'
    },
    autoLock: {
      label: 'Lock automatically after',
      off: 'Never (lock manually)',
      minutes: (n) => `${n} minutes`,
      hours: (n) => (n === 1 ? '1 hour' : `${n} hours`),
      hint: 'Removes your private keys from memory this long after you unlock, while this tab stays open.'
    },
    copyId: 'Copy Fabric ID',
    lock: 'Lock identity',
    backup: {
      download: 'Download backup file',
      downloadTitle: 'Your keys, locked with your password. Restoring it needs the same password.',
      note: 'The backup file is locked with the password you unlock with. It does not contain your recovery phrase.',
      exportFailed: 'Could not create the backup file. Try again.'
    },
    passwords: {
      tooShort: (min) => `Use a password of at least ${min} characters.`,
      mismatch: 'The passwords do not match. Type them again.'
    },
    lockPassword: {
      password: 'Password for this browser',
      confirm: 'Confirm password',
      hint: (min) => `At least ${min} characters. It locks your keys in this browser and in backup files, and you need it every time you unlock. It is not part of your recovery phrase: if you forget it, restore from your recovery phrase.`
    },
    passphrase: {
      label: 'Extra passphrase (optional)',
      placeholder: 'Only if you want one',
      hint: 'Some wallets call it a 25th word. It changes which keys your recovery phrase makes, so you need it, with the phrase, to restore. Leave it empty if you are not sure.'
    },
    unlock: {
      password: 'Password',
      hint: 'The password you chose when you created or restored this identity in this browser.',
      submit: 'Unlock identity',
      missing: 'Enter your password to unlock.',
      failed: 'Could not unlock. Check your password and try again. If it still fails, restore from your recovery phrase.',
      noStorage: 'This browser does not allow local storage, so your identity cannot be saved here.',
      noStored: 'No identity is saved in this browser.'
    },
    forget: {
      button: 'Remove identity',
      title: 'Remove this identity from this browser?',
      warning: 'This permanently deletes the keys and documents stored in this browser.',
      recover: 'You can restore this identity later only with your recovery phrase (and extra passphrase, if you used one) or a backup file and its password. Without them, this identity and its documents cannot be recovered.',
      question: 'Do you want to continue?',
      confirm: 'Delete identity and documents'
    },
    create: {
      title: 'Create a new identity',
      intro: 'Your keys are made on this device and are not sent anywhere.',
      phraseTitle: 'Save your recovery phrase',
      body: 'Your recovery phrase is the only way to restore this identity if you clear this browser or lose this device. Fabric cannot recover it for you, and this browser does not keep it after this step.',
      keepSafe: 'Write it on paper or save it in a password manager, and keep it offline and private. Anyone who has it controls this identity and its funds. Never type it into a website or share it with anyone, including support.',
      phraseLabel: 'Recovery phrase',
      phraseNote: '12 words. Most wallets can restore from these.',
      phraseHidden: 'Hidden. Choose Show recovery phrase to see it.',
      showPhrase: 'Show recovery phrase',
      hidePhrase: 'Hide recovery phrase',
      copyPhrase: 'Copy recovery phrase',
      copyPhraseTitle: 'Show the phrase first so you can check what you copy.',
      regenerate: 'Generate a different recovery phrase',
      acknowledge: 'I have saved my recovery phrase, and my extra passphrase if I chose one. I understand this identity cannot be recovered without them.',
      submit: 'Create identity',
      submitTitle: 'Confirm that you saved your recovery phrase first.',
      failed: 'Could not create your identity. Try again.'
    },
    chooser: {
      prompt: 'How do you want to log in?',
      passport: 'Log in with Passport',
      passportTitle: 'Approve the login in the Fabric Passport browser extension.',
      hubSelf: 'Sign in as this Hub',
      hubSelfTitle: 'Use this Hub’s own Fabric identity in this window.',
      generate: 'Create new identity',
      backup: 'Load from backup',
      restore: 'Restore from recovery phrase',
      restoreTitle: 'Restore the same keys as other BIP39 wallets from your recovery words.'
    },
    backToChooser: 'Back to login options',
    importBackup: {
      title: 'Load from backup',
      intro: 'Choose a Fabric identity backup file (.json), then enter the password it was locked with.',
      fileLabel: 'Backup file',
      passwordLabel: 'Password',
      submit: 'Load and unlock',
      missingFile: 'Choose a backup file first.',
      notBackup: 'This file is not a Fabric identity backup. Older backup files cannot be loaded: restore from your recovery phrase instead.',
      failed: 'Could not unlock this backup. Check the password and try again.',
      readFailed: 'Could not read the file. Choose it again.'
    },
    restore: {
      title: 'Restore from recovery phrase',
      howTitle: 'Before you start',
      how: [
        'Enter your recovery phrase, usually 12 or 24 words. If you added an extra passphrase when the wallet was created (sometimes called a 25th word), enter it too.',
        'Then choose a password for this browser. It locks your keys here; it is not part of your recovery phrase.',
        'A wrong or missing extra passphrase does not show an error. It restores a different identity instead. After restoring, check that your Fabric ID or an address matches what you expect.'
      ],
      safety: 'Only type your recovery phrase on a device you trust, and never on a website you did not open yourself.',
      phraseLabel: 'Recovery phrase',
      phrasePlaceholder: 'Enter your words separated by spaces',
      replace: 'Replace the identity already saved in this browser',
      submit: 'Restore and unlock',
      failed: 'Could not restore from this recovery phrase. Check the words and try again.',
      existing: 'An identity is already saved in this browser. Tick Replace to overwrite it.'
    },
    login: {
      verifyFailed: 'Could not verify the sign-in. Try again.',
      passportTimeout: 'Passport did not approve the sign-in in time. Try again.',
      passportRejected: 'Passport did not approve the sign-in.',
      passportMissing: 'Fabric Passport was not detected. Install or enable the extension, then reload this page.',
      passportOutdated: 'Update Fabric Passport to sign in here. This Hub uses Passport v2.',
      passportBusy: 'Passport is already showing a sign-in. Approve or decline it there first.',
      passportPurpose: 'Sign in to this Fabric Hub'
    },
    saveFailed: 'Could not save your identity in this browser. Try again.',
    errorTitle: 'Something went wrong'
  },
  accountControls: {
    label: 'Fabric account',
    networkLabel: 'Network',
    option: (n) => `Account ${n}`,
    networks: {
      mainnet: 'Mainnet',
      testnet: 'Testnet',
      testnet4: 'Testnet4',
      signet: 'Signet',
      regtest: 'Regtest'
    },
    title: 'Each account and network has its own identity, wallet, and cosigner key, all from the same recovery phrase.',
    blockedLocked: 'Unlock your identity with your password to switch to an account or network you have not used yet.',
    blockedSession: 'Passport sessions cannot switch accounts here. Switch accounts in Passport.',
    switchFailed: 'Could not switch accounts. Unlock your identity and try again.'
  },
  postSetupWizard: {
    title: 'Create your Fabric identity',
    intro: 'Generate a new key or restore one below to finish. You can skip this and open the identity menu from the top bar at any time.',
    skip: 'Skip for now'
  },
  adminTokenNotice: {
    title: 'Hub admin token saved',
    body: 'Setup saved an admin token in this browser. It authorizes operator actions on this Hub, such as regtest block generation and some settings changes. It is not your Fabric signing identity.',
    next: 'Next, generate or restore your Fabric keys below. They sign your wallet payments, documents, and messages.'
  },
  onboarding: {
    title: 'Set up your Hub',
    finishLater: 'This Hub needs setup before you can use it. To stop for now, close this tab. Nothing is saved until you choose Complete setup, and setup starts again from the beginning the next time you open the Hub.',
    steps: {
      intro: { title: 'Welcome', description: 'What this Hub does' },
      node: { title: 'Node', description: 'Name and network access' },
      bitcoin: { title: 'Bitcoin', description: 'Network and Bitcoin Core' }
    },
    networks: {
      regtest: 'Regtest (local development)',
      signet: 'Signet (public test coins)',
      testnet: 'Testnet (public testing)',
      mainnet: 'Mainnet (real bitcoin)'
    },
    intro: {
      title: 'Welcome to Fabric Hub',
      adminToken: 'Finishing setup creates an admin token for this Hub. It is kept in this browser only, never on the server, and lets you change operator settings later.',
      storeDeveloper: 'Setup writes the Hub settings to stores/hub/STATE.',
      about: 'Your Hub connects you to the Fabric network. It finds peers, helps browsers connect to each other, stores documents, and can run Bitcoin and Lightning. Next you will name the Hub, choose who can reach it, and pick Bitcoin Core options.',
      loppBefore: 'The Bitcoin options follow the beginner settings in Jameson Lopp’s',
      loppLink: 'Bitcoin Core Config Generator',
      loppAfter: ', one section at a time. A Bitcoin node run by the Hub does not relay unconfirmed transactions unless you turn that on.',
      resetTitle: 'Starting over later',
      resetExternal: 'This desktop window is connected to a Hub that is already running on this computer, so setup uses that Hub’s data. To start over, quit the other Hub first.',
      resetExternalDeveloper: 'The running Hub usually uses stores/hub in the repository (from npm start). You can also restart the desktop app with FABRIC_DESKTOP_ALWAYS_SPAWN_HUB=1. Deleting files in the checkout has no effect while the running Hub still has IS_CONFIGURED in memory.',
      resetDesktop: 'To start over, quit Fabric Hub and delete its data folder (choose Reveal Hub data folder in the tray menu to find it), or use Admin → Self-destruct.',
      resetDesktopDeveloper: (folder) => `Data folder: ${folder}. Desktop data is separate from the git checkout. From the repository, npm run reset:stores clears both the command-line and desktop Hub data, including the legacy Electron profile.`,
      resetCli: 'To start over, stop the Hub, clear its data with the reset command, and start the Hub again. This setup then opens again.',
      resetCliDeveloper: 'npm run reset:stores clears the command-line stores/hub, the desktop Fabric Hub data, and the legacy Electron profile. Desktop data is not in the git checkout; on macOS it is in ~/Library/Application Support/Fabric Hub/stores/hub.',
      resetChain: 'The reset also deletes Bitcoin and Lightning chain data and logs unless you choose to keep them.',
      resetChainDeveloper: 'npm run reset:stores removes stores/bitcoin-*, stores/lightning/, and logs. Add --setup-only to keep chain data.'
    },
    node: {
      name: 'Node name',
      namePlaceholder: 'For example, My Hub',
      share: 'Share this Hub on your local network',
      shareHint: 'Off keeps the dashboard reachable only from this computer. The desktop app starts that way until you turn this on.',
      shareDeveloper: 'On binds HTTP to 0.0.0.0. The FABRIC_HUB_INTERFACE environment variable overrides this on restart.',
      disk: 'Document storage limit (MB)',
      diskHint: 'The most disk space this Hub uses for documents. It also limits document purchases.',
      cost: 'Price per byte (sats)',
      costHint: 'The minimum price for serving a document, per byte. 0.01 is about 10,000 sats per MB.',
      secret: 'Operator setup secret',
      secretHint: 'This Hub is protected by a setup secret. Enter it to finish setup. If you do not have it, ask the person who started the Hub.',
      secretDeveloper: 'The same value as FABRIC_HUB_SETUP_UI_SECRET on the server.'
    },
    bitcoin: {
      sections: {
        network: 'Network',
        core: 'Bitcoin Core',
        lightning: 'Lightning',
        binaries: 'Node software'
      },
      preset: 'Starting preset',
      network: 'Bitcoin network',
      managed: 'Run a Bitcoin node for this Hub (bitcoind)',
      rpcHost: 'Bitcoin RPC host',
      rpcPort: 'Bitcoin RPC port',
      rpcPortHint: 'Defaults: regtest 18443, signet 38332, testnet 18332, mainnet 8332.',
      rpcUser: 'Bitcoin RPC username',
      rpcPassword: 'Bitcoin RPC password',
      listen: 'Accept incoming connections from other Bitcoin nodes. Off matches Lopp’s home and Raspberry Pi default.',
      txrelay: 'Relay unconfirmed transactions',
      txrelayHint: 'Off is the Hub default: the node only downloads blocks, so other nodes cannot fill its mempool. Wallet features still work. Lightning needs relay and turns it on.',
      txrelayDeveloper: 'Off starts Bitcoin Core with -blocksonly=1. Bitcoin Core 29 has no -txrelay flag.',
      prune: 'Prune block storage (MiB, 0 keeps all blocks)',
      pruneHint: 'The smallest prune size is 550 MiB. Pruning cannot be combined with the transaction index or Lightning.',
      txindex: 'Keep a transaction index (txindex). Lightning needs it; it is not available while pruning.',
      dbcache: 'Database cache (MiB)',
      maxConnections: 'Maximum peer connections',
      uploadTarget: 'Daily upload limit (MiB, 0 for no limit)',
      uploadTargetHint: 'Lopp’s low-bandwidth setting caps daily upload so a home connection is not saturated.',
      lightningManaged: 'Run a Lightning node for this Hub (lightningd)',
      lightningHint: 'Optional. Needs a Bitcoin node run by this Hub, with no pruning, a transaction index, and transaction relay.',
      lightningPlatform: 'Official Core Lightning downloads are for Linux x86_64. On macOS the Hub uses Homebrew when it is installed.',
      lightningSocket: 'Lightning RPC socket path',
      lightningSocketPlaceholder: '/path/to/lightningd.sock',
      regtestNote: 'Regtest is a private chain on this computer. Lightning is optional.',
      testnetNote: 'Signet and testnet run a Bitcoin node on this computer. Signet blocks arrive about once a minute; testnet blocks are irregular and the network can be unstable.'
    },
    binaries: {
      title: 'Node software',
      check: 'Check for updates',
      pinned: (bitcoinVersion, withLightning, platform) => `The Hub installs a pinned Bitcoin Core${bitcoinVersion ? ` ${bitcoinVersion}` : ''}${withLightning ? ' and Core Lightning' : ''} for ${platform}.`,
      platformFallback: 'this platform',
      checkExplain: 'Check for updates compares the publishers’ latest releases and checksums with this pin and with what is installed. It downloads the pinned version only when something is missing. Newer releases are listed, not installed.',
      component: 'Component',
      local: 'Installed',
      pin: 'Pinned',
      remote: 'Latest release',
      status: 'Status',
      bitcoinCore: 'Bitcoin Core',
      coreLightning: 'Core Lightning',
      installed: 'Installed',
      notInstalled: 'Not installed',
      matchesPin: 'Matches pin',
      differsFromPin: 'Different from pin',
      notAvailable: 'Not available on this platform',
      newerSuffix: 'newer release available',
      pinMismatch: (version) => `The official checksums for Bitcoin Core ${version} do not match the checksum pinned in this Hub. Check the download source before you continue.`,
      remoteError: (reason) => `Could not check Bitcoin Core releases: ${reason}`,
      working: 'Working…',
      downloadingPercent: (file, percent) => `Downloading ${file} (${percent}%)…`,
      downloading: (file) => `Downloading ${file}…`,
      extracting: (component) => `Extracting ${component}…`,
      extractingArchive: 'Extracting archive…',
      fetching: (file) => `Fetching ${file}…`,
      checking: 'Checking for updates…',
      installing: 'Installing node software…'
    },
    apply: {
      downloading: 'Downloading node software…',
      writing: 'Writing Hub settings…',
      saving: 'Saving settings…',
      confirming: 'Checking that the settings were saved…',
      finishing: 'Finishing setup…'
    },
    errors: {
      title: 'Setup could not continue',
      secretMissing: 'Enter the operator setup secret on the Node step to continue.',
      downloadFailed: (status) => `Could not download node software (status ${status}). Check your internet connection, then try again.`,
      bitcoinDownloadFailed: 'Could not download Bitcoin Core. Check your internet connection, then try again.',
      lightningFailed: 'Could not install Core Lightning. Turn off the Lightning node or install Core Lightning yourself, then try again.',
      checkFailed: (status) => `Could not check for updates (status ${status}). Try again later.`,
      notConfirmed: 'The Hub did not confirm the new settings in time. Check the Hub log, then try again.',
      setupFailedStatus: (status) => `Setup failed (status ${status}). Check the Hub log, then try again.`,
      setupFailed: 'Setup failed. Check the Hub log, then try again.',
      htmlResponse: 'The Hub sent a web page instead of a setup response. Check that the Hub is running and that any proxy points to it, then try again.'
    },
    next: 'Next',
    complete: 'Complete setup'
  },
  security: {
    title: 'Security',
    summary: 'Your sign-in to this Hub and the devices that share your Fabric identity. When you sign in with Passport, your keys stay in Passport (or the desktop app it is linked to) and this browser holds only a session.',
    pathNote: 'The browser paths /sessions and /security open this page. The sign-in API is served at /sessions.',
    related: 'Related:',
    payments: 'Bitcoin payments',
    paymentsNote: 'receive, send from the Hub wallet, or use Payjoin',
    paymentsHidden: 'Bitcoin payments is hidden from the menu. Turn on Bitcoin — Payments under Settings → Admin → Feature visibility to show it',
    documents: 'Documents',
    documentsNote: 'distribution payments and hosting proposals show extra guidance when this browser has no signing key',
    devices: {
      title: 'Linked devices',
      intro: 'Devices that share your Fabric identity, such as Passport, Android, Fabric Hub desktop, and this Hub. A lost or stolen device can act as you until another of your devices revokes it.',
      signHint: 'Revoking signs a message with your identity. Unlock it with your password first, or import your full key if it is watch-only.',
      developer: 'Revoking publishes a BIP340-signed IdentityCrossSignRevoke Fabric message.',
      empty: 'No devices are linked in this browser. To link one, open the identity menu and use Link another device.',
      revoke: 'Revoke',
      fallbackName: 'Device',
      revokeFailed: 'Could not revoke the device. Try again.'
    },
    session: {
      title: 'Signed in with Passport',
      on: (signer) => `This browser is signed in to this Hub. ${signer} signed the sign-in.`,
      off: 'This browser is not signed in with Passport. Open the identity menu and choose Log in with Passport.',
      signers: { passport: 'Passport', hub: 'Fabric Hub desktop', gooncitizen: 'GoonCitizen' },
      identity: 'Identity:',
      network: (network) => `Network: ${network}`,
      walletShared: 'You shared your wallet with this sign-in, so this Hub can show its balance.',
      walletNotShared: 'You did not share your wallet. This Hub knows your identity only.',
      expires: (when) => `Ends ${when}`,
      end: 'Sign out',
      endFailed: 'Could not sign out. Try again.'
    }
  },
  messagePrompt: {
    title: 'Fabric message',
    fromContract: 'An execution contract run on this Hub asks for this message to be signed.',
    contentsHeading: 'Message contents',
    signers: (n) => `Other signers to notify: ${n}`,
    type: 'Type',
    bytes: (n) => `${Number(n).toLocaleString()} bytes`,
    author: 'Author',
    signedBy: 'Signed by',
    unsigned: 'Not signed — anyone could have made this message.',
    noBody: 'This message has no body.',
    viewOnly: 'This is for review only. Opening a Fabric link never signs anything or signs you in.',
    needsKey: 'Signing this needs your full key. Unlock or import your identity in this browser, then sign it from the contract page.',
    developer: 'Opaque fabric:<frame> link, fabric://message?hex=… link, or a contract run’s sign request.'
  },
  qrScanner: {
    title: 'Scan QR code',
    hint: 'Point your camera at a Bitcoin address or Lightning invoice QR code.',
    cameraFailed: 'Could not open the camera. Allow camera access for this page in your browser, then try again.'
  }
};
