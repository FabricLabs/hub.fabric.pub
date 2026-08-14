'use strict';

/**
 * Detect OpenSSF / GHSA bulk malware advisories (e.g. `@zalastax/nolb-*`).
 * Those dumps were ingested as Fabric documents and Internal messages until Hub OOM.
 * @param {*} input metadata, JSON object, UTF-8 string, or Buffer
 * @returns {boolean}
 */
function looksLikeBulkSecurityAdvisory (input) {
  if (input == null) return false;
  if (Buffer.isBuffer(input)) {
    const n = Math.min(input.length, 8192);
    return looksLikeBulkSecurityAdvisory(input.slice(0, n).toString('utf8'));
  }
  if (typeof input === 'string') {
    const s = input.length > 16384 ? input.slice(0, 16384) : input;
    if (/@zalastax\/nolb-/i.test(s)) return true;
    if (/malicious code in @/i.test(s)) return true;
    if (/"security_advisory"\s*:/.test(s) && (
      /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.test(s) ||
      /"type"\s*:\s*"malware"/i.test(s)
    )) return true;
    const trimmed = s.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return looksLikeBulkSecurityAdvisory(JSON.parse(trimmed));
      } catch (_) {
        return false;
      }
    }
    return false;
  }
  if (typeof input !== 'object') return false;
  if (input.security_advisory && typeof input.security_advisory === 'object') return true;
  const summary = String(input.summary || input.title || input.name || '');
  if (input.ghsa_id && /malicious code in @/i.test(summary)) return true;
  if (/@zalastax\/nolb-/i.test(summary) || /malicious code in @/i.test(summary)) return true;
  const nested = input.object || input.content || input.advisory || input.payload;
  if (nested && nested !== input && looksLikeBulkSecurityAdvisory(nested)) return true;
  return false;
}

module.exports = {
  looksLikeBulkSecurityAdvisory
};
