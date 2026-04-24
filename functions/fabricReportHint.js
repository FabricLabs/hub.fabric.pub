'use strict';

/**
 * Default URL for bug reports (Hub + browser bundle).
 * Override with FABRIC_ISSUES_URL (Node) or window.FABRIC_ISSUES_URL (browser).
 */
const DEFAULT_ISSUES_URL = 'https://github.com/FabricLabs/hub.fabric.pub/issues';

function reportIssuesUrl () {
  if (typeof process !== 'undefined' && process.env && process.env.FABRIC_ISSUES_URL) {
    return String(process.env.FABRIC_ISSUES_URL);
  }
  if (typeof window !== 'undefined' && window.FABRIC_ISSUES_URL) {
    return String(window.FABRIC_ISSUES_URL);
  }
  return DEFAULT_ISSUES_URL;
}

function reportHintLine () {
  return `If this looks like a Fabric bug, report it at: ${reportIssuesUrl()}`;
}

/**
 * After logging the crash, print where to file an issue (same console stream).
 * @param {string} [prefix] - e.g. '[FABRIC:HUB]' or '[BRIDGE]'
 */
function logCrashReportHint (prefix) {
  const p = prefix != null ? prefix : '[FABRIC]';
  console.error(p, reportHintLine());
}

module.exports = {
  reportIssuesUrl,
  reportHintLine,
  logCrashReportHint
};
