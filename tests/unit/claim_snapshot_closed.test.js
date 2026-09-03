/**
 * THE CLAIM CONTRACT IS CLOSED, AND EVERY DOOR THAT MOVES A CLAIM ASKS THE SAME QUESTION.
 *
 * WHAT WAS WRONG. `checkClaimSnapshot` asked about the values sitting under a fixed list of names
 * and never about the object carrying them. So the answer it gave was "every value I recognise is
 * fine", which a reader took for "this is a claim". Measured on a settled draft written to by hand,
 * before this was closed:
 *
 *   evidence_notes = null    snapshot OK (accepted)   lockField THREW TypeError: claim.evidence_notes is not iterable
 *   Map as notes             snapshot OK (accepted)   lockField OK (accepted)
 *   TypedArray as notes      snapshot OK (accepted)   lockField OK (accepted)
 *   unknown own key          snapshot OK (accepted)   lockField OK (accepted)
 *   symbol key               snapshot OK (accepted)   lockField OK (accepted)
 *   accessor property        snapshot OK (accepted)   lockField OK (accepted)
 *   exotic prototype         snapshot OK (accepted)   lockField OK (accepted)
 *   locked = null            snapshot OK (accepted)   lockField THREW TypeError: claim.locked is not iterable
 *   provenance = null        snapshot OK (accepted)   lockField OK, revision 0 -> 1
 *
 * Two shapes of failure, and both are worse than a refusal. The check said the claim was fine and
 * the next writer crashed on it, so the sentence a caller could have read never arrived. Or the
 * check said the claim was fine and the writer advanced the revision on it, which is the one number
 * a later writer trusts to prove it read what it is writing to.
 *
 * AND THE CHECK ITSELF THREW, on the values a refusal is most likely to be about. Every sentence it
 * built went through `JSON.stringify`:
 *
 *   cyclic status              checkClaimSnapshot THREW TypeError: Converting circular structure to JSON
 *   cyclic in locked           checkClaimSnapshot THREW TypeError: Converting circular structure to JSON
 *   cyclic provenance source   checkClaimSnapshot THREW TypeError: Converting circular structure to JSON
 *   bigint revision            checkClaimSnapshot THREW TypeError: Do not know how to serialize a BigInt
 *   throwing getter on driver  checkClaimSnapshot THREW Error: boom
 *
 * A crash is not a refusal. `canFile` and `buildFilingPacket` both turn this verdict into a
 * sentence a person reads beside a button, and neither of them can read a thrown TypeError.
 *
 * WHY THE LAST TEST IN THIS FILE MATTERS MOST. Six exported functions move a claim, and one of them,
 * `noteContextChange`, was never asking. Listing six names in a loop would not stop a seventh door
 * being added without one. So the table below is compared against the module's own exports minus a
 * named list of readers, and a new exported function fails this file at authoring time until
 * somebody says which of the two it is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as claimModule from '../../src/core/claim.js';
import {
  applyPatch,
  checkClaimSnapshot,
  createClaim,
  fileClaim,
  hydrateClaim,
  lockField,
  noteContextChange,
  PATCH_CODES,
  readEvidenceNotes,
  unlockField,
} from '../../src/core/claim.js';
import { FILE_CODES } from '../../src/core/filing.js';
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

/** An object that points back at itself, which is what the old sentence builder choked on. */
function cyclic() {
  const knot = { name: 'knot' };
  knot.self = knot;
  return knot;
}

/** One note in the shape `normaliseNote` writes, so a list of them is a list this page could hold. */
function note(id) {
  return { id, author: 'Halkidiki Panelbeaters', received_at: null, text: `Bumper cracked, ${id}.` };
}

/**
 * Every shape a claim can wear that this page never gave one.
 *
 * These are about the OBJECT rather than about a held answer. tests/unit/claim_snapshot.test.js
 * already covers the values, so nothing here repeats a bad severity or a clock position of 47.
 */
