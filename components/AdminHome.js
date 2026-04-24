'use strict';

const React = require('react');
const { Link, useLocation, useNavigate } = require('react-router-dom');
const { Button, Header, Icon, Segment, Card, Message, Checkbox, Form, Divider } = require('semantic-ui-react');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { fetchBitcoinStatus, loadUpstreamSettings } = require('../functions/bitcoinClient');
const {
  loadHubUiFeatureFlags,
  setHubUiFeatureFlag,
  FLAG_KEYS,
  anyBitcoinSubFeatureEnabled,
  fetchPersistedHubUiFeatureFlags,
  persistHubUiFeatureFlags
} = require('../functions/hubUiFeatureFlags');
const HubRegtestAdminTokenPanel = require('./HubRegtestAdminTokenPanel');
const BeaconAdminPanel = require('./BeaconAdminPanel');

/**
 * Operator admin hub: Beacon, federation links, regtest admin token.
 */
const UI_FLAG_LABELS = {
  promo: 'Promo hero block on the homepage (what is Hub, install your own node)',
  advancedMode: 'Advanced Mode (shows power-user navigation and tools)',
  peers: 'Peers & WebRTC (nav, routes, home network card)',
  peersAdmin: 'Peers (hub admin token required in this browser)',
  activities: 'Notifications (bell), activity log, feed, home sections',
  features: 'Features tour (/features, More menu, home shortcut)',
  sidechain: 'Sidechain demo, federation settings, beacon federation nav',
  bitcoinPayments: 'Bitcoin — Payments & Payjoin (page, nav links, balance chip)',
  bitcoinInvoices: 'Bitcoin — Invoices walkthrough page',
  bitcoinResources: 'Bitcoin — HTTP resources browser (/services/bitcoin/resources)',
  bitcoinExplorer: 'Bitcoin — Block & transaction detail routes',
  bitcoinLightning: 'Bitcoin — Lightning UI & channel detail routes',
  bitcoinCrowdfund: 'Bitcoin — Taproot crowdfund section on the dashboard'
};
const WORK_QUEUE_STRATEGY_OPTIONS = [
  { key: 'highest_value_first', value: 'highest_value_first', text: 'Highest value first (default)' },
  { key: 'fifo', value: 'fifo', text: 'FIFO (oldest first)' },
  { key: 'oldest_high_value_first', value: 'oldest_high_value_first', text: 'Oldest first, value tie-breaker' }
];

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

  const rpcCall = React.useCallback(async (method, params = {}) => {
    const res = await fetch('/services/rpc', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    });
    const json = await res.json().catch(() => ({}));
    if (json && json.error) throw new Error(json.error.message || 'RPC error');
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
    if (!Number.isFinite(v) || v < 0) return 'n/a';
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

  const formatDuration = React.useCallback((secIn) => {
    const sec = Number(secIn);
    if (!Number.isFinite(sec) || sec < 0) return 'n/a';
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
        if (!cancelled) setHttpSharedErr(e && e.message ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setHttpSharedLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const persistHttpShared = (next) => {
    if (!adminToken) {
      setHttpSharedErr('Admin token required to change HTTP bind mode.');
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
        if (!r.ok) return r.text().then((t) => { throw new Error(t || `${r.status}`); });
        return r.json();
      })
      .then((j) => {
        setHttpShared(!!next);
        if (j && j.httpRebind === 'scheduled') {
          setHttpSharedOk(j.message || 'HTTP listener is rebinding; WebSocket clients will reconnect.');
        } else if (j && j.httpRebind === 'skipped') {
          setHttpSharedOk(j.httpRebindReason || 'Saved. Bind address is controlled by environment until you restart without those variables.');
        } else {
          setHttpSharedOk(null);
        }
      })
      .catch((e) => {
        setHttpSharedErr(e && e.message ? e.message : String(e));
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
      setUiFlagsPersistMsg('Saved in this browser only. Save admin token to persist on hub disk.');
      return;
    }
    const result = await persistHubUiFeatureFlags(next, adminToken);
    if (!result.ok) {
      setUiFlagsPersistMsg(`Saved in browser; hub-disk save failed: ${result.message || 'unknown error'}`);
      return;
    }
    setUiFlagsPersistMsg('Persisted to hub settings (disk) and restored on startup.');
  };

  const runWorkerNow = async () => {
    if (!adminToken) return setWorkerError('Admin token required.');
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
    if (!hasAdmin) return setWorkerError('Admin token required.');
    setWorkerStrategySaving(true);
    setWorkerError(null);
    try {
      const out = await rpcCall('SetWorkerQueueStrategy', { adminToken, strategy });
      if (out && out.status === 'error') throw new Error(out.message || 'Could not save worker queue strategy');
      setWorkerStrategy(String((out && out.strategy) || strategy || 'highest_value_first'));
      await refreshWorkerPanel();
    } catch (e) {
      setWorkerError(e && e.message ? e.message : String(e));
    } finally {
      setWorkerStrategySaving(false);
    }
  };

  const clearWorkerQueue = async () => {
    if (!adminToken) return setWorkerError('Admin token required.');
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
    if (!adminToken) return setWorkerError('Admin token required.');
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

  return (
    <Segment style={{ maxWidth: 960, margin: '1em auto' }}>
      <div style={{ marginBottom: '1em', display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
        <Button as={Link} to="/" basic size="small" aria-label="Back to home">
          <Icon name="arrow left" aria-hidden="true" />
          Home
        </Button>
        <Button as={Link} to="/settings" basic size="small" aria-label="Back to settings overview">
          <Icon name="setting" aria-hidden="true" />
          Settings
        </Button>
      </div>

      {routeBlockedHint && (
        <Message
          warning
          style={{ marginBottom: '1em' }}
          onDismiss={() => setRouteBlockedHint(null)}
          dismissible
        >
          <Message.Header>That page is hidden in this browser</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>
            {routeBlockedHint.flag === 'peersAdmin' ? (
              <>
                You opened{' '}
                <code style={{ wordBreak: 'break-all' }}>{routeBlockedHint.path || '(unknown path)'}</code>
                . Peers are only available when this browser has the hub admin token (first-time setup token).
                Paste or refresh the token below, then open the link again.
              </>
            ) : (
              <>
                You opened{' '}
                <code style={{ wordBreak: 'break-all' }}>{routeBlockedHint.path || '(unknown path)'}</code>
                , but{' '}
                <strong>{UI_FLAG_LABELS[routeBlockedHint.flag] || routeBlockedHint.flag}</strong> is turned off under
                Feature visibility below. Enable it, then open the link again.
              </>
            )}
          </p>
        </Message>
      )}

      <Header as="h2" id="admin-page-heading">
        <Icon name="settings" aria-hidden="true" />
        <Header.Content>Admin</Header.Content>
      </Header>
      <p id="admin-page-summary" style={{ color: '#666', marginBottom: '1.25em', maxWidth: '42rem', lineHeight: 1.45 }}>
        Node-operator tools that depend on the hub setup token, Bitcoin service, and distributed execution surfaces.
        End users normally use <Link to="/settings">Settings</Link>
        {' '}and the <Link to="/services/bitcoin">Bitcoin</Link> dashboard without opening this page.
        The Bitcoin dashboard is always available; turn on the Bitcoin sub-toggles below for Payments, Invoices, HTTP resources, block/tx explorer routes, Lightning, and crowdfund UI.
      </p>

      {!hasAdmin ? (
        <Message info style={{ marginBottom: '1em' }}>
          <Message.Header>No admin token in this browser</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>
            Paste the setup token from first-time hub configuration (or refresh it) to unlock Generate Block, Hub-wallet spends, and federation policy saves.
            Regtest: use the panel below.
          </p>
        </Message>
      ) : (
        <Message positive size="small" style={{ marginBottom: '1em' }}>
          Admin token is present in this browser.
        </Message>
      )}

      <HubRegtestAdminTokenPanel network={network} adminTokenProp={adminTokenProp} />

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-operator-health-heading">Operator health</Header>
      <p style={{ color: '#666', marginBottom: '0.75em', maxWidth: '42rem', lineHeight: 1.45 }}>
        Local node health signals for disk capacity, process pressure, and connectivity to configured local services.
      </p>
      {operatorHealthError ? (
        <Message negative size="small" style={{ marginBottom: '0.75em' }}>
          {operatorHealthError}
        </Message>
      ) : null}
      <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.75em' }}>
        <Button basic size="small" loading={operatorHealthLoading} onClick={refreshOperatorHealth}>
          <Icon name="refresh" /> Refresh health
        </Button>
        {operatorHealth && operatorHealth.now ? (
          <span style={{ color: '#666', fontSize: '0.9em', alignSelf: 'center' }}>
            Updated: {new Date(operatorHealth.now).toLocaleString()}
          </span>
        ) : null}
      </div>
      <Segment secondary style={{ marginBottom: '1em' }}>
        <div><strong>Host:</strong> {operatorHealth && operatorHealth.node && operatorHealth.node.hostname ? operatorHealth.node.hostname : 'n/a'}</div>
        <div><strong>Node process uptime:</strong> {formatDuration(operatorHealth && operatorHealth.node ? operatorHealth.node.uptimeSec : null)}</div>
        <div><strong>CPU usage (process):</strong> {operatorHealth && operatorHealth.node && operatorHealth.node.cpu && Number.isFinite(Number(operatorHealth.node.cpu.processPercent)) ? `${Number(operatorHealth.node.cpu.processPercent).toFixed(1)}%` : 'warming up…'}</div>
        <div><strong>CPU cores:</strong> {operatorHealth && operatorHealth.node && operatorHealth.node.cpu && Number.isFinite(Number(operatorHealth.node.cpu.cores)) ? Number(operatorHealth.node.cpu.cores) : 'n/a'}</div>
        <div><strong>System load avg:</strong> {operatorHealth && operatorHealth.node && Array.isArray(operatorHealth.node.loadAverage) ? operatorHealth.node.loadAverage.map((v) => Number(v || 0).toFixed(2)).join(' / ') : 'n/a'}</div>
        <div><strong>Memory RSS:</strong> {formatBytes(operatorHealth && operatorHealth.node && operatorHealth.node.memory ? operatorHealth.node.memory.rss : null)}</div>
        <div><strong>Heap used:</strong> {formatBytes(operatorHealth && operatorHealth.node && operatorHealth.node.memory ? operatorHealth.node.memory.heapUsed : null)}</div>
      </Segment>
      <Segment secondary style={{ marginBottom: '1em' }}>
        <div><strong>Disk path:</strong> <code>{operatorHealth && operatorHealth.disk && operatorHealth.disk.path ? operatorHealth.disk.path : 'n/a'}</code></div>
        <div><strong>Disk available:</strong> {formatBytes(operatorHealth && operatorHealth.disk ? operatorHealth.disk.availableBytes : null)}</div>
        <div><strong>Disk used:</strong> {formatBytes(operatorHealth && operatorHealth.disk ? operatorHealth.disk.usedBytes : null)} ({operatorHealth && operatorHealth.disk && Number.isFinite(Number(operatorHealth.disk.usedPercent)) ? `${Number(operatorHealth.disk.usedPercent).toFixed(1)}%` : 'n/a'})</div>
        <div><strong>Estimated time to full:</strong> {formatDuration(operatorHealth && operatorHealth.disk ? operatorHealth.disk.estimatedSecondsUntilFull : null)}{operatorHealth && operatorHealth.disk && operatorHealth.disk.estimatedAt ? ` (around ${new Date(operatorHealth.disk.estimatedAt).toLocaleString()})` : ''}</div>
        <div style={{ color: '#666' }}>
          {operatorHealth && operatorHealth.disk && Number.isFinite(Number(operatorHealth.disk.trendBytesPerSecond)) && Number(operatorHealth.disk.trendBytesPerSecond) > 0
            ? `Observed fill rate: ${formatBytes(operatorHealth.disk.trendBytesPerSecond)}/s`
            : 'Fill-rate estimate appears after multiple health samples.'}
        </div>
      </Segment>
      <Segment secondary style={{ marginBottom: '1.25em' }}>
        <div><strong>DNS probe:</strong> {operatorHealth && operatorHealth.network && operatorHealth.network.dnsProbe && operatorHealth.network.dnsProbe.ok ? 'ok' : 'failed'}</div>
        <div style={{ marginTop: '0.5em' }}><strong>Local service reachability:</strong></div>
        {operatorHealth && operatorHealth.network && Array.isArray(operatorHealth.network.localProbes) && operatorHealth.network.localProbes.length ? (
          <div style={{ marginTop: '0.25em' }}>
            {operatorHealth.network.localProbes.map((probe) => (
              <div key={`${probe.name}:${probe.host}:${probe.port}`}>
                <code>{probe.name}</code> {probe.host}:{probe.port} — {probe.ok ? `reachable (${probe.latencyMs} ms)` : `unreachable (${probe.error || 'error'})`}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: '0.25em', color: '#666' }}>No local probes configured.</div>
        )}
        <div style={{ marginTop: '0.5em' }}><strong>Network-accessible addresses:</strong></div>
        {operatorHealth && operatorHealth.network && Array.isArray(operatorHealth.network.interfaces) && operatorHealth.network.interfaces.length ? (
          <div style={{ marginTop: '0.25em' }}>
            {operatorHealth.network.interfaces.map((iface) => (
              <div key={iface.name}>
                <code>{iface.name}</code>: {Array.isArray(iface.addresses) ? iface.addresses.map((a) => a.address).join(', ') : '(none)'}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: '0.25em', color: '#666' }}>No external interfaces detected.</div>
        )}
      </Segment>

      {!hasAdmin ? (
        <Message warning style={{ marginTop: '1em' }}>
          <Message.Header>Admin controls are hidden until token is present</Message.Header>
          <p style={{ margin: '0.35em 0 0' }}>
            Save a valid admin token above to reveal worker queue controls, wealth visibility, network bind settings, and feature visibility toggles.
          </p>
        </Message>
      ) : (
        <React.Fragment>
          <BeaconAdminPanel />

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-worker-queue-heading">Fabric worker queue</Header>
      <p style={{ color: '#666', marginBottom: '0.75em', maxWidth: '42rem', lineHeight: 1.45 }}>
        Prioritized offer execution queue. Strategy is operator-managed and persisted on hub settings.
      </p>
      {workerError ? (
        <Message negative size="small" style={{ marginBottom: '0.75em' }}>
          {workerError}
        </Message>
      ) : null}
      <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', marginBottom: '0.75em' }}>
        <Button basic size="small" loading={workerLoading} onClick={refreshWorkerPanel}>
          <Icon name="refresh" /> Refresh
        </Button>
        <Button primary size="small" disabled={!hasAdmin || workerActionBusy} loading={workerActionBusy} onClick={runWorkerNow}>
          <Icon name="play" /> Run Now
        </Button>
        <Button negative size="small" disabled={!hasAdmin || workerActionBusy} loading={workerActionBusy} onClick={clearWorkerQueue}>
          <Icon name="trash" /> Clear Queue
        </Button>
      </div>
      <Form style={{ marginBottom: '0.75em' }}>
        <Form.Select
          label="Job selection strategy"
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
        <div><strong>Worker ready:</strong> {workerStatus && workerStatus.workerReady ? 'yes' : 'no'}</div>
        <div><strong>Selection strategy:</strong> {workerStatus && workerStatus.strategy ? workerStatus.strategy : workerStrategy}</div>
        <div><strong>Queue length:</strong> {workerStatus && Number.isFinite(Number(workerStatus.queueLength)) ? Number(workerStatus.queueLength) : 0}</div>
        <div><strong>Queue busy:</strong> {workerStatus && workerStatus.queueBusy ? 'yes' : 'no'}</div>
      </Segment>
      {workerQueue.length ? (
        <Card.Group itemsPerRow={1} stackable style={{ marginBottom: '1.25em' }}>
          {workerQueue.slice(0, 25).map((item) => (
            <Card key={item.id}>
              <Card.Content>
                <Card.Header style={{ fontSize: '1em' }}>{item.type || 'work-item'}</Card.Header>
                <Card.Meta>{item.id}</Card.Meta>
                <Card.Description>
                  <div><strong>Value:</strong> {Number(item.valueSats || 0)} sats</div>
                  <div><strong>Attempts:</strong> {Number(item.attempts || 0)}</div>
                  <div><strong>Peer:</strong> {item.sourcePeer || '(n/a)'}</div>
                </Card.Description>
              </Card.Content>
              <Card.Content extra>
                <Button size="mini" basic negative disabled={!hasAdmin || workerActionBusy} onClick={() => dropWorkerItem(item.id)}>
                  Drop item
                </Button>
              </Card.Content>
            </Card>
          ))}
        </Card.Group>
      ) : (
        <Message size="small" info style={{ marginBottom: '1.25em' }}>
          Queue is empty.
        </Message>
      )}

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-wealth-heading">Node wealth visibility</Header>
      <p style={{ color: '#666', marginBottom: '0.75em', maxWidth: '42rem', lineHeight: 1.45 }}>
        Operational wallet balance plus labeled BTC-earning flows (Payjoin, storage contracts, inventory HTLC) observed by this hub.
      </p>
      <Segment secondary style={{ marginBottom: '1.25em' }}>
        <div><strong>Network:</strong> {wealthSummary && wealthSummary.wallet && wealthSummary.wallet.network ? wealthSummary.wallet.network : '(unknown)'}</div>
        <div><strong>Wallet balance:</strong> {wealthSummary && wealthSummary.wallet ? Number(wealthSummary.wallet.balanceBtc || 0) : 0} BTC</div>
        <div><strong>Chain height:</strong> {wealthSummary && wealthSummary.wallet && wealthSummary.wallet.height != null ? wealthSummary.wallet.height : 'n/a'}</div>
        <div style={{ marginTop: '0.5em' }}><strong>Labeled flow counts:</strong></div>
        <div>Payjoin proposals: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.counts.payjoin || 0) : 0}</div>
        <div>Payjoin deposits: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.counts.payjoinDeposit || 0) : 0}</div>
        <div>Inventory HTLC funds: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.counts.inventoryHtlcFund || 0) : 0}</div>
        <div>Inventory HTLC claims: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.counts.inventoryHtlcClaim || 0) : 0}</div>
        <div>Storage contracts: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.counts.storageContract || 0) : 0}</div>
        <div style={{ marginTop: '0.5em' }}><strong>Labeled flow totals (sats):</strong></div>
        <div>Payjoin proposals: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.totals.payjoin || 0) : 0}</div>
        <div>Payjoin deposits: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.totals.payjoinDeposit || 0) : 0}</div>
        <div>Inventory HTLC funds: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.totals.inventoryHtlcFund || 0) : 0}</div>
        <div>Inventory HTLC claims: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.totals.inventoryHtlcClaim || 0) : 0}</div>
        <div>Storage contracts: {wealthSummary && wealthSummary.labeledFlows ? Number(wealthSummary.labeledFlows.totals.storageContract || 0) : 0}</div>
      </Segment>

      <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-network-http-heading">Network — HTTP bind (hub)</Header>
      <p style={{ color: '#666', marginBottom: '0.75em', maxWidth: '42rem', lineHeight: 1.45 }}>
        <strong>Shared mode</strong> persists in <code>stores/hub/settings.json</code> as <code>HTTP_SHARED_MODE</code>.
        When enabled, the hub listens on <code>0.0.0.0</code> so other machines on the LAN can open this UI (subject to firewall).
        When disabled, HTTP is bound to <code>127.0.0.1</code> only. Changing this setting <strong>rebinds the HTTP server immediately</strong> (open WebSockets drop and reconnect).
        If <code>FABRIC_HUB_INTERFACE</code> or <code>INTERFACE</code> is set in the environment, the bind address follows that instead; save still persists the flag for when env is unset.
      </p>
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
            label="HTTP shared mode (bind all interfaces)"
            aria-label="HTTP shared mode (bind all interfaces)"
            checked={httpShared}
            disabled={httpSharedLoading || httpSharedSaving || !hasAdmin}
            onChange={(_, d) => persistHttpShared(!!d.checked)}
          />
          <span style={{ display: 'block', marginTop: '0.35em', fontSize: '0.85em', color: '#888' }}>
            {httpSharedLoading ? 'Loading current setting…' : null}
            {!hasAdmin ? ' Save the admin token in this browser to change this setting.' : null}
          </span>
        </Form.Field>
      </Form>

      <Divider section />

      <Header as="h3" id="admin-ui-visibility-heading">Feature visibility (this browser)</Header>
      <p style={{ color: '#666', marginBottom: '0.75em', maxWidth: '42rem', lineHeight: 1.45 }}>
        Optional areas of the UI are <strong>off by default</strong>. When a toggle is off, that area is hidden for{' '}
        <strong>everyone</strong> using this browser profile (including operators) until you turn it back on.
        Home, Documents, Contracts, Settings, Security, and this Admin page stay available.
        Toggles below take effect when saved (including Activities, Features, explorer, and Invoices).
        Choices are cached in the browser Fabric state store and, with admin token, persisted to hub settings on disk and restored at startup.
      </p>
      {uiFlagsPersistMsg ? (
        <Message info size="small" style={{ marginBottom: '0.75em' }} onDismiss={() => setUiFlagsPersistMsg(null)}>
          {uiFlagsPersistMsg}
        </Message>
      ) : null}
      <Form>
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
                aria-label={`${labelText} — hub UI feature flag ${key}`}
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
          <Header as="h3" style={{ marginTop: '1.5em' }} id="admin-related-pages-heading">Related pages</Header>
          <Card.Group itemsPerRow={1} stackable>
            {uiFlags.sidechain ? (
              <React.Fragment>
                <Card as={Link} to="/settings/admin/beacon-federation" style={{ cursor: 'pointer' }}>
                  <Card.Content>
                    <Card.Header>
                      <Icon name="users" aria-hidden="true" /> Beacon Federation
                    </Card.Header>
                    <Card.Description>
                      Contract: epoch cadence, Fabric messages, cooperative signing, and L1 Taproot vault (144-block deposit lock by default).
                    </Card.Description>
                  </Card.Content>
                </Card>
                <Card as={Link} to="/federations" style={{ cursor: 'pointer' }}>
                  <Card.Content>
                    <Card.Header>
                      <Icon name="sliders horizontal" aria-hidden="true" /> Federations (validators)
                    </Card.Header>
                    <Card.Description>
                      Edit distributed federation pubkeys persisted on this hub (when not overridden by environment).
                      Cross-check live policy with{' '}
                      <a href="/services/distributed/manifest" target="_blank" rel="noopener noreferrer">GET manifest</a>
                      {' / '}
                      <a href="/services/distributed/epoch" target="_blank" rel="noopener noreferrer">GET epoch</a>
                      {' '}(see <Link to="/settings/admin/beacon-federation">Beacon Federation</Link> for verification).
                    </Card.Description>
                  </Card.Content>
                </Card>
              </React.Fragment>
            ) : null}
            <Card as={Link} to="/services/bitcoin" style={{ cursor: 'pointer' }}>
              <Card.Content>
                <Card.Header>
                  <Icon name="bitcoin" aria-hidden="true" /> Bitcoin dashboard
                </Card.Header>
                <Card.Description>
                  Node status, regtest tools, and core wallet view. Sub-pages (payments, invoices, resources, explorer, Lightning) follow the Bitcoin toggles above.
                </Card.Description>
              </Card.Content>
            </Card>
          </Card.Group>
        </React.Fragment>
          ) : (
        <p style={{ color: '#666', marginTop: '1.5em', maxWidth: '42rem', lineHeight: 1.45 }}>
          Enable <strong>Sidechain</strong> and/or any <strong>Bitcoin …</strong> toggle to show operator shortcut cards (federation, Bitcoin dashboard link).
        </p>
          )}
        </React.Fragment>
      )}
    </Segment>
  );
}

module.exports = AdminHome;
