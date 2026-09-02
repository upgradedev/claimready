/**
 * WHAT A CLAIM HOLDS, CHECKED AS A WHOLE, AT EVERY DOOR THAT ACTS ON IT.
 *
 * WHAT WAS WRONG. `validateClaim` answers one question, "which required field is empty", and three
 * surfaces were reading it as though it answered a second one, "is this claim usable". It does not
 * look at a single held value. So a claim written to by hand between being built and being filed
 * carried a severity this page has no word for, a clock position of 47, an incident date of
 * "yesterday", the string "maybe" where a boolean belongs, or an object where the claimant's own
 * account of the crash belongs, and it filed. Measured before the check existed, on claims built
 * through the real patch path and then written to directly:
 *
 *   unknown severity                canFile=true fileClaim=true packet=SEALED
 *   damage_zone out of range        canFile=true fileClaim=true packet=SEALED
 *   object where free text belongs  canFile=true fileClaim=true packet=SEALED ... {}
 *   negative revision               canFile=true fileClaim=true packet=SEALED ref=CR-...-R-4
 *
 * The packet is the surface that makes this expensive. A handler was handed an empty JSON object
 * under the heading a person's account of the crash goes under, sealed with a SHA-256 over it, and
 * a digest is exactly what makes a wrong value look checked.
 *
 * ONE VALIDATOR, THREE DOORS. `checkClaimSnapshot` is asked by `canFile`, which is what `fileClaim`
 * and the page's File button both read, by `buildFilingPacket`, and by `hydrateClaim`, which is the
 * door a stored claim comes back through. Three copies of this rule would be three chances to
 * disagree about what a usable claim is, which is the defect src/core/filing.js was written to
 * close one input further out.
 *
 * THE ORDINARY JOURNEY IS ASSERTED HERE TOO, at the bottom. A check that refuses everything is not
 * a fix, and the demo path filing is the one thing this must not have cost.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canFile, FILE_CODES } from '../../src/core/filing.js';
import {
  applyPatch,
  checkClaimSnapshot,
  createClaim,
  fileClaim,
  hydrateClaim,
  lockField,
  unlockField,
} from '../../src/core/claim.js';
import { buildFilingPacket, PACKET_CODES } from '../../src/core/packet.js';
import { loadPolicyPack } from '../../src/core/policy.js';

const northwind = loadPolicyPack(JSON.parse(readFileSync(
  new URL('../../fixtures/insurers/northwind.json', import.meta.url), 'utf8',
)));

const HOME = { homePackId: 'northwind' };
const AT = '2026-09-02T05:00:00.000Z';

/** A complete draft the northwind intake has nothing left to ask about, built through patches. */
function settledDraft() {
  const result = applyPatch(createClaim({ policy: { id: 'MTR-2026-0417' } }), [
    { field: 'incident_date', value: '2026-08-20' },
    { field: 'incident_type', value: 'collision' },
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ]);
  assert.equal(result.ok, true, `the draft must apply: ${result.error}`);
  return result.claim;
}

/**
 * Every way a claim can hold a value this page would never have written.
 *
 * Each one starts from the draft above, which files cleanly, so the only thing under test is the
 * single value the mutator writes. The first several are the claimant's own answers. The rest are
 * the bookkeeping that decides what a later writer may do.
 */
const BAD_SNAPSHOTS = {
  'a date nobody can order': (claim) => { claim.incident_date = 'yesterday'; },
  'a day that is not on the calendar': (claim) => { claim.incident_date = '2026-02-30'; },
  'an incident type this page has no word for': (claim) => { claim.incident_type = 'banana'; },
  'a severity this page has no word for': (claim) => { claim.severity = 'catastrophic'; },
  'a clock position out of range': (claim) => { claim.damage_zone = 47; },
  'a drivable answer that is not true or false': (claim) => { claim.vehicle_drivable = 'maybe'; },
  'an object where the account of the crash belongs': (claim) => { claim.description = { text: 'hi' }; },
  'free text stored as a number': (claim) => { claim.location = 4417; },
  'a zone stored as the string a patch would have coerced': (claim) => { claim.damage_zone = '10'; },
  'a severity stored in a case a patch would have lowered': (claim) => { claim.severity = 'DENT'; },
  'a revision below zero': (claim) => { claim.revision = -5; },
  'a revision that is not a whole number': (claim) => { claim.revision = 2.5; },
  'no revision at all': (claim) => { delete claim.revision; },
  'a status this page does not write': (claim) => { claim.status = 'archived'; },
  'a pin on a field nobody can pin': (claim) => { claim.locked = ['settlement_amount']; },
  'the same field pinned twice': (claim) => { claim.locked = ['severity', 'severity']; },
  'a pin list that is not a list': (claim) => { claim.locked = 'severity'; },
  'a provenance source this page does not write': (claim) => { claim.provenance.severity = 'the garage'; },
  'a provenance badge over a field that holds nothing': (claim) => { claim.provenance.witness_name = 'human'; },
  'a policy number that is not a string': (claim) => { claim.policy_id = 12345; },
  'a reference that is not a string': (claim) => { claim.reference = ['CR-1']; },
};