const BAD_SHAPES = {
  'no evidence notes at all': (claim) => { claim.evidence_notes = null; },
  'a Map where the evidence notes belong': (claim) => { claim.evidence_notes = new Map([['a', 1]]); },
  'a typed array where the evidence notes belong': (claim) => { claim.evidence_notes = new Uint8Array([1, 2, 3]); },
  'a Set where the pins belong': (claim) => { claim.locked = new Set(['driver']); },
  'no pin list at all': (claim) => { claim.locked = null; },
  'the pin list missing': (claim) => { delete claim.locked; },
  'no provenance at all': (claim) => { claim.provenance = null; },
  'the provenance missing': (claim) => { delete claim.provenance; },
  'the evidence notes missing': (claim) => { delete claim.evidence_notes; },
  'an own key this page never writes': (claim) => { claim.settlement_amount = 4400; },
  'a symbol key': (claim) => { claim[Symbol('smuggled')] = 'anything'; },
  'a hidden own key': (claim) => {
    Object.defineProperty(claim, 'driver', { value: 'Ann', enumerable: false, configurable: true });
  },
  'a field answered by a getter': (claim) => {
    Object.defineProperty(claim, 'driver', { get() { return 'Ann'; }, configurable: true, enumerable: true });
  },
  'a field answered by a getter that throws': (claim) => {
    Object.defineProperty(claim, 'driver', { get() { throw new Error('boom'); }, configurable: true, enumerable: true });
  },
  'a prototype this page never gives a claim': (claim) => {
    Object.setPrototypeOf(claim, new Proxy({}, {}));
  },
  'a Date where the account of the crash belongs': (claim) => { claim.description = new Date(0); },
  'a note that is not an object': (claim) => { claim.evidence_notes = [null]; },
  'a note carrying a key a note does not have': (claim) => {
    claim.evidence_notes = [{ id: 'n1', author: 'Garage', received_at: null, text: 'Bumper cracked.', priority: 9 }];
  },
  'a note short of a key a note always has': (claim) => {
    claim.evidence_notes = [{ id: 'n1', author: 'Garage', text: 'Bumper cracked.' }];
  },
  'a note whose text is a number': (claim) => {
    claim.evidence_notes = [{ id: 'n1', author: 'Garage', received_at: null, text: 42 }];
  },
  'a note whose received_at is neither text nor null': (claim) => {
    claim.evidence_notes = [{ id: 'n1', author: 'Garage', received_at: new Date(0), text: 'Bumper cracked.' }];
  },
  'a note answering its text from a getter': (claim) => {
    const note = { id: 'n1', author: 'Garage', received_at: null };
    Object.defineProperty(note, 'text', { get() { return 'Bumper cracked.'; }, enumerable: true, configurable: true });
    claim.evidence_notes = [note];
  },
  // A GAP IN A LIST, WHICH IS THE ABSENCE OF A PROPERTY AND SO HAS NO OWN NAME.
  //
  // Nothing in the module could see one. `Object.getOwnPropertyNames` does not report a hole and
  // `forEach`, `map`, `filter` and `some` all step over it, and every walk over a list was one of
  // those two kinds. Measured on the tree before this was closed, on a settled draft:
  //
  //   checkClaimSnapshot on the draft        ok = true, accepted
  //   lockField                              ok = true, revision 0 -> 1
  //   checkClaimSnapshot on what came back   ok = false, evidence_notes[0] is nothing
  //
  // So the check said yes to a claim and no to what the door made out of it, and the claim in
  // between could be filed and sealed while `buildFilingPacket` answered
  // PACKET_REFUSED_UNUSABLE_STATE. Closed to patches, and no packet.
  //
  // THE GAPS ARE AT OFFSETS AND LENGTHS NOTHING IN THE MODULE NAMES. A check that only looked at
  // position 0, or only at a list with nothing at all in it, would pass three of these five.
  'a gap where the first note belongs': (claim) => { claim.evidence_notes = new Array(2); },
  'a gap between two notes': (claim) => {
    const notes = [note('n1'), note('n2'), note('n3')];
    delete notes[1];
    claim.evidence_notes = notes;
  },
  'a note list longer than the notes in it': (claim) => {
    const notes = [note('n1')];
    notes.length = 4;
    claim.evidence_notes = notes;
  },
  'a gap between two pinned fields': (claim) => {
    const pinned = ['driver', 'location', 'witness_name'];
    delete pinned[1];
    claim.locked = pinned;
  },
  'a pin list longer than the pins in it': (claim) => {
    const pinned = ['severity'];
    pinned.length = 3;
    claim.locked = pinned;
  },
  'a claim that points back at itself': (claim) => { claim.status = cyclic(); },
  'a knot in the pin list': (claim) => { claim.locked = [cyclic()]; },
  'a knot where a provenance source belongs': (claim) => { claim.provenance = { driver: cyclic() }; },
  'a knot where the filing time belongs': (claim) => { claim.status = 'filed'; claim.filed_at = cyclic(); },
  'a revision written as a bigint': (claim) => { claim.revision = 1n; },
};

