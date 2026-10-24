'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RotatingLogFile, redactLogText } = require('../functions/desktopLogFile');

describe('functions/desktopLogFile', () => {
  it('redactLogText scrubs keys, tokens, and passwords', () => {
    const xprv = 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
    const out = redactLogText([
      `key ${xprv}`,
      'Authorization: Bearer abc.def-123',
      '{"adminToken":"s3cret","name":"hub"}',
      'GET /x?token=zzz&a=1',
      'FABRIC_MNEMONIC=word1'
    ].join('\n'));
    assert.ok(!out.includes(xprv.slice(4)));
    assert.ok(out.includes('xprv…[redacted]'));
    assert.ok(out.includes('Bearer [redacted]'));
    assert.ok(out.includes('"adminToken":"[redacted]"'));
    assert.ok(out.includes('"name":"hub"'));
    assert.ok(out.includes('?token=[redacted]&a=1'));
    assert.ok(out.includes('FABRIC_MNEMONIC=[redacted]'));
  });

  it('RotatingLogFile rolls over past maxBytes and keeps N files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-log-'));
    const filePath = path.join(dir, 'fabric-hub.log');
    const log = new RotatingLogFile({ filePath, maxBytes: 64, keep: 2 });
    for (let i = 0; i < 6; i++) log.write(`line ${i} ${'x'.repeat(40)}\n`);
    log.write('Bearer secret-token\n');
    log.close();
    assert.ok(fs.readFileSync(filePath, 'utf8').includes('Bearer [redacted]'));
    assert.ok(fs.existsSync(`${filePath}.1`));
    assert.ok(fs.existsSync(`${filePath}.2`));
    assert.ok(!fs.existsSync(`${filePath}.3`));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
