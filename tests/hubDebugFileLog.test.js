'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  shouldAppendHubDebugLine,
  hubDebugLogPath,
  maybeRotateHubDebugLogFile,
  resolveDebugLogMaxBytes
} = require('../functions/hubDebugFileLog');

describe('hubDebugFileLog', function () {
  const prevLog = process.env.FABRIC_HUB_DEBUG_LOG;
  const prevMax = process.env.FABRIC_HUB_DEBUG_LOG_MAX_BYTES;

  afterEach(function () {
    if (prevLog === undefined) delete process.env.FABRIC_HUB_DEBUG_LOG;
    else process.env.FABRIC_HUB_DEBUG_LOG = prevLog;
    if (prevMax === undefined) delete process.env.FABRIC_HUB_DEBUG_LOG_MAX_BYTES;
    else process.env.FABRIC_HUB_DEBUG_LOG_MAX_BYTES = prevMax;
  });

  it('matches hub-prefixed lines when filter mode', function () {
    delete process.env.FABRIC_HUB_DEBUG_LOG;
    assert.strictEqual(shouldAppendHubDebugLine('[HUB] test'), true);
    assert.strictEqual(shouldAppendHubDebugLine('[HUB:SIDECHAIN] x'), true);
    assert.strictEqual(shouldAppendHubDebugLine('[FABRIC:HUB] x'), true);
    assert.strictEqual(shouldAppendHubDebugLine('random npm noise'), false);
  });

  it('all mode matches any line', function () {
    process.env.FABRIC_HUB_DEBUG_LOG = 'all';
    assert.strictEqual(shouldAppendHubDebugLine('anything'), true);
  });

  it('hubDebugLogPath defaults under logs/hub/debug.log (outside Fabric stores/hub)', function () {
    const p = hubDebugLogPath('/tmp/fabric-test-root');
    assert.ok(
      p.endsWith(`logs${path.sep}hub${path.sep}debug.log`),
      p
    );
  });

  it('maybeRotateHubDebugLogFile renames log when over max bytes', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-dbg-'));
    const logf = path.join(dir, 'debug.log');
    fs.writeFileSync(logf, 'x'.repeat(200), 'utf8');
    process.env.FABRIC_HUB_DEBUG_LOG_MAX_BYTES = '100';
    maybeRotateHubDebugLogFile(logf);
    assert.strictEqual(fs.existsSync(logf), false);
    assert.strictEqual(fs.readFileSync(`${logf}.1`, 'utf8').length, 200);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolveDebugLogMaxBytes 0 means unlimited', function () {
    process.env.FABRIC_HUB_DEBUG_LOG_MAX_BYTES = '0';
    assert.strictEqual(resolveDebugLogMaxBytes(), 0);
  });
});
