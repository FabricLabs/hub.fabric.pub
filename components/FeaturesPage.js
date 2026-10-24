'use strict';

/**
 * Marketing / tour at `/features` (gated by Feature visibility).
 */

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Container, Header, Icon, Segment } = require('semantic-ui-react');
const t = require('../locales/en');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { readStorageJSON } = require('../functions/fabricBrowserState');
const { featuresPageIdentityButtonLabelFromStorage } = require('../functions/hubIdentityUiHints');
const { useHubHttpAvailable, useHubMeshAvailable } = require('./hubUiRuntime');

const f = t.home.features;
const nav = t.shell.nav;

function FeaturesPage (props) {
  const [hubUiTick, setHubUiTick] = React.useState(0);
  const [identityButtonLabel, setIdentityButtonLabel] = React.useState(t.common.identity.login);
  const publicHubVisitor = !!(props && props.publicHubVisitor);

  const refreshIdentityButtonLabel = React.useCallback(() => {
    if (typeof window === 'undefined') {
      setIdentityButtonLabel(t.common.identity.login);
      return;
    }
    let sessionUnlocked = null;
    try {
      const unlockedRaw = window.sessionStorage && window.sessionStorage.getItem('fabric.identity.unlocked');
      if (unlockedRaw) sessionUnlocked = JSON.parse(unlockedRaw);
    } catch (_) {
      sessionUnlocked = null;
    }
    let local = null;
    try {
      local = readStorageJSON('fabric.identity.local', null);
    } catch (_) {
      local = null;
    }
    setIdentityButtonLabel(featuresPageIdentityButtonLabelFromStorage(local, sessionUnlocked));
  }, []);

  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((n) => n + 1)), []);
  React.useEffect(() => {
    refreshIdentityButtonLabel();
    if (typeof window === 'undefined') return undefined;
    const onStorage = () => refreshIdentityButtonLabel();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshIdentityButtonLabel]);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();
  const hubHttpAvailable = useHubHttpAvailable();
  const meshAvailable = useHubMeshAvailable();
  const hasAdminToken = !!readHubAdminTokenFromBrowser();
  const showOperatorShortcuts = hubHttpAvailable && !publicHubVisitor;
  const showPeersShortcut = showOperatorShortcuts && uf.peers && hasAdminToken;
  const identityButtonText = identityButtonLabel === t.common.identity.login
    ? identityButtonLabel
    : f.identityButton(identityButtonLabel);

  return (
    <fabric-hub-features className="fade-in" data-testid={publicHubVisitor ? 'hub-visitor-features' : 'hub-features'}>
      <Segment>
        <Button as={Link} to="/" basic size="small">
          <Icon name="arrow left" aria-hidden="true" />
          {t.home.backHome}
        </Button>
        <Header as="h1" id="features-page-heading" style={{ marginTop: '0.75em' }}>
          {f.title}
        </Header>
        <p style={{ color: '#666', maxWidth: '42rem', lineHeight: 1.45 }}>
          {f.intro}
          {showOperatorShortcuts ? (
            <>
              {' '}{f.operatorBefore} <Link to="/services/bitcoin">{f.operatorBitcoin}</Link> {f.operatorMiddle}{' '}
              <Link to="/settings/admin">{f.operatorAdmin}</Link> {f.operatorAfter}
            </>
          ) : hubHttpAvailable ? (
            <> {f.visitor}</>
          ) : (
            <> {f.client}</>
          )}
        </p>
      </Segment>

      <div className="ui vertical stripe segment">
        <Container text>
          <Header as="h2" style={{ fontSize: '2em', textAlign: 'center' }}>
            {t.PITCH_CTA_TEXT}
          </Header>
          <div className="ui three column stackable grid" style={{ marginTop: '2em' }}>
            <div className="column">
              <div className="ui segment">
                <Header as="h3" style={{ textAlign: 'center' }}>
                  <Icon name="shield" size="large" aria-hidden="true" />
                  <Header.Content>{f.security.title}</Header.Content>
                </Header>
                <p style={{ textAlign: 'center' }}>
                  {f.security.body}
                  {showOperatorShortcuts ? (
                    <>{f.security.operatorBefore} <Link to="/settings/security">{f.security.link}</Link>.</>
                  ) : (
                    <>.</>
                  )}
                </p>
              </div>
            </div>
            <div className="column">
              <div className="ui segment">
                <Header as="h3" style={{ textAlign: 'center' }}>
                  <Icon name="users" size="large" aria-hidden="true" />
                  <Header.Content>{f.collaboration.title}</Header.Content>
                </Header>
                <p style={{ textAlign: 'center' }}>
                  {f.collaboration.body}
                  {showOperatorShortcuts ? (
                    <>
                      {uf.sidechain ? (
                        <> {f.collaboration.sharedBefore} <Link to="/sidechains">{f.collaboration.sidechainLink}</Link> {f.collaboration.sharedAfter} </>
                      ) : (
                        <> {f.collaboration.sidechainOff} </>
                      )}
                      <Link to="/contracts">{f.collaboration.contractsLink}</Link> {f.collaboration.contractsAfter}
                    </>
                  ) : (
                    <> {f.collaboration.signedOut}</>
                  )}
                </p>
              </div>
            </div>
            <div className="column">
              <div className="ui segment">
                <Header as="h3" style={{ textAlign: 'center' }}>
                  <Icon name="bitcoin" size="large" aria-hidden="true" />
                  <Header.Content>{f.bitcoin.title}</Header.Content>
                </Header>
                <p style={{ textAlign: 'center' }}>
                  {f.bitcoin.body}
                  {showOperatorShortcuts ? (
                    uf.sidechain ? (
                      <> {f.bitcoin.seeBefore} <Link to="/settings/admin/beacon-federation">{f.bitcoin.beaconLink}</Link>.</>
                    ) : (
                      <> {f.bitcoin.sidechainOff}</>
                    )
                  ) : (
                    <>.</>
                  )}
                </p>
              </div>
            </div>
          </div>
        </Container>
      </div>

      <Segment>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
          <Button
            color="blue"
            icon
            labelPosition="left"
            type="button"
            title={f.identityButtonTitle}
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('fabricOpenIdentityManager'));
              }
            }}
          >
            <Icon name="user" aria-hidden="true" />
            {identityButtonText}
          </Button>
          <Button as={Link} to="/downloads" basic icon labelPosition="left">
            <Icon name="download" aria-hidden="true" />
            {f.downloads}
          </Button>
          {showPeersShortcut ? (
            <Button as={Link} to="/peers" basic icon labelPosition="left">
              <Icon name="sitemap" aria-hidden="true" />
              {nav.peers}
            </Button>
          ) : null}
          {(showOperatorShortcuts || meshAvailable) ? (
            <Button as={Link} to="/documents" basic icon labelPosition="left">
              <Icon name="file outline" aria-hidden="true" />
              {nav.documents}
            </Button>
          ) : null}
          {showOperatorShortcuts ? (
            <Button as={Link} to="/contracts" basic icon labelPosition="left">
              <Icon name="file code" aria-hidden="true" />
              {nav.contracts}
            </Button>
          ) : (
            <Button as={Link} to="/settings/bitcoin-wallet" basic icon labelPosition="left">
              <Icon name="bitcoin" aria-hidden="true" />
              {f.localWallet}
            </Button>
          )}
          {showOperatorShortcuts && uf.activities ? (
            <Button as={Link} to="/notifications" basic icon labelPosition="left" title={f.notificationsTitle}>
              <Icon name="bell outline" aria-hidden="true" />
              {nav.notifications}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.activities ? (
            <Button as={Link} to="/activities" basic icon labelPosition="left" title={f.activityLogTitle}>
              <Icon name="comments" aria-hidden="true" />
              {nav.activityLog}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.sidechain ? (
            <Button as={Link} to="/sidechains" basic icon labelPosition="left">
              <Icon name="random" aria-hidden="true" />
              {f.sidechain}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.sidechain ? (
            <Button
              as={Link}
              to="/settings/admin/beacon-federation"
              basic
              icon
              labelPosition="left"
              title={f.beaconTitle}
            >
              <Icon name="star" aria-hidden="true" />
              {nav.beaconFederation}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.sidechain ? (
            <Button as={Link} to="/federations" basic icon labelPosition="left" title={f.federationsTitle}>
              <Icon name="users" aria-hidden="true" />
              {nav.federations}
            </Button>
          ) : null}
          {showOperatorShortcuts ? (
            <Button as={Link} to="/services/bitcoin" basic icon labelPosition="left">
              <Icon name="bitcoin" aria-hidden="true" />
              {nav.bitcoin}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.bitcoinPayments ? (
            <Button as={Link} to="/payments" basic icon labelPosition="left">
              <Icon name="credit card outline" aria-hidden="true" />
              {nav.payments}
            </Button>
          ) : null}
          {showOperatorShortcuts ? (
            <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic icon labelPosition="left">
              <Icon name="file alternate outline" aria-hidden="true" />
              {nav.invoices}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.bitcoinLightning ? (
            <Button as={Link} to="/services/bitcoin#fabric-bitcoin-lightning" basic icon labelPosition="left" title={f.lightningTitle}>
              <Icon name="bolt" aria-hidden="true" />
              {nav.lightning}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.bitcoinExplorer ? (
            <Button as={Link} to="/services/bitcoin/blocks" basic icon labelPosition="left" title={f.explorerTitle}>
              <Icon name="search" aria-hidden="true" />
              {nav.explorer}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.bitcoinResources ? (
            <Button as={Link} to="/services/bitcoin/resources" basic icon labelPosition="left">
              <Icon name="code" aria-hidden="true" />
              {nav.bitcoinResources}
            </Button>
          ) : null}
          {showOperatorShortcuts && uf.bitcoinCrowdfund ? (
            <Button as={Link} to="/services/bitcoin/crowdfunds" basic icon labelPosition="left" title={f.crowdfundsTitle}>
              <Icon name="heart outline" aria-hidden="true" />
              {nav.crowdfunds}
            </Button>
          ) : null}
          {showOperatorShortcuts ? (
            <Button as={Link} to="/settings/admin" basic icon labelPosition="left">
              <Icon name="settings" aria-hidden="true" />
              {nav.admin}
            </Button>
          ) : null}
          <Button as={Link} to="/settings" basic icon labelPosition="left">
            <Icon name="setting" aria-hidden="true" />
            {nav.settings}
          </Button>
          {showOperatorShortcuts ? (
            <Button as={Link} to="/settings/security" basic icon labelPosition="left" title={f.securityTitle}>
              <Icon name="shield" aria-hidden="true" />
              {nav.security}
            </Button>
          ) : null}
        </div>
      </Segment>
    </fabric-hub-features>
  );
}

module.exports = FeaturesPage;
