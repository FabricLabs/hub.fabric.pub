'use strict';

const React = require('react');
const { Button, Icon, Message } = require('semantic-ui-react');
const { formatFederationInviteSpendingSummary } = require('../functions/federationContractInvite');

/**
 * In-app notice for incoming federation invites (review before opening security modal).
 * @param {{ detail: object|null, onReview: function, onDismiss: function }} props
 */
function FederationInviteNotificationBanner (props) {
  const detail = props && props.detail;
  const onReview = props && typeof props.onReview === 'function' ? props.onReview : () => {};
  const onDismiss = props && typeof props.onDismiss === 'function' ? props.onDismiss : () => {};
  if (!detail || !detail.inviteId) return null;

  const cap = formatFederationInviteSpendingSummary(detail);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: '0 -1em 0.65rem -1em',
        padding: '0 0.5rem'
      }}
    >
      <Message
        warning
        style={{
          margin: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.65rem'
        }}
      >
        <div style={{ flex: '1 1 12rem', lineHeight: 1.45, fontSize: '0.93rem' }}>
          <strong>Federation co-signer invite</strong>
          {' — '}
          review terms before you accept (your compressed pubkey is only sent if you approve).
          {cap ? (
            <span style={{ display: 'block', marginTop: '0.35em', color: '#555' }}>{cap}</span>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          <Button type="button" primary size="small" onClick={() => onReview()}>
            <Icon name="eye" />
            Review &amp; sign
          </Button>
          <Button type="button" basic size="small" onClick={() => onDismiss()}>
            Dismiss
          </Button>
        </div>
      </Message>
    </div>
  );
}

module.exports = FederationInviteNotificationBanner;
