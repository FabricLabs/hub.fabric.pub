'use strict';

const { MULBERRY32_A, UINT32_MAX_PLUS_ONE } = require('../constants');
const { formatSimulationRevenueAsciiGraph } = require('./playnetAsciiFeeGraph');

/**
 * Pure ledger simulation: N operators, random publish/distribute rounds, stochastic host acceptance.
 * Models pay-to-distribute style transfers (publisher pays; hosts that accept earn a net fee).
 * No Hub process — used by tests to show that under mild assumptions, servicing the network yields profit
 * for a non-empty subset of hosts (Markov / game-theory style ergodic reward).
 */

function mulberry32 (a) {
  return function () {
    let t = (a += MULBERRY32_A);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_MAX_PLUS_ONE;
  };
}

function pickDistinct (rng, n, count, exclude) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    if (i !== exclude) pool.push(i);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * @param {object} [opts]
 * @param {number} [opts.nodeCount] — clamped to [5, 15]
 * @param {number} [opts.rounds]
 * @param {number} [opts.seed]
 * @param {number} [opts.initialSatsPerNode]
 * @param {number} [opts.offerSats] — paid by publisher to each host that accepts
 * @param {number} [opts.acceptProbability] — Bernoulli host acceptance
 * @param {number} [opts.protocolFeeRate] — fraction of offer burned (remainder to host)
 * @param {number} [opts.federationValidatorCount] — treat node indexes `[0..count-1]` as **federation** cohort for
 *   reporting (default ~⅓ of operators, at least 1, leaving ≥1 **normal** peer when n≥6). Override with env
 *   `FABRIC_PLAYNET_SIM_FEDERATION_COUNT` when passed through tests.
 */
