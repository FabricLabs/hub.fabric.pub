'use strict';

const { plaintextMasterFromStored } = require('./fabricHubLocalIdentity');

/**
 * UI / policy hints for what an in-browser Fabric identity can do.
 * @param {object|null} parsed - Raw `fabric.identity.local` JSON (or null).
 * @returns {object}
 */
function describeFabricIdentityCapabilities (parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return {
      scope: 'none',
      hasHdMasterOnDevice: false,
      canSwitchFabricAccount: false,
      canExportFabricAccountSubtreeBackup: false,
      supportsExternalSigningAttachments: false
    };
  }
  const role = parsed.fabricHdRole != null ? String(parsed.fabricHdRole) : '';
  const mode = parsed.fabricIdentityMode != null ? String(parsed.fabricIdentityMode) : 'legacy';
  const hasMaster = !!plaintextMasterFromStored(parsed);
  const isWatch = role === 'watchAccount';
  const isAccountNode = role === 'accountNode';
  const isAccountMode = mode === 'account';

  return {
    scope: mode,
    fabricHdRole: role || undefined,
    hasHdMasterOnDevice: hasMaster,
    canSwitchFabricAccount:
      isAccountMode && !isAccountNode && !isWatch && hasMaster && !parsed.passwordProtected,
    canExportFabricAccountSubtreeBackup:
      isAccountMode && !isWatch && hasMaster && !parsed.passwordProtected,
    supportsExternalSigningAttachments: false
  };
}

/**
 * Payload encrypted inside fabric-identity-backup v2 files — Fabric account subtree only (no HD master).
 * Caller must supply signing xprv (protocol node m/44'/7778'/n'/0/0).
 */
function buildFabricAccountSubtreeBackupInner ({
  fabricAccountIndex,
  id,
  xpub,
  xprv
}) {
  const ai = fabricAccountIndex != null ? Math.floor(Number(fabricAccountIndex)) : 0;
  if (!Number.isFinite(ai) || ai < 0) throw new Error('Invalid Fabric account index.');
  const xv = String(xprv || '').trim();
  if (!xv) throw new Error('Account signing xprv required for account-subtree backup.');
  return {
    type: 'fabric-identity-backup-inner',
    version: 2,
    backupScope: 'fabricAccountSubtree',
    fabricHdRole: 'accountNode',
    fabricAccountIndex: ai,
    id: id != null ? String(id) : undefined,
    xpub: xpub != null ? String(xpub) : undefined,
    xprv: xv
  };
}

module.exports = {
  describeFabricIdentityCapabilities,
  buildFabricAccountSubtreeBackupInner
};
