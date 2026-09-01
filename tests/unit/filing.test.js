/**
 * The file gate, at the level below the page.
 *
 * WHAT WAS WRONG, AND IT IS WORTH WRITING OUT BECAUSE THE SHAPE RECURS. The question "can this
 * draft be filed" was asked in four places from three different inputs. `fileClaim` read the
 * static required list. The store's file action carried no insurer rule pack at all, so nothing
 * derived could reach the domain. The File button was disabled on the validation result. And
 * `validate_claim` reported READY off the same static list while its own next line said an intake
 * requirement was open. On a theft claim with no police report reference every surface on the page
 * reported one open requirement, and the claim filed, from the button and from a direct call.
 *
 * There is one answer now, `canFile`, and this file is where it is held to it. The page half lives
 * in tests/unit/app_boot.test.js and the three surfaces are asserted together on one claim state in
 * tests/unit/app_boot_filing.test.js.
 *
 * THE FIRST IMPORT IS filing.js ON PURPOSE. claim.js imports this module and this module imports
 * claim.js and requirements.js, which is a cycle, and a cycle is only safe while no module in it
 * reads an imported binding during evaluation. Entering the graph here rather than through claim.js
 * is what would break if somebody added a top level constant that reads one. src/webmcp/register.js
 * carries the same note for the same reason, and learned it the hard way.
 */

import { canFile, FILE_CODES, NO_PACK_FILING_REASON } from '../../src/core/filing.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyPatch, createClaim, fileClaim, hydrateClaim, validateClaim } from '../../src/core/claim.js';
import { buildFilingPacket } from '../../src/core/packet.js';
import { createStore } from '../../src/core/store.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { fileGateIsSettled } from '../../src/core/requirements.js';

function pack(name) {
  return loadPolicyPack(JSON.parse(readFileSync(
    new URL(`../../fixtures/insurers/${name}.json`, import.meta.url), 'utf8',
  )));
}

const northwind = pack('northwind');
const kestrel = pack('kestrel');

/**
 * Whose policy the draft is on, named on every call that asks whether it can be filed.
 *
 * IT IS AN ARGUMENT, NOT A DECORATION, AND NOTHING HERE DEFAULTS IT. `canFile` refuses a filing it
 * cannot place with an insurer, because the borrowed rules check is a comparison and a comparison
 * with one side missing has no opinion. So a call that leaves this out is asking a different
 * question and gets a different answer, and the tests below name it rather than relying on a helper
 * to put it back. The refusal itself is held in tests/unit/filing_borrowed_pack.test.js.
 *
 * Where a test reads one claim against two insurers in turn, each call names the pack it is reading
 * as the home pack. That keeps the borrowed check out of the way, which is another file's subject,
 * so the only thing moving in those tests is the intake.
 */
const HOME = { homePackId: 'northwind' };

/** Build a draft through the real patch path, so nothing here is a claim shaped literal. */
function draft(fields) {
  const result = applyPatch(
    createClaim({ policy: { id: 'MTR-2026-0417' } }),
    Object.entries(fields).map(([field, value]) => ({ field, value })),
  );
  assert.equal(result.ok, true, `the draft must apply: ${result.error}`);
  return result.claim;
}

/** A theft claim with every REQUIRED field answered and no police report reference. */
function theftWithoutReference() {
  return draft({
    incident_date: '2026-08-14',
    incident_type: 'theft',
    severity: 'dent',
    vehicle_drivable: true,
    description: 'The car was taken overnight from the street outside the house.',
  });
}

/** A collision claim the northwind intake has nothing left to ask about. */
function settledCollision() {
  return draft({
    incident_date: '2026-08-20',
    incident_type: 'collision',
    damage_zone: 10,
    severity: 'dent',
    vehicle_drivable: true,
    description: 'A delivery van reversed into the left front wing while the car was parked.',
  });
}

/* --------------------------------------------------- 1. the requirement the gate could not see */

