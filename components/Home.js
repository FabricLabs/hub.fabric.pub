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
const { isHubNetworkStatusShape, bridgeConnectionPhase, bridgeWebSocketLoadingHint } = require('../functions/hubNetworkStatus');
const { hydrateHubNetworkStatusViaHttp } = require('../functions/hydrateHubNetworkStatusViaHttp');
const { loadHubUiFeatureFlags } = require('../functions/hubUiFeatureFlags');
const { readHubAdminTokenFromBrowser } = require('../functions/hubAdminTokenBrowser');
const { readStorageString, writeStorageString } = require('../functions/fabricBrowserState');
const { useHubHttpAvailable, useHubMeshAvailable } = require('./hubUiRuntime');
const t = require('../locales/en');

const hc = t.home.home;
const nav = t.shell.nav;

/** Persist visitor promo dismiss across reloads (session-only React state was not enough). */
const PROMO_DISMISSED_STORAGE_KEY = 'fabric.hub.promoDismissed';

function formatBytes (n) {
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
}

function formatDuration (secIn) {
  const sec = Number(secIn);
  if (!Number.isFinite(sec) || sec < 0) return t.common.none;
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
          title={hc.promo.dismiss}
          aria-label={hc.promo.dismiss}
          style={{ position: 'absolute', top: '0.75em', right: '0.75em', opacity: 0.6 }}
          onClick={onDismiss}
        >
          <Icon name="close" />
        </Button>
      ) : null}
      <div style={{ maxWidth: '52rem' }}>
        <Header as="h1" inverted style={{ marginTop: 0, fontSize: '1.75em', lineHeight: 1.3 }}>
          <Icon name="cube" style={{ fontSize: '0.85em', marginRight: '0.35em', verticalAlign: 'middle' }} />
          {hc.promo.title}
        </Header>
        <p style={{ fontSize: '1.1em', lineHeight: 1.65, marginBottom: '1em', color: '#d4d4d4' }}>
          {hc.promo.intro}
        </p>
        <p style={{ fontSize: '1em', lineHeight: 1.65, marginBottom: '1.25em', color: '#bbb' }}>
          {hc.promo.visiting}
        </p>

        <Header as="h3" inverted style={{ marginBottom: '0.65em', fontSize: '1.15em' }}>
          {hc.promo.runYourOwn}
        </Header>
        <Grid columns={3} stackable doubling style={{ marginBottom: '1em' }}>
          <Grid.Column>
            <Segment inverted style={{ background: 'rgba(255,255,255,0.08)', height: '100%' }}>
              <Header as="h4" inverted style={{ marginTop: 0 }}>
                <Icon name="desktop" /> {hc.promo.desktop}
              </Header>
              <p style={{ fontSize: '0.92em', lineHeight: 1.5, color: '#ccc' }}>
                {hc.promo.desktopBody}
              </p>
              <Button as={Link} to="/downloads" size="small" primary>
                <Icon name="download" /> {hc.promo.desktopCta}
              </Button>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment inverted style={{ background: 'rgba(255,255,255,0.08)', height: '100%' }}>
              <Header as="h4" inverted style={{ marginTop: 0 }}>
                <Icon name="code" /> {hc.promo.developer}
              </Header>
              <p style={{ fontSize: '0.92em', lineHeight: 1.5, color: '#ccc' }}>
                {hc.promo.developerBody}
              </p>
              <code style={{ fontSize: '0.85em', color: '#8ec8e8' }}>git clone &amp;&amp; npm start</code>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment inverted style={{ background: 'rgba(255,255,255,0.08)', height: '100%' }}>
              <Header as="h4" inverted style={{ marginTop: 0 }}>
                <Icon name="server" /> {hc.promo.production}
              </Header>
              <p style={{ fontSize: '0.92em', lineHeight: 1.5, color: '#ccc' }}>
                {hc.promo.productionBody}
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
            <Icon name="github" /> {hc.promo.github}
          </Button>
          <Button
            as={Link}
            to="/documents"
            basic
            inverted
            size="small"
          >
            <Icon name="file alternate outline" /> {hc.promo.browseDocuments}
          </Button>
          <Button
            as={Link}
            to="/settings"
            basic
            inverted
            size="small"
          >
            <Icon name="setting" /> {hc.promo.explore}
          </Button>
        </div>
      </div>
    </Segment>
  );
}

