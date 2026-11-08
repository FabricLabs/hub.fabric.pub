'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const {
  Button,
  Container,
  Form,
  Header,
  Icon,
  Label,
  List,
  Message,
  Segment,
  Table
} = require('semantic-ui-react');
const FederationRequestsPanel = require('./FederationRequestsPanel');
const YourFederations = require('./YourFederations');
const { browserContractsClient } = require('../functions/hubContractsBrowser');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { PASSPORT_SESSION_EVENT } = require('../functions/passportSession');
const {
  federationSummary,
  signerRows,
  vaultRows,
  withdrawalRows,
  shortKey
} = require('../functions/federationView');
const { messageHref, messageLabel } = require('../functions/fabricMessageView');
const t = require('../locales/en');

const c = t.federation.page;
const named = t.federation.named;
const { federationRpc } = FederationRequestsPanel;
const MESSAGE_PAGE = 50;

function copy (text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(String(text));
  } catch (_) {}
}

function CopyButton (props) {
  return <Button type="button" size="mini" basic onClick={() => copy(props.text)}>{props.label || c.copy}</Button>;
}

function statusColor (status) {
  if (status === 'active' || status === 'accepted') return 'green';
  if (status === 'declined') return 'red';
  if (status === 'relayed') return 'blue';
  return 'yellow';
}

function signerName (view, key) {
  const rows = signerRows(view);
  const row = rows.find((r) => r.pubkey.slice(2) === String(key || '').toLowerCase() || r.pubkey === key);
  if (!row) return shortKey(key);
  if (row.hub) return c.signers.hub;
  return row.alias || row.short;
}

/**
 * Operator actions: deposit from the Hub wallet, request a withdrawal, resend the invite.
 * @param {{ adminToken: string, view: Object, onChange: Function }} props
 */
