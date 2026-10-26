'use strict';

/**
 * Settings: the active Fabric account's wallet (SegWit + watched standard account).
 */

const React = require('react');
const { Link } = require('react-router-dom');
const { Header, Icon, Message, Segment } = require('semantic-ui-react');
const { getSpendWalletContext } = require('../functions/bitcoinClient');
const {
  classifyHubBrowserIdentity,
  fabricIdentityNeedFullKeyPlain
} = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const c = t.bitcoin.settingsWallet;

function trimMiddle (s, left = 14, right = 10) {
  const text = String(s || '');
  if (text.length <= left + right + 1) return text;
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}

function SettingsBitcoinWallet ({ identity }) {
  const wallet = identity && identity.wallet ? identity.wallet : null;
  const segwitPath = wallet && wallet.segwit && wallet.segwit.path ? String(wallet.segwit.path) : '';
  const standardPath = wallet && wallet.standard && wallet.standard.path ? String(wallet.standard.path) : '';
  const acct = identity && identity.fabricAccountIndex != null ? Number(identity.fabricAccountIndex) : 0;
  const spend = React.useMemo(() => getSpendWalletContext(identity || {}), [identity]);
  const identityKind = classifyHubBrowserIdentity(identity || {});

  return (
    <Segment style={{ maxWidth: 720, margin: '1em auto' }}>
      <section aria-labelledby="settings-btc-wallet-h2">
        <Header as="h2" id="settings-btc-wallet-h2" style={{ marginBottom: '0.35em' }}>
          <Icon name="bitcoin" aria-hidden="true" />
          <Header.Content>{c.title}</Header.Content>
        </Header>
        <p style={{ color: '#666', margin: '0 0 1em', maxWidth: '40rem', lineHeight: 1.45 }}>
          {c.intro}
          {segwitPath ? (
            <React.Fragment>
              {' '}{c.pathLead} <code style={{ whiteSpace: 'nowrap' }}>{segwitPath}</code> {c.pathTail(acct)}
            </React.Fragment>
          ) : null}
          {standardPath ? (
            <React.Fragment>
              {' '}{c.standardLead} <code style={{ whiteSpace: 'nowrap' }}>{standardPath}</code> {c.standardTail}
            </React.Fragment>
          ) : null}
        </p>
        <Message info size="small" style={{ marginBottom: '1em' }}>
          <Message.Header>{c.walletsTitle}</Message.Header>
          <p style={{ margin: '0.35em 0 0', fontSize: '0.88em', lineHeight: 1.45 }}>
            {c.walletsYours} {c.walletsHub} {c.walletsMainnet}
          </p>
        </Message>
        <Message size="small" style={{ marginBottom: '1em' }}>
          <p style={{ margin: 0, fontSize: '0.88em', lineHeight: 1.45, color: '#555' }}>
            <strong>{c.backupLead}</strong> {c.backup}{' '}
            <Link to="/settings/security">{c.securityLink}</Link> {c.securityAfter}
          </p>
        </Message>
      </section>

      {spend && spend.xpub ? (
        <Message size="small" info style={{ marginBottom: '1em' }}>
          {spend.walletId ? (
            <p style={{ margin: 0, fontSize: '0.88em', color: '#333' }}>
              <strong>{c.walletIdLead}</strong> {c.walletIdNote}{' '}
              <code style={{ wordBreak: 'break-all' }}>{spend.walletId}</code>
            </p>
          ) : null}
          <p style={{ margin: '0.5em 0 0', fontSize: '0.85em', color: '#555' }}>
            <strong>{c.segwitXpub(acct)}</strong>{' '}
            <code title={spend.xpub}>{trimMiddle(spend.xpub, 18, 18)}</code>
          </p>
          {spend.standardXpub ? (
            <p style={{ margin: '0.35em 0 0', fontSize: '0.85em', color: '#555' }}>
              <strong>{c.standardXpub(acct)}</strong>{' '}
              <code title={spend.standardXpub}>{trimMiddle(spend.standardXpub, 18, 18)}</code>
            </p>
          ) : null}
          {!spend.hasPrivateKey && (identityKind === 'password_locked' || identityKind === 'watch_only') ? (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', color: '#8a6d3b' }}>
              {identityKind === 'password_locked' ? c.lockedNote : c.watchOnlyNote}
            </p>
          ) : null}
        </Message>
      ) : (
        <Message warning size="small" style={{ marginBottom: '1em' }}>
          {fabricIdentityNeedFullKeyPlain(identity || {})} {c.noXpubSuffix}
        </Message>
      )}

      <Message size="small" style={{ marginBottom: '1em' }}>
        <p style={{ margin: 0, fontSize: '0.88em', lineHeight: 1.45, color: '#555' }}>
          <strong>{c.documentsLead}</strong> {c.documentsBefore}{' '}
          <Link to="/services/bitcoin">{c.bitcoinLink}</Link> {c.documentsMiddle}{' '}
          <Link to="/services/bitcoin/resources">{c.resourcesLink}</Link> {c.documentsAfter}
        </p>
      </Message>

      <nav aria-label={c.relatedLabel} style={{ marginTop: '1.25em', fontSize: '0.88em', color: '#666' }}>
        <Link to="/settings">{c.allSettings}</Link>
        {' · '}
        <Link to="/documents">{c.documents}</Link>
        {' · '}
        <Link to="/services/bitcoin/invoices">{c.invoices}</Link>
        {' · '}
        <Link to="/payments">{c.payments}</Link>
      </nav>
    </Segment>
  );
}

module.exports = SettingsBitcoinWallet;
