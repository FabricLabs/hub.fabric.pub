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
        setError((j && j.error) || 'Could not load delegation session');
        return;
      }
      setMe(j.session || null);
    } catch (e) {
      setMe(null);
      setError((e && e.message) ? e.message : String(e));
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
        if (r.status !== 403) setError((j && j.error) || 'Could not list sessions');
        return;
      }
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
    } catch (e) {
      setSessions([]);
      setError(`Could not list delegation sessions: ${(e && e.message) ? e.message : String(e)}`);
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

  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
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
        setError((j && j.error) || 'Could not end delegation');
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
      setError((e && e.message) ? e.message : String(e));
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
        setError((j && j.error) || 'Could not destroy session');
        return;
      }
      await refreshSessions();
      if (token === tokenId) {
        try {
          removeStorageKey(DELEGATION_STORAGE_KEY);
        } catch (e) {}
        notifyDelegationStorageChanged();
        setDelegation(null);
        setMe(null);
      }
    } catch (e) {
      setError((e && e.message) ? e.message : String(e));
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
          <Header.Content>Security &amp; delegation</Header.Content>
        </Header>
        <p id="security-page-summary" style={{ color: '#666' }}>
          When you use <strong>Log in with Fabric Hub (desktop)</strong>, private keys stay with the Hub node; the browser uses <strong>external signing</strong>. Confirm each signature in this app (web or desktop shell) via the delegation modal.
        </p>
        <p style={{ color: '#666', marginTop: '0.65em' }}>
          Related:{' '}
          {uf.bitcoinPayments ? (
            <><Link to="/payments">Bitcoin Payments</Link> (receive vs Hub-wallet send vs Payjoin),{' '}</>
          ) : (
            <>Bitcoin Payments (enable <strong>Bitcoin — Payments</strong> in Admin → Feature visibility for a nav link),{' '}</>
          )}
          <Link to="/documents">Documents</Link> (pay-to-distribute and hosting proposals show extra tips when you have no local wire-signing key).
        </p>
      </section>

      {error && (
        <Message negative onDismiss={() => setError(null)}>
          {error}
        </Message>
      )}

      <Segment>
        <section aria-labelledby="security-external-signing-h3">
        <Header as="h3" id="security-external-signing-h3">External signing</Header>
        {external ? (
          <Message info>
            <Icon name="linkify" aria-hidden="true" />
            External signing is <Label color="teal" size="small" aria-hidden="true">enabled</Label> for this browser. Approve or reject each request in the in-app delegation modal.
          </Message>
        ) : (
          <Message>
            External signing is not active. Use <strong>Identity → Log in with Fabric Hub (desktop)</strong> to delegate signing to the desktop app.
          </Message>
        )}
        {token && (
          <List bulleted>
            <List.Item>Delegation token: <code style={{ wordBreak: 'break-all' }}>{token.slice(0, 16)}…</code></List.Item>
            <List.Item>
              <Link to={`/sessions/${encodeURIComponent(token)}`}>Open session tools &amp; audit</Link>
            </List.Item>
            {me && me.linkedAt && (
              <List.Item>Linked: {new Date(me.linkedAt).toLocaleString()}</List.Item>
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
            End delegation (this browser)
          </Button>
        )}
        </section>
      </Segment>

      <Segment>
        <section aria-labelledby="security-active-sessions-h3" aria-describedby="security-active-sessions-desc">
        <Header as="h3" id="security-active-sessions-h3">Active delegation sessions (this Hub)</Header>
        <p id="security-active-sessions-desc" style={{ color: '#666', fontSize: '0.95em' }}>
          Loopback clients (including this page when served from localhost) can list all open delegation tokens. Use <strong>Destroy session</strong> to revoke a token; the browser must log in again.
        </p>
        <Button
          size="small"
          basic
          type="button"
          onClick={() => void refreshSessions()}
          disabled={busy}
          aria-label="Refresh delegation sessions list"
        >
          <Icon name="refresh" aria-hidden="true" />
          Refresh list
        </Button>
        <Table celled compact unstackable style={{ marginTop: '1em' }}>
            <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Token</Table.HeaderCell>
              <Table.HeaderCell>Origin</Table.HeaderCell>
              <Table.HeaderCell>Linked</Table.HeaderCell>
              <Table.HeaderCell>Session</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sessions.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan="5">No active delegation sessions.</Table.Cell>
              </Table.Row>
            ) : (
              sessions.map((s) => (
                <Table.Row key={s.tokenId}>
                  <Table.Cell><code style={{ fontSize: '0.85em' }}>{s.token}</code></Table.Cell>
                  <Table.Cell>{s.origin || '—'}</Table.Cell>
                  <Table.Cell>{s.linkedAt ? new Date(s.linkedAt).toLocaleString() : '—'}</Table.Cell>
                  <Table.Cell collapsing>
                    <Button
                      as={Link}
                      to={`/sessions/${encodeURIComponent(s.tokenId)}`}
                      size="mini"
                      basic
                    >
                      Open
                    </Button>
                  </Table.Cell>
                  <Table.Cell collapsing>
                    <Button
                      negative
                      size="mini"
                      disabled={busy}
                      onClick={() => void destroyByTokenId(s.tokenId)}
                    >
                      Destroy session
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
