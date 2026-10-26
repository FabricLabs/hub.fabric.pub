'use strict';

const React = require('react');
const { Button, Header, Icon, List, Message, Segment } = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const t = require('../locales/en');

const c = t.settings.trackedContracts;

async function rpc (method, params = {}) {
  const res = await fetch('/services/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: [params] })
  });
  const json = await res.json();
  if (json && json.error) {
    throw new Error(json.error.message || String(json.error));
  }
  return json && json.result != null ? json.result : json;
}

/**
 * Operator UI: pending CONTRACT_PUBLISH offers → Accept into Beacon-tracked set.
 * @param {object} [props]
 * @param {boolean} [props.embedded] When true, omit outer Segment (parent already wraps).
 */
function TrackedApplicationContractsPanel (props = {}) {
  const embedded = !!(props && props.embedded);
  const [summary, setSummary] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busyId, setBusyId] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(() => {
    setLoading(true);
    return rpc('ListTrackedApplicationContracts', {})
      .then((r) => {
        setSummary(r);
        setError(null);
      })
      .catch((e) => {
        setError(t.common.errors.withReason(c.loadFailed, e && e.message ? e.message : String(e)));
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    refresh();
    const onEvt = () => { refresh(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('fabric:trackedApplicationContract', onEvt);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('fabric:trackedApplicationContract', onEvt);
      }
    };
  }, [refresh]);

  const act = async (method, contractId) => {
    const adminToken = readHubAdminTokenFromBrowser();
    if (!adminToken) {
      setError(t.common.errors.adminTokenRequired);
      return;
    }
    setBusyId(contractId);
    try {
      const r = await rpc(method, { contractId, adminToken });
      if (r && r.status === 'error') throw new Error(r.message || c.actionFailed);
      setSummary(r.summary || null);
      await refresh();
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const pending = (summary && Array.isArray(summary.pending)) ? summary.pending : [];
  const accepted = (summary && Array.isArray(summary.accepted)) ? summary.accepted : [];
  const stateRoot = summary && summary.stateRoot ? String(summary.stateRoot) : null;

  const body = (
    <>
      <Header as={embedded ? 'h4' : 'h3'}>
        <Icon name="file code outline" aria-hidden="true" />
        <Header.Content>{embedded ? c.titleEmbedded : c.title}</Header.Content>
      </Header>
      {!embedded ? (
        <>
          <p style={{ color: '#555', lineHeight: 1.5, marginBottom: '0.5em' }}>{c.intro}</p>
          <details className="hub-developer-details" style={{ marginBottom: '0.75em' }}>
            <summary>{t.common.developerDetails}</summary>
            <p style={{ color: '#555', margin: '0.35em 0 0' }}>{c.developer}</p>
          </details>
        </>
      ) : null}
      {loading && <Message info size="small">{c.loading}</Message>}
      {error && <Message negative size="small" onDismiss={() => setError(null)}>{error}</Message>}
      {stateRoot && (
        <Message size="small" style={{ wordBreak: 'break-all' }}>
          <Message.Header>{c.stateRoot}</Message.Header>
          <code>{stateRoot}</code>
        </Message>
      )}

      <Header as="h4">{c.pending(pending.length)}</Header>
      {pending.length === 0 ? (
        <p style={{ color: '#777' }}>{c.pendingEmpty}</p>
      ) : (
        <List divided relaxed>
          {pending.map((row) => (
            <List.Item key={row.contractId}>
              <List.Content floated="right">
                <Button
                  size="mini"
                  primary
                  disabled={busyId === row.contractId}
                  onClick={() => act('AcceptTrackedApplicationContract', row.contractId)}
                >
                  {c.accept}
                </Button>
                <Button
                  size="mini"
                  basic
                  disabled={busyId === row.contractId}
                  onClick={() => act('RejectTrackedApplicationContract', row.contractId)}
                  style={{ marginLeft: '0.35em' }}
                >
                  {c.reject}
                </Button>
              </List.Content>
              <List.Content>
                <List.Header>{row.name || c.unnamed}</List.Header>
                <List.Description style={{ wordBreak: 'break-all' }}>
                  <code>{row.contractId}</code>
                  {row.version != null ? ` · ${c.version(row.version)}` : ''}
                  {row.receivedAt ? ` · ${row.receivedAt}` : ''}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      )}

      <Header as="h4" style={{ marginTop: '1em' }}>{c.accepted(accepted.length)}</Header>
      {accepted.length === 0 ? (
        <p style={{ color: '#777' }}>{c.acceptedEmpty}</p>
      ) : (
        <List divided relaxed>
          {accepted.map((row) => (
            <List.Item key={row.contractId}>
              <List.Content floated="right">
                <Button
                  size="mini"
                  basic
                  negative
                  disabled={busyId === row.contractId}
                  onClick={() => act('RejectTrackedApplicationContract', row.contractId)}
                >
                  {c.untrack}
                </Button>
              </List.Content>
              <List.Content>
                <List.Header>{row.name || c.unnamed}</List.Header>
                <List.Description style={{ wordBreak: 'break-all' }}>
                  <code>{row.contractId}</code>
                  {row.stateDigest ? (
                    <>
                      <br />
                      {c.stateDigest}: <code>{row.stateDigest}</code>
                    </>
                  ) : null}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      )}
      <Button size="small" basic onClick={refresh} style={{ marginTop: '0.5em' }}>
        {t.common.actions.refresh}
      </Button>
    </>
  );

  if (embedded) return <div className="fabric-tracked-application-contracts">{body}</div>;
  return (
    <Segment>
      {body}
    </Segment>
  );
}

module.exports = TrackedApplicationContractsPanel;
