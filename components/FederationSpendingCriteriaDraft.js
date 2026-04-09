'use strict';

const React = require('react');
const { Checkbox, Form, Button, Icon, Message } = require('semantic-ui-react');
const {
  loadFederationSpendingPrefs,
  saveFederationSpendingPrefs,
  subscribeFederationSpendingPrefs
} = require('../functions/federationSpendingPrefs');

/**
 * Optional human-readable spending rules draft (this browser only).
 * @param {{ compact?: boolean }} props
 */
function FederationSpendingCriteriaDraft (props) {
  const compact = !!(props && props.compact);
  const [prefs, setPrefs] = React.useState(() => loadFederationSpendingPrefs());
  const [draft, setDraft] = React.useState(() => loadFederationSpendingPrefs().spendingCriteriaDraft);
  const [open, setOpen] = React.useState(() => {
    const p = loadFederationSpendingPrefs();
    return !!p.draftingUiOpen || String(p.spendingCriteriaDraft || '').trim().length > 0;
  });

  React.useEffect(() => {
    return subscribeFederationSpendingPrefs(() => {
      const p = loadFederationSpendingPrefs();
      setPrefs(p);
      setDraft(p.spendingCriteriaDraft);
      if (p.draftingUiOpen) setOpen(true);
    });
  }, []);

  const persistOpen = (nextOpen) => {
    setOpen(nextOpen);
    const p = saveFederationSpendingPrefs({ draftingUiOpen: nextOpen });
    setPrefs(p);
  };

  const saveDraft = () => {
    const p = saveFederationSpendingPrefs({ spendingCriteriaDraft: draft });
    setPrefs(p);
  };

  const clearDraft = () => {
    setDraft('');
    const p = saveFederationSpendingPrefs({ spendingCriteriaDraft: '' });
    setPrefs(p);
  };

  return (
    <div style={compact ? { marginTop: '0.5em' } : { marginTop: '1rem' }}>
      <Checkbox
        toggle={!compact}
        checked={open}
        onChange={(_, d) => persistOpen(!!(d && d.checked))}
        label={
          compact
            ? 'Show spending criteria draft (saved in this browser)'
            : 'Write an optional spending criteria draft (saved in this browser only)'
        }
      />
      {open ? (
        <div style={{ marginTop: '0.75em' }}>
          <Message info size="small" style={{ marginBottom: '0.75em' }}>
            <p style={{ margin: 0, lineHeight: 1.45 }}>
              This text is <strong>not</strong> enforced by the hub. It is copied into payment memos when you choose
              “Record as federation-related payment” on wallet screens, so your group sees the same intent in logs.
            </p>
          </Message>
          <Form>
            <Form.TextArea
              label="Spending criteria (plain language)"
              placeholder={
                'Examples: “Any spend over 0.01 BTC needs 2 approvals within 48h.”\n' +
                '“Treasury pays only from the federation vault PSBT flow.”\n' +
                '“Emergency key held by ops@…”'
              }
              rows={compact ? 4 : 6}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ fontFamily: 'inherit', lineHeight: 1.45 }}
            />
            <Button type="button" size="small" primary icon labelPosition="left" onClick={saveDraft}>
              <Icon name="save" />
              Save draft
            </Button>
            <Button type="button" size="small" basic onClick={clearDraft} disabled={!String(draft || '').trim() && !String(prefs.spendingCriteriaDraft || '').trim()}>
              Clear
            </Button>
          </Form>
        </div>
      ) : null}
    </div>
  );
}

module.exports = FederationSpendingCriteriaDraft;
