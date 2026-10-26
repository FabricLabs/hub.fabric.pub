'use strict';

// Constants
const t = require('../locales/en');
const {
  BROWSER_DATABASE_NAME,
  BROWSER_DATABASE_TOKEN_TABLE
} = require('../constants');
const {
  refreshPassportSession,
  endPassportSession,
  watchIdentityFromSession
} = require('../functions/passportSession');
const { safeIdentityErr } = require('../functions/fabricSafeLog');
const {
  readStorageString,
  readStorageJSON,
  writeStorageString,
  writeStorageJSON,
  removeStorageKey,
  clearFabricBrowserIdentityLocal
} = require('../functions/fabricBrowserState');
const { hasCompletedPostSetupBrowserIdentity } = require('../functions/fabricPostSetupBrowserIdentity');
const {
  loadHubUiFeatureFlags,
  setHubUiFeatureFlag,
  subscribeHubUiFeatureFlags,
  fetchPersistedHubUiFeatureFlags,
  installHubUiFeatureFlagsWindowApi
} = require('../functions/hubUiFeatureFlags');
const {
  classifyHubHttpProbe,
  HUB_UI_RUNTIME_CLIENT,
  HUB_UI_RUNTIME_HUB
} = require('../functions/hubClientEnvironment');
const {
  collectFabricHubSeeds,
  pickPrimarySignalingSeed,
  recommendedMaxWebrtcPeers
} = require('../functions/fabricHubSeeds');
const { probeFabricHubSeeds } = require('../functions/fabricHubSeedProbe');
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
const {
  STORAGE_KEY: IDENTITY_STORAGE_KEY,
  isAccountVault,
  readStoredIdentity,
  lockIdentity,
  unlockedIdentity,
  switchVaultAccount
} = require('../functions/hubAccountVault');
const { applyFabricDevBrowserSeedBootstrap, suppressActiveDevSeed } = require('../functions/fabricBrowserIdentityDev');
const {
  fundLocalKeyFromHubFaucet,
  shouldAutoFundDesktopLocalKey,
  discoverLocalHubFaucet,
  markAutoFaucetDone
} = require('../functions/fundLocalKeyFromHubFaucet');

// Components
const Bridge = require('./Bridge');
const BitcoinHome = require('./BitcoinHome');
const LightningHome = require('./LightningHome');
const BitcoinBlockList = require('./BitcoinBlockList');
const FaucetHome = require('./FaucetHome');
const Onboarding = require('./Onboarding');
const BitcoinBlockView = require('./BitcoinBlockView');
const BitcoinPaymentsHome = require('./BitcoinPaymentsHome');
const BitcoinTransactionsHome = require('./BitcoinTransactionsHome');

function NavigatePaymentsLegacyToCanonical () {
  const loc = useLocation();
  return (
    <Navigate
      to={{
        pathname: '/payments',
        search: loc.search || '',
        hash: loc.hash || ''
      }}
      replace
    />
  );
}

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

function buildAdminGateNavigate (location, flag) {
  const blockedPath = `${location.pathname || ''}${location.search || ''}`;
  const qs = new URLSearchParams();
  qs.set('blockedFlag', String(flag || ''));
  qs.set('blockedPath', blockedPath || '/');
  return {
    to: {
      pathname: '/settings/admin',
      search: `?${qs.toString()}`
    },
    state: {
      featureFlagBlocked: flag,
      blockedPath
    }
  };
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
  const location = useLocation();
  if (!f.peers) {
    const blocked = buildAdminGateNavigate(location, 'peers');
    return (
      <Navigate
        to={blocked.to}
        replace
        state={blocked.state}
      />
    );
  }
  const { id } = useParams();
  const raw = id != null ? String(id).trim() : '';
  if (!raw) return <Navigate to="/peers" replace />;
  return <Navigate to={`/peers/${encodeURIComponent(raw)}`} replace />;
}

function NavigatePeerRootAlias () {
  const f = loadHubUiFeatureFlags();
  const location = useLocation();
  if (!f.peers) {
    const blocked = buildAdminGateNavigate(location, 'peers');
    return (
      <Navigate
        to={blocked.to}
        replace
        state={blocked.state}
      />
    );
  }
  return <Navigate to="/peers" replace />;
}

function NavigateActivityToActivities () {
  const f = loadHubUiFeatureFlags();
  const location = useLocation();
  if (!f.activities) {
    const blocked = buildAdminGateNavigate(location, 'activities');
    return (
      <Navigate
        to={blocked.to}
        replace
        state={blocked.state}
      />
    );
  }
  return <Navigate to="/activities" replace />;
}

function UiFlagRoute ({ flag, children }) {
  const f = loadHubUiFeatureFlags();
  const location = useLocation();
  if (!f[flag]) {
    const blocked = buildAdminGateNavigate(location, flag);
    return (
      <Navigate
        to={blocked.to}
        replace
        state={blocked.state}
      />
    );
  }
  return children;
}

/** Peers routes: UI feature flag only (no hub admin token required). */
function PeersFeatureRoute ({ children }) {
  const f = loadHubUiFeatureFlags();
  const location = useLocation();
  if (!f.peers) {
    const blocked = buildAdminGateNavigate(location, 'peers');
    return (
      <Navigate
        to={blocked.to}
        replace
        state={blocked.state}
      />
    );
  }
  return children;
}

/** Legacy `/tx/...` bookmark → canonical Bitcoin transaction view. */
function NavigateLegacyBitcoinTxAlias () {
  const f = loadHubUiFeatureFlags();
  const location = useLocation();
  if (!f.bitcoinExplorer) {
    const blocked = buildAdminGateNavigate(location, 'bitcoinExplorer');
    return (
      <Navigate
        to={blocked.to}
        replace
        state={blocked.state}
      />
    );
  }
  const { txhash } = useParams();
  const raw = txhash != null ? String(txhash).trim() : '';
  if (!raw) return <Navigate to="/services/bitcoin" replace />;
  return <Navigate to={`/services/bitcoin/transactions/${encodeURIComponent(raw)}`} replace />;
}

/** Legacy `/block/...` bookmark → canonical Bitcoin block view. */
function NavigateLegacyBitcoinBlockAlias () {
  const f = loadHubUiFeatureFlags();
  const location = useLocation();
  if (!f.bitcoinExplorer) {
    const blocked = buildAdminGateNavigate(location, 'bitcoinExplorer');
    return (
      <Navigate
        to={blocked.to}
        replace
        state={blocked.state}
      />
    );
  }
  const { blockhash } = useParams();
  const raw = blockhash != null ? String(blockhash).trim() : '';
  if (!raw) {
    return <Navigate to="/services/bitcoin/blocks" replace />;
  }
  return <Navigate to={`/services/bitcoin/blocks/${encodeURIComponent(raw)}`} replace />;
}

const { HubUiRuntimeContext, HubMeshContext, HubHttpRoute, HubMeshRoute, useHubHttpAvailable } = require('./hubUiRuntime');

function UnknownRouteShell () {
  const { pathname, search } = useLocation();
  const full = `${pathname || ''}${search || ''}` || '/';
  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();
  const hubHttpAvailable = useHubHttpAvailable();
  return (
    <Segment style={{ marginTop: '2em' }}>
      <Header as="h3">{t.shell.notFound.title}</Header>
      <p style={{ color: '#666', marginBottom: '0.75em', lineHeight: 1.45 }}>
        {t.shell.notFound.body}{' '}
        <code style={{ wordBreak: 'break-all' }}>{full}</code>
        .
      </p>
      <p style={{ color: '#666', marginBottom: '0.5em', lineHeight: 1.45 }}>
        {hubHttpAvailable
          ? (
            <>
              {t.shell.notFound.hubHint}
              {uf.activities ? ` ${t.shell.notFound.activityHint}` : ''}
            </>
            )
          : t.shell.notFound.clientHint}
      </p>
      <p style={{ color: '#666', lineHeight: 1.45 }}>
        <Link to="/">{t.shell.notFound.goHome}</Link>
        {' · '}
        <Link to="/settings">{t.shell.notFound.settings}</Link>
        {hubHttpAvailable && (uf.bitcoinPayments || uf.bitcoinLightning) ? (
          <>
            {' · '}
            <Link
              to={{
                pathname: '/services/bitcoin',
                hash: uf.bitcoinPayments ? 'fabric-bitcoin-payjoin' : 'fabric-bitcoin-lightning'
              }}
            >
              {t.shell.notFound.treasury}
            </Link>
          </>
        ) : null}
        {hubHttpAvailable && uf.sidechain ? (
          <>
            {' · '}
            <Link to="/sidechains">{t.shell.notFound.statechain}</Link>
          </>
        ) : null}
      </p>
    </Segment>
  );
}

/** HTML shell: `/services/payjoin` SPA → canonical `/payments` Payjoin surface; JSON still on REST payjoin bases. */
function NavigatePayjoinSpaAlias () {
  const uf = loadHubUiFeatureFlags();
  if (uf.bitcoinPayments) {
    return <Navigate to={{ pathname: '/payments', hash: 'wealth-payjoin-board' }} replace />;
  }
  return <Navigate to={{ pathname: '/services/bitcoin', hash: 'fabric-bitcoin-payjoin' }} replace />;
}

