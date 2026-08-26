import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadPolicyPack, coverFacts, describePack, PACK_CONTRACT } from '../../src/core/policy.js';
import { checkCoverage } from '../../src/core/coverage.js';
import { createClaim } from '../../src/core/claim.js';

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

const fixture = readJson('../../fixtures/demo-collision.json');
const northwindRaw = readJson('../../fixtures/insurers/northwind.json');
const kestrelRaw = readJson('../../fixtures/insurers/kestrel.json');

const northwind = loadPolicyPack(northwindRaw);
const kestrel = loadPolicyPack(kestrelRaw);

function claimFor(id) {
  return createClaim(fixture.scenarios.find((scenario) => scenario.id === id));
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

test('both shipped packs load and declare the contract this build reads', () => {
  for (const pack of [northwind, kestrel]) {
    assert.equal(pack.contract, PACK_CONTRACT);
    assert.ok(pack.id.length > 0);
    assert.ok(pack.insurer.length > 0);
    assert.ok(pack.coverages.length > 0);
    assert.ok(pack.requirements.length > 0);
  }
  assert.notEqual(northwind.id, kestrel.id);
});

test('the demo fixture names a pack that exists', () => {
  const ids = fixture.available_packs.map((entry) => entry.id);
  assert.ok(ids.includes(fixture.insurer_pack), 'the fixture points at a pack nobody ships');
  assert.deepEqual(ids.sort(), [kestrel.id, northwind.id].sort());
});

test('a loaded pack is frozen, so a tool cannot edit the insurer rules at runtime', () => {
  assert.throws(() => {
    northwind.coverages[0].deductible = 0;
  }, TypeError);
  assert.equal(northwind.coverages[0].deductible, 250);
});

test('a pack that is not usable throws, naming what is wrong', () => {
  const base = () => JSON.parse(JSON.stringify(northwindRaw));

  assert.throws(() => loadPolicyPack(null), /expected a parsed pack object/);
  assert.throws(() => loadPolicyPack({ ...base(), contract: 'claim-intake.v9' }), /contract/);
  assert.throws(() => loadPolicyPack({ ...base(), id: '' }), /id/);
  assert.throws(() => loadPolicyPack({ ...base(), coverages: [] }), /lists no coverages/);

  const noExcess = base();
  delete noExcess.coverages[0].deductible;
  assert.throws(() => loadPolicyPack(noExcess), /active but names no deductible/);

  const twoIds = base();
  twoIds.requirements.push({ ...twoIds.requirements[0] });
  assert.throws(() => loadPolicyPack(twoIds), /used twice/);

  const badWatch = base();
  badWatch.requirements[2].when = { field: 'payout_amount', equals: 1 };
  assert.throws(() => loadPolicyPack(badWatch), /not a claim field/);

  const badTarget = base();
  badTarget.requirements[0].satisfied_by = { field: 'settlement' };
  assert.throws(() => loadPolicyPack(badTarget), /not a claim field/);

  const noTarget = base();
  delete noTarget.requirements[0].satisfied_by;
  assert.throws(() => loadPolicyPack(noTarget), /satisfied_by/);

  const badCondition = base();
  badCondition.requirements[2].when = { field: 'severity', looks_like: 'bad' };
  assert.throws(() => loadPolicyPack(badCondition), /not a condition key/);
});

// ---------------------------------------------------------------------------
// The pack is a drop in for the policy shape coverage.js already reads
// ---------------------------------------------------------------------------

// The demo fixture carries this customer's own schedule, and the pack carries
// the insurer's. They have to agree, or the page and the tools would answer two
// different things about the same cover. This test is what stops them drifting.
test('the northwind pack decides every demo scenario exactly as the fixture policy does', () => {
  for (const scenario of fixture.scenarios) {
    const claim = createClaim(scenario);
    const fromFixture = checkCoverage(fixture.policy, claim);
    const fromPack = checkCoverage(northwind, claim);

    assert.equal(fromPack.covered, fromFixture.covered, `${scenario.id} covered`);
    assert.equal(fromPack.clause, fromFixture.clause, `${scenario.id} clause`);
    assert.equal(fromPack.deductible, fromFixture.deductible, `${scenario.id} deductible`);
    assert.equal(fromPack.currency, fromFixture.currency, `${scenario.id} currency`);
  }
});

// ---------------------------------------------------------------------------
// Swap the pack, and the same claim gets a different answer
// ---------------------------------------------------------------------------

test('the same theft claim is refused by one insurer and covered by the other', () => {
  const claim = claimFor('uncovered-theft');

  const first = checkCoverage(northwind, claim);
  assert.equal(first.covered, false);
  assert.equal(first.clause, 'TH-7.2');
  assert.equal(first.deductible, null);

  const second = checkCoverage(kestrel, claim);
  assert.equal(second.covered, true);
  assert.equal(second.clause, 'TH-3.4');
  assert.equal(second.deductible, 500);
});

test('the same collision carries a different excess under each pack', () => {
  const claim = claimFor('covered-collision');
  assert.equal(checkCoverage(northwind, claim).deductible, 250);
  assert.equal(checkCoverage(kestrel, claim).deductible, 150);
});

test('an excluded driver stops the claim at one insurer and not at the other', () => {
  const claim = claimFor('excluded-driver');
  assert.equal(checkCoverage(northwind, claim).clause, 'EX-9.1');
  assert.equal(checkCoverage(kestrel, claim).covered, true, 'kestrel excludes nobody from driving');
});

test('cover facts read the schedule, and the two schedules do not match', () => {
  const first = coverFacts(northwind);
  const second = coverFacts(kestrel);

  const theftHere = first.find((entry) => entry.code === 'theft');
  const theftThere = second.find((entry) => entry.code === 'theft');
  assert.equal(theftHere.in_force, false);
  assert.equal(theftHere.excess, null, 'a section that is not in force has no excess to state');
  assert.ok(theftHere.note, 'a section that is not in force says why');
  assert.equal(theftThere.in_force, true);
  assert.equal(theftThere.excess, 500);

  const glassHere = first.find((entry) => entry.code === 'glass');
  const glassThere = second.find((entry) => entry.code === 'glass');
  assert.equal(glassHere.excess, 0, 'zero excess is a real answer');
  assert.equal(glassThere.excess, 75);
});

// Nothing in a pack may sound like a decision about a claim. A pack states what
// the schedule says, and that is all it is allowed to say.
test('no pack text claims a claim is approved, accepted or valid', () => {
  const forbidden = /\b(approved|accepted|adjudicat|guaranteed|compliant)\b/i;
  for (const raw of [northwindRaw, kestrelRaw]) {
    assert.ok(!forbidden.test(JSON.stringify(raw)), `${raw.id} reads like a decision on a claim`);
  }
});

test('describePack says which insurer is loaded, in one line', () => {
  const line = describePack(northwind);
  assert.match(line, /Northwind Mutual/);
  assert.match(line, /EUR/);
  assert.ok(line.length < 200);
  assert.notEqual(describePack(kestrel), line);
});

test('coverFacts and describePack refuse anything that is not a pack', () => {
  assert.throws(() => coverFacts(null), TypeError);
  assert.throws(() => coverFacts({}), TypeError);
  assert.throws(() => describePack(undefined), TypeError);
});
