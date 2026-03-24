'use strict';

const React = require('react');
const { Button, Form, Message } = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser, saveHubAdminTokenToBrowser } = require('../functions/hubAdminTokenBrowser');

/**
 * Regtest-only: paste Hub setup admin token so Make Payment / Pay Now can use the node wallet.
 */
function HubRegtestAdminTokenPanel ({ network, adminTokenProp }) {
  const isRegtest = String(network || '').toLowerCase() === 'regtest';
  const [draft, setDraft] = React.useState('');
  if (!isRegtest) return null;
  const has = !!readHubAdminTokenFromBrowser(adminTokenProp);
  if (has) {
    return (
      <Message positive size="small" style={{ marginBottom: '1em' }} id="fabric-hub-admin-token-ok">
        Hub <strong>admin token</strong> is set in this browser (needed for Hub-wallet sends and invoice <strong>Pay Now</strong>).
      </Message>
    );
  }
  return (
    <Message warning size="small" style={{ marginBottom: '1em' }} id="fabric-hub-admin-token-missing">
      <Message.Header>Regtest: Hub admin token</Message.Header>
      <p style={{ margin: '0.35em 0 0', color: '#333' }}>
        Paste the token from first-time setup so this tab can broadcast from the Hub <code>bitcoind</code> wallet (Make Payment, Pay Now). Stored only in <code>localStorage</code> for this origin.
      </p>
      <Form
        style={{ marginTop: '0.75em', maxWidth: '28rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (saveHubAdminTokenToBrowser(draft)) setDraft('');
        }}
      >
        <Form.Input
          type="password"
          label="Setup admin token"
          value={draft}
          onChange={(e, { value }) => setDraft(value != null ? String(value) : (e && e.target && e.target.value) || '')}
          onInput={(e) => {
            const v = e && e.target && e.target.value != null ? String(e.target.value) : '';
            if (v !== draft) setDraft(v);
          }}
          placeholder="Token from initial POST /settings (or refresh)"
          autoComplete="off"
        />
        <Button type="submit" size="small" primary disabled={!String(draft).trim()}>
          Save in this browser
        </Button>
      </Form>
    </Message>
  );
}

module.exports = HubRegtestAdminTokenPanel;
