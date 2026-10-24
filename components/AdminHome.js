'use strict';

const React = require('react');
const { Link, useLocation, useNavigate } = require('react-router-dom');
const { Button, Header, Icon, Segment, Card, Message, Checkbox, Form, Divider, Modal, Input } = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser, clearHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { fetchBitcoinStatus, loadUpstreamSettings } = require('../functions/bitcoinClient');
const {
  loadHubUiFeatureFlags,
  setHubUiFeatureFlag,
  setAllHubUiFeatureFlags,
  FLAG_KEYS,
  anyBitcoinSubFeatureEnabled,
  fetchPersistedHubUiFeatureFlags,
  persistHubUiFeatureFlags,
  documentMarketUiFlags
} = require('../functions/hubUiFeatureFlags');
const HubRegtestAdminTokenPanel = require('./HubRegtestAdminTokenPanel');
const BeaconAdminPanel = require('./BeaconAdminPanel');
const PrivateNetworkPanel = require('./PrivateNetworkPanel');
const t = require('../locales/en');

const c = t.settings.admin;

/**
 * Operator admin hub: Beacon, federation links, regtest admin token.
 */
const UI_FLAG_LABELS = c.flags;
const WORK_QUEUE_STRATEGY_OPTIONS = ['highest_value_first', 'fifo', 'oldest_high_value_first']
  .map((value) => ({ key: value, value, text: c.worker.strategies[value] }));

/** Must match {@link HUB_SELF_DESTRUCT_CONFIRM_PHRASE} in `services/hub.js` (POST `/settings/self-destruct`). */
const HUB_SELF_DESTRUCT_CONFIRM_PHRASE = 'DELETE ALL HUB DATA';