/** The claim as bytes, so a refusal can be shown to have moved nothing. */
function snapshot(claim) {
  return JSON.stringify(claim);
}

/* ------------------------------------------------------------- 1. none of them can file */

test('a claim holding a value this page could not have written is refused by the file gate', () => {
  for (const [name, mutate] of Object.entries(BAD_SNAPSHOTS)) {
    const claim = settledDraft();
    mutate(claim);
    const before = snapshot(claim);

    const decision = canFile(northwind, claim, [], HOME);

    assert.equal(decision.ok, false, `${name} passed the file gate`);
    assert.equal(decision.code, FILE_CODES.unusableState, `${name} got the wrong code`);
    assert.match(decision.reason, /could not have written/);
    assert.equal(snapshot(claim), before, `${name} was changed by asking`);
  }
});

test('and none of them can be filed by a direct call either', () => {
  // fileClaim has no second opinion. It reaches the refusal through canFile, which is the same
  // answer the button reads, so the page and a direct caller cannot disagree about any of these.
  for (const [name, mutate] of Object.entries(BAD_SNAPSHOTS)) {
    const claim = settledDraft();
    mutate(claim);
    const before = snapshot(claim);

    const refused = fileClaim(claim, { at: AT, pack: northwind, completedHumanActions: [], ...HOME });

    assert.equal(refused.ok, false, `${name} filed`);
    assert.equal(refused.code, FILE_CODES.unusableState, `${name} got the wrong code`);
    assert.notEqual(refused.claim.status, 'filed', `${name} came back filed`);
    assert.equal(snapshot(refused.claim), before, `${name} moved the claim`);
  }
});

test('a refused filing moves no revision', () => {
  const claim = settledDraft();
  claim.severity = 'catastrophic';
  const was = claim.revision;

  const refused = fileClaim(claim, { at: AT, pack: northwind, completedHumanActions: [], ...HOME });

  assert.equal(refused.revision, was);
  assert.equal(claim.revision, was);
});

test('and none of them can be moved on by a patch, which is the door that writes', () => {
  // THE FOURTH DOOR. The three above only read the claim. This one writes to it, and it used to
  // accept a bad snapshot and advance the revision over it:
  //
  //   unknown severity   patch ok=true revision 1 -> 2 still holds "catastrophic"
  //   zone out of range  patch ok=true revision 1 -> 2 still holds 47
  //   negative revision  patch ok=true revision -5 -> -4
  //
  // The counter moving is the expensive half. It is the one thing a later writer trusts to prove
  // it is writing to the draft it read.
  for (const [name, mutate] of Object.entries(BAD_SNAPSHOTS)) {
    const claim = settledDraft();
    mutate(claim);
    const before = snapshot(claim);

    const refused = applyPatch(claim, { field: 'description', value: 'Something else entirely.' });

    assert.equal(refused.ok, false, `${name} was patched`);
    assert.equal(refused.code, 'PATCH_REJECTED_VALUE', `${name} got the wrong code`);
    assert.deepEqual(refused.applied, [], `${name} reported a written field`);
    assert.equal(snapshot(refused.claim), before, `${name} moved the claim`);
  }
});

test('and none of them can be pinned or unpinned either, the other two doors that write', () => {
  // THE FIFTH AND SIXTH DOORS, and the last two that said yes. Pinning writes no value, so nothing
  // wrong escaped through them. They moved the counter, and the counter is the one thing a later
  // writer trusts to prove it read what it is writing to. Measured before the check, on a settled
  // draft holding one value written by hand:
  //
  //   severity "catastrophic"   applyPatch  refused PATCH_REJECTED_VALUE, revision stayed 2
  //                             lockField   ok=true, revision 2 -> 3, still "catastrophic"
  //                             unlockField ok=true, revision 2 -> 3, still "catastrophic"
  //
  // Every claim below is pinned on description first, through the real door, so both calls ask for
  // a change that would have landed rather than for one that changes nothing anyway.
  for (const [name, mutate] of Object.entries(BAD_SNAPSHOTS)) {
    const claim = lockField(settledDraft(), 'description').claim;
    mutate(claim);
    const before = snapshot(claim);

    const patched = applyPatch(claim, { field: 'location', value: 'Somewhere else entirely' });
    assert.equal(patched.ok, false, `${name} was patched`);

    for (const [door, result] of [
      ['lockField', lockField(claim, 'location')],
      ['unlockField', unlockField(claim, 'description')],
    ]) {
      assert.equal(result.ok, false, `${name} was accepted by ${door}`);
      assert.equal(result.code, 'PATCH_REJECTED_VALUE', `${name} got the wrong code from ${door}`);
      assert.equal(result.claim, claim, `${door} handed back a different claim for ${name}`);
      assert.equal(result.revision, patched.revision, `${door} moved the revision on ${name}`);
      assert.equal(snapshot(claim), before, `${name} was changed by ${door}`);

      // THE SAME REFUSAL, WORD FOR WORD. Three doors reading one check must not describe it three
      // ways, or a reader fixing the claim gets three accounts of one problem.
      assert.equal(result.error, patched.error, `${door} says something else about ${name}`);
    }
  }
});

