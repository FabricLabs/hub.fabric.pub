'use strict';

const React = require('react');
const { Button, Form, Header, Icon, Input, Label, List, Message, Segment } = require('semantic-ui-react');
const FederationRequestsPanel = require('./FederationRequestsPanel');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const c = t.federation.named;
const { federationRpc, shortKey, memberLabel } = FederationRequestsPanel;
const PUBKEY_RE = /^0[23][0-9a-fA-F]{64}$/;

function copy (text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(String(text));
  } catch (_) {}
}

/**
 * Hub wallet receive address and balance (admin).
 * @param {{ adminToken: string, refreshToken?: number }} props
 */
function HubWalletCard (props) {
  const [wallet, setWallet] = React.useState(null);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await federationRpc('GetHubWallet', { adminToken: props.adminToken });
        if (live) { setWallet(r.wallet); setError(null); }
      } catch (e) {
        if (live) setError(e.message);
      }
    };
    void load();
    const id = setInterval(load, 15000);
    return () => { live = false; clearInterval(id); };
  }, [props.adminToken, props.refreshToken]);
  return (
    <Segment secondary style={{ borderRadius: 10 }}>
      <Header as="h4" style={{ marginTop: 0 }}>
        <Icon name="bitcoin" aria-hidden="true" />
        {c.wallet.title}
      </Header>
      {error ? <p style={{ color: '#9f3a38' }}>{c.wallet.failed(error)}</p> : null}
      {wallet ? (
        <div>
          <p style={{ margin: '0 0 0.35em' }}>
            {c.wallet.address}:{' '}
            <code style={{ wordBreak: 'break-all' }}>{wallet.address}</code>{' '}
            <Button size="mini" basic onClick={() => copy(wallet.address)}>{c.copy}</Button>
          </p>
          <p style={{ margin: 0 }}>
            <strong>{c.wallet.available(t.common.sats(wallet.trustedSats))}</strong>
            {wallet.pendingSats ? <span>{' · '}{c.wallet.pending(t.common.sats(wallet.pendingSats))}</span> : null}
            {wallet.immatureSats ? <span>{' · '}{c.wallet.immature(t.common.sats(wallet.immatureSats))}</span> : null}
          </p>
        </div>
      ) : null}
    </Segment>
  );
}

/**
 * One federation: members, vault, deposit, withdraw.
 * @param {{ adminToken: string, summary: Object, onChange: Function }} props
 */
