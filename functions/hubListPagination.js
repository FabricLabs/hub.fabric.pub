'use strict';

const React = require('react');

const DEFAULT_HUB_LIST_PAGE_SIZE = 10;

/**
 * @param {unknown[]} items
 * @param {number} requestedPage
 * @param {number} [pageSize]
 * @returns {{
 *   slice: unknown[],
 *   totalPages: number,
 *   page: number,
 *   total: number,
 *   rangeFrom: number,
 *   rangeTo: number,
 *   pageSize: number
 * }}
 */
function paginateArray (items, requestedPage, pageSize) {
  const arr = Array.isArray(items) ? items : [];
  const n = Math.max(1, Number(pageSize) || DEFAULT_HUB_LIST_PAGE_SIZE);
  const total = arr.length;
  const totalPages = Math.max(1, Math.ceil(total / n));
  const raw = Number(requestedPage);
  const requested = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  const page = Math.min(requested, totalPages);
  const start = (page - 1) * n;
  const slice = arr.slice(start, start + n);
  const rangeFrom = total ? start + 1 : 0;
  const rangeTo = Math.min(start + n, total);
  return {
    slice,
    totalPages,
    page,
    total,
    rangeFrom,
    rangeTo,
    pageSize: n
  };
}

/**
 * @param {unknown[]} items
 * @param {string} resetKey When this changes, active page resets to 1.
 * @param {number} [pageSize]
 */
function useHubListPagination (items, resetKey, pageSize) {
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    setPage(1);
  }, [resetKey]);
  const model = paginateArray(items, page, pageSize);
  React.useEffect(() => {
    if (model.page !== page) setPage(model.page);
  }, [model.page, page]);
  return { ...model, setPage };
}

module.exports = {
  DEFAULT_HUB_LIST_PAGE_SIZE,
  paginateArray,
  useHubListPagination
};
