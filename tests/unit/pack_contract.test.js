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
  PACK_CONTRACT,
} from '../../src/core/policy.js';
import {
  PATCHABLE_FIELDS,
  INCIDENT_TYPES,
  SEVERITIES,
  DAMAGE_ZONES,
} from '../../src/core/claim.js';
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

/**
 * THE SPLIT IS NOW FIXED RATHER THAN ONLY UNREACHABLE, AND THIS IS WHAT KEEPS IT THAT WAY.
 *
 * The loader refusal above makes the disagreement impossible to reach, which is worth having and is
 * not the same as the two readers agreeing. Drop the `expectedId` argument tomorrow, for any reason
 * at all, and the old split comes straight back, because the page and the gate would still be
 * reading two different names for one pack.
 *
 * So they read one answer. `packIdentity` decides the pack's identity from the pack file, and both
 * surfaces that used to decide it for themselves now call it: src/ui/app.js for `context.packId`
 * and the borrowed rules banner, and src/webmcp/tools/check_coverage.js for the line it prints to a
 * model. This test reads the source, the way tests/unit/packet_is_not_a_tool.test.js does, because
 * the thing being protected is that nobody writes the comparison out by hand again.
 */
test('the page and the tool decide whose rules these are by calling packIdentity, not by hand', () => {
  // SELECTED BY PATH, AND THE COUNT IS ASSERTED. A check that finds its files by searching their
  // text stops covering a file the moment somebody renames or moves it, and reports PASS over a
  // set that has quietly shrunk. These two paths are named, and the number actually read is checked
  // against the number expected.
  const paths = ['../../src/ui/app.js', '../../src/webmcp/tools/check_coverage.js'];
  const scanned = paths.map((relative) => ({
    name: relative.replace('../../', ''),
    source: readFileSync(new URL(relative, import.meta.url), 'utf8'),
  }));
  assert.equal(scanned.length, 2, 'both identity readers have to be in the scan');

  for (const { name, source } of scanned) {
    // The positive half, and it is the half that carries the weight. Each file imports the one
    // function that answers this and calls it. Rename or delete the import and this fails.
    assert.match(source, /import \{[^}]*packIdentity[^}]*\} from/, `${name} no longer imports packIdentity`);
    assert.match(source, /packIdentity\(/, `${name} imports it and never calls it`);

    // The negative half, and it is best effort rather than a proof. It catches the shape that was
    // actually there, a comparison with homePackId on one side of it, in code rather than in a
    // comment. It would not catch the same comparison written through a local alias, so it is a
    // tripwire on the obvious spelling and the import assertion above is what actually holds.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.doesNotMatch(
      code,
      /homePackId\s*[!=]==?|[!=]==?\s*(ctx\.|context\.)?homePackId/,
      `${name} compares the home pack id by hand again, which is the split coming back`,
    );
  }
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

/* ---------------------------------------------------------------------------
 * VALUES, not only shapes.
 *
 * Everything above this line is about the GRAMMAR of a pack: one leaf test or one group, one thing
 * that answers a requirement, one file per id. A pack can satisfy every one of those rules and
 * still say something no claim on this page can ever match, or something the page reads out to a
 * claimant as a fact about their policy while the file says the opposite.
 *
 * Every case below was run against the loader as it stood before this section existed. The comment
 * on each says what loaded and what the page or the tool surface then did with it. Two of them were
 * already refused, and those say so: they are pinned here so a later tidy up cannot quietly drop
 * them, which is the convention the top of this file already follows.
 *
 * The fixtures on disk are never touched. Every pack below is a deep copy bent in memory.
 * ------------------------------------------------------------------------ */

/** Build a pack with one coverage bent, and try to load it. */
function withCoverage(index, bend) {
  const pack = base();
  bend(pack.coverages[index]);
  return () => loadPolicyPack(pack);
}

/**
 * Run a load that must be refused, and hand the refusal back.
 *
 * assert.throws answers undefined, not the error it caught, so a test that wants to read the
 * message or the ids has to catch for itself. Doing it here once keeps that out of every test that
 * needs more than "it threw".
 */
function refusalFrom(load) {
  try {
    load();
  } catch (error) {
    return error;
  }
  return assert.fail('the pack loaded, and this test exists because it must not');
}