function FederationDetail (props) {
  const { adminToken, summary } = props;
  const [view, setView] = React.useState(null);
  const [busy, setBusy] = React.useState('');
  const [note, setNote] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [depositSats, setDepositSats] = React.useState('');
  const [depositRate, setDepositRate] = React.useState('2');
  const [dest, setDest] = React.useState('');
  const [withdrawSats, setWithdrawSats] = React.useState('');
  const [withdrawRate, setWithdrawRate] = React.useState('2');

  const load = React.useCallback(async () => {
    try {
      const r = await federationRpc('GetNamedFederation', { adminToken, federationId: summary.id });
      setView(r.federation);
    } catch (e) {
      setError(e.message);
    }
  }, [adminToken, summary.id]);

  React.useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(id);
  }, [load, summary.updatedAt]);

  const act = async (key, method, params, done) => {
    setBusy(key);
    setNote(null);
    setError(null);
    try {
      const r = await federationRpc(method, { adminToken, federationId: summary.id, ...params });
      setNote(typeof done === 'function' ? done(r) : done);
      await load();
      props.onChange();
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy('');
    }
  };

  const v = view || summary;
  const active = v.status === 'active';
  return (
    <div style={{ marginTop: '0.75em' }}>
      {error ? <Message negative size="small">{error}</Message> : null}
      {note ? <Message positive size="small">{note}</Message> : null}
      <List relaxed>
        {v.members.map((m) => (
          <List.Item key={m.pubkey}>
            <List.Content floated="right">
              <Label size="small" color={m.status === 'accepted' ? 'green' : (m.status === 'declined' ? 'red' : 'grey')}>
                {c.memberStatus[m.status] || m.status}
              </Label>
            </List.Content>
            <List.Content>
              <List.Header>
                {m.self ? c.thisHub : (m.alias || m.url || shortKey(m.pubkey))}
                {m.pubkey === v.publisher ? <span style={{ fontWeight: 'normal', color: '#666' }}>{' · '}{c.publisher}</span> : null}
              </List.Header>
              <List.Description><code>{m.pubkey}</code></List.Description>
            </List.Content>
          </List.Item>
        ))}
      </List>
      {v.isPublisher && v.status === 'pending' ? (
        <Button size="small" basic loading={busy === 'resend'} disabled={!!busy} onClick={() => act('resend', 'ResendFederationInvite', {}, c.resent)}>
          {c.resend}
        </Button>
      ) : null}
      <p style={{ marginTop: '0.75em' }}>
        {c.vault}:{' '}<code style={{ wordBreak: 'break-all' }}>{v.vaultAddress}</code>{' '}
        <Button size="mini" basic onClick={() => copy(v.vaultAddress)}>{c.copy}</Button>
      </p>
      {view ? (
        <p>
          {view.balanceSats != null
            ? <strong>{c.balance(t.common.sats(view.balanceSats))}</strong>
            : c.balanceUnknown(view.balanceError || '')}
        </p>
      ) : null}

      <Header as="h4">{c.deposit.title}</Header>
      {!active ? <p style={{ color: '#666' }}>{c.deposit.notActive}</p> : (
        <Form onSubmit={() => act('deposit', 'DepositToFederation', {
          amountSats: Number(depositSats),
          feeRateSatVb: Number(depositRate)
        }, (r) => c.deposit.sent(r.deposit.txid))}
        >
          <Form.Group widths="equal">
            <Form.Input label={c.deposit.amount} type="number" min="546" value={depositSats} onChange={(e, d) => setDepositSats(d.value)} />
            <Form.Input label={c.deposit.feeRate} type="number" min="1" step="any" value={depositRate} onChange={(e, d) => setDepositRate(d.value)} />
          </Form.Group>
          <Button type="submit" primary size="small" loading={busy === 'deposit'} disabled={!!busy || !(Number(depositSats) > 0)}>
            {c.deposit.submit}
          </Button>
        </Form>
      )}

      <Header as="h4">{c.withdraw.title}</Header>
      <p style={{ color: '#666' }}>{c.withdraw.help(v.threshold)}</p>
      <Form onSubmit={() => act('withdraw', 'CreateFederationWithdrawal', {
        destinationAddress: dest.trim(),
        amountSats: Number(withdrawSats),
        feeRateSatVb: Number(withdrawRate)
      }, c.withdraw.requested)}
      >
        <Form.Input label={c.withdraw.destination} value={dest} onChange={(e, d) => setDest(d.value)} />
        <Form.Group widths="equal">
          <Form.Input label={c.withdraw.amount} type="number" min="546" value={withdrawSats} onChange={(e, d) => setWithdrawSats(d.value)} />
          <Form.Input label={c.withdraw.feeRate} type="number" min="1" step="any" value={withdrawRate} onChange={(e, d) => setWithdrawRate(d.value)} />
        </Form.Group>
        <Button type="submit" size="small" loading={busy === 'withdraw'} disabled={!!busy || !dest.trim() || !(Number(withdrawSats) > 0)}>
          {c.withdraw.submit}
        </Button>
      </Form>

      <Header as="h5">{c.withdraw.listTitle}</Header>
      {(v.withdrawals || []).length ? (
        <List divided relaxed>
          {v.withdrawals.map((w) => (
            <List.Item key={w.requestId}>
              <List.Content floated="right">
                {w.status === 'pending' && !w.signedBySelf ? (
                  <Button size="mini" primary loading={busy === `a:${w.requestId}`} disabled={!!busy} onClick={() => act(`a:${w.requestId}`, 'ApproveFederationWithdrawal', { requestId: w.requestId }, c.withdraw.approved)}>
                    {c.withdraw.approve}
                  </Button>
                ) : null}
                {(w.status === 'pending' || w.status === 'failed') && w.signers.length >= v.threshold ? (
                  <Button size="mini" basic loading={busy === `b:${w.requestId}`} disabled={!!busy} onClick={() => act(`b:${w.requestId}`, 'BroadcastFederationWithdrawal', { requestId: w.requestId }, (r) => c.withdraw.txid(r.withdrawal.txid))}>
                    {c.withdraw.broadcast}
                  </Button>
                ) : null}
              </List.Content>
              <List.Content>
                <List.Header>{c.withdraw.row(t.common.sats(w.amountSats), w.destinationAddress)}</List.Header>
                <List.Description>
                  {c.withdraw.status[w.status] || w.status}
                  {' · '}
                  {c.withdraw.approvals(w.signers.length, v.threshold)}
                  {' · '}
                  {memberLabel(v, (v.members.find((m) => m.pubkey.slice(2) === w.requester) || {}).pubkey || w.requester)}
                  {w.txid ? <div><code style={{ wordBreak: 'break-all' }}>{c.withdraw.txid(w.txid)}</code></div> : null}
                  {w.error ? <div style={{ color: '#9f3a38' }}>{w.error}</div> : null}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      ) : <p style={{ color: '#666' }}>{c.withdraw.none}</p>}
    </div>
  );
}

/**
 * Create form: this Hub plus Hubs added by verified address or by key.
 * @param {{ adminToken: string, self: (string|null), onCreated: Function }} props
 */
function CreateFederationForm (props) {
  const { adminToken, self } = props;
  const [name, setName] = React.useState('');
  const [members, setMembers] = React.useState([]);
  const [url, setUrl] = React.useState('');
  const [key, setKey] = React.useState('');
  const [threshold, setThreshold] = React.useState('2');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState(null);
  const [note, setNote] = React.useState(null);

  const addMember = (m) => {
    const lower = m.pubkey.toLowerCase();
    if (self && lower.slice(2) === self.slice(2)) throw new Error(c.create.isSelf);
    if (members.some((x) => x.pubkey.slice(2) === lower.slice(2))) throw new Error(c.create.duplicate);
    setMembers((list) => [...list, { ...m, pubkey: lower }]);
  };

  const addByUrl = async () => {
    setBusy('url');
    setError(null);
    try {
      const r = await federationRpc('ResolveHubIdentity', { adminToken, url: url.trim() });
      addMember({ pubkey: r.pubkey, url: r.url, alias: r.alias, verified: true });
      setUrl('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const addByKey = () => {
    setError(null);
    try {
      if (!PUBKEY_RE.test(key.trim())) throw new Error(c.create.invalidKey);
      addMember({ pubkey: key.trim(), verified: false });
      setKey('');
    } catch (e) {
      setError(e.message);
    }
  };

  const n = members.length + 1;
  const submit = async () => {
    setError(null);
    setNote(null);
    if (!members.length) {
      setError(c.create.needMember);
      return;
    }
    setBusy('create');
    try {
      await federationRpc('CreateNamedFederation', {
        adminToken,
        name: name.trim() || undefined,
        threshold: Number(threshold),
        members: members.map((m) => ({ pubkey: m.pubkey, url: m.url, alias: m.alias }))
      });
      setNote(c.create.created);
      setMembers([]);
      setName('');
      props.onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Segment style={{ borderRadius: 10 }}>
      <Header as="h4" style={{ marginTop: 0 }}>{c.create.title}</Header>
      <p style={{ color: '#666' }}>{c.create.help}</p>
      {error ? <Message negative size="small">{error}</Message> : null}
      {note ? <Message positive size="small">{note}</Message> : null}
      <Form onSubmit={submit}>
        <Form.Input label={c.create.name} placeholder={c.create.namePlaceholder} value={name} onChange={(e, d) => setName(d.value)} />
        <Form.Field>
          <label>{c.create.addByUrl}</label>
          <Input
            placeholder={c.create.addByUrlPlaceholder}
            value={url}
            onChange={(e, d) => setUrl(d.value)}
            action={<Button type="button" loading={busy === 'url'} disabled={!!busy || !url.trim()} onClick={addByUrl}>{c.create.addHub}</Button>}
          />
        </Form.Field>
        <Form.Field>
          <label>{c.create.addByKey}</label>
          <Input
            placeholder={c.create.addByKeyPlaceholder}
            value={key}
            onChange={(e, d) => setKey(d.value)}
            action={<Button type="button" disabled={!!busy || !key.trim()} onClick={addByKey}>{c.create.addKey}</Button>}
          />
        </Form.Field>
        <Header as="h5">{c.create.members}</Header>
        <List relaxed>
          <List.Item>
            <List.Content>
              <List.Header>{c.thisHub}</List.Header>
              <List.Description><code>{self || '…'}</code></List.Description>
            </List.Content>
          </List.Item>
          {members.map((m) => (
            <List.Item key={m.pubkey}>
              <List.Content floated="right">
                <Button type="button" size="mini" basic onClick={() => setMembers((list) => list.filter((x) => x.pubkey !== m.pubkey))}>
                  {c.create.remove}
                </Button>
              </List.Content>
              <List.Content>
                <List.Header>{m.alias || m.url || shortKey(m.pubkey)}</List.Header>
                <List.Description>
                  <code>{m.pubkey}</code>
                  <div style={{ color: m.verified ? '#21ba45' : '#666' }}>{m.verified ? c.create.verified(m.alias) : c.create.unverified}</div>
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
        <Form.Input
          label={c.create.threshold}
          type="number"
          min="2"
          max={String(n)}
          value={threshold}
          onChange={(e, d) => setThreshold(d.value)}
          width={4}
        />
        <p style={{ color: '#666', marginTop: '-0.5em' }}>{c.create.thresholdHelp(n)}</p>
        <Button type="submit" primary loading={busy === 'create'} disabled={!!busy || !members.length}>
          {c.create.submit}
        </Button>
      </Form>
    </Segment>
  );
}

/**
 * Named federations with other Hubs (services/federations.js).
 * @param {{ adminToken?: string }} props
 */
function NamedFederationsPanel (props) {
  const adminToken = readHubAdminTokenFromBrowser(props && props.adminToken);
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [open, setOpen] = React.useState(null);
  const [tick, setTick] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!adminToken) return;
    try {
      const r = await federationRpc('ListNamedFederations', { adminToken });
      setData(r);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [adminToken]);

  React.useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(id);
  }, [load, tick]);

  const changed = () => setTick((n) => n + 1);

  return (
    <section aria-labelledby="named-federations-heading" style={{ marginBottom: '1.25em' }}>
      <Segment style={{ borderRadius: 10 }}>
        <Header as="h2" id="named-federations-heading" style={{ marginTop: 0 }}>
          <Icon name="sitemap" color="teal" aria-hidden="true" />
          {c.title}
        </Header>
        <p style={{ color: '#555', lineHeight: 1.45 }}>{c.intro}</p>
        {!adminToken ? <Message info size="small">{c.needToken}</Message> : null}
        {error ? <Message negative size="small">{c.loadFailed(error)}</Message> : null}
        {adminToken && !data && !error ? <p>{c.loading}</p> : null}
        {data && data.self ? <p style={{ color: '#666', fontSize: '0.9em' }}>{c.thisHubKey(data.self)}</p> : null}
        {adminToken ? <HubWalletCard adminToken={adminToken} refreshToken={tick} /> : null}
        {data ? (
          data.federations.length ? (
            <List divided relaxed>
              {data.federations.map((f) => (
                <List.Item key={f.id}>
                  <List.Content floated="right">
                    <Button size="small" basic onClick={() => setOpen(open === f.id ? null : f.id)}>
                      {open === f.id ? c.close : c.open}
                    </Button>
                  </List.Content>
                  <List.Content>
                    <List.Header>
                      {f.name}{' '}
                      <Label size="tiny" color={f.status === 'active' ? 'green' : (f.status === 'declined' ? 'red' : 'yellow')}>
                        {c.status[f.status] || f.status}
                      </Label>
                    </List.Header>
                    <List.Description>
                      {c.policy(f.threshold, f.validators.length)}
                      {f.source === 'policy' ? <span>{' · '}{c.imported}</span> : null}
                    </List.Description>
                    {open === f.id ? <FederationDetail adminToken={adminToken} summary={f} onChange={changed} /> : null}
                  </List.Content>
                </List.Item>
              ))}
            </List>
          ) : <p style={{ color: '#666' }}>{c.none}</p>
        ) : null}
      </Segment>
      {adminToken ? <FederationRequestsPanel adminToken={adminToken} refreshToken={tick} onChange={changed} compact /> : null}
      {adminToken ? <CreateFederationForm adminToken={adminToken} self={data ? data.self : null} onCreated={changed} /> : null}
    </section>
  );
}

module.exports = NamedFederationsPanel;