/* --------------------------------------------- 1. the check answers, on every one of them */

test('every shape this page never wrote is refused, and the check never throws saying so', () => {
  for (const [name, mutate] of Object.entries(BAD_SHAPES)) {
    const claim = settledDraft();
    mutate(claim);

    // A cyclic value used to make this throw, and before that it would have hung anything that
    // walked the graph. A hang shows up here as the runner timing this file out.
    let verdict;
    assert.doesNotThrow(() => { verdict = checkClaimSnapshot(claim); }, `${name} made the check throw`);

    assert.equal(verdict.ok, false, `${name} was called usable`);
    assert.ok(verdict.problems.length > 0, `${name} was refused with nothing said`);
    assert.match(verdict.reason, /could not have written/);
    for (const problem of verdict.problems) {
      assert.equal(typeof problem, 'string', `${name} produced a problem that is not a sentence`);
    }
  }
});

test('the refusal names the shape, so a reader is told which one it is', () => {
  const named = {
    'no evidence notes at all': /evidence_notes is null/,
    'a Map where the evidence notes belong': /evidence_notes is a Map/,
    'a typed array where the evidence notes belong': /evidence_notes is a Uint8Array/,
    'a Set where the pins belong': /locked is a Set/,
    'no provenance at all': /provenance is null/,
    'an own key this page never writes': /carries "settlement_amount"/,
    'a symbol key': /carries a symbol key/,
    'a hidden own key': /hides "driver"/,
    'a field answered by a getter': /answers "driver" from a getter or a setter/,
    'a prototype this page never gives a claim': /wears a prototype this page never gives one/,
    'a note whose text is a number': /evidence_notes\[0\]\.text is 42/,
    'a revision written as a bigint': /revision is 1n/,
    'a claim that points back at itself': /status is an object/,
    // The position and the length are both said out loud, because "somewhere in this list there is
    // a gap" is not something a reader can act on. Each of these names a different offset, and the
    // third one is checked on the length sentence rather than the position for the same reason.
    'a gap where the first note belongs': /evidence_notes\[0\] is a gap rather than an entry/,
    'a gap between two notes': /evidence_notes\[1\] is a gap rather than an entry/,
    'a note list longer than the notes in it': /every position from 0 to 3\./,
    'a gap between two pinned fields': /locked\[1\] is a gap rather than an entry/,
    'a pin list longer than the pins in it': /locked\[1\] is a gap rather than an entry/,
  };
  for (const [name, pattern] of Object.entries(named)) {
    const claim = settledDraft();
    BAD_SHAPES[name](claim);
    assert.match(checkClaimSnapshot(claim).reason, pattern, `${name} was refused in the wrong words`);
  }
});

test('a getter that throws is refused rather than run', () => {
  // The descriptors are read before any property is, so this never calls the getter at all. It used
  // to, and the Error travelled straight out of every door on the module.
  const claim = settledDraft();
  let called = 0;
  Object.defineProperty(claim, 'driver', {
    get() { called += 1; throw new Error('boom'); },
    configurable: true,
    enumerable: true,
  });

  const verdict = checkClaimSnapshot(claim);

  assert.equal(verdict.ok, false);
  assert.equal(called, 0, 'the check ran somebody else\'s code to decide whether to trust it');
});

/* ------------------------------------------------ 2. every door, and no door left out */

/**
 * The doors that move a claim, with the refusal each one is contracted to give.
 *
 * THE CODES ARE NOT ALL THE SAME AND MUST NOT BE MADE SO. The five patch shaped doors answer with
 * PATCH_REJECTED_VALUE, because a caller already branches on it. `fileClaim` answers through
 * `canFile` with FILE_REFUSED_UNUSABLE_STATE, which is the code the page draws beside the File
 * button and is part of the published contract. Editing either literal to make one loop simpler
 * would be changing a shipped refusal to suit a test.
 */
const DOORS = {
  applyPatch: {
    invoke: (claim) => applyPatch(claim, { field: 'driver', value: 'Ann Okafor' }, { actor: 'human' }),
    code: PATCH_CODES.value,
  },
  applyPatchBatch: {
    exported: 'applyPatch',
    invoke: (claim) => applyPatch(claim, [
      { field: 'driver', value: 'Ann Okafor' },
      { field: 'location', value: 'Kifisias Avenue' },
    ], { actor: 'human' }),
    code: PATCH_CODES.value,
  },
  lockField: {
    invoke: (claim) => lockField(claim, 'severity'),
    code: PATCH_CODES.value,
  },
  unlockField: {
    invoke: (claim) => unlockField(claim, 'severity'),
    code: PATCH_CODES.value,
  },
  noteContextChange: {
    invoke: (claim) => noteContextChange(claim, 'the page loaded another insurer rule pack'),
    code: PATCH_CODES.value,
  },
  fileClaim: {
    invoke: (claim) => fileClaim(claim, { at: AT, pack: northwind, completedHumanActions: [], ...HOME }),
    code: FILE_CODES.unusableState,
  },
};

