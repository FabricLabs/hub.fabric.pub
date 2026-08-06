/**
 * Injected into the page (main world) by the content script.
 * Must be a separate file — inline script violates strict CSP on Hub pages.
 */
(function () {
  if (window.__FABRIC_HUB_EXTENSION__) return;
  var reqId = 0;
  window.__FABRIC_HUB_EXTENSION__ = {
    isAvailable: true,
    getIdentity: function () {
      return new Promise(function (resolve) {
        var id = (++reqId) + '-' + Date.now();
        function handler (e) {
          if (!e || !e.data || e.data.type !== 'fabric-hub-ext-response' || e.data.requestId !== id) return;
          window.removeEventListener('message', handler);
          resolve(e.data.identity || null);
        }
        window.addEventListener('message', handler);
        var origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '*';
        window.postMessage({ type: 'fabric-hub-ext-request', requestId: id, action: 'getIdentity' }, origin);
      });
    }
  };
})();
