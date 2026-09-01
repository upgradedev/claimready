/**
 * The shape a rule pack has to be in before this build will read it.
 *
 * ITS OWN FILE, BESIDE policy.test.js, because that file is about what a good pack MEANS: which
 * claim is covered, what the excess is, how two insurers differ. This one is about what a bad pack
 * is not allowed to do. They are different questions and mixing them made the loading section over
 * there hard to read.
 *
 * WHY ANY OF THIS MATTERS. A pack is the one thing on this page that a stranger writes. Every
 * refusal below closes a case where the loader accepted a pack whose meaning it could not know, and
 * src/core/requirements.js then picked one silently, by the accident of which branch of its
 * evaluator is written first. The claimant is asked for the wrong list and nothing anywhere says so.
 * That is the failure this file exists to make impossible.
 *
 * EVERY CASE HERE WAS RUN AGAINST THE OLD LOADER FIRST. Six of them loaded without complaint and the
 * comment on each says what the evaluator then did with it. Four were already refused before this
 * work, and they are pinned here so that a later tidy up cannot quietly drop them. A test whose
 * subject already worked is worth writing when the thing it protects is a refusal.
 *
 * The fixtures on disk are never touched. Every malformed pack below is a deep copy made in memory,
 * so `git status` stays clean while the loader is fed things no shipped pack contains.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  loadPolicyPack,
  planPackManifest,
  PackRefused,
} from '../../src/core/policy.js';
import { packIdentity } from '../../src/core/filing.js';

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

const northwindRaw = readJson('../../fixtures/insurers/northwind.json');
const kestrelRaw = readJson('../../fixtures/insurers/kestrel.json');

/** A fresh deep copy every time, so one test's mutation cannot reach the next one. */
const base = () => JSON.parse(JSON.stringify(northwindRaw));

/** requirements[2] is impact_position, whose `when` is a single leaf. The one to bend. */
const RULE = 2;
const RULE_ID = 'impact_position';

/** Build a pack whose impact_position rule carries the given `when`, and try to load it. */
function withCondition(when) {
  const pack = base();
  pack.requirements[RULE].when = when;
  return () => loadPolicyPack(pack);
}

// ---------------------------------------------------------------------------
// One leaf test, or one group. Never a mixture, and never neither.
// ---------------------------------------------------------------------------

// LOADED BEFORE, AND not_equals WON. On a theft claim the equals half asks for the impact position
// and the not_equals half says do not, and the rule simply vanished from the derived list. Which
// half won was decided by the order of two lines in src/core/requirements.js.
test('a when carrying both equals and not_equals is refused', () => {
  assert.throws(
    withCondition({ field: 'incident_type', equals: 'theft', not_equals: 'theft' }),
    /carries equals and not_equals in one block/,
  );
});

// LOADED BEFORE, AND any_of WON. The all_of arm was never read, in the loader or in the evaluator.
test('a when carrying both any_of and all_of is refused', () => {
  assert.throws(
    withCondition({
      any_of: [{ field: 'incident_type', equals: 'collision' }],
      all_of: [{ field: 'incident_type', equals: 'theft' }],
    }),
    /carries both any_of and all_of/,
  );
});

// LOADED BEFORE, AND is_set WON, so a rule that asked for a field to be empty asked for the reverse.
test('a when carrying both is_set and is_not_set is refused', () => {
  assert.throws(
    withCondition({ field: 'incident_type', is_set: true, is_not_set: true }),
    /carries is_set and is_not_set in one block/,
  );
});

