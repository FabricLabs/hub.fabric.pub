'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Label, List, Message, Segment } = require('semantic-ui-react');
const { browserContractsClient } = require('../functions/hubContractsBrowser');
const { federationSummary } = require('../functions/federationView');
const { loginWithPassportAny } = require('../functions/passportSiteLogin');
const { PASSPORT_SESSION_EVENT } = require('../functions/passportSession');
const t = require('../locales/en');

const c = t.federation.yours;
const named = t.federation.named;

/**
 * Sign in again with Passport, asking for the cosigner key.
 * @param {{ onSignedIn?: Function, primary?: boolean }} props
 */
function CosignerSignIn (props) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const run = async () => {
    if (typeof window === 'undefined') return;
    setBusy(true);
    setError(null);
    try {
      const r = await loginWithPassportAny({ window, request: ['cosigner'], purpose: c.purpose });
      if (!r.ok) {
        if (r.error === 'cancelled') return;
        if (r.error === 'passport_missing') throw new Error(c.passportMissing);
        if (r.error === 'passport_outdated') throw new Error(c.passportOutdated);
        throw new Error(c.signInFailed(r.error === 'rejected' ? '' : r.error));
      }
      if (!r.session || !r.session.cosigner) throw new Error(c.stillNoCosigner);
      if (props.onSignedIn) props.onSignedIn(r.session);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {error ? <Message negative size="small">{error}</Message> : null}
      <Button type="button" primary={props.primary !== false} size="small" loading={busy} disabled={busy} onClick={run}>
        <Icon name="key" aria-hidden="true" />
        {busy ? c.signingIn : c.showMine}
      </Button>
    </div>
  );
}

/**
 * Federations the signed-in Passport member signs for (`GET /federations`).
 * @param {{ adminToken?: string }} props
 */
function YourFederations (props) {
  const adminToken = props && props.adminToken ? String(props.adminToken).trim() : '';
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [signedOut, setSignedOut] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    browserContractsClient(adminToken).listFederations()
      .then((r) => { if (live) { setData(r); setError(null); setSignedOut(false); } })
      .catch((e) => {
        if (!live) return;
        if (e && e.status === 404) { setSignedOut(true); setData(null); } else setError(e.message);
      });
    return () => { live = false; };
  }, [adminToken, tick]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(PASSPORT_SESSION_EVENT, bump);
    return () => window.removeEventListener(PASSPORT_SESSION_EVENT, bump);
  }, []);

  const role = data && data.viewer ? data.viewer.role : null;
  const list = data && Array.isArray(data.federations) ? data.federations : [];
  return (
    <Segment style={{ borderRadius: 10 }} aria-labelledby="your-federations-heading">
      <Header as="h3" id="your-federations-heading" style={{ marginTop: 0 }}>
        <Icon name="key" color="teal" aria-hidden="true" />
        {c.title}
      </Header>
      <p style={{ color: '#555', lineHeight: 1.45 }}>{c.intro}</p>
      {error ? <Message negative size="small">{c.loadFailed(error)}</Message> : null}
      {!data && !error && !signedOut ? <p>{c.loading}</p> : null}
      {signedOut ? <Message info size="small">{c.signedOut}</Message> : null}
      {role === 'signedIn' ? (
        <div>
          <p style={{ color: '#555' }}>{c.needCosigner}</p>
          <CosignerSignIn onSignedIn={() => setTick((n) => n + 1)} />
        </div>
      ) : null}
      {role === 'member' || role === 'operator' ? (
        list.length ? (
          <List divided relaxed>
            {list.map((f) => {
              const s = federationSummary(f);
              return (
                <List.Item key={f.id}>
                  <List.Content floated="right">
                    <Button as={Link} to={s.href} size="small" basic>{named.open}</Button>
                  </List.Content>
                  <List.Content>
                    <List.Header as={Link} to={s.href}>
                      {s.title}{' '}
                      {s.status ? (
                        <Label size="tiny" color={s.status === 'active' ? 'green' : (s.status === 'declined' ? 'red' : 'yellow')}>
                          {named.status[s.status] || s.status}
                        </Label>
                      ) : null}
                    </List.Header>
                    <List.Description>
                      {named.policy(f.threshold, (f.validators || []).length)}
                      {s.network ? <span>{' · '}{s.network}</span> : null}
                    </List.Description>
                  </List.Content>
                </List.Item>
              );
            })}
          </List>
        ) : <p style={{ color: '#666' }}>{c.none}</p>
      ) : null}
    </Segment>
  );
}

YourFederations.CosignerSignIn = CosignerSignIn;

module.exports = YourFederations;
