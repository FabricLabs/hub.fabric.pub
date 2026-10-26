'use strict';

/**
 * Shown after first-time Hub HTTP setup while the user completes Fabric identity (keys).
 * Same copy is used from {@link FabricPostSetupIdentityWizard} and {@link IdentityManager}.
 */

const React = require('react');
const { Message, Icon } = require('semantic-ui-react');
const t = require('../../locales/en');

const copy = t.identity.adminTokenNotice;

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
      <Message.Header>{copy.title}</Message.Header>
      <Message.Content style={{ marginTop: '0.35em' }}>
        <p style={{ margin: 0, lineHeight: 1.55 }}>
          {copy.body}
        </p>
        <p style={{ margin: '0.65em 0 0', lineHeight: 1.55 }}>
          {copy.next}
        </p>
      </Message.Content>
    </Message>
  );
}

module.exports = FabricHubAdminTokenNotice;
