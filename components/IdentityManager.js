'use strict';

// Constants
const DEFAULT_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');
const crypto = require('crypto');

// Fabric Types
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');

// Semantic UI
const {
  Accordion,
  Button,
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
  writeStorageJSON,
  removeStorageKey
} = require('../functions/fabricBrowserState');

const STORAGE_LINKED_DEVICES = 'fabric.linkedDevices';

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

function readLinkedDevices () {
  try {
    if (typeof window === 'undefined') return [];
    const j = readStorageJSON(STORAGE_LINKED_DEVICES, []);
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

function mergeLinkedDevice (entry) {
  try {
    if (typeof window === 'undefined') return;
    let list = readLinkedDevices();
    list = list.filter((d) => !(d && d.kind === entry.kind && d.hubOrigin === entry.hubOrigin));
    list.push(entry);
    writeStorageJSON(STORAGE_LINKED_DEVICES, list);
  } catch (e) {}
}

function IdentityManager (props) {
  const lockTimeoutMs = (props && typeof props.lockTimeoutMs === 'number' && props.lockTimeoutMs > 0)
    ? props.lockTimeoutMs
    : DEFAULT_LOCK_TIMEOUT_MS;
  const [localIdentity, setLocalIdentity] = React.useState(() => {
    // Parent identity is authoritative when provided (prevents lock/watch-only state drifting from shell).
    if (props.currentIdentity && (props.currentIdentity.id || props.currentIdentity.xpub)) {
      return {
        id: props.currentIdentity.id,
        xpub: props.currentIdentity.xpub,
        xprv: props.currentIdentity.xprv || null,
        passwordProtected: !!props.currentIdentity.passwordProtected,
        linkedFromDesktop: !!props.currentIdentity.linkedFromDesktop
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

      // Prefer full xprv-based identities (can sign locally).
      if (parsed.xprv && !parsed.passwordProtected) {
        const ident = new Identity({ xprv: parsed.xprv });
        return {
          id: ident.id,
          xpub: ident.key.xpub,
          xprv: parsed.xprv,
          passwordProtected: false
        };
      }

      // Password-protected identity: we know id/xpub but keep xprv locked until password is provided.
      if (parsed.passwordProtected && parsed.id && parsed.xpub) {
        return {
          id: parsed.id,
          xpub: parsed.xpub,
          xprv: null,
          passwordProtected: true
        };
      }

      // Fallback: xpub-only identity (public identifier only; signing disabled here).
      if (parsed.xpub) {
        try {
          const key = new Key({ xpub: parsed.xpub });
          const ident = new Identity(key);
          return {
            id: ident.id,
            xpub: key.xpub,
            xprv: null,
            passwordProtected: false
          };
        } catch (e) {
          console.warn('[IDENTITY]', 'Failed to restore xpub-only identity:', safeIdentityErr(e));
          return null;
        }
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
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [showSeedPhrase, setShowSeedPhrase] = React.useState(false);
  const [showBackupKey, setShowBackupKey] = React.useState(false);
  const [loginMethod, setLoginMethod] = React.useState(null); // 'existing' | 'generate' | 'import' | 'restoreMnemonic' | 'mnemonicDev' | null
  const [devMnemonicText, setDevMnemonicText] = React.useState('');
  const [devBip39Passphrase, setDevBip39Passphrase] = React.useState('');
  const [devMnemonicReplace, setDevMnemonicReplace] = React.useState(false);
  /** User must check before finishing a newly generated identity (backup discipline). */
  const [backupAcknowledged, setBackupAcknowledged] = React.useState(false);

  const resetSeedState = () => {
    setPendingSeed(null);
    setSeedConfirmed(false);
    setIdentityPassword('');
    setIdentityPasswordConfirm('');
    setIsGenerating(false);
    setShowSeedPhrase(false);
    setShowBackupKey(false);
    setUnlockPassword('');
    setDevMnemonicText('');
    setDevBip39Passphrase('');
    setDevMnemonicReplace(false);
    setBackupAcknowledged(false);
    setLoginMethod(null);
  };

  // Derive lock state from localIdentity. Only "locked" when password-protected and no xprv (user can unlock).
  const isLocked = !!(localIdentity && localIdentity.id && localIdentity.xpub && !localIdentity.xprv && localIdentity.passwordProtected);

  // Automatically re-lock only password-protected keys after the configured timeout.
  React.useEffect(() => {
    if (!localIdentity || !localIdentity.xprv || !localIdentity.passwordProtected || !lockTimeoutMs) return;

    const timer = setTimeout(() => {
      setLocalIdentity((prev) => {
        if (!prev || !prev.xprv) return prev;
        return { ...prev, xprv: null };
      });
    }, lockTimeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [localIdentity && localIdentity.xprv, lockTimeoutMs]);

  // Persist unlocked key for this browser tab/session only, so refresh keeps the user unlocked.
  React.useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.sessionStorage) return;
      if (localIdentity && localIdentity.id && localIdentity.xpub && localIdentity.xprv) {
        window.sessionStorage.setItem('fabric.identity.unlocked', JSON.stringify({
          id: localIdentity.id,
          xpub: localIdentity.xpub,
          xprv: localIdentity.xprv,
          passwordProtected: !!localIdentity.passwordProtected
        }));
      } else {
        window.sessionStorage.removeItem('fabric.identity.unlocked');
      }
    } catch (e) {}
  }, [localIdentity]);

  function identityAnchorKey (i) {
    if (!i || (!i.id && !i.xpub)) return '';
    return `${String(i.id || '')}|${String(i.xpub || '')}|${i.passwordProtected ? '1' : '0'}|${i.linkedFromDesktop ? '1' : '0'}`;
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
        const isPasswordFlow = !!(p.passwordProtected || (prev && prev.passwordProtected));
        // Keep anti-flicker behavior, but honor explicit lock/unlock transitions for password-protected identities.
        if (!isPasswordFlow || prevHasXprv === parentHasXprv) return prev;
      }
      return {
        id: p.id,
        xpub: p.xpub,
        xprv: p.xprv || null,
        passwordProtected: !!p.passwordProtected,
        linkedFromDesktop: !!p.linkedFromDesktop
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
      cb({
        id: localIdentity.id,
        xpub: localIdentity.xpub,
        xprv: localIdentity.xprv || undefined,
        passwordProtected: !!localIdentity.passwordProtected
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
          xprv: localIdentity.xprv || undefined,
          passwordProtected: !!localIdentity.passwordProtected
        };
        chrome.storage.local.set({ 'fabric.identity.ext': payload });
      } else {
        chrome.storage.local.remove('fabric.identity.ext');
      }
    } catch (e) {}
  }, [localIdentity]);

  const [extensionAvailable, setExtensionAvailable] = React.useState(false);
  const desktopPollIntervalRef = React.useRef(null);

  React.useEffect(() => {
    return () => {
      if (desktopPollIntervalRef.current) {
        clearInterval(desktopPollIntervalRef.current);
        desktopPollIntervalRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const check = () => setExtensionAvailable(!!(typeof window !== 'undefined' && window.__FABRIC_HUB_EXTENSION__?.isAvailable));
    check();
    const t = setTimeout(check, 300);
    return () => clearTimeout(t);
  }, []);

  const handleLoginWithExtension = React.useCallback(async () => {
    if (!window.__FABRIC_HUB_EXTENSION__?.getIdentity) return;
    setBusy(true);
    setError(null);
    try {
      const identity = await window.__FABRIC_HUB_EXTENSION__.getIdentity();
      if (!identity || !identity.xpub) {
        setError('No identity found in extension. Create or restore one in the Fabric Hub extension popup first.');
        return;
      }
      // Extension → page only delivers watch-only fields (xpub + id). xprv never crosses postMessage into
      // the page JS realm; import or unlock a full key here when you need signing or decryption.
      try {
        if (typeof window !== 'undefined') {
          const toStore = identity.xprv
            ? { id: identity.id, xpub: identity.xpub, xprv: identity.xprv, passwordProtected: !!identity.passwordProtected }
            : { id: identity.id, xpub: identity.xpub };
          writeStorageJSON('fabric.identity.local', toStore);
        }
        if (identity.xprv && typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('fabric.identity.unlocked', JSON.stringify({
            id: identity.id,
            xpub: identity.xpub,
            xprv: identity.xprv,
            passwordProtected: !!identity.passwordProtected
          }));
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

  const handleLoginWithDesktop = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (window.fabricDesktop && window.fabricDesktop.isDesktopShell) return;
    if (desktopPollIntervalRef.current) {
      clearInterval(desktopPollIntervalRef.current);
      desktopPollIntervalRef.current = null;
    }
    setBusy(true);
    setError(null);
    const origin = window.location.origin;
    let sessionId = null;
    const maxAttempts = 360;
    let attempts = 0;
    try {
      const res = await fetch(`${origin}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ origin }),
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.sessionId) {
        throw new Error((data && data.error) || 'Could not start desktop login session');
      }
      sessionId = data.sessionId;
      const protocolUrl = data.protocolUrl || (`fabric://login?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`);

      desktopPollIntervalRef.current = setInterval(() => {
        attempts++;
        if (attempts > maxAttempts) {
          if (desktopPollIntervalRef.current) clearInterval(desktopPollIntervalRef.current);
          desktopPollIntervalRef.current = null;
          setBusy(false);
          setError('Timed out waiting for the Fabric Hub desktop app. Start it, then try again.');
          return;
        }
        void (async () => {
          try {
            const r = await fetch(`${origin}/sessions/${encodeURIComponent(sessionId)}`, {
              headers: { Accept: 'application/json' },
              cache: 'no-store'
            });
            const j = await r.json().catch(() => ({}));
            if (r.status === 403) {
              if (desktopPollIntervalRef.current) {
                clearInterval(desktopPollIntervalRef.current);
                desktopPollIntervalRef.current = null;
              }
              setBusy(false);
              setError((j && j.error) ? String(j.error) : 'Hub rejected this login session (check origin / proxy headers).');
              return;
            }
            if (!j.ok || j.status !== 'signed' || !j.identity) return;
            if (desktopPollIntervalRef.current) clearInterval(desktopPollIntervalRef.current);
            desktopPollIntervalRef.current = null;
            if (j.delegationToken) {
              try {
                writeStorageJSON(DELEGATION_STORAGE_KEY, {
                  token: j.delegationToken,
                  externalSigning: true,
                  hubOrigin: origin,
                  linkedAt: new Date().toISOString()
                });
                notifyDelegationStorageChanged();
              } catch (e) {}
            }
            const xpub = j.identity.xpub;
            const rid = j.identity.id;
            if (!xpub) throw new Error('Hub did not return xpub');
            const k = new Key({ xpub });
            const ident = new Identity(k);
            const resolvedId = rid != null ? String(rid) : String(ident.id);
            const payload = { id: resolvedId, xpub, linkedFromDesktop: true };
            try {
              writeStorageJSON('fabric.identity.local', payload);
            } catch (e) {}
            mergeLinkedDevice({
              kind: 'fabric-desktop',
              hubOrigin: origin,
              fabricId: resolvedId,
              linkedAt: new Date().toISOString(),
              label: 'Fabric Hub (desktop)'
            });
            setLocalIdentity({
              id: resolvedId,
              xpub,
              xprv: null,
              passwordProtected: false,
              linkedFromDesktop: true
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
            setBusy(false);
          } catch (err) {
            if (desktopPollIntervalRef.current) clearInterval(desktopPollIntervalRef.current);
            desktopPollIntervalRef.current = null;
            setBusy(false);
            setError((err && err.message) ? err.message : String(err));
          }
        })();
      }, 600);

      const a = document.createElement('a');
      a.href = protocolUrl;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      if (desktopPollIntervalRef.current) {
        clearInterval(desktopPollIntervalRef.current);
        desktopPollIntervalRef.current = null;
      }
      setError((e && e.message) ? e.message : String(e));
      setBusy(false);
    }
  }, [props.onLocalIdentityChange, props.onUnlockSuccess]);

  return (
    <Segment basic style={{ minWidth: 0, maxWidth: '100%' }}>
      <Header as="h3" id="fabric-identity-modal-heading">
        <Icon name="key" aria-hidden="true" />
        <Header.Content>Fabric Identity</Header.Content>
      </Header>
      <p style={{ color: '#666', marginTop: '0.25em', marginBottom: '0.75em', maxWidth: '42em', lineHeight: 1.45 }}>
        The top-bar <strong>Wallet</strong> chip, Bitcoin receive addresses, and{' '}
        <Link to="/documents">document</Link> flows (encrypt, publish, paid distribute / purchase proofs) use this identity when the private key is unlocked in this browser.
        {' '}On-chain derivation for this Hub is described under{' '}
        <Link to="/settings/bitcoin-wallet">Bitcoin wallet &amp; derivation</Link>.
        {' '}Reopen this dialog from the identity menu (<strong>User profile</strong>) or{' '}
        <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong>.
      </p>
      <div>
        {localIdentity ? (
          <>
            <p style={{ marginBottom: 0 }}><strong>XPUB (public identifier):</strong></p>
            <code style={identityMonospaceBlockStyle}>{localIdentity.xpub}</code>
            <p style={{ marginBottom: 0, marginTop: '0.25em' }}><strong>Bech32m ID:</strong></p>
            <code style={identityMonospaceBlockStyle}>{localIdentity.id}</code>
            {localIdentity.linkedFromDesktop ? (
              <Message info size="small" style={{ marginTop: '0.75em' }}>
                <Icon name="shield" />
                <strong>External signing</strong> is enabled — private keys stay on the Hub node; this browser holds a watch-only xpub.
                Use <strong>Sign message</strong> from the profile menu and confirm each request in the <strong>Fabric Hub desktop</strong> app.
                {' '}
                <Link to="/settings">Settings</Link>
                {' · '}
                <Link to="/settings/security">Security & delegation</Link>
              </Message>
            ) : null}
            {readLinkedDevices().length > 0 ? (
              <Segment style={{ marginTop: '1em' }}>
                <Header as="h4" size="small">
                  <Icon name="linkify" />
                  Linked devices
                </Header>
                <p style={{ color: '#666', fontSize: '0.95em' }}>
                  Browsers and apps you have authorized with this identity (same Hub origin).
                </p>
                <ul style={{ margin: '0.5em 0 0 1em' }}>
                  {readLinkedDevices().map((d, i) => (
                    <li key={i}>
                      <strong>{d.label || d.kind || 'Device'}</strong>
                      {d.hubOrigin ? ` — ${d.hubOrigin}` : ''}
                      {d.linkedAt ? ` (${new Date(d.linkedAt).toLocaleString()})` : ''}
                    </li>
                  ))}
                </ul>
              </Segment>
            ) : (
              <p style={{ color: '#888', fontSize: '0.92em', marginTop: '0.75em', marginBottom: 0 }}>
                No linked devices on this origin yet — desktop login or delegation flows add entries here for auditing.
              </p>
            )}
            <p style={{ color: '#666' }}>
              <strong>Private Key:</strong>{' '}
              {localIdentity.xprv
                ? 'unlocked in memory'
                : (isLocked ? 'locked (password protected)' : 'not stored in this browser')}
              {localIdentity.xprv && lockTimeoutMs ? (
                <span> — will re‑lock in {Math.round(lockTimeoutMs / 60000)} minutes.</span>
              ) : null}
            </p>
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
              <Icon name="copy" />
              Copy ID
            </Button>
            <Button
              size="small"
              icon
              labelPosition="left"
              style={{ marginLeft: '0.5em' }}
              onClick={() => {
                try {
                  if (!localIdentity || !localIdentity.xpub) return;
                  const hasXprv = !!localIdentity.xprv;
                  const backupPayload = {
                    type: 'fabric-identity-backup',
                    version: 1,
                    id: localIdentity.id || undefined,
                    xpub: localIdentity.xpub || undefined,
                    xprv: hasXprv ? String(localIdentity.xprv) : undefined
                  };
                  const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'fabric-identity-backup.json';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (e) {}
              }}
            >
              <Icon name="download" />
              Download backup
            </Button>
            {localIdentity.xprv && localIdentity.passwordProtected ? (
              <Button
                size="small"
                basic
                icon
                labelPosition="left"
                onClick={() => {
                  setLocalIdentity((prev) => {
                    if (!prev) return prev;
                    return { ...prev, xprv: null };
                  });
                }}
              >
                <Icon name="lock" />
                Lock private key
              </Button>
            ) : null}
            {!localIdentity.xprv && isLocked ? (
              <>
                <Form
                  style={{ marginTop: '0.75em', maxWidth: 360 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    const pwd = String(unlockPassword || '').trim();
                    if (!pwd) {
                      setError('Please enter your decryption password.');
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
                          throw new Error('Secure storage not available in this environment.');
                        }
                        const parsed = readStorageJSON('fabric.identity.local', null);
                        if (!parsed) throw new Error('No stored identity found.');
                        if (parsed && parsed.passwordProtected && parsed.xprvEnc && parsed.passwordSalt) {
                          const keyBytes = crypto.createHash('sha256')
                            .update(String(parsed.passwordSalt) + pwd)
                            .digest();
                          const parts = String(parsed.xprvEnc).split(':');
                          if (parts.length !== 2) throw new Error('Invalid encrypted key format.');
                          const iv = Buffer.from(parts[0], 'hex');
                          const blob = Buffer.from(parts[1], 'hex');
                          const decipher = crypto.createDecipheriv('aes-256-cbc', keyBytes, iv);
                          let decrypted = decipher.update(blob, 'hex', 'utf8');
                          decrypted += decipher.final('utf8');
                          const xprv = decrypted;
                          const identity = new Identity({ xprv });
                          const key = identity.key;
                          const nextIdentity = {
                            id: identity.id != null ? String(identity.id) : undefined,
                            xpub: key.xpub != null ? String(key.xpub) : undefined,
                            xprv: xprv != null ? String(xprv) : undefined,
                            passwordProtected: true
                          };
                          try {
                            if (typeof window !== 'undefined' && window.sessionStorage) {
                              window.sessionStorage.setItem('fabric.identity.unlocked', JSON.stringify(nextIdentity));
                            }
                          } catch (e) {}
                          setLocalIdentity(nextIdentity);
                          setUnlockPassword('');
                          setError(null);
                          if (typeof props.onUnlockSuccess === 'function') {
                            props.onUnlockSuccess(nextIdentity);
                          }
                        } else if (parsed && parsed.xprv && !parsed.passwordProtected) {
                          const xprv = parsed.xprv;
                          const identity = new Identity({ xprv });
                          const key = identity.key;
                          const nextIdentity = {
                            id: identity.id != null ? String(identity.id) : undefined,
                            xpub: key.xpub != null ? String(key.xpub) : undefined,
                            xprv: xprv != null ? String(xprv) : undefined,
                            passwordProtected: false
                          };
                          try {
                            if (typeof window !== 'undefined' && window.sessionStorage) {
                              window.sessionStorage.setItem('fabric.identity.unlocked', JSON.stringify(nextIdentity));
                            }
                          } catch (e) {}
                          setLocalIdentity(nextIdentity);
                          setUnlockPassword('');
                          setError(null);
                          if (typeof props.onUnlockSuccess === 'function') {
                            props.onUnlockSuccess(nextIdentity);
                          }
                        } else {
                          throw new Error('Stored identity is not password-protected.');
                        }
                      } catch (err) {
                        console.error('[IDENTITY]', 'Unlock failed:', safeIdentityErr(err));
                        setError('Incorrect password or corrupted identity. Please try again.');
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <Form.Field>
                    <label>Decryption password</label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                    />
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
                    <Icon name="unlock" />
                    Unlock private key
                  </Button>
                </Form>
              </>
            ) : null}
            <Button
              size="small"
              basic
              color="red"
              icon
              labelPosition="left"
              onClick={() => setShowConfirmForget(true)}
            >
              <Icon name="trash" />
              Forget local identity
            </Button>
            <Modal
              open={showConfirmForget}
              onClose={() => setShowConfirmForget(false)}
              closeOnDimmerClick={false}
              closeOnDocumentClick={false}
              closeOnEscape={false}
              size="small"
            >
              <Header icon="trash" content="Delete local identity?" />
              <Modal.Content>
                <p>
                  <strong>All local files and key material will be permanently deleted.</strong>
                </p>
                <p>
                  The only way to recover access to your data is to have your private key (xprv or seed).
                  If you have not backed these up, you will not be able to recover deleted documents or this identity.
                </p>
                <p>Are you sure you want to proceed?</p>
              </Modal.Content>
              <Modal.Actions>
                <Button onClick={() => setShowConfirmForget(false)}>
                  Cancel
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
                        removeStorageKey('fabric.identity.local');
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
                  <Icon name="trash" />
                  I understand, delete everything
                </Button>
              </Modal.Actions>
            </Modal>
          </>
        ) : isGenerating ? (
          <>
            <p style={{ color: '#666' }}>
              Generating a new identity for this browser. This only happens locally and never leaves your device.
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
              <Icon name="spinner" loading size="huge" />
              <p style={{ marginTop: '1em', color: '#666' }}>Please wait a moment…</p>
            </div>
          </>
        ) : pendingSeed && !seedConfirmed ? (
          <>
            <p style={{ color: '#666' }}>
              Provide an encryption password to protect your identity.
            </p>
            <Form style={{ marginTop: '0.75em' }}>
              <Form.Field>
                <label>Encryption password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={identityPassword}
                  onChange={(e) => setIdentityPassword(e.target.value)}
                />
              </Form.Field>
              <Form.Field>
                <label>Confirm password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={identityPasswordConfirm}
                  onChange={(e) => setIdentityPasswordConfirm(e.target.value)}
                />
              </Form.Field>
              <div style={{ marginTop: '0.5em', color: '#666', fontSize: '0.9em' }}>
                This password will be required to unlock your identity in this browser. Do not forget it.
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
                    setError('Please enter and confirm a password.');
                    return;
                  }
                  if (a.length < 8) {
                    setError('Password should be at least 8 characters long.');
                    return;
                  }
                  if (a !== b) {
                    setError('Passwords do not match. Please try again.');
                    return;
                  }
                  setError(null);
                  // Keep the generated seed in-memory and show backup details next.
                  // Final persistence/login happens in the "Login with this identity" step.
                  setBackupAcknowledged(false);
                  setSeedConfirmed(true);
                }}
              >
                <Icon name="arrow right" />
                Continue to backup review
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
                Cancel
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
                        throw new Error('Key did not produce mnemonic/xprv.');
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
                    setError((e && e.stack) ? e.stack : (e && e.message ? e.message : String(e)));
                  } finally {
                    setIsGenerating(false);
                    setBusy(false);
                  }
                }}
              >
                <Icon name="refresh" />
                Generate a different seed
              </Button>
            </div>
          </>
        ) : pendingSeed && seedConfirmed ? (
          <>
            <Message warning style={{ maxWidth: '42rem' }}>
              <Message.Header>Save your backup before continuing</Message.Header>
              <p style={{ margin: '0.5em 0 0', lineHeight: 1.5 }}>
                Your <strong>recovery phrase</strong> (and optional <strong>xprv</strong> or downloaded JSON) is the only way to restore this identity
                if you clear the browser or lose this device. Fabric cannot recover it for you.
                Prefer storing the <strong>xprv</strong> or phrase <strong>offline</strong> (paper, password manager, hardware workflow)—not only in this browser.
              </p>
            </Message>
            <p style={{ color: '#666' }}>
              Reveal each secret below, copy or write it down, then confirm at the bottom.
            </p>
            {pendingSeed.mnemonic && (
              <>
                <p><strong>Recovery phrase (BIP39 mnemonic)</strong> — most wallets use this format.</p>
                <Segment inverted color="blue">
                  {showSeedPhrase ? (
                    <code style={{ whiteSpace: 'pre-wrap' }}>{pendingSeed.mnemonic}</code>
                  ) : (
                    <span style={{ color: '#ccd', fontStyle: 'italic' }}>
                      Hidden for privacy. Click &quot;Show recovery phrase&quot; to reveal.
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
                  <Icon name={showSeedPhrase ? 'eye slash' : 'eye'} />
                  {showSeedPhrase ? 'Hide recovery phrase' : 'Show recovery phrase'}
                </Button>
                <Button
                  size="small"
                  basic
                  icon
                  labelPosition="left"
                  disabled={!showSeedPhrase}
                  title={!showSeedPhrase ? 'Reveal the phrase first so you know what you are copying' : undefined}
                  onClick={() => {
                    try {
                      if (typeof navigator !== 'undefined' && navigator.clipboard && pendingSeed.mnemonic) {
                        navigator.clipboard.writeText(pendingSeed.mnemonic);
                      }
                    } catch (e) {}
                  }}
                >
                  <Icon name="copy" />
                  Copy recovery phrase
                </Button>
              </>
            )}
            <p style={{ marginTop: '0.75em' }}><strong>Extended private key (xprv)</strong> — single serialized backup; import via <em>Import Backup</em> or paste into a JSON file.</p>
            <Segment>
              {showBackupKey ? (
                <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{pendingSeed.xprv}</code>
              ) : (
                <span style={{ color: '#666', fontStyle: 'italic' }}>
                  Hidden for privacy. Click &quot;Show backup key&quot; to reveal.
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
              <Icon name={showBackupKey ? 'eye slash' : 'eye'} />
              {showBackupKey ? 'Hide backup key' : 'Show backup key'}
            </Button>
            <Button
              size="small"
              icon
              labelPosition="left"
              disabled={!showBackupKey}
              title={!showBackupKey ? 'Reveal the xprv first so you know what you are copying' : undefined}
              onClick={() => {
                try {
                  if (typeof navigator !== 'undefined' && navigator.clipboard && pendingSeed.xprv) {
                    navigator.clipboard.writeText(pendingSeed.xprv);
                  }
                } catch (e) {}
              }}
            >
              <Icon name="copy" />
              Copy xprv
            </Button>
            <Button
              size="small"
              icon
              labelPosition="left"
              onClick={() => {
                try {
                  const xprv = pendingSeed && pendingSeed.xprv;
                  if (!xprv) return;
                  const backupPayload = {
                    type: 'fabric-identity-backup',
                    version: 1,
                    mnemonic: pendingSeed.mnemonic || undefined,
                    xprv,
                    xpub: undefined,
                    id: undefined
                  };
                  try {
                    const identity = new Identity({ xprv });
                    if (identity && identity.id && identity.key && identity.key.xpub) {
                      backupPayload.id = String(identity.id);
                      backupPayload.xpub = String(identity.key.xpub);
                    }
                  } catch (e) {}
                  const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'fabric-identity-backup.json';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (e) {}
              }}
            >
              <Icon name="download" />
              Download backup
            </Button>
            <Form style={{ marginTop: '1.25em', maxWidth: '42rem' }}>
              <Form.Checkbox
                checked={backupAcknowledged}
                onChange={(e, d) => setBackupAcknowledged(!!(d && d.checked))}
                aria-label="I have securely saved my recovery phrase and/or xprv or backup file and understand Fabric cannot recover this identity for me"
                label={
                  <span>
                    I have securely saved my recovery phrase and/or xprv (or downloaded the backup file). I understand I cannot recover this identity without them.
                  </span>
                }
              />
            </Form>
            <Button
              primary
              size="small"
              icon
              labelPosition="left"
              style={{ marginTop: '0.75em' }}
              disabled={!backupAcknowledged}
              title={!backupAcknowledged ? 'Confirm you have saved your backup' : undefined}
              onClick={() => {
                try {
                  const xprv = pendingSeed && pendingSeed.xprv;
                  if (!xprv) throw new Error('Missing xprv for pending seed.');
                  const identity = new Identity({ xprv });
                  const key = identity.key;
                  const pwd = String(identityPassword || '').trim();
                  const isPasswordProtected = !!pwd;
                  let hasStorage = false;
                  try {
                    hasStorage = (typeof window !== 'undefined');
                  } catch (e) {
                    hasStorage = false;
                  }
                  if (hasStorage) {
                    let payload = null;
                    if (isPasswordProtected) {
                      const salt = crypto.randomBytes(16).toString('hex');
                      const keyBytes = crypto.createHash('sha256')
                        .update(salt + pwd)
                        .digest();
                      const iv = crypto.randomBytes(16);
                      const cipher = crypto.createCipheriv('aes-256-cbc', keyBytes, iv);
                      let enc = cipher.update(xprv, 'utf8', 'hex');
                      enc += cipher.final('hex');
                      payload = {
                        id: identity.id,
                        xpub: key.xpub,
                        xprvEnc: iv.toString('hex') + ':' + enc,
                        passwordProtected: true,
                        passwordSalt: salt
                      };
                    } else {
                      payload = {
                        id: identity.id,
                        xpub: key.xpub,
                        xprv
                      };
                    }
                    writeStorageJSON('fabric.identity.local', payload);
                  }
                  setLocalIdentity({
                    id: identity.id,
                    xpub: key.xpub,
                    xprv,
                    passwordProtected: isPasswordProtected
                  });
                  if (typeof props.onLocalIdentityChange === 'function') {
                    props.onLocalIdentityChange({
                      id: identity.id != null ? String(identity.id) : undefined,
                      xpub: key.xpub != null ? String(key.xpub) : undefined,
                      xprv: xprv != null ? String(xprv) : undefined,
                      passwordProtected: !!isPasswordProtected
                    });
                  }
                  resetSeedState();
                  if (typeof props.onUnlockSuccess === 'function') {
                    props.onUnlockSuccess({
                      id: identity.id != null ? String(identity.id) : undefined,
                      xpub: key.xpub != null ? String(key.xpub) : undefined,
                      xprv: xprv != null ? String(xprv) : undefined,
                      passwordProtected: !!isPasswordProtected
                    });
                  }
                } catch (e) {
                  console.error('[IDENTITY]', 'Save local identity failed:', safeIdentityErr(e));
                  setError((e && e.stack) ? e.stack : (e && e.message ? e.message : String(e)));
                }
              }}
            >
              <Icon name="sign-in" />
              Login with this identity
            </Button>
          </>
        ) : loginMethod === null ? (
          <>
            <p style={{ color: '#666' }}>
              Choose how you would like to connect:
            </p>
            <Message info size="small" style={{ marginBottom: '0.85em', maxWidth: '40rem' }}>
              <p style={{ margin: 0, fontSize: '0.95em', color: '#333', lineHeight: 1.45 }}>
                <strong>Full key</strong> (generate, import backup, restore from recovery phrase, hub/dev mnemonic, desktop, extension, or password-unlock): encrypt and decrypt documents, publish signed listings, and use in-browser Payjoin when enabled.
                <strong> xpub-only</strong> (<em>Existing Key</em>): watch-only — the top-bar balance chip works, but you cannot sign publishes, decrypt your own ciphertext, or complete browser-side Payjoin without another signing path.
              </p>
            </Message>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', maxWidth: 320 }}>
              {extensionAvailable ? (
                <Button
                  primary
                  fluid
                  icon
                  labelPosition="left"
                  loading={busy}
                  disabled={busy}
                  onClick={handleLoginWithExtension}
                  title="Use identity from the Fabric Hub browser extension"
                >
                  <Icon name="puzzle piece" />
                  Login with Extension
                </Button>
              ) : null}
              {typeof window !== 'undefined' && !(window.fabricDesktop && window.fabricDesktop.isDesktopShell) ? (
                <Button
                  primary={!extensionAvailable}
                  fluid
                  icon
                  labelPosition="left"
                  loading={busy}
                  disabled={busy}
                  onClick={handleLoginWithDesktop}
                  title="Open the Fabric Hub desktop app to sign in with the same identity as this Hub node"
                >
                  <Icon name="desktop" />
                  Log in with Fabric Hub (desktop)
                </Button>
              ) : null}
              <Button
                primary={!extensionAvailable && (typeof window === 'undefined' || !!(window.fabricDesktop && window.fabricDesktop.isDesktopShell))}
                fluid
                icon
                labelPosition="left"
                onClick={() => setLoginMethod('existing')}
              >
                <Icon name="key" />
                Existing Key
              </Button>
              <Button
                fluid
                icon
                labelPosition="left"
                onClick={() => setLoginMethod('generate')}
              >
                <Icon name="shield" />
                Generate New Identity
              </Button>
              <Button
                fluid
                icon
                labelPosition="left"
                onClick={() => {
                  setLoginMethod('import');
                  setError(null);
                }}
              >
                <Icon name="download" />
                Import Backup
              </Button>
              <Button
                fluid
                icon
                labelPosition="left"
                onClick={() => {
                  setLoginMethod('restoreMnemonic');
                  setError(null);
                }}
                title="Restore the same keys as other BIP39 wallets using your recovery words"
              >
                <Icon name="history" />
                Restore with recovery phrase
              </Button>
              <Button
                fluid
                icon
                labelPosition="left"
                onClick={() => {
                  setLoginMethod('mnemonicDev');
                  setError(null);
                }}
                title="Regtest: reuse the hub node seed (FABRIC_SEED) in the browser—weakens key separation"
              >
                <Icon name="paste" />
                Import mnemonic (hub / dev)
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
              aria-label="Back to sign-in options"
              onClick={() => {
                setLoginMethod(null);
                setXpubInput('');
                setError(null);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              Change method
            </Button>
            <Header as="h4" size="small">
              <Icon name="key" />
              <Header.Content>Use Existing Key</Header.Content>
            </Header>
            <p style={{ color: '#666' }}>
              Paste your extended public key (xpub) to connect. It will be stored only in this browser.
              You can track balance and receive addresses against this xpub; you <strong>cannot</strong> decrypt encrypted documents, sign publishes, or spend from this browser without importing the matching seed or using desktop / extension signing.
            </p>
            <Form>
              <Form.Field>
                <label>Extended public key (xpub)</label>
                <Form.TextArea
                  rows={2}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', wordBreak: 'break-all' }}
                  placeholder="Paste your extended public key (xpub)…"
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
                    setError('Please paste an xpub to continue.');
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
                  setError((e && e.stack) ? e.stack : (e && e.message ? e.message : String(e)));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="sign-in" />
              Activate xpub
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
              aria-label="Back to sign-in options"
              onClick={() => {
                setLoginMethod(null);
                setError(null);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              Change method
            </Button>
            <Header as="h4" size="small">
              <Icon name="download" />
              <Header.Content>Import Backup</Header.Content>
            </Header>
            <p style={{ color: '#666' }}>
              Select a Fabric identity backup file (JSON) from this app, or JSON that includes <code>xprv</code> / <code>xpub</code>, or <strong>mnemonic</strong> (plus optional <code>bip39Passphrase</code> / <code>passphrase</code>).
            </p>
            <input
              type="file"
              accept=".json,application/json,text/*"
              onChange={(event) => {
                const file = event && event.target && event.target.files && event.target.files[0];
                if (!file) return;
                setBusy(true);
                setError(null);
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const text = String(reader.result || '');
                    let data = null;
                    try {
                      data = JSON.parse(text);
                    } catch (e) {}

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
                          setError((mnErr && mnErr.message)
                            ? `Could not restore from mnemonic in file: ${mnErr.message}`
                            : 'Could not restore from mnemonic in file.');
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
                      setError('Could not find an xprv or xpub in the selected file.');
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
                      setError('Failed to reconstruct identity from backup file.');
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
                            xprv
                          });
                        } else {
                          writeStorageJSON('fabric.identity.local', {
                            id: identity.id,
                            xpub: key.xpub
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
                    setError((e && e.message) ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                };
                reader.onerror = () => {
                  setBusy(false);
                  setError('Failed to read backup file.');
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
              aria-label="Back to sign-in options"
              onClick={() => {
                setLoginMethod(null);
                setError(null);
                setDevMnemonicText('');
                setDevBip39Passphrase('');
                setDevMnemonicReplace(false);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              Change method
            </Button>
            <Header as="h4" size="small">
              <Icon name="history" />
              <Header.Content>Restore with recovery phrase</Header.Content>
            </Header>
            <Message info style={{ maxWidth: '42rem' }}>
              <Message.Header>How this works</Message.Header>
              <p style={{ margin: '0.5em 0 0', lineHeight: 1.5 }}>
                Enter your <strong>BIP39 recovery phrase</strong> (usually 12 or 24 words). If you used an optional
                <strong> extension passphrase</strong> (sometimes called a 25th word) when the wallet was created, add it below—this is
                <em> not</em> the same as the optional encryption password you may set after generating a new identity in Fabric.
              </p>
              <p style={{ margin: '0.65em 0 0', lineHeight: 1.5 }}>
                Fabric derives the same master key as <strong>Generate New Identity</strong> and other standard BIP39 software.
                Prefer importing the <strong>xprv</strong> or JSON backup when you have it (single branch, fewer typos)—use <strong>Import Backup</strong>.
              </p>
            </Message>
            <Form>
              <Form.Field>
                <label htmlFor="fabric-restore-mnemonic">Recovery phrase</label>
                <Form.TextArea
                  id="fabric-restore-mnemonic"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', wordBreak: 'break-all' }}
                  placeholder="Enter your BIP39 words separated by spaces…"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  value={devMnemonicText}
                  onChange={(e) => setDevMnemonicText(e.target.value)}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="fabric-restore-bip39-pass">Extension passphrase (optional)</label>
                <Form.Input
                  id="fabric-restore-bip39-pass"
                  type="password"
                  placeholder="Only if your wallet used a passphrase with the phrase"
                  autoComplete="off"
                  value={devBip39Passphrase}
                  onChange={(e) => setDevBip39Passphrase(e.target.value)}
                />
              </Form.Field>
              <Form.Checkbox
                label="Replace the identity already stored in this browser"
                checked={devMnemonicReplace}
                onChange={(e, d) => setDevMnemonicReplace(!!(d && d.checked))}
                aria-label="Replace the identity already stored in this browser"
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
                    setError(r.error || 'Restore failed');
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
                  setError((e && e.message) ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="check circle" />
              Restore and unlock
            </Button>
          </>
        ) : loginMethod === 'mnemonicDev' ? (
          <>
            <Button
              basic
              size="small"
              icon
              labelPosition="left"
              style={{ marginBottom: '1em' }}
              aria-label="Back to sign-in options"
              onClick={() => {
                setLoginMethod(null);
                setError(null);
                setDevMnemonicText('');
                setDevBip39Passphrase('');
                setDevMnemonicReplace(false);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              Change method
            </Button>
            <Header as="h4" size="small">
              <Icon name="paste" />
              <Header.Content>Import mnemonic (hub / dev)</Header.Content>
            </Header>
            <Message warning>
              <Message.Header>Operator / development</Message.Header>
              <p style={{ margin: '0.5em 0 0' }}>
                Pasting the <strong>same</strong> mnemonic as the Hub node (<code>FABRIC_SEED</code> / <code>FABRIC_MNEMONIC</code>) is convenient on regtest but removes separation between the node and this browser.
                For day-to-day use, prefer a <strong>dedicated browser identity</strong>, <strong>Restore with recovery phrase</strong> for a personal wallet, or <strong>xpub-only</strong> with desktop signing.
                The optional field below is the BIP39 extension passphrase—not the UI encryption password.
              </p>
            </Message>
            <Form>
              <Form.Field>
                <label>BIP39 mnemonic</label>
                <Form.TextArea
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', wordBreak: 'break-all' }}
                  placeholder="Paste recovery phrase…"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  value={devMnemonicText}
                  onChange={(e) => setDevMnemonicText(e.target.value)}
                />
              </Form.Field>
              <Form.Field>
                <label>BIP39 extension passphrase (optional)</label>
                <Form.Input
                  type="password"
                  placeholder="Only if your wallet used a passphrase with the mnemonic"
                  autoComplete="off"
                  value={devBip39Passphrase}
                  onChange={(e) => setDevBip39Passphrase(e.target.value)}
                />
              </Form.Field>
              <Form.Checkbox
                label="Replace existing identity stored in this browser"
                checked={devMnemonicReplace}
                onChange={(e, d) => setDevMnemonicReplace(!!(d && d.checked))}
                aria-label="Replace existing identity stored in this browser"
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
                    setError(r.error || 'Import failed');
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
                  console.error('[IDENTITY]', 'Mnemonic import failed:', safeIdentityErr(e));
                  setError((e && e.message) ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="sign-in" />
              Store and unlock
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
              aria-label="Back to sign-in options"
              onClick={() => {
                setLoginMethod(null);
                setError(null);
              }}
            >
              <Icon name="arrow left" aria-hidden="true" />
              Change method
            </Button>
            <Header as="h4" size="small">
              <Icon name="shield" />
              <Header.Content>Generate New Identity</Header.Content>
            </Header>
            <p style={{ color: '#666' }}>
              Create a new identity with a 12-word seed phrase. This happens locally and never leaves your device.
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
                      throw new Error('Key did not produce mnemonic/xprv.');
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
                  setError((e && e.stack) ? e.stack : (e && e.message ? e.message : String(e)));
                } finally {
                  setIsGenerating(false);
                  setBusy(false);
                }
              }}
            >
              <Icon name="shield" />
              Generate new identity (12‑word seed)
            </Button>
          </>
        ) : null}
        {error && (
          <Message negative style={{ marginTop: '0.75em' }}>
            <Message.Header>Error</Message.Header>
            <pre style={{ margin: '0.5em 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85em' }}>
              {error}
            </pre>
          </Message>
        )}
      </div>
    </Segment>
  );
}

module.exports = IdentityManager;
