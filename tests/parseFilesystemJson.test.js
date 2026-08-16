'use strict';

const assert = require('assert');
const parseFilesystemJson = require('../functions/parseFilesystemJson');

describe('parseFilesystemJson', function () {
  it('parses UTF-8 Buffers the same as strings', function () {
    const obj = { id: 'aa'.repeat(32), name: 'held.txt', contentBase64: 'aGVsbG8=' };
    const text = JSON.stringify(obj);
    assert.deepStrictEqual(parseFilesystemJson(text), obj);
    assert.deepStrictEqual(parseFilesystemJson(Buffer.from(text, 'utf8')), obj);
  });

  it('returns already-decoded objects (test mocks)', function () {
    const obj = { id: 'bb'.repeat(32), name: 'mock.txt' };
    assert.strictEqual(parseFilesystemJson(obj), obj);
  });

  it('returns null for missing files', function () {
    assert.strictEqual(parseFilesystemJson(null), null);
    assert.strictEqual(parseFilesystemJson(undefined), null);
  });

  it('throws on broken JSON text and Buffers', function () {
    assert.throws(() => parseFilesystemJson('{not-json'), SyntaxError);
    assert.throws(() => parseFilesystemJson(Buffer.from('{not-json', 'utf8')), SyntaxError);
  });
});
