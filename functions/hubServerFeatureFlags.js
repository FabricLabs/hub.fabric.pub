'use strict';

/**
 * Browser helpers for server `FEATURE_FLAGS` exposed on GetNetworkStatus (`featureFlags`).
 */

const { getFabricBrowserGlobal } = require('./fabricBrowserState');

/**
 * @param {object|null|undefined} networkStatus - Bridge networkStatus / GetNetworkStatus result
 * @returns {{ bitcoin:boolean, documentPurchase:boolean, payjoin:boolean, invoices:boolean, distribute:boolean, lightning:boolean, webrtc:boolean }}
 */
function serverFeatureFlagsFromStatus (networkStatus) {
  const f = networkStatus && networkStatus.featureFlags && typeof networkStatus.featureFlags === 'object'
    ? networkStatus.featureFlags
    : {};
  return {
    bitcoin: f.bitcoin !== false,
    documentPurchase: f.documentPurchase !== false,
    payjoin: !!f.payjoin,
    invoices: f.invoices !== false,
    distribute: !!f.distribute,
    lightning: !!f.lightning,
    webrtc: !!f.webrtc
  };
}

/**
 * Read from Bridge instance or window.__FABRIC_BRIDGE__ / last network status event.
 * @param {{ networkStatus?: object, state?: { networkStatus?: object } }|null} bridge
 * @returns {ReturnType<typeof serverFeatureFlagsFromStatus>}
 */
function loadServerFeatureFlags (bridge) {
  const fromBridge = bridge && (bridge.networkStatus || (bridge.state && bridge.state.networkStatus));
  if (fromBridge) return serverFeatureFlagsFromStatus(fromBridge);
  try {
    const w = getFabricBrowserGlobal();
    if (w && w.__FABRIC_LAST_NETWORK_STATUS__) {
      return serverFeatureFlagsFromStatus(w.__FABRIC_LAST_NETWORK_STATUS__);
    }
  } catch (_) {}
  // Safe defaults aligned with constants.js when status not yet loaded.
  return {
    bitcoin: true,
    documentPurchase: true,
    payjoin: false,
    invoices: true,
    distribute: false,
    lightning: false,
    webrtc: false
  };
}

module.exports = {
  serverFeatureFlagsFromStatus,
  loadServerFeatureFlags
};