function OperatorActions (props) {
  const { adminToken, view } = props;
  const [busy, setBusy] = React.useState('');
  const [note, setNote] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [depositSats, setDepositSats] = React.useState('');
  const [depositRate, setDepositRate] = React.useState('2');
  const [dest, setDest] = React.useState('');
  const [withdrawSats, setWithdrawSats] = React.useState('');
  const [withdrawRate, setWithdrawRate] = React.useState('2');

  const act = async (key, method, params, done) => {
    setBusy(key);
    setNote(null);
    setError(null);
    try {
      const r = await federationRpc(method, { adminToken, federationId: view.id, ...params });
      setNote(typeof done === 'function' ? done(r) : done);
      props.onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const active = view.status === 'active';
  return (
    <Segment style={{ borderRadius: 10 }} aria-labelledby="federation-actions-heading">
      <Header as="h3" id="federation-actions-heading" style={{ marginTop: 0 }}>{c.actions.title}</Header>
      {error ? <Message negative size="small">{error}</Message> : null}
      {note ? <Message positive size="small">{note}</Message> : null}
      {view.isPublisher && view.status === 'pending' ? (
        <Button size="small" basic loading={busy === 'resend'} disabled={!!busy} onClick={() => act('resend', 'ResendFederationInvite', {}, named.resent)}>
          {named.resend}
        </Button>
      ) : null}

      <Header as="h4">{named.deposit.title}</Header>
      {!active ? <p style={{ color: '#666' }}>{named.deposit.notActive}</p> : (
        <Form onSubmit={() => act('deposit', 'DepositToFederation', {
          amountSats: Number(depositSats),
          feeRateSatVb: Number(depositRate)
        }, (r) => named.deposit.sent(r.deposit.txid))}
        >
          <Form.Group widths="equal">
            <Form.Input label={named.deposit.amount} type="number" min="546" value={depositSats} onChange={(e, d) => setDepositSats(d.value)} />
            <Form.Input label={named.deposit.feeRate} type="number" min="1" step="any" value={depositRate} onChange={(e, d) => setDepositRate(d.value)} />
          </Form.Group>
          <Button type="submit" primary size="small" loading={busy === 'deposit'} disabled={!!busy || !(Number(depositSats) > 0)}>
            {named.deposit.submit}
          </Button>
        </Form>
      )}

      <Header as="h4">{named.withdraw.title}</Header>
      <p style={{ color: '#666' }}>{named.withdraw.help(view.threshold)}</p>
      <Form onSubmit={() => act('withdraw', 'CreateFederationWithdrawal', {
        destinationAddress: dest.trim(),
        amountSats: Number(withdrawSats),
        feeRateSatVb: Number(withdrawRate)
      }, named.withdraw.requested)}
      >
        <Form.Input label={named.withdraw.destination} value={dest} onChange={(e, d) => setDest(d.value)} />
        <Form.Group widths="equal">
          <Form.Input label={named.withdraw.amount} type="number" min="546" value={withdrawSats} onChange={(e, d) => setWithdrawSats(d.value)} />
          <Form.Input label={named.withdraw.feeRate} type="number" min="1" step="any" value={withdrawRate} onChange={(e, d) => setWithdrawRate(d.value)} />
        </Form.Group>
        <Button type="submit" size="small" loading={busy === 'withdraw'} disabled={!!busy || !dest.trim() || !(Number(withdrawSats) > 0)}>
          {named.withdraw.submit}
        </Button>
      </Form>
      {props.children ? props.children({ act, busy }) : null}
    </Segment>
  );
}

/**
 * Withdrawals with "n of k" signatures. The operator approves and broadcasts
 * here; a member sees whether their signature is still needed.
 */
function Withdrawals (props) {
  const { view, viewerKey, operator, act, busy } = props;
  const rows = withdrawalRows(view, viewerKey);
  return (
    <Segment style={{ borderRadius: 10 }} aria-labelledby="federation-withdrawals-heading">
      <Header as="h3" id="federation-withdrawals-heading" style={{ marginTop: 0 }}>{c.withdrawals.title}</Header>
      {!rows.length ? <p style={{ color: '#666' }}>{c.withdrawals.none}</p> : (
        <List divided relaxed>
          {rows.map((w) => (
            <List.Item key={w.requestId}>
              {operator && act ? (
                <List.Content floated="right">
                  {w.status === 'pending' && !w.signedBySelf ? (
                    <Button size="mini" primary loading={busy === `a:${w.requestId}`} disabled={!!busy} onClick={() => act(`a:${w.requestId}`, 'ApproveFederationWithdrawal', { requestId: w.requestId }, named.withdraw.approved)}>
                      {named.withdraw.approve}
                    </Button>
                  ) : null}
                  {(w.status === 'pending' || w.status === 'failed') && w.ready ? (
                    <Button size="mini" basic loading={busy === `b:${w.requestId}`} disabled={!!busy} onClick={() => act(`b:${w.requestId}`, 'BroadcastFederationWithdrawal', { requestId: w.requestId }, (r) => named.withdraw.txid(r.withdrawal.txid))}>
                      {named.withdraw.broadcast}
                    </Button>
                  ) : null}
                </List.Content>
              ) : null}
              <List.Content>
                <List.Header>{c.withdrawals.row(t.common.sats(w.amountSats), w.destinationAddress)}</List.Header>
                <List.Description>
                  <Label size="tiny" color={w.ready ? 'green' : 'grey'}>{c.withdrawals.progress(w.progress)}</Label>{' '}
                  {named.withdraw.status[w.status] || w.status}
                  {' · '}{c.withdrawals.fee(t.common.sats(w.feeSats))}
                  {w.requester ? <span>{' · '}{c.withdrawals.requestedBy(signerName(view, w.requester))}</span> : null}
                  {w.signedByViewer ? <span>{' · '}<strong>{c.withdrawals.youSigned}</strong></span> : null}
                  {w.canSign && !operator ? <div style={{ marginTop: '0.35em' }}>{c.withdrawals.yourTurn}</div> : null}
                  {w.txid ? <div><code style={{ wordBreak: 'break-all' }}>{named.withdraw.txid(w.txid)}</code></div> : null}
                  {w.error ? <div style={{ color: '#9f3a38' }}>{w.error}</div> : null}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      )}
    </Segment>
  );
}

function Messages (props) {
  const { client, federationId } = props;
  const [rows, setRows] = React.useState([]);
  const [next, setNext] = React.useState(0);
  const [more, setMore] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(async (since, append) => {
    try {
      const r = await client.federationMessages(federationId, { since, limit: MESSAGE_PAGE });
      setRows((prev) => (append ? prev.concat(r.messages || []) : (r.messages || [])));
      setNext(r.next || 0);
      setMore(!!r.more);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [client, federationId]);

  React.useEffect(() => { void load(0, false); }, [load]);

  return (
    <Segment id="messages" style={{ borderRadius: 10 }} aria-labelledby="federation-messages-heading">
      <Header as="h3" id="federation-messages-heading" style={{ marginTop: 0 }}>{c.messages.title}</Header>
      <p style={{ color: '#666' }}>{c.messages.help}</p>
      {error ? <Message negative size="small">{error}</Message> : null}
      {!rows.length && !error ? <p style={{ color: '#666' }}>{c.messages.none}</p> : null}
      {rows.length ? (
        <List divided relaxed>
          {rows.map((m) => (
            <List.Item key={m.id || m.seq}>
              <List.Content floated="right">
                {m.id ? <Button as={Link} to={messageHref(m.id)} size="mini" basic>{c.messages.open}</Button> : null}
                {m.fabric ? <CopyButton text={m.fabric} label={c.messages.copyFabric} /> : null}
              </List.Content>
              <List.Content>
                <List.Header>{messageLabel(m.type)}</List.Header>
                <List.Description>
                  #{m.seq}
                  {m.signer ? <span>{' · '}{c.messages.signer(signerName(props.view, m.signer))}</span> : null}
                  {m.at ? <span>{' · '}{new Date(m.at).toLocaleString()}</span> : null}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      ) : null}
      {more ? <Button type="button" size="small" basic onClick={() => load(next, true)}>{c.messages.more}</Button> : null}
    </Segment>
  );
}

/**
 * `/federations/:id`: one named federation for the operator or one of its signers.
 * @param {{ adminToken?: string, federationId?: string }} props
 */
function FederationPage (props) {
  const params = useParams();
  const id = (props && props.federationId) || (params && params.id) || '';
  const adminToken = readHubAdminTokenFromBrowser(props && props.adminToken);
  const client = React.useMemo(() => browserContractsClient(adminToken), [adminToken]);
  const [view, setView] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [missing, setMissing] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const f = await client.getFederation(id);
        if (!live) return;
        setView(f);
        setMissing(false);
        setError(null);
      } catch (e) {
        if (!live) return;
        if (e && e.status === 404) setMissing(true);
        else setError(e.message);
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    return () => { live = false; clearInterval(timer); };
  }, [client, id, tick]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(PASSPORT_SESSION_EVENT, bump);
    return () => window.removeEventListener(PASSPORT_SESSION_EVENT, bump);
  }, []);

  const changed = () => setTick((n) => n + 1);
  const s = view ? federationSummary(view) : null;
  const viewer = view && view.viewer ? view.viewer : null;
  const operator = !!(viewer && viewer.role === 'operator');
  const viewerKey = viewer && viewer.key ? viewer.key : null;

  return (
    <Container style={{ maxWidth: 980, margin: '1em auto 2em', padding: '0 0.75em' }}>
      <Button as={Link} to="/federations" basic size="small" style={{ marginBottom: '1em' }}>
        <Icon name="arrow left" aria-hidden="true" />
        {c.back}
      </Button>
      {error ? <Message negative>{c.loadFailed(error)}</Message> : null}
      {!view && !error && !missing ? <Segment loading style={{ minHeight: '6em' }}>{c.loading}</Segment> : null}
      {missing ? (
        <div>
          <Message info>{c.notFound}</Message>
          {!adminToken ? <YourFederations /> : null}
        </div>
      ) : null}
      {view && s ? (
        <div>
          <Segment raised style={{ borderRadius: 10 }}>
            <Header as="h1" style={{ marginTop: 0 }}>
              <Icon name="sitemap" color="teal" aria-hidden="true" />
              <Header.Content>
                {s.name || c.titleFallback(s.shortId)}
                <Header.Subheader style={{ marginTop: '0.35em' }}>
                  {viewer && c.viewer[viewer.role] ? c.viewer[viewer.role] : null}
                </Header.Subheader>
              </Header.Content>
            </Header>
            <List horizontal relaxed>
              <List.Item>
                <List.Header>{c.id}</List.Header>
                <code title={s.id}>{s.shortId}</code>{' '}<CopyButton text={s.id} />
              </List.Item>
              <List.Item>
                <List.Header>{c.network}</List.Header>
                {s.network || '—'}
              </List.Item>
              <List.Item>
                <List.Header>{c.policy}</List.Header>
                {s.threshold}
              </List.Item>
              <List.Item>
                <List.Header>{c.status}</List.Header>
                <Label size="small" color={statusColor(s.status)}>
                  {s.status === 'relayed' ? c.relayed : (named.status[s.status] || s.status)}
                </Label>
              </List.Item>
            </List>
            {s.status === 'relayed' ? <p style={{ color: '#666', marginTop: '0.75em' }}>{c.relayedHelp}</p> : null}
          </Segment>

          <Segment style={{ borderRadius: 10 }} aria-labelledby="federation-signers-heading">
            <Header as="h3" id="federation-signers-heading" style={{ marginTop: 0 }}>{c.signers.title}</Header>
            <Table basic="very" compact unstackable>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{c.signers.signer}</Table.HeaderCell>
                  <Table.HeaderCell>{c.signers.status}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {signerRows(view, viewerKey).map((r) => (
                  <Table.Row key={r.pubkey}>
                    <Table.Cell>
                      <strong>{r.hub ? c.signers.hub : (r.alias || r.short)}</strong>{' '}
                      {r.you ? <Label size="tiny" color="blue">{c.signers.you}</Label> : null}
                      {r.publisher ? <Label size="tiny" basic>{c.signers.publisher}</Label> : null}
                      <div><code style={{ wordBreak: 'break-all', fontSize: '0.85em' }}>{r.pubkey}</code></div>
                    </Table.Cell>
                    <Table.Cell>
                      {r.status ? <Label size="small" color={statusColor(r.status)}>{named.memberStatus[r.status] || r.status}</Label> : c.signers.unknownStatus}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Segment>

          <Segment style={{ borderRadius: 10 }} aria-labelledby="federation-vault-heading">
            <Header as="h3" id="federation-vault-heading" style={{ marginTop: 0 }}>{c.vaults.title}</Header>
            {vaultRows(view).map((v) => (
              <div key={v.address} style={{ marginBottom: '1em' }}>
                <Header as="h4" style={{ marginBottom: '0.35em' }}>{v.current ? c.vaults.current : c.vaults.previous}</Header>
                {!v.current ? <p style={{ color: '#666' }}>{c.vaults.previousHelp}</p> : null}
                <p style={{ margin: '0 0 0.35em' }}>
                  <code style={{ wordBreak: 'break-all' }}>{v.address}</code>{' '}<CopyButton text={v.address} />
                </p>
                <p style={{ margin: '0 0 0.35em' }}>
                  {v.balanceSats != null
                    ? <strong>{c.vaults.balance(t.common.sats(v.balanceSats))}</strong>
                    : c.vaults.balanceUnknown(v.error || '')}
                </p>
                {Array.isArray(v.coins) ? (
                  v.coins.length ? (
                    <Table basic="very" compact unstackable size="small">
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>{c.vaults.coin}</Table.HeaderCell>
                          <Table.HeaderCell>{c.vaults.amount}</Table.HeaderCell>
                          <Table.HeaderCell>{c.vaults.height}</Table.HeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {v.coins.map((u) => (
                          <Table.Row key={`${u.txid}:${u.vout}`}>
                            <Table.Cell><code style={{ wordBreak: 'break-all' }}>{`${u.txid}:${u.vout}`}</code></Table.Cell>
                            <Table.Cell>{t.common.sats(u.sats)}</Table.Cell>
                            <Table.Cell>{u.height != null ? u.height : '—'}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table>
                  ) : <p style={{ color: '#666' }}>{c.vaults.noCoins}</p>
                ) : null}
              </div>
            ))}
          </Segment>

          {operator && s.status !== 'relayed' ? (
            <OperatorActions adminToken={adminToken} view={view} onChange={changed}>
              {({ act, busy }) => <Withdrawals view={view} viewerKey={viewerKey} operator act={act} busy={busy} />}
            </OperatorActions>
          ) : <Withdrawals view={view} viewerKey={viewerKey} operator={false} />}

          <Messages client={client} federationId={view.id} view={view} />

          <Segment style={{ borderRadius: 10 }} aria-labelledby="federation-descriptor-heading">
            <Header as="h3" id="federation-descriptor-heading" style={{ marginTop: 0 }}>{c.descriptor.title}</Header>
            <p style={{ color: '#666' }}>{c.descriptor.help}</p>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.85em', background: '#f8f8f8', padding: '0.75em', borderRadius: 6 }}>
              {JSON.stringify(view.descriptor, null, 2)}
            </pre>
            <CopyButton text={JSON.stringify(view.descriptor)} />
          </Segment>
        </div>
      ) : null}
    </Container>
  );
}

module.exports = FederationPage;
