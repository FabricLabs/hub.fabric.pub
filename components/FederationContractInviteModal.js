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
const { fabricIdentityNeedFullKeyPlain } = require('../functions/hubIdentityUiHints');
const t = require('../locales/en');

const im = t.federation.inviteModal;

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} props.detail Incoming invite.
 * @param {function} props.onClose
 * @param {function} [props.onSendPeerMessage]
 * @param {function} [props.getResponderPubkey]
 * @param {object} [props.auth] Browser identity; when given, the no-key hint matches its state (Locked / Watch-only / none).
 */
function FederationContractInviteModal (props) {
  const open = !!(props && props.open);
  const detail = props && props.detail;
  const onClose = props && typeof props.onClose === 'function' ? props.onClose : () => {};
  const onSendPeerMessage = props && typeof props.onSendPeerMessage === 'function' ? props.onSendPeerMessage : null;
  const getResponderPubkey = props && typeof props.getResponderPubkey === 'function' ? props.getResponderPubkey : () => '';
  const auth = props && props.auth && typeof props.auth === 'object' ? props.auth : null;

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
        <Icon name="users" aria-hidden="true" />
        {im.title}
      </Header>
      <Modal.Content>
        <p style={{ marginTop: 0 }}>{im.intro}</p>
        {contractId ? (
          <p>
            {im.contract}{' '}<code style={{ wordBreak: 'break-all' }}>{contractId}</code>
            {' '}<Link to={`/contracts/${encodeURIComponent(contractId)}`}>{im.contractLink}</Link>
          </p>
        ) : null}

        {(spendingTerms || capLine) ? (
          <Segment secondary style={{ marginTop: '0.75rem' }}>
            <Header as="h4" style={{ marginTop: 0 }}>{im.spendingTitle}</Header>
            {capLine ? <p style={{ margin: '0.25em 0', fontWeight: 600 }}>{capLine}</p> : null}
            {spendingTerms ? (
              <p style={{ margin: '0.25em 0', color: '#555', fontSize: '0.9em' }}>
                {spendingTerms.mode === 'percent' ? im.limitPercent(spendingTerms.value) : im.limitSats(spendingTerms.value)}
              </p>
            ) : null}
          </Segment>
        ) : null}

        {termsSummary ? (
          <Segment style={{ marginTop: '0.75rem' }}>
            <Header as="h4" style={{ marginTop: 0 }}>{im.agreementTitle}</Header>
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
            <Header as="h4" style={{ marginTop: 0 }}>{im.signersTitle}</Header>
            <p style={{ margin: '0.25em 0 0.5em', color: '#555' }}>
              {im.threshold(proposedPolicy.threshold, proposedPolicy.validators.length)}
            </p>
            <List relaxed size="small" style={{ fontFamily: 'monospace', fontSize: '0.82em' }}>
              {proposedPolicy.validators.map((v, i) => (
                <List.Item key={i}>
                  <List.Content>
                    <List.Header>{im.signer(i + 1)}</List.Header>
                    <span style={{ wordBreak: 'break-all' }}>{v}</span>
                  </List.Content>
                </List.Item>
              ))}
            </List>
          </Segment>
        ) : null}

        {note ? <p style={{ color: '#444' }}><strong>{im.note}</strong> {note}</p> : null}

        <Message info size="small" style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: 0, lineHeight: 1.45 }}>{im.decision}</p>
          {previewPk ? (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', lineHeight: 1.45 }}>
              {im.sharedKey}{' '}
              <code style={{ wordBreak: 'break-all' }}>{previewPk}</code>
              {!pkLooksValidator ? (
                <span style={{ display: 'block', color: '#a5673f' }}>
                  {im.keyInvalid}{auth ? ` ${fabricIdentityNeedFullKeyPlain(auth)}` : ''}
                </span>
              ) : null}
            </p>
          ) : (
            <p style={{ margin: '0.65em 0 0', fontSize: '0.88em', color: '#8a6d3b' }}>
              {auth ? fabricIdentityNeedFullKeyPlain(auth) : im.noKey}{' '}
              <Link to="/settings/security">{im.securityLink}</Link>
            </p>
          )}
        </Message>
      </Modal.Content>
      <Modal.Actions>
        <Button onClick={() => sendResponse(false)} basic>
          {im.decline}
        </Button>
        <Button onClick={() => sendResponse(true)} primary disabled={!pkLooksValidator}>
          {im.accept}
        </Button>
      </Modal.Actions>
    </Modal>
  );
}

module.exports = FederationContractInviteModal;