function runPlaynetMarketSimulation (opts = {}) {
  const nodeCount = Math.max(5, Math.min(15, Number(opts.nodeCount) || 7));
  const rounds = Math.max(20, Number(opts.rounds) || 120);
  const seed = Number(opts.seed) || 1;
  const initialSatsPerNode = Math.max(1000, Number(opts.initialSatsPerNode) || 80_000);
  const offerSats = Math.max(100, Number(opts.offerSats) || 10_000);
  const acceptProbability = Math.min(0.95, Math.max(0.05, Number(opts.acceptProbability) || 0.42));
  const protocolFeeRate = Math.min(0.5, Math.max(0, Number(opts.protocolFeeRate) || 0.08));
  const envFed = Number(process.env.FABRIC_PLAYNET_SIM_FEDERATION_COUNT);
  let federationValidatorCount = Number.isFinite(Number(opts.federationValidatorCount))
    ? Math.max(1, Math.min(nodeCount - 1, Number(opts.federationValidatorCount)))
    : NaN;
  if (!Number.isFinite(federationValidatorCount)) {
    federationValidatorCount = Number.isFinite(envFed) && envFed > 0
      ? Math.max(1, Math.min(nodeCount - 1, Math.floor(envFed)))
      : Math.max(1, Math.min(nodeCount - 2, Math.max(1, Math.floor(nodeCount / 3))));
  }
  if (nodeCount >= 6 && federationValidatorCount > nodeCount - 2) {
    federationValidatorCount = nodeCount - 2;
  }
  if (federationValidatorCount < 1) federationValidatorCount = 1;

  const rng = mulberry32(seed >>> 0);
  const balances = Array(nodeCount).fill(initialSatsPerNode);
  const initial = balances.slice();
  let successfulContracts = 0;
  /** @type {{ publisher: number, host: number, offerSats: number, feeSats: number, bytes: number, satPerByte: number }[]} */
  const deals = [];
  const publishingSpend = Array(nodeCount).fill(0);
  const hostingGross = Array(nodeCount).fill(0);
  const protocolFeesBurned = Array(nodeCount).fill(0);
  const bytesHosted = Array(nodeCount).fill(0);
  let totalFeeSats = 0;

  for (let r = 0; r < rounds; r++) {
    const publisher = Math.floor(rng() * nodeCount);
    const hostSlots = 1 + Math.floor(rng() * Math.min(4, nodeCount - 1));
    const hosts = pickDistinct(rng, nodeCount, hostSlots, publisher);
    let gross = 0;
    for (const h of hosts) {
      if (rng() < acceptProbability) {
        if (balances[publisher] < offerSats) break;
        const bytes = randomPayloadBytes(rng);
        const satPerByte = bytes > 0 ? offerSats / bytes : 0;
        balances[publisher] -= offerSats;
        publishingSpend[publisher] += offerSats;
        const fee = Math.floor(offerSats * protocolFeeRate);
        const toHost = offerSats - fee;
        balances[h] += toHost;
        hostingGross[h] += toHost;
        protocolFeesBurned[publisher] += fee;
        totalFeeSats += fee;
        bytesHosted[h] += bytes;
        deals.push({ publisher, host: h, offerSats, feeSats: fee, bytes, satPerByte });
        gross += offerSats;
      }
    }
    if (gross > 0) successfulContracts += 1;
  }

  const profit = balances.map((b, i) => b - initial[i]);
  const profitableIdx = profit
    .map((p, i) => (p > 0 ? i : -1))
    .filter((i) => i >= 0);
  const maxProfit = Math.max(...profit);
  const minProfit = Math.min(...profit);

  const totalBytes = bytesHosted.reduce((a, b) => a + b, 0);
  const dealByteSum = deals.reduce((s, d) => s + d.bytes, 0);
  const dealOfferSum = deals.reduce((s, d) => s + d.offerSats, 0);
  const aggregateSatPerByte = dealByteSum > 0 ? dealOfferSum / dealByteSum : 0;
  /** Arithmetic mean of (offerSats/bytes) per deal leg — not byte-weighted */
  const meanSatPerBytePerDeal =
    deals.length > 0 ? deals.reduce((s, d) => s + d.offerSats / Math.max(1, d.bytes), 0) / deals.length : 0;

  const federationIndexes = [];
  for (let i = 0; i < federationValidatorCount; i++) federationIndexes.push(i);
  const normalUserIndexes = [];
  for (let i = federationValidatorCount; i < nodeCount; i++) normalUserIndexes.push(i);

  function cohortStats (indexes) {
    const idx = indexes;
    const count = idx.length;
    let totalProfitSats = 0;
    let totalHostingReceiptSats = 0;
    let totalPublishingSpendSats = 0;
    let profitableCount = 0;
    for (const i of idx) {
      totalProfitSats += profit[i];
      totalHostingReceiptSats += hostingGross[i];
      totalPublishingSpendSats += publishingSpend[i];
      if (profit[i] > 0) profitableCount++;
    }
    const meanProfitSats =
      count > 0 ? Math.round((totalProfitSats / count) * 1e6) / 1e6 : 0;
    return {
      count,
      indexes: idx.slice(),
      totalProfitSats,
      meanProfitSats,
      profitableCount,
      totalHostingReceiptSats,
      totalPublishingSpendSats
    };
  }

  const cohortFederation = cohortStats(federationIndexes);
  const cohortNormal = cohortStats(normalUserIndexes);
  const cohortProfitDifferenceSats = cohortFederation.totalProfitSats - cohortNormal.totalProfitSats;

  const perNode = [];
  for (let i = 0; i < nodeCount; i++) {
    const ret = initial[i] > 0 ? (profit[i] / initial[i]) * 100 : 0;
    const cohort = i < federationValidatorCount ? 'federation' : 'normal';
    perNode.push({
      index: i,
      cohort,
      initialSats: initial[i],
      finalSats: balances[i],
      profitSats: profit[i],
      returnPct: Math.round(ret * 100) / 100,
      publishingSpendSats: publishingSpend[i],
      hostingReceiptSats: hostingGross[i],
      protocolFeeAttributedSats: protocolFeesBurned[i],
      bytesHosted: bytesHosted[i],
      impliedSatPerByteHosted: bytesHosted[i] > 0 ? Math.round((hostingGross[i] / bytesHosted[i]) * 1e9) / 1e9 : null
    });
  }

  return {
    nodeCount,
    rounds,
    initialSatsPerNode,
    offerSats,
    acceptProbability,
    protocolFeeRate,
    successfulContracts,
    dealCount: deals.length,
    balances,
    profit,
    profitableNodeIndexes: profitableIdx,
    maxProfit,
    minProfit,
    someNodeProfited: profitableIdx.length > 0,
    wealthGiniApprox: gini(balances),
    totalBytesHosted: totalBytes,
    totalProtocolFeesSats: totalFeeSats,
    // Σ offerSats / Σ bytes across deal legs
    aggregateSatPerByte: Math.round(aggregateSatPerByte * 1e12) / 1e12,
    // Legacy key: mean of (offer/bytes) per deal; prefer meanSatPerBytePerDeal
    avgSatPerByteWeightedByDeal: Math.round(meanSatPerBytePerDeal * 1e12) / 1e12,
    meanSatPerBytePerDeal: Math.round(meanSatPerBytePerDeal * 1e12) / 1e12,
    federationValidatorCount,
    federationIndexes,
    normalUserIndexes,
    cohortFederation,
    cohortNormal,
    cohortProfitDifferenceSats,
    perNode,
    dealsSample: deals.slice(0, 12),
    /** Full deal legs for reporting / charts (can be large if rounds is huge). */
    deals
  };
}

