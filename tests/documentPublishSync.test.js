'use strict';

const assert = require('assert');
const {
  needsCreateDocumentBeforePublish,
  mergePublishedDocumentsFromHubStatus
} = require('../functions/documentPublishSync');

describe('functions/documentPublishSync', function () {
  describe('needsCreateDocumentBeforePublish', function () {
    it('is true for opaque local id with sha and not published', function () {
      const sha = 'a'.repeat(64);
      assert.strictEqual(
        needsCreateDocumentBeforePublish('fabric-actor-xyz', { sha256: sha, published: false }),
        true
      );
    });

    it('is false when logical id is already the content hash (post-CreateDocument publish hop)', function () {
      const sha = 'b'.repeat(64);
      assert.strictEqual(
        needsCreateDocumentBeforePublish(sha, { id: sha, sha256: sha, published: false }),
        false
      );
    });

    it('is false when document is already published', function () {
      const sha = 'c'.repeat(64);
      assert.strictEqual(
        needsCreateDocumentBeforePublish('actor', { sha256: sha, published: '2025-01-01T00:00:00.000Z' }),
        false
      );
    });

    it('is false without sha256', function () {
      assert.strictEqual(needsCreateDocumentBeforePublish('actor', { published: false }), false);
    });
  });

  describe('mergePublishedDocumentsFromHubStatus', function () {
    it('sets published from hub catalog when matched by id or sha256', function () {
      const sha = 'd'.repeat(64);
      const documents = {
        local1: { id: 'local1', sha256: sha, name: 'x' },
        [sha]: { id: sha, sha256: sha, name: 'x' }
      };
      const published = {
        [sha]: { id: sha, sha256: sha, published: '2025-03-01T12:00:00.000Z' }
      };
      const changed = mergePublishedDocumentsFromHubStatus(documents, published);
      assert.strictEqual(changed, true);
      assert.strictEqual(documents.local1.published, '2025-03-01T12:00:00.000Z');
      assert.strictEqual(documents[sha].published, '2025-03-01T12:00:00.000Z');
    });

    it('does not strip published when catalog snapshot omits the document', function () {
      const documents = {
        local1: { id: 'local1', sha256: 'e'.repeat(64), published: '2025-03-02T00:00:00.000Z' }
      };
      const changed = mergePublishedDocumentsFromHubStatus(documents, {});
      assert.strictEqual(changed, false);
      assert.strictEqual(documents.local1.published, '2025-03-02T00:00:00.000Z');
    });
  });
});
