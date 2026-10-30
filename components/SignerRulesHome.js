'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Checkbox,
  Form,
  Header,
  Icon,
  Label,
  List,
  Message,
  Segment
} = require('semantic-ui-react');
const {
  getSignerRules,
  putSignerRules,
  listSignerDecisions
} = require('../functions/hubDelegationClient');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const c = t.delegation.rules;

/** @private */
function lines (text) {
  return String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/** @private */
function nextId (rules, prefix) {
  let n = 1;
  while (rules.some((r) => r.id === `${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** @private */
function describeRule (rule) {
  const parts = [c.scopes[rule.scope] || rule.scope];
  if (rule.origins) parts.push(rule.origins.join(', '));
  if (rule.maxAmountSats) parts.push(`≤ ${rule.maxAmountSats} sats`);
  if (rule.destinations) parts.push(rule.destinations.map((a) => `${a.slice(0, 10)}…`).join(', '));
  if (rule.dailyLimitSats) parts.push(`${rule.dailyLimitSats} sats/day`);
  if (rule.maxPerHour) parts.push(`${rule.maxPerHour}/hour`);
  return parts.join(' · ');
}

/**
 * Signing rules: what this Hub signs for its linked signers without asking.
 * @param {{ adminToken?: string }} props
 */
function SignerRulesHome (props) {
  const adminToken = readHubAdminTokenFromBrowser(props && props.adminToken);
  const [rules, setRules] = React.useState([]);
  const [valid, setValid] = React.useState([]);
  const [invalid, setInvalid] = React.useState([]);
  const [decisions, setDecisions] = React.useState([]);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [origins, setOrigins] = React.useState('');
  const [maxAmount, setMaxAmount] = React.useState('');
  const [destinations, setDestinations] = React.useState('');
  const [dailyLimit, setDailyLimit] = React.useState('');

  const apply = (r) => {
    setRules(r.rules || []);
    setValid(r.valid || []);
    setInvalid(r.invalid || []);
  };

  const load = React.useCallback(async () => {
    if (!adminToken) return;
    try {
      apply(await getSignerRules(adminToken));
      setDecisions(await listSignerDecisions(adminToken, 25));
      setDirty(false);
    } catch (e) {
      setError(t.common.errors.withReason(c.loadFailed, e.message));
    }
  }, [adminToken]);

  React.useEffect(() => { void load(); }, [load]);

  const add = (rule) => {
    setRules((list) => list.concat([Object.assign({ id: nextId(list, rule.scope === 'passport' ? 'sign-in' : 'wallet') }, rule)]));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      apply(await putSignerRules(adminToken, rules));
      setDirty(false);
      setNote(c.saved);
    } catch (e) {
      setError(t.common.errors.withReason(c.saveFailed, e.message));
    } finally {
      setBusy(false);
    }
  };

  const usageOf = (id) => {
    const v = valid.find((r) => r.id === id);
    return v && v.usage ? v.usage : null;
  };
  const brokenOf = (id, index) => invalid.find((x) => x.id === id || x.index === index);

  return (
    <Segment style={{ maxWidth: 960, margin: '1em auto' }} data-testid="signer-rules">
      <Header as="h2">
        <Icon name="handshake outline" aria-hidden="true" />
        <Header.Content>{c.title}</Header.Content>
      </Header>
      <p style={{ color: '#666' }}>
        {c.intro}{' '}
        <Link to="/notifications">{t.identity.security.signers.requestsLink}</Link>
        {' · '}
        <Link to="/settings/security">{t.identity.security.signers.title}</Link>
      </p>
      {!adminToken ? <Message info>{c.adminOnly}</Message> : null}
      {note ? <Message positive size="small" onDismiss={() => setNote(null)}>{note}</Message> : null}
      {error ? <Message negative size="small" onDismiss={() => setError(null)}>{error}</Message> : null}
      {invalid.length ? <Message warning>{c.invalid(invalid.length)}</Message> : null}

      {adminToken ? (
        <>
          <Segment>
            {rules.length === 0 ? <p style={{ color: '#888' }}>{c.empty}</p> : (
              <List divided relaxed>
                {rules.map((rule, i) => {
                  const broken = brokenOf(rule.id, i);
                  const usage = usageOf(rule.id);
                  return (
                    <List.Item key={`${rule.id}-${i}`}>
                      <List.Content floated="right">
                        <Checkbox
                          toggle
                          checked={rule.enabled !== false}
                          label={rule.enabled !== false ? c.enabled : c.disabled}
                          onChange={(e, d) => {
                            setRules((list) => list.map((r, j) => (j === i ? Object.assign({}, r, { enabled: !!d.checked }) : r)));
                            setDirty(true);
                          }}
                        />
                        <Button
                          basic
                          size="mini"
                          style={{ marginLeft: '0.75em' }}
                          onClick={() => {
                            setRules((list) => list.filter((_, j) => j !== i));
                            setDirty(true);
                          }}
                        >
                          {c.remove}
                        </Button>
                      </List.Content>
                      <List.Header>
                        <Label size="tiny" color={rule.action === 'decline' ? 'red' : 'green'}>{c.actions[rule.action] || rule.action}</Label>{' '}
                        {rule.label || rule.id}
                      </List.Header>
                      <List.Description>
                        {describeRule(rule)}
                        {usage ? <div style={{ color: '#888', fontSize: '0.85em' }}>{c.usage(usage.daySats || 0, usage.hourCount || 0)}</div> : null}
                        {broken ? <div style={{ color: '#9f3a38', fontSize: '0.9em' }}>{broken.error}</div> : null}
                      </List.Description>
                    </List.Item>
                  );
                })}
              </List>
            )}
            <Button primary disabled={!dirty || busy} loading={busy} onClick={() => void save()}>
              {c.save}
            </Button>
          </Segment>

          <Segment>
            <Header as="h3">{c.presetsTitle}</Header>
            <Form>
              <Header as="h4">{c.presets.signIn}</Header>
              <p style={{ color: '#666' }}>{c.presets.signInHint}</p>
              <Form.TextArea rows={2} label={c.fields.origins} value={origins} onChange={(e, d) => setOrigins(d.value)} />
              <Button
                size="small"
                disabled={!lines(origins).length}
                onClick={() => {
                  add({ action: 'sign', scope: 'passport', label: c.presets.signIn, from: 'identity-linked', origins: lines(origins) });
                  setOrigins('');
                }}
              >
                {c.add}
              </Button>

              <Header as="h4">{c.presets.spend}</Header>
              <p style={{ color: '#666' }}>{c.presets.spendHint}</p>
              <Form.Group widths="equal">
                <Form.Input label={c.fields.maxAmountSats} type="number" min="1" value={maxAmount} onChange={(e, d) => setMaxAmount(d.value)} />
                <Form.Input label={c.fields.dailyLimitSats} type="number" min="1" value={dailyLimit} onChange={(e, d) => setDailyLimit(d.value)} />
              </Form.Group>
              <Form.TextArea rows={2} label={c.fields.destinations} value={destinations} onChange={(e, d) => setDestinations(d.value)} />
              <Button
                size="small"
                disabled={!(Number(maxAmount) > 0) || !lines(destinations).length}
                onClick={() => {
                  const rule = {
                    action: 'sign',
                    scope: 'federation',
                    label: c.presets.spend,
                    from: 'identity-linked',
                    maxAmountSats: Math.floor(Number(maxAmount)),
                    destinations: lines(destinations)
                  };
                  if (Number(dailyLimit) > 0) rule.dailyLimitSats = Math.floor(Number(dailyLimit));
                  add(rule);
                  setMaxAmount('');
                  setDestinations('');
                  setDailyLimit('');
                }}
              >
                {c.add}
              </Button>

              <Header as="h4">{c.presets.accept}</Header>
              <p style={{ color: '#666' }}>{c.presets.acceptHint}</p>
              <Button
                size="small"
                onClick={() => add({ action: 'sign', scope: 'federation', label: c.presets.accept, from: 'identity-linked' })}
              >
                {c.add}
              </Button>
            </Form>
          </Segment>

          <Segment>
            <Header as="h3">{c.decisionsTitle}</Header>
            {decisions.length === 0 ? <p style={{ color: '#888' }}>{c.decisionsEmpty}</p> : (
              <List divided>
                {decisions.map((d, i) => (
                  <List.Item key={`${d.at}-${i}`}>
                    <List.Content>
                      <strong>{c.decision[d.action] || d.action}</strong>{' '}
                      {d.title || c.scopes[d.scope] || d.scope}{' '}
                      <span style={{ color: '#888' }}>
                        {d.rule ? c.byRule(d.rule) : (d.action === 'notify' ? '' : c.byYou)}
                        {' · '}
                        {new Date(d.at).toLocaleString()}
                      </span>
                    </List.Content>
                  </List.Item>
                ))}
              </List>
            )}
          </Segment>
        </>
      ) : null}
    </Segment>
  );
}

module.exports = SignerRulesHome;