/** Log-uniform-ish payload 1 KiB … 64 KiB for sat/byte spread */
function randomPayloadBytes (rng) {
  const lo = 1024;
  const hi = 64 * 1024;
  const t = rng();
  return Math.floor(lo + t * (hi - lo));
}

function gini (values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  if (sum === 0) return 0;
  let num = 0;
  for (let i = 0; i < n; i++) num += (2 * (i + 1) - n - 1) * sorted[i];
  return num / (n * sum);
}

/**
 * Human-readable report for stdout (Mocha / CI). Set FABRIC_PLAYNET_REPORT=0 to skip printing from tests.
 * @param {ReturnType<typeof runPlaynetMarketSimulation>} out
 */
function formatPlaynetSimulationReport (out) {
  if (!out || !out.perNode) return '';
  const lines = [];
  lines.push('');
  lines.push('======== PLAYNET MARKET SIMULATION — FINAL REPORT ========');
  lines.push(`Operators: ${out.nodeCount}  |  Rounds: ${out.rounds}  |  Flat offer: ${out.offerSats} sats/deal`);
  lines.push(`Accept probability: ${out.acceptProbability}  |  Protocol fee rate: ${(out.protocolFeeRate * 100).toFixed(1)}% of offer`);
  lines.push(`Rounds with ≥1 acceptance: ${out.successfulContracts}  |  Total deal legs: ${out.dealCount}`);
  lines.push(`Total bytes attributed to hosted payloads: ${out.totalBytesHosted.toLocaleString()} B`);
  lines.push(`Total protocol fees (burned from offers): ${out.totalProtocolFeesSats.toLocaleString()} sats`);
  lines.push(
    `Sat/byte — aggregate (Σ offer / Σ payload bytes): ${out.aggregateSatPerByte}  |  mean per deal leg: ${out.meanSatPerBytePerDeal ?? out.avgSatPerByteWeightedByDeal}`
  );
  lines.push(`Wealth Gini (0=equal): ${out.wealthGiniApprox.toFixed(4)}  |  Profitable node indexes: [${out.profitableNodeIndexes.join(', ')}]`);
  if (out.cohortFederation && out.cohortNormal) {
    const cf = out.cohortFederation;
    const cn = out.cohortNormal;
    lines.push('--- Cohort: federation validators vs normal operators (same simulation; indexes 0..F-1 = federation) ---');
    lines.push(
      `Federation cohort: |F|=${cf.count} nodes [${cf.indexes.join(', ')}]  |  Σ profit ${cf.totalProfitSats.toLocaleString()} sats (mean ${cf.meanProfitSats})  |  profitable ${cf.profitableCount}/${cf.count}`
    );
    lines.push(
      `  hosting receipts Σ ${cf.totalHostingReceiptSats.toLocaleString()} sats  |  publish spend Σ ${cf.totalPublishingSpendSats.toLocaleString()} sats`
    );
    lines.push(
      `Normal cohort: |N|=${cn.count} nodes [${cn.indexes.join(', ')}]  |  Σ profit ${cn.totalProfitSats.toLocaleString()} sats (mean ${cn.meanProfitSats})  |  profitable ${cn.profitableCount}/${cn.count}`
    );
    lines.push(
      `  hosting receipts Σ ${cn.totalHostingReceiptSats.toLocaleString()} sats  |  publish spend Σ ${cn.totalPublishingSpendSats.toLocaleString()} sats`
    );
    const diff = out.cohortProfitDifferenceSats;
    lines.push(
      `Difference (federation Σ profit − normal Σ profit): ${diff.toLocaleString()} sats  ${diff > 0 ? '(federation ahead on net balance change)' : diff < 0 ? '(normal operators ahead)' : '(tie)'}`
    );
  }
  lines.push('--- Per-node balances, flows, returns (tag: fed = federation index, usr = normal) ---');
  lines.push(
    ' tag | node | final sats | profit | return% | publish spend | host receipts | fees attrib | bytes hosted | sats/B (host net)'
  );
  for (const row of out.perNode) {
    const spb = row.impliedSatPerByteHosted != null ? String(row.impliedSatPerByteHosted) : '—';
    const tag = row.cohort === 'federation' ? 'fed' : 'usr';
    lines.push(
      [
        tag.padStart(3),
        String(row.index).padStart(4),
        String(row.finalSats).padStart(11),
        String(row.profitSats).padStart(8),
        `${String(row.returnPct).padStart(7)}%`,
        String(row.publishingSpendSats).padStart(14),
        String(row.hostingReceiptSats).padStart(14),
        String(row.protocolFeeAttributedSats).padStart(12),
        String(row.bytesHosted).padStart(13),
        spb
      ].join(' | ')
    );
  }
  if (out.dealsSample && out.dealsSample.length) {
    lines.push('--- Sample deals (publisher → host): offer sats, fee, bytes, sats/byte ---');
    for (const d of out.dealsSample) {
      lines.push(
        `  pub ${d.publisher} → host ${d.host}: ${d.offerSats} sats, fee ${d.feeSats}, ${d.bytes} B, ${d.satPerByte.toFixed(6)} sats/B`
      );
    }
  }
  const legs = Array.isArray(out.deals) ? out.deals : [];
  if (legs.length) {
    const graphPoints = legs.slice(0, 96).map((d) => ({
      offerSatPerByte: d.bytes > 0 ? d.offerSats / d.bytes : 0,
      protocolFeeSatPerByte: d.bytes > 0 ? d.feeSats / d.bytes : 0
    }));
    lines.push(formatSimulationRevenueAsciiGraph(graphPoints));
    const userGross = legs.reduce((s, d) => s + (d.offerSats - d.feeSats), 0);
    lines.push(
      `--- Modelled revenue split (${legs.length} deal legs) — user/host gross (after protocol burn): ${userGross.toLocaleString()} sats | protocol (federation) fees: ${out.totalProtocolFeesSats.toLocaleString()} sats ---`
    );
  }
  lines.push('========================================================');
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  runPlaynetMarketSimulation,
  formatPlaynetSimulationReport,
  mulberry32,
  pickDistinct
};
