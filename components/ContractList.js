'use strict';

const React = require('react');
const { Link, useNavigate } = require('react-router-dom');
const {
  Segment,
  Header,
  List,
  Icon,
  Label,
  Loader,
  Button,
  ButtonGroup,
  Table,
  Form,
  TextArea,
  Message
} = require('semantic-ui-react');
const { fetchLightningChannels, loadUpstreamSettings, fetchCrowdfundingCampaigns } = require('../functions/bitcoinClient');
const { formatSatsDisplay } = require('../functions/formatSats');
const { hubJsonRpc } = require('../functions/sidechainHubClient');
const { describeHubRpcFailure } = require('../functions/hubRpcHints');
const DistributedFederationPanel = require('./DistributedFederationPanel');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

const FILTER_ALL = 'all';
const FILTER_NEW = 'new';
const FILTER_PARTIAL = 'partial';
const FILTER_COMPLETE = 'complete';

/** Minimal valid program — replace `steps` with your real execution contract. */
const DEFAULT_EMPTY_EXEC_PROGRAM = JSON.stringify({ version: 1, steps: [] }, null, 2);

const DEFAULT_REGISTRY_FEE_SATS = 1000;
const EXEC_REGISTRY_DRAFT_STORAGE_KEY = 'fabric.execRegistryDraft.v1';

function trimHash (value = '', left = 8, right = 8) {
  const text = String(value || '');
  if (text.length <= left + right + 1) return text;
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}

function normalizeOptionalInputText (value) {
  const text = String(value == null ? '' : value);
  // Defensive cleanup for historical drafts/UI states that serialized "undefined".
  if (text === 'undefined') return '';
  if (text.startsWith('undefined') && text.length > 'undefined'.length) {
    return text.slice('undefined'.length);
  }
  return text;
}