// THE SHARPEST OF THEM. The old checkConditionShape returned as soon as it saw a group key, so the
// leaf sitting beside the group was never looked at, and the claim field check that IS the point of
// this validation was skipped. A pack could name a field that does not exist on any claim and load,
// as long as it wrote a group in the same block.
test('a when carrying a leaf test beside a group is refused, and the smuggled field is caught', () => {
  assert.throws(
    withCondition({
      any_of: [{ field: 'incident_type', equals: 'collision' }],
      field: 'not_a_real_field',
      equals: 'nonsense',
    }),
    /one leaf test or one group, never both/,
  );

  // The same block with the group removed is refused for the OTHER reason, which is what proves the
  // field check was reachable all along and the group key was turning it off.
  assert.throws(
    withCondition({ field: 'not_a_real_field', equals: 'nonsense' }),
    /not a claim field/,
  );
});

test('a group carrying a field of its own is refused', () => {
  assert.throws(
    withCondition({
      field: 'incident_type',
      any_of: [{ field: 'incident_type', equals: 'collision' }],
    }),
    /carries a field beside any_of/,
  );
});

// LOADED BEFORE, and read as "this field has an answer". That is a defensible meaning and it is not
// the loader's to choose: five tests exist and the pack named none of them.
test('a when that names a field and no test is refused', () => {
  assert.throws(
    withCondition({ field: 'incident_type' }),
    /names the field "incident_type" and no test to run on it/,
  );
});

// The evaluator asks whether these are exactly true. Anything else fell through every branch and
// landed on the bare field reading, which is the opposite of what `is_set: false` looks like it says.
test('is_set and is_not_set are refused unless they are exactly true', () => {
  assert.throws(withCondition({ field: 'incident_type', is_set: false }), /It is only ever true/);
  assert.throws(withCondition({ field: 'incident_type', is_not_set: 'yes' }), /It is only ever true/);
  assert.doesNotThrow(withCondition({ field: 'incident_type', is_set: true }));
});

// ALREADY REFUSED BEFORE THIS WORK, by requireString and by the length check. Pinned so that the
// rewrite above cannot have dropped them, and so a later one cannot either.
test('a test with no field, and an empty group, were already refused and still are', () => {
  assert.throws(withCondition({ equals: 'theft' }), /when field must be a non empty string/);
  assert.throws(withCondition({ any_of: [] }), /when any_of is empty/);
  assert.throws(withCondition({ all_of: [] }), /when all_of is empty/);
});

// The rules apply at every depth, because a group is checked by the same function that checks a
// leaf. A pack that hides a contradiction one level down is the version of this defect a careful
// author would actually ship by accident.
test('a condition nested inside a group is held to the same grammar', () => {
  assert.throws(
    withCondition({ any_of: [{ field: 'incident_type', equals: 'theft', not_equals: 'theft' }] }),
    /any_of\[0\] when carries equals and not_equals/,
  );
  assert.throws(
    withCondition({ all_of: [{ field: 'severity', equals: 'structural' }, { field: 'made_up' }] }),
    /all_of\[1\] when watches "made_up", which is not a claim field/,
  );
});

/* ---------------------------------------------------------------------------
 * The two shapes the first pass at this file missed.
 *
 * An adversarial reviewer read the rewrite and found both. Neither is exotic and both are exactly
 * the class the file opens by describing: the loader accepted a pack whose meaning it could not
 * know, and the evaluator then answered something nobody wrote. They are here with the measurement
 * that found them, the same as every case above.
 * ------------------------------------------------------------------------ */

// A HOLE IN A GROUP USED TO MAKE THE GROUP TRUE. checkConditionShape returned early for a null,
// which is right for a rule that carries no condition at all and wrong for a member of a list.
// Measured on the old code: a control any_of answered false on a claim that did not match, and the
// same any_of with a null appended answered TRUE.
test('a group member that is not a condition is refused, while an absent when is still allowed', () => {
  for (const hole of [null, undefined]) {
    assert.throws(
      withCondition({ any_of: [{ field: 'severity', equals: 'structural' }, hole] }),
      /any_of\[1\] is null, which is not a condition/,
      `a ${String(hole)} member loaded`,
    );
  }

  assert.throws(
    withCondition({ all_of: [null] }),
    /all_of\[0\] is null, which is not a condition/,
  );

  // And the thing that must NOT change: a rule with no condition applies to every claim, and that
  // is how both shipped packs write their unconditional rules.
  const pack = base();
  delete pack.requirements[RULE].when;
  const loaded = loadPolicyPack(pack);
  assert.equal(loaded.requirements[RULE].when, null,
    'a rule with no condition still loads, and still means always');
});

