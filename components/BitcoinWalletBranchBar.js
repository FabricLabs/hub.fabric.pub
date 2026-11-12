'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Icon, Message } = require('semantic-ui-react');
const { fabricIdentityNeedFullKeyPlain } = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const c = t.bitcoin.branchBar;

/**
 * The active Fabric account's wallet: new addresses from its SegWit account, its standard account watched.
 */
function BitcoinWalletBranchBar ({ identity }) {
  const wallet = identity && identity.wallet ? identity.wallet : null;
  const segwit = wallet && wallet.segwit ? wallet.segwit : null;
  const standard = wallet && wallet.standard ? wallet.standard : null;
  const acct = identity && identity.fabricAccountIndex != null ? Number(identity.fabricAccountIndex) : 0;
  const segwitXpub = segwit && segwit.xpub ? String(segwit.xpub) : '';

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
          {segwitXpub ? (
            <React.Fragment>
              <details className="hub-developer-details" style={{ margin: '0 0 0.35em', color: '#666', fontSize: '0.85em' }}>
                <summary>{t.common.developerDetails}</summary>
                <code>{c.path(segwit.path || '', (standard && standard.path) || '')}</code>
              </details>
              <p style={{ margin: 0, color: '#666', fontSize: '0.85em', wordBreak: 'break-all' }}>
                <strong>{c.segwitXpub}</strong>{' '}
                <code>
                  {segwitXpub.slice(0, 18)}…{segwitXpub.slice(-10)}
                </code>
              </p>
            </React.Fragment>
          ) : (
            <p style={{ margin: 0, color: '#888', fontSize: '0.88em' }}>
              {fabricIdentityNeedFullKeyPlain(identity || {})} {c.noKey}
            </p>
          )}
        </div>
      </div>
    </Message>
  );
}

module.exports = BitcoinWalletBranchBar;
