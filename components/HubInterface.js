'use strict';

// Constants
const {
  BRAND_NAME,
  BROWSER_DATABASE_NAME,
  BROWSER_DATABASE_TOKEN_TABLE
} = require('../constants');
const {
  DELEGATION_STORAGE_KEY,
  notifyDelegationStorageChanged,
  hasExternalSigningDelegation
} = require('../functions/fabricDelegationLocal');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');

// Dependencies
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { renderToString } = require('react-dom/server');
const {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useLocation,
  useSearchParams,
  useParams
} = require('react-router-dom');

// Fabric Types
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');

// Components
const Bridge = require('./Bridge');
const BitcoinHome = require('./BitcoinHome');
const Onboarding = require('./Onboarding');
const BitcoinBlockView = require('./BitcoinBlockView');
const BitcoinPaymentsHome = require('./BitcoinPaymentsHome');

function BitcoinPaymentsHomeRoute (props) {
  const [searchParams, setSearchParams] = useSearchParams();
  React.useEffect(() => {
    try {
      if (!searchParams.has('bip44Account')) return;
      const sp = new URLSearchParams(searchParams);
      sp.delete('bip44Account');
      setSearchParams(sp, { replace: true });
    } catch (_) { /* ignore */ }
  }, [searchParams, setSearchParams]);
  const payjoinSessionFromQuery = String(searchParams.get('payjoinSession') || '').trim();
  const payToFromQuery = String(searchParams.get('payTo') || '').trim();
  const payAmountSatsFromQuery = searchParams.get('payAmountSats');
  const bitcoinUriFromQuery = String(searchParams.get('bitcoinUri') || '').trim();
  return (
    <BitcoinPaymentsHome
      {...props}
      paymentsSetSearchParams={setSearchParams}
      payjoinSessionFromQuery={payjoinSessionFromQuery}
      payToFromQuery={payToFromQuery}
      payAmountSatsFromQuery={payAmountSatsFromQuery}
      bitcoinUriFromQuery={bitcoinUriFromQuery}
    />
  );
}

/** Legacy singular `/document/...` → plural canonical `/documents/...`. */
function NavigateDocumentsDetailAlias () {
  const { id } = useParams();
  const raw = id != null ? String(id).trim() : '';
  if (!raw) return <Navigate to="/documents" replace />;
  return <Navigate to={`/documents/${encodeURIComponent(raw)}`} replace />;
}

/** Legacy singular `/peer/...` → plural canonical `/peers/...`. */
function NavigatePeerDetailAlias () {
  const f = loadHubUiFeatureFlags();
  if (!f.peers) return <Navigate to="/" replace />;
  const { id } = useParams();
  const raw = id != null ? String(id).trim() : '';
  if (!raw) return <Navigate to="/peers" replace />;
  return <Navigate to={`/peers/${encodeURIComponent(raw)}`} replace />;
}

function NavigatePeerRootAlias () {
  const f = loadHubUiFeatureFlags();
  if (!f.peers) return <Navigate to="/" replace />;
  return <Navigate to="/peers" replace />;
}

function NavigateActivityToActivities () {
  const f = loadHubUiFeatureFlags();
  if (!f.activities) return <Navigate to="/" replace />;
  return <Navigate to="/activities" replace />;
}

function UiFlagRoute ({ flag, children }) {
  const f = loadHubUiFeatureFlags();
  if (!f[flag]) return <Navigate to="/" replace />;
  return children;
}

/** Legacy `/tx/...` bookmark → canonical Bitcoin transaction view. */
function NavigateLegacyBitcoinTxAlias () {
  const f = loadHubUiFeatureFlags();
  if (!f.bitcoinExplorer) return <Navigate to="/" replace />;
  const { txhash } = useParams();
  const raw = txhash != null ? String(txhash).trim() : '';
  if (!raw) return <Navigate to="/services/bitcoin" replace />;
  return <Navigate to={`/services/bitcoin/transactions/${encodeURIComponent(raw)}`} replace />;
}

/** Legacy `/block/...` bookmark → canonical Bitcoin block view. */
function NavigateLegacyBitcoinBlockAlias () {
  const f = loadHubUiFeatureFlags();
  if (!f.bitcoinExplorer) return <Navigate to="/" replace />;
  const { blockhash } = useParams();
  const raw = blockhash != null ? String(blockhash).trim() : '';
  if (!raw) {
    return <Navigate to={{ pathname: '/services/bitcoin', hash: 'bitcoin-explorer' }} replace />;
  }
  return <Navigate to={`/services/bitcoin/blocks/${encodeURIComponent(raw)}`} replace />;
}

function UnknownRouteShell () {
  const { pathname, search } = useLocation();
  const full = `${pathname || ''}${search || ''}` || '/';
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();
  return (
    <Segment style={{ marginTop: '2em' }}>
      <Header as="h3">Page not found</Header>
      <p style={{ color: '#666', marginBottom: '1em' }}>
        No hub UI for{' '}
        <code style={{ wordBreak: 'break-all' }}>{full}</code>
        . Use the nav above or open Home.
        {uf.activities ? ' The activity feed and in-app toasts are under the bell (top bar).' : ''}
        {!uf.features ? ' Enable “Features” in Admin → Feature visibility for the full product tour at /features.' : ''}
      </p>
      <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }} role="navigation" aria-label="Suggested pages">
        <Button as={Link} to="/" primary aria-label="Home">
          <Icon name="home" />
          Home
        </Button>
        <Button as={Link} to="/documents" basic aria-label="Documents">
          <Icon name="folder open" />
          Documents
        </Button>
        <Button as={Link} to="/contracts" basic aria-label="Contracts">
          <Icon name="file contract" />
          Contracts
        </Button>
        {uf.peers ? (
          <Button as={Link} to="/peers" basic aria-label="Peers">
            <Icon name="sitemap" />
            Peers
          </Button>
        ) : null}
        {uf.activities ? (
          <Button as={Link} to="/activities" basic aria-label="Activities">
            <Icon name="bell outline" />
            Activities
          </Button>
        ) : null}
        {uf.features ? (
          <Button as={Link} to="/features" basic aria-label="Features">
            <Icon name="info circle" />
            Features
          </Button>
        ) : null}
        {uf.sidechain ? (
          <Button as={Link} to="/sidechains" basic aria-label="Sidechain and demo">
            <Icon name="random" />
            Sidechain
          </Button>
        ) : null}
        <Button as={Link} to="/services/bitcoin" basic aria-label="Bitcoin">
          <Icon name="bitcoin" />
          Bitcoin
        </Button>
        {uf.bitcoinResources ? (
          <Button as={Link} to="/services/bitcoin/resources" basic aria-label="Bitcoin HTTP resources">
            <Icon name="code" />
            Bitcoin resources
          </Button>
        ) : null}
        {uf.bitcoinPayments ? (
          <Button as={Link} to="/services/bitcoin/payments" basic aria-label="Payments">
            <Icon name="credit card outline" />
            Payments
          </Button>
        ) : null}
        {uf.bitcoinInvoices ? (
          <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic aria-label="Invoices">
            <Icon name="file alternate outline" />
            Invoices
          </Button>
        ) : null}
        <Button as={Link} to="/settings" basic aria-label="Settings">
          <Icon name="setting" />
          Settings
        </Button>
        <Button as={Link} to="/settings/admin" basic aria-label="Admin">
          <Icon name="settings" />
          Admin
        </Button>
        {uf.sidechain ? (
          <React.Fragment>
            <Button as={Link} to="/settings/admin/beacon-federation" basic aria-label="Beacon Federation">
              <Icon name="star" />
              Beacon Federation
            </Button>
            <Button as={Link} to="/settings/federation" basic aria-label="Distributed federation">
              <Icon name="sliders horizontal" />
              Federation
            </Button>
          </React.Fragment>
        ) : null}
        <Button as={Link} to="/settings/security" basic aria-label="Security and delegation">
          <Icon name="shield" />
          Security & delegation
        </Button>
      </div>
    </Segment>
  );
}

const BitcoinResourcesHome = require('./BitcoinResourcesHome');
const BitcoinTransactionView = require('./BitcoinTransactionView');
const ChannelView = require('./ChannelView');
const InvoiceListHome = require('./InvoiceListHome');

