'use strict';

const React = require('react');
const { listDelegationRequests } = require('../functions/hubDelegationClient');
const {
  readUiNotifications,
  pushUiNotification,
  resolveUiNotification
} = require('../functions/uiNotifications');

const POLL_MS = 15000;

/**
 * Puts each new signing request from a linked signer into the in-app
 * notifications (and so the top-bar badge), linking to `/notifications`,
 * and marks it resolved (kept in history) once the request is no longer pending.
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
        const pending = new Set(list.map((r) => `delegation:${r.hash}`));
        const stored = readUiNotifications();
        for (const n of stored) {
          if (!n || n.kind !== 'delegation' || n.resolvedAt || pending.has(n.id)) continue;
          resolveUiNotification(n.id);
        }
        const known = new Set(stored.map((n) => n && n.id));
        for (const r of list) {
          if (seen.current.has(r.hash)) continue;
          seen.current.add(r.hash);
          if (known.has(`delegation:${r.hash}`)) continue;
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
