'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateRule,
  validateRules,
  requestFacts,
  factsForRequest,
  evaluate,
  usageAt,
  countUse,
  IDENTITY_LINKED
} = require('../functions/signerRules');
const SignerRules = require('../services/signerRules');

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const SITE = 'https://goon.vc';
const ADDRESS = 'bcrt1qexampleexampleexampleexample0';
const FED = 'f'.repeat(64);

const signIn = (extra = {}) => Object.assign({ id: 'sites', action: 'sign', scope: 'passport', from: IDENTITY_LINKED, origins: [SITE] }, extra);
const spend = (extra = {}) => Object.assign({ id: 'spend', action: 'sign', scope: 'federation', from: IDENTITY_LINKED, maxAmountSats: 10000, destinations: [ADDRESS] }, extra);
const passportFacts = (extra = {}) => requestFacts(Object.assign({ scope: 'passport', from: ALICE, origin: SITE, network: 'regtest' }, extra));
const withdrawal = (extra = {}) => requestFacts(Object.assign({ scope: 'federation', kind: 'withdrawal', from: ALICE, federationId: FED, network: 'regtest', amountSats: 5000, destination: ADDRESS }, extra));
const ctx = (extra = {}) => Object.assign({ identityPeers: ['02' + ALICE] }, extra);