test('every door that moves a claim refuses every bad shape, with its own code', () => {
  for (const [doorName, door] of Object.entries(DOORS)) {
    for (const [shapeName, mutate] of Object.entries(BAD_SHAPES)) {
      const claim = settledDraft();
      mutate(claim);
      const where = `${doorName} on ${shapeName}`;

      let result;
      assert.doesNotThrow(() => { result = door.invoke(claim); }, `${where} threw`);

      assert.equal(result.ok, false, `${where} was accepted`);
      assert.equal(result.code, door.code, `${where} gave the wrong code`);
      assert.match(result.error, /could not have written/, `${where} said the wrong thing`);
    }
  }
});

test('and a refusal leaves the object, the revision and the state exactly as they were', () => {
  for (const [doorName, door] of Object.entries(DOORS)) {
    for (const [shapeName, mutate] of Object.entries(BAD_SHAPES)) {
      const claim = settledDraft();
      mutate(claim);
      const where = `${doorName} on ${shapeName}`;

      // The revision is read off the object rather than serialised, because half of these claims
      // cannot be serialised at all, which is the whole reason they are here.
      const revisionBefore = claim.revision;
      const statusBefore = claim.status;
      const severityBefore = claim.severity;

      const result = door.invoke(claim);

      assert.equal(result.claim, claim, `${where} handed back a different object`);
      assert.equal(claim.revision, revisionBefore, `${where} moved the revision`);

      // The reported number is the claim's own, except where the claim is refused for holding a
      // revision that is not a whole number. `currentRevision` answers 0 for one of those, which is
      // a fallback for a value nobody can quote rather than a claim about where the draft is, and
      // it is the same fallback every refusal in this module has always used.
      if (Number.isInteger(revisionBefore)) {
        assert.equal(result.revision, revisionBefore, `${where} reported a moved revision`);
      }
      assert.equal(claim.status, statusBefore, `${where} changed the status`);
      assert.equal(claim.severity, severityBefore, `${where} changed a field`);
    }
  }
});

test('and the ordinary journey is untouched, which is what a check that refuses everything would cost', () => {
  // A gate that says no to every claim is not a fix. Each door is asked once on a clean draft.
  const patched = applyPatch(settledDraft(), { field: 'driver', value: 'Ann Okafor' }, { actor: 'human' });
  assert.equal(patched.ok, true, patched.error);
  assert.equal(patched.revision, 2);

  const pinned = lockField(patched.claim, 'severity');
  assert.equal(pinned.ok, true, pinned.error);
  assert.equal(pinned.revision, 3);

  const unpinned = unlockField(pinned.claim, 'severity');
  assert.equal(unpinned.ok, true, unpinned.error);
  assert.equal(unpinned.revision, 4);

  const noted = noteContextChange(unpinned.claim, 'the page loaded another insurer rule pack');
  assert.equal(noted.ok, true, noted.error);
  assert.equal(noted.revision, 5);

  const filed = fileClaim(noted.claim, { at: AT, pack: northwind, completedHumanActions: [], ...HOME });
  assert.equal(filed.ok, true, filed.error);
  assert.equal(filed.claim.status, 'filed');
  assert.equal(filed.claim.filed_at, AT);
});

/* ---------------------------------------------------- 3. the readers, named once */

/**
 * The exported functions that read a claim and never move one.
 *
 * `hydrateClaim` and `createClaim` are on this list although both produce a claim, because neither
 * takes one this page already holds and hands back a moved version of it. They are doors IN, they
 * refuse by throwing, and tests/unit/claim_snapshot.test.js covers that. `checkClaimSnapshot` is
 * the check itself.
 */
const READERS = [
  'checkClaimSnapshot',
  'createClaim',
  'describeClaim',
  'filedRevisionOf',
  'hydrateClaim',
  'isCalendarDate',
  'isFilingInstant',
  'isIsoDate',
  'isLocked',
  'patchIsNoChange',
  'provenanceOf',
  'readEvidenceNotes',
  'requiredFieldsFor',
  'validateClaim',
  'verifyFilingContext',
  'wasFiledHere',
];

