'use strict';

const React = require('react');
const { useParams, Link } = require('react-router-dom');
const { Segment, Header, Icon, Button, Loader, Table, Label, Message, Step } = require('semantic-ui-react');
const { formatSatsDisplay } = require('../functions/formatSats');
const { loadUpstreamSettings, fetchTransactionByHash } = require('../functions/bitcoinClient');
const { runExecutionProgram } = require('../functions/fabricExecutionMachine');
const { computeExecutionRunCommitmentHex } = require('../functions/executionRunCommitment');

function ContractView (props) {
  const params = useParams();
  const id = params && params.id ? params.id : '';

  const [contract, setContract] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [payTxMeta, setPayTxMeta] = React.useState(null);
  const [localRun, setLocalRun] = React.useState(null);
  const [hubRun, setHubRun] = React.useState(null);
  const [hubRunLoading, setHubRunLoading] = React.useState(false);
  const [hubRunError, setHubRunError] = React.useState(null);
  const [bitcoinNet, setBitcoinNet] = React.useState({ loading: true, regtest: false, available: false });
  const [anchorLoading, setAnchorLoading] = React.useState(false);
  const [anchorError, setAnchorError] = React.useState(null);
  const [anchorTxid, setAnchorTxid] = React.useState(null);

  const adminToken = props && props.adminToken ? String(props.adminToken) : '';

  React.useEffect(() => {
    let cancelled = false;
    fetch('/services/bitcoin', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().catch(() => ({})))
      .then((body) => {
        if (cancelled) return;
        const net = body && (body.network || body.chain);
        const available = !!(body && body.available !== false && body.status !== 'error');
        setBitcoinNet({
          loading: false,
          available,
          regtest: String(net || '').toLowerCase() === 'regtest'
        });
      })
      .catch(() => {
        if (!cancelled) setBitcoinNet({ loading: false, available: false, regtest: false });
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/contracts/${encodeURIComponent(id)}`, { method: 'GET' });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body || body.status === 'error') {
          setError((body && body.message) || 'Failed to load contract.');
          setContract(null);
          return;
        }
        const c = body.contract || body.result || body;
        setContract(c || null);
      } catch (e) {
        if (cancelled) return;
        setError(e && e.message ? e.message : 'Failed to load contract.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  React.useEffect(() => {
    const txid = contract && contract.txid ? String(contract.txid).trim() : '';
    if (!txid) {
      setPayTxMeta(null);
      return;
    }
    let cancelled = false;
    setPayTxMeta({ loading: true });
    const upstream = loadUpstreamSettings();
    fetchTransactionByHash(upstream, txid)
      .then((data) => {
        if (cancelled) return;
        if (data && data.status === 'error') {
          setPayTxMeta({ loading: false, error: data.message || 'Could not load transaction.' });
          return;
        }
        setPayTxMeta({ loading: false, tx: data });
      })
      .catch((e) => {
        if (!cancelled) setPayTxMeta({ loading: false, error: e && e.message ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [contract && contract.txid]);

  const created = contract && contract.created ? new Date(contract.created).toLocaleString() : '';
  const isExecution = !!(contract && contract.type === 'ExecutionContract');

  const runLocalExecution = React.useCallback(() => {
    if (!contract || !contract.program) return;
    setLocalRun(runExecutionProgram(contract.program));
  }, [contract]);

  const runHubExecution = React.useCallback(async () => {
    if (!id) return;
    setHubRunLoading(true);
    setHubRunError(null);
    setHubRun(null);
    try {
      const res = await fetch('/services/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ method: 'RunExecutionContract', params: [{ contractId: id }] })
      });
      const body = await res.json();
      if (body && body.error) {
        setHubRunError(body.error.message || 'RPC error');
        return;
      }
      const result = body && body.result ? body.result : null;
      if (result && result.status === 'error') {
        setHubRunError(result.message || 'Run failed');
        return;
      }
      setHubRun(result);
      setAnchorTxid(null);
      setAnchorError(null);
      if (result && result.fabricMessageWireHex && typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('fabric:delegationSignRequest', {
            detail: {
              wireHex: result.fabricMessageWireHex,
              delegationSignRequest: result.delegationSignRequest || null,
              source: 'RunExecutionContract'
            }
          }));
        } catch (_) {}
      }
    } catch (e) {
      setHubRunError(e && e.message ? e.message : String(e));
    } finally {
      setHubRunLoading(false);
    }
  }, [id]);

  const anchorCommitment = React.useCallback(async () => {
    if (!hubRun || !hubRun.runCommitmentHex || !adminToken) return;
    setAnchorLoading(true);
    setAnchorError(null);
    setAnchorTxid(null);
    try {
      const res = await fetch('/services/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          method: 'AnchorExecutionRunCommitment',
          params: [{ commitmentHex: hubRun.runCommitmentHex, adminToken }],
          jsonrpc: '2.0',
          id: 1
        })
      });
      const body = await res.json();
      if (body && body.error) {
        setAnchorError(body.error.message || 'RPC error');
        return;
      }
      const out = body && body.result;
      if (out && out.status === 'error') {
        setAnchorError(out.message || 'Anchor failed');
        return;
      }
      if (out && out.txid) setAnchorTxid(String(out.txid));
      else setAnchorError('No txid in response');
    } catch (e) {
      setAnchorError(e && e.message ? e.message : String(e));
    } finally {
      setAnchorLoading(false);
    }
  }, [hubRun, adminToken]);

  const localCommitmentHex = React.useMemo(() => {
    if (!localRun || !id) return null;
    try {
      return computeExecutionRunCommitmentHex(id, localRun);
    } catch (_) {
      return null;
    }
  }, [localRun, id]);

  return (
    <fabric-contract-detail class='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button basic size='small' as={Link} to="/contracts" title="Back to contracts">
            <Icon name="arrow left" />
            Back
          </Button>
          <span>Contract</span>
          {contract && !isExecution && (
            <Label size="small" color="purple">
              <Icon name="cloud" />
              Storage
            </Label>
          )}
          {contract && isExecution && (
            <Label size="small" color="teal">
              <Icon name="code" />
              Execution
            </Label>
          )}
        </Header>

        <Segment>
          {loading && (
            <div style={{ minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader active inline="centered" />
            </div>
          )}
          {!loading && error && (
            <div style={{ color: '#b00' }}>{error}</div>
          )}
          {!loading && !error && contract && isExecution && (
            <React.Fragment>
              <Header as="h3">Execution program</Header>
              <p style={{ color: '#666' }}>
                Run the same sandboxed interpreter the hub uses to validate this contract. “Run on hub” calls <code>RunExecutionContract</code> over HTTP JSON-RPC.
                The hub returns a <strong>run commitment</strong> (SHA-256 of the canonical trace) so local and server runs can be compared; on regtest, an admin can anchor that digest in an OP_RETURN (funded wallet required).
              </p>
              <div style={{ marginBottom: '1em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
                <Button type="button" primary onClick={runLocalExecution}>
                  <Icon name="play" />
                  Run locally
                </Button>
                <Button type="button" basic loading={hubRunLoading} disabled={hubRunLoading} onClick={runHubExecution}>
                  <Icon name="server" />
                  Run on hub
                </Button>
              </div>
              {hubRunError && (
                <Message negative content={hubRunError} style={{ marginBottom: '1em' }} />
              )}
              {localRun && (
                <Message
                  positive={localRun.ok}
                  negative={!localRun.ok}
                  header={localRun.ok ? 'Local run finished' : 'Local run failed'}
                  content={
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', margin: 0 }}>
                      {JSON.stringify(localRun, null, 2)}
                    </pre>
                  }
                  style={{ marginBottom: '1em' }}
                />
              )}
              {hubRun && hubRun.runCommitmentHex && (
                <Message info style={{ marginBottom: '1em' }}>
                  <Message.Header>Run commitment (digest)</Message.Header>
                  <p style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.85em', marginTop: '0.5em' }}>
                    {hubRun.runCommitmentHex}
                  </p>
                  {localCommitmentHex && (
                    <p style={{ marginTop: '0.75em', color: localCommitmentHex === hubRun.runCommitmentHex ? '#276749' : '#b00' }}>
                      {localCommitmentHex === hubRun.runCommitmentHex
                        ? 'Matches local run commitment.'
                        : 'Local run commitment differs — re-run locally after loading the same program.'}
                    </p>
                  )}
                  {bitcoinNet.regtest && bitcoinNet.available && adminToken && hubRun.ok && (
                    <div style={{ marginTop: '1em' }}>
                      <Button
                        type="button"
                        color="orange"
                        loading={anchorLoading}
                        disabled={anchorLoading}
                        onClick={anchorCommitment}
                      >
                        <Icon name="bitcoin" />
                        Anchor commitment on regtest (OP_RETURN)
                      </Button>
                      <span style={{ marginLeft: '0.75em', color: '#888', fontSize: '0.85em' }}>
                        Uses admin token + Hub wallet (mine a block first if needed).
                      </span>
                    </div>
                  )}
                  {anchorError && (
                    <p style={{ color: '#b00', marginTop: '0.75em' }}>{anchorError}</p>
                  )}
                  {anchorTxid && (
                    <p style={{ marginTop: '0.75em' }}>
                      <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(anchorTxid)}`}>
                        <Icon name="external" />
                        View anchor tx {anchorTxid.slice(0, 18)}…
                      </Button>
                    </p>
                  )}
                </Message>
              )}
              {hubRun && Array.isArray(hubRun.trace) && hubRun.trace.length > 0 && !hubRun.trace.some((t) => t && t.truncated) && (
                <Segment style={{ marginBottom: '1em' }}>
                  <Header as="h4">Execution trace (hub)</Header>
                  <Step.Group ordered fluid size="small">
                    {hubRun.trace.map((t, i) => (
                      <Step key={i} completed={hubRun.ok}>
                        <Step.Content>
                          <Step.Title>Step {t.pc != null ? t.pc + 1 : i + 1}{t.op ? ` · ${t.op}` : ''}</Step.Title>
                          <Step.Description>
                            <code style={{ fontSize: '0.75em', wordBreak: 'break-all' }}>{JSON.stringify(t)}</code>
                          </Step.Description>
                        </Step.Content>
                      </Step>
                    ))}
                  </Step.Group>
                </Segment>
              )}
              {hubRun && (
                <Message
                  positive={hubRun.ok}
                  negative={!hubRun.ok}
                  header="Hub run result (raw JSON)"
                  content={
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', margin: 0 }}>
                      {JSON.stringify(hubRun, null, 2)}
                    </pre>
                  }
                  style={{ marginBottom: '1em' }}
                />
              )}
              <Table definition>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell width={3}>ID</Table.Cell>
                    <Table.Cell><code>{contract.id}</code></Table.Cell>
                  </Table.Row>
                  {contract.name && (
                    <Table.Row>
                      <Table.Cell>Name</Table.Cell>
                      <Table.Cell>{contract.name}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.validatedSteps != null && (
                    <Table.Row>
                      <Table.Cell>Validated steps</Table.Cell>
                      <Table.Cell>{contract.validatedSteps}</Table.Cell>
                    </Table.Row>
                  )}
                  {created && (
                    <Table.Row>
                      <Table.Cell>Created</Table.Cell>
                      <Table.Cell>{created}</Table.Cell>
                    </Table.Row>
                  )}
                  <Table.Row>
                    <Table.Cell>Program</Table.Cell>
                    <Table.Cell>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', margin: 0 }}>
                        {JSON.stringify(contract.program, null, 2)}
                      </pre>
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
            </React.Fragment>
          )}
          {!loading && !error && contract && !isExecution && (
            <React.Fragment>
              <Header as="h3">Details</Header>
              <Table definition>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell width={3}>ID</Table.Cell>
                    <Table.Cell><code>{contract.id}</code></Table.Cell>
                  </Table.Row>
                  {contract.document && (
                    <Table.Row>
                      <Table.Cell>Document</Table.Cell>
                      <Table.Cell>
                        <code>{contract.document}</code>
                        <Button size="mini" as={Link} to={`/documents/${encodeURIComponent(contract.document)}`} style={{ marginLeft: '0.5em' }}>
                          <Icon name="file alternate" />
                          View
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {contract.txid && (
                    <Table.Row>
                      <Table.Cell>Payment tx</Table.Cell>
                      <Table.Cell>
                        <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(contract.txid)}`}>
                          <Icon name="bitcoin" />
                          {String(contract.txid).slice(0, 16)}…
                        </Button>
                        {payTxMeta && payTxMeta.loading && (
                          <Label size="small" style={{ marginLeft: '0.5em' }} basic>
                            Loading…
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.tx && (payTxMeta.tx.blockhash == null || payTxMeta.tx.blockhash === '') && (
                          <Label color="orange" size="small" style={{ marginLeft: '0.5em' }}>
                            <Icon name="clock" />
                            Mempool (unconfirmed)
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.tx && payTxMeta.tx.confirmations != null && Number(payTxMeta.tx.confirmations) > 0 && (
                          <Label color="green" size="small" style={{ marginLeft: '0.5em' }}>
                            {payTxMeta.tx.confirmations} confirmation{Number(payTxMeta.tx.confirmations) === 1 ? '' : 's'}
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.error && !payTxMeta.loading && (
                          <Label size="small" color="grey" style={{ marginLeft: '0.5em' }} title={payTxMeta.error}>
                            Tx status n/a
                          </Label>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {contract.amountSats != null && (
                    <Table.Row>
                      <Table.Cell>Amount</Table.Cell>
                      <Table.Cell>{formatSatsDisplay(contract.amountSats)} sats</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.desiredCopies != null && contract.desiredCopies > 1 && (
                    <Table.Row>
                      <Table.Cell>Desired copies</Table.Cell>
                      <Table.Cell>{contract.desiredCopies}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.durationYears != null && (
                    <Table.Row>
                      <Table.Cell>Duration</Table.Cell>
                      <Table.Cell>{contract.durationYears} years</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.challengeCadence && (
                    <Table.Row>
                      <Table.Cell>Challenge cadence</Table.Cell>
                      <Table.Cell>{contract.challengeCadence}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.responseDeadline && (
                    <Table.Row>
                      <Table.Cell>Response deadline</Table.Cell>
                      <Table.Cell>{contract.responseDeadline}</Table.Cell>
                    </Table.Row>
                  )}
                  {created && (
                    <Table.Row>
                      <Table.Cell>Created</Table.Cell>
                      <Table.Cell>{created}</Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table>
            </React.Fragment>
          )}
          {!loading && !error && !contract && (
            <div style={{ color: '#666' }}>No contract data.</div>
          )}
        </Segment>
      </Segment>
    </fabric-contract-detail>
  );
}

module.exports = ContractView;
