'use strict';

const React = require('react');
const { Checkbox, Form, Button, Icon, Message } = require('semantic-ui-react');
const {
  loadFederationSpendingPrefs,
  saveFederationSpendingPrefs,
  subscribeFederationSpendingPrefs
} = require('../functions/federationSpendingPrefs');
const t = require('../locales/en');

/**
 * Optional human-readable spending rules draft (this browser only).
 * @param {{ compact?: boolean }} props
 */
function FederationSpendingCriteriaDraft (props) {
  const compact = !!(props && props.compact);
  const sc = t.federation.spendingCriteria;
  const fieldId = compact ? 'federation-spending-criteria-compact' : 'federation-spending-criteria';
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
        id={`${fieldId}-toggle`}
        toggle={!compact}
        checked={open}
        onChange={(_, d) => persistOpen(!!(d && d.checked))}
        label={compact ? sc.toggleCompact : sc.toggle}
      />
      {open ? (
        <div style={{ marginTop: '0.75em' }}>
          <Message info size="small" style={{ marginBottom: '0.75em' }}>
            <p style={{ margin: 0, lineHeight: 1.45 }}>{sc.info}</p>
          </Message>
          <Form>
            <Form.TextArea
              id={fieldId}
              label={sc.label}
              placeholder={sc.placeholder}
              rows={compact ? 4 : 6}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ fontFamily: 'inherit', lineHeight: 1.45 }}
            />
            <Button type="button" size="small" primary icon labelPosition="left" onClick={saveDraft}>
              <Icon name="save" aria-hidden="true" />
              {sc.save}
            </Button>
            <Button type="button" size="small" basic onClick={clearDraft} disabled={!String(draft || '').trim() && !String(prefs.spendingCriteriaDraft || '').trim()}>
              {sc.clear}
            </Button>
          </Form>
        </div>
      ) : null}
    </div>
  );
}

module.exports = FederationSpendingCriteriaDraft;
