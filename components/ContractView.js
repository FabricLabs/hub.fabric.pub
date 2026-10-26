'use strict';

const React = require('react');
const { useParams, Link } = require('react-router-dom');
const { Segment, Header, Icon, Button, Loader, Table, Label, Message, Step } = require('semantic-ui-react');
const strings = require('../locales/en');
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

const common = strings.common;
const net = strings.network;
const cv = net.contractView;

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
    throw new Error(cv.hubRun.unreadable);
  }
  if (!res.ok) {
    throw new Error((body && body.error && body.error.message) || res.statusText || `HTTP ${res.status}`);
  }
  if (body && body.error) {
    throw new Error(body.error.message || cv.hubRun.failed);
  }
  return body && body.result != null ? body.result : null;
}

function ContractView (props) {
  const params = useParams();
  const id = params && params.id ? params.id : '';

  const [contract, setContract] = React.useState(null);
  const [loading, setLoading] = React.useState(!!id);
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
        setError((body && body.message) || cv.error.fallback);
        setContract(null);
        return;
      }
      const c = body.contract || body.result || body;
      setContract(c || null);
    } catch (e) {
      setError(e && e.message ? e.message : cv.error.fallback);
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
          setPayTxMeta({ loading: false, error: data.message || cv.tx.loadFailed });
          return;
        }
        if (!data || typeof data !== 'object') {
          setPayTxMeta({ loading: false, error: cv.tx.notFound });
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
      setHubRunError(cv.hubRun.noProgram);
      return;
    }
    setHubRunLoading(true);
    setHubRunError(null);
    setHubRun(null);
    setCommitmentCopied(false);
    try {
      const result = await fetchJsonRpcResult('RunExecutionContract', [{ contractId: id }]);
      if (result && result.status === 'error') {
        setHubRunError(describeHubRpcFailure(result.message || cv.hubRun.failed, ''));
        return;
      }
      if (result == null) {
        setHubRunError(cv.hubRun.empty);
        return;
      }
      setHubRun(result);
      setAnchorTxid(null);
      setAnchorError(null);
      if (result && result.fabricMessageWireHex && typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('fabric:messagePrompt', {
            detail: {
              wireHex: result.fabricMessageWireHex,
              source: 'RunExecutionContract'
            }
          }));
        } catch (_) {}
      }
    } catch (e) {
      const raw = e && e.message ? e.message : String(e);
      setHubRunError(describeHubRpcFailure(raw, cv.hubRun.hint));
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
        setAnchorError(describeHubRpcFailure(out.message || cv.fingerprint.anchorFailed, ''));
        return;
      }
      if (out && out.txid) setAnchorTxid(String(out.txid));
      else setAnchorError(cv.fingerprint.noTxid);
    } catch (e) {
      const raw = e && e.message ? e.message : String(e);
      setAnchorError(describeHubRpcFailure(raw, cv.fingerprint.anchorHint));
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
          <Button basic size="small" as={Link} to="/contracts">
            <Icon name="arrow left" aria-hidden="true" />
            {cv.back}
          </Button>
          <Header as="h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
            <Header.Content>
              {cv.title}
              {id && error && !loading && (
                <Header.Subheader style={{ marginTop: '0.35em', fontWeight: 'normal' }}>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.85em' }}>{id}</code>
                </Header.Subheader>
              )}
            </Header.Content>
            {contract && !isExecution && (
              <Label size="small" color="purple">
                <Icon name="cloud" aria-hidden="true" />
                {cv.storageTag}
              </Label>
            )}
            {contract && isExecution && (
              <Label size="small" color="teal">
                <Icon name="code" aria-hidden="true" />
                {cv.executionTag}
              </Label>
            )}
          </Header>
        </div>

        <Segment>
          {loading && (
            <div
              role="status"
              aria-live="polite"
              style={{ minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Loader active inline="centered" content={cv.loading} />
            </div>
          )}
          {!loading && error && (
            <Message negative role="alert">
              <Message.Header>{cv.error.heading}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>{error}</p>
              <p style={{ margin: '0.5em 0 0', fontSize: '0.9em', color: '#555' }}>{cv.error.hint}</p>
              <div style={{ marginTop: '0.85em' }}>
                <Button size="small" type="button" onClick={() => void reloadContract()}>
                  <Icon name="refresh" />
                  {common.actions.retry}
                </Button>
              </div>
            </Message>
          )}
          {!loading && !error && contract && contractDot ? (
            <Segment style={{ marginBottom: '1em' }}>
              <Header as="h3">{cv.graph.heading}</Header>
              <p style={{ color: '#666', marginBottom: '0.75em' }}>
                {cv.graph.description}
              </p>
              <GraphDocumentPreview dotSource={contractDot} skipIdentityGate />
              <details className="hub-developer-details" style={{ marginTop: '0.75rem' }}>
                <summary style={{ cursor: 'pointer', color: '#555' }}>{common.developerDetails}</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', background: '#f7f7f7', padding: '0.5rem', borderRadius: 4 }}>{contractDot}</pre>
              </details>
            </Segment>
          ) : null}
          {!loading && !error && contract && isExecution && (!contractDot || !String(contractDot).trim()) && (
            <Message info size="small" style={{ marginBottom: '1em' }}>
              <Message.Header>{cv.graph.heading}</Message.Header>
              <p style={{ margin: '0.35em 0 0', color: '#666' }}>
                {cv.graph.none}
              </p>
            </Message>
          )}
          {!loading && !error && contract && isExecution && (
            <React.Fragment>
              <Message info style={{ marginBottom: '1em' }}>
                <Message.Header>{cv.about.heading}</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                  {cv.about.intro}
                </p>
                <ul style={{ margin: '0.5em 0 0', paddingLeft: '1.25em', color: '#555' }}>
                  <li>
                    <strong>{cv.about.registryLabel}</strong> {cv.about.registry}
                  </li>
                  <li>
                    <strong>{cv.about.runLabel}</strong> {cv.about.run}
                  </li>
                  <li>
                    <strong>{cv.about.checkpointLabel}</strong> {cv.about.checkpoint}
                  </li>
                  {uf.sidechain ? (
                    <li>
                      <strong>{cv.about.federationLabel}</strong> {cv.about.federationBefore}{' '}
                      <Link to="/settings/admin/beacon-federation">{cv.about.federationLink}</Link>
                      {cv.about.federationAfter}
                    </li>
                  ) : null}
                </ul>
                <details className="hub-developer-details" style={{ marginTop: '0.5em' }}>
                  <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                  <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#555' }}>{cv.about.developer}</p>
                </details>
                {uf.sidechain ? <DistributedFederationPanel marginBottom="0" /> : null}
              </Message>
              {(contract.invoiceAddress || contract.invoiceAmountSats != null) && (
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>{cv.registry.heading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    {cv.registry.body}
                  </p>
                </Message>
              )}
              {bondVerify && bondVerify.loading && (
                <Message info style={{ marginBottom: '1em' }} role="status">
                  <Message.Header>{cv.registry.checkingHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0' }}>{cv.registry.checkingBody}</p>
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
                  header={bondVerify.data.verified ? cv.registry.verified : cv.registry.failed}
                  content={
                    bondVerify.data.verified
                      ? cv.verifiedBody(contract.invoiceAmountSats, bondVerify.data.confirmations, bondVerify.data.inMempool)
                      : cv.registry.failedBody
                  }
                />
              )}
              {!hasExecProgram && (
                <Message warning style={{ marginBottom: '1em' }}>
                  <Message.Header>{cv.noProgram.heading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#555' }}>
                    {cv.noProgram.body}
                  </p>
                  <details className="hub-developer-details" style={{ marginTop: '0.35em' }}>
                    <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                    <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#555' }}>{cv.noProgram.developer}</p>
                  </details>
                </Message>
              )}
              <Header as="h3">{cv.program.heading}</Header>
              <p style={{ color: '#666', marginBottom: '0.35em' }}>
                {cv.program.description}
              </p>
              <details className="hub-developer-details" style={{ marginBottom: '0.75em' }}>
                <summary style={{ cursor: 'pointer', color: '#666' }}>{common.developerDetails}</summary>
                <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#666' }}>{cv.program.developer}</p>
              </details>
              <div style={{ marginBottom: '1em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  primary
                  disabled={!hasExecProgram}
                  title={hasExecProgram ? undefined : cv.noProgram.buttonTitle}
                  onClick={runLocalExecution}
                >
                  <Icon name="play" />
                  {cv.program.runLocal}
                </Button>
                <Button
                  type="button"
                  basic
                  loading={hubRunLoading}
                  disabled={hubRunLoading || !hasExecProgram}
                  title={hasExecProgram ? undefined : cv.noProgram.buttonTitle}
                  onClick={runHubExecution}
                >
                  <Icon name="server" />
                  {cv.program.runHub}
                </Button>
              </div>
              {hubRunError && (
                <Message negative style={{ marginBottom: '1em' }} role="alert">
                  <Message.Header>{cv.hubRun.errorHeading}</Message.Header>
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
                      {common.actions.retry}
                    </Button>
                  </div>
                </Message>
              )}
              {hubRun && !hubRunError && hubRun.messagePromptError && (
                <Message warning style={{ marginBottom: '1em' }}>
                  <Message.Header>{cv.hubRun.signingHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0' }}>{String(hubRun.messagePromptError)}</p>
                  <p style={{ margin: '0.5em 0 0', fontSize: '0.9em', color: '#666' }}>
                    {cv.hubRun.signingBody}
                  </p>
                </Message>
              )}
              {hubRun && !hubRunError && !hubRun.runCommitmentHex && (
                <Message warning style={{ marginBottom: '1em' }}>
                  <Message.Header>{cv.hubRun.noFingerprintHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#666' }}>
                    {cv.hubRun.noFingerprintBody}
                  </p>
                </Message>
              )}
              {localRun && (
                <Message
                  positive={localRun.ok}
                  negative={!localRun.ok}
                  header={localRun.ok ? cv.localRun.ok : cv.localRun.failed}
                  content={
                    <React.Fragment>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', margin: 0 }}>
                        {JSON.stringify(localRun, null, 2)}
                      </pre>
                      {!localRun.ok && (
                        <div style={{ marginTop: '0.75em' }}>
                          <Button type="button" size="small" basic onClick={runLocalExecution}>
                            <Icon name="refresh" />
                            {cv.localRun.again}
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
                  <Message.Header>{cv.fingerprint.heading}</Message.Header>
                  {hubRun.ok === false && (
                    <p style={{ marginTop: '0.5em', color: '#8a6d3b' }}>
                      {cv.fingerprint.notOk}
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
                      labelPosition="left"
                      onClick={copyRunCommitmentHex}
                    >
                      <Icon name="copy outline" />
                      {cv.fingerprint.copy}
                    </Button>
                    {commitmentCopied && (
                      <span style={{ fontSize: '0.85em', color: '#276749' }} role="status">{common.actions.copied}</span>
                    )}
                  </div>
                  {!localCommitmentHex && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }}>
                      {cv.fingerprint.compare}
                    </p>
                  )}
                  {localCommitmentHex && (
                    <p style={{ marginTop: '0.75em', color: localCommitmentHex === hubRun.runCommitmentHex ? '#276749' : '#b00' }}>
                      {localCommitmentHex === hubRun.runCommitmentHex
                        ? cv.fingerprint.match
                        : cv.fingerprint.mismatch}
                    </p>
                  )}
                  {bitcoinNet.loading && hubRun.ok && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }} role="status">
                      {cv.fingerprint.checking}
                    </p>
                  )}
                  {!bitcoinNet.loading && bitcoinNet.regtest && bitcoinNet.available && hubRun.ok && !adminToken && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }}>
                      {cv.fingerprint.needAdminBefore}{' '}
                      <Link to="/settings">{cv.fingerprint.needAdminLink}</Link>.
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
                        {cv.fingerprint.anchor}
                      </Button>
                      <span style={{ marginLeft: '0.75em', color: '#888', fontSize: '0.85em' }}>
                        {cv.fingerprint.anchorNote}
                      </span>
                    </div>
                  )}
                  {!bitcoinNet.loading && (!bitcoinNet.regtest || !bitcoinNet.available) && hubRun.ok && (
                    <p style={{ marginTop: '0.75em', color: '#666', fontSize: '0.9em' }}>
                      {cv.fingerprint.anchorUnavailable}
                    </p>
                  )}
                  {anchorError && (
                    <Message negative compact size="small" style={{ marginTop: '0.75em' }} role="alert">
                      <Message.Header>{cv.fingerprint.anchorErrorHeading}</Message.Header>
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
                        {common.actions.retry}
                      </Button>
                    </Message>
                  )}
                  {anchorTxid && (
                    <p style={{ marginTop: '0.75em' }}>
                      {uf.bitcoinExplorer ? (
                        <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(anchorTxid)}`}>
                          <Icon name="external" />
                          {cv.fingerprint.viewAnchor(anchorTxid.slice(0, 18))}
                        </Button>
                      ) : (
                        <code style={{ wordBreak: 'break-all', fontSize: '0.85em' }} title={net.explorerOff}>{anchorTxid}</code>
                      )}
                    </p>
                  )}
                </Message>
              )}
              {hubRun && Array.isArray(hubRun.trace) && hubRun.trace.length > 0 && !hubRun.trace.some((t) => t && t.truncated) && (
                <Segment style={{ marginBottom: '1em' }}>
                  <Header as="h4">{cv.hubRun.traceHeading}</Header>
                  <Step.Group ordered fluid size="small">
                    {hubRun.trace.map((t, i) => (
                      <Step key={i} completed={hubRun.ok}>
                        <Step.Content>
                          <Step.Title>{cv.hubRun.step(t.pc != null ? t.pc + 1 : i + 1, t.op)}</Step.Title>
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
                  header={cv.hubRun.rawHeading}
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
                    <Table.Cell width={3}>{cv.table.id}</Table.Cell>
                    <Table.Cell><code>{contract.id}</code></Table.Cell>
                  </Table.Row>
                  {contract.name && (
                    <Table.Row>
                      <Table.Cell>{cv.table.name}</Table.Cell>
                      <Table.Cell>{contract.name}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.validatedSteps != null && (
                    <Table.Row>
                      <Table.Cell>{cv.table.validatedSteps}</Table.Cell>
                      <Table.Cell>{contract.validatedSteps}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.programDigest && (
                    <Table.Row>
                      <Table.Cell>{cv.table.digest}</Table.Cell>
                      <Table.Cell><code style={{ wordBreak: 'break-all' }}>{contract.programDigest}</code></Table.Cell>
                    </Table.Row>
                  )}
                  {contract.invoiceAddress && (
                    <Table.Row>
                      <Table.Cell>{cv.table.registryInvoice}</Table.Cell>
                      <Table.Cell><code style={{ wordBreak: 'break-all' }}>{contract.invoiceAddress}</code></Table.Cell>
                    </Table.Row>
                  )}
                  {contract.invoiceAmountSats != null && (
                    <Table.Row>
                      <Table.Cell>{cv.table.invoiceAmount}</Table.Cell>
                      <Table.Cell>{common.sats(contract.invoiceAmountSats)}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.txid && (
                    <Table.Row>
                      <Table.Cell>{cv.table.registryTx}</Table.Cell>
                      <Table.Cell>
                        {uf.bitcoinExplorer ? (
                          <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(contract.txid)}`}>
                            <Icon name="bitcoin" />
                            {String(contract.txid).slice(0, 16)}…
                          </Button>
                        ) : (
                          <code style={{ wordBreak: 'break-all' }} title={net.explorerOff}>{contract.txid}</code>
                        )}
                        {payTxMeta && payTxMeta.loading && (
                          <Label size="small" style={{ marginLeft: '0.5em' }} basic>
                            {common.states.loading}
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.tx && (payTxMeta.tx.blockhash == null || payTxMeta.tx.blockhash === '') && (
                          <Label color="orange" size="small" style={{ marginLeft: '0.5em' }}>
                            <Icon name="clock" />
                            {cv.table.unconfirmed}
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.tx && payTxMeta.tx.confirmations != null && Number(payTxMeta.tx.confirmations) > 0 && (
                          <Label color="green" size="small" style={{ marginLeft: '0.5em' }}>
                            {cv.table.confirmations(Number(payTxMeta.tx.confirmations))}
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.error && !payTxMeta.loading && (
                          <Label size="small" color="grey" style={{ marginLeft: '0.5em' }} title={payTxMeta.error}>
                            {cv.table.statusUnknown}
                          </Label>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {created && (
                    <Table.Row>
                      <Table.Cell>{cv.table.created}</Table.Cell>
                      <Table.Cell>{created}</Table.Cell>
                    </Table.Row>
                  )}
                  <Table.Row>
                    <Table.Cell>{cv.table.program}</Table.Cell>
                    <Table.Cell>
                      {hasExecProgram ? (
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', margin: 0 }}>
                          {JSON.stringify(contract.program, null, 2)}
                        </pre>
                      ) : (
                        <span style={{ color: '#888' }}>{cv.table.noProgram}</span>
                      )}
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
            </React.Fragment>
          )}
          {!loading && !error && contract && !isExecution && (
            <React.Fragment>
              <Header as="h3">{cv.storage.heading}</Header>
              {(contract.invoiceAddress || contract.invoiceAmountSats != null) && (
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>{cv.storage.bondHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    {cv.storage.bondBody}
                  </p>
                  <details className="hub-developer-details" style={{ marginTop: '0.35em' }}>
                    <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                    <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#555' }}>{cv.storage.bondDeveloper}</p>
                  </details>
                </Message>
              )}
              {bondVerify && bondVerify.loading && (
                <Message info style={{ marginBottom: '1em' }} role="status">
                  <Message.Header>{cv.storage.checkingHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0' }}>{cv.storage.checkingBody}</p>
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
                  header={bondVerify.data.verified ? cv.storage.verified : cv.storage.failed}
                  content={
                    bondVerify.data.verified
                      ? cv.verifiedBody(contract.invoiceAmountSats, bondVerify.data.confirmations, bondVerify.data.inMempool)
                      : cv.storage.failedBody
                  }
                />
              )}
              {!contract.invoiceAddress && contract.txid && (
                <Message size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>{cv.storage.legacyHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#555' }}>
                    {cv.storage.legacyBody}
                  </p>
                </Message>
              )}
              <Table definition>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell width={3}>{cv.table.id}</Table.Cell>
                    <Table.Cell><code>{contract.id}</code></Table.Cell>
                  </Table.Row>
                  {contract.invoiceAddress && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.invoice}</Table.Cell>
                      <Table.Cell>
                        <code style={{ wordBreak: 'break-all' }}>{contract.invoiceAddress}</code>
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {contract.invoiceAmountSats != null && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.invoiceAmount}</Table.Cell>
                      <Table.Cell>{common.sats(contract.invoiceAmountSats)}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.document && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.document}</Table.Cell>
                      <Table.Cell>
                        <code>{contract.document}</code>
                        <Button size="mini" as={Link} to={`/documents/${encodeURIComponent(contract.document)}`} style={{ marginLeft: '0.5em' }}>
                          <Icon name="file alternate" />
                          {cv.storage.viewDocument}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {contract.txid && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.payment}</Table.Cell>
                      <Table.Cell>
                        {uf.bitcoinExplorer ? (
                          <Button size="small" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(contract.txid)}`}>
                            <Icon name="bitcoin" />
                            {String(contract.txid).slice(0, 16)}…
                          </Button>
                        ) : (
                          <code style={{ wordBreak: 'break-all' }} title={net.explorerOff}>{contract.txid}</code>
                        )}
                        {payTxMeta && payTxMeta.loading && (
                          <Label size="small" style={{ marginLeft: '0.5em' }} basic>
                            {common.states.loading}
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.tx && (payTxMeta.tx.blockhash == null || payTxMeta.tx.blockhash === '') && (
                          <Label color="orange" size="small" style={{ marginLeft: '0.5em' }}>
                            <Icon name="clock" />
                            {cv.table.unconfirmed}
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.tx && payTxMeta.tx.confirmations != null && Number(payTxMeta.tx.confirmations) > 0 && (
                          <Label color="green" size="small" style={{ marginLeft: '0.5em' }}>
                            {cv.table.confirmations(Number(payTxMeta.tx.confirmations))}
                          </Label>
                        )}
                        {payTxMeta && payTxMeta.error && !payTxMeta.loading && (
                          <Label size="small" color="grey" style={{ marginLeft: '0.5em' }} title={payTxMeta.error}>
                            {cv.table.statusUnknown}
                          </Label>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {contract.amountSats != null && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.amount}</Table.Cell>
                      <Table.Cell>{common.sats(contract.amountSats)}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.desiredCopies != null && contract.desiredCopies > 1 && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.copies}</Table.Cell>
                      <Table.Cell>{contract.desiredCopies}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.durationYears != null && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.duration}</Table.Cell>
                      <Table.Cell>{cv.storage.years(Number(contract.durationYears))}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.challengeCadence && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.cadence}</Table.Cell>
                      <Table.Cell>{contract.challengeCadence}</Table.Cell>
                    </Table.Row>
                  )}
                  {contract.responseDeadline && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.deadline}</Table.Cell>
                      <Table.Cell>{contract.responseDeadline}</Table.Cell>
                    </Table.Row>
                  )}
                  {created && (
                    <Table.Row>
                      <Table.Cell>{cv.storage.created}</Table.Cell>
                      <Table.Cell>{created}</Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table>
            </React.Fragment>
          )}
          {!loading && !error && !contract && (
            <Message info role="status">
              <p>{cv.empty}</p>
            </Message>
          )}
        </Segment>
      </Segment>
    </fabric-contract-detail>
  );
}

module.exports = ContractView;
