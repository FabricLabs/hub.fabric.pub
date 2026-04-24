'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Header, Icon, Message, Segment, Button, Loader } = require('semantic-ui-react');
const { fetchBitcoinStatus, loadUpstreamSettings } = require('../functions/bitcoinClient');
const { formatSatsDisplay } = require('../functions/formatSats');
const {
  REGTEST_EPOCH_INTERVAL_MINUTES,
  NON_REGTEST_CADENCE_LABEL,
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS
} = require('../functions/beaconFederationConstants');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');

/**
 * Admin summary: Beacon cadence, live status from Hub Bitcoin service, link to Beacon Federation contract page.
 */
function BeaconAdminPanel () {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const upstream = loadUpstreamSettings();
      const s = await fetchBitcoinStatus(upstream);
      setStatus(s && typeof s === 'object' ? s : null);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const network = status && status.network ? String(status.network).toLowerCase() : '';
  const isRegtest = network === 'regtest';
  const cadence = isRegtest
    ? `About every ${REGTEST_EPOCH_INTERVAL_MINUTES} minutes (regtest timer)`
    : NON_REGTEST_CADENCE_LABEL;
  const beacon = status && status.beacon && typeof status.beacon === 'object' ? status.beacon : null;
  const clock = beacon && beacon.clock != null ? Number(beacon.clock) : null;
  const balanceSats = beacon && beacon.balanceSats != null ? Number(beacon.balanceSats) : null;

  return (
    <Segment style={{ maxWidth: 720 }}>
      <Header as="h3" id="admin-beacon-heading">
        <Icon name="radio" aria-hidden="true" />
        Beacon
      </Header>
      <p style={{ color: '#555', marginBottom: '0.75em', lineHeight: 1.45 }}>
        The Hub <strong>Beacon</strong> seals a chain of Fabric <code>BEACON_EPOCH</code> messages against Bitcoin (block hash, height, optional sidechain digest).
        On <strong>regtest</strong> the default cadence is timer-based (~{REGTEST_EPOCH_INTERVAL_MINUTES} minutes); on <strong>mainnet, testnet, and signet</strong> epochs are driven by{' '}
        <strong>{NON_REGTEST_CADENCE_LABEL}</strong>.
        Federation members co-sign witness data on those messages; the <strong>Beacon Federation</strong> page links the on-chain Taproot vault (<code>GET /services/distributed/vault</code>, UTXOs, withdrawal PSBT RPC).
        <span style={{ display: 'block', marginTop: '0.5em', fontSize: '0.92em', color: '#666' }}>
          <strong>Provability:</strong> compare each epoch&apos;s height/hash to L1; re-verify Schnorr witnesses against the manifest pubkeys using the canonical epoch signing string in{' '}
          <code>@fabric/core</code> <code>DistributedExecution</code>.{' '}
          <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">Manifest</a>
          {' · '}
          <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">Epoch JSON</a>.
        </span>
      </p>
      <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75em' }}>
        Default L1 deposit policy for the federation vault: lock incoming deposits for{' '}
        <strong>{DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS}</strong> blocks before withdrawal paths unlock (operator policy).
      </p>

      {loading ? (
        <Loader active inline="centered" size="small" />
      ) : error ? (
        <Message warning>
          <Message.Header>Could not load Bitcoin / Beacon status</Message.Header>
          <p>{error}</p>
        </Message>
      ) : (
        <Message info>
          <Message.Header>Live status</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>
            <strong>Network:</strong> {network || 'unknown'}
            <br />
            <strong>Epoch cadence (this hub):</strong> {cadence}
            <br />
            {beacon ? (
              <>
                <strong>Beacon clock:</strong> {Number.isFinite(clock) ? clock : '—'}
                <br />
                <strong>Core balance (Hub wallet / beacon view):</strong>{' '}
                {Number.isFinite(balanceSats) ? `${formatSatsDisplay(balanceSats)} sats` : '—'}
              </>
            ) : (
              <span>Beacon snapshot not included in status (Bitcoin service may be off or idle).</span>
            )}
          </p>
        </Message>
      )}

      {uf.sidechain ? (
        <React.Fragment>
          <Button as={Link} to="/settings/admin/beacon-federation" primary size="small" style={{ marginTop: '0.5em' }}>
            <Icon name="users" />
            Beacon Federation contract
          </Button>
          <Button as={Link} to="/sidechains" basic size="small" style={{ marginTop: '0.5em', marginLeft: '0.35em' }}>
            Sidechain &amp; demo
          </Button>
        </React.Fragment>
      ) : (
        <p style={{ color: '#888', fontSize: '0.9em', marginTop: '0.75em', marginBottom: 0, lineHeight: 1.45 }}>
          Enable <strong>Sidechain</strong> under Admin → Feature visibility to open Beacon Federation and the sidechain demo from here.
        </p>
      )}
    </Segment>
  );
}

module.exports = BeaconAdminPanel;
