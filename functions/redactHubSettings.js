'use strict';

/**
 * Strip secrets from Hub settings before logging.
 *
 * @param {*} settings
 * @returns {*}
 */
function redactHubSettingsForLog (settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = Object.assign({}, settings);
  if (out.key && typeof out.key === 'object') {
    const k = out.key;
    out.key = {
      hasXprv: !!(k.xprv && String(k.xprv).trim()),
      hasSeed: !!(k.seed && String(k.seed).trim()),
      hasMnemonic: !!(k.mnemonic && String(k.mnemonic).trim()),
      hasXpub: !!(k.xpub && String(k.xpub).trim()),
      hasPublic: !!(k.public || k.pubkey),
      hasPassphrase: !!(k.passphrase || k.password)
    };
  }
  if (out.bitcoin && typeof out.bitcoin === 'object') {
    out.bitcoin = Object.assign({}, out.bitcoin);
    if (out.bitcoin.password) out.bitcoin.password = '[redacted]';
    if (out.bitcoin.rpcpassword) out.bitcoin.rpcpassword = '[redacted]';
  }
  return out;
}

module.exports = {
  redactHubSettingsForLog
};
