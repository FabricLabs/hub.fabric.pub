'use strict';

const MAX_ADVISORY_DEPTH = 8;
const MAX_ADVISORY_ARRAY = 32;
const GHSA_ID = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i;

/**
 * Detect OpenSSF / GHSA bulk malware advisories (e.g. `@zalastax/nolb-*`).
 * Those dumps were ingested as Fabric documents and Internal messages until Hub OOM.
 * @param {*} input metadata, JSON object, UTF-8 string, or Buffer
 * @param {number} [depth]
 * @returns {boolean}
 */
function looksLikeBulkSecurityAdvisory (input, depth) {
  if (depth == null) depth = 0;
  if (depth > MAX_ADVISORY_DEPTH) return false;
  if (input == null) return false;
  if (Buffer.isBuffer(input)) {
    const n = Math.min(input.length, 8192);
    return looksLikeBulkSecurityAdvisory(input.slice(0, n).toString('utf8'), depth + 1);
  }
  if (typeof input === 'string') {
    const s = input.length > 16384 ? input.slice(0, 16384) : input;
    if (/@zalastax\/nolb-/i.test(s)) return true;
    if (/malicious code in @/i.test(s)) return true;
    if (/"security_advisory"\s*:/.test(s) && (
      GHSA_ID.test(s) ||
      /"type"\s*:\s*"malware"/i.test(s)
    )) return true;
    const trimmed = s.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return looksLikeBulkSecurityAdvisory(JSON.parse(trimmed), depth + 1);
      } catch (_) {
        return false;
      }
    }
    return false;
  }
  if (typeof input !== 'object') return false;
  if (Array.isArray(input)) {
    for (const item of input.slice(0, MAX_ADVISORY_ARRAY)) {
      if (looksLikeBulkSecurityAdvisory(item, depth + 1)) return true;
    }
    return false;
  }
  if (input.security_advisory != null) {
    if (advisoryObjectMatches(input.security_advisory)) return true;
    if (typeof input.security_advisory === 'string' &&
        looksLikeBulkSecurityAdvisory(input.security_advisory, depth + 1)) {
      return true;
    }
  }
  const summary = String(input.summary || input.title || input.name || input.description || '');
  const id = String(input.ghsa_id || input.id || '');
  if (GHSA_ID.test(id) || String(input.type || '').toLowerCase() === 'malware') return true;
  if (input.ghsa_id && /malicious code in @/i.test(summary)) return true;
  if (/@zalastax\/nolb-/i.test(summary) || /malicious code in @/i.test(summary)) return true;
  const nested = input.object || input.content || input.advisory || input.payload;
  if (nested && nested !== input && looksLikeBulkSecurityAdvisory(nested, depth + 1)) return true;
  return false;
}

/**
 * Nested `security_advisory` must carry a GHSA id, malware type, or
 * malicious-package summary — not merely an object-valued field.
 * @param {*} adv
 * @returns {boolean}
 */
function advisoryObjectMatches (adv) {
  if (!adv || typeof adv !== 'object' || Array.isArray(adv)) return false;
  const advId = String(adv.ghsa_id || adv.id || '');
  const advSummary = String(adv.summary || adv.description || '');
  if (GHSA_ID.test(advId)) return true;
  if (String(adv.type || '').toLowerCase() === 'malware') return true;
  if (/malicious code in @/i.test(advSummary)) return true;
  if (/@zalastax\/nolb-/i.test(advSummary)) return true;
  return false;
}

module.exports = {
  looksLikeBulkSecurityAdvisory
};
