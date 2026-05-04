'use strict';

/**
 * Second onboarding step shown after `/settings`-based operator bootstrap when Hub has no Fabric identity yet.
 */

const React = require('react');
const {
  Button,
  Header,
  Icon,
  Message,
  Segment
} = require('semantic-ui-react');

const IdentityManager = require('../IdentityManager');
const {
  hasCompletedPostSetupBrowserIdentity
} = require('../../functions/fabricPostSetupBrowserIdentity');

/**
 * Full-viewport wizard that drives {@link IdentityManager} toward Generate / Existing key only.
 *
 * Parent should stop rendering this once a browser-generated/imported identity exists (not desktop-only handoff)
 * or the user skips.
 */
/**
 * @param {function():void} [props.onForgetIdentity]
 */
function FabricPostSetupIdentityWizard (props) {
  const {
    hubAdminToken,
    currentIdentity,
    onLocalIdentityChange,
    onUnlockSuccess,
    onLockStateChange,
    onForgetIdentity,
    onComplete,
    onSkip
  } = props;

  const [skipped, setSkipped] = React.useState(false);

  React.useEffect(() => {
    if (skipped) return;
    if (hasCompletedPostSetupBrowserIdentity() && typeof onComplete === 'function') {
      onComplete();
    }
  }, [skipped, onComplete]);

  if (skipped) return null;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: 'center',
        padding: '1.5em',
        boxSizing: 'border-box',
        background: 'linear-gradient(180deg, #f7f9fc 0%, #fff 40%)'
      }}
    >
      <Segment style={{ maxWidth: '44rem', width: '100%' }} raised>
        <Header as="h2" style={{ marginBottom: '0.35em' }}>
          <Icon name="user secret" />
          Create your Fabric identity
        </Header>
        <Message info size="small" style={{ marginBottom: '1.1em' }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Use <strong>Generate</strong> or <strong>restore</strong> below to finish. You can skip and open the identity
            menu from the top bar anytime.
          </p>
        </Message>
        <IdentityManager
          hubAdminToken={hubAdminToken}
          currentIdentity={currentIdentity || null}
          initialLoginMethod="generate"
          postSetupFlow
          suppressForgetAndLinkedChrome
          onLocalIdentityChange={(info) => {
            if (typeof onLocalIdentityChange === 'function') onLocalIdentityChange(info);
            if (info && (info.id || info.xpub) && hasCompletedPostSetupBrowserIdentity() && typeof onComplete === 'function') {
              onComplete();
            }
          }}
          onUnlockSuccess={(info) => {
            if (typeof onUnlockSuccess === 'function') onUnlockSuccess(info);
            if (info && (info.id || info.xpub) && hasCompletedPostSetupBrowserIdentity() && typeof onComplete === 'function') {
              onComplete();
            }
          }}
          onLockStateChange={onLockStateChange}
          onForgetIdentity={typeof onForgetIdentity === 'function' ? onForgetIdentity : undefined}
        />
        <div style={{ marginTop: '1.25em', textAlign: 'center' }}>
          <Button
            basic
            type="button"
            onClick={() => {
              setSkipped(true);
              try {
                if (typeof window !== 'undefined' && window.sessionStorage) {
                  window.sessionStorage.setItem('fabric.hub.identityWizardDismissed', '1');
                  window.sessionStorage.removeItem('fabric.hub.wantIdentityWizard');
                }
              } catch (e) {}
              if (typeof onSkip === 'function') onSkip();
            }}
          >
            Skip for now — I will add an identity later
          </Button>
        </div>
      </Segment>
    </div>
  );
}

module.exports = FabricPostSetupIdentityWizard;
