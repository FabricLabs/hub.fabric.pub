'use strict';

/**
 * True when `str` looks like a BIP32 serialized extended public or private key (xpub/tpub/…).
 * Used to avoid treating these as Fabric peer route ids in Activity links and PeerView.
 */
function isLikelyBip32ExtendedKey (str) {
  const s = String(str || '').trim();
  if (s.length < 28) return false;
  return /^[xyztu](pub|prv)[1-9A-HJ-NP-Za-km-z]+$/i.test(s);
}

module.exports = { isLikelyBip32ExtendedKey };
