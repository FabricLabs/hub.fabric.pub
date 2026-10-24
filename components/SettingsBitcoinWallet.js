'use strict';

/**
 * Settings: explain Bitcoin derivation under the Fabric identity master.
 */

const React = require('react');
const { Link } = require('react-router-dom');
const { Header, Icon, Message, Segment } = require('semantic-ui-react');
const {
  getBitcoinBip44AccountForIdentity,
  getSpendWalletContext
} = require('../functions/bitcoinClient');
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
  const masterXpub = identity && (identity.masterXpub || identity.xpub)
    ? String(identity.masterXpub || identity.xpub)
    : '';
  const acct = getBitcoinBip44AccountForIdentity(identity || {});
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
          {' '}{c.pathLead} <code style={{ whiteSpace: 'nowrap' }}>{`m/44'/0'/${acct}'`}</code> {c.pathTail(acct)}
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

      {masterXpub ? (
        <Message size="small" info style={{ marginBottom: '1em' }}>
          <p style={{ margin: 0, fontSize: '0.9em', wordBreak: 'break-all' }}>
            <strong>{c.masterXpub}</strong> <code>{masterXpub}</code>
          </p>
          {spend && spend.walletId && spend.xpub ? (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', color: '#333' }}>
              <strong>{c.walletIdLead}</strong> {c.walletIdNote}{' '}
              <code style={{ wordBreak: 'break-all' }}>{spend.walletId}</code>
            </p>
          ) : null}
          {spend && spend.xpub ? (
            <p style={{ margin: '0.5em 0 0', fontSize: '0.85em', color: '#555' }}>
              <strong>{c.accountXpub(acct)}</strong>{' '}
              <code title={spend.xpub}>{trimMiddle(spend.xpub, 18, 18)}</code>
            </p>
          ) : identityKind === 'password_locked' || identityKind === 'watch_only' ? (
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