/* ------------------- 4. the check and the doors have to agree about one claim */

/**
 * Shapes a claim is allowed to wear, so the test below is about agreement and not about refusing.
 *
 * A check that says no to everything agrees with every door and closes nothing. These five are the
 * control, and the test counts them.
 */
const ACCEPTED_SHAPES = {
  'nothing attached to it': (claim) => { claim.evidence_notes = []; },
  'one note': (claim) => { claim.evidence_notes = [note('n1')]; },
  'three notes': (claim) => { claim.evidence_notes = [note('n1'), note('n2'), note('n3')]; },
  'two fields pinned': (claim) => { claim.locked = ['driver', 'location']; },
  'a note that arrived at a known time': (claim) => {
    claim.evidence_notes = [{ ...note('n1'), received_at: '2026-08-21T09:00:00.000Z' }];
  },
};

test('what the check accepts a door hands back accepted, and what it refuses no door moves', () => {
  // THE RULE THE GAP BROKE, WRITTEN AS THE RULE RATHER THAN AS THE CASE. A gate that accepts an
  // input and refuses the output of a door fed that same input is worse than one that refuses
  // both: the claim in between is filed, sealed, closed to patches, and its packet can never be
  // built. That is one property over the whole table, so the next shape somebody adds is held to
  // it without a case being written for it.
  let accepted = 0;

  for (const [name, mutate] of Object.entries({ ...ACCEPTED_SHAPES, ...BAD_SHAPES })) {
    const claim = settledDraft();
    mutate(claim);

    const verdict = checkClaimSnapshot(claim);
    const moved = lockField(claim, 'vehicle_drivable');

    if (!verdict.ok) {
      assert.equal(moved.ok, false, `${name} was refused by the check and moved by a door anyway`);
      continue;
    }

    accepted += 1;
    assert.equal(moved.ok, true, `${name} was accepted by the check and refused by a door: ${moved.error}`);
    assert.equal(
      checkClaimSnapshot(moved.claim).ok,
      true,
      `${name} was accepted, and the claim the door made out of it is refused`,
    );
  }

  assert.equal(
    accepted,
    Object.keys(ACCEPTED_SHAPES).length,
    `the table has to hold shapes the check accepts or this proves nothing, and it accepted ${accepted}`,
  );
});

test('a stored note list with a gap in it is read back with a note at every position', () => {
  // `normaliseNotes` went through `map`, which copies a hole across as a hole, so this door handed
  // back a sparse list and the check let it through. Measured on the tree before it changed,
  // hydrating a stored claim whose evidence_notes was `new Array(2)`:
  //
  //   hydrateClaim notes: length 2, and `0 in notes` was false
  //
  // The gap is at a position the list did not start at, so a reader that only fills position 0
  // fails here.
  const stored = { ...createClaim({}), evidence_notes: new Array(3) };
  stored.evidence_notes[2] = note('n3');

  const hydrated = hydrateClaim(stored);

  assert.equal(hydrated.evidence_notes.length, 3);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(index in hydrated.evidence_notes, `position ${index} came back as a gap`);
  }
  assert.equal(hydrated.evidence_notes[2].text, note('n3').text, 'the note that was there was lost');
  assert.equal(hydrated.evidence_notes[0].id, 'note-1');
  assert.equal(hydrated.evidence_notes[0].text, '');
  assert.equal(
    checkClaimSnapshot(hydrated).ok,
    true,
    'a door into a claim handed back one its own check refuses',
  );
});

test('the notes a reader is handed have something at every position', () => {
  // read_evidence_notes publishes this list to a model, and a gap in it is a position that
  // disappears from every walk on the other side too.
  const claim = { ...createClaim({}), evidence_notes: [note('n1'), note('n2')] };
  claim.evidence_notes.length = 4;

  const read = readEvidenceNotes(claim);

  assert.equal(read.length, 4);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(index in read, `position ${index} was handed to a reader as a gap`);
    assert.equal(typeof read[index].text, 'string');
  }
  assert.equal(read[1].text, note('n2').text);
  assert.equal(read[3].author, 'unknown');
});

/* --------------- 5. a name on a claim is a name somebody else can be made to answer */

