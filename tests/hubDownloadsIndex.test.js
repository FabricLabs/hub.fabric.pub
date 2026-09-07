'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  breadcrumbsForPath,
  entriesForPath,
  filesFromIndex,
  formatByteSize,
  hrefForRootRelative,
  normalizeRelativePath,
  relativePathFromLocation
} = require('../functions/hubDownloadsTree');

const {
  classifyPlatformFolder,
  destRelativeForInstaller,
  isInstallerFile,
  syncDownloadsAssets,
  syncPassportExtensionDownloads
} = require('../functions/hubDownloadsIndex');

describe('hubDownloadsTree', function () {
  it('rejects path traversal', function () {
    assert.strictEqual(normalizeRelativePath('..'), null);
    assert.strictEqual(normalizeRelativePath('mac/../win'), null);
    assert.strictEqual(normalizeRelativePath('mac/foo.dmg'), 'mac/foo.dmg');
    assert.strictEqual(normalizeRelativePath('/mac/foo.dmg'), 'mac/foo.dmg');
    assert.strictEqual(normalizeRelativePath(''), '');
    assert.strictEqual(normalizeRelativePath('', { allowEmpty: false }), null);
  });

  it('maps location pathnames onto the downloads root', function () {
    assert.deepStrictEqual(relativePathFromLocation('/downloads', '/downloads'), {
      path: '',
      invalid: false
    });
    assert.deepStrictEqual(relativePathFromLocation('/downloads/mac', '/downloads'), {
      path: 'mac',
      invalid: false
    });
    assert.strictEqual(relativePathFromLocation('/downloads/mac/../win', '/downloads').invalid, true);
  });

  it('lists immediate children only', function () {
    const files = filesFromIndex({
      files: [
        { path: 'mac/Hub.dmg', size: 10 },
        { path: 'mac/nested/extra.zip', size: 2 },
        { path: 'linux/hub.AppImage', size: 20 },
        { path: 'index.json', size: 1 }
      ]
    });
    const root = entriesForPath(files, '');
    assert.deepStrictEqual(root.map((e) => `${e.type}:${e.name}`), ['dir:linux', 'dir:mac']);
    const mac = entriesForPath(files, 'mac');
    assert.deepStrictEqual(mac.map((e) => `${e.type}:${e.name}`), ['dir:nested', 'file:Hub.dmg']);
    assert.deepStrictEqual(breadcrumbsForPath('mac/nested'), [
      { name: 'mac', path: 'mac' },
      { name: 'nested', path: 'mac/nested' }
    ]);
  });

  it('encodes file hrefs per segment', function () {
    assert.strictEqual(
      hrefForRootRelative('/downloads', 'mac/Hub 1.dmg'),
      '/downloads/mac/Hub%201.dmg'
    );
    assert.strictEqual(formatByteSize(1536), '1.5 KiB');
  });
});

