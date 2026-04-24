'use strict';

const React = require('react');
const { Modal, Button, Header, Icon, Message } = require('semantic-ui-react');
const { toast } = require('../functions/toast');

function CollaborationInviteModal (props) {
  const open = !!(props && props.open);
  const detail = props && props.detail;
  const onClose = props && typeof props.onClose === 'function' ? props.onClose : () => {};

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const respond = React.useCallback(async (action) => {
    if (!detail) return;
    const url = action === 'accept' ? detail.acceptUrl : detail.declineUrl;
    if (!url) {
      setError(`Missing ${action} URL.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(String(url), { method: 'GET', headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || (body && body.status === 'error')) {
        throw new Error((body && body.message) || `${action} failed (${res.status})`);
      }
      toast.success(action === 'accept' ? 'Invitation accepted.' : 'Invitation declined.', { header: 'Collaboration' });
      onClose();
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [detail, onClose]);

  if (!open || !detail) return null;

  const recipientPeerIdentity = detail.recipientPeerIdentity ? String(detail.recipientPeerIdentity) : '';
  const groupId = detail.groupId ? String(detail.groupId) : '';
  const fromPeerId = detail.fromPeerId ? String(detail.fromPeerId) : '';

  return (
    <Modal open={open} onClose={onClose} size="small" closeIcon aria-labelledby="collaboration-invite-heading">
      <Header icon id="collaboration-invite-heading">
        <Icon name="users" />
        Collaboration invitation
      </Header>
      <Modal.Content>
        <p style={{ marginTop: 0 }}>
          A connected peer invited this identity to collaborate.
          {recipientPeerIdentity ? ` Recipient peer: ${recipientPeerIdentity}.` : ''}
          {groupId ? ` Group: ${groupId}.` : ''}
        </p>
        {fromPeerId ? (
          <p style={{ color: '#666' }}>
            From peer: <code>{fromPeerId}</code>
          </p>
        ) : null}
        {error ? <Message negative content={error} /> : null}
      </Modal.Content>
      <Modal.Actions>
        <Button basic disabled={busy} onClick={() => respond('decline')}>
          Reject
        </Button>
        <Button primary loading={busy} disabled={busy} onClick={() => respond('accept')}>
          Accept
        </Button>
      </Modal.Actions>
    </Modal>
  );
}

module.exports = CollaborationInviteModal;
