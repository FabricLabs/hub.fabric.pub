'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Segment } = require('semantic-ui-react');
const InAppNotificationsList = require('./InAppNotificationsList');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');

/**
 * In-app toasts only (compact). Hub log + chat live on `/activities`.
 */
function NotificationsHome (props) {
  const [flagTick, setFlagTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setFlagTick((n) => n + 1)), []);
  void flagTick;
  const uf = loadHubUiFeatureFlags();

  return (
    <fabric-hub-notifications class="fade-in">
      <Segment>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
          <Button basic as={Link} to="/" size="small" icon labelPosition="left" aria-label="Back to home">
            <Icon name="arrow left" aria-hidden="true" />
            Home
          </Button>
          {uf.activities ? (
            <Button as={Link} to="/activities" basic size="small" icon labelPosition="left" title="Hub message log, chat, blocks">
              <Icon name="comments" aria-hidden="true" />
              Activity log
            </Button>
          ) : null}
          <Button
            basic
            as={Link}
            to="/settings/security"
            size="small"
            icon
            labelPosition="left"
            aria-label="Security, delegation tokens, and session audit"
          >
            <Icon name="shield alternate" aria-hidden="true" />
            Security &amp; delegation
          </Button>
          <Button as={Link} to="/services/bitcoin" basic size="small" icon labelPosition="left" aria-label="Bitcoin dashboard">
            <Icon name="bitcoin" aria-hidden="true" />
            Bitcoin
          </Button>
        </div>

        <section aria-labelledby="notifications-page-heading" aria-describedby="notifications-page-summary">
          <Header as="h2" id="notifications-page-heading" style={{ marginTop: '0.75em' }}>
            Notifications
          </Header>
          <p id="notifications-page-summary" style={{ color: '#666', marginBottom: '0.65em', lineHeight: 1.45 }}>
            Short-lived <strong>wallet</strong>, <strong>Payjoin</strong>, and hub <strong>toasts</strong> (same list as the bell in the top bar).
            The full <strong>hub message log</strong>, <strong>chat</strong>, and <strong>Bitcoin block</strong> stream is on the{' '}
            {uf.activities ? <Link to="/activities">activity log</Link> : <span>activity log (enable Activities in Admin → Feature visibility)</span>}
            .
          </p>
          <InAppNotificationsList uf={uf} showHeader={false} />
        </section>
      </Segment>
    </fabric-hub-notifications>
  );
}

module.exports = NotificationsHome;
