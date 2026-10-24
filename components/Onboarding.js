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
const t = require('../locales/en');

const copy = t.identity.onboarding;

const BITCOIN_NETWORKS = [
  { key: 'regtest', value: 'regtest', text: copy.networks.regtest, rpcPort: 18443 },
  { key: 'signet', value: 'signet', text: copy.networks.signet, rpcPort: 38332 },
  { key: 'testnet', value: 'testnet', text: copy.networks.testnet, rpcPort: 18332 },
  { key: 'mainnet', value: 'mainnet', text: copy.networks.mainnet, rpcPort: 8332 }
];

const SETUP_STEPS = [
  { key: 'intro', title: copy.steps.intro.title, description: copy.steps.intro.description },
  { key: 'node', title: copy.steps.node.title, description: copy.steps.node.description },
  { key: 'bitcoin', title: copy.steps.bitcoin.title, description: copy.steps.bitcoin.description }
];

const hintStyle = { display: 'block', marginTop: '0.25em', color: '#666' };

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
      throw new Error(copy.errors.secretMissing);
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
    this.setState({ binariesBusy: true, binariesProgress: { phase: 'starting' }, applyStatus: copy.apply.downloading });
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
        throw new Error(body.message || body.error || copy.errors.downloadFailed(response.status));
      }
      if (body.bitcoin && body.bitcoin.ok === false) {
        throw new Error(body.bitcoin.reason || copy.errors.bitcoinDownloadFailed);
      }
      if (this.state.lightningManaged && body.lightning && body.lightning.ok === false && !body.lightning.skipped) {
        throw new Error(body.lightning.reason || copy.errors.lightningFailed);
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
        binariesProgress: { phase: 'starting', message: copy.binaries.checking },
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
        throw new Error(body.message || body.error || copy.errors.checkFailed(response.status));
      }
      const check = body.lastCheck || body;
      this.setState({ binariesCheck: check });
      if (body.status) {
        this.applyBinariesStatus(Object.assign({}, body.status, { lastCheck: check }));
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      this.setState({ error: /fetch|NetworkError/.test(message) ? t.common.errors.network : message });
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
    throw new Error(copy.errors.notConfirmed);
  }

  handleComplete = async () => {
    this.setState({
      saving: true,
      error: null,
      step: 'applying',
      applyStatus: copy.apply.writing
    });
    const started = Date.now();
    try {
      const baseUrl = this.getBaseUrl();
      const { extra } = this.setupSecretHeadersBody();
      if (this.state.bitcoinManaged || this.state.lightningManaged) {
        await this.installNodeBinaries();
      }
      this.setState({ applyStatus: copy.apply.saving });
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
        throw new Error(errBody.message || errBody.error || copy.errors.setupFailedStatus(response.status));
      }

      if (text.trim().startsWith('<')) {
        throw new Error(copy.errors.htmlResponse);
      }
      const result = JSON.parse(text);
      this.setState({ applyStatus: copy.apply.confirming });
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
      let message = err && err.message ? err.message : copy.errors.setupFailed;
      if (message.includes('fetch') || message.includes('Failed to fetch') || message.includes('NetworkError')) {
        message = t.common.errors.network;
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
    const b = copy.binaries;
    if (!p) return this.state.binariesBusy ? b.working : '';
    if (p.phase === 'download' && p.file && Number(p.total) > 0) {
      return b.downloadingPercent(p.file, this.binariesProgressPercent());
    }
    if (p.phase === 'download' && p.file) return b.downloading(p.file);
    if (p.phase === 'extract') {
      return p.component ? b.extracting(p.component) : b.extractingArchive;
    }
    if (p.message) return p.message;
    if (p.file && p.phase === 'remote') return b.fetching(p.file);
    if (p.phase === 'remote') return b.checking;
    return this.state.binariesBusy ? b.installing : '';
  }

  binaryRowStatus (row, installedFallback) {
    const b = copy.binaries;
    if (!row) {
      return installedFallback ? b.installed : b.notInstalled;
    }
    if (row.status === 'matches_pin') return b.matchesPin;
    if (row.status === 'local_differs') return b.differsFromPin;
    if (row.status === 'not_installed') return b.notInstalled;
    if (row.installed && row.matchesLocal) return b.matchesPin;
    if (row.installed) return b.differsFromPin;
    return b.notInstalled;
  }

  renderIntro () {
    const c = copy.intro;
    return (
      <Segment basic>
        <Message info>
          <Message.Header>{c.title}</Message.Header>
          <p>{c.adminToken}</p>
        </Message>
        <p>{c.about}</p>
        <p>
          {c.loppBefore}{' '}
          <a href="https://jlopp.github.io/bitcoin-core-config-generator/" target="_blank" rel="noopener noreferrer">
            {c.loppLink}
          </a>
          {c.loppAfter}
        </p>
        <Message>
          <Message.Header>{c.resetTitle}</Message.Header>
          {this.state.desktopUsesExternalHub ? (
            <p>{c.resetExternal}</p>
          ) : this.state.desktopHubStore ? (
            <p>{c.resetDesktop}</p>
          ) : (
            <p>{c.resetCli}</p>
          )}
          <p>{c.resetChain}</p>
          <details className="hub-developer-details">
            <summary>{t.common.developerDetails}</summary>
            <p style={{ margin: '0.35em 0 0' }}>
              {this.state.desktopUsesExternalHub
                ? c.resetExternalDeveloper
                : (this.state.desktopHubStore ? c.resetDesktopDeveloper(this.state.desktopHubStore) : c.resetCliDeveloper)}
            </p>
            <p style={{ margin: '0.35em 0 0' }}>{c.resetChainDeveloper}</p>
            <p style={{ margin: '0.35em 0 0' }}>{c.storeDeveloper}</p>
          </details>
        </Message>
      </Segment>
    );
  }

  renderNode () {
    const c = copy.node;
    return (
      <Form>
        <Form.Field>
          <label htmlFor="hub-onboarding-node-name">{c.name}</label>
          <Input
            id="hub-onboarding-node-name"
            data-testid="hub-onboarding-node-name"
            placeholder={c.namePlaceholder}
            value={this.state.nodeName}
            onChange={(e) => this.setState({ nodeName: e.target.value })}
          />
        </Form.Field>
        <Form.Field>
          <Checkbox
            data-testid="hub-onboarding-http-shared"
            label={c.share}
            checked={!!this.state.httpSharedMode}
            onChange={(e, { checked }) => this.setState({ httpSharedMode: !!checked })}
          />
          <small style={hintStyle}>
            {c.shareHint}
          </small>
          <details className="hub-developer-details" style={{ marginTop: '0.25em' }}>
            <summary>{t.common.developerDetails}</summary>
            <small style={hintStyle}>{c.shareDeveloper}</small>
          </details>
        </Form.Field>
        <Form.Field>
          <label htmlFor="hub-onboarding-disk-mb">{c.disk}</label>
          <Input
            id="hub-onboarding-disk-mb"
            type="number"
            min="1"
            placeholder="1024"
            value={this.state.diskAllocationMb}
            onChange={(e) => this.setState({ diskAllocationMb: e.target.value })}
          />
          <small style={hintStyle}>
            {c.diskHint}
          </small>
        </Form.Field>
        <Form.Field>
          <label htmlFor="hub-onboarding-cost-per-byte">{c.cost}</label>
          <Input
            id="hub-onboarding-cost-per-byte"
            type="number"
            min="0"
            step="0.000001"
            placeholder="0.01"
            value={this.state.costPerByteSats}
            onChange={(e) => this.setState({ costPerByteSats: e.target.value })}
          />
          <small style={hintStyle}>
            {c.costHint}
          </small>
        </Form.Field>
        {this.props.requiresSetupUiSecret ? (
          <Form.Field>
            <label htmlFor="hub-onboarding-setup-secret">{c.secret}</label>
            <Input
              id="hub-onboarding-setup-secret"
              type="password"
              autoComplete="off"
              value={this.state.setupUiSecret}
              onChange={(e) => this.setState({ setupUiSecret: e.target.value })}
            />
            <small style={hintStyle}>
              {c.secretHint}
            </small>
            <details className="hub-developer-details" style={{ marginTop: '0.25em' }}>
              <summary>{t.common.developerDetails}</summary>
              <small style={hintStyle}>{c.secretDeveloper}</small>
            </details>
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
    const c = copy.bitcoin;
    const b = copy.binaries;
    return (
      <Form>
        <Accordion styled fluid exclusive={false} data-testid="hub-onboarding-bitcoin-accordion">
          {this.bitcoinAccordionTitle('network', c.sections.network)}
          <Accordion.Content active={acc === 'network'}>
            <Form.Field>
              <label htmlFor="hub-onboarding-bitcoin-preset">{c.preset}</label>
              <Select
                id="hub-onboarding-bitcoin-preset"
                aria-label={c.preset}
                data-testid="hub-onboarding-bitcoin-preset"
                options={bitcoinPresetSelectOptions()}
                value={this.state.bitcoinPreset}
                onChange={(e, { value }) => this.applyPreset(value)}
              />
              <small style={hintStyle}>
                {preset.description}
              </small>
            </Form.Field>
            <Form.Field>
              <label htmlFor="hub-onboarding-bitcoin-network">{c.network}</label>
              <Select
                id="hub-onboarding-bitcoin-network"
                aria-label={c.network}
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
                label={c.managed}
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
                  <label htmlFor="hub-onboarding-bitcoin-rpc-host">{c.rpcHost}</label>
                  <Input
                    id="hub-onboarding-bitcoin-rpc-host"
                    placeholder="127.0.0.1"
                    value={this.state.bitcoinHost}
                    onChange={(e) => this.setState({ bitcoinHost: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="hub-onboarding-bitcoin-rpc-port">{c.rpcPort}</label>
                  <Input
                    id="hub-onboarding-bitcoin-rpc-port"
                    placeholder={String(defaultBitcoinRpcPort(this.state.bitcoinNetwork))}
                    type="number"
                    value={this.state.bitcoinRpcPort}
                    onChange={(e) => this.setState({ bitcoinRpcPort: e.target.value })}
                  />
                  <small style={hintStyle}>
                    {c.rpcPortHint}
                  </small>
                </Form.Field>
                <Form.Field>
                  <label htmlFor="hub-onboarding-bitcoin-rpc-user">{c.rpcUser}</label>
                  <Input
                    id="hub-onboarding-bitcoin-rpc-user"
                    autoComplete="username"
                    value={this.state.bitcoinUsername}
                    onChange={(e) => this.setState({ bitcoinUsername: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="hub-onboarding-bitcoin-rpc-password">{c.rpcPassword}</label>
                  <Input
                    id="hub-onboarding-bitcoin-rpc-password"
                    type="password"
                    autoComplete="current-password"
                    value={this.state.bitcoinPassword}
                    onChange={(e) => this.setState({ bitcoinPassword: e.target.value })}
                  />
                </Form.Field>
              </Segment>
            )}
          </Accordion.Content>
          {this.state.bitcoinManaged ? (
            <React.Fragment>
              {this.bitcoinAccordionTitle('core', c.sections.core)}
              <Accordion.Content active={acc === 'core'}>
                <Form.Field>
                  <Checkbox
                    data-testid="hub-onboarding-bitcoin-listen"
                    label={c.listen}
                    checked={!!this.state.bitcoinListen}
                    onChange={(e, { checked }) => this.setState({ bitcoinListen: !!checked })}
                  />
                </Form.Field>
                <Form.Field>
                  <Checkbox
                    data-testid="hub-onboarding-bitcoin-txrelay"
                    label={c.txrelay}
                    checked={lightningOn || !!this.state.bitcoinTxrelay}
                    disabled={lightningOn}
                    onChange={(e, { checked }) => this.setState({ bitcoinTxrelay: !!checked })}
                  />
                  <small style={hintStyle}>
                    {c.txrelayHint}
                  </small>
                  <details className="hub-developer-details" style={{ marginTop: '0.25em' }}>
                    <summary>{t.common.developerDetails}</summary>
                    <small style={hintStyle}>{c.txrelayDeveloper}</small>
                  </details>
                </Form.Field>
                <Form.Field>
                  <label htmlFor="hub-onboarding-bitcoin-prune">{c.prune}</label>
                  <Input
                    id="hub-onboarding-bitcoin-prune"
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
                  <small style={hintStyle}>
                    {c.pruneHint}
                  </small>
                </Form.Field>
                <Form.Field>
                  <Checkbox
                    data-testid="hub-onboarding-bitcoin-txindex"
                    label={c.txindex}
                    checked={!!this.state.bitcoinTxindex && !pruneOn}
                    disabled={pruneOn}
                    onChange={(e, { checked }) => this.setState({ bitcoinTxindex: !!checked })}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="hub-onboarding-bitcoin-dbcache">{c.dbcache}</label>
                  <Input
                    id="hub-onboarding-bitcoin-dbcache"
                    type="number"
                    min="4"
                    value={this.state.bitcoinDbcache}
                    onChange={(e) => this.setState({ bitcoinDbcache: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="hub-onboarding-bitcoin-maxconnections">{c.maxConnections}</label>
                  <Input
                    id="hub-onboarding-bitcoin-maxconnections"
                    type="number"
                    min="4"
                    value={this.state.bitcoinMaxconnections}
                    onChange={(e) => this.setState({ bitcoinMaxconnections: e.target.value })}
                  />
                </Form.Field>
                <Form.Field>
                  <label htmlFor="hub-onboarding-bitcoin-maxuploadtarget">{c.uploadTarget}</label>
                  <Input
                    id="hub-onboarding-bitcoin-maxuploadtarget"
                    type="number"
                    min="0"
                    value={this.state.bitcoinMaxuploadtarget}
                    onChange={(e) => this.setState({ bitcoinMaxuploadtarget: e.target.value })}
                  />
                  <small style={hintStyle}>
                    {c.uploadTargetHint}
                  </small>
                </Form.Field>
              </Accordion.Content>
            </React.Fragment>
          ) : null}
          {this.bitcoinAccordionTitle('lightning', c.sections.lightning)}
          <Accordion.Content active={acc === 'lightning'}>
            <Form.Field>
              <Checkbox
                data-testid="hub-onboarding-lightning-managed"
                label={c.lightningManaged}
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
              <small style={hintStyle}>
                {c.lightningHint}{' '}
                {binaries && binaries.lightning && binaries.lightning.reason
                  ? binaries.lightning.reason
                  : c.lightningPlatform}
              </small>
            </Form.Field>
            {!this.state.lightningManaged && (
              <Form.Field>
                <label htmlFor="hub-onboarding-lightning-socket">{c.lightningSocket}</label>
                <Input
                  id="hub-onboarding-lightning-socket"
                  placeholder={c.lightningSocketPlaceholder}
                  value={this.state.lightningSocket}
                  onChange={(e) => this.setState({ lightningSocket: e.target.value })}
                />
              </Form.Field>
            )}
          </Accordion.Content>
          {this.bitcoinAccordionTitle('binaries', c.sections.binaries)}
          <Accordion.Content active={acc === 'binaries'}>
            <Segment data-testid="hub-onboarding-binaries" secondary>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75em', marginBottom: '0.75em' }}>
                <Header as="h4" style={{ margin: 0 }}>
                  <Icon name="download" aria-hidden="true" />
                  {b.title}
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
                  <Icon name="refresh" aria-hidden="true" />
                  {b.check}
                </Button>
              </div>
              <p style={{ marginTop: 0 }}>
                {b.pinned(
                  binaries && binaries.bitcoin && binaries.bitcoin.version,
                  this.state.lightningManaged,
                  (binaries && binaries.platform) || b.platformFallback
                )}
                {' '}{b.checkExplain}
              </p>
              <Table compact basic="very" size="small" unstackable data-testid="hub-onboarding-binaries-list">
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>{b.component}</Table.HeaderCell>
                    <Table.HeaderCell>{b.local}</Table.HeaderCell>
                    <Table.HeaderCell>{b.pin}</Table.HeaderCell>
                    <Table.HeaderCell>{b.remote}</Table.HeaderCell>
                    <Table.HeaderCell>{b.status}</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell>{b.bitcoinCore}</Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.local)
                        || (binaries && binaries.bitcoin && binaries.bitcoin.installed ? b.installed : t.common.none)}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.pin)
                        || (binaries && binaries.bitcoin && binaries.bitcoin.version)
                        || t.common.none}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.remoteLatest)
                        || t.common.none}
                    </Table.Cell>
                    <Table.Cell>
                      {this.binaryRowStatus(
                        this.state.binariesCheck && this.state.binariesCheck.bitcoin,
                        binaries && binaries.bitcoin && binaries.bitcoin.installed
                      )}
                      {this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.remoteIsNewer
                        ? ` · ${b.newerSuffix}`
                        : ''}
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>{b.coreLightning}</Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.local)
                        || (binaries && binaries.lightning && binaries.lightning.installed ? b.installed : t.common.none)}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.pin)
                        || (binaries && binaries.lightning && binaries.lightning.version)
                        || t.common.none}
                    </Table.Cell>
                    <Table.Cell>
                      {(this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.remoteLatest)
                        || t.common.none}
                    </Table.Cell>
                    <Table.Cell>
                      {!lightningSupported
                        ? b.notAvailable
                        : this.binaryRowStatus(
                          this.state.binariesCheck && this.state.binariesCheck.lightning,
                          binaries && binaries.lightning && binaries.lightning.installed
                        )}
                      {this.state.binariesCheck && this.state.binariesCheck.lightning && this.state.binariesCheck.lightning.remoteIsNewer
                        ? ` · ${b.newerSuffix}`
                        : ''}
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
              {this.state.binariesCheck && this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.pinMatchesOfficial === false ? (
                <Message warning size="small">
                  {b.pinMismatch(this.state.binariesCheck.bitcoin.pin)}
                </Message>
              ) : null}
              {this.state.binariesCheck && (this.state.binariesCheck.bitcoin && this.state.binariesCheck.bitcoin.remoteError) ? (
                <Message warning size="small">
                  {b.remoteError(this.state.binariesCheck.bitcoin.remoteError)}
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
            {c.regtestNote}
          </Message>
        )}
        {(this.state.bitcoinNetwork === 'signet' || this.state.bitcoinNetwork === 'testnet') && this.state.bitcoinManaged && (
          <Message info size="small">
            {c.testnetNote}
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
            {this.state.applyStatus || copy.apply.finishing}
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
          <Icon name="settings" aria-hidden="true" />
          {copy.title}
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
              <Message.Header>{copy.errors.title}</Message.Header>
              <p>{error}</p>
            </Message>
          )}
          {!applying && (
            <p data-testid="hub-onboarding-finish-later" style={{ color: '#666', fontSize: '0.9em', marginTop: '1em', marginBottom: 0 }}>
              {copy.finishLater}
            </p>
          )}
        </Modal.Content>
        <Modal.Actions>
          {step !== 'intro' && !applying && (
            <Button data-testid="hub-onboarding-back" onClick={this.goBack} disabled={busy}>
              {t.common.actions.back}
            </Button>
          )}
          {(step === 'intro' || step === 'node') && (
            <Button
              data-testid="hub-onboarding-next"
              primary
              onClick={this.goNext}
              disabled={busy}
            >
              {copy.next}
              <Icon name="arrow right" aria-hidden="true" />
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
              <Icon name="check" aria-hidden="true" />
              {copy.complete}
            </Button>
          )}
        </Modal.Actions>
      </Modal>
    );
  }
}

module.exports = Onboarding;
