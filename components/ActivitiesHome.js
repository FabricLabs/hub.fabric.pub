'use strict';

const React = require('react');
const { Link, useSearchParams } = require('react-router-dom');
const { Button, Header, Icon, Segment } = require('semantic-ui-react');
const ActivityStream = require('./ActivityStream');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const t = require('../locales/en');

const FILTER_LABELS = t.home.activities.filters;
const ACTIVITY_FILTERS = [
  { value: 'all', label: FILTER_LABELS.all, icon: 'list layout' },
  { value: 'chat', label: FILTER_LABELS.chat, icon: 'comments' },
  { value: 'bitcoin', label: FILTER_LABELS.bitcoin, icon: 'bitcoin' },
  { value: 'documents', label: FILTER_LABELS.documents, icon: 'file outline' },
  { value: 'network', label: FILTER_LABELS.network, icon: 'sitemap' }
];

const VALID_FILTER = new Set(ACTIVITY_FILTERS.map((f) => f.value));

/**
 * Canonical Hub activity feed (`/activities`).
 */
function ActivitiesHome (props) {
  const ref = props.bridgeRef || props.bridge;
  const adminToken = props.adminToken;
  const onRequireUnlock = props.onRequireUnlock;
  const identity = props.identity;
  const [searchParams, setSearchParams] = useSearchParams();
  const [flagTick, setFlagTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setFlagTick((n) => n + 1)), []);
  void flagTick;
  const uf = loadHubUiFeatureFlags();
  const c = t.home.activities;
  const nav = t.shell.nav;
  const rawType = (searchParams.get('type') || 'all').trim().toLowerCase();
  let entryTypeFilter = VALID_FILTER.has(rawType) ? rawType : 'all';

  const setEntryTypeFilter = (value) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (!value || value === 'all') p.delete('type');
      else p.set('type', value);
      return p;
    }, { replace: true });
  };

  return (
    <fabric-hub-activities class="fade-in">
      <Segment>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
          <Button basic as={Link} to="/" size="small" icon labelPosition="left">
            <Icon name="arrow left" aria-hidden="true" />
            {t.home.backHome}
          </Button>
          <Button
            as={Link}
            to="/notifications"
            basic
            size="small"
            icon
            labelPosition="left"
            title={c.notificationsTitle}
          >
            <Icon name="bell outline" aria-hidden="true" />
            {nav.notifications}
          </Button>
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
          <Button
            as={Link}
            to="/services/bitcoin"
            basic
            size="small"
            icon
            labelPosition="left"
            title={c.bitcoinTitle}
          >
            <Icon name="bitcoin" aria-hidden="true" />
            {nav.bitcoin}
          </Button>
          {uf.bitcoinPayments ? (
            <Button as={Link} to="/payments" basic size="small" title={c.paymentsTitle}>
              {nav.payments}
            </Button>
          ) : null}
          {uf.bitcoinInvoices ? (
            <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic size="small" title={c.invoicesTitle}>
              {nav.invoices}
            </Button>
          ) : null}
          {uf.bitcoinResources ? (
            <Button as={Link} to="/services/bitcoin/resources" basic size="small" title={c.resourcesTitle}>
              {nav.bitcoinResources}
            </Button>
          ) : null}
          {uf.bitcoinCrowdfund ? (
            <Button as={Link} to="/services/bitcoin/crowdfunds" basic size="small" icon title={c.crowdfundsTitle}>
              <Icon name="heart" />
              {nav.crowdfunds}
            </Button>
          ) : null}
        </div>
        <section aria-labelledby="activities-page-heading" aria-describedby="activities-page-summary">
          <Header as="h2" id="activities-page-heading" style={{ marginTop: '0.75em' }}>
            {c.title}
          </Header>
          <p id="activities-page-summary" style={{ color: '#666' }}>
            {c.summary}
          </p>
          <div
            role="toolbar"
            aria-label={c.filterLabel}
            style={{ marginBottom: '0.75em', display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}
          >
            <span style={{ fontSize: '0.9em', color: '#666', marginRight: '0.25em' }}>{c.show}</span>
            {ACTIVITY_FILTERS.map((f) => {
              const active = entryTypeFilter === f.value;
              return (
                <Button
                  key={f.value}
                  size="small"
                  type="button"
                  active={active}
                  primary={active}
                  basic={!active}
                  icon
                  labelPosition="left"
                  onClick={() => setEntryTypeFilter(f.value)}
                  aria-pressed={active}
                >
                  <Icon name={f.icon} />
                  {f.label}
                </Button>
              );
            })}
          </div>
          <ActivityStream
            bridge={ref}
            bridgeRef={ref}
            adminToken={adminToken}
            identity={identity}
            onRequireUnlock={onRequireUnlock}
            includeHeader={false}
            entryTypeFilter={entryTypeFilter}
          />
        </section>
      </Segment>
    </fabric-hub-activities>
  );
}

module.exports = ActivitiesHome;