// THE AUDIT CASE, VERBATIM. Every required field is filled, validateClaim says ready, and this
// insurer asks a theft claimant for a police report reference. It used to file.
test('a theft claim with no police report reference is refused, and says which requirement', () => {
  const claim = theftWithoutReference();

  assert.equal(validateClaim(claim).ready, true, 'the static required list is satisfied');
  const decision = canFile(northwind, claim, [], HOME);

  assert.equal(decision.ok, false);
  assert.equal(decision.code, FILE_CODES.requirements);
  assert.deepEqual(decision.missing, [], 'nothing on the static list is missing');
  assert.deepEqual(decision.outstanding.map((entry) => entry.id), ['police_report']);
  assert.match(decision.reason, /still asks for: The police report reference/);
  assert.equal(decision.insurer, 'Northwind Mutual');
  assert.equal(decision.requirementsKnown, true);
});

test('answering that requirement is what opens the gate, and nothing else changes', () => {
  const claim = theftWithoutReference();
  const answered = applyPatch(claim, { field: 'police_report_ref', value: 'PR-2026-55810' });
  assert.equal(answered.ok, true, answered.error);

  const decision = canFile(northwind, answered.claim, [], HOME);
  assert.equal(decision.ok, true, decision.reason);
  assert.equal(decision.code, null);
  assert.deepEqual(decision.outstanding, []);
  assert.equal(decision.reason, 'The draft is complete. Filing is yours to do.');

  const filed = fileClaim(answered.claim, { at: '2026-09-01T10:31:00.000Z', pack: northwind, ...HOME });
  assert.equal(filed.ok, true, filed.error);
  assert.equal(filed.claim.status, 'filed');
  assert.equal(filed.claim.filed_at, '2026-09-01T10:31:00.000Z');
  assert.equal(filed.revision, answered.claim.revision + 1, 'filing is a change like any other');
});

/* ------------------------------------------------------------- 2. no way round the gate */

test('a direct fileClaim call cannot reach past the insurer requirements', () => {
  const claim = theftWithoutReference();
  const refused = fileClaim(claim, { at: '2026-09-01T10:32:00.000Z', pack: northwind, ...HOME });

  assert.equal(refused.ok, false);
  assert.equal(refused.code, FILE_CODES.requirements);
  assert.equal(refused.claim.status, 'draft');
  assert.match(refused.error, /The police report reference/);
});

// FAIL CLOSED. This is the case that decides whether the gate is a gate at all: called with no
// rules, the domain must refuse rather than fall back to the list that could not see them.
test('with no rule pack the domain refuses, deterministically, and files nothing', () => {
  const claim = settledCollision();
  assert.equal(validateClaim(claim).ready, true, 'every required field is filled');

  for (const missingPack of [null, undefined, {}, { requirements: 'not a list' }]) {
    const decision = canFile(missingPack, claim, [], HOME);
    assert.equal(decision.ok, false, `${JSON.stringify(missingPack)} was treated as a usable pack`);
    assert.equal(decision.code, FILE_CODES.noPack);
    assert.equal(decision.reason, NO_PACK_FILING_REASON, 'the reason has to be the same one every time');
    assert.equal(decision.requirementsKnown, false);
    assert.deepEqual(decision.outstanding, [], 'with no rules there is no list to report');
    assert.equal(decision.insurer, null);
  }

  const refused = fileClaim(claim, { at: '2026-09-01T10:33:00.000Z', ...HOME });
  assert.equal(refused.ok, false, 'an options object with no pack in it is the direct call path');
  assert.equal(refused.code, FILE_CODES.noPack);
  assert.equal(refused.claim.status, 'draft');
});

// BOTH FACTS, NOT THE FIRST ONE ONLY. The pack is what decides the code, because without it this
// page cannot say the intake is finished. That is not a reason to stop telling a claimant which of
// their own fields are still empty, which is the half they can act on.
test('with no pack AND an incomplete draft the reason names the empty fields too', () => {
  const decision = canFile(null, draft({ incident_type: 'collision' }), [], HOME);

  assert.equal(decision.ok, false);
  assert.equal(decision.code, FILE_CODES.noPack, 'the pack is still what fails closed');
  assert.ok(decision.reason.startsWith(NO_PACK_FILING_REASON), decision.reason);
  assert.match(decision.reason, /Still needed before you can file: /);
  assert.match(decision.reason, /where the impact was/);
  assert.ok(decision.missing.length > 0);
});

