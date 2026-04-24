'use strict';

/**
 * Marketing / tour at `/features` (gated by Feature visibility). Splash FrontPage “Learn more” uses `#front-page-features`; keep grids aligned.
 */

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Container, Header, Icon, Segment } = require('semantic-ui-react');
const {
  BRAND_NAME,
  BRAND_TAGLINE,
  PITCH_CTA_TEXT
} = require('../locales/en');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { featuresPageIdentityButtonLabelFromStorage } = require('../functions/hubIdentityUiHints');
const { readStorageJSON } = require('../functions/fabricBrowserState');

function FeaturesPage () {
  const [hubUiTick, setHubUiTick] = React.useState(0);
  const [identityButtonLabel, setIdentityButtonLabel] = React.useState('Log in');

  const refreshIdentityButtonLabel = React.useCallback(() => {
    if (typeof window === 'undefined') {
      setIdentityButtonLabel('Log in');
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

  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  React.useEffect(() => {
    refreshIdentityButtonLabel();
    if (typeof window === 'undefined') return undefined;
    const onStorage = () => refreshIdentityButtonLabel();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshIdentityButtonLabel]);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();
  const hasAdminToken = !!readHubAdminTokenFromBrowser();
  const showPeersShortcut = uf.peers && hasAdminToken;

  return (
    <fabric-hub-features className="fade-in">
      <Segment>
        <Button as={Link} to="/" basic size="small" aria-label="Back to home">
          <Icon name="arrow left" aria-hidden="true" />
          Home
        </Button>
        <Header as="h1" id="features-page-heading" style={{ marginTop: '0.75em' }}>
          Features
        </Header>
        <p style={{ color: '#666', maxWidth: '42rem', lineHeight: 1.45 }}>
          <strong>{BRAND_NAME}</strong> — {BRAND_TAGLINE}. Identity and signing use standard Bitcoin cryptography (secp256k1; BIP32/BIP39-style keys in the browser). <strong>Distributed storage</strong> (publish, distribute, encrypted documents) and <strong>distributed execution</strong> (deterministic programs, optional L1-backed registry) live under Documents and Contracts. The{' '}
          <Link to="/services/bitcoin">Bitcoin</Link> dashboard stays available; Notifications, the activity log, Features, block/tx explorer, and other areas follow toggles in{' '}
          <Link to="/settings/admin">Admin</Link> → Feature visibility. The shortcuts below match home and the <strong>More</strong> menu when those routes are enabled.
        </p>
      </Segment>

      <div className="ui vertical stripe segment">
        <Container text>
          <Header as="h2" style={{ fontSize: '2em', textAlign: 'center' }}>
            {PITCH_CTA_TEXT}
          </Header>
          <div className="ui three column stackable grid" style={{ marginTop: '2em' }}>
            <div className="column">
              <div className="ui segment">
                <Header as="h3" style={{ textAlign: 'center' }}>
                  <Icon name="shield" size="large" aria-hidden="true" />
                  <Header.Content>Security</Header.Content>
                </Header>
                <p style={{ textAlign: 'center' }}>
                  Portable browser identity (standard secp256k1 / BIP32-style keys), unlock/lock, end-to-end encryption for documents, and optional desktop delegation in{' '}
                  <Link to="/settings/security">Security &amp; delegation</Link>.
                </p>
              </div>
            </div>
            <div className="column">
              <div className="ui segment">
                <Header as="h3" style={{ textAlign: 'center' }}>
                  <Icon name="users" size="large" aria-hidden="true" />
                  <Header.Content>Collaboration</Header.Content>
                </Header>
                <p style={{ textAlign: 'center' }}>
                  Fabric peers, WebRTC mesh, chat, and document workflows (publish, distribute, optional encrypted inventory).
                  {uf.sidechain ? (
                    <> Global <Link to="/sidechains">Sidechain</Link> state and </>
                  ) : (
                    <> Global sidechain state (enable Sidechain in Admin → Feature visibility) and </>
                  )}
                  <Link to="/contracts">Contracts</Link> (storage + execution) tie into the same hub.
                </p>
              </div>
            </div>
            <div className="column">
              <div className="ui segment">
                <Header as="h3" style={{ textAlign: 'center' }}>
                  <Icon name="bitcoin" size="large" aria-hidden="true" />
                  <Header.Content>Bitcoin</Header.Content>
                </Header>
                <p style={{ textAlign: 'center' }}>
                  Regtest tooling, invoices, Payjoin-oriented payments, and Lightning when enabled. Beacon epochs bind hub state to L1; execution runs use a deterministic commitment separate from federation witnesses
                  {uf.sidechain ? (
                    <> — see <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>.</>
                  ) : (
                    <> — enable Sidechain in Admin → Feature visibility for the Beacon Federation walkthrough.</>
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
            title="Open the same Fabric identity manager as the top bar (create, import, unlock)"
            aria-label={`Fabric identity — ${identityButtonLabel}`}
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('fabricOpenIdentityManager'));
              }
            }}
          >
            <Icon name="user" aria-hidden="true" />
            {identityButtonLabel}
          </Button>
          {showPeersShortcut ? (
            <Button as={Link} to="/peers" basic icon labelPosition="left">
              <Icon name="sitemap" aria-hidden="true" />
              Peers
            </Button>
          ) : null}
          <Button as={Link} to="/documents" basic icon labelPosition="left">
            <Icon name="file outline" aria-hidden="true" />
            Documents
          </Button>
          <Button as={Link} to="/contracts" basic icon labelPosition="left">
            <Icon name="file code" aria-hidden="true" />
            Contracts
          </Button>
          {uf.activities ? (
            <Button as={Link} to="/notifications" basic icon labelPosition="left" title="Wallet, Payjoin, and hub toasts (bell in the top bar)">
              <Icon name="bell outline" aria-hidden="true" />
              Notifications
            </Button>
          ) : null}
          {uf.activities ? (
            <Button as={Link} to="/activities" basic icon labelPosition="left" title="Hub message log, chat, Bitcoin blocks">
              <Icon name="comments" aria-hidden="true" />
              Activity log
            </Button>
          ) : null}
          {uf.sidechain ? (
            <Button as={Link} to="/sidechains" basic icon labelPosition="left">
              <Icon name="random" aria-hidden="true" />
              Sidechain
            </Button>
          ) : null}
          {uf.sidechain ? (
            <Button
              as={Link}
              to="/settings/admin/beacon-federation"
              basic
              icon
              labelPosition="left"
              title="L1-bound beacon epochs, manifest, federation witnesses"
            >
              <Icon name="star" aria-hidden="true" />
              Beacon Federation
            </Button>
          ) : null}
          {uf.sidechain ? (
            <Button as={Link} to="/federations" basic icon labelPosition="left" title="Multi-sig validator policy (k-of-n)">
              <Icon name="users" aria-hidden="true" />
              Federations
            </Button>
          ) : null}
          <Button as={Link} to="/services/bitcoin" basic icon labelPosition="left">
            <Icon name="bitcoin" aria-hidden="true" />
            Bitcoin
          </Button>
          {uf.bitcoinPayments ? (
            <Button as={Link} to="/payments" basic icon labelPosition="left">
              <Icon name="credit card outline" aria-hidden="true" />
              Payments
            </Button>
          ) : null}
          <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic icon labelPosition="left">
            <Icon name="file alternate outline" aria-hidden="true" />
            Invoices
          </Button>
          {uf.bitcoinLightning ? (
            <Button as={Link} to="/services/bitcoin#fabric-bitcoin-lightning" basic icon labelPosition="left" title="Invoices, decode, pay via Hub Lightning bridge">
              <Icon name="bolt" aria-hidden="true" />
              Lightning
            </Button>
          ) : null}
          {uf.bitcoinExplorer ? (
            <Button as={Link} to="/services/bitcoin/blocks" basic icon labelPosition="left" title="Block explorer — recent blocks and mempool">
              <Icon name="search" aria-hidden="true" />
              Explorer
            </Button>
          ) : null}
          {uf.bitcoinResources ? (
            <Button as={Link} to="/services/bitcoin/resources" basic icon labelPosition="left">
              <Icon name="code" aria-hidden="true" />
              Resources
            </Button>
          ) : null}
          {uf.bitcoinCrowdfund ? (
            <Button as={Link} to="/services/bitcoin/crowdfunds" basic icon labelPosition="left" title="Taproot vault, ACP donation PSBT, Payjoin to campaign">
              <Icon name="heart outline" aria-hidden="true" />
              Crowdfunds
            </Button>
          ) : null}
          <Button as={Link} to="/settings/admin" basic icon labelPosition="left">
            <Icon name="settings" aria-hidden="true" />
            Admin
          </Button>
          <Button as={Link} to="/settings" basic icon labelPosition="left">
            <Icon name="setting" aria-hidden="true" />
            Settings
          </Button>
          <Button as={Link} to="/settings/security" basic icon labelPosition="left" title="Unlock, delegation, same destination as Log in">
            <Icon name="shield" aria-hidden="true" />
            Security & delegation
          </Button>
        </div>
      </Segment>
    </fabric-hub-features>
  );
}

module.exports = FeaturesPage;
