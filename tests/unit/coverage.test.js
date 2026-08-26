import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkCoverage } from '../../src/core/coverage.js';
import { createClaim, applyPatch } from '../../src/core/claim.js';

const FIXTURE_URL = new URL('../../fixtures/demo-collision.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));
const policy = fixture.policy;

function scenario(id) {
  const found = fixture.scenarios.find((s) => s.id === id);
  assert.ok(found, `fixture is missing the "${id}" scenario`);
  return found;
}

function claimFor(id) {
  return createClaim(scenario(id));
}

const RETURN_KEYS = ['covered', 'clause', 'deductible', 'currency', 'reason', 'exclusions'];

test('every answer has the same shape', () => {
  for (const s of fixture.scenarios) {
    const result = checkCoverage(policy, createClaim(s));
    assert.deepEqual(Object.keys(result).sort(), [...RETURN_KEYS].sort(), `scenario ${s.id}`);
    assert.equal(typeof result.covered, 'boolean');
    assert.equal(typeof result.reason, 'string');
    assert.ok(Array.isArray(result.exclusions));
    assert.equal(result.currency, 'EUR');
  }
});

// The fixture states what each scenario should decide. Driving the test from
// that block means editing a scenario without editing its expectation fails.
test('every scenario decides the way the fixture says it does', () => {
  for (const s of fixture.scenarios) {
    const result = checkCoverage(policy, createClaim(s));
    assert.equal(result.covered, s.expect.covered, `scenario ${s.id} covered`);
    assert.equal(result.clause, s.expect.clause, `scenario ${s.id} clause`);
    assert.equal(result.deductible, s.expect.deductible, `scenario ${s.id} deductible`);
  }
});

test('a collision is covered under own damage with the 250 excess', () => {
  const result = checkCoverage(policy, claimFor('covered-collision'));

  assert.equal(result.covered, true);
  assert.equal(result.clause, 'OD-4.1');
  assert.equal(result.deductible, 250);
  assert.equal(result.currency, 'EUR');
  assert.deepEqual(result.exclusions, [], 'a covered claim has no exclusions to report');
  assert.match(result.reason, /OD-4\.1/);
  assert.match(result.reason, /250/);
});

test('theft is refused, and the answer cites the rider that was never bought', () => {
  const result = checkCoverage(policy, claimFor('uncovered-theft'));

  assert.equal(result.covered, false);
  assert.equal(result.clause, 'TH-7.2');
  assert.equal(result.deductible, null, 'nothing is payable, so there is no excess to quote');
  assert.equal(result.exclusions.length, 1);
  assert.equal(result.exclusions[0].code, 'rider_not_purchased');
  assert.equal(result.exclusions[0].clause, 'TH-7.2');
  assert.match(result.reason, /TH-7\.2/);
  assert.match(result.reason, /not (added|covered)/i);
});

test('an excluded driver is refused, and that beats a section that would have paid', () => {
  const result = checkCoverage(policy, claimFor('excluded-driver'));

  // Same incident type as the covered collision. Only the driver differs.
  assert.equal(claimFor('excluded-driver').incident_type, 'collision');
  assert.equal(result.covered, false);
  assert.equal(result.clause, 'EX-9.1');
  assert.equal(result.deductible, null);
  assert.equal(result.exclusions[0].code, 'excluded_driver');
  assert.match(result.reason, /EX-9\.1/);
});

test('the excluded driver is matched whatever the casing and spacing', () => {
  const base = claimFor('covered-collision');
  for (const spelling of ['Nikos P.', 'nikos p.', '  NIKOS P.  ']) {
    const { claim, ok } = applyPatch(base, 'driver', spelling);
    assert.equal(ok, true);
    const result = checkCoverage(policy, claim);
    assert.equal(result.covered, false, `"${spelling}" should still be the excluded driver`);
    assert.equal(result.clause, 'EX-9.1');
  }
});

test('a glass claim is covered with no excess, which is not the same as no cover', () => {
  const result = checkCoverage(policy, claimFor('glass-zero-excess'));

  assert.equal(result.covered, true);
  assert.equal(result.clause, 'GL-2.3');
  assert.equal(result.deductible, 0);
  assert.notEqual(result.deductible, null, 'zero excess and no cover must not look alike');
  assert.match(result.reason, /no excess/i);
});

test('an incident before cover started is refused on the date alone', () => {
  const result = checkCoverage(policy, claimFor('outside-policy-period'));

  assert.equal(result.covered, false);
  assert.equal(result.clause, 'PL-1.2');
  assert.equal(result.exclusions[0].code, 'outside_policy_period');
  assert.match(result.reason, /2026-01-01/);
  assert.match(result.reason, /2026-12-31/);
});

test('an excluded driver and a lapsed date both report, and the driver leads', () => {
  let claim = claimFor('outside-policy-period');
  claim = applyPatch(claim, 'driver', 'Nikos P.').claim;

  const result = checkCoverage(policy, claim);
  assert.equal(result.covered, false);
  assert.equal(result.clause, 'EX-9.1', 'the driver exclusion is the headline');
  assert.equal(result.exclusions.length, 2, 'both reasons should be reported, not just the first');
  assert.deepEqual(
    result.exclusions.map((e) => e.code),
    ['excluded_driver', 'outside_policy_period'],
  );
});

test('with no incident type there is no decision to give', () => {
  const claim = createClaim({ policy });
  const result = checkCoverage(policy, claim);

  assert.equal(result.covered, false);
  assert.equal(result.clause, null, 'no clause decided this, because nothing was decided');
  assert.equal(result.deductible, null);
  assert.deepEqual(result.exclusions, []);
  assert.match(result.reason, /incident type/i);
});

test('every incident type the model allows resolves to a section of this policy', () => {
  // A type that matches nothing would be a silent hole in the policy table.
  const base = claimFor('covered-collision');
  for (const type of ['collision', 'theft', 'glass', 'weather', 'fire', 'vandalism']) {
    const { claim } = applyPatch(base, 'incident_type', type);
    const result = checkCoverage(policy, claim);
    assert.ok(result.clause, `${type} resolved to no clause at all`);
  }
});

test('a refusal still points out that third party liability stays in force', () => {
  const result = checkCoverage(policy, claimFor('uncovered-theft'));
  assert.match(result.reason, /TP-1\.1/);
});

test('checkCoverage is deterministic', () => {
  const claim = claimFor('covered-collision');
  assert.deepEqual(checkCoverage(policy, claim), checkCoverage(policy, claim));
});

test('checkCoverage does not touch the policy or the claim', () => {
  const claim = claimFor('covered-collision');
  const policyBefore = JSON.stringify(policy);
  const claimBefore = JSON.stringify(claim);

  checkCoverage(policy, claim);

  assert.equal(JSON.stringify(policy), policyBefore);
  assert.equal(JSON.stringify(claim), claimBefore);
});

test('checkCoverage refuses to guess when an argument is missing', () => {
  assert.throws(() => checkCoverage(null, claimFor('covered-collision')), TypeError);
  assert.throws(() => checkCoverage(policy, null), TypeError);
});