const BitcoinResourcesHome = require('./BitcoinResourcesHome');
const CoinjoinHome = require('./CoinjoinHome');
const BitcoinTransactionView = require('./BitcoinTransactionView');
const ChannelView = require('./ChannelView');
const InvoiceListHome = require('./InvoiceListHome');

function InvoiceListHomeRoute (props) {
  return <InvoiceListHome {...props} />;
}

const BottomPanel = require('./BottomPanel');
const ContractsHome = require('./ContractsHome');
const ContractView = require('./ContractView');
const DocumentList = require('./DocumentList');
const DocumentView = require('./DocumentView');
const Home = require('./Home');
const DownloadsHome = require('./DownloadsHome');
const ActivitiesHome = require('./ActivitiesHome');
const NotificationsHome = require('./NotificationsHome');
const IdentityManager = require('./IdentityManager');
const FabricIdentityAccountControls = require('./fabricIdentity/FabricIdentityAccountControls');
const FabricPostSetupIdentityWizard = require('./fabricIdentity/FabricPostSetupIdentityWizard');
const PeerList = require('./PeerList');
const PeerView = require('./PeerView');
const TopPanel = require('./TopPanel');
const HubAlertStack = require('./HubAlertStack');

/** Alert dismiss PUT uses admin token only on admin settings routes (not on general pages). */
function HubAlertStackLocationGate ({ adminToken }) {
  const loc = useLocation();
  const onAdmin = String(loc.pathname || '').startsWith('/settings/admin');
  const token = (onAdmin && adminToken && String(adminToken).trim()) || '';
  return <HubAlertStack adminToken={token || undefined} />;
}

const {
  getSpendWalletContext,
  fetchWalletSummaryWithCache,
  loadUpstreamSettings
} = require('../functions/bitcoinClient');
const { ToastContainer, toast: toastify, Slide } = require('react-toastify');
const { toast } = require('../functions/toast');
const SecurityHome = require('./SecurityHome');
const SettingsHome = require('./SettingsHome');
const CollaborationHome = require('./CollaborationHome');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const SettingsFederationHome = require('./SettingsFederationHome');
const FederationsHome = require('./FederationsHome');
const FederationInviteNotificationBanner = require('./FederationInviteNotificationBanner');
const PublicVisitorGate = require('./PublicVisitorGate');
const { computePublicHubVisitor } = require('../functions/hubPublicVisitor');
const SettingsBitcoinWallet = require('./SettingsBitcoinWallet');
const FederationContractInviteModal = require('./FederationContractInviteModal');
const CollaborationInviteModal = require('./CollaborationInviteModal');
const FeaturesPage = require('./FeaturesPage');
const SidechainHome = require('./SidechainHome');
const FabricMessagePrompt = require('./FabricMessagePrompt');
const AdminHome = require('./AdminHome');
const BeaconFederationHome = require('./BeaconFederationHome');

/**
 * Wallet-safe Bitcoin snapshot from GetNetworkStatus / pushNetworkStatus.
 * The hub puts it on the top-level `bitcoin` key; a copy may also exist under `state.services.bitcoin`.
 * @param {object|null|undefined} networkStatus
 * @returns {object|null}
 */
function wrapPublicVisitorGate (isVisitor, onOpenIdentity, child) {
  if (!isVisitor) return child;
  return (
    <PublicVisitorGate active onOpenIdentity={onOpenIdentity}>
      {child}
    </PublicVisitorGate>
  );
}

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
  Checkbox,
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
    const hashTarget = raw.startsWith('#') ? raw.slice(1) : raw;
    const routeTarget = props && typeof props.targetHash === 'string' ? props.targetHash.trim() : '';
    const h = hashTarget || routeTarget;
    if (!h) return;
    const el = document.getElementById(h);
    if (el && typeof el.scrollIntoView === 'function') {
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  }, [location.pathname, location.hash, props && props.targetHash]);
  return <BitcoinHome {...props} navigate={navigate} />;
}

const CrowdfundingHome = require('./CrowdfundingHome');

function CrowdfundingHomeWithNav (props) {
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
  return <CrowdfundingHome {...props} navigate={navigate} />;
}

/**
 * The Hub UI.
 */
class HubInterface extends React.Component {
  constructor (props) {
    super(props);

    let initialHubAddress = '';
    try {
      if (typeof window !== 'undefined') {
        initialHubAddress = readStorageString('fabric.hub.address') || '';
      }
    } catch (e) {}
    if (!initialHubAddress) {
      try {
        if (typeof window !== 'undefined' && window.FABRIC_EDGE_AUTHORITY) {
          initialHubAddress = String(window.FABRIC_EDGE_AUTHORITY).trim();
        }
      } catch (e) {}
    }
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
      if (typeof window !== 'undefined') {
        initialAdminToken = readStorageString('fabric.hub.adminToken') || null;
        const raw = readStorageString('fabric.hub.adminTokenExpiresAt');
        if (raw) initialAdminTokenExpiresAt = Number(raw) || null;
      }
    } catch (e) {}

    let initialLocalIdentity = null;
    let initialHasLockedIdentity = false;
    let initialPostSetupIdentityWizardOpen = false;

    try {
      if (typeof window !== 'undefined') {
        const parsed = readStorageJSON(IDENTITY_STORAGE_KEY, null);
        try {
          initialLocalIdentity = readStoredIdentity(parsed).identity;
        } catch (_) {}
        try {
          const dev = applyFabricDevBrowserSeedBootstrap({ hasStoredIdentity: !!initialLocalIdentity });
          if (dev.ok && dev.identity) initialLocalIdentity = dev.identity;
        } catch (_) {}
        initialHasLockedIdentity = !!(
          initialLocalIdentity &&
          !initialLocalIdentity.xprv &&
          initialLocalIdentity.passwordProtected
        );

        try {
          let dismissed = readStorageString('fabric.hub.identityWizardDismissed') === '1';
          let pending = readStorageString('fabric.hub.identityWizardPending') === '1';
          try {
            if (typeof window !== 'undefined' && window.sessionStorage) {
              if (window.sessionStorage.getItem('fabric.hub.identityWizardDismissed') === '1') dismissed = true;
              if (window.sessionStorage.getItem('fabric.hub.wantIdentityWizard') === '1') pending = true;
            }
          } catch (eSess) {}
          initialPostSetupIdentityWizardOpen = !!(
            pending &&
            !dismissed &&
            !hasCompletedPostSetupBrowserIdentity(parsed)
          );
        } catch (e) {}
      }
    } catch (e) {}

    this.state = {
      debug: false,
      isAuthenticated: false,
      isLoading: true,
      needsSetup: false,
      setupChecked: false,
      hubRuntime: null,
      meshAvailable: false,
      hubSeedProbes: [],
      adminToken: initialAdminToken,
      adminTokenExpiresAt: initialAdminTokenExpiresAt,
      modalLogOut: false,
      loggedOut: false,
      uiSettingsOpen: false,
      uiHubAddress: initialHubAddress,
      uiHubAddressDraft: initialHubAddress,
      uiAdvancedModeDraft: !!loadHubUiFeatureFlags().advancedMode,
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
      federationInviteDetail: null,
      federationInviteBannerDetail: null,
      collaborationInviteModalOpen: false,
      collaborationInviteDetail: null,
      requiresSetupUiSecret: false,
      setupUiVerified: false,
      setupUiGatePassword: '',
      setupStatusTimedOut: false,
      setupUiGateError: null,
      setupUiGateBusy: false,
      postSetupIdentityWizardOpen: initialPostSetupIdentityWizardOpen
    };

    this.handleBridgeStateUpdate = this.handleBridgeStateUpdate.bind(this);
    this.responseCapture = this.responseCapture.bind(this);
    this.requestLogin = this.requestLogin.bind(this);
    this.openIdentityManager = this.openIdentityManager.bind(this);
    this.openIdentityModalFromGatedAction = this.openIdentityModalFromGatedAction.bind(this);
    this._handleIdentityManagerLocalChange = this._handleIdentityManagerLocalChange.bind(this);
    this._handleIdentityManagerLockStateChange = this._handleIdentityManagerLockStateChange.bind(this);
    this._handleIdentityManagerUnlockSuccess = this._handleIdentityManagerUnlockSuccess.bind(this);
    this._handleIdentityManagerForget = this._handleIdentityManagerForget.bind(this);
    this._fabricAccountChange = this._fabricAccountChange.bind(this);
    this._openFederationInviteReview = this._openFederationInviteReview.bind(this);
    this._dismissFederationInviteBanner = this._dismissFederationInviteBanner.bind(this);
    this._openIdentityModalForUser = this._openIdentityModalForUser.bind(this);
    this._closeHubIdentityModal = this._closeHubIdentityModal.bind(this);
    this._verifySetupUiSecret = this._verifySetupUiSecret.bind(this);
    /** Coalesce rapid Bridge / page unlock prompts so the identity modal does not strobe. */
    this._openIdentityModalCoolDownUntil = 0;

