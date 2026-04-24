'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Container,
  Form,
  Grid,
  Header,
  Icon,
  Label,
  List,
  Message,
  Segment,
  Step
} = require('semantic-ui-react');
const { hubJsonRpc } = require('../functions/hubJsonRpc');
const { fetchDistributedHubPolicy } = require('../functions/distributedManifestClient');
const DistributedFederationPanel = require('./DistributedFederationPanel');
const FederationSpendingCriteriaDraft = require('./FederationSpendingCriteriaDraft');
const FederationCoSignerSessionPanel = require('./FederationCoSignerSessionPanel');

const KNOWN_FEDERATIONS = [
  require('../contracts/beaconFederation'),
  require('../contracts/liquid')
];

const PUBKEY_RE = /^0[23][0-9a-fA-F]{64}$/;

function normalizePubkeyRows (rows) {
  return rows.map((s) => String(s || '').trim()).filter(Boolean);
}

/**
 * @param {{ adminToken?: string, settingsLayout?: boolean }} props
 */
function FederationsHome (props) {
  const adminToken = props && props.adminToken ? String(props.adminToken).trim() : '';
  const settingsLayout = !!(props && props.settingsLayout);

  const [validatorRows, setValidatorRows] = React.useState(['']);
  const [threshold, setThreshold] = React.useState('1');
  const [source, setSource] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState(null);
  const [saveError, setSaveError] = React.useState(null);
  const [saveOk, setSaveOk] = React.useState(null);
  const [federationFs, setFederationFs] = React.useState(null);
  const [hubKeyBusy, setHubKeyBusy] = React.useState(false);
  const [hubKeyMsg, setHubKeyMsg] = React.useState(null);
  const [collabGroupId, setCollabGroupId] = React.useState('');
  const [collabGroupName, setCollabGroupName] = React.useState('Federation validators');
  const [collabBusy, setCollabBusy] = React.useState(false);
  const [collabMsg, setCollabMsg] = React.useState('');
  const [collabErr, setCollabErr] = React.useState('');

  const refresh = React.useCallback(async () => {
    setLoadError(null);
    try {
      const r = await hubJsonRpc('GetDistributedFederationPolicy', []);
      const src = r && r.source ? String(r.source) : '';
      setSource(src);
      const v = (r && Array.isArray(r.validators)) ? r.validators.map((x) => String(x).trim()).filter(Boolean) : [];
      setValidatorRows(v.length ? [...v] : ['']);
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

  const normalizedKeys = normalizePubkeyRows(validatorRows);
  const n = normalizedKeys.length;
  let thrNum = Number(threshold);
  if (!Number.isFinite(thrNum) || thrNum < 1) thrNum = 1;
  if (n && thrNum > n) thrNum = n;
  const invalidKeys = normalizedKeys.filter((k) => !PUBKEY_RE.test(k));
  const mOfNLabel = n ? `${thrNum}-of-${n}` : '—';

  const addRow = () => setValidatorRows((rows) => [...rows, '']);
  const removeRow = (index) => {
    setValidatorRows((rows) => {
      const next = rows.filter((_, i) => i !== index);
      return next.length ? next : [''];
    });
  };
  const setRow = (index, value) => {
    setValidatorRows((rows) => {
      const next = [...rows];
      next[index] = value;
      return next;
    });
  };

  const includeHubValidator = async () => {
    setHubKeyMsg(null);
    setHubKeyBusy(true);
    try {
      const { manifest } = await fetchDistributedHubPolicy();
      const pk = manifest && manifest.hubFabricPeerId ? String(manifest.hubFabricPeerId).trim() : '';
      if (!pk) {
        setHubKeyMsg('Manifest did not include hubFabricPeerId.');
        return;
      }
      if (!PUBKEY_RE.test(pk)) {
        setHubKeyMsg('Hub id from manifest is not a compressed secp256k1 hex pubkey.');
        return;
      }
      const lower = pk.toLowerCase();
      setValidatorRows((rows) => {
        const cur = normalizePubkeyRows(rows);
        if (cur.some((k) => k.toLowerCase() === lower)) return rows;
        return [...cur, pk];
      });
      setHubKeyMsg('Added this hub’s validator pubkey from the distributed manifest.');
    } catch (e) {
      setHubKeyMsg(e && e.message ? e.message : String(e));
    } finally {
      setHubKeyBusy(false);
    }
  };

  const saveCollaborationGroupFromFederation = async () => {
    setCollabErr('');
    setCollabMsg('');
    if (!adminToken) {
      setCollabErr('Admin token required (complete hub setup and keep the token in this browser).');
      return;
    }
    const lines = normalizePubkeyRows(validatorRows);
    if (lines.length === 0) {
      setCollabErr('Add at least one validator public key.');
      return;
    }
    if (lines.some((k) => !PUBKEY_RE.test(k))) {
      setCollabErr('Each validator must be a 33-byte compressed secp256k1 public key (66 hex chars, prefix 02 or 03).');
      return;
    }
    let thr = Number(threshold);
    if (!Number.isFinite(thr) || thr < 1) thr = 1;
    if (thr > lines.length) thr = lines.length;
    setCollabBusy(true);
    try {
      const payload = {
        validators: lines,
        threshold: thr,
        adminToken
      };
      const gid = String(collabGroupId || '').trim();
      if (gid) payload.groupId = gid;
      const nm = String(collabGroupName || '').trim();
      if (nm) payload.name = nm;
      const r = await hubJsonRpc('UpsertCollaborationGroupFromFederationValidators', [payload]);
      if (r && r.status === 'error') {
        setCollabErr(r.message || 'Collaboration group sync failed.');
        return;
      }
      const id = r && r.groupId ? String(r.groupId) : '';
      const updated = !!(r && r.updated);
      setCollabMsg(
        updated
          ? `Updated collaboration group ${id} to match this federation signer set.`
          : `Created collaboration group ${id} from this federation signer set.`
      );
    } catch (e) {
      setCollabErr(e && e.message ? e.message : String(e));
    } finally {
      setCollabBusy(false);
    }
  };

  const save = async () => {
    setSaveError(null);
    setSaveOk(null);
    if (!adminToken) {
      setSaveError('Admin token required (complete hub setup and keep the token in this browser).');
      return;
    }
    const lines = normalizePubkeyRows(validatorRows);
    if (lines.length === 0) {
      setSaveError('Add at least one validator public key.');
      return;
    }
    if (lines.some((k) => !PUBKEY_RE.test(k))) {
      setSaveError('Each validator must be a 33-byte compressed secp256k1 public key (66 hex chars, prefix 02 or 03).');
      return;
    }
    let thr = Number(threshold);
    if (!Number.isFinite(thr) || thr < 1) thr = 1;
    if (thr > lines.length) thr = lines.length;
    setBusy(true);
    try {
      const r = await hubJsonRpc('SetDistributedFederationPolicy', [{
        validators: lines,
        threshold: thr,
        adminToken
      }]);
      if (r && r.status === 'error') {
        setSaveError(r.message || 'Save failed');
        return;
      }
      setSaveOk('Federation policy saved. Sidechain patches and beacon epochs use this M-of-N set when env does not override.');
      void refresh();
    } catch (e) {
      setSaveError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const backTo = settingsLayout ? '/settings' : '/';
  const backLabel = settingsLayout ? 'Settings' : 'Home';
  const headingId = settingsLayout ? 'settings-federation-heading' : 'federations-page-heading';
  const title = settingsLayout ? 'Distributed federation' : 'Federations';
  const maxWidth = settingsLayout ? 720 : 980;

  return (
    <Container style={{ maxWidth, margin: '1em auto 2em', padding: '0 0.75em' }}>
      <Button as={Link} to={backTo} basic size="small" style={{ marginBottom: '1em' }} aria-label={`Back to ${backLabel}`}>
        <Icon name="arrow left" aria-hidden="true" />
        {backLabel}
      </Button>

      <Segment
        raised
        style={{
          marginBottom: '1.25em',
          boxShadow: '0 2px 16px rgba(34, 36, 38, 0.08)',
          border: '1px solid rgba(34, 36, 38, 0.08)'
        }}
      >
        <Header as={settingsLayout ? 'h2' : 'h1'} id={headingId} style={{ marginTop: 0 }}>
          <Icon name="users" aria-hidden="true" color="blue" />
          <Header.Content>
            {title}
            {!settingsLayout ? (
              <Header.Subheader style={{ marginTop: '0.35em', fontWeight: 400, color: '#666' }}>
                Create a small <strong>shared control group</strong> for this hub: you pick who can co-sign, and how many signatures are needed (M-of-N).
                That powers safer sidechain updates and beacon checkpoints, and gives you a <strong>shared Bitcoin vault address</strong> for treasury funds.
              </Header.Subheader>
            ) : null}
          </Header.Content>
        </Header>

        {!settingsLayout ? (
          <Step.Group fluid size="small" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
            <Step active>
              <Icon name="add user" />
              <Step.Content>
                <Step.Title>Who signs</Step.Title>
                <Step.Description>Paste each co-owner’s public key (one row per person)</Step.Description>
              </Step.Content>
            </Step>
            <Step active>
              <Icon name="balance scale" />
              <Step.Content>
                <Step.Title>How many agree</Step.Title>
                <Step.Description>Pick M-of-N (e.g. 2-of-3 needs two signatures)</Step.Description>
              </Step.Content>
            </Step>
            <Step active>
              <Icon name="save" />
              <Step.Content>
                <Step.Title>Save on hub</Step.Title>
                <Step.Description>Operator token applies this group to this hub</Step.Description>
              </Step.Content>
            </Step>
          </Step.Group>
        ) : null}

        <p style={{ color: '#666', marginBottom: 0, maxWidth: '48rem', lineHeight: 1.5 }}>
          Each signer shares a <strong>33-byte hex public key</strong> (starts with <code>02</code> or <code>03</code>) — not a secret.
          Together they form an M-of-N <strong>multisig policy</strong> for this hub’s distributed features and on-chain vault.
          When <code>FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS</code> is set on the server, it overrides what you save here.
          {source ? (
            <span> Current source: <strong>{source}</strong>.</span>
          ) : null}
        </p>
        {settingsLayout ? (
          <p style={{ margin: '0.75em 0 0', fontSize: '0.95em' }}>
            <Link to="/federations">Open full Federations workspace</Link>
            {' '}(wider layout, same controls).
          </p>
        ) : null}
        <FederationSpendingCriteriaDraft />
        <Message info size="small" style={{ marginTop: '0.75em' }}>
          <Message.Header>Hub alerts vs activity</Message.Header>
          <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
            <Link to="/notifications">Notifications</Link> lists wallet and Payjoin toasts (same as the bell). The full hub message log, chat, and Bitcoin blocks are on the{' '}
            <Link to="/activities">activity log</Link>. Federation-related group chat may appear on this page when you hold a member key; hub-wide chat still mirrors the activity log.
          </p>
        </Message>
        {props.bridgeRef ? (
          <FederationCoSignerSessionPanel
            bridgeRef={props.bridgeRef}
            validatorRows={validatorRows}
            setValidatorRows={setValidatorRows}
            normalizePubkeyRows={normalizePubkeyRows}
            threshold={threshold}
            PUBKEY_RE={PUBKEY_RE}
          />
        ) : null}
      </Segment>

      <DistributedFederationPanel marginBottom="1.25em" />

      <Grid stackable>
        <Grid.Column computer={10}>
          <Segment style={{ borderRadius: 10 }}>
            <Header as="h3" style={{ marginTop: 0 }}>
              <Icon name="shield alternate" color="teal" />
              Multi-sig contract (this hub)
            </Header>
            <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '1rem' }}>
              After you save, the hub uses this signer set for <strong>sidechain updates</strong>, <strong>beacon checkpoints</strong>, and the{' '}
              <strong>Taproot federation vault</strong> address. Co-signers keep private keys off this UI; they only share pubkeys here.
              To pay from the vault, use <Link to="/services/bitcoin/transactions?scope=wallet#fabric-federation-wallet-panel">Wallet → Federation multisig</Link>{' '}
              to build a PSBT. For day-to-day hub wallet sends, you can still tag payments with your optional spending criteria (checkbox on that page).
              Invite peers from <Link to="/peers">Peers</Link> when you are ready to coordinate.
            </p>

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

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75em', marginBottom: '1rem' }}>
              <Label color="blue" size="large" style={{ fontFamily: 'monospace' }}>
                {mOfNLabel}
              </Label>
              <Button
                type="button"
                size="small"
                basic
                icon
                labelPosition="left"
                loading={hubKeyBusy}
                disabled={hubKeyBusy || source === 'env'}
                onClick={() => void includeHubValidator()}
              >
                <Icon name="plus" />
                Include this hub’s pubkey
              </Button>
              <Button type="button" size="small" basic icon labelPosition="left" onClick={() => void refresh()}>
                <Icon name="refresh" />
                Reload from hub
              </Button>
            </div>
            {hubKeyMsg ? (
              <Message info size="small" onDismiss={() => setHubKeyMsg(null)} style={{ marginTop: 0 }}>
                {hubKeyMsg}
              </Message>
            ) : null}

            <Message info size="small" style={{ marginTop: '0.85em' }}>
              <Message.Header>Collaboration group (same signer set)</Message.Header>
              <p style={{ margin: '0.35em 0 0.65em', lineHeight: 1.45 }}>
                Mirror these federation validators into a <Link to="/settings/collaboration">Collaboration</Link> group
                so invitations, previews, and the federation vault stay aligned on one pubkey list and threshold.
              </p>
              {collabErr ? (
                <Message negative size="small" onDismiss={() => setCollabErr('')} style={{ marginBottom: '0.65em' }}>
                  {collabErr}
                </Message>
              ) : null}
              {collabMsg ? (
                <Message success size="small" onDismiss={() => setCollabMsg('')} style={{ marginBottom: '0.65em' }}>
                  {collabMsg}{' '}
                  <Link to="/settings/collaboration">Open Collaboration</Link>.
                </Message>
              ) : null}
              <Form.Field>
                <label htmlFor="fed-collab-group-id">Existing group id (optional — leave empty to create)</label>
                <Form.Input
                  id="fed-collab-group-id"
                  placeholder="grp_…"
                  value={collabGroupId}
                  onChange={(e, { value }) => setCollabGroupId(value != null ? String(value) : '')}
                  style={{ fontFamily: 'monospace', fontSize: '0.9em' }}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="fed-collab-group-name">New group name (when creating)</label>
                <Form.Input
                  id="fed-collab-group-name"
                  placeholder="Federation validators"
                  value={collabGroupName}
                  onChange={(e, { value }) => setCollabGroupName(value != null ? String(value) : '')}
                />
              </Form.Field>
              <Button
                type="button"
                size="small"
                color="teal"
                icon
                labelPosition="left"
                loading={collabBusy}
                disabled={collabBusy || !normalizedKeys.length || invalidKeys.length > 0}
                onClick={() => void saveCollaborationGroupFromFederation()}
              >
                <Icon name="users" />
                Save signer set to Collaboration group
              </Button>
            </Message>

            <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <Header as="h4">Signers</Header>
              {validatorRows.map((row, index) => (
                <Form.Field key={index}>
                  <label htmlFor={`fed-pk-${index}`}>Validator {index + 1}</label>
                  <div style={{ display: 'flex', gap: '0.35em', alignItems: 'stretch', flexWrap: 'wrap' }}>
                    <Form.Input
                      id={`fed-pk-${index}`}
                      fluid
                      placeholder="02… or 03… (66 hex chars)"
                      value={row}
                      onChange={(e, { value }) => setRow(index, value != null ? String(value) : '')}
                      style={{ flex: '1 1 16rem', minWidth: '12rem', fontFamily: 'monospace', fontSize: '0.9em' }}
                    />
                    <Button
                      type="button"
                      icon="trash"
                      basic
                      negative
                      disabled={validatorRows.length <= 1}
                      onClick={() => removeRow(index)}
                      aria-label={`Remove signer ${index + 1}`}
                    />
                  </div>
                </Form.Field>
              ))}
              <Button type="button" basic icon labelPosition="left" onClick={addRow} disabled={source === 'env'}>
                <Icon name="add" />
                Add signer
              </Button>

              {invalidKeys.length > 0 ? (
                <Message warning size="small" style={{ marginTop: '1em' }}>
                  {invalidKeys.length} entr{invalidKeys.length === 1 ? 'y' : 'ies'} do not match compressed pubkey hex (02/03 + 64 hex).
                </Message>
              ) : null}

              <Form.Field style={{ marginTop: '1.25em' }}>
                <label htmlFor="federation-threshold-input">Signature threshold (M-of-N)</label>
                <Form.Input
                  id="federation-threshold-input"
                  type="number"
                  min={1}
                  max={Math.max(1, n)}
                  value={threshold}
                  onChange={(e, { value }) => setThreshold(value)}
                  disabled={source === 'env'}
                  style={{ maxWidth: '8rem' }}
                />
              </Form.Field>

              <Button type="submit" primary size="large" disabled={busy || source === 'env'} loading={busy} style={{ marginTop: '0.5em' }}>
                <Icon name="save" />
                Save federation policy
              </Button>
            </Form>
          </Segment>

          <Segment style={{ marginTop: '1.25em' }}>
            <Header as="h3" style={{ marginTop: 0 }}>Discovery &amp; APIs</Header>
            <p style={{ color: '#666', fontSize: '0.95em', lineHeight: 1.45, marginBottom: '0.75em' }}>
              <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>
              {' — '}L1 binding of <code>BEACON_EPOCH</code> and witness verification.
              {' '}
              <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">GET manifest</a>
              {' · '}
              <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">GET epoch</a>
              {' · '}
              <a href="/services/distributed/federation-registry" target="_blank" rel="noopener noreferrer">Federation registry</a>
            </p>
            {federationFs ? (
              <p style={{ color: '#555', fontSize: '0.92em', lineHeight: 1.45 }}>
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
                  <span style={{ color: '#888' }}>
                    {' '}(<code>{String(federationFs.registryDocument)}</code>)
                  </span>
                ) : null}
              </p>
            ) : null}
          </Segment>
        </Grid.Column>

        <Grid.Column computer={6}>
          <Segment secondary style={{ position: 'sticky', top: '5.5rem' }}>
            <Header as="h4" style={{ marginTop: 0 }}>Reference federations</Header>
            <p style={{ color: '#666', fontSize: '0.9em', lineHeight: 1.45, marginBottom: '0.75em' }}>
              Examples and public rosters (read-only). Your hub policy above is independent.
            </p>
            {KNOWN_FEDERATIONS.map((fed) => {
              const id = fed && fed.id ? String(fed.id) : 'unknown';
              const name = fed && fed.name ? String(fed.name) : id;
              const urls = fed && fed.urls ? fed.urls : {};
              const desc = fed && typeof fed.description === 'string' ? fed.description.trim() : '';
              return (
                <Segment key={id} size="small" style={{ marginBottom: '0.65em' }}>
                  <Header as="h5" style={{ marginTop: 0 }}>
                    {name}
                    <span style={{ color: '#888', fontWeight: 'normal', marginLeft: '0.35em', fontSize: '0.9em' }}>
                      ({fed && fed.networkId ? String(fed.networkId) : '—'})
                    </span>
                  </Header>
                  {desc ? <p style={{ color: '#555', fontSize: '0.88em', lineHeight: 1.4, marginBottom: '0.5em' }}>{desc}</p> : null}
                  <List relaxed size="small">
                    {urls.homepage ? (
                      <List.Item
                        icon="linkify"
                        content={<a href={urls.homepage} target="_blank" rel="noopener noreferrer">Site</a>}
                      />
                    ) : null}
                    {urls.federation ? (
                      <List.Item
                        icon="users"
                        content={<a href={urls.federation} target="_blank" rel="noopener noreferrer">Roster</a>}
                      />
                    ) : null}
                  </List>
                </Segment>
              );
            })}
          </Segment>
        </Grid.Column>
      </Grid>
    </Container>
  );
}

module.exports = FederationsHome;
