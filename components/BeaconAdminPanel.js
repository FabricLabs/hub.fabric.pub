'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Header, Icon, Message, Segment, Button, Loader } = require('semantic-ui-react');
const { fetchBitcoinStatus, loadUpstreamSettings } = require('../functions/bitcoinClient');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { formatSatsDisplay } = require('../functions/formatSats');
const {
  REGTEST_EPOCH_INTERVAL_MINUTES,
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS
} = require('../functions/beaconFederationConstants');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const t = require('../locales/en');

/**
 * Admin summary: Beacon cadence, live status from Hub Bitcoin service, link to Beacon Federation contract page.
 */
function BeaconAdminPanel () {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((n) => n + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();
  const c = t.federation.beaconAdminPanel;

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const upstream = {
        ...loadUpstreamSettings(),
        hubAdminToken: readHubAdminTokenFromBrowser(null) || ''
      };
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
    ? c.cadenceRegtest(REGTEST_EPOCH_INTERVAL_MINUTES)
    : c.cadenceBlocks;
  const beacon = status && status.beacon && typeof status.beacon === 'object' ? status.beacon : null;
  const clock = beacon && beacon.clock != null ? Number(beacon.clock) : null;
  const balanceSats = beacon && beacon.balanceSats != null ? Number(beacon.balanceSats) : null;

  return (
    <Segment style={{ maxWidth: 720 }}>
      <Header as="h3" id="admin-beacon-heading">
        <Icon name="radio" aria-hidden="true" />
        {c.title}
      </Header>
      <p style={{ color: '#555', marginBottom: '0.5em', lineHeight: 1.45 }}>{c.intro}</p>
      <p style={{ color: '#555', marginBottom: '0.5em', lineHeight: 1.45 }}>
        {t.federation.shared.cadence(REGTEST_EPOCH_INTERVAL_MINUTES)}{' '}
        {c.federation}{' '}
        {c.verify}
      </p>
      <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75em' }}>
        {c.maturity(DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS)}
      </p>

      {loading ? (
        <Loader active inline="centered" size="small" content={c.loading} />
      ) : error ? (
        <Message warning>
          <Message.Header>{c.loadErrorTitle}</Message.Header>
          <p>{error}</p>
          <p>{c.loadErrorHint}</p>
        </Message>
      ) : (
        <Message info>
          <Message.Header>{c.statusTitle}</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>
            <strong>{c.network}</strong> {network || c.networkUnknown}
            <br />
            <strong>{c.cadenceLabel}</strong> {cadence}
            <br />
            {beacon ? (
              <>
                <strong>{c.clock}</strong> {Number.isFinite(clock) ? clock : t.common.none}
                <br />
                <strong>{c.balance}</strong>{' '}
                {Number.isFinite(balanceSats) ? `${formatSatsDisplay(balanceSats)} sats` : t.common.none}
              </>
            ) : (
              <span>{c.noBeacon}</span>
            )}
          </p>
        </Message>
      )}

      {uf.sidechain ? (
        <React.Fragment>
          <Button as={Link} to="/settings/admin/beacon-federation" primary size="small" style={{ marginTop: '0.5em' }}>
            <Icon name="users" aria-hidden="true" />
            {c.openFederation}
          </Button>
          <Button as={Link} to="/sidechains" basic size="small" style={{ marginTop: '0.5em', marginLeft: '0.35em' }}>
            {c.openStatechain}
          </Button>
        </React.Fragment>
      ) : (
        <p style={{ color: '#888', fontSize: '0.9em', marginTop: '0.75em', marginBottom: 0, lineHeight: 1.45 }}>
          {c.sidechainOff}
        </p>
      )}

      <details className="hub-developer-details" style={{ marginTop: '0.75em', fontSize: '0.9em', color: '#666' }}>
        <summary>{t.common.developerDetails}</summary>
        <p style={{ margin: '0.35em 0' }}>{c.developer}</p>
        <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">{t.federation.shared.links.manifest}</a>
        {' · '}
        <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">{t.federation.shared.links.epoch}</a>
      </details>
    </Segment>
  );
}

module.exports = BeaconAdminPanel;
