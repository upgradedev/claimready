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
  for (const half of [
    { requirements: [] },
    { id: 'northwind', requirements: [] },
    { id: '   ', requirements: [], coverages: [] },
    { id: 'northwind', coverages: [] },
  ]) {
    const decision = canFile(half, claim, [], HOME);
    assert.equal(decision.code, FILE_CODES.noPack, `${JSON.stringify(half)} must not be a usable pack`);
    assert.equal(decision.requirementsKnown, false);
    assert.equal(decision.insurer, null);
  }
});

/* --------------------------------------------------------- the caller that names no home insurer */

test('a caller that does not know the home insurer gets the answer it always got', () => {
  // Nothing outside the page knows which pack a claim belongs to, and a tool called with no home
  // id must not start refusing on a fact it was never given.
  const claim = settledCollision();

  // Kestrel still refuses this draft, for its own reason: its intake asks a collision claimant for
  // a witness. What must not happen is a refusal about whose rules these are, on a fact nobody
  // supplied.
  for (const options of [undefined, {}, { homePackId: null }, { homePackId: '   ' }]) {
    const decision = canFile(kestrel, claim, [], options);
    assert.equal(decision.borrowed, false);
    assert.notEqual(decision.code, FILE_CODES.borrowedRules);
    assert.equal(decision.code, FILE_CODES.requirements);
  }
});
