'use strict';

const assert = require('assert');
const {
  DEFAULT_HUB_LIST_PAGE_SIZE,
  paginateArray
} = require('../functions/hubListPagination');

describe('hubListPagination', () => {
  it('paginateArray uses default page size and clamps page', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const n = DEFAULT_HUB_LIST_PAGE_SIZE;
    const totalPages = Math.ceil(30 / n);
    const a = paginateArray(items, 1, n);
    assert.strictEqual(a.total, 30);
    assert.strictEqual(a.totalPages, totalPages);
    assert.strictEqual(a.page, 1);
    assert.strictEqual(a.slice.length, n);
    assert.strictEqual(a.rangeFrom, 1);
    assert.strictEqual(a.rangeTo, n);

    const b = paginateArray(items, 99, n);
    assert.strictEqual(b.page, totalPages);
    const start = (totalPages - 1) * n;
    assert.strictEqual(b.slice[0], start);
    assert.strictEqual(b.slice.length, Math.min(n, 30 - start));
  });

  it('paginateArray handles empty list', () => {
    const a = paginateArray([], 5, 10);
    assert.strictEqual(a.total, 0);
    assert.strictEqual(a.totalPages, 1);
    assert.strictEqual(a.page, 1);
    assert.deepStrictEqual(a.slice, []);
    assert.strictEqual(a.rangeFrom, 0);
    assert.strictEqual(a.rangeTo, 0);
  });
});
