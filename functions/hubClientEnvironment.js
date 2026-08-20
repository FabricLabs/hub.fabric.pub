'use strict';

/**
 * Classify whether this origin (or a probed Hub URL) is a live Hub HTTP API
 * or only an HTML client (CDN / `http-server assets/` / spaFallback).
 */

const HUB_UI_RUNTIME_HUB = 'hub';
const HUB_UI_RUNTIME_CLIENT = 'client';

/**
 * @param {string} [text]
 * @returns {boolean}
 */
function looksLikeHtmlDocument (text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return s.charAt(0) === '<' || /^<!doctype/i.test(s);
}

/**
 * True for Hub `GET /settings` JSON (`{ success, settings, configured, needsSetup }`)
 * or the compact `{ configured, needsSetup }` setup-status object.
 * @param {object|null|undefined} value
 * @returns {boolean}
 */
function isFabricHubSettingsJson (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.configured === 'boolean' && typeof value.needsSetup === 'boolean') {
    return true;
  }
  if (value.success === true && value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings)) {
    return true;
  }
  return false;
}

/**
 * @param {object} [probe]
 * @param {number} [probe.status]
 * @param {string} [probe.contentType]
 * @param {string} [probe.bodyText]
 * @param {object|null} [probe.json]
 * @param {string} [probe.error]
 * @returns {{ runtime: string, reason: string, needsSetup?: boolean, configured?: boolean, requiresSetupUiSecret?: boolean }}
 */
function classifyHubHttpProbe (probe = {}) {
  const status = Number(probe.status) || 0;
  const contentType = String(probe.contentType || '').toLowerCase();
  const bodyText = probe.bodyText != null ? String(probe.bodyText) : '';
  let json = probe.json && typeof probe.json === 'object' && !Array.isArray(probe.json) ? probe.json : null;

  if (!json && bodyText && !looksLikeHtmlDocument(bodyText)) {
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed;
    } catch (_) { /* not JSON */ }
  }

  if (looksLikeHtmlDocument(bodyText) || contentType.includes('text/html')) {
    return { runtime: HUB_UI_RUNTIME_CLIENT, reason: 'html' };
  }

  if (json && json.protection && json.error) {
    return { runtime: HUB_UI_RUNTIME_CLIENT, reason: 'cdn-protection' };
  }

  if (json && isFabricHubSettingsJson(json)) {
    return {
      runtime: HUB_UI_RUNTIME_HUB,
      reason: 'settings-json',
      needsSetup: !!json.needsSetup,
      configured: json.configured === true,
      requiresSetupUiSecret: !!json.requiresSetupUiSecret
    };
  }

  if (status === 403 && json) {
    return {
      runtime: HUB_UI_RUNTIME_HUB,
      reason: 'http-403',
      needsSetup: false,
      configured: true
    };
  }

  if (!status && probe.error) {
    return { runtime: HUB_UI_RUNTIME_CLIENT, reason: 'unreachable' };
  }

  if (status === 404 || status === 401) {
    return { runtime: HUB_UI_RUNTIME_CLIENT, reason: `http-${status}` };
  }

  if (status >= 200 && status < 300) {
    return { runtime: HUB_UI_RUNTIME_CLIENT, reason: 'not-hub-json' };
  }

  return { runtime: HUB_UI_RUNTIME_CLIENT, reason: status ? `http-${status}` : 'unknown' };
}

module.exports = {
  HUB_UI_RUNTIME_HUB,
  HUB_UI_RUNTIME_CLIENT,
  looksLikeHtmlDocument,
  isFabricHubSettingsJson,
  classifyHubHttpProbe
};
