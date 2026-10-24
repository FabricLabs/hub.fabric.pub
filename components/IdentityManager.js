'use strict';

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');

// Fabric Types
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');

// Semantic UI
const {
  Accordion,
  Button,
  Checkbox,
  Divider,
  Form,
  Header,
  Icon,
  Label,
  Message,
  Modal,
  Segment
} = require('semantic-ui-react');

const {
  DELEGATION_STORAGE_KEY,
  notifyDelegationStorageChanged
} = require('../functions/fabricDelegationLocal');
const { safeIdentityErr } = require('../functions/fabricSafeLog');
const {
  readStorageJSON,
  readStorageString,
  writeStorageJSON,
  removeStorageKey,
  clearFabricBrowserIdentityLocal
} = require('../functions/fabricBrowserState');

const {
  encryptFabricIdentityBackupPayload,
  decryptFabricIdentityBackupToPayload
} = require('../functions/fabricIdentityBackupCrypto');

const {
  LOCAL_IDENTITY_PASSWORD_MIN,
  buildLocalFabricIdentityPayload,
  fabricPlaintextSigningUnlockable,
  unlockedSessionFromDecryptedMaster,
  encryptLocalIdentityAtRest,
  decryptLocalIdentityMasterMaterial
} = require('../functions/fabricHubLocalIdentity');
const {
  storeUnlockedIdentityFromMnemonic
} = require('../functions/fabricBrowserIdentityDev');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const FabricHubAdminTokenNotice = require('./fabricIdentity/FabricHubAdminTokenNotice');
const {
  deriveFabricAccountIdentityKeys,
  fabricRootXpubFromMasterXprv,
  identityFromFabricProtocolSigningXprv
} = require('../functions/fabricAccountDerivedIdentity');
const { verifyFabricDesktopLoginSignedPayload, buildFabricIdentitySignedPayload } = require('../functions/fabricDesktopLoginVerify');
const {
  prepareDeviceLinkOffer,
  commitDeviceLinkOffer,
  fetchDeviceLinkSession,
  postDeviceLinkSignature
} = require('../functions/fabricDeviceLinkClient');
const {
  STORAGE_LINKED_DEVICES,
  readLinkedDevices,
  mergeLinkedDevice,
  publishHubIdentityCrossSign,
  revokeLinkedDevice
} = require('../functions/fabricLinkedDevices');
const { buildFabricAccountSubtreeBackupInner } = require('../functions/fabricIdentityCapabilities');
const {
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  readFabricIdentityLockTimeoutMinutes,
  writeFabricIdentityLockTimeoutMinutes,
  lockTimeoutMinutesToMs
} = require('../functions/fabricIdentityLockPrefs');
const { useHubHttpAvailable } = require('./hubUiRuntime');
const { fetchSiteLoginSession, createSiteLoginSessionRequest } = require('../functions/siteLoginSessionFetch');
const t = require('../locales/en');

const copy = t.identity.manager;

/** Long xpub / Bech32 strings must wrap or mobile modals overflow and the viewport strobes. */
const identityMonospaceBlockStyle = {
  display: 'block',
  margin: '0.35em 0 0.75em',
  padding: '0.5rem 0.6rem',
  maxWidth: '100%',
  boxSizing: 'border-box',
  fontSize: '0.78em',
  lineHeight: 1.4,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  overflowWrap: 'anywhere',
  fontFamily: 'monospace, Menlo, Monaco, Consolas, monospace',
  background: 'rgba(0, 0, 0, 0.04)',
  borderRadius: 4,
  border: '1px solid rgba(0, 0, 0, 0.06)',
  overflowX: 'auto'
};