function AdminHome (props) {
  const location = useLocation();
  const navigate = useNavigate();
  const adminTokenProp = props && props.adminToken;
  const hasAdmin = !!readHubAdminTokenFromBrowser(adminTokenProp);
  const adminToken = readHubAdminTokenFromBrowser(adminTokenProp);
  const [routeBlockedHint, setRouteBlockedHint] = React.useState(null);
  const [network, setNetwork] = React.useState('');
  const [httpShared, setHttpShared] = React.useState(false);
  const [httpSharedLoading, setHttpSharedLoading] = React.useState(true);
  const [httpSharedErr, setHttpSharedErr] = React.useState(null);
  const [httpSharedOk, setHttpSharedOk] = React.useState(null);
  const [httpSharedSaving, setHttpSharedSaving] = React.useState(false);
  const [uiFlags, setUiFlags] = React.useState(() => loadHubUiFeatureFlags());
  const [uiFlagsPersistMsg, setUiFlagsPersistMsg] = React.useState(null);
  const [workerStatus, setWorkerStatus] = React.useState(null);
  const [workerQueue, setWorkerQueue] = React.useState([]);
  const [workerStrategy, setWorkerStrategy] = React.useState('highest_value_first');
  const [workerStrategySaving, setWorkerStrategySaving] = React.useState(false);
  const [wealthSummary, setWealthSummary] = React.useState(null);
  const [operatorHealth, setOperatorHealth] = React.useState(null);
  const [operatorHealthLoading, setOperatorHealthLoading] = React.useState(false);
  const [operatorHealthError, setOperatorHealthError] = React.useState(null);
  const [workerLoading, setWorkerLoading] = React.useState(false);
  const [workerActionBusy, setWorkerActionBusy] = React.useState(false);
  const [workerError, setWorkerError] = React.useState(null);
  const [selfDestructOpen, setSelfDestructOpen] = React.useState(false);
  const [selfDestructPhrase, setSelfDestructPhrase] = React.useState('');
  const [selfDestructBusy, setSelfDestructBusy] = React.useState(false);
  const [selfDestructErr, setSelfDestructErr] = React.useState(null);
  const [selfDestructOk, setSelfDestructOk] = React.useState(null);

  const rpcCall = React.useCallback(async (method, params = {}) => {
    const res = await fetch('/services/rpc', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    });
    const json = await res.json().catch(() => ({}));
    if (json && json.error) throw new Error(json.error.message || t.common.errors.network);
    return json && Object.prototype.hasOwnProperty.call(json, 'result') ? json.result : json;
  }, []);

  const refreshWorkerPanel = React.useCallback(async () => {
    setWorkerLoading(true);
    setWorkerError(null);
    try {
      const [statusRes, queueRes, wealthRes] = await Promise.all([
        rpcCall('GetWorkerStatus', {}),
        rpcCall('ListWorkerQueue', { limit: 100, offset: 0 }),
        rpcCall('GetNodeWealthSummary', {})
      ]);
      setWorkerStatus(statusRes || null);
      setWorkerQueue(Array.isArray(queueRes && queueRes.items) ? queueRes.items : []);
      if (statusRes && statusRes.strategy) setWorkerStrategy(String(statusRes.strategy));
      setWealthSummary(wealthRes || null);
    } catch (e) {
      setWorkerError(e && e.message ? e.message : String(e));
    } finally {
      setWorkerLoading(false);
    }
  }, [rpcCall]);

  const refreshOperatorHealth = React.useCallback(async () => {
    setOperatorHealthLoading(true);
    setOperatorHealthError(null);
    try {
      const res = await fetch('/services/operator/health', { headers: { Accept: 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json && json.message) || `${res.status} ${res.statusText}`);
      setOperatorHealth(json || null);
    } catch (e) {
      setOperatorHealthError(e && e.message ? e.message : String(e));
    } finally {
      setOperatorHealthLoading(false);
    }
  }, []);

  const formatBytes = React.useCallback((n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return t.common.none;
    if (v < 1024) return `${v} B`;
    const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
    let idx = -1;
    let cur = v;
    do {
      cur = cur / 1024;
      idx++;
    } while (cur >= 1024 && idx < units.length - 1);
    return `${cur.toFixed(cur >= 100 ? 0 : cur >= 10 ? 1 : 2)} ${units[idx]}`;
  }, []);

  const runSelfDestruct = React.useCallback(async () => {
    const token = readHubAdminTokenFromBrowser(adminTokenProp);
    if (!token) {
      setSelfDestructErr(c.token.needed);
      return;
    }
    setSelfDestructBusy(true);
    setSelfDestructErr(null);
    try {
      const res = await fetch('/settings/self-destruct', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ confirmPhrase: selfDestructPhrase.trim() })
      });
      const raw = await res.text();
      let json = {};
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch (_) {
        json = {};
      }
      if (!res.ok) {
        throw new Error((json && json.message) || raw || `${res.status} ${res.statusText}`);
      }
      setSelfDestructOk(json.message || c.danger.started);
      clearHubAdminTokenFromBrowser();
      setSelfDestructOpen(false);
      setSelfDestructPhrase('');
      setTimeout(() => navigate('/'), 2000);
    } catch (e) {
      setSelfDestructErr(e && e.message ? e.message : String(e));
    } finally {
      setSelfDestructBusy(false);
    }
  }, [adminTokenProp, selfDestructPhrase, navigate]);

  const formatDuration = React.useCallback((secIn) => {
    const sec = Number(secIn);
    if (!Number.isFinite(sec) || sec < 0) return t.common.none;
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }, []);

  React.useLayoutEffect(() => {
    const s = location.state;
    if (s && typeof s.featureFlagBlocked === 'string') {
      const path = typeof s.blockedPath === 'string' ? s.blockedPath : '';
      setRouteBlockedHint({ flag: s.featureFlagBlocked, path });
      navigate(
        { pathname: location.pathname, search: location.search || '', hash: location.hash || '' },
        { replace: true, state: {} }
      );
      return;
    }
    const qs = new URLSearchParams(location.search || '');
    const qFlag = String(qs.get('blockedFlag') || '').trim();
    const qPath = String(qs.get('blockedPath') || '').trim();
    if (qFlag) {
      setRouteBlockedHint({ flag: qFlag, path: qPath });
    }
  }, [location.state, location.pathname, location.search, location.hash, navigate]);

  React.useEffect(() => {
    let cancelled = false;
    fetchBitcoinStatus(loadUpstreamSettings())
      .then((s) => {
        if (cancelled || !s) return;
        setNetwork(s.network ? String(s.network).toLowerCase() : '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    refreshWorkerPanel();
  }, [refreshWorkerPanel]);

  React.useEffect(() => {
    let mounted = true;
    refreshOperatorHealth();
    const timer = setInterval(() => {
      if (mounted) refreshOperatorHealth();
    }, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refreshOperatorHealth]);

  React.useEffect(() => {
    let cancelled = false;
    fetchPersistedHubUiFeatureFlags()
      .then((next) => {
        if (!cancelled && next && typeof next === 'object') setUiFlags(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setHttpSharedLoading(true);
    setHttpSharedErr(null);
    fetch('/settings/HTTP_SHARED_MODE', { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (cancelled) return;
        if (r.status === 404) {
          setHttpShared(false);
          return;
        }
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => {
        if (cancelled || !j) return;
        const v = j.value;
        setHttpShared(v === true || v === 'true');
      })
      .catch((e) => {
        if (!cancelled) setHttpSharedErr(c.http.loadFailed(e && e.message ? e.message : String(e)));
      })
      .finally(() => {
        if (!cancelled) setHttpSharedLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const persistHttpShared = (next) => {
    if (!adminToken) {
      setHttpSharedErr(c.http.needToken);
      return;
    }
    setHttpSharedSaving(true);
    setHttpSharedErr(null);
    setHttpSharedOk(null);
    fetch('/settings/HTTP_SHARED_MODE', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ value: !!next })
    })
      .then((r) => {
        if (!r.ok) return r.text().then((text) => { throw new Error(text || `${r.status}`); });
        return r.json();
      })
      .then((j) => {
        setHttpShared(!!next);
        if (j && j.httpRebind === 'scheduled') {
          setHttpSharedOk(j.message || c.http.rebinding);
        } else if (j && j.httpRebind === 'skipped') {
          setHttpSharedOk(j.httpRebindReason || c.http.envControlled);
        } else {
          setHttpSharedOk(null);
        }
      })
      .catch((e) => {
        setHttpSharedErr(c.http.saveFailed(e && e.message ? e.message : String(e)));
      })
      .finally(() => {
        setHttpSharedSaving(false);
      });
  };

  const syncUiFlag = async (key, checked) => {
    setHubUiFeatureFlag(key, checked);
    const next = loadHubUiFeatureFlags();
    setUiFlags(next);
    if (!adminToken) {
      setUiFlagsPersistMsg(c.flagsSection.savedLocal);
      return;
    }
    const result = await persistHubUiFeatureFlags(next, adminToken);
    if (!result.ok) {
      setUiFlagsPersistMsg(c.flagsSection.saveFailed(result.message));
      return;
    }
    setUiFlagsPersistMsg(c.flagsSection.saved);
  };

  const applyDocumentMarketPreset = async () => {
    const next = setAllHubUiFeatureFlags(documentMarketUiFlags());
    setUiFlags(next);
    if (!adminToken) {
      setUiFlagsPersistMsg(c.flagsSection.presetLocal);
      return;
    }
    const result = await persistHubUiFeatureFlags(next, adminToken);
    if (!result.ok) {
      setUiFlagsPersistMsg(c.flagsSection.presetFailed(result.message));
      return;
    }
    setUiFlagsPersistMsg(c.flagsSection.presetSaved);
  };

  const runWorkerNow = async () => {
    if (!adminToken) return setWorkerError(c.token.needed);
    setWorkerActionBusy(true);
    setWorkerError(null);
    try {
      await rpcCall('RunWorkerQueueNow', { adminToken });
      await refreshWorkerPanel();
    } catch (e) {
      setWorkerError(e && e.message ? e.message : String(e));
    } finally {
      setWorkerActionBusy(false);
    }
  };

  const saveWorkerStrategy = async (strategy) => {
    if (!hasAdmin) return setWorkerError(c.token.needed);
    setWorkerStrategySaving(true);
    setWorkerError(null);
    try {
      const out = await rpcCall('SetWorkerQueueStrategy', { adminToken, strategy });
      if (out && out.status === 'error') throw new Error(out.message || c.worker.strategyFailed);
      setWorkerStrategy(String((out && out.strategy) || strategy || 'highest_value_first'));
      await refreshWorkerPanel();
    } catch (e) {
      setWorkerError(e && e.message ? e.message : String(e));
    } finally {
      setWorkerStrategySaving(false);
    }
  };

  const clearWorkerQueue = async () => {
    if (!adminToken) return setWorkerError(c.token.needed);
    setWorkerActionBusy(true);
    setWorkerError(null);
    try {
      await rpcCall('ClearWorkerQueue', { adminToken });
      await refreshWorkerPanel();
    } catch (e) {
      setWorkerError(e && e.message ? e.message : String(e));
    } finally {
      setWorkerActionBusy(false);
    }
  };

  const dropWorkerItem = async (id) => {
    if (!adminToken) return setWorkerError(c.token.needed);
    setWorkerActionBusy(true);
    setWorkerError(null);
    try {
      await rpcCall('DropWorkerQueueItem', { adminToken, id });
      await refreshWorkerPanel();
    } catch (e) {
      setWorkerError(e && e.message ? e.message : String(e));
    } finally {
      setWorkerActionBusy(false);
    }
  };

  const peersBlocked = !!(routeBlockedHint && routeBlockedHint.flag === 'peersAdmin');
  const blockedLabel = routeBlockedHint && !peersBlocked
    ? (UI_FLAG_LABELS[routeBlockedHint.flag] || routeBlockedHint.flag)
    : null;
  const healthNode = operatorHealth && operatorHealth.node ? operatorHealth.node : null;
  const healthDisk = operatorHealth && operatorHealth.disk ? operatorHealth.disk : null;
  const healthNet = operatorHealth && operatorHealth.network ? operatorHealth.network : null;
  const flows = wealthSummary && wealthSummary.labeledFlows ? wealthSummary.labeledFlows : null;
  const flowKeys = ['payjoin', 'payjoinDeposit', 'inventoryHtlcFund', 'inventoryHtlcClaim', 'storageContract'];
  const flowValue = (group, key) => (flows && flows[group] ? Number(flows[group][key] || 0) : 0);
  const yesNo = (v) => (v ? t.common.states.yes : t.common.states.no);
  const currentStrategy = workerStatus && workerStatus.strategy ? String(workerStatus.strategy) : workerStrategy;
  const sectionIntroStyle = { color: '#666', marginBottom: '0.75em', maxWidth: '42rem', lineHeight: 1.45 };

  return (
    <Segment style={{ maxWidth: 960, margin: '1em auto' }}>
      <div style={{ marginBottom: '1em', display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
        <Button as={Link} to="/" basic size="small">
          <Icon name="arrow left" aria-hidden="true" />
          {c.home}
        </Button>
        <Button as={Link} to="/settings" basic size="small">
          <Icon name="setting" aria-hidden="true" />
          {c.settings}
        </Button>
      </div>

      {blockedLabel && (
        <Message
          warning
          style={{ marginBottom: '1em' }}
          onDismiss={() => setRouteBlockedHint(null)}
          dismissible
        >
          <Message.Header>{c.routeBlocked.title}</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>
            {hasAdmin ? c.routeBlocked.flagOff(blockedLabel) : c.routeBlocked.flagOffNoToken(blockedLabel)}
            {hasAdmin && routeBlockedHint.path ? (
              <>
                {' '}
                <Link to={routeBlockedHint.path}>{c.routeBlocked.openAgain}</Link>
              </>
            ) : null}
          </p>
        </Message>
      )}
      {peersBlocked && hasAdmin && (
        <Message info style={{ marginBottom: '1em' }} onDismiss={() => setRouteBlockedHint(null)}>
          <p style={{ margin: 0 }}>
            {c.routeBlocked.peersReady}{' '}
            <Link to={routeBlockedHint.path || '/peers'}>{c.routeBlocked.openPeers}</Link>
          </p>
        </Message>
      )}

      <Header as="h2" id="admin-page-heading">
        <Icon name="settings" aria-hidden="true" />
        <Header.Content>{c.title}</Header.Content>
      </Header>
      <p id="admin-page-summary" style={{ color: '#666', marginBottom: '1.25em', maxWidth: '42rem', lineHeight: 1.45 }}>
        {c.summary}
      </p>

      {!hasAdmin ? (
        <Message warning style={{ marginBottom: '1em' }} id="admin-token-banner">
          <Message.Header>{c.token.missingTitle}</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>
            {peersBlocked ? c.token.peersBody : c.token.missingBody}
          </p>
          <HubRegtestAdminTokenPanel
            network={network}
            adminTokenProp={adminTokenProp}
            formOnly
            inputId="admin-token-input"
          />
          <details className="hub-developer-details" style={{ marginTop: '0.75em' }}>
            <summary>{t.common.developerDetails}</summary>
            <p style={{ margin: '0.35em 0 0' }}>{c.token.developer}</p>
          </details>
        </Message>
      ) : (
        <Message positive size="small" style={{ marginBottom: '1em' }}>
          {c.token.present}
        </Message>
      )}

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-operator-health-heading">{c.health.title}</Header>
      <p style={sectionIntroStyle}>{c.health.intro}</p>
      {operatorHealthError ? (
        <Message negative size="small" style={{ marginBottom: '0.75em' }}>
          {c.health.loadFailed(operatorHealthError)}
        </Message>
      ) : null}
      <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.75em' }}>
        <Button basic size="small" loading={operatorHealthLoading} onClick={refreshOperatorHealth}>
          <Icon name="refresh" aria-hidden="true" /> {c.health.refresh}
        </Button>
        {operatorHealth && operatorHealth.now ? (
          <span style={{ color: '#666', fontSize: '0.9em', alignSelf: 'center' }}>
            {c.health.updated(new Date(operatorHealth.now).toLocaleString())}
          </span>
        ) : null}
      </div>
      <Segment secondary style={{ marginBottom: '1em' }}>
        <div><strong>{c.health.host}:</strong> {healthNode && healthNode.hostname ? healthNode.hostname : t.common.none}</div>
        <div><strong>{c.health.uptime}:</strong> {formatDuration(healthNode ? healthNode.uptimeSec : null)}</div>
        <div><strong>{c.health.cpu}:</strong> {healthNode && healthNode.cpu && Number.isFinite(Number(healthNode.cpu.processPercent)) ? `${Number(healthNode.cpu.processPercent).toFixed(1)}%` : c.health.cpuMeasuring}</div>
        <div><strong>{c.health.cores}:</strong> {healthNode && healthNode.cpu && Number.isFinite(Number(healthNode.cpu.cores)) ? Number(healthNode.cpu.cores) : t.common.none}</div>
        <div><strong>{c.health.load}:</strong> {healthNode && Array.isArray(healthNode.loadAverage) ? healthNode.loadAverage.map((v) => Number(v || 0).toFixed(2)).join(' / ') : t.common.none}</div>
        <div><strong>{c.health.memory}:</strong> {formatBytes(healthNode && healthNode.memory ? healthNode.memory.rss : null)}</div>
        <div><strong>{c.health.heap}:</strong> {formatBytes(healthNode && healthNode.memory ? healthNode.memory.heapUsed : null)}</div>
      </Segment>
      <Segment secondary style={{ marginBottom: '1em' }}>
        <div><strong>{c.health.diskPath}:</strong> <code>{healthDisk && healthDisk.path ? healthDisk.path : t.common.none}</code></div>
        <div><strong>{c.health.diskFree}:</strong> {formatBytes(healthDisk ? healthDisk.availableBytes : null)}</div>
        <div><strong>{c.health.diskUsed}:</strong> {formatBytes(healthDisk ? healthDisk.usedBytes : null)} ({healthDisk && Number.isFinite(Number(healthDisk.usedPercent)) ? `${Number(healthDisk.usedPercent).toFixed(1)}%` : t.common.none})</div>
        <div><strong>{c.health.diskFull}:</strong> {formatDuration(healthDisk ? healthDisk.estimatedSecondsUntilFull : null)}{healthDisk && healthDisk.estimatedAt ? ` (${c.health.diskFullAround(new Date(healthDisk.estimatedAt).toLocaleString())})` : ''}</div>
        <div style={{ color: '#666' }}>
          {healthDisk && Number.isFinite(Number(healthDisk.trendBytesPerSecond)) && Number(healthDisk.trendBytesPerSecond) > 0
            ? c.health.fillRate(formatBytes(healthDisk.trendBytesPerSecond))
            : c.health.fillRatePending}
        </div>
      </Segment>
      <Segment secondary style={{ marginBottom: '1.25em' }}>
        <div><strong>{c.health.dns}:</strong> {healthNet && healthNet.dnsProbe && healthNet.dnsProbe.ok ? t.common.states.ok : t.common.states.failed}</div>
        <div style={{ marginTop: '0.5em' }}><strong>{c.health.localServices}:</strong></div>
        {healthNet && Array.isArray(healthNet.localProbes) && healthNet.localProbes.length ? (
          <div style={{ marginTop: '0.25em' }}>
            {healthNet.localProbes.map((probe) => (
              <div key={`${probe.name}:${probe.host}:${probe.port}`}>
                <code>{probe.name}</code> {probe.host}:{probe.port} — {probe.ok ? c.health.reachable(probe.latencyMs) : c.health.unreachable(probe.error || c.health.noResponse)}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: '0.25em', color: '#666' }}>{c.health.noProbes}</div>
        )}
        <div style={{ marginTop: '0.5em' }}><strong>{c.health.addresses}:</strong></div>
        {healthNet && Array.isArray(healthNet.interfaces) && healthNet.interfaces.length ? (
          <div style={{ marginTop: '0.25em' }}>
            {healthNet.interfaces.map((iface) => (
              <div key={iface.name}>
                <code>{iface.name}</code>: {Array.isArray(iface.addresses) ? iface.addresses.map((a) => a.address).join(', ') : t.common.none}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: '0.25em', color: '#666' }}>{c.health.noAddresses}</div>
        )}
      </Segment>

      {hasAdmin ? (
        <React.Fragment>
          <BeaconAdminPanel />

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-worker-queue-heading">{c.worker.title}</Header>
      <p style={sectionIntroStyle}>{c.worker.intro}</p>
      {workerError ? (
        <Message negative size="small" style={{ marginBottom: '0.75em' }}>
          {workerError}
        </Message>
      ) : null}
      <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.75em' }}>
        <Button basic size="small" loading={workerLoading} onClick={refreshWorkerPanel}>
          <Icon name="refresh" aria-hidden="true" /> {c.worker.refresh}
        </Button>
        <Button primary size="small" disabled={!hasAdmin || workerActionBusy} loading={workerActionBusy} onClick={runWorkerNow}>
          <Icon name="play" aria-hidden="true" /> {c.worker.runNow}
        </Button>
        <Button negative size="small" disabled={!hasAdmin || workerActionBusy} loading={workerActionBusy} onClick={clearWorkerQueue}>
          <Icon name="trash" aria-hidden="true" /> {c.worker.clear}
        </Button>
      </div>
      <Form style={{ marginBottom: '0.75em' }}>
        <Form.Select
          id="admin-worker-strategy"
          label={c.worker.strategyLabel}
          aria-label={c.worker.strategyLabel}
          options={WORK_QUEUE_STRATEGY_OPTIONS}
          value={workerStrategy}
          disabled={!hasAdmin || workerStrategySaving}
          onChange={(_, d) => {
            const next = String(d && d.value ? d.value : '');
            if (next) saveWorkerStrategy(next);
          }}
        />
      </Form>
      <Segment secondary style={{ marginBottom: '1em' }}>
        <div><strong>{c.worker.ready}:</strong> {yesNo(workerStatus && workerStatus.workerReady)}</div>
        <div><strong>{c.worker.strategy}:</strong> {c.worker.strategies[currentStrategy] || currentStrategy}</div>
        <div><strong>{c.worker.length}:</strong> {workerStatus && Number.isFinite(Number(workerStatus.queueLength)) ? Number(workerStatus.queueLength) : 0}</div>
        <div><strong>{c.worker.busy}:</strong> {yesNo(workerStatus && workerStatus.queueBusy)}</div>
      </Segment>
      {workerQueue.length ? (
        <Card.Group itemsPerRow={1} stackable style={{ marginBottom: '1.25em' }}>
          {workerQueue.slice(0, 25).map((item) => (
            <Card key={item.id}>
              <Card.Content>
                <Card.Header style={{ fontSize: '1em' }}>{item.type || c.worker.itemFallback}</Card.Header>
                <Card.Meta>{item.id}</Card.Meta>
                <Card.Description>
                  <div><strong>{c.worker.value}:</strong> {t.common.sats(item.valueSats)}</div>
                  <div><strong>{c.worker.attempts}:</strong> {Number(item.attempts || 0)}</div>
                  <div><strong>{c.worker.peer}:</strong> {item.sourcePeer || t.common.none}</div>
                </Card.Description>
              </Card.Content>
              <Card.Content extra>
                <Button size="mini" basic negative disabled={!hasAdmin || workerActionBusy} onClick={() => dropWorkerItem(item.id)}>
                  {c.worker.drop}
                </Button>
              </Card.Content>
            </Card>
          ))}
        </Card.Group>
      ) : (
        <Message size="small" info style={{ marginBottom: '1.25em' }}>
          {c.worker.empty}
        </Message>
      )}

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-wealth-heading">{c.wealth.title}</Header>
      <p style={sectionIntroStyle}>{c.wealth.intro}</p>
      <Segment secondary style={{ marginBottom: '1.25em' }}>
        <div><strong>{c.wealth.network}:</strong> {wealthSummary && wealthSummary.wallet && wealthSummary.wallet.network ? wealthSummary.wallet.network : c.wealth.unknown}</div>
        <div><strong>{c.wealth.balance}:</strong> {t.common.sats(Math.round(Number(wealthSummary && wealthSummary.wallet ? wealthSummary.wallet.balanceBtc || 0 : 0) * 1e8))}</div>
        <div><strong>{c.wealth.height}:</strong> {wealthSummary && wealthSummary.wallet && wealthSummary.wallet.height != null ? wealthSummary.wallet.height : t.common.none}</div>
        <div style={{ marginTop: '0.5em' }}><strong>{c.wealth.counts}:</strong></div>
        {flowKeys.map((key) => (
          <div key={`count-${key}`}>{c.wealth[key]}: {flowValue('counts', key)}</div>
        ))}
        <div style={{ marginTop: '0.5em' }}><strong>{c.wealth.totals}:</strong></div>
        {flowKeys.map((key) => (
          <div key={`total-${key}`}>{c.wealth[key]}: {t.common.sats(flowValue('totals', key))}</div>
        ))}
      </Segment>

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-network-http-heading">{c.http.title}</Header>
      <p style={{ ...sectionIntroStyle, marginBottom: '0.5em' }}>{c.http.intro}</p>
      <details className="hub-developer-details" style={{ marginBottom: '0.75em', maxWidth: '42rem' }}>
        <summary>{t.common.developerDetails}</summary>
        <p style={{ color: '#666', margin: '0.35em 0 0' }}>{c.http.developer}</p>
      </details>
      {httpSharedOk && (
        <Message info size="small" style={{ marginBottom: '0.75em' }} onDismiss={() => setHttpSharedOk(null)}>
          {httpSharedOk}
        </Message>
      )}
      {httpSharedErr && (
        <Message negative size="small" style={{ marginBottom: '0.75em' }}>
          {httpSharedErr}
        </Message>
      )}
      <Form>
        <Form.Field>
          <Checkbox
            toggle
            id="admin-http-shared-mode"
            label={c.http.label}
            checked={httpShared}
            disabled={httpSharedLoading || httpSharedSaving || !hasAdmin}
            onChange={(_, d) => persistHttpShared(!!d.checked)}
          />
          {httpSharedLoading ? (
            <span style={{ display: 'block', marginTop: '0.35em', fontSize: '0.85em', color: '#888' }}>
              {c.http.loading}
            </span>
          ) : null}
        </Form.Field>
      </Form>

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-private-network-heading">{c.privateNetwork.title}</Header>
      <p style={{ ...sectionIntroStyle, marginBottom: '0.5em' }}>{c.privateNetwork.intro}</p>
      <details className="hub-developer-details" style={{ marginBottom: '0.75em', maxWidth: '42rem' }}>
        <summary>{t.common.developerDetails}</summary>
        <p style={{ color: '#666', margin: '0.35em 0 0' }}>{c.privateNetwork.developer}</p>
      </details>
      <PrivateNetworkPanel adminToken={adminToken} />

      <Divider section />

      <Header as="h3" id="admin-ui-visibility-heading">{c.flagsSection.title}</Header>
      <p style={{ ...sectionIntroStyle, marginBottom: '0.5em' }}>{c.flagsSection.intro}</p>
      <p style={{ ...sectionIntroStyle, marginBottom: '0.5em' }}>{c.flagsSection.defaults}</p>
      <details className="hub-developer-details" style={{ marginBottom: '0.75em', maxWidth: '42rem' }}>
        <summary>{t.common.developerDetails}</summary>
        <p style={{ color: '#666', margin: '0.35em 0 0' }}>{c.flagsSection.developer}</p>
      </details>
      <Button
        type="button"
        size="small"
        primary
        basic
        id="fabric-hub-ui-flag-document-market-preset"
        style={{ marginBottom: '0.75em' }}
        onClick={() => { applyDocumentMarketPreset(); }}
      >
        <Icon name="file alternate outline" aria-hidden="true" />
        {c.flagsSection.preset}
      </Button>
      {uiFlagsPersistMsg ? (
        <Message info size="small" style={{ marginBottom: '0.75em' }} onDismiss={() => setUiFlagsPersistMsg(null)}>
          {uiFlagsPersistMsg}
        </Message>
      ) : null}
      <Form aria-labelledby="admin-ui-visibility-heading">
        {FLAG_KEYS.map((key) => {
          const labelText = UI_FLAG_LABELS[key] || key;
          const flagInputId = `fabric-hub-ui-flag-${key}`;
          return (
            <Form.Field key={key}>
              <Checkbox
                toggle
                id={flagInputId}
                label={labelText}
                checked={!!uiFlags[key]}
                onChange={(_, d) => {
                  syncUiFlag(key, !!d.checked);
                }}
              />
            </Form.Field>
          );
        })}
      </Form>

          {(uiFlags.sidechain || anyBitcoinSubFeatureEnabled(uiFlags)) ? (
        <React.Fragment>
          <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-related-pages-heading">{c.related.title}</Header>
          <Card.Group itemsPerRow={1} stackable>
            {uiFlags.sidechain ? (
              <React.Fragment>
                <Card as={Link} to="/settings/admin/beacon-federation" style={{ cursor: 'pointer' }}>
                  <Card.Content>
                    <Card.Header>
                      <Icon name="users" aria-hidden="true" /> {c.related.beaconTitle}
                    </Card.Header>
                    <Card.Description>{c.related.beaconBody}</Card.Description>
                  </Card.Content>
                </Card>
                <Card as={Link} to="/federations" style={{ cursor: 'pointer' }}>
                  <Card.Content>
                    <Card.Header>
                      <Icon name="sliders horizontal" aria-hidden="true" /> {c.related.federationsTitle}
                    </Card.Header>
                    <Card.Description>{c.related.federationsBody}</Card.Description>
                  </Card.Content>
                </Card>
              </React.Fragment>
            ) : null}
            <Card as={Link} to="/services/bitcoin" style={{ cursor: 'pointer' }}>
              <Card.Content>
                <Card.Header>
                  <Icon name="bitcoin" aria-hidden="true" /> {c.related.bitcoinTitle}
                </Card.Header>
                <Card.Description>{c.related.bitcoinBody}</Card.Description>
              </Card.Content>
            </Card>
          </Card.Group>
        </React.Fragment>
          ) : (
        <p style={{ color: '#666', marginTop: '1.5em', maxWidth: '42rem', lineHeight: 1.45 }}>
          {c.related.empty}
        </p>
          )}

          <Divider section />

          <Header as="h3" id="admin-self-destruct-heading" style={{ color: '#9f3a38', marginTop: '1.5em' }}>
            <Icon name="bomb" aria-hidden="true" /> {c.danger.title}
          </Header>
          <Message negative style={{ marginBottom: '0.75em' }}>
            <Message.Header>{c.danger.wipeTitle}</Message.Header>
            <p style={{ margin: '0.35em 0 0', lineHeight: 1.45 }}>{c.danger.wipeBody}</p>
            <details className="hub-developer-details" style={{ marginTop: '0.5em' }}>
              <summary>{t.common.developerDetails}</summary>
              <p style={{ margin: '0.35em 0 0' }}>{c.danger.developer}</p>
            </details>
          </Message>
          {selfDestructOk ? (
            <Message positive size="small" style={{ marginBottom: '0.75em' }} onDismiss={() => setSelfDestructOk(null)}>
              {selfDestructOk}
            </Message>
          ) : null}
          <Button
            negative
            basic
            id="fabric-hub-admin-self-destruct-open"
            disabled={!hasAdmin || selfDestructBusy}
            loading={selfDestructBusy}
            onClick={() => {
              setSelfDestructErr(null);
              setSelfDestructPhrase('');
              setSelfDestructOpen(true);
            }}
          >
            <Icon name="bomb" aria-hidden="true" /> {c.danger.open}
          </Button>

          <Modal
            closeOnDimmerClick={!selfDestructBusy}
            open={selfDestructOpen}
            onClose={() => !selfDestructBusy && setSelfDestructOpen(false)}
            size="small"
          >
            <Modal.Header style={{ color: '#9f3a38' }}>{c.danger.confirmTitle}</Modal.Header>
            <Modal.Content>
              <p style={{ marginBottom: '0.75em', lineHeight: 1.45 }}>{c.danger.confirmBody}</p>
              <p style={{ marginBottom: '0.5em' }}>
                <code style={{ fontSize: '1rem', userSelect: 'all' }}>{HUB_SELF_DESTRUCT_CONFIRM_PHRASE}</code>
              </p>
              {selfDestructErr ? (
                <Message negative size="small" style={{ marginBottom: '0.75em' }}>
                  {selfDestructErr}
                </Message>
              ) : null}
              <label htmlFor="admin-self-destruct-phrase" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35em' }}>
                {c.danger.phraseLabel}
              </label>
              <Input
                fluid
                id="admin-self-destruct-phrase"
                value={selfDestructPhrase}
                disabled={selfDestructBusy}
                onChange={(_, d) => setSelfDestructPhrase(d.value)}
                autoComplete="off"
              />
            </Modal.Content>
            <Modal.Actions>
              <Button onClick={() => !selfDestructBusy && setSelfDestructOpen(false)} disabled={selfDestructBusy}>
                {t.common.actions.cancel}
              </Button>
              <Button
                negative
                id="fabric-hub-admin-self-destruct-confirm"
                disabled={
                  selfDestructBusy ||
                  selfDestructPhrase.trim() !== HUB_SELF_DESTRUCT_CONFIRM_PHRASE
                }
                loading={selfDestructBusy}
                onClick={runSelfDestruct}
              >
                {c.danger.confirm}
              </Button>
            </Modal.Actions>
          </Modal>
        </React.Fragment>
      ) : null}
    </Segment>
  );
}

module.exports = AdminHome;
