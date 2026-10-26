'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Checkbox,
  Header,
  Icon,
  List,
  Message,
  Segment
} = require('semantic-ui-react');
const { hubJsonRpc } = require('../functions/hubJsonRpc');
const { fetchDistributedHubPolicy, federationSummaryFromManifest } = require('../functions/distributedManifestClient');
const {
  loadFederationSpendingPrefs,
  mergePaymentMemoWithFederation,
  subscribeFederationSpendingPrefs
} = require('../functions/federationSpendingPrefs');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { copyToClipboard } = require('../functions/uiNotifications');
const FederationSpendingCriteriaDraft = require('./FederationSpendingCriteriaDraft');
const t = require('../locales/en');

const wm = t.federation.walletMultisig;

/**
 * Federation summary, shared vaults with other Hubs, and memo tagging for hub wallet sends.
 * @param {{
 *   adminToken?: string,
 *   recordFederationContext: boolean,
 * onRecordFederationContextChange: (v: boolean) => void,
 *   spendingPrefsTick?: number
 * }} props
 */
function FederationWalletMultisigPanel (props) {
  const adminToken = readHubAdminTokenFromBrowser(props && props.adminToken);
  const recordFed = !!(props && props.recordFederationContext);
  const onRecordChange = props && typeof props.onRecordFederationContextChange === 'function'
    ? props.onRecordFederationContextChange
    : () => {};

  const [policy, setPolicy] = React.useState(null);
  const [manifest, setManifest] = React.useState(null);
  const [vaultDetail, setVaultDetail] = React.useState(null);
  const [loadErr, setLoadErr] = React.useState(null);
  const [named, setNamed] = React.useState(null);
  const [prefs, setPrefs] = React.useState(() => loadFederationSpendingPrefs());
  const [collabHubSummary, setCollabHubSummary] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setLoadErr(null);
    const tok = readHubAdminTokenFromBrowser(props && props.adminToken);
    try {
      const [pol, dist, vaultJson] = await Promise.all([
        hubJsonRpc('GetDistributedFederationPolicy', []).catch((e) => {
          throw new Error(e && e.message ? e.message : String(e));
        }),
        fetchDistributedHubPolicy(),
        fetch('/services/distributed/vault', {
          headers: { Accept: 'application/json' }
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      setPolicy(pol && typeof pol === 'object' ? pol : null);
      setManifest(dist && dist.manifest ? dist.manifest : null);
      setVaultDetail(vaultJson && typeof vaultJson === 'object' ? vaultJson : null);
    } catch (e) {
      setPolicy(null);
      setManifest(null);
      setVaultDetail(null);
      setLoadErr(e && e.message ? e.message : String(e));
    }
    if (!tok) {
      setCollabHubSummary(null);
      setNamed(null);
    } else {
      try {
        const nf = await hubJsonRpc('ListNamedFederations', [{ adminToken: tok }]);
        setNamed(nf && nf.status !== 'error' && Array.isArray(nf.federations) ? nf.federations : null);
      } catch (_) {
        setNamed(null);
      }
      try {
        const lg = await hubJsonRpc('ListCollaborationGroups', [{ adminToken: tok }]);
        const groups = lg && Array.isArray(lg.groups) ? lg.groups : [];
        setCollabHubSummary({ n: groups.length });
      } catch (e) {
        setCollabHubSummary({ err: e && e.message ? e.message : String(e) });
      }
    }
  }, [props]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    return subscribeFederationSpendingPrefs(() => setPrefs(loadFederationSpendingPrefs()));
  }, []);

  React.useEffect(() => {
    setPrefs(loadFederationSpendingPrefs());
  }, [props && props.spendingPrefsTick]);

  const validators = policy && Array.isArray(policy.validators) ? policy.validators.filter(Boolean) : [];
  const thr = policy && policy.threshold != null ? Math.max(1, Number(policy.threshold) || 1) : 1;
  const mOfN = validators.length ? wm.signers(Math.min(thr, validators.length), validators.length) : null;
  const fedFromManifest = federationSummaryFromManifest(manifest);
  const vault = (vaultDetail && vaultDetail.status === 'ok' && vaultDetail.address)
    ? vaultDetail
    : (manifest && manifest.federationVault ? manifest.federationVault : null);
  const vaultAddr = vault && vault.address ? String(vault.address) : '';
  const vaultLeaves = (vaultDetail && Array.isArray(vaultDetail.leaves) && vaultDetail.leaves.length)
    ? vaultDetail.leaves
    : ((vault && Array.isArray(vault.leaves)) ? vault.leaves : []);
  const criteriaPreview = mergePaymentMemoWithFederation('', prefs, true);

  return (
    <Segment id="fabric-federation-wallet-panel" style={{ marginTop: '0.85em' }}>
      <Header as="h3" style={{ marginTop: 0 }}>
        <Icon name="users" aria-hidden="true" />
        {wm.title}
      </Header>
      <p style={{ color: '#555', lineHeight: 1.5, marginBottom: '0.65em' }}>{wm.intro}</p>
      {loadErr ? (
        <Message warning size="small">
          {wm.loadError(loadErr)}
        </Message>
      ) : null}
      {mOfN ? (
        <Message positive size="small">
          <Message.Header>{wm.configuredTitle}</Message.Header>
          <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
            {wm.policy} <strong>{mOfN}</strong>
            {policy && policy.source ? (
              <span style={{ color: '#555' }}>{' · '}{t.federation.shared.policySource(String(policy.source))}</span>
            ) : null}
            {fedFromManifest.active ? (
              <span style={{ color: '#555' }}>{' · '}{wm.manifestSame}</span>
            ) : null}
          </p>
        </Message>
      ) : (
        <Message info size="small">
          <Message.Header>{wm.noneTitle}</Message.Header>
          <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
            {wm.noneBefore}{' '}
            <Link to="/federations">{t.federation.shared.links.federations}</Link>{' '}
            {wm.noneAfter}
          </p>
        </Message>
      )}
      {vaultAddr ? (
        <p
          style={{
            margin: '0.75em 0',
            color: '#2c5c2c',
            lineHeight: 1.45,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.35em'
          }}
        >
          <span>
            <strong>{wm.vault}</strong>{' '}
            <code style={{ wordBreak: 'break-all' }}>{vaultAddr}</code>
          </span>
          <Button
            type="button"
            icon
            basic
            size="small"
            title={wm.copyVault}
            aria-label={wm.copyVault}
            onClick={() => copyToClipboard(vaultAddr)}
          >
            <Icon name="copy" aria-hidden="true" />
          </Button>
          <span>{' · '}</span>
          <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">{t.federation.shared.links.vaultUtxos}</a>
        </p>
      ) : vault && vault.status === 'no_validators' ? (
        <p style={{ margin: '0.75em 0', color: '#666' }}>
          {wm.noValidators}
        </p>
      ) : null}

      {vaultLeaves.length ? (
        <div style={{ margin: '0.65em 0 0.85em' }}>
          <p style={{ margin: '0 0 0.4em', fontSize: '0.9em', color: '#444' }}>
            {wm.leaves}
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.2em', fontSize: '0.85em', lineHeight: 1.5, color: '#555' }}>
            {vaultLeaves.map((l) => (
              <li key={l.id || l.tapscriptHex}>
                <code>{l.id || '?'}</code>
                {' · '}
                {l.kind || wm.leafKind}
                {l.threshold != null && l.keys ? ` · ${wm.leafThreshold(l.threshold, (l.keys || []).length)}` : null}
                {l.commitmentHex ? ` · ${wm.leafHashlock(String(l.commitmentHex).slice(0, 12))}` : null}
                {l.witnessShape ? ` · ${wm.leafWitness(l.witnessShape)}` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ margin: '0.85em 0' }}>
        {mOfN ? (
          <React.Fragment>
            <Link to="/federations">{wm.openFederations}</Link>
            {' · '}
          </React.Fragment>
        ) : null}
        <a href="#fabric-btc-tx-client-h3">{wm.walletActivity}</a>
      </div>

      {adminToken && collabHubSummary && collabHubSummary.err ? (
        <Message warning size="small" style={{ marginTop: 0 }}>
          {wm.collabError(collabHubSummary.err)}
        </Message>
      ) : null}
      {adminToken && collabHubSummary && collabHubSummary.n != null ? (
        <p style={{ margin: '0.5em 0 0', fontSize: '0.9em', color: '#555', lineHeight: 1.45 }}>
          <Icon name="users" aria-hidden="true" />
          {' '}
          {wm.collabCount(collabHubSummary.n)}
          {' '}
          <Link to="/settings/collaboration">{wm.collabOpen}</Link>
          {' '}
          {wm.collabHint}
        </p>
      ) : !adminToken && mOfN ? (
        <p style={{ margin: '0.5em 0 0', fontSize: '0.88em', color: '#666', lineHeight: 1.45 }}>
          {wm.noToken}
        </p>
      ) : null}

      <FederationSpendingCriteriaDraft compact />

      <Checkbox
        id="fed-wallet-record-federation"
        checked={recordFed}
        onChange={(_, d) => onRecordChange(!!(d && d.checked))}
        style={{ marginTop: '0.85em', display: 'block' }}
        label={wm.record}
      />
      {recordFed && criteriaPreview ? (
        <p style={{ margin: '0.35em 0 0', fontSize: '0.85em', color: '#666', lineHeight: 1.4 }}>
          {wm.memoPreview} <code style={{ wordBreak: 'break-word' }}>{criteriaPreview.slice(0, 120)}{criteriaPreview.length > 120 ? '…' : ''}</code>
        </p>
      ) : recordFed && !criteriaPreview ? (
        <p style={{ margin: '0.35em 0 0', fontSize: '0.85em', color: '#888' }}>
          {wm.memoEmpty}
        </p>
      ) : null}

      <Header as="h4">{wm.namedTitle}</Header>
      <p style={{ color: '#555', lineHeight: 1.45 }}>{wm.namedIntro}</p>
      {named && named.length ? (
        <List divided relaxed>
          {named.map((f) => (
            <List.Item key={f.id}>
              <List.Content>
                <List.Header>
                  <Link to="/federations">{f.name}</Link>
                  {' · '}
                  {t.federation.named.status[f.status] || f.status}
                </List.Header>
                <List.Description>
                  {t.federation.named.policy(f.threshold, f.validators.length)}
                  {' · '}
                  <code style={{ wordBreak: 'break-all' }}>{f.vaultAddress}</code>
                  {f.withdrawals.filter((w) => w.status === 'pending').length ? (
                    <div>
                      {f.withdrawals.filter((w) => w.status === 'pending').map((w) => (
                        <span key={w.requestId} style={{ marginRight: '1em' }}>
                          {t.federation.named.withdraw.row(t.common.sats(w.amountSats), w.destinationAddress)}
                          {' · '}
                          {t.federation.named.withdraw.approvals(w.signers.length, f.threshold)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      ) : (
        <p style={{ color: '#666' }}>
          {adminToken ? wm.namedNone : wm.noToken}{' '}
          <Link to="/federations">{wm.openFederations}</Link>
        </p>
      )}
    </Segment>
  );
}

module.exports = FederationWalletMultisigPanel;
