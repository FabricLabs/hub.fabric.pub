'use strict';

// Dependencies
const React = require('react');
const { Link, useLocation } = require('react-router-dom');

// Semantic UI
const {
  Button,
  Dropdown,
  Header,
  Icon,
  Label,
  Popup,
  Segment
} = require('semantic-ui-react');
const { formatSatsDisplay } = require('../functions/formatSats');
const {
  readUiNotifications,
  UPDATED_EVENT,
  STORAGE_KEY
} = require('../functions/uiNotifications');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { readStorageJSON } = require('../functions/fabricBrowserState');

function TopPanel (props) {
  const location = useLocation();
  const pathname = (location && location.pathname) || '/';

  const hubAddress = (props && props.hubAddress) ? String(props.hubAddress) : '';
  const onOpenSettings = props && typeof props.onOpenSettings === 'function' ? props.onOpenSettings : null;
  const auth = props && props.auth ? props.auth : null;
  const onLogin = props && typeof props.onLogin === 'function' ? props.onLogin : null;
  const onManageIdentity = props && typeof props.onManageIdentity === 'function' ? props.onManageIdentity : null;
  const onUnlockIdentity = props && typeof props.onUnlockIdentity === 'function' ? props.onUnlockIdentity : null;
  const onLockIdentity = props && typeof props.onLockIdentity === 'function' ? props.onLockIdentity : null;
  const onProfile = props && typeof props.onProfile === 'function' ? props.onProfile : onManageIdentity;
  const onSignMessage = props && typeof props.onSignMessage === 'function' ? props.onSignMessage : null;
  const onDestroyIdentity = props && typeof props.onDestroyIdentity === 'function' ? props.onDestroyIdentity : null;
  const onRefreshBalance = props && typeof props.onRefreshBalance === 'function' ? props.onRefreshBalance : null;
  const hasLocalIdentity = !!(props && props.hasLocalIdentity);
  const hasLockedIdentity = !!(props && props.hasLockedIdentity);
  const localIdentity = props && props.localIdentity ? props.localIdentity : null;
  const bitcoin = props && props.bitcoin;
  const clientBalance = props && props.clientBalance;
  const clientBalanceLoading = !!(props && props.clientBalanceLoading);
  const adminTokenProp = props && props.adminToken;
  const hasHubAdminPeerNav = !!(
    readHubAdminTokenFromBrowser(adminTokenProp)
  );
  const publicHubVisitor = !!(props && props.publicHubVisitor);

  const formatIdentityValue = (value) => {
    if (value == null) return '';
    const s = String(value);
    if (s.length <= 16) return s;
    const head = s.slice(0, 8);
    const tail = s.slice(-8);
    return `${head}…${tail}`;
  };

  // Authenticated = have identity with private key (can sign/encrypt).
  // Locked = have identity but private key is locked (can unlock with password).
  // Never show "Locked" when we have the key in auth (e.g. right after first login).
  const hasPrivate = !!(
    (auth && (auth.xprv || auth.private)) ||
    (localIdentity && localIdentity.xprv)
  );
  const isAuthed = hasPrivate;
  const showSignedInControls = isAuthed;
  // Fallback for short-lived parent state gaps right after identity create/login:
  // if props lag for a render, derive id/xpub from persisted local storage so the
  // chip does not flash back to "Login".
  const persistedIdentity = React.useMemo(() => {
    try {
      if (typeof window === 'undefined') return null;
      const parsed = readStorageJSON('fabric.identity.local', null);
      if (!parsed || (!parsed.id && !parsed.xpub)) return null;
      return {
        id: parsed.id ? String(parsed.id) : undefined,
        xpub: parsed.xpub ? String(parsed.xpub) : undefined
      };
    } catch (e) {
      return null;
    }
  }, [hasLocalIdentity, localIdentity && localIdentity.xpub, auth && auth.xpub]);
  const identitySource = localIdentity || auth || persistedIdentity;
  const hasAnyLocalIdentity = !!(hasLocalIdentity || (persistedIdentity && (persistedIdentity.id || persistedIdentity.xpub)));
  // Password-protected identity without xprv in memory → show Locked (unlock flow).
  // xpub / watch-only (no password) → show Watch-only (upgrade/import path), not "Locked".
  const passwordProtectedIdentity = !!(localIdentity && localIdentity.passwordProtected);
  const isPasswordLocked = hasAnyLocalIdentity && !isAuthed && (hasLockedIdentity || passwordProtectedIdentity);
  const isWatchOnlyIdentity = hasAnyLocalIdentity && !isAuthed && !passwordProtectedIdentity && !!identitySource;
  const isLockedState = isPasswordLocked || isWatchOnlyIdentity;
  /** True when we can derive a client wallet id and show a live balance in the chip. */
  const canShowClientBalance = !!(
    identitySource &&
    identitySource.xpub &&
    (hasAnyLocalIdentity || isAuthed)
  );
  /** Password-locked identities may still have xpub in memory; do not imply a live balance until unlock. */
  const showLiveBalanceInChip = canShowClientBalance && !isPasswordLocked;
  const identityLabel = (() => {
    if (!identitySource) return 'Login';
    if (identitySource.username) return identitySource.username;
    if (identitySource.xpub) return formatIdentityValue(identitySource.xpub);
    if (identitySource.id) return formatIdentityValue(identitySource.id);
    if (identitySource.address) return formatIdentityValue(identitySource.address);
    return 'Identity';
  })();

  const active = (prefix) => {
    if (!prefix) return false;
    if (prefix === '/') return pathname === '/';
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  };

  const [notifList, setNotifList] = React.useState(() => readUiNotifications());
  const [uiTick, setUiTick] = React.useState(0);
  const balanceHoverRefreshAtRef = React.useRef(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setUiTick((n) => n + 1)), []);
  const uiFlags = loadHubUiFeatureFlags();
  const isAdvancedMode = !!uiFlags.advancedMode;
  void uiTick;
  const balanceChipHref = '/services/bitcoin/transactions?scope=wallet#fabric-federation-wallet-panel';
  const depositFlowHref = uiFlags.bitcoinPayments
    ? '/payments#fabric-btc-request-payment-h4'
    : '/services/bitcoin';
  const withdrawFlowHref = uiFlags.bitcoinPayments
    ? '/payments#fabric-btc-make-payment-h4'
    : balanceChipHref;
  const chipBalanceSats = Number(clientBalance && clientBalance.balanceSats);
  const hasSpendableChipBalance = Number.isFinite(chipBalanceSats) && chipBalanceSats > 0;
  const walletChipMenu = (
    <div className="fade-in" style={{ padding: '0.5em', maxWidth: '22rem' }}>
      <p style={{ marginBottom: '0.65em', fontSize: '0.9em', lineHeight: 1.45 }}>
        Open wallet flows quickly from here.
      </p>
      <Button
        as={Link}
        to={balanceChipHref}
        fluid
        size="small"
        icon
        labelPosition="right"
        style={{ marginBottom: '0.5em' }}
      >
        <Icon name="credit card" />
        Wallet
      </Button>
      <Button
        as={Link}
        to={depositFlowHref}
        color="green"
        fluid
        size="small"
        icon
        labelPosition="right"
        style={{ marginBottom: '0.5em' }}
      >
        <Icon name="download" />
        Deposit
      </Button>
      <Button
        as={Link}
        to={withdrawFlowHref}
        color="black"
        fluid
        size="small"
        icon
        labelPosition="right"
        disabled={showLiveBalanceInChip && !hasSpendableChipBalance}
      >
        <Icon name="right chevron" />
        Withdraw
      </Button>
    </div>
  );

  React.useEffect(() => {
    const sync = () => setNotifList(readUiNotifications());
    if (typeof window !== 'undefined') {
      window.addEventListener(UPDATED_EVENT, sync);
      const onStorage = (ev) => {
        if (ev && ev.key === STORAGE_KEY) sync();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(UPDATED_EVENT, sync);
        window.removeEventListener('storage', onStorage);
      };
    }
    return undefined;
  }, []);

  return (
    <Segment
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75em',
        flexWrap: 'wrap',
        marginTop: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
        <Header as='h3' style={{ margin: 0 }}>
          <Link to="/" aria-label="Hub home, hub.fabric.pub">
            <code>hub.fabric.pub</code>
          </Link>
        </Header>

        <Button.Group size='small' role="navigation" aria-label="Primary hub sections">
          <Button as={Link} to="/" basic={!active('/')} primary={active('/')} aria-current={active('/') ? 'page' : undefined}>
            <Icon name="home" />
            Home
          </Button>
          {isAdvancedMode && uiFlags.peers && !publicHubVisitor ? (
            <Button as={Link} to="/peers" basic={!active('/peers')} primary={active('/peers')} aria-current={active('/peers') ? 'page' : undefined}>
              <Icon name="sitemap" />
              Peers
            </Button>
          ) : null}
          <Button as={Link} to="/documents" basic={!active('/documents')} primary={active('/documents')} aria-current={active('/documents') ? 'page' : undefined}>
            <Icon name="file outline" />
            Documents
          </Button>
          {!publicHubVisitor && isAdvancedMode ? (
            <Button as={Link} to="/contracts" basic={!active('/contracts')} primary={active('/contracts')} aria-current={active('/contracts') ? 'page' : undefined}>
              <Icon name="file code" />
              Contracts
            </Button>
          ) : null}
        </Button.Group>
        {!publicHubVisitor && isAdvancedMode ? (
        <Dropdown
          item
          trigger={
            <Button
              size="small"
              basic
              title="More services — Bitcoin, Settings, Admin, and other pages"
              aria-label="More hub pages and tools"
              aria-haspopup="menu"
            >
              <Icon name="ellipsis horizontal" aria-hidden="true" />
              More
            </Button>
          }
          pointing="top left"
        >
          <Dropdown.Menu>
            {uiFlags.features ? (
              <Dropdown.Item as={Link} to="/features" icon="info circle" text="Features" />
            ) : null}
            {uiFlags.activities && !publicHubVisitor ? (
              <Dropdown.Item
                as={Link}
                to="/notifications"
                icon="bell outline"
                text="Notifications"
                active={pathname === '/notifications'}
              />
            ) : null}
            {uiFlags.activities && !publicHubVisitor ? (
              <Dropdown.Item
                as={Link}
                to="/activities"
                icon="comments"
                text="Activity log"
                active={pathname === '/activities'}
              />
            ) : null}
            {!publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin" icon="bitcoin" text="Bitcoin" />
            ) : null}
            {!publicHubVisitor && (uiFlags.bitcoinPayments || uiFlags.bitcoinLightning) ? (
              <Dropdown.Item
                as={Link}
                to={{
                  pathname: '/services/bitcoin',
                  hash: uiFlags.bitcoinPayments ? 'fabric-bitcoin-payjoin' : 'fabric-bitcoin-lightning'
                }}
                icon="shield alternate"
                text="Treasury (Payjoin / Lightning)"
                title="Hub-managed deposits: Payjoin when Payments are enabled; otherwise Lightning section"
              />
            ) : null}
            {uiFlags.bitcoinPayments && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/payments" icon="credit card outline" text="Payments" />
            ) : null}
            {uiFlags.bitcoinInvoices && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" icon="file alternate outline" text="Invoices" />
            ) : null}
            {uiFlags.bitcoinLightning && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/lightning" icon="bolt" text="Lightning" />
            ) : null}
            {uiFlags.bitcoinExplorer && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/blocks" icon="search" text="Explorer" />
            ) : null}
            {!publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/faucet" icon="tint" text="Faucet" />
            ) : null}
            {uiFlags.bitcoinResources && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/resources" icon="code" text="Bitcoin HTTP resources" />
            ) : null}
            {uiFlags.bitcoinCrowdfund && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/crowdfunds" icon="heart outline" text="Crowdfunds" />
            ) : null}
            {uiFlags.sidechain && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/sidechains" icon="random" text="Sidechain & demo" />
            ) : null}
            {hasHubAdminPeerNav ? (
              <Dropdown.Item
                as={Link}
                to="/settings/admin"
                icon="settings"
                text="Admin"
                active={pathname === '/settings/admin' || pathname.startsWith('/settings/admin/')}
              />
            ) : null}
            {hasHubAdminPeerNav ? (
              <Dropdown.Item
                as={Link}
                to="/settings/collaboration"
                icon="users"
                text="Collaboration"
                active={pathname === '/settings/collaboration'}
              />
            ) : null}
            {uiFlags.sidechain && hasHubAdminPeerNav ? (
              <Dropdown.Item
                as={Link}
                to="/settings/admin/beacon-federation"
                icon="star"
                text="Beacon Federation"
                active={pathname === '/settings/admin/beacon-federation'}
              />
            ) : null}
            <Dropdown.Item
              as={Link}
              to="/settings"
              icon="setting"
              text="Settings"
              active={pathname === '/settings'}
            />
            {uiFlags.sidechain && !publicHubVisitor ? (
              <Dropdown.Item
                as={Link}
                to="/federations"
                icon="users"
                text="Federations"
                active={pathname === '/federations' || pathname === '/settings/federation'}
              />
            ) : null}
            <Dropdown.Item as={Link} to="/settings/security" icon="shield" text="Security & delegation" />
            {uiFlags.sidechain && !publicHubVisitor ? (
              <React.Fragment>
                <Dropdown.Divider />
                <Dropdown.Item
                  as="a"
                  href="/services/distributed/manifest"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon="code"
                  text="Distributed manifest (JSON)"
                />
                <Dropdown.Item
                  as="a"
                  href="/services/distributed/vault"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon="bitcoin"
                  text="Federation vault (JSON)"
                />
              </React.Fragment>
            ) : null}
          </Dropdown.Menu>
        </Dropdown>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
        {showSignedInControls && isAdvancedMode ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Button
              as={Link}
              to="/notifications"
              size="small"
              title={
                notifList.length
                  ? `${notifList.length} in-app notification(s) — open Notifications`
                  : 'Notifications — wallet, Payjoin, and hub toasts (activity log is under More)'
              }
              aria-label="Notifications"
              aria-current={pathname === '/notifications' ? 'page' : undefined}
              primary={pathname === '/notifications'}
              basic={pathname !== '/notifications'}
              style={{
                border: 'none',
                boxShadow: 'none',
                background: 'transparent',
                padding: '0.45em 0.55em',
                margin: 0
              }}
            >
              <Icon name="bell outline" />
            </Button>
            {notifList.length > 0 && (
              <Label
                circular
                color="red"
                size="mini"
                style={{ position: 'absolute', top: -6, right: -6, margin: 0, minWidth: '1.5em' }}
                title={`${notifList.length} notification(s)`}
              >
                {notifList.length > 99 ? '99+' : String(notifList.length)}
              </Label>
            )}
          </div>
        ) : null}
        {(showSignedInControls || isLockedState) ? (
          <Popup
            on="hover"
            hoverable
            position="bottom center"
            trigger={(
              <Label
                size="small"
                basic
                aria-label={
                  !showLiveBalanceInChip
                    ? (isPasswordLocked
                        ? 'Wallet — unlock identity to show balance'
                        : isWatchOnlyIdentity
                          ? 'Wallet — open Bitcoin transactions (watch-only)'
                          : 'Wallet — log in to track balance')
                    : clientBalanceLoading && clientBalance == null
                      ? 'Wallet — loading balance'
                      : 'Wallet — browser balance; opens wallet menu'
                }
                title={
                  !showLiveBalanceInChip
                    ? (isPasswordLocked
                        ? 'Unlock your identity to show your browser wallet balance here'
                        : isWatchOnlyIdentity
                          ? 'Import a full key or unlock to track your browser wallet balance'
                          : 'Log in or set a local identity to track your browser wallet balance')
                    : clientBalanceLoading && clientBalance == null
                      ? 'Loading your browser wallet balance…'
                      : 'Hover for wallet actions: open wallet, deposit, or withdraw'
                }
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => {
                  if (!onRefreshBalance || !showLiveBalanceInChip) return;
                  const now = Date.now();
                  if (now - balanceHoverRefreshAtRef.current < 8000) return;
                  balanceHoverRefreshAtRef.current = now;
                  try {
                    onRefreshBalance();
                  } catch (_) {}
                }}
              >
                <Icon name="bitcoin" color={showLiveBalanceInChip ? 'orange' : 'grey'} />
                {!showLiveBalanceInChip
                  ? (isPasswordLocked ? 'Unlock for balance' : 'Wallet')
                  : (clientBalanceLoading && clientBalance == null
                      ? '…'
                      : (clientBalance != null && Number.isFinite(clientBalance.balanceSats)
                          ? (clientBalance.balanceSats >= 100000000
                              ? `${(clientBalance.balanceSats / 100000000).toFixed(4)} BTC`
                              : `${formatSatsDisplay(clientBalance.balanceSats)} sats`)
                          : '—'))}
              </Label>
            )}
            content={walletChipMenu}
          />
        ) : null}
        {!publicHubVisitor && isAdvancedMode && bitcoin && bitcoin.mempoolTxCount != null && Number(bitcoin.mempoolTxCount) > 0 && (
          <Label
            as={Link}
            to="/services/bitcoin"
            size="small"
            color="orange"
            title="Transactions waiting in this Hub node’s mempool — open Bitcoin dashboard"
            style={{ cursor: 'pointer' }}
          >
            <Icon name="clock outline" />
            Mempool {bitcoin.mempoolTxCount}
          </Label>
        )}
        {isAuthed ? (
          <div style={{ display: 'inline-block' }}>
            <Dropdown
              trigger={
                <Button size="small" primary title="Identity — menu or lock">
                  <Icon name="unlock" style={{ marginRight: '0.15em' }} />
                  <Icon name="user circle" />
                  {identityLabel}
                  <Icon name="dropdown" />
                </Button>
              }
              pointing="top right"
              icon={null}
            >
              <Dropdown.Menu>
                <Dropdown.Item icon="user" text="User profile" onClick={() => { onProfile && onProfile(); }} />
                <Dropdown.Item icon="pencil" text="Sign message" onClick={() => { onSignMessage && onSignMessage(); }} />
                <Dropdown.Item
                  icon="plug"
                  text="Bridge connection"
                  onClick={() => { onOpenSettings && onOpenSettings(); }}
                  title="Hub WebSocket URL and bridge options"
                />
                <Dropdown.Divider />
                {localIdentity && localIdentity.passwordProtected ? (
                  <Dropdown.Item
                    icon="lock"
                    text="Lock identity"
                    onClick={() => {
                      if (!onLockIdentity) return;
                      onLockIdentity();
                    }}
                  />
                ) : null}
                <Dropdown.Divider />
                <Dropdown.Item icon="trash" text="Destroy identity" onClick={() => { onDestroyIdentity && onDestroyIdentity(); }} />
              </Dropdown.Menu>
            </Dropdown>
          </div>
        ) : (
          <Button
            size="small"
            basic={!isLockedState}
            primary={isLockedState}
            onClick={() => {
              if (isLockedState && onUnlockIdentity) {
                onUnlockIdentity();
              } else if (!isAuthed && onLogin) {
                onLogin();
              }
            }}
            title={
              isPasswordLocked
                ? 'Unlock identity — enter your encryption password'
                : isWatchOnlyIdentity
                  ? 'Watch-only identity — open to import a full key or use desktop signing'
                  : 'Log in'
            }
            aria-label={
              isPasswordLocked
                ? 'Locked — unlock Fabric identity'
                : isWatchOnlyIdentity
                  ? 'Watch-only Fabric identity — open options'
                  : 'Log in or create Fabric identity'
            }
          >
            <Icon name={isPasswordLocked ? 'lock' : isWatchOnlyIdentity ? 'eye' : 'user circle'} aria-hidden="true" />
            {isPasswordLocked ? 'Locked' : isWatchOnlyIdentity ? 'Watch-only' : identityLabel}
          </Button>
        )}
        {onOpenSettings ? (
          <Button
            size="small"
            basic
            icon
            title="Settings and UI mode"
            aria-label="Open settings"
            onClick={() => onOpenSettings && onOpenSettings()}
          >
            <Icon name="cog" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </Segment>
  );
}

module.exports = TopPanel;
