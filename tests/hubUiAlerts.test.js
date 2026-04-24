'use strict';

const assert = require('assert');
const {
  normalizeHubUiAlerts,
  mergeAlertLists,
  filterActiveAlerts
} = require('../functions/hubUiAlerts');

describe('hubUiAlerts', function () {
  it('normalizeHubUiAlerts drops invalid entries and caps shape', function () {
    const n = normalizeHubUiAlerts([
      null,
      { id: 'a', message: 'Hello' },
      { id: 'a', message: 'Dup id ignored' },
      { id: '', message: 'No id' },
      { id: 'b', message: '   ', severity: 'warning' },
      { id: 'c', message: 'Ok', elementName: 'my alert !!!', severity: 'bogus' }
    ]);
    assert.strictEqual(n.length, 2);
    assert.strictEqual(n[0].id, 'a');
    assert.strictEqual(n[0].elementName, 'fabric-hub-alert-a');
    assert.strictEqual(n[0].severity, 'info');
    assert.strictEqual(n[1].id, 'c');
    assert.strictEqual(n[1].elementName, 'my-alert');
    assert.strictEqual(n[1].severity, 'info');
  });

  it('mergeAlertLists dedupes by id with server first', function () {
    const m = mergeAlertLists(
      [{ id: 'x', message: 'one' }],
      [{ id: 'x', message: 'two' }, { id: 'y', message: 'w' }]
    );
    assert.strictEqual(m.length, 2);
    assert.strictEqual(m[0].message, 'one');
    assert.strictEqual(m[1].id, 'y');
  });

  it('filterActiveAlerts removes dismissed ids', function () {
    const alerts = [{ id: 'a', message: 'm' }];
    const active = filterActiveAlerts(alerts, new Set(['a']));
    assert.strictEqual(active.length, 0);
  });
});
