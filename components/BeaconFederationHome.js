'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Segment, List, Message } = require('semantic-ui-react');
const DistributedFederationPanel = require('./DistributedFederationPanel');
const TrackedApplicationContractsPanel = require('./TrackedApplicationContractsPanel');
const {
  REGTEST_EPOCH_INTERVAL_MINUTES,
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS
} = require('../functions/beaconFederationConstants');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const BEACON_DESIGN_DOC_HREF = 'https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md';
const SIDECHAIN_INDEX_DOC_HREF = 'https://github.com/FabricLabs/hub.fabric.pub/blob/master/docs/SIDECHAIN_AND_EXECUTION_INDEX.md';

const ENDPOINTS = [
  { key: 'manifest', href: '/services/distributed/manifest' },
  { key: 'epoch', href: '/services/distributed/epoch' },
  { key: 'vault', href: '/services/distributed/vault' },
  { key: 'vaultUtxos', href: '/services/distributed/vault/utxos' },
  { key: 'registry', href: '/services/distributed/federation-registry' }
];

const PROSE = { color: '#555', maxWidth: '44rem', lineHeight: 1.5 };

/**
 * Dedicated operator page: Beacon Federation "contract" — Fabric epochs, cooperative signing, L1 Taproot vault (design).
 */
function BeaconFederationHome () {
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((n) => n + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();
  const hasAdminToken = !!readHubAdminTokenFromBrowser();
  const peersNav = !!(uf && uf.peers && hasAdminToken);
  const c = t.federation.beaconFederationHome;
  const links = t.federation.shared.links;

  return (
    <Segment style={{ maxWidth: 900, margin: '1em auto' }}>
      <Button as={Link} to="/settings/admin" basic size="small" style={{ marginBottom: '1em' }}>
        <Icon name="arrow left" aria-hidden="true" />
        {t.federation.shared.backTo(t.federation.shared.admin)}
      </Button>

      <Header as="h2" id="beacon-federation-heading">
        <Icon name="users" aria-hidden="true" />
        <Header.Content>{c.title}</Header.Content>
      </Header>

      {c.intro.map((line) => (
        <p key={line} style={{ ...PROSE, marginBottom: '0.65em' }}>{line}</p>
      ))}
      <p style={{ ...PROSE, marginBottom: '1em' }}>{t.federation.shared.cadence(REGTEST_EPOCH_INTERVAL_MINUTES)}</p>

      <Header as="h3">{c.proofTitle}</Header>
      {c.proof.map((line) => (
        <p key={line} style={{ ...PROSE, marginBottom: '0.5em' }}>{line}</p>
      ))}
      <Message warning size="small" style={{ margin: '0.75em 0 1em' }}>
        <Message.Header>{c.scopeTitle}</Message.Header>
        <p style={{ margin: '0.35em 0 0' }}>{c.scope}</p>
      </Message>

      <Header as="h3">{c.vaultTitle}</Header>
      {c.vault.map((line) => (
        <p key={line} style={{ ...PROSE, marginBottom: '0.5em' }}>{line}</p>
      ))}
      <p style={{ ...PROSE, marginBottom: '0.75em' }}>{c.maturity(DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS)}</p>

      <Header as="h3" style={{ marginTop: '1.25em' }}>{c.policyTitle}</Header>
      <DistributedFederationPanel size="small" marginBottom="1em" hideEndpointLinks />

      <TrackedApplicationContractsPanel />

      <Header as="h3">{c.checklistTitle}</Header>
      <List bulleted relaxed>
        <List.Item>
          {c.checklist.configure}{' '}
          <Link to="/federations">{c.checklist.configureLink}</Link>
        </List.Item>
        <List.Item>{c.checklist.verify}</List.Item>
        <List.Item>
          {c.checklist.peers}{' '}
          {peersNav ? <Link to="/peers">{c.checklist.peersLink}</Link> : <span>{c.checklist.peersLocked}</span>}
        </List.Item>
        <List.Item>
          {c.checklist.contracts}{' '}
          {c.checklist.seeAlso}{' '}
          <Link to="/sidechains">{links.statechain}</Link>
          {' · '}
          <Link to="/activities">{links.activityLog}</Link>
          {' · '}
          <Link to="/notifications">{links.notifications}</Link>
        </List.Item>
      </List>

      <nav aria-labelledby="beacon-federation-endpoints-heading" style={{ marginTop: '1em' }}>
        <Header as="h3" id="beacon-federation-endpoints-heading">{c.endpointsTitle}</Header>
        <List horizontal divided>
          {ENDPOINTS.map((e) => (
            <List.Item key={e.key}>
              <a href={e.href} target="_blank" rel="noopener noreferrer">{links[e.key]}</a>
            </List.Item>
          ))}
        </List>
      </nav>

      <p style={{ ...PROSE, marginTop: '1em' }}>
        {c.furtherReading}{' '}
        <a href={BEACON_DESIGN_DOC_HREF} target="_blank" rel="noopener noreferrer">{c.designDoc}</a>
        {' · '}
        <a href={SIDECHAIN_INDEX_DOC_HREF} target="_blank" rel="noopener noreferrer">{c.indexDoc}</a>
      </p>

      <details className="hub-developer-details" style={{ marginTop: '0.75em' }}>
        <summary>{t.common.developerDetails}</summary>
        <List bulleted style={{ color: '#555', fontSize: '0.9em' }}>
          {c.developer.map((line) => <List.Item key={line}>{line}</List.Item>)}
        </List>
      </details>
    </Segment>
  );
}

module.exports = BeaconFederationHome;
