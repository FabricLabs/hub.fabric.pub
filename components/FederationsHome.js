'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Container,
  Checkbox,
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
const DistributedFederationPanel = require('./DistributedFederationPanel');
const NamedFederationsPanel = require('./NamedFederationsPanel');
const FederationSpendingCriteriaDraft = require('./FederationSpendingCriteriaDraft');
const FederationCoSignerSessionPanel = require('./FederationCoSignerSessionPanel');
const t = require('../locales/en');

const fh = t.federation.federationsHome;
const shared = t.federation.shared;

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
  const [useBls, setUseBls] = React.useState(false);
  const [policyRevision, setPolicyRevision] = React.useState(0);
  const [source, setSource] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState(null);
  const [saveError, setSaveError] = React.useState(null);
  const [saveOk, setSaveOk] = React.useState(null);
  const [federationFs, setFederationFs] = React.useState(null);
  const [hubKeyBusy, setHubKeyBusy] = React.useState(false);
  const [hubKeyMsg, setHubKeyMsg] = React.useState(null);
  const [collabGroupId, setCollabGroupId] = React.useState('');
  const [collabGroupName, setCollabGroupName] = React.useState(fh.collabDefaultName);
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
      setUseBls(!!(r && r.signatureScheme === 'bls'));
      setFederationFs(r && r.filesystem && typeof r.filesystem === 'object' ? r.filesystem : null);
      setPolicyRevision((n) => n + 1);
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
  const mOfNLabel = n ? shared.mOfN(thrNum, n) : t.common.none;

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
      // The federation key is the Hub root key (what it signs attestations with), not its Fabric Peer id.
      const identity = await hubJsonRpc('GetHubIdentity', []);
      const pk = identity && identity.pubkey ? String(identity.pubkey).trim() : '';
      if (!pk) {
        setHubKeyMsg(fh.hubIdMissing);
        return;
      }
      if (!PUBKEY_RE.test(pk)) {
        setHubKeyMsg(fh.hubIdInvalid);
        return;
      }
      const lower = pk.toLowerCase();
      setValidatorRows((rows) => {
        const cur = normalizePubkeyRows(rows);
        if (cur.some((k) => k.toLowerCase() === lower)) return rows;
        return [...cur, pk];
      });
      setHubKeyMsg(fh.hubIdAdded);
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
      setCollabErr(t.common.errors.adminTokenRequired);
      return;
    }
    const lines = normalizePubkeyRows(validatorRows);
    if (lines.length === 0) {
      setCollabErr(fh.needValidator);
      return;
    }
    if (lines.some((k) => !PUBKEY_RE.test(k))) {
      setCollabErr(fh.invalidKey);
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
        setCollabErr(r.message || fh.collabFailed);
        return;
      }
      const id = r && r.groupId ? String(r.groupId) : '';
      const updated = !!(r && r.updated);
      setCollabMsg(
        updated
          ? fh.collabUpdated(id)
          : fh.collabCreated(id)
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
      setSaveError(t.common.errors.adminTokenRequired);
      return;
    }
    const lines = normalizePubkeyRows(validatorRows);
    if (lines.length === 0) {
      setSaveError(fh.needValidator);
      return;
    }
    if (lines.some((k) => !PUBKEY_RE.test(k))) {
      setSaveError(fh.invalidKey);
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
        signatureScheme: useBls ? 'bls' : 'schnorr',
        adminToken
      }]);
      if (r && r.status === 'error') {
        setSaveError(r.message || fh.saveFailed);
        return;
      }
      setSaveOk(fh.saved);
      void refresh();
    } catch (e) {
      setSaveError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const backTo = settingsLayout ? '/settings' : '/';
  const backLabel = settingsLayout ? shared.settings : shared.home;
  const headingId = settingsLayout ? 'settings-federation-heading' : 'federations-page-heading';
  const title = settingsLayout ? fh.titleSettings : fh.title;
  const maxWidth = settingsLayout ? 720 : 980;

  return (
    <Container style={{ maxWidth, margin: '1em auto 2em', padding: '0 0.75em' }}>
      <Button as={Link} to={backTo} basic size="small" style={{ marginBottom: '1em' }}>
        <Icon name="arrow left" aria-hidden="true" />
        {shared.backTo(backLabel)}
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
                {fh.subheader}
              </Header.Subheader>
            ) : null}
          </Header.Content>
        </Header>

        {!settingsLayout ? (
          <Step.Group fluid size="small" style={{ marginTop: '1rem', flexWrap: 'wrap' }} aria-label={fh.steps.label}>
            <Step active>
              <Icon name="add user" aria-hidden="true" />
              <Step.Content>
                <Step.Title>{fh.steps.who}</Step.Title>
                <Step.Description>{fh.steps.whoHelp}</Step.Description>
              </Step.Content>
            </Step>
            <Step active>
              <Icon name="balance scale" aria-hidden="true" />
              <Step.Content>
                <Step.Title>{fh.steps.howMany}</Step.Title>
                <Step.Description>{fh.steps.howManyHelp}</Step.Description>
              </Step.Content>
            </Step>
            <Step active>
              <Icon name="save" aria-hidden="true" />
              <Step.Content>
                <Step.Title>{fh.steps.save}</Step.Title>
                <Step.Description>{fh.steps.saveHelp}</Step.Description>
              </Step.Content>
            </Step>
          </Step.Group>
        ) : null}

        <p style={{ color: '#666', marginBottom: 0, maxWidth: '48rem', lineHeight: 1.5 }}>
          {fh.intro}{' '}
          {fh.envOverride}
          {source ? (
            <span>{' '}{fh.source(shared.policySource(source))}</span>
          ) : null}
        </p>
        {settingsLayout ? (
          <p style={{ margin: '0.75em 0 0', fontSize: '0.95em' }}>
            <Link to="/federations">{fh.openFull}</Link>
            {' '}{fh.openFullHint}
          </p>
        ) : null}
        <FederationSpendingCriteriaDraft />
        <Message info size="small" style={{ marginTop: '0.75em' }}>
          <Message.Header>{fh.alertsTitle}</Message.Header>
          <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
            <Link to="/notifications">{shared.links.notifications}</Link>{' '}{fh.alertsNotifications}{' '}
            {fh.alertsActivityBefore}{' '}
            <Link to="/activities">{fh.alertsActivityLink}</Link>.
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

      <NamedFederationsPanel adminToken={adminToken} />

      <DistributedFederationPanel marginBottom="1.25em" refreshToken={policyRevision} />

      <Grid stackable>
        <Grid.Column computer={10}>
          <Segment style={{ borderRadius: 10 }}>
            <Header as="h3" style={{ marginTop: 0 }}>
              <Icon name="shield alternate" color="teal" aria-hidden="true" />
              {fh.policyTitle}
            </Header>
            <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '1rem' }}>
              {fh.policyBody}{' '}
              {fh.policyVaultBefore}{' '}
              <Link to="/services/bitcoin/transactions?scope=wallet#fabric-federation-wallet-panel">{fh.policyVaultLink}</Link>.{' '}
              {fh.policyVaultAfter}{' '}
              {fh.policyPeersBefore}{' '}
              <Link to="/peers">{shared.links.peers}</Link>.
            </p>

            {loadError ? (
              <Message negative>
                <Message.Header>{fh.loadErrorTitle}</Message.Header>
                <p>{loadError}</p>
              </Message>
            ) : null}
            {saveError ? (
              <Message negative onDismiss={() => setSaveError(null)}>
                <Message.Header>{fh.saveErrorTitle}</Message.Header>
                <p>{saveError}</p>
              </Message>
            ) : null}
            {saveOk ? (
              <Message success onDismiss={() => setSaveOk(null)}>
                <Message.Header>{fh.savedTitle}</Message.Header>
                <p>{saveOk}</p>
              </Message>
            ) : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75em', marginBottom: '1rem' }}>
              <Label color="blue" size="large" style={{ fontFamily: 'monospace' }}>
                {mOfNLabel}
              </Label>
              {useBls ? (
                <Label color="purple" size="large">{fh.blsBadge}</Label>
              ) : null}
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
                <Icon name="plus" aria-hidden="true" />
                {fh.includeHub}
              </Button>
              <Button type="button" size="small" basic icon labelPosition="left" onClick={() => void refresh()}>
                <Icon name="refresh" aria-hidden="true" />
                {fh.reload}
              </Button>
            </div>
            {hubKeyMsg ? (
              <Message info size="small" onDismiss={() => setHubKeyMsg(null)} style={{ marginTop: 0 }}>
                {hubKeyMsg}
              </Message>
            ) : null}

            <Message info size="small" style={{ marginTop: '0.85em' }}>
              <Message.Header>{fh.collabTitle}</Message.Header>
              <p style={{ margin: '0.35em 0 0.65em', lineHeight: 1.45 }}>
                {fh.collabBefore}{' '}
                <Link to="/settings/collaboration">{shared.links.collaboration}</Link>{' '}
                {fh.collabAfter}
              </p>
              {collabErr ? (
                <Message negative size="small" onDismiss={() => setCollabErr('')} style={{ marginBottom: '0.65em' }}>
                  {collabErr}
                </Message>
              ) : null}
              {collabMsg ? (
                <Message success size="small" onDismiss={() => setCollabMsg('')} style={{ marginBottom: '0.65em' }}>
                  {collabMsg}{' '}
                  <Link to="/settings/collaboration">{fh.collabOpen}</Link>
                </Message>
              ) : null}
              <Form.Field>
                <label htmlFor="fed-collab-group-id">{fh.collabGroupId}</label>
                <Form.Input
                  id="fed-collab-group-id"
                  placeholder="grp_…"
                  value={collabGroupId}
                  onChange={(e, { value }) => setCollabGroupId(value != null ? String(value) : '')}
                  style={{ fontFamily: 'monospace', fontSize: '0.9em' }}
                />
              </Form.Field>
              <Form.Field>
                <label htmlFor="fed-collab-group-name">{fh.collabGroupName}</label>
                <Form.Input
                  id="fed-collab-group-name"
                  placeholder={fh.collabDefaultName}
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
                <Icon name="users" aria-hidden="true" />
                {fh.collabSave}
              </Button>
            </Message>

            <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <Header as="h4">{fh.signersTitle}</Header>
              {validatorRows.map((row, index) => (
                <Form.Field key={index}>
                  <label htmlFor={`fed-pk-${index}`}>{fh.validatorLabel(index + 1)}</label>
                  <div style={{ display: 'flex', gap: '0.35em', alignItems: 'stretch', flexWrap: 'wrap' }}>
                    <Form.Input
                      id={`fed-pk-${index}`}
                      fluid
                      placeholder={fh.validatorPlaceholder}
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
                      aria-label={fh.removeValidator(index + 1)}
                      title={fh.removeValidator(index + 1)}
                    />
                  </div>
                </Form.Field>
              ))}
              <Button type="button" basic icon labelPosition="left" onClick={addRow} disabled={source === 'env'}>
                <Icon name="add" aria-hidden="true" />
                {fh.addValidator}
              </Button>

              {invalidKeys.length > 0 ? (
                <Message warning size="small" style={{ marginTop: '1em' }}>
                  {fh.invalidCount(invalidKeys.length)}
                </Message>
              ) : null}

              <Form.Field style={{ marginTop: '1.25em' }}>
                <label htmlFor="federation-threshold-input">{fh.thresholdLabel}</label>
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

              <Form.Field>
                <Checkbox
                  id="federation-bls-signatures"
                  label={fh.useBls}
                  aria-describedby="federation-bls-help"
                  checked={useBls}
                  disabled={source === 'env'}
                  onChange={(e, data) => setUseBls(!!(data && data.checked))}
                />
                <p id="federation-bls-help" style={{ color: '#666', margin: '0.4em 0 0', maxWidth: '40rem', lineHeight: 1.45 }}>
                  {fh.blsHelp}
                </p>
              </Form.Field>

              <Button type="submit" primary size="large" disabled={busy || source === 'env'} loading={busy} style={{ marginTop: '0.5em' }}>
                <Icon name="save" aria-hidden="true" />
                {fh.save}
              </Button>
            </Form>
          </Segment>

          <Segment style={{ marginTop: '1.25em' }}>
            <Header as="h3" style={{ marginTop: 0 }}>{fh.relatedTitle}</Header>
            {federationFs ? (
              <p style={{ color: '#555', fontSize: '0.92em', lineHeight: 1.45 }}>
                {fh.registry(Number(federationFs.registryEntryCount) || 0)}{' '}
                {federationFs.lastScannedHeight != null && Number.isFinite(Number(federationFs.lastScannedHeight))
                  ? fh.registryHeight(Number(federationFs.lastScannedHeight))
                  : fh.registryNoHeight}
              </p>
            ) : null}
            <p style={{ color: '#666', fontSize: '0.95em', lineHeight: 1.45, marginBottom: 0 }}>
              <a href="/services/distributed/federation-registry" target="_blank" rel="noopener noreferrer">{shared.links.registry}</a>
            </p>
            {federationFs && federationFs.registryDocument ? (
              <details className="hub-developer-details" style={{ marginTop: '0.5em', fontSize: '0.85em', color: '#666' }}>
                <summary>{t.common.developerDetails}</summary>
                <code>{fh.registryDocument(String(federationFs.registryDocument))}</code>
              </details>
            ) : null}
          </Segment>
        </Grid.Column>

        <Grid.Column computer={6}>
          <section aria-labelledby="federations-reference-heading">
            <Segment secondary style={{ position: 'sticky', top: '5.5rem' }}>
              <Header as="h4" id="federations-reference-heading" style={{ marginTop: 0 }}>{fh.reference.title}</Header>
              <p style={{ color: '#666', fontSize: '0.9em', lineHeight: 1.45, marginBottom: '0.75em' }}>
                {fh.reference.intro}
              </p>
              {KNOWN_FEDERATIONS.map((fed) => {
                const id = fed && fed.id ? String(fed.id) : 'unknown';
                const name = fed && fed.name ? String(fed.name) : id;
                const urls = fed && fed.urls ? fed.urls : {};
                const desc = fh.reference.descriptions[id] || '';
                const networkLabel = id === 'beacon-federation'
                  ? fh.reference.thisHub
                  : (fed && fed.networkId ? String(fed.networkId) : t.common.none);
                const functionaries = fed && fed.governanceFederation ? fed.governanceFederation.functionaryOperatorCount : null;
                const pegDepth = fed && fed.l1Bitcoin ? fed.l1Bitcoin.peginMinDepthBlocks : null;
                return (
                  <Segment
                    key={id}
                    as="section"
                    size="small"
                    aria-label={fh.reference.region(name)}
                    style={{ marginBottom: '0.65em' }}
                  >
                    <Header as="h5" style={{ marginTop: 0 }}>
                      {name}
                      <span style={{ color: '#888', fontWeight: 'normal', marginLeft: '0.35em', fontSize: '0.9em' }}>
                        ({networkLabel})
                      </span>
                    </Header>
                    {desc ? <p style={{ color: '#555', fontSize: '0.88em', lineHeight: 1.4, marginBottom: '0.5em' }}>{desc}</p> : null}
                    {id === 'liquid' && functionaries != null && pegDepth != null ? (
                      <p style={{ color: '#555', fontSize: '0.88em', lineHeight: 1.4, marginBottom: '0.5em' }}>
                        {fh.reference.liquidSummary(functionaries, pegDepth)}
                      </p>
                    ) : null}
                    <List relaxed size="small">
                      {urls.homepage ? (
                        <List.Item
                          icon="linkify"
                          content={<a href={urls.homepage} target="_blank" rel="noopener noreferrer">{fh.reference.website(name)}</a>}
                        />
                      ) : null}
                      {urls.federation ? (
                        <List.Item
                          icon="users"
                          content={<a href={urls.federation} target="_blank" rel="noopener noreferrer">{fh.reference.members(name)}</a>}
                        />
                      ) : null}
                    </List>
                  </Segment>
                );
              })}
            </Segment>
          </section>
        </Grid.Column>
      </Grid>
    </Container>
  );
}

module.exports = FederationsHome;
