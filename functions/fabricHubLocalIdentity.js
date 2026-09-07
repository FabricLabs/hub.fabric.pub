'use strict';

const {
  encryptLocalIdentityMaterial,
  decryptLocalIdentityMaterial,
  LOCAL_IDENTITY_AT_REST_V2
} = require('./fabricLocalIdentityAtRestCrypto');
const Identity = require('@fabric/core/types/identity');
const Key = require('@fabric/core/types/key');
const {
  deriveFabricAccountIdentityKeys,
  fabricRootXpubFromMasterXprv,
  identityFromFabricProtocolSigningXprv
} = require('./fabricAccountDerivedIdentity');

const LOCAL_IDENTITY_PASSWORD_MIN = 8;

function buildLocalFabricIdentityPayload (parsed = {}) {
  if (!parsed || typeof parsed !== 'object') return { resolved: false, record: null };

  try {
    if (parsed.xprv && !parsed.passwordProtected) {
      // Strict model: never treat plaintext on-disk private keys as valid state.
      // Identity-at-rest must be encrypted (passwordProtected) or watch-only (xpub only).
      return { resolved: false, record: null };
    }

    if (parsed.passwordProtected && parsed.id && parsed.xpub && parsed.xprvEnc && parsed.passwordSalt) {
      return {
        resolved: true,
        record: {
          id: parsed.id,
          xpub: parsed.xpub,
          xprv: null,
          passwordProtected: true,
          atRestEncryption: parsed.atRestEncryption || null,
          kdfIterations: parsed.kdfIterations != null ? parsed.kdfIterations : undefined,
          fabricIdentityMode: parsed.fabricIdentityMode === 'account' ? 'account' : 'master',
          fabricHdRole: parsed.fabricHdRole === 'accountNode' ? 'accountNode' : undefined,
          fabricAccountIndex:
            parsed.fabricAccountIndex != null && String(parsed.fabricAccountIndex).trim() !== ''
              ? Math.floor(Number(parsed.fabricAccountIndex))
              : 0,
          plaintextUnlockAvailable: false
        }
      };
    }

    if (parsed.xpub) {
      /** Fabric account-slot xpub-only (watch-only protocol identity). */
      if (parsed.fabricIdentityMode === 'account' && !parsed.xprv) {
        try {
          const key = new Key({ xpub: parsed.xpub });
          const {
            fabricBech32IdFromCompressedPubHex
          } = require('./fabricAccountDerivedIdentity');
          const ai =
            parsed.fabricAccountIndex != null && String(parsed.fabricAccountIndex).trim() !== ''
              ? Math.floor(Number(parsed.fabricAccountIndex))
              : 0;
          return {
            resolved: true,
            record: {
              id: fabricBech32IdFromCompressedPubHex(key.pubkey),
              xpub: key.xpub,
              xprv: null,
              masterXprv: null,
              masterXpub: null,
              fabricIdentityMode: 'account',
              fabricHdRole: 'watchAccount',
              fabricAccountIndex: ai,
              plaintextUnlockAvailable: false,
              passwordProtected: false
            }
          };
        } catch (e) {
          return { resolved: false, record: null, error: String(e.message || e) };
        }
      }

      try {
        const key = new Key({ xpub: parsed.xpub });
        const ident = new Identity(key);
        return {
          resolved: true,
          record: {
            id: ident.id,
            xpub: key.xpub,
            xprv: null,
            fabricIdentityMode: 'master',
            fabricHdRole: 'master',
            fabricAccountIndex: 0,
            plaintextUnlockAvailable: false,
            passwordProtected: false
          }
        };
      } catch (e) {
        return { resolved: false, record: null, error: String(e.message || e) };
      }
    }
  } catch (err) {
    return { resolved: false, record: null, error: String(err.message || err) };
  }
  return { resolved: false, record: null };
}

