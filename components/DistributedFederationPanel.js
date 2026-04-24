'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Message, Icon, Button } = require('semantic-ui-react');
const {
  fetchDistributedHubPolicy,
  federationSummaryFromManifest,
  beaconEpochWitnessDetail
} = require('../functions/distributedManifestClient');

/**
 * Operator-facing summary of federation policy from live hub endpoints.
 * Clarifies what the hub enforces vs execution-contract registry/run (L1 + deterministic commitment only).
 */
function DistributedFederationPanel (props) {
  const size = props && props.size ? props.size : 'small';
  const style = props && props.style ? props.style : undefined;
  const marginBottom = props && props.marginBottom != null ? props.marginBottom : '1em';
  const hideSidechainNavLink = !!(props && props.hideSidechainNavLink);

  const [loading, setLoading] = React.useState(true);
  const [manifest, setManifest] = React.useState(null);
  const [epoch, setEpoch] = React.useState(null);
  const [warnings, setWarnings] = React.useState([]);
  const [hubIdCopied, setHubIdCopied] = React.useState(false);

  const hubFabricPeerId = manifest && manifest.hubFabricPeerId
    ? String(manifest.hubFabricPeerId).trim()
    : '';

  const copyHubFabricPeerId = React.useCallback(() => {
    if (!hubFabricPeerId) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
    setHubIdCopied(false);
    navigator.clipboard.writeText(hubFabricPeerId).then(() => {
      setHubIdCopied(true);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => setHubIdCopied(false), 2000);
      }
    }).catch(() => {});
  }, [hubFabricPeerId]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDistributedHubPolicy()
      .then((r) => {
        if (cancelled) return;
        setManifest(r.manifest);
        setEpoch(r.epoch);
        setWarnings(Array.isArray(r.warnings) ? r.warnings : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setManifest(null);
        setEpoch(null);
        setWarnings([e && e.message ? e.message : String(e)]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const fed = federationSummaryFromManifest(manifest);
  const beacon = beaconEpochWitnessDetail(epoch);
  const hubInValidatorSet = !!(fed.active && hubFabricPeerId && fed.validators.some(
    (v) => String(v).toLowerCase() === hubFabricPeerId.toLowerCase()
  ));

  if (loading) {
    return (
      <Message
        info
        size={size}
        style={{ ...style, marginBottom }}
        role="region"
        aria-label="Federation policy loading"
      >
        <Message.Header>
          <Icon name="circle notched" loading aria-hidden="true" />
          {' '}
          Federation policy (this hub)
        </Message.Header>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>
          Loading <code>/services/distributed/manifest</code>, <code>/services/distributed/epoch</code>, and federation vault JSON…
        </p>
        <p style={{ margin: '0.75em 0 0', fontSize: '0.9em', color: '#666' }}>
          {!hideSidechainNavLink ? (
            <React.Fragment>
              <Link to="/sidechains">Sidechain &amp; demo</Link>
              {' · '}
            </React.Fragment>
          ) : null}
          <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>
          {' · '}
          <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">Distributed manifest</a>
          {' · '}
          <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">Beacon epoch (JSON)</a>
          {' · '}
          <a href="/services/distributed/vault" target="_blank" rel="noopener noreferrer">Vault</a>
        </p>
      </Message>
    );
  }

  const warnOnly = warnings.length > 0 && !manifest && !epoch;
  if (warnOnly) {
    return (
      <Message negative size={size} style={{ ...style, marginBottom }} role="region" aria-label="Federation policy error">
        <Message.Header>Federation policy (this hub)</Message.Header>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>
          Could not load distributed endpoints: {warnings.join('; ')}.
        </p>
      </Message>
    );
  }

  const witnessLine = !beacon.hasBeacon
    ? 'Beacon epoch summary not available from this hub (epoch endpoint missing or empty).'
    : beacon.lastWitnessPresent
      ? `Latest recorded beacon epoch carries a federation witness (${beacon.signatureCount} signature(s) in the last message).`
      : 'Latest recorded beacon epoch has no federation witness (expected when no validators are configured, or the hub key is not in the set).';

  const scopeLine = (
    <span>
      <strong>Execution contracts:</strong> registry publish and <code>RunExecutionContract</code> use L1 invoice verification (when Bitcoin is on) and a deterministic <code>runCommitmentHex</code> only; they do <strong>not</strong> use federation witnesses.
    </span>
  );

  let body;
  if (fed.active) {
    body = (
      <React.Fragment>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>
          <strong>Federation active on this hub:</strong>{' '}
          <strong>{fed.threshold}-of-{fed.count}</strong> Schnorr threshold over the configured compressed secp256k1 validator pubkeys.
          <code>SubmitSidechainStatePatch</code> requires a valid <code>federationWitness</code> over the patch signing string (admin token does not bypass when validators are configured).
          The beacon adds a <code>federationWitness</code> on new epochs when the hub&apos;s pubkey is in that set, and on startup the hub checks stored epochs against the same threshold (see <code>verifyFederationWitnessOnMessage</code>).
        </p>
        {hubFabricPeerId ? (
          <React.Fragment>
            <p style={{ margin: '0.5em 0 0', color: '#444', fontSize: '0.9em' }}>
              <strong>Hub Fabric peer id:</strong>{' '}
              <code style={{ wordBreak: 'break-all' }}>{hubFabricPeerId}</code>
              {' '}
              <Button
                type="button"
                size="mini"
                basic
                icon="copy"
                aria-label="Copy hub Fabric peer id"
                title="Copy pubkey"
                onClick={() => copyHubFabricPeerId()}
              />
              {hubIdCopied ? <span style={{ marginLeft: '0.35em', color: '#2185d0' }}>Copied</span> : null}
            </p>
            <p style={{ margin: '0.35em 0 0', color: hubInValidatorSet ? '#2a6a2a' : '#8a6d3b', fontSize: '0.95em' }}>
              {hubInValidatorSet
                ? 'This id is in the validator list, so new beacon epochs can attach its Schnorr signature to federationWitness.'
                : 'This id is not in the validator list; the beacon will not attach federationWitness until it is included in FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS (or settings.distributed.federation.validators).'}
            </p>
          </React.Fragment>
        ) : null}
        <p style={{ margin: '0.5em 0 0', color: '#555', fontSize: '0.95em' }}>
          {witnessLine}
        </p>
        <p style={{ margin: '0.5em 0 0', color: '#555', fontSize: '0.95em' }}>
          {scopeLine}
        </p>
      </React.Fragment>
    );
  } else {
    body = (
      <React.Fragment>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>
          <strong>Federation not configured</strong> (distributed manifest has no validator pubkeys).
          <code>SubmitSidechainStatePatch</code> requires a valid <strong>admin token</strong> only.
          Beacon epochs are still anchored to Bitcoin; the hub signs each epoch <code>Message</code> with its identity key, but no k-of-n <code>federationWitness</code> is produced until validators and threshold are configured.
        </p>
        {hubFabricPeerId ? (
          <p style={{ margin: '0.5em 0 0', color: '#444', fontSize: '0.9em' }}>
            <strong>Hub Fabric peer id</strong> (compressed pubkey hex — include when you enable federation):
            {' '}
            <code style={{ wordBreak: 'break-all' }}>{hubFabricPeerId}</code>
            {' '}
            <Button
              type="button"
              size="mini"
              basic
              icon="copy"
              aria-label="Copy hub Fabric peer id"
              title="Copy pubkey"
              onClick={() => copyHubFabricPeerId()}
            />
            {hubIdCopied ? <span style={{ marginLeft: '0.35em', color: '#2185d0' }}>Copied</span> : null}
          </p>
        ) : null}
        <p style={{ margin: '0.5em 0 0', color: '#555', fontSize: '0.95em' }}>
          {witnessLine}
        </p>
        <p style={{ margin: '0.5em 0 0', color: '#555', fontSize: '0.95em' }}>
          {scopeLine}
        </p>
      </React.Fragment>
    );
  }

  return (
    <Message
      info={fed.active}
      warning={!fed.active}
      size={size}
      style={{ ...style, marginBottom }}
      role="region"
      aria-label="Federation guarantees for this hub"
    >
      <Message.Header>Federation guarantees (this hub)</Message.Header>
      {warnings.length > 0 && (manifest || epoch) ? (
        <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.9em' }}>
          Partial load: {warnings.join('; ')}.
        </p>
      ) : null}
      {body}
      {manifest && manifest.federationVault && manifest.federationVault.address ? (
        <p style={{ margin: '0.55em 0 0', color: '#2c5c2c', fontSize: '0.95em', lineHeight: 1.45 }}>
          <strong>L1 federation vault (Taproot):</strong>{' '}
          <code style={{ wordBreak: 'break-all' }}>{manifest.federationVault.address}</code>
          {' · '}
          <a href="/services/distributed/vault" target="_blank" rel="noopener noreferrer">Vault JSON</a>
          {' · '}
          <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">UTXOs</a>
          {manifest.federationVault.depositMaturityBlocks != null ? (
            <span>
              {' '}
              — default maturity policy: <strong>{manifest.federationVault.depositMaturityBlocks}</strong> confirmations before treating deposits as matured for withdrawal planning.
            </span>
          ) : null}
          <span style={{ display: 'block', marginTop: '0.4em', fontSize: '0.88em', color: '#555' }}>
            Withdraw via <code>PrepareFederationVaultWithdrawalPsbt</code> on <code>POST /services/rpc</code> (admin token): pass <code>fundedTxHex</code> and <code>destinationAddress</code>; validators co-sign the returned PSBT off-node.
          </span>
        </p>
      ) : manifest && manifest.federationVault && manifest.federationVault.status === 'no_validators' ? (
        <p style={{ margin: '0.55em 0 0', color: '#666', fontSize: '0.9em' }}>
          <strong>On-chain vault:</strong> add validator pubkeys to derive a deterministic Taproot deposit address (<code>GET /services/distributed/vault</code>).
        </p>
      ) : null}
      <p style={{ margin: '0.6em 0 0', fontSize: '0.82em', color: '#777' }}>
        The distributed manifest&apos;s validator list and threshold match what this hub enforces for <code>SubmitSidechainStatePatch</code> (environment and settings), including when the beacon has not attached yet.
        Beacon epochs use the same style of witness over a deterministic signing string; sidechain patches use <code>signingStringForSidechainStatePatch</code> — both verifiable offline with <code>@fabric/core</code>.
      </p>
      <p style={{ margin: '0.75em 0 0', fontSize: '0.9em', color: '#666' }}>
        {!hideSidechainNavLink ? (
          <React.Fragment>
            <Link to="/sidechains">Sidechain &amp; demo</Link>
            {' · '}
          </React.Fragment>
        ) : null}
        <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>
        {' · '}
        <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">Distributed manifest</a>
        {' · '}
        <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">Beacon epoch (JSON)</a>
        {' · '}
        <a href="/services/distributed/vault" target="_blank" rel="noopener noreferrer">Federation vault</a>
        {' · '}
        <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">Vault UTXOs</a>
      </p>
    </Message>
  );
}

module.exports = DistributedFederationPanel;
