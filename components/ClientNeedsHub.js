'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Segment } = require('semantic-ui-react');
const t = require('../locales/en');

const s = t.shell.clientNeedsHub;

/**
 * Shown on Hub-HTTP routes when this origin only serves the SPA (CDN / static files).
 */
function ClientNeedsHub () {
  return (
    <Segment data-testid="hub-client-needs-hub" style={{ maxWidth: '40rem', margin: '2em auto' }}>
      <Header as="h2" id="hub-client-needs-hub-heading">
        <Icon name="plug" aria-hidden="true" />
        <Header.Content>{s.title}</Header.Content>
      </Header>
      <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '1em' }}>
        {s.body}
      </p>
      <p style={{ color: '#666', lineHeight: 1.5, marginBottom: '1.25em' }}>
        {s.hint}
      </p>
      <Button as={Link} to="/" primary>
        {s.home}
      </Button>
      <Button as={Link} to="/settings" basic style={{ marginLeft: '0.5em' }}>
        {s.settings}
      </Button>
    </Segment>
  );
}

module.exports = ClientNeedsHub;
