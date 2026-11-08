#!/usr/bin/env node
'use strict';

/**
 * @fileoverview `hub` — set up and run a Fabric Hub installed with npm.
 * `hub setup` asks what the web onboarding asks (node, Bitcoin, Tor) and
 * applies it the same way: through `POST /settings` when this data
 * directory's Hub is running, else straight into its `stores/hub/STATE`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('util');
const { spawnSync } = require('child_process');

require('../functions/patchLinkedFabricNodePath');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PACKAGE = require('../package.json');

const USAGE = `Usage: hub <command> [options]

Commands:
  setup              Configure this Hub (same choices as the web onboarding)
  start              Run the Hub
  status             Show where the Hub keeps its data and how it is set up
  token [--save]     Print a new admin token (--save writes ~/.fabric/hub-admin-token)
  tor [status]       Show the Tor onion service
  tor enable         Serve the Hub as a Tor onion service
  tor disable        Stop serving it over Tor
  help               Show this help

Options:
  --data <dir>       Hub data directory (default: FABRIC_HUB_HOME, else this directory
                     when it holds stores/hub, else ~/.fabric/hub)
  --port <n>         HTTP port of a running Hub (default: the configured port)
  --json             Machine-readable output
  -y, --yes          Setup: accept defaults for anything not given as an option

Setup options:
  --name <name>              Node name (default Hub)
  --preset <id>              local-dev, signet, pruned, full, low-bandwidth
  --network <name>           Override the preset's network (regtest, signet, testnet, mainnet)
  --bitcoin-rpc <url>        Use your own bitcoind, e.g. http://user:pass@127.0.0.1:8332
  --lightning                Also run Core Lightning (needs the Hub's own bitcoind)
  --lightning-socket <path>  Use your own Core Lightning RPC socket
  --shared                   Serve HTTP on every interface (LAN), not only loopback
  --disk <MB>                Document storage allocation (default 1024)
  --cost-per-byte <sats>     Document storage price (default 0.01)
  --tor / --no-tor           Serve the Hub as a Tor onion service
  --tor-control <host:port>  Use a Tor you already run (its ControlPort) instead of a private one
  --tor-advertise            Show the onion address to anyone at GET /services/tor
  --no-binaries              Do not download Bitcoin Core / Core Lightning
  --save-token / --no-save-token
                             Write the admin token to ~/.fabric/hub-admin-token
`;

const OPTIONS = {
  data: { type: 'string' },
  port: { type: 'string' },
  json: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  save: { type: 'boolean' },
  name: { type: 'string' },
  preset: { type: 'string' },
  network: { type: 'string' },
  'bitcoin-rpc': { type: 'string' },
  lightning: { type: 'boolean' },
  'lightning-socket': { type: 'string' },
  shared: { type: 'boolean' },
  disk: { type: 'string' },
  'cost-per-byte': { type: 'string' },
  tor: { type: 'boolean' },
  'tor-control': { type: 'string' },
  'tor-advertise': { type: 'boolean' },
  control: { type: 'string' },
  advertise: { type: 'boolean' },
  binaries: { type: 'boolean' },
  'save-token': { type: 'boolean' }
};

class CliError extends Error {}

function parseCli (argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, allowNegative: true, strict: true });
  return { command: positionals[0] || (values.version ? 'version' : 'help'), args: positionals.slice(1), flags: values };
}

/**
 * Data directory: `--data`, `FABRIC_HUB_HOME`, the desktop's `FABRIC_HUB_USER_DATA`,
 * a directory that already holds `stores/hub` (or this checkout), else `~/.fabric/hub`.
 * @param {Object} flags
 * @param {Object} [env]
 * @param {string} [cwd]
 * @returns {string}
 */
function resolveDataDir (flags = {}, env = process.env, cwd = process.cwd()) {
  const explicit = flags.data || env.FABRIC_HUB_HOME || env.FABRIC_HUB_USER_DATA;
  if (explicit) return path.resolve(cwd, String(explicit));
  if (fs.existsSync(path.join(cwd, 'stores', 'hub'))) return path.resolve(cwd);
  if (path.resolve(cwd) === PACKAGE_ROOT) return PACKAGE_ROOT;
  return path.join(env.HOME || os.homedir(), '.fabric', 'hub');
}