// THE FIELD WAS VALIDATED TRIMMED AND STORED RAW, so the loader checked one string and the
// evaluator read another. Measured on the old code with the impact_position rule: written clean it
// fired, written with spaces it did not, and the rule silently never applied to anybody.
test('the field the evaluator reads is the field the loader checked', () => {
  const pack = base();
  pack.requirements[RULE].when = { field: '  incident_type  ', not_equals: 'theft' };
  const loaded = loadPolicyPack(pack);

  assert.equal(loaded.requirements[RULE].when.field, 'incident_type',
    'the stored field is the one that was validated, not the one that was typed');
  assert.equal(loaded.requirements[RULE].when.not_equals, 'theft',
    'and the rest of the condition survives the normalisation');

  // Through a group as well, because that is the path the recursion takes.
  const nested = base();
  nested.requirements[RULE].when = { any_of: [{ field: ' severity ', equals: 'structural' }] };
  const throughGroup = loadPolicyPack(nested);
  assert.equal(throughGroup.requirements[RULE].when.any_of[0].field, 'severity');
});

test('the grammar this build actually ships still loads', () => {
  // Every shape both shipped packs use, written out here rather than assumed, so a rewrite of the
  // grammar that refuses a real pack fails on this line rather than at boot.
  assert.doesNotThrow(withCondition({ field: 'incident_type', equals: 'collision' }));
  assert.doesNotThrow(withCondition({ field: 'incident_type', not_equals: 'theft' }));
  assert.doesNotThrow(withCondition({ field: 'severity', in: ['structural', 'dent'] }));
  assert.doesNotThrow(withCondition({ field: 'vehicle_drivable', equals: false }));
  assert.doesNotThrow(withCondition({
    any_of: [
      { field: 'severity', equals: 'structural' },
      { field: 'incident_type', equals: 'theft' },
    ],
  }));
  assert.doesNotThrow(() => loadPolicyPack(base()));
  assert.doesNotThrow(() => loadPolicyPack(JSON.parse(JSON.stringify(kestrelRaw))));
});

// ---------------------------------------------------------------------------
// satisfied_by names one thing
// ---------------------------------------------------------------------------

// LOADED BEFORE, AND THE FIELD WON. normaliseSatisfiedBy read the field first and returned, so the
// human action was dropped on the floor: never named on the page, never counted as outstanding, and
// the requirement reported itself answered the moment the field was filled.
test('a satisfied_by naming both a field and a human_action is refused', () => {
  const pack = base();
  pack.requirements[0].satisfied_by = {
    field: 'incident_date',
    human_action: 'a person telephones the claims line and reads the date out',
  };
  assert.throws(() => loadPolicyPack(pack), /names both a field and a human_action/);
});

// An empty string is still an author asking for a human action, so it is still the ambiguity.
test('the both check looks at presence, not at whether the value is useful', () => {
  const pack = base();
  pack.requirements[0].satisfied_by = { field: 'incident_date', human_action: '' };
  assert.throws(() => loadPolicyPack(pack), /names both a field and a human_action/);
});

// ALREADY REFUSED BEFORE THIS WORK. Pinned for the same reason as the group checks above.
test('a satisfied_by naming neither was already refused and still is', () => {
  const missing = base();
  delete missing.requirements[0].satisfied_by;
  assert.throws(() => loadPolicyPack(missing), /needs satisfied_by/);

  const useless = base();
  useless.requirements[0].satisfied_by = { note: 'ask them nicely' };
  assert.throws(() => loadPolicyPack(useless), /must name either a claim field or a human_action/);
});