test('pinning still works on a claim this page could have written', () => {
  // A check that refuses everything is not a fix. The ordinary pin is what the filmed journey does
  // on vehicle_drivable, so it is asserted here beside the refusals.
  const claim = settledDraft();

  const pinned = lockField(claim, 'vehicle_drivable');
  assert.equal(pinned.ok, true, pinned.error);
  assert.equal(pinned.revision, claim.revision + 1);
  assert.deepEqual(pinned.claim.locked, ['vehicle_drivable']);

  const released = unlockField(pinned.claim, 'vehicle_drivable');
  assert.equal(released.ok, true, released.error);
  assert.deepEqual(released.claim.locked, []);
});

/* --------------------------------------------- 2. none of them can be sealed into a packet */

test('none of them can be packeted, even with the filed status written on by hand', () => {
  // The route that does not go through the gate at all. A caller sets the status and a filing time
  // itself and asks for the document. Every one of these used to come back sealed.
  for (const [name, mutate] of Object.entries(BAD_SNAPSHOTS)) {
    // Filed first, then the bad value written over it, so the one case that writes its own status
    // keeps it rather than being handed a good one back.
    const claim = settledDraft();
    claim.status = 'filed';
    claim.filed_at = AT;
    mutate(claim);
    const before = snapshot(claim);

    const built = buildFilingPacket({
      claim, pack: northwind, homePackId: 'northwind', completedHumanActions: [],
    });

    assert.equal(built.ok, false, `${name} was sealed into a packet`);
    assert.equal(built.code, PACKET_CODES.unusableState, `${name} got the wrong code`);
    assert.equal(built.packet, null);
    assert.equal(built.canonical, null, 'there is nothing to hash, so nothing is offered to hash');
    assert.equal(snapshot(claim), before, `${name} was changed by asking`);
  }
});

test('a claim marked filed with no filing time on it is not a packet either', () => {
  // The state finding D is about, arriving at the other door. The packet used to write
  // "at": null into the filed block and hash it, which reads as a filing nobody timed.
  const claim = settledDraft();
  claim.status = 'filed';

  const built = buildFilingPacket({
    claim, pack: northwind, homePackId: 'northwind', completedHumanActions: [],
  });

  assert.equal(built.ok, false);
  assert.equal(built.code, PACKET_CODES.unusableState);
  assert.match(built.reason, /marked filed/);
  assert.match(built.reason, /full UTC instant/);
});

/* ------------------------------------------- 3. the stored claim, and the state that reopened */

test('hydrateClaim refuses a stored filed claim that carries no filing time', () => {
  // WHAT WAS WRONG. hydrateClaim turned this into a writable draft, so a closed state came back
  // open and an agent patch went straight through it. Measured at revision 7 before the change:
  //
  //   stored status  : filed  filed_at: null
  //   hydrated status: draft  filed_at: null
  //   patch ok       : true   Something else entirely.
  const stored = {
    policy_id: 'MTR-2026-0417',
    status: 'filed',
    filed_at: null,
    revision: 7,
    provenance: { description: 'human' },
    locked: [],
    incident_date: '2026-08-20',
    incident_type: 'collision',
    damage_zone: 10,
    severity: 'dent',
    vehicle_drivable: true,
    description: 'A delivery van reversed into the left front wing while parked.',
  };

  assert.throws(
    () => hydrateClaim(stored),
    (error) => error instanceof TypeError
      && error.message.includes('marked filed')
      && error.message.includes('full UTC instant'),
    'a filed claim with no filing time was read back as something writable',
  );

  // The same store with the instant on it opens, stays filed, and is closed to a patch. That is
  // the state the refusal above protects, so it is asserted rather than assumed.
  const real = hydrateClaim({ ...stored, filed_at: AT });
  assert.equal(real.status, 'filed');
  assert.equal(real.filed_at, AT);
  const patched = applyPatch(real, { field: 'description', value: 'Something else entirely.' }, {
    actor: 'agent', baseRevision: real.revision,
  });
  assert.equal(patched.ok, false);
  assert.equal(patched.claim.description, stored.description);
});

