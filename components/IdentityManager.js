'use strict';

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');

// Semantic UI
const {
  Button,
  Checkbox,
  Form,
  Header,
  Icon,
  Message,
  Modal,
  Segment
} = require('semantic-ui-react');

const {
  setPassportSession,
  endPassportSession,
  watchIdentityFromSession
} = require('../functions/passportSession');
const { safeIdentityErr } = require('../functions/fabricSafeLog');
const {
  readStorageJSON,
  readStorageString,
  writeStorageJSON,
  removeStorageKey,
  clearFabricBrowserIdentityLocal
} = require('../functions/fabricBrowserState');
const {
  STORAGE_KEY,
  LOCAL_IDENTITY_PASSWORD_MIN,
  isAccountVault,
  readStoredIdentity,
  lockIdentity,
  masterFromMnemonic,
  generateMnemonic,
  createVault,
  unlockVault,
  identitySigner
} = require('../functions/hubAccountVault');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const FabricHubAdminTokenNotice = require('./fabricIdentity/FabricHubAdminTokenNotice');
const {
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  readFabricIdentityLockTimeoutMinutes,
  writeFabricIdentityLockTimeoutMinutes,
  lockTimeoutMinutesToMs
} = require('../functions/fabricIdentityLockPrefs');
const { useHubHttpAvailable } = require('./hubUiRuntime');
const {
  probePassport,
  loginWithPassport
} = require('../functions/passportSiteLogin');
const t = require('../locales/en');

const copy = t.identity.manager;
const networkNames = t.identity.accountControls.networks;

/** Long Bech32 strings must wrap or mobile modals overflow and the viewport strobes. */
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

const inputStyle = { width: '100%', maxWidth: 360, padding: '0.55em', boxSizing: 'border-box' };
const hintStyle = { marginTop: '0.35em', color: '#666', fontSize: '0.9em', lineHeight: 1.45 };

