'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const {
  Button,
  Checkbox,
  Form,
  Header,
  Icon,
  Input,
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

/**
 * Federation summary + optional vault PSBT prep + memo tagging for hub wallet sends.
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
  const [loadErr, setLoadErr] = React.useState(null);
  const [vaultFlowOpen, setVaultFlowOpen] = React.useState(false);
  const [fundedTxHex, setFundedTxHex] = React.useState('');
  const [destAddress, setDestAddress] = React.useState('');
  const [feeSats, setFeeSats] = React.useState('');
  const [psbtBusy, setPsbtBusy] = React.useState(false);
  const [psbtResult, setPsbtResult] = React.useState(null);
  const [prefs, setPrefs] = React.useState(() => loadFederationSpendingPrefs());

  const refresh = React.useCallback(async () => {
    setLoadErr(null);
    try {
      const [pol, dist] = await Promise.all([
        hubJsonRpc('GetDistributedFederationPolicy', []).catch((e) => {
          throw new Error(e && e.message ? e.message : String(e));
        }),
        fetchDistributedHubPolicy()
      ]);
      setPolicy(pol && typeof pol === 'object' ? pol : null);
      setManifest(dist && dist.manifest ? dist.manifest : null);
    } catch (e) {
      setPolicy(null);
      setManifest(null);
      setLoadErr(e && e.message ? e.message : String(e));
    }
  }, []);

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
  const mOfN = validators.length ? `${Math.min(thr, validators.length)}-of-${validators.length}` : null;
  const fedFromManifest = federationSummaryFromManifest(manifest);
  const vault = manifest && manifest.federationVault ? manifest.federationVault : null;
  const vaultAddr = vault && vault.address ? String(vault.address) : '';
  const criteriaPreview = mergePaymentMemoWithFederation('', prefs, true);

  const preparePsbt = async () => {
    setPsbtResult(null);
    if (!adminToken) {
      setPsbtResult({ error: 'Admin token required in this browser to build a withdrawal PSBT.' });
      return;
    }
    const hex = String(fundedTxHex || '').trim();
    const to = String(destAddress || '').trim();
    if (!hex) {
      setPsbtResult({ error: 'Paste the full raw transaction hex that funded the federation vault address.' });
      return;
    }
    if (!to) {
      setPsbtResult({ error: 'Destination address is required.' });
      return;
    }
    setPsbtBusy(true);
    try {
      const params = {
        fundedTxHex: hex,
        destinationAddress: to,
        adminToken
      };
      if (vaultAddr) params.vaultAddress = vaultAddr;
      const fs = feeSats != null && String(feeSats).trim() !== '' ? Math.round(Number(feeSats)) : NaN;
      if (Number.isFinite(fs) && fs > 0) params.feeSats = fs;
      const r = await hubJsonRpc('PrepareFederationVaultWithdrawalPsbt', [params]);
      if (r && r.status === 'error') {
        setPsbtResult({ error: r.message || 'Prepare PSBT failed' });
        return;
      }
      setPsbtResult(r || {});
    } catch (e) {
      setPsbtResult({ error: e && e.message ? e.message : String(e) });
    } finally {
      setPsbtBusy(false);
    }
  };

  const psbtText = psbtResult && (psbtResult.psbtBase64 || psbtResult.psbtHex || psbtResult.psbt);

  return (
    <Segment id="fabric-federation-wallet-panel" style={{ marginTop: '0.85em' }}>
      <Header as="h3" style={{ marginTop: 0 }}>
        <Icon name="users" />
        Shared wallet (federation multisig)
      </Header>
      <p style={{ color: '#555', lineHeight: 1.5, marginBottom: '0.65em' }}>
        Your hub can host a <strong>shared Taproot vault</strong> controlled by multiple signers (M-of-N).
        That is separate from the <strong>hub node wallet</strong> used for quick sends below — vault spends use a PSBT
        that co-signers approve offline, then you broadcast when complete.
      </p>
      {loadErr ? (
        <Message warning size="small">
          Could not load federation policy: {loadErr}
        </Message>
      ) : null}
      {mOfN ? (
        <Message positive size="small">
          <Message.Header>Federation is configured on this hub</Message.Header>
          <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
            Policy: <strong>{mOfN}</strong>
            {policy && policy.source ? (
              <span style={{ color: '#555' }}>{' '}· source <code>{String(policy.source)}</code></span>
            ) : null}
            {fedFromManifest.active ? (
              <span style={{ color: '#555' }}>{' '}· manifest lists the same signer set for distributed features.</span>
            ) : null}
          </p>
        </Message>
      ) : (
        <Message info size="small">
          <Message.Header>No federation yet</Message.Header>
          <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>
            Add signer public keys and a threshold on the{' '}
            <Link to="/federations">Federations</Link> page (or{' '}
            <Link to="/settings/federation">Settings → Distributed federation</Link>
            ). After saving, this hub derives the vault address for deposits.
          </p>
        </Message>
      )}
      {vaultAddr ? (
        <p style={{ margin: '0.75em 0', color: '#2c5c2c', lineHeight: 1.45 }}>
          <strong>Federation vault (deposit here for multisig):</strong>{' '}
          <code style={{ wordBreak: 'break-all' }}>{vaultAddr}</code>
          {' · '}
          <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">UTXOs</a>
        </p>
      ) : vault && vault.status === 'no_validators' ? (
        <p style={{ margin: '0.75em 0', color: '#666' }}>
          Configure validators to show the on-chain vault address.
        </p>
      ) : null}

      <div style={{ margin: '0.85em 0' }}>
        <Link to="/federations">Open federation setup</Link>
        {' · '}
        <a href="#fabric-btc-tx-client-h3">Jump to wallet activity</a>
      </div>

      <FederationSpendingCriteriaDraft compact />

      <Checkbox
        checked={recordFed}
        onChange={(_, d) => onRecordChange(!!(d && d.checked))}
        style={{ marginTop: '0.85em', display: 'block' }}
        label="Record hub wallet sends below as federation-related (append my spending criteria to the payment memo)"
      />
      {recordFed && criteriaPreview ? (
        <p style={{ margin: '0.35em 0 0', fontSize: '0.85em', color: '#666', lineHeight: 1.4 }}>
          Memo will include: <code style={{ wordBreak: 'break-word' }}>{criteriaPreview.slice(0, 120)}{criteriaPreview.length > 120 ? '…' : ''}</code>
        </p>
      ) : recordFed && !criteriaPreview ? (
        <p style={{ margin: '0.35em 0 0', fontSize: '0.85em', color: '#888' }}>
          Turn on the drafting checkbox above and save text to attach a memo fragment.
        </p>
      ) : null}

      <Checkbox
        checked={vaultFlowOpen}
        onChange={(_, d) => setVaultFlowOpen(!!(d && d.checked))}
        style={{ marginTop: '1em', display: 'block' }}
        label="Prepare a federation vault withdrawal PSBT (co-signers sign outside the hub)"
      />
      {vaultFlowOpen ? (
        <div style={{ marginTop: '0.75em' }}>
          <Message size="small">
            <p style={{ margin: 0, lineHeight: 1.45 }}>
              Paste the <strong>full raw hex</strong> of the transaction that sent coins to the vault, the
              <strong> destination</strong> you want to pay, and optionally a <strong>fee</strong> in sats.
              The hub returns an <strong>unsigned PSBT</strong> for validators to sign with their keys.
            </p>
          </Message>
          <Form style={{ marginTop: '0.5em' }}>
            <Form.Field>
              <label>Funding transaction hex</label>
              <Input
                placeholder="020000..."
                value={fundedTxHex}
                onChange={(e) => setFundedTxHex(e.target.value)}
              />
            </Form.Field>
            <Form.Field>
              <label>Destination address</label>
              <Input
                placeholder="bc1…"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
              />
            </Form.Field>
            <Form.Field>
              <label>Fee (sats, optional)</label>
              <Input
                type="number"
                min={1}
                placeholder="e.g. 500"
                value={feeSats}
                onChange={(e) => setFeeSats(e.target.value)}
              />
            </Form.Field>
            <Button type="button" primary loading={psbtBusy} disabled={psbtBusy} onClick={() => void preparePsbt()}>
              <Icon name="file code outline" />
              Build withdrawal PSBT
            </Button>
          </Form>
          {psbtResult ? (
            <Message
              style={{ marginTop: '0.75em' }}
              negative={!!psbtResult.error}
              positive={!psbtResult.error && !!psbtText}
            >
              {psbtResult.error ? (
                <p>{psbtResult.error}</p>
              ) : (
                <>
                  <Message.Header>PSBT ready</Message.Header>
                  <p style={{ marginTop: '0.5em' }}>Share this with co-signers. Finalize and broadcast when you have enough signatures.</p>
                  {psbtText ? (
                    <div style={{ marginTop: '0.5em' }}>
                      <Form.TextArea
                        readOnly
                        rows={4}
                        value={String(psbtText)}
                        style={{ fontFamily: 'monospace', fontSize: '0.8em' }}
                      />
                      <Button
                        type="button"
                        size="small"
                        basic
                        icon
                        labelPosition="left"
                        onClick={() => copyToClipboard(String(psbtText))}
                      >
                        <Icon name="copy" />
                        Copy PSBT
                      </Button>
                    </div>
                  ) : (
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85em' }}>
                      {JSON.stringify(psbtResult, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </Message>
          ) : null}
        </div>
      ) : null}
    </Segment>
  );
}

module.exports = FederationWalletMultisigPanel;
