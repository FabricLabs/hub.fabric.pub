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
  Segment,
  Table
} = require('semantic-ui-react');

const {
  DELEGATION_STORAGE_KEY,
  DELEGATION_CHANGED_EVENT,
  notifyDelegationStorageChanged
} = require('../functions/fabricDelegationLocal');
const {
  readStorageJSON,
  removeStorageKey
} = require('../functions/fabricBrowserState');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const {
  readLinkedDevices,
  peerIdOf,
  revokeLinkedDevice
} = require('../functions/fabricLinkedDevices');
const t = require('../locales/en');

const copy = t.identity.security;

function timingSafeStringEqual (a, b) {
  const s = String(a);
  const u = String(b);
  if (s.length !== u.length) return false;
  let diff = 0;
  for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ u.charCodeAt(i);
  return diff === 0;
}

function readDelegation () {
  try {
    if (typeof window === 'undefined') return null;
    return readStorageJSON(DELEGATION_STORAGE_KEY, null);
  } catch (e) {
    return null;
  }
}

/**
 * Security & delegation: external signing sessions, hub-side delegation tokens, pending sign flow.
 */
function SecurityHome () {
  const [delegation, setDelegation] = React.useState(() => readDelegation());
  const [me, setMe] = React.useState(null);
  const [sessions, setSessions] = React.useState([]);
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

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const token = delegation && delegation.token ? delegation.token : null;

  const refreshMe = React.useCallback(async () => {
    if (!token) {
      setMe(null);
      return;
    }
    beginBusy();
    setError(null);
    try {
      const r = await fetch(`${origin}/sessions/${encodeURIComponent(token)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store'
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMe(null);
        setError((j && j.error) || copy.external.loadFailed);
        return;
      }
      setMe(j.session || null);
    } catch (e) {
      setMe(null);
      setError(t.common.errors.withReason(copy.external.loadFailed, (e && e.message) ? e.message : String(e)));
    } finally {
      endBusy();
    }
  }, [origin, token, beginBusy, endBusy]);

  const refreshSessions = React.useCallback(async () => {
    beginBusy();
    setError(null);
    try {
      const r = await fetch(`${origin}/sessions`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSessions([]);
        if (r.status !== 403) setError((j && j.error) || copy.sessions.listFailed);
        return;
      }
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
    } catch (e) {
      setSessions([]);
      setError(t.common.errors.withReason(copy.sessions.listFailed, (e && e.message) ? e.message : String(e)));
    } finally {
      endBusy();
    }
  }, [origin, beginBusy, endBusy]);

  React.useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  React.useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => setDelegation(readDelegation());
    const onStorage = (ev) => {
      if (ev && ev.key === DELEGATION_STORAGE_KEY) sync();
    };
    window.addEventListener(DELEGATION_CHANGED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DELEGATION_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const refreshLinkedDevices = React.useCallback(() => {
    setLinkedDevices(readLinkedDevices());
  }, []);

  const handleRevokeDevice = React.useCallback(async (device) => {
    beginBusy();
    setError(null);
    try {
      const r = await revokeLinkedDevice(device);
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
  }, [beginBusy, endBusy, refreshLinkedDevices]);

  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((n) => n + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();

  const destroyMine = async () => {
    if (!token) return;
    beginBusy();
    setError(null);
    try {
      const r = await fetch(`${origin}/sessions/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store'
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError((j && j.error) || copy.external.endFailed);
        return;
      }
      try {
        removeStorageKey(DELEGATION_STORAGE_KEY);
      } catch (e) {}
      notifyDelegationStorageChanged();
      setDelegation(null);
      setMe(null);
      await refreshSessions();
    } catch (e) {
      setError(t.common.errors.withReason(copy.external.endFailed, (e && e.message) ? e.message : String(e)));
    } finally {
      endBusy();
    }
  };

  const destroyByTokenId = async (tokenId) => {
    if (!tokenId) return;
    beginBusy();
    setError(null);
    try {
      const r = await fetch(`${origin}/sessions/${encodeURIComponent(tokenId)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError((j && j.error) || copy.sessions.endFailed);
        return;
      }
      await refreshSessions();
      if (timingSafeStringEqual(token, tokenId)) {
        try {
          removeStorageKey(DELEGATION_STORAGE_KEY);
        } catch (e) {}
        notifyDelegationStorageChanged();
        setDelegation(null);
        setMe(null);
      }
    } catch (e) {
      setError(t.common.errors.withReason(copy.sessions.endFailed, (e && e.message) ? e.message : String(e)));
    } finally {
      endBusy();
    }
  };

  const external = !!token;

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
        <Message warning size="small" data-testid="security-session-token-warning">
          <Icon name="exclamation triangle" aria-hidden="true" />
          {copy.tokenWarning}
        </Message>
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
        <section aria-labelledby="security-external-signing-h3">
        <Header as="h3" id="security-external-signing-h3">{copy.external.title}</Header>
        {external ? (
          <Message info>
            <Icon name="linkify" aria-hidden="true" />
            <Label color="teal" size="small" aria-hidden="true">{t.common.states.on}</Label>{' '}
            {copy.external.on}
          </Message>
        ) : (
          <Message>
            {copy.external.off}
          </Message>
        )}
        {token && (
          <List bulleted>
            <List.Item>{copy.external.tokenLabel} <code style={{ wordBreak: 'break-all' }}>{token.slice(0, 16)}…</code></List.Item>
            <List.Item>
              <Link to={`/sessions/${encodeURIComponent(token)}`}>{copy.external.openSession}</Link>
            </List.Item>
            {me && me.linkedAt && (
              <List.Item>{copy.external.linked(new Date(me.linkedAt).toLocaleString())}</List.Item>
            )}
          </List>
        )}
        {external && token && (
          <Button
            negative
            size="small"
            disabled={busy}
            onClick={() => void destroyMine()}
          >
            <Icon name="unlink" />
            {copy.external.end}
          </Button>
        )}
        </section>
      </Segment>

      <Segment>
        <section aria-labelledby="security-active-sessions-h3" aria-describedby="security-active-sessions-desc">
        <Header as="h3" id="security-active-sessions-h3">{copy.sessions.title}</Header>
        <p id="security-active-sessions-desc" style={{ color: '#666', fontSize: '0.95em' }}>
          {copy.sessions.intro}
        </p>
        <Button
          size="small"
          basic
          type="button"
          onClick={() => void refreshSessions()}
          disabled={busy}
        >
          <Icon name="refresh" aria-hidden="true" />
          {copy.sessions.refresh}
        </Button>
        <Table celled compact unstackable style={{ marginTop: '1em' }}>
            <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{copy.sessions.token}</Table.HeaderCell>
              <Table.HeaderCell>{copy.sessions.origin}</Table.HeaderCell>
              <Table.HeaderCell>{copy.sessions.linked}</Table.HeaderCell>
              <Table.HeaderCell>{copy.sessions.session}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sessions.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan="5">{copy.sessions.empty}</Table.Cell>
              </Table.Row>
            ) : (
              sessions.map((s) => (
                <Table.Row key={s.tokenId}>
                  <Table.Cell><code style={{ fontSize: '0.85em' }}>{s.token}</code></Table.Cell>
                  <Table.Cell>{s.origin || t.common.none}</Table.Cell>
                  <Table.Cell>{s.linkedAt ? new Date(s.linkedAt).toLocaleString() : t.common.none}</Table.Cell>
                  <Table.Cell collapsing>
                    <Button
                      as={Link}
                      to={`/sessions/${encodeURIComponent(s.tokenId)}`}
                      size="mini"
                      basic
                    >
                      {t.common.actions.open}
                    </Button>
                  </Table.Cell>
                  <Table.Cell collapsing>
                    <Button
                      negative
                      size="mini"
                      disabled={busy}
                      onClick={() => void destroyByTokenId(s.tokenId)}
                    >
                      {copy.sessions.end}
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
        </section>
      </Segment>
    </Segment>
  );
}

module.exports = SecurityHome;
