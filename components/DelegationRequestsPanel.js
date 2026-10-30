'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, List, Message, Segment } = require('semantic-ui-react');
const {
  listDelegationRequests,
  answerDelegationRequest
} = require('../functions/hubDelegationClient');
const t = require('../locales/en');

const c = t.delegation.requests;

/** @private */
function shortKey (pk) {
  const s = String(pk || '');
  return s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}

/**
 * Requests from linked signers that no signing rule covered: Sign or Decline.
 * @param {{ adminToken?: string, compact?: boolean, onCount?: Function }} props
 */
function DelegationRequestsPanel (props) {
  const adminToken = props && props.adminToken ? String(props.adminToken).trim() : '';
  const onCount = props && props.onCount;
  const [requests, setRequests] = React.useState(null);
  const [busy, setBusy] = React.useState('');
  const [note, setNote] = React.useState(null);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    if (!adminToken) return;
    try {
      const list = await listDelegationRequests(adminToken);
      setRequests(list);
      setError(null);
      if (typeof onCount === 'function') onCount(list.length);
    } catch (e) {
      if (e.status === 404) setRequests([]);
      else setError(e.message);
    }
  }, [adminToken, onCount]);

  React.useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  if (!adminToken) return null;
  const list = requests || [];
  if (props.compact && !list.length && !note && !error) return null;

  const answer = async (hash, action) => {
    setBusy(`${action}:${hash}`);
    setNote(null);
    setError(null);
    try {
      await answerDelegationRequest(adminToken, hash, action);
      setNote(action === 'sign' ? c.signed : c.declined);
      await load();
    } catch (e) {
      setError(t.common.errors.withReason(c.failed, e.message));
    } finally {
      setBusy('');
    }
  };

  return (
    <Segment data-testid="delegation-requests">
      <Header as="h3">
        <Icon name="pencil alternate" aria-hidden="true" />
        <Header.Content>{c.title}</Header.Content>
      </Header>
      <p style={{ color: '#666' }}>
        {c.intro}{' '}
        <Link to="/settings/signing">{t.delegation.rules.title}</Link>
      </p>
      {note ? <Message positive size="small" onDismiss={() => setNote(null)}>{note}</Message> : null}
      {error ? <Message negative size="small" onDismiss={() => setError(null)}>{error}</Message> : null}
      {list.length === 0 ? (
        <p style={{ color: '#888' }}>{c.empty}</p>
      ) : (
        <List divided relaxed>
          {list.map((r) => (
            <List.Item key={r.hash} data-testid="delegation-request">
              <List.Content floated="right">
                <Button
                  primary
                  size="small"
                  loading={busy === `sign:${r.hash}`}
                  disabled={!!busy}
                  onClick={() => void answer(r.hash, 'sign')}
                >
                  {c.sign}
                </Button>
                <Button
                  basic
                  size="small"
                  loading={busy === `decline:${r.hash}`}
                  disabled={!!busy}
                  onClick={() => void answer(r.hash, 'decline')}
                >
                  {c.decline}
                </Button>
              </List.Content>
              <List.Header>{r.title}</List.Header>
              <List.Description>
                {r.summary ? <div>{r.summary}</div> : null}
                <div style={{ color: '#888', fontSize: '0.9em' }}>
                  {c.from((r.from && r.from.label) || shortKey(r.from && r.from.pubkey))}
                  {r.expiresAt ? ` · ${c.expires(new Date(r.expiresAt).toLocaleString())}` : ''}
                </div>
              </List.Description>
            </List.Item>
          ))}
        </List>
      )}
    </Segment>
  );
}

module.exports = DelegationRequestsPanel;
