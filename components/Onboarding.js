'use strict';

/**
 * First-time setup flow for Hub.
 * Stages: introduction → node configuration → Bitcoin (Lopp-style beginner knobs) → apply spinner.
 */

const React = require('react');
const {
  Accordion,
  Modal,
  Button,
  Header,
  Icon,
  Form,
  Input,
  Message,
  Segment,
  Select,
  Checkbox,
  Progress,
  Dimmer,
  Loader,
  Step,
  Table
} = require('semantic-ui-react');

const {
  HUB_BITCOIN_PRESETS,
  HUB_SETUP_APPLY_MIN_MS,
  bitcoinPresetSelectOptions,
  defaultBitcoinRpcPort,
  presetById
} = require('../functions/hubBitcoinSetup');

const BITCOIN_NETWORKS = [
  { key: 'regtest', value: 'regtest', text: 'Regtest (local development)', rpcPort: 18443 },
  { key: 'signet', value: 'signet', text: 'Signet (public test coins)', rpcPort: 38332 },
  { key: 'testnet', value: 'testnet', text: 'Testnet (public testing)', rpcPort: 18332 },
  { key: 'mainnet', value: 'mainnet', text: 'Mainnet (production)', rpcPort: 8332 }
];

const SETUP_STEPS = [
  { key: 'intro', title: 'Welcome', description: 'What this Hub does' },
  { key: 'node', title: 'Node', description: 'Name and HTTP' },
  { key: 'bitcoin', title: 'Bitcoin', description: 'Chain and Core' }
];