/** Prefer `masterXprv` then legacy `xprv` for HD master-only storage (plaintext). */
function plaintextMasterFromStored (parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  // Strict model: plaintext key material at rest is unsupported.
  return '';
}

/** Plaintext on disk can unlock signing: HD master (`masterXprv`/`xprv`) or account-node-only `xprv`. */
function fabricPlaintextSigningUnlockable (parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  // Strict model: plaintext key material at rest is unsupported.
  return false;
}

/**
 * Builds in-memory unlocked identity snapshot after decrypt/paste master xprv material.
 * For account mode (`fabricIdentityMode` account), decrypted material is Fabric HD master; signing key is derived.
 */
function unlockedSessionFromDecryptedMaster (decryptedMasterXprv, parsed = {}) {
  const master = String(decryptedMasterXprv || '').trim();
  if (!master) throw new Error('Missing decrypted key material.');
  const pwProt = !!(parsed && parsed.passwordProtected);

  if (parsed && parsed.fabricHdRole === 'accountNode') {
    const mat = identityFromFabricProtocolSigningXprv(master);
    if (parsed.id != null && String(parsed.id).trim() && String(parsed.id).trim() !== String(mat.id)) {
      throw new Error('Imported key does not match stored Fabric identity id.');
    }
    const ai =
      parsed.fabricAccountIndex != null && String(parsed.fabricAccountIndex).trim() !== ''
        ? Math.floor(Number(parsed.fabricAccountIndex))
        : 0;
    return {
      id: mat.id != null ? String(mat.id) : undefined,
      xpub: mat.xpub != null ? String(mat.xpub) : undefined,
      xprv: mat.xprv != null ? String(mat.xprv) : undefined,
      masterXprv: null,
      masterXpub: null,
      fabricIdentityMode: 'account',
      fabricAccountIndex: ai,
      fabricHdRole: 'accountNode',
      passwordProtected: pwProt,
      plaintextUnlockAvailable: false
    };
  }

  if (parsed && parsed.fabricIdentityMode === 'account') {
    const ai =
      parsed.fabricAccountIndex != null && String(parsed.fabricAccountIndex).trim() !== ''
        ? Math.floor(Number(parsed.fabricAccountIndex))
        : 0;
    const dk = deriveFabricAccountIdentityKeys(master, ai, 0);
    const mxp =
      parsed.masterXpub && String(parsed.masterXpub).trim()
        ? String(parsed.masterXpub).trim()
        : fabricRootXpubFromMasterXprv(master);
    return {
      id: dk.id != null ? String(dk.id) : undefined,
      xpub: dk.xpub != null ? String(dk.xpub) : undefined,
      xprv: dk.xprv != null ? String(dk.xprv) : undefined,
      masterXprv: master,
      masterXpub: mxp,
      fabricIdentityMode: 'account',
      fabricAccountIndex: ai,
      fabricHdRole: 'master',
      passwordProtected: pwProt,
      plaintextUnlockAvailable: false
    };
  }
  const ident = new Identity({ xprv: master });
  const key = ident.key;
  return {
    id: ident.id != null ? String(ident.id) : undefined,
    xpub: key.xpub != null ? String(key.xpub) : undefined,
    xprv: master,
    fabricIdentityMode: 'master',
    fabricAccountIndex: 0,
    fabricHdRole: 'master',
    passwordProtected: pwProt,
    plaintextUnlockAvailable: false
  };
}

/**
 * Re-encrypt plaintext key material in `parsed` (localStorage record) with `password`.
 * Strips on-disk xprv / masterXprv; caller should write the return value to storage.
 */
