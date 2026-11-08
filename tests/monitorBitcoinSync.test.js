'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const monitor = require('../scripts/monitor-bitcoin-sync');

describe('monitor-bitcoin-sync', function () {
  it('finds a deploy instance by name', function () {
    const t = monitor.resolveTarget(monitor.parseArgs(['--network', 'mainnet', '--instance', 'operator', '--root', '/tmp/fabric-monitor-test']));
    assert.strictEqual(t.rpcPort, 32552);
    assert.strictEqual(t.zmqPort, 32928);
    assert.strictEqual(t.hubPort, 32188);
    assert.ok(t.datadir.endsWith(path.join('mainnet', 'operator', 'bitcoin-datadir')));
    assert.strictEqual(t.debugLog, path.join(t.datadir, 'debug.log'));
  });

  it('puts debug.log and the cookie in the chain subdirectory off mainnet', function () {
    assert.strictEqual(monitor.chainDir('/d', 'signet'), path.join('/d', 'signet'));
    assert.strictEqual(monitor.chainDir('/d', 'testnet'), path.join('/d', 'testnet3'));
    assert.strictEqual(monitor.chainDir('/d', 'mainnet'), '/d');
  });

  it('reads ps cumulative CPU times', function () {
    assert.strictEqual(monitor.parseCpuTime('0:01.50'), 1.5);
    assert.strictEqual(monitor.parseCpuTime('12:34.00'), 754);
    assert.strictEqual(monitor.parseCpuTime('1:00:00.00'), 3600);
    assert.strictEqual(monitor.parseCpuTime('2-01:00:00'), 176400);
  });

  it('parses the last UpdateTip line', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-monitor-'));
    try {
      const file = path.join(dir, 'debug.log');
      fs.writeFileSync(file, [
        "2026-11-06T21:00:00Z UpdateTip: new best=00aa height=100 version=0x1 log2_work=60.1 tx=1000 date='2010-01-01T00:00:00Z' progress=0.000100 cache=1.0MiB(10txo)",
        "2026-11-06T21:00:01Z UpdateTip: new best=00bb height=101 version=0x1 log2_work=60.2 tx=1005 date='2010-01-01T00:10:00Z' progress=0.000101 cache=1.5MiB(12txo)",
        '2026-11-06T21:00:02Z Saw new header'
      ].join('\n') + '\n');
      const tip = monitor.lastUpdateTip(file);
      assert.deepStrictEqual(tip, {
        at: '2026-11-06T21:00:01Z', height: 101, tx: 1005, blockDate: '2010-01-01T00:10:00Z',
        progress: 0.000101, cacheMiB: 1.5, cacheTxo: 12
      });
      assert.strictEqual(monitor.lastUpdateTip(path.join(dir, 'missing.log')), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts only what the Hub appended since the last read', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-monitor-'));
    try {
      const file = path.join(dir, 'hub.log');
      fs.writeFileSync(file, '[BITCOIN] [ERROR] old\n');
      const read = monitor.createLogTail(file);
      assert.strictEqual(read().lines, 0, 'the first read starts at the end');
      fs.appendFileSync(file, '[BITCOIN] [ERROR] Unable to synchronize: Error: connect ECONNRESET 127.0.0.1:32552\n' +
        '[HUB:HEAP] {"at":"x","eventLoop":{"p99Ms":5}}\nplain line\n');
      const out = read();
      assert.strictEqual(out.lines, 3);
      assert.strictEqual(out.counts.econnreset, 1);
      assert.strictEqual(out.counts.error, 1);
      assert.deepStrictEqual(out.heap.eventLoop, { p99Ms: 5 });
      assert.strictEqual(read().lines, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes percentiles of finite values', function () {
    assert.strictEqual(monitor.percentile([5, 1, null, 3], 50), 3);
    assert.strictEqual(monitor.percentile([5, 1, 3], 100), 5);
    assert.strictEqual(monitor.percentile([], 50), null);
  });
});
