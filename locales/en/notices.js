'use strict';

module.exports = {
  collaboration: {
    received: 'Collaboration invite received',
    header: 'Collaboration',
    title: 'Collaboration invite',
    inviteFor: (who) => `Invite for ${who}`,
    fromPeer: (peer) => `From peer ${peer}`,
    review: 'Open to review and respond.'
  },
  htlc: {
    noCiphertext: 'This document has no paid content waiting to unlock yet.',
    noWebCrypto: 'This browser cannot decrypt documents here (Web Crypto is unavailable).',
    notPending: 'This document is not waiting for an unlock key.',
    badPreimage: 'The unlock key must be 64 hex characters (32 bytes).',
    wrongPreimage: 'That unlock key does not match this purchase.',
    badCiphertext: 'The stored encrypted copy is damaged. Request the document again.',
    decryptFailed: 'Could not decrypt the document. The key is wrong or the encrypted copy is damaged.'
  },
  wallet: {
    header: 'Wallet',
    mempoolContent: (amount, split, total) => `+${amount} incoming, not yet confirmed. ${split}. Balance about ${total}.`,
    mempoolTitle: 'Incoming payment (unconfirmed)',
    mempoolSubtitle: (amount, total) => `+${amount} unconfirmed · ${total} balance`,
    mempoolToast: (amount) => `+${amount} incoming (unconfirmed)`,
    confirmedContent: (amount, split, total) => `+${amount} confirmed. ${split}. Balance ${total}.`,
    confirmedTitle: 'Payment confirmed',
    confirmedSubtitle: (amount, confirmed) => `+${amount} · ${confirmed} confirmed`,
    confirmedToast: (amount) => `+${amount} confirmed`,
    receivedContent: (amount, total) => `Your balance went up by ${amount} (${total} total).`,
    receivedTitle: 'Payment received',
    receivedSubtitle: (amount, total) => `+${amount} · ${total} balance`,
    receivedToast: (amount) => `+${amount} received`,
    split: (confirmed, unconfirmed) => `${confirmed} confirmed · ${unconfirmed} unconfirmed`
  },
  invoice: {
    fallbackLabel: 'Invoice',
    confirmedContent: (label, confirmations) => `Invoice paid on-chain${confirmations ? ` (${confirmations} confirmations)` : ''}: ${label}`,
    mempoolContent: (label) => `Invoice payment seen, not yet confirmed: ${label}`,
    paidToast: 'Invoice paid on-chain',
    detectedToast: 'Invoice payment detected',
    confirmedTitle: 'Invoice paid',
    mempoolTitle: 'Invoice payment pending'
  },
  transport: {
    hubHeader: 'Hub',
    meshHeader: 'Mesh peer',
    hubDisconnected: (reason, score) => `Disconnected from the Hub${reason ? ` (${reason})` : ''} after too many bad messages (score ${score}).`,
    meshDisconnected: (reason, score, misbehavior) => `Disconnected a browser peer${reason ? ` (${reason})` : ''} after too many bad messages (score ${score}, misbehavior ${misbehavior}).`
  },
  documents: {
    notFound: 'Document not found.',
    claimFailed: 'Could not claim the purchase.',
    refreshFailed: 'Could not refresh documents',
    createBlocked: 'Could not create the document',
    createBlockedSubtitle: 'Unlock your Fabric identity to upload or publish.',
    createFailed: 'Could not create the document',
    hostingOfferNotSent: 'Hosting offer not sent',
    unlockToUpload: 'Unlock your Fabric identity to upload documents. Every upload is signed with your key.',
    unlockToPublish: 'Unlock your Fabric identity to publish. Publishing is signed with your key.',
    unlockToBuy: 'Unlock your Fabric identity to buy this document. Purchases are signed with your key.',
    unlockToClaim: 'Unlock your Fabric identity to claim this purchase. Claims are signed with your key.',
    unlockToHost: 'Unlock your Fabric identity to request hosting. Requests are signed with your key.',
    unlockToOffer: 'Unlock your Fabric identity to send hosting offers. Offers are signed with your key.',
    unlockToContract: 'Unlock your Fabric identity to create a storage contract. Contracts are signed with your key.',
    claimNeedsTx: 'Enter the document and the payment transaction ID.'
  },
  rpc: {
    error: 'The Hub returned an error.',
    failed: 'The request failed.',
    unexpected: 'Unexpected response from the Hub.'
  }
};
