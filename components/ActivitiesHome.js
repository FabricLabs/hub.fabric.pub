'use strict';

const React = require('react');
const { Link, useSearchParams } = require('react-router-dom');
const { Button, Header, Icon, Segment } = require('semantic-ui-react');
const ActivityStream = require('./ActivityStream');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');

const ACTIVITY_FILTERS = [
  { value: 'all', label: 'All', icon: 'list layout' },
  { value: 'chat', label: 'Chat', icon: 'comments' },
  { value: 'bitcoin', label: 'Bitcoin', icon: 'bitcoin' },
  { value: 'documents', label: 'Documents', icon: 'file outline' },
  { value: 'network', label: 'Network', icon: 'sitemap' }
];

const VALID_FILTER = new Set(ACTIVITY_FILTERS.map((f) => f.value));

function ActivitiesUiNotifications ({ uf: ufProp }) {
  const uf = ufProp || loadHubUiFeatureFlags();
  const [list, setList] = React.useState(() => readUiNotifications());
  React.useEffect(() => {
    const sync = () => setList(readUiNotifications());
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

  if (list.length === 0) return null;

  return (
    <Segment id="in-app-notifications" secondary style={{ marginBottom: '1em' }}>
      <Header as="h4" style={{ marginTop: 0 }}>
        <Icon name="bell outline" />
        In-app notifications
      </Header>
      <p style={{ color: '#666', fontSize: '0.9em', marginBottom: '0.75em' }}>
        Wallet, Payjoin, and hub toasts. Open a link, copy details, or dismiss.
      </p>
      {list.map((n) => {
        const openTo = notificationOpenHref(n.href, uf);
        return (
        <Segment key={n.id} size="small" style={{ marginBottom: '0.5em' }}>
          <div style={{ fontWeight: 600 }}>{n.title}</div>
          {n.subtitle && (
            <div style={{ fontSize: '0.85em', color: '#888', wordBreak: 'break-word', marginTop: '0.25em' }}>
              {n.subtitle}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center', marginTop: '0.5em' }}>
            {openTo && (
              <Button as={Link} to={openTo} size="mini" primary>
                Open
              </Button>
            )}
            {n.copyText && (
              <Button
                size="mini"
                basic
                icon
                title="Copy to clipboard"
                onClick={() => copyToClipboard(n.copyText)}
              >
                <Icon name="copy outline" />
              </Button>
            )}
            <Button
              size="mini"
              basic
              icon
              title="Dismiss"
              onClick={() => removeUiNotification(n.id)}
            >
              <Icon name="close" />
            </Button>
          </div>
        </Segment>
        );
      })}
      <Button size="small" basic icon labelPosition="left" onClick={() => clearUiNotifications()}>
        <Icon name="trash" />
        Clear all
      </Button>
    </Segment>
  );
}

/**
 * Canonical hub activity feed (`/activities`).
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
          <Button basic as={Link} to="/" size="small" icon labelPosition="left" aria-label="Back to home">
            <Icon name="arrow left" aria-hidden="true" />
            Home
          </Button>
          <Button
            as={Link}
            to="/notifications"
            basic
            size="small"
            icon
            labelPosition="left"
            title="Wallet, Payjoin, and hub toasts (same as the bell)"
            aria-label="Notifications — in-app toasts"
          >
            <Icon name="bell outline" aria-hidden="true" />
            Notifications
          </Button>
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
          <Button
            as={Link}
            to="/services/bitcoin"
            basic
            size="small"
            icon
            labelPosition="left"
            title="Bitcoin hub page"
            aria-label="Bitcoin dashboard"
          >
            <Icon name="bitcoin" aria-hidden="true" />
            Bitcoin
          </Button>
          {uf.bitcoinPayments ? (
            <Button as={Link} to="/payments" basic size="small" title="Payjoin and payments">
              Payments
            </Button>
          ) : null}
          {uf.bitcoinInvoices ? (
            <Button as={Link} to="/services/bitcoin/invoices#fabric-invoices-tab-demo" basic size="small" title="Invoices walkthrough">
              Invoices
            </Button>
          ) : null}
          {uf.bitcoinResources ? (
            <Button as={Link} to="/services/bitcoin/resources" basic size="small" title="HTTP resources and L1 payment verification">
              Resources
            </Button>
          ) : null}
          {uf.bitcoinCrowdfund ? (
            <Button as={Link} to="/services/bitcoin/crowdfunds" basic size="small" icon title="Taproot campaign vault">
              <Icon name="heart" />
              Crowdfunds
            </Button>
          ) : null}
        </div>
        <section aria-labelledby="activities-page-heading" aria-describedby="activities-page-summary">
          <Header as="h2" id="activities-page-heading" style={{ marginTop: '0.75em' }}>
            Activities
          </Header>
          <p id="activities-page-summary" style={{ color: '#666' }}>
            Hub message log, chat, Bitcoin blocks, and network events. Wallet, Payjoin, and other short toasts live on{' '}
            <Link to="/notifications">Notifications</Link> (same list as the bell in the top bar).
          </p>
          <div
            role="toolbar"
            aria-label="Activity type filter"
            style={{ marginBottom: '0.75em', display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}
          >
            <span style={{ fontSize: '0.9em', color: '#666', marginRight: '0.25em' }}>Show:</span>
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
                  aria-label={f.value === 'all' ? 'Show all activity types' : `Filter activity feed: ${f.label} only`}
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
