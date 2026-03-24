'use strict';

/**
 * Browser helpers: fetch hub distributed manifest + beacon epoch summary for operator UI.
 * Federation enforcement lives in the hub (sidechain patches, beacon epochs); this module only summarizes public JSON.
 */

/**
 * @returns {Promise<{ manifest: object|null, epoch: object|null, warnings: string[] }>}
 */
async function fetchDistributedHubPolicy () {
  const warnings = [];
  let manifest = null;
  let epoch = null;
  try {
    const [mRes, eRes] = await Promise.all([
      fetch('/services/distributed/manifest', { headers: { Accept: 'application/json' } }),
      fetch('/services/distributed/epoch', { headers: { Accept: 'application/json' } })
    ]);
    if (mRes.ok) {
      try {
        manifest = await mRes.json();
      } catch (_) {
        warnings.push('manifest: invalid JSON');
      }
    } else {
      warnings.push(`manifest: HTTP ${mRes.status}`);
    }
    if (eRes.ok) {
      try {
        epoch = await eRes.json();
      } catch (_) {
        warnings.push('epoch: invalid JSON');
      }
    } else {
      warnings.push(`epoch: HTTP ${eRes.status}`);
    }
  } catch (e) {
    warnings.push(e && e.message ? e.message : String(e));
  }
  return { manifest, epoch, warnings };
}

/**
 * @param {object|null} manifest
 * @returns {{ active: boolean, threshold: number, count: number, validators: string[] }}
 */
function federationSummaryFromManifest (manifest) {
  const f = manifest && manifest.federation;
  const validators = f && Array.isArray(f.validators)
    ? f.validators.filter((v) => typeof v === 'string' && v.trim())
    : [];
  if (!validators.length) {
    return { active: false, threshold: 1, count: 0, validators: [] };
  }
  return {
    active: true,
    threshold: Math.max(1, Number(f.threshold) || 1),
    count: validators.length,
    validators
  };
}

/**
 * @param {object|null} epochJson — body of GET /services/distributed/epoch
 * @returns {{ hasBeacon: boolean, status?: string, epochCount?: number|null, lastWitnessPresent: boolean, signatureCount: number }}
 */
function beaconEpochWitnessDetail (epochJson) {
  const b = epochJson && epochJson.beacon;
  if (!b || typeof b !== 'object') {
    return { hasBeacon: false, lastWitnessPresent: false, signatureCount: 0 };
  }
  const last = b.last;
  const fw = last && last.federationWitness;
  const sigCount = fw && fw.signatures && typeof fw.signatures === 'object'
    ? Object.keys(fw.signatures).filter((k) => fw.signatures[k]).length
    : 0;
  return {
    hasBeacon: true,
    status: typeof b.status === 'string' ? b.status : undefined,
    epochCount: typeof b.epochCount === 'number' ? b.epochCount : null,
    lastWitnessPresent: sigCount > 0,
    signatureCount: sigCount
  };
}

module.exports = {
  fetchDistributedHubPolicy,
  federationSummaryFromManifest,
  beaconEpochWitnessDetail
};
