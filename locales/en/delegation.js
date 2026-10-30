'use strict';

module.exports = {
  requests: {
    title: 'Signing requests',
    intro: 'Your linked signers asked this Hub to sign these. No rule covered them, so they wait for you.',
    empty: 'Nothing is waiting.',
    sign: 'Sign',
    decline: 'Decline',
    signed: 'Signed and sent back.',
    declined: 'Declined. Nothing was signed.',
    from: (label) => `From ${label}`,
    expires: (when) => `Expires ${when}`,
    failed: 'Could not answer the request. Try again.',
    badge: (n) => `${n} signing request${n === 1 ? '' : 's'} waiting`
  },
  rules: {
    title: 'Signing rules',
    intro: 'This Hub can sign for your linked signers on its own, but only what a rule allows. Anything no rule covers waits for you under Notifications. A decline rule always wins, and if any rule is broken, nothing is signed on its own.',
    adminOnly: 'Signing rules need this Hub\'s admin token.',
    presetsTitle: 'Add a rule',
    presets: {
      signIn: 'Sign in to these sites',
      signInHint: 'Sites, one per line (https://…). Your linked signers can sign you in to them through this Hub.',
      spend: 'Co-sign shared-wallet spends',
      spendHint: 'Up to this many sats per spend, and only to these addresses (one per line).',
      accept: 'Accept shared wallets from my linked signers',
      acceptHint: 'Join shared wallets that an app paired with your identity invites this Hub to.'
    },
    fields: {
      label: 'Name',
      origins: 'Sites',
      maxAmountSats: 'Most per spend (sats)',
      destinations: 'Addresses',
      dailyLimitSats: 'Most per day (sats, optional)',
      maxPerHour: 'Most per hour (optional)'
    },
    add: 'Add rule',
    save: 'Save rules',
    saved: 'Rules saved.',
    remove: 'Remove',
    enabled: 'On',
    disabled: 'Off',
    actions: { sign: 'Sign', decline: 'Decline' },
    scopes: { passport: 'Sign-in', federation: 'Shared wallet' },
    invalid: (n) => `${n} rule${n === 1 ? ' is' : 's are'} broken, so nothing is signed on its own until you fix or remove ${n === 1 ? 'it' : 'them'}.`,
    usage: (sats, count) => `Today: ${sats} sats; this hour: ${count}`,
    empty: 'No rules yet. Every request waits for you.',
    decisionsTitle: 'Recent decisions',
    decisionsEmpty: 'No decisions yet.',
    decision: { sign: 'signed', decline: 'declined', notify: 'asked you' },
    byRule: (id) => `by rule ${id}`,
    byYou: 'by you',
    loadFailed: 'Could not load signing rules.',
    saveFailed: 'Could not save the rules.'
  }
};
