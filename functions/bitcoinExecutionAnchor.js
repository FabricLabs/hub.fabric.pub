'use strict';

/**
 * Broadcast a 32-byte commitment on regtest using the Hub Bitcoin wallet (OP_RETURN via funded PSBT).
 *
 * @param {object} bitcoin - Hub {@link Bitcoin} service with `_makeRPCRequest`, `_makeWalletRequest`, `network`, `walletName`
 * @param {string} commitmentHex - 64 hex chars (SHA-256 digest)
 * @returns {Promise<{ txid: string, hex: string }>}
 */
async function anchorExecutionCommitmentRegtest (bitcoin, commitmentHex) {
  const h = String(commitmentHex || '').replace(/\s+/g, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) {
    throw new Error('commitmentHex must be 64 hex chars (32-byte digest)');
  }
  if (!bitcoin || bitcoin.network !== 'regtest') {
    throw new Error('execution anchoring is only supported on regtest');
  }
  const walletName = bitcoin.walletName || (bitcoin.settings && bitcoin.settings.walletName) || null;
  if (!walletName || typeof bitcoin._makeWalletRequest !== 'function') {
    throw new Error('Bitcoin named wallet RPC is required for execution anchoring');
  }

  const outputs = [{ data: h }];
  const funded = await bitcoin._makeWalletRequest(
    'walletcreatefundedpsbt',
    [[], outputs, 0, {}, true],
    walletName
  );
  if (!funded || typeof funded.psbt !== 'string' || !funded.psbt) {
    throw new Error('walletcreatefundedpsbt did not return a PSBT');
  }

  const processed = await bitcoin._makeWalletRequest(
    'walletprocesspsbt',
    [funded.psbt, true, 'ALL'],
    walletName
  );
  let hex = processed && typeof processed.hex === 'string' ? processed.hex : '';
  if (!hex && processed && processed.psbt) {
    const fin = await bitcoin._makeWalletRequest('finalizepsbt', [processed.psbt, true], walletName).catch(() => null);
    if (fin && typeof fin.hex === 'string') hex = fin.hex;
  }
  if (!hex) {
    throw new Error(
      processed && processed.complete === false
        ? 'walletprocesspsbt did not complete (wallet may need a funded UTXO on regtest)'
        : 'could not obtain signed transaction hex for anchor'
    );
  }

  const txid = await bitcoin._makeRPCRequest('sendrawtransaction', [hex]);
  return { txid, hex };
}

module.exports = {
  anchorExecutionCommitmentRegtest
};