test('hydrateClaim refuses a stored draft that carries a filing time', () => {
  // The same slide running the other way. A draft carrying a filing time is not a draft this page
  // wrote, and reading it back as an ordinary open draft is the repair that hid the first one.
  assert.throws(
    () => hydrateClaim({ status: 'draft', severity: 'dent', filed_at: AT }),
    /marked draft and carries a filing time/,
  );
});

/* ------------------------------------------------ 4. what the check must NOT have taken with it */

test('a draft halfway through being filled in is not touched by any of this', () => {
  // The check is about held values, never about missing ones. A claimant three answers in has to
  // pass it, or the page refuses its own ordinary state before anyone has done anything wrong.
  const partial = applyPatch(createClaim({ policy: { id: 'MTR-2026-0417' } }), [
    { field: 'incident_type', value: 'collision' },
    { field: 'severity', value: 'dent' },
  ]);
  assert.equal(partial.ok, true, partial.error);

  assert.equal(checkClaimSnapshot(partial.claim).ok, true);

  // And the gate still refuses it for the reason it always did, naming the empty fields.
  const decision = canFile(northwind, partial.claim, [], HOME);
  assert.equal(decision.code, FILE_CODES.incomplete);
  assert.ok(decision.missing.includes('description'));
});

test('the ordinary journey still files and still seals a packet', () => {
  const claim = settledDraft();
  assert.equal(checkClaimSnapshot(claim).ok, true);

  const decision = canFile(northwind, claim, [], HOME);
  assert.equal(decision.ok, true, decision.reason);

  const filed = fileClaim(claim, { at: AT, pack: northwind, completedHumanActions: [], ...HOME });
  assert.equal(filed.ok, true, filed.error);
  assert.equal(filed.claim.status, 'filed');

  const built = buildFilingPacket({
    claim: filed.claim, pack: northwind, homePackId: 'northwind', completedHumanActions: [],
  });
  assert.equal(built.ok, true, built.reason);
  assert.equal(built.packet.filed.at, AT);
  assert.equal(built.packet.claim.severity.value, 'dent');
});

test('a filed claim read back through the store still passes the snapshot check', () => {
  // The three doors have to agree about what a usable claim IS. A claim that files, goes out
  // through JSON and comes back has to satisfy the same check the gate applied on the way in, or
  // one of the three is wrong.
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: [], ...HOME,
  });
  assert.equal(filed.ok, true, filed.error);

  const readBack = hydrateClaim(JSON.parse(JSON.stringify(filed.claim)));
  assert.equal(checkClaimSnapshot(readBack).ok, true);

  // AND THE PACKET STILL REFUSES IT, WHICH IS A DIFFERENT QUESTION AND IS DELIBERATE.
  //
  // This assertion used to read `built.ok === true`, which conflated two things. The snapshot check
  // asks whether this is a claim this page could have written, and a claim that went out through
  // JSON and came back is. The packet asks something narrower: whether THIS page performed THIS
  // filing. Storage is caller controlled, so a hydrated claim that was handed the filing receipt
  // back would hand it to whoever wrote the storage. The receipt and its limits live in
  // src/core/claim.js, and tests/unit/filing_receipt.test.js holds the forgeries.
  const built = buildFilingPacket({
    claim: readBack, pack: northwind, homePackId: 'northwind', completedHumanActions: [],
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, PACKET_CODES.notFiledHere);
});

/* --------------------------------------------------------- 5. the validator on its own terms */

test('the verdict names every problem, not only the first one', () => {
  // A caller fixing one value at a time against a check that stopped at the first would walk the
  // list one round trip per problem. The page draws this sentence, so it says all of it at once.
  const claim = settledDraft();
  claim.severity = 'catastrophic';
  claim.damage_zone = 47;
  claim.revision = -1;

  const verdict = checkClaimSnapshot(claim);

  assert.equal(verdict.ok, false);
  assert.equal(verdict.problems.length, 3);
  assert.match(verdict.reason, /catastrophic/);
  assert.match(verdict.reason, /47/);
  assert.match(verdict.reason, /whole number/);
});

test('the validator refuses anything that is not a claim object at all', () => {
  for (const value of [null, undefined, 'a claim', 42, []]) {
    assert.equal(checkClaimSnapshot(value).ok, false, `${JSON.stringify(value)} was read as a claim`);
  }
});
