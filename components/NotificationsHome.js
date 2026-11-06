'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Segment } = require('semantic-ui-react');
const InAppNotificationsList = require('./InAppNotificationsList');
const FederationRequestsPanel = require('./FederationRequestsPanel');
const DelegationRequestsPanel = require('./DelegationRequestsPanel');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const t = require('../locales/en');

/**
 * In-app toasts only (compact). Hub log + chat live on `/activities`.
 */
function NotificationsHome (props) {
  const [flagTick, setFlagTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setFlagTick((n) => n + 1)), []);
  void flagTick;
  const uf = loadHubUiFeatureFlags();
  const c = t.home.notifications;
  const nav = t.shell.nav;

  return (
    <fabric-hub-notifications class="fade-in">
      <Segment>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
          <Button basic as={Link} to="/" size="small" icon labelPosition="left">
            <Icon name="arrow left" aria-hidden="true" />
            {t.home.backHome}
          </Button>
          {uf.activities ? (
            <Button as={Link} to="/activities" basic size="small" icon labelPosition="left" title={c.activityLogTitle}>
              <Icon name="comments" aria-hidden="true" />
              {nav.activityLog}
            </Button>
          ) : null}
          <Button
            basic
            as={Link}
            to="/settings/security"
            size="small"
            icon
            labelPosition="left"
            title={c.securityTitle}
          >
            <Icon name="shield alternate" aria-hidden="true" />
            {nav.security}
          </Button>
          <Button as={Link} to="/services/bitcoin" basic size="small" icon labelPosition="left" title={c.bitcoinTitle}>
            <Icon name="bitcoin" aria-hidden="true" />
            {nav.bitcoin}
          </Button>
        </div>

        <section aria-labelledby="notifications-page-heading" aria-describedby="notifications-page-summary">
          <Header as="h2" id="notifications-page-heading" style={{ marginTop: '0.75em' }}>
            {c.title}
          </Header>
          <p id="notifications-page-summary" style={{ color: '#666', marginBottom: '0.65em', lineHeight: 1.45 }}>
            {c.summary} {uf.activities ? c.summaryActivity : c.summaryActivityOff}
          </p>
          <InAppNotificationsList uf={uf} showHeader={false} />
        </section>
      </Segment>
      <DelegationRequestsPanel adminToken={readHubAdminTokenFromBrowser(props && props.adminToken)} />
      <FederationRequestsPanel adminToken={readHubAdminTokenFromBrowser(props && props.adminToken)} compact />
    </fabric-hub-notifications>
  );
}

module.exports = NotificationsHome;
