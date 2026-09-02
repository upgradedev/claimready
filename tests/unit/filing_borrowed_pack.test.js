/**
 * Filing under an insurer this policy is not with.
 *
 * WHAT WAS WRONG. The page can load another insurer's published rules against the same claim. That
 * is the demonstration the entry is built on: the requirements, the clause and the excess all move
 * when the pack does, and nothing was rebuilt between them. The picker says so, in the page's own
 * words, two panels above the File button: "Policy MTR-2026-0417 itself is not with Kestrel
 * Assurance."
 *
 * And then the filing gate read whichever pack was selected. A Northwind claim, with the Kestrel
 * comparison open, filed under Kestrel's intake. The page said one thing and did another, which is
 * the same defect the file gate was written to close, one input further out.
 *
 * The home pack now travels with the decision. `canFile` refuses a borrowed pack with its own code
 * before it looks at fields or requirements, `fileClaim` has no second opinion, and the store
 * carries the home id on the action the same way it carries the pack.
 *
 * The comparison itself is untouched. Requirements, cover and the repair band still answer under
 * the pack you picked, because that is the thing worth seeing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canFile, FILE_CODES } from '../../src/core/filing.js';
import { applyPatch, createClaim, fileClaim } from '../../src/core/claim.js';
import { createStore } from '../../src/core/store.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { deriveRequirements } from '../../src/core/requirements.js';
import { checkCoverage } from '../../src/core/coverage.js';

function pack(name) {
  return loadPolicyPack(JSON.parse(readFileSync(
    new URL(`../../fixtures/insurers/${name}.json`, import.meta.url), 'utf8',
  )));
}

const northwind = pack('northwind');
const kestrel = pack('kestrel');

const HOME = { homePackId: 'northwind' };

/** A collision claim Northwind's intake has nothing left to ask about. */
function settledCollision() {
  const result = applyPatch(
    createClaim({ policy: { id: 'MTR-2026-0417' } }),
    [
      { field: 'incident_date', value: '2026-08-20' },
      { field: 'incident_type', value: 'collision' },
      { field: 'damage_zone', value: 10 },
      { field: 'severity', value: 'dent' },
      { field: 'vehicle_drivable', value: true },
      { field: 'description', value: 'A delivery van reversed into the left front wing.' },
    ],
  );
  assert.equal(result.ok, true, `the draft must apply: ${result.error}`);
  return result.claim;
}

/* ------------------------------------------------------------------ 1. the home pack still files */

test('the policy\'s own insurer files a complete claim', () => {
  const decision = canFile(northwind, settledCollision(), [], HOME);

  assert.equal(decision.ok, true);
  assert.equal(decision.code, null);
  assert.equal(decision.borrowed, false);
});

/* ------------------------------------------------------------- 2. the borrowed pack cannot file */

test('a complete claim is refused while another insurer\'s rules are loaded', () => {
  const decision = canFile(kestrel, settledCollision(), [], HOME);

  assert.equal(decision.ok, false);
  assert.equal(decision.code, FILE_CODES.borrowedRules);
  assert.equal(decision.borrowed, true);
  assert.match(decision.reason, /Kestrel Assurance/);
  assert.match(decision.reason, /not with/);
});

test('the refusal is about whose rules these are, not about what is missing', () => {
  // The draft is complete and Kestrel's own intake has one thing open on it, the witness. Neither
  // is the reason, and the sentence must not send a claimant off to answer questions for a pack
  // that was never going to file anything.
  const decision = canFile(kestrel, settledCollision(), [], HOME);

  assert.equal(decision.missing.length, 0);
  assert.ok(decision.outstanding.length > 0, 'Kestrel asks a collision claimant for a witness');
  assert.doesNotMatch(decision.reason, /witness/i);
});

/* ------------------------------------------- 3 and 4. no state moves, through either entry point */

test('filing through the domain under borrowed rules changes nothing', () => {
  const claim = settledCollision();
  const before = JSON.stringify(claim);

  const result = fileClaim(claim, { pack: kestrel, completedHumanActions: [], homePackId: 'northwind' });

  assert.equal(result.ok, false);
  assert.equal(result.code, FILE_CODES.borrowedRules);
  assert.equal(result.claim.status, 'draft');
  assert.equal(result.revision, claim.revision);
  assert.equal(JSON.stringify(claim), before, 'the claim handed in is not mutated');
});

test('filing through the store under borrowed rules changes nothing', () => {
  const store = createStore({ claim: settledCollision() });
  const before = store.getState().claim;

  const result = store.dispatch({
    type: 'file',
    at: '2026-08-31T10:00:00.000Z',
    pack: kestrel,
    completedHumanActions: [],
    homePackId: 'northwind',
  });

  const after = store.getState().claim;
  assert.equal(result.ok, false);
  assert.equal(result.code, FILE_CODES.borrowedRules);
  assert.equal(after.status, 'draft');
  assert.equal(after.revision, before.revision, 'a refused filing does not move the revision');
  assert.equal(after.filed_at, null);
});

