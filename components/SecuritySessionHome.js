'use strict';

/**
 * Per–delegation-token workspace: audit log, pending queue, Hub public key for verification.
 * Token is the URL param (encodeURIComponent). Bearer on GET must match.
 */

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const {
  Button,
  Header,
  Icon,
  Message,
  Segment,
  Table,
  Loader
} = require('semantic-ui-react');

const {
  DELEGATION_STORAGE_KEY,
  DELEGATION_CHANGED_EVENT
} = require('../functions/fabricDelegationLocal');

function SecuritySessionHome () {
  const { sessionId: encodedId } = useParams();
  const sessionId = encodedId ? decodeURIComponent(encodedId) : '';
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(true);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const refresh = React.useCallback(async () => {
    if (!sessionId) {
      setError('Missing session id');
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${origin}/sessions/${encodeURIComponent(sessionId)}/delegation/audit`, {
        headers: { Authorization: `Bearer ${sessionId}`, Accept: 'application/json' },
        cache: 'no-store'
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setData(null);
        setError((j && j.error) || `HTTP ${r.status}`);
        return;
      }
      if (!j || j.ok !== true) {
        setData(null);
        setError((j && j.error) || 'Audit response was not successful');
        return;
      }
      setData(j);
    } catch (e) {
      setData(null);
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [origin, sessionId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !sessionId) return undefined;
    const bump = () => void refresh();
    window.addEventListener(DELEGATION_CHANGED_EVENT, bump);
    const onStorage = (ev) => {
      if (ev && ev.key === DELEGATION_STORAGE_KEY) bump();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DELEGATION_CHANGED_EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, [sessionId, refresh]);

  const session = data && data.session;
  const pending = (data && Array.isArray(data.pending)) ? data.pending : [];
  const fabricLog = (data && Array.isArray(data.fabricLog)) ? data.fabricLog : [];
  const hubPk = data && data.hubPubkeyHex ? String(data.hubPubkeyHex) : null;

  return (
    <Segment style={{ maxWidth: 960, margin: '1em auto' }}>
      <Button
        as={Link}
        to="/settings/security"
        basic
        size="small"
        style={{ marginBottom: '1em' }}
        aria-label="Back to security and delegation"
      >
        <Icon name="arrow left" aria-hidden="true" />
        Security &amp; delegation
      </Button>

      <section aria-labelledby="delegation-session-heading" aria-describedby="delegation-session-summary">
        <Header as="h2" id="delegation-session-heading">
          <Icon name="key" aria-hidden="true" />
          Delegation session
        </Header>
        <p id="delegation-session-summary" style={{ color: '#666' }}>
          Tools and audit for one browser delegation token. Use <strong>Identity → Verify signature</strong> with the Hub public key below when checking Schnorr signatures.
        </p>
        <div style={{ marginTop: '0.65em' }}>
          <Button
            size="small"
            basic
            type="button"
            disabled={busy || !sessionId}
            onClick={() => void refresh()}
            aria-label="Refresh delegation audit from hub"
          >
            <Icon name="refresh" aria-hidden="true" />
            Refresh audit
          </Button>
        </div>
      </section>

      {error && !busy && (
        <Message negative onDismiss={() => setError(null)}>
          <Message.Header>Could not load delegation session</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>{error}</p>
          {sessionId ? (
            <p style={{ margin: '0.5em 0 0', fontSize: '0.9em', color: '#555' }}>
              Token:{' '}
              <code style={{ wordBreak: 'break-all' }}>
                {sessionId.length > 56
                  ? `${sessionId.slice(0, 28)}…${sessionId.slice(-16)}`
                  : sessionId}
              </code>
            </p>
          ) : null}
          <div style={{ marginTop: '0.85em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button
              size="small"
              type="button"
              disabled={!sessionId}
              onClick={() => void refresh()}
            >
              <Icon name="refresh" />
              Retry
            </Button>
            <Button as={Link} to="/settings/security" size="small" basic>
              <Icon name="shield alternate" aria-hidden="true" />
              Security &amp; delegation
            </Button>
          </div>
        </Message>
      )}

      {busy && !data && (
        <Loader active inline="centered">
          Loading session…
        </Loader>
      )}

      {!busy && data && data.ok && (
        <>
          <Segment>
            <section aria-labelledby="delegation-session-detail-h3">
            <Header as="h3" id="delegation-session-detail-h3">Session</Header>
            <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75em', maxWidth: '42rem', lineHeight: 1.45 }}>
              The full delegation token is the value in this page&apos;s URL path (and in Security &amp; delegation). The hub only returns a short token preview in JSON for display.
            </p>
            {session && (
              <Table basic="very" compact>
                <Table.Body>
                  {session.id ? (
                    <Table.Row>
                      <Table.Cell><strong>Token preview</strong></Table.Cell>
                      <Table.Cell><code style={{ wordBreak: 'break-all' }}>{session.id}</code></Table.Cell>
                    </Table.Row>
                  ) : null}
                  <Table.Row>
                    <Table.Cell><strong>Origin</strong></Table.Cell>
                    <Table.Cell>{session.origin || '—'}</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell><strong>Linked</strong></Table.Cell>
                    <Table.Cell>{session.linkedAt ? new Date(session.linkedAt).toLocaleString() : '—'}</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell><strong>Label</strong></Table.Cell>
                    <Table.Cell>{session.label || 'browser'}</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell><strong>Identity id</strong></Table.Cell>
                    <Table.Cell><code style={{ wordBreak: 'break-all' }}>{session.identityId || '—'}</code></Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
            )}
            </section>
          </Segment>

          <Segment>
            <section aria-labelledby="delegation-hub-pk-h3" aria-describedby="delegation-hub-pk-desc">
            <Header as="h3" id="delegation-hub-pk-h3">Hub verification key</Header>
            <p id="delegation-hub-pk-desc" style={{ color: '#666', fontSize: '0.95em' }}>
              Compressed secp256k1 public key (hex) for the Hub node identity used when this session signs.
            </p>
            {hubPk ? (
              <pre
                style={{
                  fontSize: '0.82em',
                  padding: '0.75em',
                  background: '#f7f7f7',
                  borderRadius: 4,
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {hubPk}
              </pre>
            ) : (
              <Message warning>Hub public key not available.</Message>
            )}
            </section>
          </Segment>

          <Segment>
            <section aria-labelledby="delegation-pending-h3">
            <Header as="h3" id="delegation-pending-h3">Pending signature requests</Header>
            {pending.length === 0 ? (
              <p style={{ color: '#666' }}>None.</p>
            ) : (
              <Table celled compact unstackable>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Message id</Table.HeaderCell>
                    <Table.HeaderCell>Preview</Table.HeaderCell>
                    <Table.HeaderCell>Purpose</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {pending.map((p) => (
                    <Table.Row key={p.messageId}>
                      <Table.Cell><code style={{ fontSize: '0.8em' }}>{p.messageId}</code></Table.Cell>
                      <Table.Cell style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{p.preview || '—'}</Table.Cell>
                      <Table.Cell>{p.purpose || '—'}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
            </section>
          </Segment>

          <Segment>
            <section aria-labelledby="delegation-fabric-log-h3" aria-describedby="delegation-fabric-log-desc">
            <Header as="h3" id="delegation-fabric-log-h3">Fabric message log (delegation)</Header>
            <p id="delegation-fabric-log-desc" style={{ color: '#666', fontSize: '0.92em' }}>
              Request and resolution rows from the Hub Fabric message log for this token (newest may appear last).
            </p>
            {fabricLog.length === 0 ? (
              <p style={{ color: '#666' }}>No entries yet.</p>
            ) : (
              <Table celled compact unstackable>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Seq</Table.HeaderCell>
                    <Table.HeaderCell>Type</Table.HeaderCell>
                    <Table.HeaderCell>Summary</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {fabricLog.map((row) => (
                    <Table.Row key={row.id}>
                      <Table.Cell>{row.seq != null ? row.seq : '—'}</Table.Cell>
                      <Table.Cell>{row.type}</Table.Cell>
                      <Table.Cell>
                        <code style={{ fontSize: '0.8em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {JSON.stringify(row.summary || {}, null, 0)}
                        </code>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            )}
            </section>
          </Segment>
        </>
      )}
    </Segment>
  );
}

module.exports = SecuritySessionHome;