describe('signer rules (pure)', function () {
  it('refuses unknown fields, bad values, and fields from another scope', function () {
    assert.strictEqual(validateRule(signIn()).ok, true);
    assert.match(validateRule(signIn({ sudo: true })).error, /unknown field sudo/);
    assert.match(validateRule(signIn({ action: 'maybe' })).error, /action/);
    assert.match(validateRule(signIn({ origins: ['ftp://x'] })).error, /origins/);
    assert.match(validateRule(signIn({ origins: ['https://goon.vc/path'] })).error, /origins/, 'an origin, not a page');
    assert.match(validateRule(signIn({ maxAmountSats: 5 })).error, /federation rules/);
    assert.match(validateRule(spend({ origins: [SITE] })).error, /passport rules/);
    assert.match(validateRule(spend({ maxAmountSats: -1 })).error, /positive/);
    assert.match(validateRule(spend({ destinations: [] })).error, /empty/);
    assert.match(validateRule(signIn({ from: ['nothex'] })).error, /from/);
    const { rules, invalid } = validateRules([signIn(), signIn(), { id: 'x' }]);
    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(invalid.map((i) => i.error.slice(0, 9)), ['duplicate', 'action mu']);
  });

  it('signs a sign-in only for a listed site and an identity-linked signer', function () {
    const { rules } = validateRules([signIn()]);
    assert.deepStrictEqual(evaluate(rules, passportFacts(), ctx()), { action: 'sign', rule: 'sites' });
    assert.strictEqual(evaluate(rules, passportFacts({ origin: 'https://evil.example' }), ctx()).action, 'notify');
    assert.strictEqual(evaluate(rules, passportFacts({ from: BOB }), ctx()).action, 'notify');
    assert.strictEqual(evaluate(rules, passportFacts(), ctx({ identityPeers: [] })).action, 'notify');
  });

  it('shares a wallet or cosigner key without asking only when the rule lists it', function () {
    assert.match(validateRule(signIn({ disclose: ['seed'] })).error, /disclose/);
    assert.match(validateRule(spend({ disclose: ['wallet'] })).error, /passport rules/);
    const plain = validateRules([signIn()]).rules;
    assert.strictEqual(evaluate(plain, passportFacts({ disclose: ['wallet'] }), ctx()).action, 'notify', 'a site rule alone shares only the identity');
    assert.strictEqual(evaluate(plain, passportFacts({ disclose: ['cosigner'] }), ctx()).action, 'notify');
    const wallet = validateRules([signIn({ disclose: ['wallet'] })]).rules;
    assert.strictEqual(evaluate(wallet, passportFacts({ disclose: ['wallet'] }), ctx()).action, 'sign');
    assert.strictEqual(evaluate(wallet, passportFacts({ disclose: ['wallet', 'cosigner'] }), ctx()).action, 'notify');
    assert.strictEqual(evaluate(wallet, passportFacts(), ctx()).action, 'sign', 'identity-only sign-ins still match');
    const guard = validateRules([signIn({ disclose: ['wallet', 'cosigner'] }), { id: 'no-keys', action: 'decline', scope: 'passport', disclose: ['cosigner'] }]).rules;
    assert.strictEqual(evaluate(guard, passportFacts({ disclose: ['cosigner'] }), ctx()).action, 'decline');
    assert.strictEqual(evaluate(guard, passportFacts({ disclose: ['wallet'] }), ctx()).action, 'sign');
  });

  it('lets a decline rule win, and signs nothing while a rule is broken', function () {
    const { rules } = validateRules([signIn(), { id: 'no-alice', action: 'decline', scope: 'passport', from: [ALICE] }]);
    assert.strictEqual(evaluate(rules, passportFacts(), ctx()).action, 'decline');
    const ok = validateRules([signIn()]).rules;
    assert.strictEqual(evaluate(ok, passportFacts(), ctx({ anyInvalid: true })).action, 'notify');
    assert.strictEqual(evaluate(rules, passportFacts(), ctx({ anyInvalid: true })).action, 'decline', 'declines still apply');
  });

  it('co-signs a withdrawal only under the rule amount, the Hub cap, and to a listed address', function () {
    const { rules } = validateRules([spend()]);
    assert.strictEqual(evaluate(rules, withdrawal(), ctx()).action, 'sign');
    assert.strictEqual(evaluate(rules, withdrawal({ amountSats: 10001 }), ctx()).action, 'notify');
    assert.strictEqual(evaluate(rules, withdrawal({ destination: 'bcrt1qsomewhereelsesomewhereelse00' }), ctx()).action, 'notify');
    assert.strictEqual(evaluate(rules, withdrawal(), ctx({ maxWithdrawalSats: 4000 })).action, 'notify');
    const open = validateRules([{ id: 'open', action: 'sign', scope: 'federation', from: IDENTITY_LINKED }]).rules;
    assert.strictEqual(evaluate(open, withdrawal(), ctx()).action, 'notify', 'no amount, no withdrawals');
    const invite = requestFacts({ scope: 'federation', kind: 'invite', from: ALICE, federationId: FED, network: 'regtest' });
    assert.strictEqual(evaluate(open, invite, ctx()).action, 'sign', 'but invites, yes');
    assert.strictEqual(evaluate(rules, invite, ctx()).action, 'notify', 'an invite has no destination to match');
    const capped = validateRules([spend({ destinations: undefined })]).rules;
    assert.strictEqual(evaluate(capped, invite, ctx()).action, 'notify', 'an invite has no amount to match');
    assert.strictEqual(evaluate(capped, withdrawal(), ctx()).action, 'sign');
  });

  it('counts a withdrawal\'s fee against the rule, and asks when the fee is unreadable', function () {
    const read = (body) => ({ scope: 'federation', request: { requester: ALICE }, inner: { network: 'regtest', body: Object.assign({ type: 'FederationWithdrawalRequest', federationId: FED, destinationAddress: ADDRESS }, body) } });
    const { rules } = validateRules([spend()]);
    assert.strictEqual(factsForRequest(read({ amountSats: 5000, feeSats: 300 })).amountSats, 5300);
    assert.strictEqual(evaluate(rules, factsForRequest(read({ amountSats: 5000, feeSats: 300 })), ctx()).action, 'sign');
    assert.strictEqual(evaluate(rules, factsForRequest(read({ amountSats: 5000, feeSats: 900000 })), ctx()).action, 'notify', 'a payout under the cap with a fee that drains the vault');
    assert.strictEqual(evaluate(rules, factsForRequest(read({ amountSats: 5000 })), ctx()).action, 'notify');
    assert.strictEqual(evaluate(rules, factsForRequest(read({ amountSats: 5000, feeSats: -1 })), ctx()).action, 'notify');
  });

  it('counts a rule\'s use by day and hour', function () {
    const now = Date.parse('2026-10-30T12:00:00Z');
    let counter = countUse(null, { amountSats: 4000 }, now);
    counter = countUse(counter, { amountSats: 4000 }, now + 1000);
    assert.deepStrictEqual(usageAt(counter, now + 2000), { daySats: 8000, hourCount: 2 });
    assert.deepStrictEqual(usageAt(counter, now + 2 * 3600 * 1000), { daySats: 8000, hourCount: 0 });
    assert.deepStrictEqual(usageAt(counter, now + 24 * 3600 * 1000), { daySats: 0, hourCount: 0 });
    const { rules } = validateRules([spend({ dailyLimitSats: 9000, maxPerHour: 5 })]);
    const usage = () => usageAt(counter, now + 2000);
    assert.strictEqual(evaluate(rules, withdrawal({ amountSats: 1000 }), ctx({ usage })).action, 'sign');
    assert.strictEqual(evaluate(rules, withdrawal({ amountSats: 1001 }), ctx({ usage })).action, 'notify');
  });
});