test('a second filing is refused, and the first one still stands', () => {
  const claim = settledCollision();
  const filed = fileClaim(claim, { at: '2026-09-01T10:34:00.000Z', pack: northwind, ...HOME });
  assert.equal(filed.ok, true, filed.error);

  const again = fileClaim(filed.claim, { at: '2026-09-01T10:35:00.000Z', pack: northwind, ...HOME });
  assert.equal(again.ok, false);
  assert.equal(again.code, FILE_CODES.alreadyFiled);
  assert.match(again.error, /already been filed/);
  assert.equal(again.claim.filed_at, '2026-09-01T10:34:00.000Z', 'the first timestamp is not overwritten');
  assert.equal(again.revision, filed.claim.revision, 'a refused filing moves no revision');
});
/* ------------------------------------------------------- 2b. one shape for a filing time */

/**
 * ONE FILING TIME, ONE SHAPE, EVERYWHERE IT IS WRITTEN OR READ.
 *
 * A filing time used to be whatever the caller handed over. The page handed a local wall clock
 * reading, "10:31:00", so the sealed packet a handler receives said the claim was filed at
 * half past ten with no date on it and no zone, and `hydrateClaim` read any string back without
 * looking. Three readers, three different ideas of what the value was.
 *
 * The shape is a full ISO-8601 instant in UTC, to the millisecond, which is exactly what
 * `new Date().toISOString()` writes. It is refused here rather than invented here: core owns no
 * clock, and a timestamp this module made up would be a fact about the filing that nobody
 * observed. The page reads the clock and hands the instant in, and this is the check that stops a
 * caller from handing in something else.
 */
test('a filing time that is not a full UTC instant is refused, and nothing is filed', () => {
  const claim = settledCollision();
  const bad = [
    '10:31:00',
    '2026-08-26',
    '2026-08-26T09:30:00Z',
    '2026-08-26T09:30:00.000+02:00',
    '2026-02-30T09:30:00.000Z',
    'just now',
    '',
    null,
    undefined,
    1756200000000,
  ];

  for (const value of bad) {
    const refused = fileClaim(claim, { at: value, pack: northwind, ...HOME });
    assert.equal(refused.ok, false, `${JSON.stringify(value)} was accepted as a filing time`);
    assert.equal(refused.code, FILE_CODES.noFilingTime, `${JSON.stringify(value)} got the wrong code`);
    assert.match(refused.error, /full UTC instant/);
    assert.equal(refused.claim.status, 'draft');
    assert.equal(refused.claim.filed_at, null);
    assert.equal(refused.revision, claim.revision, 'a refused filing moves no revision');
  }

  const filed = fileClaim(claim, { at: '2026-08-26T09:30:00.000Z', pack: northwind, ...HOME });
  assert.equal(filed.ok, true, filed.error);
  assert.equal(filed.claim.filed_at, '2026-08-26T09:30:00.000Z');
});

// A CALLER BUG MUST NOT SPEAK OVER THE CLAIMANT'S OWN FIELDS. The timestamp is checked after the
// gate, so a draft that is not ready still hears which of its own answers are missing. That is the
// half a person can act on, and it was the whole point of the gate reasons.
test('the gate answers first, so a bad timestamp never hides an open requirement', () => {
  const refused = fileClaim(theftWithoutReference(), { at: '10:31:00', pack: northwind, ...HOME });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, FILE_CODES.requirements);
  assert.match(refused.error, /The police report reference/);
});

test('the domain, the stored claim and the sealed packet quote one filing time', () => {
  const filed = fileClaim(settledCollision(), { at: '2026-08-26T09:30:00.000Z', pack: northwind, ...HOME });
  assert.equal(filed.ok, true, filed.error);

  // Through JSON and back, which is the other door into this state.
  const readBack = hydrateClaim(JSON.parse(JSON.stringify(filed.claim)));
  assert.equal(readBack.status, 'filed');
  assert.equal(readBack.filed_at, filed.claim.filed_at);

  const built = buildFilingPacket({
    claim: filed.claim,
    pack: northwind,
    homePackId: 'northwind',
    completedHumanActions: [],
    ledger: [],
  });
  assert.equal(built.ok, true, built.reason);
  assert.equal(built.packet.filed.at, filed.claim.filed_at);
});