/** Build a pack with the period bent, and try to load it. */
function withPeriod(bend) {
  const pack = base();
  bend(pack.period);
  return () => loadPolicyPack(pack);
}

/** northwind's coverages, by position. 0 is in force, 3 is the theft section it does not carry. */
const OWN_DAMAGE = 0;
const THIRD_PARTY = 2;
const THEFT = 3;

// ---------------------------------------------------------------------------
// A section is in force, or it is not. Nothing in between.
// ---------------------------------------------------------------------------

// LOADED BEFORE, AND THE PAGE PRINTED THE OPPOSITE OF THE FILE. The old line read
// `active: entry.active === true`, so anything that was not the boolean true became false without a
// word. Measured on a deep copy of northwind with own_damage bent: `active: "true"` loaded, and
// coverFacts answered in_force false, excess null, on the section the file puts in force. That is
// the internal answer every cover decision is built from, so a section the file puts in force is
// read as out of force. An earlier version of this comment said the value reached an agent through
// a tool called get_coverage_facts. There is no such tool in this build, the cover tool is
// check_coverage, and a reviewer caught the name. The defect is real at the layer named here.
test('a coverage whose active is not a boolean is refused, because the page would report the reverse', () => {
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.active = 'true'; }), /writes active: "true"/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.active = 1; }), /writes active: 1/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.active = 'false'; }), /writes active: "false"/);
  // AN ABSENT KEY IS REPORTED AS ABSENT, not as one written null. An author sent looking for an
  // "active": null line their file does not contain is the same wrong turn the NaN test below pins.
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { delete c.active; }), /states no active flag/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.active = null; }), /writes active: null/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.active = 'true'; }), PackRefused);

  // Both values a schedule can actually mean still load, which is the half that must not move.
  assert.doesNotThrow(withCoverage(OWN_DAMAGE, (c) => { c.active = true; }));
  assert.doesNotThrow(withCoverage(THEFT, (c) => { c.active = false; }));
});

// ---------------------------------------------------------------------------
// The excess is a number a claimant plans around
// ---------------------------------------------------------------------------

// ALL THREE LOADED BEFORE, and coverFacts carried each one out to the tool surface as `excess`:
// -250, Infinity and NaN respectively. typeof NaN is number, which is how it walked through the old
// check untouched.
test('a deductible that is not a usable amount is refused', () => {
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.deductible = -250; }), /never below zero/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.deductible = Infinity; }), /writes deductible: Infinity/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.deductible = NaN; }), /writes deductible: NaN/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.deductible = null; }), /active but names no deductible/);
});

// THE REFUSAL SAYS WHAT THE AUTHOR WROTE. JSON.stringify renders both Infinity and NaN as the word
// null, so a message built on it sent a pack author looking for a key that was not the problem.
test('the refusal names the value that was written, not what JSON.stringify makes of it', () => {
  const thrown = refusalFrom(withCoverage(OWN_DAMAGE, (c) => { c.deductible = NaN; }));
  assert.ok(!/deductible: null/.test(thrown.message), 'NaN was reported back to the author as null');
  assert.match(thrown.message, /deductible: NaN/);
});

// PARTLY A PIN. On an ACTIVE section a string deductible was already refused, by the older rule
// three lines further down, which said the section named no deductible at all. It is refused here
// for the accurate reason instead. On an INACTIVE section nothing caught it: measured on northwind's
// theft section, `deductible: "400"` loaded and the pack came back holding null where the file said
// 400.
test('a deductible written as a string is refused on an inactive section too', () => {
  assert.throws(withCoverage(THEFT, (c) => { c.deductible = '400'; }), /writes deductible: "400"/);
  assert.throws(withCoverage(OWN_DAMAGE, (c) => { c.deductible = '250'; }), /writes deductible: "250"/);
});

// THE HALF THAT MUST NOT MOVE, checked against both shipped files before anything above was
// tightened. A section with no excess is an ordinary section and both packs ship one.
test('a deductible of exactly 0 stays legal, and both shipped packs rely on it', () => {
  assert.doesNotThrow(withCoverage(OWN_DAMAGE, (c) => { c.deductible = 0; }));

  const zeroes = [];
  for (const raw of [northwindRaw, kestrelRaw]) {
    const pack = loadPolicyPack(JSON.parse(JSON.stringify(raw)));
    for (const coverage of pack.coverages) {
      if (coverage.deductible === 0) zeroes.push(`${pack.id}/${coverage.code}`);
    }
  }
  assert.ok(zeroes.length >= 2,
    `a rule refusing a zero excess would refuse the shipped packs, which use it at ${zeroes.join(', ')}`);
});

