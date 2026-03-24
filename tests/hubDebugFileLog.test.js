'use strict';

const assert = require('assert');
const { shouldAppendHubDebugLine, hubDebugLogPath } = require('../functions/hubDebugFileLog');

describe('hubDebugFileLog', function () {
  const prevLog = process.env.FABRIC_HUB_DEBUG_LOG;

  afterEach(function () {
    if (prevLog === undefined) delete process.env.FABRIC_HUB_DEBUG_LOG;
    else process.env.FABRIC_HUB_DEBUG_LOG = prevLog;
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

  it('hubDebugLogPath defaults under stores/hub/debug.log', function () {
    const p = hubDebugLogPath('/tmp/fabric-test-root');
    assert.ok(p.endsWith(`stores${require('path').sep}hub${require('path').sep}debug.log`), p);
  });
});
