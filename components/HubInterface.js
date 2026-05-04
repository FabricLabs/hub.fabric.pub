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
const { safeIdentityErr } = require('../functions/fabricSafeLog');
const {
  readStorageString,
  readStorageJSON,
  writeStorageString,
  writeStorageJSON,
  removeStorageKey
} = require('../functions/fabricBrowserState');
const { hasCompletedPostSetupBrowserIdentity } = require('../functions/fabricPostSetupBrowserIdentity');
const {
  loadHubUiFeatureFlags,
  setHubUiFeatureFlag,
  subscribeHubUiFeatureFlags,
  fetchPersistedHubUiFeatureFlags
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
const {
  buildLocalFabricIdentityPayload,
  plaintextMasterFromStored,
  fabricPlaintextSigningUnlockable
} = require('../functions/fabricHubLocalIdentity');
const {
  deriveFabricAccountIdentityKeys,
  fabricRootXpubFromMasterXprv
} = require('../functions/fabricAccountDerivedIdentity');

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
      <p style={{ color: '#666', marginBottom: '0.75em', lineHeight: 1.45 }}>
        No hub UI for{' '}
        <code style={{ wordBreak: 'break-all' }}>{full}</code>
        .
      </p>
      <p style={{ color: '#666', marginBottom: '0.5em', lineHeight: 1.45 }}>
        Use the <strong>top navigation</strong> (Home, Documents, Contracts, and <strong>More</strong>) — it lists the same places without duplicating them here.
        {uf.activities ? ' The bell opens Notifications (toasts); the activity log is under More → Activity log.' : ''}
      </p>
      <p style={{ color: '#666', lineHeight: 1.45 }}>
        <Link to="/">Go to Home</Link>
        {' · '}
        <Link to="/settings">Settings</Link>
        {(uf.bitcoinPayments || uf.bitcoinLightning) ? (
          <>
            {' · '}
            <Link
              to={{
                pathname: '/services/bitcoin',
                hash: uf.bitcoinPayments ? 'fabric-bitcoin-payjoin' : 'fabric-bitcoin-lightning'
              }}
            >
              Treasury (Payjoin / Lightning)
            </Link>
          </>
        ) : null}
        {uf.sidechain ? (
          <>
            {' · '}
            <Link to="/sidechains">Sidechain &amp; demo</Link>
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
  loadUpstreamSettings,
  saveSpendXpubWatchForIdentity,
  clearSpendXpubWatch
} = require('../functions/bitcoinClient');
const { ToastContainer, toast: toastify, Slide } = require('react-toastify');
const { toast } = require('../functions/toast');
const SecurityHome = require('./SecurityHome');
const SecuritySessionHome = require('./SecuritySessionHome');
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
const DelegationSigningModal = require('./DelegationSigningModal');
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
      <p style={{ color: '#666', maxWidth: '32rem', margin: '0 auto 0.75em', lineHeight: 1.45 }}>
        Create or restore a local Fabric identity to access this feature (encrypt documents, sign publishes, and use the browser Bitcoin account tied to your keys).
      </p>
      <p style={{ color: '#666', maxWidth: '32rem', margin: '0 auto 1em', lineHeight: 1.45 }}>
        Use <strong>Log in</strong> below, the top-bar identity menu, or open{' '}
        <Link to="/settings">Settings</Link> → <strong>Fabric identity</strong> for the same unlock/import flow.{' '}
        <Link to="/settings/bitcoin-wallet">Bitcoin wallet &amp; derivation</Link> explains on-chain addresses for this identity.
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
      if (typeof window !== 'undefined') {
        initialHubAddress = readStorageString('fabric.hub.address') || '';
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
              console.warn('[HUB] FABRIC_DEV_BROWSER_* bootstrap failed:', safeIdentityErr(r.error));
            }
          } catch (e) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[HUB] FABRIC_DEV_BROWSER_* ignored:', safeIdentityErr(e));
            }
          }
        }

        const parsed = readStorageJSON('fabric.identity.local', null);
        if (parsed && (parsed.id || parsed.xpub)) {
          try {
            const bl = buildLocalFabricIdentityPayload(parsed, { unlockPlaintextMaster: true });
            if (bl.resolved && bl.record) {
              const r = bl.record;
              initialLocalIdentity = {
                id: r.id,
                xpub: r.xpub,
                xprv: null,
                passwordProtected: !!r.passwordProtected,
                plaintextUnlockAvailable: !!r.plaintextUnlockAvailable,
                fabricIdentityMode: r.fabricIdentityMode || undefined,
                fabricHdRole: r.fabricHdRole || undefined,
                fabricAccountIndex:
                  r.fabricAccountIndex != null ? Math.floor(Number(r.fabricAccountIndex)) : undefined,
                masterXpub: r.masterXpub || undefined,
                linkedFromDesktop: !!parsed.linkedFromDesktop
              };
              initialHasLockedIdentity = !!(
                initialLocalIdentity.passwordProtected || initialLocalIdentity.plaintextUnlockAvailable
              );
            }
          } catch (e) {}
        }

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
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith('<')) {
          this.setState({ setupChecked: true });
          return;
        }
        const data = JSON.parse(text);
        let setupUiVerified = false;
        try {
          if (data.requiresSetupUiSecret && typeof window !== 'undefined' && window.sessionStorage) {
            setupUiVerified = window.sessionStorage.getItem('fabric.hub.setupUiVerified') === '1';
          }
        } catch (eVer) {}
        this.setState({
          needsSetup: !!data.needsSetup,
          setupChecked: true,
          requiresSetupUiSecret: !!data.requiresSetupUiSecret,
          setupUiVerified
        });
      } else {
        this.setState({ setupChecked: true });
      }
    } catch (e) {
      this.setState({ setupChecked: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async _verifySetupUiSecret () {
    const pwd = String(this.state.setupUiGatePassword || '').trim();
    if (!pwd) {
      this.setState({ setupUiGateError: 'Enter the setup secret from the operator.' });
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
      let errMsg = 'Invalid setup secret.';
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
        setupUiGateError: e && e.message ? String(e.message) : 'Request failed.'
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
    if (!info || (!info.id && !info.xpub)) return '';
    const hasX = !!(info.xprv && String(info.xprv).trim());
    const plainAvail = !!info.plaintextUnlockAvailable;
    const acct = info.fabricAccountIndex != null && info.fabricAccountIndex !== ''
      ? String(Math.floor(Number(info.fabricAccountIndex)))
      : '';
    const mode = info.fabricIdentityMode ? String(info.fabricIdentityMode) : '';
    const hd = info.fabricHdRole ? String(info.fabricHdRole) : '';
    return `${String(info.id || '')}|${String(info.xpub || '')}|${hasX ? '1' : '0'}|${info.passwordProtected ? '1' : '0'}|${plainAvail ? '1' : '0'}|${info.linkedFromDesktop ? '1' : '0'}|${mode}|${acct}|${hd}`;
  }

  _handleIdentityManagerLocalChange (info) {
    if (info && (info.id || info.xpub)) {
      try {
        writeStorageString('fabric.hub.identityWizardPending', '');
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem('fabric.hub.wantIdentityWizard');
        }
      } catch (e) {}
    }
    this.setState((prev) => {
      if (!info) {
        try { clearSpendXpubWatch(); } catch (_) {}
        if (!prev.uiLocalIdentity && !prev.uiHasLockedIdentity) return {};
        return {
          uiLocalIdentity: null,
          uiHasLockedIdentity: false,
          clientBalance: null,
          clientBalanceLoading: false
        };
      }
      const prevId = prev.uiLocalIdentity && prev.uiLocalIdentity.id != null
        ? String(prev.uiLocalIdentity.id) : '';
      const nextId = info.id != null ? String(info.id) : '';
      const prevXpub = prev.uiLocalIdentity && prev.uiLocalIdentity.xpub != null
        ? String(prev.uiLocalIdentity.xpub) : '';
      const nextXpub = info.xpub != null ? String(info.xpub) : '';
      const sameIdentity = !!prev.uiLocalIdentity && prevId === nextId && prevXpub === nextXpub;
      if (prev.uiLocalIdentity && prev.uiLocalIdentity.xprv && !info.xprv && !sameIdentity) {
        return {};
      }
      const hasXprv = !!(info.xprv && String(info.xprv).trim());
      const passwordProtected = !!info.passwordProtected;
      const plaintextUnlockAvailable =
        info.plaintextUnlockAvailable != null
          ? !!info.plaintextUnlockAvailable
          : (!!prev.uiLocalIdentity &&
            !!prev.uiLocalIdentity.plaintextUnlockAvailable &&
            prevId === nextId &&
            prevXpub === nextXpub &&
            !hasXprv &&
            !passwordProtected);
      const linkedFromDesktop = info.linkedFromDesktop != null
        ? !!info.linkedFromDesktop
        : !!(prev.uiLocalIdentity && prev.uiLocalIdentity.linkedFromDesktop);
      const nextIdentity = {
        id: info.id,
        xpub: info.xpub,
        xprv: hasXprv ? info.xprv : undefined,
        passwordProtected,
        linkedFromDesktop
      };
      if (info.fabricIdentityMode != null && info.fabricIdentityMode !== '') {
        nextIdentity.fabricIdentityMode = info.fabricIdentityMode;
      } else if (prev.uiLocalIdentity && prev.uiLocalIdentity.fabricIdentityMode) {
        nextIdentity.fabricIdentityMode = prev.uiLocalIdentity.fabricIdentityMode;
      }
      if (info.fabricAccountIndex != null && info.fabricAccountIndex !== '') {
        nextIdentity.fabricAccountIndex = Math.floor(Number(info.fabricAccountIndex));
      } else if (prev.uiLocalIdentity && prev.uiLocalIdentity.fabricAccountIndex != null) {
        nextIdentity.fabricAccountIndex = prev.uiLocalIdentity.fabricAccountIndex;
      }
      if (info.fabricHdRole != null && String(info.fabricHdRole).trim() !== '') {
        nextIdentity.fabricHdRole = info.fabricHdRole;
      } else if (prev.uiLocalIdentity && prev.uiLocalIdentity.fabricHdRole) {
        nextIdentity.fabricHdRole = prev.uiLocalIdentity.fabricHdRole;
      }
      if (info.masterXprv != null && String(info.masterXprv).trim()) {
        nextIdentity.masterXprv = info.masterXprv;
      } else if (prev.uiLocalIdentity && prev.uiLocalIdentity.masterXprv && hasXprv) {
        nextIdentity.masterXprv = prev.uiLocalIdentity.masterXprv;
      }
      if (info.masterXpub != null && String(info.masterXpub).trim()) {
        nextIdentity.masterXpub = info.masterXpub;
      } else if (prev.uiLocalIdentity && prev.uiLocalIdentity.masterXpub) {
        nextIdentity.masterXpub = prev.uiLocalIdentity.masterXpub;
      }
      if (plaintextUnlockAvailable && !hasXprv && !passwordProtected) {
        nextIdentity.plaintextUnlockAvailable = true;
      }
      const nextHasLocked = !hasXprv && (passwordProtected || !!nextIdentity.plaintextUnlockAvailable);
      if (
        this._hubIdentityUiSnapshotKey(prev.uiLocalIdentity) === this._hubIdentityUiSnapshotKey(nextIdentity) &&
        !!prev.uiHasLockedIdentity === !!nextHasLocked
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
      const hasIdent = !!(prev.uiLocalIdentity && (prev.uiLocalIdentity.id || prev.uiLocalIdentity.xpub));
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
    if (identityInfo && typeof identityInfo === 'object' && (identityInfo.id || identityInfo.xpub)) {
      try {
        writeStorageString('fabric.hub.identityWizardPending', '');
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem('fabric.hub.wantIdentityWizard');
        }
      } catch (e) {}
      const next = {
        id: identityInfo.id,
        xpub: identityInfo.xpub,
        xprv: identityInfo.xprv || undefined,
        passwordProtected: !!identityInfo.passwordProtected
      };
      if (identityInfo.fabricIdentityMode) next.fabricIdentityMode = identityInfo.fabricIdentityMode;
      if (identityInfo.fabricAccountIndex != null) {
        next.fabricAccountIndex = Math.floor(Number(identityInfo.fabricAccountIndex));
      }
      if (identityInfo.fabricHdRole) next.fabricHdRole = identityInfo.fabricHdRole;
      if (identityInfo.masterXprv) next.masterXprv = identityInfo.masterXprv;
      if (identityInfo.masterXpub) next.masterXpub = identityInfo.masterXpub;
      this.setState({
        uiLocalIdentity: next,
        uiHasLockedIdentity: false,
        uiIdentityOpen: false
      });
    } else {
      this.setState({ uiIdentityOpen: false });
    }
  }

  _handleIdentityManagerForget () {
    try { clearSpendXpubWatch(); } catch (_) {}
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

  _fabricAccountChange (nextAccountIndex) {
    try {
      const ai = Math.floor(Number(nextAccountIndex));
      if (!Number.isFinite(ai) || ai < 0) return;
      let parsed = null;
      try {
        parsed = readStorageJSON('fabric.identity.local', null);
      } catch (_) {}
      if (!parsed || parsed.fabricIdentityMode !== 'account') return;
      if (parsed.passwordProtected) return;
      if (parsed.fabricHdRole === 'accountNode' || parsed.fabricHdRole === 'watchAccount') return;
      const master = plaintextMasterFromStored(parsed);
      if (!master) return;

      const dk = deriveFabricAccountIdentityKeys(master, ai, 0);
      const masterXp =
        parsed.masterXpub && String(parsed.masterXpub).trim()
          ? String(parsed.masterXpub).trim()
          : fabricRootXpubFromMasterXprv(master);
      const nextPayload = Object.assign({}, parsed, {
        fabricIdentityMode: 'account',
        fabricAccountIndex: ai,
        id: dk.id,
        xpub: dk.xpub,
        masterXpub: masterXp
      });
      writeStorageJSON('fabric.identity.local', nextPayload);

      this.setState((prev) => {
        const loc = prev.uiLocalIdentity || {};
        const hadKey = !!(loc && loc.xprv);
        if (hadKey) {
          const mx =
            parsed.masterXpub && String(parsed.masterXpub).trim()
              ? String(parsed.masterXpub).trim()
              : fabricRootXpubFromMasterXprv(master);
          return {
            uiLocalIdentity: {
              ...loc,
              id: dk.id,
              xpub: dk.xpub,
              xprv: dk.xprv,
              fabricIdentityMode: 'account',
              fabricAccountIndex: ai,
              masterXprv: master,
              masterXpub: mx
            },
            uiHasLockedIdentity: false
          };
        }

        try {
          const bl = buildLocalFabricIdentityPayload(nextPayload, { unlockPlaintextMaster: true });
          if (!bl.resolved || !bl.record) return {};
          const r = bl.record;
          return {
            uiLocalIdentity: Object.assign({}, loc, {
              id: r.id,
              xpub: r.xpub,
              passwordProtected: !!r.passwordProtected,
              plaintextUnlockAvailable: !!r.plaintextUnlockAvailable,
              fabricIdentityMode: 'account',
              fabricAccountIndex: ai,
              masterXpub: r.masterXpub
            }),
            uiHasLockedIdentity: !!(r.passwordProtected || r.plaintextUnlockAvailable)
          };
        } catch (_) {
          return {};
        }
      });
    } catch (e) {
      console.error('[HUB]', 'Fabric account switch failed:', safeIdentityErr(e));
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
      toastify.info('A peer declined your federation contract invite.', { transition: Slide });
      return;
    }
    const admin = this.state.adminToken || (typeof window !== 'undefined' && readStorageString('fabric.hub.adminToken'));
    const pk = d.responderPubkey;
    if (!pk) {
      toastify.warning('Federation invite accepted but no responder pubkey was included.', { transition: Slide });
      return;
    }
    if (!admin) {
      toastify.info(`Peer accepted federation invite (pubkey ${pk.slice(0, 10)}…). Add their pubkey under More → Federations (or Settings → Distributed federation).`, { transition: Slide, autoClose: 8000 });
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
    this._setupStatusSafetyTimer = setTimeout(() => {
      this.setState((prev) => (prev.setupChecked ? null : { setupChecked: true }));
    }, 20000);
    this._checkSetupStatus().finally(() => {
      if (this._setupStatusSafetyTimer) {
        clearTimeout(this._setupStatusSafetyTimer);
        this._setupStatusSafetyTimer = null;
      }
    });
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
      this._hubUiUnsub = subscribeHubUiFeatureFlags(() => this.forceUpdate());
      fetchPersistedHubUiFeatureFlags().then(() => this.forceUpdate()).catch(() => {});
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
    const prevId = prevState.uiLocalIdentity || prevProps.auth || {};
    const nextId = this.state.uiLocalIdentity || this.props.auth || {};
    const prevXpub = prevId.xpub;
    const nextXpub = nextId.xpub;
    const prevFab = prevId.fabricAccountIndex;
    const nextFab = nextId.fabricAccountIndex;
    if (prevXpub !== nextXpub || prevFab !== nextFab) this._refreshClientBalance();
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
    let plaintextStored = false;
    try {
      const p = readStorageJSON('fabric.identity.local', null);
      plaintextStored = !!(p && fabricPlaintextSigningUnlockable(p));
    } catch (_) {}
    if (!local.passwordProtected && !plaintextStored) return;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('fabric.identity.unlocked');
      }
      if (this.bridgeRef && this.bridgeRef.current && typeof this.bridgeRef.current.clearDecryptedDocuments === 'function') {
        try { this.bridgeRef.current.clearDecryptedDocuments(); } catch (e) {}
      }
      const next = {
        id: local.id,
        xpub: local.xpub,
        passwordProtected: !!local.passwordProtected
      };
      if (local.fabricIdentityMode) next.fabricIdentityMode = local.fabricIdentityMode;
      if (local.fabricHdRole != null && String(local.fabricHdRole).trim() !== '') {
        next.fabricHdRole = local.fabricHdRole;
      }
      if (local.fabricAccountIndex != null) next.fabricAccountIndex = local.fabricAccountIndex;
      if (local.masterXpub) next.masterXpub = local.masterXpub;
      if (plaintextStored && !local.passwordProtected) {
        next.plaintextUnlockAvailable = true;
      }
      this.setState({
        uiLocalIdentity: next,
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

    // Auth: prefer in-session local identity (with id/xpub) so button shows identity after login
    const local = this.state.uiLocalIdentity;
    const hasLocal = local && (local.id || local.xpub);
    const effectiveAuth = hasLocal ? local : this.props.auth;
    // Locked chip: derive only from shell identity fields — never trust orphan uiHasLockedIdentity when
    // local is empty (TopPanel still merges persisted storage into the chip and could show "Locked"
    // if hasLockedIdentity stayed true from a stale callback).
    const effectiveHasLockedIdentity = !!(
      hasLocal &&
      !local.xprv &&
      (local.passwordProtected || local.plaintextUnlockAvailable)
    );
    const publicHubVisitor = computePublicHubVisitor({
      localIdentity: local,
      propsAuth: this.props.auth
    });
    const openIdentityForGate = () => this._openIdentityModalForUser();
    const pv = (el) => wrapPublicVisitorGate(publicHubVisitor, openIdentityForGate, el);

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
            <DelegationSigningModal bridgeRef={this.bridgeRef} />
            <FederationContractInviteModal
              open={this.state.federationInviteModalOpen}
              detail={this.state.federationInviteDetail}
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
                <p style={{ color: '#666', margin: 0, textAlign: 'center', maxWidth: '22rem', lineHeight: 1.45 }}>Loading session…</p>
              </div>
            ) : !this.state.setupChecked ? (
              <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1em' }}>
                <Loader active inline="centered" size='large' />
                <p style={{ color: '#666', margin: 0, textAlign: 'center', maxWidth: '22rem', lineHeight: 1.45 }}>
                  Checking hub configuration…
                </p>
                <p style={{ color: '#888', margin: 0, fontSize: '0.9em', textAlign: 'center', maxWidth: '24rem', lineHeight: 1.45 }}>
                  Fetching setup status from this hub (not the WebSocket path).
                </p>
              </div>
            ) : this.state.needsSetup ? (
              this.state.requiresSetupUiSecret && !this.state.setupUiVerified ? (
                <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '1.5em', boxSizing: 'border-box' }}>
                  <Message warning style={{ maxWidth: '28rem', width: '100%' }}>
                    <Message.Header>Operator setup</Message.Header>
                    <p style={{ marginTop: '0.5em', marginBottom: 0, lineHeight: 1.5 }}>
                      Enter the value of <code>FABRIC_HUB_SETUP_UI_SECRET</code> from the server environment to open first-time Hub configuration.
                    </p>
                  </Message>
                  <Form
                    style={{ maxWidth: '22rem', width: '100%', marginTop: '1em' }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      this._verifySetupUiSecret();
                    }}
                  >
                    <Form.Field>
                      <label htmlFor="hub-setup-ui-secret">Setup secret</label>
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
                      Continue to setup
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
              <BrowserRouter
                style={{ marginTop: 0 }}
                future={{
                  v7_startTransition: true,
                  v7_relativeSplatPath: true
                }}
              >
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
                  onProfile={this.openIdentityManager}
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
                          On-chain balance in the top bar and Bitcoin receive/spend paths use the same BIP44 account
                          index as the Fabric account you select here (<code>m/44&apos;/0&apos;/n&apos;</code> under your
                          master key).
                        </p>
                      </div>
                    ) : null}
                    <IdentityManager
                      key="fabric-identity-manager"
                      hubAdminToken={this.state.adminToken}
                      currentIdentity={this.state.uiLocalIdentity}
                      onLocalIdentityChange={this._handleIdentityManagerLocalChange}
                      onLockStateChange={this._handleIdentityManagerLockStateChange}
                      onUnlockSuccess={this._handleIdentityManagerUnlockSuccess}
                      onForgetIdentity={this._handleIdentityManagerForget}
                    />
                  </Modal.Content>
                  <Modal.Actions>
                    <Button basic onClick={this._closeHubIdentityModal}>
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
                        <Checkbox
                          toggle
                          label="Advanced Mode"
                          checked={!!this.state.uiAdvancedModeDraft}
                          onChange={(e, data) => this.setState({ uiAdvancedModeDraft: !!(data && data.checked) })}
                        />
                        <div style={{ marginTop: '0.5em', color: '#666' }}>
                          Shows advanced hub surfaces (Peers, Contracts, More tools, activity/nav extras).
                        </div>
                      </Form.Field>
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
                              console.error('[HUB]', 'Delegated sign failed:', safeIdentityErr(e));
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
                            removeStorageKey('fabric.identity.local');
                            removeStorageKey(DELEGATION_STORAGE_KEY);
                            notifyDelegationStorageChanged();
                            if (window.sessionStorage) window.sessionStorage.removeItem('fabric.identity.unlocked');
                            removeStorageKey('fabric:documents');
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
                        <FeaturesPage />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/activities"
                    element={pv((
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
                    element={pv((
                      <UiFlagRoute flag="activities">
                        <NotificationsHome />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/services/bitcoin"
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    path="/services/bitcoin/payments"
                    element={<NavigatePaymentsLegacyToCanonical />}
                  />
                  <Route
                    path="/payments"
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
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
                    element={pv((
                      <PeersFeatureRoute>
                        {this._hubPeerView(effectiveAuth, local || effectiveAuth, undefined)}
                      </PeersFeatureRoute>
                    ))}
                  />
                  <Route
                    path="/settings/admin/peers/:id"
                    element={pv((
                      <PeersFeatureRoute>
                        {this._hubPeerView(effectiveAuth, local || effectiveAuth, this.state.adminToken)}
                      </PeersFeatureRoute>
                    ))}
                  />
                  <Route
                    path="/documents"
                    element={(
                      <DocumentList
                        bridge={this.props.bridge}
                        bridgeRef={this.bridgeRef}
                        identity={local || effectiveAuth}
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
                    path="/federation"
                    element={(
                      <UiFlagRoute flag="sidechain">
                        <Navigate to="/federations" replace />
                      </UiFlagRoute>
                    )}
                  />
                  <Route
                    path="/federations"
                    element={pv((
                      <UiFlagRoute flag="sidechain">
                        <FederationsHome adminToken={this.state.adminToken} bridgeRef={this.bridgeRef} />
                      </UiFlagRoute>
                    ))}
                  />
                  <Route
                    path="/settings/federation"
                    element={pv((
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
                    path="/settings/collaboration"
                    element={pv((
                      readHubAdminTokenFromBrowser(this.state.adminToken)
                        ? (
                          <CollaborationHome
                            bridgeRef={this.bridgeRef}
                            adminToken={this.state.adminToken}
                          />
                          )
                        : (<Navigate to="/settings" replace />)
                    ))}
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
                    element={pv(<ContractList {...this.props} />)}
                  />
                  <Route
                    path="/contracts/:id"
                    element={pv(<ContractView {...this.props} adminToken={this.state.adminToken} />)}
                  />
                  <Route path="*" element={<UnknownRouteShell />} />
                </Routes>
                <BottomPanel
                  pubkey={nodePubkey}
                  adminToken={this.state.adminToken}
                  publicHubVisitor={publicHubVisitor}
                />
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
