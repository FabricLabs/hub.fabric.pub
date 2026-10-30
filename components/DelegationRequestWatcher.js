'use strict';

const React = require('react');
const { listDelegationRequests } = require('../functions/hubDelegationClient');
const { pushUiNotification } = require('../functions/uiNotifications');

const POLL_MS = 15000;

/**
 * Puts each new signing request from a linked signer into the in-app
 * notifications (and so the top-bar badge), linking to `/notifications`.
 * Renders nothing; operator only (needs the admin token).
 * @param {{ adminToken?: string }} props
 */
function DelegationRequestWatcher (props) {
  const adminToken = props && props.adminToken ? String(props.adminToken).trim() : '';
  const seen = React.useRef(new Set());

  React.useEffect(() => {
    if (!adminToken) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const list = await listDelegationRequests(adminToken);
        if (stopped) return;
        for (const r of list) {
          if (seen.current.has(r.hash)) continue;
          seen.current.add(r.hash);
          pushUiNotification({
            id: `delegation:${r.hash}`,
            kind: 'delegation',
            title: r.title || 'Signing request',
            subtitle: r.summary || undefined,
            href: '/notifications'
          });
        }
      } catch (_) { /* Hub without delegation, or offline */ }
    };
    void poll();
    const id = setInterval(() => { void poll(); }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [adminToken]);

  return null;
}

module.exports = DelegationRequestWatcher;