// ---------------------------------------------------------------------------
// A section applies to incidents a claim can actually declare
// ---------------------------------------------------------------------------

// LOADED BEFORE, and coverFacts carried "banana" out in applies_to, so the published tool surface
// offered an agent a category no claim can be. checkCoverage then matched it against nothing for
// ever, which reads on the page as a section that covers no incident at all.
test('a coverage that applies to an incident no claim can declare is refused', () => {
  assert.throws(
    withCoverage(OWN_DAMAGE, (c) => { c.incident_types = ['collision', 'banana']; }),
    /applies to "banana", which is not an incident a claim can declare/,
  );
  assert.throws(
    withCoverage(OWN_DAMAGE, (c) => { c.incident_types = ['Collision']; }),
    /applies to "Collision"/,
  );
  // Every incident the claim layer knows is still accepted, read from the claim layer's own list.
  //
  // THE OTHER SECTIONS ARE EMPTIED FIRST, AND THAT IS NOT A SOFTENING. northwind's glass and theft
  // sections name glass and theft, so handing own_damage the whole list makes three sections claim
  // one incident each, which the overlap rule below now refuses for its own reason. The subject of
  // this test is whether each incident NAME is accepted, so the pack is built to ask only that.
  assert.doesNotThrow(() => {
    const pack = base();
    for (const coverage of pack.coverages) coverage.incident_types = [];
    pack.coverages[OWN_DAMAGE].incident_types = [...INCIDENT_TYPES];
    return loadPolicyPack(pack);
  });
});

// THE OTHER HALF THAT MUST NOT MOVE. Third party liability is not written against an incident
// category at all, and both shipped packs give it an empty list.
test('an empty incident_types stays legal, and both shipped packs rely on that too', () => {
  assert.doesNotThrow(withCoverage(THIRD_PARTY, (c) => { c.incident_types = []; }));
  for (const raw of [northwindRaw, kestrelRaw]) {
    const pack = loadPolicyPack(JSON.parse(JSON.stringify(raw)));
    const empty = pack.coverages.filter((coverage) => coverage.incident_types.length === 0);
    assert.equal(empty.length, 1, `${pack.id} ships exactly one section with no incident list`);
  }
});

// ---------------------------------------------------------------------------
// One incident, one section. Two sections claiming it is the file deciding by order
// ---------------------------------------------------------------------------

// LOADED BEFORE, AND THE ORDER OF THE FILE DECIDED THE EXCESS. findCoverage in src/core/coverage.js
// picks a section with Array.find, so the first entry naming the incident wins and every later one
// is never read. Measured on a deep copy of northwind with a second glass section added, against a
// glass claim on 2026-08-23:
//
//   glass written first             clause GL-2.3, excess 0
//   windscreen_extra written first  clause WX-1.1, excess 900
//
// Same pack, same claim, two answers, and the only difference is which line the author typed first.
// The excess is the number a claimant plans around, so a file that does not say which section
// answers is a file this build cannot read out.
test('two sections claiming one incident type are refused, because order would decide the excess', () => {
  const overlapping = () => {
    const pack = base();
    pack.coverages.push({
      code: 'windscreen_extra',
      label: 'Windscreen extra',
      clause: 'WX-1.1',
      active: true,
      deductible: 900,
      incident_types: ['glass'],
    });
    return loadPolicyPack(pack);
  };

  assert.throws(overlapping, /writes the incident "glass" into both the "glass" and the "windscreen_extra" sections/);
  assert.throws(overlapping, PackRefused);

  const refusal = refusalFrom(overlapping);
  assert.equal(refusal.packId, 'northwind', 'the refusal names the pack it came from');

  // A section that names the incident twice inside its own list is the same ambiguity written
  // shorter, and it was accepted too.
  assert.throws(
    withCoverage(OWN_DAMAGE, (c) => { c.incident_types = ['collision', 'collision']; }),
    /writes the incident "collision" into the "own_damage" section twice/,
  );
});