test('one of the two on its own still loads, both ways round', () => {
  const byField = base();
  byField.requirements[0].satisfied_by = { field: 'incident_date' };
  assert.doesNotThrow(() => loadPolicyPack(byField));

  const byAction = base();
  byAction.requirements[0].satisfied_by = { human_action: 'a person signs the form at the branch' };
  assert.doesNotThrow(() => loadPolicyPack(byAction));
});

// ---------------------------------------------------------------------------
// The refusal is a named thing a caller can catch
// ---------------------------------------------------------------------------

// A raw TypeError from somewhere deep tells a caller nothing but a sentence. The page prints that
// sentence, which is fine, but anything that wants to act on the refusal had to match a string.
test('a refused pack throws PackRefused, carrying the pack id and the rule id', () => {
  const pack = base();
  pack.requirements[RULE].when = { field: 'incident_type', equals: 'theft', not_equals: 'theft' };

  let caught = null;
  try {
    loadPolicyPack(pack);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'the malformed pack was accepted, which is the defect this file exists for');
  assert.ok(caught instanceof PackRefused);
  assert.equal(caught.name, 'PackRefused');
  assert.equal(caught.packId, 'northwind');
  assert.equal(caught.ruleId, RULE_ID);
  assert.match(caught.message, /^policy pack: /);
});

// The class widens TypeError rather than replacing it, so every caller and every test written
// against the old behaviour still holds. This is the assertion that keeps that promise.
test('PackRefused is still a TypeError, so nothing that caught one before stops catching it', () => {
  assert.ok(new PackRefused('policy pack: anything at all') instanceof TypeError);
  assert.throws(() => loadPolicyPack(null), TypeError);
});

test('the ids are null where they were genuinely not known, rather than invented', () => {
  // Refused before any id could be read. There is no pack id to report and none is made up.
  let caught = null;
  try {
    loadPolicyPack({ contract: 'claim-intake.v1' });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught.packId, null);
  assert.equal(caught.ruleId, null);

  // Refused over a coverage, which belongs to the pack and to no rule.
  const badCoverage = base();
  delete badCoverage.coverages[0].deductible;
  let overCoverage = null;
  try {
    loadPolicyPack(badCoverage);
  } catch (error) {
    overCoverage = error;
  }
  assert.equal(overCoverage.packId, 'northwind');
  assert.equal(overCoverage.ruleId, null, 'a coverage is not a rule and must not borrow a rule id');
});

test('a rule id does not leak from the rule before it onto a later refusal', () => {
  // The first rule is fine and the third is not. If the origin were not cleared between rules, the
  // refusal below would report date_of_loss.
  const pack = base();
  pack.requirements[RULE].when = { field: 'incident_type' };
  try {
    loadPolicyPack(pack);
    assert.fail('the malformed rule was accepted');
  } catch (error) {
    assert.equal(error.ruleId, RULE_ID);
  }
});

// ---------------------------------------------------------------------------
// The manifest and the file it points at have to agree
// ---------------------------------------------------------------------------

// THE SPLIT THIS CLOSES, MEASURED. src/ui/app.js keys the picker, the borrowed rules banner and the
// tool context's packId on the id in the list of available packs. packIdentity in
// src/core/filing.js reads the id inside the pack file. Point a manifest entry called northwind at
// the kestrel file and the two disagree about whose rules are loaded, so the page's own borrowed
// rules protection reads one identity and the filing refusal reads the other.
test('a pack file whose own id differs from the manifest entry is refused, naming both', () => {
  assert.throws(
    () => loadPolicyPack(JSON.parse(JSON.stringify(kestrelRaw)), { expectedId: 'northwind' }),
    /calls this one "northwind" and the file itself says "kestrel"/,
  );
});

