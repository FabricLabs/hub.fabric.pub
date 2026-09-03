'use strict';

/**
 * @fileoverview Coverage locks from FabricLabs/hub.fabric.pub PR #16 review items.
 *
 * Codacy: operator path helpers live under libs/hub-operator with thin
 * functions/* re-exports. Security: EditDocument shares the bulk-advisory
 * guard with CreateDocument. Wave 4: Bridge parent via http/core
 * fabricMessageParent + Message.toVector parent round-trip.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('mocha');

const { looksLikeBulkSecurityAdvisory } = require('../functions/bulkSecurityAdvisory');
const {
  isHttpSharedModeEnabled,
  resolveHttpListenHost
} = require('../functions/httpSharedMode');

const OPERATOR_REEXPORTS = [
  'desktopOpenAtLogin',
  'desktopUserData',
  'fabricHubSeedProbe',
  'hubDownloadsIndex',
  'hubManagedBinaries'
];

describe('Hub PR #16 review coverage', function () {
  it('functions/* re-exports resolve to libs/hub-operator implementations', function () {
    for (const name of OPERATOR_REEXPORTS) {
      const reexport = require(path.join('..', 'functions', name));
      const impl = require(path.join('..', 'libs', 'hub-operator', name));
      assert.strictEqual(reexport, impl, `${name} re-export mismatch`);
    }
  });

  it('lockfile pins fabric #99a8681 and fabric-http #2149ba2', function () {
    const lock = fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8');
    assert.ok(lock.includes('99a8681b301de503ebdf656c7d793736d0cba025'), 'core pin');
    assert.ok(lock.includes('2149ba238b7cbe71f6a77f2067167f35583a6848'), 'http pin');
  });

  it('declares stoppable so fabricHttpRebind works without http hoisting', function () {
    const pkg = require('../package.json');
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    assert.strictEqual(deps.stoppable, '=1.1.0');
  });

  it('EditDocument advisory guard rejects the same payloads as CreateDocument', function () {
    const advisoryBuf = Buffer.from(JSON.stringify({
      security_advisory: { ghsa_id: 'GHSA-edit-doc-bypass', type: 'malware' }
    }), 'utf8');
    assert.strictEqual(looksLikeBulkSecurityAdvisory(advisoryBuf), true);
    assert.strictEqual(
      looksLikeBulkSecurityAdvisory('@zalastax/nolb-edit-bypass'),
      true
    );
  });

  it('httpSharedMode resolveHttpListenHost avoids dynamic env[key] walks', function () {
    assert.strictEqual(
      resolveHttpListenHost({
        mode: 'relay',
        env: { FABRIC_HUB_INTERFACE: '10.0.0.5', INTERFACE: '192.168.0.1' }
      }),
      '10.0.0.5'
    );
    assert.strictEqual(isHttpSharedModeEnabled(' YES '), true);
    assert.strictEqual(isHttpSharedModeEnabled(undefined), false);
  });

  it('Bridge path fabricMessageParent matches core and toVector keeps parent', function () {
    let parentLib = null;
    try {
      parentLib = require('@fabric/http/functions/fabricMessageParent');
    } catch (_) {
      parentLib = require('@fabric/core/functions/fabricMessageParent');
    }
    const coreParent = require('@fabric/core/functions/fabricMessageParent');
    assert.strictEqual(parentLib.ZERO_PARENT, coreParent.ZERO_PARENT);
    assert.strictEqual(typeof parentLib.setMessageParent, 'function');

    const Key = require('@fabric/core/types/key');
    const Message = require('@fabric/core/types/message');
    const key = new Key();
    const genesis = Message.fromVector(['P2P_CHAT_MESSAGE', 'hub-bridge-genesis']).signWithKey(key);
    const child = Message.fromVector(['P2P_CHAT_MESSAGE', 'hub-bridge-child', genesis]).signWithKey(key);
    parentLib.setMessageParent(child, genesis.id);
    assert.strictEqual(parentLib.parentHexOf(child), genesis.id);

    const vec = child.toVector();
    assert.strictEqual(vec.length, 3);
    const restored = Message.fromVector(vec).signWithKey(key);
    assert.strictEqual(restored.parent, genesis.id);
  });
});