// THE HALF THAT MUST NOT MOVE. Both shipped packs give several sections several incidents each and
// none of them collide, so a rule this strict still reads the files this build ships with.
test('the shipped packs still load, and every incident they name belongs to one section', () => {
  for (const raw of [northwindRaw, kestrelRaw]) {
    const pack = loadPolicyPack(JSON.parse(JSON.stringify(raw)));
    const claimed = pack.coverages.flatMap((coverage) => coverage.incident_types);
    assert.equal(new Set(claimed).size, claimed.length, `${pack.id} names one incident under two sections`);
    assert.ok(claimed.length >= 4, `${pack.id} has to name enough incidents for this to be worth asserting`);
  }
});

// ---------------------------------------------------------------------------
// One excluded driver, one row
// ---------------------------------------------------------------------------

// LOADED BEFORE, AND ONE PERSON WAS COUNTED AS TWO. normaliseExcludedDriver trims the name and stops
// there, while findExcludedDriver in src/core/coverage.js matches on trim AND lower case, so two
// spellings of one name are one person to the cover check and two people to everything that counts
// rows. Measured on a deep copy of northwind carrying a second row for "  nikos p.  ":
//
//   excluded_drivers loaded as  [["Nikos P.","EX-9.1"],["nikos p.","EX-9.7"]]
//   a claim naming Nikos P.     refused under clause EX-9.1, because find stops at the first row,
//                               so which clause the claimant is shown depends on the row order
//   a claim naming nobody       "this policy excludes 2 named drivers under clauses EX-9.1, EX-9.7"
//
// The last line is the one a claimant reads. It tells them the policy shuts out two people it does
// not, and it cites a clause that can never be the one that fires.
test('one excluded driver written twice is refused, however the second row is spelled', () => {
  const twice = (name) => () => {
    const pack = base();
    pack.excluded_drivers.push({ name, clause: 'EX-9.7', reason: 'A second row for the same person.' });
    return loadPolicyPack(pack);
  };

  assert.throws(twice('  nikos p.  '), /names "Nikos P\." as an excluded driver twice/);
  assert.throws(twice('Nikos P.'), /names "Nikos P\." as an excluded driver twice/);
  assert.throws(twice('NIKOS P.'), /names "Nikos P\." as an excluded driver twice/);
  assert.throws(twice('nikos p.'), PackRefused);
});

// THE HALF THAT MUST NOT MOVE. Two different people are two rows, and a pack that excludes nobody
// is still an ordinary pack. Both shipped files depend on one of those.
test('two different excluded drivers stay legal, and so does excluding nobody', () => {
  assert.doesNotThrow(() => {
    const pack = base();
    pack.excluded_drivers.push({ name: 'Nikos Papadopoulos', clause: 'EX-9.7', reason: 'A different person.' });
    return loadPolicyPack(pack);
  });
  assert.doesNotThrow(() => {
    const pack = base();
    pack.excluded_drivers = [];
    return loadPolicyPack(pack);
  });
  assert.deepEqual(loadPolicyPack(JSON.parse(JSON.stringify(kestrelRaw))).excluded_drivers, [],
    'the kestrel pack excludes nobody, and a rule about duplicates may not change that');
});

// ---------------------------------------------------------------------------
// The policy period is two dates, in that order
// ---------------------------------------------------------------------------

// LOADED BEFORE, AND THE COVER ANSWER WAS DECIDED ALPHABETICALLY. src/core/coverage.js asks
// `date >= start && date <= end` on three strings, which is chronological only while all three are
// YYYY-MM-DD. Measured with start set to "the first of January": the pack loaded and a claim inside
// the real period was answered by comparing "2026-06-15" against that sentence.
test('a period that is not two real dates is refused', () => {
  assert.throws(withPeriod((p) => { p.start = 'the first of January'; }), /not a real day written as YYYY-MM-DD/);
  assert.throws(withPeriod((p) => { p.end = '2026-13-01'; }), /not a real day written as YYYY-MM-DD/);
  assert.throws(withPeriod((p) => { p.end = '2026-02-30'; }), /not a real day written as YYYY-MM-DD/);
  assert.throws(withPeriod((p) => { p.start = '01/01/2026'; }), /not a real day written as YYYY-MM-DD/);

  // ALREADY REFUSED BEFORE THIS WORK, by requireString. Pinned so the rewrite cannot have dropped it.
  assert.throws(withPeriod((p) => { p.start = 20260101; }), /period start must be a non empty string/);

  // A pack that states no period at all is still allowed. coverage.js treats the question as moot
  // and says so in its own comment, so this is not a hole.
  const noPeriod = base();
  delete noPeriod.period;
  assert.equal(loadPolicyPack(noPeriod).period, null);
});

