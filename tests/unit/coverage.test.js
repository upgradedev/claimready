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

// `provisional` joined this list deliberately. A yes that still depends on who
// was driving is not the same answer as a yes, and a caller that cannot see the
// difference prints a flat COVERED over an undecided question.
const RETURN_KEYS = ['covered', 'clause', 'deductible', 'currency', 'reason', 'exclusions', 'provisional'];

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
    const { claim, ok } = applyPatch(base, { field: 'driver', value: spelling });
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
  claim = applyPatch(claim, { field: 'driver', value: 'Nikos P.' }).claim;

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
    const { claim } = applyPatch(base, { field: 'incident_type', value: type });
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

// ---------------------------------------------------------------------------
// A yes that still depends on who was driving
// ---------------------------------------------------------------------------

const kestrel = JSON.parse(
  readFileSync(new URL('../../fixtures/insurers/kestrel.json', import.meta.url), 'utf8'),
);

function driverless() {
  const claim = createClaim({ policy, claim: {} });
  const typed = applyPatch(claim, { field: 'incident_type', value: 'collision' });
  assert.equal(typed.ok, true);
  const dated = applyPatch(typed.claim, { field: 'incident_date', value: '2026-08-20' });
  assert.equal(dated.ok, true);
  return dated.claim;
}

test('a covered claim with nobody named as the driver is provisional, not a flat yes', () => {
  const result = checkCoverage(policy, driverless());

  assert.equal(result.covered, true, 'the schedule does cover a collision');
  assert.equal(result.provisional, true, 'but naming one particular driver would turn it into a no');
  assert.match(result.reason, /Nobody is named as the driver/);
  assert.match(result.reason, /EX-9\.1/, 'the answer cites the exclusion it depends on');
  assert.match(result.reason, /provisional/);
});

// The discriminating half. Same driverless claim, a schedule with nobody
// excluded: there is nothing left to depend on, so the yes is a plain yes.
test('the same driverless claim is not provisional on a policy that excludes nobody', () => {
  assert.deepEqual(kestrel.excluded_drivers, [], 'this pack has to keep excluding nobody');
  const result = checkCoverage(kestrel, driverless());

  assert.equal(result.covered, true);
  assert.equal(result.provisional, false);
  assert.doesNotMatch(result.reason, /provisional/);
});

test('naming the driver settles it, either way', () => {
  const named = applyPatch(driverless(), { field: 'driver', value: 'Maria K.' });
  assert.equal(named.ok, true);
  const safe = checkCoverage(policy, named.claim);
  assert.equal(safe.covered, true);
  assert.equal(safe.provisional, false, 'the question it depended on has been answered');

  const excluded = applyPatch(driverless(), { field: 'driver', value: 'nikos p.' });
  assert.equal(excluded.ok, true);
  const refused = checkCoverage(policy, excluded.claim);
  assert.equal(refused.covered, false);
  assert.equal(refused.clause, 'EX-9.1');
  assert.equal(refused.provisional, false);
});

// A no cannot be provisional. Nothing the driver field could say turns a rider
// that was never bought, or a date outside the period, into cover.
test('a refusal is never provisional, whoever was driving', () => {
  for (const id of ['uncovered-theft', 'outside-policy-period', 'excluded-driver']) {
    const result = checkCoverage(policy, claimFor(id));
    assert.equal(result.covered, false, id);
    assert.equal(result.provisional, false, `${id} must not be reported as provisional`);
  }
});

test('a claim with no incident type yet is undecided rather than provisional', () => {
  const result = checkCoverage(policy, createClaim({ policy, claim: {} }));
  assert.equal(result.covered, false);
  assert.equal(result.provisional, false);
  assert.match(result.reason, /incident type is not recorded yet/i);
});

// ---------------------------------------------------------------------------
// A yes that has not read the date is not a yes
//
// The driver hole was closed and the same hole in the field beside it was left
// open. findOutsidePeriod answers null on an empty date, which is correct on its
// own terms, so a claim with an incident type and no date printed a flat COVERED
// with a clause and an excess while the schedule had not been asked the one
// question the period clause exists to answer. Typing a date inside the period
// changed nothing; typing one outside it turned the same claim into NOT COVERED.
// ---------------------------------------------------------------------------

/** A claim that names the incident and the driver, and no date. */
function undated() {
  const claim = createClaim({ policy, claim: {} });
  const typed = applyPatch(claim, { field: 'incident_type', value: 'collision' });
  assert.equal(typed.ok, true);
  const named = applyPatch(typed.claim, { field: 'driver', value: 'Maria K.' });
  assert.equal(named.ok, true);
  assert.equal(named.claim.incident_date, null, 'the point of this fixture is the missing date');
  return named.claim;
}

test('a covered claim with no incident date is provisional, not a flat yes', () => {
  const result = checkCoverage(policy, undated());

  assert.equal(result.covered, true, 'the schedule does cover a collision');
  assert.equal(result.provisional, true, 'but a date outside the period would turn it into a no');
  assert.match(result.reason, /No date has been recorded/);
  assert.match(result.reason, /PL-1\.2/, 'the answer cites the period clause it depends on');
  assert.match(result.reason, /provisional/);
});

test('the same undated claim is provisional under the other insurer too', () => {
  const result = checkCoverage(kestrel, undated());
  assert.equal(result.covered, true);
  assert.equal(result.provisional, true);
  assert.match(result.reason, /KP-2\.1/);
});

// The discriminating half. A schedule that states no period cannot be waiting on
// a date, so the same claim gets a plain yes rather than a permanent maybe.
test('an undated claim is not provisional on a policy that states no period', () => {
  const noPeriod = { ...policy };
  delete noPeriod.period;
  const result = checkCoverage(noPeriod, undated());

  assert.equal(result.covered, true);
  assert.equal(result.provisional, false);
  assert.doesNotMatch(result.reason, /provisional/);
});

test('giving the date settles it, either way', () => {
  const inside = applyPatch(undated(), { field: 'incident_date', value: '2026-08-20' });
  assert.equal(inside.ok, true);
  const safe = checkCoverage(policy, inside.claim);
  assert.equal(safe.covered, true);
  assert.equal(safe.provisional, false, 'the question it depended on has been answered');

  const outside = applyPatch(undated(), { field: 'incident_date', value: '2025-11-04' });
  assert.equal(outside.ok, true);
  const refused = checkCoverage(policy, outside.claim);
  assert.equal(refused.covered, false);
  assert.equal(refused.clause, 'PL-1.2');
  assert.equal(refused.provisional, false, 'a no is never provisional');
});

// Both open at once, and both said. One overwriting the other is the easy way to
// write this and it would hide whichever question the code looked at second.
test('a claim missing both the driver and the date names both open questions', () => {
  const claim = createClaim({ policy, claim: {} });
  const typed = applyPatch(claim, { field: 'incident_type', value: 'collision' });
  assert.equal(typed.ok, true);

  const result = checkCoverage(policy, typed.claim);
  assert.equal(result.covered, true);
  assert.equal(result.provisional, true);
  assert.match(result.reason, /Nobody is named as the driver/);
  assert.match(result.reason, /No date has been recorded/);
});
