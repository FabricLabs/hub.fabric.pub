'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Key = require('@fabric/core/types/key');
const SetupService = require('../libs/hub-operator/setupService');
const { resolveHubRuntimeSettings } = require('../functions/hubRuntimeSettings');
const { parseCli, resolveDataDir } = require('../scripts/cli');

const CLI = path.join(__dirname, '..', 'scripts', 'cli.js');
const OPERATOR_ENV = ['FABRIC_XPRV', 'FABRIC_SEED', 'FABRIC_MNEMONIC', 'FABRIC_PASSWORD', 'FABRIC_HUB_USER_DATA', 'FABRIC_HUB_HOME', 'FABRIC_HUB_ADMIN_TOKEN', 'FABRIC_HUB_ADMIN_TOKEN_FILE'];

describe('hub CLI', function () {
  this.timeout(60000);
  let tmp;
  let env;

  function hub (...args) {
    const result = spawnSync(process.execPath, [CLI, ...args], { env, cwd: tmp, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function hubJson (...args) {
    const result = hub(...args, '--json');
    assert.strictEqual(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  beforeEach(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cli-'));
    fs.mkdirSync(path.join(tmp, 'home'));
    env = { ...process.env, HOME: path.join(tmp, 'home'), FABRIC_HUB_PORT: '1', NODE_ENV: 'test' };
    for (const name of OPERATOR_ENV) delete env[name];
    for (const name of Object.keys(env)) if (name.startsWith('FABRIC_TOR')) delete env[name];
  });

  afterEach(function () {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('parses commands and finds the data directory', function () {
    const { command, args, flags } = parseCli(['tor', 'enable', '--control', '9151', '--no-advertise']);
    assert.strictEqual(command, 'tor');
    assert.deepStrictEqual(args, ['enable']);
    assert.strictEqual(flags.control, '9151');
    assert.strictEqual(flags.advertise, false);
    assert.strictEqual(resolveDataDir({ data: 'x' }, {}, '/w'), path.resolve('/w', 'x'));
    assert.strictEqual(resolveDataDir({}, { FABRIC_HUB_HOME: '/h' }, '/w'), '/h');
    assert.strictEqual(resolveDataDir({}, { HOME: '/home/a' }, tmp), path.join('/home/a', '.fabric', 'hub'));
    fs.mkdirSync(path.join(tmp, 'stores', 'hub'), { recursive: true });
    assert.strictEqual(resolveDataDir({}, { HOME: '/home/a' }, tmp), tmp);
  });

  it('sets up a Hub offline the way onboarding does', function () {
    const data = path.join(tmp, 'data');
    const setup = hubJson('setup', '--data', data, '--yes', '--name', 'CLI Hub', '--network', 'signet',
      '--bitcoin-rpc', 'http://user:pass@127.0.0.1:38332', '--tor', '--tor-control', '127.0.0.1:9151', '--no-save-token');
    assert.strictEqual(setup.configured, true);
    assert.strictEqual(setup.running, false);
    assert.match(setup.onion, /^http:\/\/[a-z2-7]{56}\.onion$/);

    const state = JSON.parse(fs.readFileSync(path.join(data, 'stores', 'hub', 'STATE'), 'utf8'));
    assert.strictEqual(state.settings.IS_CONFIGURED, true);
    assert.strictEqual(state.settings.NODE_NAME, 'CLI Hub');
    assert.strictEqual(state.settings.BITCOIN_NETWORK, 'signet');
    assert.strictEqual(String(state.settings.BITCOIN_MANAGED), 'false');
    assert.strictEqual(String(state.settings.TOR_ENABLE), 'true');
    assert.strictEqual(state.settings.TOR_MODE, 'control');
    assert.ok(state.collections && state.collections.messages, 'STATE carries the seeded collections');
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(path.join(data, 'stores', 'hub', 'STATE')).mode & 0o777, 0o600);
    }

    const status = hubJson('status', '--data', data);
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.network, 'signet');
    assert.strictEqual(status.tor.mode, 'control');
    assert.strictEqual(`http://${status.tor.address}`, setup.onion);
    assert.strictEqual(status.tor.controlPassword, undefined);

    const identity = new Key({ public: status.identity });
    const verifier = new SetupService({ key: identity });
    assert.strictEqual(verifier.verifyAdminToken(setup.token), true);
    const minted = hubJson('token', '--data', data);
    assert.strictEqual(verifier.verifyAdminToken(minted.token), true);
    assert.strictEqual(verifier.verifyAdminToken(minted.token.slice(0, -4) + 'AAAA'), false);

    const again = hub('setup', '--data', data, '--yes', '--network', 'signet', '--bitcoin-rpc', 'http://127.0.0.1:38332');
    assert.notStrictEqual(again.status, 0);
    assert.match(again.stderr, /already set up/);
  });

  it('turns Tor on and off for a stopped Hub', function () {
    const data = path.join(tmp, 'data');
    hubJson('setup', '--data', data, '--yes', '--network', 'signet', '--bitcoin-rpc', 'http://127.0.0.1:38332', '--no-tor', '--no-save-token');
    assert.strictEqual(hubJson('status', '--data', data).tor.enable, false);
    hubJson('tor', 'enable', '--data', data, '--control', '9151');
    const on = hubJson('status', '--data', data).tor;
    assert.strictEqual(on.enable, true);
    assert.strictEqual(on.mode, 'control');
    assert.strictEqual(on.controlPort, 9151);
    hubJson('tor', 'disable', '--data', data);
    assert.strictEqual(hubJson('status', '--data', data).tor.enable, false);
  });
});

describe('resolveHubRuntimeSettings', function () {
  it('overlays setup, Tor included, without touching the loaded settings', function () {
    const base = require('../settings/local');
    const baseBitcoin = JSON.stringify(base.bitcoin);
    const baseTor = JSON.stringify(base.tor);
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-runtime-'));
    try {
      const { settings } = resolveHubRuntimeSettings({
        env: {},
        userDataRoot,
        log: () => {},
        setup: {
          IS_CONFIGURED: true,
          BITCOIN_NETWORK: 'signet',
          BITCOIN_MANAGED: 'false',
          BITCOIN_HOST: '10.0.0.2',
          TOR_ENABLE: 'true',
          TOR_MODE: 'control',
          TOR_CONTROL_PORT: '127.0.0.1:9151'
        }
      });
      assert.strictEqual(settings.bitcoin.network, 'signet');
      assert.strictEqual(settings.bitcoin.managed, false);
      assert.strictEqual(settings.bitcoin.host, '10.0.0.2');
      assert.strictEqual(settings.bitcoin.rpcport, 38332);
      assert.strictEqual(settings.tor.enable, true);
      assert.strictEqual(settings.tor.mode, 'control');
      assert.strictEqual(settings.tor.controlPort, 9151);
      assert.strictEqual(JSON.stringify(base.bitcoin), baseBitcoin);
      assert.strictEqual(JSON.stringify(base.tor), baseTor);
    } finally {
      fs.rmSync(userDataRoot, { recursive: true, force: true });
    }
  });
});
