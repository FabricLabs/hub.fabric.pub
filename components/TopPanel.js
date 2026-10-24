'use strict';

// Dependencies
const React = require('react');
const { Link, useLocation, useNavigate } = require('react-router-dom');

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
const { plaintextMasterFromStored } = require('../functions/fabricHubLocalIdentity');
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
const { buildLocalFabricIdentityPayload } = require('../functions/fabricHubLocalIdentity');
const { isLikelyBip32ExtendedKey } = require('../functions/isLikelyBip32ExtendedKey');
const { useHubHttpAvailable, useHubMeshAvailable } = require('./hubUiRuntime');
const t = require('../locales/en');

const s = t.shell;

function TopPanel (props) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = (location && location.pathname) || '/';

  const hubAddress = (props && props.hubAddress) ? String(props.hubAddress) : '';
  const onOpenSettings = props && typeof props.onOpenSettings === 'function' ? props.onOpenSettings : null;
  const auth = props && props.auth ? props.auth : null;
  const onLogin = props && typeof props.onLogin === 'function' ? props.onLogin : null;
  const onManageIdentity = props && typeof props.onManageIdentity === 'function' ? props.onManageIdentity : null;
  const onUnlockIdentity = props && typeof props.onUnlockIdentity === 'function' ? props.onUnlockIdentity : null;
  const onLockIdentity = props && typeof props.onLockIdentity === 'function' ? props.onLockIdentity : null;
  const onProfile = props && typeof props.onProfile === 'function' ? props.onProfile : null;
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
  // Must use the same resolution rules as HubInterface / IdentityManager — not raw JSON fields —
  // or the chip can show Watch-only/Locked while the shell has no effective identity (e.g. strict
  // no-plaintext-at-rest records, or cleared/forgotten state that still has stray keys).
  const persistedIdentity = React.useMemo(() => {
    try {
      if (typeof window === 'undefined') return null;
      const parsed = readStorageJSON('fabric.identity.local', null);
      if (!parsed || (!parsed.id && !parsed.xpub)) return null;
      const bl = buildLocalFabricIdentityPayload(parsed);
      if (!bl.resolved || !bl.record) return null;
      const r = bl.record;
      return {
        id: r.id != null ? String(r.id) : undefined,
        xpub: r.xpub != null ? String(r.xpub) : undefined
      };
    } catch (e) {
      return null;
    }
  }, [hasLocalIdentity, localIdentity && localIdentity.xpub, auth && auth.xpub]);
  const plaintextXprvOnDisk = React.useMemo(() => {
    try {
      const p = readStorageJSON('fabric.identity.local', null);
      return !!(p && plaintextMasterFromStored(p));
    } catch (e) {
      return false;
    }
  }, [hasLocalIdentity, localIdentity && localIdentity.xpub, hasLockedIdentity]);
  const identitySource = localIdentity || auth || persistedIdentity;
  const profilePeerId = (() => {
    const id = identitySource && identitySource.id != null ? String(identitySource.id).trim() : '';
    if (!id || isLikelyBip32ExtendedKey(id)) return '';
    return id;
  })();
  const openUserProfile = () => {
    if (typeof onProfile === 'function') {
      onProfile();
      return;
    }
    if (profilePeerId) {
      navigate(`/peers/${encodeURIComponent(profilePeerId)}`);
      return;
    }
    if (typeof onManageIdentity === 'function') onManageIdentity();
  };
  const hasAnyLocalIdentity = !!(hasLocalIdentity || (persistedIdentity && (persistedIdentity.id || persistedIdentity.xpub)));
  // Password-protected identity without xprv in memory → show Locked (unlock flow).
  // xpub / watch-only (no password) → show Watch-only (upgrade/import path), not "Locked".
  const passwordProtectedIdentity = !!(localIdentity && localIdentity.passwordProtected);
  const isPasswordLocked = hasAnyLocalIdentity && !isAuthed && (hasLockedIdentity || passwordProtectedIdentity);
  const isWatchOnlyIdentity = hasAnyLocalIdentity && !isAuthed && !passwordProtectedIdentity && !!identitySource &&
    !hasLockedIdentity;
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
    if (!identitySource) return s.identity.login;
    if (identitySource.username) return identitySource.username;
    if (identitySource.id) return formatIdentityValue(identitySource.id);
    if (identitySource.xpub) return formatIdentityValue(identitySource.xpub);
    if (identitySource.address) return formatIdentityValue(identitySource.address);
    return s.identity.fallback;
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
  const hubHttpAvailable = useHubHttpAvailable();
  const meshAvailable = useHubMeshAvailable();
  const showHubNav = hubHttpAvailable;
  const showDocumentsNav = hubHttpAvailable || meshAvailable;
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
        {s.wallet.menuIntro}
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
        {s.wallet.open}
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
        {s.wallet.deposit}
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
        {s.wallet.withdraw}
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
          <Link to="/" aria-label={s.brandHomeLabel}>
            <code>{t.BRAND_MARK}</code>
          </Link>
        </Header>

        <Button.Group size='small' role="navigation" aria-label={s.nav.label}>
          <Button as={Link} to="/" basic={!active('/')} primary={active('/')} aria-current={active('/') ? 'page' : undefined}>
            <Icon name="home" />
            {s.nav.home}
          </Button>
          {showHubNav && isAdvancedMode && uiFlags.peers && !publicHubVisitor ? (
            <Button as={Link} to="/peers" basic={!active('/peers')} primary={active('/peers')} aria-current={active('/peers') ? 'page' : undefined}>
              <Icon name="sitemap" />
              {s.nav.peers}
            </Button>
          ) : null}
          {showDocumentsNav ? (
          <Button as={Link} to="/documents" data-testid="hub-nav-documents" basic={!active('/documents')} primary={active('/documents')} aria-current={active('/documents') ? 'page' : undefined}>
            <Icon name="file outline" />
            {s.nav.documents}
          </Button>
          ) : null}
          {!showHubNav ? (
          <Button as={Link} to="/settings" data-testid="hub-nav-settings" basic={!active('/settings')} primary={active('/settings')} aria-current={active('/settings') ? 'page' : undefined}>
            <Icon name="setting" />
            {s.nav.settings}
          </Button>
          ) : null}
          {showHubNav && !publicHubVisitor && isAdvancedMode ? (
            <Button as={Link} to="/contracts" basic={!active('/contracts')} primary={active('/contracts')} aria-current={active('/contracts') ? 'page' : undefined}>
              <Icon name="file code" />
              {s.nav.contracts}
            </Button>
          ) : null}
        </Button.Group>
        {showHubNav && !publicHubVisitor && isAdvancedMode ? (
        <Dropdown
          item
          trigger={
            <Button
              size="small"
              basic
              title={s.nav.moreTitle}
              aria-label={s.nav.moreLabel}
              aria-haspopup="menu"
            >
              <Icon name="ellipsis horizontal" aria-hidden="true" />
              {s.nav.more}
            </Button>
          }
          pointing="top left"
        >
          <Dropdown.Menu>
            {uiFlags.features ? (
              <Dropdown.Item as={Link} to="/features" icon="info circle" text={s.nav.features} />
            ) : null}
            {uiFlags.activities && !publicHubVisitor ? (
              <Dropdown.Item
                as={Link}
                to="/notifications"
                icon="bell outline"
                text={s.nav.notifications}
                active={pathname === '/notifications'}
              />
            ) : null}
            {uiFlags.activities && !publicHubVisitor ? (
              <Dropdown.Item
                as={Link}
                to="/activities"
                icon="comments"
                text={s.nav.activityLog}
                active={pathname === '/activities'}
              />
            ) : null}
            {!publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin" icon="bitcoin" text={s.nav.bitcoin} />
            ) : null}
            {!publicHubVisitor && (uiFlags.bitcoinPayments || uiFlags.bitcoinLightning) ? (
              <Dropdown.Item
                as={Link}
                to={{
                  pathname: '/services/bitcoin',
                  hash: uiFlags.bitcoinPayments ? 'fabric-bitcoin-payjoin' : 'fabric-bitcoin-lightning'
                }}
                icon="shield alternate"
                text={s.nav.treasury}
                title={s.nav.treasuryTitle}
              />
            ) : null}
            {uiFlags.bitcoinPayments && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/payments" icon="credit card outline" text={s.nav.payments} />
            ) : null}
            {uiFlags.bitcoinInvoices && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" icon="file alternate outline" text={s.nav.invoices} />
            ) : null}
            {uiFlags.bitcoinLightning && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/lightning" icon="bolt" text={s.nav.lightning} />
            ) : null}
            {uiFlags.bitcoinExplorer && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/blocks" icon="search" text={s.nav.explorer} />
            ) : null}
            {!publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/faucet" icon="tint" text={s.nav.faucet} />
            ) : null}
            {uiFlags.bitcoinResources && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/resources" icon="code" text={s.nav.bitcoinResources} />
            ) : null}
            {uiFlags.bitcoinCrowdfund && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/services/bitcoin/crowdfunds" icon="heart outline" text={s.nav.crowdfunds} />
            ) : null}
            {uiFlags.sidechain && !publicHubVisitor ? (
              <Dropdown.Item as={Link} to="/sidechains" icon="random" text={s.nav.statechain} />
            ) : null}
            {hasHubAdminPeerNav ? (
              <Dropdown.Item
                as={Link}
                to="/settings/admin"
                icon="settings"
                text={s.nav.admin}
                active={pathname === '/settings/admin' || pathname.startsWith('/settings/admin/')}
              />
            ) : null}
            {hasHubAdminPeerNav ? (
              <Dropdown.Item
                as={Link}
                to="/settings/collaboration"
                icon="users"
                text={s.nav.collaboration}
                active={pathname === '/settings/collaboration'}
              />
            ) : null}
            {uiFlags.sidechain && hasHubAdminPeerNav ? (
              <Dropdown.Item
                as={Link}
                to="/settings/admin/beacon-federation"
                icon="star"
                text={s.nav.beaconFederation}
                active={pathname === '/settings/admin/beacon-federation'}
              />
            ) : null}
            <Dropdown.Item
              as={Link}
              to="/settings"
              icon="setting"
              text={s.nav.settings}
              active={pathname === '/settings'}
            />
            {uiFlags.sidechain && !publicHubVisitor ? (
              <Dropdown.Item
                as={Link}
                to="/federations"
                icon="users"
                text={s.nav.federations}
                active={pathname === '/federations' || pathname === '/settings/federation'}
              />
            ) : null}
            <Dropdown.Item as={Link} to="/settings/security" icon="shield" text={s.nav.security} />
            {uiFlags.sidechain && !publicHubVisitor ? (
              <React.Fragment>
                <Dropdown.Divider />
                <Dropdown.Item
                  as="a"
                  href="/services/distributed/manifest"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon="code"
                  text={s.nav.distributedManifest}
                />
                <Dropdown.Item
                  as="a"
                  href="/services/distributed/vault"
                  target="_blank"
                  rel="noopener noreferrer"
                  icon="bitcoin"
                  text={s.nav.federationVault}
                />
              </React.Fragment>
            ) : null}
          </Dropdown.Menu>
        </Dropdown>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
        {showSignedInControls && isAdvancedMode && showHubNav ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <Button
              as={Link}
              to="/notifications"
              size="small"
              title={
                notifList.length
                  ? s.notifications.titleCount(notifList.length)
                  : s.notifications.titleEmpty
              }
              aria-label={s.notifications.label}
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
                title={s.notifications.badgeTitle(notifList.length)}
              >
                {notifList.length > 99 ? '99+' : String(notifList.length)}
              </Label>
            )}
          </div>
        ) : null}
        {(showHubNav && (showSignedInControls || isLockedState)) ? (
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
                        ? s.wallet.labelLocked
                        : isWatchOnlyIdentity
                          ? s.wallet.labelWatchOnly
                          : s.wallet.labelLoggedOut)
                    : clientBalanceLoading && clientBalance == null
                      ? s.wallet.labelLoading
                      : s.wallet.labelReady
                }
                title={
                  !showLiveBalanceInChip
                    ? (isPasswordLocked
                        ? s.wallet.titleLocked
                        : isWatchOnlyIdentity
                          ? s.wallet.titleWatchOnly
                          : s.wallet.titleLoggedOut)
                    : clientBalanceLoading && clientBalance == null
                      ? s.wallet.titleLoading
                      : s.wallet.titleReady
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
                  ? (isPasswordLocked ? s.wallet.chipLocked : s.wallet.chipIdle)
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
        {(!publicHubVisitor && showHubNav && isAdvancedMode && bitcoin && bitcoin.mempoolTxCount != null && Number(bitcoin.mempoolTxCount) > 0) && (
          <Label
            as={Link}
            to="/services/bitcoin"
            size="small"
            color="orange"
            title={s.wallet.mempoolTitle}
            style={{ cursor: 'pointer' }}
          >
            <Icon name="clock outline" />
            {s.wallet.mempool(bitcoin.mempoolTxCount)}
          </Label>
        )}
        {isAuthed ? (
            <Dropdown
              trigger={
                <Button size="small" primary title={s.identity.menuTitle}>
                  <Icon name="unlock" style={{ marginRight: '0.15em' }} />
                  <Icon name="user circle" />
                  <span data-testid="hub-identity-chip-label">{identityLabel}</span>
                  <Icon name="dropdown" />
                </Button>
              }
              pointing="top right"
              icon={null}
            >
              <Dropdown.Menu>
                <Dropdown.Item
                  icon="user"
                  text={s.identity.profile}
                  disabled={!profilePeerId && typeof onProfile !== 'function'}
                  title={profilePeerId
                    ? s.identity.profileTitle
                    : s.identity.profileLockedTitle}
                  onClick={() => { openUserProfile(); }}
                />
                <Dropdown.Item
                  icon="key"
                  text={s.identity.manage}
                  onClick={() => { onManageIdentity && onManageIdentity(); }}
                  title={s.identity.manageTitle}
                />
                <Dropdown.Item icon="pencil" text={s.identity.sign} onClick={() => { onSignMessage && onSignMessage(); }} />
                <Dropdown.Item
                  icon="plug"
                  text={s.identity.connection}
                  onClick={() => { onOpenSettings && onOpenSettings(); }}
                  title={s.identity.connectionTitle}
                />
                <Dropdown.Divider />
                {localIdentity && localIdentity.xprv && (localIdentity.passwordProtected || plaintextXprvOnDisk) ? (
                  <Dropdown.Item
                    icon="lock"
                    text={s.identity.lock}
                    onClick={() => {
                      if (!onLockIdentity) return;
                      onLockIdentity();
                    }}
                  />
                ) : null}
                <Dropdown.Divider />
                <Dropdown.Item icon="trash" text={s.identity.destroy} onClick={() => { onDestroyIdentity && onDestroyIdentity(); }} />
              </Dropdown.Menu>
            </Dropdown>
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
                ? s.identity.buttonTitleLocked
                : isWatchOnlyIdentity
                  ? s.identity.buttonTitleWatchOnly
                  : s.identity.buttonTitleLogin
            }
            aria-label={
              isPasswordLocked
                ? s.identity.buttonLabelLocked
                : isWatchOnlyIdentity
                  ? s.identity.buttonLabelWatchOnly
                  : s.identity.buttonLabelLogin
            }
          >
            <Icon name={isPasswordLocked ? 'lock' : isWatchOnlyIdentity ? 'eye' : 'user circle'} aria-hidden="true" />
            {isPasswordLocked ? s.identity.locked : isWatchOnlyIdentity ? s.identity.watchOnly : (
              <span data-testid="hub-identity-chip-label">{identityLabel}</span>
            )}
          </Button>
        )}
        {onOpenSettings ? (
          <Button
            size="small"
            basic
            icon
            title={s.nav.openSettingsTitle}
            aria-label={s.nav.openSettings}
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
