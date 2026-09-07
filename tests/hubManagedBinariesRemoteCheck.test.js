'use strict';

const assert = require('assert');

const {
  BITCOIN_CORE_VERSION,
  CORE_LIGHTNING_VERSION,
  artifactsForPlatform
} = require('../functions/hubManagedBinariesManifest');

const {
  compareVersions,
  versionsMatch,
  parseBitcoinCoreVersionsFromBinIndex,
  latestVersion,
  sha256ForFileName,
  parseGithubLatestTag,
  parseBitcoinCoreVersionFromOutput,
  parseLightningVersionFromOutput,
  checkManagedBinariesRemote
} = require('../functions/hubManagedBinariesRemoteCheck');

describe('hubManagedBinariesRemoteCheck', function () {
  it('treats 29.4 and 29.4.0 as the same Core version', function () {
    assert.strictEqual(compareVersions('29.4', '29.4.0'), 0);
    assert.strictEqual(versionsMatch('v29.4.0', '29.4'), true);
    assert.ok(compareVersions('29.4', '29.0') > 0);
  });

  it('parses bitcoincore.org /bin/ directory listings', function () {
    const html = [
      '<a href="bitcoin-core-29.0/">bitcoin-core-29.0/</a>',
      '<a href="bitcoin-core-30.0/">bitcoin-core-30.0/</a>',
      '<a href="bitcoin-core-31.1/">bitcoin-core-31.1/</a>',
      '<a href="bitcoin-core-28.1/">bitcoin-core-28.1/</a>'
    ].join('\n');
    const versions = parseBitcoinCoreVersionsFromBinIndex(html);
    assert.deepStrictEqual(versions, ['28.1', '29.0', '30.0', '31.1']);
    assert.strictEqual(latestVersion(versions), '31.1');
  });

  it('reads SHA256SUMS lines for a named artifact', function () {
    const art = artifactsForPlatform('darwin-arm64').bitcoin;
    const sums = [
      `${art.sha256}  ${art.file}`,
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  other.tar.gz'
    ].join('\n');
    assert.strictEqual(sha256ForFileName(sums, art.file), art.sha256);
    assert.strictEqual(sha256ForFileName(sums, 'missing.tar.gz'), null);
  });

  it('parses GitHub latest release tags and local -version output', function () {
    assert.strictEqual(parseGithubLatestTag({ tag_name: 'v26.06.6' }), '26.06.6');
    assert.strictEqual(
      parseBitcoinCoreVersionFromOutput('Bitcoin Core version v29.4.0\nCopyright (C) 2009-2026'),
      '29.4.0'
    );
    assert.strictEqual(parseLightningVersionFromOutput('v26.06.6\n'), '26.06.6');
  });

  it('compares remote latest to the Hub pin without installing a newer listing', async function () {
    const calls = [];
    const report = await checkManagedBinariesRemote({
      bitcoin: true,
      lightning: false,
      platformId: 'darwin-arm64',
      installIfMissing: true,
      status: {
        bitcoin: { installed: true },
        lightning: { installed: false, supported: true }
      },
      getText: async (url) => {
        calls.push(url);
        if (url === 'https://bitcoincore.org/bin/') {
          return '<a href="bitcoin-core-29.4/">bitcoin-core-29.4/</a>\n<a href="bitcoin-core-32.0/">bitcoin-core-32.0/</a>';
        }
        if (/SHA256SUMS$/.test(url)) {
          const art = artifactsForPlatform('darwin-arm64').bitcoin;
          return `${art.sha256}  ${art.file}\n`;
        }
        if (url.indexOf('github.com') !== -1) {
          return JSON.stringify({ tag_name: 'v26.06.6' });
        }
        throw new Error('unexpected url ' + url);
      },
      installManagedBinaries: async () => {
        throw new Error('must not install when local Bitcoin is present');
      }
    });

    assert.ok(calls.some((u) => u === 'https://bitcoincore.org/bin/'));
    assert.ok(calls.some((u) => /SHA256SUMS$/.test(u)));
    assert.strictEqual(report.bitcoin.pin, BITCOIN_CORE_VERSION);
    assert.strictEqual(report.bitcoin.remoteLatest, '32.0');
    assert.strictEqual(report.bitcoin.remoteIsNewer, true);
    assert.strictEqual(report.bitcoin.pinMatchesOfficial, true);
    assert.strictEqual(report.install, null);
    assert.strictEqual(report.lightning.pin, CORE_LIGHTNING_VERSION);
  });

  it('downloads the Hub pin when local Bitcoin is missing', async function () {
    let installed = null;
    const report = await checkManagedBinariesRemote({
      bitcoin: true,
      lightning: false,
      platformId: 'linux-x64',
      installIfMissing: true,
      status: {
        bitcoin: { installed: false },
        lightning: { installed: false, supported: true }
      },
      getText: async (url) => {
        if (url === 'https://bitcoincore.org/bin/') {
          return '<a href="bitcoin-core-29.4/">bitcoin-core-29.4/</a>';
        }
        if (/SHA256SUMS$/.test(url)) {
          const art = artifactsForPlatform('linux-x64').bitcoin;
          return `${art.sha256}  ${art.file}\n`;
        }
        if (url.indexOf('github.com') !== -1) {
          return JSON.stringify({ tag_name: 'v26.06.6' });
        }
        throw new Error('unexpected url ' + url);
      },
      installManagedBinaries: async (opts) => {
        installed = opts;
        return { bitcoin: { ok: true, skipped: false }, lightning: { skipped: true } };
      }
    });

    assert.ok(installed);
    assert.strictEqual(installed.bitcoin, true);
    assert.strictEqual(installed.lightning, false);
    assert.ok(report.install);
  });
});
