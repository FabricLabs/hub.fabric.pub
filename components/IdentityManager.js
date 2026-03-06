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
  Button,
  Form,
  Header,
  Icon,
  Segment,
  Tab
} = require('semantic-ui-react');

function IdentityManager (props) {
  const auth = props && props.auth ? props.auth : null;
  const lockTimeoutMs = (props && typeof props.lockTimeoutMs === 'number' && props.lockTimeoutMs > 0)
    ? props.lockTimeoutMs
    : DEFAULT_LOCK_TIMEOUT_MS;
  const [localIdentity, setLocalIdentity] = React.useState(() => {
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
          xprv: parsed.xprv
        };
      }

      // Password-protected identity: we know id/xpub but keep xprv locked until password is provided.
      if (parsed.passwordProtected && parsed.id && parsed.xpub) {
        return {
          id: parsed.id,
          xpub: parsed.xpub,
          xprv: null
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
            xprv: null
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
  const [messageToSign, setMessageToSign] = React.useState('');
  const [signature, setSignature] = React.useState(null);
  const [pendingSeed, setPendingSeed] = React.useState(null); // { mnemonic, xprv }
  const [seedConfirmed, setSeedConfirmed] = React.useState(false); // when true, show final backup/login screen
  const [xpubInput, setXpubInput] = React.useState('');
  const [identityPassword, setIdentityPassword] = React.useState('');
  const [identityPasswordConfirm, setIdentityPasswordConfirm] = React.useState('');
  const [unlockPassword, setUnlockPassword] = React.useState('');
  const [isLocked, setIsLocked] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [showSeedPhrase, setShowSeedPhrase] = React.useState(false);
  const [showBackupKey, setShowBackupKey] = React.useState(false);

  const mnemonicWords = React.useMemo(() => {
    if (!pendingSeed || !pendingSeed.mnemonic) return [];
    return String(pendingSeed.mnemonic).trim().split(/\s+/).filter(Boolean);
  }, [pendingSeed]);

  const resetSeedState = () => {
    setPendingSeed(null);
    setSeedConfirmed(false);
    setIdentityPassword('');
    setIdentityPasswordConfirm('');
    setIsGenerating(false);
    setShowSeedPhrase(false);
    setShowBackupKey(false);
    setUnlockPassword('');
  };

  // Automatically re-lock the private key after the configured timeout.
  React.useEffect(() => {
    if (!localIdentity || !localIdentity.xprv || !lockTimeoutMs) return;

    setIsLocked(false);

    const timer = setTimeout(() => {
      setLocalIdentity((prev) => {
        if (!prev || !prev.xprv) return prev;
        return { ...prev, xprv: null };
      });
      setIsLocked(true);
    }, lockTimeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [localIdentity && localIdentity.xprv, lockTimeoutMs]);

  // Initialize lock state based on stored passwordProtected flag.
  React.useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem('fabric.identity.local');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.passwordProtected) {
        setIsLocked(true);
      }
    } catch (e) {}
  }, []);

  // Notify parent when the local identity changes so outer UI (TopPanel) can update.
  React.useEffect(() => {
    if (typeof props.onLocalIdentityChange !== 'function') return;
    if (localIdentity && localIdentity.id && localIdentity.xpub) {
      props.onLocalIdentityChange({
        id: localIdentity.id,
        xpub: localIdentity.xpub
      });
    } else {
      props.onLocalIdentityChange(null);
    }
  }, [localIdentity, props.onLocalIdentityChange]);

  // Notify parent when lock state changes so header can show lock icon.
  React.useEffect(() => {
    if (typeof props.onLockStateChange !== 'function') return;
    const hasIdentity = !!(localIdentity && localIdentity.id && localIdentity.xpub);
    const currentlyLocked = hasIdentity && !localIdentity.xprv;
    props.onLockStateChange(currentlyLocked);
  }, [localIdentity, props.onLockStateChange]);

  const summary = (() => {
    if (localIdentity && localIdentity.id) return `Local identity ${localIdentity.id}`;
    if (!auth) return 'Not logged in';
    if (auth.username) return `Signed in as ${auth.username}`;
    if (auth.id) return `Signed in as ${auth.id}`;
    if (auth.address) return `Address ${auth.address}`;
    if (auth.xpub) return `XPUB ${String(auth.xpub).slice(0, 12)}…`;
    return 'Identity loaded';
  })();

  const panes = [
    {
      menuItem: { key: 'local', icon: 'key', content: 'Identity' },
      render: () => (
        <Tab.Pane attached={false}>
          <Header as="h3">
            <Icon name="key" />
            <Header.Content>Identity</Header.Content>
          </Header>
          <p style={{ color: '#666' }}>Manage your Fabric identity.
          </p>
          <Segment>
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
                      setIsLocked(true);
                    }}
                  >
                    <Icon name="lock" />
                    Lock private key
                  </Button>
                ) : null}
                {!localIdentity.xprv && isLocked ? (
                  <>
                    <Form style={{ marginTop: '0.75em', maxWidth: 360 }}>
                      <Form.Field>
                        <label>Decryption password</label>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={unlockPassword}
                          onChange={(e) => setUnlockPassword(e.target.value)}
                        />
                      </Form.Field>
                    </Form>
                    <Button
                      primary
                      size="small"
                      icon
                      labelPosition="left"
                      style={{ marginTop: '0.5em' }}
                      disabled={busy}
                      onClick={async () => {
                        const pwd = String(unlockPassword || '').trim();
                        if (!pwd) {
                          setError('Please enter your decryption password.');
                          return;
                        }
                        setBusy(true);
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
                            setLocalIdentity({
                              id: identity.id,
                              xpub: key.xpub,
                              xprv
                            });
                            setIsLocked(false);
                            setUnlockPassword('');
                            setError(null);
                          } else if (parsed && parsed.xprv && !parsed.passwordProtected) {
                            // Legacy plaintext storage: accept any password and restore for compatibility.
                            const xprv = parsed.xprv;
                            const identity = new Identity({ xprv });
                            const key = identity.key;
                            setLocalIdentity({
                              id: identity.id,
                              xpub: key.xpub,
                              xprv
                            });
                            setIsLocked(false);
                            setUnlockPassword('');
                            setError(null);
                          } else {
                            throw new Error('Stored identity is not password-protected.');
                          }
                        } catch (e) {
                          console.error('[IDENTITY]', 'Unlock failed:', e);
                          setError('Incorrect password or corrupted identity. Please try again.');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Icon name="unlock" />
                      Unlock private key
                    </Button>
                  </>
                ) : null}
                <Button
                  size="small"
                  basic
                  color="red"
                  icon
                  labelPosition="left"
                  onClick={() => {
                    try {
                      if (typeof window !== 'undefined' && window.localStorage) {
                        window.localStorage.removeItem('fabric.identity.local');
                      }
                    } catch (e) {}
                    setLocalIdentity(null);
                    setSignature(null);
                    setIsLocked(false);
                  }}
                >
                  <Icon name="trash" />
                  Forget local identity
                </Button>
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
                      setSeedConfirmed(true);
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
                      if (typeof window !== 'undefined' && window.localStorage) {
                        const pwd = String(identityPassword || '').trim();
                        let payload = null;
                        if (pwd) {
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
                        xprv
                      });
                      resetSeedState();
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
            ) : (
              <>
                <p style={{ color: '#666' }}>
                  Connect by pasting an existing extended public key (xpub), or generate a new identity for this browser.
                </p>

                <Header as="h4" size="small">
                  <Icon name="sign-in" />
                  <Header.Content>Use existing XPUB</Header.Content>
                </Header>
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
                    <div style={{ marginTop: '0.5em', color: '#666', fontSize: '0.9em' }}>
                      Paste the xpub exported from your wallet or browser extension. It will be stored only in this browser.
                    </div>
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

                      // Validate and derive identity from the xpub using @fabric/core Key/Identity.
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

                <div style={{ margin: '1em 0', textAlign: 'center', color: '#999' }}>or</div>

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
                      // Use Key's internal FROM_RANDOM behaviour (12‑word BIP‑39 mnemonic + xprv).
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
            )}
            {error && (
              <div style={{ marginTop: '0.75em', color: '#b00' }}>
                <p style={{ margin: 0 }}><strong>Error:</strong></p>
                <pre style={{ marginTop: '0.5em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</pre>
              </div>
            )}
          </Segment>
        </Tab.Pane>
      )
    }
  ];

  return (
    <Segment basic>
      <Tab menu={{ secondary: true, pointing: true }} panes={panes} />
    </Segment>
  );
}

module.exports = IdentityManager;
