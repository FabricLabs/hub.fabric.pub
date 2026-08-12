'use strict';

const React = require('react');
const { Button, Header, Icon, List, Message, Segment } = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

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
 */
function TrackedApplicationContractsPanel () {
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
        setError(e && e.message ? e.message : String(e));
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
      setError('Admin token required (paste under Admin) to accept or reject.');
      return;
    }
    setBusyId(contractId);
    try {
      const r = await rpc(method, { contractId, adminToken });
      if (r && r.status === 'error') throw new Error(r.message || 'request failed');
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

  return (
    <Segment>
      <Header as="h3">
        <Icon name="file code outline" aria-hidden="true" />
        <Header.Content>Tracked application contracts</Header.Content>
      </Header>
      <p style={{ color: '#555', lineHeight: 1.5, marginBottom: '0.75em' }}>
        Inbound <code>CONTRACT_PUBLISH</code> frames (application namespaces) land here as pending offers.
        Accepting one adds it to the local Beacon-tracked set; the next epoch seals{' '}
        <code>payload.contracts.stateDigest</code> (the state root of accepted published contracts).
      </p>
      {loading && <Message info size="small">Loading…</Message>}
      {error && <Message negative size="small" onDismiss={() => setError(null)}>{error}</Message>}
      {stateRoot && (
        <Message size="small" style={{ wordBreak: 'break-all' }}>
          <Message.Header>Contracts state root</Message.Header>
          <code>{stateRoot}</code>
        </Message>
      )}

      <Header as="h4">Pending publishes ({pending.length})</Header>
      {pending.length === 0 ? (
        <p style={{ color: '#777' }}>No pending CONTRACT_PUBLISH offers.</p>
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
                  Accept
                </Button>
                <Button
                  size="mini"
                  basic
                  disabled={busyId === row.contractId}
                  onClick={() => act('RejectTrackedApplicationContract', row.contractId)}
                  style={{ marginLeft: '0.35em' }}
                >
                  Reject
                </Button>
              </List.Content>
              <List.Content>
                <List.Header>{row.name || 'Unnamed contract'}</List.Header>
                <List.Description style={{ wordBreak: 'break-all' }}>
                  <code>{row.contractId}</code>
                  {row.version != null ? ` · v${row.version}` : ''}
                  {row.receivedAt ? ` · ${row.receivedAt}` : ''}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      )}

      <Header as="h4" style={{ marginTop: '1em' }}>Accepted ({accepted.length})</Header>
      {accepted.length === 0 ? (
        <p style={{ color: '#777' }}>None accepted yet — Beacon contracts root is empty.</p>
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
                  Untrack
                </Button>
              </List.Content>
              <List.Content>
                <List.Header>{row.name || 'Unnamed contract'}</List.Header>
                <List.Description style={{ wordBreak: 'break-all' }}>
                  <code>{row.contractId}</code>
                  {row.stateDigest ? (
                    <>
                      <br />
                      stateDigest: <code>{row.stateDigest}</code>
                    </>
                  ) : null}
                </List.Description>
              </List.Content>
            </List.Item>
          ))}
        </List>
      )}
      <Button size="small" basic onClick={refresh} style={{ marginTop: '0.5em' }}>
        Refresh
      </Button>
    </Segment>
  );
}

module.exports = TrackedApplicationContractsPanel;
