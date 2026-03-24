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
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

function SettingsHome () {
  const [, setUiTick] = React.useState(0);
  React.useEffect(() => {
    return subscribeHubUiFeatureFlags(() => setUiTick((t) => t + 1));
  }, []);
  const uf = loadHubUiFeatureFlags();
  /** Same gate as {@link TopPanel}: Peers nav is hub-admin-only. */
  const hasHubAdminPeerNav = !!readHubAdminTokenFromBrowser();

  return (
    <Segment style={{ maxWidth: 960, margin: '1em auto' }}>
      <section aria-labelledby="settings-page-heading" aria-describedby="settings-page-summary">
        <Header as="h2" id="settings-page-heading" style={{ marginBottom: '0.35em' }}>
          <Icon name="setting" aria-hidden="true" />
          <Header.Content>Settings</Header.Content>
        </Header>
        <p id="settings-page-summary" style={{ color: '#666', margin: '0 0 1.5em', maxWidth: '42rem', lineHeight: 1.45 }}>
          Hub configuration uses the <code>/settings</code> HTTP API (JSON). Use the cards below for documents, contracts,
          the hub activity feed, and identity-related tools: browser ↔ desktop linking, delegation tokens, and per-session audit.
        </p>
      </section>

      <Card.Group itemsPerRow={1} stackable>
        <Card as={Link} to="/documents" style={{ cursor: 'pointer' }}>
          <Card.Content>
            <Card.Header>
              <Icon name="file outline" aria-hidden="true" /> Documents
            </Card.Header>
            <Card.Description>
              Publish, distribute, and open the document list for this browser (same as the top nav).
            </Card.Description>
          </Card.Content>
        </Card>
        <Card as={Link} to="/contracts" style={{ cursor: 'pointer' }}>
          <Card.Content>
            <Card.Header>
              <Icon name="file code" aria-hidden="true" /> Contracts
            </Card.Header>
            <Card.Description>
              Storage and execution contracts; optional L1-backed execution registry when the hub Bitcoin service is available.
            </Card.Description>
          </Card.Content>
        </Card>
        {uf.peers && hasHubAdminPeerNav ? (
          <Card as={Link} to="/peers" style={{ cursor: 'pointer' }}>
            <Card.Content>
              <Card.Header>
                <Icon name="sitemap" aria-hidden="true" /> Peers
              </Card.Header>
              <Card.Description>
                Fabric TCP peers and WebRTC mesh (same as top nav).
              </Card.Description>
            </Card.Content>
          </Card>
        ) : null}
        {uf.features ? (
          <Card as={Link} to="/features" style={{ cursor: 'pointer' }}>
            <Card.Content>
              <Card.Header>
                <Icon name="info circle" aria-hidden="true" /> Features tour
              </Card.Header>
              <Card.Description>
                Product overview and the same shortcut row as home and <strong>More</strong> → Features.
              </Card.Description>
            </Card.Content>
          </Card>
        ) : null}
        {uf.activities ? (
          <Card as={Link} to="/activities" style={{ cursor: 'pointer' }}>
            <Card.Content>
              <Card.Header>
                <Icon name="bell outline" aria-hidden="true" /> Activities
              </Card.Header>
              <Card.Description>
                Hub message log, chat, Bitcoin blocks, optional feed filters, and in-app toasts (same as the bell in the top bar).
              </Card.Description>
            </Card.Content>
          </Card>
        ) : null}
        <Card
          style={{ cursor: 'pointer' }}
          tabIndex={0}
          role="button"
          aria-label="Open Fabric identity manager"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('fabricOpenIdentityManager'));
            }
          }}
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('fabricOpenIdentityManager'));
            }
          }}
        >
          <Card.Content>
            <Card.Header>
              <Icon name="user circle" aria-hidden="true" /> Fabric identity
            </Card.Header>
            <Card.Description>
              Unlock, import, or export your local Fabric keys (same modal as <strong>Profile</strong> / <strong>Manage identity</strong> in the top bar).
              For Bitcoin receive addresses and balance, see{' '}
              <Link to="/settings/bitcoin-wallet" onClick={(e) => e.stopPropagation()}>Bitcoin wallet &amp; derivation</Link>.
            </Card.Description>
          </Card.Content>
        </Card>
        <Card as={Link} to="/settings/bitcoin-wallet" style={{ cursor: 'pointer' }}>
          <Card.Content>
            <Card.Header>
              <Icon name="bitcoin" aria-hidden="true" /> Bitcoin wallet &amp; derivation
            </Card.Header>
            <Card.Description>
              How Bitcoin addresses and client balance map to your Fabric identity: one BIP44 Bitcoin account (
              <code style={{ whiteSpace: 'nowrap' }}>{`m/44'/0'/0'`}</code>) for receives, change, and Hub wallet id.
            </Card.Description>
          </Card.Content>
        </Card>
        <Card as={Link} to="/services/bitcoin" style={{ cursor: 'pointer' }}>
          <Card.Content>
            <Card.Header>
              <Icon name="bitcoin" aria-hidden="true" /> Bitcoin dashboard
            </Card.Header>
            <Card.Description>
              Hub L1 status, regtest tools, explorer, Payjoin, and Lightning; Payments / Invoices / Resources and other sub-pages follow Feature visibility.
            </Card.Description>
          </Card.Content>
        </Card>
        <Card as={Link} to="/settings/security" style={{ cursor: 'pointer' }}>
          <Card.Content>
            <Card.Header>
              <Icon name="shield" aria-hidden="true" /> Security &amp; delegation
            </Card.Header>
            <Card.Description>
              External signing sessions, delegation tokens, and links to per-token audit (
              <code>/sessions</code> REST API on this Hub).
            </Card.Description>
          </Card.Content>
        </Card>
        <Card as={Link} to="/settings/admin" style={{ cursor: 'pointer' }}>
          <Card.Content>
            <Card.Header>
              <Icon name="settings" aria-hidden="true" /> Admin
            </Card.Header>
            <Card.Description>
              Beacon status, regtest admin token, HTTP shared mode, optional hub UI feature toggles (URL{' '}
              <code>/settings/admin</code>; old <code>/admin</code> redirects here).
            </Card.Description>
          </Card.Content>
        </Card>
        {uf.sidechain ? (
          <Card as={Link} to="/sidechains" style={{ cursor: 'pointer' }}>
            <Card.Content>
              <Card.Header>
                <Icon name="random" aria-hidden="true" /> Sidechain &amp; demo
              </Card.Header>
              <Card.Description>
                Global state, JSON patches, and operator context (same route as <strong>More</strong> → Sidechain).
              </Card.Description>
            </Card.Content>
          </Card>
        ) : null}
        {uf.sidechain ? (
          <Card as={Link} to="/settings/admin/beacon-federation" style={{ cursor: 'pointer' }}>
            <Card.Content>
              <Card.Header>
                <Icon name="star" aria-hidden="true" /> Beacon Federation
              </Card.Header>
              <Card.Description>
                L1-bound epochs, manifest links, and federation witness walkthrough (same as <strong>More</strong> → Beacon Federation).
              </Card.Description>
            </Card.Content>
          </Card>
        ) : null}
        {uf.sidechain ? (
          <Card as={Link} to="/settings/federation" style={{ cursor: 'pointer' }}>
            <Card.Content>
              <Card.Header>
                <Icon name="users" aria-hidden="true" /> Distributed federation
              </Card.Header>
              <Card.Description>
                Configure validator pubkeys and threshold for sidechain patches and beacon epochs (when not overridden by environment).
                For L1-bound epochs and reproducible Schnorr witnesses, see{' '}
                <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>
                {' '}
                and the live{' '}
                <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">manifest</a>
                {' / '}
                <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">epoch</a>
                {' '}JSON.
              </Card.Description>
            </Card.Content>
          </Card>
        ) : null}
        {uf.bitcoinResources ? (
          <Card as={Link} to="/services/bitcoin/resources" style={{ cursor: 'pointer' }}>
            <Card.Content>
              <Card.Header>
                <Icon name="code" aria-hidden="true" /> Bitcoin HTTP resources
              </Card.Header>
              <Card.Description>
                L1 payment verification, browse JSON from <code>/services/bitcoin</code> and <code>/services/lightning</code>, and quick-open common GET paths.
              </Card.Description>
            </Card.Content>
          </Card>
        ) : null}
      </Card.Group>
    </Segment>
  );
}

module.exports = SettingsHome;
