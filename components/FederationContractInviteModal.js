'use strict';

const React = require('react');
const { Link } = require('react-router-dom');
const { Modal, Button, Header, Icon, Message, List, Segment } = require('semantic-ui-react');
const {
  buildFederationContractInviteResponseJson,
  normalizeProposedPolicy,
  normalizeSpendingTerms,
  formatFederationInviteSpendingSummary
} = require('../functions/federationContractInvite');

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
  const spendingTerms = normalizeSpendingTerms(detail.spendingTerms);
  const proposedPolicy = normalizeProposedPolicy(detail.proposedPolicy);
  const termsSummary = detail.termsSummary ? String(detail.termsSummary).trim() : '';
  const capLine = formatFederationInviteSpendingSummary(detail);
  const previewPk = getResponderPubkey() || '';
  const pkLooksValidator = /^0[23][0-9a-fA-F]{64}$/.test(previewPk);

  return (
    <Modal open={open} onClose={onClose} size="small" closeIcon aria-labelledby="federation-invite-heading">
      <Header icon id="federation-invite-heading">
        <Icon name="users" />
        Federation contract invite
      </Header>
      <Modal.Content>
        <p style={{ marginTop: 0 }}>
          Another hub invited this identity to join a <strong>distributed federation</strong> (sidechain patches / beacon witnesses).
          Review every field below before you accept — accepting sends your <strong>compressed secp256k1 pubkey</strong> to the inviter.
        </p>
        {contractId ? (
          <p>
            Referenced execution contract id: <code style={{ wordBreak: 'break-all' }}>{contractId}</code>
            {' '}(see <Link to={`/contracts/${encodeURIComponent(contractId)}`}>contract</Link>).
          </p>
        ) : null}

        {(spendingTerms || capLine) ? (
          <Segment secondary style={{ marginTop: '0.75rem' }}>
            <Header as="h4" style={{ marginTop: 0 }}>Spending limit (UI terms)</Header>
            {capLine ? <p style={{ margin: '0.25em 0', fontWeight: 600 }}>{capLine}</p> : null}
            {spendingTerms ? (
              <p style={{ margin: '0.25em 0', color: '#555', fontSize: '0.9em' }}>
                Mode: <code>{spendingTerms.mode}</code>
                {' · '}
                Value: <code>{spendingTerms.value}</code>
                {spendingTerms.mode === 'percent' ? '%' : ' sats'}
              </p>
            ) : null}
          </Segment>
        ) : null}

        {termsSummary ? (
          <Segment style={{ marginTop: '0.75rem' }}>
            <Header as="h4" style={{ marginTop: 0 }}>Agreement text</Header>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                fontSize: '0.9em',
                lineHeight: 1.45,
                maxHeight: '14rem',
                overflow: 'auto'
              }}
            >
              {termsSummary}
            </pre>
          </Segment>
        ) : null}

        {proposedPolicy ? (
          <Segment style={{ marginTop: '0.75rem' }}>
            <Header as="h4" style={{ marginTop: 0 }}>Proposed validator set</Header>
            <p style={{ margin: '0.25em 0 0.5em', color: '#555' }}>
              Threshold: <strong>{proposedPolicy.threshold}</strong> of <strong>{proposedPolicy.validators.length}</strong>
            </p>
            <List relaxed size="small" style={{ fontFamily: 'monospace', fontSize: '0.82em' }}>
              {proposedPolicy.validators.map((v, i) => (
                <List.Item key={i}>
                  <List.Content>
                    <List.Header>{`Signer ${i + 1}`}</List.Header>
                    <span style={{ wordBreak: 'break-all' }}>{v}</span>
                  </List.Content>
                </List.Item>
              ))}
            </List>
          </Segment>
        ) : null}

        {note ? <p style={{ color: '#444' }}><strong>Note:</strong> {note}</p> : null}

        <Message info size="small" style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: 0, lineHeight: 1.45 }}>
            <strong>Reject</strong> sends a decline without your pubkey.{' '}
            <strong>Accept</strong> only if you agree with the terms above and trust the inviter’s peer connection.
          </p>
          {previewPk ? (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', lineHeight: 1.45 }}>
              Pubkey that would be shared:{' '}
              <code style={{ wordBreak: 'break-all' }}>{previewPk}</code>
              {!pkLooksValidator ? (
                <span style={{ color: '#a5673f' }}> — unlock a full identity if this is not a 33-byte hex key.</span>
              ) : null}
            </p>
          ) : (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', color: '#8a6d3b' }}>
              No wire pubkey available — open <Link to="/settings/security">Security</Link> and unlock before accepting.
            </p>
          )}
        </Message>
      </Modal.Content>
      <Modal.Actions>
        <Button onClick={() => sendResponse(false)} basic>
          Reject
        </Button>
        <Button onClick={() => sendResponse(true)} primary disabled={!pkLooksValidator}>
          Accept (send pubkey)
        </Button>
      </Modal.Actions>
    </Modal>
  );
}

module.exports = FederationContractInviteModal;