/**
 * EVERY NAME A CLAIM CARRIES, TAKEN OFF A CLAIM RATHER THAN WRITTEN OUT HERE.
 *
 * WHAT WAS STILL OPEN AFTER THE ACCESSOR GATE WENT IN. `checkClaimSnapshot` stopped reading
 * properties, and every door went on reading `claim.revision` through `currentRevision` on its
 * REFUSAL path, which is the one line that runs when the gate has just said no. Measured on the
 * tree before this closed, with a getter on `revision` that throws:
 *
 *   checkClaimSnapshot  refused, and read no property at all
 *   applyPatch          THREW Error: boom
 *   lockField           THREW Error: boom
 *   unlockField         THREW Error: boom
 *   noteContextChange   THREW Error: boom
 *   fileClaim           THREW Error: boom
 *
 * The gate had been moved, not closed. So this asks every door about every name a claim carries
 * rather than about the one name the defect was found on, and the list of names comes from a claim
 * this module built, so a field added to the contract is covered on the commit that adds it. The
 * last name is not on the contract at all, so the table is not purely the module talking to itself.
 */
const CLAIM_NAMES = [...Object.keys(createClaim({})), 'settlement_amount'];

test('every door refuses a claim that answers any of its own names from a getter, without running it', () => {
  // THE DOORS COME FROM THE SAME TABLE THE REST OF THIS FILE USES, and that table is held to the
  // module's own export list by the last test in this file. So a seventh door is asked this
  // question on the commit that adds it, without anybody adding a case here.
  const cleanRevision = settledDraft().revision;
  let checked = 0;

  for (const name of CLAIM_NAMES) {
    for (const [doorName, door] of Object.entries(DOORS)) {
      const claim = settledDraft();
      let called = 0;
      Object.defineProperty(claim, name, {
        get() { called += 1; throw new Error('boom'); },
        configurable: true,
        enumerable: true,
      });
      const where = `${doorName} on a throwing getter over "${name}"`;

      let result;
      assert.doesNotThrow(() => { result = door.invoke(claim); }, `${where} threw`);

      assert.equal(result.ok, false, `${where} was accepted`);
      assert.equal(result.code, door.code, `${where} gave the wrong code`);
      assert.equal(result.claim, claim, `${where} handed back a different object`);
      assert.equal(called, 0, `${where} ran the getter ${called} times`);

      // The counter is reported as 0 only where the counter itself is the thing nobody can read,
      // which is the documented fallback. Everywhere else the door still quotes the real number.
      assert.equal(
        result.revision,
        name === 'revision' ? 0 : cleanRevision,
        `${where} reported the wrong revision`,
      );
      checked += 1;
    }
  }

  assert.equal(checked, CLAIM_NAMES.length * Object.keys(DOORS).length, 'the loop skipped a pair');
});

test('the counter a door quotes on a refusal is read off the descriptor and never asked for', () => {
  // The measurement that showed the gate had only moved: a counting getter stood at 0 after
  // `checkClaimSnapshot` and at 2 after one `lockField` refusal, because the refusal was built from
  // `claim.revision`. The number this one hands back is neither the fallback nor the claim's own,
  // so a door that asks for it fails on the reported revision as well as on the count.
  const claim = settledDraft();
  let called = 0;
  Object.defineProperty(claim, 'revision', {
    get() { called += 1; return 41; },
    configurable: true,
    enumerable: true,
  });

  assert.equal(checkClaimSnapshot(claim).ok, false);
  assert.equal(called, 0, `the check asked for the counter ${called} times`);

  const pinned = lockField(claim, 'severity');

  assert.equal(pinned.ok, false);
  assert.equal(called, 0, `the refusal path asked for the counter ${called} times`);
  assert.equal(pinned.revision, 0, 'a counter nobody can quote is reported as something else');
});

/* --------------------------------------------- 6. the door nobody remembered to add */

test('every exported function is either a reader or a door this file already tests', () => {
  // THIS IS THE POINT OF THE FILE. `noteContextChange` was a door that asked nothing, and it stayed
  // that way because the surface was only ever checked as a list somebody had written out by hand.
  // Comparing the table against the module's own exports means a seventh door fails here on the
  // commit that adds it, and whoever adds it has to say which of the two it is.
  const exported = Object.entries(claimModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();

  const covered = [...new Set(
    Object.entries(DOORS).map(([name, door]) => door.exported ?? name),
  )];
  const classified = [...covered, ...READERS].sort();

  assert.deepEqual(
    exported,
    classified,
    'an exported function on src/core/claim.js is neither in DOORS nor in READERS. '
    + 'If it moves a claim, add it to DOORS with the refusal code it gives. If it only reads one, '
    + 'add it to READERS.',
  );
});
