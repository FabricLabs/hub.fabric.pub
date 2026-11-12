'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Key = require('@fabric/core/types/key');
const { rootKeyPath, readHubRootKey, loadOrCreateHubRootKey } = require('../functions/hubRootKey');

describe('hubRootKey', function () {
  let dir;
  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-root-key-'));
  });
  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Reversible stand-in for safeStorage.
  const sealing = {
    seal: (value) => Buffer.from(String(value), 'utf8').map((b) => b ^ 0x5a),
    unseal: (buffer) => Buffer.from(buffer).map((b) => b ^ 0x5a).toString('utf8')
  };

  it('creates the key once (0600) and returns the same key afterwards', function () {
    const filePath = rootKeyPath(path.join(dir, 'stores', 'hub'));
    const first = loadOrCreateHubRootKey({ filePath });
    assert.strictEqual(first.created, true);
    assert.strictEqual(first.sealed, false);
    assert.strictEqual(new Key({ xprv: first.xprv }).xprv, first.xprv);
    assert.strictEqual(fs.statSync(filePath).mode & 0o777, 0o600);

    const second = loadOrCreateHubRootKey({ filePath });
    assert.strictEqual(second.created, false);
    assert.strictEqual(second.xprv, first.xprv);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(filePath)), ['ROOT_KEY']);
  });

  it('seals the key when given a sealer and never writes it in the clear', function () {
    const filePath = rootKeyPath(dir);
    const first = loadOrCreateHubRootKey({ filePath, ...sealing });
    assert.strictEqual(first.sealed, true);
    const raw = fs.readFileSync(filePath, 'utf8');
    assert.ok(!raw.includes(first.xprv));
    assert.ok(!JSON.parse(raw).xprv);
    assert.strictEqual(loadOrCreateHubRootKey({ filePath, ...sealing }).xprv, first.xprv);
  });

  it('refuses a sealed key it cannot unseal instead of replacing it', function () {
    const filePath = rootKeyPath(dir);
    loadOrCreateHubRootKey({ filePath, ...sealing });
    const before = fs.readFileSync(filePath, 'utf8');
    assert.throws(() => loadOrCreateHubRootKey({ filePath }), /sealed with the desktop app/);
    assert.throws(() => loadOrCreateHubRootKey({ filePath, unseal: () => { throw new Error('keychain locked'); } }), /will not replace it/);
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), before);
  });

  it('refuses a damaged key file instead of replacing it', function () {
    const filePath = rootKeyPath(dir);
    fs.writeFileSync(filePath, 'not json');
    assert.throws(() => loadOrCreateHubRootKey({ filePath }), /not a Hub root key file/);
    fs.writeFileSync(filePath, JSON.stringify({ type: 'FabricHubRootKey', version: 1, sealed: false, xprv: 'xprv-nope' }));
    assert.throws(() => readHubRootKey(filePath), /does not hold an extended private key/);
    assert.strictEqual(readHubRootKey(rootKeyPath(path.join(dir, 'missing'))), null);
  });
});
