'use strict';

/**
 * Settings overview: links into security/delegation UI (REST `/sessions` remains the Fabric API).
 */

const React = require('react');
const { Link } = require('react-router-dom');
const { Header, Icon, Segment, Card } = require('semantic-ui-react');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { useHubHttpAvailable } = require('./hubUiRuntime');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const c = t.settings.home;

function SettingsHome (props) {
  const [, setUiTick] = React.useState(0);
  React.useEffect(() => {
    return subscribeHubUiFeatureFlags(() => setUiTick((n) => n + 1));
  }, []);
  const uf = loadHubUiFeatureFlags();
  /** Same gate as {@link TopPanel}: Peers nav is hub-admin-only. */
  const hasHubAdminPeerNav = !!readHubAdminTokenFromBrowser();
  const hubHttpAvailable = useHubHttpAvailable();
  const publicHubVisitor = !!(props && props.publicHubVisitor);
  /** Operator cards need live Hub HTTP and a signed-in (or enrolled) shell. */
  const showOperatorCards = hubHttpAvailable && !publicHubVisitor;

  const cards = [
    showOperatorCards && { key: 'documents', to: '/documents', icon: 'file outline' },
    showOperatorCards && { key: 'contracts', to: '/contracts', icon: 'file code' },
    showOperatorCards && uf.peers && hasHubAdminPeerNav && { key: 'peers', to: '/peers', icon: 'sitemap' },
    uf.features && { key: 'features', to: '/features', icon: 'info circle' },
    showOperatorCards && uf.activities && { key: 'notifications', to: '/notifications', icon: 'bell outline' },
    showOperatorCards && uf.activities && { key: 'activities', to: '/activities', icon: 'comments' },
    { key: 'identity', icon: 'user circle', identity: true },
    { key: 'wallet', to: '/settings/bitcoin-wallet', icon: 'bitcoin' },
    showOperatorCards && { key: 'bitcoin', to: '/services/bitcoin', icon: 'bitcoin' },
    showOperatorCards && hasHubAdminPeerNav && { key: 'collaboration', to: '/settings/collaboration', icon: 'users' },
    showOperatorCards && { key: 'security', to: '/settings/security', icon: 'shield' },
    showOperatorCards && { key: 'admin', to: '/settings/admin', icon: 'settings' },
    showOperatorCards && uf.sidechain && { key: 'statechain', to: '/sidechains', icon: 'random' },
    showOperatorCards && uf.sidechain && { key: 'beaconFederation', to: '/settings/admin/beacon-federation', icon: 'star' },
    showOperatorCards && uf.sidechain && { key: 'federations', to: '/federations', icon: 'users' },
    showOperatorCards && uf.bitcoinResources && { key: 'bitcoinResources', to: '/services/bitcoin/resources', icon: 'code' }
  ].filter(Boolean);

  const openIdentityManager = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fabricOpenIdentityManager'));
    }
  };

  return (
    <Segment
      style={{ maxWidth: 960, margin: '1em auto' }}
      data-testid={hubHttpAvailable
        ? (publicHubVisitor ? 'hub-visitor-settings' : 'hub-settings-home')
        : 'hub-client-settings'}
    >
      <section aria-labelledby="settings-page-heading" aria-describedby="settings-page-summary">
        <Header as="h2" id="settings-page-heading" style={{ marginBottom: '0.35em' }}>
          <Icon name="setting" aria-hidden="true" />
          <Header.Content>{c.title}</Header.Content>
        </Header>
        <p id="settings-page-summary" style={{ color: '#666', margin: '0 0 1.5em', maxWidth: '42rem', lineHeight: 1.45 }}>
          {publicHubVisitor
            ? c.summaryVisitor
            : (hubHttpAvailable ? c.summaryHub : c.summaryClient)}
        </p>
      </section>

      <Card.Group itemsPerRow={1} stackable>
        {cards.map((card) => {
          const copy = c[card.key];
          const content = (
            <Card.Content>
              <Card.Header>
                <Icon name={card.icon} aria-hidden="true" /> {copy.title}
              </Card.Header>
              <Card.Description>{copy.body}</Card.Description>
            </Card.Content>
          );
          if (card.identity) {
            return (
              <Card
                key={card.key}
                style={{ cursor: 'pointer' }}
                tabIndex={0}
                role="button"
                aria-label={copy.title}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  openIdentityManager();
                }}
                onClick={openIdentityManager}
              >
                {content}
              </Card>
            );
          }
          return (
            <Card key={card.key} as={Link} to={card.to} style={{ cursor: 'pointer' }}>
              {content}
            </Card>
          );
        })}
      </Card.Group>
    </Segment>
  );
}

module.exports = SettingsHome;
