'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Message, Icon, Button, List } = require('semantic-ui-react');
const {
  fetchDistributedHubPolicy,
  federationSummaryFromManifest,
  beaconEpochWitnessDetail
} = require('../functions/distributedManifestClient');
const t = require('../locales/en');

/**
 * Operator-facing summary of federation policy from live hub endpoints.
 * Clarifies what the hub enforces vs execution-contract registry/run (L1 + deterministic commitment only).
 * @param {object} props
 * @param {string} [props.size]
 * @param {object} [props.style]
 * @param {string} [props.marginBottom]
 * @param {boolean} [props.hideSidechainNavLink] Omit the Statechain link (used on /sidechains).
 * @param {boolean} [props.hideEndpointLinks] Omit the whole link row when the page lists the same links itself.
 * @param {*} [props.refreshToken] Reload when this changes.
 */
function DistributedFederationPanel (props) {
  const size = props && props.size ? props.size : 'small';
  const style = props && props.style ? props.style : undefined;
  const marginBottom = props && props.marginBottom != null ? props.marginBottom : '1em';
  const hideSidechainNavLink = !!(props && props.hideSidechainNavLink);
  const hideEndpointLinks = !!(props && props.hideEndpointLinks);
  const c = t.federation.distributedFederationPanel;
  const links = t.federation.shared.links;

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

  const refreshToken = props && props.refreshToken;
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
  }, [refreshToken]);

  const fed = federationSummaryFromManifest(manifest);
  const beacon = beaconEpochWitnessDetail(epoch);
  const hubInValidatorSet = !!(fed.active && hubFabricPeerId && fed.validators.some(
    (v) => String(v).toLowerCase() === hubFabricPeerId.toLowerCase()
  ));

  const linkRow = hideEndpointLinks ? null : (
    <p style={{ margin: '0.75em 0 0', fontSize: '0.9em', color: '#666' }}>
      {!hideSidechainNavLink ? (
        <React.Fragment>
          <Link to="/sidechains">{links.statechain}</Link>
          {' · '}
        </React.Fragment>
      ) : null}
      <Link to="/settings/admin/beacon-federation">{links.beaconFederation}</Link>
      {' · '}
      <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">{links.manifest}</a>
      {' · '}
      <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">{links.epoch}</a>
      {' · '}
      <a href="/services/distributed/vault" target="_blank" rel="noopener noreferrer">{links.vault}</a>
      {' · '}
      <a href="/services/distributed/vault/utxos" target="_blank" rel="noopener noreferrer">{links.vaultUtxos}</a>
    </p>
  );

  if (loading) {
    return (
      <Message
        info
        size={size}
        style={{ ...style, marginBottom }}
        role="region"
        aria-label={c.title}
      >
        <Message.Header>
          <Icon name="circle notched" loading aria-hidden="true" />
          {' '}
          {c.title}
        </Message.Header>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>{c.loading}</p>
        {linkRow}
      </Message>
    );
  }

  const warnOnly = warnings.length > 0 && !manifest && !epoch;
  if (warnOnly) {
    return (
      <Message negative size={size} style={{ ...style, marginBottom }} role="region" aria-label={c.title}>
        <Message.Header>{c.title}</Message.Header>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>{c.loadError(warnings.join('; '))}</p>
      </Message>
    );
  }

  const witnessLine = !beacon.hasBeacon
    ? c.witnessNone
    : beacon.lastWitnessPresent
      ? c.witnessSigned(beacon.signatureCount)
      : c.witnessUnsigned;

  const copyButton = (
    <React.Fragment>
      <Button
        type="button"
        size="mini"
        basic
        icon="copy"
        aria-label={c.copyHubId}
        title={c.copyHubId}
        onClick={() => copyHubFabricPeerId()}
      />
      {hubIdCopied ? <span role="status" style={{ marginLeft: '0.35em', color: '#2185d0' }}>{t.common.actions.copied}</span> : null}
    </React.Fragment>
  );

  const hubIdLine = hubFabricPeerId ? (
    <p style={{ margin: '0.5em 0 0', color: '#444', fontSize: '0.9em' }}>
      <strong>{c.hubId}</strong>{' '}
      <code style={{ wordBreak: 'break-all' }}>{hubFabricPeerId}</code>
      {' '}
      {copyButton}
      {!fed.active ? <span style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>{c.hubIdInactiveHint}</span> : null}
    </p>
  ) : null;

  let body;
  if (fed.active) {
    body = (
      <React.Fragment>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>
          <strong>{c.active(fed.threshold, fed.count)}</strong>{' '}
          {fed.signatureScheme === 'bls' ? c.schemeBls : c.schemeSchnorr}{' '}
          {c.activeEffect}
        </p>
        {hubIdLine}
        {hubFabricPeerId ? (
          <p style={{ margin: '0.35em 0 0', color: hubInValidatorSet ? '#2a6a2a' : '#8a6d3b', fontSize: '0.95em' }}>
            {hubInValidatorSet ? c.inSet : c.notInSet}
          </p>
        ) : null}
      </React.Fragment>
    );
  } else {
    body = (
      <React.Fragment>
        <p style={{ margin: '0.35em 0 0', color: '#444' }}>{c.inactive}</p>
        {hubIdLine}
      </React.Fragment>
    );
  }

  const vault = manifest && manifest.federationVault ? manifest.federationVault : null;

  return (
    <Message
      info={fed.active}
      warning={!fed.active}
      size={size}
      style={{ ...style, marginBottom }}
      role="region"
      aria-label={c.title}
    >
      <Message.Header>{c.title}</Message.Header>
      {warnings.length > 0 && (manifest || epoch) ? (
        <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.9em' }}>
          {c.partial(warnings.join('; '))}
        </p>
      ) : null}
      {body}
      <p style={{ margin: '0.5em 0 0', color: '#555', fontSize: '0.95em' }}>{witnessLine}</p>
      <p style={{ margin: '0.5em 0 0', color: '#555', fontSize: '0.95em' }}>{c.scope}</p>
      {vault && vault.address ? (
        <p style={{ margin: '0.55em 0 0', color: '#2c5c2c', fontSize: '0.95em', lineHeight: 1.45 }}>
          <strong>{c.vault}</strong>{' '}
          <code style={{ wordBreak: 'break-all' }}>{vault.address}</code>
          {vault.depositMaturityBlocks != null ? (
            <span>{' '}{c.maturity(vault.depositMaturityBlocks)}</span>
          ) : null}
          <span style={{ display: 'block', marginTop: '0.4em', fontSize: '0.9em', color: '#555' }}>{c.withdraw}</span>
        </p>
      ) : vault && vault.status === 'no_validators' ? (
        <p style={{ margin: '0.55em 0 0', color: '#666', fontSize: '0.9em' }}>{c.vaultNoValidators}</p>
      ) : null}
      <details className="hub-developer-details" style={{ margin: '0.6em 0 0', fontSize: '0.85em', color: '#666' }}>
        <summary>{t.common.developerDetails}</summary>
        <List bulleted>
          {c.developer.map((line) => <List.Item key={line}>{line}</List.Item>)}
          {vault && vault.address && vault.internalKeyMode ? (
            <List.Item>{c.internalKey(String(vault.internalKeyMode))}</List.Item>
          ) : null}
        </List>
      </details>
      {linkRow}
    </Message>
  );
}

module.exports = DistributedFederationPanel;
