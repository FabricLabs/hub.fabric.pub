'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Icon, Message } = require('semantic-ui-react');
const { BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX } = require('../functions/bitcoinClient');

/**
 * Fabric identity is the master; Bitcoin receive/change for payments use one fixed BIP44 account under it.
 */
function BitcoinWalletBranchBar ({ identity }) {
  const xpub = identity && identity.xpub ? String(identity.xpub) : '';
  const acct = BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX;

  return (
    <Message
      info
      size="small"
      style={{ marginBottom: '1em' }}
      id="fabric-bitcoin-wallet-context-bar"
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '0.75em' }}>
        <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#333', marginBottom: '0.25em' }}>
            <Icon name="key" aria-hidden="true" /> Fabric identity (master)
          </div>
          <p style={{ margin: '0 0 0.35em', color: '#555', fontSize: '0.9em', lineHeight: 1.45 }}>
            Your node identity is the root. On-chain receives, spends, and Hub wallet balance all use{' '}
            <strong>
              BIP44 account {acct}
            </strong>{' '}
            (<code style={{ whiteSpace: 'nowrap' }}>{`m/44'/0'/${acct}'`}</code>): external chain <code>0/*</code> for deposits, internal <code>1/*</code> for change.
            Issued receive addresses stay in local storage. Details:{' '}
            <Link to="/settings/bitcoin-wallet">Settings → Bitcoin wallet</Link>.
          </p>
          {xpub ? (
            <p style={{ margin: 0, color: '#666', fontSize: '0.85em', wordBreak: 'break-all' }}>
              <strong>Master xpub:</strong>{' '}
              <code>
                {xpub.slice(0, 18)}…{xpub.slice(-10)}
              </code>
            </p>
          ) : (
            <p style={{ margin: 0, color: '#888', fontSize: '0.88em' }}>
              Use the <strong>Identity</strong> control in the top bar (shows <strong>Locked</strong> when your signing key is not loaded), or{' '}
              <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong>, to unlock and derive receive addresses.
            </p>
          )}
        </div>
      </div>
    </Message>
  );
}

module.exports = BitcoinWalletBranchBar;
