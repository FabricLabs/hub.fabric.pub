'use strict';

const React = require('react');
const { useParams, Link } = require('react-router-dom');
const { Segment, Header, Icon, Button, Loader, Table, Label, Message, Step } = require('semantic-ui-react');
const { formatSatsDisplay } = require('../functions/formatSats');
const { loadUpstreamSettings, fetchTransactionByHash, verifyL1Payment } = require('../functions/bitcoinClient');
const { runExecutionProgram } = require('../functions/fabricExecutionMachine');
const { computeExecutionRunCommitmentHex } = require('../functions/executionRunCommitment');
const { contractToDot } = require('../functions/contractGraphDot');
const GraphDocumentPreview = require('./GraphDocumentPreview');
const { describeHubRpcFailure } = require('../functions/hubRpcHints');
const DistributedFederationPanel = require('./DistributedFederationPanel');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');

async function fetchJsonRpcResult (method, params) {
  const res = await fetch('/services/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  let body = {};
  try {
    body = await res.json();
  } catch (_) {
    throw new Error('Hub returned non-JSON (check network or hub logs)');
  }
  if (!res.ok) {
    throw new Error((body && body.error && body.error.message) || res.statusText || `HTTP ${res.status}`);
  }
  if (body && body.error) {
    throw new Error(body.error.message || 'RPC error');
  }
  return body && body.result != null ? body.result : null;
}

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
  const [bondVerify, setBondVerify] = React.useState(null);
  const [commitmentCopied, setCommitmentCopied] = React.useState(false);

  const adminToken = props && props.adminToken ? String(props.adminToken) : '';

  const [hubUiTick, setHubUiTick] = React.useState(0);
  React.useEffect(() => subscribeHubUiFeatureFlags(() => setHubUiTick((t) => t + 1)), []);
  void hubUiTick;
  const uf = loadHubUiFeatureFlags();

  const copyRunCommitmentHex = React.useCallback(() => {
    const hex = hubRun && hubRun.runCommitmentHex ? String(hubRun.runCommitmentHex) : '';
    if (!hex) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      return;
    }
    setCommitmentCopied(false);
    navigator.clipboard.writeText(hex).then(() => {
      setCommitmentCopied(true);
      window.setTimeout(() => setCommitmentCopied(false), 2000);
    }).catch(() => {});
  }, [hubRun]);

  React.useEffect(() => {
    let cancelled = false;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId;
    if (typeof window !== 'undefined' && ac) {
      timeoutId = window.setTimeout(() => {
        try {
          ac.abort();
        } catch (_) {}
      }, 15000);
    }
    fetch('/services/bitcoin', {
      headers: { Accept: 'application/json' },
      ...(ac ? { signal: ac.signal } : {})
    })
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
      })
      .finally(() => {
        if (typeof window !== 'undefined' && timeoutId != null) {
          window.clearTimeout(timeoutId);
        }
      });
    return () => {
      cancelled = true;
      if (ac) {
        try {
          ac.abort();
        } catch (_) {}
      }
      if (typeof window !== 'undefined' && timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const reloadContract = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/contracts/${encodeURIComponent(id)}`, { method: 'GET' });
      const body = await res.json();
      if (!res.ok || !body || body.status === 'error') {
        setError((body && body.message) || 'Failed to load contract.');
        setContract(null);
        return;
      }
      const c = body.contract || body.result || body;
      setContract(c || null);
    } catch (e) {
      setError(e && e.message ? e.message : 'Failed to load contract.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    setLocalRun(null);
    setHubRun(null);
    setHubRunError(null);
    setHubRunLoading(false);
    setAnchorTxid(null);
    setAnchorError(null);
    setAnchorLoading(false);
    setCommitmentCopied(false);
  }, [id]);

  React.useEffect(() => {
    void reloadContract();
  }, [reloadContract]);

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
        if (!data || typeof data !== 'object') {
          setPayTxMeta({ loading: false, error: 'Transaction not found on this hub.' });
          return;
        }
        setPayTxMeta({ loading: false, tx: data });
      })
      .catch((e) => {
        if (!cancelled) setPayTxMeta({ loading: false, error: e && e.message ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [contract && contract.txid]);

  React.useEffect(() => {
    const txid = contract && contract.txid ? String(contract.txid).trim() : '';
    const addr = contract && contract.invoiceAddress ? String(contract.invoiceAddress).trim() : '';
    const sats = contract && contract.invoiceAmountSats != null ? Number(contract.invoiceAmountSats) : NaN;
    if (!txid || !addr || !Number.isFinite(sats) || sats <= 0) {
      setBondVerify(null);
      return;
    }
    let cancelled = false;
    setBondVerify({ loading: true });
    const upstream = loadUpstreamSettings();
    verifyL1Payment(upstream, { txid, address: addr, amountSats: Math.round(sats) })
      .then((data) => {
        if (cancelled) return;
        setBondVerify({ loading: false, data });
      })
      .catch((e) => {
        if (cancelled) return;
        setBondVerify({ loading: false, error: e && e.message ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [contract && contract.txid, contract && contract.invoiceAddress, contract && contract.invoiceAmountSats]);

  const created = contract && contract.created ? new Date(contract.created).toLocaleString() : '';
  const isExecution = !!(contract && contract.type === 'ExecutionContract');
  const hasExecProgram = !!(contract && contract.program != null && typeof contract.program === 'object');

  const runLocalExecution = React.useCallback(() => {
    if (!contract || !contract.program || typeof contract.program !== 'object') return;
    setLocalRun(runExecutionProgram(contract.program));
  }, [contract]);

  const runHubExecution = React.useCallback(async () => {
    if (!id) return;
    if (!contract || contract.program == null || typeof contract.program !== 'object') {
      setHubRunError('No program on this contract; cannot run on the hub.');
      return;
    }
    setHubRunLoading(true);
    setHubRunError(null);
    setHubRun(null);
    setCommitmentCopied(false);
    try {
      const result = await fetchJsonRpcResult('RunExecutionContract', [{ contractId: id }]);
      if (result && result.status === 'error') {
        setHubRunError(describeHubRpcFailure(result.message || 'Run failed', ''));
        return;
      }
      if (result == null) {
        setHubRunError('Empty response from hub');
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
      const raw = e && e.message ? e.message : String(e);
      setHubRunError(describeHubRpcFailure(raw, 'Check hub reachability and JSON-RPC (/services/rpc).'));
    } finally {
      setHubRunLoading(false);
    }
  }, [id, contract]);

  const anchorCommitment = React.useCallback(async () => {
    if (!hubRun || !hubRun.runCommitmentHex || !adminToken) return;
    setAnchorLoading(true);
    setAnchorError(null);
    setAnchorTxid(null);
    try {
      const out = await fetchJsonRpcResult('AnchorExecutionRunCommitment', [
        { commitmentHex: hubRun.runCommitmentHex, adminToken }
      ]);
      if (out && out.status === 'error') {
        setAnchorError(describeHubRpcFailure(out.message || 'Anchor failed', ''));
        return;
      }
      if (out && out.txid) setAnchorTxid(String(out.txid));
      else setAnchorError('No txid in response');
    } catch (e) {
      const raw = e && e.message ? e.message : String(e);
      setAnchorError(describeHubRpcFailure(raw, 'Regtest + admin token required; check hub wallet and /services/rpc.'));
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

  const contractDot = React.useMemo(() => {
    if (!contract) return '';
    try {
      return contractToDot(contract, hubRun);
    } catch (_) {
      return '';
    }
  }, [contract, hubRun]);

  return (
    <fabric-contract-detail class='fade-in'>
      <Segment>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
          role="banner"
        >
          <Button basic size="small" as={Link} to="/contracts" aria-label="Back to contracts list">
            <Icon name="arrow left" aria-hidden="true" />
            Contracts
          </Button>
          <Header as="h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
            <Header.Content>
              Contract
              {id && error && !loading && (
                <Header.Subheader style={{ marginTop: '0.35em', fontWeight: 'normal' }}>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.85em' }}>{id}</code>
                </Header.Subheader>
              )}
            </Header.Content>
            {contract && !isExecution && (
              <Label size="small" color="purple">
                <Icon name="cloud" aria-hidden="true" />
                Storage
              </Label>
            )}
            {contract && isExecution && (
              <Label size="small" color="teal">
                <Icon name="code" aria-hidden="true" />
                Execution
              </Label>
            )}
          </Header>
        </div>

        <Segment>
          {loading && (
            <div style={{ minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader active inline="centered" />
            </div>
          )}
          {!loading && error && (
            <Message negative>
              <Message.Header>Could not load contract</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>{error}</p>
              <div style={{ marginTop: '0.85em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
                <Button size="small" type="button" onClick={() => void reloadContract()}>
                  <Icon name="refresh" />
                  Retry
                </Button>
                <Button size="small" basic as={Link} to="/contracts">
                  <Icon name="list" />
                  Contracts list
                </Button>
              </div>
              <p style={{ margin: '0.85em 0 0', fontSize: '0.9em', color: '#555' }}>
                <Link to="/contracts">Execution contracts</Link> and the live <strong>Federation guarantees</strong> panel are on the main contracts page.
              </p>
            </Message>
          )}
          {!loading && !error && contract && contractDot ? (
            <Segment style={{ marginBottom: '1em' }}>
              <Header as="h3">Contract graph</Header>
              <p style={{ color: '#666', marginBottom: '0.75em' }}>
                Derived from this contract&apos;s fields (storage vs execution). Same Graphviz preview as DOT documents — no private payload beyond what this page already shows.
              </p>
              <GraphDocumentPreview dotSource={contractDot} skipIdentityGate />
              <details style={{ marginTop: '0.75rem' }}>
                <summary style={{ cursor: 'pointer', color: '#555' }}>DOT source</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', background: '#f7f7f7', padding: '0.5rem', borderRadius: 4 }}>{contractDot}</pre>
              </details>
            </Segment>
          ) : null}
          {!loading && !error && contract && isExecution && (!contractDot || !String(contractDot).trim()) && (
            <Message info size="small" style={{ marginBottom: '1em' }}>
              <Message.Header>Contract graph</Message.Header>
              <p style={{ margin: '0.35em 0 0', color: '#666' }}>
                No DOT preview was generated for this execution contract. You can still run locally or on the hub below.
              </p>
            </Message>
          )}
          {!loading && !error && contract && isExecution && (
            <React.Fragment>
              <Message info style={{ marginBottom: '1em' }}>
                <Message.Header>Distributed execution and Bitcoin L1</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                  This flow is designed so peers can agree on a <strong>program</strong>, verify <strong>runs</strong> deterministically, and relate hub state to <strong>Bitcoin</strong>:
                </p>
                <ul style={{ margin: '0.5em 0 0', paddingLeft: '1.25em', color: '#555' }}>
                  <li>
                    <strong>Registry (when Bitcoin is on):</strong> L1 pays the hub invoice for a fixed <code>programDigest</code> before <code>CreateExecutionContract</code> accepts the publish.
                  </li>
                  <li>
                    <strong>Run integrity:</strong> the hub interpreter returns <code>runCommitmentHex</code> (hash of the canonical trace). <strong>Run locally</strong> in the browser should match; mismatch means different inputs or code paths.
                  </li>
                  <li>
                    <strong>L1 checkpoint (regtest demo):</strong> after a successful hub run, an admin can broadcast <strong>OP_RETURN</strong> carrying that digest using the hub wallet (see below).
                  </li>
                  {uf.sidechain ? (
                    <li>
                      <strong>Federation (sidechain + beacon):</strong> enforced by this hub only for <code>SubmitSidechainStatePatch</code> and beacon epoch <code>federationWitness</code> fields — see{' '}
                      <Link to="/settings/admin/beacon-federation">Beacon Federation</Link>
                      {' '}and the live policy panel below (not used for registry publish or hub runs).
                    </li>
                  ) : null}
                </ul>
                {uf.sidechain ? <DistributedFederationPanel marginBottom="0" /> : null}
              </Message>
              {(contract.invoiceAddress || contract.invoiceAmountSats != null) && (
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>L1 registry payment</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    This execution contract was published with a verified on-chain payment to the hub invoice address (same L1 check as storage distribute bonds).
                  </p>
                </Message>
              )}
              {bondVerify && bondVerify.loading && (
                <Message info style={{ marginBottom: '1em' }}>
                  <Message.Header>Verifying registry payment</Message.Header>
                  <p style={{ margin: '0.35em 0 0' }}>Checking L1 proof against the registry invoice…</p>
                </Message>
              )}
              {bondVerify && !bondVerify.loading && bondVerify.error && (
                <Message warning style={{ marginBottom: '1em' }} content={bondVerify.error} />
              )}
              {bondVerify && !bondVerify.loading && bondVerify.data && (
                <Message
                  positive={!!bondVerify.data.verified}
                  negative={!bondVerify.data.verified}
                  style={{ marginBottom: '1em' }}
                  header={bondVerify.data.verified ? 'Registry payment verified on-chain' : 'L1 proof check did not pass'}
                  content={
                    bondVerify.data.verified
                      ? `Matched at least ${formatSatsDisplay(contract.invoiceAmountSats)} sats to the invoice address. Confirmations: ${bondVerify.data.confirmations != null ? bondVerify.data.confirmations : 'n/a'}${bondVerify.data.inMempool ? ' (still in mempool)' : ''}.`
                      : 'Inspect the funding transaction or mempool; the hub may still list the contract if verification is temporarily unavailable.'
                  }
                />
              )}
              {!hasExecProgram && (
                <Message warning style={{ marginBottom: '1em' }}>
                  <Message.Header>No executable program</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#555' }}>
                    This execution contract record has no <code>program</code> object (legacy row, truncated API, or bad publish). Open the hub <code>contracts/&lt;id&gt;.json</code> store or republish from the contracts list.
                  </p>
                </Message>
              )}
              <Header as="h3">Execution program</Header>
              <p style={{ color: '#666' }}>
                Run the same sandboxed interpreter the hub used at publish time. <strong>Run on hub</strong> calls <code>RunExecutionContract</code> via <code>POST /services/rpc</code> (same methods as WebSocket JSON-RPC).
                Compare the returned <code>runCommitmentHex</code> with <strong>Run locally</strong>; anchor on regtest after a successful hub run when offered below.
              </p>
              <div style={{ marginBottom: '1em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  primary
                  disabled={!hasExecProgram}
                  title={hasExecProgram ? undefined : 'No program JSON on this contract'}
                  onClick={runLocalExecution}
                >
                  <Icon name="play" />
                  Run locally
                </Button>
                <Button
                  type="button"
                  basic
                  loading={hubRunLoading}
                  disabled={hubRunLoading || !hasExecProgram}
                  title={hasExecProgram ? undefined : 'No program JSON on this contract'}
                  onClick={runHubExecution}
                >
                  <Icon name="server" />
                  Run on hub
                </Button>
              </div>
              {hubRunError && (
                <Message negative style={{ marginBottom: '1em' }}>
                  <Message.Header>Run on hub failed</Message.Header>
                  <p style={{ margin: '0.35em 0 0' }}>{hubRunError}</p>
                  <div style={{ marginTop: '0.75em' }}>
                    <Button
                      type="button"
                      size="small"
                      loading={hubRunLoading}
                      disabled={hubRunLoading}
                      onClick={() => void runHubExecution()}
                    >
                      <Icon name="refresh" />
                      Retry
                    </Button>
                  </div>
                </Message>
              )}
              {hubRun && !hubRunError && hubRun.delegationSignRequestError && (
                <Message warning style={{ marginBottom: '1em' }}>
                  <Message.Header>Delegation signing wire not built</Message.Header>
                  <p style={{ margin: '0.35em 0 0' }}>{String(hubRun.delegationSignRequestError)}</p>
                  <p style={{ margin: '0.5em 0 0', fontSize: '0.9em', color: '#666' }}>
                    The hub run finished, but no <code>fabricMessageWireHex</code> was produced for the delegation modal. Check the raw hub result below.
                  </p>
                </Message>
              )}
              {hubRun && !hubRunError && !hubRun.runCommitmentHex && (
                <Message warning style={{ marginBottom: '1em' }}>
                  <Message.Header>No run commitment digest</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#666' }}>
                    The hub returned a run result without <code>runCommitmentHex</code> (commitment computation may have failed on the server).
                  </p>
                </Message>
              )}
              {localRun && (
                <Message
                  positive={localRun.ok}
                  negative={!localRun.ok}
                  header={localRun.ok ? 'Local run finished' : 'Local run failed'}
                  content={
                    <React.Fragment>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', margin: 0 }}>
                        {JSON.stringify(localRun, null, 2)}
                      </pre>
                      {!localRun.ok && (
                        <div style={{ marginTop: '0.75em' }}>
                          <Button type="button" size="small" basic onClick={runLocalExecution}>
                            <Icon name="refresh" />
                            Run locally again
                          </Button>
                        </div>
                      )}
                    </React.Fragment>
                  }
                  style={{ marginBottom: '1em' }}
                />
              )}
              {hubRun && hubRun.runCommitmentHex && (
                <Message info style={{ marginBottom: '1em' }}>
                  <Message.Header>Run commitment (digest)</Message.Header>
                  {hubRun.ok === false && (
                    <p style={{ marginTop: '0.5em', color: '#8a6d3b' }}>
                      This hub run did not finish successfully (<code>ok: false</code>). The digest is still shown for comparison; OP_RETURN anchor is only offered after a successful run.
                    </p>
                  )}
                  <div style={{ marginTop: '0.5em', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5em' }}>
                    <p style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.85em', margin: 0, flex: '1 1 12rem' }}>
                      {hubRun.runCommitmentHex}
                    </p>
                    <Button
                      type="button"
                      size="small"
                      basic
                      icon
                      onClick={copyRunCommitmentHex}
                      title="Copy commitment hex"
                      aria-label="Copy run commitment digest hex"
                    >
                      <Icon name="copy outline" />
                    </Button>
                    {commitmentCopied && (
                      <span style={{ fontSize: '0.85em', color: '#276749' }}>Copied</span>
                    )}
                  </div>
                  {!localCommitmentHex && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }}>
                      Use <strong>Run locally</strong> above to compare this digest with the same interpreter in your browser.
                    </p>
                  )}
                  {localCommitmentHex && (
                    <p style={{ marginTop: '0.75em', color: localCommitmentHex === hubRun.runCommitmentHex ? '#276749' : '#b00' }}>
                      {localCommitmentHex === hubRun.runCommitmentHex
                        ? 'Matches local run commitment.'
                        : 'Local run commitment differs — re-run locally after loading the same program.'}
                    </p>
                  )}
                  {bitcoinNet.loading && hubRun.ok && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }}>
                      Checking <code>/services/bitcoin</code> for regtest anchoring options…
                    </p>
                  )}
                  {!bitcoinNet.loading && bitcoinNet.regtest && bitcoinNet.available && hubRun.ok && !adminToken && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }}>
                      Complete first-time setup and keep your admin token in this browser to anchor on regtest, or open{' '}
                      <Link to="/settings">Settings</Link>.
                    </p>
                  )}
                  {!bitcoinNet.loading && bitcoinNet.regtest && bitcoinNet.available && adminToken && hubRun.ok && (
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
                  {!bitcoinNet.loading && (!bitcoinNet.regtest || !bitcoinNet.available) && hubRun.ok && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }}>
                      OP_RETURN anchoring for run commitments is only enabled when this hub&apos;s Bitcoin service is available on regtest.
                    </p>
                  )}
                  {anchorError && (
                    <Message negative compact size="small" style={{ marginTop: '0.75em' }}>
                      <Message.Header>Anchor failed</Message.Header>
                      <p style={{ margin: '0.35em 0 0' }}>{anchorError}</p>
                      <Button
                        type="button"
                        size="small"
                        style={{ marginTop: '0.5em' }}
                        loading={anchorLoading}
                        disabled={anchorLoading}
                        onClick={() => void anchorCommitment()}
                      >
                        <Icon name="refresh" />
                        Retry
                      </Button>
                    </Message>
                  )}
                  {anchorTxid && (
                    <p style={{ marginTop: '0.75em' }}>
                      {uf.bitcoinExplorer ? (
                        <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(anchorTxid)}`}>
                          <Icon name="external" />
                          View anchor tx {anchorTxid.slice(0, 18)}…
                        </Button>
                      ) : (
                        <code style={{ wordBreak: 'break-all', fontSize: '0.85em' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the tx viewer">{anchorTxid}</code>
                      )}
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
                  {contract.programDigest && (
                    <Table.Row>
                      <Table.Cell>Program digest</Table.Cell>
                      <Table.Cell><code style={{ wordBreak: 'break-all' }}>{contract.programDigest}</code></Table.Cell>
                    </Table.Row>
                  )}
                  {contract.invoiceAddress && (
                    <Table.Row>
                      <Table.Cell>Registry invoice</Table.Cell>
                      <Table.Cell><code style={{ wordBreak: 'break-all' }}>{contract.invoiceAddress}</code></Table.Cell>
                    </Table.Row>
                  )}
                  {contract.invoiceAmountSats != null && (
                    <Table.Row>
                      <Table.Cell>Invoice amount</Table.Cell>
                      <Table.Cell>{formatSatsDisplay(contract.invoiceAmountSats)} sats</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.txid && (
                    <Table.Row>
                      <Table.Cell>Registry tx</Table.Cell>
                      <Table.Cell>
                        {uf.bitcoinExplorer ? (
                          <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(contract.txid)}`}>
                            <Icon name="bitcoin" />
                            {String(contract.txid).slice(0, 16)}…
                          </Button>
                        ) : (
                          <code style={{ wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the tx viewer">{contract.txid}</code>
                        )}
                        {payTxMeta && payTxMeta.loading && (
                          <Label size="small" style={{ marginLeft: '0.5em' }} basic>
                            Loading…
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.tx && (payTxMeta.tx.blockhash == null || payTxMeta.tx.blockhash === '') && (
                          <Label color="orange" size="small" style={{ marginLeft: '0.5em' }}>
                            <Icon name="clock" />
                            Mempool
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
                  {created && (
                    <Table.Row>
                      <Table.Cell>Created</Table.Cell>
                      <Table.Cell>{created}</Table.Cell>
                    </Table.Row>
                  )}
                  <Table.Row>
                    <Table.Cell>Program</Table.Cell>
                    <Table.Cell>
                      {hasExecProgram ? (
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', margin: 0 }}>
                          {JSON.stringify(contract.program, null, 2)}
                        </pre>
                      ) : (
                        <span style={{ color: '#888' }}>No program object in this contract record.</span>
                      )}
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
            </React.Fragment>
          )}
          {!loading && !error && contract && !isExecution && (
            <React.Fragment>
              <Header as="h3">Details</Header>
              {(contract.invoiceAddress || contract.invoiceAmountSats != null) && (
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>Bitcoin-bonded distribute flow</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    This record includes the <strong>CreateDistributeInvoice</strong> destination and amount the hub checked when <strong>CreateStorageContract</strong> ran.
                    The section below re-runs the same L1 proof as <code>GET /services/bitcoin/transactions/:txid?address=&amp;amountSats=</code>.
                  </p>
                </Message>
              )}
              {bondVerify && bondVerify.loading && (
                <Message info style={{ marginBottom: '1em' }}>
                  <Message.Header>Verifying bond</Message.Header>
                  <p style={{ margin: '0.35em 0 0' }}>Checking L1 payment proof against the distribute invoice…</p>
                </Message>
              )}
              {bondVerify && !bondVerify.loading && bondVerify.error && (
                <Message warning style={{ marginBottom: '1em' }} content={bondVerify.error} />
              )}
              {bondVerify && !bondVerify.loading && bondVerify.data && (
                <Message
                  positive={!!bondVerify.data.verified}
                  negative={!bondVerify.data.verified}
                  style={{ marginBottom: '1em' }}
                  header={bondVerify.data.verified ? 'Bitcoin bond verified on-chain' : 'L1 proof check did not pass'}
                  content={
                    bondVerify.data.verified
                      ? `Matched at least ${formatSatsDisplay(contract.invoiceAmountSats)} sats to the invoice address. Confirmations: ${bondVerify.data.confirmations != null ? bondVerify.data.confirmations : 'n/a'}${bondVerify.data.inMempool ? ' (still in mempool)' : ''}.`
                      : 'Inspect the payment transaction or regtest mempool. Older contracts may lack invoice fields; the row below still links the bonding tx when present.'
                  }
                />
              )}
              {!contract.invoiceAddress && contract.txid && (
                <Message size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>Legacy storage contract</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#555' }}>
                    No invoice address on file (created before this build). Use the payment tx link for manual inspection; new bonds persist <code>invoiceAddress</code> / <code>invoiceAmountSats</code> for automatic proof.
                  </p>
                </Message>
              )}
              <Table definition>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell width={3}>ID</Table.Cell>
                    <Table.Cell><code>{contract.id}</code></Table.Cell>
                  </Table.Row>
                  {contract.invoiceAddress && (
                    <Table.Row>
                      <Table.Cell>Distribute invoice</Table.Cell>
                      <Table.Cell>
                        <code style={{ wordBreak: 'break-all' }}>{contract.invoiceAddress}</code>
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {contract.invoiceAmountSats != null && (
                    <Table.Row>
                      <Table.Cell>Invoice amount</Table.Cell>
                      <Table.Cell>{formatSatsDisplay(contract.invoiceAmountSats)} sats</Table.Cell>
                    </Table.Row>
                  )}
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
                        {uf.bitcoinExplorer ? (
                          <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(contract.txid)}`}>
                            <Icon name="bitcoin" />
                            {String(contract.txid).slice(0, 16)}…
                          </Button>
                        ) : (
                          <code style={{ wordBreak: 'break-all' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the tx viewer">{contract.txid}</code>
                        )}
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