/** Run from the data directory: the Hub resolves its stores and binaries against it. */
function enterDataDir (dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  process.chdir(dataDir);
  if (!process.env.FABRIC_HUB_APP_ROOT) process.env.FABRIC_HUB_APP_ROOT = PACKAGE_ROOT;
  require('@fabric/core/functions/fabricHomeEnv').loadFabricHomeEnv();
}

function hubStoreDir (settings, dataDir) {
  const raw = (settings.fs && settings.fs.path) || 'stores/hub';
  return path.isAbsolute(raw) ? raw : path.resolve(dataDir, raw);
}

function resolveContext (flags, overrides = {}) {
  const { resolveHubRuntimeSettings } = require('../functions/hubRuntimeSettings');
  const dataDir = process.cwd();
  const resolved = resolveHubRuntimeSettings({ userDataRoot: dataDir, log: () => {}, ...overrides });
  const settings = resolved.settings;
  const port = Number(flags.port || (settings.http && settings.http.port) || 8080);
  return { dataDir, settings, setup: resolved.setup, storeDir: hubStoreDir(settings, dataDir), port, baseUrl: `http://127.0.0.1:${port}` };
}

function isConfigured (setup) {
  return !!setup && (setup.IS_CONFIGURED === true || setup.IS_CONFIGURED === 'true');
}

/**
 * This Hub's identity key (admin tokens) for `settings`, or `{ error }`.
 * @param {Object} ctx
 * @param {Object} [opts]
 * @param {boolean} [opts.create=false] Create the store's root key when there is none.
 */
function identityFor (ctx, settings, opts = {}) {
  const { withPersistentHubKey, hubIdentityKey } = require('../functions/hubRuntimeSettings');
  try {
    const withKey = withPersistentHubKey(settings, { userDataRoot: ctx.dataDir, create: opts.create === true });
    if (withKey.source === 'none') return { key: null, settings, error: 'This Hub has no key yet (it is created on first start or by `hub setup`).' };
    const key = hubIdentityKey(withKey.settings);
    if (!key || !key.private) return { key: null, settings: withKey.settings, error: 'The operator key is watch-only (xpub); admin tokens need its private key.' };
    return { key, settings: withKey.settings, source: withKey.source, filePath: withKey.filePath, created: withKey.created };
  } catch (err) {
    return { key: null, settings, error: err && err.message ? err.message : String(err) };
  }
}