test('the two identity readers disagreed on exactly that pack, which is why it is refused', () => {
  const kestrel = loadPolicyPack(JSON.parse(JSON.stringify(kestrelRaw)));

  // What the page would conclude from the manifest id alone, as src/ui/app.js does.
  const fromManifest = 'northwind' !== 'northwind';
  // What the filing gate concludes from the pack's own id, as packIdentity does.
  const fromPayload = packIdentity(kestrel, { homePackId: 'northwind' }).borrowed;

  assert.equal(fromManifest, false);
  assert.equal(fromPayload, true, 'the two readers really do give opposite answers on this pack');

  // And that state is now unreachable through the loader, which is the fix. Neither reader was
  // changed, because neither of them is wrong.
  assert.throws(
    () => loadPolicyPack(JSON.parse(JSON.stringify(kestrelRaw)), { expectedId: 'northwind' }),
    PackRefused,
  );
});

test('a manifest entry that tells the truth loads, and no expectation still loads', () => {
  assert.doesNotThrow(() => loadPolicyPack(base(), { expectedId: 'northwind' }));
  assert.doesNotThrow(() => loadPolicyPack(base(), { expectedId: '  northwind  ' }));
  assert.doesNotThrow(() => loadPolicyPack(base(), {}));
  assert.doesNotThrow(() => loadPolicyPack(base()));
});

test('the mismatch refusal carries the pack id the FILE states, not the one it was expected to be', () => {
  try {
    loadPolicyPack(JSON.parse(JSON.stringify(kestrelRaw)), { expectedId: 'northwind' });
    assert.fail('the mismatched pack was accepted');
  } catch (error) {
    assert.equal(error.packId, 'kestrel', 'the id on the refusal is the one that was actually read');
  }
});

// ---------------------------------------------------------------------------
// The manifest itself
// ---------------------------------------------------------------------------

test('the manifest the demo ships is clean, and planPackManifest says so', () => {
  const fixture = readJson('../../fixtures/demo-collision.json');
  const planned = planPackManifest(fixture.available_packs);

  assert.equal(planned.length, 2);
  for (const entry of planned) {
    assert.equal(entry.refusal, null, `${entry.id} is refused, and the shipped manifest must not be`);
    assert.ok(entry.path.length > 0);
  }
  assert.deepEqual(planned.map((entry) => entry.id), ['northwind', 'kestrel']);
});

// BOTH COPIES GO, NOT JUST THE SECOND. src/ui/app.js keeps the loaded packs in a Map keyed by this
// id, so the second entry overwrote the first and the picker showed one row where the list named
// two. Which file answered came down to the order the fetches settled in.
test('an id listed twice refuses both copies, and leaves the rest of the list alone', () => {
  const planned = planPackManifest([
    { id: 'harbour', path: './a.json' },
    { id: 'kestrel', path: './kestrel.json' },
    { id: 'harbour', path: './b.json' },
  ]);

  assert.match(planned[0].refusal, /names "harbour" 2 times/);
  assert.match(planned[2].refusal, /names "harbour" 2 times/);
  assert.equal(planned[1].refusal, null, 'one bad pair must not take the whole list down');
  assert.equal(planned.length, 3, 'nothing is dropped, because a row that vanishes tells nobody anything');
});

test('an entry with no id, and one with no file to read, are refused', () => {
  const planned = planPackManifest([
    { path: './orphan.json' },
    { id: 'kestrel' },
    { id: '   ', path: './blank.json' },
  ]);

  assert.match(planned[0].refusal, /states no id/);
  assert.equal(planned[0].id, 'unknown');
  assert.match(planned[1].refusal, /gives no file to read it from/);
  assert.match(planned[2].refusal, /states no id/);
});

test('planPackManifest answers for anything at all, because a sample file is a stranger too', () => {
  assert.deepEqual(planPackManifest(null), []);
  assert.deepEqual(planPackManifest('northwind'), []);
  assert.deepEqual(planPackManifest([]), []);
  assert.equal(planPackManifest([null])[0].refusal.includes('states no id'), true);
});