function sleepMs (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Onboarding extends React.Component {
  constructor (props) {
    super(props);
    this._binariesPoll = null;
    const preset = presetById(props.bitcoinPreset || 'local-dev');
    const network = props.bitcoinNetwork || preset.network || 'regtest';
    this.state = {
      open: true,
      step: 'intro',
      nodeName: props.nodeName || 'Hub',
      httpSharedMode: !!props.httpSharedMode,
      bitcoinPreset: preset.id,
      bitcoinNetwork: network,
      bitcoinManaged: props.bitcoinManaged !== false,
      bitcoinHost: props.bitcoinHost || '127.0.0.1',
      bitcoinRpcPort: props.bitcoinRpcPort || String(
        BITCOIN_NETWORKS.find((n) => n.value === network)?.rpcPort ?? defaultBitcoinRpcPort(network)
      ),
      bitcoinUsername: props.bitcoinUsername || '',
      bitcoinPassword: props.bitcoinPassword || '',
      bitcoinListen: props.bitcoinListen != null ? !!props.bitcoinListen : preset.listen,
      bitcoinTxrelay: props.bitcoinTxrelay != null ? !!props.bitcoinTxrelay : false,
      bitcoinPrune: props.bitcoinPrune != null ? String(props.bitcoinPrune) : String(preset.prune),
      bitcoinTxindex: props.bitcoinTxindex != null ? !!props.bitcoinTxindex : preset.txindex,
      bitcoinAccordion: 'network',
      bitcoinDbcache: props.bitcoinDbcache != null ? String(props.bitcoinDbcache) : String(preset.dbcache),
      bitcoinMaxconnections: props.bitcoinMaxconnections != null
        ? String(props.bitcoinMaxconnections)
        : String(preset.maxconnections),
      bitcoinMaxuploadtarget: props.bitcoinMaxuploadtarget != null
        ? String(props.bitcoinMaxuploadtarget)
        : String(preset.maxuploadtarget),
      lightningManaged: props.lightningManaged === true,
      lightningSocket: props.lightningSocket || '',
      diskAllocationMb: props.diskAllocationMb || '1024',
      costPerByteSats: (props.costPerByteSats != null && String(props.costPerByteSats).trim() !== '')
        ? String(props.costPerByteSats)
        : '0.01',
      saving: false,
      error: null,
      setupUiSecret: '',
      binariesStatus: null,
      binariesProgress: null,
      binariesBusy: false,
      binariesCheck: null,
      applyStatus: '',
      desktopHubStore: '',
      desktopUsesExternalHub: false
    };
  }

  componentDidMount () {
    this.refreshBinariesStatus();
    this.loadDesktopStorePath();
  }

  loadDesktopStorePath () {
    if (typeof window === 'undefined') return;
    const desk = window.fabricDesktop;
    if (!desk || typeof desk.getPaths !== 'function') return;
    Promise.resolve(desk.getPaths()).then((p) => {
      if (this._unmounted || !p || typeof p !== 'object') return;
      this.setState({
        desktopHubStore: typeof p.hubStore === 'string' ? p.hubStore : '',
        desktopUsesExternalHub: !!p.usesExternalHub
      });
    }).catch(() => {});
  }

  componentWillUnmount () {
    this._unmounted = true;
    if (this._binariesPoll) {
      clearInterval(this._binariesPoll);
      this._binariesPoll = null;
    }
  }

  getBaseUrl () {
    if (typeof window !== 'undefined' && window.location) {
      const protocol = window.location.protocol || 'http:';
      const host = window.location.hostname || 'localhost';
      const port = window.location.port || (protocol === 'https:' ? '443' : '80');
      return `${protocol}//${host}${port === '80' || port === '443' ? '' : ':' + port}`;
    }
    return 'http://localhost:8080';
  }

  applyBinariesStatus (status) {
    if (!status || typeof status !== 'object') return;
    const next = { binariesStatus: status };
    if (status.lastCheck && typeof status.lastCheck === 'object') {
      next.binariesCheck = status.lastCheck;
    }
    if (status.lightning && status.lightning.supported === false && this.state.lightningManaged) {
      next.lightningManaged = false;
    }
    this.setState(next);
  }

  refreshBinariesStatus = async () => {
    try {
      const res = await fetch(`${this.getBaseUrl()}/services/binaries`, {
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return;
      const json = await res.json();
      this.applyBinariesStatus(json);
      if (json.job && json.job.progress) {
        this.setState({ binariesProgress: json.job.progress });
      }
      if (json.lastCheck && typeof json.lastCheck === 'object') {
        this.setState({ binariesCheck: json.lastCheck });
      }
    } catch (_) {}
  };

  needsBinaryDownload () {
    const st = this.state.binariesStatus;
    if (this.state.bitcoinManaged && !(st && st.bitcoin && st.bitcoin.installed)) return true;
    if (this.state.lightningManaged && st && st.lightning && st.lightning.supported && !st.lightning.installed) {
      return true;
    }
    return false;
  }

  setupSecretHeadersBody () {
    const needsSecret = !!this.props.requiresSetupUiSecret;
    const secretTrim = String(this.state.setupUiSecret || '').trim();
    if (needsSecret && !secretTrim) {
      throw new Error('Enter the operator setup secret (FABRIC_HUB_SETUP_UI_SECRET).');
    }
    return {
      needsSecret,
      secretTrim,
      extra: needsSecret ? { setupUiSecret: secretTrim, SETUP_UI_SECRET: secretTrim } : {}
    };
  }

  applyPreset (presetId) {
    const preset = presetById(presetId);
    const net = BITCOIN_NETWORKS.find((n) => n.value === preset.network);
    this.setState({
      bitcoinPreset: preset.id,
      bitcoinNetwork: preset.network,
      bitcoinRpcPort: net && net.rpcPort ? String(net.rpcPort) : String(defaultBitcoinRpcPort(preset.network)),
      bitcoinListen: preset.listen,
      bitcoinTxrelay: !!preset.txrelay,
      bitcoinPrune: String(preset.prune),
      bitcoinTxindex: preset.txindex,
      bitcoinDbcache: String(preset.dbcache),
      bitcoinMaxconnections: String(preset.maxconnections),
      bitcoinMaxuploadtarget: String(preset.maxuploadtarget)
    });
  }

  goNext = () => {
    this.setState({ error: null });
    if (this.state.step === 'intro') this.setState({ step: 'node' });
    else if (this.state.step === 'node') this.setState({ step: 'bitcoin' });
  };

  goBack = () => {
    this.setState({ error: null });
    if (this.state.step === 'bitcoin') this.setState({ step: 'node' });
    else if (this.state.step === 'node') this.setState({ step: 'intro' });
  };

  installNodeBinaries = async () => {
    if (!this.needsBinaryDownload()) return;
    const { extra } = this.setupSecretHeadersBody();
    this.setState({ binariesBusy: true, binariesProgress: { phase: 'starting' }, applyStatus: 'Downloading node binaries…' });
    if (this._binariesPoll) clearInterval(this._binariesPoll);
    this._binariesPoll = setInterval(() => { this.refreshBinariesStatus(); }, 1000);
    try {
      const response = await fetch(`${this.getBaseUrl()}/services/binaries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          ...extra,
          bitcoin: this.state.bitcoinManaged,
          lightning: this.state.lightningManaged
        })
      });
      const text = await response.text();
      let body = {};
      if (!text.trim().startsWith('<')) {
        try { body = JSON.parse(text); } catch (_) {}
      }
      if (!response.ok) {
        throw new Error(body.message || body.error || `Binary download failed: ${response.status}`);
      }
      if (body.bitcoin && body.bitcoin.ok === false) {
        throw new Error(body.bitcoin.reason || 'Bitcoin Core download failed.');
      }
      if (this.state.lightningManaged && body.lightning && body.lightning.ok === false && !body.lightning.skipped) {
        throw new Error(body.lightning.reason || 'Core Lightning install failed.');
      }
      this.applyBinariesStatus(body.status || body);
    } finally {
      if (this._binariesPoll) {
        clearInterval(this._binariesPoll);
        this._binariesPoll = null;
      }
      this.setState({ binariesBusy: false });
      await this.refreshBinariesStatus();
    }
  };

  checkRemoteBinaries = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (this.state.binariesBusy) return;
    try {
      const { extra } = this.setupSecretHeadersBody();
      this.setState({
        binariesBusy: true,
        binariesProgress: { phase: 'starting', message: 'Checking publishers…' },
        error: null
      });
      if (this._binariesPoll) clearInterval(this._binariesPoll);
      this._binariesPoll = setInterval(() => { this.refreshBinariesStatus(); }, 1000);
      const response = await fetch(`${this.getBaseUrl()}/services/binaries/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          ...extra,
          bitcoin: this.state.bitcoinManaged,
          lightning: this.state.lightningManaged
        })
      });
      const text = await response.text();
      let body = {};
      if (!text.trim().startsWith('<')) {
        try { body = JSON.parse(text); } catch (_) {}
      }
      if (!response.ok) {
        throw new Error(body.message || body.error || `Remote check failed: ${response.status}`);
      }
      const check = body.lastCheck || body;
      this.setState({ binariesCheck: check });
      if (body.status) {
        this.applyBinariesStatus(Object.assign({}, body.status, { lastCheck: check }));
      }
    } catch (err) {
      this.setState({ error: err && err.message ? err.message : String(err) });
    } finally {
      if (this._binariesPoll) {
        clearInterval(this._binariesPoll);
        this._binariesPoll = null;
      }
      this.setState({ binariesBusy: false });
      await this.refreshBinariesStatus();
    }
  };

  async waitUntilConfigured (deadlineMs = 20000) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.getBaseUrl()}/settings`, {
          headers: { Accept: 'application/json' }
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.configured && !json.needsSetup) return json;
        }
      } catch (_) {}
      await sleepMs(200);
    }
    throw new Error('Hub did not report configured after writing stores. Check the server log and try again.');
  }

  handleComplete = async () => {
    this.setState({
      saving: true,
      error: null,
      step: 'applying',
      applyStatus: 'Writing Hub stores…'
    });
    const started = Date.now();
    try {
      const baseUrl = this.getBaseUrl();
      const { extra } = this.setupSecretHeadersBody();
      if (this.state.bitcoinManaged || this.state.lightningManaged) {
        await this.installNodeBinaries();
      }
      this.setState({ applyStatus: 'Saving settings…' });
      const pruneN = parseInt(this.state.bitcoinPrune, 10);
      const response = await fetch(`${baseUrl}/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          ...extra,
          NODE_NAME: this.state.nodeName.trim() || 'Hub',
          NODE_PERSONALITY: JSON.stringify(['helpful']),
          NODE_TEMPERATURE: 0,
          NODE_GOALS: JSON.stringify([]),
          HTTP_SHARED_MODE: !!this.state.httpSharedMode,
          BITCOIN_NETWORK: this.state.bitcoinNetwork,
          BITCOIN_MANAGED: this.state.bitcoinManaged,
          BITCOIN_PRESET: this.state.bitcoinPreset,
          BITCOIN_PRUNE: Number.isFinite(pruneN) ? pruneN : 0,
          BITCOIN_TXINDEX: !!this.state.bitcoinTxindex,
          BITCOIN_TXRELAY: !!this.state.bitcoinTxrelay,
          BITCOIN_LISTEN: !!this.state.bitcoinListen,
          BITCOIN_DBCACHE: parseInt(this.state.bitcoinDbcache, 10) || 450,
          BITCOIN_MAXCONNECTIONS: parseInt(this.state.bitcoinMaxconnections, 10) || 40,
          BITCOIN_MAXUPLOADTARGET: parseInt(this.state.bitcoinMaxuploadtarget, 10) || 0,
          DISK_ALLOCATION_MB: Math.max(1, parseInt(this.state.diskAllocationMb, 10) || 1024),
          COST_PER_BYTE_SATS: this.state.costPerByteSats.trim()
            ? Math.max(0, parseFloat(this.state.costPerByteSats) || 0)
            : 0.01,
          ...(this.state.bitcoinManaged ? {} : {
            BITCOIN_HOST: this.state.bitcoinHost,
            BITCOIN_RPC_PORT: this.state.bitcoinRpcPort,
            BITCOIN_USERNAME: this.state.bitcoinUsername,
            BITCOIN_PASSWORD: this.state.bitcoinPassword
          }),
          LIGHTNING_MANAGED: this.state.lightningManaged,
          ...(this.state.lightningManaged ? {} : {
            LIGHTNING_SOCKET: this.state.lightningSocket
          })
        })
      });

      const text = await response.text();
      if (!response.ok) {
        let errBody = {};
        if (!text.trim().startsWith('<')) {
          try { errBody = JSON.parse(text); } catch (_) {}
        }
        throw new Error(errBody.message || errBody.error || `Setup failed: ${response.status}`);
      }

      if (text.trim().startsWith('<')) {
        throw new Error('Server returned HTML instead of JSON. Ensure the Hub is running (npm start) and the proxy target is correct.');
      }
      const result = JSON.parse(text);
      this.setState({ applyStatus: 'Confirming stores on disk…' });
      await this.waitUntilConfigured();
      const elapsed = Date.now() - started;
      if (elapsed < HUB_SETUP_APPLY_MIN_MS) {
        await sleepMs(HUB_SETUP_APPLY_MIN_MS - elapsed);
      }
      if (this.props.onConfigurationComplete) {
        this.props.onConfigurationComplete({
          token: result.token,
          configured: result.configured,
          expiresAt: result.expiresAt
        });
      }
      this.setState({ open: false, saving: false });
    } catch (err) {
      let message = err && err.message ? err.message : 'Setup failed';
      if (message.includes('fetch') || message.includes('Failed to fetch') || message.includes('NetworkError')) {
        message = 'Cannot reach the Hub. Ensure the server is running (npm start) and try again.';
      }
      this.setState({
        saving: false,
        binariesBusy: false,
        step: 'bitcoin',
        error: message
      });
    }
  };

  binariesProgressPercent () {
    const p = this.state.binariesProgress;
    if (p && Number(p.total) > 0) {
      return Math.min(100, Math.floor((Number(p.received || 0) / Number(p.total)) * 100));
    }
    return this.state.binariesBusy ? 50 : 0;
  }

  binariesProgressLabel () {
    const p = this.state.binariesProgress;
    if (!p) return this.state.binariesBusy ? 'Working…' : '';
    if (p.phase === 'download' && p.file && Number(p.total) > 0) {
      return `Downloading ${p.file} (${this.binariesProgressPercent()}%)`;
    }
    if (p.phase === 'download' && p.file) return `Downloading ${p.file}`;
    if (p.phase === 'extract') {
      return p.component ? `Extracting ${p.component}…` : 'Extracting archive…';
    }
    if (p.message) return p.message;
    if (p.file && p.phase === 'remote') return `Fetching ${p.file}`;
    if (p.phase === 'remote') return 'Checking publishers…';
    return this.state.binariesBusy ? 'Installing node binaries…' : '';
  }

  binaryRowStatus (row, installedFallback) {
    if (!row) {
      return installedFallback ? 'Installed' : 'Not installed';
    }
    if (row.status === 'matches_pin') return 'Matches Hub pin';
    if (row.status === 'local_differs') return 'Local differs from pin';
    if (row.status === 'not_installed') return 'Not installed';
    if (row.installed && row.matchesLocal) return 'Matches Hub pin';
    if (row.installed) return 'Local differs from pin';
    return 'Not installed';
  }

  renderIntro () {
    return (
      <Segment basic>
        <Message info>
          <Message.Header>Welcome to Fabric Hub</Message.Header>
          <p>
            This process is the first-time operator setup. Completing it creates an admin token
            that stays in <strong>this browser only</strong> (never stored on the server) and writes
            Hub settings into <code>stores/hub/STATE</code>.
          </p>
        </Message>
        <p>
          Hub is the Fabric rendezvous: peer discovery, browser WebRTC signaling, documents,
          and optional Bitcoin / Lightning. You will name the node, choose how HTTP is bound,
          then pick Bitcoin Core options aimed at a first operator — the same beginner knobs
          Jameson Lopp’s{' '}
          <a href="https://jlopp.github.io/bitcoin-core-config-generator/" target="_blank" rel="noopener noreferrer">
            Bitcoin Core Config Generator
          </a>
          {' '}exposes (network, prune vs txindex, listen, dbcache, connection and upload caps).
          Those options sit in one accordion group at a time. A managed node defaults to no
          transaction relay (Core <code>-blocksonly</code>).
        </p>
        <Message>
          <Message.Header>Resetting this Hub</Message.Header>
          {this.state.desktopUsesExternalHub ? (
            <p>
              This desktop window is attached to an existing Hub on loopback, so first-time
              setup follows <strong>that process&apos;s</strong> store (often the repo
              {' '}<code>stores/hub</code> from <code>npm start</code>). Quit the other Hub,
              or restart desktop with <code>FABRIC_DESKTOP_ALWAYS_SPAWN_HUB=1</code>.
              Wiping only the git checkout does nothing if the live process still has
              {' '}<code>IS_CONFIGURED</code> in memory.
            </p>
          ) : this.state.desktopHubStore ? (
            <p>
              Desktop does <strong>not</strong> use the git checkout. Quit Fabric Hub, then
              delete <code>{this.state.desktopHubStore}</code> (tray: Reveal Hub data folder),
              or use Admin → Self-destruct. From the repo, <code>npm run reset:stores</code>
              wipes CLI and desktop Hub stores (legacy Electron profile included).
            </p>
          ) : (
            <p>
              Stop Hub, then run <code>npm run reset:stores</code> from this repo (CLI
              {' '}<code>stores/hub</code>, desktop Fabric Hub userData, and the legacy Electron
              profile). Desktop stores are not the git checkout
              ({' '}<code>~/Library/Application Support/Fabric Hub/stores/hub</code> on macOS).
              Restart Hub to see this flow again.
            </p>
          )}
          <p>
            Default <code>npm run reset:stores</code> also removes Bitcoin and Lightning
            datadirs (<code>stores/bitcoin-*</code>, <code>stores/lightning/</code>) and logs.
            Use <code>--setup-only</code> to leave chain data.
          </p>
        </Message>
      </Segment>
    );
  }

  renderNode () {
    return (
      <Form>
        <Form.Field>
          <label>Node name</label>
          <Input
            data-testid="hub-onboarding-node-name"
            placeholder="e.g. Hub, My Node"
            value={this.state.nodeName}
            onChange={(e) => this.setState({ nodeName: e.target.value })}
          />
        </Form.Field>
        <Form.Field>
          <Checkbox
            data-testid="hub-onboarding-http-shared"
            label="Share HTTP on the LAN (bind 0.0.0.0). Off keeps the dashboard on loopback."
            checked={!!this.state.httpSharedMode}
            onChange={(e, { checked }) => this.setState({ httpSharedMode: !!checked })}
          />
          <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
            Desktop defaults to loopback until you enable this. Environment
            {' '}<code>FABRIC_HUB_INTERFACE</code> still wins on restart.
          </small>
        </Form.Field>
        <Form.Field>
          <label>Disk space allocation (MB)</label>
          <Input
            type="number"
            min="1"
            placeholder="1024"
            value={this.state.diskAllocationMb}
            onChange={(e) => this.setState({ diskAllocationMb: e.target.value })}
          />
          <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
            Maximum storage for documents (used for HTLC purchase limits).
          </small>
        </Form.Field>
        <Form.Field>
          <label>Cost per byte (sats)</label>
          <Input
            type="number"
            min="0"
            step="0.000001"
            placeholder="0.01"
            value={this.state.costPerByteSats}
            onChange={(e) => this.setState({ costPerByteSats: e.target.value })}
          />
          <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
            Per-byte floor for document serving (HTLC purchase price). 0.01 ≈ 10k sats/MB.
          </small>
        </Form.Field>
        {this.props.requiresSetupUiSecret ? (
          <Form.Field>
            <label>Operator setup secret</label>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Same as FABRIC_HUB_SETUP_UI_SECRET on the server"
              value={this.state.setupUiSecret}
              onChange={(e) => this.setState({ setupUiSecret: e.target.value })}
            />
            <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
              Required to authorize first-time configuration when the hub is protected with an environment secret.
            </small>
          </Form.Field>
        ) : null}
      </Form>
    );
  }

  bitcoinAccordionTitle (key, label) {
    return (
      <Accordion.Title
        active={this.state.bitcoinAccordion === key}
        index={key}
        data-testid={`hub-onboarding-bitcoin-accordion-${key}`}
        onClick={(e) => {
          e.preventDefault();
          this.setState({ bitcoinAccordion: key });
        }}
      >
        <Icon name="dropdown" />
        {label}
      </Accordion.Title>
    );
  }

  renderBitcoin () {
    const binaries = this.state.binariesStatus;
    const lightningSupported = !(binaries && binaries.lightning && binaries.lightning.supported === false);
    const preset = HUB_BITCOIN_PRESETS[this.state.bitcoinPreset] || HUB_BITCOIN_PRESETS['local-dev'];
    const pruneOn = parseInt(this.state.bitcoinPrune, 10) > 0;
    const lightningOn = this.state.lightningManaged && lightningSupported && this.state.bitcoinManaged;
    const acc = this.state.bitcoinAccordion;
    return (
      <Form>
        <Accordion styled fluid exclusive={false} data-testid="hub-onboarding-bitcoin-accordion">
          {this.bitcoinAccordionTitle('network', 'Network')}
          <Accordion.Content active={acc === 'network'}>
            <Form.Field>
              <label>Beginner preset</label>
              <Select
                data-testid="hub-onboarding-bitcoin-preset"
                options={bitcoinPresetSelectOptions()}
                value={this.state.bitcoinPreset}
                onChange={(e, { value }) => this.applyPreset(value)}
              />
              <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                {preset.description}
              </small>
            </Form.Field>
            <Form.Field>
              <label>Bitcoin network</label>
              <Select
                data-testid="hub-onboarding-bitcoin-network"
                options={BITCOIN_NETWORKS}
                value={this.state.bitcoinNetwork}
                onChange={(e, { value }) => {
                  const net = BITCOIN_NETWORKS.find((n) => n.value === value);
                  this.setState({
                    bitcoinNetwork: value,
                    bitcoinRpcPort: net && net.rpcPort ? String(net.rpcPort) : this.state.bitcoinRpcPort
                  });
                }}
              />
            </Form.Field>
            <Form.Field>
              <Checkbox
                label="Launch managed Bitcoin node (bitcoind)"
                data-testid="hub-onboarding-bitcoin-managed"
                checked={this.state.bitcoinManaged}
                onChange={(e, { checked }) => {
                  const on = !!checked;
                  this.setState({
                    bitcoinManaged: on,
                    bitcoinAccordion: !on && acc === 'core' ? 'network' : acc
                  });
                }}
              />
            </Form.Field>
            {!this.state.bitcoinManaged && (
              <Segment basic style={{ marginLeft: '1.5em', paddingTop: 0, paddingLeft: 0 }}>
                <Form.Field>
                  <label>Bitcoin RPC host</label>
                  <Input
                    placeholder="127.0.0.1"
                    value={this.state.bitcoinHost}
                    onChange={(e) => this.setState({ bitcoinHost: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Bitcoin RPC port</label>
                  <Input
                    placeholder={String(defaultBitcoinRpcPort(this.state.bitcoinNetwork))}
                    type="number"
                    value={this.state.bitcoinRpcPort}
                    onChange={(e) => this.setState({ bitcoinRpcPort: e.target.value })}
                  />
                  <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                    Default: regtest 18443, signet 38332, testnet 18332, mainnet 8332
                  </small>
                </Form.Field>
                <Form.Field>
                  <label>Bitcoin RPC username</label>
                  <Input
                    placeholder="rpcuser"
                    value={this.state.bitcoinUsername}
                    onChange={(e) => this.setState({ bitcoinUsername: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Bitcoin RPC password</label>
                  <Input
                    type="password"
                    placeholder="rpcpassword"
                    value={this.state.bitcoinPassword}
                    onChange={(e) => this.setState({ bitcoinPassword: e.target.value })}
                  />
                </Form.Field>
              </Segment>
            )}
          </Accordion.Content>
          {this.state.bitcoinManaged ? (
            <React.Fragment>
              {this.bitcoinAccordionTitle('core', 'Bitcoin Core')}
              <Accordion.Content active={acc === 'core'}>
                <Form.Field>
                  <Checkbox
                    data-testid="hub-onboarding-bitcoin-listen"
                    label="Listen for inbound Bitcoin P2P (server=1). Off is Lopp’s local / Raspberry-style default."
                    checked={!!this.state.bitcoinListen}
                    onChange={(e, { checked }) => this.setState({ bitcoinListen: !!checked })}
                  />
                </Form.Field>
                <Form.Field>
                  <Checkbox
                    data-testid="hub-onboarding-bitcoin-txrelay"
                    label="Relay unconfirmed transactions (txrelay). Off is the Hub default: Core -blocksonly, so peers cannot fill this mempool. Wallet RPC still works."
                    checked={lightningOn || !!this.state.bitcoinTxrelay}
                    disabled={lightningOn}
                    onChange={(e, { checked }) => this.setState({ bitcoinTxrelay: !!checked })}
                  />
                  <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                    Core 29 has no -txrelay flag; Hub maps this to -blocksonly=1 when off. Lightning turns relay on.
                  </small>
                </Form.Field>
                <Form.Field>
                  <label>Prune (MiB, 0 = keep full blocks)</label>
                  <Input
                    data-testid="hub-onboarding-bitcoin-prune"
                    type="number"
                    min="0"
                    value={this.state.bitcoinPrune}
                    onChange={(e) => {
                      const v = e.target.value;
                      const n = parseInt(v, 10);
                      this.setState({
                        bitcoinPrune: v,
                        bitcoinTxindex: Number.isFinite(n) && n > 0 ? false : this.state.bitcoinTxindex
                      });
                    }}
                  />
                  <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                    Core minimum prune is 550 MiB. Prune cannot be combined with txindex or Lightning.
                  </small>
                </Form.Field>
                <Form.Field>
                  <Checkbox
                    data-testid="hub-onboarding-bitcoin-txindex"
                    label="Transaction index (txindex=1). Required for Lightning; disabled when pruning."
                    checked={!!this.state.bitcoinTxindex && !pruneOn}
                    disabled={pruneOn}
                    onChange={(e, { checked }) => this.setState({ bitcoinTxindex: !!checked })}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Database cache (dbcache, MiB)</label>
                  <Input
                    type="number"
                    min="4"
                    value={this.state.bitcoinDbcache}
                    onChange={(e) => this.setState({ bitcoinDbcache: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Max peer connections</label>
                  <Input
                    type="number"
                    min="4"
                    value={this.state.bitcoinMaxconnections}
                    onChange={(e) => this.setState({ bitcoinMaxconnections: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label>Max upload target (MiB/day, 0 = unlimited)</label>
                  <Input
                    type="number"
                    min="0"
                    value={this.state.bitcoinMaxuploadtarget}
                    onChange={(e) => this.setState({ bitcoinMaxuploadtarget: e.target.value })}
                  />
                  <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                    Lopp’s Low Bandwidth class uses a daily cap so a home connection is not saturated.
                  </small>
                </Form.Field>
              </Accordion.Content>
            </React.Fragment>
          ) : null}
          {this.bitcoinAccordionTitle('lightning', 'Lightning')}
          <Accordion.Content active={acc === 'lightning'}>
            <Form.Field>
              <Checkbox
                data-testid="hub-onboarding-lightning-managed"
                label="Launch managed Lightning node (lightningd)"
                disabled={!lightningSupported || !this.state.bitcoinManaged}
                checked={lightningOn}
                onChange={(e, { checked }) => {
                  const on = !!checked;
                  this.setState({
                    lightningManaged: on,
                    bitcoinPrune: on ? '0' : this.state.bitcoinPrune,
                    bitcoinTxindex: on ? true : this.state.bitcoinTxindex,
                    bitcoinTxrelay: on ? true : this.state.bitcoinTxrelay
                  });
                }}
              />
              <small style={{ display: 'block', marginTop: '0.25em', color: '#666' }}>
                Optional. Requires managed Bitcoin, no prune, txindex, and transaction relay.
                {binaries && binaries.lightning && binaries.lightning.reason
                  ? ` ${binaries.lightning.reason}`
                  : ' Official Core Lightning tarballs are Linux x86_64; macOS uses Homebrew when brew is installed.'}
              </small>
            </Form.Field>
            {!this.state.lightningManaged && (
              <Form.Field>
                <label>Lightning RPC socket path</label>
                <Input
                  placeholder="/path/to/lightningd.sock"
                  value={this.state.lightningSocket}
                  onChange={(e) => this.setState({ lightningSocket: e.target.value })}
                />
              </Form.Field>
            )}
          </Accordion.Content>
          {this.bitcoinAccordionTitle('binaries', 'Node binaries')}
          <Accordion.Content active={acc === 'binaries'}>
            <Segment data-testid="hub-onboarding-binaries" secondary>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75em', marginBottom: '0.75em' }}>
                <Header as="h4" style={{ margin: 0 }}>
                  <Icon name="download" />
                  Node binaries
                </Header>
                <Button
                  type="button"
                  size="small"
                  compact
                  data-testid="hub-onboarding-binaries-check"
                  disabled={this.state.binariesBusy || this.state.saving}
                  loading={this.state.binariesBusy}
                  onClick={this.checkRemoteBinaries}
                >
                  <Icon name="refresh" />
                  Check remote
                </Button>
              </div>
              <p style={{ marginTop: 0 }}>
                Hub pins Bitcoin Core
                {binaries && binaries.bitcoin && binaries.bitcoin.version ? ` ${binaries.bitcoin.version}` : ''}
                {this.state.lightningManaged ? ' and Core Lightning' : ''}
                {' '}for <code>{(binaries && binaries.platform) || 'this platform'}</code>.
                Check remote downloads publisher indexes and SHA256SUMS, compares them to this pin
                and to the local install, and downloads the pin only when a binary is missing.
                A newer publisher listing is shown, not installed.
              </p>
              <Table compact basic="very" size="small" unstackable data-testid="hub-onboarding-binaries-list">
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Component</Table.HeaderCell>
                    <Table.HeaderCell>Local</Table.HeaderCell>
                    <Table.HeaderCell>Hub pin</Table.HeaderCell>
                    <Table.HeaderCell>Remote latest</Table.HeaderCell>
                    <Table.HeaderCell>Status</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell>Bitcoin Core</Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.local)
                        || (binaries && binaries.bitcoin && binaries.bitcoin.installed ? 'installed' : '—')}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.pin)
                        || (binaries && binaries.bitcoin && binaries.bitcoin.version)
                        || '—'}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.remoteLatest)
                        || '—'}
                    </Table.Cell>
                    <Table.Cell>
                      {this.binaryRowStatus(
                        this.state.binariesCheck && this.state.binariesCheck.bitcoin,
                        binaries && binaries.bitcoin && binaries.bitcoin.installed
                      )}
                      {this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.remoteIsNewer
                        ? ' · newer listed'
                        : ''}
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>Core Lightning</Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.local)
                        || (binaries && binaries.lightning && binaries.lightning.installed ? 'installed' : '—')}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.pin)
                        || (binaries && binaries.lightning && binaries.lightning.version)
                        || '—'}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.remoteLatest)
                        || '—'}
                    </Table.Cell>
                    <Table.Cell>
                      {!lightningSupported
                        ? 'Not available'
                        : this.binaryRowStatus(
                          this.state.binariesCheck && this.state.binariesCheck.lightning,
                          binaries && binaries.lightning && binaries.lightning.installed
                        )}
                      {this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.remoteIsNewer
                        ? ' · newer listed'
                        : ''}
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
              {this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.pinMatchesOfficial === false ? (
                <Message warning size="small">
                  Official SHA256SUMS for Bitcoin Core {this.state.binariesCheck.bitcoin.pin} does not match Hub&apos;s pinned digest.
                </Message>
              ) : null}
              {this.state.binariesCheck && (this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.remoteError) ? (
                <Message warning size="small">
                  Bitcoin Core listing: {this.state.binariesCheck.bitcoin.remoteError}
                </Message>
              ) : null}
              {this.state.binariesBusy && (
                <Progress
                  percent={this.binariesProgressPercent()}
                  indicating
                  size="small"
                  label={this.binariesProgressLabel()}
                />
              )}
            </Segment>
          </Accordion.Content>
        </Accordion>
        {this.state.bitcoinNetwork === 'regtest' && this.state.bitcoinManaged && (
          <Message info size="small">
            Regtest is a private chain on this machine. Lightning is optional.
          </Message>
        )}
        {(this.state.bitcoinNetwork === 'signet' || this.state.bitcoinNetwork === 'testnet') && this.state.bitcoinManaged && (
          <Message info size="small">
            Managed signet/testnet runs bitcoind locally. Signet has predictable ~1 min blocks; testnet uses PoW and can be unstable.
          </Message>
        )}
      </Form>
    );
  }

  renderApplying () {
    return (
      <Segment basic textAlign="center" style={{ minHeight: '16em', paddingTop: '3em' }} data-testid="hub-onboarding-applying">
        <Dimmer active inverted>
          <Loader size="large" inverted>
            {this.state.applyStatus || 'Finishing setup…'}
          </Loader>
        </Dimmer>
      </Segment>
    );
  }

  render () {
    const { open, saving, error, step } = this.state;
    const busy = saving || this.state.binariesBusy;
    const applying = step === 'applying';

    return (
      <Modal
        data-testid="hub-onboarding-modal"
        open={open}
        onClose={() => {}}
        size="large"
        closeIcon={false}
      >
        <Modal.Header>
          <Icon name="settings" />
          First-Time Setup
        </Modal.Header>
        <Modal.Content>
          {!applying && (
            <Step.Group fluid size="small" unstackable>
              {SETUP_STEPS.map((s, idx) => (
                <Step
                  key={s.key}
                  active={step === s.key}
                  completed={SETUP_STEPS.findIndex((x) => x.key === step) > idx}
                >
                  <Step.Content>
                    <Step.Title>{s.title}</Step.Title>
                    <Step.Description>{s.description}</Step.Description>
                  </Step.Content>
                </Step>
              ))}
            </Step.Group>
          )}
          {step === 'intro' && this.renderIntro()}
          {step === 'node' && (
            <Segment basic>
              {this.renderNode()}
            </Segment>
          )}
          {step === 'bitcoin' && (
            <Segment basic>
              {this.renderBitcoin()}
            </Segment>
          )}
          {applying && this.renderApplying()}
          {error && (
            <Message negative>
              <Message.Header>Error</Message.Header>
              <p>{error}</p>
            </Message>
          )}
        </Modal.Content>
        <Modal.Actions>
          {step !== 'intro' && !applying && (
            <Button data-testid="hub-onboarding-back" onClick={this.goBack} disabled={busy}>
              Back
            </Button>
          )}
          {(step === 'intro' || step === 'node') && (
            <Button
              data-testid="hub-onboarding-next"
              primary
              onClick={this.goNext}
              disabled={busy}
            >
              Next
              <Icon name="arrow right" />
            </Button>
          )}
          {step === 'bitcoin' && (
            <Button
              data-testid="hub-onboarding-complete-setup"
              primary
              loading={busy}
              disabled={busy}
              onClick={this.handleComplete}
            >
              <Icon name="check" />
              Complete Setup
            </Button>
          )}
        </Modal.Actions>
      </Modal>
    );
  }
}

module.exports = Onboarding;