// THE WORSE ONE, because it looks like a typo and reads as a decision. Measured with the two dates
// swapped: the pack loaded, and a claim dated inside the real period came back NOT COVERED carrying
// the period clause, so the page told a claimant their loss fell outside a policy that was running
// on the day.
test('a period whose start is after its end is refused', () => {
  assert.throws(withPeriod((p) => { p.start = '2026-12-31'; p.end = '2026-01-01'; }), /which is backwards/);

  // One day long is not backwards, and must keep loading.
  assert.doesNotThrow(withPeriod((p) => { p.start = '2026-05-05'; p.end = '2026-05-05'; }));
});

// ---------------------------------------------------------------------------
// A condition compares a field against something that field can hold
// ---------------------------------------------------------------------------

// EVERY ONE OF THESE LOADED BEFORE, and none of them says anything on the page. The evaluator in
// src/core/requirements.js compares with === and with Array.includes, so a value of the wrong type
// or the wrong spelling never matches and the requirement silently is not there. Measured on
// northwind's impact_position rule against a theft claim: the rule vanished for the first five, and
// on the not_equals below it fired for everybody.
test('an operand no claim field can hold is refused, and the check knows which field', () => {
  assert.throws(withCondition({ field: 'incident_type', equals: 'banana' }), /which no claim can ever hold/);
  assert.throws(withCondition({ field: 'severity', equals: 'banana' }), /severity is one of scratch, dent, structural/);
  assert.throws(withCondition({ field: 'damage_zone', equals: 47 }), /damage_zone is a whole clock position from 1 to 12/);
  assert.throws(withCondition({ field: 'vehicle_drivable', equals: 'false' }), /vehicle_drivable is true or false/);
  assert.throws(withCondition({ field: 'incident_date', equals: 'yesterday' }), /which no claim can ever hold/);

  // not_equals is held to the same list. A rule that excludes a value nothing can be is a rule that
  // applies to every claim, which is the loudest version of this defect rather than the quietest.
  assert.throws(withCondition({ field: 'incident_type', not_equals: 'banana' }), /which no claim can ever hold/);
});

// THE TWO A CAREFUL AUTHOR ACTUALLY SHIPS BY ACCIDENT, and both were measured loading. The claim
// layer lower cases every incident type and holds the impact position as a number, and a pack is
// written by hand.
test('a capitalised enum and a numeric field written as a string are refused', () => {
  assert.throws(withCondition({ field: 'incident_type', equals: 'Theft' }), /against "Theft"/);
  assert.throws(withCondition({ field: 'damage_zone', equals: '3' }), /against "3"/);
  assert.throws(withCondition({ field: 'severity', in: ['Structural'] }), /against "Structural"/);
});

// THE CHECK IS FIELD AWARE, which is the whole point: the same value is sense on one field and
// nonsense on the next. If this ever collapses into one "is it a scalar" test, this is the line
// that goes red.
test('what is valid for one field is refused on another', () => {
  assert.doesNotThrow(withCondition({ field: 'damage_zone', equals: 3 }));
  assert.throws(withCondition({ field: 'severity', equals: 3 }), /severity is one of/);

  assert.doesNotThrow(withCondition({ field: 'vehicle_drivable', equals: false }));
  assert.throws(withCondition({ field: 'incident_type', equals: false }), /incident_type is one of/);

  assert.doesNotThrow(withCondition({ field: 'severity', equals: 'structural' }));
  assert.throws(withCondition({ field: 'damage_zone', equals: 'structural' }), /damage_zone is a whole clock position/);
});

