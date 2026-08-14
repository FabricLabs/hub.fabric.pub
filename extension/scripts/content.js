'use strict';

/**
 * Fabric Hub extension content script.
 * Runs on Hub pages, exposes window.__FABRIC_HUB_EXTENSION__ for login-with-extension.
 * Communicates with page via postMessage (content script is in isolated world).
 *
 * Page bridge is loaded from page-bridge.js (not inline) so strict CSP on Hub does not block it.
 */
function injectPageBridge () {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-bridge.js');
  script.onload = function () {
    this.remove();
  };
  script.onerror = function () {
    console.error('[Fabric Hub extension] Failed to inject page-bridge.js');
  };
  (document.head || document.documentElement).appendChild(script);
}

function handlePageRequest (event) {
  if (!event || !event.data || event.data.type !== 'fabric-hub-ext-request') return;
  const { requestId, action } = event.data;
  if (action !== 'getIdentity') return;
  const targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
  const reply = (identity) => {
    if (!event.source || typeof event.source.postMessage !== 'function') return;
    event.source.postMessage({
      type: 'fabric-hub-ext-response',
      requestId,
      identity
    }, targetOrigin);
  };

  chrome.storage.local.get(['fabric.identity.ext'], (result) => {
    const payload = result && result['fabric.identity.ext'];
    // Never forward xprv into the page JS realm: postMessage is observable (e.g. XSS). Hub uses watch-only
    // from extension; unlock a full key in the browser Identity UI when signing/decryption is required.
    const identity = (payload && payload.xpub)
      ? { id: payload.id, xpub: payload.xpub, passwordProtected: !!payload.passwordProtected }
      : null;
    reply(identity);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectPageBridge);
} else {
  injectPageBridge();
}
window.addEventListener('message', handlePageRequest);
