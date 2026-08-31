/**
 * The journey the video films, from a fresh draft to a filed claim, at the level below the page.
 *
 * WHY IT EXISTS. The first attempt at filming it did not finish. The agent filled the collision
 * fields, the person answered that the car could not be driven, and Northwind raised two new
 * requirements at once: the roadside collection, which a person closes by pressing a button, and
 * the collection address, which is a field. The runbook only knew about the first. So the person
 * pressed the button, the File control stayed disabled with FILE_REFUSED_REQUIREMENTS, and the
 * take stopped in the middle with nobody able to say why from the script alone.
 *
 * The fix is in the source sentence: the prompt now says where the car is, so the agent writes
 * `location` in the same patch as the damage. This file is what keeps the two in step. If a later
 * change to the packs, the rules or the prompt breaks that chain, this fails here rather than in
 * front of a camera with the owner waiting.
 *
 * IT IS DELIBERATELY NOT A UI TEST. The page half is covered in tests/unit/app_boot*.test.js. What
 * this asserts is that the sequence of domain facts the runbook depends on is reachable at all,
 * three times from a fresh claim, with no manual repair between the steps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyPatch, createClaim, fileClaim, lockField } from '../../src/core/claim.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { deriveRequirements, outstandingRequirements } from '../../src/core/requirements.js';
import { canFile, FILE_CODES } from '../../src/core/filing.js';

const HOME = 'northwind';
const pack = loadPolicyPack(JSON.parse(readFileSync(
  new URL('../../fixtures/insurers/northwind.json', import.meta.url), 'utf8',
)));

const fixture = JSON.parse(readFileSync(
  new URL('../../fixtures/demo-collision.json', import.meta.url), 'utf8',
));

/** What the agent writes from the beat 03 prompt, in one patch, the way the take shows it. */
const AGENT_PATCH = [
  { field: 'damage_zone', value: 10 },
  { field: 'severity', value: 'dent' },
  { field: 'vehicle_drivable', value: true },
  { field: 'location', value: 'Car park on Harbour Road' },
  {
    field: 'description',
    value: 'A delivery van reversed into the left front wing while the car was parked in the '
      + 'car park on Harbour Road. The car still drives.',
  },
];

function openIds(claim, done) {
  return outstandingRequirements(deriveRequirements(pack, claim, done)).map((entry) => entry.id);
}

function runTheJourney() {
  const steps = [];
  let claim = createClaim(fixture);
  steps.push({ what: 'the page opens', revision: claim.revision, open: openIds(claim, []) });

  // BEAT 03. One patch, quoting the revision it read, which is what the tool descriptor asks for
  // and what the ledger shows on camera.
  const filled = applyPatch(claim, AGENT_PATCH, { actor: 'agent', baseRevision: claim.revision });
  assert.equal(filled.ok, true, `the agent patch must land: ${filled.error}`);
  claim = filled.claim;
  assert.equal(claim.location, 'Car park on Harbour Road', 'beat 03 has to leave the location on the draft');
  steps.push({ what: 'the agent fills the draft', revision: claim.revision, open: openIds(claim, []) });

  // BEAT 04. The person corrects the drivable answer by hand, which is what raises the two
  // requirements this journey turns on.
  const corrected = applyPatch(claim, [{ field: 'vehicle_drivable', value: false }], { actor: 'human' });
  assert.equal(corrected.ok, true, `the correction must land: ${corrected.error}`);
  claim = corrected.claim;
  const raised = openIds(claim, []);
  assert.ok(raised.includes('roadside_collection'), 'the collection is raised by the correction');
  assert.ok(
    !raised.includes('collection_address'),
    'the address is already answered, because beat 03 wrote the location. This is the assertion '
    + 'the first filming attempt did not have, and it is the one that failed in front of the camera',
  );
  steps.push({ what: 'the person says it cannot be driven', revision: claim.revision, open: raised });

  // Still beat 04: the person pins the row, which is what makes the refusal in beat 06 possible.
  const pinned = lockField(claim, 'vehicle_drivable');
  assert.equal(pinned.ok, true, `the pin must land: ${pinned.error}`);
  claim = pinned.claim;

  // BEAT 06: the planted note asks for the pinned field back. Refused, and nothing moves.
  const refused = applyPatch(claim, [{ field: 'vehicle_drivable', value: true }], {
    actor: 'agent',
    baseRevision: claim.revision,
  });
  assert.equal(refused.ok, false, 'a pinned field does not move for an agent');
  assert.match(refused.code, /LOCKED/, `the refusal names the pin: ${refused.code}`);
  assert.equal(refused.claim.revision, claim.revision, 'a refusal moves no revision');

  // BEAT 07. The person presses the roadside control, which closes the one requirement no field
  // answers, and then files.
  const beforeFiling = canFile(pack, claim, [], { homePackId: HOME });
  assert.equal(beforeFiling.ok, false, 'filing waits for the collection');
  assert.equal(beforeFiling.code, FILE_CODES.requirements);

  const done = ['roadside_collection'];
  assert.deepEqual(openIds(claim, done), [], 'the press closes the last open requirement');

  const ready = canFile(pack, claim, done, { homePackId: HOME });
  assert.equal(ready.ok, true, `filing must be open by now: ${ready.code} ${ready.reason}`);

  const filed = fileClaim(claim, {
    pack,
    completedHumanActions: done,
    homePackId: HOME,
    at: '2026-09-01T10:00:00.000Z',
  });
  assert.equal(filed.ok, true, `the filing must succeed: ${filed.error}`);
  assert.equal(filed.claim.status, 'filed');
  steps.push({ what: 'the person files', revision: filed.claim.revision, open: [] });

  return steps;
}

test('the filmed journey runs from a fresh draft to a filed claim', () => {
  const steps = runTheJourney();
  assert.equal(steps.length, 4);
  assert.ok(steps[3].revision > steps[0].revision, 'the revision only ever moves forward');
});

// THREE TIMES FROM FRESH, because a journey that works once is a journey that might be carrying
// state from the run before it. Each pass builds its own claim from the shipped fixture.
test('it runs three times from fresh state with no repair in between', () => {
  const runs = [runTheJourney(), runTheJourney(), runTheJourney()];
  const shapes = runs.map((steps) => JSON.stringify(steps));
  assert.equal(shapes[0], shapes[1]);
  assert.equal(shapes[1], shapes[2]);
});

// AND THE OTHER DIRECTION, so the assertion above is not passing by luck: without the location the
// journey is exactly the one that stopped in front of the camera.
test('without the location, the same journey stops at the File control, as it did on the day', () => {
  let claim = createClaim(fixture);
  const withoutLocation = AGENT_PATCH.filter((change) => change.field !== 'location');
  claim = applyPatch(claim, withoutLocation, { actor: 'agent', baseRevision: claim.revision }).claim;
  claim = applyPatch(claim, [{ field: 'vehicle_drivable', value: false }], { actor: 'human' }).claim;

  const stillOpen = openIds(claim, ['roadside_collection']);
  assert.deepEqual(stillOpen, ['collection_address']);

  const decision = canFile(pack, claim, ['roadside_collection'], { homePackId: HOME });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, FILE_CODES.requirements);
  assert.match(decision.reason, /collected/i);
});
