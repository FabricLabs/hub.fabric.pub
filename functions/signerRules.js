'use strict';

/**
 * @fileoverview Signer rules: what the Hub signs for its linked signers
 * without asking (pure; `services/signerRules.js` keeps them and their counters).
 *
 * A rule is `{ id, enabled, action, label, scope, from, origins, federations,
 * networks, maxAmountSats, destinations, dailyLimitSats, maxPerHour }`.
 * `action` is `sign` or `decline`; `scope` is a delegation scope (`passport`,
 * `federation`, `message`). The other fields narrow it; an absent field does
 * not. `from` is a list of pubkeys or `identity-linked` (the participants
 * that hold mutual identity grants with this Hub).
 *
 * Fail closed:
 * - a rule with an unknown field or a bad value is invalid and never matches,
 *   and while any rule is invalid nothing is signed without asking (declines
 *   still apply);
 * - a constraint the request cannot answer (an origin on a federation
 *   request, a destination on an invite) does not match;
 * - a `sign` rule covers a federation withdrawal only when it sets
 *   `maxAmountSats`, and never above the Hub's own `maxWithdrawalSats`;
 * - `decline` wins over `sign`; no match means the user is asked.
 */

const RULE_FIELDS = Object.freeze([
  'id', 'enabled', 'action', 'label', 'scope', 'from', 'origins', 'federations',
  'networks', 'maxAmountSats', 'destinations', 'dailyLimitSats', 'maxPerHour'
]);
const ACTIONS = Object.freeze(['sign', 'decline']);
const SCOPES = Object.freeze(['passport', 'federation', 'message']);
const IDENTITY_LINKED = 'identity-linked';
const NETWORKS = Object.freeze(['mainnet', 'testnet', 'signet', 'regtest']);
const MAX_RULES = 64;
const MAX_LIST = 64;
const HOUR_MS = 60 * 60 * 1000;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PUBKEY = /^(0[23])?[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{64}$/;

/** @private */
function stringList (value, check, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be a list`);
  if (value.length > MAX_LIST) throw new Error(`${name} has more than ${MAX_LIST} entries`);
  const out = [];
  for (const raw of value) {
    const item = check(String(raw == null ? '' : raw).trim());
    if (!item) throw new Error(`${name} has an invalid entry: ${String(raw).slice(0, 80)}`);
    if (!out.includes(item)) out.push(item);
  }
  if (!out.length) throw new Error(`${name} must not be empty (leave it out instead)`);
  return out;
}

/** @private */
function sats (value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number of sats`);
  return n;
}

/** @private */
function origin (value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch (_) {
    return null;
  }
}

/** @private */
function xOnly (value) {
  const hex = String(value || '').trim().toLowerCase();
  return PUBKEY.test(hex) ? hex.slice(-64) : null;
}

/** @private */
function address (value) {
  return /^[a-zA-Z0-9]{14,90}$/.test(value) ? value : null;
}

/**
 * Check one rule and return it normalized.
 * @param {Object} rule
 * @returns {{ ok: true, rule: Object }|{ ok: false, error: string }}
 */
