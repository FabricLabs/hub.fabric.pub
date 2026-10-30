'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Header,
  Icon,
  Label,
  List,
  Message,
  Segment
} = require('semantic-ui-react');

const {
  PASSPORT_SESSION_EVENT,
  getPassportSession,
  refreshPassportSession,
  endPassportSession
} = require('../functions/passportSession');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const {
  getLinkedSigners,
  revokeSignerGrant
} = require('../functions/hubDelegationClient');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const copy = t.identity.security;

/** @private */
function shortKey (pk) {
  const s = String(pk || '');
  return s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}

/**
 * Security: the Passport session this browser holds, and (for the operator)
 * the apps linked to sign with this Hub.
 * @param {{ adminToken?: string }} props
 */
function SecurityHome (props = {}) {
  const adminToken = readHubAdminTokenFromBrowser(props.adminToken);
  const [session, setSession] = React.useState(() => getPassportSession());
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [signers, setSigners] = React.useState(null);
  const busyDepthRef = React.useRef(0);

  const beginBusy = React.useCallback(() => {
    busyDepthRef.current += 1;
    setBusy(true);
  }, []);
  const endBusy = React.useCallback(() => {
    busyDepthRef.current = Math.max(0, busyDepthRef.current - 1);
    if (busyDepthRef.current === 0) setBusy(false);
  }, []);

  React.useEffect(() => {
    void refreshPassportSession().then((view) => setSession(view));
    if (typeof window === 'undefined') return undefined;
    const sync = (ev) => setSession(ev && ev.detail !== undefined ? ev.detail : getPassportSession());
    window.addEventListener(PASSPORT_SESSION_EVENT, sync);
    return () => window.removeEventListener(PASSPORT_SESSION_EVENT, sync);
  }, []);

  const refreshSigners = React.useCallback(async () => {
    if (!adminToken) return;
    try {
      setSigners(await getLinkedSigners(adminToken));
    } catch (e) {
      if (e.status !== 404) setError(e.message);
    }
  }, [adminToken]);

  React.useEffect(() => { void refreshSigners(); }, [refreshSigners]);

  const handleRevoke = React.useCallback(async (grant) => {
    beginBusy();
    setError(null);
    try {
      await revokeSignerGrant(adminToken, grant.hash);
      await refreshSigners();
    } catch (e) {
      setError(t.common.errors.withReason(copy.signers.revokeFailed, (e && e.message) ? e.message : String(e)));
    } finally {
      endBusy();
    }
  }, [beginBusy, endBusy, refreshSigners, adminToken]);

  const renderGrants = (list, revocable) => (
    !list || list.length === 0 ? <p style={{ color: '#888' }}>{copy.signers.none}</p> : (
      <List divided relaxed>
        {list.map((g) => (
          <List.Item key={g.hash}>
            {revocable && !g.revoked ? (
              <List.Content floated="right">
                <Button negative size="mini" disabled={busy} onClick={() => void handleRevoke(g)}>
                  {copy.signers.revoke}
                </Button>
              </List.Content>
            ) : null}
            <List.Header>
              {g.label || shortKey(revocable ? g.grantee : g.grantor)}
              {g.revoked ? <Label size="tiny" style={{ marginLeft: '0.5em' }}>{copy.signers.revoked}</Label> : null}
            </List.Header>
            <List.Description>
              {(g.scopes || []).map((sc) => copy.signers.scopes[sc] || sc).join(', ')}
              {g.origins && g.origins.length ? ` · ${g.origins.join(', ')}` : ''}
              {g.issuedAt ? ` · ${new Date(g.issuedAt).toLocaleString()}` : ''}
            </List.Description>
          </List.Item>
        ))}
      </List>
    )
  );

  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((n) => n + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();

  const signOut = async () => {
    beginBusy();
    setError(null);
    try {
      await endPassportSession();
      setSession(null);
    } catch (e) {
      setError(t.common.errors.withReason(copy.session.endFailed, (e && e.message) ? e.message : String(e)));
    } finally {
      endBusy();
    }
  };

  return (
    <Segment style={{ maxWidth: 960, margin: '1em auto' }}>
      <section aria-labelledby="security-page-heading" aria-describedby="security-page-summary">
        <Header as="h2" id="security-page-heading">
          <Icon name="shield alternate" aria-hidden="true" />
          <Header.Content>{copy.title}</Header.Content>
        </Header>
        <p id="security-page-summary" style={{ color: '#666' }}>
          {copy.summary}
        </p>
        <p style={{ color: '#666', marginTop: '0.65em' }}>
          {copy.related}{' '}
          {uf.bitcoinPayments ? (
            <><Link to="/payments">{copy.payments}</Link> ({copy.paymentsNote}),{' '}</>
          ) : (
            <>{copy.paymentsHidden}.{' '}</>
          )}
          <Link to="/documents">{copy.documents}</Link> ({copy.documentsNote}).
        </p>
        <details className="hub-developer-details">
          <summary>{t.common.developerDetails}</summary>
          <p style={{ color: '#666', margin: '0.35em 0 0' }}>{copy.pathNote}</p>
        </details>
      </section>

      {error && (
        <Message negative onDismiss={() => setError(null)}>
          {error}
        </Message>
      )}

      <Segment>
        <section aria-labelledby="security-linked-signers-h3" data-testid="security-linked-signers">
        <Header as="h3" id="security-linked-signers-h3">{copy.signers.title}</Header>
        <p style={{ color: '#666', fontSize: '0.95em' }}>{copy.signers.intro}</p>
        {!adminToken ? (
          <Message>{copy.signers.adminOnly}</Message>
        ) : (
          <>
            <p style={{ color: '#666', fontSize: '0.95em' }}>
              {copy.signers.pairHint}{' '}
              <Link to="/settings/signing">{copy.signers.rulesLink}</Link>
              {' · '}
              <Link to="/notifications">{copy.signers.requestsLink}</Link>
            </p>
            <Header as="h4">{copy.signers.given}</Header>
            {renderGrants(signers && signers.given, true)}
            <Header as="h4">{copy.signers.received}</Header>
            {renderGrants(signers && signers.received, false)}
            {signers && signers.pubkey ? (
              <details className="hub-developer-details">
                <summary>{t.common.developerDetails}</summary>
                <p style={{ color: '#666', margin: '0.35em 0 0' }}>
                  {copy.signers.developer} <code style={{ wordBreak: 'break-all' }}>{signers.pubkey}</code>
                </p>
              </details>
            ) : null}
          </>
        )}
        </section>
      </Segment>

      <Segment>
        <section aria-labelledby="security-session-h3">
        <Header as="h3" id="security-session-h3">{copy.session.title}</Header>
        {session ? (
          <>
            <Message info>
              <Icon name="id badge" aria-hidden="true" />
              <Label color="teal" size="small" aria-hidden="true">{t.common.states.on}</Label>{' '}
              {copy.session.on(copy.session.signers[session.signer] || session.signer)}
            </Message>
            <List bulleted>
              <List.Item>{copy.session.identity} <code style={{ wordBreak: 'break-all' }}>{session.identity.id}</code></List.Item>
              <List.Item>{copy.session.network(session.network)}</List.Item>
              <List.Item>{session.wallet ? copy.session.walletShared : copy.session.walletNotShared}</List.Item>
              {session.expiresAt ? (
                <List.Item>{copy.session.expires(new Date(session.expiresAt).toLocaleString())}</List.Item>
              ) : null}
            </List>
            <Button negative size="small" disabled={busy} onClick={() => void signOut()}>
              <Icon name="sign out" />
              {copy.session.end}
            </Button>
          </>
        ) : (
          <Message>{copy.session.off}</Message>
        )}
        </section>
      </Segment>
    </Segment>
  );
}

module.exports = SecurityHome;
