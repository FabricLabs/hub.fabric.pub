'use strict';

const React = require('react');
const { Modal, Button, Header, Icon, Message } = require('semantic-ui-react');
const { toast } = require('../functions/toast');
const strings = require('../locales/en');

const ci = strings.network.collaborationInvite;

function CollaborationInviteModal (props) {
  const open = !!(props && props.open);
  const detail = props && props.detail;
  const onClose = props && typeof props.onClose === 'function' ? props.onClose : () => {};

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const respond = React.useCallback(async (action) => {
    if (!detail) return;
    const accepting = action === 'accept';
    const url = accepting ? detail.acceptUrl : detail.declineUrl;
    if (!url) {
      setError(accepting ? ci.missingAccept : ci.missingDecline);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(String(url), { method: 'GET', headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || (body && body.status === 'error')) {
        throw new Error((body && body.message) || (accepting ? ci.acceptFailed(res.status) : ci.declineFailed(res.status)));
      }
      toast.success(accepting ? ci.accepted : ci.declined, { header: ci.toastHeader });
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
        {ci.title}
      </Header>
      <Modal.Content>
        <p style={{ marginTop: 0 }}>
          {ci.body}
          {recipientPeerIdentity ? ` ${ci.recipient(recipientPeerIdentity)}` : ''}
          {groupId ? ` ${ci.group(groupId)}` : ''}
        </p>
        {fromPeerId ? (
          <p style={{ color: '#666' }}>
            {ci.from} <code>{fromPeerId}</code>
          </p>
        ) : null}
        {error ? <Message negative content={error} role="alert" /> : null}
      </Modal.Content>
      <Modal.Actions>
        <Button basic disabled={busy} onClick={() => respond('decline')}>
          {ci.decline}
        </Button>
        <Button primary loading={busy} disabled={busy} onClick={() => respond('accept')}>
          {ci.accept}
        </Button>
      </Modal.Actions>
    </Modal>
  );
}

module.exports = CollaborationInviteModal;
