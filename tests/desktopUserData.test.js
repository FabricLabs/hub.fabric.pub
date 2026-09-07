'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PRODUCT_NAME,
  defaultDesktopUserDataDir,
  hubStoreDir,
  hubStatePath,
  resolveDesktopUserDataPlan,
  migrateHubOwnedFiles,
  configureDesktopUserData
} = require('../functions/desktopUserData');

function writeState (root, configured) {
  const dir = hubStoreDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(hubStatePath(root), JSON.stringify({
    settings: { IS_CONFIGURED: configured, NODE_NAME: 'Hub' }
  }), 'utf8');
}

describe('desktop userData', function () {
  let tmp;

  beforeEach(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-desktop-ud-'));
  });

  afterEach(function () {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  });

  it('pins unpackaged Hub data under Fabric Hub, not Electron', function () {
    const plan = resolveDesktopUserDataPlan({ appDataDir: tmp, isPackaged: false, env: {} });
    assert.strictEqual(plan.userDataDir, defaultDesktopUserDataDir(tmp));
    assert.ok(plan.userDataDir.endsWith(PRODUCT_NAME));
    assert.strictEqual(plan.migratedFrom, null);
    assert.strictEqual(plan.source, 'product');
  });

  it('honors FABRIC_HUB_USER_DATA over the product folder', function () {
    const custom = path.join(tmp, 'custom-root');
    const plan = resolveDesktopUserDataPlan({
      appDataDir: tmp,
      isPackaged: false,
      env: { FABRIC_HUB_USER_DATA: custom }
    });
    assert.strictEqual(plan.userDataDir, custom);
    assert.strictEqual(plan.source, 'env');
    assert.strictEqual(plan.migratedFrom, null);
  });

  it('migrates Hub stores from the unpackaged Electron profile when Fabric Hub is empty', function () {
    const legacy = path.join(tmp, 'Electron');
    writeState(legacy, true);
    fs.writeFileSync(path.join(legacy, 'desktop-shell.json'), '{"openAtLogin":false}\n', 'utf8');

    const plan = resolveDesktopUserDataPlan({ appDataDir: tmp, isPackaged: false, env: {}, fs: fs });
    assert.strictEqual(plan.source, 'migrate_electron');
    assert.strictEqual(plan.migratedFrom, legacy);

    const dest = defaultDesktopUserDataDir(tmp);
    const result = migrateHubOwnedFiles(legacy, dest, fs);
    assert.strictEqual(result.copied, true);
    assert.ok(result.names.includes('stores'));
    assert.ok(result.names.includes('desktop-shell.json'));
    const copied = JSON.parse(fs.readFileSync(hubStatePath(dest), 'utf8'));
    assert.strictEqual(copied.settings.IS_CONFIGURED, true);
  });

  it('does not overwrite an existing Fabric Hub STATE', function () {
    const dest = defaultDesktopUserDataDir(tmp);
    writeState(dest, true);
    const legacy = path.join(tmp, 'Electron');
    writeState(legacy, true);
    const result = migrateHubOwnedFiles(legacy, dest, fs);
    assert.strictEqual(result.copied, false);
    assert.strictEqual(result.reason, 'dest_exists');
  });

  it('skips Electron migrate when FABRIC_DESKTOP_SKIP_ELECTRON_MIGRATE is set', function () {
    const legacy = path.join(tmp, 'Electron');
    writeState(legacy, true);
    const plan = resolveDesktopUserDataPlan({
      appDataDir: tmp,
      isPackaged: false,
      env: { FABRIC_DESKTOP_SKIP_ELECTRON_MIGRATE: '1' },
      fs: fs
    });
    assert.strictEqual(plan.source, 'product');
    assert.strictEqual(plan.migratedFrom, null);
  });

  it('configureDesktopUserData sets Electron userData before lock', function () {
    const preferred = defaultDesktopUserDataDir(tmp);
    const fakeApp = {
      isPackaged: false,
      _paths: {
        appData: tmp,
        userData: path.join(tmp, 'Electron')
      },
      getPath (name) {
        return this._paths[name];
      },
      setName (name) {
        this._name = name;
      },
      setPath (name, value) {
        this._paths[name] = value;
      }
    };
    const cfg = configureDesktopUserData(fakeApp, { env: {}, fs: fs });
    assert.strictEqual(fakeApp._name, PRODUCT_NAME);
    assert.strictEqual(cfg.userDataDir, preferred);
    assert.strictEqual(cfg.hubStoreDir, hubStoreDir(preferred));
    assert.strictEqual(fakeApp.getPath('userData'), preferred);
  });
});