describe('SignerRules service', function () {
  let dir;
  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signer-rules-'));
  });
  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps rules, counters, and decisions on disk, private to the owner', function () {
    let now = Date.parse('2026-10-30T12:00:00Z');
    const rules = new SignerRules({ dir, now: () => now }).load();
    const listed = rules.set([spend({ dailyLimitSats: 6000 }), { id: 'Bad Id' }]);
    assert.strictEqual(listed.valid.length, 1);
    assert.strictEqual(listed.invalid.length, 1);
    assert.strictEqual(rules.decide(withdrawal(), ctx()).action, 'notify', 'a broken rule stops automatic signing');
    rules.set([spend({ dailyLimitSats: 6000 })]);
    const facts = withdrawal();
    const decision = rules.decide(facts, ctx());
    assert.strictEqual(decision.action, 'sign');
    rules.record(decision, facts, { title: 'Co-sign 5000 sats' });
    assert.strictEqual(rules.decide(withdrawal(), ctx()).action, 'notify', 'the day limit is spent');
    now += 1000;

    const again = new SignerRules({ dir, now: () => now }).load();
    assert.strictEqual(again.list().rules.length, 1);
    assert.strictEqual(again.list().valid[0].usage.daySats, 5000);
    assert.strictEqual(again.decisions(5)[0].title, 'Co-sign 5000 sats');
    const mode = fs.statSync(path.join(dir, SignerRules.FILE)).mode & 0o777;
    assert.strictEqual(mode, 0o600);
  });

  it('counts a reserved sign once, and gives it back when nothing was signed', function () {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const rules = new SignerRules({ dir, now: () => now }).load();
    rules.set([spend({ maxPerHour: 1 })]);
    const facts = withdrawal();
    const decision = rules.decide(facts, ctx());
    const held = rules.reserve(decision, facts);
    assert.strictEqual(rules.decide(withdrawal(), ctx()).action, 'notify', 'a second request sees the reserved use');
    rules.release(held);
    assert.deepStrictEqual(rules.list().valid[0].usage, { daySats: 0, hourCount: 0 });
    assert.strictEqual(rules.decide(withdrawal(), ctx()).action, 'sign');

    const kept = rules.reserve(decision, facts);
    rules.record(decision, facts, {}, kept);
    assert.deepStrictEqual(rules.list().valid[0].usage, { daySats: 5000, hourCount: 1 });
    assert.strictEqual(rules.reserve({ action: 'notify' }, facts), null);
  });

  it('takes nothing when a reservation cannot be saved', function () {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const rules = new SignerRules({ dir, now: () => now }).load();
    rules.set([spend({ maxPerHour: 1 })]);
    const facts = withdrawal();
    const decision = rules.decide(facts, ctx());
    const before = JSON.parse(JSON.stringify(rules._state.usage));
    const save = rules._save;
    rules._save = () => { throw new Error('disk full'); };
    assert.throws(() => rules.reserve(decision, facts), /disk full/);
    rules._save = save;
    assert.deepStrictEqual(rules._state.usage, before);
    assert.deepStrictEqual(rules.list().valid[0].usage, { daySats: 0, hourCount: 0 });
    assert.strictEqual(rules.decide(withdrawal(), ctx()).action, 'sign');
  });

  it('keeps a rule’s earlier uses when a reservation cannot be saved', function () {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const rules = new SignerRules({ dir, now: () => now }).load();
    rules.set([spend({ maxPerHour: 2 })]);
    const facts = withdrawal();
    const decision = rules.decide(facts, ctx());
    rules.record(decision, facts, {}, rules.reserve(decision, facts));
    const before = JSON.parse(JSON.stringify(rules._state.usage));
    const save = rules._save;
    rules._save = () => { throw new Error('disk full'); };
    assert.throws(() => rules.reserve(rules.decide(facts, ctx()), facts), /disk full/);
    rules._save = save;
    assert.deepStrictEqual(rules._state.usage, before);
    assert.deepStrictEqual(rules.list().valid[0].usage, { daySats: 5000, hourCount: 1 });
    assert.strictEqual(rules.decide(withdrawal(), ctx()).action, 'sign');
  });

  it('gives a reservation back once, and never after its rule is removed', function () {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const rules = new SignerRules({ dir, now: () => now }).load();
    rules.set([spend({ maxPerHour: 3 })]);
    const facts = withdrawal();
    const decision = rules.decide(facts, ctx());
    rules.record(decision, facts, {}, rules.reserve(decision, facts));
    const held = rules.reserve(decision, facts);
    rules.release(held);
    rules.release(held);
    assert.deepStrictEqual(rules.list().valid[0].usage, { daySats: 5000, hourCount: 1 }, 'the recorded sign still counts');

    const stale = rules.reserve(decision, facts);
    rules.set([]);
    rules.set([spend({ maxPerHour: 3 })]);
    rules.record(decision, facts, {}, rules.reserve(decision, facts));
    rules.release(stale);
    assert.deepStrictEqual(rules.list().valid[0].usage, { daySats: 5000, hourCount: 1 });
  });

  it('gives back reservations left open by a restart', function () {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const rules = new SignerRules({ dir, now: () => now }).load();
    rules.set([spend({ maxPerHour: 2 })]);
    const facts = withdrawal();
    const decision = rules.decide(facts, ctx());
    rules.record(decision, facts, {}, rules.reserve(decision, facts));
    rules.reserve(decision, facts);
    assert.deepStrictEqual(rules.list().valid[0].usage, { daySats: 10000, hourCount: 2 });

    const restarted = new SignerRules({ dir, now: () => now }).load();
    assert.deepStrictEqual(restarted.list().valid[0].usage, { daySats: 5000, hourCount: 1 }, 'only the recorded sign still counts');
    const again = new SignerRules({ dir, now: () => now }).load();
    assert.deepStrictEqual(again.list().valid[0].usage, { daySats: 5000, hourCount: 1 });
  });

  it('keeps a rule\'s counters while it is broken and fixed again', function () {
    const now = Date.parse('2026-10-30T12:00:00Z');
    const rules = new SignerRules({ dir, now: () => now }).load();
    rules.set([spend({ dailyLimitSats: 6000 })]);
    const facts = withdrawal();
    rules.record(rules.decide(facts, ctx()), facts);
    rules.set([spend({ dailyLimitSats: 6000, sudo: true })]);
    rules.set([spend({ dailyLimitSats: 6000 })]);
    assert.strictEqual(rules.list().valid[0].usage.daySats, 5000);
    assert.strictEqual(rules.decide(withdrawal(), ctx()).action, 'notify', 'the day limit is still spent');
  });
});
