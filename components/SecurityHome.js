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
  readLinkedDevices,
  peerIdOf,
  revokeLinkedDevice
} = require('../functions/fabricLinkedDevices');
const { identitySigner } = require('../functions/hubAccountVault');
const t = require('../locales/en');

const copy = t.identity.security;

/**
 * Security: the Passport session this browser holds and the devices that share its identity.
 * @param {{ identity?: object }} props The Hub's in-memory identity (revoking needs it unlocked).
 */
function SecurityHome (props = {}) {
  const identity = props.identity || null;
  const [session, setSession] = React.useState(() => getPassportSession());
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [linkedDevices, setLinkedDevices] = React.useState(() => readLinkedDevices());
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

  const refreshLinkedDevices = React.useCallback(() => {
    setLinkedDevices(readLinkedDevices());
  }, []);

  const handleRevokeDevice = React.useCallback(async (device) => {
    beginBusy();
    setError(null);
    try {
      const r = await revokeLinkedDevice(device, identitySigner(identity));
      if (!r.ok) {
        setError(r.error || copy.devices.revokeFailed);
        return;
      }
      refreshLinkedDevices();
    } catch (e) {
      setError(t.common.errors.withReason(copy.devices.revokeFailed, (e && e.message) ? e.message : String(e)));
    } finally {
      endBusy();
    }
  }, [beginBusy, endBusy, refreshLinkedDevices, identity]);

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
        <section aria-labelledby="security-linked-devices-h3">
        <Header as="h3" id="security-linked-devices-h3">{copy.devices.title}</Header>
        <p style={{ color: '#666', fontSize: '0.95em' }}>
          {copy.devices.intro}
        </p>
        {linkedDevices.length > 0 ? (
          <p style={{ color: '#666', fontSize: '0.95em' }}>{copy.devices.signHint}</p>
        ) : null}
        <details className="hub-developer-details">
          <summary>{t.common.developerDetails}</summary>
          <p style={{ color: '#666', margin: '0.35em 0 0' }}>{copy.devices.developer}</p>
        </details>
        {linkedDevices.length === 0 ? (
          <Message>
            {copy.devices.empty}
          </Message>
        ) : (
          <List divided relaxed>
            {linkedDevices.map((d, i) => {
              const pid = peerIdOf(d);
              return (
                <List.Item key={pid || i}>
                  <List.Content floated="right">
                    <Button
                      negative
                      size="mini"
                      disabled={busy}
                      onClick={() => void handleRevokeDevice(d)}
                    >
                      {copy.devices.revoke}
                    </Button>
                  </List.Content>
                  <List.Header>{d.label || d.kind || copy.devices.fallbackName}</List.Header>
                  <List.Description>
                    {pid ? <code style={{ fontSize: '0.85em' }}>{pid}</code> : t.common.none}
                    {d.hubOrigin ? ` · ${d.hubOrigin}` : ''}
                    {d.linkedAt ? ` · ${new Date(d.linkedAt).toLocaleString()}` : ''}
                  </List.Description>
                </List.Item>
              );
            })}
          </List>
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
