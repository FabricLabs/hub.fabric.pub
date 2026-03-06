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

  const formatIdentityValue = (value) => {
    if (value == null) return '';
    const s = String(value);
    if (s.length <= 16) return s;
    const head = s.slice(0, 8);
    const tail = s.slice(-8);
    return `${head}…${tail}`;
  };

  // Treat any non-null auth object as "authenticated" so we never
  // accidentally trigger host onLogin handlers that might log out.
  const isAuthed = !!auth;
  const isLockedState = !isAuthed && hasLocalIdentity && hasLockedIdentity;
  const identityLabel = (() => {
    if (!auth) return 'Login';
    if (auth.username) return auth.username;
    if (auth.id) return formatIdentityValue(auth.id);
    if (auth.address) return formatIdentityValue(auth.address);
    if (auth.xpub) return formatIdentityValue(auth.xpub);
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
        {hubAddress ? (
          <Label size="small" title="Configured hub address">
            <Icon name="server" />
            {hubAddress}
          </Label>
        ) : null}
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
