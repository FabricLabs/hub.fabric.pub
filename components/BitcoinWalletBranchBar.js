'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Icon, Message } = require('semantic-ui-react');
const { getBitcoinBip44AccountForIdentity } = require('../functions/bitcoinClient');
const { fabricIdentityNeedFullKeyPlain } = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const c = t.bitcoin.branchBar;

/**
 * Fabric identity is the master; Bitcoin receive/change follow the active BIP44 account (matches Fabric account index when enabled).
 */
function BitcoinWalletBranchBar ({ identity }) {
  const masterXpub = identity && (identity.masterXpub || identity.xpub)
    ? String(identity.masterXpub || identity.xpub)
    : '';
  const accountXpub = identity && identity.masterXpub && identity.xpub && identity.xpub !== identity.masterXpub
    ? String(identity.xpub)
    : '';
  const acct = getBitcoinBip44AccountForIdentity(identity || {});

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
            <Icon name="key" aria-hidden="true" /> {c.title}
          </div>
          <p style={{ margin: '0 0 0.35em', color: '#555', fontSize: '0.9em', lineHeight: 1.45 }}>
            {c.body(acct)}{' '}
            <Link to="/settings/bitcoin-wallet">{c.settingsLink}</Link>.
          </p>
          <details className="hub-developer-details" style={{ margin: '0 0 0.35em', color: '#666', fontSize: '0.85em' }}>
            <summary>{t.common.developerDetails}</summary>
            <code>{c.path(acct)}</code>
          </details>
          {masterXpub ? (
            <p style={{ margin: 0, color: '#666', fontSize: '0.85em', wordBreak: 'break-all' }}>
              <strong>{c.masterXpub}</strong>{' '}
              <code>
                {masterXpub.slice(0, 18)}…{masterXpub.slice(-10)}
              </code>
            </p>
          ) : (
            <p style={{ margin: 0, color: '#888', fontSize: '0.88em' }}>
              {fabricIdentityNeedFullKeyPlain(identity || {})} {c.noKey}
            </p>
          )}
          {accountXpub ? (
            <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.85em', wordBreak: 'break-all' }}>
              <strong>{c.accountXpub}</strong>{' '}
              <code>
                {accountXpub.slice(0, 18)}…{accountXpub.slice(-10)}
              </code>
            </p>
          ) : null}
        </div>
      </div>
    </Message>
  );
}

module.exports = BitcoinWalletBranchBar;
