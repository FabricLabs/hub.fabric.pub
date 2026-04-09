'use strict';

/**
 * Hide deep links when the matching Bitcoin sub-flag is off (avoids redirect-to-home).
 * @param {string|null|undefined} href
 * @param {Record<string, boolean>} uf
 * @returns {string|null}
 */
function inAppNotificationOpenHref (href, uf) {
  if (!href || !uf) return href || null;
  const h = String(href);
  const path = h.split(/[?#]/)[0];
  if (path === '/services/bitcoin') return href;
  if (path.startsWith('/payments') || path.startsWith('/services/bitcoin/payments')) {
    return uf.bitcoinPayments ? href : null;
  }
  if (path.startsWith('/services/bitcoin/invoices')) return uf.bitcoinInvoices ? href : null;
  if (path.startsWith('/services/bitcoin/resources')) return uf.bitcoinResources ? href : null;
  if (path.startsWith('/services/bitcoin/blocks') || path.startsWith('/services/bitcoin/transactions')) {
    return uf.bitcoinExplorer ? href : null;
  }
  if (path.startsWith('/services/bitcoin/channels')) return uf.bitcoinLightning ? href : null;
  if (path.startsWith('/services/bitcoin/crowdfunding') || path.startsWith('/services/bitcoin/crowdfunds')) {
    return uf.bitcoinCrowdfund ? href : null;
  }
  if (path.startsWith('/services/bitcoin/')) return href;
  return href;
}

module.exports = { inAppNotificationOpenHref };