// LOADED BEFORE, AND THE RULE THEN FIRED FOR EVERY CLAIM, because no claim value is ever === an
// object. The equals half was the mirror image: it fired for nobody.
test('an object or a list where one value belongs is refused', () => {
  assert.throws(withCondition({ field: 'incident_type', equals: { x: 1 } }), /against an object/);
  assert.throws(withCondition({ field: 'incident_type', equals: ['theft'] }), /against a list/);
  assert.throws(withCondition({ field: 'incident_type', not_equals: { x: 1 } }), /against an object/);
  assert.throws(withCondition({ field: 'incident_type', not_equals: ['theft'] }), /against a list/);

  const thrown = refusalFrom(withCondition({ field: 'incident_type', equals: ['theft'] }));
  assert.match(thrown.message, /For several values write in/,
    'the refusal has to point at the operator that does take a list');
});

// LOADED BEFORE, and read as a comparison against nothing. There are two operators for the question
// "has this field been answered", and a null equals is neither of them.
test('a null operand is refused, and points at the two operators that ask about emptiness', () => {
  assert.throws(withCondition({ field: 'incident_type', equals: null }), /is_not_set: true/);
  assert.throws(withCondition({ field: 'severity', not_equals: null }), /is_set: true/);
});

// LOADED BEFORE, and the rule applied to nobody, for ever. A field is never one of nothing.
test('an empty in list is refused', () => {
  assert.throws(withCondition({ field: 'incident_type', in: [] }), /when in is an empty list/);
});

// ONE BAD MEMBER IS ENOUGH, and the refusal names which one. An `in` that is right four times and
// wrong once is the version of this a reviewer misses.
test('every member of an in list is checked, and the refusal names the position', () => {
  assert.throws(
    withCondition({ field: 'severity', in: ['structural', 'banana'] }),
    /when in\[1\] compares severity against "banana"/,
  );
  assert.doesNotThrow(withCondition({ field: 'severity', in: [...SEVERITIES] }));
  assert.doesNotThrow(withCondition({ field: 'damage_zone', in: [...DAMAGE_ZONES] }));
});

// THE SAME RULES AT EVERY DEPTH, because a group is checked by the function that checks a leaf.
test('an operand inside a group is held to the same list', () => {
  assert.throws(
    withCondition({ any_of: [{ field: 'severity', equals: 'structural' }, { field: 'severity', equals: 'banana' }] }),
    /any_of\[1\] when equals compares severity against "banana"/,
  );
  assert.throws(
    withCondition({ all_of: [{ field: 'damage_zone', in: [] }] }),
    /all_of\[0\] when in is an empty list/,
  );
});

// THE FORCING FUNCTION. The loader holds a list of what each claim field can contain, and the day
// somebody adds a field to PATCHABLE_FIELDS without adding it there, the operand check would go on
// reporting success while covering one field fewer. That is the failure this project keeps meeting:
// a gate that quietly stops covering a case and says nothing. So every patchable field is fed an
// operand no field can hold, and the refusal has to be the one that means "I know this field and
// that value is impossible", never the one that means "I have never heard of this field".
test('the operand check covers every patchable field, and says how many it covered', (t) => {
  const impossible = -1; // not a string, not a boolean, not a clock position, not a date
  const covered = [];

  for (const field of PATCHABLE_FIELDS) {
    const thrown = refusalFrom(withCondition({ field, equals: impossible }));
    assert.ok(thrown instanceof PackRefused, `${field} was refused with something other than a PackRefused`);
    assert.match(
      thrown.message,
      /which no claim can ever hold/,
      `${field} has no entry in the loader's list of what a claim field can contain, so the operand `
        + 'check silently stopped covering it',
    );
    covered.push(field);
  }

  assert.equal(covered.length, PATCHABLE_FIELDS.length);
  t.diagnostic(`operand check covered ${covered.length} claim fields: ${covered.join(', ')}`);
});

