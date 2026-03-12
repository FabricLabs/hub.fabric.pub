'use strict';

// Dependencies
const React = require('react');
const { Link, useLocation } = require('react-router-dom');

// Semantic UI
const {
  Button,
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
  const hasLocalIdentity = !!(props && props.hasLocalIdentity);
  const hasLockedIdentity = !!(props && props.hasLockedIdentity);
  const localIdentity = props && props.localIdentity ? props.localIdentity : null;
  const bitcoin = props && props.bitcoin;

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
        {isAuthed && bitcoin && typeof bitcoin.balance === 'number' && (
          <Label size="small" basic title="Bitcoin balance">
            <Icon name="bitcoin" color="orange" />
            {bitcoin.balance}
          </Label>
        )}
        {hasLocalIdentity && (
          <Icon
            name={isLockedState ? 'lock' : 'unlock'}
            color={isLockedState ? 'orange' : 'green'}
            title={isLockedState ? 'Identity locked' : 'Identity unlocked'}
            style={{ marginRight: '0.25em', cursor: isLockedState ? 'pointer' : 'default' }}
            onClick={() => {
              if (isLockedState && onUnlockIdentity) onUnlockIdentity();
            }}
          />
        )}
        <Button
          size="small"
          basic={!isAuthed && !isLockedState}
          primary={isAuthed}
          onClick={() => {
            if (isAuthed && onManageIdentity) {
              onManageIdentity();
            } else if (isLockedState && onUnlockIdentity) {
              onUnlockIdentity();
            } else if (!isAuthed && onLogin) {
              onLogin();
            }
          }}
          title={isAuthed ? 'Manage identity' : (isLockedState ? 'Unlock identity' : 'Log in')}
        >
          <Icon name={isLockedState ? 'lock' : 'user circle'} />
          {isLockedState ? 'Locked' : identityLabel}
        </Button>
        <Button
          size="small"
          basic
          icon
          title="Settings"
          onClick={() => onOpenSettings && onOpenSettings()}
        >
          <Icon name="cog" />
        </Button>
      </div>
    </Segment>
  );
}

module.exports = TopPanel;
