'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PRODUCT_NAME,
  assertSafeToRemove,
  defaultAppDataDir,
  desktopStoreRoots,
  listHubStoreResetTargets,
  resetHubStores
} = require('../functions/hubStoreReset');
const { LEGACY_ELECTRON_PROFILE, hubStoreDir } = require('../functions/desktopUserData');

describe('hubStoreReset', function () {
  it('lists CLI hub store plus Fabric Hub and legacy Electron desktop stores', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-reset-list-'));
    try {
      const targets = listHubStoreResetTargets({
        repoRoot: tmp,
        homedir: tmp,
        platform: 'darwin',
        env: {},
        setupOnly: true
      });
      const appData = defaultAppDataDir('darwin', tmp);
      const paths = targets.map((t) => t.path);
      assert.ok(paths.includes(path.join(tmp, 'stores', 'hub')));
      assert.ok(paths.includes(hubStoreDir(path.join(appData, PRODUCT_NAME))));
      assert.ok(paths.includes(hubStoreDir(path.join(appData, LEGACY_ELECTRON_PROFILE))));
      assert.ok(targets.every((t) => t.kind === 'cli-hub' || t.kind === 'desktop-hub'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('includes FABRIC_HUB_USER_DATA and chain datadirs unless setup-only', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-reset-env-'));
    try {
      const custom = path.join(tmp, 'custom-ud');
      const all = listHubStoreResetTargets({
        repoRoot: tmp,
        homedir: tmp,
        platform: 'linux',
        env: { FABRIC_HUB_USER_DATA: custom }
      });
      const paths = all.map((t) => t.path);
      assert.ok(paths.includes(path.join(custom, 'stores', 'hub')));
      assert.ok(paths.includes(path.join(tmp, 'stores', 'bitcoin-regtest')));
      assert.ok(paths.includes(path.join(custom, 'stores', 'lightning')));
      const setup = listHubStoreResetTargets({
        repoRoot: tmp,
        homedir: tmp,
        platform: 'linux',
        env: { FABRIC_HUB_USER_DATA: custom },
        setupOnly: true
      });
      assert.ok(!setup.some((t) => t.path.includes('bitcoin-regtest')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resetHubStores removes existing dirs and skips absent ones', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-reset-rm-'));
    try {
      const hubDir = path.join(tmp, 'stores', 'hub');
      fs.mkdirSync(hubDir, { recursive: true });
      fs.writeFileSync(path.join(hubDir, 'STATE'), '{"settings":{"IS_CONFIGURED":true}}\n');
      const { results, errors } = resetHubStores({
        repoRoot: tmp,
        homedir: tmp,
        platform: 'darwin',
        env: {},
        setupOnly: true
      });
      assert.strictEqual(errors, 0);
      const cli = results.find((r) => r.kind === 'cli-hub');
      assert.strictEqual(cli.status, 'removed');
      assert.strictEqual(fs.existsSync(hubDir), false);
      const missing = results.filter((r) => r.status === 'absent');
      assert.ok(missing.length >= 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('refuses to delete paths outside the reset roots', function () {
    assert.throws(() => {
      assertSafeToRemove('/tmp/not-a-hub-store', [path.join(os.tmpdir(), 'hub-allowed')]);
    }, /outside reset roots/);
  });

  it('desktopStoreRoots prefers env then product then Electron', function () {
    const tmp = '/tmp/hub-appdata-home';
    const roots = desktopStoreRoots({
      homedir: tmp,
      platform: 'darwin',
      env: { FABRIC_HUB_USER_DATA: '/tmp/custom-hub-ud' }
    });
    assert.strictEqual(roots[0], path.resolve('/tmp/custom-hub-ud'));
    assert.ok(roots.includes(path.join(tmp, 'Library', 'Application Support', PRODUCT_NAME)));
    assert.ok(roots.includes(path.join(tmp, 'Library', 'Application Support', LEGACY_ELECTRON_PROFILE)));
  });
});