function encryptLocalIdentityAtRest (parsed, password) {
  const pwd = String(password || '').trim();
  if (pwd.length < LOCAL_IDENTITY_PASSWORD_MIN) {
    const err = new Error(`Password must be at least ${LOCAL_IDENTITY_PASSWORD_MIN} characters.`);
    err.code = 'FABRIC_LOCAL_PASSWORD_POLICY';
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.passwordProtected) {
    throw new Error('Cannot encrypt this identity state.');
  }

  if (parsed.fabricHdRole === 'accountNode') {
    const material = String(parsed.xprv || '').trim();
    if (!material) throw new Error('Missing account signing key.');
    const sealed = encryptLocalIdentityMaterial(material, pwd);
    const fabricAccountIndex =
      parsed.fabricAccountIndex != null && String(parsed.fabricAccountIndex).trim() !== ''
        ? Math.floor(Number(parsed.fabricAccountIndex))
        : 0;
    const out = {
      fabricIdentityMode: 'account',
      fabricHdRole: 'accountNode',
      fabricAccountIndex,
      id: parsed.id,
      xpub: parsed.xpub,
      xprvEnc: sealed.xprvEnc,
      passwordSalt: sealed.passwordSalt,
      atRestEncryption: sealed.atRestEncryption,
      kdfIterations: sealed.kdfIterations,
      passwordProtected: true
    };
    if (parsed.linkedFromDesktop) out.linkedFromDesktop = true;
    return out;
  }

  if (parsed.fabricIdentityMode === 'account') {
    const material = String(parsed.masterXprv || parsed.xprv || '').trim();
    if (!material) throw new Error('Missing HD master key.');
    const fabricAccountIndex =
      parsed.fabricAccountIndex != null && String(parsed.fabricAccountIndex).trim() !== ''
        ? Math.floor(Number(parsed.fabricAccountIndex))
        : 0;
    const dk = deriveFabricAccountIdentityKeys(material, fabricAccountIndex, 0);
    const masterXpub =
      parsed.masterXpub && String(parsed.masterXpub).trim()
        ? String(parsed.masterXpub).trim()
        : fabricRootXpubFromMasterXprv(material);
    const sealed = encryptLocalIdentityMaterial(material, pwd);
    const out = {
      fabricIdentityMode: 'account',
      fabricAccountIndex,
      masterXpub,
      id: dk.id,
      xpub: dk.xpub,
      xprvEnc: sealed.xprvEnc,
      passwordSalt: sealed.passwordSalt,
      atRestEncryption: sealed.atRestEncryption,
      kdfIterations: sealed.kdfIterations,
      passwordProtected: true
    };
    if (parsed.linkedFromDesktop) out.linkedFromDesktop = true;
    return out;
  }

  const material = String(parsed.masterXprv || parsed.xprv || '').trim();
  if (!material) throw new Error('Missing extended private key.');
  const ident = new Identity({ xprv: material });
  const sealed = encryptLocalIdentityMaterial(material, pwd);
  const out = {
    fabricIdentityMode: 'master',
    fabricHdRole: 'master',
    fabricAccountIndex: 0,
    id: ident.id,
    xpub: ident.key.xpub,
    xprvEnc: sealed.xprvEnc,
    passwordSalt: sealed.passwordSalt,
    atRestEncryption: sealed.atRestEncryption,
    kdfIterations: sealed.kdfIterations,
    passwordProtected: true
  };
  if (parsed.linkedFromDesktop) out.linkedFromDesktop = true;
  return out;
}

/** Decrypt stored master/signing key material (v2 GCM or legacy CBC). */
function decryptLocalIdentityMasterMaterial (parsed, password) {
  return decryptLocalIdentityMaterial(parsed, password);
}

module.exports = {
  LOCAL_IDENTITY_PASSWORD_MIN,
  buildLocalFabricIdentityPayload,
  plaintextMasterFromStored,
  fabricPlaintextSigningUnlockable,
  unlockedSessionFromDecryptedMaster,
  encryptLocalIdentityAtRest,
  decryptLocalIdentityMasterMaterial,
  deriveFabricAccountIdentityKeys,
  fabricRootXpubFromMasterXprv,
  LOCAL_IDENTITY_AT_REST_V2
};
