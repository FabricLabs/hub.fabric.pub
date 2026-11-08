'use strict';

/**
 * Signer rules: a match signs, decline wins, an invalid rule asks,
 * and a withdrawal without a cap does not sign.
 * Run: node examples/signer-rules.js
 */

const { validateRules, evaluate, requestFacts } = require('../functions/signerRules');

function fail (message) {
  console.error('[EXAMPLES:SIGNER_RULES]', message);
  process.exitCode = 1;
  throw new Error(message);
}

function rulesOf (list) {
  const checked = validateRules(list);
  if (checked.invalid.length) fail(checked.invalid.map((row) => row.error).join('; '));
  return checked.rules;
}

function main () {
  const message = requestFacts({ scope: 'message' });
  const signed = evaluate(rulesOf([
    { id: 'allow-messages', action: 'sign', scope: 'message', label: 'Allow messages' }
  ]), message);
  if (signed.action !== 'sign' || signed.rule !== 'allow-messages') fail('a matching sign rule should sign');

  const declined = evaluate(rulesOf([
    { id: 'no-messages', action: 'decline', scope: 'message', label: 'No messages' },
    { id: 'allow-messages', action: 'sign', scope: 'message', label: 'Allow messages' }
  ]), message);
  if (declined.action !== 'decline') fail('decline should win over sign');

  const broken = validateRules([
    { id: 'allow-messages', action: 'sign', scope: 'message' },
    { id: 'bad', action: 'sign', scope: 'message', extra: true }
  ]);
  if (!broken.invalid.length) fail('an unknown field should be invalid');
  const asked = evaluate(broken.rules, message, { anyInvalid: true });
  if (asked.action !== 'notify') fail('an invalid rule should fail closed to asking');

  const withdrawal = requestFacts({
    scope: 'federation',
    kind: 'withdrawal',
    amountSats: 1000,
    federationId: 'ab'.repeat(32)
  });
  const uncapped = evaluate(rulesOf([
    { id: 'pay', action: 'sign', scope: 'federation', label: 'Pay' }
  ]), withdrawal);
  if (uncapped.action === 'sign') fail('a withdrawal sign rule needs maxAmountSats');

  console.log('[EXAMPLES:SIGNER_RULES]', 'sign', signed.rule);
  console.log('[EXAMPLES:SIGNER_RULES]', 'decline', declined.rule);
  console.log('[EXAMPLES:SIGNER_RULES]', 'invalid', asked.action);
  console.log('[EXAMPLES:SIGNER_RULES]', 'uncapped withdrawal', uncapped.action);
}

main();
