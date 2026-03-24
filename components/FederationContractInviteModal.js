'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Modal, Button, Header, Icon } = require('semantic-ui-react');
const { buildFederationContractInviteResponseJson } = require('../functions/federationContractInvite');

function FederationContractInviteModal (props) {
  const open = !!(props && props.open);
  const detail = props && props.detail;
  const onClose = props && typeof props.onClose === 'function' ? props.onClose : () => {};
  const onSendPeerMessage = props && typeof props.onSendPeerMessage === 'function' ? props.onSendPeerMessage : null;
  const getResponderPubkey = props && typeof props.getResponderPubkey === 'function' ? props.getResponderPubkey : () => '';

  const sendResponse = React.useCallback((accept) => {
    if (!detail || !detail.toPeerId || !onSendPeerMessage) {
      onClose();
      return;
    }
    const pk = getResponderPubkey() || null;
    const json = buildFederationContractInviteResponseJson({
      inviteId: detail.inviteId,
      accept,
      responderPubkey: pk
    });
    onSendPeerMessage(detail.toPeerId, json);
    onClose();
  }, [detail, getResponderPubkey, onClose, onSendPeerMessage]);

  if (!open || !detail) return null;

  const note = detail.note ? String(detail.note) : '';
  const contractId = detail.contractId ? String(detail.contractId) : '';

  return (
    <Modal open={open} onClose={onClose} size="small" closeIcon aria-labelledby="federation-invite-heading">
      <Header icon id="federation-invite-heading">
        <Icon name="users" />
        Federation contract invite
      </Header>
      <Modal.Content>
        <p style={{ marginTop: 0 }}>
          Another hub invited this identity to join a <strong>distributed federation</strong> (sidechain patches / beacon witnesses).
        </p>
        {contractId ? (
          <p>
            Referenced execution contract id: <code style={{ wordBreak: 'break-all' }}>{contractId}</code>
            {' '}(see <Link to={`/contracts/${encodeURIComponent(contractId)}`}>contract</Link>).
          </p>
        ) : null}
        {note ? <p style={{ color: '#444' }}>{note}</p> : null}
        <p style={{ color: '#666', fontSize: '0.9em' }}>
          Accept sends a signed chat response to the inviter with your Fabric public key. Only add keys to the federation policy when you trust this peer.
        </p>
      </Modal.Content>
      <Modal.Actions>
        <Button onClick={() => sendResponse(false)} basic>
          Decline
        </Button>
        <Button onClick={() => sendResponse(true)} primary>
          Accept
        </Button>
      </Modal.Actions>
    </Modal>
  );
}

module.exports = FederationContractInviteModal;
