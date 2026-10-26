'use strict';

function plural (n, one, many) {
  const count = Number(n) || 0;
  return `${count.toLocaleString()} ${count === 1 ? one : (many || `${one}s`)}`;
}

module.exports = {
  plural,
  sats: (n) => `${(Number(n) || 0).toLocaleString()} sats`,
  none: '—',
  actions: {
    back: 'Back',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    continue: 'Continue',
    copy: 'Copy',
    copied: 'Copied',
    delete: 'Delete',
    dismiss: 'Dismiss',
    open: 'Open',
    refresh: 'Refresh',
    retry: 'Try again',
    save: 'Save',
    saving: 'Saving…',
    showDetails: 'Show details',
    hideDetails: 'Hide details'
  },
  states: {
    loading: 'Loading…',
    updating: 'Updating…',
    ok: 'OK',
    failed: 'Failed',
    unavailable: 'Unavailable',
    off: 'Off',
    on: 'On',
    yes: 'Yes',
    no: 'No'
  },
  identity: {
    login: 'Log in',
    locked: 'Locked',
    watchOnly: 'Watch-only',
    unlocked: 'Unlocked',
    lockedHint: 'Your key is encrypted. Unlock it with your password to sign.',
    watchOnlyHint: 'Only your public key is loaded. Import the full key to sign.',
    unlockToSign: 'Unlock your identity to sign.',
    importToSign: 'Import your full key to sign.',
    signInToContinue: 'Log in with a Fabric identity to continue.',
    howToUnlock: 'Click Locked in the top bar, or open Settings → Fabric identity, and enter your password.',
    howToImport: 'Open the identity menu in the top bar, or Settings → Fabric identity, to import your full key or use desktop signing.',
    howToLogIn: 'Click Log in in the top bar, or open Settings → Fabric identity, to create or restore a key.',
    needUnlock: 'Unlock your identity with your password: click Locked in the top bar.',
    needFullKey: 'Import your full key or use desktop signing. Watch-only identities cannot sign.',
    needIdentity: 'Create or restore a Fabric identity: click Log in in the top bar.',
    chatLocked: 'Your identity is locked, so you cannot send chat messages yet.',
    chatWatchOnly: 'Watch-only identities cannot send chat messages.',
    chatNone: 'Log in with a Fabric identity to send chat messages.',
    peerLocked: 'Your identity is locked, so you cannot message peers yet.',
    peerWatchOnly: 'Watch-only identities cannot message peers.',
    peerNone: 'Log in with a Fabric identity to message peers.'
  },
  developerDetails: 'Developer details',
  errors: {
    generic: 'Something went wrong. Try again.',
    network: 'Could not reach this Hub. Check that it is running, then try again.',
    adminTokenRequired: 'This needs the admin token for this Hub. Add it under Settings → Admin.',
    withReason: (what, reason) => (reason ? `${what}: ${reason}` : what)
  }
};
