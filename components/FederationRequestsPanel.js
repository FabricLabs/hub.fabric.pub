'use strict';

const React = require('react');
const { Button, Header, Icon, List, Message, Segment } = require('semantic-ui-react');
const { hubJsonRpc } = require('../functions/hubJsonRpc');
const t = require('../locales/en');

const c = t.federation.named;

/**
 * Admin RPC that throws on `{ status: 'error' }` results.
 * @param {string} method
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function federationRpc (method, params) {
  const r = await hubJsonRpc(method, [params]);
  if (!r || r.status === 'error') throw new Error((r && r.message) || method);
  return r;
}

function shortKey (pk) {
  const s = String(pk || '');
  return s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}

function memberLabel (view, pubkey) {
  const m = (view.members || []).find((x) => x.pubkey === pubkey);
  return (m && (m.alias || m.url)) || shortKey(pubkey);
}

/**
 * Federation invites and withdrawals waiting on this operator.
 * @param {{ adminToken?: string, onChange?: Function, refreshToken?: number, compact?: boolean }} props
 */
function FederationRequestsPanel (props) {
  const adminToken = props && props.adminToken ? String(props.adminToken).trim() : '';
  const [pending, setPending] = React.useState(null);
  const [busy, setBusy] = React.useState('');
  const [note, setNote] = React.useState(null);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async () => {
    if (!adminToken) return;
    try {
      const r = await federationRpc('ListNamedFederations', { adminToken });
      setPending(r.pending || { invites: [], withdrawals: [] });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [adminToken]);

  React.useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(id);
  }, [load, props && props.refreshToken]);

  if (!adminToken) return null;

  const act = async (key, method, params, done) => {
    setBusy(key);
    setNote(null);
    setError(null);
    try {
      await federationRpc(method, { adminToken, ...params });
      setNote(done);
      await load();
      if (props.onChange) props.onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const invites = (pending && pending.invites) || [];
  const withdrawals = (pending && pending.withdrawals) || [];
  if (props.compact && !invites.length && !withdrawals.length && !note && !error) return null;

  return (
    <Segment style={{ borderRadius: 10 }} aria-labelledby="federation-requests-heading">
      <Header as="h3" id="federation-requests-heading" style={{ marginTop: 0 }}>
        <Icon name="handshake outline" color="teal" aria-hidden="true" />
        {c.invites.title}
      </Header>
      {error ? <Message negative size="small">{error}</Message> : null}
      {note ? <Message positive size="small">{note}</Message> : null}
      {invites.length ? (
        <List divided relaxed>
          {invites.map((v) => (
            <List.Item key={v.id}>
              <List.Content floated="right">
                <Button
                  size="small"
                  primary
                  loading={busy === `a:${v.id}`}
                  disabled={!!busy}
                  onClick={() => act(`a:${v.id}`, 'AcceptFederationInvite', { federationId: v.id }, c.invites.accepted)}
                >
                  {c.invites.accept}
                </Button>
                <Button
                  size="small"
                  basic
                  loading={busy === `d:${v.id}`}
                  disabled={!!busy}
                  onClick={() => act(`d:${v.id}`, 'DeclineFederationInvite', { federationId: v.id }, c.invites.declined)}
                >
                  {c.invites.decline}
                </Button>
              </List.Content>
              <List.Content>
                <List.Header>{c.invites.body(v.name, v.threshold, v.validators.length)}</List.Header>
                <List.Description>
                  {c.invites.from(memberLabel(v, v.publisher))}
                  {' · '}
                  <code style={{ wordBreak: 'break-all' }}>{v.vaultAddress}</code>
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      ) : <p style={{ color: '#666' }}>{c.invites.none}</p>}

      <Header as="h4">{c.approvals.title}</Header>
      {withdrawals.length ? (
        <List divided relaxed>
          {withdrawals.map((w) => (
            <List.Item key={w.requestId}>
              <List.Content floated="right">
                <Button
                  size="small"
                  primary
                  loading={busy === `w:${w.requestId}`}
                  disabled={!!busy}
                  onClick={() => act(`w:${w.requestId}`, 'ApproveFederationWithdrawal', { federationId: w.federation.id, requestId: w.requestId }, c.withdraw.approved)}
                >
                  {c.withdraw.approve}
                </Button>
              </List.Content>
              <List.Content>
                <List.Header>{c.approvals.body(w.federation.name, t.common.sats(w.amountSats), w.destinationAddress)}</List.Header>
                <List.Description>
                  {c.approvals.fee(t.common.sats(w.feeSats))}
                  {' · '}
                  {c.withdraw.approvals(w.signers.length, w.federation.threshold)}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      ) : <p style={{ color: '#666' }}>{c.approvals.none}</p>}
    </Segment>
  );
}

FederationRequestsPanel.federationRpc = federationRpc;
FederationRequestsPanel.shortKey = shortKey;
FederationRequestsPanel.memberLabel = memberLabel;

module.exports = FederationRequestsPanel;