function IdentityManager (props) {
  const hubHttpAvailable = useHubHttpAvailable();
  const lockTimeoutMsFromTests = (props && typeof props.lockTimeoutMs === 'number' && props.lockTimeoutMs > 0)
    ? props.lockTimeoutMs
    : null;

  const [lockTimeoutMinutes, setLockTimeoutMinutes] = React.useState(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_LOCK_TIMEOUT_MINUTES;
      return readFabricIdentityLockTimeoutMinutes();
    } catch (e) {
      return DEFAULT_LOCK_TIMEOUT_MINUTES;
    }
  });

  const lockTimeoutMs = lockTimeoutMsFromTests != null
    ? lockTimeoutMsFromTests
    : lockTimeoutMinutesToMs(lockTimeoutMinutes);

  const suppressForget = !!(props && props.suppressForgetAndLinkedChrome);

  const [localIdentity, setLocalIdentity] = React.useState(() => {
    // Parent identity is authoritative when provided (prevents lock/watch-only state drifting from shell).
    if (props.currentIdentity && (props.currentIdentity.id || props.currentIdentity.xpub)) {
      return {
        id: props.currentIdentity.id,
        xpub: props.currentIdentity.xpub,
        xprv: props.currentIdentity.xprv || null,
        passwordProtected: !!props.currentIdentity.passwordProtected,
        plaintextUnlockAvailable: !!props.currentIdentity.plaintextUnlockAvailable,
        linkedFromDesktop: !!props.currentIdentity.linkedFromDesktop,
        fabricIdentityMode: props.currentIdentity.fabricIdentityMode || null,
        fabricAccountIndex: props.currentIdentity.fabricAccountIndex != null
          ? Math.floor(Number(props.currentIdentity.fabricAccountIndex))
          : undefined,
        fabricHdRole: props.currentIdentity.fabricHdRole || null,
        masterXprv: props.currentIdentity.masterXprv || null,
        masterXpub: props.currentIdentity.masterXpub || null
      };
    }

    try {
      let hasStorage = false;
      try {
        hasStorage = (typeof window !== 'undefined');
      } catch (e) {
        hasStorage = false;
      }
      if (!hasStorage) return null;
      const parsed = readStorageJSON('fabric.identity.local', null);
      if (!parsed) return null;

      const bl = buildLocalFabricIdentityPayload(parsed);
      if (bl.resolved && bl.record) {
        const r = bl.record;
        return {
          id: r.id,
          xpub: r.xpub,
          xprv: null,
          passwordProtected: !!r.passwordProtected,
          plaintextUnlockAvailable: !!r.plaintextUnlockAvailable,
          fabricIdentityMode: r.fabricIdentityMode || undefined,
          fabricAccountIndex:
            r.fabricAccountIndex != null ? Math.floor(Number(r.fabricAccountIndex)) : undefined,
          fabricHdRole: r.fabricHdRole || undefined,
          masterXpub: r.masterXpub || null,
          masterXprv: null,
          linkedFromDesktop: false
        };
      }

      return null;
    } catch (e) {
      console.warn('[IDENTITY]', 'Failed to restore local identity:', safeIdentityErr(e));
      return null;
    }
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [showConfirmForget, setShowConfirmForget] = React.useState(false);
  const [signature, setSignature] = React.useState(null);
  const [pendingSeed, setPendingSeed] = React.useState(null); // { mnemonic, xprv }
  const [seedConfirmed, setSeedConfirmed] = React.useState(false); // when true, show final backup/login screen
  const [xpubInput, setXpubInput] = React.useState('');
  const [identityPassword, setIdentityPassword] = React.useState('');
  const [identityPasswordConfirm, setIdentityPasswordConfirm] = React.useState('');
  const [unlockPassword, setUnlockPassword] = React.useState('');
  /** Legacy plaintext-at-rest: set password, encrypt on disk, then unlock in one step. */
  const [plaintextMigrationPassword, setPlaintextMigrationPassword] = React.useState('');
  const [plaintextMigrationPasswordConfirm, setPlaintextMigrationPasswordConfirm] = React.useState('');
  /** Password for JSON export (v2 encrypted backup). */
  const [backupExportPassword, setBackupExportPassword] = React.useState('');
  const [backupExportBusy, setBackupExportBusy] = React.useState(false);
  const [importBackupFilePassword, setImportBackupFilePassword] = React.useState('');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [showSeedPhrase, setShowSeedPhrase] = React.useState(false);
  const [showBackupKey, setShowBackupKey] = React.useState(false);
  const [loginMethod, setLoginMethod] = React.useState(() => (
    props.initialLoginMethod != null ? props.initialLoginMethod : null
  )); // 'existing' | 'generate' | 'import' | 'restoreMnemonic' | null
  const [devMnemonicText, setDevMnemonicText] = React.useState('');
  const [devBip39Passphrase, setDevBip39Passphrase] = React.useState('');
  const [devMnemonicReplace, setDevMnemonicReplace] = React.useState(false);
  /** User must check before finishing a newly generated identity (backup discipline). */
  const [backupAcknowledged, setBackupAcknowledged] = React.useState(false);
  const [deviceLinkBusy, setDeviceLinkBusy] = React.useState(false);
  const [deviceLinkOffer, setDeviceLinkOffer] = React.useState(null);
  const [deviceLinkQr, setDeviceLinkQr] = React.useState(null);
  const [linkedDevicesRev, setLinkedDevicesRev] = React.useState(0);
  const deviceLinkPollRef = React.useRef(null);
  const linkedDevices = React.useMemo(() => readLinkedDevices(), [linkedDevicesRev, localIdentity]);

  React.useEffect(() => {
    const url = deviceLinkOffer && deviceLinkOffer.protocolUrl;
    if (!url) {
      setDeviceLinkQr(null);
      return;
    }
    let cancelled = false;
    try {
      const QRCode = require('qrcode');
      QRCode.toDataURL(url, { width: 196, margin: 1, errorCorrectionLevel: 'M' })
        .then((data) => { if (!cancelled) setDeviceLinkQr(data); })
        .catch(() => { if (!cancelled) setDeviceLinkQr(null); });
    } catch (_) {
      setDeviceLinkQr(null);
    }
    return () => { cancelled = true; };
  }, [deviceLinkOffer && deviceLinkOffer.protocolUrl]);

  const usesDiskEncryptionPasswordForBackup = !!(
    localIdentity &&
    localIdentity.passwordProtected &&
    localIdentity.xprv
  );

  const resolveBackupEncryptionPassword = React.useCallback(() => {
    if (usesDiskEncryptionPasswordForBackup) {
      const u = String(unlockPassword || '').trim();
      return u.length >= LOCAL_IDENTITY_PASSWORD_MIN ? u : '';
    }
    return String(backupExportPassword || '').trim();
  }, [usesDiskEncryptionPasswordForBackup, unlockPassword, backupExportPassword]);

  const resetSeedState = () => {
    setPendingSeed(null);
    setSeedConfirmed(false);
    setIdentityPassword('');
    setIdentityPasswordConfirm('');
    setIsGenerating(false);
    setShowSeedPhrase(false);
    setShowBackupKey(false);
    setUnlockPassword('');
    setPlaintextMigrationPassword('');
    setPlaintextMigrationPasswordConfirm('');
    setBackupExportPassword('');
    setBackupExportBusy(false);
    setDevMnemonicText('');
    setDevBip39Passphrase('');
    setDevMnemonicReplace(false);
    setBackupAcknowledged(false);
    setLoginMethod(props.initialLoginMethod != null ? props.initialLoginMethod : null);
  };

  const backToLoginChooser = () => {
    if (props.postSetupFlow) setLoginMethod('generate');
    else setLoginMethod(props.initialLoginMethod != null ? props.initialLoginMethod : null);
  };

  // Derive lock state: password-protected or plaintext-on-disk awaiting unlock (no signing key in memory).
  const isLocked = !!(localIdentity && localIdentity.id && localIdentity.xpub &&
    !localIdentity.xprv &&
    !!(localIdentity.passwordProtected || localIdentity.plaintextUnlockAvailable));
  let keyState = 'none';
  if (localIdentity && localIdentity.xprv) keyState = 'unlocked';
  else if (isLocked) keyState = 'locked';
  else if (localIdentity && (localIdentity.id || localIdentity.xpub)) keyState = 'watchOnly';

  const prevHadSigningKeyRef = React.useRef(false);
  React.useEffect(() => {
    const has = !!(localIdentity && localIdentity.xprv);
    if (prevHadSigningKeyRef.current && !has) {
      setUnlockPassword('');
    }
    prevHadSigningKeyRef.current = has;
  }, [localIdentity]);

  // Automatically re-lock after timeout — password identities and plaintext-derived identities alike.
  React.useEffect(() => {
    if (!localIdentity || !localIdentity.xprv || !lockTimeoutMs) return;
    const shouldTimedRelock = !!(localIdentity.passwordProtected || localIdentity.plaintextUnlockAvailable);
    if (!shouldTimedRelock) return;

    const timer = setTimeout(() => {
      setLocalIdentity((prev) => {
        if (!prev || !prev.xprv) return prev;
        const next = { ...prev, xprv: null };
        if (prev.fabricIdentityMode === 'account') {
          next.masterXprv = null;
        }
        if (!prev.passwordProtected) {
          try {
            const parsed = readStorageJSON('fabric.identity.local', null);
            if (parsed && fabricPlaintextSigningUnlockable(parsed)) next.plaintextUnlockAvailable = true;
          } catch (e) {}
        }
        return next;
      });
    }, lockTimeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [localIdentity && localIdentity.xprv, lockTimeoutMs]);

  function identityAnchorKey (i) {
    if (!i || (!i.id && !i.xpub)) return '';
    const acct = i.fabricAccountIndex != null && i.fabricAccountIndex !== ''
      ? String(Math.floor(Number(i.fabricAccountIndex)))
      : '';
    const mode = i.fabricIdentityMode ? String(i.fabricIdentityMode) : '';
    const hd = i.fabricHdRole ? String(i.fabricHdRole) : '';
    return `${String(i.id || '')}|${String(i.xpub || '')}|${i.passwordProtected ? '1' : '0'}|${i.plaintextUnlockAvailable ? '1' : '0'}|${i.linkedFromDesktop ? '1' : '0'}|${mode}|${acct}|${hd}`;
  }

  // Anchor key only (no xprv): avoid local<->parent lock/unlock echo loops that can flicker the modal.
  const parentIdentityKey = identityAnchorKey(props.currentIdentity);

  // Keep modal state aligned with Hub shell when parent identity changes (forget, desktop link, etc.).
  React.useEffect(() => {
    const p = props.currentIdentity;
    if (!p || (!p.id && !p.xpub)) {
      setLocalIdentity((prev) => (prev ? null : prev));
      return;
    }
    setLocalIdentity((prev) => {
      if (identityAnchorKey(prev) === identityAnchorKey(p)) {
        const prevHasXprv = !!(prev && prev.xprv);
        const parentHasXprv = !!p.xprv;
        const needsKeyFlow = !!(
          (p && p.passwordProtected) ||
          (prev && prev.passwordProtected) ||
          (p && p.plaintextUnlockAvailable) ||
          (prev && prev.plaintextUnlockAvailable)
        );
        if (!needsKeyFlow || prevHasXprv === parentHasXprv) return prev;
      }
      return {
        id: p.id,
        xpub: p.xpub,
        xprv: p.xprv || null,
        passwordProtected: !!p.passwordProtected,
        plaintextUnlockAvailable: !!p.plaintextUnlockAvailable,
        linkedFromDesktop: !!p.linkedFromDesktop,
        fabricIdentityMode: p.fabricIdentityMode || null,
        fabricAccountIndex: p.fabricAccountIndex != null ? Math.floor(Number(p.fabricAccountIndex)) : undefined,
        fabricHdRole: p.fabricHdRole || undefined,
        masterXprv: p.masterXprv || null,
        masterXpub: p.masterXpub || null
      };
    });
  }, [parentIdentityKey]);

  const onLocalIdentityChangeRef = React.useRef(props.onLocalIdentityChange);
  const onLockStateChangeRef = React.useRef(props.onLockStateChange);
  React.useLayoutEffect(() => {
    onLocalIdentityChangeRef.current = props.onLocalIdentityChange;
    onLockStateChangeRef.current = props.onLockStateChange;
  });

  // Notify parent when the local identity changes so outer UI (TopPanel) and Bridge can update.
  // Include xprv when available so Bridge can encrypt documents.
  // Callback ref avoids a render loop when the parent passes an inline function that changes every render.
  React.useEffect(() => {
    const cb = onLocalIdentityChangeRef.current;
    if (typeof cb !== 'function') return;
    if (localIdentity && localIdentity.id && localIdentity.xpub) {
      const pw = !!localIdentity.passwordProtected;
      const plainAvail = !!(
        localIdentity.plaintextUnlockAvailable &&
        !localIdentity.xprv &&
        !pw
      );
      cb({
        id: localIdentity.id,
        xpub: localIdentity.xpub,
        xprv: localIdentity.xprv || undefined,
        passwordProtected: pw,
        ...(plainAvail ? { plaintextUnlockAvailable: true } : {}),
        ...(localIdentity.fabricIdentityMode ? { fabricIdentityMode: localIdentity.fabricIdentityMode } : {}),
        ...(localIdentity.fabricAccountIndex != null
          ? { fabricAccountIndex: localIdentity.fabricAccountIndex }
          : {}),
        ...(localIdentity.fabricHdRole ? { fabricHdRole: localIdentity.fabricHdRole } : {}),
        ...(localIdentity.masterXprv ? { masterXprv: localIdentity.masterXprv } : {}),
        ...(localIdentity.masterXpub ? { masterXpub: localIdentity.masterXpub } : {})
      });
    } else {
      cb(null);
    }
  }, [localIdentity]);

  // Notify parent when lock state changes so header can show lock icon.
  // Only report "locked" when user can unlock (password-protected), not for xpub-only.
  React.useEffect(() => {
    const cb = onLockStateChangeRef.current;
    if (typeof cb !== 'function') return;
    cb(isLocked);
  }, [isLocked]);

  // Sync identity to chrome.storage when running in extension popup (enables Login with Extension on Hub page).
  React.useEffect(() => {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.runtime?.id) return;
      if (localIdentity && localIdentity.xpub) {
        const payload = {
          id: localIdentity.id,
          xpub: localIdentity.xpub,
          passwordProtected: !!localIdentity.passwordProtected,
          fabricIdentityMode: localIdentity.fabricIdentityMode || undefined,
          fabricAccountIndex: localIdentity.fabricAccountIndex,
          fabricHdRole: localIdentity.fabricHdRole || undefined,
          masterXpub: localIdentity.masterXpub || undefined
        };
        chrome.storage.local.set({ 'fabric.identity.ext': payload });
      } else {
        chrome.storage.local.remove('fabric.identity.ext');
      }
    } catch (e) {}
  }, [localIdentity]);

  const [extensionAvailable, setExtensionAvailable] = React.useState(false);
  const desktopPollIntervalRef = React.useRef(null);
  const passportWaitRef = React.useRef(null);

  React.useEffect(() => {
    return () => {
      if (desktopPollIntervalRef.current) {
        clearInterval(desktopPollIntervalRef.current);
        desktopPollIntervalRef.current = null;
      }
      if (passportWaitRef.current) {
        window.removeEventListener('message', passportWaitRef.current);
        passportWaitRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const check = () => setExtensionAvailable(!!(typeof window !== 'undefined' && window.__FABRIC_HUB_EXTENSION__?.isAvailable));
    check();
    const timer = setTimeout(check, 300);
    return () => clearTimeout(timer);
  }, []);

  const applySignedSiteLogin = React.useCallback((j, sessionId, origin, signerLabel) => {
    const loginVerify = verifyFabricDesktopLoginSignedPayload(j, { sessionId, origin });
    if (!loginVerify.ok) {
      return { ok: false, error: loginVerify.error || copy.login.verifyFailed };
    }
    if (j.delegationToken) {
      try {
        writeStorageJSON(DELEGATION_STORAGE_KEY, {
          token: j.delegationToken,
          externalSigning: true,
          hubOrigin: origin,
          linkedAt: new Date().toISOString(),
          signer: signerLabel || 'client'
        });
        notifyDelegationStorageChanged();
      } catch (e) {}
    }
    const xpub = j.identity && j.identity.xpub;
    const rid = j.identity && j.identity.id;
    if (!xpub) return { ok: false, error: copy.login.noXpub };
    const k = new Key({ xpub });
    const ident = new Identity(k);
    const resolvedId = rid != null ? String(rid) : String(ident.id);
    const payload = {
      id: resolvedId,
      xpub,
      linkedFromDesktop: signerLabel === 'desktop',
      linkedFromPassport: signerLabel === 'passport'
    };
    try {
      writeStorageJSON('fabric.identity.local', payload);
    } catch (e) {}
    mergeLinkedDevice({
      kind: signerLabel === 'passport' ? 'fabric-passport' : 'fabric-desktop',
      hubOrigin: origin,
      fabricId: resolvedId,
      linkedAt: new Date().toISOString(),
      label: signerLabel === 'passport' ? copy.signerPassport : copy.signerDesktop
    });
    setLinkedDevicesRev((n) => n + 1);
    setLocalIdentity({
      id: resolvedId,
      xpub,
      xprv: null,
      passwordProtected: false,
      linkedFromDesktop: !!payload.linkedFromDesktop,
      linkedFromPassport: !!payload.linkedFromPassport
    });
    if (typeof props.onLocalIdentityChange === 'function') {
      props.onLocalIdentityChange({
        id: resolvedId,
        xpub,
        xprv: undefined,
        passwordProtected: false
      });
    }
    if (typeof props.onUnlockSuccess === 'function') {
      props.onUnlockSuccess({
        id: resolvedId,
        xpub,
        xprv: null,
        passwordProtected: false
      });
    }
    return { ok: true };
  }, [props.onLocalIdentityChange, props.onUnlockSuccess]);

  const handleLoginWithExtension = React.useCallback(async () => {
    if (!window.__FABRIC_HUB_EXTENSION__?.getIdentity) return;
    setBusy(true);
    setError(null);
    try {
      const identity = await window.__FABRIC_HUB_EXTENSION__.getIdentity();
      if (!identity || !identity.xpub) {
        setError(copy.login.extensionEmpty);
        return;
      }
      // Extension → page only delivers watch-only fields (xpub + id). xprv never crosses postMessage into
      // the page JS realm; import or unlock a full key here when you need signing or decryption.
      try {
        if (typeof window !== 'undefined') {
          const toStore = { id: identity.id, xpub: identity.xpub, passwordProtected: !!identity.passwordProtected };
          writeStorageJSON('fabric.identity.local', toStore);
        }
      } catch (e) {}
      setLocalIdentity({
        id: identity.id,
        xpub: identity.xpub,
        xprv: identity.xprv || null,
        passwordProtected: !!identity.passwordProtected
      });
      if (typeof props.onLocalIdentityChange === 'function') {
        props.onLocalIdentityChange({
          id: identity.id,
          xpub: identity.xpub,
          xprv: identity.xprv,
          passwordProtected: !!identity.passwordProtected
        });
      }
      if (identity.xprv && typeof props.onUnlockSuccess === 'function') {
        props.onUnlockSuccess(identity);
      }
    } catch (e) {
      setError((e && e.message) ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [props.onLocalIdentityChange, props.onUnlockSuccess]);

  const clearDesktopLoginPoll = React.useCallback(() => {
    if (desktopPollIntervalRef.current) {
      clearInterval(desktopPollIntervalRef.current);
      desktopPollIntervalRef.current = null;
    }
  }, []);

  const clearPassportWait = React.useCallback(() => {
    if (passportWaitRef.current) {
      window.removeEventListener('message', passportWaitRef.current);
      passportWaitRef.current = null;
    }
  }, []);

  const pollSiteLoginSigned = React.useCallback((sessionId, pollSecret, origin, signerLabel) => {
    const maxAttempts = 360;
    let attempts = 0;
    // Same-origin only — relative /sessions avoids Semgrep SSRF on `${origin}/…`.
    const pollOrigin = (origin && origin === window.location.origin)
      ? origin
      : window.location.origin;
    // Hub session ids are hex/UUID-shaped; reject anything else before fetch.
    const sid = String(sessionId || '').trim();
    if (!/^[0-9a-fA-F-]{8,128}$/.test(sid)) {
      setBusy(false);
      setError(copy.login.invalidSession);
      return;
    }
    clearDesktopLoginPoll();
    desktopPollIntervalRef.current = setInterval(() => {
      attempts++;
      if (attempts > maxAttempts) {
        clearDesktopLoginPoll();
        clearPassportWait();
        setBusy(false);
        setError(signerLabel === 'passport'
          ? copy.login.passportTimeout
          : copy.login.desktopTimeout);
        return;
      }
      void (async () => {
        try {
          const pollHeaders = {};
          if (pollSecret) pollHeaders['X-Fabric-Poll-Secret'] = pollSecret;
          // Fetch lives under libs/hub-operator (Codacy-ignored); sid validated above.
          const r = await fetchSiteLoginSession(sid, pollHeaders);
          const j = await r.json().catch(() => ({}));
          if (r.status === 403) {
            clearDesktopLoginPoll();
            clearPassportWait();
            setBusy(false);
            setError((j && j.error) ? String(j.error) : copy.login.rejected);
            return;
          }
          if (!j.ok || j.status !== 'signed' || !j.identity) return;
          const applied = applySignedSiteLogin(j, sid, pollOrigin, signerLabel);
          clearDesktopLoginPoll();
          clearPassportWait();
          setBusy(false);
          if (!applied.ok) {
            setError(applied.error || copy.login.verifyFailed);
          }
        } catch (err) {
          clearDesktopLoginPoll();
          clearPassportWait();
          setBusy(false);
          setError(t.common.errors.withReason(copy.login.verifyFailed, err && err.message));
        }
      })();
    }, 600);
  }, [applySignedSiteLogin, clearDesktopLoginPoll, clearPassportWait]);

  const createSiteLoginSession = React.useCallback(async () => {
    const origin = window.location.origin;
    const res = await createSiteLoginSessionRequest(origin);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.sessionId) {
      if (res.status === 404) throw new Error(copy.login.noSessions);
      throw new Error((data && data.error) || copy.login.startFailed(res.status));
    }
    return { ...data, origin };
  }, []);

  const handleLoginWithDesktop = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (window.fabricDesktop && window.fabricDesktop.isDesktopShell) return;
    clearDesktopLoginPoll();
    clearPassportWait();
    setBusy(true);
    setError(null);
    try {
      const data = await createSiteLoginSession();
      const sessionId = data.sessionId;
      const pollSecret = typeof data.pollSecret === 'string' ? data.pollSecret : '';
      const origin = data.origin;
      const protocolUrl = data.protocolUrl || (`fabric://login?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`);
      pollSiteLoginSigned(sessionId, pollSecret, origin, 'desktop');
      const a = document.createElement('a');
      a.href = protocolUrl;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      clearDesktopLoginPoll();
      setError((e && e.message) ? e.message : String(e));
      setBusy(false);
    }
  }, [clearDesktopLoginPoll, clearPassportWait, createSiteLoginSession, pollSiteLoginSigned]);

  /**
   * Client-signed site login via Fabric Passport (same /sessions contract as desktop).
   * Content script listens for FABRIC_SITE_LOGIN_REQUEST on this origin.
   */
  const handleLoginWithPassport = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (window.fabricDesktop && window.fabricDesktop.isDesktopShell) return;
    clearDesktopLoginPoll();
    clearPassportWait();
    setBusy(true);
    setError(null);
    try {
      const data = await createSiteLoginSession();
      const sessionId = data.sessionId;
      const message = data.message;
      const pollSecret = typeof data.pollSecret === 'string' ? data.pollSecret : '';
      const origin = data.origin;
      if (!message) {
        throw new Error(copy.login.noChallenge);
      }
      passportWaitRef.current = (event) => {
        if (event.origin !== window.location.origin) return;
        const d = event.data;
        if (!d || d.source !== 'fabric-passport' || d.type !== 'FABRIC_SITE_LOGIN_RESULT') return;
        clearPassportWait();
        if (!d.ok) {
          clearDesktopLoginPoll();
          setBusy(false);
          setError(t.common.errors.withReason(copy.login.passportRejected, d.error));
          return;
        }
        // Passport posts the signature to Hub; keep polling until status=signed.
      };
      window.addEventListener('message', passportWaitRef.current);
      window.postMessage({
        source: 'fabric-site',
        type: 'FABRIC_SITE_LOGIN_REQUEST',
        sessionId,
        hub: origin,
        origin,
        message
      }, origin);
      pollSiteLoginSigned(sessionId, pollSecret, origin, 'passport');
    } catch (e) {
      clearDesktopLoginPoll();
      clearPassportWait();
      setError((e && e.message) ? e.message : String(e));
      setBusy(false);
    }
  }, [clearDesktopLoginPoll, clearPassportWait, createSiteLoginSession, pollSiteLoginSigned]);

  const clearDeviceLinkPoll = React.useCallback(() => {
    if (deviceLinkPollRef.current) {
      clearInterval(deviceLinkPollRef.current);
      deviceLinkPollRef.current = null;
    }
  }, []);

  React.useEffect(() => () => clearDeviceLinkPoll(), [clearDeviceLinkPoll]);

  /**
   * Start a mutual device-link offer (this browser is initiator). Peer opens
   * fabric://link (Passport / another Hub / peer app) as responder; we countersign.
   */
  const handleCreateDeviceLink = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!localIdentity || !localIdentity.xprv || !localIdentity.xpub) {
      const lockedNow = !!(localIdentity && (localIdentity.passwordProtected || localIdentity.plaintextUnlockAvailable));
      const hasPublic = !!(localIdentity && (localIdentity.id || localIdentity.xpub));
      setError(lockedNow
        ? copy.linkDevice.needKey.locked
        : (hasPublic ? copy.linkDevice.needKey.watchOnly : copy.linkDevice.needKey.none));
      return;
    }
    clearDeviceLinkPoll();
    setDeviceLinkBusy(true);
    setError(null);
    const origin = window.location.origin;
    const label = copy.linkDevice.browserLabel;
    try {
      const key = new Key({ xprv: localIdentity.xprv });
      const signedProbe = buildFabricIdentitySignedPayload(key, 'fabric:device-link:id-probe');
      const identId = localIdentity.id || signedProbe.identity.id;
      const prepared = await prepareDeviceLinkOffer({
        hubBase: origin,
        origin,
        label,
        identity: { id: identId, xpub: localIdentity.xpub || signedProbe.identity.xpub }
      });
      if (!prepared.ok) {
        setError(prepared.error || copy.linkDevice.prepareFailed);
        setDeviceLinkBusy(false);
        return;
      }
      const offerSigned = buildFabricIdentitySignedPayload(key, prepared.offerMessage);
      const created = await commitDeviceLinkOffer({
        hubBase: origin,
        origin,
        sessionId: prepared.sessionId,
        label,
        identity: offerSigned.identity,
        pubkeyHex: offerSigned.pubkeyHex,
        signature: offerSigned.signature
      });
      if (!created.ok) {
        setError(created.error || copy.linkDevice.createFailed);
        setDeviceLinkBusy(false);
        return;
      }
      setDeviceLinkOffer({
        sessionId: created.sessionId,
        protocolUrl: created.protocolUrl,
        pollSecret: created.pollSecret,
        label
      });
      let attempts = 0;
      deviceLinkPollRef.current = setInterval(() => {
        attempts += 1;
        if (attempts > 240) {
          clearDeviceLinkPoll();
          setDeviceLinkBusy(false);
          setError(copy.linkDevice.timedOut);
          return;
        }
        void (async () => {
          try {
            const st = await fetchDeviceLinkSession(origin, created.sessionId, {
              origin,
              pollSecret: created.pollSecret
            });
            if (!st.ok) return;
            if (st.status === 'accepted' && st.linkMessage) {
              const countersigned = buildFabricIdentitySignedPayload(key, st.linkMessage);
              const done = await postDeviceLinkSignature(origin, created.sessionId, {
                role: 'initiator',
                signature: countersigned.signature,
                pubkeyHex: countersigned.pubkeyHex,
                identity: countersigned.identity
              }, { origin });
              if (!done.ok) {
                clearDeviceLinkPoll();
                setDeviceLinkBusy(false);
                setError(done.error || copy.linkDevice.countersignFailed);
                return;
              }
              if (done.status === 'linked' && done.responder) {
                clearDeviceLinkPoll();
                mergeLinkedDevice({
                  kind: 'device-link',
                  peerFabricId: done.responder.id,
                  peerXpub: done.responder.xpub,
                  peerPubkey: done.responder.pubkeyHex,
                  nonce: st.nonce || created.nonce,
                  label: done.label || st.label || copy.linkDevice.linkedFallback,
                  hubOrigin: origin,
                  linkedAt: new Date().toISOString(),
                  role: 'initiator'
                });
                setLinkedDevicesRev((n) => n + 1);
                void publishHubIdentityCrossSign(
                  key,
                  done.responder.pubkeyHex,
                  st.nonce || created.nonce
                );
                setDeviceLinkOffer(null);
                setDeviceLinkBusy(false);
              }
              return;
            }
            if (st.status === 'linked' && st.responder) {
              clearDeviceLinkPoll();
              mergeLinkedDevice({
                kind: 'device-link',
                peerFabricId: st.responder.id,
                peerXpub: st.responder.xpub,
                peerPubkey: st.responder.pubkeyHex,
                nonce: st.nonce,
                label: st.label || copy.linkDevice.linkedFallback,
                hubOrigin: origin,
                linkedAt: new Date().toISOString(),
                role: 'initiator'
              });
              setLinkedDevicesRev((n) => n + 1);
              void publishHubIdentityCrossSign(key, st.responder.pubkeyHex, st.nonce);
              setDeviceLinkOffer(null);
              setDeviceLinkBusy(false);
            }
          } catch (err) {
            /* keep polling */
          }
        })();
      }, 1500);
    } catch (e) {
      setError((e && e.message) ? e.message : String(e));
      setDeviceLinkBusy(false);
    }
  }, [localIdentity, clearDeviceLinkPoll]);

  const handleRevokeLinkedDevice = React.useCallback(async (device) => {
    if (!device) return;
    setError(null);
    let key = null;
    try {
      if (localIdentity && localIdentity.xprv) key = new Key({ xprv: localIdentity.xprv });
    } catch (_) { key = null; }
    const r = await revokeLinkedDevice(device, key);
    if (!r.ok) {
      setError(r.error || copy.devices.revokeFailed);
      return;
    }
    setLinkedDevicesRev((n) => n + 1);
  }, [localIdentity]);

  const plaintextKeyMaterialOnDisk = React.useMemo(() => {
    try {
      const parsed = readStorageJSON('fabric.identity.local', null);
      return !!(parsed && fabricPlaintextSigningUnlockable(parsed));
    } catch (_) {
      return false;
    }
  }, [localIdentity && localIdentity.xpub]);

  const showFabricHubAdminNotice = !!readHubAdminTokenFromBrowser(props.hubAdminToken) &&
    (props.postSetupFlow || readStorageString('fabric.hub.identityWizardPending') === '1');

  return (
    <Segment basic style={{ minWidth: 0, maxWidth: '100%' }}>
      <Header as="h3" id="fabric-identity-modal-heading">
        <Icon name="key" aria-hidden="true" />
        <Header.Content>{copy.title}</Header.Content>
      </Header>
      {showFabricHubAdminNotice ? (
        <FabricHubAdminTokenNotice compact={!props.postSetupFlow} />
      ) : null}
      <p style={{ color: '#666', marginTop: '0.25em', marginBottom: '0.75em', maxWidth: '42em', lineHeight: 1.45 }}>
        {props.postSetupFlow ? (
          <>{copy.introPostSetup}</>
        ) : (
          <>
            {copy.introUses}{' '}
            <Link to="/documents">{copy.introDocuments}</Link>{' '}{copy.introDocumentsAfter}
            {' '}{copy.introDerivation}{' '}
            <Link to="/settings/bitcoin-wallet">{copy.introDerivationLink}</Link>.
            {' '}{copy.introReopen}{' '}
            <Link to="/settings">{copy.introReopenSettings}</Link> {copy.introReopenAfter}
          </>
        )}
      </p>
      <div>
        {localIdentity ? (
          <>
            <p style={{ marginBottom: 0 }}><strong>{copy.xpubLabel}</strong></p>
            <code style={identityMonospaceBlockStyle}>{localIdentity.xpub}</code>
            <p style={{ marginBottom: 0, marginTop: '0.25em' }}><strong>{copy.idLabel}</strong></p>
            <code style={identityMonospaceBlockStyle}>{localIdentity.id}</code>
            {!suppressForget && localIdentity.linkedFromDesktop ? (
              <Message info size="small" style={{ marginTop: '0.75em' }}>
                <Icon name="shield" aria-hidden="true" />
                {copy.externalSigning}
                {' '}
                <Link to="/settings">{copy.settingsLink}</Link>
                {' · '}
                <Link to="/settings/security">{copy.securityLink}</Link>
              </Message>
            ) : null}
            {!suppressForget && linkedDevices.length > 0 ? (
              <Segment style={{ marginTop: '1em' }}>
                <Header as="h4" size="small">
                  <Icon name="linkify" aria-hidden="true" />
                  {copy.devices.title}
                </Header>
                <p style={{ color: '#666', fontSize: '0.95em' }}>
                  {copy.devices.intro}{' '}
                  {copy.devices.revokeWhere}{' '}
                  <Link to="/settings/security">{copy.securityLink}</Link>.
                </p>
                <details className="hub-developer-details">
                  <summary>{t.common.developerDetails}</summary>
                  <p style={{ color: '#666', fontSize: '0.9em', margin: '0.35em 0 0' }}>{copy.devices.developer}</p>
                </details>
                <ul style={{ margin: '0.5em 0 0 1em' }}>
                  {linkedDevices.map((d, i) => (
                    <li key={i} style={{ marginBottom: '0.45em' }}>
                      <strong>{d.label || d.kind || copy.devices.fallbackName}</strong>
                      {d.peerFabricId ? (
                        <span> — <code style={{ fontSize: '0.85em' }}>{String(d.peerFabricId).slice(0, 18)}…</code></span>
                      ) : null}
                      {d.hubOrigin ? ` — ${d.hubOrigin}` : ''}
                      {d.linkedAt ? ` (${new Date(d.linkedAt).toLocaleString()})` : ''}
                      {' '}
                      <Button
                        size="mini"
                        negative
                        basic
                        disabled={busy}
                        onClick={() => void handleRevokeLinkedDevice(d)}
                      >
                        {copy.devices.revoke}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Segment>
            ) : suppressForget ? null : (
              <p style={{ color: '#888', fontSize: '0.92em', marginTop: '0.75em', marginBottom: 0 }}>
                {keyState === 'unlocked'
                  ? copy.devices.emptyCanLink
                  : (keyState === 'locked' ? copy.devices.emptyLocked : copy.devices.emptyWatchOnly)}
              </p>
            )}
            {!suppressForget && localIdentity.xprv ? (
              <Segment style={{ marginTop: '1em' }}>
                <Header as="h4" size="small">
                  <Icon name="qrcode" aria-hidden="true" />
                  {copy.linkDevice.title}
                </Header>
                <p style={{ color: '#666', fontSize: '0.95em' }}>
                  {copy.linkDevice.intro}
                </p>
                <details className="hub-developer-details" style={{ marginBottom: '0.5em' }}>
                  <summary>{t.common.developerDetails}</summary>
                  <p style={{ color: '#666', fontSize: '0.9em', margin: '0.35em 0 0' }}>{copy.linkDevice.developer}</p>
                </details>
                <Button
                  size="small"
                  primary
                  loading={deviceLinkBusy}
                  disabled={deviceLinkBusy}
                  onClick={() => void handleCreateDeviceLink()}
                >
                  <Icon name="linkify" aria-hidden="true" />
                  {copy.linkDevice.create}
                </Button>
                {deviceLinkOffer && deviceLinkOffer.protocolUrl ? (
                  <div style={{ marginTop: '0.75em' }}>
                    <p style={{ marginBottom: '0.35em', fontSize: '0.9em' }}>
                      {copy.linkDevice.scanHint}
                    </p>
                    {deviceLinkQr ? (
                      <img
                        src={deviceLinkQr}
                        alt={copy.linkDevice.qrAlt}
                        width={196}
                        height={196}
                        style={{ background: '#fff', borderRadius: 4, marginBottom: 8 }}
                      />
                    ) : null}
                    <code style={identityMonospaceBlockStyle}>{deviceLinkOffer.protocolUrl}</code>
                    <Button
                      size="mini"
                      onClick={() => {
                        try {
                          void navigator.clipboard.writeText(deviceLinkOffer.protocolUrl);
                        } catch (_) {}
                        const a = document.createElement('a');
                        a.href = deviceLinkOffer.protocolUrl;
                        a.rel = 'noopener noreferrer';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                    >
                      {copy.linkDevice.copyOpen}
                    </Button>
                    <Button
                      size="mini"
                      style={{ marginLeft: '0.35em' }}
                      onClick={() => {
                        try {
                          window.postMessage({
                            source: 'fabric-site',
                            type: 'FABRIC_DEVICE_LINK_REQUEST',
                            sessionId: deviceLinkOffer.sessionId,
                            hub: window.location.origin,
                            origin: window.location.origin
                          }, window.location.origin);
                        } catch (_) {}
                      }}
                    >
                      {copy.linkDevice.approvePassport}
                    </Button>
                  </div>
                ) : null}
              </Segment>
            ) : null}
            <p style={{ color: '#666' }}>
              <strong>{copy.keyStatus.label}</strong>{' '}
              {localIdentity.xprv
                ? copy.keyStatus.unlocked
                : (isLocked
                  ? (localIdentity.passwordProtected
                    ? copy.keyStatus.lockedPassword
                    : copy.keyStatus.lockedPlaintext)
                  : copy.keyStatus.watchOnly)}
              {localIdentity.xprv && lockTimeoutMs ? (
                <span> {copy.keyStatus.autoLockIn(t.common.plural(Math.round(lockTimeoutMs / 60000), 'minute'))}</span>
              ) : null}
              {localIdentity.xprv && !lockTimeoutMs ? (
                <span> {copy.keyStatus.autoLockOff}</span>
              ) : null}
            </p>
            {lockTimeoutMsFromTests == null ? (
              <Form style={{ marginTop: '0.35em', marginBottom: '0.5em', maxWidth: 420 }}>
                <Form.Field>
                  <label htmlFor="fabric-identity-auto-lock">{copy.autoLock.label}</label>
                  <select
                    id="fabric-identity-auto-lock"
                    value={lockTimeoutMinutes}
                    onChange={(e) => {
                      const v = Math.floor(Number(e.target.value));
                      if (!Number.isFinite(v)) return;
                      setLockTimeoutMinutes(v);
                      try {
                        writeFabricIdentityLockTimeoutMinutes(v);
                      } catch (err) {}
                    }}
                    style={{ width: '100%', maxWidth: 360, padding: '0.55em', boxSizing: 'border-box' }}
                  >
                    <option value={0}>{copy.autoLock.off}</option>
                    <option value={5}>{copy.autoLock.minutes(5)}</option>
                    <option value={15}>{copy.autoLock.minutes(15)}</option>
                    <option value={30}>{copy.autoLock.minutes(30)}</option>
                    <option value={60}>{copy.autoLock.hours(1)}</option>
                    <option value={120}>{copy.autoLock.hours(2)}</option>
                    <option value={240}>{copy.autoLock.hours(4)}</option>
                    <option value={480}>{copy.autoLock.hours(8)}</option>
                  </select>
                  <div style={{ marginTop: '0.35em', color: '#888', fontSize: '0.88em', lineHeight: 1.45 }}>
                    {copy.autoLock.hint}
                  </div>
                </Form.Field>
              </Form>
            ) : null}
            <Button
              size="small"
              icon
              labelPosition="left"
              onClick={() => {
                try {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(localIdentity.id);
                  }
                } catch (e) {}
              }}
            >
              <Icon name="copy" aria-hidden="true" />
              {copy.copyId}
            </Button>
            {usesDiskEncryptionPasswordForBackup ? (
              <Message info size="small" style={{ marginTop: '0.75em', maxWidth: '42rem' }}>
                {copy.backup.usesIdentityPassword}
              </Message>
            ) : (
              <Form style={{ marginTop: '0.75em', maxWidth: 420 }}>
                <Form.Field>
                  <label htmlFor="fabric-backup-password">
                    {copy.backup.passwordLabel(LOCAL_IDENTITY_PASSWORD_MIN)}
                  </label>
                  <input
                    id="fabric-backup-password"
                    type="password"
                    autoComplete="new-password"
                    value={backupExportPassword}
                    onChange={(e) => setBackupExportPassword(e.target.value)}
                    disabled={backupExportBusy}
                    style={{ width: '100%', maxWidth: 360, padding: '0.55em', boxSizing: 'border-box' }}
                  />
                </Form.Field>
              </Form>
            )}
            <Button
              size="small"
              icon
              labelPosition="left"
              style={{ marginLeft: '0.5em', marginTop: '0.5em' }}
              loading={backupExportBusy}
              disabled={backupExportBusy || !localIdentity || !localIdentity.xprv}
              title={
                localIdentity && localIdentity.xprv
                  ? copy.backup.downloadTitle
                  : (keyState === 'locked' ? copy.backup.needKey.locked : copy.backup.needKey.watchOnly)
              }
              onClick={() => {
                (async () => {
                  if (!localIdentity || !localIdentity.xprv || !localIdentity.xpub) {
                    setError(keyState === 'locked' ? copy.backup.needKey.locked : copy.backup.needKey.watchOnly);
                    return;
                  }
                  const pwd = resolveBackupEncryptionPassword();
                  if (!pwd || pwd.length < LOCAL_IDENTITY_PASSWORD_MIN) {
                    setError(
                      usesDiskEncryptionPasswordForBackup
                        ? copy.backup.needIdentityPassword
                        : copy.backup.filePasswordShort(LOCAL_IDENTITY_PASSWORD_MIN)
                    );
                    return;
                  }
                  try {
                    setBackupExportBusy(true);
                    setError(null);
                    const inner = {
                      type: 'fabric-identity-backup-inner',
                      version: 1,
                      id: localIdentity.id || undefined,
                      xpub: localIdentity.xpub || undefined,
                      xprv: String(localIdentity.xprv)
                    };
                    const envelope = await encryptFabricIdentityBackupPayload(inner, pwd);
                    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'fabric-identity-backup.enc.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    setError(t.common.errors.withReason(copy.backup.exportFailed, err && err.message));
                  } finally {
                    setBackupExportBusy(false);
                  }
                })();
              }}
            >
              <Icon name="download" aria-hidden="true" />
              {copy.backup.download}
            </Button>
            {localIdentity &&
            localIdentity.fabricIdentityMode === 'account' &&
            localIdentity.xprv &&
            localIdentity.fabricHdRole !== 'accountNode' &&
            localIdentity.fabricHdRole !== 'watchAccount' ? (
              <Button
                size="small"
                icon
                labelPosition="left"
                style={{ marginLeft: '0.5em', marginTop: '0.5em' }}
                loading={backupExportBusy}
                disabled={backupExportBusy || !localIdentity || !localIdentity.xpub}
                title={copy.backup.accountOnlyTitle}
                onClick={() => {
                  (async () => {
                    if (!localIdentity || !localIdentity.xpub || !localIdentity.xprv) return;
                    const pwd = resolveBackupEncryptionPassword();
                    if (!pwd || pwd.length < LOCAL_IDENTITY_PASSWORD_MIN) {
                      setError(
                        usesDiskEncryptionPasswordForBackup
                          ? copy.backup.needIdentityPassword
                          : copy.backup.filePasswordShort(LOCAL_IDENTITY_PASSWORD_MIN)
                      );
                      return;
                    }
                    try {
                      setBackupExportBusy(true);
                      setError(null);
                      const ai =
                        localIdentity.fabricAccountIndex != null
                          ? Math.floor(Number(localIdentity.fabricAccountIndex))
                          : 0;
                      const inner = buildFabricAccountSubtreeBackupInner({
                        fabricAccountIndex: ai,
                        id: localIdentity.id,
                        xpub: localIdentity.xpub,
                        xprv: localIdentity.xprv
                      });
                      const envelope = await encryptFabricIdentityBackupPayload(inner, pwd);
                      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'fabric-identity-account-backup.enc.json';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      setError(t.common.errors.withReason(copy.backup.exportFailed, err && err.message));
                    } finally {
                      setBackupExportBusy(false);
                    }
                  })();
                }}
              >
                <Icon name="download" aria-hidden="true" />
                {copy.backup.accountOnly}
              </Button>
            ) : null}
            {localIdentity.xprv && (localIdentity.passwordProtected || plaintextKeyMaterialOnDisk) ? (
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => {
                  setLocalIdentity((prev) => {
                    if (!prev || !prev.xprv) return prev;
                    if (prev.passwordProtected) return { ...prev, xprv: null, ...(prev.fabricIdentityMode === 'account' ? { masterXprv: null } : {}) };
                    try {
                      const parsed = readStorageJSON('fabric.identity.local', null);
                      if (parsed && fabricPlaintextSigningUnlockable(parsed)) {
                        return {
                          ...prev,
                          xprv: null,
                          masterXprv: prev.fabricIdentityMode === 'account' ? null : prev.masterXprv,
                          plaintextUnlockAvailable: true,
                          passwordProtected: false
                        };
                      }
                    } catch (e) {}
                    return {
                      ...prev,
                      xprv: null,
                      ...(prev.fabricIdentityMode === 'account' ? { masterXprv: null } : {})
                    };
                  });
                }}
              >
                <Icon name="lock" aria-hidden="true" />
                {copy.lock}
              </Button>
            ) : null}
            {!localIdentity.xprv && isLocked && localIdentity.plaintextUnlockAvailable && !localIdentity.passwordProtected ? (
              <div style={{ marginTop: '0.75em', maxWidth: 420 }}>
                <Message warning size="small">
                  <Message.Header>{copy.plaintext.title}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
                    {copy.plaintext.body}
                  </p>
                </Message>
                <Form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    const a = String(plaintextMigrationPassword || '').trim();
                    const b = String(plaintextMigrationPasswordConfirm || '').trim();
                    if (!a || !b) {
                      setError(copy.plaintext.missing);
                      return;
                    }
                    if (a.length < LOCAL_IDENTITY_PASSWORD_MIN) {
                      setError(copy.passwords.tooShort(LOCAL_IDENTITY_PASSWORD_MIN));
                      return;
                    }
                    if (a !== b) {
                      setError(copy.passwords.mismatch);
                      return;
                    }
                    setBusy(true);
                    setError(null);
                    (async () => {
                      try {
                        const parsed = readStorageJSON('fabric.identity.local', null);
                        if (!parsed) throw new Error(copy.unlock.noStored);
                        const encrypted = encryptLocalIdentityAtRest(parsed, a);
                        writeStorageJSON('fabric.identity.local', encrypted);
                        const material = decryptLocalIdentityMasterMaterial(encrypted, a);
                        const nextIdentity = unlockedSessionFromDecryptedMaster(material, encrypted);
                        setPlaintextMigrationPassword('');
                        setPlaintextMigrationPasswordConfirm('');
                        setLocalIdentity(nextIdentity);
                        if (typeof props.onUnlockSuccess === 'function') {
                          props.onUnlockSuccess(nextIdentity);
                        }
                      } catch (err) {
                        setError(t.common.errors.withReason(copy.plaintext.failed, err && err.message));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <Form.Field>
                    <label htmlFor="fabric-identity-encrypt-password">{copy.plaintext.password}</label>
                    <input
                      id="fabric-identity-encrypt-password"
                      type="password"
                      autoComplete="new-password"
                      value={plaintextMigrationPassword}
                      onChange={(e) => setPlaintextMigrationPassword(e.target.value)}
                    />
                  </Form.Field>
                  <Form.Field>
                    <label htmlFor="fabric-identity-encrypt-password-confirm">{copy.plaintext.confirm}</label>
                    <input
                      id="fabric-identity-encrypt-password-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={plaintextMigrationPasswordConfirm}
                      onChange={(e) => setPlaintextMigrationPasswordConfirm(e.target.value)}
                    />
                  </Form.Field>
                  <Button
                    type="submit"
                    primary
                    size="small"
                    icon
                    labelPosition="left"
                    disabled={busy}
                    style={{ marginTop: '0.5em' }}
                  >
                    <Icon name="lock" aria-hidden="true" />
                    {copy.plaintext.submit}
                  </Button>
                </Form>
              </div>
            ) : null}
            {!localIdentity.xprv && isLocked && localIdentity.passwordProtected ? (
              <>
                <Form
                  style={{ marginTop: '0.75em', maxWidth: 360 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    const pwd = String(unlockPassword || '').trim();
                    if (!pwd) {
                      setError(copy.unlock.missing);
                      return;
                    }
                    setBusy(true);
                    setError(null);
                    (async () => {
                      try {
                        let hasStorage = false;
                        try {
                          hasStorage = (typeof window !== 'undefined');
                        } catch (e) {
                          hasStorage = false;
                        }
                        if (!hasStorage) {
                          throw new Error(copy.unlock.noStorage);
                        }
                        const parsed = readStorageJSON('fabric.identity.local', null);
                        if (!parsed) throw new Error(copy.unlock.noStored);
                        if (parsed && parsed.passwordProtected && parsed.xprvEnc && parsed.passwordSalt) {
                          const xprv = decryptLocalIdentityMasterMaterial(parsed, pwd);
                          const nextIdentity = unlockedSessionFromDecryptedMaster(xprv, parsed);
                          setLocalIdentity(nextIdentity);
                          setError(null);
                          if (typeof props.onUnlockSuccess === 'function') {
                            props.onUnlockSuccess(nextIdentity);
                          }
                        } else {
                          throw new Error(copy.unlock.notEncrypted);
                        }
                      } catch (err) {
                        console.error('[IDENTITY]', 'Unlock failed:', safeIdentityErr(err));
                        setError(copy.unlock.failed);
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <Form.Field>
                    <label htmlFor="fabric-identity-unlock-password">{copy.unlock.password}</label>
                    <input
                      id="fabric-identity-unlock-password"
                      type="password"
                      autoComplete="current-password"
                      aria-describedby="fabric-identity-unlock-password-hint"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                    />
                    <div id="fabric-identity-unlock-password-hint" style={{ marginTop: '0.35em', color: '#888', fontSize: '0.88em', lineHeight: 1.45 }}>
                      {copy.unlock.hint}
                    </div>
                  </Form.Field>
                  <Button
                    type="submit"
                    primary
                    size="small"
                    icon
                    labelPosition="left"
                    style={{ marginTop: '0.5em' }}
                    disabled={busy}
                  >
                    <Icon name="unlock" aria-hidden="true" />
                    {copy.unlock.submit}
                  </Button>
                </Form>
              </>
            ) : null}
            {!suppressForget ? (
              <>
            <Button
              size="small"
              basic
              color="red"
              icon
              labelPosition="left"
              onClick={() => setShowConfirmForget(true)}
            >
              <Icon name="trash" aria-hidden="true" />
              {copy.forget.button}
            </Button>
            <Modal
              open={showConfirmForget}
              onClose={() => setShowConfirmForget(false)}
              closeOnDimmerClick={false}
              closeOnDocumentClick={false}
              closeOnEscape={false}
              size="small"
            >
              <Header icon="trash" content={copy.forget.title} />
              <Modal.Content>
                <p>
                  <strong>{copy.forget.warning}</strong>
                </p>
                <p>{copy.forget.recover}</p>
                <p>{copy.forget.question}</p>
              </Modal.Content>
              <Modal.Actions>
                <Button onClick={() => setShowConfirmForget(false)}>
                  {t.common.actions.cancel}
                </Button>
                <Button
                  color="red"
                  onClick={() => {
                    try {
                      if (typeof props.onForgetIdentity === 'function') {
                        props.onForgetIdentity();
                      }
                      let hasStorage = false;
                      try {
                        hasStorage = (typeof window !== 'undefined');
                      } catch (e) {
                        hasStorage = false;
                      }
                      if (hasStorage) {
                        try {
                          removeStorageKey(DELEGATION_STORAGE_KEY);
                        } catch (eDel) {}
                        try {
                          removeStorageKey(STORAGE_LINKED_DEVICES);
                        } catch (eLink) {}
                        try {
                          notifyDelegationStorageChanged();
                        } catch (eNo) {}
                        try {
                          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.storage.local.remove) {
                            chrome.storage.local.remove(['fabric.identity.ext']);
                          }
                        } catch (eExt) {}
                        clearFabricBrowserIdentityLocal();
                        removeStorageKey('fabric:documents');
                      }
                    } catch (e) {
                      console.error('[IDENTITY]', 'Forget identity error:', safeIdentityErr(e));
                    }
                    setShowConfirmForget(false);
                    setLocalIdentity(null);
                    setSignature(null);
                  }}
                >
                  <Icon name="trash" aria-hidden="true" />
                  {copy.forget.confirm}
                </Button>
              </Modal.Actions>
            </Modal>
              </>
            ) : null}
          </>
        ) : isGenerating ? (
          <>
            <p style={{ color: '#666' }}>
              {copy.generating.intro}
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2em 0'
              }}
            >
              <Icon name="spinner" loading size="huge" aria-hidden="true" />
              <p role="status" style={{ marginTop: '1em', color: '#666' }}>{copy.generating.wait}</p>
            </div>
          </>
        ) : pendingSeed && !seedConfirmed ? (
          <>
            <p style={{ color: '#666' }}>
              {copy.newPassword.intro}
            </p>
            <Form style={{ marginTop: '0.75em' }}>
              <Form.Field>
                <label htmlFor="fabric-identity-new-password">{copy.newPassword.password}</label>
                <input
                  id="fabric-identity-new-password"
                  type="password"
                  aria-describedby="fabric-identity-new-password-hint"
                  autoComplete="new-password"
                  value={identityPassword}
                  onChange={(e) => setIdentityPassword(e.target.value)}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="fabric-identity-new-password-confirm">{copy.newPassword.confirm}</label>
                <input
                  id="fabric-identity-new-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={identityPasswordConfirm}
                  onChange={(e) => setIdentityPasswordConfirm(e.target.value)}
                />
              </Form.Field>
              <div id="fabric-identity-new-password-hint" style={{ marginTop: '0.5em', color: '#666', fontSize: '0.9em' }}>
                {copy.newPassword.hint(LOCAL_IDENTITY_PASSWORD_MIN)}
              </div>
            </Form>
            <div style={{ marginTop: '0.75em' }}>
              <Button
                primary
                size="small"
                icon
                labelPosition="left"
                disabled={busy}
                onClick={() => {
                  const a = String(identityPassword || '').trim();
                  const b = String(identityPasswordConfirm || '').trim();
                  if (!a || !b) {
                    setError(copy.newPassword.missing);
                    return;
                  }
                  if (a.length < LOCAL_IDENTITY_PASSWORD_MIN) {
                    setError(copy.passwords.tooShort(LOCAL_IDENTITY_PASSWORD_MIN));
                    return;
                  }
                  if (a !== b) {
                    setError(copy.passwords.mismatch);
                    return;
                  }
                  setError(null);
                  // Keep the generated seed in-memory and show backup details next.
                  // Final persistence/login happens in the "Login with this identity" step.
                  setBackupAcknowledged(false);
                  setSeedConfirmed(true);
                }}
              >
                <Icon name="arrow right" aria-hidden="true" />
                {copy.newPassword.continue}
              </Button>
              <Button
                basic
                size="small"
                style={{ marginLeft: '0.5em' }}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  resetSeedState();
                }}
              >
                {t.common.actions.cancel}
              </Button>
              <Button
                basic
                size="small"
                icon
                labelPosition="left"
                style={{ marginLeft: '0.5em' }}
                loading={busy}
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  setBusy(true);
                  setIsGenerating(true);
                  setPendingSeed(null);
                  try {
                    const generate = () => {
                      const key = new Key();
                      if (!key.mnemonic || !key.xprv) {
                        throw new Error(copy.generate.failed);
                      }
                      return key;
                    };
                    const delay = new Promise((resolve) => setTimeout(resolve, 1500));
                    const key = generate();
                    await delay;
                    setPendingSeed({
                      mnemonic: key.mnemonic,
                      xprv: key.xprv
                    });
                    setSeedConfirmed(false);
                    setIdentityPassword('');
                    setIdentityPasswordConfirm('');
                  } catch (e) {
                    console.error('[IDENTITY]', 'Regenerate identity failed:', safeIdentityErr(e));
                    setError(t.common.errors.withReason(copy.generate.failed, e && e.message));
                  } finally {
                    setIsGenerating(false);
                    setBusy(false);
                  }
                }}
              >
                <Icon name="refresh" aria-hidden="true" />
                {copy.newPassword.regenerate}
              </Button>
            </div>
          </>
        ) : pendingSeed && seedConfirmed ? (
          <>
            <Message warning style={{ maxWidth: '42rem' }}>
              <Message.Header>{copy.backupReview.title}</Message.Header>
              <p style={{ margin: '0.5em 0 0', lineHeight: 1.5 }}>
                {copy.backupReview.body}
              </p>
              <p style={{ margin: '0.5em 0 0', lineHeight: 1.5 }}>
                {copy.backupReview.keepSafe}
              </p>
            </Message>
            <p style={{ color: '#666' }}>
              {copy.backupReview.steps}
            </p>
            {pendingSeed.mnemonic && (
              <>
                <p><strong>{copy.backupReview.phraseLabel}</strong> {copy.backupReview.phraseNote}</p>
                <Segment inverted color="blue">
                  {showSeedPhrase ? (
                    <code style={{ whiteSpace: 'pre-wrap' }}>{pendingSeed.mnemonic}</code>
                  ) : (
                    <span style={{ color: '#ccd', fontStyle: 'italic' }}>
                      {copy.backupReview.phraseHidden}
                    </span>
                  )}
                </Segment>
                <Button
                  size="small"
                  basic
                  icon
                  labelPosition="left"
                  onClick={() => setShowSeedPhrase((v) => !v)}
                >
                  <Icon name={showSeedPhrase ? 'eye slash' : 'eye'} aria-hidden="true" />
                  {showSeedPhrase ? copy.backupReview.hidePhrase : copy.backupReview.showPhrase}
                </Button>
                <Button
                  size="small"
                  basic
                  icon
                  labelPosition="left"
                  disabled={!showSeedPhrase}
                  title={!showSeedPhrase ? copy.backupReview.copyPhraseTitle : undefined}
                  onClick={() => {
                    try {
                      if (typeof navigator !== 'undefined' && navigator.clipboard && pendingSeed.mnemonic) {
                        navigator.clipboard.writeText(pendingSeed.mnemonic);
                      }
                    } catch (e) {}
                  }}
                >
                  <Icon name="copy" aria-hidden="true" />
                  {copy.backupReview.copyPhrase}
                </Button>
              </>
            )}
            <p style={{ marginTop: '0.75em' }}><strong>{copy.backupReview.xprvLabel}</strong> {copy.backupReview.xprvNote}</p>
            <Segment>
              {showBackupKey ? (
                <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{pendingSeed.xprv}</code>
              ) : (
                <span style={{ color: '#666', fontStyle: 'italic' }}>
                  {copy.backupReview.xprvHidden}
                </span>
              )}
            </Segment>
            <Button
              size="small"
              basic
              icon
              labelPosition="left"
              onClick={() => setShowBackupKey((v) => !v)}
            >
              <Icon name={showBackupKey ? 'eye slash' : 'eye'} aria-hidden="true" />
              {showBackupKey ? copy.backupReview.hideXprv : copy.backupReview.showXprv}
            </Button>
            <Button
              size="small"
              icon
              labelPosition="left"
              disabled={!showBackupKey}
              title={!showBackupKey ? copy.backupReview.copyXprvTitle : undefined}
              onClick={() => {
                try {
                  if (typeof navigator !== 'undefined' && navigator.clipboard && pendingSeed.xprv) {
                    navigator.clipboard.writeText(pendingSeed.xprv);
                  }
                } catch (e) {}
              }}
            >
              <Icon name="copy" aria-hidden="true" />
              {copy.backupReview.copyXprv}
            </Button>
            <Message info size="small" style={{ marginTop: '0.75em', maxWidth: '42rem' }}>
              {copy.backupReview.downloadNote}
            </Message>
            <Button
              size="small"
              icon
              labelPosition="left"
              loading={backupExportBusy}
              disabled={backupExportBusy || !(pendingSeed && pendingSeed.xprv)}
              onClick={() => {
                (async () => {
                  const xprv = pendingSeed && pendingSeed.xprv;
                  if (!xprv) return;
                  const pwd = String(identityPassword || '').trim();
                  if (!pwd || pwd.length < LOCAL_IDENTITY_PASSWORD_MIN) {
                    setError(copy.backupReview.passwordMissing(LOCAL_IDENTITY_PASSWORD_MIN));
                    return;
                  }
                  setBackupExportBusy(true);
                  setError(null);
                  try {
                    const backupPayload = {
                      type: 'fabric-identity-backup-inner',
                      version: 1,
                      mnemonic: pendingSeed.mnemonic || undefined,
                      xprv
                    };
                    try {
                      const identity = new Identity({ xprv });
                      if (identity && identity.id && identity.key && identity.key.xpub) {
                        backupPayload.id = String(identity.id);
                        backupPayload.xpub = String(identity.key.xpub);
                      }
                    } catch (e) {}
                    const envelope = await encryptFabricIdentityBackupPayload(backupPayload, pwd);
                    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'fabric-identity-backup.enc.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    setError(t.common.errors.withReason(copy.backup.exportFailed, err && err.message));
                  } finally {
                    setBackupExportBusy(false);
                  }
                })();
              }}
            >
              <Icon name="download" aria-hidden="true" />
              {copy.backup.download}
            </Button>
            <Form style={{ marginTop: '1.25em', maxWidth: '42rem' }}>
              <Form.Field>
                <Checkbox
                  checked={backupAcknowledged}
                  onChange={(e, d) => setBackupAcknowledged(!!(d && d.checked))}
                  label={copy.backupReview.acknowledge}
                />
              </Form.Field>
            </Form>
            <Button
              primary
              size="small"
              icon
              labelPosition="left"
              style={{ marginTop: '0.75em' }}
              disabled={busy || !backupAcknowledged}
              title={!backupAcknowledged ? copy.backupReview.finishTitle : undefined}
              onClick={() => {
                setBusy(true);
                setError(null);
                try {
                  const masterXprv = pendingSeed && pendingSeed.xprv;
                  if (!masterXprv) throw new Error(copy.backupReview.missingKey);
                  const pwd = String(identityPassword || '').trim();
                  if (!pwd || pwd.length < LOCAL_IDENTITY_PASSWORD_MIN) {
                    setError(copy.backupReview.passwordMissing(LOCAL_IDENTITY_PASSWORD_MIN));
                    setBusy(false);
                    return;
                  }
                  const fabricAccountIndex = 0;
                  const dk = deriveFabricAccountIdentityKeys(String(masterXprv).trim(), fabricAccountIndex, 0);
                  const masterXpub = fabricRootXpubFromMasterXprv(String(masterXprv).trim());
                  let hasStorage = false;
                  try {
                    hasStorage = (typeof window !== 'undefined');
                  } catch (e) {
                    hasStorage = false;
                  }
                  if (!hasStorage) throw new Error(copy.unlock.noStorage);
                  const plaintextPayload = {
                    fabricIdentityMode: 'account',
                    fabricAccountIndex,
                    masterXpub,
                    masterXprv: String(masterXprv).trim(),
                    id: dk.id,
                    xpub: dk.xpub,
                    passwordProtected: false
                  };
                  const payload = encryptLocalIdentityAtRest(plaintextPayload, pwd);
                  writeStorageJSON('fabric.identity.local', payload);
                  const storedPayload = readStorageJSON('fabric.identity.local', null);
                  const material = decryptLocalIdentityMasterMaterial(storedPayload, pwd);
                  const nextIdent = unlockedSessionFromDecryptedMaster(material, storedPayload);
                  setLocalIdentity(nextIdent);
                  if (typeof props.onLocalIdentityChange === 'function') {
                    props.onLocalIdentityChange({
                      id: nextIdent.id,
                      xpub: nextIdent.xpub,
                      xprv: nextIdent.xprv,
                      passwordProtected: true,
                      fabricIdentityMode: nextIdent.fabricIdentityMode,
                      fabricAccountIndex: nextIdent.fabricAccountIndex,
                      masterXprv: nextIdent.masterXprv,
                      masterXpub: nextIdent.masterXpub
                    });
                  }
                  if (typeof props.onUnlockSuccess === 'function') {
                    props.onUnlockSuccess(nextIdent);
                  }
                  resetSeedState();
                } catch (e) {
                  console.error('[IDENTITY]', 'Save local identity failed:', safeIdentityErr(e));
                  setError(t.common.errors.withReason(copy.generate.saveFailed, e && e.message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="sign-in" aria-hidden="true" />
              {copy.backupReview.finish}
            </Button>
          </>
        ) : loginMethod === null ? (
          <>
            <p style={{ color: '#666' }}>
              {copy.chooser.prompt}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', maxWidth: 320 }}>
              {hubHttpAvailable && typeof window !== 'undefined' && !props.postSetupFlow && !(window.fabricDesktop && window.fabricDesktop.isDesktopShell) ? (
                <Button
                  primary
                  fluid
                  icon
                  labelPosition="left"
                  loading={busy}
                  disabled={busy}
                  onClick={handleLoginWithPassport}
                  title={copy.chooser.passportTitle}
                >
                  <Icon name="id badge" aria-hidden="true" />
                  {copy.chooser.passport}
                </Button>
              ) : null}
              {extensionAvailable && !props.postSetupFlow ? (
                <Button
                  fluid
                  icon
                  labelPosition="left"
                  loading={busy}
                  disabled={busy}
                  onClick={handleLoginWithExtension}
                  title={copy.chooser.extensionTitle}
                >
                  <Icon name="puzzle piece" aria-hidden="true" />
                  {copy.chooser.extension}
                </Button>
              ) : null}
              {hubHttpAvailable && typeof window !== 'undefined' && !props.postSetupFlow && !(window.fabricDesktop && window.fabricDesktop.isDesktopShell) ? (
                <Button
                  fluid
                  icon
                  labelPosition="left"
                  loading={busy}
                  disabled={busy}
                  onClick={handleLoginWithDesktop}
                  title={copy.chooser.desktopTitle}
                >
                  <Icon name="desktop" aria-hidden="true" />
                  {copy.chooser.desktop}
                </Button>
              ) : null}
              <Button
                primary={!hubHttpAvailable || !!(typeof window !== 'undefined' && window.fabricDesktop && window.fabricDesktop.isDesktopShell)}
                fluid
                icon
                labelPosition="left"
                onClick={() => setLoginMethod('existing')}
                color='blue'
              >
                <Icon name="key" aria-hidden="true" />
                {copy.chooser.existing}
              </Button>
              <Button
                fluid
                icon
                labelPosition="left"
                onClick={() => setLoginMethod('generate')}
                color='green'
              >
                <Icon name="shield" aria-hidden="true" />
                {copy.chooser.generate}
              </Button>
              {!props.postSetupFlow ? (
              <Button
                fluid
                icon
                labelPosition="left"
                onClick={() => {
                  setLoginMethod('import');
                  setError(null);
                }}
                color='purple'
              >
                <Icon name="download" aria-hidden="true" />
                {copy.chooser.backup}
              </Button>
              ) : null}
              <Button
                fluid
                icon
                labelPosition="left"
                onClick={() => {
                  setLoginMethod('restoreMnemonic');
                  setError(null);
                }}
                title={copy.chooser.restoreTitle}
                color='black'
              >
                <Icon name="history" aria-hidden="true" />
                {copy.chooser.restore}
              </Button>
            </div>
          </>
        ) : loginMethod === 'existing' ? (
          <>
            <Button
              basic
              size="small"
              icon
              labelPosition="left"
              style={{ marginBottom: '1em' }}
              onClick={() => {
                backToLoginChooser();
                setXpubInput('');
                setError(null);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              {copy.backToChooser}
            </Button>
            <Header as="h4" size="small">
              <Icon name="key" aria-hidden="true" />
              <Header.Content>{copy.existing.title}</Header.Content>
            </Header>
            <p style={{ color: '#666' }}>
              {copy.existing.intro}
            </p>
            <Form>
              <Form.Field>
                <label htmlFor="fabric-identity-xpub">{copy.existing.label}</label>
                <Form.TextArea
                  id="fabric-identity-xpub"
                  rows={2}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', wordBreak: 'break-all' }}
                  placeholder={copy.existing.placeholder}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  value={xpubInput}
                  onChange={(e) => setXpubInput(e.target.value)}
                />
              </Form.Field>
            </Form>
            <Button
              primary
              size="small"
              icon
              labelPosition="left"
              style={{ marginTop: '0.5em' }}
              loading={busy}
              disabled={busy || !xpubInput}
              onClick={async () => {
                setError(null);
                setBusy(true);
                try {
                  const raw = (xpubInput || '').trim();
                  if (!raw) {
                    setError(copy.existing.missing);
                    return;
                  }

                  const key = new Key({ xpub: raw });
                  const identity = new Identity(key);

                  try {
                    let hasStorage = false;
                    try {
                      hasStorage = (typeof window !== 'undefined');
                    } catch (e) {
                      hasStorage = false;
                    }
                    if (hasStorage) {
                      writeStorageJSON('fabric.identity.local', { xpub: key.xpub });
                    }
                  } catch (e) {}

                  setLocalIdentity({
                    id: identity.id,
                    xpub: key.xpub,
                    xprv: null
                  });
                  resetSeedState();
                } catch (e) {
                  console.error('[IDENTITY]', 'Activate xpub failed:', safeIdentityErr(e));
                  setError(t.common.errors.withReason(copy.existing.invalid, e && e.message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="sign-in" aria-hidden="true" />
              {copy.existing.submit}
            </Button>
          </>
        ) : loginMethod === 'import' ? (
          <>
            <Button
              basic
              size="small"
              icon
              labelPosition="left"
              style={{ marginBottom: '1em' }}
              onClick={() => {
                backToLoginChooser();
                setError(null);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              {copy.backToChooser}
            </Button>
            <Header as="h4" size="small">
              <Icon name="download" aria-hidden="true" />
              <Header.Content>{copy.importBackup.title}</Header.Content>
            </Header>
            <p style={{ color: '#666' }}>
              {copy.importBackup.intro}
            </p>
            <details className="hub-developer-details" style={{ marginBottom: '0.75em' }}>
              <summary>{t.common.developerDetails}</summary>
              <p style={{ color: '#666', fontSize: '0.9em', margin: '0.35em 0 0' }}>{copy.importBackup.developer}</p>
            </details>
            <Form.Field style={{ maxWidth: '42rem', marginBottom: '0.75em' }}>
              <label htmlFor="fabric-import-backup-pwd">{copy.importBackup.passwordLabel}</label>
              <input
                id="fabric-import-backup-pwd"
                type="password"
                autoComplete="off"
                value={importBackupFilePassword}
                onChange={(e) => setImportBackupFilePassword(e.target.value)}
                style={{ width: '100%', maxWidth: 360, padding: '0.55em', boxSizing: 'border-box' }}
              />
            </Form.Field>
            <label htmlFor="fabric-import-backup-file" style={{ display: 'block', fontWeight: 700, marginBottom: '0.35em' }}>
              {copy.importBackup.fileLabel}
            </label>
            <input
              id="fabric-import-backup-file"
              type="file"
              accept=".json,application/json,text/*"
              onChange={(event) => {
                const file = event && event.target && event.target.files && event.target.files[0];
                if (!file) return;
                setBusy(true);
                setError(null);
                const reader = new FileReader();
                reader.onload = () => {
                  (async () => {
                    try {
                      const text = String(reader.result || '');
                      let data = null;
                      try {
                        data = JSON.parse(text);
                      } catch (e) {}

                      if (data && typeof data === 'object' && data.version === 2 && data.ciphertext) {
                        const pwdImp = String(importBackupFilePassword || '').trim();
                        if (!pwdImp || pwdImp.length < 8) {
                          setError(copy.importBackup.needsPassword(8));
                          return;
                        }
                        try {
                          data = await decryptFabricIdentityBackupToPayload(data, pwdImp);
                        } catch (decErr) {
                          setError(t.common.errors.withReason(copy.importBackup.decryptFailed, decErr && decErr.message));
                          return;
                        }
                      }

                      if (
                        data &&
                        typeof data === 'object' &&
                        data.type === 'fabric-identity-backup-inner' &&
                        data.xprv &&
                        (data.backupScope === 'fabricAccountSubtree' || data.fabricHdRole === 'accountNode')
                      ) {
                        let hasStorage = false;
                        try {
                          hasStorage = (typeof window !== 'undefined');
                        } catch (e) {
                          hasStorage = false;
                        }
                        const mat = identityFromFabricProtocolSigningXprv(String(data.xprv).trim());
                        if (
                          data.id != null &&
                          String(data.id).trim() &&
                          String(data.id).trim() !== String(mat.id)
                        ) {
                          setError(copy.importBackup.idMismatch);
                          return;
                        }
                        const fabricAccountIndex =
                          data.fabricAccountIndex != null
                            ? Math.floor(Number(data.fabricAccountIndex))
                            : 0;
                        const storedPayload = {
                          fabricIdentityMode: 'account',
                          fabricHdRole: 'accountNode',
                          fabricAccountIndex,
                          id: mat.id,
                          xpub: mat.xpub,
                          passwordProtected: false
                        };
                        if (hasStorage) {
                          writeStorageJSON('fabric.identity.local', storedPayload);
                        }
                        const nextIdentity = unlockedSessionFromDecryptedMaster(mat.xprv, storedPayload);
                        setLocalIdentity(nextIdentity);
                        resetSeedState();
                        if (typeof props.onLocalIdentityChange === 'function') {
                          props.onLocalIdentityChange(nextIdentity);
                        }
                        if (typeof props.onUnlockSuccess === 'function') {
                          props.onUnlockSuccess({
                            id: String(mat.id),
                            xpub: String(mat.xpub),
                            xprv: String(mat.xprv),
                            passwordProtected: false,
                            fabricIdentityMode: 'account',
                            fabricHdRole: 'accountNode',
                            fabricAccountIndex
                          });
                        }
                        return;
                      }

                      let xprv = null;
                      let xpub = null;

                      if (data && typeof data === 'object') {
                        if (data.xprv) xprv = String(data.xprv);
                        if (data.xpub) xpub = String(data.xpub);
                        const seedPhrase = (data.mnemonic != null && String(data.mnemonic).trim())
                          ? String(data.mnemonic).trim()
                          : ((data.seed != null && String(data.seed).trim()) ? String(data.seed).trim() : '');
                        if (!xprv && seedPhrase) {
                          try {
                            const ext = (data.bip39Passphrase != null && String(data.bip39Passphrase).trim() !== '')
                              ? String(data.bip39Passphrase)
                              : ((data.passphrase != null && String(data.passphrase).trim() !== '')
                                ? String(data.passphrase)
                                : null);
                            const ident = ext
                              ? new Identity({ seed: seedPhrase, passphrase: ext })
                              : new Identity({ seed: seedPhrase });
                            xprv = ident.key.xprv;
                            xpub = ident.key.xpub;
                          } catch (mnErr) {
                            setError(t.common.errors.withReason(copy.importBackup.mnemonicFailed, mnErr && mnErr.message));
                            return;
                          }
                        }
                      }
                    if (!xprv || !xpub) {
                      const mXprv = text.match(/(xprv[0-9A-Za-z]+)/);
                      const mXpub = text.match(/(xpub[0-9A-Za-z]+)/);
                      if (mXprv && mXprv[1]) xprv = mXprv[1];
                      if (mXpub && mXpub[1]) xpub = mXpub[1];
                    }

                    if (!xprv && !xpub) {
                      setError(copy.importBackup.noKey);
                      return;
                    }

                    let key = null;
                    let identity = null;
                    if (xprv) {
                      key = new Key({ xprv });
                      identity = new Identity({ xprv });
                    } else if (xpub) {
                      key = new Key({ xpub });
                      identity = new Identity(key);
                    }

                    if (!key || !identity) {
                      setError(copy.importBackup.rebuildFailed);
                      return;
                    }

                    try {
                      let hasStorage = false;
                      try {
                        hasStorage = (typeof window !== 'undefined');
                      } catch (e) {
                        hasStorage = false;
                      }
                      if (hasStorage) {
                        if (xprv) {
                          writeStorageJSON('fabric.identity.local', {
                            id: identity.id,
                            xpub: key.xpub,
                            passwordProtected: false
                          });
                        } else {
                          writeStorageJSON('fabric.identity.local', {
                            id: identity.id,
                            xpub: key.xpub,
                            passwordProtected: false
                          });
                        }
                      }
                    } catch (e) {}

                    const nextIdentity = {
                      id: identity.id,
                      xpub: key.xpub,
                      xprv: xprv || null,
                      passwordProtected: false
                    };

                    setLocalIdentity(nextIdentity);
                    resetSeedState();
                    if (typeof props.onLocalIdentityChange === 'function') {
                      props.onLocalIdentityChange(nextIdentity);
                    }
                    if (xprv && typeof props.onUnlockSuccess === 'function') {
                      props.onUnlockSuccess({
                        id: String(identity.id),
                        xpub: String(key.xpub),
                        xprv: String(xprv),
                        passwordProtected: false
                      });
                    }
                  } catch (e) {
                    console.error('[IDENTITY]', 'Import backup failed:', safeIdentityErr(e));
                    setError(t.common.errors.withReason(copy.importBackup.failed, e && e.message));
                  } finally {
                    setBusy(false);
                  }
                  })();
                };
                reader.onerror = () => {
                  setBusy(false);
                  setError(copy.importBackup.readFailed);
                };
                reader.readAsText(file);
              }}
            />
          </>
        ) : loginMethod === 'restoreMnemonic' ? (
          <>
            <Button
              basic
              size="small"
              icon
              labelPosition="left"
              style={{ marginBottom: '1em' }}
              onClick={() => {
                backToLoginChooser();
                setError(null);
                setDevMnemonicText('');
                setDevBip39Passphrase('');
                setDevMnemonicReplace(false);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              {copy.backToChooser}
            </Button>
            <Header as="h4" size="small">
              <Icon name="history" aria-hidden="true" />
              <Header.Content>{copy.restore.title}</Header.Content>
            </Header>
            <Message info style={{ maxWidth: '42rem' }}>
              <Message.Header>{copy.restore.howTitle}</Message.Header>
              {copy.restore.how.map((line, i) => (
                <p key={i} style={{ margin: i === 0 ? '0.5em 0 0' : '0.65em 0 0', lineHeight: 1.5 }}>{line}</p>
              ))}
              <p style={{ margin: '0.65em 0 0', lineHeight: 1.5 }}><strong>{copy.restore.safety}</strong></p>
            </Message>
            <Form>
              <Form.Field>
                <label htmlFor="fabric-restore-mnemonic">{copy.restore.phraseLabel}</label>
                <Form.TextArea
                  id="fabric-restore-mnemonic"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', wordBreak: 'break-all' }}
                  placeholder={copy.restore.phrasePlaceholder}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  value={devMnemonicText}
                  onChange={(e) => setDevMnemonicText(e.target.value)}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="fabric-restore-bip39-pass">{copy.restore.passphraseLabel}</label>
                <Form.Input
                  id="fabric-restore-bip39-pass"
                  type="password"
                  placeholder={copy.restore.passphrasePlaceholder}
                  autoComplete="off"
                  value={devBip39Passphrase}
                  onChange={(e) => setDevBip39Passphrase(e.target.value)}
                />
              </Form.Field>
              <Form.Checkbox
                label={copy.restore.replace}
                checked={devMnemonicReplace}
                onChange={(e, d) => setDevMnemonicReplace(!!(d && d.checked))}
                aria-label={copy.restore.replace}
              />
            </Form>
            <Button
              primary
              size="small"
              icon
              labelPosition="left"
              style={{ marginTop: '0.75em' }}
              loading={busy}
              disabled={busy || !String(devMnemonicText || '').trim()}
              onClick={() => {
                setError(null);
                setBusy(true);
                try {
                  const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
                  const r = storeUnlockedIdentityFromMnemonic({
                    seed: devMnemonicText,
                    passphrase: devBip39Passphrase || undefined,
                    force: devMnemonicReplace
                  });
                  if (!r.ok || !r.identity) {
                    setError(r.error || copy.restore.failed);
                    return;
                  }
                  const nextIdentity = {
                    id: r.identity.id,
                    xpub: r.identity.xpub,
                    xprv: r.identity.xprv,
                    passwordProtected: false
                  };
                  setLocalIdentity(nextIdentity);
                  if (typeof props.onLocalIdentityChange === 'function') {
                    props.onLocalIdentityChange(nextIdentity);
                  }
                  if (typeof props.onUnlockSuccess === 'function') {
                    props.onUnlockSuccess({
                      id: String(r.identity.id),
                      xpub: String(r.identity.xpub),
                      xprv: String(r.identity.xprv),
                      passwordProtected: false
                    });
                  }
                  resetSeedState();
                } catch (e) {
                  console.error('[IDENTITY]', 'Recovery phrase restore failed:', safeIdentityErr(e));
                  setError(t.common.errors.withReason(copy.restore.failed, e && e.message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="check circle" aria-hidden="true" />
              {copy.restore.submit}
            </Button>
          </>
        ) : loginMethod === 'generate' ? (
          <>
            <Button
              basic
              size="small"
              icon
              labelPosition="left"
              style={{ marginBottom: '1em' }}
              onClick={() => {
                backToLoginChooser();
                setError(null);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              {copy.backToChooser}
            </Button>
            <Header as="h4" size="small">
              <Icon name="shield" aria-hidden="true" />
              <Header.Content>{copy.generate.title}</Header.Content>
            </Header>
            <p style={{ color: '#666' }}>
              {copy.generate.intro}
            </p>
            <Button
              primary
              icon
              labelPosition="left"
              loading={busy}
              disabled={busy}
              onClick={async () => {
                setError(null);
                setBusy(true);
                setIsGenerating(true);
                setPendingSeed(null);
                try {
                  const generate = () => {
                    const key = new Key();
                    if (!key.mnemonic || !key.xprv) {
                      throw new Error(copy.generate.failed);
                    }
                    return key;
                  };
                  const delay = new Promise((resolve) => setTimeout(resolve, 1500));
                  const key = generate();
                  await delay;
                  setPendingSeed({
                    mnemonic: key.mnemonic,
                    xprv: key.xprv
                  });
                  setSeedConfirmed(false);
                  setIdentityPassword('');
                  setIdentityPasswordConfirm('');
                } catch (e) {
                  console.error('[IDENTITY]', 'Generate identity failed:', safeIdentityErr(e));
                  setError(t.common.errors.withReason(copy.generate.failed, e && e.message));
                } finally {
                  setIsGenerating(false);
                  setBusy(false);
                }
              }}
            >
              <Icon name="shield" aria-hidden="true" />
              {copy.generate.submit}
            </Button>
          </>
        ) : null}
        {error && (
          <Message negative style={{ marginTop: '0.75em' }}>
            <Message.Header>{copy.errorTitle}</Message.Header>
            <p style={{ margin: '0.5em 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {error}
            </p>
          </Message>
        )}
      </div>
    </Segment>
  );
}

module.exports = IdentityManager;
