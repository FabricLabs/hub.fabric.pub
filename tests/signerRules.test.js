'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateRule,
  validateRules,
  requestFacts,
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
});