/** Sealing and unsealing are synchronous and slow on purpose; let the spinner paint first. */
function nextTick () {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function storedRecord () {
  try {
    if (typeof window === 'undefined') return null;
    return readStorageJSON(STORAGE_KEY, null);
  } catch (_) {
    return null;
  }
}

function copyIdentity (identity) {
  return identity && identity.id ? Object.assign({}, identity) : null;
}

function identityAnchorKey (i) {
  if (!i || !i.id) return '';
  const acct = i.fabricAccountIndex != null ? String(Math.floor(Number(i.fabricAccountIndex))) : '';
  return [
    i.id,
    i.network || '',
    acct,
    i.passwordProtected ? '1' : '0',
    i.linkedFromPassport ? '1' : '0',
    i.wallet ? '1' : '0'
  ].join('|');
}

/**
 * Password + confirm fields for the lock password.
 * @param {{ idPrefix: string, value: string, confirm: string, onChange: function, onConfirmChange: function, disabled: boolean }} props
 */
function LockPasswordFields (props) {
  const hintId = `${props.idPrefix}-hint`;
  return (
    <>
      <Form.Field>
        <label htmlFor={`${props.idPrefix}`}>{copy.lockPassword.password}</label>
        <input
          id={props.idPrefix}
          type="password"
          aria-describedby={hintId}
          autoComplete="new-password"
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          style={inputStyle}
        />
      </Form.Field>
      <Form.Field>
        <label htmlFor={`${props.idPrefix}-confirm`}>{copy.lockPassword.confirm}</label>
        <input
          id={`${props.idPrefix}-confirm`}
          type="password"
          autoComplete="new-password"
          value={props.confirm}
          disabled={props.disabled}
          onChange={(e) => props.onConfirmChange(e.target.value)}
          style={inputStyle}
        />
        <div id={hintId} style={hintStyle}>{copy.lockPassword.hint(LOCAL_IDENTITY_PASSWORD_MIN)}</div>
      </Form.Field>
    </>
  );
}

/**
 * BIP39 passphrase (the derivation password; never stored).
 * @param {{ id: string, value: string, onChange: function, disabled: boolean }} props
 */
function PassphraseField (props) {
  return (
    <Form.Field>
      <label htmlFor={props.id}>{copy.passphrase.label}</label>
      <input
        id={props.id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={copy.passphrase.placeholder}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        style={inputStyle}
      />
      <div style={hintStyle}>{copy.passphrase.hint}</div>
    </Form.Field>
  );
}

function lockPasswordProblem (a, b) {
  const pwd = String(a || '');
  if (pwd.trim().length < LOCAL_IDENTITY_PASSWORD_MIN) return copy.passwords.tooShort(LOCAL_IDENTITY_PASSWORD_MIN);
  if (pwd !== String(b || '')) return copy.passwords.mismatch;
  return null;
}

/**
 * The browser's Fabric identity: one seed, kept only as a master xprv sealed
 * by the lock password (a core `FabricAccountVault`), or a Passport session.
 * Account and network switching lives in the top bar
 * (`FabricIdentityAccountControls`).
 *
 * @param {object} props
 * @param {object|null} [props.currentIdentity] The Hub shell's in-memory identity (authoritative when set).
 * @param {string} [props.defaultNetwork] Network for new identities (the Hub's Bitcoin network).
 * @param {string} [props.initialLoginMethod] `generate` | `import` | `restore`
 * @param {boolean} [props.postSetupFlow]
 * @param {boolean} [props.suppressForgetAndLinkedChrome]
 * @param {number} [props.lockTimeoutMs] Tests only.
 * @param {string} [props.hubAdminToken]
 * @param {function} [props.onLocalIdentityChange]
 * @param {function} [props.onLockStateChange]
 * @param {function} [props.onUnlockSuccess]
 * @param {function} [props.onForgetIdentity]
 */
function IdentityManager (props) {
  const hubHttpAvailable = useHubHttpAvailable();
  const lockTimeoutMsFromTests = (props && typeof props.lockTimeoutMs === 'number' && props.lockTimeoutMs > 0)
    ? props.lockTimeoutMs
    : null;
  const defaultNetwork = props.defaultNetwork || 'regtest';

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
    if (props.currentIdentity && props.currentIdentity.id) return copyIdentity(props.currentIdentity);
    try {
      return readStoredIdentity(storedRecord()).identity;
    } catch (e) {
      console.warn('[IDENTITY]', 'Failed to restore local identity:', safeIdentityErr(e));
      return null;
    }
  });

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [showConfirmForget, setShowConfirmForget] = React.useState(false);
  const [loginMethod, setLoginMethod] = React.useState(() => (
    props.initialLoginMethod != null ? props.initialLoginMethod : null
  ));
  const [newMnemonic, setNewMnemonic] = React.useState(null);
  const [showPhrase, setShowPhrase] = React.useState(false);
  const [backupAcknowledged, setBackupAcknowledged] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState('');
  const [lockPassword, setLockPassword] = React.useState('');
  const [lockPasswordConfirm, setLockPasswordConfirm] = React.useState('');
  const [restorePhrase, setRestorePhrase] = React.useState('');
  const [restoreReplace, setRestoreReplace] = React.useState(false);
  const [importVault, setImportVault] = React.useState(null);
  const [importPassword, setImportPassword] = React.useState('');
  const [unlockPassword, setUnlockPassword] = React.useState('');
  const passportWaitRef = React.useRef(null);

  React.useEffect(() => {
    if (loginMethod === 'generate' && !newMnemonic && !localIdentity) {
      try {
        setNewMnemonic(generateMnemonic());
      } catch (e) {
        setError(t.common.errors.withReason(copy.create.failed, e && e.message));
      }
    }
  }, [loginMethod, newMnemonic, localIdentity]);

  const clearSecrets = () => {
    setNewMnemonic(null);
    setShowPhrase(false);
    setBackupAcknowledged(false);
    setPassphrase('');
    setLockPassword('');
    setLockPasswordConfirm('');
    setRestorePhrase('');
    setRestoreReplace(false);
    setImportVault(null);
    setImportPassword('');
  };

  const backToLoginChooser = () => {
    clearSecrets();
    setError(null);
    if (props.postSetupFlow) setLoginMethod('generate');
    else setLoginMethod(props.initialLoginMethod != null ? props.initialLoginMethod : null);
  };

  const isPassport = !!(localIdentity && localIdentity.linkedFromPassport);
  const isLocked = !!(localIdentity && localIdentity.id && !localIdentity.xprv && localIdentity.passwordProtected);
  let keyState = 'none';
  if (localIdentity && localIdentity.xprv) keyState = 'unlocked';
  else if (isLocked) keyState = 'locked';
  else if (localIdentity && localIdentity.id) keyState = 'session';

  React.useEffect(() => {
    if (!localIdentity || !localIdentity.xprv) setUnlockPassword('');
  }, [localIdentity && localIdentity.xprv]);

  React.useEffect(() => {
    if (!localIdentity || !localIdentity.xprv || !localIdentity.passwordProtected || !lockTimeoutMs) return undefined;
    const timer = setTimeout(() => {
      setLocalIdentity((prev) => (prev && prev.xprv ? lockIdentity(prev) : prev));
    }, lockTimeoutMs);
    return () => clearTimeout(timer);
  }, [localIdentity && localIdentity.xprv, lockTimeoutMs]);

  // Anchor key only: avoid local <-> parent lock/unlock echo loops that can flicker the modal.
  const parentIdentityKey = identityAnchorKey(props.currentIdentity);
  React.useEffect(() => {
    const p = props.currentIdentity;
    if (!p || !p.id) {
      setLocalIdentity((prev) => (prev ? null : prev));
      return;
    }
    setLocalIdentity((prev) => {
      if (identityAnchorKey(prev) === identityAnchorKey(p) && !!(prev && prev.xprv) === !!p.xprv) return prev;
      return copyIdentity(p);
    });
  }, [parentIdentityKey, !!(props.currentIdentity && props.currentIdentity.xprv)]);

  const onLocalIdentityChangeRef = React.useRef(props.onLocalIdentityChange);
  const onLockStateChangeRef = React.useRef(props.onLockStateChange);
  React.useLayoutEffect(() => {
    onLocalIdentityChangeRef.current = props.onLocalIdentityChange;
    onLockStateChangeRef.current = props.onLockStateChange;
  });

  // The shell keeps the unlocked keys in memory for wallet, documents, and account switching.
  React.useEffect(() => {
    const cb = onLocalIdentityChangeRef.current;
    if (typeof cb === 'function') cb(copyIdentity(localIdentity));
  }, [localIdentity]);

  React.useEffect(() => {
    const cb = onLockStateChangeRef.current;
    if (typeof cb === 'function') cb(isLocked);
  }, [isLocked]);

  React.useEffect(() => () => {
    if (passportWaitRef.current) {
      passportWaitRef.current();
      passportWaitRef.current = null;
    }
  }, []);

  const finishUnlocked = (identity) => {
    clearSecrets();
    setError(null);
    setLocalIdentity(identity);
    if (typeof props.onUnlockSuccess === 'function') props.onUnlockSuccess(copyIdentity(identity));
  };

  const saveVault = (vault) => {
    try {
      writeStorageJSON(STORAGE_KEY, vault);
      return true;
    } catch (_) {
      setError(copy.saveFailed);
      return false;
    }
  };

  /** Seal a master from a recovery phrase into a new vault and unlock it. */
  const createFromPhrase = async (mnemonic, failedCopy) => {
    const problem = lockPasswordProblem(lockPassword, lockPasswordConfirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    await nextTick();
    try {
      const master = masterFromMnemonic(mnemonic, passphrase);
      const created = createVault({ master, lockPassword, account: 0, network: defaultNetwork });
      if (!saveVault(created.vault)) return;
      finishUnlocked(created.identity);
    } catch (e) {
      console.error('[IDENTITY]', 'Create identity failed:', safeIdentityErr(e));
      setError(t.common.errors.withReason(failedCopy, e && e.message));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () => {
    if (!newMnemonic || !backupAcknowledged) return;
    void createFromPhrase(newMnemonic, copy.create.failed);
  };

  const handleRestore = () => {
    const phrase = String(restorePhrase || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!phrase) {
      setError(copy.restore.failed);
      return;
    }
    if (isAccountVault(storedRecord()) && !restoreReplace) {
      setError(copy.restore.existing);
      return;
    }
    void createFromPhrase(phrase, copy.restore.failed);
  };

  const handleImportFile = (file) => {
    setError(null);
    setImportVault(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed = null;
      try {
        parsed = JSON.parse(String(reader.result || ''));
      } catch (_) {
        parsed = null;
      }
      if (!isAccountVault(parsed)) {
        setError(copy.importBackup.notBackup);
        return;
      }
      setImportVault(parsed);
    };
    reader.onerror = () => setError(copy.importBackup.readFailed);
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importVault) {
      setError(copy.importBackup.missingFile);
      return;
    }
    setBusy(true);
    setError(null);
    await nextTick();
    try {
      const identity = unlockVault(importVault, importPassword);
      if (!saveVault(importVault)) return;
      finishUnlocked(identity);
    } catch (e) {
      setError(copy.importBackup.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    const record = storedRecord();
    if (!isAccountVault(record)) {
      setError(copy.unlock.noStored);
      return;
    }
    if (!unlockPassword) {
      setError(copy.unlock.missing);
      return;
    }
    setBusy(true);
    setError(null);
    await nextTick();
    try {
      finishUnlocked(unlockVault(record, unlockPassword));
    } catch (e) {
      setError(copy.unlock.failed);
    } finally {
      setUnlockPassword('');
      setBusy(false);
    }
  };

  const handleDownloadBackup = () => {
    const record = storedRecord();
    if (!isAccountVault(record)) {
      setError(copy.unlock.noStored);
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fabric-identity-backup.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(t.common.errors.withReason(copy.backup.exportFailed, e && e.message));
    }
  };

  /**
   * Watch-only identity from a Hub Passport session: the identity id and
   * pubkey always, wallet xpubs only when the user shared them this time.
   * The wallet is kept in memory, never in storage.
   */
  const applyPassportSession = React.useCallback((session) => {
    const watch = watchIdentityFromSession(session);
    if (!watch) return { ok: false, error: copy.login.verifyFailed };
    const stored = {
      id: watch.id,
      pubkey: watch.pubkey,
      network: watch.network,
      signer: watch.signer,
      linkedFromPassport: true
    };
    try {
      writeStorageJSON(STORAGE_KEY, stored);
    } catch (e) {}
    const next = Object.assign({}, stored, { xprv: null, passwordProtected: false, wallet: watch.wallet });
    setLocalIdentity(next);
    if (typeof props.onUnlockSuccess === 'function') props.onUnlockSuccess(next);
    return { ok: true };
  }, [props.onUnlockSuccess]);

  const clearPassportWait = React.useCallback(() => {
    if (passportWaitRef.current) {
      const cancel = passportWaitRef.current;
      passportWaitRef.current = null;
      cancel();
    }
  }, []);

  /**
   * Sign in with Fabric Passport (v2): the Hub issues a challenge, Passport
   * (or a desktop app it is linked to) signs it over a private port, and the
   * Hub sets an HttpOnly session cookie. `wallet` asks to share wallet xpubs.
   */
  const runPassportLogin = React.useCallback(async ({ wallet = false } = {}) => {
    if (typeof window === 'undefined') return;
    clearPassportWait();
    setError(null);
    let passport;
    try {
      passport = await probePassport(window);
    } catch (e) {
      setError((e && e.message) ? e.message : copy.login.passportMissing);
      return;
    }
    if (passport !== 'ready') {
      setError(passport === 'outdated' ? copy.login.passportOutdated : copy.login.passportMissing);
      return;
    }
    setBusy(true);
    try {
      const result = await loginWithPassport({
        window,
        wallet,
        purpose: copy.login.passportPurpose,
        onPending: ({ cancel }) => { passportWaitRef.current = cancel; }
      });
      passportWaitRef.current = null;
      if (!result.ok) {
        if (result.error === 'cancelled') return;
        if (result.error === 'timeout') throw new Error(copy.login.passportTimeout);
        if (result.error === 'busy') throw new Error(copy.login.passportBusy);
        if (result.error === 'passport_outdated') throw new Error(copy.login.passportOutdated);
        throw new Error(t.common.errors.withReason(copy.login.passportRejected, result.error === 'rejected' ? '' : result.error));
      }
      const applied = applyPassportSession(result.session);
      if (!applied.ok) throw new Error(applied.error || copy.login.verifyFailed);
    } catch (e) {
      setError((e && e.message) ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [applyPassportSession, clearPassportWait]);

  const handleLoginWithPassport = React.useCallback(() => runPassportLogin({ wallet: false }), [runPassportLogin]);
  const handleShowPassportWallet = React.useCallback(() => runPassportLogin({ wallet: true }), [runPassportLogin]);

  /** Desktop shell only: sign in to this Hub as the Hub's own identity (`POST /sessions/self`). */
  const handleSignInAsHub = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/sessions/self', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.session) throw new Error(t.common.errors.withReason(copy.login.verifyFailed, body.error || res.status));
      setPassportSession(body.session);
      const applied = applyPassportSession(body.session);
      if (!applied.ok) throw new Error(applied.error || copy.login.verifyFailed);
    } catch (e) {
      setError((e && e.message) ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [applyPassportSession]);

  const handleForget = () => {
    try {
      if (typeof props.onForgetIdentity === 'function') props.onForgetIdentity();
      if (typeof window !== 'undefined') {
        void endPassportSession();
        clearFabricBrowserIdentityLocal();
        removeStorageKey('fabric:documents');
      }
    } catch (e) {
      console.error('[IDENTITY]', 'Forget identity error:', safeIdentityErr(e));
    }
    setShowConfirmForget(false);
    clearSecrets();
    setLocalIdentity(null);
  };

  const showFabricHubAdminNotice = !!readHubAdminTokenFromBrowser(props.hubAdminToken) &&
    (props.postSetupFlow || readStorageString('fabric.hub.identityWizardPending') === '1');
  const isDesktopShell = !!(typeof window !== 'undefined' && window.fabricDesktop && window.fabricDesktop.isDesktopShell);
  const hasStoredVault = isAccountVault(storedRecord());

  const backButton = (
    <Button basic size="small" style={{ marginLeft: '0.5em' }} disabled={busy} onClick={backToLoginChooser}>
      <Icon name="arrow left" aria-hidden="true" />
      {copy.backToChooser}
    </Button>
  );

  const renderIdentity = () => (
    <>
      <p style={{ marginBottom: 0, marginTop: '0.25em' }}><strong>{copy.idLabel}</strong></p>
      <code style={identityMonospaceBlockStyle}>{localIdentity.id}</code>
      {!isPassport && localIdentity.network ? (
        <p style={{ color: '#666', marginTop: 0 }} data-testid="identity-account">
          {copy.accountLabel(
            localIdentity.fabricAccountIndex != null ? localIdentity.fabricAccountIndex : 0,
            networkNames[localIdentity.network] || localIdentity.network
          )}
        </p>
      ) : null}
      {!suppressForget && isPassport ? (
        <Message info size="small" style={{ marginTop: '0.75em' }} data-testid="identity-passport-signing">
          <Icon name="id badge" aria-hidden="true" />
          {copy.passportSigning}
          {' '}
          <Link to="/settings/security">{copy.securityLink}</Link>
          {!localIdentity.wallet && hubHttpAvailable ? (
            <div style={{ marginTop: '0.5em' }}>
              <Button size="small" basic disabled={busy} loading={busy} onClick={handleShowPassportWallet} data-testid="identity-passport-wallet">
                <Icon name="bitcoin" aria-hidden="true" />
                {copy.passportShowWallet}
              </Button>
            </div>
          ) : null}
        </Message>
      ) : null}
      {suppressForget ? null : (
        <p style={{ color: '#666', fontSize: '0.92em', marginTop: '0.75em' }} data-testid="identity-linked-signers">
          {copy.linkedSigners}{' '}
          <Link to="/settings/security">{copy.securityLink}</Link>
        </p>
      )}
      <p style={{ color: '#666' }}>
        <strong>{copy.keyStatus.label}</strong>{' '}
        {keyState === 'unlocked'
          ? copy.keyStatus.unlocked
          : (keyState === 'locked' ? copy.keyStatus.lockedPassword : copy.keyStatus.session)}
        {keyState === 'unlocked' && lockTimeoutMs ? (
          <span> {copy.keyStatus.autoLockIn(t.common.plural(Math.round(lockTimeoutMs / 60000), 'minute'))}</span>
        ) : null}
        {keyState === 'unlocked' && !lockTimeoutMs ? <span> {copy.keyStatus.autoLockOff}</span> : null}
      </p>
      {!isPassport && lockTimeoutMsFromTests == null ? (
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
              style={inputStyle}
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
            <div style={hintStyle}>{copy.autoLock.hint}</div>
          </Form.Field>
        </Form>
      ) : null}
      {keyState === 'locked' ? (
        <Form
          style={{ marginTop: '0.75em', maxWidth: 420 }}
          onSubmit={(e) => {
            e.preventDefault();
            void handleUnlock();
          }}
        >
          <Form.Field>
            <label htmlFor="fabric-identity-unlock-password">{copy.unlock.password}</label>
            <input
              id="fabric-identity-unlock-password"
              type="password"
              aria-describedby="fabric-identity-unlock-password-hint"
              autoComplete="current-password"
              value={unlockPassword}
              disabled={busy}
              onChange={(e) => setUnlockPassword(e.target.value)}
              style={inputStyle}
            />
            <div id="fabric-identity-unlock-password-hint" style={hintStyle}>{copy.unlock.hint}</div>
          </Form.Field>
          <Button type="submit" primary size="small" icon labelPosition="left" loading={busy} disabled={busy}>
            <Icon name="unlock" aria-hidden="true" />
            {copy.unlock.submit}
          </Button>
        </Form>
      ) : null}
      <div style={{ marginTop: '0.75em', display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
        <Button
          size="small"
          icon
          labelPosition="left"
          onClick={() => {
            try {
              if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(localIdentity.id);
            } catch (e) {}
          }}
        >
          <Icon name="copy" aria-hidden="true" />
          {copy.copyId}
        </Button>
        {!isPassport && hasStoredVault ? (
          <Button size="small" icon labelPosition="left" title={copy.backup.downloadTitle} onClick={handleDownloadBackup}>
            <Icon name="download" aria-hidden="true" />
            {copy.backup.download}
          </Button>
        ) : null}
        {keyState === 'unlocked' ? (
          <Button
            size="small"
            icon
            labelPosition="left"
            onClick={() => setLocalIdentity((prev) => lockIdentity(prev))}
          >
            <Icon name="lock" aria-hidden="true" />
            {copy.lock}
          </Button>
        ) : null}
      </div>
      {!isPassport && hasStoredVault ? (
        <p style={hintStyle}>{copy.backup.note}</p>
      ) : null}
      {!suppressForget ? (
        <>
          <Button
            size="small"
            basic
            color="red"
            icon
            labelPosition="left"
            style={{ marginTop: '1em' }}
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
              <p><strong>{copy.forget.warning}</strong></p>
              <p>{copy.forget.recover}</p>
              <p>{copy.forget.question}</p>
            </Modal.Content>
            <Modal.Actions>
              <Button onClick={() => setShowConfirmForget(false)}>{t.common.actions.cancel}</Button>
              <Button color="red" onClick={handleForget}>
                <Icon name="trash" aria-hidden="true" />
                {copy.forget.confirm}
              </Button>
            </Modal.Actions>
          </Modal>
        </>
      ) : null}
    </>
  );

  const renderCreate = () => (
    <>
      <Header as="h4">{copy.create.title}</Header>
      <p style={{ color: '#666' }}>{copy.create.intro}</p>
      <Message warning>
        <Message.Header>{copy.create.phraseTitle}</Message.Header>
        <p>{copy.create.body}</p>
        <p>{copy.create.keepSafe}</p>
      </Message>
      <p style={{ marginBottom: 0 }}><strong>{copy.create.phraseLabel}</strong></p>
      <p style={{ color: '#666', margin: '0.15em 0 0' }}>{copy.create.phraseNote}</p>
      <code style={identityMonospaceBlockStyle} data-testid="identity-new-phrase">
        {showPhrase && newMnemonic ? newMnemonic : copy.create.phraseHidden}
      </code>
      <Button size="small" basic disabled={!newMnemonic} onClick={() => setShowPhrase((v) => !v)}>
        <Icon name={showPhrase ? 'eye slash' : 'eye'} aria-hidden="true" />
        {showPhrase ? copy.create.hidePhrase : copy.create.showPhrase}
      </Button>
      <Button
        size="small"
        basic
        disabled={!showPhrase || !newMnemonic}
        title={showPhrase ? undefined : copy.create.copyPhraseTitle}
        onClick={() => {
          try {
            void navigator.clipboard.writeText(newMnemonic);
          } catch (_) {}
        }}
      >
        <Icon name="copy" aria-hidden="true" />
        {copy.create.copyPhrase}
      </Button>
      <Button
        size="small"
        basic
        disabled={busy}
        onClick={() => {
          setShowPhrase(false);
          setBackupAcknowledged(false);
          setNewMnemonic(generateMnemonic());
        }}
      >
        <Icon name="refresh" aria-hidden="true" />
        {copy.create.regenerate}
      </Button>
      <Form style={{ marginTop: '1em', maxWidth: 420 }}>
        <PassphraseField id="fabric-identity-new-passphrase" value={passphrase} onChange={setPassphrase} disabled={busy} />
        <LockPasswordFields
          idPrefix="fabric-identity-new-password"
          value={lockPassword}
          confirm={lockPasswordConfirm}
          onChange={setLockPassword}
          onConfirmChange={setLockPasswordConfirm}
          disabled={busy}
        />
        <Form.Field>
          <Checkbox
            checked={backupAcknowledged}
            onChange={(e, d) => setBackupAcknowledged(!!d.checked)}
            label={copy.create.acknowledge}
          />
        </Form.Field>
      </Form>
      <div style={{ marginTop: '0.75em' }}>
        <Button
          primary
          size="small"
          icon
          labelPosition="left"
          loading={busy}
          disabled={busy || !newMnemonic || !backupAcknowledged}
          title={backupAcknowledged ? undefined : copy.create.submitTitle}
          onClick={handleCreate}
        >
          <Icon name="shield" aria-hidden="true" />
          {copy.create.submit}
        </Button>
        {!props.postSetupFlow ? backButton : null}
      </div>
    </>
  );

  const renderRestore = () => (
    <>
      <Header as="h4">{copy.restore.title}</Header>
      <Message info size="small">
        <Message.Header>{copy.restore.howTitle}</Message.Header>
        <ul style={{ margin: '0.5em 0 0 1em', paddingLeft: '0.5em' }}>
          {copy.restore.how.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
        <p style={{ marginTop: '0.5em' }}>{copy.restore.safety}</p>
      </Message>
      <Form style={{ maxWidth: 520 }}>
        <Form.Field>
          <label htmlFor="fabric-restore-mnemonic">{copy.restore.phraseLabel}</label>
          <textarea
            id="fabric-restore-mnemonic"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder={copy.restore.phrasePlaceholder}
            value={restorePhrase}
            disabled={busy}
            onChange={(e) => setRestorePhrase(e.target.value)}
          />
        </Form.Field>
        <PassphraseField id="fabric-restore-bip39-pass" value={passphrase} onChange={setPassphrase} disabled={busy} />
        <LockPasswordFields
          idPrefix="fabric-restore-password"
          value={lockPassword}
          confirm={lockPasswordConfirm}
          onChange={setLockPassword}
          onConfirmChange={setLockPasswordConfirm}
          disabled={busy}
        />
        {hasStoredVault ? (
          <Form.Field>
            <Checkbox
              checked={restoreReplace}
              onChange={(e, d) => setRestoreReplace(!!d.checked)}
              label={copy.restore.replace}
            />
          </Form.Field>
        ) : null}
      </Form>
      <div style={{ marginTop: '0.75em' }}>
        <Button primary size="small" icon labelPosition="left" loading={busy} disabled={busy} onClick={handleRestore}>
          <Icon name="redo" aria-hidden="true" />
          {copy.restore.submit}
        </Button>
        {backButton}
      </div>
    </>
  );

  const renderImport = () => (
    <>
      <Header as="h4">{copy.importBackup.title}</Header>
      <p style={{ color: '#666' }}>{copy.importBackup.intro}</p>
      <Form
        style={{ maxWidth: 420 }}
        onSubmit={(e) => {
          e.preventDefault();
          void handleImport();
        }}
      >
        <Form.Field>
          <label htmlFor="fabric-import-backup-file">{copy.importBackup.fileLabel}</label>
          <input
            id="fabric-import-backup-file"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(e) => handleImportFile(e.target.files && e.target.files[0])}
          />
        </Form.Field>
        <Form.Field>
          <label htmlFor="fabric-import-backup-pwd">{copy.importBackup.passwordLabel}</label>
          <input
            id="fabric-import-backup-pwd"
            type="password"
            autoComplete="current-password"
            value={importPassword}
            disabled={busy}
            onChange={(e) => setImportPassword(e.target.value)}
            style={inputStyle}
          />
        </Form.Field>
        <Button type="submit" primary size="small" icon labelPosition="left" loading={busy} disabled={busy || !importVault}>
          <Icon name="upload" aria-hidden="true" />
          {copy.importBackup.submit}
        </Button>
        {backButton}
      </Form>
    </>
  );

  const renderChooser = () => (
    <>
      <p style={{ color: '#666' }}>{copy.chooser.prompt}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', maxWidth: 320 }}>
        {hubHttpAvailable && typeof window !== 'undefined' && !props.postSetupFlow && !isDesktopShell ? (
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
        {hubHttpAvailable && !props.postSetupFlow && isDesktopShell ? (
          <Button
            fluid
            icon
            labelPosition="left"
            loading={busy}
            disabled={busy}
            onClick={handleSignInAsHub}
            title={copy.chooser.hubSelfTitle}
          >
            <Icon name="desktop" aria-hidden="true" />
            {copy.chooser.hubSelf}
          </Button>
        ) : null}
        <Button fluid icon labelPosition="left" color="green" onClick={() => setLoginMethod('generate')}>
          <Icon name="shield" aria-hidden="true" />
          {copy.chooser.generate}
        </Button>
        <Button fluid icon labelPosition="left" onClick={() => setLoginMethod('import')}>
          <Icon name="upload" aria-hidden="true" />
          {copy.chooser.backup}
        </Button>
        <Button fluid icon labelPosition="left" title={copy.chooser.restoreTitle} onClick={() => setLoginMethod('restore')}>
          <Icon name="redo" aria-hidden="true" />
          {copy.chooser.restore}
        </Button>
      </div>
    </>
  );

  let body = null;
  if (localIdentity) body = renderIdentity();
  else if (loginMethod === 'generate') body = renderCreate();
  else if (loginMethod === 'restore') body = renderRestore();
  else if (loginMethod === 'import') body = renderImport();
  else body = renderChooser();

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
        {body}
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
