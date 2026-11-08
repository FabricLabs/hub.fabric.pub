'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon, Label } = require('semantic-ui-react');
const {
  readUiNotifications,
  markUiNotificationsRead,
  markAllUiNotificationsRead,
  markUiNotificationUnread,
  isUnread,
  countUnread,
  isWalletTransactionNotification,
  copyToClipboard,
  UPDATED_EVENT,
  STORAGE_KEY
} = require('../functions/uiNotifications');
const { inAppNotificationOpenHref } = require('../functions/inAppNotificationOpenHref');
const t = require('../locales/en');

const PAGE_SIZE = 50;
const FILTERS = ['all', 'unread', 'wallet'];

/**
 * @param {number} ts
 * @param {number} now
 * @returns {string}
 */
function relativeTime (ts, now) {
  const c = t.home.inApp.ago;
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return c.now;
  const m = Math.round(s / 60);
  if (m < 60) return c.minutes(m);
  const h = Math.round(m / 60);
  if (h < 24) return c.hours(h);
  const d = Math.round(h / 24);
  if (d < 30) return c.days(d);
  return new Date(ts).toLocaleDateString();
}

/**
 * @param {object[]} list
 * @param {string} filter
 * @returns {object[]}
 */
function filterNotifications (list, filter) {
  if (filter === 'unread') return list.filter(isUnread);
  if (filter === 'wallet') return list.filter(isWalletTransactionNotification);
  return list;
}

/**
 * Notification history from browser storage (same source as the top-bar badge): unread rows
 * are highlighted, nothing is deleted.
 * @param {{ uf?: object, showHeader?: boolean, showMarkAll?: boolean }} props
 */
function InAppNotificationsList (props) {
  const c = t.home.inApp;
  const uf = props.uf || {};
  const showHeader = props.showHeader !== false;
  const showMarkAll = props.showMarkAll !== false;
  const [list, setList] = React.useState(() => readUiNotifications());
  const [filter, setFilter] = React.useState('all');
  const [shown, setShown] = React.useState(PAGE_SIZE);
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

  if (list.length === 0) {
    return (
      <p style={{ color: '#888', fontSize: '0.9em', margin: '0.25em 0 0' }}>
        {c.empty}
      </p>
    );
  }

  const now = Date.now();
  const unread = countUnread(list);
  const visible = filterNotifications(list, filter);
  const page = visible.slice(0, shown);

  return (
    <div id="in-app-notifications">
      {showHeader ? (
        <Header as="h4" style={{ marginTop: 0, marginBottom: '0.5em' }}>
          <Icon name="bell outline" />
          {c.title}
        </Header>
      ) : null}
      <div
        role="group"
        aria-label={c.filterLabel}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35em', marginBottom: '0.5em' }}
      >
        <Button.Group size="mini" basic>
          {FILTERS.map((f) => (
            <Button
              key={f}
              active={filter === f}
              aria-pressed={filter === f}
              onClick={() => { setFilter(f); setShown(PAGE_SIZE); }}
            >
              {c.filters[f]}
              {f === 'unread' && unread > 0 ? ` (${unread})` : ''}
            </Button>
          ))}
        </Button.Group>
        {showMarkAll ? (
          <Button
            size="mini"
            basic
            icon
            labelPosition="left"
            disabled={unread === 0}
            onClick={() => markAllUiNotificationsRead()}
          >
            <Icon name="check" />
            {c.markAllRead}
          </Button>
        ) : null}
      </div>
      {page.length === 0 ? (
        <p style={{ color: '#888', fontSize: '0.9em', margin: '0.25em 0 0' }}>
          {filter === 'unread' ? c.emptyUnread : c.emptyWallet}
        </p>
      ) : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {page.map((n) => {
          const fresh = isUnread(n);
          const resolved = !!n.resolvedAt;
          const openTo = resolved ? null : inAppNotificationOpenHref(n.href, uf);
          const ts = Number(n.ts) || 0;
          return (
            <li
              key={n.id}
              data-unread={fresh ? 'true' : undefined}
              aria-label={fresh ? c.unreadRow(n.title) : n.title}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                gap: '0.35em 0.5em',
                padding: '0.4em 0.5em',
                borderBottom: '1px solid rgba(34, 36, 38, 0.08)',
                borderLeft: fresh ? '3px solid #2185d0' : '3px solid transparent',
                background: fresh ? 'rgba(33, 133, 208, 0.07)' : 'transparent',
                fontSize: '0.9em',
                lineHeight: 1.35
              }}
            >
              <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                <div style={{ fontWeight: fresh ? 700 : 500 }}>
                  {fresh ? (
                    <Label size="mini" color="blue" style={{ marginRight: '0.4em' }}>{c.newLabel}</Label>
                  ) : null}
                  {n.title}
                  {resolved ? (
                    <Label size="mini" basic style={{ marginLeft: '0.4em' }}>{c.resolved}</Label>
                  ) : null}
                </div>
                {n.subtitle ? (
                  <div
                    style={{
                      color: '#767676',
                      fontSize: '0.88em',
                      wordBreak: 'break-word',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                    title={n.subtitle}
                  >
                    {n.subtitle}
                  </div>
                ) : null}
                {ts ? (
                  <time
                    dateTime={new Date(ts).toISOString()}
                    title={new Date(ts).toLocaleString()}
                    style={{ color: '#999', fontSize: '0.82em' }}
                  >
                    {relativeTime(ts, now)}
                  </time>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25em', alignItems: 'center', flexShrink: 0 }}>
                {openTo ? (
                  <Button
                    as={Link}
                    to={openTo}
                    size="mini"
                    compact
                    primary
                    onClick={() => markUiNotificationsRead([n.id])}
                  >
                    {t.common.actions.open}
                  </Button>
                ) : null}
                {n.copyText ? (
                  <Button
                    size="mini"
                    compact
                    basic
                    icon
                    title={c.copy}
                    aria-label={c.copy}
                    onClick={() => copyToClipboard(n.copyText)}
                  >
                    <Icon name="copy outline" />
                  </Button>
                ) : null}
                <Button
                  size="mini"
                  compact
                  basic
                  icon
                  title={fresh ? c.markRead : c.markUnread}
                  aria-label={fresh ? c.markRead : c.markUnread}
                  onClick={() => (fresh ? markUiNotificationsRead([n.id]) : markUiNotificationUnread(n.id))}
                >
                  <Icon name={fresh ? 'check' : 'circle outline'} />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {visible.length > shown ? (
        <Button size="small" basic icon labelPosition="left" style={{ marginTop: '0.65em' }} onClick={() => setShown(shown + PAGE_SIZE)}>
          <Icon name="history" />
          {c.showOlder(visible.length - shown)}
        </Button>
      ) : null}
    </div>
  );
}

InAppNotificationsList.filterNotifications = filterNotifications;
InAppNotificationsList.relativeTime = relativeTime;

module.exports = InAppNotificationsList;
