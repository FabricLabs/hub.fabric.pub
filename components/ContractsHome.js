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
  Message,
  Step,
  Menu
} = require('semantic-ui-react');
const { fetchLightningChannels, loadUpstreamSettings, fetchCrowdfundingCampaigns } = require('../functions/bitcoinClient');
const { hubJsonRpc } = require('../functions/sidechainHubClient');
const { describeHubRpcFailure } = require('../functions/hubRpcHints');
const DistributedFederationPanel = require('./DistributedFederationPanel');
const TrackedApplicationContractsPanel = require('./TrackedApplicationContractsPanel');
const {
  loadHubUiFeatureFlags,
  subscribeHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const HubPagination = require('./HubPagination');
const { useHubListPagination } = require('../functions/hubListPagination');
const strings = require('../locales/en');

const common = strings.common;
const net = strings.network;
const ch = net.contractsHome;
const chx = ch.execution;

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

/**
 * Hub contracts home — storage bonds, execution registry, tracked application
 * ARC publishes, crowdfunds, and Lightning channel visibility.
 * Route: `/contracts` (also exported historically as `ContractList`).
 */
function ContractsHome () {
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
      if (typeof draft.execTxid === 'string') setExecTxid(normalizeOptionalInputText(draft.execTxid));
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
        setError(reason && reason.message ? reason.message : ch.error.fallback);
        setContracts([]);
      } else {
        const contractsRes = contractsSettled.value;
        try {
          const body = await contractsRes.json();
          if (!contractsRes.ok || !body || body.status === 'error') {
            setError((body && body.message) || ch.error.fallback);
            setContracts([]);
          } else {
            const list = Array.isArray(body.contracts) ? body.contracts : (body.result || []);
            setContracts(list || []);
            if (background) setError(null);
          }
        } catch (parseErr) {
          setError(ch.error.unreadable);
          setContracts([]);
        }
      }
    } catch (e) {
      setError(e && e.message ? e.message : ch.error.fallback);
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

  const storageContractsResetKey = `${filter}:${filteredContracts.length}:${filteredContracts[0] && filteredContracts[0].id}:${filteredContracts[filteredContracts.length - 1] && filteredContracts[filteredContracts.length - 1].id}`;
  const {
    slice: storageContractsSlice,
    page: storageListActivePage,
    totalPages: storageTotalPages,
    rangeFrom: storageRangeFrom,
    rangeTo: storageRangeTo,
    total: storageListTotal,
    setPage: setStorageListPage
  } = useHubListPagination(filteredContracts, storageContractsResetKey);

  const executionResetKey = `${executionContracts.length}:${executionContracts[0] && executionContracts[0].id}:${executionContracts[executionContracts.length - 1] && executionContracts[executionContracts.length - 1].id}`;
  const {
    slice: executionContractsSlice,
    page: executionListActivePage,
    totalPages: executionTotalPages,
    rangeFrom: executionRangeFrom,
    rangeTo: executionRangeTo,
    total: executionListTotal,
    setPage: setExecutionListPage
  } = useHubListPagination(executionContracts, executionResetKey);

  const requestExecutionRegistryInvoice = React.useCallback(async () => {
    setExecFeedback(null);
    if (execBitcoinLoading) {
      setExecFeedback({ negative: true, content: chx.feedback.stillChecking });
      return;
    }
    let program;
    try {
      program = JSON.parse(execJson);
    } catch (e) {
      setExecFeedback({
        negative: true,
        content: chx.feedback.badJson
      });
      return;
    }
    const amountSats = Number(execAmountSats);
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      setExecFeedback({ negative: true, content: chx.feedback.badFee });
      return;
    }
    const nameOpt = execName.trim() || undefined;
    setExecInvoiceBusy(true);
    try {
      const out = await hubJsonRpc('CreateExecutionRegistryInvoice', [{ program, amountSats, name: nameOpt }]);
      if (!out.ok) {
        setExecFeedback({
          negative: true,
          content: describeHubRpcFailure(out.error, chx.feedback.invoiceHint)
        });
        return;
      }
      const r = out.result;
      if (r && r.status === 'error') {
        setExecFeedback({ negative: true, content: r.message || chx.feedback.invoiceRejected });
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
      setExecFeedback({ negative: true, content: chx.feedback.invoiceUnexpected });
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
        content: chx.feedback.badJson
      });
      return;
    }
    if (execBitcoinLoading) {
      setExecFeedback({
        negative: true,
        content: chx.feedback.stillCheckingPublish
      });
      return;
    }
    const nameOpt = execName.trim() || undefined;
    if (execBitcoinOn) {
      if (!execRegistryInvoice || !execRegistryInvoice.programDigest) {
        setExecFeedback({
          negative: true,
          content: chx.feedback.needInvoice
        });
        return;
      }
      const tid = String(execTxid || '').trim();
      if (!tid) {
        setExecFeedback({
          negative: true,
          content: chx.feedback.needTxid
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
          content: describeHubRpcFailure(out.error, chx.feedback.publishHint)
        });
        return;
      }
      const r = out.result;
      if (r && r.status === 'error') {
        const msg = r.message || chx.feedback.publishRejected;
        const needsPayHelp = /bitcoin is enabled|l1 payment verification failed|registry invoice|pay the invoice/i.test(msg);
        const payHint = loadHubUiFeatureFlags().bitcoinPayments ? (
          <span>
            {chx.feedback.payBefore} <Link to="/payments">{chx.paymentsLink}</Link> {chx.feedback.payAfter}
          </span>
        ) : (
          <span>
            {chx.feedback.payOff}
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
              {chx.feedback.digestHint}
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
              {chx.feedback.published}
              {cid ? (
                <>
                  {' '}
                  <Link to={`/contracts/${encodeURIComponent(cid)}`}>{chx.feedback.openIt}</Link>
                  {' '}{chx.feedback.toRun}
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
        setExecFeedback({ negative: true, content: chx.feedback.unexpected });
      }
    } catch (e) {
      setExecFeedback({ negative: true, content: e && e.message ? e.message : String(e) });
    } finally {
      setExecBusy(false);
    }
  }, [execJson, execName, execBitcoinOn, execBitcoinLoading, execRegistryInvoice, execTxid]);

  const registryStep = !execBitcoinOn
    ? 2
    : (!execRegistryInvoice ? 0 : (!String(execTxid || '').trim() ? 1 : 2));

  const scrollToSection = React.useCallback((id) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <fabric-contracts class='fade-in'>
      <Segment>
        <section aria-labelledby="contracts-page-heading">
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.35em' }}
            role="banner"
          >
            <Button basic size="small" as={Link} to="/">
              <Icon name="arrow left" aria-hidden="true" />
              {ch.home}
            </Button>
            <Header as="h2" id="contracts-page-heading" style={{ margin: 0 }}>
              <Header.Content>{ch.title}</Header.Content>
            </Header>
            <Button
              basic
              size="small"
              type="button"
              loading={loading}
              disabled={loading}
              onClick={() => void loadContracts()}
              title={ch.refreshTitle}
            >
              <Icon name="refresh" />
              {common.actions.refresh}
            </Button>
          </div>
          <p style={{ margin: '0 0 0.75em', maxWidth: '48rem', lineHeight: 1.55, color: '#555' }}>
            {ch.intro}
          </p>
          <Menu secondary size="small" style={{ marginBottom: '0.75em', flexWrap: 'wrap' }} aria-label={ch.sectionsLabel}>
            <Menu.Item
              link
              onClick={() => scrollToSection('contracts-application-h4')}
              content={ch.sections.application}
            />
            <Menu.Item
              link
              onClick={() => scrollToSection('contracts-storage-h4')}
              content={ch.sections.storage}
            />
            <Menu.Item
              link
              onClick={() => scrollToSection('contracts-execution-h4')}
              content={ch.sections.execution}
            />
            <Menu.Item
              link
              onClick={() => scrollToSection('contracts-crowdfund-h4')}
              content={ch.sections.crowdfunds}
            />
            {uf.bitcoinLightning ? (
              <Menu.Item
                link
                onClick={() => scrollToSection('contracts-lightning-h4')}
                content={ch.sections.lightning}
              />
            ) : null}
            <Menu.Item
              as={Link}
              to="/settings/admin/beacon-federation"
              content={ch.sections.beacon}
            />
          </Menu>
          <div
            id="contracts-summary"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45em', marginBottom: '1em' }}
            aria-live="polite"
          >
            <Label size="small" basic>
              <Icon name="file code outline" />
              {ch.summary.application}
            </Label>
            <Label size="small" color="purple" basic={loading}>
              <Icon name="cloud" />
              {loading ? `${ch.sections.storage}: ${ch.summary.pending}` : ch.summary.storage(storageContracts.length)}
            </Label>
            <Label size="small" color="teal" basic={loading}>
              <Icon name="microchip" />
              {loading ? `${ch.sections.execution}: ${ch.summary.pending}` : ch.summary.execution(executionContracts.length)}
            </Label>
            <Label size="small" color="red" basic={loading}>
              <Icon name="heart" />
              {loading ? `${ch.sections.crowdfunds}: ${ch.summary.pending}` : ch.summary.crowdfunds(crowdfundCampaigns.length)}
            </Label>
            {uf.bitcoinLightning ? (
              <Label size="small" color="yellow" basic={loading}>
                <Icon name="bolt" />
                {loading ? `${ch.sections.lightning}: ${ch.summary.pending}` : ch.summary.channels(lightningChannels.length)}
              </Label>
            ) : null}
          </div>
        </section>

        <Segment>
          {loading && (
            <Message info size="small" style={{ marginBottom: '1em' }} role="status">
              <Message.Header>
                <Loader active inline size="tiny" style={{ marginRight: '0.5em' }} />
                {ch.loading.heading}
              </Message.Header>
              <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                {ch.loading.body(!!uf.bitcoinLightning)}
              </p>
            </Message>
          )}
          {error && (
            <Message negative role="alert">
              <Message.Header>{ch.error.heading}</Message.Header>
              <p style={{ margin: '0.35em 0 0' }}>{error}</p>
              <div style={{ marginTop: '0.85em' }}>
                <Button size="small" type="button" onClick={() => void loadContracts()}>
                  <Icon name="refresh" />
                  {common.actions.retry}
                </Button>
              </div>
            </Message>
          )}

          <section aria-labelledby="contracts-application-h4" style={{ marginBottom: '1.25em' }}>
            <Header as="h4" id="contracts-application-h4" dividing>
              <Icon name="sitemap" aria-hidden="true" />
              {ch.application.heading}
            </Header>
            <Message info size="small" style={{ marginBottom: '0.75em' }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>{ch.application.infoHeading}</p>
              <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                {ch.application.bodyBefore}{' '}
                <Link to="/settings/admin/beacon-federation">{ch.application.beaconLink}</Link>.
              </p>
              <details className="hub-developer-details" style={{ marginTop: '0.35em' }}>
                <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#555' }}>{ch.application.developer}</p>
              </details>
            </Message>
            <TrackedApplicationContractsPanel embedded />
          </section>

              <section aria-labelledby="contracts-crowdfund-h4" aria-describedby="contracts-crowdfund-intro">
              <Header as="h4" id="contracts-crowdfund-h4" dividing>
                <Icon name="heart outline" color="red" aria-hidden="true" />
                {ch.crowdfunds.heading}
              </Header>
              <div id="contracts-crowdfund-intro">
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>{ch.crowdfunds.infoHeading}</p>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    {ch.crowdfunds.bodyBefore}{' '}
                    {uf.bitcoinCrowdfund ? (
                      <Link to="/services/bitcoin/crowdfunds">{ch.crowdfunds.link}</Link>
                    ) : (
                      <span>{ch.crowdfunds.linkOff}</span>
                    )}.
                  </p>
                </Message>
              </div>
              <List divided relaxed style={{ marginBottom: '1.25em' }}>
                {crowdfundCampaigns.map((row) => {
                  if (!row) return null;
                  const cid = String(row.campaignId || '').trim();
                  const title = row.title || cid || ch.crowdfunds.fallbackTitle;
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
                            {ch.crowdfunds.tag}
                          </Label>
                          {cid ? (
                            <code style={{ fontSize: '0.8em', color: '#666' }} title={ch.crowdfunds.idTitle}>{cid}</code>
                          ) : null}
                        </List.Header>
                        <List.Description style={{ color: '#666' }}>
                          {row.address ? (
                            <span style={{ wordBreak: 'break-all' }}>{ch.crowdfunds.vault} <code>{row.address}</code></span>
                          ) : (
                            ch.crowdfunds.vaultPending
                          )}
                          {row.goalSats != null ? (
                            <span style={{ marginLeft: '0.5em' }}>{ch.crowdfunds.goal(row.goalSats)}</span>
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
                        {ch.crowdfunds.empty}
                        {uf.bitcoinCrowdfund ? (
                          <> {ch.crowdfunds.emptyOpen} <Link to="/services/bitcoin/crowdfunds">{ch.crowdfunds.link}</Link> {ch.crowdfunds.emptyOpenAfter}</>
                        ) : (
                          <> {ch.crowdfunds.emptyOff}</>
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
                {ch.storage.heading}
              </Header>
              <div id="contracts-storage-intro">
              <Message info size="small" style={{ marginBottom: '1em' }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#333' }}>{ch.storage.infoHeading}</p>
                <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                  {ch.storage.body}
                </p>
                <p style={{ margin: '0.35em 0 0', color: '#666', fontSize: '0.88em' }}>
                  {ch.storage.flowLabel} {ch.storage.flowSteps}
                </p>
                <details className="hub-developer-details" style={{ marginTop: '0.35em' }}>
                  <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                  <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#555' }}>
                    {ch.storage.flowRpc} <code>CreateDistributeInvoice</code> → {ch.storage.flowPay} → <code>CreateStorageContract</code>
                  </p>
                  <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#555' }}>{ch.storage.developer}</p>
                </details>
              </Message>
              </div>
              <div style={{ marginBottom: '1em', display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                <span id="contracts-storage-filter-label" style={{ color: '#666', fontSize: '0.9em' }}>{ch.storage.filterLabel}</span>
                <ButtonGroup size="small" role="group" aria-labelledby="contracts-storage-filter-label">
                  <Button
                    type="button"
                    active={filter === FILTER_ALL}
                    onClick={() => setFilter(FILTER_ALL)}
                  >
                    {ch.storage.filters.all}
                  </Button>
                  <Button
                    type="button"
                    active={filter === FILTER_NEW}
                    onClick={() => setFilter(FILTER_NEW)}
                    title={ch.storage.filters.newTitle}
                  >
                    {ch.storage.filters.new}
                  </Button>
                  <Button
                    type="button"
                    active={filter === FILTER_PARTIAL}
                    onClick={() => setFilter(FILTER_PARTIAL)}
                    title={ch.storage.filters.partialTitle}
                  >
                    {ch.storage.filters.partial}
                  </Button>
                  <Button
                    type="button"
                    active={filter === FILTER_COMPLETE}
                    onClick={() => setFilter(FILTER_COMPLETE)}
                    title={ch.storage.filters.completeTitle}
                  >
                    {ch.storage.filters.complete}
                  </Button>
                </ButtonGroup>
              </div>
              <List divided relaxed>
              {storageContractsSlice.map((c) => {
                if (!c || !c.id) return null;
                const created = c.created ? new Date(c.created).toLocaleString() : '';
                const docContracts = contractsByDoc[c.document] || [];
                const acceptedCount = docContracts.length;
                const desired = Math.max(1, Number(c.desiredCopies || 1));
                const status = acceptedCount >= desired ? 'complete' : acceptedCount === 1 ? 'new' : 'partial';
                const statusLabel = status === 'complete'
                  ? ch.storage.filters.complete
                  : status === 'new' ? ch.storage.filters.new : ch.storage.filters.partial;
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
                          {ch.storage.tag}
                        </Label>
                        <Label size="mini" color={statusColor} style={{ marginLeft: '0.25em' }}>
                          {statusLabel}
                        </Label>
                        {desired > 1 && (
                          <Label size="mini" basic style={{ marginLeft: '0.25em' }}>
                            {ch.storage.copies(acceptedCount, desired)}
                          </Label>
                        )}
                      </List.Header>
                      <List.Description style={{ color: '#666' }}>
                        {c.document ? ch.storage.document(c.document) : ch.storage.documentFallback}
                        {created ? ` · ${created}` : ''}
                        {c.txid && (
                          <span style={{ marginLeft: '0.5em' }}>
                            {uf.bitcoinExplorer ? (
                              <Button size="mini" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(c.txid)}`} basic>
                                <Icon name="bitcoin" />
                                {ch.storage.transaction}
                              </Button>
                            ) : (
                              <code style={{ fontSize: '0.85em' }} title={net.explorerOff}>{c.txid}</code>
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
                        ? ch.storage.emptyAll
                        : (ch.storage.empty[filter] || ch.storage.empty.all)}
                    </List.Description>
                  </List.Content>
                </List.Item>
              )}
            </List>
            {storageListTotal > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.5em',
                  marginTop: '0.75em'
                }}
              >
                <span style={{ color: '#666', fontSize: '0.88em' }}>
                  {net.range(storageRangeFrom, storageRangeTo, storageListTotal)}
                </span>
                <HubPagination
                  activePage={storageListActivePage}
                  totalPages={storageTotalPages}
                  onPageChange={(e, d) => setStorageListPage(d.activePage)}
                  disabled={loading}
                  style={{ marginTop: 0, flex: '1 1 auto', minWidth: 0 }}
                />
              </div>
            )}
              </section>

              <section aria-labelledby="contracts-execution-h4" aria-describedby="contracts-execution-desc">
              <Header as="h4" dividing id="contracts-execution-h4" style={{ marginTop: '1.5em' }}>
                <Icon name="microchip" aria-hidden="true" />
                {chx.heading}
              </Header>
              <p id="contracts-execution-desc" style={{ color: '#666', marginBottom: '0.35em' }}>
                {chx.description}
              </p>
              <details className="hub-developer-details" style={{ marginBottom: '0.75em' }}>
                <summary style={{ cursor: 'pointer', color: '#666' }}>{common.developerDetails}</summary>
                <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#666' }}>{chx.descriptionDeveloper}</p>
              </details>
              <Message info size="small" style={{ marginBottom: '1em' }}>
                <Message.Header>{chx.checksHeading}</Message.Header>
                <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                  {chx.checksBody}
                </p>
                <details className="hub-developer-details" style={{ marginTop: '0.35em' }}>
                  <summary style={{ cursor: 'pointer' }}>{common.developerDetails}</summary>
                  <p style={{ margin: '0.35em 0 0', fontSize: '0.9em', color: '#555' }}>{chx.checksDeveloper}</p>
                </details>
              </Message>
              {uf.sidechain ? <DistributedFederationPanel /> : null}
              {execBitcoinLoading && (
                <Message info size="small" style={{ marginBottom: '1em' }} role="status">
                  <Message.Header>{chx.checkingHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    {chx.checkingBody}
                  </p>
                </Message>
              )}
              {!execBitcoinLoading && execBitcoinOn && (
                <Message info size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>{chx.paidHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    {chx.paidBefore}{' '}
                    {uf.bitcoinPayments ? (
                      <Link to="/payments">{chx.paymentsLink}</Link>
                    ) : (
                      <span>{chx.paymentsOff}</span>
                    )}
                    {' '}{chx.paidAfter}
                  </p>
                  {!hasAdmin ? (
                    <p style={{ margin: '0.5em 0 0', color: '#444' }}>
                      {chx.noAdmin}
                    </p>
                  ) : null}
                </Message>
              )}
              {!execBitcoinLoading && !execBitcoinOn && (
                <Message warning size="small" style={{ marginBottom: '1em' }}>
                  <Message.Header>{chx.noBitcoinHeading}</Message.Header>
                  <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                    {chx.noBitcoinBody}
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
                {execBitcoinOn && (
                  <Step.Group size="small" fluid unstackable style={{ marginBottom: '1em', overflowX: 'auto' }}>
                    <Step completed={registryStep > 0} active={registryStep === 0}>
                      <Icon name="file code outline" />
                      <Step.Content>
                        <Step.Title>{chx.steps.program}</Step.Title>
                        <Step.Description>{chx.steps.programDescription}</Step.Description>
                      </Step.Content>
                    </Step>
                    <Step completed={registryStep > 1} active={registryStep === 1}>
                      <Icon name="bitcoin" />
                      <Step.Content>
                        <Step.Title>{chx.steps.pay}</Step.Title>
                        <Step.Description>{chx.steps.payDescription}</Step.Description>
                      </Step.Content>
                    </Step>
                    <Step completed={false} active={registryStep === 2}>
                      <Icon name="check" />
                      <Step.Content>
                        <Step.Title>{chx.steps.publish}</Step.Title>
                        <Step.Description>{chx.steps.publishDescription}</Step.Description>
                      </Step.Content>
                    </Step>
                  </Step.Group>
                )}
                <Form.Field>
                  <label htmlFor="fabric-exec-name">{chx.fields.name}</label>
                  <Form.Input
                    id="fabric-exec-name"
                    value={normalizeOptionalInputText(execName)}
                    onChange={(e, d) => setExecName(normalizeOptionalInputText(d && d.value))}
                    placeholder={chx.fields.namePlaceholder}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="fabric-exec-program-json">{chx.fields.program}</label>
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
                    <label htmlFor="fabric-exec-registry-fee-sats">{chx.fields.fee}</label>
                    <Form.Input
                      id="fabric-exec-registry-fee-sats"
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
                    <Message.Header>{chx.invoice.heading}</Message.Header>
                    <p style={{ margin: '0.35em 0 0', color: '#444' }}>
                      {chx.invoice.body}
                    </p>
                    <p style={{ margin: '0.5em 0 0', wordBreak: 'break-all' }}>
                      <strong>{chx.invoice.payAtLeast(execRegistryInvoice.amountSats)}</strong>{' '}
                      <code>{execRegistryInvoice.address}</code>
                      {' '}{chx.invoice.network(String(execRegistryInvoice.network || '').trim() || common.none)}
                    </p>
                    <div style={{ marginTop: '0.5em', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5em' }}>
                      <Button
                        type="button"
                        size="small"
                        basic
                        icon
                        labelPosition="left"
                        onClick={copyRegistryInvoiceAddress}
                      >
                        <Icon name="copy outline" />
                        {chx.invoice.copy}
                      </Button>
                      {registryAddressCopied && (
                        <span style={{ fontSize: '0.85em', color: '#276749' }} role="status">{common.actions.copied}</span>
                      )}
                    </div>
                    <p style={{ margin: '0.75em 0 0', fontSize: '0.85em', color: '#555' }}>
                      {chx.invoice.digest} <code style={{ wordBreak: 'break-all' }}>{execRegistryInvoice.programDigest}</code>
                    </p>
                    <p style={{ margin: '0.5em 0 0', fontSize: '0.8em', color: '#777' }}>
                      {chx.invoice.digestNote}
                    </p>
                  </Message>
                )}
                {execBitcoinOn && (
                  <Form.Field>
                    <label htmlFor="fabric-exec-registry-txid">{chx.fields.txid}</label>
                    <Form.Input
                      id="fabric-exec-registry-txid"
                      value={normalizeOptionalInputText(execTxid)}
                      onChange={(e, d) => setExecTxid(normalizeOptionalInputText(d && d.value))}
                      placeholder={chx.fields.txidPlaceholder}
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
                      title={execBitcoinLoading ? chx.waitTitle : undefined}
                      onClick={() => void requestExecutionRegistryInvoice()}
                    >
                      <Icon name="bitcoin" />
                      {chx.requestInvoice}
                    </Button>
                  )}
                  <Button
                    primary
                    type="submit"
                    loading={execBusy}
                    disabled={execBusy || execInvoiceBusy || execBitcoinLoading}
                    title={execBitcoinLoading ? chx.waitTitle : undefined}
                  >
                    <Icon name="plus" />
                    {chx.publish}
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
                    {chx.reset}
                  </Button>
                </div>
              </Form>
              <List divided relaxed>
                {executionContractsSlice.map((c) => {
                  if (!c || !c.id) return null;
                  const created = c.created ? new Date(c.created).toLocaleString() : '';
                  const stepCount = c.program && Array.isArray(c.program.steps) ? c.program.steps.length : null;
                  const stepSummary = stepCount != null
                    ? chx.list.steps(stepCount)
                    : chx.list.programFallback;
                  return (
                    <List.Item key={c.id}>
                      <List.Content>
                        <List.Header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35em' }}>
                          <Link to={`/contracts/${encodeURIComponent(c.id)}`}>
                            {c.name || c.id}
                          </Link>
                          <Label size="mini" color="teal" style={{ marginLeft: '0.15em' }}>
                            <Icon name="code" />
                            {chx.list.tag}
                          </Label>
                          <Button
                            size="mini"
                            basic
                            as={Link}
                            to={`/contracts/${encodeURIComponent(c.id)}`}
                            title={chx.list.openTitle}
                          >
                            <Icon name="angle double right" />
                            {chx.list.open}
                          </Button>
                        </List.Header>
                        <List.Description style={{ color: '#666' }}>
                          {stepSummary}
                          {created ? ` · ${created}` : ''}
                          {c.txid && (
                            <span style={{ marginLeft: '0.5em' }}>
                              {uf.bitcoinExplorer ? (
                                <Button
                                  size="mini"
                                  as={Link}
                                  to={`/services/bitcoin/transactions/${encodeURIComponent(c.txid)}`}
                                  basic
                                  title={chx.list.transactionTitle}
                                >
                                  <Icon name="bitcoin" />
                                  {ch.storage.transaction}
                                </Button>
                              ) : (
                                <code style={{ fontSize: '0.85em' }} title={net.explorerOff}>{c.txid}</code>
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
                        {chx.list.empty}
                      </List.Description>
                    </List.Content>
                  </List.Item>
                )}
              </List>
              {executionListTotal > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.5em',
                    marginTop: '0.75em'
                  }}
                >
                  <span style={{ color: '#666', fontSize: '0.88em' }}>
                    {net.range(executionRangeFrom, executionRangeTo, executionListTotal)}
                  </span>
                  <HubPagination
                    activePage={executionListActivePage}
                    totalPages={executionTotalPages}
                    onPageChange={(e, d) => setExecutionListPage(d.activePage)}
                    disabled={loading}
                    style={{ marginTop: 0, flex: '1 1 auto', minWidth: 0 }}
                  />
                </div>
              )}
              </section>
          {uf.bitcoinLightning ? (
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
                <Header as="h4" id="contracts-lightning-h4" style={{ margin: 0 }} dividing={false}>
                  <Icon name="bolt" color="yellow" aria-hidden="true" />
                  <Header.Content>{ch.lightning.heading}</Header.Content>
                </Header>
                <Button as={Link} to="/services/bitcoin" basic size="small" title={ch.lightning.manageTitle}>
                  {ch.lightning.manage}
                </Button>
              </div>
              {lightningChannels.length === 0 ? (
                <p style={{ color: '#666' }}>{ch.lightning.empty}</p>
              ) : (
                <Table celled compact size='small'>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{ch.lightning.columns.peer}</Table.HeaderCell>
                      <Table.HeaderCell>{ch.lightning.columns.state}</Table.HeaderCell>
                      <Table.HeaderCell>{ch.lightning.columns.capacity}</Table.HeaderCell>
                      <Table.HeaderCell>{ch.lightning.columns.balance}</Table.HeaderCell>
                      <Table.HeaderCell>{ch.lightning.columns.shortId}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {lightningChannels.map((channel, idx) => {
                      const chId = channel.channel_id || channel.funding_txid || idx;
                      const toUrl = `/services/bitcoin/channels/${encodeURIComponent(chId)}`;
                      return (
                        <Table.Row
                          key={chId}
                          style={{ cursor: uf.bitcoinLightning ? 'pointer' : 'default' }}
                          onClick={() => { if (uf.bitcoinLightning) navigate(toUrl); }}
                        >
                          <Table.Cell>
                            <code style={{ fontSize: '0.85em' }}>{trimHash(channel.peer_id || channel.funding_txid || '')}</code>
                          </Table.Cell>
                          <Table.Cell>{channel.state || common.none}</Table.Cell>
                          <Table.Cell>
                            {channel.amount_msat != null ? common.sats(Math.floor(Number(channel.amount_msat) / 1000)) : (channel.channel_sat != null ? common.sats(channel.channel_sat) : common.none)}
                          </Table.Cell>
                          <Table.Cell>
                            {channel.our_amount_msat != null ? common.sats(Math.floor(Number(channel.our_amount_msat) / 1000)) : common.none}
                          </Table.Cell>
                          <Table.Cell>
                            <code style={{ fontSize: '0.8em' }}>{channel.short_channel_id || common.none}</code>
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

module.exports = ContractsHome;