/* ------------------------------------------------------- 5. switching back restores eligibility */

test('loading the policy\'s own pack again makes the same claim filable', () => {
  const claim = settledCollision();

  assert.equal(canFile(kestrel, claim, [], HOME).ok, false);
  assert.equal(canFile(northwind, claim, [], HOME).ok, true);

  const store = createStore({ claim });
  const refused = store.dispatch({
    type: 'file', at: '2026-08-31T10:00:00.000Z', pack: kestrel, completedHumanActions: [], homePackId: 'northwind',
  });
  assert.equal(refused.ok, false);

  const filed = store.dispatch({
    type: 'file', at: '2026-08-31T10:01:00.000Z', pack: northwind, completedHumanActions: [], homePackId: 'northwind',
  });
  assert.equal(filed.ok, true);
  assert.equal(store.getState().claim.status, 'filed');
});

/* ------------------------------------------------------ 6. the requirement gate is still in front */

test('the home pack still refuses a claim its own intake has questions about', () => {
  // The A1 case. Northwind asks a theft claimant for a police report reference, and this is the
  // check the borrowed rule is inserted in front of rather than instead of.
  const theft = applyPatch(createClaim({ policy: { id: 'MTR-2026-0417' } }), [
    { field: 'incident_date', value: '2026-08-14' },
    { field: 'incident_type', value: 'theft' },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'description', value: 'The car was taken overnight from the street outside the house.' },
  ]);
  assert.equal(theft.ok, true);

  const decision = canFile(northwind, theft.claim, [], HOME);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, FILE_CODES.requirements);
});

/* ------------------------------------------------------- 7. no pack and half a pack both refuse */

test('no pack and a half built pack both refuse, and neither is read as an insurer', () => {
  const claim = settledCollision();

  assert.equal(canFile(null, claim, [], HOME).code, FILE_CODES.noPack);

  // The shape that used to pass: a list of requirements and nothing else. It has no id, so it
  // cannot be compared against the home pack either, which is the second reason to refuse it here
  // rather than to let it answer for an insurer with no name.
  // The fifth entry is not half a pack at all. It is complete, and it is refused for the reason the
  // other four are not: src/core/policy.js has never read it. Added 2026-09-02, when the audit found
  // that the shape check above was the whole gate, so a literal like this one filed a claim and
  // sealed a packet naming an insurer that does not exist. The four before it still fail on their
  // own shape, which is why they stay in the same loop.
  for (const half of [
    { requirements: [] },
    { id: 'northwind', requirements: [] },
    { id: '   ', requirements: [], coverages: [] },
    { id: 'northwind', coverages: [] },
    {
      id: 'northwind',
      insurer: 'Northwind Mutual',
      currency: 'EUR',
      contract: 'claim-intake.v1',
      requirements: [],
      coverages: [{
        code: 'own_damage',
        label: 'Own damage',
        clause: 'OD-4.1',
        active: true,
        deductible: 250,
        incident_types: ['collision'],
      }],
    },
  ]) {
    const decision = canFile(half, claim, [], HOME);
    assert.equal(decision.code, FILE_CODES.noPack, `${JSON.stringify(half)} must not be a usable pack`);
    assert.equal(decision.requirementsKnown, false);
    assert.equal(decision.insurer, null);
  }
});

/* --------------------------------------------------------- the caller that names no home insurer */

/**
 * THIS TEST USED TO ASSERT THE OPPOSITE, AND THE OLD ASSERTION WAS THE DEFECT.
 *
 * It read: "a caller that does not know the home insurer gets the answer it always got", on the
 * reasoning that nothing outside the page knows which pack a claim belongs to, so a tool called
 * with no home id must not start refusing on a fact it was never given. It then asserted that
 * filing under Kestrel with no home id was refused only for Kestrel's own missing witness.
 *
 * The reasoning is right about reporting and wrong about filing, and the two had been run together.
 * Reading a pack, deriving its requirements, checking cover and comparing two insurers all still
 * answer with no home id, because none of them asserts where a claim went. Filing does assert it.
 * The borrowed rules check is a comparison between the pack in hand and the policy's own insurer,
 * and with one side missing it has no opinion at all. Treating no opinion as a yes is how a claim
 * on a policy with Northwind filed under Kestrel's intake as soon as the witness was filled in,
 * with the sealed packet naming Kestrel as the insurer.
 *
 * So the answer a caller with no home id gets is not the answer it always got. It is a refusal
 * naming the fact that is missing, which is a stricter gate than the one this file shipped with.
 */
test('a caller that does not know the home insurer cannot file at all', () => {
  const claim = settledCollision();

  for (const options of [undefined, {}, { homePackId: null }, { homePackId: '' }, { homePackId: '   ' }]) {
    const decision = canFile(kestrel, claim, [], options);

    assert.equal(decision.ok, false, `${JSON.stringify(options)} filed with nobody having said whose policy this is`);
    assert.equal(decision.code, FILE_CODES.noHomeInsurer);
    assert.equal(decision.borrowed, false, 'a comparison with one side missing did not fire, it was not made');
    assert.match(decision.reason, /has not been told which insurer/);
  }
});