function InvoiceListHomeRoute (props) {
  return <InvoiceListHome {...props} />;
}

const BottomPanel = require('./BottomPanel');
const ContractList = require('./ContractList');
const ContractView = require('./ContractView');
const DocumentList = require('./DocumentList');
const DocumentView = require('./DocumentView');
const Home = require('./Home');
const ActivitiesHome = require('./ActivitiesHome');
const IdentityManager = require('./IdentityManager');
const PeerList = require('./PeerList');
const PeerView = require('./PeerView');
const TopPanel = require('./TopPanel');
const {
  getSpendWalletContext,
  fetchWalletSummaryWithCache,
  loadUpstreamSettings,
  saveSpendXpubWatchForIdentity,
  clearSpendXpubWatch
} = require('../functions/bitcoinClient');
const { ToastContainer, toast: toastify, Slide } = require('react-toastify');
const { toast } = require('../functions/toast');
const SecurityHome = require('./SecurityHome');
const SecuritySessionHome = require('./SecuritySessionHome');
const SettingsHome = require('./SettingsHome');
const SettingsFederationHome = require('./SettingsFederationHome');
const SettingsBitcoinWallet = require('./SettingsBitcoinWallet');
const FederationContractInviteModal = require('./FederationContractInviteModal');
const FeaturesPage = require('./FeaturesPage');
const SidechainHome = require('./SidechainHome');
const DelegationSigningModal = require('./DelegationSigningModal');
const AdminHome = require('./AdminHome');
const BeaconFederationHome = require('./BeaconFederationHome');

/**
 * Wallet-safe Bitcoin snapshot from GetNetworkStatus / pushNetworkStatus.
 * The hub puts it on the top-level `bitcoin` key; a copy may also exist under `state.services.bitcoin`.
 * @param {object|null|undefined} networkStatus
 * @returns {object|null}
 */
function resolveBitcoinFromNetworkStatus (networkStatus) {
  if (!networkStatus || typeof networkStatus !== 'object') return null;
  const top = networkStatus.bitcoin;
  if (top && typeof top === 'object' && !Array.isArray(top)) {
    return top;
  }
  const svc = networkStatus.state && networkStatus.state.services && networkStatus.state.services.bitcoin;
  if (!svc || typeof svc !== 'object') return null;
  if (svc.status && typeof svc.status === 'object') return svc.status;
  return svc;
}

// Semantic UI
const {
  Modal,
  Button,
  Form,
  Header,
  Icon,
  Input,
  Loader,
  Message,
  Segment
} = require('semantic-ui-react');

function BitcoinHomeWithNav (props) {
  const navigate = useNavigate();
  const location = useLocation();
  React.useLayoutEffect(() => {
    const raw = location.hash || '';
    const h = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!h) return;
    const el = document.getElementById(h);
    if (el && typeof el.scrollIntoView === 'function') {
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  }, [location.pathname, location.hash]);
  return <BitcoinHome {...props} navigate={navigate} />;
}

/**
 * Login wall: shown when user tries to access a gated route without a local identity.
 */
function LoginGate (props) {
  const onLogin = props && typeof props.onLogin === 'function' ? props.onLogin : null;
  return (
    <Segment placeholder style={{ marginTop: '2em', textAlign: 'center' }}>
      <Header icon>
        <Icon name="lock" />
        Log in required
      </Header>
      <p style={{ color: '#666', marginBottom: '1em' }}>
        Create or restore a local identity to access this feature.
      </p>
      <Button primary onClick={() => onLogin && onLogin()}>
        <Icon name="user circle" />
        Log in
      </Button>
    </Segment>
  );
}

/**
 * The Hub UI.
 */
