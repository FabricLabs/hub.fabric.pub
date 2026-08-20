'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Segment } = require('semantic-ui-react');

/**
 * Shown on Hub-HTTP routes when this origin only serves the SPA (CDN / static files).
 */
function ClientNeedsHub () {
  return (
    <Segment data-testid="hub-client-needs-hub" style={{ maxWidth: '40rem', margin: '2em auto' }}>
      <Header as="h2" id="hub-client-needs-hub-heading">
        <Icon name="plug" aria-hidden="true" />
        <Header.Content>This view needs a Hub</Header.Content>
      </Header>
      <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '1em' }}>
        Peers, documents, contracts, Bitcoin services, and activity talk to a live Hub
        HTTP API (<code>/settings</code> JSON, <code>/services/rpc</code>, WebSocket).
        This origin is only serving the HTML client.
      </p>
      <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '1.25em' }}>
        Use identity and local wallet tools here. Point the client at a Hub from Settings
        when you have one.
      </p>
      <Button as={Link} to="/" primary>
        Client home
      </Button>
      <Button as={Link} to="/settings" basic style={{ marginLeft: '0.5em' }}>
        Settings
      </Button>
    </Segment>
  );
}

module.exports = ClientNeedsHub;
