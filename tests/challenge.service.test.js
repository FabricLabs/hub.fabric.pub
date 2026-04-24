'use strict';

const assert = require('assert');
const ChallengeService = require('../services/challenge');

describe('ChallengeService', function () {
  it('registers a challenge row from a StorageContract', async function () {
    const svc = new ChallengeService({ enable: true });
    const contract = {
      type: 'StorageContract',
      id: 'contract-abc',
      document: 'doc-1',
      challengeCadence: 'weekly',
      responseDeadline: '60s'
    };
    const row = await svc.registerFromStorageContract(contract);
    assert.strictEqual(row.type, 'Challenge');
    assert.strictEqual(row.contractId, 'contract-abc');
    assert.strictEqual(row.documentId, 'doc-1');
    assert.strictEqual(svc.list().length, 1);
  });

  it('syncFromHubState picks up StorageContract rows', function () {
    const svc = new ChallengeService({});
    const hub = {
      _state: {
        content: {
          collections: {
            contracts: {
              a: { type: 'StorageContract', id: 'a', document: 'd1', challengeCadence: 'daily' },
              b: { type: 'Other', id: 'b' }
            }
          }
        }
      }
    };
    svc.attach({ hub });
    const n = svc.syncFromHubState();
    assert.strictEqual(n, 1);
    assert.ok(svc.getByContractId('a'));
    assert.strictEqual(svc.getByContractId('b'), null);
  });
});