class HubInterface extends React.Component {
  constructor (props) {
    super(props);

    let initialHubAddress = '';
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        initialHubAddress = window.localStorage.getItem('fabric.hub.address') || '';
      }
    } catch (e) {}
    if (!initialHubAddress) {
      try {
        if (typeof window !== 'undefined' && window.location) {
          const host = window.location.hostname;
          const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
          initialHubAddress = `${host}:${port}`;
        }
      } catch (e) {}
    }

    let initialAdminToken = null;
    let initialAdminTokenExpiresAt = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        initialAdminToken = window.localStorage.getItem('fabric.hub.adminToken') || null;
        const raw = window.localStorage.getItem('fabric.hub.adminTokenExpiresAt');
        if (raw) initialAdminTokenExpiresAt = Number(raw) || null;
      }
    } catch (e) {}

    let initialLocalIdentity = null;
    let initialHasLockedIdentity = false;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // Dev-only: window.FABRIC_DEV_BROWSER_SEED (+ optional FABRIC_DEV_BROWSER_PASSPHRASE) from
        // assets/config.local.js or hub HTML injection (FABRIC_DEV_PUSH_BROWSER_IDENTITY). Sharing the
        // node mnemonic with the browser is discouraged except for local regtest.
        const devPhraseRaw = window.FABRIC_DEV_BROWSER_SEED || window.FABRIC_DEV_BROWSER_MNEMONIC;
        const devPhrase = devPhraseRaw ? String(devPhraseRaw).trim() : '';
        const devPassRaw = window.FABRIC_DEV_BROWSER_PASSPHRASE || window.FABRIC_DEV_PASSPHRASE;
        const devPass = devPassRaw != null && String(devPassRaw).trim() !== '' ? String(devPassRaw) : undefined;
        const devForce = window.FABRIC_DEV_BROWSER_IDENTITY === 'force';
        if (devPhrase) {
          try {
            const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
            const r = storeUnlockedIdentityFromMnemonic({
              seed: devPhrase,
              passphrase: devPass,
              force: devForce
            });
            if (r.ok && typeof console !== 'undefined' && console.warn) {
              console.warn(
                '[HUB] Stored local identity from FABRIC_DEV_BROWSER_* (development only; prefer a separate browser key when possible).'
              );
            } else if (!r.ok && devForce && typeof console !== 'undefined' && console.warn) {
              console.warn('[HUB] FABRIC_DEV_BROWSER_* bootstrap failed:', r.error);
            }
          } catch (e) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[HUB] FABRIC_DEV_BROWSER_* ignored:', e && e.message ? e.message : e);
            }
          }
        }

        let unlockedSession = null;
        try {
          if (window.sessionStorage) {
            const rawSession = window.sessionStorage.getItem('fabric.identity.unlocked');
            if (rawSession) {
              const parsedSession = JSON.parse(rawSession);
              if (parsedSession && parsedSession.xprv) {
                const sessionIdentity = new Identity({ xprv: parsedSession.xprv });
                unlockedSession = {
                  id: sessionIdentity.id,
                  xpub: sessionIdentity.key.xpub,
                  xprv: parsedSession.xprv,
                  passwordProtected: !!parsedSession.passwordProtected
                };
              }
            }
          }
        } catch (e) {}

        const raw = window.localStorage.getItem('fabric.identity.local');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.xprv && !parsed.passwordProtected) {
            try {
              const ident = new Identity({ xprv: parsed.xprv });
              initialLocalIdentity = {
                id: ident.id,
                xpub: ident.key.xpub,
                xprv: parsed.xprv
              };
            } catch (e) {}
          } else if (parsed && parsed.passwordProtected && parsed.id && parsed.xpub) {
            const sessionMatches = !!(
              unlockedSession &&
              unlockedSession.xprv &&
              (String(unlockedSession.id) === String(parsed.id) || String(unlockedSession.xpub) === String(parsed.xpub))
            );

            if (sessionMatches) {
              initialLocalIdentity = {
                id: unlockedSession.id,
                xpub: unlockedSession.xpub,
                xprv: unlockedSession.xprv,
                passwordProtected: true
              };
            } else {
              initialLocalIdentity = {
                id: parsed.id,
                xpub: parsed.xpub
              };
              initialHasLockedIdentity = true;
            }
          } else if (parsed && parsed.xpub) {
            try {
              const key = new Key({ xpub: parsed.xpub });
              const ident = new Identity(key);
              initialLocalIdentity = {
                id: ident.id,
                xpub: key.xpub
              };
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    this.state = {
      debug: false,
      isAuthenticated: false,
      isLoading: true,
      needsSetup: false,
      setupChecked: false,
      adminToken: initialAdminToken,
      adminTokenExpiresAt: initialAdminTokenExpiresAt,
      modalLogOut: false,
      loggedOut: false,
      uiSettingsOpen: false,
      uiHubAddress: initialHubAddress,
      uiHubAddressDraft: initialHubAddress,
      uiHubAddressError: null,
      uiIdentityOpen: false,
      uiSignMessageOpen: false,
      uiSignMessageText: '',
      uiSignMessageResult: null,
      uiSignMessageBusy: false,
      uiVerifyMessageText: '',
      uiVerifySignature: '',
      uiVerifyPublicKey: '',
      uiVerifyResult: null,
      uiDestroyIdentityConfirmOpen: false,
      clientBalance: null,
      clientBalanceLoading: false,
      uiLocalIdentity: initialLocalIdentity,
      uiHasLockedIdentity: initialHasLockedIdentity,
      webrtcChatOnly: false,
      federationInviteModalOpen: false,
      federationInviteDetail: null
    };

    this.handleBridgeStateUpdate = this.handleBridgeStateUpdate.bind(this);
    this.responseCapture = this.responseCapture.bind(this);
    this.requestLogin = this.requestLogin.bind(this);
    this.openIdentityManager = this.openIdentityManager.bind(this);

    // Instantiate Bridge once here
    this.bridgeRef = React.createRef();

    this._state = {
      actors: {},
      content: this.state
    };

    return this;
  }

  async _checkSetupStatus () {
    try {
      const base = typeof window !== 'undefined' && window.location
        ? `${window.location.protocol}//${window.location.host}`
        : 'http://localhost:8080';
      const res = await fetch(`${base}/settings`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith('<')) {
          this.setState({ setupChecked: true });
          return;
        }
        const data = JSON.parse(text);
        this.setState({
          needsSetup: !!data.needsSetup,
          setupChecked: true
        });
      } else {
        this.setState({ setupChecked: true });
      }
    } catch (e) {
      this.setState({ setupChecked: true });
    }
  }

  async _refreshAdminTokenIfNeeded () {
    const token = this.state.adminToken || (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('fabric.hub.adminToken'));
    if (!token) return;
    const expiresAt = this.state.adminTokenExpiresAt || (typeof window !== 'undefined' && window.localStorage && (() => {
      const raw = window.localStorage.getItem('fabric.hub.adminTokenExpiresAt');
      return raw ? Number(raw) : null;
    })());
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (expiresAt && Date.now() < expiresAt - thirtyDaysMs) return; // No refresh needed
    try {
      const base = typeof window !== 'undefined' && window.location
        ? `${window.location.protocol}//${window.location.host}`
        : 'http://localhost:8080';
      const res = await fetch(`${base}/settings/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ token })
      });
      if (!res.ok) return;
      const text = await res.text();
      if (text.trim().startsWith('<')) return;
      const result = JSON.parse(text);
      if (result && result.token) {
        this.setState({ adminToken: result.token, adminTokenExpiresAt: result.expiresAt });
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem('fabric.hub.adminToken', result.token);
            if (result.expiresAt != null) {
              window.localStorage.setItem('fabric.hub.adminTokenExpiresAt', String(result.expiresAt));
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  requestLogin () {
    // Prefer host-provided handler (browser extension or outer app).
    if (typeof this.props.onLogin === 'function') {
      this.props.onLogin();
      return;
    }

    // Fallback: try a generic identity manager open handler if provided.
    if (typeof this.props.onOpenIdentityManager === 'function') {
      this.props.onOpenIdentityManager();
      return;
    }

    // Fallback: open built-in IdentityManager modal.
    this.setState({ uiIdentityOpen: true });
  }

  openIdentityManager () {
    if (typeof this.props.onOpenIdentityManager === 'function') {
      this.props.onOpenIdentityManager();
      return;
    }

    this.setState({ uiIdentityOpen: true });
  }

  _handleFederationInviteResponse (d) {
    if (!d || typeof d.accept !== 'boolean') return;
    if (!d.accept) {
      toastify.info('A peer declined your federation contract invite.', { transition: Slide });
      return;
    }
    const admin = this.state.adminToken || (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('fabric.hub.adminToken'));
    const pk = d.responderPubkey;
    if (!pk) {
      toastify.warning('Federation invite accepted but no responder pubkey was included.', { transition: Slide });
      return;
    }
    if (!admin) {
      toastify.info(`Peer accepted federation invite (pubkey ${pk.slice(0, 10)}…). Use an admin session to add them under Settings → Federation.`, { transition: Slide, autoClose: 8000 });
      return;
    }
    const self = this;
    const token = String(admin).trim();
    toastify.info(
      ({ closeToast }) => (
        <div>
          <p style={{ margin: '0 0 0.6em', fontSize: '0.95rem' }}>Federation invite accepted.</p>
          <button
            type="button"
            style={{
              marginRight: '0.5em',
              padding: '0.45em 0.75em',
              borderRadius: 4,
              border: '1px solid #2185d0',
              background: '#2185d0',
              color: '#fff',
              cursor: 'pointer'
            }}
            onClick={() => {
              void self._addFederationMemberFromInvite(pk, token, closeToast);
            }}
          >
            Add to validators
          </button>
          <button
            type="button"
            style={{
              padding: '0.45em 0.75em',
              borderRadius: 4,
              border: '1px solid #ccc',
              background: '#f4f4f4',
              cursor: 'pointer'
            }}
            onClick={() => (typeof closeToast === 'function' ? closeToast() : null)}
          >
            Dismiss
          </button>
        </div>
      ),
      { autoClose: false, closeOnClick: false, transition: Slide }
    );
  }

  async _addFederationMemberFromInvite (pubkey, adminToken, closeToast) {
    try {
      const base = typeof window !== 'undefined' && window.location
        ? `${window.location.protocol}//${window.location.host}`
        : '';
      const res = await fetch(`${base}/services/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'AddDistributedFederationMember',
          params: [{ pubkey, adminToken }]
        })
      });
      const body = await res.json().catch(() => ({}));
      if (body.error || !res.ok) {
        toastify.error((body.error && body.error.message) || 'Add member failed', { transition: Slide });
        return;
      }
      toastify.success('Validator added to federation policy.', { transition: Slide });
      if (typeof closeToast === 'function') closeToast();
    } catch (e) {
      toastify.error(e && e.message ? e.message : String(e), { transition: Slide });
    }
  }

  componentDidMount () {
    console.debug('[HUB]', 'Component mounted!');
    this._checkSetupStatus();
    this._refreshAdminTokenIfNeeded();
    this._refreshClientBalance();
    this._onGlobalStateUpdate = (e) => {
      const d = e && e.detail;
      if (d && d.operation && d.operation.path === '/bitcoin') {
        const idn = this.state.uiLocalIdentity || this.props.auth || null;
        if (idn && idn.xpub) this._refreshClientBalance();
      }
    };
    this._onClientBalanceUpdate = () => {
      const idn = this.state.uiLocalIdentity || this.props.auth || null;
      if (idn && idn.xpub) this._refreshClientBalance();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('globalStateUpdate', this._onGlobalStateUpdate);
      window.addEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);
      this._onFabricHubAdminTokenSaved = () => {
        try {
          const t = window.localStorage && window.localStorage.getItem('fabric.hub.adminToken');
          if (t) this.setState({ adminToken: t });
        } catch (e) {}
      };
      window.addEventListener('fabricHubAdminTokenSaved', this._onFabricHubAdminTokenSaved);
      this._fabricFedInvite = (ev) => {
        const d = ev && ev.detail;
        if (d && d.inviteId) this.setState({ federationInviteModalOpen: true, federationInviteDetail: d });
      };
      this._fabricFedResp = (ev) => {
        this._handleFederationInviteResponse(ev && ev.detail);
      };
      window.addEventListener('fabric:federationContractInvite', this._fabricFedInvite);
      window.addEventListener('fabric:federationContractInviteResponse', this._fabricFedResp);
      this._adminTokenRefreshInterval = setInterval(() => this._refreshAdminTokenIfNeeded(), 24 * 60 * 60 * 1000);
    }
    this._toastUnsub = toast.addListener((t) => {
      const msg = t.header ? `${t.header}: ${t.message}` : t.message;
      const opts = { autoClose: t.duration || 4000, transition: Slide };
      if (t.type === 'success') toastify.success(msg, opts);
      else if (t.type === 'error') toastify.error(msg, opts);
      else if (t.type === 'warning') toastify.warning(msg, opts);
      else toastify.info(msg, opts);
    });
    if (typeof window !== 'undefined') {
      this._hubUiUnsub = subscribeHubUiFeatureFlags(() => this.forceUpdate());
    }
  }

  componentWillUnmount () {
    console.debug('[HUB]', 'Cleaning up...');
    if (typeof this._hubUiUnsub === 'function') this._hubUiUnsub();
    if (typeof this._toastUnsub === 'function') this._toastUnsub();
    if (typeof window !== 'undefined') {
      if (this._onGlobalStateUpdate) window.removeEventListener('globalStateUpdate', this._onGlobalStateUpdate);
      if (this._onClientBalanceUpdate) window.removeEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);
      if (this._onFabricHubAdminTokenSaved) {
        window.removeEventListener('fabricHubAdminTokenSaved', this._onFabricHubAdminTokenSaved);
      }
      if (this._fabricFedInvite) window.removeEventListener('fabric:federationContractInvite', this._fabricFedInvite);
      if (this._fabricFedResp) window.removeEventListener('fabric:federationContractInviteResponse', this._fabricFedResp);
      if (this._adminTokenRefreshInterval) clearInterval(this._adminTokenRefreshInterval);
    }
  }

  componentDidUpdate (prevProps, prevState) {
    const prevXpub = (prevState.uiLocalIdentity || prevProps.auth || {}).xpub;
    const nextXpub = (this.state.uiLocalIdentity || this.props.auth || {}).xpub;
    if (prevXpub !== nextXpub) this._refreshClientBalance();
  }

  async _refreshClientBalance (forceRefresh = false) {
    const identity = this.state.uiLocalIdentity || this.props.auth || null;
    const wallet = getSpendWalletContext(identity || {});
    if (!wallet.walletId || !wallet.xpub) {
      this.setState({ clientBalance: null, clientBalanceLoading: false });
      return;
    }
    const prevRow = this.state.clientBalance;
    const prevWid = prevRow && prevRow.walletId ? String(prevRow.walletId) : '';
    const nextWid = String(wallet.walletId || '');
    if (prevWid && nextWid && prevWid !== nextWid) {
      this.setState({ clientBalance: null });
    }
    this.setState({ clientBalanceLoading: true });
    const bridgeInstance = this.bridgeRef && this.bridgeRef.current;
    const networkStatus = bridgeInstance && (bridgeInstance.networkStatus || bridgeInstance.lastNetworkStatus);
    const bitcoin = resolveBitcoinFromNetworkStatus(networkStatus);
    const network = (bitcoin && bitcoin.network) ? String(bitcoin.network).toLowerCase() : 'regtest';
    try {
      const upstream = loadUpstreamSettings();
      const summary = await fetchWalletSummaryWithCache(upstream, wallet, { bypassCache: forceRefresh, network });
      const balanceSats = Number(summary.balanceSats ?? summary.balance ?? 0);
      if (Number.isFinite(balanceSats)) {
        const confirmedSats = Number(summary.confirmedSats ?? balanceSats);
        const unconfirmedSats = Number(summary.unconfirmedSats ?? 0);
        const nextClient = {
          walletId: wallet.walletId,
          balanceSats,
          confirmedSats,
          unconfirmedSats,
          fromCache: !!summary._fromCache
        };
        const prev = this.state.clientBalance;
        const changed = !prev ||
          String(prev.walletId || '') !== String(nextClient.walletId || '') ||
          Math.round(prev.balanceSats) !== Math.round(balanceSats) ||
          Math.round(prev.confirmedSats) !== Math.round(confirmedSats) ||
          Math.round(prev.unconfirmedSats) !== Math.round(unconfirmedSats);
        this.setState({ clientBalance: nextClient, clientBalanceLoading: false });
        if (identity && String(identity.xprv || '').trim()) {
          try { saveSpendXpubWatchForIdentity(identity, wallet); } catch (_) {}
        }
        if (changed && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('clientBalanceUpdate', {
            detail: {
              walletId: wallet.walletId,
              balanceSats,
              confirmedSats,
              unconfirmedSats
            }
          }));
        }
      } else {
        this.setState({ clientBalance: null, clientBalanceLoading: false });
      }
    } catch (e) {
      this.setState((prev) => ({
        clientBalance: prev.clientBalance,
        clientBalanceLoading: false
      }));
    }
  }

  _handleLockIdentity () {
    const local = this.state.uiLocalIdentity;
    if (!local || !local.xprv) return;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('fabric.identity.unlocked');
      }
      if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
        try { this.bridgeRef.current.clearDecryptedDocuments(); } catch (e) {}
      }
      this.setState({
        uiLocalIdentity: {
          id: local.id,
          xpub: local.xpub,
          passwordProtected: !!local.passwordProtected
        },
        uiHasLockedIdentity: true
      });
    } catch (e) {
      console.error('[HUB]', 'Error locking identity:', e);
    }
  }

  handleBridgeStateUpdate (newState) {
    if (!newState || typeof newState !== 'object') return;
    // Only merge Bridge-owned state; never overwrite identity/auth state from Bridge.
    const bridgeKeys = ['data', 'error', 'networkStatus', 'subscriptions', 'isConnected', 'webrtcConnected', 'currentPath'];
    const patch = {};
    for (const k of bridgeKeys) {
      if (Object.prototype.hasOwnProperty.call(newState, k)) patch[k] = newState[k];
    }
    if (Object.keys(patch).length > 0) {
      this.setState(patch);
    }
  }

  responseCapture (action) {
    try {
      if (!action || !action.content) return;

      const payload = JSON.parse(action.content);

      if (payload && payload.method === 'JSONCallResult') {
        let status = null;

        if (Array.isArray(payload.params) && payload.params.length > 0) {
          const candidate = payload.params[payload.params.length - 1];
          if (candidate && typeof candidate === 'object') {
            status = candidate;
          }
        } else if (payload.result && typeof payload.result === 'object') {
          status = payload.result;
        }

        // Only treat JSONCallResult as a network status update when it has the right shape.
        // Prevents overwriting `networkStatus` with `{ status: "success" }` from AddPeer/RemovePeer.
        const isNetworkStatus = status && typeof status === 'object' && (status.network || Array.isArray(status.peers));

        if (isNetworkStatus && status.setup && status.setup.needsSetup) {
          this.setState({ needsSetup: true });
        }

        if (isNetworkStatus && this.props.bridgeNetworkStatusUpdate) {
          this.props.bridgeNetworkStatusUpdate(status);
        }
      }
    } catch (error) {
      console.error('[HUB]', 'Error handling bridge response:', error);
    }
  }

  render () {
    // Prefer Bridge ref (live from WebSocket), then Redux, then local state
    const bridgeInstance = this.bridgeRef && this.bridgeRef.current;
    const nodePubkey = (bridgeInstance && typeof bridgeInstance.getNodePubkey === 'function' && bridgeInstance.getNodePubkey());
    const networkStatus = bridgeInstance && (bridgeInstance.networkStatus || bridgeInstance.lastNetworkStatus || null);
    const services = networkStatus && networkStatus.state && networkStatus.state.services;
    const bitcoin = resolveBitcoinFromNetworkStatus(networkStatus);

    // Auth: prefer in-session local identity (with id/xpub) so button shows identity after login
    const local = this.state.uiLocalIdentity;
    const hasLocal = local && (local.id || local.xpub);
    const effectiveAuth = hasLocal ? local : this.props.auth;
    // Never show "locked" when we have the key in memory
    const effectiveHasLockedIdentity = (local && local.xprv) ? false : this.state.uiHasLockedIdentity;

    return (
      <fabric-interface id={this.id} class="fabric-site">
        <style>
          {`
            fabric-react-component {
              margin: 1em;
            }

            .fade-in {
              animation: hub-fade-in 220ms ease-out;
            }

            /* Flex main: grows so BottomPanel sits at viewport bottom when content is short; flows after content when long. */
            .hub-app-shell {
              min-height: 100vh;
              display: flex;
              flex-direction: column;
              box-sizing: border-box;
              width: 100%;
            }

            .hub-main-with-fixed-footer {
              flex: 1 1 auto;
              min-height: 0;
              width: 100%;
              padding-bottom: 1rem;
              box-sizing: border-box;
            }

            @keyframes hub-fade-in {
              from {
                opacity: 0;
                transform: translateY(2px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `}
        </style>
        <fabric-container id="react-application">
          <fabric-react-component id='fabric-hub-application'>
            <Bridge
              ref={this.bridgeRef}
              auth={effectiveAuth}
              debug={this.state.debug}
              hubAddress={this.state.uiHubAddress}
              onRequireUnlock={() => this.setState({ uiIdentityOpen: true })}
              onStateUpdate={this.handleBridgeStateUpdate}
              responseCapture={this.responseCapture}
            />
            <DelegationSigningModal bridgeRef={this.bridgeRef} />
            <FederationContractInviteModal
              open={this.state.federationInviteModalOpen}
              detail={this.state.federationInviteDetail}
              onClose={() => this.setState({ federationInviteModalOpen: false, federationInviteDetail: null })}
              getResponderPubkey={() => {
                const b = this.bridgeRef && this.bridgeRef.current;
                return (b && typeof b.getNodePubkey === 'function' && b.getNodePubkey()) || '';
              }}
              onSendPeerMessage={(toPeerId, text) => {
                const b = this.bridgeRef && this.bridgeRef.current;
                if (b && typeof b.sendPeerMessageRequest === 'function') b.sendPeerMessageRequest(toPeerId, text);
              }}
            />
            {(this.props.auth && this.props.auth.loading) ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Loader active inline="centered" size='huge' />
              </div>
            ) : !this.state.setupChecked ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1em' }}>
                <Loader active inline="centered" size='large' />
                <p style={{ color: '#666', margin: 0 }}>Connecting to Hub…</p>
              </div>
            ) : this.state.needsSetup ? (
              <Onboarding
                nodeName="Hub"
                onConfigurationComplete={(result) => {
                  if (result && result.token) {
                    this.setState({
                      adminToken: result.token,
                      adminTokenExpiresAt: result.expiresAt,
                      needsSetup: false
                    });
                    if (typeof window !== 'undefined' && window.localStorage) {
                      try {
                        window.localStorage.setItem('fabric.hub.adminToken', result.token);
                        if (result.expiresAt != null) {
                          window.localStorage.setItem('fabric.hub.adminTokenExpiresAt', String(result.expiresAt));
                        }
                      } catch (e) {}
                    }
                  }
                }}
              />
            ) : (
              <BrowserRouter style={{ marginTop: 0 }}>
                <ToastContainer
                  position="bottom-center"
                  newestOnTop
                  closeOnClick
                  pauseOnFocusLoss
                  draggable
                  pauseOnHover
                  style={{ bottom: 'max(4.5rem, calc(3rem + env(safe-area-inset-bottom, 0px)))' }}
                />
                <div className="hub-app-shell">
                <TopPanel
                  hubAddress={this.state.uiHubAddress}
                  auth={effectiveAuth}
                  localIdentity={local}
                  hasLocalIdentity={!!hasLocal}
                  hasLockedIdentity={effectiveHasLockedIdentity}
                  bitcoin={bitcoin}
                  clientBalance={this.state.clientBalance}
                  clientBalanceLoading={this.state.clientBalanceLoading}
                  onRefreshBalance={() => this._refreshClientBalance(true)}
                  onUnlockIdentity={() => {
                    this.setState({ uiIdentityOpen: true });
                  }}
                  onLockIdentity={() => this._handleLockIdentity()}
                  onLogin={this.requestLogin}
                  onManageIdentity={this.openIdentityManager}
                  onProfile={this.openIdentityManager}
                  onSignMessage={() => this.setState({ uiSignMessageOpen: true })}
                  onDestroyIdentity={() => this.setState({ uiDestroyIdentityConfirmOpen: true })}
                  onOpenSettings={() => {
                    this.setState({
                      uiSettingsOpen: true,
                      uiHubAddressDraft: this.state.uiHubAddress,
                      uiHubAddressError: null
                    });
                  }}
                />

                <div className="hub-main-with-fixed-footer">
                <Modal
                  size="large"
                  open={!!this.state.uiIdentityOpen}
                  onClose={() => this.setState({ uiIdentityOpen: false })}
                >
                  <Modal.Content scrolling>
                    <IdentityManager
                      key={this.state.uiIdentityOpen ? 'open' : 'closed'}
                      currentIdentity={this.state.uiLocalIdentity}
                      onLocalIdentityChange={(info) => {
                        this.setState((prev) => {
                          if (!info) {
                            try { clearSpendXpubWatch(); } catch (_) {}
                            return {
                              uiLocalIdentity: null,
                              uiHasLockedIdentity: false,
                              clientBalance: null,
                              clientBalanceLoading: false
                            };
                          }
                          // Never replace an unlocked identity (have xprv) with a locked one from the modal
                          if (prev.uiLocalIdentity && prev.uiLocalIdentity.xprv && !info.xprv) {
                            return {};
                          }
                          return {
                            uiLocalIdentity: {
                              id: info.id,
                              xpub: info.xpub,
                              xprv: info.xprv || undefined,
                              passwordProtected: !!info.passwordProtected
                            }
                          };
                        });
                      }}
                      onLockStateChange={(locked) => {
                        this.setState((prev) => {
                          // Never mark locked if we still have the key in memory
                          if (prev.uiLocalIdentity && prev.uiLocalIdentity.xprv) return {};
                          return { uiHasLockedIdentity: !!locked };
                        });
                        // When locking identity, wipe any decrypted document content
                        // while preserving encrypted blobs, so re-unlocking is required
                        // to view protected documents again.
                        if (locked && this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
                          try {
                            this.bridgeRef.current.clearDecryptedDocuments();
                          } catch (e) {}
                        }
                      }}
                      onUnlockSuccess={(identityInfo) => {
                        if (identityInfo && typeof identityInfo === 'object' && (identityInfo.id || identityInfo.xpub)) {
                          const next = {
                            id: identityInfo.id,
                            xpub: identityInfo.xpub,
                            xprv: identityInfo.xprv || undefined,
                            passwordProtected: !!identityInfo.passwordProtected
                          };
                          this.setState({
                            uiLocalIdentity: next,
                            uiHasLockedIdentity: false,
                            uiIdentityOpen: false
                          });
                        } else {
                          this.setState({ uiIdentityOpen: false });
                        }
                      }}
                      onForgetIdentity={() => {
                        try { clearSpendXpubWatch(); } catch (_) {}
                        this.setState({
                          uiLocalIdentity: null,
                          uiHasLockedIdentity: false,
                          clientBalance: null,
                          clientBalanceLoading: false
                        });
                        if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearAllDocuments === 'function') {
                          this.bridgeRef.current.clearAllDocuments();
                        }
                      }}
                    />
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({ uiIdentityOpen: false })}>
                      Close
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Modal
                  size="small"
                  open={!!this.state.uiSettingsOpen}
                  onClose={() => this.setState({ uiSettingsOpen: false, uiHubAddressError: null })}
                >
                  <Header icon>
                    <Icon name="cog" />
                    Settings
                  </Header>
                  <Modal.Content>
                    <Form>
                      <Form.Field>
                        <label>Hub address</label>
                        <Input
                          placeholder="host:port (e.g. localhost:7777) or https://host:port"
                          value={this.state.uiHubAddressDraft || ''}
                          onChange={(e) => this.setState({ uiHubAddressDraft: e.target.value, uiHubAddressError: null })}
                        />
                        <div style={{ marginTop: '0.5em', color: '#666' }}>
                          This updates the WebSocket endpoint used by the UI.
                        </div>
                        {this.state.uiHubAddressError ? (
                          <Message negative size="small" style={{ marginTop: '0.75em' }}>
                            {this.state.uiHubAddressError}
                          </Message>
                        ) : null}
                      </Form.Field>
                    </Form>
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({ uiSettingsOpen: false, uiHubAddressError: null })}>
                      Cancel
                    </Button>
                    <Button
                      primary
                      onClick={() => {
                        const raw = (this.state.uiHubAddressDraft || '').trim();
                        if (!raw) {
                          this.setState({ uiHubAddressError: 'Hub address is required.' });
                          return;
                        }

                        try {
                          if (typeof window !== 'undefined' && window.localStorage) {
                            window.localStorage.setItem('fabric.hub.address', raw);
                          }
                        } catch (e) {}

                        this.setState({ uiHubAddress: raw, uiSettingsOpen: false, uiHubAddressError: null }, () => {
                          try {
                            if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.setHubAddress === 'function') {
                              const ok = this.bridgeRef.current.setHubAddress(raw);
                              if (!ok) this.setState({ uiHubAddressError: 'Invalid hub address format.' });
                            }
                          } catch (e) {}
                        });
                      }}
                    >
                      Save
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Modal
                  size="small"
                  open={!!this.state.uiSignMessageOpen}
                  onClose={() => this.setState({
                    uiSignMessageOpen: false,
                    uiSignMessageText: '',
                    uiSignMessageResult: null,
                    uiVerifyMessageText: '',
                    uiVerifySignature: '',
                    uiVerifyPublicKey: '',
                    uiVerifyResult: null
                  })}
                >
                  <Header icon>
                    <Icon name="pencil" />
                    Sign & verify message
                  </Header>
                  <Modal.Content>
                    <Form>
                      <Form.Field>
                        <label>Message to sign</label>
                        <Input
                          placeholder="Enter message to sign"
                          value={this.state.uiSignMessageText || ''}
                          onChange={(e) => this.setState({ uiSignMessageText: e.target.value, uiSignMessageResult: null })}
                        />
                      </Form.Field>
                      {this.state.uiSignMessageResult && (
                        <Message className="fade-in">
                          <Form.Field>
                            <label>Public key (hex)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              <span>{this.state.uiSignMessageResult.publicKey}</span>
                              <Icon
                                name="copy"
                                link
                                onClick={() => { try { navigator.clipboard.writeText(this.state.uiSignMessageResult.publicKey); } catch (e) {} }}
                                style={{ cursor: 'pointer' }}
                              />
                            </div>
                          </Form.Field>
                          <Form.Field>
                            <label>Signature</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              <span>{this.state.uiSignMessageResult.signature}</span>
                              <Icon
                                name="copy"
                                link
                                onClick={() => { try { navigator.clipboard.writeText(this.state.uiSignMessageResult.signature); } catch (e) {} }}
                                style={{ cursor: 'pointer' }}
                              />
                            </div>
                          </Form.Field>
                        </Message>
                      )}

                      <Header as="h4" dividing style={{ marginTop: '1.5em' }}>
                        Verify signature
                      </Header>
                      <p style={{ color: '#666', fontSize: '0.95em', marginBottom: '1em' }}>
                        When you use <strong>external signing</strong> (desktop delegation), the Hub records a Fabric message and the same message, public key, and signature appear here for verification—same flow as local signing.
                      </p>
                      <Form.Field>
                        <label>Message</label>
                        <Input
                          placeholder="Message that was signed"
                          value={this.state.uiVerifyMessageText || ''}
                          onChange={(e) => this.setState({ uiVerifyMessageText: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      <Form.Field>
                        <label>Public key (hex)</label>
                        <Input
                          placeholder="Compressed public key (66 hex chars)"
                          value={this.state.uiVerifyPublicKey || ''}
                          onChange={(e) => this.setState({ uiVerifyPublicKey: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      <Form.Field>
                        <label>Signature (hex)</label>
                        <Input
                          placeholder="Signature (128 hex chars)"
                          value={this.state.uiVerifySignature || ''}
                          onChange={(e) => this.setState({ uiVerifySignature: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      {this.state.uiVerifyResult === true && (
                        <Message success className="fade-in">
                          <Icon name="check" color="green" size="large" />
                          Signature is valid
                        </Message>
                      )}
                      {this.state.uiVerifyResult === false && (
                        <Message negative className="fade-in">
                          <Icon name="close" color="red" size="large" />
                          Signature is invalid
                        </Message>
                      )}
                    </Form>
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({
                      uiSignMessageOpen: false,
                      uiSignMessageText: '',
                      uiSignMessageResult: null,
                      uiVerifyMessageText: '',
                      uiVerifySignature: '',
                      uiVerifyPublicKey: '',
                      uiVerifyResult: null
                    })}>
                      Close
                    </Button>
                    <Button
                      primary
                      loading={!!this.state.uiSignMessageBusy}
                      onClick={() => {
                        const text = (this.state.uiSignMessageText || '').trim();
                        if (!text) return;
                        const bridge = this.bridgeRef && this.bridgeRef.current;
                        const useDelegation = hasExternalSigningDelegation() &&
                          bridge && typeof bridge.signArbitraryTextDelegated === 'function';
                        if (useDelegation) {
                          this.setState({ uiSignMessageBusy: true, uiSignMessageResult: null });
                          toast.info('Confirm signing in the Fabric Hub desktop app…', { duration: 12000, header: 'External signing' });
                          void (async () => {
                            let result = null;
                            try {
                              result = await bridge.signArbitraryTextDelegated(text);
                            } catch (e) {
                              console.error('[HUB]', 'Delegated sign failed:', e);
                            }
                            this.setState({
                              uiSignMessageBusy: false,
                              uiSignMessageResult: result,
                              uiVerifyMessageText: result ? text : this.state.uiVerifyMessageText,
                              uiVerifyPublicKey: result ? result.publicKey : this.state.uiVerifyPublicKey,
                              uiVerifySignature: result ? result.signature : this.state.uiVerifySignature,
                              uiVerifyResult: null
                            });
                            if (!result) {
                              toast.warning('Signing was cancelled or timed out.', { header: 'External signing' });
                            }
                          })();
                          return;
                        }
                        const result = bridge && typeof bridge.signArbitraryText === 'function' ? bridge.signArbitraryText(text) : null;
                        this.setState({
                          uiSignMessageResult: result,
                          uiVerifyMessageText: result ? text : this.state.uiVerifyMessageText,
                          uiVerifyPublicKey: result ? result.publicKey : this.state.uiVerifyPublicKey,
                          uiVerifySignature: result ? result.signature : this.state.uiVerifySignature,
                          uiVerifyResult: null
                        });
                      }}
                      disabled={!((this.state.uiSignMessageText || '').trim())}
                    >
                      <Icon name="pencil" />
                      Sign
                    </Button>
                    <Button
                      onClick={() => {
                        const msg = (this.state.uiVerifyMessageText || '').trim();
                        const sig = (this.state.uiVerifySignature || '').trim();
                        const pub = (this.state.uiVerifyPublicKey || '').trim();
                        if (!msg || !sig || !pub) return;
                        const bridge = this.bridgeRef && this.bridgeRef.current;
                        const result = bridge && typeof bridge.verifyArbitraryText === 'function'
                          ? bridge.verifyArbitraryText(msg, sig, pub)
                          : null;
                        this.setState({ uiVerifyResult: result });
                      }}
                      disabled={!((this.state.uiVerifyMessageText || '').trim()) || !((this.state.uiVerifySignature || '').trim()) || !((this.state.uiVerifyPublicKey || '').trim())}
                    >
                      <Icon name="check" />
                      Verify
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Modal
                  size="tiny"
                  open={!!this.state.uiDestroyIdentityConfirmOpen}
                  onClose={() => this.setState({ uiDestroyIdentityConfirmOpen: false })}
                >
                  <Header icon>
                    <Icon name="trash" color="red" />
                    Destroy identity
                  </Header>
                  <Modal.Content>
                    <p>This will remove your local identity and all documents from this browser. This cannot be undone. Make sure you have backed up your seed phrase.</p>
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({ uiDestroyIdentityConfirmOpen: false })}>
                      Cancel
                    </Button>
                    <Button
                      negative
                      onClick={() => {
                        if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearAllDocuments === 'function') {
                          try { this.bridgeRef.current.clearAllDocuments(); } catch (e) {}
                        }
                        try {
                          if (typeof window !== 'undefined') {
                            if (window.localStorage) window.localStorage.removeItem('fabric.identity.local');
                            if (window.localStorage) {
                              window.localStorage.removeItem(DELEGATION_STORAGE_KEY);
                              notifyDelegationStorageChanged();
                            }
                            if (window.sessionStorage) window.sessionStorage.removeItem('fabric.identity.unlocked');
                            if (window.localStorage) window.localStorage.removeItem('fabric:documents');
                          }
                        } catch (e) {}
                        this.setState({
                          uiLocalIdentity: null,
                          uiHasLockedIdentity: false,
                          uiIdentityOpen: false,
                          uiDestroyIdentityConfirmOpen: false,
                          uiSignMessageOpen: false
                        });
                      }}
                    >
                      <Icon name="trash" />
                      Destroy
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Routes>
                  <Route
                    path="/"
                    element={(
                      <Home
                        auth={effectiveAuth}
                        fetchContract={this.props.fetchContract}
                        contracts={this.props.contracts}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onDiscoverWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.discoverAndConnectToPeers === 'function') {
                            bridgeInstance.discoverAndConnectToPeers();
                          }
                        }}
                        onRepublishWebRTCOffer={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.publishWebRTCOffer === 'function') {
                            bridgeInstance.publishWebRTCOffer();
                          }
                        }}
                        onConnectWebRTCPeer={(peerId) => {
                          const id = (peerId || '').trim();
                          if (!id || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.connectToWebRTCPeer === 'function') {
                            bridgeInstance.connectToWebRTCPeer(id);
                          }
                        }}
                        onDisconnectAllWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.disconnectAllWebRTCPeers === 'function') {
                            bridgeInstance.disconnectAllWebRTCPeers();
                          }
                        }}
                        onSendWebRTCTestPing={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.broadcastToWebRTCPeers === 'function') {
                            bridgeInstance.broadcastToWebRTCPeers({
                              type: 'ping',
                              timestamp: Date.now()
                            });
                          }
                        }}
                        onToggleWebRTCChatOnly={(enabled) => {
                          const flag = !!enabled;
                          this.setState({ webrtcChatOnly: flag });
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.setWebRTCChatOnly === 'function') {
                            bridgeInstance.setWebRTCChatOnly(flag);
                          }
                        }}
                        onRequireUnlock={() => {
                          this.setState({ uiIdentityOpen: true });
                        }}
                        onRefreshNetworkStatus={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendNetworkStatusRequest === 'function') {
                            bridgeInstance.sendNetworkStatusRequest();
                          }
                        }}
                        webrtcChatOnly={this.state.webrtcChatOnly}
                        {...this.props}
                        adminToken={this.state.adminToken}
                      />
                    )}
                  />
                  <Route
                    path="/features"
                    element={(
                      <UiFlagRoute flag="features">
                        <FeaturesPage />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/activities"
                    element={(
                      <UiFlagRoute flag="activities">
                        <ActivitiesHome
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          onRequireUnlock={() => {
                            this.setState({ uiIdentityOpen: true });
                          }}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin"
                    element={(
                      <BitcoinHomeWithNav
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        adminToken={this.state.adminToken}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/services/bitcoin/blocks"
                    element={(
                      <UiFlagRoute flag="bitcoinExplorer">
                        <Navigate to={{ pathname: '/services/bitcoin', hash: 'bitcoin-explorer' }} replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin/transactions"
                    element={(
                      <UiFlagRoute flag="bitcoinExplorer">
                        <Navigate to={{ pathname: '/services/bitcoin', hash: 'bitcoin-explorer' }} replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin/blocks/:blockhash"
                    element={(
                      <UiFlagRoute flag="bitcoinExplorer">
                        <BitcoinBlockView
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin/resources"
                    element={(
                      <UiFlagRoute flag="bitcoinResources">
                        <BitcoinResourcesHome
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bitcoin={bitcoin}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin/payments"
                    element={(
                      <UiFlagRoute flag="bitcoinPayments">
                        <BitcoinPaymentsHomeRoute
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bitcoin={bitcoin}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin/invoices"
                    element={(
                      <UiFlagRoute flag="bitcoinInvoices">
                        <InvoiceListHomeRoute
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bitcoin={bitcoin}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin/transactions/:txhash"
                    element={(
                      <UiFlagRoute flag="bitcoinExplorer">
                        <BitcoinTransactionView
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/bitcoin/channels/:id"
                    element={(
                      <UiFlagRoute flag="bitcoinLightning">
                        <ChannelView
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/services/sidechain"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <Navigate to="/sidechains" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/sidechain"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <Navigate to="/sidechains" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/sidechains"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <SidechainHome
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/peers"
                    element={(
                      <UiFlagRoute flag="peers">
                        <PeerList
                        auth={effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onAddPeer={(peer) => {
                          if (!peer || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendAddPeerRequest === 'function') {
                            bridgeInstance.sendAddPeerRequest(peer);
                          }
                        }}
                        onRefreshPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListPeersRequest === 'function') {
                            bridgeInstance.sendListPeersRequest();
                          }
                          if (typeof bridgeInstance.sendNetworkStatusRequest === 'function') {
                            bridgeInstance.sendNetworkStatusRequest();
                          }
                        }}
                        onDisconnectPeer={(address) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendRemovePeerRequest === 'function') {
                            bridgeInstance.sendRemovePeerRequest(address);
                          }
                        }}
                        onSendPeerMessage={(address, text) => {
                          if (!address || !text || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPeerMessageRequest === 'function') {
                            bridgeInstance.sendPeerMessageRequest(address, text);
                          }
                        }}
                        onFabricPeerResync={(idOrAddress) => {
                          if (!idOrAddress || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendFabricPeerResyncRequest === 'function') {
                            bridgeInstance.sendFabricPeerResyncRequest(idOrAddress);
                          }
                        }}
                        onSetPeerNickname={(address, nickname) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendSetPeerNicknameRequest === 'function') {
                            bridgeInstance.sendSetPeerNicknameRequest(address, nickname);
                          }
                        }}
                        onDiscoverWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.discoverAndConnectToPeers === 'function') {
                            bridgeInstance.discoverAndConnectToPeers();
                          }
                        }}
                        onRepublishWebRTCOffer={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.publishWebRTCOffer === 'function') {
                            bridgeInstance.publishWebRTCOffer();
                          }
                        }}
                        onConnectWebRTCPeer={(peerId) => {
                          const id = (peerId || '').trim();
                          if (!id || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.connectToWebRTCPeer === 'function') {
                            bridgeInstance.connectToWebRTCPeer(id);
                          }
                        }}
                        onDisconnectWebRTCPeer={(peerId) => {
                          const id = (peerId || '').trim();
                          if (!id || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.disconnectWebRTCPeer === 'function') {
                            bridgeInstance.disconnectWebRTCPeer(id);
                          }
                        }}
                        onDisconnectAllWebRTCPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.disconnectAllWebRTCPeers === 'function') {
                            bridgeInstance.disconnectAllWebRTCPeers();
                          }
                        }}
                        onSendWebRTCTestPing={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.broadcastToWebRTCPeers === 'function') {
                            bridgeInstance.broadcastToWebRTCPeers({
                              type: 'ping',
                              timestamp: Date.now()
                            });
                          }
                        }}
                        {...this.props}
                      />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/peers/:id"
                    element={(
                      <UiFlagRoute flag="peers">
                        <PeerView
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onAddPeer={(peer) => {
                          if (!peer || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendAddPeerRequest === 'function') {
                            bridgeInstance.sendAddPeerRequest(peer);
                          }
                        }}
                        onRefreshPeers={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListPeersRequest === 'function') {
                            bridgeInstance.sendListPeersRequest();
                          }
                          if (typeof bridgeInstance.sendNetworkStatusRequest === 'function') {
                            bridgeInstance.sendNetworkStatusRequest();
                          }
                        }}
                        onDisconnectPeer={(address) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendRemovePeerRequest === 'function') {
                            bridgeInstance.sendRemovePeerRequest(address);
                          }
                        }}
                        onSendPeerMessage={(address, text) => {
                          if (!address || !text || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPeerMessageRequest === 'function') {
                            bridgeInstance.sendPeerMessageRequest(address, text);
                          }
                        }}
                        onFabricPeerResync={(idOrAddress) => {
                          if (!idOrAddress || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendFabricPeerResyncRequest === 'function') {
                            bridgeInstance.sendFabricPeerResyncRequest(idOrAddress);
                          }
                        }}
                        onSetPeerNickname={(address, nickname) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendSetPeerNicknameRequest === 'function') {
                            bridgeInstance.sendSetPeerNicknameRequest(address, nickname);
                          }
                        }}
                        onGetPeer={(address) => {
                          if (!address || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendGetPeerRequest === 'function') {
                            bridgeInstance.sendGetPeerRequest(address);
                          }
                        }}
                        {...this.props}
                        adminToken={this.state.adminToken}
                      />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/documents"
                    element={(
                      <DocumentList
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        onListDocuments={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListDocumentsRequest === 'function') {
                            bridgeInstance.sendListDocumentsRequest();
                          }
                        }}
                        onAddLocalDocument={(doc) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.addLocalDocument === 'function') {
                            bridgeInstance.addLocalDocument(doc);
                          }
                        }}
                        onPublishLocalDocument={(doc) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPublishDocumentRequest === 'function') {
                            bridgeInstance.sendPublishDocumentRequest(doc.id);
                          }
                        }}
                        onCreateDocument={(doc) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendCreateDocumentRequest === 'function') {
                            bridgeInstance.sendCreateDocumentRequest(doc);
                          }
                        }}
                        {...this.props}
                      />
                    )}
                  />
                  <Route
                    path="/documents/:id"
                    element={(
                      <DocumentView
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        identity={local || effectiveAuth}
                        bitcoin={bitcoin}
                        hasDocumentKey={
                          !!(bridgeInstance &&
                            typeof bridgeInstance.hasDocumentEncryptionKey === 'function' &&
                            bridgeInstance.hasDocumentEncryptionKey())
                        }
                        onRequestUnlock={() => {
                          this.setState({ uiIdentityOpen: true });
                        }}
                        onGetDocument={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendGetDocumentRequest === 'function') {
                            bridgeInstance.sendGetDocumentRequest(id);
                          }
                        }}
                        onGetDecryptedContent={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return null;
                          const bridgeInstance = this.bridgeRef.current;
                          return typeof bridgeInstance.getDecryptedDocumentContent === 'function'
                            ? bridgeInstance.getDecryptedDocumentContent(id)
                            : null;
                        }}
                        onUnlockHtlcDocument={async (docId, preimageHex) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) {
                            return { ok: false, error: 'Bridge not ready.' };
                          }
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.unlockHtlcEncryptedDocument !== 'function') {
                            return { ok: false, error: 'HTLC unlock not available.' };
                          }
                          return bridgeInstance.unlockHtlcEncryptedDocument(docId, preimageHex);
                        }}
                        onPublishDocument={(id, opts) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendPublishDocumentRequest === 'function') {
                            bridgeInstance.sendPublishDocumentRequest(id, opts);
                          }
                        }}
                        onRequestPurchaseInvoice={(id) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendCreatePurchaseInvoiceRequest === 'function') {
                            bridgeInstance.sendCreatePurchaseInvoiceRequest(id);
                          }
                        }}
                        onClaimPurchase={(id, txid) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return null;
                          const bridgeInstance = this.bridgeRef.current;
                          return typeof bridgeInstance.sendClaimPurchaseRequest === 'function'
                            ? bridgeInstance.sendClaimPurchaseRequest(id, txid)
                            : Promise.resolve({ error: 'Claim not available' });
                        }}
                        onRequestDistributeInvoice={(id, config) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendCreateDistributeInvoiceRequest === 'function') {
                            bridgeInstance.sendCreateDistributeInvoiceRequest(id, config);
                          }
                        }}
                        onDistributeDocument={(id, config) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return null;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendDistributeDocumentRequest === 'function') {
                            return bridgeInstance.sendDistributeDocumentRequest(id, config);
                          }
                          return null;
                        }}
                        {...this.props}
                        adminToken={this.state.adminToken}
                      />
                    )}
                  />
                  <Route
                    path="/settings/admin/beacon-federation"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <BeaconFederationHome />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/settings/admin"
                    element={<AdminHome adminToken={this.state.adminToken} />}
                  />
                  <Route
                    path="/settings/federation"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <SettingsFederationHome adminToken={this.state.adminToken} />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/settings/bitcoin-wallet"
                    element={<SettingsBitcoinWallet identity={local || effectiveAuth} />}
                  />
                  <Route
                    path="/settings/security"
                    element={<SecurityHome />}
                  />
                  <Route
                    path="/admin/beacon-federation"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <Navigate to="/settings/admin/beacon-federation" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/admin"
                    element={<Navigate to="/settings/admin" replace />}
                  />
                  <Route
                    path="/settings"
                    element={<SettingsHome />}
                  />
                  <Route
                    path="/sessions/:sessionId"
                    element={<SecuritySessionHome />}
                  />
                  <Route
                    path="/sessions"
                    element={<Navigate to="/settings/security" replace />}
                  />
                  <Route
                    path="/security"
                    element={<Navigate to="/settings/security" replace />}
                  />
                  <Route
                    path="/activity"
                    element={<NavigateActivityToActivities />}
                  />
                  <Route
                    path="/peer"
                    element={<NavigatePeerRootAlias />}
                  />
                  <Route
                    path="/peer/:id"
                    element={<NavigatePeerDetailAlias />}
                  />
                  <Route
                    path="/home"
                    element={<Navigate to="/" replace />}
                  />
                  <Route
                    path="/wallet"
                    element={(
                      <UiFlagRoute flag="bitcoinPayments">
                        <Navigate to="/services/bitcoin/payments" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/bitcoin"
                    element={<Navigate to="/services/bitcoin" replace />}
                  />
                  <Route
                    path="/payments"
                    element={(
                      <UiFlagRoute flag="bitcoinPayments">
                        <Navigate to="/services/bitcoin/payments" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/invoices"
                    element={(
                      <UiFlagRoute flag="bitcoinInvoices">
                        <Navigate to="/services/bitcoin/invoices#fabric-invoices-tab-demo" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/resources"
                    element={(
                      <UiFlagRoute flag="bitcoinResources">
                        <Navigate to="/services/bitcoin/resources" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/tx/:txhash"
                    element={<NavigateLegacyBitcoinTxAlias />}
                  />
                  <Route
                    path="/block/:blockhash"
                    element={<NavigateLegacyBitcoinBlockAlias />}
                  />
                  <Route
                    path="/document/:id"
                    element={<NavigateDocumentsDetailAlias />}
                  />
                  <Route
                    path="/document"
                    element={<Navigate to="/documents" replace />}
                  />
                  <Route
                    path="/contracts"
                    element={(
                      <ContractList {...this.props} />
                    )}
                  />
                  <Route
                    path="/contracts/:id"
                    element={(
                      <ContractView {...this.props} adminToken={this.state.adminToken} />
                    )}
                  />
                  <Route path="*" element={<UnknownRouteShell />} />
                </Routes>
                </div>
                <BottomPanel pubkey={nodePubkey} />
                </div>
              </BrowserRouter>
            )}
          </fabric-react-component>
        </fabric-container>
      </fabric-interface>
    )
  }

  _getHTML () {
    const component = this.render();
    return renderToString(component);
  }

  _toHTML () {
    return ReactDOMServer.renderToString(this.render());
  }

  toHTMLFragment () {
    return this._toHTML();
  }

  toHTML () {
    return this._toHTML();
  }
}

module.exports = HubInterface;
