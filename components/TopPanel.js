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
  // Fallback for short-lived parent state gaps right after identity create/login:
  // if props lag for a render, derive id/xpub from persisted local storage so the
  // chip does not flash back to "Login".
  const persistedIdentity = React.useMemo(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const raw = window.localStorage.getItem('fabric.identity.local');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
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
  // Treat any local identity without private material as locked, even if
  // hasLockedIdentity lags behind after route transitions.
  const isLockedState = hasAnyLocalIdentity && !isAuthed && (hasLockedIdentity || !!identitySource);
  /** True when we can derive a client wallet id and show a live balance in the chip. */
  const canShowClientBalance = !!(
    identitySource &&
    identitySource.xpub &&
    (hasAnyLocalIdentity || isAuthed)
  );
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
  void uiTick;
  const balanceChipHref = '/services/bitcoin/transactions?scope=wallet#fabric-btc-tx-client-h3';

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
          <Link to='/'><code>hub.fabric.pub</code></Link>
        </Header>

        <Button.Group size='small'>
          <Button as={Link} to="/" basic={!active('/')} primary={active('/')}>
            <Icon name="home" />
            Home
          </Button>
          {uiFlags.peers && hasHubAdminPeerNav ? (
            <Button as={Link} to="/peers" basic={!active('/peers')} primary={active('/peers')}>
              <Icon name="sitemap" />
              Peers
            </Button>
          ) : null}
          <Button as={Link} to="/documents" basic={!active('/documents')} primary={active('/documents')}>
            <Icon name="file outline" />
            Documents
          </Button>
          <Button as={Link} to="/contracts" basic={!active('/contracts')} primary={active('/contracts')}>
            <Icon name="file code" />
            Contracts
          </Button>
        </Button.Group>
        <Dropdown
          item
          trigger={
            <Button size="small" basic title="More services">
              <Icon name="ellipsis horizontal" />
              More
            </Button>
          }
          pointing="top left"
        >
          <Dropdown.Menu>
            {uiFlags.features ? (
              <Dropdown.Item as={Link} to="/features" icon="info circle" text="Features" />
            ) : null}
            {uiFlags.activities ? (
              <Dropdown.Item
                as={Link}
                to="/activities"
                icon="bell outline"
                text="Activities"
                active={pathname === '/activities'}
              />
            ) : null}
            <Dropdown.Item as={Link} to="/services/bitcoin" icon="bitcoin" text="Bitcoin" />
            {uiFlags.bitcoinPayments ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/payments" icon="credit card outline" text="Payments" />
            ) : null}
            {uiFlags.bitcoinInvoices ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" icon="file alternate outline" text="Invoices" />
            ) : null}
            {uiFlags.bitcoinLightning ? (
              <Dropdown.Item as={Link} to="/services/lightning" icon="bolt" text="Lightning" />
            ) : null}
            {uiFlags.bitcoinExplorer ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/blocks" icon="search" text="Explorer" />
            ) : null}
            <Dropdown.Item as={Link} to="/services/bitcoin/faucet" icon="tint" text="Faucet" />
            {uiFlags.bitcoinResources ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/resources" icon="code" text="Bitcoin HTTP resources" />
            ) : null}
            {uiFlags.bitcoinCrowdfund ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/crowdfunds" icon="heart outline" text="Crowdfunds" />
            ) : null}
            {uiFlags.sidechain ? (
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
            {uiFlags.sidechain ? (
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
            {uiFlags.sidechain ? (
              <Dropdown.Item as={Link} to="/settings/federation" icon="users" text="Distributed federation" />
            ) : null}
            <Dropdown.Item as={Link} to="/settings/security" icon="shield" text="Security & delegation" />
            {uiFlags.sidechain ? (
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
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Button
            as={Link}
            to="/activities"
            size="small"
            title={
              notifList.length
                ? `${notifList.length} in-app notification(s) — open Activities to manage`
                : 'Activities — hub log, chat, and in-app notifications'
            }
            aria-label="Activities and notifications"
            primary={active('/activities')}
            basic={!active('/activities')}
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
        <Label
          as={Link}
          to={balanceChipHref}
          size="small"
          basic
          title={
            !canShowClientBalance
              ? 'Open Bitcoin — log in or set a local identity to track your browser wallet balance here'
              : clientBalanceLoading && clientBalance == null
                ? 'Loading your browser wallet balance…'
                : 'Your browser wallet balance (this identity / session) — hover to refresh, click for Bitcoin'
          }
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => {
            if (!onRefreshBalance || !canShowClientBalance) return;
            const now = Date.now();
            if (now - balanceHoverRefreshAtRef.current < 8000) return;
            balanceHoverRefreshAtRef.current = now;
            try {
              onRefreshBalance();
            } catch (_) {}
          }}
        >
          <Icon name="bitcoin" color="orange" />
          {!canShowClientBalance
            ? 'Wallet'
            : (clientBalanceLoading && clientBalance == null
                ? '…'
                : (clientBalance != null && Number.isFinite(clientBalance.balanceSats)
                    ? (clientBalance.balanceSats >= 100000000
                        ? `${(clientBalance.balanceSats / 100000000).toFixed(4)} BTC`
                        : `${formatSatsDisplay(clientBalance.balanceSats)} sats`)
                    : '—'))}
        </Label>
        {bitcoin && bitcoin.mempoolTxCount != null && Number(bitcoin.mempoolTxCount) > 0 && (
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
                <Dropdown.Item
                  icon="lock"
                  text="Lock identity"
                  onClick={() => {
                    if (!onLockIdentity) return;
                    onLockIdentity();
                  }}
                />
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
            title={isLockedState ? 'Unlock identity' : 'Log in'}
          >
            <Icon name={isLockedState ? 'lock' : 'user circle'} />
            {isLockedState ? 'Locked' : identityLabel}
          </Button>
        )}
        {!isAuthed && (
          <Button
            size="small"
            basic
            icon
            title="Settings"
            onClick={() => onOpenSettings && onOpenSettings()}
          >
            <Icon name="cog" />
          </Button>
        )}
      </div>
    </Segment>
  );
}

module.exports = TopPanel;
