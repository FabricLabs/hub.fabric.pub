'use strict';

/**
 * Settings: explain Bitcoin derivation under the Fabric identity master.
 */

const React = require('react');
const { Link } = require('react-router-dom');
const { Header, Icon, Message, Segment } = require('semantic-ui-react');
const {
  BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX,
  getSpendWalletContext
} = require('../functions/bitcoinClient');
const { classifyHubBrowserIdentity } = require('../functions/hubIdentityUiHints');

function trimMiddle (s, left = 14, right = 10) {
  const t = String(s || '');
  if (t.length <= left + right + 1) return t;
  return `${t.slice(0, left)}…${t.slice(-right)}`;
}

function SettingsBitcoinWallet ({ identity }) {
  const xpub = identity && identity.xpub ? String(identity.xpub) : '';
  const acct = BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX;
  const spend = React.useMemo(() => getSpendWalletContext(identity || {}), [identity]);

  return (
    <Segment style={{ maxWidth: 720, margin: '1em auto' }}>
      <section aria-labelledby="settings-btc-wallet-h2">
        <Header as="h2" id="settings-btc-wallet-h2" style={{ marginBottom: '0.35em' }}>
          <Icon name="bitcoin" aria-hidden="true" />
          <Header.Content>Bitcoin wallet &amp; derivation</Header.Content>
        </Header>
        <p style={{ color: '#666', margin: '0 0 1em', maxWidth: '40rem', lineHeight: 1.45 }}>
          Your <strong>Fabric identity</strong> is the master key. All Hub and browser Bitcoin payment flows use a single BIP44 Bitcoin account under that
          master: <code style={{ whiteSpace: 'nowrap' }}>{`m/44'/0'/${acct}'`}</code> (account {acct}). External addresses use chain <code>0/*</code>; change uses <code>1/*</code>.
          There is no separate “second wallet”—only this account for on-chain balance, invoices, and client-signed sends.
        </p>
        <Message info size="small" style={{ marginBottom: '1em' }}>
          <Message.Header>Identity wallet vs Hub node wallet</Message.Header>
          <p style={{ margin: '0.35em 0 0', fontSize: '0.88em', lineHeight: 1.45 }}>
            <strong>This page (identity):</strong> your client keys — receive, spend, and balance shown in the top bar when unlocked.
            <strong> Hub / Bridge:</strong> the node&apos;s <code>bitcoind</code> (regtest rewards, optional admin sends, Payjoin receiver) — different keys.
            On <strong>mainnet</strong>, treat Hub RPC as privileged; never send user funds to the Hub wallet address by mistake.
          </p>
        </Message>
        <Message size="small" style={{ marginBottom: '1em' }}>
          <p style={{ margin: 0, fontSize: '0.88em', lineHeight: 1.45, color: '#555' }}>
            <strong>Backup &amp; recovery:</strong> keep your mnemonic safe (identity manager in the top bar).{' '}
            <Link to="/settings/security">Security &amp; delegation</Link> covers signing sessions and delegation tokens.
          </p>
        </Message>
      </section>

      {xpub ? (
        <Message size="small" info style={{ marginBottom: '1em' }}>
          <p style={{ margin: 0, fontSize: '0.9em', wordBreak: 'break-all' }}>
            <strong>Master xpub:</strong> <code>{xpub}</code>
          </p>
          {spend && spend.walletId && spend.xpub ? (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', color: '#333' }}>
              <strong>Payment account wallet id</strong> (same formula as Hub <code>walletName</code> / balance APIs for this account):{' '}
              <code style={{ wordBreak: 'break-all' }}>{spend.walletId}</code>
            </p>
          ) : null}
          {spend && spend.xpub ? (
            <p style={{ margin: '0.5em 0 0', fontSize: '0.85em', color: '#555' }}>
              <strong>Payment account xpub</strong> (BIP44 account {acct}):{' '}
              <code title={spend.xpub}>{trimMiddle(spend.xpub, 18, 18)}</code>
            </p>
          ) : identity && identity.passwordProtected && !identity.xprv ? (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', color: '#8a6d3b' }}>
              Unlock your identity to derive payment account keys. While locked, the Hub may still show a prior wallet id if you used this browser before.
            </p>
          ) : null}
        </Message>
      ) : (
        <Message warning size="small" style={{ marginBottom: '1em' }}>
          {(() => {
            const m = classifyHubBrowserIdentity(identity || {});
            if (m === 'watch_only') {
              return (
                <>
                  Import a full key from the top-bar identity menu or <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong> to show the master xpub and payment account ids (watch-only does not derive spend keys here).
                </>
              );
            }
            if (m === 'password_locked') {
              return (
                <>
                  Unlock from the header (<strong>Locked</strong> → encryption password), or <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong>, to show the master xpub and payment account ids.
                </>
              );
            }
            return (
              <>
                Create or restore a Fabric identity: <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong> or <strong>Log in</strong> in the top bar, to show the master xpub and payment account ids.
              </>
            );
          })()}
        </Message>
      )}

      <Message size="small" style={{ marginBottom: '1em' }}>
        <p style={{ margin: 0, fontSize: '0.88em', lineHeight: 1.45, color: '#555' }}>
          <strong>Documents &amp; L1:</strong> publishing is free; <strong>distribute</strong> and paid retrieval use invoices you pay from{' '}
          <Link to="/services/bitcoin">Bitcoin</Link> or <Link to="/payments">Payments</Link>. Verify on-chain activity under{' '}
          <Link to="/services/bitcoin/resources">Resources</Link> or the explorer on the Bitcoin page.
        </p>
      </Message>

      <p style={{ marginTop: '1.25em', fontSize: '0.88em', color: '#666' }}>
        <Link to="/settings">← All settings</Link>
        {' · '}
        <Link to="/settings">Fabric identity</Link>
        {' · '}
        <Link to="/documents">Documents</Link>
        {' · '}
        <Link to="/services/bitcoin/invoices">Invoices</Link>
        {' · '}
        <Link to="/payments">Payments</Link>
      </p>
    </Segment>
  );
}

module.exports = SettingsBitcoinWallet;