/* ------------------------------------------------- 3. a refusal changes nothing, on every path */

test('every refusal hands back the claim it was given, untouched, and moves no revision', () => {
  const cases = [
    { what: 'incomplete', claim: draft({ incident_type: 'collision' }), pack: northwind },
    { what: 'an open requirement', claim: theftWithoutReference(), pack: northwind },
    { what: 'no pack', claim: settledCollision(), pack: null },
    { what: 'already filed', claim: fileClaim(settledCollision(), { at: '2026-09-01T10:36:00.000Z', pack: northwind, ...HOME }).claim, pack: northwind },
  ];

  for (const item of cases) {
    const before = JSON.parse(JSON.stringify(item.claim));
    const result = fileClaim(item.claim, { at: '2026-09-01T11:00:00.000Z', pack: item.pack, ...HOME });

    assert.equal(result.ok, false, `${item.what} should have been refused`);
    assert.ok(result.code, `${item.what} was refused with no code`);
    assert.ok(Object.is(result.claim, item.claim),
      `${item.what}: a refusal handed back a different object, so something was copied and may have been changed`);
    assert.deepEqual(item.claim, before, `${item.what}: the claim was mutated by a refusal`);
    assert.equal(result.revision, before.revision, `${item.what}: the revision moved on a refusal`);
  }
});

/* --------------------------------------------------------- 4. the gate follows the rule pack */

test('switching the rule pack recomputes the gate, in both directions', () => {
  // The same claim, unchanged throughout. Only the rules move.
  const claim = settledCollision();

  const first = canFile(northwind, claim, [], HOME);
  assert.equal(first.ok, true, first.reason);

  // Kestrel asks a collision claimant to name a witness. Northwind does not.
  const second = canFile(kestrel, claim, [], { homePackId: 'kestrel' });
  assert.equal(second.ok, false);
  assert.equal(second.code, FILE_CODES.requirements);
  assert.deepEqual(second.outstanding.map((entry) => entry.id), ['named_witness']);
  assert.equal(second.insurer, 'Kestrel Assurance');

  // And back again, because a gate that only tightens is not following the rules either.
  const third = canFile(northwind, claim, [], HOME);
  assert.equal(third.ok, true, third.reason);
  assert.deepEqual(third.outstanding, []);

  // The store carries the pack on the action, so the same swing happens through a dispatch.
  const store = createStore(claim);
  assert.equal(store.dispatch({ type: 'file', at: '2026-09-01T10:37:00.000Z', pack: kestrel, homePackId: 'kestrel' }).ok, false);
  assert.equal(store.getState().claim.status, 'draft');
  assert.equal(store.dispatch({ type: 'file', at: '2026-09-01T10:37:00.000Z', pack: northwind, ...HOME }).ok, true);
  assert.equal(store.getState().claim.status, 'filed');
});

/* ------------------------------------------------ 5. the requirement no patch from either side closes */

test('a requirement only a human action closes holds the gate until the action is reported', () => {
  const stranded = draft({
    incident_date: '2026-08-20',
    incident_type: 'collision',
    damage_zone: 10,
    severity: 'dent',
    vehicle_drivable: false,
    description: 'A car came out of a side road and hit the left front wing.',
    location: 'Car park, Harbour Road',
  });

  const open = canFile(northwind, stranded, [], HOME);
  assert.equal(open.ok, false);
  assert.equal(open.code, FILE_CODES.requirements);
  assert.deepEqual(open.outstanding.map((entry) => entry.id), ['roadside_collection']);
  assert.equal(open.outstanding[0].field, null, 'no field answers it, so no patch can close it');
  assert.ok(open.outstanding[0].humanAction, 'the requirement says what has to be done instead');
  assert.match(open.reason, /no tool on this page reaches it/i);

  // Reported as carried out on the page, which is the one fact src/core cannot work out for itself.
  const done = canFile(northwind, stranded, ['roadside_collection'], HOME);
  assert.equal(done.ok, true, done.reason);
  assert.equal(fileClaim(stranded, { at: '2026-09-01T10:38:00.000Z', pack: northwind, ...HOME, completedHumanActions: ['roadside_collection'] }).ok, true);
  assert.equal(fileClaim(stranded, { at: '2026-09-01T10:38:00.000Z', pack: northwind, ...HOME }).ok, false,
    'an action nobody reported is not done');
});