async function request (ctx, method, pathname, { body, token, timeoutMs = 3000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${ctx.baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  if (!res.ok) {
    const message = (json && (json.message || json.error)) || `HTTP ${res.status}`;
    throw new CliError(`${method} ${pathname}: ${message}`);
  }
  return json || {};
}

/**
 * The Hub answering on `ctx.port`, if any: `{ pubkey, settings }` (settings = `GET /settings`).
 * @returns {Promise<?Object>}
 */
async function probeRunningHub (ctx) {
  let settings;
  try {
    settings = await request(ctx, 'GET', '/settings', { timeoutMs: 1500 });
  } catch (_) {
    return null;
  }
  let pubkey = null;
  try {
    const PeeringService = require('../services/peering');
    const att = await request(ctx, 'GET', '/services/peering/attestation', { timeoutMs: 1500 });
    const checked = PeeringService.verifyHubAttestation(att);
    if (checked.ok) pubkey = checked.pubkey;
  } catch (_) {}
  return { pubkey, settings };
}

/**
 * The running Hub when it is this data directory's (same identity key), else null.
 * A different Hub on the port is an error rather than something to configure.
 */
async function runningHubFor (ctx) {
  const running = await probeRunningHub(ctx);
  if (!running) return null;
  const ours = identityFor(ctx, ctx.settings);
  if (ours.key && running.pubkey && running.pubkey === ours.key.pubkey) return running;
  throw new CliError(
    `A Hub is running on ${ctx.baseUrl}${running.pubkey ? ` (key ${running.pubkey.slice(0, 16)}…)` : ''}, ` +
    `but it is not the Hub in ${ctx.dataDir}. Stop it, or pass --data / --port for the Hub you mean.`
  );
}

function stateFs (storeDir) {
  return {
    readFile (name) {
      try {
        return fs.readFileSync(path.join(storeDir, name), 'utf8');
      } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async publish (name, data) {
      fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
      const target = path.join(storeDir, name);
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data, { mode: 0o600 });
      fs.renameSync(tmp, target);
    }
  };
}

/** The collections and peers directory a Hub seeds after web setup (`seedHubStoresAfterSetup`). */
async function seedStoresOffline (ctx) {
  const { HUB_SETUP_COLLECTION_NAMES } = require('../libs/hub-operator/hubSetupStores');
  const files = stateFs(ctx.storeDir);
  let state = {};
  try { state = JSON.parse(files.readFile('STATE') || '{}'); } catch (_) {}
  state.collections = state.collections && typeof state.collections === 'object' ? state.collections : {};
  for (const name of HUB_SETUP_COLLECTION_NAMES) {
    if (!state.collections[name] || typeof state.collections[name] !== 'object') state.collections[name] = {};
  }
  if (!state.chain || typeof state.chain !== 'object') state.chain = {};
  if (!state.services || typeof state.services !== 'object') state.services = {};
  await files.publish('STATE', JSON.stringify(state, null, '  '));
  const peersDb = ctx.settings.peersDb || path.join(ctx.storeDir, 'peers');
  fs.mkdirSync(path.isAbsolute(peersDb) ? peersDb : path.resolve(ctx.dataDir, peersDb), { recursive: true });
}

function print (flags, human, json) {
  if (flags.json) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  else if (human) process.stdout.write(`${human}\n`);
}

function warn (message) {
  process.stderr.write(`hub: ${message}\n`);
}

function torBinaryInstalled (binary) {
  const result = spawnSync(binary || 'tor', ['--version'], { stdio: 'ignore' });
  return !result.error;
}

function torInstallHint () {
  if (process.platform === 'darwin') return 'brew install tor';
  if (process.platform === 'win32') return 'install the Tor Expert Bundle and set FABRIC_TOR_BIN';
  return 'sudo apt install tor (or your distribution\'s tor package)';
}

/** The onion address this Hub will serve (the key is created now, so it is known before Tor runs). */
function onionAddressFor (ctx) {
  const { loadOrCreateOnionKey } = require('../functions/torOnionKey');
  return loadOrCreateOnionKey(path.join(ctx.storeDir, 'tor', 'hidden_service')).address;
}

// ---------------------------------------------------------------------------
// setup

function parseBitcoinRpc (raw) {
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch (_) {
    throw new CliError(`--bitcoin-rpc is not a URL: ${raw}`);
  }
  return {
    BITCOIN_HOST: url.hostname || '127.0.0.1',
    BITCOIN_RPC_PORT: url.port || '',
    BITCOIN_USERNAME: decodeURIComponent(url.username || ''),
    BITCOIN_PASSWORD: decodeURIComponent(url.password || '')
  };
}

class Prompter {
  constructor (interactive) {
    this.interactive = interactive;
    this.rl = null;
  }

  _readline () {
    if (!this.rl) {
      this.rl = require('readline/promises').createInterface({ input: process.stdin, output: process.stderr });
    }
    return this.rl;
  }

  async text (question, fallback) {
    if (!this.interactive) return fallback;
    const answer = (await this._readline().question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
    return answer || fallback;
  }

  async yes (question, fallback) {
    if (!this.interactive) return fallback;
    const hint = fallback ? 'Y/n' : 'y/N';
    for (;;) {
      const answer = (await this._readline().question(`${question} [${hint}]: `)).trim().toLowerCase();
      if (!answer) return fallback;
      if (['y', 'yes'].includes(answer)) return true;
      if (['n', 'no'].includes(answer)) return false;
    }
  }

  async choose (question, choices, fallback) {
    if (!this.interactive) return fallback;
    process.stderr.write(`${question}\n`);
    choices.forEach((c, i) => process.stderr.write(`  ${i + 1}) ${c.label}${c.value === fallback ? ' (default)' : ''}\n`));
    for (;;) {
      const answer = (await this._readline().question('Choose: ')).trim();
      if (!answer) return fallback;
      const byIndex = choices[Number(answer) - 1];
      if (byIndex) return byIndex.value;
      const byValue = choices.find((c) => c.value === answer);
      if (byValue) return byValue.value;
    }
  }

  close () {
    if (this.rl) this.rl.close();
  }
}

/**
 * The `POST /settings` body for the answers, as the web onboarding sends it.
 * @param {Object} flags
 * @param {Prompter} ask
 * @returns {Promise<{ body: Object, saveToken: boolean, binaries: boolean }>}
 */
async function collectSetupAnswers (flags, ask) {
  const { HUB_BITCOIN_PRESETS } = require('../libs/hub-operator/hubBitcoinSetup');
  const presetIds = Object.keys(HUB_BITCOIN_PRESETS);

  const name = flags.name || await ask.text('Node name', 'Hub');

  let presetId = flags.preset;
  if (presetId && !HUB_BITCOIN_PRESETS[presetId]) throw new CliError(`Unknown preset ${presetId} (one of ${presetIds.join(', ')})`);
  if (!presetId) {
    presetId = await ask.choose('Bitcoin node:', presetIds.map((id) => ({ value: id, label: HUB_BITCOIN_PRESETS[id].label })), 'local-dev');
  }
  const preset = HUB_BITCOIN_PRESETS[presetId];
  const network = flags.network || preset.network;

  let external = flags['bitcoin-rpc'] ? parseBitcoinRpc(flags['bitcoin-rpc']) : null;
  if (!external && !flags.yes) {
    const managed = await ask.yes('Run and manage Bitcoin Core for this Hub?', true);
    if (!managed) {
      const raw = await ask.text('Your bitcoind RPC (http://user:pass@host:port)', `http://127.0.0.1:${require('../libs/hub-operator/hubBitcoinSetup').defaultBitcoinRpcPort(network)}`);
      external = parseBitcoinRpc(raw);
    }
  }
  const bitcoinManaged = !external;

  let lightningManaged = false;
  if (bitcoinManaged) {
    lightningManaged = flags.lightning !== undefined
      ? !!flags.lightning
      : (flags['lightning-socket'] ? false : await ask.yes('Also run Core Lightning?', false));
  } else if (flags.lightning) {
    throw new CliError('--lightning needs the Hub to run its own bitcoind (drop --bitcoin-rpc).');
  }

  const shared = flags.shared !== undefined ? !!flags.shared : await ask.yes('Serve HTTP on your network (LAN), not only this computer?', false);

  let torEnable = flags.tor !== undefined ? !!flags.tor : !!(flags['tor-control'] || flags['tor-advertise']);
  if (flags.tor === undefined && !torEnable) torEnable = await ask.yes('Serve the Hub as a Tor onion service?', false);
  let torControl = flags['tor-control'] || '';
  let torAdvertise = !!flags['tor-advertise'];
  if (torEnable && !flags['tor-control'] && !flags.yes) {
    if (await ask.yes('Use a Tor you already run (its ControlPort) instead of a private one?', false)) {
      torControl = await ask.text('Tor ControlPort', '127.0.0.1:9051');
    }
  }
  if (torEnable && flags['tor-advertise'] === undefined && !flags.yes) {
    torAdvertise = await ask.yes('Show the onion address to anyone who asks (GET /services/tor)?', false);
  }

  const body = {
    NODE_NAME: String(name || 'Hub').trim() || 'Hub',
    NODE_PERSONALITY: JSON.stringify(['helpful']),
    NODE_TEMPERATURE: 0,
    NODE_GOALS: JSON.stringify([]),
    HTTP_SHARED_MODE: shared,
    TOR_ENABLE: torEnable,
    BITCOIN_NETWORK: network,
    BITCOIN_MANAGED: bitcoinManaged,
    BITCOIN_PRESET: presetId,
    LIGHTNING_MANAGED: lightningManaged,
    DISK_ALLOCATION_MB: Math.max(1, parseInt(flags.disk, 10) || 1024),
    COST_PER_BYTE_SATS: flags['cost-per-byte'] != null ? Math.max(0, parseFloat(flags['cost-per-byte']) || 0) : 0.01
  };
  if (torEnable) {
    body.TOR_MODE = torControl ? 'control' : 'managed';
    if (torControl) body.TOR_CONTROL_PORT = torControl;
    body.TOR_ADVERTISE = torAdvertise;
  }
  if (external) Object.assign(body, external);
  if (!lightningManaged && flags['lightning-socket']) body.LIGHTNING_SOCKET = flags['lightning-socket'];

  const saveToken = flags['save-token'] !== undefined ? !!flags['save-token'] : await ask.yes('Save the admin token to ~/.fabric/hub-admin-token?', true);
  const binaries = flags.binaries !== false && (bitcoinManaged || lightningManaged);
  return { body, saveToken, binaries };
}

function describeSetup (config) {
  const lines = [
    `  Node name:   ${config.NODE_NAME}`,
    `  Bitcoin:     ${config.BITCOIN_NETWORK} (${config.BITCOIN_MANAGED ? `managed, preset ${config.BITCOIN_PRESET}` : `your bitcoind at ${config.BITCOIN_HOST}:${config.BITCOIN_RPC_PORT}`})`,
    `  Lightning:   ${config.LIGHTNING_MANAGED ? 'managed Core Lightning' : (config.LIGHTNING_SOCKET ? `your node at ${config.LIGHTNING_SOCKET}` : 'off')}`,
    `  HTTP:        ${config.HTTP_SHARED_MODE ? 'every interface (LAN)' : 'this computer only'}`,
    `  Tor:         ${config.TOR_ENABLE ? `${config.TOR_MODE === 'control' ? `your Tor at ${config.TOR_CONTROL_PORT}` : 'private Tor process'}${config.TOR_ADVERTISE ? ', address public' : ''}` : 'off'}`
  ];
  return lines.join('\n');
}

async function installBinariesOffline (body) {
  const { installManagedBinaries } = require('../libs/hub-operator/hubManagedBinaries');
  let last = '';
  const result = await installManagedBinaries({
    bitcoin: body.BITCOIN_MANAGED !== false,
    lightning: body.LIGHTNING_MANAGED === true,
    onProgress: (ev) => {
      const line = ev && (ev.message || [ev.phase, ev.component, ev.file].filter(Boolean).join(' '));
      if (line && line !== last) {
        last = line;
        process.stderr.write(`  ${line}\n`);
      }
    }
  });
  if (result.bitcoin && result.bitcoin.ok === false) throw new CliError(result.bitcoin.reason || 'Bitcoin Core download failed');
  if (body.LIGHTNING_MANAGED && result.lightning && result.lightning.ok === false && !result.lightning.skipped) {
    throw new CliError(result.lightning.reason || 'Core Lightning download failed');
  }
  return result;
}

async function commandSetup (flags) {
  let ctx = resolveContext(flags);
  const running = await runningHubFor(ctx);
  const configured = running ? !!(running.settings && running.settings.configured) : isConfigured(ctx.setup);
  if (configured) {
    throw new CliError(`The Hub in ${ctx.dataDir} is already set up. Use \`hub token\` for a new admin token or \`hub tor\` to change Tor.`);
  }

  const ask = new Prompter(!flags.yes && process.stdin.isTTY && !flags.json);
  let answers;
  try {
    if (ask.interactive) process.stderr.write(`Setting up the Fabric Hub in ${ctx.dataDir}\n\n`);
    answers = await collectSetupAnswers(flags, ask);
    const { buildHubSetupInitialConfig } = require('../libs/hub-operator/hubBitcoinSetup');
    const config = buildHubSetupInitialConfig(answers.body);
    if (ask.interactive) {
      process.stderr.write(`\n${describeSetup(config)}\n\n`);
      if (!await ask.yes('Apply?', true)) throw new CliError('Setup cancelled; nothing was changed.');
    }
  } finally {
    ask.close();
  }
  const { body } = answers;

  if (body.TOR_ENABLE && body.TOR_MODE === 'managed') {
    const binary = (ctx.settings.tor && ctx.settings.tor.binary) || 'tor';
    if (!torBinaryInstalled(binary)) warn(`Tor is not installed (${torInstallHint()}); the onion service starts once it is.`);
  }

  let token;
  let expiresAt;
  if (running) {
    if (answers.binaries) {
      process.stderr.write('Downloading node binaries…\n');
      await request(ctx, 'POST', '/services/binaries', {
        body: { bitcoin: body.BITCOIN_MANAGED, lightning: body.LIGHTNING_MANAGED, setupUiSecret: process.env.FABRIC_HUB_SETUP_UI_SECRET },
        timeoutMs: 30 * 60 * 1000
      });
    }
    const result = await request(ctx, 'POST', '/settings', { body: { ...body, setupUiSecret: process.env.FABRIC_HUB_SETUP_UI_SECRET }, timeoutMs: 30000 });
    token = result.token;
    expiresAt = result.expiresAt;
  } else {
    if (answers.binaries) {
      process.stderr.write('Downloading node binaries…\n');
      await installBinariesOffline(body);
    }
    const { buildHubSetupInitialConfig } = require('../libs/hub-operator/hubBitcoinSetup');
    const initialConfig = buildHubSetupInitialConfig(body);
    // The admin token is signed by the identity key for the network chosen here.
    ctx = resolveContext(flags, { setup: { ...ctx.setup, ...initialConfig } });
    const identity = identityFor(ctx, ctx.settings, { create: true });
    if (!identity.key) throw new CliError(identity.error);
    const SetupService = require('../libs/hub-operator/setupService');
    const service = new SetupService({ fs: stateFs(ctx.storeDir), key: identity.key });
    const log = console.log;
    console.log = () => {};
    try {
      ({ token, expiresAt } = await service.createAdminToken(initialConfig));
    } finally {
      console.log = log;
    }
    await seedStoresOffline(ctx);
  }

  let tokenPath = null;
  if (answers.saveToken && token) {
    tokenPath = require('@fabric/core/functions/fabricHomeEnv').writeHubAdminToken(token);
  }
  const onion = body.TOR_ENABLE ? onionAddressFor(ctx) : null;

  const lines = [`The Hub in ${ctx.dataDir} is set up.`];
  if (tokenPath) lines.push(`Admin token saved to ${tokenPath}.`);
  else lines.push(`Admin token (keep it secret; it is not shown again):\n  ${token}`);
  if (onion) lines.push(`Onion address: http://${onion}`);
  lines.push(running ? `It is running at ${ctx.baseUrl}.` : 'Start it with: hub start');
  print(flags, lines.join('\n'), {
    configured: true,
    dataDir: ctx.dataDir,
    running: !!running,
    token: tokenPath ? undefined : token,
    tokenPath,
    expiresAt,
    onion: onion ? `http://${onion}` : null
  });
}

// ---------------------------------------------------------------------------
// token / status / tor

async function commandToken (flags) {
  const ctx = resolveContext(flags);
  if (!isConfigured(ctx.setup)) warn('this Hub is not set up yet; setup can change its network, and with it the key this token is signed by.');
  const identity = identityFor(ctx, ctx.settings);
  if (!identity.key) throw new CliError(identity.error);
  const token = require('@fabric/core/functions/fabricHomeEnv').mintHubAdminToken(identity.key);
  if (flags.save) {
    const tokenPath = require('@fabric/core/functions/fabricHomeEnv').writeHubAdminToken(token);
    print(flags, `Admin token saved to ${tokenPath}.`, { tokenPath });
    return;
  }
  print(flags, token, { token });
}

function adminTokenFor (ctx) {
  const fromHome = require('@fabric/core/functions/fabricHomeEnv').readHubAdminToken(process.env);
  if (fromHome && fromHome.token) return fromHome.token;
  const identity = identityFor(ctx, ctx.settings);
  if (!identity.key) return null;
  return require('@fabric/core/functions/fabricHomeEnv').mintHubAdminToken(identity.key);
}

function torSummary (tor) {
  if (!tor || !tor.enable) return 'off';
  return tor.mode === 'control' ? `on (your Tor at ${tor.controlHost}:${tor.controlPort})` : 'on (private Tor process)';
}

async function commandStatus (flags) {
  const ctx = resolveContext(flags);
  const configured = isConfigured(ctx.setup);
  const identity = identityFor(ctx, ctx.settings);
  const running = await probeRunningHub(ctx);
  const ours = !!(running && identity.key && running.pubkey === identity.key.pubkey);
  const { readHiddenServiceDir } = require('../functions/torOnionKey');
  const onionKey = readHiddenServiceDir(path.join(ctx.storeDir, 'tor', 'hidden_service'));
  let torStatus = null;
  if (ours) {
    try {
      torStatus = await request(ctx, 'GET', '/services/tor', { token: adminTokenFor(ctx) });
    } catch (_) {}
  }
  const json = {
    version: PACKAGE.version,
    dataDir: ctx.dataDir,
    configured,
    name: ctx.setup.NODE_NAME || null,
    network: ctx.settings.bitcoin && ctx.settings.bitcoin.network,
    identity: identity.key ? identity.key.pubkey : null,
    identityError: identity.key ? undefined : identity.error,
    running: ours,
    url: ctx.baseUrl,
    tor: {
      ...ctx.settings.tor,
      controlPassword: undefined,
      address: onionKey ? onionKey.address : null,
      state: torStatus ? torStatus.state : null,
      error: torStatus ? torStatus.error : null
    }
  };
  const lines = [
    `Fabric Hub ${PACKAGE.version}`,
    `  Data:      ${ctx.dataDir}`,
    `  Set up:    ${configured ? `yes (${json.name || 'Hub'}, ${json.network})` : 'no — run `hub setup`'}`,
    `  Identity:  ${json.identity || `unknown (${identity.error})`}`,
    `  Running:   ${ours ? `yes, ${ctx.baseUrl}` : (running ? `no (another Hub answers on ${ctx.baseUrl})` : 'no')}`,
    `  Tor:       ${torSummary(ctx.settings.tor)}${json.tor.address ? `, http://${json.tor.address}` : ''}${torStatus && torStatus.state ? ` — ${torStatus.state}${torStatus.error ? `: ${torStatus.error}` : ''}` : ''}`
  ];
  print(flags, lines.join('\n'), json);
}

async function commandTor (flags, args) {
  const action = args[0] || 'status';
  if (action === 'status') return commandTorStatus(flags);
  if (action !== 'enable' && action !== 'disable') throw new CliError(`Unknown tor command: ${action}\n\n${USAGE}`);

  const ctx = resolveContext(flags);
  const { torSetupFromBody } = require('../functions/hubTor');
  const enable = action === 'enable';
  const control = flags.control || flags['tor-control'] || '';
  const advertise = flags.advertise !== undefined ? !!flags.advertise : (flags['tor-advertise'] !== undefined ? !!flags['tor-advertise'] : undefined);
  const changes = torSetupFromBody({
    TOR_ENABLE: enable,
    TOR_MODE: control ? 'control' : 'managed',
    TOR_CONTROL_PORT: control || undefined,
    TOR_ADVERTISE: advertise !== undefined ? advertise : (ctx.setup.TOR_ADVERTISE === true || ctx.setup.TOR_ADVERTISE === 'true')
  });
  // TOR_ENABLE last: each PUT restarts Tor with the settings saved so far.
  const ordered = Object.keys(changes).filter((k) => k !== 'TOR_ENABLE').concat('TOR_ENABLE');

  const running = await runningHubFor(ctx);
  if (running) {
    const token = adminTokenFor(ctx);
    if (!token) throw new CliError('No admin token: set FABRIC_HUB_ADMIN_TOKEN, or run `hub token --save` where the Hub key is readable.');
    for (const name of ordered) {
      await request(ctx, 'PUT', `/settings/${name}`, { body: { value: changes[name] }, token, timeoutMs: 30000 });
    }
  } else {
    const SetupService = require('../libs/hub-operator/setupService');
    const service = new SetupService({ fs: stateFs(ctx.storeDir) });
    for (const name of ordered) await service.setSetting(name, changes[name]);
  }

  if (enable && changes.TOR_MODE === 'managed') {
    const binary = (ctx.settings.tor && ctx.settings.tor.binary) || 'tor';
    if (!torBinaryInstalled(binary)) warn(`Tor is not installed (${torInstallHint()}); the onion service starts once it is.`);
  }
  const onion = enable ? onionAddressFor(ctx) : null;
  const lines = [enable ? `Tor onion service on: http://${onion}` : 'Tor onion service off.'];
  if (!running) lines.push('It applies the next time the Hub starts.');
  if (enable && running) lines.push('Passport sign-in on the onion address works after the next restart.');
  print(flags, lines.join('\n'), { enabled: enable, onion: onion ? `http://${onion}` : null, running: !!running });
}

async function commandTorStatus (flags) {
  const ctx = resolveContext(flags);
  const running = await probeRunningHub(ctx);
  const identity = identityFor(ctx, ctx.settings);
  if (running && identity.key && running.pubkey === identity.key.pubkey) {
    const status = await request(ctx, 'GET', '/services/tor', { token: adminTokenFor(ctx) });
    const human = status.enabled
      ? `Tor: ${status.state}${status.address ? `, http://${status.address}` : ''}${status.bootstrap != null && status.state === 'starting' ? ` (bootstrap ${status.bootstrap}%)` : ''}${status.error ? `\n  ${status.error}` : ''}`
      : 'Tor: off';
    return print(flags, human, status);
  }
  const { readHiddenServiceDir } = require('../functions/torOnionKey');
  const key = readHiddenServiceDir(path.join(ctx.storeDir, 'tor', 'hidden_service'));
  const tor = ctx.settings.tor || {};
  const human = `Tor: ${torSummary(tor)}${key ? `, http://${key.address}` : ''} (Hub not running)`;
  return print(flags, human, { enabled: !!tor.enable, mode: tor.mode, address: key ? key.address : null, running: false });
}

function commandStart (flags) {
  const ctx = resolveContext(flags);
  if (!isConfigured(ctx.setup)) {
    process.stderr.write(`hub: not set up yet — run \`hub setup\`, or open ${ctx.baseUrl} to set it up in the browser.\n`);
  }
  require('./hub.js');
}

async function main (argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (err) {
    throw new CliError(`${err.message}\n\n${USAGE}`);
  }
  const { command, args, flags } = parsed;
  if (command === 'help' || flags.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (command === 'version') {
    process.stdout.write(`${PACKAGE.version}\n`);
    return;
  }
  const commands = { setup: commandSetup, start: commandStart, status: commandStatus, token: commandToken, tor: commandTor };
  const run = commands[command];
  if (!run) throw new CliError(`Unknown command: ${command}\n\n${USAGE}`);
  const dataDir = resolveDataDir(flags);
  // The Hub stores under FABRIC_HUB_USER_DATA when it is set, so --data must replace it.
  if (process.env.FABRIC_HUB_USER_DATA && path.resolve(process.env.FABRIC_HUB_USER_DATA) !== dataDir) {
    delete process.env.FABRIC_HUB_USER_DATA;
  }
  enterDataDir(dataDir);
  await run(flags, args);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`hub: ${err instanceof CliError ? err.message : (err && err.stack) || err}\n`);
    process.exit(1);
  });
}

module.exports = { main, parseCli, resolveDataDir };