test('the refusal is in front of the intake, not instead of it', () => {
  // Kestrel's own intake asks a collision claimant for a witness, and this draft has none. That is
  // a true fact about the draft and it is not the reason it cannot be filed, so the sentence must
  // not send a claimant off to answer it.
  const decision = canFile(kestrel, settledCollision(), [], {});

  assert.equal(decision.code, FILE_CODES.noHomeInsurer);
  assert.ok(decision.outstanding.length > 0, 'the outstanding list is still reported in full');
  assert.doesNotMatch(decision.reason, /witness/i);
});

test('with the home insurer named, the same call answers about the intake again', () => {
  // The other half, so the refusal above cannot be read as filing having closed generally. Name the
  // pack as its own policy's pack and the identity questions are all answered, which puts the
  // intake back in front.
  const decision = canFile(kestrel, settledCollision(), [], { homePackId: 'kestrel' });

  assert.equal(decision.code, FILE_CODES.requirements);
  assert.match(decision.reason, /witness/i);
});

test('nothing but filing closes when the home insurer is unknown', () => {
  // The boundary this refusal is drawn on. Everything the demonstration is built to show still
  // answers, because none of it asserts where a claim went. Only the filing decision closes.
  const claim = settledCollision();

  const derived = deriveRequirements(kestrel, claim, []);
  assert.ok(derived.length > 0, 'the borrowed pack still derives its own intake');
  assert.equal(checkCoverage(kestrel, claim).covered, true, 'the cover check still answers');
  assert.equal(checkCoverage(northwind, claim).covered, true);

  // And the two packs still disagree about the intake, which is the comparison the entry is for.
  const kestrelIds = deriveRequirements(kestrel, claim, []).map((entry) => entry.id);
  const northwindIds = deriveRequirements(northwind, claim, []).map((entry) => entry.id);
  assert.notDeepEqual(kestrelIds, northwindIds);
});

/* ------------------------------------------------------------- the policy nobody has named */

/**
 * A draft that does not say which policy it is on.
 *
 * `policy_id` is a protected field. No patch can set it, `validateClaim` does not walk it because
 * it is not on the required list, and so nothing anywhere checked it was there. A claim carrying
 * null filed, and the sealed packet wrote the hole out as a reference reading `CR-UNKNOWN-R2` over
 * a null policy number, under a digest that made it look deliberate.
 */
test('a draft that names no policy cannot be filed, whatever else is complete', () => {
  for (const value of [undefined, null, '', '   ']) {
    const claim = { ...settledCollision(), policy_id: value, reference: null };
    const decision = canFile(northwind, claim, [], HOME);

    assert.equal(decision.ok, false, `policy_id ${JSON.stringify(value)} filed anyway`);
    assert.equal(decision.code, FILE_CODES.noPolicyId);
    assert.match(decision.reason, /does not say which policy/);

    const refused = fileClaim(claim, { pack: northwind, completedHumanActions: [], homePackId: 'northwind' });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, FILE_CODES.noPolicyId);
    assert.equal(refused.claim.status, 'draft');
  }
});

test('the policy number is asked for before the empty fields are listed', () => {
  // Both facts are true on this draft and only one of them is the reason. A claimant sent off to
  // fill in fields would come back to the same refusal.
  const claim = { ...applyPatch(createClaim({ policy: { id: 'MTR-2026-0417' } }), [
    { field: 'incident_type', value: 'collision' },
  ]).claim, policy_id: null };

  const decision = canFile(northwind, claim, [], HOME);
  assert.equal(decision.code, FILE_CODES.noPolicyId);
  assert.ok(decision.missing.length > 0, 'the empty fields are still reported in the facts');
  assert.doesNotMatch(decision.reason, /Still needed before you can file/);
});

test('a policy number that is only whitespace is not a policy number', () => {
  // The same rule the pack id follows. A number nobody can read is not a number, and the trimmed
  // value is what the packet would have printed.
  const decision = canFile(northwind, { ...settledCollision(), policy_id: '\t \n' }, [], HOME);
  assert.equal(decision.code, FILE_CODES.noPolicyId);
});

test('the matching home pack on a named policy still files, so nothing above closed too much', () => {
  // The control. Every identity fact present and agreeing, and the filing goes through.
  const claim = settledCollision();
  const decision = canFile(northwind, claim, [], HOME);
  assert.equal(decision.ok, true, decision.reason);

  const filed = fileClaim(claim, { at: '2026-08-31T10:02:00.000Z', pack: northwind, completedHumanActions: [], homePackId: 'northwind' });
  assert.equal(filed.ok, true, filed.error);
  assert.equal(filed.claim.status, 'filed');
});
