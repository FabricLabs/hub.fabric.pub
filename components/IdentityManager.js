'use strict';

// Constants
const DEFAULT_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Dependencies
const React = require('react');
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

function IdentityManager (props) {
  const lockTimeoutMs = (props && typeof props.lockTimeoutMs === 'number' && props.lockTimeoutMs > 0)
    ? props.lockTimeoutMs
    : DEFAULT_LOCK_TIMEOUT_MS;
  const [localIdentity, setLocalIdentity] = React.useState(() => {
    // If parent already has an unlocked identity (with xprv), use that to preserve unlocked state.
    if (props.currentIdentity && props.currentIdentity.xprv) {
      return {
        id: props.currentIdentity.id,
        xpub: props.currentIdentity.xpub,
        xprv: props.currentIdentity.xprv,
        passwordProtected: !!props.currentIdentity.passwordProtected
      };
    }

    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const raw = window.localStorage.getItem('fabric.identity.local');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
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
          console.warn('[IDENTITY]', 'Failed to restore xpub-only identity:', e);
          return null;
        }
      }

      return null;
    } catch (e) {
      console.warn('[IDENTITY]', 'Failed to restore local identity:', e);
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
  const [loginMethod, setLoginMethod] = React.useState(null); // 'existing' | 'generate' | null

  const resetSeedState = () => {
    setPendingSeed(null);
    setSeedConfirmed(false);
    setIdentityPassword('');
    setIdentityPasswordConfirm('');
    setIsGenerating(false);
    setShowSeedPhrase(false);
    setShowBackupKey(false);
    setUnlockPassword('');
    setLoginMethod(null);
  };

  // Derive lock state from localIdentity. Only "locked" when password-protected and no xprv (user can unlock).
  const isLocked = !!(localIdentity && localIdentity.id && localIdentity.xpub && !localIdentity.xprv && localIdentity.passwordProtected);

  // Automatically re-lock the private key after the configured timeout.
  React.useEffect(() => {
    if (!localIdentity || !localIdentity.xprv || !lockTimeoutMs) return;

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

  // Notify parent when the local identity changes so outer UI (TopPanel) and Bridge can update.
  // Include xprv when available so Bridge can encrypt documents.
  React.useEffect(() => {
    if (typeof props.onLocalIdentityChange !== 'function') return;
    if (localIdentity && localIdentity.id && localIdentity.xpub) {
      props.onLocalIdentityChange({
        id: localIdentity.id,
        xpub: localIdentity.xpub,
        xprv: localIdentity.xprv || undefined,
        passwordProtected: !!localIdentity.passwordProtected
      });
    } else {
      props.onLocalIdentityChange(null);
    }
  }, [localIdentity, props.onLocalIdentityChange]);

  // Notify parent when lock state changes so header can show lock icon.
  // Only report "locked" when user can unlock (password-protected), not for xpub-only.
  React.useEffect(() => {
    if (typeof props.onLockStateChange !== 'function') return;
    props.onLockStateChange(isLocked);
  }, [localIdentity, isLocked, props.onLockStateChange]);

  return (
    <Segment basic>
      <Header as="h3">
        <Icon name="key" />
        <Header.Content>Identity</Header.Content>
      </Header>
      <div>
        {localIdentity ? (
          <>
            <p><strong>Identity ID:</strong> <code>{localIdentity.id}</code></p>
            <p><strong>XPUB:</strong> <code>{localIdentity.xpub}</code></p>
            <p style={{ color: '#666' }}>
              <strong>Private key:</strong>{' '}
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
            {localIdentity.xprv ? (
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
                        if (typeof window === 'undefined' || !window.localStorage) {
                          throw new Error('Secure storage not available in this environment.');
                        }
                        const raw = window.localStorage.getItem('fabric.identity.local');
                        if (!raw) throw new Error('No stored identity found.');
                        const parsed = JSON.parse(raw);
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
                        console.error('[IDENTITY]', 'Unlock failed:', err);
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
                      if (typeof window !== 'undefined' && window.localStorage) {
                        window.localStorage.removeItem('fabric.identity.local');
                        window.localStorage.removeItem('fabric:documents');
                      }
                    } catch (e) {
                      console.error('[IDENTITY]', 'Forget identity error:', e);
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
                  setBusy(true);
                  try {
                    const xprv = pendingSeed && pendingSeed.xprv;
                    if (!xprv) throw new Error('Missing xprv for pending seed.');
                    const identity = new Identity({ xprv });
                    const key = identity.key;
                    const pwd = a;
                    const isPasswordProtected = true;
                    if (typeof window !== 'undefined' && window.localStorage) {
                      const salt = crypto.randomBytes(16).toString('hex');
                      const keyBytes = crypto.createHash('sha256')
                        .update(salt + pwd)
                        .digest();
                      const iv = crypto.randomBytes(16);
                      const cipher = crypto.createCipheriv('aes-256-cbc', keyBytes, iv);
                      let enc = cipher.update(xprv, 'utf8', 'hex');
                      enc += cipher.final('hex');
                      const payload = {
                        id: identity.id,
                        xpub: key.xpub,
                        xprvEnc: iv.toString('hex') + ':' + enc,
                        passwordProtected: true,
                        passwordSalt: salt
                      };
                      window.localStorage.setItem('fabric.identity.local', JSON.stringify(payload));
                    }
                    const nextIdentity = {
                      id: identity.id != null ? String(identity.id) : undefined,
                      xpub: key.xpub != null ? String(key.xpub) : undefined,
                      xprv: xprv != null ? String(xprv) : undefined,
                      passwordProtected: isPasswordProtected
                    };

                    // Make refresh-after-login deterministic for this tab/session.
                    try {
                      if (typeof window !== 'undefined' && window.sessionStorage) {
                        window.sessionStorage.setItem('fabric.identity.unlocked', JSON.stringify(nextIdentity));
                      }
                    } catch (e) {}

                    setLocalIdentity(nextIdentity);
                    if (typeof props.onLocalIdentityChange === 'function') {
                      props.onLocalIdentityChange(nextIdentity);
                    }
                    resetSeedState();
                    if (typeof props.onUnlockSuccess === 'function') {
                      props.onUnlockSuccess(nextIdentity);
                    }
                  } catch (e) {
                    console.error('[IDENTITY]', 'Save and login failed:', e);
                    setError((e && e.message) ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="arrow right" />
                Continue
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
                    console.error('[IDENTITY]', 'Regenerate identity failed:', e);
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
            <p style={{ color: '#666' }}>
              Your identity seed and backup key have been generated. Save them somewhere secure before continuing.
            </p>
            {pendingSeed.mnemonic && (
              <>
                <p><strong>Seed phrase (mnemonic):</strong></p>
                <Segment inverted color="blue">
                  {showSeedPhrase ? (
                    <code style={{ whiteSpace: 'pre-wrap' }}>{pendingSeed.mnemonic}</code>
                  ) : (
                    <span style={{ color: '#ccd', fontStyle: 'italic' }}>
                      Hidden for privacy. Click &quot;Show seed phrase&quot; to reveal.
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
                  {showSeedPhrase ? 'Hide seed phrase' : 'Show seed phrase'}
                </Button>
              </>
            )}
            <p style={{ marginTop: '0.75em' }}><strong>Backup key (XPRV):</strong></p>
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
              onClick={() => {
                try {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
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
                  const contents = [
                    '# Fabric Identity Backup',
                    '',
                    pendingSeed.mnemonic ? 'Seed phrase (mnemonic):' : null,
                    pendingSeed.mnemonic || null,
                    '',
                    'Backup key (xprv):',
                    xprv,
                    ''
                  ].filter((line) => line !== null).join('\n');
                  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'fabric-identity-backup.txt';
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
            <Button
              primary
              size="small"
              icon
              labelPosition="left"
              style={{ marginLeft: '0.5em' }}
              onClick={() => {
                try {
                  const xprv = pendingSeed && pendingSeed.xprv;
                  if (!xprv) throw new Error('Missing xprv for pending seed.');
                  const identity = new Identity({ xprv });
                  const key = identity.key;
                  const pwd = String(identityPassword || '').trim();
                  const isPasswordProtected = !!pwd;
                  if (typeof window !== 'undefined' && window.localStorage) {
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
                    window.localStorage.setItem('fabric.identity.local', JSON.stringify(payload));
                  }
                  setLocalIdentity({
                    id: identity.id,
                    xpub: key.xpub,
                    xprv,
                    passwordProtected: isPasswordProtected
                  });
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
                  console.error('[IDENTITY]', 'Save local identity failed:', e);
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75em', maxWidth: 320 }}>
              <Button
                primary
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
                setLoginMethod(null);
                setXpubInput('');
                setError(null);
              }}
            >
              <Icon name="arrow left" />
              Back
            </Button>
            <Header as="h4" size="small">
              <Icon name="key" />
              <Header.Content>Use Existing Key</Header.Content>
            </Header>
            <p style={{ color: '#666' }}>
              Paste your extended public key (xpub) to connect. It will be stored only in this browser.
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
                    if (typeof window !== 'undefined' && window.localStorage) {
                      window.localStorage.setItem('fabric.identity.local', JSON.stringify({ xpub: key.xpub }));
                    }
                  } catch (e) {}

                  setLocalIdentity({
                    id: identity.id,
                    xpub: key.xpub,
                    xprv: null
                  });
                  resetSeedState();
                } catch (e) {
                  console.error('[IDENTITY]', 'Activate xpub failed:', e);
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
        ) : loginMethod === 'generate' ? (
          <>
            <Button
              basic
              size="small"
              icon
              labelPosition="left"
              style={{ marginBottom: '1em' }}
              onClick={() => {
                setLoginMethod(null);
                setError(null);
              }}
            >
              <Icon name="arrow left" />
              Back
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
                  console.error('[IDENTITY]', 'Generate identity failed:', e);
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
          <div style={{ marginTop: '0.75em', color: '#b00' }}>
            <p style={{ margin: 0 }}><strong>Error:</strong></p>
            <pre style={{ marginTop: '0.5em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</pre>
          </div>
        )}
      </div>
    </Segment>
  );
}

module.exports = IdentityManager;
