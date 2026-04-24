'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Button, Header, Icon } = require('semantic-ui-react');
const {
  readUiNotifications,
  clearUiNotifications,
  removeUiNotification,
  copyToClipboard,
  UPDATED_EVENT,
  STORAGE_KEY
} = require('../functions/uiNotifications');
const { inAppNotificationOpenHref } = require('../functions/inAppNotificationOpenHref');

/**
 * Wallet / Payjoin / hub toasts from localStorage (same source as the top-bar badge).
 * @param {{ uf?: object, showHeader?: boolean, showClearAll?: boolean }} props
 */
function InAppNotificationsList (props) {
  const uf = props.uf || {};
  const showHeader = props.showHeader !== false;
  const showClearAll = props.showClearAll !== false;
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

  if (list.length === 0) {
    return (
      <p style={{ color: '#888', fontSize: '0.9em', margin: '0.25em 0 0' }}>
        No in-app notifications. Wallet, Payjoin, and hub toasts appear here when triggered.
      </p>
    );
  }

  return (
    <div id="in-app-notifications">
      {showHeader ? (
        <Header as="h4" style={{ marginTop: 0, marginBottom: '0.5em' }}>
          <Icon name="bell outline" />
          In-app notifications
        </Header>
      ) : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((n) => {
          const openTo = inAppNotificationOpenHref(n.href, uf);
          return (
            <li
              key={n.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                gap: '0.35em 0.5em',
                padding: '0.35em 0',
                borderBottom: '1px solid rgba(34, 36, 38, 0.08)',
                fontSize: '0.9em',
                lineHeight: 1.35
              }}
            >
              <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{n.title}</div>
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
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25em', alignItems: 'center', flexShrink: 0 }}>
                {openTo ? (
                  <Button as={Link} to={openTo} size="mini" compact primary>
                    Open
                  </Button>
                ) : null}
                {n.copyText ? (
                  <Button
                    size="mini"
                    compact
                    basic
                    icon
                    title="Copy to clipboard"
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
                  title="Dismiss"
                  onClick={() => removeUiNotification(n.id)}
                >
                  <Icon name="close" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {showClearAll ? (
        <Button size="small" basic icon labelPosition="left" style={{ marginTop: '0.65em' }} onClick={() => clearUiNotifications()}>
          <Icon name="trash" />
          Clear all
        </Button>
      ) : null}
    </div>
  );
}

module.exports = InAppNotificationsList;