// THE PROOF THAT THE LAST BRANCH OF THAT CHECK REFUSES RATHER THAN WAVES THROUGH. A field the
// loader has no list for must stop the pack, not pass it. PATCHABLE_FIELDS is pushed to and popped
// from inside this one test, deliberately and restored in the same breath, because standing up a
// field the loader accepts as a claim field and has no values for is the only way to reach that
// branch at all.
test('a claim field the loader holds no list of values for refuses the pack, rather than skipping it', () => {
  const original = [...PATCHABLE_FIELDS];
  try {
    PATCHABLE_FIELDS.push('odometer');
    assert.throws(
      withCondition({ field: 'odometer', equals: 1 }),
      /holds no list of what that field can contain/,
      'an unmapped field was waved through, which is the fail open this branch exists to prevent',
    );
  } finally {
    PATCHABLE_FIELDS.length = 0;
    PATCHABLE_FIELDS.push(...original);
  }
  assert.deepEqual(PATCHABLE_FIELDS, original, 'the mutation used to prove the branch was not restored');
});

// ---------------------------------------------------------------------------
// The contract line
// ---------------------------------------------------------------------------

// NOT A DEFECT, AND PINNED SO IT IS NOT TIGHTENED LATER BY MISTAKE. An absent contract has always
// meant this build's own, at the line that reads it, and src/core/packet.js was written against
// that: its pack_contract row prints "no contract stated" for a pack that names none. There is no
// separate version field to require either. The version is the tail of the contract string, which is
// why a whole wrong string is refused rather than compared piece by piece.
test('a pack that states no contract still loads, and is read as this build own convention', () => {
  const pack = base();
  delete pack.contract;
  assert.equal(loadPolicyPack(pack).contract, PACK_CONTRACT);
});

// LOADED BEFORE, AND CAME BACK SAYING claim-intake.v1. A pack written to some other convention was
// answered for under this one. Saying nothing and saying something unreadable are not one claim.
test('a contract that is present and is not a string is refused', () => {
  for (const value of [2, null, true, ['claim-intake.v1'], { name: 'claim-intake.v1' }]) {
    const pack = base();
    pack.contract = value;
    assert.throws(() => loadPolicyPack(pack), /which names no convention/,
      `contract: ${JSON.stringify(value)} was read as ours`);
  }

  // The wrong string is still refused by the older check, with the older sentence.
  const wrong = base();
  wrong.contract = 'claim-intake.v9';
  assert.throws(() => loadPolicyPack(wrong), /this build reads claim-intake\.v1/);
});

// ---------------------------------------------------------------------------
// Which section a refusal belongs to
// ---------------------------------------------------------------------------

test('a refusal about a section carries the coverage code, and no rule id', () => {
  let caught = null;
  try {
    withCoverage(OWN_DAMAGE, (c) => { c.active = 'true'; })();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof PackRefused);
  assert.equal(caught.packId, 'northwind');
  assert.equal(caught.coverageId, 'own_damage');
  assert.equal(caught.ruleId, null, 'a section is not a rule and must not borrow a rule id');
});

// THE SAME LEAK THE RULE ID TEST ABOVE GUARDS, in the other direction. Coverages are normalised
// before requirements, so a coverage code left lying in the module variable would ride onto a
// refusal raised by a rule that has nothing to do with it.
test('a coverage code does not leak from a good section onto a later rule refusal', () => {
  const pack = base();
  pack.requirements[RULE].when = { field: 'severity', equals: 'banana' };

  let caught = null;
  try {
    loadPolicyPack(pack);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof PackRefused);
  assert.equal(caught.ruleId, RULE_ID);
  assert.equal(caught.coverageId, null,
    'the section normalised just before this rule put its code on a refusal that is not about it');
});

// ---------------------------------------------------------------------------
// And the test that stops all of the above going too far
// ---------------------------------------------------------------------------

test('every shipped pack still loads, and still says what its file says', () => {
  for (const raw of [northwindRaw, kestrelRaw]) {
    const pack = loadPolicyPack(JSON.parse(JSON.stringify(raw)));
    assert.equal(pack.id, raw.id);
    assert.equal(pack.coverages.length, raw.coverages.length);
    assert.equal(pack.requirements.length, raw.requirements.length);
    for (const [index, coverage] of pack.coverages.entries()) {
      assert.equal(coverage.active, raw.coverages[index].active);
      assert.equal(coverage.deductible, raw.coverages[index].deductible ?? null);
      assert.deepEqual(coverage.incident_types, raw.coverages[index].incident_types);
    }
    assert.equal(pack.period.start, raw.period.start);
    assert.equal(pack.period.end, raw.period.end);
  }
});