    // Instantiate Bridge once here
    this.bridgeRef = React.createRef();

    this._state = {
      actors: {},
      content: this.state
    };

    return this;
  }

  async _checkSetupStatus () {
    const base = typeof window !== 'undefined' && window.location
      ? `${window.location.protocol}//${window.location.host}`
      : 'http://localhost:8080';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = 15000;
    const timer = controller && typeof setTimeout === 'function'
      ? setTimeout(() => {
        try {
          controller.abort();
        } catch (abortErr) {}
      }, timeoutMs)
      : null;
    try {
      const res = await fetch(`${base}/settings`, {
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'FabricHub-Setup'
        },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      const text = await res.text();
      let json = null;
      if (text && !String(text).trim().startsWith('<')) {
        try {
          json = JSON.parse(text);
        } catch (_) { json = null; }
      }
      const contentType = (res.headers && typeof res.headers.get === 'function')
        ? (res.headers.get('content-type') || '')
        : '';
      const classified = classifyHubHttpProbe({
        status: res.status,
        contentType,
        bodyText: text,
        json
      });
      if (classified.runtime === HUB_UI_RUNTIME_CLIENT) {
        this.setState({
          setupChecked: true,
          setupStatusTimedOut: false,
          needsSetup: false,
          hubRuntime: HUB_UI_RUNTIME_CLIENT,
          requiresSetupUiSecret: false
        });
        void this._applyHubSeeds({ originIsHub: false });
        return;
      }
      let setupUiVerified = false;
      try {
        if (classified.requiresSetupUiSecret && typeof window !== 'undefined' && window.sessionStorage) {
          setupUiVerified = window.sessionStorage.getItem('fabric.hub.setupUiVerified') === '1';
        }
      } catch (eVer) {}
      this.setState({
        needsSetup: !!classified.needsSetup,
        setupChecked: true,
        setupStatusTimedOut: false,
        requiresSetupUiSecret: !!classified.requiresSetupUiSecret,
        setupUiVerified,
        hubRuntime: HUB_UI_RUNTIME_HUB
      });
      fetchPersistedHubUiFeatureFlags().then(() => this.forceUpdate()).catch(() => {});
      void this._applyHubSeeds({ originIsHub: true });
    } catch (e) {
      const aborted = !!(e && (e.name === 'AbortError' || e.name === 'TimeoutError'));
      if (aborted) return;
      this.setState({
        setupChecked: true,
        needsSetup: false,
        hubRuntime: HUB_UI_RUNTIME_CLIENT
      });
      void this._applyHubSeeds({ originIsHub: false });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * OPTIONS + peering probes for build-time seed Hubs. CDN origins use the first
   * reachable seed as WebSocket / WebRTC signaling. Local Hub JSON keeps this origin.
   * @param {object} [opts]
   * @param {boolean} [opts.originIsHub]
   * @returns {Promise<void>}
   */
  async _applyHubSeeds (opts = {}) {
    const originIsHub = !!opts.originIsHub;
    const seeds = collectFabricHubSeeds();
    let pageProtocol = '';
    try {
      if (typeof window !== 'undefined' && window.location) {
        pageProtocol = window.location.protocol;
      }
    } catch (_) {}
    let probes = [];
    try {
      if (seeds.length) {
        probes = await probeFabricHubSeeds(seeds, { pageProtocol });
      }
    } catch (e) {
      probes = [];
    }
    const meshFromSeeds = probes.some((p) => p && p.hubLike);
    const meshAvailable = originIsHub || meshFromSeeds;
    const patch = { hubSeedProbes: probes, meshAvailable };
    let signalingHttp = '';
    if (!originIsHub) {
      const primary = pickPrimarySignalingSeed(probes, { pageProtocol });
      if (primary && primary.http) {
        signalingHttp = primary.http;
        patch.uiHubAddress = primary.http;
        try {
          writeStorageString('fabric.hub.address', primary.http);
        } catch (_) {}
      }
    }
    this.setState(patch, () => {
      const b = this.bridgeRef && this.bridgeRef.current;
      if (!b) return;
      const maxPeers = recommendedMaxWebrtcPeers(seeds.length);
      if (b.settings) {
        b.settings.maxWebrtcPeers = Math.max(Number(b.settings.maxWebrtcPeers) || 5, maxPeers);
      }
      if (signalingHttp && typeof b.setHubAddress === 'function') {
        b.setHubAddress(signalingHttp);
      }
      if (meshAvailable && typeof b.requestConnectedPeerInventories === 'function') {
        setTimeout(() => {
          try {
            b.requestConnectedPeerInventories();
          } catch (_) {}
        }, 1500);
      }
    });
  }

  async _verifySetupUiSecret () {
    const pwd = String(this.state.setupUiGatePassword || '').trim();
    if (!pwd) {
      this.setState({ setupUiGateError: t.shell.setupGate.missing });
      return;
    }
    const base = typeof window !== 'undefined' && window.location
      ? `${window.location.protocol}//${window.location.host}`
      : 'http://localhost:8080';
    this.setState({ setupUiGateBusy: true, setupUiGateError: null });
    try {
      const res = await fetch(`${base}/settings/verify-setup-ui`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'FabricHub-Setup'
        },
        body: JSON.stringify({ setupUiSecret: pwd })
      });
      const text = await res.text();
      let errMsg = t.shell.setupGate.invalid;
      if (!res.ok) {
        try {
          if (!text.trim().startsWith('<')) {
            const j = JSON.parse(text);
            if (j && j.message) errMsg = String(j.message);
          }
        } catch (eJ) {}
        this.setState({ setupUiGateBusy: false, setupUiGateError: errMsg });
        return;
      }
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('fabric.hub.setupUiVerified', '1');
        }
      } catch (eS) {}
      this.setState({
        setupUiVerified: true,
        setupUiGateBusy: false,
        setupUiGatePassword: '',
        setupUiGateError: null
      });
    } catch (e) {
      this.setState({
        setupUiGateBusy: false,
        setupUiGateError: e && e.message ? String(e.message) : t.shell.setupGate.failed
      });
    }
  }

  async _refreshAdminTokenIfNeeded () {
    const token = this.state.adminToken || (typeof window !== 'undefined' && readStorageString('fabric.hub.adminToken'));
    if (!token) return;
    const expiresAt = this.state.adminTokenExpiresAt || (typeof window !== 'undefined' && (() => {
      const raw = readStorageString('fabric.hub.adminTokenExpiresAt');
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
        if (typeof window !== 'undefined') {
          try {
            writeStorageString('fabric.hub.adminToken', result.token);
            if (result.expiresAt != null) {
              writeStorageString('fabric.hub.adminTokenExpiresAt', String(result.expiresAt));
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

    this._openIdentityModalForUser();
  }

  /** User explicitly asked for the identity UI — always show (avoids “stuck closed” if state desyncs). */
  _openIdentityModalForUser () {
    this.setState({ uiIdentityOpen: true });
  }

  /** Dismiss identity UI only from explicit chrome — ignore Semantic Modal / Portal onClose (mobile-safe). */
  _closeHubIdentityModal () {
    this.setState({ uiIdentityOpen: false });
  }

  openIdentityManager () {
    if (typeof this.props.onOpenIdentityManager === 'function') {
      this.props.onOpenIdentityManager();
      return;
    }

    this._openIdentityModalForUser();
  }

  /** Bridge / background prompts — do not re-open if already visible (prevents mobile modal strobing). */
  openIdentityModalFromGatedAction () {
    if (this.state.uiIdentityOpen) return;
    const now = Date.now();
    if (now < this._openIdentityModalCoolDownUntil) return;
    this._openIdentityModalCoolDownUntil = now + 2500;
    this.setState({ uiIdentityOpen: true });
  }

  _hubIdentityUiSnapshotKey (info) {
    if (!info || !info.id) return '';
    const hasX = !!(info.xprv && String(info.xprv).trim());
    const acct = info.fabricAccountIndex != null && info.fabricAccountIndex !== ''
      ? String(Math.floor(Number(info.fabricAccountIndex)))
      : '';
    return [
      info.id,
      info.network || '',
      acct,
      hasX ? '1' : '0',
      info.passwordProtected ? '1' : '0',
      info.linkedFromPassport ? '1' : '0',
      info.wallet ? '1' : '0'
    ].join('|');
  }

  _clearIdentityWizardPending () {
    try {
      writeStorageString('fabric.hub.identityWizardPending', '');
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('fabric.hub.wantIdentityWizard');
      }
    } catch (e) {}
  }

  _handleIdentityManagerLocalChange (info) {
    if (info && info.id) this._clearIdentityWizardPending();
    this.setState((prev) => {
      if (!info || !info.id) {
        if (!prev.uiLocalIdentity && !prev.uiHasLockedIdentity) return {};
        return {
          uiLocalIdentity: null,
          uiHasLockedIdentity: false,
          clientBalance: null,
          clientBalanceLoading: false
        };
      }
      const nextIdentity = Object.assign({}, info);
      const nextHasLocked = !nextIdentity.xprv && !!nextIdentity.passwordProtected;
      if (
        this._hubIdentityUiSnapshotKey(prev.uiLocalIdentity) === this._hubIdentityUiSnapshotKey(nextIdentity) &&
        !!prev.uiHasLockedIdentity === nextHasLocked
      ) {
        return {};
      }
      return {
        uiLocalIdentity: nextIdentity,
        uiHasLockedIdentity: nextHasLocked
      };
    });
  }

  _handleIdentityManagerLockStateChange (locked) {
    this.setState((prev) => {
      if (prev.uiLocalIdentity && prev.uiLocalIdentity.xprv) return {};
      const hasIdent = !!(prev.uiLocalIdentity && prev.uiLocalIdentity.id);
      if (locked && !hasIdent) return {};
      if (!!prev.uiHasLockedIdentity === !!locked) return {};
      return { uiHasLockedIdentity: !!locked };
    });
    if (locked && this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
      try {
        this.bridgeRef.current.clearDecryptedDocuments();
      } catch (e) {}
    }
  }

  _handleIdentityManagerUnlockSuccess (identityInfo) {
    if (identityInfo && typeof identityInfo === 'object' && identityInfo.id) {
      this._clearIdentityWizardPending();
      this.setState({
        uiLocalIdentity: Object.assign({}, identityInfo),
        uiHasLockedIdentity: false,
        uiIdentityOpen: false
      });
    } else {
      this.setState({ uiIdentityOpen: false });
    }
  }

  _handleIdentityManagerForget () {
    void endPassportSession();
    try { removeStorageKey('fabric.linkedDevices'); } catch (_) {}
    try { clearFabricBrowserIdentityLocal(); } catch (_) {}
    try { suppressActiveDevSeed(); } catch (_) {}
    this.setState({
      uiLocalIdentity: null,
      uiHasLockedIdentity: false,
      clientBalance: null,
      clientBalanceLoading: false
    });
    if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearAllDocuments === 'function') {
      try {
        this.bridgeRef.current.clearAllDocuments();
      } catch (e) {}
    }
  }

  /**
   * Switch to another (account, network) pair of the same seed. Unlocked, any
   * pair derives; locked, only pairs the vault has cached (else the identity
   * modal opens to unlock).
   * @param {number} nextAccountIndex
   * @param {string} [nextNetwork]
   */
  _fabricAccountChange (nextAccountIndex, nextNetwork) {
    try {
      const account = Math.floor(Number(nextAccountIndex));
      if (!Number.isFinite(account) || account < 0) return;
      const current = this.state.uiLocalIdentity || null;
      if (!current || current.fabricIdentityMode !== 'account') return;
      const network = nextNetwork || current.network || 'regtest';
      const master = current.masterXprv ? String(current.masterXprv).trim() : '';
      let vault = null;
      try {
        vault = readStorageJSON(IDENTITY_STORAGE_KEY, null);
      } catch (_) {}
      let next = null;
      if (isAccountVault(vault)) {
        try {
          const switched = switchVaultAccount(vault, { account, network, master: master || undefined });
          writeStorageJSON(IDENTITY_STORAGE_KEY, switched.vault);
          next = switched.identity;
        } catch (e) {
          if (e && e.code === 'FABRIC_ACCOUNT_LOCKED') {
            this._openIdentityModalForUser();
            return;
          }
          throw e;
        }
      } else if (master) {
        next = Object.assign(unlockedIdentity(master, { account, network }), {
          passwordProtected: !!current.passwordProtected,
          devSeed: !!current.devSeed
        });
      } else {
        return;
      }
      if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
        try { this.bridgeRef.current.clearDecryptedDocuments(); } catch (_) {}
      }
      this.setState({
        uiLocalIdentity: next,
        uiHasLockedIdentity: !next.xprv && !!next.passwordProtected,
        clientBalance: null
      });
    } catch (e) {
      console.error('[HUB]', 'Fabric account switch failed:', safeIdentityErr(e));
      try { toast.error(t.identity.accountControls.switchFailed); } catch (_) {}
    }
  }

  _openFederationInviteReview () {
    const d = this.state.federationInviteBannerDetail;
    if (!d || !d.inviteId) return;
    this.setState({
      federationInviteModalOpen: true,
      federationInviteDetail: d,
      federationInviteBannerDetail: null
    });
  }

  _dismissFederationInviteBanner () {
    this.setState({ federationInviteBannerDetail: null });
  }

  _handleFederationInviteResponse (d) {
    if (!d || typeof d.accept !== 'boolean') return;
    if (!d.accept) {
      toastify.info(t.shell.federationInvite.declined, { transition: Slide });
      return;
    }
    const admin = this.state.adminToken || (typeof window !== 'undefined' && readStorageString('fabric.hub.adminToken'));
    const pk = d.responderPubkey;
    if (!pk) {
      toastify.warning(t.shell.federationInvite.acceptedNoKey, { transition: Slide });
      return;
    }
    if (!admin) {
      toastify.info(t.shell.federationInvite.acceptedNoAdmin(pk.slice(0, 10)), { transition: Slide, autoClose: 8000 });
      return;
    }
    const self = this;
    const token = String(admin).trim();
    toastify.info(
      ({ closeToast }) => (
        <div>
          <p style={{ margin: '0 0 0.6em', fontSize: '0.95rem' }}>{t.shell.federationInvite.accepted}</p>
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
            {t.shell.federationInvite.addValidator}
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
            {t.shell.federationInvite.dismiss}
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
        toastify.error((body.error && body.error.message) || t.shell.federationInvite.addFailed, { transition: Slide });
        return;
      }
      toastify.success(t.shell.federationInvite.added, { transition: Slide });
      if (typeof closeToast === 'function') closeToast();
    } catch (e) {
      toastify.error(e && e.message ? e.message : String(e), { transition: Slide });
    }
  }

  componentDidMount () {
    console.debug('[HUB]', 'Component mounted!');
    this._setupStatusSafetyTimer = setTimeout(() => {
      // Do not treat unknown setup status as configured (would skip onboarding).
      this.setState((prev) => (prev.setupChecked ? null : { setupStatusTimedOut: true }));
    }, 20000);
    this._checkSetupStatus().finally(() => {
      if (this._setupStatusSafetyTimer) {
        clearTimeout(this._setupStatusSafetyTimer);
        this._setupStatusSafetyTimer = null;
      }
    });
    this._refreshAdminTokenIfNeeded();
    void refreshPassportSession().then((view) => {
      const prev = this.state.uiLocalIdentity;
      const watch = watchIdentityFromSession(view);
      if (!prev || !prev.linkedFromPassport || !watch || watch.id !== prev.id) return;
      this.setState({ uiLocalIdentity: Object.assign({}, prev, { wallet: watch.wallet }) });
    });
    this._refreshClientBalance().then(() => {
      void this._maybeAutoFundDesktopLocalKey();
    }).catch(() => {
      void this._maybeAutoFundDesktopLocalKey();
    });
    this._onGlobalStateUpdate = (e) => {
      const d = e && e.detail;
      if (d && d.operation && d.operation.path === '/bitcoin') {
        const idn = this.state.uiLocalIdentity || null;
        if (!idn || !idn.wallet) return;
        // One tx raises both `hashtx` and `rawtx` (and a block re-pushes status): coalesce the burst.
        if (this._bitcoinPatchRefreshTimer) clearTimeout(this._bitcoinPatchRefreshTimer);
        this._bitcoinPatchRefreshTimer = setTimeout(() => {
          this._bitcoinPatchRefreshTimer = null;
          this._refreshClientBalance(true);
        }, 750);
      }
    };
    this._onClientBalanceUpdate = () => {
      const idn = this.state.uiLocalIdentity || null;
      if (idn && idn.wallet) this._refreshClientBalance();
    };
    if (typeof window !== 'undefined') {
      // Strict lock policy: always clear unlocked key material on close/unload.
      window.addEventListener('globalStateUpdate', this._onGlobalStateUpdate);
      window.addEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);
      this._onFabricHubAdminTokenSaved = () => {
        try {
          const t = readStorageString('fabric.hub.adminToken');
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
      this._fabricCollabInvite = (ev) => {
        const d = ev && ev.detail;
        if (d && d.invitationId) this.setState({ collaborationInviteModalOpen: true, collaborationInviteDetail: d });
      };
      window.addEventListener('fabric:collaborationInvitation', this._fabricCollabInvite);
      this._onFabricOpenIdentityManager = () => {
        this.openIdentityManager();
      };
      window.addEventListener('fabricOpenIdentityManager', this._onFabricOpenIdentityManager);
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
      installHubUiFeatureFlagsWindowApi();
      this._hubUiUnsub = subscribeHubUiFeatureFlags(() => this.forceUpdate());
    }
  }

  componentWillUnmount () {
    console.debug('[HUB]', 'Cleaning up...');
    if (this._setupStatusSafetyTimer) {
      clearTimeout(this._setupStatusSafetyTimer);
      this._setupStatusSafetyTimer = null;
    }
    if (typeof this._hubUiUnsub === 'function') this._hubUiUnsub();
    if (typeof this._toastUnsub === 'function') this._toastUnsub();
    if (typeof window !== 'undefined') {
      if (this._onGlobalStateUpdate) window.removeEventListener('globalStateUpdate', this._onGlobalStateUpdate);
      if (this._bitcoinPatchRefreshTimer) clearTimeout(this._bitcoinPatchRefreshTimer);
      if (this._onClientBalanceUpdate) window.removeEventListener('clientBalanceUpdate', this._onClientBalanceUpdate);
      if (this._onFabricHubAdminTokenSaved) {
        window.removeEventListener('fabricHubAdminTokenSaved', this._onFabricHubAdminTokenSaved);
      }
      if (this._fabricFedInvite) window.removeEventListener('fabric:federationContractInvite', this._fabricFedInvite);
      if (this._fabricFedResp) window.removeEventListener('fabric:federationContractInviteResponse', this._fabricFedResp);
      if (this._fabricCollabInvite) window.removeEventListener('fabric:collaborationInvitation', this._fabricCollabInvite);
      if (this._onFabricOpenIdentityManager) {
        window.removeEventListener('fabricOpenIdentityManager', this._onFabricOpenIdentityManager);
      }
      if (this._adminTokenRefreshInterval) clearInterval(this._adminTokenRefreshInterval);
    }
  }

  componentDidUpdate (prevProps, prevState) {
    const prevId = prevState.uiLocalIdentity || {};
    const nextId = this.state.uiLocalIdentity || {};
    const prevWallet = prevId.wallet && prevId.wallet.segwit ? prevId.wallet.segwit.xpub : '';
    const nextWallet = nextId.wallet && nextId.wallet.segwit ? nextId.wallet.segwit.xpub : '';
    if (prevWallet !== nextWallet || prevId.network !== nextId.network) this._refreshClientBalance();
  }

  async _maybeAutoFundDesktopLocalKey () {
    if (this._desktopAutoFaucetBusy) return;
    const identity = this.state.uiLocalIdentity || null;
    const bridgeInstance = this.bridgeRef && this.bridgeRef.current;
    const networkStatus = bridgeInstance && (bridgeInstance.networkStatus || bridgeInstance.lastNetworkStatus);
    const bitcoin = resolveBitcoinFromNetworkStatus(networkStatus);
    const network = (bitcoin && bitcoin.network) ? String(bitcoin.network).toLowerCase() : 'regtest';
    if (!shouldAutoFundDesktopLocalKey({
      identity,
      clientBalance: this.state.clientBalance,
      network
    })) {
      return;
    }
    this._desktopAutoFaucetBusy = true;
    try {
      const disc = await discoverLocalHubFaucet({
        hubAdminToken: readHubAdminTokenFromBrowser(this.state.adminToken) || ''
      });
      if (!disc.available || disc.funded === false) {
        this._desktopAutoFaucetBusy = false;
        return;
      }
      const funded = await fundLocalKeyFromHubFaucet({
        identity,
        adminToken: this.state.adminToken,
        network,
        amountSats: (disc.faucet && disc.faucet.defaultAmountSats) || 10000,
        mineConfirm: true
      });
      if (funded && funded.ok) {
        markAutoFaucetDone();
        try {
          toast.success(
            t.shell.faucetFunded(funded.amountSats.toLocaleString())
          );
        } catch (_) {}
        await this._refreshClientBalance(true);
      }
    } catch (e) {
      console.warn('[HUB] Desktop auto-faucet skipped:', e && e.message ? e.message : e);
    } finally {
      this._desktopAutoFaucetBusy = false;
    }
  }

  async _refreshClientBalance (forceRefresh = false) {
    const identity = this.state.uiLocalIdentity || null;
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
    // Overlapping refreshes resolve out of order: only the latest request for
    // this wallet (and only while it is still the active wallet) may write state
    // or feed the Bridge baseline.
    if (!this._balanceReq) this._balanceReq = {};
    const requestId = (this._balanceReq[nextWid] || 0) + 1;
    this._balanceReq[nextWid] = requestId;
    const isCurrent = () => {
      if (this._balanceReq[nextWid] !== requestId) return false;
      const active = getSpendWalletContext(this.state.uiLocalIdentity || {});
      return String(active.walletId || '') === nextWid;
    };
    const bridgeInstance = this.bridgeRef && this.bridgeRef.current;
    const networkStatus = bridgeInstance && (bridgeInstance.networkStatus || bridgeInstance.lastNetworkStatus);
    const bitcoin = resolveBitcoinFromNetworkStatus(networkStatus);
    const network = (bitcoin && bitcoin.network) ? String(bitcoin.network).toLowerCase() : 'regtest';
    try {
      const upstream = loadUpstreamSettings();
      const summary = await fetchWalletSummaryWithCache(upstream, wallet, { bypassCache: forceRefresh, network });
      if (!isCurrent()) return;
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
        this.setState({ clientBalance: nextClient, clientBalanceLoading: false });
        /* Feed the Bridge directly, not via a `clientBalanceUpdate` event: this component listens to that
         * event and would refetch in a loop. Cached rows are skipped so a stale fallback cannot rewind
         * the baseline and re-announce the same receive. */
        if (!summary._fromCache) {
          const bridge = this.bridgeRef && this.bridgeRef.current;
          if (bridge && typeof bridge.noteClientWalletBalance === 'function') {
            bridge.noteClientWalletBalance({ walletId: wallet.walletId, balanceSats, confirmedSats, unconfirmedSats });
          }
        }
      } else {
        this.setState({ clientBalance: null, clientBalanceLoading: false });
      }
    } catch (e) {
      if (!isCurrent()) return;
      this.setState((prev) => ({
        clientBalance: prev.clientBalance,
        clientBalanceLoading: false
      }));
    }
  }

  _handleLockIdentity () {
    const local = this.state.uiLocalIdentity;
    if (!local || !local.xprv || !local.passwordProtected) return;
    try {
      if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
        try { this.bridgeRef.current.clearDecryptedDocuments(); } catch (e) {}
      }
      this.setState({
        uiLocalIdentity: lockIdentity(local),
        uiHasLockedIdentity: true
      });
    } catch (e) {
      console.error('[HUB]', 'Error locking identity:', safeIdentityErr(e));
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
      console.error('[HUB]', 'Error handling bridge response:', safeIdentityErr(error));
    }
  }

  /**
   * @param {object} effectiveAuth
   * @param {object} identity
   * @param {string} [adminPeerToolsToken] - Hub admin token for operator-only peer tools; omit on `/peers/:id`.
   */
  _hubPeerView (effectiveAuth, identity, adminPeerToolsToken) {
    return (
      <PeerView
        auth={effectiveAuth}
        identity={identity}
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
        adminPeerToolsToken={adminPeerToolsToken}
      />
    );
  }

  _shouldShowPostSetupIdentityWizard () {
    if (!this.state.setupChecked || this.state.needsSetup) return false;
    let dismissed = false;
    try {
      dismissed = readStorageString('fabric.hub.identityWizardDismissed') === '1';
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (window.sessionStorage.getItem('fabric.hub.identityWizardDismissed') === '1') dismissed = true;
      }
    } catch (e) {
      return false;
    }
    if (dismissed) return false;
    try {
      const p = readStorageJSON('fabric.identity.local', null);
      if (hasCompletedPostSetupBrowserIdentity(p)) return false;
    } catch (e) {
      return false;
    }
    let pending = readStorageString('fabric.hub.identityWizardPending') === '1';
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (window.sessionStorage.getItem('fabric.hub.wantIdentityWizard') === '1') pending = true;
      }
    } catch (e) {}
    const stateFlag = !!this.state.postSetupIdentityWizardOpen;
    return !!(pending || stateFlag);
  }

  render () {
    // Prefer Bridge ref (live from WebSocket), then Redux, then local state
    const bridgeInstance = this.bridgeRef && this.bridgeRef.current;
    const nodePubkey = (bridgeInstance && typeof bridgeInstance.getNodePubkey === 'function' && bridgeInstance.getNodePubkey());
    const networkStatus = bridgeInstance && (bridgeInstance.networkStatus || bridgeInstance.lastNetworkStatus || null);
    const services = networkStatus && networkStatus.state && networkStatus.state.services;
    const bitcoin = resolveBitcoinFromNetworkStatus(networkStatus);

    // Identity is local-browser identity only. Do not fall back to props auth.
    const local = this.state.uiLocalIdentity;
    const hasLocal = !!(local && local.id);
    const hubNetwork = bitcoin && bitcoin.network ? String(bitcoin.network).toLowerCase() : 'regtest';
    const effectiveAuth = hasLocal ? local : null;
    // Locked chip: derive only from shell identity fields — never trust orphan uiHasLockedIdentity when
    // local is empty (TopPanel still merges persisted storage into the chip and could show "Locked"
    // if hasLockedIdentity stayed true from a stale callback).
    const effectiveHasLockedIdentity = !!(
      hasLocal &&
      !local.xprv &&
      local.passwordProtected
    );
    const publicHubVisitor = computePublicHubVisitor({
      localIdentity: local,
      propsAuth: null
    });
    const openIdentityForGate = () => this._openIdentityModalForUser();
    const pv = (el) => wrapPublicVisitorGate(publicHubVisitor, openIdentityForGate, el);
    const hubPv = (el) => (
      <HubHttpRoute>{pv(el)}</HubHttpRoute>
    );
    const hubRuntime = this.state.hubRuntime === HUB_UI_RUNTIME_CLIENT
      ? HUB_UI_RUNTIME_CLIENT
      : HUB_UI_RUNTIME_HUB;

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
              onRequireUnlock={this.openIdentityModalFromGatedAction}
              onStateUpdate={this.handleBridgeStateUpdate}
              responseCapture={this.responseCapture}
            />
            <FabricMessagePrompt />
            <FederationContractInviteModal
              open={this.state.federationInviteModalOpen}
              detail={this.state.federationInviteDetail}
              auth={effectiveAuth}
              onClose={() => this.setState({ federationInviteModalOpen: false, federationInviteDetail: null })}
              getResponderPubkey={() => {
                const b = this.bridgeRef && this.bridgeRef.current;
                if (b && typeof b.getHtlcRefundPublicKeyHex === 'function') {
                  const pk = b.getHtlcRefundPublicKeyHex();
                  if (pk) return pk;
                }
                return (b && typeof b.getNodePubkey === 'function' && b.getNodePubkey()) || '';
              }}
              onSendPeerMessage={(toPeerId, text) => {
                const b = this.bridgeRef && this.bridgeRef.current;
                if (b && typeof b.sendPeerMessageRequest === 'function') b.sendPeerMessageRequest(toPeerId, text);
              }}
            />
            <CollaborationInviteModal
              open={this.state.collaborationInviteModalOpen}
              detail={this.state.collaborationInviteDetail}
              onClose={() => this.setState({ collaborationInviteModalOpen: false, collaborationInviteDetail: null })}
            />
            {(this.props.auth && this.props.auth.loading) ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.75em' }}>
                <Loader active inline="centered" size='huge' />
                <p style={{ color: '#666', margin: 0, textAlign: 'center', maxWidth: '22rem', lineHeight: 1.45 }}>{t.shell.bootstrap.loadingSession}</p>
              </div>
            ) : !this.state.setupChecked ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1em' }}>
                <Loader active={!this.state.setupStatusTimedOut} inline="centered" size='large' />
                <p style={{ color: '#666', margin: 0, textAlign: 'center', maxWidth: '22rem', lineHeight: 1.45 }}>
                  {this.state.setupStatusTimedOut
                    ? t.shell.bootstrap.timedOut
                    : t.shell.bootstrap.checking}
                </p>
                <p style={{ color: '#888', margin: 0, fontSize: '0.9em', textAlign: 'center', maxWidth: '24rem', lineHeight: 1.45 }}>
                  {this.state.setupStatusTimedOut
                    ? t.shell.bootstrap.timedOutDetail
                    : t.shell.bootstrap.checkingDetail}
                </p>
                {this.state.setupStatusTimedOut ? (
                  <Button
                    primary
                    type="button"
                    onClick={() => {
                      this.setState({ setupStatusTimedOut: false });
                      this._checkSetupStatus().finally(() => {
                        if (this._setupStatusSafetyTimer) {
                          clearTimeout(this._setupStatusSafetyTimer);
                          this._setupStatusSafetyTimer = null;
                        }
                        this._setupStatusSafetyTimer = setTimeout(() => {
                          this.setState((prev) => (prev.setupChecked ? null : { setupStatusTimedOut: true }));
                        }, 20000);
                      });
                    }}
                  >
                    {t.shell.bootstrap.retry}
                  </Button>
                ) : null}
              </div>
            ) : this.state.needsSetup ? (
              this.state.requiresSetupUiSecret && !this.state.setupUiVerified ? (
                <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '1.5em', boxSizing: 'border-box' }}>
                  <Message warning style={{ maxWidth: '28rem', width: '100%' }}>
                    <Message.Header>{t.shell.setupGate.title}</Message.Header>
                    <p style={{ marginTop: '0.5em', marginBottom: 0, lineHeight: 1.5 }}>
                      {t.shell.setupGate.body}
                    </p>
                    <details style={{ marginTop: '0.5em', fontSize: '0.9em' }}>
                      <summary>{t.common.developerDetails}</summary>
                      {t.shell.setupGate.developerHint}
                    </details>
                  </Message>
                  <Form
                    style={{ maxWidth: '22rem', width: '100%', marginTop: '1em' }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      this._verifySetupUiSecret();
                    }}
                  >
                    <Form.Field>
                      <label htmlFor="hub-setup-ui-secret">{t.shell.setupGate.label}</label>
                      <Input
                        id="hub-setup-ui-secret"
                        type="password"
                        autoComplete="off"
                        value={this.state.setupUiGatePassword}
                        onChange={(e) => this.setState({ setupUiGatePassword: e.target.value })}
                      />
                    </Form.Field>
                    {this.state.setupUiGateError ? (
                      <Message negative size="small" style={{ marginBottom: '0.75em' }}>{this.state.setupUiGateError}</Message>
                    ) : null}
                    <Button primary type="submit" loading={this.state.setupUiGateBusy} disabled={this.state.setupUiGateBusy}>
                      {t.shell.setupGate.submit}
                    </Button>
                  </Form>
                </div>
              ) : (
              <Onboarding
                nodeName="Hub"
                requiresSetupUiSecret={this.state.requiresSetupUiSecret}
                onConfigurationComplete={(result) => {
                  if (result && result.token) {
                    let openWizard = false;
                    try {
                      const idRec = readStorageJSON('fabric.identity.local', null);
                      openWizard = !hasCompletedPostSetupBrowserIdentity(idRec);
                    } catch (e) {}
                    try {
                      if (typeof window !== 'undefined') {
                        if (window.sessionStorage) {
                          window.sessionStorage.setItem('fabric.hub.wantIdentityWizard', openWizard ? '1' : '');
                        }
                        writeStorageString('fabric.hub.identityWizardPending', openWizard ? '1' : '');
                        if (!openWizard) {
                          writeStorageString('fabric.hub.identityWizardDismissed', '');
                        }
                      }
                    } catch (e) {}

                    this.setState({
                      adminToken: result.token,
                      adminTokenExpiresAt: result.expiresAt,
                      needsSetup: false,
                      postSetupIdentityWizardOpen: openWizard
                    });
                    if (typeof window !== 'undefined') {
                      try {
                        writeStorageString('fabric.hub.adminToken', result.token);
                        if (result.expiresAt != null) {
                          writeStorageString('fabric.hub.adminTokenExpiresAt', String(result.expiresAt));
                        }
                      } catch (e) {}
                    }
                  }
                }}
              />
              )
            ) : this._shouldShowPostSetupIdentityWizard() ? (
              <FabricPostSetupIdentityWizard
                hubAdminToken={this.state.adminToken}
                currentIdentity={local}
                defaultNetwork={hubNetwork}
                onLocalIdentityChange={this._handleIdentityManagerLocalChange}
                onUnlockSuccess={this._handleIdentityManagerUnlockSuccess}
                onLockStateChange={this._handleIdentityManagerLockStateChange}
                onForgetIdentity={this._handleIdentityManagerForget}
                onComplete={() => {
                  try {
                    writeStorageString('fabric.hub.identityWizardPending', '');
                    if (typeof window !== 'undefined' && window.sessionStorage) {
                      window.sessionStorage.removeItem('fabric.hub.wantIdentityWizard');
                    }
                  } catch (e) {}
                  this.setState({ postSetupIdentityWizardOpen: false });
                }}
                onSkip={() => {
                  try {
                    writeStorageString('fabric.hub.identityWizardDismissed', '1');
                    writeStorageString('fabric.hub.identityWizardPending', '');
                    if (typeof window !== 'undefined' && window.sessionStorage) {
                      window.sessionStorage.setItem('fabric.hub.identityWizardDismissed', '1');
                      window.sessionStorage.removeItem('fabric.hub.wantIdentityWizard');
                    }
                  } catch (e) {}
                  this.setState({ postSetupIdentityWizardOpen: false });
                }}
              />
            ) : (
              <HubUiRuntimeContext.Provider value={hubRuntime}>
              <HubMeshContext.Provider value={!!this.state.meshAvailable}>
              <BrowserRouter useTransitions>
                <ToastContainer
                  position="bottom-center"
                  newestOnTop
                  closeOnClick
                  pauseOnFocusLoss
                  draggable
                  pauseOnHover
                />
                <TopPanel
                  hubAddress={this.state.uiHubAddress}
                  auth={effectiveAuth}
                  adminToken={this.state.adminToken}
                  localIdentity={local}
                  hasLocalIdentity={!!hasLocal}
                  hasLockedIdentity={effectiveHasLockedIdentity}
                  publicHubVisitor={publicHubVisitor}
                  bitcoin={bitcoin}
                  clientBalance={this.state.clientBalance}
                  clientBalanceLoading={this.state.clientBalanceLoading}
                  onRefreshBalance={() => this._refreshClientBalance(true)}
                  onUnlockIdentity={() => this._openIdentityModalForUser()}
                  onLockIdentity={() => this._handleLockIdentity()}
                  onLogin={this.requestLogin}
                  onManageIdentity={this.openIdentityManager}
                  onSignMessage={() => this.setState({ uiSignMessageOpen: true })}
                  onDestroyIdentity={() => this.setState({ uiDestroyIdentityConfirmOpen: true })}
                  onOpenSettings={() => {
                    const uf = loadHubUiFeatureFlags();
                    this.setState({
                      uiSettingsOpen: true,
                      uiHubAddressDraft: this.state.uiHubAddress,
                      uiAdvancedModeDraft: !!uf.advancedMode,
                      uiHubAddressError: null
                    });
                  }}
                />
                <HubAlertStackLocationGate adminToken={this.state.adminToken} />
                {publicHubVisitor ? null : (
                  <FederationInviteNotificationBanner
                    detail={this.state.federationInviteBannerDetail}
                    onReview={this._openFederationInviteReview}
                    onDismiss={this._dismissFederationInviteBanner}
                  />
                )}

                <Modal
                  size="large"
                  closeOnDimmerClick={false}
                  closeOnEscape={false}
                  open={!!this.state.uiIdentityOpen}
                  onClose={() => this.setState({ uiIdentityOpen: false })}
                  aria-labelledby="fabric-identity-modal-heading"
                  style={{ margin: '1rem auto', maxWidth: 'calc(100vw - 1.5rem)' }}
                >
                  <Modal.Content
                    scrolling
                    style={{
                      maxWidth: '100%',
                      minWidth: 0,
                      overflowX: 'hidden',
                      WebkitOverflowScrolling: 'touch',
                      boxSizing: 'border-box'
                    }}
                  >
                    {effectiveAuth && effectiveAuth.fabricIdentityMode === 'account' ? (
                      <div
                        style={{
                          marginBottom: '1rem',
                          padding: '0.75rem 1rem',
                          background: 'rgba(0,0,0,0.03)',
                          borderRadius: '0.28571429rem',
                          border: '1px solid rgba(34,36,38,.15)'
                        }}
                      >
                        <FabricIdentityAccountControls
                          localIdentity={effectiveAuth}
                          onFabricAccountChange={this._fabricAccountChange}
                        />
                        <p style={{ margin: '0.6em 0 0', color: '#666', fontSize: '0.9em', lineHeight: 1.45 }}>
                          {t.shell.identityModal.accountNote} (<code>m/44&apos;/0&apos;/n&apos;</code> {t.shell.identityModal.accountPath}).
                        </p>
                      </div>
                    ) : null}
                    <IdentityManager
                      key="fabric-identity-manager"
                      hubAdminToken={this.state.adminToken}
                      currentIdentity={this.state.uiLocalIdentity}
                      defaultNetwork={hubNetwork}
                      onLocalIdentityChange={this._handleIdentityManagerLocalChange}
                      onLockStateChange={this._handleIdentityManagerLockStateChange}
                      onUnlockSuccess={this._handleIdentityManagerUnlockSuccess}
                      onForgetIdentity={this._handleIdentityManagerForget}
                    />
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={this._closeHubIdentityModal}>
                      {t.shell.identityModal.close}
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
                    {t.shell.settingsModal.title}
                  </Header>
                  <Modal.Content>
                    <Form>
                      <Form.Field>
                        <Checkbox
                          toggle
                          label={t.shell.settingsModal.advanced}
                          checked={!!this.state.uiAdvancedModeDraft}
                          onChange={(e, data) => this.setState({ uiAdvancedModeDraft: !!(data && data.checked) })}
                        />
                        <div style={{ marginTop: '0.5em', color: '#666' }}>
                          {t.shell.settingsModal.advancedHint}
                        </div>
                      </Form.Field>
                      <Form.Field>
                        <label htmlFor="hub-settings-address">{t.shell.settingsModal.address}</label>
                        <Input
                          id="hub-settings-address"
                          placeholder={t.shell.settingsModal.addressPlaceholder}
                          value={this.state.uiHubAddressDraft || ''}
                          onChange={(e) => this.setState({ uiHubAddressDraft: e.target.value, uiHubAddressError: null })}
                        />
                        <div style={{ marginTop: '0.5em', color: '#666' }}>
                          {t.shell.settingsModal.addressHint}
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
                      {t.shell.settingsModal.cancel}
                    </Button>
                    <Button
                      primary
                      onClick={() => {
                        const raw = (this.state.uiHubAddressDraft || '').trim();
                        if (!raw) {
                          this.setState({ uiHubAddressError: t.shell.settingsModal.addressRequired });
                          return;
                        }

                        try {
                          if (typeof window !== 'undefined') {
                            writeStorageString('fabric.hub.address', raw);
                          }
                        } catch (e) {}
                        try {
                          setHubUiFeatureFlag('advancedMode', !!this.state.uiAdvancedModeDraft);
                        } catch (e) {}

                        this.setState({ uiHubAddress: raw, uiSettingsOpen: false, uiHubAddressError: null }, () => {
                          try {
                            if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.setHubAddress === 'function') {
                              const ok = this.bridgeRef.current.setHubAddress(raw);
                              if (!ok) this.setState({ uiHubAddressError: t.shell.settingsModal.addressInvalid });
                            }
                          } catch (e) {}
                        });
                      }}
                    >
                      {t.shell.settingsModal.save}
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
                    {t.shell.signModal.title}
                  </Header>
                  <Modal.Content>
                    <Form>
                      <Form.Field>
                        <label htmlFor="hub-sign-message">{t.shell.signModal.messageToSign}</label>
                        <Input
                          id="hub-sign-message"
                          placeholder={t.shell.signModal.messageToSignPlaceholder}
                          value={this.state.uiSignMessageText || ''}
                          onChange={(e) => this.setState({ uiSignMessageText: e.target.value, uiSignMessageResult: null })}
                        />
                      </Form.Field>
                      {this.state.uiSignMessageResult && (
                        <Message className="fade-in">
                          <Form.Field>
                            <label>{t.shell.signModal.publicKey}</label>
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
                            <label>{t.shell.signModal.signature}</label>
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
                        {t.shell.signModal.verifyTitle}
                      </Header>
                      <p style={{ color: '#666', fontSize: '0.95em', marginBottom: '1em' }}>
                        {t.shell.signModal.verifyIntro}
                      </p>
                      <Form.Field>
                        <label htmlFor="hub-verify-message">{t.shell.signModal.message}</label>
                        <Input
                          id="hub-verify-message"
                          placeholder={t.shell.signModal.messagePlaceholder}
                          value={this.state.uiVerifyMessageText || ''}
                          onChange={(e) => this.setState({ uiVerifyMessageText: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      <Form.Field>
                        <label htmlFor="hub-verify-pubkey">{t.shell.signModal.publicKey}</label>
                        <Input
                          id="hub-verify-pubkey"
                          placeholder={t.shell.signModal.publicKeyPlaceholder}
                          value={this.state.uiVerifyPublicKey || ''}
                          onChange={(e) => this.setState({ uiVerifyPublicKey: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      <Form.Field>
                        <label htmlFor="hub-verify-signature">{t.shell.signModal.signatureHex}</label>
                        <Input
                          id="hub-verify-signature"
                          placeholder={t.shell.signModal.signaturePlaceholder}
                          value={this.state.uiVerifySignature || ''}
                          onChange={(e) => this.setState({ uiVerifySignature: e.target.value, uiVerifyResult: null })}
                        />
                      </Form.Field>
                      {this.state.uiVerifyResult === true && (
                        <Message success className="fade-in">
                          <Icon name="check" color="green" size="large" />
                          {t.shell.signModal.valid}
                        </Message>
                      )}
                      {this.state.uiVerifyResult === false && (
                        <Message negative className="fade-in">
                          <Icon name="close" color="red" size="large" />
                          {t.shell.signModal.invalid}
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
                      {t.shell.signModal.close}
                    </Button>
                    <Button
                      primary
                      loading={!!this.state.uiSignMessageBusy}
                      onClick={() => {
                        const text = (this.state.uiSignMessageText || '').trim();
                        if (!text) return;
                        const bridge = this.bridgeRef && this.bridgeRef.current;
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
                      {t.shell.signModal.sign}
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
                      {t.shell.signModal.verify}
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
                    {t.shell.destroyModal.title}
                  </Header>
                  <Modal.Content>
                    <p>{t.shell.destroyModal.body}</p>
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={() => this.setState({ uiDestroyIdentityConfirmOpen: false })}>
                      {t.shell.destroyModal.cancel}
                    </Button>
                    <Button
                      negative
                      onClick={() => {
                        if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearAllDocuments === 'function') {
                          try { this.bridgeRef.current.clearAllDocuments(); } catch (e) {}
                        }
                        try {
                          if (typeof window !== 'undefined') {
                            clearFabricBrowserIdentityLocal();
                            suppressActiveDevSeed();
                            void endPassportSession();
                            removeStorageKey('fabric.linkedDevices');
                            removeStorageKey('fabric:documents');
                            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.storage.local.remove) {
                              chrome.storage.local.remove(['fabric.identity.ext']);
                            }
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
                      {t.shell.destroyModal.confirm}
                    </Button>
                  </Modal.Actions>
                </Modal>

                <Routes>
                  <Route
                    path="/"
                    element={(
                      <Home
                        auth={effectiveAuth}
                        publicHubVisitor={publicHubVisitor}
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
                        onRequireUnlock={this.openIdentityModalFromGatedAction}
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
                        <FeaturesPage publicHubVisitor={publicHubVisitor} />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/downloads"
                    element={<DownloadsHome />}
                  />
                  <Route
                    path="/downloads/*"
                    element={<DownloadsHome />}
                  />
                  <Route
                    path="/activities"
                    element={hubPv((
                      <UiFlagRoute flag="activities">
                        <ActivitiesHome
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          identity={local || effectiveAuth}
                          onRequireUnlock={this.openIdentityModalFromGatedAction}
                        />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/notifications"
                    element={hubPv((
                      <UiFlagRoute flag="activities">
                        <NotificationsHome adminToken={this.state.adminToken} />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin"
                    element={hubPv((
                      <BitcoinHomeWithNav
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        adminToken={this.state.adminToken}
                        bitcoinPage="dashboard"
                        {...this.props}
                      />
                    ))}
                  />
                  <Route path="/services/payjoin" element={<NavigatePayjoinSpaAlias />} />
                  <Route
                    path="/services/bitcoin/blocks"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinExplorer">
                        <BitcoinBlockList
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bitcoin={bitcoin}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/faucet"
                    element={hubPv((
                      <FaucetHome
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bitcoin={bitcoin}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        adminToken={this.state.adminToken}
                        {...this.props}
                      />
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/transactions"
                    element={hubPv((
                      <BitcoinTransactionsHome
                        auth={effectiveAuth}
                        identity={local || effectiveAuth}
                        bitcoin={bitcoin}
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        adminToken={this.state.adminToken}
                        {...this.props}
                      />
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/blocks/:blockhash"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinExplorer">
                        <BitcoinBlockView
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/resources"
                    element={hubPv((
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
                    ))}
                  />
                  <Route
                    path="/services/coinjoin"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinPayments">
                        <CoinjoinHome adminToken={this.state.adminToken} />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/payments"
                    element={<NavigatePaymentsLegacyToCanonical />}
                  />
                  <Route
                    path="/payments"
                    element={hubPv((
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
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/crowdfunds"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinCrowdfund">
                        <CrowdfundingHome
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bitcoin={bitcoin}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          onRequireUnlock={this.openIdentityModalFromGatedAction}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/invoices"
                    element={hubPv((
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
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/lightning"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinLightning">
                        <LightningHome
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bitcoin={bitcoin}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/lightning"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinLightning">
                        <LightningHome
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bitcoin={bitcoin}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          adminToken={this.state.adminToken}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/transactions/:txhash"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinExplorer">
                        <BitcoinTransactionView
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          bridge={this.props.bridge}
                          bridgeRef={this.bridgeRef}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin/channels/:id"
                    element={hubPv((
                      <UiFlagRoute flag="bitcoinLightning">
                        <ChannelView
                          auth={effectiveAuth}
                          identity={local || effectiveAuth}
                          {...this.props}
                        />
                      </UiFlagRoute>
                    ))}
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
                    element={hubPv((
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
                    ))}
                  />
                  <Route
                    path="/peers"
                    element={hubPv((
                      <PeersFeatureRoute>
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
                        adminPeerToolsToken={
                          this.state.adminToken
                          || (typeof window !== 'undefined' ? readStorageString('fabric.hub.adminToken') : '')
                          || ''
                        }
                        onSendFlushChainToTrustedPeers={(body) => {
                          const t = this.state.adminToken
                            || (typeof window !== 'undefined' ? readStorageString('fabric.hub.adminToken') : '')
                            || '';
                          if (!t || !body || !this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendFlushChainToTrustedPeersRequest === 'function') {
                            bridgeInstance.sendFlushChainToTrustedPeersRequest(body, t);
                          }
                        }}
                        {...this.props}
                      />
                      </PeersFeatureRoute>
                    ))}
                  />
                  <Route
                    path="/peers/:id"
                    element={hubPv((
                      <PeersFeatureRoute>
                        {this._hubPeerView(effectiveAuth, local || effectiveAuth, undefined)}
                      </PeersFeatureRoute>
                    ))}
                  />
                  <Route
                    path="/settings/admin/peers/:id"
                    element={hubPv((
                      <PeersFeatureRoute>
                        {this._hubPeerView(effectiveAuth, local || effectiveAuth, this.state.adminToken)}
                      </PeersFeatureRoute>
                    ))}
                  />
                  <Route
                    path="/documents"
                    element={(
                      <HubMeshRoute>
                      <DocumentList
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        identity={local || effectiveAuth}
                        inventoryCatalog={this.state.hubRuntime === HUB_UI_RUNTIME_CLIENT}
                        onListDocuments={() => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendListDocumentsRequest === 'function') {
                            bridgeInstance.sendListDocumentsRequest();
                          }
                          if (typeof bridgeInstance.sendRefreshDocumentMarketRequest === 'function') {
                            bridgeInstance.sendRefreshDocumentMarketRequest();
                          }
                          if (typeof bridgeInstance.requestConnectedPeerInventories === 'function') {
                            bridgeInstance.requestConnectedPeerInventories();
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
                      </HubMeshRoute>
                    )}
                  />
                  <Route
                    path="/documents/:id"
                    element={(
                      <HubMeshRoute>
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
                        onRequestUnlock={this.openIdentityModalFromGatedAction}
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
                            return { ok: false, error: t.shell.bridgeErrors.notReady };
                          }
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.unlockHtlcEncryptedDocument !== 'function') {
                            return { ok: false, error: t.shell.bridgeErrors.htlcUnavailable };
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
                            : Promise.resolve({ error: t.shell.bridgeErrors.claimUnavailable });
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
                        onSendDistributeProposal={(peerKey, proposal) => {
                          if (!this.bridgeRef || !this.bridgeRef.current) return;
                          const bridgeInstance = this.bridgeRef.current;
                          if (typeof bridgeInstance.sendSendDistributeProposalRequest === 'function') {
                            bridgeInstance.sendSendDistributeProposalRequest(peerKey, proposal);
                          }
                        }}
                        {...this.props}
                        adminToken={this.state.adminToken}
                      />
                      </HubMeshRoute>
                    )}
                  />
                  <Route
                    path="/settings/admin/beacon-federation"
                    element={hubPv((
                      <UiFlagRoute flag="sidechain">
                        <BeaconFederationHome />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/settings/admin"
                    element={hubPv(<AdminHome adminToken={this.state.adminToken} />)}
                  />
                  <Route
                    path="/federation"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <Navigate to="/federations" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/federations"
                    element={hubPv((
                      <UiFlagRoute flag="sidechain">
                        <FederationsHome adminToken={this.state.adminToken} bridgeRef={this.bridgeRef} />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/settings/federation"
                    element={hubPv((
                      <UiFlagRoute flag="sidechain">
                        <SettingsFederationHome adminToken={this.state.adminToken} bridgeRef={this.bridgeRef} />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/settings/bitcoin-wallet"
                    element={pv(<SettingsBitcoinWallet identity={local || effectiveAuth} />)}
                  />
                  <Route
                    path="/settings/security"
                    element={hubPv(<SecurityHome identity={this.state.uiLocalIdentity} />)}
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
                    path="/settings/collaboration"
                    element={(
                      <HubHttpRoute>
                      {readHubAdminTokenFromBrowser(this.state.adminToken)
                        ? pv((
                          <CollaborationHome
                            bridgeRef={this.bridgeRef}
                            adminToken={this.state.adminToken}
                          />
                        ))
                        : (<Navigate to="/settings" replace />)}
                      </HubHttpRoute>
                    )}
                  />
                  <Route
                    path="/settings"
                    element={<SettingsHome publicHubVisitor={publicHubVisitor} />}
                  />
                  <Route
                    path="/sessions"
                    element={hubPv(<Navigate to="/settings/security" replace />)}
                  />
                  <Route
                    path="/security"
                    element={hubPv(<Navigate to="/settings/security" replace />)}
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
                    element={<Navigate to="/services/bitcoin/transactions" replace />}
                  />
                  <Route
                    path="/bitcoin"
                    element={<Navigate to="/services/bitcoin" replace />}
                  />
                  <Route
                    path="/crowdfunds"
                    element={(
                      <UiFlagRoute flag="bitcoinCrowdfund">
                        <Navigate to="/services/bitcoin/crowdfunds" replace />
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
                    element={hubPv(<ContractsHome {...this.props} />)}
                  />
                  <Route
                    path="/contracts/:id"
                    element={hubPv(<ContractView {...this.props} adminToken={this.state.adminToken} />)}
                  />
                  <Route path="*" element={<UnknownRouteShell />} />
                </Routes>
                <BottomPanel
                  pubkey={nodePubkey}
                  adminToken={this.state.adminToken}
                  publicHubVisitor={publicHubVisitor}
                />
              </BrowserRouter>
              </HubMeshContext.Provider>
              </HubUiRuntimeContext.Provider>
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