function StatCard ({ icon, color, label, value, sub }) {
  return (
    <Segment textAlign="center" style={{ margin: 0, padding: '1em 0.75em' }}>
      <Statistic size="mini" style={{ margin: 0 }}>
        <Statistic.Value>
          <Icon name={icon} color={color || 'grey'} style={{ marginRight: '0.2em', fontSize: '0.85em' }} />
          {value != null ? value : t.common.none}
        </Statistic.Value>
        <Statistic.Label style={{ fontSize: '0.78em', marginTop: '0.35em' }}>{label}</Statistic.Label>
      </Statistic>
      {sub ? <div style={{ marginTop: '0.25em', fontSize: '0.82em', color: '#666' }}>{sub}</div> : null}
    </Segment>
  );
}

function HealthPanel ({ health, loading, error, onRefresh }) {
  const c = hc.health;
  if (error) {
    return (
      <Segment secondary style={{ padding: '0.85em' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35em' }}>
          <Header as="h4" style={{ margin: 0 }}><Icon name="heartbeat" /> {c.title}</Header>
          <Button basic size="mini" icon="refresh" onClick={onRefresh} loading={loading} aria-label={c.refresh} title={c.refresh} />
        </div>
        <Message negative size="small" style={{ margin: '0.5em 0 0' }}>
          {c.loadFailed}
          <details className="hub-developer-details">
            <summary>{t.common.developerDetails}</summary>
            {error}
          </details>
        </Message>
      </Segment>
    );
  }
  const node = health && health.node;
  const disk = health && health.disk;
  const net = health && health.network;
  const uptime = node ? formatDuration(node.uptimeSec) : t.common.none;
  const cpuPct = node && node.cpu && Number.isFinite(Number(node.cpu.processPercent))
    ? `${Number(node.cpu.processPercent).toFixed(1)}%`
    : null;
  const memRss = node && node.memory ? formatBytes(node.memory.rss) : null;
  const diskPct = disk && Number.isFinite(Number(disk.usedPercent)) ? `${Number(disk.usedPercent).toFixed(1)}%` : null;
  const diskUsed = disk ? c.diskValue(formatBytes(disk.usedBytes), formatBytes(disk.usedBytes + (disk.availableBytes || 0)), diskPct) : null;
  const dns = net && net.dnsProbe;
  const probes = net && Array.isArray(net.localProbes) ? net.localProbes : [];
  const probeOk = probes.filter((p) => p.ok).length;

  return (
    <Segment secondary style={{ padding: '0.85em' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35em', marginBottom: '0.5em' }}>
        <Header as="h4" style={{ margin: 0 }}><Icon name="heartbeat" /> {c.title}</Header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          {health && health.now ? (
            <span style={{ fontSize: '0.82em', color: '#888' }}>{c.checkedAt(new Date(health.now).toLocaleTimeString())}</span>
          ) : null}
          <Button basic size="mini" icon="refresh" onClick={onRefresh} loading={loading} aria-label={c.refresh} title={c.refresh} />
        </div>
      </div>
      {!health ? (
        <div style={{ color: '#888', fontSize: '0.9em' }}>{c.loading}</div>
      ) : (
        <Grid columns={2} stackable style={{ margin: 0 }}>
          <Grid.Row style={{ padding: '0.25em 0' }}>
            <Grid.Column>
              <div style={{ fontSize: '0.9em', lineHeight: 1.65 }}>
                <div><Icon name="server" color="blue" /> <strong>{c.host}:</strong> {node && node.hostname ? node.hostname : t.common.none}</div>
                <div title={c.uptimeTitle}><Icon name="clock outline" color="blue" /> <strong>{c.uptime}:</strong> {uptime}</div>
                {cpuPct ? <div title={c.cpuTitle}><Icon name="microchip" color="blue" /> <strong>{c.cpu}:</strong> {c.cpuValue(cpuPct, node.cpu.cores)}</div> : null}
                {node && Array.isArray(node.loadAverage) ? (
                  <div title={c.loadTitle}><Icon name="tachometer alternate" color="blue" /> <strong>{c.load}:</strong> {node.loadAverage.map((v) => Number(v || 0).toFixed(2)).join(' / ')}</div>
                ) : null}
                {memRss ? <div title={c.memoryTitle}><Icon name="database" color="blue" /> <strong>{c.memory}:</strong> {memRss}</div> : null}
              </div>
            </Grid.Column>
            <Grid.Column>
              <div style={{ fontSize: '0.9em', lineHeight: 1.65 }}>
                {diskUsed ? <div><Icon name="hdd outline" color="teal" /> <strong>{c.disk}:</strong> {diskUsed}</div> : null}
                {disk && disk.availableBytes != null ? (
                  <div><Icon name="hdd outline" color="teal" /> <strong>{c.free}:</strong> {formatBytes(disk.availableBytes)}</div>
                ) : null}
                <div title={c.dnsTitle}>
                  <Icon name="signal" color={dns && dns.ok ? 'green' : 'red'} />
                  <strong>{c.dns}:</strong> {dns ? (dns.ok ? t.common.states.ok : t.common.states.failed) : t.common.none}
                </div>
                {probes.length > 0 ? (
                  <div>
                    <Icon name="plug" color={probeOk === probes.length ? 'green' : 'yellow'} />
                    <strong>{c.services}:</strong> {c.servicesValue(probeOk, probes.length)}
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

function ClientHomePanel () {
  const meshAvailable = useHubMeshAvailable();
  const c = hc.client;
  return (
    <Card fluid data-testid="hub-client-home">
      <Card.Content>
        <Header as="h2" id="hub-client-home-heading" style={{ marginTop: 0 }}>
          {c.title}
        </Header>
        <p style={{ color: '#666', lineHeight: 1.5, maxWidth: '40rem' }}>
          {c.body}
          {meshAvailable ? ` ${c.bodyMesh}` : ''}
        </p>
        <Button
          primary
          type="button"
          icon
          labelPosition="left"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('fabricOpenIdentityManager'));
            }
          }}
        >
          <Icon name="user circle" />
          {c.identity}
        </Button>
        <Button as={Link} to="/downloads" basic icon labelPosition="left" style={{ marginLeft: '0.5em' }} data-testid="hub-client-downloads">
          <Icon name="download" />
          {c.downloads}
        </Button>
        <Button as={Link} to="/settings" basic icon labelPosition="left" style={{ marginLeft: '0.5em' }}>
          <Icon name="setting" />
          {c.settings}
        </Button>
        <Button as={Link} to="/settings/bitcoin-wallet" basic icon labelPosition="left" style={{ marginLeft: '0.5em' }}>
          <Icon name="bitcoin" />
          {c.localWallet}
        </Button>
        {meshAvailable ? (
          <Button as={Link} to="/documents" basic icon labelPosition="left" style={{ marginLeft: '0.5em' }} data-testid="hub-client-documents">
            <Icon name="file outline" />
            {c.documents}
          </Button>
        ) : null}
        <p style={{ color: '#888', fontSize: '0.9em', marginTop: '1.25em', lineHeight: 1.45 }}>
          {meshAvailable ? c.footerMesh : c.footerNoHub}
        </p>
        {meshAvailable ? (
          <details className="hub-developer-details">
            <summary>{t.common.developerDetails}</summary>
            {c.footerMeshDeveloper}
          </details>
        ) : null}
      </Card.Content>
    </Card>
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
      promoDismissed: readStorageString(PROMO_DISMISSED_STORAGE_KEY) === '1'
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
    if (this.props.hubHttpAvailable === false) return;
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
    if (this.props.hubHttpAvailable === false) return;
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
    if (this.props.hubHttpAvailable === false) return;
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
    if (this.props.hubHttpAvailable === false) return;
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
    if (this.props.hubHttpAvailable === false) {
      return (
        <fabric-hub-home class="fade-in">
          <ClientHomePanel />
        </fabric-hub-home>
      );
    }

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
    const transportPhase = bridgeConnectionPhase(current);
    const transportHint = bridgeWebSocketLoadingHint(current);
    const loadingCopy = hc.loading;
    const dataStatusLine = (() => {
      if (!transportPhase) return loadingCopy.preparing;
      if (transportPhase === 'connected') return loadingCopy.nextStatus;
      return loadingCopy.bridgeFirst;
    })();
    const hubLoadingHeader = (() => {
      if (transportPhase === 'connected') return loadingCopy.headerWaitingData;
      if (transportPhase === 'opening') return loadingCopy.headerConnecting;
      if (transportPhase === 'reconnecting') return loadingCopy.headerReconnecting;
      return loadingCopy.headerDefault;
    })();
    const hubLoadingLead = transportHint || loadingCopy.lead;
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
                          {loadingCopy.retry}
                        </Button>
                        <p style={{ color: '#888', fontSize: '0.85em', marginTop: '0.75em', marginBottom: 0, lineHeight: 1.45 }}>
                          {loadingCopy.stuckHint}
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
            {/* ─── Promo hero: public visitors only (opt-in via Admin → Feature visibility) ─── */}
            {uf.promo && publicHubVisitor && !this.state.promoDismissed ? (
              <PromoHero
                onDismiss={() => {
                  try {
                    writeStorageString(PROMO_DISMISSED_STORAGE_KEY, '1');
                  } catch (e) {}
                  this.setState({ promoDismissed: true });
                }}
              />
            ) : null}

            {/* ─── Main content (Identity, Bitcoin, health, quick links) ─── */}
            <div data-home-network-tick={this.state.networkStatusRenderTick}>
              {/* ─── Identity & network ─── */}
              <Segment style={{ marginBottom: '0.85em', padding: '0.85em' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5em', marginBottom: '0.5em' }}>
                  <Header as="h4" style={{ margin: 0 }}><Icon name="id badge" /> {hc.network.title}</Header>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
                    {snapshotUpdated ? (
                      <span style={{ fontSize: '0.82em', color: '#888' }}>{hc.network.updated(snapshotUpdated)}</span>
                    ) : null}
                    {typeof this.props.onRefreshNetworkStatus === 'function' ? (
                      <Button
                        type="button"
                        size="mini"
                        basic
                        icon
                        aria-label={hc.network.refresh}
                        title={hc.network.refresh}
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
                <Grid columns={2} stackable style={{ margin: 0 }}>
                  <Grid.Row style={{ padding: '0.15em 0' }}>
                    <Grid.Column>
                      <div style={{ fontSize: '0.9em', lineHeight: 1.75 }}>
                        {fabricPeerId ? (
                          <div>
                            <strong>{hc.network.fabricId}:</strong>{' '}
                            <code style={{ wordBreak: 'break-all', fontSize: '0.88em' }} title={fabricPeerId}>
                              {fabricPeerId.length > 20 ? `${fabricPeerId.slice(0, 10)}…${fabricPeerId.slice(-8)}` : fabricPeerId}
                            </code>
                          </div>
                        ) : null}
                        {hostPort ? (
                          <div><strong>{hc.network.listen}:</strong> <code style={{ fontSize: '0.88em' }}>{hostPort}</code></div>
                        ) : null}
                        {contractShort ? (
                          <div><strong>{hc.network.contract}:</strong> <code style={{ fontSize: '0.88em' }} title={contractId}>{contractShort}</code></div>
                        ) : null}
                      </div>
                    </Grid.Column>
                    <Grid.Column>
                      <div style={{ fontSize: '0.9em', lineHeight: 1.75 }}>
                        {uf.peers && hasHubAdminForPeers ? (
                          <>
                            <div>
                              <strong>{hc.network.peers}:</strong> {hc.network.peersValue(connectedPeers.length, peers.length)}
                              {' · '}
                              <Link to="/peers" style={{ fontSize: '0.92em' }}>{hc.network.managePeers}</Link>
                            </div>
                            <div>
                              <strong>{hc.network.browserPeers}:</strong> {webrtcPeers.length}
                              {meshStatus && Number(meshStatus.connected) > 0 ? ` (${hc.network.browserPeersMesh(meshStatus.connected)})` : ''}
                            </div>
                          </>
                        ) : null}
                        <div><strong>{hc.network.documents}:</strong> {hc.network.documentsValue(publishedCount)}</div>
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
                      title={hc.network.copyNodeIdTitle}
                    >
                      <Icon name='copy' />
                      {hc.network.copyNodeId}
                    </Button>
                  </div>
                ) : null}
              </Segment>

              {/* ─── Bitcoin ─── */}
              {bitcoin ? (
                <Segment style={{ marginBottom: '0.85em', padding: '0.85em' }}>
                  <Header as="h4" style={{ margin: '0 0 0.5em' }}>
                    <Icon name="bitcoin" color="orange" /> {hc.bitcoin.title}
                  </Header>
                  {bitcoin.available ? (
                    <div style={{ fontSize: '0.9em', lineHeight: 1.75 }}>
                      <div>
                        <Label size="mini" color="green" style={{ marginRight: '0.5em' }}>{hc.bitcoin.available}</Label>
                        <strong>{hc.bitcoin.network}:</strong> {bitcoin.network || t.common.none}
                        {bitcoin.height != null ? <span> · <strong>{hc.bitcoin.height}:</strong> {bitcoin.height}</span> : null}
                      </div>
                      {bitcoin.bestBlockHash ? (
                        <div><strong>{hc.bitcoin.tip}:</strong> <code style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>{String(bitcoin.bestBlockHash).slice(0, 16)}…</code></div>
                      ) : null}
                      {bitcoin.mempoolTxCount != null ? (
                        <div><strong>{hc.bitcoin.mempool}:</strong> {hc.bitcoin.mempoolValue(bitcoin.mempoolTxCount, bitcoin.mempoolBytes ? formatBytes(bitcoin.mempoolBytes) : null)}</div>
                      ) : null}
                      {showHomeOperatorLinks ? (
                        <div style={{ marginTop: '0.35em' }}>
                          <Link to="/services/bitcoin">{hc.bitcoin.dashboard}</Link>
                          {uf.bitcoinLightning ? <>{' · '}<Link to="/services/bitcoin/lightning">{hc.bitcoin.lightning}</Link></> : null}
                          {' · '}
                          <Link to="/services/bitcoin/transactions?scope=wallet">{hc.bitcoin.wallet}</Link>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ color: '#888', fontSize: '0.9em' }}>
                      {bitcoin.message ? String(bitcoin.message) : hc.bitcoin.unavailable}
                    </div>
                  )}
                </Segment>
              ) : null}

              {/* ─── Operator health ─── */}
              {showHomeOperatorLinks ? (
                <HealthPanel
                  health={this.state.operatorHealth}
                  loading={this.state.operatorHealthLoading}
                  error={this.state.operatorHealthError}
                  onRefresh={() => this._refreshOperatorHealth()}
                />
              ) : null}

              {/* ─── Quick links ─── */}
              {showHomeOperatorLinks ? (
                <Segment style={{ marginTop: '0.85em', padding: '0.85em' }}>
                  <Header as="h4" style={{ margin: '0 0 0.5em' }}><Icon name="compass outline" /> {hc.quickLinks.title}</Header>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5em' }}>
                    <Button as={Link} to="/documents" size="small" basic><Icon name="file alternate outline" /> {nav.documents}</Button>
                    {uf.peers ? <Button as={Link} to="/peers" size="small" basic><Icon name="sitemap" /> {nav.peers}</Button> : null}
                    <Button as={Link} to="/settings" size="small" basic><Icon name="setting" /> {nav.settings}</Button>
                    {bitcoin && bitcoin.available ? (
                      <Button as={Link} to="/services/bitcoin" size="small" basic><Icon name="bitcoin" /> {nav.bitcoin}</Button>
                    ) : null}
                    {uf.sidechain ? (
                      <Button as={Link} to="/federations" size="small" basic><Icon name="users" /> {nav.federations}</Button>
                    ) : null}
                    <Button as={Link} to="/contracts" size="small" basic><Icon name="file code outline" /> {nav.contracts}</Button>
                    <Button as={Link} to="/settings/collaboration" size="small" basic><Icon name="handshake outline" /> {nav.collaboration}</Button>
                    {uf.activities ? (
                      <Button as={Link} to="/activities" size="small" basic><Icon name="list alternate outline" /> {nav.activityLog}</Button>
                    ) : null}
                    <Button as={Link} to="/settings/admin" size="small" basic><Icon name="shield" /> {nav.admin}</Button>
                  </div>
                </Segment>
              ) : null}

              {/* ─── Credentials hint (compact) ─── */}
              {!hasHubAdminForPeers && showHomeOperatorLinks ? (
                <Message size="small" style={{ marginTop: '0.85em' }}>
                  <Message.Header>{hc.adminToken.title}</Message.Header>
                  <p style={{ margin: '0.25em 0 0', lineHeight: 1.45 }}>
                    {hc.adminToken.before} <Link to="/settings">{hc.adminToken.link}</Link> {hc.adminToken.after}
                  </p>
                </Message>
              ) : null}

              {!uf.peers && showHomeOperatorLinks ? (
                <Message warning size="small" style={{ marginTop: '0.85em' }}>
                  <Message.Header>{hc.peersHidden.title}</Message.Header>
                  <p style={{ margin: '0.25em 0 0', lineHeight: 1.45 }}>
                    {hc.peersHidden.before} <Link to="/settings/admin">{hc.peersHidden.link}</Link>.
                  </p>
                </Message>
              ) : null}
            </div>
          </>
        )}

        {/* ─── Public mesh shoutbox ─── */}
        {networkStatus ? (
          <Segment
            role="region"
            style={{ marginTop: '1.25em' }}
            aria-labelledby="home-global-chat-heading"
          >
            <Header as="h2" id="home-global-chat-heading" style={{ marginTop: 0 }}>
              {hc.shoutbox.title}
            </Header>
            <p style={{ color: '#666', marginTop: '-0.25em', marginBottom: '0.75em' }}>
              {showHomeOperatorLinks && uf.activities ? (
                <>
                  <Link to="/notifications">{hc.shoutbox.notifications}</Link>
                  {' · '}
                </>
              ) : null}
              {showHomeOperatorLinks ? (
                <Link to="/settings/security">{nav.security}</Link>
              ) : (
                <span>{hc.shoutbox.visitor}</span>
              )}
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
          <Modal.Header>{hc.connect.title}</Modal.Header>
          <Modal.Content>
            <Form onSubmit={(e) => { e.preventDefault(); this._submitConnectPeerId(); }}>
              <Form.Field>
                <label htmlFor="home-webrtc-peer-id">{hc.connect.peerId}</label>
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
            <Button type="button" onClick={this._closeConnectModal}>{t.common.actions.cancel}</Button>
            <Button type="button" primary onClick={this._submitConnectPeerId}>
              <Icon name="plug" />
              {hc.connect.submit}
            </Button>
          </Modal.Actions>
        </Modal>
      </fabric-hub-home>
    );
  }
}

function HomeWithLocation (props) {
  const location = useLocation();
  const [networkStatusFromEvent, setNetworkStatusFromEvent] = React.useState(() => {
    const n = props.networkStatusFromEvent;
    return isHubNetworkStatusShape(n) ? n : null;
  });

  React.useEffect(() => {
    const seed = () => {
      const inst = props.bridgeRef && props.bridgeRef.current;
      const n = inst && inst.networkStatus;
      if (isHubNetworkStatusShape(n)) setNetworkStatusFromEvent(n);
    };
    seed();
    const timer = setTimeout(seed, 0);
    return () => clearTimeout(timer);
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
  const hubHttpAvailable = useHubHttpAvailable();
  return (
    <Home
      {...props}
      location={location}
      networkStatusFromEvent={networkStatusFromEvent}
      hubHttpAvailable={hubHttpAvailable}
    />
  );
}

module.exports = HomeWithLocation;
