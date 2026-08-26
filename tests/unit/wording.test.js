import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The page states what the policy schedule says and what the intake therefore
 * requires. It never decides a claim.
 *
 * That is a promise made to a judge and to a claimant, so it is checked rather
 * than remembered. This guard reads the shipped text of every core module and
 * every fixture and fails on any sentence that announces an outcome.
 *
 * It is deliberately narrow. "A collision claim is covered under Own damage,
 * clause OD-4.1" is a statement about the schedule and stays legal. "Your claim
 * has been approved" is an outcome and does not.
 */

const ROOT = new URL('../../', import.meta.url);

/**
 * Every pattern names its subject. "the change was accepted" is about a patch
 * and is nobody's business here; "the claim was accepted" is an outcome. A guard
 * that fires on innocent prose gets widened by the next person who trips over
 * it, and a widened guard is worth nothing, so it is narrow from the start.
 */
const CLAIM_SUBJECT = '(claim|cover|coverage|payout|settlement|policy)';

const OUTCOME_PHRASES = [
  {
    pattern: new RegExp(`\\b(the |this |your |a )?${CLAIM_SUBJECT} (is|was|has been) (approved|accepted|granted|denied|settled|valid)\\b`, 'i'),
    why: 'announces an outcome on a claim',
  },
  {
    pattern: new RegExp(`\\b(approve|approves|approved|accept|accepts|accepted|deny|denies|denied|settle|settles|settled) (the|this|your|their) ${CLAIM_SUBJECT}\\b`, 'i'),
    why: 'decides a claim',
  },
  { pattern: /\bwe (will )?(pay|approve|accept|settle|reimburse)\b/i, why: 'promises a payment or a decision' },
  { pattern: /\bguaranteed (payout|payment|settlement|cover|coverage)\b/i, why: 'guarantees an outcome' },
  { pattern: /\bpayout of\b/i, why: 'states a payout figure' },
  { pattern: /\bfully compliant\b/i, why: 'claims compliance' },
];

function read(relative) {
  return readFileSync(new URL(relative, ROOT), 'utf8');
}

function shippedTextFiles() {
  const files = [];
  for (const name of readdirSync(new URL('src/core/', ROOT))) {
    if (name.endsWith('.js')) files.push(`src/core/${name}`);
  }
  for (const name of readdirSync(new URL('fixtures/', ROOT))) {
    if (name.endsWith('.json')) files.push(`fixtures/${name}`);
  }
  for (const name of readdirSync(new URL('fixtures/insurers/', ROOT))) {
    if (name.endsWith('.json')) files.push(`fixtures/insurers/${name}`);
  }
  files.push('docs/claim-intake.v1.json');
  return files;
}

test('the shipped text scanned by this guard is the text that actually ships', () => {
  const files = shippedTextFiles();
  assert.ok(files.includes('src/core/coverage.js'), 'the cover module has to be in scope');
  assert.ok(files.includes('src/core/estimate.js'), 'the repair band module has to be in scope');
  assert.ok(files.includes('src/core/claim.js'));
  assert.ok(files.includes('fixtures/insurers/northwind.json'));
  assert.ok(files.includes('fixtures/insurers/kestrel.json'));
  assert.ok(files.length >= 8, `only ${files.length} files were scanned`);
});

test('nothing the page can say announces a decision on a claim', () => {
  const findings = [];
  for (const file of shippedTextFiles()) {
    const source = read(file);
    source.split(/\r?\n/).forEach((line, index) => {
      for (const rule of OUTCOME_PHRASES) {
        if (rule.pattern.test(line)) {
          findings.push(`${file}:${index + 1} ${rule.why}: ${line.trim().slice(0, 100)}`);
        }
      }
    });
  }
  assert.deepEqual(findings, [], `outcome wording reached the shipped text:\n${findings.join('\n')}`);
});

// A guard nobody has seen fail proves nothing.
test('the wording guard fails on a sentence that does announce a decision', () => {
  const planted = [
    'Good news, your claim is approved and we will pay the full amount.',
    'The insurer accepted this claim on 20 August.',
    'A guaranteed payout of 1200 EUR follows.',
  ];
  for (const sentence of planted) {
    const caught = OUTCOME_PHRASES.filter((rule) => rule.pattern.test(sentence));
    assert.ok(caught.length > 0, `the guard let this through: ${sentence}`);
  }
});

// And a guard that fires on ordinary prose gets widened by the next person who
// trips over it, so the innocent sentences are pinned too.
test('the wording guard leaves ordinary prose about patches and pins alone', () => {
  const innocent = [
    'Pinning a field that is already pinned is allowed and changes nothing.',
    'The revision advances on every accepted change.',
    'A collision claim is covered under Own damage, clause OD-4.1.',
    'This section carries no excess, so there is nothing for you to pay towards it.',
    'The patch was accepted and the revision moved to 4.',
  ];
  for (const sentence of innocent) {
    const caught = OUTCOME_PHRASES.filter((rule) => rule.pattern.test(sentence));
    assert.deepEqual(caught.map((rule) => rule.why), [], `the guard fired on: ${sentence}`);
  }
});

// The repair band is triage, not a quote. The disclaimer is what keeps it that
// way, so it is pinned here rather than left to whoever edits the module next.
test('the repair band still ships with its disclaimer', () => {
  const source = read('src/core/estimate.js');
  assert.match(source, /not a quote and not a prediction/i);
  assert.match(source, /triage/i);
});