function ContractList () {
  const navigate = useNavigate();
  const [, setUiTick] = React.useState(0);
  React.useEffect(() => {
    return subscribeHubUiFeatureFlags(() => setUiTick((t) => t + 1));
  }, []);
  const uf = loadHubUiFeatureFlags();
  const hasAdmin = !!readHubAdminTokenFromBrowser();
  const [contracts, setContracts] = React.useState([]);
  const [crowdfundCampaigns, setCrowdfundCampaigns] = React.useState([]);
  const [lightningChannels, setLightningChannels] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [filter, setFilter] = React.useState(FILTER_ALL);
  const [execName, setExecName] = React.useState('');
  const [execJson, setExecJson] = React.useState(DEFAULT_EMPTY_EXEC_PROGRAM);
  const [execBusy, setExecBusy] = React.useState(false);
  const [execFeedback, setExecFeedback] = React.useState(null);
  const [execBitcoinOn, setExecBitcoinOn] = React.useState(false);
  const [execBitcoinLoading, setExecBitcoinLoading] = React.useState(true);
  const [execAmountSats, setExecAmountSats] = React.useState(String(DEFAULT_REGISTRY_FEE_SATS));
  const [execRegistryInvoice, setExecRegistryInvoice] = React.useState(null);
  const [execTxid, setExecTxid] = React.useState('');
  const [execInvoiceBusy, setExecInvoiceBusy] = React.useState(false);
  const [registryAddressCopied, setRegistryAddressCopied] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const raw = window.sessionStorage.getItem(EXEC_REGISTRY_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return;
      if (typeof draft.execName === 'string') setExecName(normalizeOptionalInputText(draft.execName));
      if (typeof draft.execJson === 'string' && draft.execJson.trim()) setExecJson(draft.execJson);
      if (draft.execAmountSats != null) setExecAmountSats(String(draft.execAmountSats));
      if (typeof draft.execTxid === 'string') setExecTxid(draft.execTxid);
      if (
        draft.execRegistryInvoice &&
        typeof draft.execRegistryInvoice === 'object' &&
        draft.execRegistryInvoice.programDigest &&
        draft.execRegistryInvoice.address
      ) {
        setExecRegistryInvoice({
          programDigest: String(draft.execRegistryInvoice.programDigest),
          address: String(draft.execRegistryInvoice.address),
          amountSats: Number(draft.execRegistryInvoice.amountSats) || DEFAULT_REGISTRY_FEE_SATS,
          network: draft.execRegistryInvoice.network != null
            ? String(draft.execRegistryInvoice.network).trim()
            : undefined
        });
      }
    } catch (_) {}
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const draft = {
        execName: normalizeOptionalInputText(execName),
        execJson: String(execJson || ''),
        execAmountSats: String(execAmountSats || ''),
        execTxid: String(execTxid || ''),
        execRegistryInvoice: execRegistryInvoice || null
      };
      const hasContent = !!(
        draft.execName.trim() ||
        draft.execTxid.trim() ||
        (draft.execJson && draft.execJson !== DEFAULT_EMPTY_EXEC_PROGRAM) ||
        draft.execRegistryInvoice
      );
      if (!hasContent) {
        window.sessionStorage.removeItem(EXEC_REGISTRY_DRAFT_STORAGE_KEY);
        return;
      }
      window.sessionStorage.setItem(EXEC_REGISTRY_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch (_) {}
  }, [execName, execJson, execAmountSats, execTxid, execRegistryInvoice]);

  const copyRegistryInvoiceAddress = React.useCallback(() => {
    const a = execRegistryInvoice && execRegistryInvoice.address;
    if (!a) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
    setRegistryAddressCopied(false);
    navigator.clipboard.writeText(String(a)).then(() => {
      setRegistryAddressCopied(true);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => setRegistryAddressCopied(false), 2000);
      }
    }).catch(() => {});
  }, [execRegistryInvoice]);

  const loadContracts = React.useCallback(async (opts = {}) => {
    const background = !!opts.background;
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const upstream = loadUpstreamSettings();
      const [contractsSettled, lightningSettled, crowdfundSettled] = await Promise.allSettled([
        fetch('/contracts', { method: 'GET' }),
        fetchLightningChannels(upstream).catch(() => ({ channels: [], outputs: [] })),
        fetchCrowdfundingCampaigns(upstream).catch(() => [])
      ]);

      if (lightningSettled.status === 'fulfilled') {
        const lightningRes = lightningSettled.value;
        const channels = lightningRes && Array.isArray(lightningRes.channels) ? lightningRes.channels : [];
        setLightningChannels(channels);
      } else {
        setLightningChannels([]);
      }

      if (crowdfundSettled.status === 'fulfilled') {
        const raw = crowdfundSettled.value;
        const list = Array.isArray(raw) ? raw : [];
        setCrowdfundCampaigns(list);
      } else {
        setCrowdfundCampaigns([]);
      }

      if (contractsSettled.status !== 'fulfilled') {
        const reason = contractsSettled.reason;
        setError(reason && reason.message ? reason.message : 'Failed to load contracts.');
        setContracts([]);
      } else {
        const contractsRes = contractsSettled.value;
        try {
          const body = await contractsRes.json();
          if (!contractsRes.ok || !body || body.status === 'error') {
            setError((body && body.message) || 'Failed to load contracts.');
            setContracts([]);
          } else {
            const list = Array.isArray(body.contracts) ? body.contracts : (body.result || []);
            setContracts(list || []);
            if (background) setError(null);
          }
        } catch (parseErr) {
          setError(parseErr && parseErr.message ? parseErr.message : 'Invalid contracts response.');
          setContracts([]);
        }
      }
    } catch (e) {
      setError(e && e.message ? e.message : 'Failed to load contracts.');
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadContracts();
  }, [loadContracts]);

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
    setExecBitcoinLoading(true);
    fetch('/services/bitcoin', {
      headers: { Accept: 'application/json' },
      ...(ac ? { signal: ac.signal } : {})
    })
      .then((r) => r.json().catch(() => ({})))
      .then((body) => {
        if (cancelled) return;
        const available = !!(body && body.available !== false && body.status !== 'error');
        setExecBitcoinOn(available);
        setExecBitcoinLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setExecBitcoinOn(false);
          setExecBitcoinLoading(false);
        }
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

  React.useEffect(() => {
    const onCreated = () => {
      void loadContracts({ background: true });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('executionContractCreated', onCreated);
      return () => window.removeEventListener('executionContractCreated', onCreated);
    }
    return undefined;
  }, [loadContracts]);

  const storageContracts = React.useMemo(() => {
    return contracts.filter((c) => {
      if (!c) return false;
      if (c.type === 'ExecutionContract') return false;
      if (c.type === 'StorageContract') return true;
      return !!c.document;
    });
  }, [contracts]);

  const executionContracts = React.useMemo(() => {
    const list = contracts.filter((c) => c && c.type === 'ExecutionContract');
    return list.slice().sort((a, b) => {
      const ta = a && a.created ? Date.parse(a.created) : NaN;
      const tb = b && b.created ? Date.parse(b.created) : NaN;
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      if (Number.isFinite(tb) && !Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb) && Number.isFinite(ta)) return -1;
      return String((b && b.id) || '').localeCompare(String((a && a.id) || ''));
    });
  }, [contracts]);

  // Group storage contracts by document to compute accepted count vs desired
  const contractsByDoc = React.useMemo(() => {
    const map = {};
    for (const c of storageContracts) {
      if (!c || !c.document) continue;
      const docId = c.document;
      if (!map[docId]) map[docId] = [];
      map[docId].push(c);
    }
    return map;
  }, [storageContracts]);

  const filteredContracts = React.useMemo(() => {
    return storageContracts.filter((c) => {
      if (!c || !c.document) return false;
      const docContracts = contractsByDoc[c.document] || [];
      const acceptedCount = docContracts.length;
      const desired = Math.max(1, Number(c.desiredCopies || 1));
      if (filter === FILTER_ALL) return true;
      if (filter === FILTER_NEW) return acceptedCount === 1;
      if (filter === FILTER_PARTIAL) return acceptedCount >= 1 && acceptedCount < desired;
      if (filter === FILTER_COMPLETE) return acceptedCount >= desired;
      return true;
    });
  }, [storageContracts, contractsByDoc, filter]);

  const requestExecutionRegistryInvoice = React.useCallback(async () => {
    setExecFeedback(null);
    if (execBitcoinLoading) {
      setExecFeedback({ negative: true, content: 'Still checking Bitcoin service; try again in a moment.' });
      return;
    }
    let program;
    try {
      program = JSON.parse(execJson);
    } catch (e) {
      setExecFeedback({
        negative: true,
        content: 'Program must be valid JSON. Fix the text or use Reset program template.'
      });
      return;
    }
    const amountSats = Number(execAmountSats);
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      setExecFeedback({ negative: true, content: 'Enter a positive registry fee in sats.' });
      return;
    }
    const nameOpt = execName.trim() || undefined;
    setExecInvoiceBusy(true);
    try {
      const out = await hubJsonRpc('CreateExecutionRegistryInvoice', [{ program, amountSats, name: nameOpt }]);
      if (!out.ok) {
        setExecFeedback({
          negative: true,
          content: describeHubRpcFailure(out.error, 'Check hub reachability and Bitcoin status.')
        });
        return;
      }
      const r = out.result;
      if (r && r.status === 'error') {
        setExecFeedback({ negative: true, content: r.message || 'Hub rejected the registry invoice request.' });
        return;
      }
      if (r && r.type === 'CreateExecutionRegistryInvoiceResult' && r.programDigest && r.address) {
        setExecRegistryInvoice({
          programDigest: r.programDigest,
          address: r.address,
          amountSats: r.amountSats,
          network: r.network != null ? String(r.network).trim() : undefined
        });
        setExecTxid('');
        setRegistryAddressCopied(false);
        setExecFeedback(null);
        return;
      }
      setExecFeedback({ negative: true, content: 'Unexpected response from hub for registry invoice.' });
    } catch (e) {
      setExecFeedback({ negative: true, content: e && e.message ? e.message : String(e) });
    } finally {
      setExecInvoiceBusy(false);
    }
  }, [execJson, execAmountSats, execName, execBitcoinLoading]);

  const submitExecutionContract = React.useCallback(async () => {
    setExecFeedback(null);
    let program;
    try {
      program = JSON.parse(execJson);
    } catch (e) {
      setExecFeedback({
        negative: true,
        content: 'Program must be valid JSON. Fix the text or use Reset program template.'
      });
      return;
    }
    if (execBitcoinLoading) {
      setExecFeedback({
        negative: true,
        content: 'Still checking Bitcoin service; wait a moment before publishing.'
      });
      return;
    }
    const nameOpt = execName.trim() || undefined;
    if (execBitcoinOn) {
      if (!execRegistryInvoice || !execRegistryInvoice.programDigest) {
        setExecFeedback({
          negative: true,
          content: 'Request a registry invoice first (step 1), pay it on-chain, then enter the txid.'
        });
        return;
      }
      const tid = String(execTxid || '').trim();
      if (!tid) {
        setExecFeedback({
          negative: true,
          content: 'Enter the Bitcoin transaction id that pays the registry invoice.'
        });
        return;
      }
    }

    const payload = execBitcoinOn
      ? {
        name: nameOpt,
        program,
        txid: String(execTxid || '').trim(),
        programDigest: execRegistryInvoice.programDigest
      }
      : { name: nameOpt, program };

    setExecBusy(true);
    try {
      const out = await hubJsonRpc('CreateExecutionContract', [payload]);
      if (!out.ok) {
        setExecFeedback({
          negative: true,
          content: describeHubRpcFailure(out.error, 'Check that this origin can reach the hub and try again.')
        });
        return;
      }
      const r = out.result;
      if (r && r.status === 'error') {
        const msg = r.message || 'Hub rejected publish.';
        const needsPayHelp = /bitcoin is enabled|l1 payment verification failed|registry invoice|pay the invoice/i.test(msg);
        const payHint = loadHubUiFeatureFlags().bitcoinPayments ? (
          <span>
            Pay from <Link to="/services/bitcoin/payments">Payments</Link> (regtest + admin token) or another wallet, then paste the funding txid and publish again.
          </span>
        ) : (
          <span>
            Pay from another wallet, or enable <strong>Bitcoin — Payments</strong> in Admin → Feature visibility and use Payments (regtest + admin token), then paste the funding txid and publish again.
          </span>
        );
        setExecFeedback({
          negative: true,
          content: needsPayHelp ? (
            <span>
              {msg}{' '}
              {payHint}
            </span>
          ) : (
            <span>
              {msg}{' '}
              If you requested a registry invoice and edited the program JSON afterward, request a new invoice so the digest matches.
            </span>
          )
        });
        return;
      }
      if (r && r.type === 'CreateExecutionContractResult' && (r.contract || r.id)) {
        const cid = r.id || (r.contract && r.contract.id);
        setExecName('');
        setExecRegistryInvoice(null);
        setExecTxid('');
        if (typeof window !== 'undefined' && window.sessionStorage) {
          try {
            window.sessionStorage.removeItem(EXEC_REGISTRY_DRAFT_STORAGE_KEY);
          } catch (_) {}
        }
        setRegistryAddressCopied(false);
        setExecFeedback({
          positive: true,
          content: (
            <span>
              Execution contract published to the hub registry.
              {cid ? (
                <>
                  {' '}
                  <Link to={`/contracts/${encodeURIComponent(cid)}`}>Open detail</Link>
                  {' '}to run on the hub.
                </>
              ) : null}
            </span>
          )
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('executionContractCreated', {
            detail: { contract: r.contract || null, id: cid }
          }));
        }
      } else {
        setExecFeedback({ negative: true, content: 'Unexpected response from hub.' });
      }
    } catch (e) {
      setExecFeedback({ negative: true, content: e && e.message ? e.message : String(e) });
    } finally {
      setExecBusy(false);
    }
  }, [execJson, execName, execBitcoinOn, execBitcoinLoading, execRegistryInvoice, execTxid]);

  return (
    <fabric-contracts class='fade-in'>
      <Segment>
        <section aria-labelledby="contracts-page-heading">
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
          role="banner"
        >
          <Button basic size="small" as={Link} to="/" aria-label="Back to home">
            <Icon name="arrow left" aria-hidden="true" />
            Home
          </Button>
          <Header as="h2" id="contracts-page-heading" style={{ margin: 0 }}>
            <Header.Content>Contracts</Header.Content>
          </Header>
        </div>
        </section>

        <Segment>
          {loading && (
            <div style={{ minHeight: '20vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader active inline="centered" />
            </div>
          )}
          {!loading && error && (
            <Message negative>
              <Message.Header>Could not load contracts</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>{error}</p>
              <div style={{ marginTop: '0.85em' }}>
                <Button size="small" type="button" onClick={() => void loadContracts()}>
                  <Icon name="refresh" />
                  Retry
                </Button>
              </div>
            </Message>
          )}
          {!loading && !error && (
            <>
              <section aria-labelledby="contracts-crowdfund-h4" aria-describedby="contracts-crowdfund-intro">
              <Header as="h4" id="contracts-crowdfund-h4">
                <Icon name="heart outline" color="red" aria-hidden="true" />
                Taproot crowdfunds (this hub)
              </Header>
              <div id="contracts-crowdfund-intro">
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>Hub-local vault campaigns</p>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    Crowdfunds use Taproot scripts on this node&apos;s Bitcoin connection; they are listed here for visibility alongside storage and execution contracts.
                    Manage campaigns, ACP PSBT, Payjoin, payout, and refund from{' '}
                    {uf.bitcoinCrowdfund ? (
                      <Link to="/services/bitcoin/crowdfunds">Crowdfunds</Link>
                    ) : (
                      <span>Crowdfunds (enable <strong>Bitcoin — Crowdfund</strong> in Admin → Feature visibility)</span>
                    )}.
                  </p>
                </Message>
              </div>
              <List divided relaxed style={{ marginBottom: '1.25em' }}>
                {crowdfundCampaigns.map((row) => {
                  if (!row) return null;
                  const cid = String(row.campaignId || '').trim();
                  const title = row.title || cid || 'Campaign';
                  return (
                    <List.Item key={cid || title}>
                      <List.Content>
                        <List.Header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35em' }}>
                          {uf.bitcoinCrowdfund ? (
                            <Link to="/services/bitcoin/crowdfunds">{title}</Link>
                          ) : (
                            <span>{title}</span>
                          )}
                          <Label size="mini" color="red" style={{ marginLeft: '0.15em' }}>
                            <Icon name="heart" />
                            Crowdfunds
                          </Label>
                          {cid ? (
                            <code style={{ fontSize: '0.8em', color: '#666' }} title="Campaign id">{cid}</code>
                          ) : null}
                        </List.Header>
                        <List.Description style={{ color: '#666' }}>
                          {row.address ? (
                            <span style={{ wordBreak: 'break-all' }}>Vault <code>{row.address}</code></span>
                          ) : (
                            'Vault address pending'
                          )}
                          {row.goalSats != null ? (
                            <span style={{ marginLeft: '0.5em' }}>· goal {formatSatsDisplay(row.goalSats)} sats</span>
                          ) : null}
                        </List.Description>
                      </List.Content>
                    </List.Item>
                  );
                })}
                {crowdfundCampaigns.length === 0 && (
                  <List.Item>
                    <List.Content>
                      <List.Description style={{ color: '#666' }}>
                        No Taproot crowdfund campaigns on this hub yet.
                        {uf.bitcoinCrowdfund ? (
                          <> Open <Link to="/services/bitcoin/crowdfunds">Crowdfunds</Link> to create one.</>
                        ) : (
                          <> Enable <strong>Bitcoin — Crowdfund</strong> in Admin → Feature visibility to add campaigns.</>
                        )}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                )}
              </List>
              </section>

              <section aria-labelledby="contracts-storage-h4" aria-describedby="contracts-storage-intro">
              <Header as="h4" id="contracts-storage-h4">
                <Icon name="cloud" aria-hidden="true" />
                Storage Contracts
              </Header>
              <div id="contracts-storage-intro">
              <Message info size="small" style={{ marginBottom: '1em' }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>L1 bond vs execution anchor</p>
                <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                  Storage contracts are created after a verified payment to the distribute invoice (<code>CreateDistributeInvoice</code> → pay → <code>CreateStorageContract</code>).
                  Execution contracts use an L1 registry fee when Bitcoin is enabled (see below); after publish you can run on the hub and on regtest anchor the run commitment (OP_RETURN) with an admin token from the contract detail page.
                </p>
              </Message>
              </div>
              <div style={{ marginBottom: '1em', display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                <span style={{ color: '#666', fontSize: '0.9em' }}>Filter:</span>
                <ButtonGroup size="small">
                  <Button
                    type="button"
                    active={filter === FILTER_ALL}
                    onClick={() => setFilter(FILTER_ALL)}
                  >
                    All
                  </Button>
                  <Button
                    type="button"
                    active={filter === FILTER_NEW}
                    onClick={() => setFilter(FILTER_NEW)}
                    title="First copy bonded"
                  >
                    New
                  </Button>
                  <Button
                    type="button"
                    active={filter === FILTER_PARTIAL}
                    onClick={() => setFilter(FILTER_PARTIAL)}
                    title="Some copies bonded, not all"
                  >
                    Partial
                  </Button>
                  <Button
                    type="button"
                    active={filter === FILTER_COMPLETE}
                    onClick={() => setFilter(FILTER_COMPLETE)}
                    title="All desired copies bonded"
                  >
                    Complete
                  </Button>
                </ButtonGroup>
              </div>
              <List divided relaxed>
              {filteredContracts.map((c) => {
                if (!c || !c.id) return null;
                const created = c.created ? new Date(c.created).toLocaleString() : '';
                const docContracts = contractsByDoc[c.document] || [];
                const acceptedCount = docContracts.length;
                const desired = Math.max(1, Number(c.desiredCopies || 1));
                const status = acceptedCount >= desired ? 'complete' : acceptedCount === 1 ? 'new' : 'partial';
                const statusLabel = status === 'complete' ? 'Complete' : status === 'new' ? 'New' : 'Partial';
                const statusColor = status === 'complete' ? 'green' : status === 'new' ? 'blue' : 'orange';
                return (
                  <List.Item key={c.id}>
                    <List.Content>
                      <List.Header>
                        <Link to={`/contracts/${encodeURIComponent(c.id)}`}>
                          {c.name || c.id}
                        </Link>
                        <Label size="mini" color="purple" style={{ marginLeft: '0.5em' }}>
                          <Icon name="cloud" />
                          Storage
                        </Label>
                        <Label size="mini" color={statusColor} style={{ marginLeft: '0.25em' }}>
                          {statusLabel}
                        </Label>
                        {desired > 1 && (
                          <Label size="mini" basic style={{ marginLeft: '0.25em' }}>
                            {acceptedCount}/{desired} copies
                          </Label>
                        )}
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {c.document ? `Document: ${c.document}` : 'Document storage contract'}
                        {created ? ` — ${created}` : ''}
                        {c.txid && (
                          <span style={{ marginLeft: '0.5em' }}>
                            {uf.bitcoinExplorer ? (
                              <Button size="mini" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(c.txid)}`} basic>
                                <Icon name="bitcoin" />
                                Tx
                              </Button>
                            ) : (
                              <code style={{ fontSize: '0.85em' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the tx viewer">{c.txid}</code>
                            )}
                          </span>
                        )}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                );
              })}
              {filteredContracts.length === 0 && !loading && !error && (
                <List.Item>
                  <List.Content>
                    <List.Description style={{ color: '#666' }}>
                      {storageContracts.length === 0 && executionContracts.length === 0 && crowdfundCampaigns.length === 0
                        ? 'No contracts yet.'
                        : `No storage contracts match "${filter}".`}
                    </List.Description>
                  </List.Content>
                </List.Item>
              )}
            </List>
              </section>

              <section aria-labelledby="contracts-execution-h4" aria-describedby="contracts-execution-desc">
              <Header as="h4" dividing id="contracts-execution-h4" style={{ marginTop: '1.5em' }}>
                <Icon name="microchip" aria-hidden="true" />
                Execution contracts
              </Header>
              <p id="contracts-execution-desc" style={{ color: '#666', marginBottom: '0.75em' }}>
                <strong>Registry:</strong> execution contracts are listed hub-wide. When this hub&apos;s Bitcoin service is available, publishing requires a real L1 payment: request a <code>CreateExecutionRegistryInvoice</code> address, pay at least the quoted sats, then submit the funding <code>txid</code> with <code>CreateExecutionContract</code> (same <code>POST /services/rpc</code> surface as <strong>Run on hub</strong> on the detail page).
                Without Bitcoin (local dev), the hub still accepts free registration so you can iterate on programs.
              </p>
              <Message info size="small" style={{ marginBottom: '1em' }}>
                <Message.Header>L1, deterministic runs, and network state</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                  <strong>Registry</strong> ties a <code>programDigest</code> to an on-chain payment when Bitcoin is enabled.
                  <strong> Runs</strong> produce a <code>runCommitmentHex</code> anyone can re-check (browser vs hub); regtest can <strong>OP_RETURN</strong>-anchor that digest.
                  The hub <strong>Beacon</strong> records epochs against Bitcoin block hash/height; <strong>sidechain</strong> state can advance via patches and follow L1 reorgs.
                  Reproducible epoch witnesses, <strong>Beacon Federation</strong> docs, and live manifest / epoch JSON links are in the federation panel below (avoid duplicating the same shortcuts here).
                </p>
              </Message>
              {uf.sidechain ? <DistributedFederationPanel /> : null}
              {execBitcoinLoading && (
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>Checking Bitcoin</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    Waiting for <code>/services/bitcoin</code> so we know whether registry publish requires an L1 invoice and txid.
                  </p>
                </Message>
              )}
              {!execBitcoinLoading && execBitcoinOn && (
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>L1-backed registry active</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    Use <strong>Request registry invoice</strong>, pay on-chain (e.g. from{' '}
                    {uf.bitcoinPayments ? (
                      <Link to="/services/bitcoin/payments">Payments</Link>
                    ) : (
                      <span>Payments (enable Bitcoin — Payments in Admin → Feature visibility)</span>
                    )}
                    {' '}with admin token on regtest), then paste the txid and <strong>Publish to registry</strong>.
                  </p>
                  {!hasAdmin ? (
                    <p style={{ margin: '0.5em 0 0', color: '#444' }}>
                      This browser is currently in non-admin mode, so Hub-wallet funding steps are blocked.
                      Keep using invoice + txid flow with an operator wallet, or load the setup token first.
                    </p>
                  ) : null}
                </Message>
              )}
              {!execBitcoinLoading && !execBitcoinOn && (
                <Message warning size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>No Bitcoin service</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    Publishing skips L1 verification until the hub exposes a working <code>/services/bitcoin</code> connection.
                  </p>
                </Message>
              )}
              {execFeedback && (
                <Message
                  positive={!!execFeedback.positive}
                  negative={!!execFeedback.negative}
                  info={!!execFeedback.info}
                  content={execFeedback.content}
                  onDismiss={() => setExecFeedback(null)}
                  style={{ marginBottom: '1em' }}
                />
              )}
              <Form
                style={{ marginBottom: '1.25em' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitExecutionContract();
                }}
              >
                <Form.Field>
                  <label htmlFor="fabric-exec-name">Name (optional)</label>
                  <Form.Input
                    id="fabric-exec-name"
                    value={normalizeOptionalInputText(execName)}
                    onChange={(e, d) => setExecName(normalizeOptionalInputText(d && d.value))}
                    placeholder="e.g. Ping demo"
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="fabric-exec-program-json">Program (JSON)</label>
                  <TextArea
                    id="fabric-exec-program-json"
                    value={execJson}
                    onChange={(e, d) => setExecJson(d.value)}
                    rows={14}
                    style={{ fontFamily: 'monospace', fontSize: '0.85em' }}
                  />
                </Form.Field>
                {execBitcoinOn && (
                  <Form.Field>
                    <label>Registry fee (sats)</label>
                    <Form.Input
                      type="number"
                      min={1}
                      step={1}
                      value={execAmountSats}
                      onChange={(e, d) => setExecAmountSats(d.value)}
                      placeholder={String(DEFAULT_REGISTRY_FEE_SATS)}
                    />
                  </Form.Field>
                )}
                {execBitcoinOn && execRegistryInvoice && (
                  <Message size="small" style={{ marginBottom: '1em' }}>
                    <Message.Header>Pending registry invoice</Message.Header>
                    <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                      Pay at least the quoted sats to the hub address below, then paste the funding transaction id.
                    </p>
                    <p style={{ margin: '0.5em 0 0', wordBreak: 'break-all' }}>
                      <strong>Pay ≥</strong> {formatSatsDisplay(execRegistryInvoice.amountSats)} sats to{' '}
                      <code>{execRegistryInvoice.address}</code>
                      {' '}(network: {String(execRegistryInvoice.network || '—').trim() || '—'}).
                    </p>
                    <div style={{ marginTop: '0.5em', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5em' }}>
                      <Button
                        type="button"
                        size="small"
                        basic
                        icon
                        onClick={copyRegistryInvoiceAddress}
                        title="Copy payment address"
                        aria-label="Copy registry invoice payment address"
                      >
                        <Icon name="copy outline" />
                      </Button>
                      {registryAddressCopied && (
                        <span style={{ fontSize: '0.85em', color: '#276749' }}>Copied</span>
                      )}
                    </div>
                    <p style={{ margin: '0.75em 0 0', fontSize: '0.85em', color: '#555' }}>
                      Program digest: <code style={{ wordBreak: 'break-all' }}>{execRegistryInvoice.programDigest}</code>
                    </p>
                    <p style={{ margin: '0.5em 0 0', fontSize: '0.8em', color: '#777' }}>
                      If you edit the program JSON after this invoice, request a new invoice so the digest still matches.
                    </p>
                  </Message>
                )}
                {execBitcoinOn && (
                  <Form.Field>
                    <label htmlFor="fabric-exec-registry-txid">Funding txid (after you pay the invoice)</label>
                    <Form.Input
                      id="fabric-exec-registry-txid"
                      value={execTxid}
                      onChange={(e, d) => setExecTxid(d.value)}
                      placeholder="64-character transaction id"
                    />
                  </Form.Field>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em', alignItems: 'center' }}>
                  {execBitcoinOn && (
                    <Button
                      type="button"
                      color="blue"
                      loading={execInvoiceBusy}
                      disabled={execInvoiceBusy || execBusy || execBitcoinLoading}
                      title={execBitcoinLoading ? 'Wait until Bitcoin status is known' : undefined}
                      onClick={() => void requestExecutionRegistryInvoice()}
                    >
                      <Icon name="bitcoin" />
                      Request registry invoice
                    </Button>
                  )}
                  <Button
                    primary
                    type="submit"
                    loading={execBusy}
                    disabled={execBusy || execInvoiceBusy || execBitcoinLoading}
                    title={execBitcoinLoading ? 'Wait until Bitcoin status is known' : undefined}
                  >
                    <Icon name="plus" />
                    {execBitcoinOn ? 'Publish to registry' : 'Publish to registry (no L1)'}
                  </Button>
                  <Button
                    type="button"
                    basic
                    disabled={execBusy || execInvoiceBusy}
                    onClick={() => {
                      setExecJson(DEFAULT_EMPTY_EXEC_PROGRAM);
                      setExecFeedback(null);
                      setExecRegistryInvoice(null);
                      setExecTxid('');
                      setRegistryAddressCopied(false);
                    }}
                  >
                    <Icon name="undo" />
                    Reset program template
                  </Button>
                </div>
              </Form>
              <List divided relaxed>
                {executionContracts.map((c) => {
                  if (!c || !c.id) return null;
                  const created = c.created ? new Date(c.created).toLocaleString() : '';
                  const stepCount = c.program && Array.isArray(c.program.steps) ? c.program.steps.length : null;
                  const stepSummary = stepCount != null
                    ? `${stepCount} step${stepCount === 1 ? '' : 's'}`
                    : 'Program';
                  return (
                    <List.Item key={c.id}>
                      <List.Content>
                        <List.Header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35em' }}>
                          <Link to={`/contracts/${encodeURIComponent(c.id)}`}>
                            {c.name || c.id}
                          </Link>
                          <Label size="mini" color="teal" style={{ marginLeft: '0.15em' }}>
                            <Icon name="code" />
                            Execution
                          </Label>
                          <Button
                            size="mini"
                            basic
                            as={Link}
                            to={`/contracts/${encodeURIComponent(c.id)}`}
                            title="Open detail — run locally or on hub"
                          >
                            <Icon name="angle double right" />
                            Open
                          </Button>
                        </List.Header>
                        <List.Description style={{ color: '#666' }}>
                          {stepSummary}
                          {created ? ` — ${created}` : ''}
                          {c.txid && (
                            <span style={{ marginLeft: '0.5em' }}>
                              {uf.bitcoinExplorer ? (
                                <Button
                                  size="mini"
                                  as={Link}
                                  to={`/services/bitcoin/transactions/${encodeURIComponent(c.txid)}`}
                                  basic
                                  title="Open registry funding transaction on this hub"
                                >
                                  <Icon name="bitcoin" />
                                  Tx
                                </Button>
                              ) : (
                                <code style={{ fontSize: '0.85em' }} title="Enable Bitcoin — Block & transaction detail routes in Admin → Feature visibility to open the tx viewer">{c.txid}</code>
                              )}
                            </span>
                          )}
                        </List.Description>
                      </List.Content>
                    </List.Item>
                  );
                })}
                {executionContracts.length === 0 && (
                  <List.Item>
                    <List.Content>
                      <List.Description style={{ color: '#666' }}>
                        No execution contracts on this hub yet. Publish from the form above
                        {execBitcoinOn ? ' (registry invoice + funding txid when Bitcoin is on)' : ''}.
                      </List.Description>
                    </List.Content>
                  </List.Item>
                )}
              </List>
              </section>
            </>
          )}
          {!loading && uf.bitcoinLightning ? (
              <section aria-labelledby="contracts-lightning-h4">
              <div
                style={{
                  marginTop: '1.5em',
                  paddingTop: '1em',
                  borderTop: '1px solid rgba(34, 36, 38, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.5em'
                }}
              >
                <Header as="h4" id="contracts-lightning-h4" style={{ margin: 0 }}>
                  <Icon name="bolt" color="yellow" aria-hidden="true" />
                  <Header.Content>Lightning Channels</Header.Content>
                </Header>
                <Button as={Link} to="/services/bitcoin" basic size="small" title="Open Bitcoin / Lightning dashboard">
                  Manage
                </Button>
              </div>
              {lightningChannels.length === 0 ? (
                <p style={{ color: '#666' }}>No Lightning channels. Open a channel from the Bitcoin page.</p>
              ) : (
                <Table celled compact size='small'>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Peer</Table.HeaderCell>
                      <Table.HeaderCell>State</Table.HeaderCell>
                      <Table.HeaderCell>Capacity</Table.HeaderCell>
                      <Table.HeaderCell>Our balance</Table.HeaderCell>
                      <Table.HeaderCell>Short channel ID</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {lightningChannels.map((ch, idx) => {
                      const chId = ch.channel_id || ch.funding_txid || idx;
                      const toUrl = `/services/bitcoin/channels/${encodeURIComponent(chId)}`;
                      return (
                        <Table.Row
                          key={chId}
                          style={{ cursor: uf.bitcoinLightning ? 'pointer' : 'default' }}
                          onClick={() => { if (uf.bitcoinLightning) navigate(toUrl); }}
                        >
                          <Table.Cell>
                            <code style={{ fontSize: '0.85em' }}>{trimHash(ch.peer_id || ch.funding_txid || '')}</code>
                          </Table.Cell>
                          <Table.Cell>{ch.state || '—'}</Table.Cell>
                          <Table.Cell>
                            {ch.amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(ch.amount_msat) / 1000))} sats` : (ch.channel_sat != null ? `${formatSatsDisplay(ch.channel_sat)} sats` : '—')}
                          </Table.Cell>
                          <Table.Cell>
                            {ch.our_amount_msat != null ? `${formatSatsDisplay(Math.floor(Number(ch.our_amount_msat) / 1000))} sats` : '—'}
                          </Table.Cell>
                          <Table.Cell>
                            <code style={{ fontSize: '0.8em' }}>{ch.short_channel_id || '—'}</code>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>
              )}
              </section>
          ) : null}
        </Segment>
      </Segment>
    </fabric-contracts>
  );
}

module.exports = ContractList;

