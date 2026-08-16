'use strict';

const assert = require('assert');
const {
  installFilesystemPublishHeapGuard,
  dropFilesystemBodyCache
} = require('../functions/hubFilesystemPersist');

describe('Hub Filesystem publish heap guard', function () {
  it('routes publish through writeFile and does not call the original publish', async function () {
    const writes = [];
    let origPublish = 0;
    const fs = {
      _state: { documents: { keep: 'no' }, actors: { a: 1 } },
      writeFile (name, body) {
        writes.push({ name, body });
        return true;
      },
      async publish () {
        origPublish++;
      }
    };
    installFilesystemPublishHeapGuard(fs);
    await fs.publish('documents/x.json', { id: 'x', contentBase64: 'QQ==' });
    assert.strictEqual(origPublish, 0);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].name, 'documents/x.json');
    assert.ok(String(writes[0].body).indexOf('QQ==') >= 0);
    assert.deepStrictEqual(fs._state.documents, {});
  });

  it('installFilesystemPublishHeapGuard is idempotent', function () {
    const fs = { writeFile () { return true; }, publish: async () => {} };
    installFilesystemPublishHeapGuard(fs);
    const first = fs.publish;
    installFilesystemPublishHeapGuard(fs);
    assert.strictEqual(fs.publish, first);
  });

  it('dropFilesystemBodyCache clears retain maps', function () {
    const fs = { _state: { documents: { a: 'body' }, actors: { b: {} } } };
    dropFilesystemBodyCache(fs);
    assert.deepStrictEqual(fs._state.documents, {});
    assert.deepStrictEqual(fs._state.actors, {});
  });
});
