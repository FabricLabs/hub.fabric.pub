'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BITCOIN_CORE_VERSION,
  CORE_LIGHTNING_VERSION,
  INSTALLER_PLATFORM_IDS,
  managedBinaryPlatformId,
  artifactsForPlatform,
  lightningSupportForPlatform
} = require('../functions/hubManagedBinariesManifest');

const {
  getManagedBinariesStatus,
  installBitcoinFromExtract,
  installLightningFromExtract,
  applyManagedNodeBinariesToProcessEnv,
  resolveBitcoindPath,
  writablePlatformDir
} = require('../functions/hubManagedBinaries');

describe('hubManagedBinaries', function () {
  it('pins Bitcoin Core and Core Lightning artifacts with SHA-256', function () {
    assert.strictEqual(BITCOIN_CORE_VERSION, '29.4');
    assert.strictEqual(CORE_LIGHTNING_VERSION, '26.06.6');
    for (const id of INSTALLER_PLATFORM_IDS) {
      const art = artifactsForPlatform(id);
      assert.ok(art && art.bitcoin, id);
      assert.ok(art.bitcoin.file.indexOf('bitcoin-29.4-') === 0, id);
      assert.ok(art.bitcoin.url.indexOf('/bitcoin-core-29.4/') !== -1, id);
      assert.ok(/^https:\/\//.test(art.bitcoin.url), id);
      assert.strictEqual(art.bitcoin.sha256.length, 64, id);
    }
    const linux = artifactsForPlatform('linux-x64');
    assert.ok(linux.lightning);
    assert.ok(linux.lightning.url.includes('ElementsProject/lightning'));
  });

  it('describes Lightning support honestly per platform', function () {
    assert.strictEqual(lightningSupportForPlatform('linux-x64').supported, true);
    assert.strictEqual(lightningSupportForPlatform('linux-x64').source, 'release-tarball');
    assert.strictEqual(lightningSupportForPlatform('darwin-arm64').source, 'homebrew');
    assert.strictEqual(lightningSupportForPlatform('win32-x64').supported, false);
    assert.strictEqual(lightningSupportForPlatform('linux-arm64').supported, false);
  });

  it('uses Node platform-arch ids', function () {
    assert.strictEqual(managedBinaryPlatformId('darwin', 'arm64'), 'darwin-arm64');
    assert.strictEqual(managedBinaryPlatformId('win32', 'x64'), 'win32-x64');
  });

  it('copies bitcoind from a Bitcoin Core extract tree', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-btc-extract-'));
    const extract = path.join(tmp, 'extract');
    const dest = path.join(tmp, 'platform');
    const binDir = path.join(extract, 'bitcoin-29.4', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'bitcoind'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(binDir, 'bitcoin-cli'), '#!/bin/sh\n');
    installBitcoinFromExtract(extract, dest);
    assert.ok(fs.existsSync(path.join(dest, 'bin', 'bitcoind')));
    assert.ok(fs.existsSync(path.join(dest, 'bin', 'bitcoin-cli')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps Core Lightning usr/local layout under lightning/', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-cln-extract-'));
    const extract = path.join(tmp, 'extract');
    const dest = path.join(tmp, 'platform');
    const binDir = path.join(extract, 'usr', 'local', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'lightningd'), '#!/bin/sh\n');
    installLightningFromExtract(extract, dest);
    assert.ok(fs.existsSync(path.join(dest, 'lightning', 'usr', 'local', 'bin', 'lightningd')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports status without throwing', function () {
    const status = getManagedBinariesStatus();
    assert.ok(status.platform);
    assert.strictEqual(typeof status.bitcoin.installed, 'boolean');
    assert.strictEqual(typeof status.lightning.supported, 'boolean');
    assert.ok(String(status.writableDir).includes('binaries'));
  });

  it('prepends an existing binaries bin dir onto PATH', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-bin-path-'));
    const prevUser = process.env.FABRIC_HUB_USER_DATA;
    const prevPath = process.env.PATH;
    try {
      process.env.FABRIC_HUB_USER_DATA = tmp;
      const platformId = managedBinaryPlatformId();
      const binDir = path.join(writablePlatformDir(platformId), 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const marker = path.join(binDir, 'hub-binaries-marker');
      fs.writeFileSync(marker, '1');
      const added = applyManagedNodeBinariesToProcessEnv(platformId);
      assert.ok(added.some((d) => path.normalize(d) === path.normalize(binDir)));
      assert.strictEqual(path.normalize(String(process.env.PATH).split(path.delimiter)[0]), path.normalize(binDir));
    } finally {
      if (prevUser === undefined) delete process.env.FABRIC_HUB_USER_DATA;
      else process.env.FABRIC_HUB_USER_DATA = prevUser;
      process.env.PATH = prevPath;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves Windows bitcoind.exe when fetching win32 from another OS', function () {
    const {
      bitcoindName,
      hostMatchesPlatform
    } = require('../functions/hubManagedBinaries');
    assert.strictEqual(bitcoindName('win32-x64'), 'bitcoind.exe');
    assert.strictEqual(bitcoindName('linux-x64'), 'bitcoind');
    assert.strictEqual(hostMatchesPlatform(managedBinaryPlatformId()), true);
    if (managedBinaryPlatformId() !== 'win32-x64') {
      assert.strictEqual(hostMatchesPlatform('win32-x64'), false);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-win-btc-'));
    const prevUser = process.env.FABRIC_HUB_USER_DATA;
    const prevApp = process.env.FABRIC_HUB_APP_ROOT;
    const prevBin = process.env.FABRIC_HUB_BINARIES;
    try {
      process.env.FABRIC_HUB_USER_DATA = tmp;
      process.env.FABRIC_HUB_APP_ROOT = tmp;
      delete process.env.FABRIC_HUB_BINARIES;
      const binDir = path.join(tmp, 'binaries', 'win32-x64', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const exe = path.join(binDir, 'bitcoind.exe');
      fs.writeFileSync(exe, 'mz');
      const found = resolveBitcoindPath('win32-x64');
      assert.strictEqual(path.normalize(found), path.normalize(exe));
    } finally {
      if (prevUser === undefined) delete process.env.FABRIC_HUB_USER_DATA;
      else process.env.FABRIC_HUB_USER_DATA = prevUser;
      if (prevApp === undefined) delete process.env.FABRIC_HUB_APP_ROOT;
      else process.env.FABRIC_HUB_APP_ROOT = prevApp;
      if (prevBin === undefined) delete process.env.FABRIC_HUB_BINARIES;
      else process.env.FABRIC_HUB_BINARIES = prevBin;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolveBitcoindPath is null when binaries are absent', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-bin-empty-'));
    const prevUser = process.env.FABRIC_HUB_USER_DATA;
    const prevApp = process.env.FABRIC_HUB_APP_ROOT;
    const prevBin = process.env.FABRIC_HUB_BINARIES;
    try {
      process.env.FABRIC_HUB_USER_DATA = tmp;
      process.env.FABRIC_HUB_APP_ROOT = tmp;
      delete process.env.FABRIC_HUB_BINARIES;
      const found = resolveBitcoindPath('linux-x64');
      assert.strictEqual(found, null);
    } finally {
      if (prevUser === undefined) delete process.env.FABRIC_HUB_USER_DATA;
      else process.env.FABRIC_HUB_USER_DATA = prevUser;
      if (prevApp === undefined) delete process.env.FABRIC_HUB_APP_ROOT;
      else process.env.FABRIC_HUB_APP_ROOT = prevApp;
      if (prevBin === undefined) delete process.env.FABRIC_HUB_BINARIES;
      else process.env.FABRIC_HUB_BINARIES = prevBin;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
