'use strict';

// Dependencies
const React = require('react');
const { useLocation, Link } = require('react-router-dom');

function scrollToHashElement (hash) {
  const raw = hash || '';
  const h = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!h) return;
  const el = document.getElementById(h);
  if (el && typeof el.scrollIntoView === 'function') {
    window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
}

const {
  Button,
  Card,
  Form,
  Grid,
  Header,
  Icon,
  Input,
  Label,
  Loader,
  Message,
  Modal,
  Segment,
  Statistic
} = require('semantic-ui-react');

const ActivityStream = require('./ActivityStream');
const { isHubNetworkStatusShape, bridgeWebSocketLoadingHint } = require('../functions/hubNetworkStatus');
const { hydrateHubNetworkStatusViaHttp } = require('../functions/hydrateHubNetworkStatusViaHttp');
const { loadHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');

function formatBytes (n) {
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
}

function formatDuration (secIn) {
  const sec = Number(secIn);
  if (!Number.isFinite(sec) || sec < 0) return 'n/a';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(sec)}s`;
}

function PromoHero ({ onDismiss }) {
  return (
    <Segment
      id="fabric-hub-promo"
      style={{
        background: 'linear-gradient(135deg, #1b1c1d 0%, #2d3436 100%)',
        color: '#f5f5f5',
        padding: '2.5em 2em',
        borderRadius: '8px',
        marginBottom: '1.25em',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {typeof onDismiss === 'function' ? (
        <Button
          icon
          basic
          inverted
          size="mini"
          title="Dismiss promo"
          aria-label="Dismiss promo"
          style={{ position: 'absolute', top: '0.75em', right: '0.75em', opacity: 0.6 }}
          onClick={onDismiss}
        >
          <Icon name="close" />
        </Button>
      ) : null}
      <div style={{ maxWidth: '52rem' }}>
        <Header as="h1" inverted style={{ marginTop: 0, fontSize: '1.75em', lineHeight: 1.3 }}>
          <Icon name="cube" style={{ fontSize: '0.85em', marginRight: '0.35em', verticalAlign: 'middle' }} />
          This is a Fabric Hub
        </Header>
        <p style={{ fontSize: '1.1em', lineHeight: 1.65, marginBottom: '1em', color: '#d4d4d4' }}>
          A <strong style={{ color: '#fff' }}>Fabric Hub</strong> is a self-sovereign node that connects you to the
          Fabric network — peer-to-peer messaging, document storage, Bitcoin integration, and cooperative multisig
          vaults, all running on your own hardware.
        </p>
        <p style={{ fontSize: '1em', lineHeight: 1.65, marginBottom: '1.25em', color: '#bbb' }}>
          You are viewing <strong style={{ color: '#ccc' }}>someone else's hub</strong> right now. Everything here
          runs on their node. To own your data and identity, install your own.
        </p>

        <Header as="h3" inverted style={{ marginBottom: '0.65em', fontSize: '1.15em' }}>
          Run your own hub
        </Header>
        <Grid columns={3} stackable doubling style={{ marginBottom: '1em' }}>
          <Grid.Column>
            <Segment inverted style={{ background: 'rgba(255,255,255,0.08)', height: '100%' }}>
              <Header as="h4" inverted style={{ marginTop: 0 }}>
                <Icon name="desktop" /> Desktop
              </Header>
              <p style={{ fontSize: '0.92em', lineHeight: 1.5, color: '#ccc' }}>
                Download the Fabric Hub desktop app. One click installs the hub,
                Bitcoin node, and browser UI on macOS, Windows, or Linux.
              </p>
              <code style={{ fontSize: '0.85em', color: '#8ec8e8' }}>npm run desktop</code>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment inverted style={{ background: 'rgba(255,255,255,0.08)', height: '100%' }}>
              <Header as="h4" inverted style={{ marginTop: 0 }}>
                <Icon name="code" /> Developer
              </Header>
              <p style={{ fontSize: '0.92em', lineHeight: 1.5, color: '#ccc' }}>
                Clone the repo and start hacking. The hub is a Node.js service with
                a React UI, Bitcoin RPC, and Fabric P2P built in.
              </p>
              <code style={{ fontSize: '0.85em', color: '#8ec8e8' }}>git clone &amp;&amp; npm start</code>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment inverted style={{ background: 'rgba(255,255,255,0.08)', height: '100%' }}>
              <Header as="h4" inverted style={{ marginTop: 0 }}>
                <Icon name="server" /> Production
              </Header>
              <p style={{ fontSize: '0.92em', lineHeight: 1.5, color: '#ccc' }}>
                Deploy on a VPS or home server for always-on peering, document
                hosting, and Bitcoin services with LAN or public access.
              </p>
              <code style={{ fontSize: '0.85em', color: '#8ec8e8' }}>npm run start:production</code>
            </Segment>
          </Grid.Column>
        </Grid>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65em', alignItems: 'center' }}>
          <Button
            as="a"
            href="https://github.com/FabricLabs/hub.fabric.pub"
            target="_blank"
            rel="noopener noreferrer"
            primary
            size="small"
          >
            <Icon name="github" /> View on GitHub
          </Button>
          <Button
            as={Link}
            to="/documents"
            basic
            inverted
            size="small"
          >
            <Icon name="file alternate outline" /> Browse documents
          </Button>
          <Button
            as={Link}
            to="/settings"
            basic
            inverted
            size="small"
          >
            <Icon name="setting" /> Explore this hub
          </Button>
        </div>
      </div>
    </Segment>
  );
}

function StatCard ({ icon, color, label, value, sub }) {
  return (
    <Segment textAlign="center" style={{ margin: 0, padding: '1em 0.75em' }}>
      <Statistic size="small" style={{ margin: 0 }}>
        <Statistic.Value>
          <Icon name={icon} color={color || 'grey'} style={{ marginRight: '0.2em', fontSize: '0.85em' }} />
          {value != null ? value : '—'}
        </Statistic.Value>
        <Statistic.Label style={{ fontSize: '0.78em', marginTop: '0.35em' }}>{label}</Statistic.Label>
      </Statistic>
      {sub ? <div style={{ marginTop: '0.25em', fontSize: '0.82em', color: '#666' }}>{sub}</div> : null}
    </Segment>
  );
}

function HealthPanel ({ health, loading, error, onRefresh }) {
  if (error) {
    return (
      <Segment secondary style={{ padding: '0.85em' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35em' }}>
          <Header as="h4" style={{ margin: 0 }}><Icon name="heartbeat" /> Node health</Header>
          <Button basic size="mini" icon="refresh" onClick={onRefresh} loading={loading} />
        </div>
        <Message negative size="small" style={{ margin: '0.5em 0 0' }}>{error}</Message>
      </Segment>
    );
  }
  const node = health && health.node;
  const disk = health && health.disk;
  const net = health && health.network;
  const uptime = node ? formatDuration(node.uptimeSec) : '—';
  const cpuPct = node && node.cpu && Number.isFinite(Number(node.cpu.processPercent))
    ? `${Number(node.cpu.processPercent).toFixed(1)}%`
    : null;
  const memRss = node && node.memory ? formatBytes(node.memory.rss) : null;
  const diskUsed = disk ? `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.usedBytes + (disk.availableBytes || 0))}` : null;
  const diskPct = disk && Number.isFinite(Number(disk.usedPercent)) ? `${Number(disk.usedPercent).toFixed(1)}%` : null;
  const dns = net && net.dnsProbe;
  const probes = net && Array.isArray(net.localProbes) ? net.localProbes : [];
  const probeOk = probes.filter((p) => p.ok).length;

  return (
    <Segment secondary style={{ padding: '0.85em' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35em', marginBottom: '0.5em' }}>
        <Header as="h4" style={{ margin: 0 }}><Icon name="heartbeat" /> Node health</Header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          {health && health.now ? (
            <span style={{ fontSize: '0.82em', color: '#888' }}>{new Date(health.now).toLocaleTimeString()}</span>
          ) : null}
          <Button basic size="mini" icon="refresh" onClick={onRefresh} loading={loading} />
        </div>
      </div>
      {!health ? (
        <div style={{ color: '#888', fontSize: '0.9em' }}>Loading health data…</div>
      ) : (
        <Grid columns={2} stackable style={{ margin: 0 }}>
          <Grid.Row style={{ padding: '0.25em 0' }}>
            <Grid.Column>
              <div style={{ fontSize: '0.9em', lineHeight: 1.65 }}>
                <div><Icon name="server" color="blue" /> <strong>Host:</strong> {node && node.hostname ? node.hostname : '—'}</div>
                <div><Icon name="clock outline" color="blue" /> <strong>Uptime:</strong> {uptime}</div>
                {cpuPct ? <div><Icon name="microchip" color="blue" /> <strong>CPU:</strong> {cpuPct} ({node.cpu.cores} core{node.cpu.cores !== 1 ? 's' : ''})</div> : null}
                {node && Array.isArray(node.loadAverage) ? (
                  <div><Icon name="tachometer alternate" color="blue" /> <strong>Load:</strong> {node.loadAverage.map((v) => Number(v || 0).toFixed(2)).join(' / ')}</div>
                ) : null}
                {memRss ? <div><Icon name="database" color="blue" /> <strong>Memory:</strong> {memRss}</div> : null}
              </div>
            </Grid.Column>
            <Grid.Column>
              <div style={{ fontSize: '0.9em', lineHeight: 1.65 }}>
                {diskUsed ? <div><Icon name="hdd outline" color="teal" /> <strong>Disk:</strong> {diskUsed} ({diskPct})</div> : null}
                {disk && disk.availableBytes != null ? (
                  <div><Icon name="hdd outline" color="teal" /> <strong>Free:</strong> {formatBytes(disk.availableBytes)}</div>
                ) : null}
                <div>
                  <Icon name="signal" color={dns && dns.ok ? 'green' : 'red'} />
                  <strong>DNS:</strong> {dns ? (dns.ok ? 'ok' : 'failed') : '—'}
                </div>
                {probes.length > 0 ? (
                  <div>
                    <Icon name="plug" color={probeOk === probes.length ? 'green' : 'yellow'} />
                    <strong>Services:</strong> {probeOk}/{probes.length} reachable
                  </div>
                ) : null}
              </div>
            </Grid.Column>
          </Grid.Row>
        </Grid>
      )}
    </Segment>
  );
}

class Home extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      connectModalOpen: false,
      connectPeerIdDraft: '',
      networkStatusRenderTick: 0,
      lastNetworkSnapshotAt: null,
      snapshotRefreshPending: false,
      operatorHealth: null,
      operatorHealthLoading: false,
      operatorHealthError: null,
      promoDismissed: false
    };
    this._snapshotRefreshSafetyTimer = null;
    this._healthRefreshTimer = null;
    this._onNetworkStatusEvent = () => {
      if (this._snapshotRefreshSafetyTimer) {
        clearTimeout(this._snapshotRefreshSafetyTimer);
        this._snapshotRefreshSafetyTimer = null;
      }
      this.setState((s) => ({
        networkStatusRenderTick: (s.networkStatusRenderTick || 0) + 1,
        lastNetworkSnapshotAt: Date.now(),
        snapshotRefreshPending: false
      }));
    };
    this._homeHttpFallbackTimer = null;
    this._homeHttpHydrateAttempted = false;
  }

  componentDidMount () {
    if (typeof window !== 'undefined') {
      window.addEventListener('networkStatusUpdate', this._onNetworkStatusEvent);
    }
    this._scheduleHomeNetworkHttpFallback();
    this._touchSnapshotTimeIfReady();
    setTimeout(() => this._touchSnapshotTimeIfReady(), 0);
    this._refreshOperatorHealth();
    this._healthRefreshTimer = setInterval(() => this._refreshOperatorHealth(), 30000);
  }

  componentWillUnmount () {
    if (typeof window !== 'undefined') {
      window.removeEventListener('networkStatusUpdate', this._onNetworkStatusEvent);
    }
    if (this._homeHttpFallbackTimer) {
      clearTimeout(this._homeHttpFallbackTimer);
      this._homeHttpFallbackTimer = null;
    }
    if (this._snapshotRefreshSafetyTimer) {
      clearTimeout(this._snapshotRefreshSafetyTimer);
      this._snapshotRefreshSafetyTimer = null;
    }
    if (this._healthRefreshTimer) {
      clearInterval(this._healthRefreshTimer);
      this._healthRefreshTimer = null;
    }
  }

  componentDidUpdate () {
    this._scheduleHomeNetworkHttpFallback();
    this._touchSnapshotTimeIfReady();
  }

  _touchSnapshotTimeIfReady () {
    const ref = this.props.bridgeRef || this.props.bridge;
    const cur = ref && ref.current;
    const ns = cur && (cur.networkStatus || cur.lastNetworkStatus);
    if (!isHubNetworkStatusShape(ns)) return;
    if (this.state.lastNetworkSnapshotAt != null) return;
    this.setState({ lastNetworkSnapshotAt: Date.now() });
  }

  _scheduleHomeNetworkHttpFallback () {
    if (typeof window === 'undefined') return;
    if (this._homeHttpHydrateAttempted) return;
    const ref = this.props.bridgeRef || this.props.bridge;
    const current = ref && ref.current;
    if (!current) return;
    const ns = current.networkStatus || current.lastNetworkStatus;
    if (isHubNetworkStatusShape(ns)) {
      if (this._homeHttpFallbackTimer) {
        clearTimeout(this._homeHttpFallbackTimer);
        this._homeHttpFallbackTimer = null;
      }
      return;
    }
    if (this._homeHttpFallbackTimer) return;
    this._homeHttpFallbackTimer = setTimeout(async () => {
      this._homeHttpFallbackTimer = null;
      this._homeHttpHydrateAttempted = true;
      const r2 = this.props.bridgeRef || this.props.bridge;
      const cur = r2 && r2.current;
      if (!cur) return;
      const n2 = cur.networkStatus || cur.lastNetworkStatus;
      if (isHubNetworkStatusShape(n2)) return;
      const origin = window.location && window.location.origin ? window.location.origin : '';
      await hydrateHubNetworkStatusViaHttp(cur, origin);
    }, 2500);
  }

  async _refreshOperatorHealth () {
    this.setState({ operatorHealthLoading: true, operatorHealthError: null });
    try {
      const res = await fetch('/services/operator/health', { headers: { Accept: 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json && json.message) || `${res.status} ${res.statusText}`);
      this.setState({ operatorHealth: json || null });
    } catch (e) {
      this.setState({ operatorHealthError: e && e.message ? e.message : String(e) });
    } finally {
      this.setState({ operatorHealthLoading: false });
    }
  }

  _openConnectModal = () => {
    this.setState({ connectModalOpen: true, connectPeerIdDraft: '' });
  };

  _closeConnectModal = () => {
    this.setState({ connectModalOpen: false, connectPeerIdDraft: '' });
  };

  _submitConnectPeerId = () => {
    const { onConnectWebRTCPeer } = this.props;
    const value = String(this.state.connectPeerIdDraft || '').trim();
    if (!value || typeof onConnectWebRTCPeer !== 'function') return;
    onConnectWebRTCPeer(value);
    this.setState({ connectModalOpen: false, connectPeerIdDraft: '' });
  };

  render () {
    const {
      bridge,
      bridgeRef,
      networkStatusFromEvent,
      onDiscoverWebRTCPeers,
      onRepublishWebRTCOffer,
      onConnectWebRTCPeer,
      onRequireUnlock,
      adminToken,
      auth
    } = this.props;
    const publicHubVisitor = !!(this.props && this.props.publicHubVisitor);
    const showHomeOperatorLinks = !publicHubVisitor;
    const uf = loadHubUiFeatureFlags();
    const hasHubAdminForPeers = !!readHubAdminTokenFromBrowser(adminToken);
    const ref = bridgeRef || bridge;
    const current = ref && ref.current;
    const candidateFromEvent = networkStatusFromEvent;
    const candidateFromRef = current && current.networkStatus;
    const candidate = isHubNetworkStatusShape(candidateFromEvent)
      ? candidateFromEvent
      : (isHubNetworkStatusShape(candidateFromRef) ? candidateFromRef : null);
    const fallback = current && current.lastNetworkStatus;
    const networkStatus = isHubNetworkStatusShape(candidate)
      ? candidate
      : (isHubNetworkStatusShape(fallback) ? fallback : null);
    const network = networkStatus && networkStatus.network;
    const peers = Array.isArray(networkStatus && networkStatus.peers) ? networkStatus.peers : [];
    const connectedPeers = peers.filter((p) => p && p.status === 'connected');
    const webrtcPeers = Array.isArray(networkStatus && networkStatus.webrtcPeers) ? networkStatus.webrtcPeers : [];
    const state = networkStatus && networkStatus.state;
    const stateStatusUpper = (state && state.status != null)
      ? String(state.status).trim().toUpperCase()
      : '';
    const bridgeFabricPaused = stateStatusUpper === 'PAUSED';
    const fabricPeerId = networkStatus && networkStatus.fabricPeerId
      ? String(networkStatus.fabricPeerId)
      : null;
    const legacyUnstableId = !fabricPeerId && networkStatus && networkStatus.contract != null
      ? String(networkStatus.contract)
      : null;
    const shareNodeId = fabricPeerId || legacyUnstableId;
    const hostPort = network && network.address ? String(network.address) : null;
    const shareableString = [shareNodeId, hostPort].filter(Boolean).join('\n');
    const meshStatus = current && typeof current.webrtcMeshStatus !== 'undefined'
      ? current.webrtcMeshStatus
      : null;
    const isOnline = !!networkStatus;
    const publishedMap = networkStatus && networkStatus.publishedDocuments && typeof networkStatus.publishedDocuments === 'object'
      ? networkStatus.publishedDocuments
      : {};
    const publishedCount = Object.values(publishedMap).filter((d) => d && d.id).length;
    const transportHint = bridgeWebSocketLoadingHint(current);
    const dataStatusLine = (() => {
      if (!transportHint) return 'Preparing a connection to this hub.';
      if (/waiting for network status/i.test(transportHint)) {
        return 'Next: the hub sends your network snapshot (peers, documents, node id).';
      }
      if (/Opening WebSocket|Reconnecting/i.test(transportHint)) {
        return 'The browser bridge must connect before status can load.';
      }
      return null;
    })();
    const hubLoadingHeader = (() => {
      if (transportHint && /waiting for network status/i.test(transportHint)) return 'Connected — waiting for hub data';
      if (transportHint && /Opening WebSocket/i.test(transportHint)) return 'Opening WebSocket…';
      if (transportHint && /Reconnecting/i.test(transportHint)) return 'Reconnecting…';
      return 'Waiting for hub snapshot…';
    })();
    const hubLoadingLead = transportHint || 'Opening a connection to the hub…';
    const bitcoin = networkStatus && networkStatus.bitcoin && typeof networkStatus.bitcoin === 'object'
      ? networkStatus.bitcoin
      : null;
    const clockVal = networkStatus && networkStatus.clock;
    const snapshotUpdated =
      this.state.lastNetworkSnapshotAt != null && typeof this.state.lastNetworkSnapshotAt === 'number'
        ? new Date(this.state.lastNetworkSnapshotAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
        : null;
    const contractId = networkStatus && networkStatus.contract != null ? String(networkStatus.contract) : '';
    const contractShort = contractId.length > 18 ? `${contractId.slice(0, 10)}…${contractId.slice(-6)}` : contractId;

    return (
      <fabric-hub-home class='fade-in'>
        {!networkStatus ? (
          <Card fluid data-home-network-tick={this.state.networkStatusRenderTick}>
            <Card.Content>
              <Segment basic>
                <Segment
                  placeholder
                  style={{ minHeight: '30vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
                    <Loader active inline="centered" size="large" />
                    <Header as='h4' style={{ marginTop: '1em', textAlign: 'center' }}>
                      {hubLoadingHeader}
                      <Header.Subheader style={{ textAlign: 'center', lineHeight: 1.5 }}>
                        <span style={{ display: 'block' }}>{hubLoadingLead}</span>
                        {dataStatusLine && dataStatusLine !== hubLoadingLead ? (
                          <span style={{ display: 'block', color: '#888', fontSize: '0.92em', marginTop: '0.35em' }}>
                            {dataStatusLine}
                          </span>
                        ) : null}
                      </Header.Subheader>
                    </Header>
                    {typeof this.props.onRefreshNetworkStatus === 'function' && (
                      <div style={{ marginTop: '1.1em' }}>
                        <Button type="button" size="small" basic icon labelPosition="left" onClick={() => { try { this.props.onRefreshNetworkStatus(); } catch (e) {} }}>
                          <Icon name="refresh" />
                          Request status again
                        </Button>
                        <p style={{ color: '#888', fontSize: '0.85em', marginTop: '0.75em', marginBottom: 0, lineHeight: 1.45 }}>
                          If this stays here, confirm the hub is up and the WebSocket bridge is connected.
                        </p>
                      </div>
                    )}
                  </div>
                </Segment>
              </Segment>
            </Card.Content>
          </Card>
        ) : (
          <>
            {/* ─── Promo hero (opt-in via Admin → Feature visibility) ─── */}
            {uf.promo && !this.state.promoDismissed ? (
              <PromoHero onDismiss={() => this.setState({ promoDismissed: true })} />
            ) : null}

            {/* ─── Stat cards row ─── */}
            <Grid columns={4} stackable doubling style={{ marginBottom: '0.5em' }}>
              <Grid.Column>
                <StatCard
                  icon="circle"
                  color={bridgeFabricPaused ? 'yellow' : (isOnline ? 'green' : 'grey')}
                  label="Fabric state"
                  value={bridgeFabricPaused ? 'Paused' : (isOnline ? 'Online' : 'Offline')}
                  sub={(state && state.status) || null}
                />
              </Grid.Column>
              <Grid.Column>
                <StatCard
                  icon="sitemap"
                  color="blue"
                  label={uf.peers && hasHubAdminForPeers ? 'TCP peers' : 'Peers'}
                  value={uf.peers && hasHubAdminForPeers ? `${connectedPeers.length} / ${peers.length}` : '—'}
                  sub={uf.peers && hasHubAdminForPeers && webrtcPeers.length > 0 ? `${webrtcPeers.length} WebRTC` : (uf.peers && hasHubAdminForPeers ? null : 'admin token required')}
                />
              </Grid.Column>
              <Grid.Column>
                <StatCard
                  icon="file alternate outline"
                  color="teal"
                  label="Published docs"
                  value={publishedCount}
                  sub={clockVal != null ? `hub clock ${clockVal}` : null}
                />
              </Grid.Column>
              <Grid.Column>
                <StatCard
                  icon="bitcoin"
                  color={bitcoin && bitcoin.available ? 'orange' : 'grey'}
                  label="Bitcoin"
                  value={bitcoin ? (bitcoin.available ? (bitcoin.height != null ? `#${bitcoin.height}` : 'Ready') : 'Off') : '—'}
                  sub={bitcoin && bitcoin.available && bitcoin.network ? String(bitcoin.network) : null}
                />
              </Grid.Column>
            </Grid>

            {/* ─── Main content ─── */}
            <Card fluid data-home-network-tick={this.state.networkStatusRenderTick}>
              <Card.Content>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5em', marginBottom: '0.5em' }}>
                  <Card.Header style={{ margin: 0 }}>Node overview</Card.Header>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
                    {snapshotUpdated ? (
                      <span style={{ fontSize: '0.82em', color: '#888' }}>Updated {snapshotUpdated}</span>
                    ) : null}
                    {typeof this.props.onRefreshNetworkStatus === 'function' ? (
                      <Button
                        type="button"
                        size="mini"
                        basic
                        icon
                        aria-label="Refresh hub network snapshot"
                        disabled={this.state.snapshotRefreshPending}
                        loading={this.state.snapshotRefreshPending}
                        onClick={() => {
                          try {
                            this.setState({ snapshotRefreshPending: true });
                            if (this._snapshotRefreshSafetyTimer) clearTimeout(this._snapshotRefreshSafetyTimer);
                            this._snapshotRefreshSafetyTimer = setTimeout(() => {
                              this._snapshotRefreshSafetyTimer = null;
                              this.setState({ snapshotRefreshPending: false });
                            }, 10000);
                            this.props.onRefreshNetworkStatus();
                          } catch (e) {
                            this.setState({ snapshotRefreshPending: false });
                          }
                        }}
                      >
                        <Icon name="refresh" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <Card.Description>
                  {/* ─── Identity & network ─── */}
                  <Segment style={{ marginBottom: '0.85em', padding: '0.85em' }}>
                    <Header as="h4" style={{ margin: '0 0 0.5em' }}><Icon name="id badge" /> Identity &amp; network</Header>
                    <Grid columns={2} stackable style={{ margin: 0 }}>
                      <Grid.Row style={{ padding: '0.15em 0' }}>
                        <Grid.Column>
                          <div style={{ fontSize: '0.9em', lineHeight: 1.75 }}>
                            {fabricPeerId ? (
                              <div>
                                <strong>Fabric id:</strong>{' '}
                                <code style={{ wordBreak: 'break-all', fontSize: '0.88em' }} title={fabricPeerId}>
                                  {fabricPeerId.length > 20 ? `${fabricPeerId.slice(0, 10)}…${fabricPeerId.slice(-8)}` : fabricPeerId}
                                </code>
                              </div>
                            ) : null}
                            {hostPort ? (
                              <div><strong>Listen:</strong> <code style={{ fontSize: '0.88em' }}>{hostPort}</code></div>
                            ) : null}
                            {contractShort ? (
                              <div><strong>Contract:</strong> <code style={{ fontSize: '0.88em' }} title={contractId}>{contractShort}</code></div>
                            ) : null}
                          </div>
                        </Grid.Column>
                        <Grid.Column>
                          <div style={{ fontSize: '0.9em', lineHeight: 1.75 }}>
                            {uf.peers && hasHubAdminForPeers ? (
                              <>
                                <div>
                                  <strong>Peers:</strong> {connectedPeers.length} connected / {peers.length} known
                                  {' · '}
                                  <Link to="/peers" style={{ fontSize: '0.92em' }}>Manage</Link>
                                </div>
                                <div>
                                  <strong>WebRTC registry:</strong> {webrtcPeers.length}
                                  {meshStatus && Number(meshStatus.connected) > 0 ? ` (${meshStatus.connected} mesh)` : ''}
                                </div>
                              </>
                            ) : null}
                            <div><strong>Documents:</strong> {publishedCount} published</div>
                          </div>
                        </Grid.Column>
                      </Grid.Row>
                    </Grid>
                    {uf.peers && hasHubAdminForPeers && shareableString ? (
                      <div style={{ marginTop: '0.65em' }}>
                        <Button
                          size='mini'
                          basic
                          icon
                          labelPosition='left'
                          onClick={() => {
                            try {
                              if (navigator.clipboard && navigator.clipboard.writeText) {
                                navigator.clipboard.writeText(shareableString);
                              }
                            } catch (e) {}
                          }}
                          title="Copy Fabric node ID and listen address"
                        >
                          <Icon name='copy' />
                          Copy node id
                        </Button>
                      </div>
                    ) : null}
                  </Segment>

                  {/* ─── Bitcoin ─── */}
                  {bitcoin ? (
                    <Segment style={{ marginBottom: '0.85em', padding: '0.85em' }}>
                      <Header as="h4" style={{ margin: '0 0 0.5em' }}>
                        <Icon name="bitcoin" color="orange" /> Bitcoin
                      </Header>
                      {bitcoin.available ? (
                        <div style={{ fontSize: '0.9em', lineHeight: 1.75 }}>
                          <div>
                            <Label size="mini" color="green" style={{ marginRight: '0.5em' }}>Available</Label>
                            <strong>Network:</strong> {bitcoin.network || '—'}
                            {bitcoin.height != null ? <span> · <strong>Height:</strong> {bitcoin.height}</span> : null}
                          </div>
                          {bitcoin.bestBlockHash ? (
                            <div><strong>Tip:</strong> <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>{String(bitcoin.bestBlockHash).slice(0, 16)}…</code></div>
                          ) : null}
                          {bitcoin.mempoolTxCount != null ? (
                            <div><strong>Mempool:</strong> {bitcoin.mempoolTxCount} tx{bitcoin.mempoolBytes ? ` (${formatBytes(bitcoin.mempoolBytes)})` : ''}</div>
                          ) : null}
                          {showHomeOperatorLinks ? (
                            <div style={{ marginTop: '0.35em' }}>
                              <Link to="/services/bitcoin">Bitcoin dashboard</Link>
                              {uf.bitcoinLightning ? <>{' · '}<Link to="/services/bitcoin/lightning">Lightning</Link></> : null}
                              {' · '}
                              <Link to="/services/bitcoin/transactions?scope=wallet">Wallet</Link>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div style={{ color: '#888', fontSize: '0.9em' }}>
                          {bitcoin.message ? String(bitcoin.message) : 'Bitcoin service is not available.'}
                        </div>
                      )}
                    </Segment>
                  ) : null}

                  {/* ─── Operator health ─── */}
                  <HealthPanel
                    health={this.state.operatorHealth}
                    loading={this.state.operatorHealthLoading}
                    error={this.state.operatorHealthError}
                    onRefresh={() => this._refreshOperatorHealth()}
                  />

                  {/* ─── Quick links ─── */}
                  {showHomeOperatorLinks ? (
                    <Segment style={{ marginTop: '0.85em', padding: '0.85em' }}>
                      <Header as="h4" style={{ margin: '0 0 0.5em' }}><Icon name="compass outline" /> Quick links</Header>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
                        <Button as={Link} to="/documents" size="small" basic><Icon name="file alternate outline" /> Documents</Button>
                        {uf.peers ? <Button as={Link} to="/peers" size="small" basic><Icon name="sitemap" /> Peers</Button> : null}
                        <Button as={Link} to="/settings" size="small" basic><Icon name="setting" /> Settings</Button>
                        {bitcoin && bitcoin.available ? (
                          <Button as={Link} to="/services/bitcoin" size="small" basic><Icon name="bitcoin" /> Bitcoin</Button>
                        ) : null}
                        {uf.sidechain ? (
                          <Button as={Link} to="/federations" size="small" basic><Icon name="users" /> Federations</Button>
                        ) : null}
                        <Button as={Link} to="/contracts" size="small" basic><Icon name="file code outline" /> Contracts</Button>
                        <Button as={Link} to="/settings/collaboration" size="small" basic><Icon name="handshake outline" /> Collaboration</Button>
                        {uf.activities ? (
                          <Button as={Link} to="/activities" size="small" basic><Icon name="list alternate outline" /> Activity log</Button>
                        ) : null}
                        <Button as={Link} to="/settings/admin" size="small" basic><Icon name="shield" /> Admin</Button>
                      </div>
                    </Segment>
                  ) : null}

                  {/* ─── Credentials hint (compact) ─── */}
                  {!hasHubAdminForPeers && showHomeOperatorLinks ? (
                    <Message size="small" style={{ marginTop: '0.85em' }}>
                      <Message.Header>Admin token not saved</Message.Header>
                      <p style={{ margin: '0.25em 0 0', lineHeight: 1.45 }}>
                        Paste your operator token in <Link to="/settings">Settings</Link> to unlock peer details, full statistics, and operator controls.
                      </p>
                    </Message>
                  ) : null}

                  {!uf.peers && showHomeOperatorLinks ? (
                    <Message warning size="small" style={{ marginTop: '0.85em' }}>
                      <Message.Header>Peers &amp; WebRTC hidden</Message.Header>
                      <p style={{ margin: '0.25em 0 0', lineHeight: 1.45 }}>
                        Enable the <strong>peers</strong> flag under <Link to="/settings/admin">Admin → Feature visibility</Link>.
                      </p>
                    </Message>
                  ) : null}
                </Card.Description>
              </Card.Content>
            </Card>
          </>
        )}

        {/* ─── Global chat ─── */}
        {networkStatus ? (
          <Segment
            role="region"
            style={{ marginTop: '1.25em' }}
            aria-labelledby="home-global-chat-heading"
          >
            <Header as="h2" id="home-global-chat-heading" style={{ marginTop: 0 }}>
              Global chat
            </Header>
            <p style={{ color: '#666', marginTop: '-0.25em', marginBottom: '0.75em' }}>
              {uf.activities ? (
                <>
                  <Link to="/notifications">Notifications</Link>
                  {' · '}
                  <Link to="/activities">Activity log</Link>
                </>
              ) : null}
              {uf.activities ? ' · ' : ''}
              <Link to="/settings/security">Delegation &amp; signing</Link>
            </p>
            <div style={{ minHeight: '12rem' }}>
              <ActivityStream
                bridge={ref}
                bridgeRef={ref}
                adminToken={adminToken}
                identity={auth}
                onRequireUnlock={onRequireUnlock}
                includeHeader={false}
                entryTypeFilter="chat"
              />
            </div>
          </Segment>
        ) : null}

        {/* ─── WebRTC connect modal ─── */}
        <Modal open={this.state.connectModalOpen} size="tiny" onClose={this._closeConnectModal} closeOnEscape closeOnDimmerClick>
          <Modal.Header>Connect to WebRTC peer</Modal.Header>
          <Modal.Content>
            <Form onSubmit={(e) => { e.preventDefault(); this._submitConnectPeerId(); }}>
              <Form.Field>
                <label htmlFor="home-webrtc-peer-id">Peer ID</label>
                <Input
                  id="home-webrtc-peer-id"
                  placeholder="fabric-bridge-…"
                  value={this.state.connectPeerIdDraft}
                  onChange={(e) => this.setState({ connectPeerIdDraft: e.target.value })}
                />
              </Form.Field>
            </Form>
          </Modal.Content>
          <Modal.Actions>
            <Button type="button" onClick={this._closeConnectModal}>Cancel</Button>
            <Button type="button" primary onClick={this._submitConnectPeerId}>
              <Icon name="plug" />
              Connect
            </Button>
          </Modal.Actions>
        </Modal>
      </fabric-hub-home>
    );
  }
}

function HomeWithLocation (props) {
  const location = useLocation();
  const [networkStatusFromEvent, setNetworkStatusFromEvent] = React.useState(null);

  React.useEffect(() => {
    const seed = () => {
      const inst = props.bridgeRef && props.bridgeRef.current;
      const n = inst && inst.networkStatus;
      if (isHubNetworkStatusShape(n)) setNetworkStatusFromEvent(n);
    };
    seed();
    const t = setTimeout(seed, 0);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    const onNs = (e) => {
      const n = e.detail && e.detail.networkStatus;
      setNetworkStatusFromEvent(n && typeof n === 'object' && isHubNetworkStatusShape(n) ? n : null);
    };
    window.addEventListener('networkStatusUpdate', onNs);
    return () => window.removeEventListener('networkStatusUpdate', onNs);
  }, []);

  React.useLayoutEffect(() => {
    scrollToHashElement(location.hash);
  }, [location.pathname, location.hash]);
  return <Home {...props} location={location} networkStatusFromEvent={networkStatusFromEvent} />;
}

module.exports = HomeWithLocation;