/* ------------------------------------------------------------ 6. the two answers never diverge */

/**
 * fileGateIsSettled has been in src/core/requirements.js since before this module existed, and it
 * answers the same question from the derived state the panel is built from. The view no longer
 * calls it: the button and the sentence both come off canFile, so there is one decision on the
 * page. Keeping the older function honest against the newer one is what stops it drifting into a
 * second answer that some future caller reaches for. It is the same forcing function
 * packFieldDemands already provides one file over.
 */
test('fileGateIsSettled and canFile give one answer on every draft in this matrix', () => {
  const claims = [
    createClaim({ policy: { id: 'MTR-2026-0417' } }),
    draft({ incident_type: 'collision' }),
    theftWithoutReference(),
    applyPatch(theftWithoutReference(), { field: 'police_report_ref', value: 'PR-2026-55810' }).claim,
    settledCollision(),
    draft({
      incident_date: '2026-08-20',
      incident_type: 'collision',
      damage_zone: 10,
      severity: 'dent',
      vehicle_drivable: false,
      description: 'A car came out of a side road and hit the left front wing.',
    }),
  ];

  let checked = 0;
  for (const claim of claims) {
    for (const rules of [northwind, kestrel, null]) {
      for (const done of [[], ['roadside_collection']]) {
        // Each pack is read as its own policy's pack. A borrowed pack is refused on identity
        // before either answer looks at a requirement, which is a different question from the one
        // this matrix is about.
        const decision = canFile(rules, claim, done, { homePackId: rules ? rules.id : null });
        const asPanel = {
          ready: decision.missing.length === 0,
          missing: decision.missing,
          outstanding: decision.outstanding,
          insurer: decision.insurer,
          requirementsKnown: decision.requirementsKnown,
        };
        assert.equal(fileGateIsSettled(asPanel), decision.ok,
          `the two disagreed on ${JSON.stringify({ code: decision.code, done, insurer: decision.insurer })}`);
        checked += 1;
      }
    }
  }
  assert.equal(checked, claims.length * 3 * 2, `only ${checked} combinations were compared`);
});

// The one case where they are allowed to differ, said out loud so nobody reads the matrix above as
// a promise it does not make. A filed claim has nothing outstanding and cannot be filed again, and
// the panel has its own branch for that which never asks either question.
test('a filed claim is the one draft where settled and filable are different questions', () => {
  const filed = fileClaim(settledCollision(), { at: '2026-09-01T10:39:00.000Z', pack: northwind, ...HOME }).claim;
  const decision = canFile(northwind, filed, [], HOME);

  assert.equal(decision.ok, false);
  assert.equal(decision.code, FILE_CODES.alreadyFiled);
  assert.equal(fileGateIsSettled({
    ready: true, missing: [], outstanding: [], insurer: decision.insurer, requirementsKnown: true,
  }), true, 'nothing is outstanding on a filed claim, which is why the panel branches on filed first');
});

/* --------------------------------------------------------------------- 7. the arguments */

test('canFile insists on a claim and never invents one', () => {
  assert.throws(() => canFile(northwind, null, [], HOME), TypeError);
  assert.throws(() => canFile(northwind, 'a claim', [], HOME), TypeError);
  assert.throws(() => fileClaim(null, { pack: northwind, ...HOME }), TypeError);
});

test('the completed actions argument takes an array, a Set, or nothing at all', () => {
  const stranded = draft({
    incident_date: '2026-08-20',
    incident_type: 'collision',
    damage_zone: 10,
    severity: 'dent',
    vehicle_drivable: false,
    description: 'A car came out of a side road and hit the left front wing.',
    location: 'Car park, Harbour Road',
  });

  assert.equal(canFile(northwind, stranded, new Set(['roadside_collection']), HOME).ok, true);
  assert.equal(canFile(northwind, stranded, ['roadside_collection'], HOME).ok, true);
  assert.equal(canFile(northwind, stranded, undefined, HOME).ok, false, 'omitted means nothing is reported as done');
});
