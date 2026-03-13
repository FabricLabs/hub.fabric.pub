'use strict';

// Dependencies
const React = require('react');
const { Link, useLocation } = require('react-router-dom');

const HOVER_CLOSE_DELAY_MS = 350;

// Semantic UI
const {
  Button,
  Dropdown,
  Header,
  Icon,
  Label,
  Segment
} = require('semantic-ui-react');

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
  const isLockedState = hasLocalIdentity && hasLockedIdentity && !isAuthed;
  const identitySource = localIdentity || auth;
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

  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const hoverTimeoutRef = React.useRef(null);
  const handleDropdownMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setDropdownOpen(true);
  };
  const handleDropdownMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => setDropdownOpen(false), HOVER_CLOSE_DELAY_MS);
  };
  React.useEffect(() => () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
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
          <Button as={Link} to="/services/bitcoin" basic={!active('/services/bitcoin')} primary={active('/services/bitcoin')}>
            <Icon name="bitcoin" color="orange" />
            Bitcoin
          </Button>
          <Button as={Link} to="/peers" basic={!active('/peers')} primary={active('/peers')}>
            <Icon name="sitemap" />
            Peers
          </Button>
          <Button as={Link} to="/documents" basic={!active('/documents')} primary={active('/documents')}>
            <Icon name="file outline" />
            Documents
          </Button>
        </Button.Group>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
        {hasLocalIdentity && (
          <Icon
            name={isLockedState ? 'lock' : 'unlock'}
            color={isLockedState ? 'orange' : 'green'}
            title={isLockedState ? 'Identity locked — click to unlock' : 'Identity unlocked — click to lock'}
            style={{ marginRight: '0.25em', cursor: 'pointer' }}
            onClick={() => {
              if (isLockedState && onUnlockIdentity) {
                onUnlockIdentity();
              } else if (!isLockedState && onLockIdentity) {
                if (typeof window !== 'undefined' && window.confirm('Lock your identity? You will need to enter your password to unlock again.')) {
                  onLockIdentity();
                }
              }
            }}
          />
        )}
        {isAuthed && (clientBalance != null || (bitcoin && typeof bitcoin.balance === 'number')) && (
          <Label
            as={Link}
            to="/services/bitcoin/payments"
            size="small"
            basic
            title="Bitcoin balance — click to open payments"
            style={{ cursor: 'pointer' }}
          >
            <Icon name="bitcoin" color="orange" />
            {clientBalance != null && Number.isFinite(clientBalance.balanceSats)
              ? (clientBalance.balanceSats >= 100000000
                  ? `${(clientBalance.balanceSats / 100000000).toFixed(4)} BTC`
                  : `${clientBalance.balanceSats} sats`)
              : (bitcoin && typeof bitcoin.balance === 'number' ? String(bitcoin.balance) : '—')}
          </Label>
        )}
        {isAuthed ? (
          <div
            onMouseEnter={handleDropdownMouseEnter}
            onMouseLeave={handleDropdownMouseLeave}
            style={{ display: 'inline-block' }}
          >
            <Dropdown
              open={dropdownOpen}
              onClose={() => setDropdownOpen(false)}
              trigger={
                <Button size="small" primary title="Identity menu">
                  <Icon name="user circle" />
                  {identityLabel}
                  <Icon name="dropdown" />
                </Button>
              }
              pointing="top right"
              icon={null}
            >
              <Dropdown.Menu>
                <Dropdown.Item icon="user" text="User profile" onClick={() => { setDropdownOpen(false); onProfile && onProfile(); }} />
                <Dropdown.Item icon="pencil" text="Sign message" onClick={() => { setDropdownOpen(false); onSignMessage && onSignMessage(); }} />
                <Dropdown.Item icon="cog" text="Settings" onClick={() => { setDropdownOpen(false); onOpenSettings && onOpenSettings(); }} />
                <Dropdown.Divider />
                <Dropdown.Item icon="trash" text="Destroy identity" onClick={() => { setDropdownOpen(false); onDestroyIdentity && onDestroyIdentity(); }} />
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