describe('hubDownloadsIndex', function () {
  it('classifies installer names into platform folders', function () {
    assert.strictEqual(classifyPlatformFolder('FabricHub-0.1.0-arm64.dmg'), 'mac');
    assert.strictEqual(classifyPlatformFolder('FabricHub-0.1.0-arm64-mac.zip'), 'mac');
    assert.strictEqual(classifyPlatformFolder('FabricHub Setup 0.1.0.exe'), 'win');
    assert.strictEqual(classifyPlatformFolder('fabrichub_0.1.0-RC1_x64.AppImage'), 'linux');
    assert.strictEqual(classifyPlatformFolder('notes.zip'), 'other');
    assert.strictEqual(classifyPlatformFolder('fabric-passport-v0.1.0.zip'), 'extension');
    assert.strictEqual(destRelativeForInstaller('Hub.dmg'), 'mac/Hub.dmg');
    assert.strictEqual(destRelativeForInstaller('fabric-passport-v0.1.0.zip'), 'extension/fabric-passport-v0.1.0.zip');
    assert.ok(isInstallerFile('Hub.dmg'));
    assert.ok(!isInstallerFile('latest-mac.yml'));
  });

  it('copies dist installers and writes index.json', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-downloads-'));
    const distDir = path.join(tmp, 'dist');
    const destDir = path.join(tmp, 'assets', 'downloads');
    const unpacked = path.join(distDir, 'mac-arm64-unpacked');
    fs.mkdirSync(unpacked, { recursive: true });
    fs.writeFileSync(path.join(unpacked, 'FabricHub.exe'), 'unpacked');
    fs.writeFileSync(path.join(distDir, 'Hub.dmg'), 'dmg-bytes');
    fs.writeFileSync(path.join(distDir, 'Hub.dmg.blockmap'), 'nope');
    fs.writeFileSync(path.join(distDir, 'latest-mac.yml'), 'nope');
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'README.md'), 'keep\n');
    fs.mkdirSync(path.join(destDir, 'extension'), { recursive: true });
    fs.writeFileSync(path.join(destDir, 'extension', 'fabric-passport-v0.1.0.zip'), 'passport');

    const result = syncDownloadsAssets({ distDir, destDir, copyDist: true });
    assert.strictEqual(result.copied, 1);
    assert.ok(fs.existsSync(path.join(destDir, 'mac', 'Hub.dmg')));
    assert.ok(fs.existsSync(path.join(destDir, 'README.md')));
    assert.ok(fs.existsSync(path.join(destDir, 'extension', 'fabric-passport-v0.1.0.zip')),
      'extension/ survives desktop installer sync wipe');
    assert.ok(!fs.existsSync(path.join(destDir, 'mac-arm64-unpacked')));
    const index = JSON.parse(fs.readFileSync(path.join(destDir, 'index.json'), 'utf8'));
    const paths = index.files.map((f) => f.path).sort();
    assert.deepStrictEqual(paths, [
      'extension/fabric-passport-v0.1.0.zip',
      'mac/Hub.dmg'
    ]);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('syncPassportExtensionDownloads copies zips without wiping installers', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-passport-dl-'));
    const destDir = path.join(tmp, 'downloads');
    const zipDir = path.join(tmp, 'passport-zip');
    fs.mkdirSync(path.join(destDir, 'mac'), { recursive: true });
    fs.writeFileSync(path.join(destDir, 'mac', 'Hub.dmg'), 'dmg');
    fs.mkdirSync(zipDir, { recursive: true });
    fs.writeFileSync(path.join(zipDir, 'fabric-passport-v0.1.0.zip'), 'zip-bytes');
    fs.writeFileSync(path.join(zipDir, 'ignore.zip'), 'nope');

    const result = syncPassportExtensionDownloads({ destDir, passportZipDir: zipDir });
    assert.strictEqual(result.copied, 1);
    assert.ok(fs.existsSync(path.join(destDir, 'extension', 'fabric-passport-v0.1.0.zip')));
    assert.ok(fs.existsSync(path.join(destDir, 'mac', 'Hub.dmg')));
    const index = JSON.parse(fs.readFileSync(path.join(destDir, 'index.json'), 'utf8'));
    assert.ok(index.files.some((f) => f.path === 'extension/fabric-passport-v0.1.0.zip'));
    assert.ok(index.files.some((f) => f.path === 'mac/Hub.dmg'));

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('index-only rebuilds from dest without copying dist', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-downloads-idx-'));
    const distDir = path.join(tmp, 'dist');
    const destDir = path.join(tmp, 'downloads');
    fs.mkdirSync(path.join(destDir, 'linux'), { recursive: true });
    fs.writeFileSync(path.join(destDir, 'linux', 'hub.AppImage'), 'appimage');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'ignored.dmg'), 'no-copy');
    const result = syncDownloadsAssets({ distDir, destDir, copyDist: false });
    assert.strictEqual(result.copied, 0);
    assert.strictEqual(result.fileCount, 1);
    assert.ok(!fs.existsSync(path.join(destDir, 'mac', 'ignored.dmg')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