function validateRule (rule) {
  try {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('a rule must be an object');
    const unknown = Object.keys(rule).filter((k) => !RULE_FIELDS.includes(k));
    if (unknown.length) throw new Error(`unknown field ${unknown.join(', ')}`);
    const id = String(rule.id || '').trim().toLowerCase();
    if (!ID.test(id)) throw new Error('id must be 1–64 lowercase letters, digits, or dashes');
    if (!ACTIONS.includes(rule.action)) throw new Error('action must be sign or decline');
    if (!SCOPES.includes(rule.scope)) throw new Error(`scope must be one of ${SCOPES.join(', ')}`);
    const out = { id, enabled: rule.enabled !== false, action: rule.action, scope: rule.scope };
    if (rule.enabled != null && typeof rule.enabled !== 'boolean') throw new Error('enabled must be true or false');
    if (rule.label != null) {
      const label = String(rule.label).trim();
      if (label.length > 120) throw new Error('label is longer than 120 characters');
      if (label) out.label = label;
    }
    if (rule.from != null) {
      out.from = rule.from === IDENTITY_LINKED ? IDENTITY_LINKED : stringList(rule.from, xOnly, 'from');
    }
    if (rule.origins != null) {
      if (rule.scope !== 'passport') throw new Error('origins only apply to passport rules');
      out.origins = stringList(rule.origins, origin, 'origins');
    }
    if (rule.federations != null) {
      if (rule.scope !== 'federation') throw new Error('federations only apply to federation rules');
      out.federations = stringList(rule.federations, (v) => (HEX32.test(v.toLowerCase()) ? v.toLowerCase() : null), 'federations');
    }
    if (rule.networks != null) out.networks = stringList(rule.networks, (v) => (NETWORKS.includes(v.toLowerCase()) ? v.toLowerCase() : null), 'networks');
    for (const name of ['maxAmountSats', 'destinations', 'dailyLimitSats']) {
      if (rule[name] != null && rule.scope !== 'federation') throw new Error(`${name} only applies to federation rules`);
    }
    if (rule.maxAmountSats != null) out.maxAmountSats = sats(rule.maxAmountSats, 'maxAmountSats');
    if (rule.dailyLimitSats != null) out.dailyLimitSats = sats(rule.dailyLimitSats, 'dailyLimitSats');
    if (rule.destinations != null) out.destinations = stringList(rule.destinations, address, 'destinations');
    if (rule.maxPerHour != null) {
      const n = Number(rule.maxPerHour);
      if (!Number.isSafeInteger(n) || n <= 0 || n > 10000) throw new Error('maxPerHour must be a whole number from 1 to 10000');
      out.maxPerHour = n;
    }
    return { ok: true, rule: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Check a whole rule list. Ids must be unique.
 * @param {Array<Object>} list
 * @returns {{ rules: Array<Object>, invalid: Array<{ index: number, id: (string|null), error: string }> }}
 */
function validateRules (list) {
  const rules = [];
  const invalid = [];
  const items = Array.isArray(list) ? list : [];
  if (items.length > MAX_RULES) invalid.push({ index: MAX_RULES, id: null, error: `at most ${MAX_RULES} rules` });
  const seen = new Set();
  items.slice(0, MAX_RULES).forEach((raw, index) => {
    const checked = validateRule(raw);
    const id = raw && typeof raw === 'object' && raw.id != null ? String(raw.id) : null;
    if (!checked.ok) return invalid.push({ index, id, error: checked.error });
    if (seen.has(checked.rule.id)) return invalid.push({ index, id, error: 'duplicate id' });
    seen.add(checked.rule.id);
    rules.push(checked.rule);
  });
  return { rules, invalid };
}

/**
 * What a request asks, in the terms rules speak.
 * @param {Object} input
 * @param {string} input.scope
 * @param {string} [input.from] Requester pubkey.
 * @param {string} [input.origin] Site of a Passport sign-in.
 * @param {string} [input.federationId]
 * @param {string} [input.kind] `invite` | `withdrawal` for federation requests.
 * @param {string} [input.network]
 * @param {number} [input.amountSats]
 * @param {string} [input.destination]
 * @returns {Object}
 */
function requestFacts (input = {}) {
  return {
    scope: String(input.scope || ''),
    from: xOnly(input.from),
    origin: input.origin ? origin(String(input.origin)) : null,
    federationId: input.federationId ? String(input.federationId).toLowerCase() : null,
    kind: input.kind || null,
    network: input.network ? String(input.network).toLowerCase() : null,
    amountSats: Number.isSafeInteger(Number(input.amountSats)) && Number(input.amountSats) > 0 ? Number(input.amountSats) : null,
    destination: input.destination ? String(input.destination).trim() : null
  };
}

/**
 * Facts for a delegation request read by `@fabric/core/functions/delegation` `readRequest`.
 * @param {Object} read
 * @param {Object} [context]
 * @param {Function} [context.networkOf] `(federationId) => network` for withdrawals.
 * @returns {Object}
 */
function factsForRequest (read, context = {}) {
  const base = { scope: read.scope, from: read.request.requester };
  if (read.scope === 'passport') {
    return requestFacts(Object.assign(base, { origin: read.inner.challenge.origin, network: read.inner.network }));
  }
  if (read.scope === 'federation') {
    const body = read.inner.body || {};
    const withdrawal = body.type === 'FederationWithdrawalRequest';
    let network = read.inner.network;
    if (!network && typeof context.networkOf === 'function') {
      try { network = context.networkOf(body.federationId); } catch (_) { network = null; }
    }
    return requestFacts(Object.assign(base, {
      federationId: body.federationId,
      kind: withdrawal ? 'withdrawal' : 'invite',
      network,
      amountSats: withdrawal ? body.amountSats : null,
      destination: withdrawal ? body.destinationAddress : null
    }));
  }
  return requestFacts(base);
}

/** @private */
function matches (rule, facts, context) {
  if (!rule.enabled || rule.scope !== facts.scope) return false;
  if (rule.from === IDENTITY_LINKED) {
    if (!facts.from || !context.identityPeers.has(facts.from)) return false;
  } else if (rule.from && !(facts.from && rule.from.includes(facts.from))) {
    return false;
  }
  if (rule.origins && !(facts.origin && rule.origins.includes(facts.origin))) return false;
  if (rule.federations && !(facts.federationId && rule.federations.includes(facts.federationId))) return false;
  if (rule.networks && !(facts.network && rule.networks.includes(facts.network))) return false;
  if (rule.destinations && !(facts.destination && rule.destinations.includes(facts.destination))) return false;
  if (rule.maxAmountSats != null && facts.amountSats != null && facts.amountSats > rule.maxAmountSats) return false;
  return true;
}

/** @private Limits a `sign` rule must also stay within. */
function withinLimits (rule, facts, context) {
  if (facts.kind === 'withdrawal') {
    if (rule.maxAmountSats == null || facts.amountSats == null) return false;
    if (context.maxWithdrawalSats != null && facts.amountSats > context.maxWithdrawalSats) return false;
  }
  const usage = context.usage(rule.id) || {};
  if (rule.dailyLimitSats != null && facts.amountSats != null) {
    if ((usage.daySats || 0) + facts.amountSats > rule.dailyLimitSats) return false;
  }
  if (rule.maxPerHour != null && (usage.hourCount || 0) >= rule.maxPerHour) return false;
  return true;
}

/**
 * Decide a request.
 * @param {Array<Object>} rules Valid rules (from {@link validateRules}).
 * @param {Object} facts From {@link requestFacts} / {@link factsForRequest}.
 * @param {Object} [context]
 * @param {Iterable<string>} [context.identityPeers] Pubkeys of identity-linked participants.
 * @param {Function} [context.usage] `(ruleId) => ({ daySats, hourCount })`.
 * @param {number} [context.maxWithdrawalSats] The Hub's hard cap.
 * @param {boolean} [context.anyInvalid] Some stored rule did not validate: sign nothing.
 * @returns {{ action: string, rule: (string|undefined), reason: (string|undefined) }}
 */
function evaluate (rules, facts, context = {}) {
  const ctx = {
    identityPeers: new Set([...(context.identityPeers || [])].map(xOnly).filter(Boolean)),
    usage: typeof context.usage === 'function' ? context.usage : () => ({}),
    maxWithdrawalSats: context.maxWithdrawalSats != null ? Number(context.maxWithdrawalSats) : null
  };
  const live = (Array.isArray(rules) ? rules : []).filter((r) => r && r.enabled !== false);
  const decline = live.find((r) => r.action === 'decline' && matches(r, facts, ctx));
  if (decline) return { action: 'decline', rule: decline.id, reason: `declined by rule ${decline.label || decline.id}` };
  if (context.anyInvalid) return { action: 'notify', reason: 'a signer rule is invalid' };
  const sign = live.find((r) => r.action === 'sign' && matches(r, facts, ctx) && withinLimits(r, facts, ctx));
  if (sign) return { action: 'sign', rule: sign.id };
  return { action: 'notify' };
}

/**
 * The usage a rule has left in the window ending at `now`.
 * @param {Object} counter `{ day, daySats, hours: number[] }`
 * @param {number} now
 * @returns {{ daySats: number, hourCount: number }}
 */
function usageAt (counter, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const c = counter || {};
  return {
    daySats: c.day === day ? Number(c.daySats) || 0 : 0,
    hourCount: (Array.isArray(c.hours) ? c.hours : []).filter((t) => now - t < HOUR_MS).length
  };
}

/**
 * Add one signed request to a rule's counter.
 * @param {Object} counter
 * @param {Object} facts
 * @param {number} now
 * @returns {Object} The new counter.
 */
function countUse (counter, facts, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const used = usageAt(counter, now);
  const hours = (counter && Array.isArray(counter.hours) ? counter.hours : []).filter((t) => now - t < HOUR_MS);
  hours.push(now);
  return { day, daySats: used.daySats + (facts.amountSats || 0), hours };
}

module.exports = {
  RULE_FIELDS,
  ACTIONS,
  SCOPES,
  IDENTITY_LINKED,
  MAX_RULES,
  validateRule,
  validateRules,
  requestFacts,
  factsForRequest,
  evaluate,
  usageAt,
  countUse
};
