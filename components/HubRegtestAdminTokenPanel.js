'use strict';

const React = require('react');
const { Button, Form, Message } = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser, saveHubAdminTokenToBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const c = t.settings.adminToken;

/**
 * Regtest-only: paste Hub setup admin token so Make Payment / Pay Now can use the node wallet.
 * With `formOnly`, renders just the token form on any network (nothing once a token is saved),
 * for a parent that supplies its own banner (Admin).
 */
function HubRegtestAdminTokenPanel ({ network, adminTokenProp, formOnly, inputId }) {
  const isRegtest = String(network || '').toLowerCase() === 'regtest';
  const [draft, setDraft] = React.useState('');
  if (!isRegtest && !formOnly) return null;
  const has = !!readHubAdminTokenFromBrowser(adminTokenProp);
  if (has) {
    if (formOnly) return null;
    return (
      <Message positive size="small" style={{ marginBottom: '1em' }} id="fabric-hub-admin-token-ok">
        {c.present}
      </Message>
    );
  }
  const form = (
    <Form
      style={{ marginTop: '0.75em', maxWidth: '28rem' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (saveHubAdminTokenToBrowser(draft)) setDraft('');
      }}
    >
      <Form.Input
        id={inputId || 'hub-admin-token-input'}
        type="password"
        label={c.label}
        value={draft}
        onChange={(e, { value }) => setDraft(value != null ? String(value) : (e && e.target && e.target.value) || '')}
        onInput={(e) => {
          const v = e && e.target && e.target.value != null ? String(e.target.value) : '';
          if (v !== draft) setDraft(v);
        }}
        autoComplete="off"
      />
      <Button type="submit" size="small" primary disabled={!String(draft).trim()}>
        {c.save}
      </Button>
    </Form>
  );
  if (formOnly) return form;
  return (
    <Message warning size="small" style={{ marginBottom: '1em' }} id="fabric-hub-admin-token-missing">
      <Message.Header>{c.title}</Message.Header>
      <p style={{ margin: '0.35em 0 0', color: '#333' }}>{c.body}</p>
      {form}
    </Message>
  );
}

module.exports = HubRegtestAdminTokenPanel;
