'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Form,
  Header,
  Icon,
  List,
  Message,
  Segment,
  TextArea
} = require('semantic-ui-react');

const KNOWN_FEDERATIONS = [
  require('../contracts/beaconFederation'),
  require('../contracts/liquid')
];

async function hubRpc (method, params) {
  const res = await fetch(`${typeof window !== 'undefined' ? window.location.origin : ''}/services/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  let body = {};
  try {
    body = await res.json();
  } catch (_) {
    throw new Error('Hub returned non-JSON');
  }
  if (!res.ok || body.error) {
    throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
  }
  return body.result;
}

function SettingsFederationHome (props) {
  const adminToken = props && props.adminToken ? String(props.adminToken).trim() : '';
  const [validatorsText, setValidatorsText] = React.useState('');
  const [threshold, setThreshold] = React.useState('1');
  const [source, setSource] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState(null);
  const [saveError, setSaveError] = React.useState(null);
  const [saveOk, setSaveOk] = React.useState(null);
  const [federationFs, setFederationFs] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setLoadError(null);
    try {
      const r = await hubRpc('GetDistributedFederationPolicy', []);
      const src = r && r.source ? String(r.source) : '';
      setSource(src);
      const v = (r && Array.isArray(r.validators)) ? r.validators : [];
      setValidatorsText(v.join('\n'));
      const thr = r && r.threshold != null ? String(r.threshold) : '1';
      setThreshold(thr);
      setFederationFs(r && r.filesystem && typeof r.filesystem === 'object' ? r.filesystem : null);
    } catch (e) {
      setFederationFs(null);
      setLoadError(e && e.message ? e.message : String(e));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    setSaveError(null);
    setSaveOk(null);
    if (!adminToken) {
      setSaveError('Admin token required (complete hub setup and keep the token in this browser).');
      return;
    }
    const lines = validatorsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    let thr = Number(threshold);
    if (!Number.isFinite(thr) || thr < 1) thr = 1;
    if (lines.length && thr > lines.length) thr = lines.length;
    setBusy(true);
    try {
      const r = await hubRpc('SetDistributedFederationPolicy', [{
        validators: lines,
        threshold: thr,
        adminToken
      }]);
      if (r && r.status === 'error') {
        setSaveError(r.message || 'Save failed');
        return;
      }
      setSaveOk('Federation policy saved. Beacon and sidechain checks use the new validator set when env does not override.');
      void refresh();
    } catch (e) {
      setSaveError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Segment style={{ maxWidth: 720, margin: '1em auto' }}>
      <Button as={Link} to="/settings" basic size="small" style={{ marginBottom: '1em' }} aria-label="Back to settings">
        <Icon name="arrow left" aria-hidden="true" />
        Settings
      </Button>
      <Header as="h2" id="settings-federation-heading">
        <Icon name="users" aria-hidden="true" />
        <Header.Content>Distributed federation</Header.Content>
      </Header>
      <p style={{ color: '#666', marginBottom: '1em', maxWidth: '40rem', lineHeight: 1.45 }}>
        Validator public keys (compressed secp256k1 hex) and signature threshold for sidechain patches and beacon epochs.
        When <code>FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS</code> is set on the Hub process, it overrides this store — unset it to manage policy here.
        {source ? (
          <span> Current source: <strong>{source}</strong>.</span>
        ) : null}
      </p>
      <p style={{ color: '#666', marginBottom: '1em', maxWidth: '40rem', lineHeight: 1.45, fontSize: '0.95em' }}>
        <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>
        {' — '}L1 binding of <code>BEACON_EPOCH</code>, canonical signing strings, and k-of-n witness verification (operators).
        {' '}
        <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">GET manifest</a>
        {' · '}
        <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">GET epoch</a>
        {' · '}
        <a href="/services/distributed/federation-registry" target="_blank" rel="noopener noreferrer">federation registry</a>
        {federationFs ? (
          <span style={{ display: 'block', marginTop: '0.5em' }}>
            On-chain registry mirror (this node):{' '}
            <strong>{Number(federationFs.registryEntryCount) || 0}</strong>
            {' '}entr{Number(federationFs.registryEntryCount) === 1 ? 'y' : 'ies'}
            {federationFs.lastScannedHeight != null && Number.isFinite(Number(federationFs.lastScannedHeight))
              ? (
                <span>
                  {', '}last L1 scan height <strong>{Number(federationFs.lastScannedHeight)}</strong>
                </span>
                )
              : ', last L1 scan height —'}
            {federationFs.registryDocument ? (
              <span style={{ color: '#888', fontSize: '0.92em' }}>
                {' '}(<code>{String(federationFs.registryDocument)}</code>)
              </span>
            ) : null}
          </span>
        ) : null}
      </p>
      <Header as="h3" style={{ marginTop: '1.25em' }}>Federations</Header>
      <p style={{ color: '#666', marginBottom: '0.75em', maxWidth: '40rem', lineHeight: 1.45, fontSize: '0.95em' }}>
        Reference entries: this hub’s <strong>Beacon Federation</strong> (epochs, vault, HTTP discovery) and public L2 examples (e.g. Liquid peg script). Independent of the validator list below, which configures <em>this</em> hub.
      </p>
      {KNOWN_FEDERATIONS.map((fed) => {
        const id = fed && fed.id ? String(fed.id) : 'unknown';
        const name = fed && fed.name ? String(fed.name) : id;
        const urls = fed && fed.urls ? fed.urls : {};
        const refLinks = Array.isArray(fed.links) ? fed.links : [];
        const l1 = fed && fed.l1Bitcoin ? fed.l1Bitcoin : {};
        const gov = fed && fed.governanceFederation ? fed.governanceFederation : {};
        const watch = fed && fed.fedpegWatchmen && Array.isArray(fed.fedpegWatchmen.compressedSecp256k1PubkeysHex)
          ? fed.fedpegWatchmen.compressedSecp256k1PubkeysHex
          : [];
        const highlights = Array.isArray(gov.highlightMemberOrganizations) ? gov.highlightMemberOrganizations : [];
        const desc = fed && typeof fed.description === 'string' ? fed.description.trim() : '';
        return (
          <Segment key={id} secondary style={{ marginBottom: '1em' }}>
            <Header as="h4" style={{ marginTop: 0 }}>
              {name}
              <span style={{ color: '#888', fontWeight: 'normal', marginLeft: '0.35em' }}>
                ({fed && fed.networkId ? String(fed.networkId) : '—'})
              </span>
            </Header>
            {desc ? (
              <p style={{ color: '#555', fontSize: '0.92em', lineHeight: 1.45, marginBottom: '0.75em' }}>{desc}</p>
            ) : null}
            <List relaxed>
              {refLinks.length > 0 ? (
                <List.Item>
                  <List.Icon name="linkify" />
                  <List.Content>
                    {refLinks.map((L, i) => {
                      const label = L && L.label ? String(L.label) : 'Link';
                      const el = L && L.to ? (
                        <Link key={i} to={String(L.to)}>{label}</Link>
                      ) : L && L.href ? (
                        <a
                          key={i}
                          href={String(L.href)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {label}
                        </a>
                      ) : null;
                      if (!el) return null;
                      return (
                        <span key={i}>
                          {i > 0 ? ' · ' : null}
                          {el}
                        </span>
                      );
                    })}
                  </List.Content>
                </List.Item>
              ) : null}
              {urls.homepage ? (
                <List.Item>
                  <List.Icon name="linkify" />
                  <List.Content>
                    <a href={urls.homepage} target="_blank" rel="noopener noreferrer">Site</a>
                    {urls.federation ? (
                      <span>
                        {' · '}
                        <a href={urls.federation} target="_blank" rel="noopener noreferrer">Federation roster</a>
                      </span>
                    ) : null}
                    {urls.docs ? (
                      <span>
                        {' · '}
                        <a href={urls.docs} target="_blank" rel="noopener noreferrer">Docs</a>
                      </span>
                    ) : null}
                  </List.Content>
                </List.Item>
              ) : null}
              {l1.fedpegScriptHex ? (
                <List.Item>
                  <List.Icon name="bitcoin" />
                  <List.Content>
                    <strong>Bitcoin L1 fedpeg script (hex, {String(l1.fedpegScriptHex).length} chars)</strong>
                    {' — '}
                    <code style={{ fontSize: '10px', wordBreak: 'break-all' }} title={l1.fedpegScriptHex}>
                      {l1.fedpegScriptHex.slice(0, 28)}…
                    </code>
                    {l1.peginMinDepthBlocks != null ? (
                      <span style={{ color: '#666', marginLeft: '0.5em' }}>
                        peg-in min depth {l1.peginMinDepthBlocks} blocks
                      </span>
                    ) : null}
                  </List.Content>
                </List.Item>
              ) : null}
              {watch.length ? (
                <List.Item>
                  <List.Icon name="key" />
                  <List.Content>
                    <strong>L1 script pubkeys</strong>
                    {' — '}
                    {watch.length} compressed secp256k1 keys in the Elements fedpeg script (
                    <a href={urls.elementsChainparamsSource || urls.helpFederation} target="_blank" rel="noopener noreferrer">source</a>
                    ).
                  </List.Content>
                </List.Item>
              ) : null}
              {highlights.length ? (
                <List.Item>
                  <List.Icon name="users" />
                  <List.Content>
                    <strong>Example governance members</strong> (non-exhaustive; see roster link):{' '}
                    {highlights.join(', ')}.
                  </List.Content>
                </List.Item>
              ) : null}
              {l1.notes ? (
                <List.Item>
                  <List.Icon name="info circle" />
                  <List.Content style={{ color: '#555', fontSize: '0.92em' }}>{l1.notes}</List.Content>
                </List.Item>
              ) : null}
            </List>
          </Segment>
        );
      })}
      {loadError ? (
        <Message negative>
          <Message.Header>Could not load policy</Message.Header>
          <p>{loadError}</p>
        </Message>
      ) : null}
      {saveError ? (
        <Message negative onDismiss={() => setSaveError(null)}>
          <Message.Header>Save failed</Message.Header>
          <p>{saveError}</p>
        </Message>
      ) : null}
      {saveOk ? (
        <Message success onDismiss={() => setSaveOk(null)}>
          <Message.Header>Saved</Message.Header>
          <p>{saveOk}</p>
        </Message>
      ) : null}
      <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Form.Field>
          <label htmlFor="federation-validators-input">Validator pubkeys (one per line or comma-separated)</label>
          <TextArea
            id="federation-validators-input"
            value={validatorsText}
            onChange={(e, { value }) => setValidatorsText(value)}
            rows={6}
            placeholder="02… or 03…"
          />
        </Form.Field>
        <Form.Field>
          <label htmlFor="federation-threshold-input">Threshold (M-of-N)</label>
          <Form.Input
            id="federation-threshold-input"
            type="number"
            min={1}
            value={threshold}
            onChange={(e, { value }) => setThreshold(value)}
          />
        </Form.Field>
        <Button type="submit" primary disabled={busy || source === 'env'} loading={busy}>
          Save federation policy
        </Button>
      </Form>
    </Segment>
  );
}

module.exports = SettingsFederationHome;
