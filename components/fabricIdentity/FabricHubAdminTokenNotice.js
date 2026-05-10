'use strict';

/**
 * Shown after first-time Hub HTTP setup while the user completes Fabric identity (keys).
 * Same copy is used from {@link FabricPostSetupIdentityWizard} and {@link IdentityManager}.
 */

const React = require('react');
const { Message, Icon } = require('semantic-ui-react');

/**
 * @param {{ compact?: boolean }} props
 */
function FabricHubAdminTokenNotice (props) {
  const compact = !!(props && props.compact);
  return (
    <Message
      positive={!compact}
      info={compact}
      size="small"
      style={{ marginBottom: compact ? '0.85em' : '1em' }}
    >
      <Icon name="check circle" aria-hidden="true" />
      <Message.Header>Hub admin token saved</Message.Header>
      <Message.Content style={{ marginTop: '0.35em' }}>
        <p style={{ margin: 0, lineHeight: 1.55 }}>
          First-time operator setup stored an <strong>admin token</strong> in this browser (local storage).
          It authenticates hub-only actions such as regtest block generation and some settings changes — it is{' '}
          <strong>not</strong> your Fabric signing identity.
        </p>
        <p style={{ margin: '0.65em 0 0', lineHeight: 1.55 }}>
          Continue below to <strong>generate or restore</strong> your Fabric keys (wallet, documents, signing).
        </p>
      </Message.Content>
    </Message>
  );
}

module.exports = FabricHubAdminTokenNotice;
