'use strict';

const React = require('react');
const { Button, Icon, Message } = require('semantic-ui-react');
const {
  mergeAlertLists,
  computeDismissedIdSet,
  filterActiveAlerts,
  fetchPersistedDismissedIds,
  dismissHubUiAlert,
  subscribeHubUiAlertDismissals
} = require('../functions/hubUiAlerts');
function readWindowOverlayAlerts () {
  try {
    if (typeof window === 'undefined') return [];
    const w = window.FABRIC_HUB_UI_ALERTS;
    return Array.isArray(w) ? w : [];
  } catch (e) {
    return [];
  }
}

function HubAlertStack (props) {
  const adminToken = props && props.adminToken != null ? String(props.adminToken).trim() : '';
  const [allAlerts, setAllAlerts] = React.useState([]);
  const [active, setActive] = React.useState([]);
  const [index, setIndex] = React.useState(0);
  const scrollerRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let server = [];
      try {
        const res = await fetch('/services/ui-config', { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          server = body && Array.isArray(body.alerts) ? body.alerts : [];
        }
      } catch (_) { /* ignore */ }
      if (cancelled) return;
      const merged = mergeAlertLists(server, readWindowOverlayAlerts());
      setAllAlerts(merged);
      const serverDismissed = await fetchPersistedDismissedIds();
      if (cancelled) return;
      const dismissed = computeDismissedIdSet(merged, serverDismissed);
      setActive(filterActiveAlerts(merged, dismissed));
      setIndex(0);
    })();
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    const off = subscribeHubUiAlertDismissals(() => {
      setAllAlerts((cur) => {
        const dismissed = computeDismissedIdSet(cur, []);
        setActive(filterActiveAlerts(cur, dismissed));
        setIndex((i) => Math.min(i, Math.max(0, filterActiveAlerts(cur, dismissed).length - 1)));
        return cur;
      });
    });
    return off;
  }, []);

  React.useEffect(() => {
    if (index >= active.length && active.length > 0) setIndex(active.length - 1);
    if (active.length === 0) setIndex(0);
  }, [active.length, index]);

  const onDismiss = React.useCallback((alert) => {
    dismissHubUiAlert(alert, { adminToken });
    setAllAlerts((cur) => {
      const dismissed = computeDismissedIdSet(cur, []);
      const nextActive = filterActiveAlerts(cur, dismissed);
      setActive(nextActive);
      setIndex((i) => Math.min(i, Math.max(0, nextActive.length - 1)));
      return cur;
    });
  }, [adminToken]);

  const scrollToIndex = React.useCallback((i) => {
    const el = scrollerRef.current;
    if (!el || !active.length) return;
    const w = el.clientWidth || 1;
    el.scrollTo({ left: i * w, behavior: 'smooth' });
  }, [active.length]);

  const onPrev = () => {
    const i = Math.max(0, index - 1);
    setIndex(i);
    scrollToIndex(i);
  };

  const onNext = () => {
    const i = Math.min(active.length - 1, index + 1);
    setIndex(i);
    scrollToIndex(i);
  };

  if (!active.length) return null;

  const showNav = active.length > 1;

  return (
    <div
      id="fabric-hub-alert-stack"
      role="region"
      aria-label="Hub alerts"
      style={{
        margin: '0 -1em 0.5rem -1em',
        padding: '0 0.5rem',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.04), transparent)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '0.25rem', maxWidth: '100%' }}>
        {showNav ? (
          <Button
            type="button"
            basic
            icon
            aria-label="Previous alert"
            disabled={index <= 0}
            onClick={onPrev}
            style={{ alignSelf: 'center', flex: '0 0 auto' }}
          >
            <Icon name="chevron left" />
          </Button>
        ) : null}
        <div
          ref={scrollerRef}
          onScroll={(e) => {
            const el = e.target;
            const w = el.clientWidth || 1;
            const i = Math.round(el.scrollLeft / w);
            if (i !== index && i >= 0 && i < active.length) setIndex(i);
          }}
          style={{
            flex: '1 1 auto',
            display: 'flex',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollBehavior: 'smooth',
            WebkitOverflowScrolling: 'touch',
            gap: 0
          }}
        >
          {active.map((alert) => (
            <div
              key={alert.id}
              id={alert.elementName}
              data-alert-id={alert.id}
              style={{
                flex: '0 0 100%',
                scrollSnapAlign: 'start',
                minWidth: '100%',
                boxSizing: 'border-box',
                padding: '0.15rem 0'
              }}
            >
              <Message
                info={alert.severity === 'info'}
                warning={alert.severity === 'warning'}
                error={alert.severity === 'error'}
                success={alert.severity === 'success'}
                style={{ margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}
              >
                <span style={{ flex: '1 1 auto', lineHeight: 1.35, fontSize: '0.92rem' }}>{alert.message}</span>
                <Button
                  type="button"
                  basic
                  compact
                  size="small"
                  aria-label="Dismiss alert"
                  onClick={() => onDismiss(alert)}
                >
                  <Icon name="close" />
                </Button>
              </Message>
            </div>
          ))}
        </div>
        {showNav ? (
          <Button
            type="button"
            basic
            icon
            aria-label="Next alert"
            disabled={index >= active.length - 1}
            onClick={onNext}
            style={{ alignSelf: 'center', flex: '0 0 auto' }}
          >
            <Icon name="chevron right" />
          </Button>
        ) : null}
      </div>
      {showNav ? (
        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#666', marginTop: '-0.15rem' }}>
          {index + 1} / {active.length}
        </div>
      ) : null}
    </div>
  );
}

module.exports = HubAlertStack;
