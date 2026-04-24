'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Container, Message, Header, Button, Icon } = require('semantic-ui-react');

/**
 * Soft gate: browsers without an unlocked signing identity see a sign-in prompt instead of operator pages.
 * @param {{ active: boolean, onOpenIdentity?: function, children: React.ReactNode }} props
 */
function PublicVisitorGate (props) {
  const active = !!(props && props.active);
  const onOpenIdentity = props && typeof props.onOpenIdentity === 'function' ? props.onOpenIdentity : null;
  const children = props && props.children;
  if (!active) return children;
  return (
    <Container style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <Message info icon>
        <Icon name="user circle outline" aria-hidden="true" />
        <Message.Content>
          <Header as="h3" style={{ marginTop: 0 }}>Sign in with a Fabric identity</Header>
          <p style={{ lineHeight: 1.55, marginBottom: '1rem' }}>
            This area uses your local keys and hub wallet tools. Create or unlock an identity to continue.
          </p>
          <Button type="button" primary onClick={() => (onOpenIdentity ? onOpenIdentity() : null)}>
            <Icon name="sign in" />
            Open identity
          </Button>
          <Button type="button" as={Link} to="/settings/security" basic style={{ marginLeft: '0.5rem' }}>
            Security &amp; identity
          </Button>
          <Button type="button" as={Link} to="/" basic style={{ marginLeft: '0.5rem' }}>
            Home
          </Button>
        </Message.Content>
      </Message>
    </Container>
  );
}

module.exports = PublicVisitorGate;
