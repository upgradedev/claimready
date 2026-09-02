/**
 * Insurer rule packs: load one, check it, hand back a normalised policy.
 *
 * PURE MODULE. No DOM, no browser globals, no network, no timers, no I/O. It is
 * handed already parsed JSON. Reading a file or a URL is somebody else's job.
 *
 * WHY THIS EXISTS. The tool surface is the same for every insurer, and the
 * answers are not. A rule pack carries one insurer's schedule of cover and one
 * insurer's intake rules, and the same six tools return that insurer's facts.
 * Swap the pack and the cover facts change, the excess changes, and the list of
 * things the intake asks for changes, with no tool renamed and no code edited.
 * That is what makes this a contract rather than one hardcoded form.
 *
 * The normalised pack is deliberately shaped so `checkCoverage(pack, claim)`
 * accepts it unchanged: coverages, excluded drivers, period and currency sit
 * where coverage.js already looks for them. One object type flows through cover
 * checking and requirement deriving alike, so "policy" means one thing here.
 *
 * A pack is data an insurer publishes. It states what the schedule says. It
 * never decides a claim, and nothing in it can approve, accept or refuse one.
 */

import {
  PATCHABLE_FIELDS,
  INCIDENT_TYPES,
  SEVERITIES,
  DAMAGE_ZONES,
  DESCRIPTION_MAX_LENGTH,
  DRIVER_MAX_LENGTH,
  LOCATION_MAX_LENGTH,
  POLICE_REF_MAX_LENGTH,
  WITNESS_MAX_LENGTH,
  isCalendarDate,
  isIsoDate,
} from './claim.js';

/** The convention this pack is written against. Ours, versioned, not a standard. */
export const PACK_CONTRACT = 'claim-intake.v1';

/** Condition keys a requirement rule may use in its `when` block. */
export const CONDITION_KEYS = ['field', 'equals', 'not_equals', 'in', 'is_set', 'is_not_set', 'any_of', 'all_of'];

/**
 * The tests one leaf condition may state. Exactly one of them, never two.
 *
 * Two of these in one block is not a stricter rule, it is a contradiction the evaluator resolves by
 * accident of source order. See the note above checkConditionShape for what each pair used to do.
 */
const LEAF_OPERATORS = ['equals', 'not_equals', 'in', 'is_set', 'is_not_set'];

/** The two ways one condition may hold other conditions. Exactly one of them, never both. */
const GROUP_OPERATORS = ['any_of', 'all_of'];

/**
 * A pack this build will not read, named so a caller can catch it rather than pattern match a string.
 *
 * IT EXTENDS TypeError ON PURPOSE. Every refusal below was a TypeError before this class existed and
 * callers, tests and the page all treat it as one. Narrowing that would be a breaking change dressed
 * up as an improvement, so the class widens instead: `instanceof TypeError` still holds, the message
 * is byte for byte what it was, and `packId` and `ruleId` are new information rather than a new
 * contract. The page reads `error.message`, so the sentence a person sees is unchanged too.
 *
 * `packId` is null when the pack was refused before its id could be read, which is honest: a file
 * with no usable id has no id to report, and inventing one would be worse than saying nothing.
 * `ruleId` and `coverageId` are null for the same reason, and they are never both set: a refusal
 * belongs to one intake rule or to one section of the schedule, never to both at once.
 */
export class PackRefused extends TypeError {
  constructor(message, origin) {
    super(message);
    this.name = 'PackRefused';
    this.packId = (origin && origin.packId) || null;
    this.ruleId = (origin && origin.ruleId) || null;
    this.coverageId = (origin && origin.coverageId) || null;
  }
}

/**
 * Which pack, and which rule or which section inside it, the refusal being raised belongs to.
 *
 * WHY A MODULE VARIABLE RATHER THAN AN ARGUMENT. `fail` is reached from requireString and
 * requireArray, which are called from a dozen places that have no idea which rule is being read.
 * Threading an origin through all of them would touch every call site to carry a value that does not
 * change for the whole of one load. The variable is safe because `loadPolicyPack` is synchronous
 * from its first line to its last: no await, no callback out to anyone else's code, so on one thread
 * only one load can ever be part way through. It is reset at the top of every load, so a refusal
 * from an earlier call cannot leak its rule id into a later one.
 *
 * The same care applies between the two halves of one load. Coverages are normalised before
 * requirements, so a coverage id left lying here would ride onto a refusal raised by a rule that has
 * nothing to do with it. Both normalisers clear their own field on the way in and on the way out.
 */
let refusalOrigin = { packId: null, ruleId: null, coverageId: null };

/**
 * The packs this build has actually read, held by identity and by nothing else.
 *
 * WHAT THIS REPLACES AND WHY IT IS NOT A FLAG. Every trust point downstream used to decide whether
 * it had a rule pack by looking at the object in its hand: an `id`, a `requirements` array and a
 * `coverages` array. That is a description of a pack, not evidence one was loaded. Measured before
 * this existed, with an object literal typed out by hand and never shown to this module:
 *
 *   canFile ok: true code: null
 *   fileClaim ok: true status: filed
 *   sealed insurer : Totally Not An Insurer
 *   sealed clause  : MADE-UP-1
 *   sealed excess  : 1
 *
 * THREE WAYS WERE AVAILABLE AND THIS IS THE ONE CHOSEN. A public marker such as `validated: true`
 * is written by whoever builds the object, so the forgery above would simply have carried it.
 * Revalidating at each boundary would work and would mean running the whole loader several times on
 * every keystroke that redraws the file gate, on a page that has to stay responsive on a phone. A
 * WeakSet is neither: membership is not a property, so it cannot be typed, copied, spread or
 * serialised in, and `loadPolicyPack` below is the only writer in this repository. It is weak so a
 * pack the page has swapped away from can still be collected.
 *
 * IDENTITY IS THE WHOLE CLAIM. A JSON round trip of a validated pack holds the same data and is not
 * the same object, so it is refused until this module reads it for itself. That is deliberate, and
 * tests/unit/validated_pack_boundary.test.js pins it: it is what makes this different from the
 * shape check it replaces.
 */
const validatedPacks = new WeakSet();

/**
 * Did this build load and check THIS object.
 *
 * The reading half is exported and the writing half is not, which is the point. A caller can ask
 * and cannot answer.
 *
 * @param {*} pack anything at all
 * @returns {boolean}
 */
export function isValidatedPack(pack) {
  return Boolean(pack) && typeof pack === 'object' && validatedPacks.has(pack);
}

function fail(message) {
  throw new PackRefused(`policy pack: ${message}`, refusalOrigin);
}

function requireString(value, what) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${what} must be a non empty string, received ${JSON.stringify(value ?? null)}.`);
  }
  return value.trim();
}

function requireArray(value, what) {
  if (!Array.isArray(value)) {
    fail(`${what} must be an array, received ${JSON.stringify(value ?? null)}.`);
  }
  return value;
}

/**
 * The offending value, written back to its author as the thing they actually wrote.
 *
 * JSON.stringify RENDERS Infinity AND NaN AS null, so a refusal built on it told a pack author that
 * they had written null when they had written NaN, and sent them looking for a key that was not the
 * problem. Numbers go through String instead, which says NaN and Infinity out loud. Everything else
 * keeps the quoted JSON form the older refusals in this file already use, so their wording is
 * unchanged.
 */
function showValue(value) {
  return typeof value === 'number' ? String(value) : JSON.stringify(value ?? null);
}

/**
 * One section of the schedule, checked for what it SAYS and not only for what shape it is in.
 *
 * WHAT EACH OF THESE THREE CHECKS WAS MEASURED DOING BEFORE IT EXISTED, on a deep copy of
 * fixtures/insurers/northwind.json with one field bent:
 *
 *   active: "true"            loaded, and `entry.active === true` answered false. coverFacts then
 *                             reported in_force false and excess null on a section the pack says is
 *                             in force. A judge reading the page is told the opposite of the file
 *   active: 1                 the same
 *   active absent             the same, silently
 *   deductible: -250          loaded, and coverFacts returned excess -250
 *   deductible: Infinity      loaded, and coverFacts returned excess Infinity
 *   deductible: NaN           loaded, and coverFacts returned excess NaN
 *   incident_types: ["banana"] loaded, and applies_to carried "banana" out to the tool surface
 *
 * The excess is the number a claimant reads off this page and plans around, so a section that says
 * nothing usable about it may not load at all. None of this is a new opinion about what a schedule
 * means: it is the loader refusing to answer for a file it cannot read.
 *
 * TWO THINGS THAT LOOK WRONG AND ARE NOT, both checked against the shipped packs before tightening
 * anything. `deductible: 0` is legal and both packs use it, because a section with no excess is an
 * ordinary section and the refusal below already tells an author to write the zero. An empty
 * `incident_types` is legal and both packs use it on third party liability, which is not written
 * against an incident category at all. A rule that refused either of those would be a rule that
 * refuses the files this build ships with.
 */
function normaliseCoverage(entry, index) {
  refusalOrigin.coverageId = null;
  if (!entry || typeof entry !== 'object') fail(`coverage ${index} is not an object.`);
  const code = requireString(entry.code, `coverage ${index} code`);

  // From here on the refusal belongs to this section, so a caller can name it without reading the
  // sentence. Cleared above on the way in, so the section before this one cannot put its code on a
  // refusal raised by this one.
  refusalOrigin.coverageId = code;

  // A KEY THAT IS NOT THERE IS NOT A KEY WRITTEN AS null, AND THE REFUSAL HAS TO SAY WHICH. Sending
  // an author to look for an `"active": null` line that their file does not contain is the same
  // defect showValue above exists to stop, one argument further along.
  if (entry.active === undefined) {
    fail(`coverage "${code}" states no active flag, so nothing in the file says whether this section `
      + 'is in force. Write true or false, because an absent one is read as not in force and a '
      + 'section the schedule puts in force would be reported to a claimant as not bought.');
  }
  if (typeof entry.active !== 'boolean') {
    fail(`coverage "${code}" writes active: ${showValue(entry.active)}. It is true or `
      + 'false and nothing else, because anything else is read as not in force, and a section the '
      + 'schedule puts in force would be reported to a claimant as not bought.');
  }

  if (entry.deductible !== undefined && entry.deductible !== null) {
    if (typeof entry.deductible !== 'number' || !Number.isFinite(entry.deductible)) {
      fail(`coverage "${code}" writes deductible: ${showValue(entry.deductible)}. An excess is a `
        + 'number, and this one reaches a claimant as the amount they pay.');
    }
    if (entry.deductible < 0) {
      fail(`coverage "${code}" writes a deductible of ${entry.deductible}. An excess is what the `
        + 'claimant pays, so it is never below zero. Write 0 if there is no excess.');
    }
  }

  const coverage = {
    code,
    label: requireString(entry.label, `coverage "${code}" label`),
    clause: requireString(entry.clause, `coverage "${code}" clause`),
    active: entry.active,
    deductible: typeof entry.deductible === 'number' ? entry.deductible : null,
    incident_types: requireArray(entry.incident_types, `coverage "${code}" incident_types`).map((type) => {
      const named = requireString(type, `coverage "${code}" incident type`);
      if (!INCIDENT_TYPES.includes(named)) {
        fail(`coverage "${code}" applies to "${named}", which is not an incident a claim can `
          + `declare. Incidents: ${INCIDENT_TYPES.join(', ')}.`);
      }
      return named;
    }),
  };
  if (typeof entry.inactive_reason === 'string') coverage.inactive_reason = entry.inactive_reason;
  if (coverage.active && coverage.deductible === null) {
    fail(`coverage "${code}" is active but names no deductible. Write 0 if there is no excess.`);
  }
  refusalOrigin.coverageId = null;
  return coverage;
}

function normaliseExcludedDriver(entry, index) {
  if (!entry || typeof entry !== 'object') fail(`excluded driver ${index} is not an object.`);
  return {
    name: requireString(entry.name, `excluded driver ${index} name`),
    clause: requireString(entry.clause, `excluded driver ${index} clause`),
    reason: typeof entry.reason === 'string' ? entry.reason : null,
  };
}

/**
 * The two dates the schedule runs between, held to the grammar the comparison needs.
 *
 * src/core/coverage.js decides whether a loss falls inside the period with `date >= start && date
 * <= end`, comparing three strings. That is chronological only while all three are YYYY-MM-DD, so a
 * period written any other way turns a date comparison into an alphabetical one and the answer it
 * gives has nothing to do with time. Measured on a deep copy of northwind with `start` set to "the
 * first of January": the pack loaded, and the cover answer for a claim inside the real period was
 * decided by comparing "2026-06-15" against "the first of January".
 *
 * REVERSED IS THE WORSE ONE, because it looks like a typo and reads as a decision. Also measured,
 * with start 2026-12-31 and end 2026-01-01: the pack loaded and every claim came back NOT COVERED,
 * carrying the period clause, so the page told a claimant their loss fell outside a policy that was
 * running on the day. A pair of dates in that order describes no period at all.
 *
 * The calendar grammar is imported from src/core/claim.js rather than written again here, because
 * the claim date this is compared against is checked by that same function. Two copies of one date
 * rule is how the two ends of a comparison drift apart.
 */
function normalisePeriod(period) {
  if (period === undefined || period === null) return null;
  if (typeof period !== 'object') fail('period must be an object holding start, end and clause.');
  const start = requireString(period.start, 'period start');
  const end = requireString(period.end, 'period end');
  for (const [label, value] of [['start', start], ['end', end]]) {
    if (!isCalendarDate(value)) {
      fail(`period ${label} is "${value}", which is not a real day written as YYYY-MM-DD. The cover `
        + 'check compares the incident date against these two as text, so anything else compares '
        + 'alphabetically and answers about something other than time.');
    }
  }
  if (start > end) {
    fail(`period runs from "${start}" to "${end}", which is backwards. Every claim would fall `
      + 'outside a policy written that way, and the page would tell the claimant so.');
  }
  return {
    start,
    end,
    clause: typeof period.clause === 'string' ? period.clause : null,
  };
}

/* --------------------------------------------------------- condition shape */

/**
 * What each claim field can actually hold, so a condition can be checked against the field it names.
 *
 * ONE CANONICAL SOURCE, IMPORTED. Every list below is the list src/core/claim.js already validates
 * an incoming value against. Writing them out again here would give this build two answers to "is
 * severity allowed to be banana", and the day they disagreed the loader would refuse a pack the
 * claim layer accepts, or wave one through that it does not.
 *
 * WHY THE CHECK HAS TO KNOW WHICH FIELD. The evaluator in src/core/requirements.js compares with
 * `===` and with `Array.includes`, so a condition matches only when the pack's value is the same
 * type and the same string as the claim's. What is valid therefore depends entirely on the field:
 * `equals: 3` is a sensible impact position and a nonsense severity, `equals: false` is the only way
 * to ask about a car that will not drive and can never be an incident type. A check that only asked
 * "is this a scalar" would pass all four of those.
 *
 * MEASURED, ON A DEEP COPY OF northwind, before any of this existed. Every one of these loaded:
 *
 *   equals: "banana" on incident_type   the rule never fired for anybody, silently
 *   equals: "Theft" on incident_type    the same, because the claim layer lowercases and the pack
 *                                       does not, so a capital letter switches a rule off
 *   equals: "3" on damage_zone          the same, because the claim holds a number and a JSON author
 *                                       reaches for a string
 *   equals: "false" on vehicle_drivable the same, and this is the shape both shipped packs use
 *   equals: 47 on damage_zone           the same
 *   in: ["structural", "banana"]        loaded with a member that can never match
 *   not_equals: {x: 1}                  the rule fired for EVERYBODY, because no claim value is ever
 *                                       equal to an object
 *   in: []                              the rule never fired, which is a rule written to do nothing
 *
 * None of those is a shape error and none of them says anything on the page. The claimant is asked
 * for the wrong list, or for nothing, and the only sign is a requirement that quietly is not there.
 */
const textValues = (cap) => ({
  describe: `text, at most ${cap} characters once trimmed`,
  accepts: (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= cap,
});

/**
 * Built on first use rather than at module load, and the delay is the point.
 *
 * The entries below read `INCIDENT_TYPES`, `DAMAGE_ZONES`, `SEVERITIES` and the four length caps
 * out of claim.js. Reading them while this module evaluated was safe only while nothing in the
 * import cycle reached here first. src/core/filing.js now imports `isValidatedPack` from this
 * module, which puts policy.js inside the cycle claim.js and filing.js already form, and a graph
 * entered through claim.js would evaluate this object before claim.js had initialised one of those
 * bindings. That is a ReferenceError at import time, on every path, which is a hard failure of the
 * whole page rather than anything a reader could act on.
 *
 * Nothing here is read outside `checkOperand`, and by the time a pack is being loaded every module
 * in the cycle has finished, so building it lazily costs one branch and removes the hazard.
 */
let claimFieldValues = null;

function fieldValues() {
  if (claimFieldValues === null) claimFieldValues = buildClaimFieldValues();
  return claimFieldValues;
}

function buildClaimFieldValues() {
  return {
    incident_date: {
      describe: 'a real calendar date written as YYYY-MM-DD, in the years this build reads',
      accepts: isIsoDate,
    },
    incident_type: {
      describe: `one of ${INCIDENT_TYPES.join(', ')}, in lower case`,
      accepts: (value) => INCIDENT_TYPES.includes(value),
    },
    damage_zone: {
      describe: `a whole clock position from ${DAMAGE_ZONES[0]} to ${DAMAGE_ZONES[DAMAGE_ZONES.length - 1]}, as a number`,
      accepts: (value) => DAMAGE_ZONES.includes(value),
    },
    severity: {
      describe: `one of ${SEVERITIES.join(', ')}, in lower case`,
      accepts: (value) => SEVERITIES.includes(value),
    },
    vehicle_drivable: {
      describe: 'true or false, as a boolean and not as a word',
      accepts: (value) => typeof value === 'boolean',
    },
    description: textValues(DESCRIPTION_MAX_LENGTH),
    driver: textValues(DRIVER_MAX_LENGTH),
    location: textValues(LOCATION_MAX_LENGTH),
    police_report_ref: textValues(POLICE_REF_MAX_LENGTH),
    witness_name: textValues(WITNESS_MAX_LENGTH),
  };
}

/**
 * One value a condition compares a field against.
 *
 * IT REFUSES A FIELD IT HAS NO ENTRY FOR, AND THAT IS THE POINT OF THE LAST BRANCH. The map above
 * has to cover PATCHABLE_FIELDS, and the day somebody adds a field to that list and forgets this
 * one, the honest answer is that this loader does not know what that field can hold. Failing open
 * there would be the quiet kind of rot: the operand check would go on reporting success while
 * silently covering one field fewer. tests/unit/pack_contract.test.js asserts the map covers every
 * patchable field and prints the count, so the omission is caught at authoring time rather than by
 * a stranger's pack at boot.
 */
function checkOperand(field, value, where, operator) {
  if (value === null) {
    fail(`${where} compares ${field} against null. A field with no answer is asked about with `
      + 'is_not_set: true, and one with any answer at all with is_set: true.');
  }
  if (typeof value === 'object') {
    const shape = Array.isArray(value) ? 'a list' : 'an object';
    fail(`${where} compares ${field} against ${shape}. ${operator} holds one value, and no claim `
      + `field ever holds ${shape}, so the test answers the same thing for every claim that will `
      + 'ever be read against it. For several values write in: [...].');
  }
  const known = fieldValues()[field];
  if (!known) {
    fail(`${where} watches ${field}, and this loader holds no list of what that field can contain, `
      + 'so it cannot say whether this pack is asking for something reachable.');
  }
  if (!known.accepts(value)) {
    fail(`${where} compares ${field} against ${showValue(value)}, which no claim can ever hold. `
      + `${field} is ${known.describe}. A rule written against a value that cannot occur silently `
      + 'never applies, or silently always does, and nothing on the page says so.');
  }
}

/**
 * A `when` block is one leaf test or one group. Anything else is refused here.
 *
 * WHAT THIS USED TO ALLOW, AND WHAT THE EVALUATOR THEN DID WITH IT. The old version checked that the
 * keys were known keys, that a group was a non empty array, and that a leaf named a real claim
 * field. It never checked that the block stated ONE thing, so a pack could carry two conditions in
 * one block and src/core/requirements.js would silently pick a winner by the order its own branches
 * happen to be written in. Measured against fixtures/insurers/northwind.json, on the impact_position
 * rule:
 *
 *   { field, equals: "theft", not_equals: "theft" }   loaded. not_equals won, so the rule vanished
 *                                                     from a theft claim that the equals half asks for
 *   { any_of: [...], all_of: [...] }                  loaded. any_of won, all_of was never read
 *   { field, is_set: true, is_not_set: true }         loaded. is_set won
 *   { any_of: [...], field: "not_a_real_field", ... } loaded, AND the bogus field name was never
 *                                                     checked, because the group branch returned
 *                                                     before the field check could run
 *   { field }                                         loaded, and read as "this field has an answer"
 *
 * The fourth is the sharpest of the five. Adding a group key to a block turned OFF the claim field
 * check on the leaf beside it, so the one piece of validation this function did have could be walked
 * around by writing more, not less.
 *
 * A pack is what one insurer publishes about its own intake. Half reading one means asking a
 * claimant for the wrong list, so the answer to an ambiguous block is to refuse the pack and say so,
 * not to pick a meaning on the author's behalf.
 *
 * Three of the shapes named in the audit were already refused before this rewrite, and they still
 * are, by the same lines: an operator with no field fails on requireString below, and an empty
 * any_of or all_of fails on the length check.
 */
function checkConditionShape(when, where, insideGroup = false) {
  // A rule with no condition always applies, which is why an absent `when` is allowed at the top.
  // A MEMBER of a group is a different thing. `any_of: [{...}, null]` used to reach this same early
  // return, so the member contributed nothing, and an any_of with one real condition beside a null
  // was read as unconditionally true. Measured: a control group answered false and the same group
  // with a null member answered true. A hole in a list is not a condition, so it is refused where
  // it can only be a mistake, and still allowed where it is the ordinary way to say "always".
  if (when === undefined || when === null) {
    if (insideGroup) {
      fail(`${where} is ${JSON.stringify(when === undefined ? null : when)}, which is not a `
        + 'condition. A group holds conditions. Remove the empty member, or remove the group.');
    }
    return null;
  }
  if (typeof when !== 'object' || Array.isArray(when)) {
    fail(`${where} when must be an object, received ${JSON.stringify(when)}.`);
  }

  for (const key of Object.keys(when)) {
    if (!CONDITION_KEYS.includes(key)) {
      fail(`${where} when uses "${key}", which is not a condition key. Use one of: ${CONDITION_KEYS.join(', ')}.`);
    }
  }

  // Presence, not truthiness. `is_set: false` and `in: []` are both present and both mean something
  // to whoever wrote them, so neither may be read as an absent key.
  const groups = GROUP_OPERATORS.filter((key) => when[key] !== undefined);
  const leaves = LEAF_OPERATORS.filter((key) => when[key] !== undefined);

  if (groups.length > 1) {
    fail(`${where} when carries both any_of and all_of. A condition is one or the other, and a block `
      + 'holding both does not say which of the two the insurer meant.');
  }

  if (groups.length === 1 && leaves.length > 0) {
    fail(`${where} when carries the group ${groups[0]} and the test ${leaves.join(' and ')} in one block. `
      + `A condition is one leaf test or one group, never both. Move the test inside ${groups[0]}.`);
  }

  if (groups.length === 1 && when.field !== undefined) {
    fail(`${where} when carries a field beside ${groups[0]}. A group watches no field of its own: `
      + 'the field belongs on each condition inside it.');
  }

  if (groups.length === 1) {
    const label = groups[0];
    const group = requireArray(when[label], `${where} when ${label}`);
    if (group.length === 0) fail(`${where} when ${label} is empty.`);
    return {
      [label]: group.map((entry, index) => checkConditionShape(entry, `${where} when ${label}[${index}]`, true)),
    };
  }

  if (leaves.length > 1) {
    fail(`${where} when carries ${leaves.join(' and ')} in one block. A condition states one test, `
      + 'and two of them leave the answer to whichever branch of the evaluator is written first.');
  }

  const field = requireString(when.field, `${where} when field`);
  if (!PATCHABLE_FIELDS.includes(field)) {
    fail(`${where} when watches "${field}", which is not a claim field. Fields: ${PATCHABLE_FIELDS.join(', ')}.`);
  }

  if (leaves.length === 0) {
    fail(`${where} when names the field "${field}" and no test to run on it. `
      + `Write one of: ${LEAF_OPERATORS.join(', ')}.`);
  }

  // The evaluator asks whether these are exactly true, so a pack that writes false here is asking
  // for something it will not get. Refused rather than quietly read as the opposite, or as nothing.
  for (const key of ['is_set', 'is_not_set']) {
    if (when[key] !== undefined && when[key] !== true) {
      fail(`${where} when writes ${key}: ${JSON.stringify(when[key])}. It is only ever true. `
        + `For the opposite question write ${key === 'is_set' ? 'is_not_set' : 'is_set'}: true.`);
    }
  }

  // THE VALUE CHECKS RUN LAST, SO EVERY REFUSAL ABOVE KEEPS THE SENTENCE IT ALREADY HAD. A block
  // that names no field, or a field that is not a claim field, is refused for that first, because
  // "watches made_up" is a more useful thing to read than a complaint about the value beside it.
  if (when.in !== undefined) {
    const values = requireArray(when.in, `${where} when in`);
    if (values.length === 0) {
      fail(`${where} when in is an empty list. A field is never one of nothing, so the rule could `
        + 'not apply to any claim, and a rule that cannot apply is a rule the insurer did not get.');
    }
    values.forEach((value, index) => checkOperand(field, value, `${where} when in[${index}]`, 'in'));
  }

  for (const operator of ['equals', 'not_equals']) {
    if (when[operator] !== undefined) checkOperand(field, when[operator], `${where} when ${operator}`, operator);
  }

  // THE FIELD IS STORED AS IT WAS VALIDATED, AND THAT IS THE WHOLE POINT OF RETURNING ANYTHING.
  //
  // This function validated `requireString(when.field)`, which trims, and the caller then stored
  // `rule.when` raw. So a pack writing `field: " incident_type "` passed every check here and then
  // reached src/core/requirements.js, which reads `claim[when.field]` untrimmed, looks up a
  // property that does not exist, and quietly answers that the rule does not apply. Measured on the
  // impact_position rule: clean fired true, spaced fired false, and nothing anywhere said why. The
  // two other places a field is stored, triggered_by and satisfied_by.field, were already trimmed.
  // This was the one that was not.
  return { ...when, field };
}

/**
 * What answers this requirement: one claim field, or one thing a person does. Never both.
 *
 * BOTH USED TO LOAD, AND THE FIELD WON IN SILENCE. `satisfied_by: { field, human_action }` passed
 * this function, which read the field first and returned before it ever looked at the action, and
 * src/core/requirements.js then made the same choice for the same reason. So the rule was reported
 * as answered the moment the field was filled, the human action was never named on the page, never
 * counted as outstanding, and the sentence that exists to say "no field answers this one" was never
 * reached. An insurer that wrote both would have had half of its rule dropped without being told.
 *
 * A satisfied_by with neither was already refused before this check existed, on the last line here,
 * and still is.
 */
function normaliseSatisfiedBy(rule, where) {
  const satisfiedBy = rule.satisfied_by;
  if (!satisfiedBy || typeof satisfiedBy !== 'object' || Array.isArray(satisfiedBy)) {
    fail(`${where} needs satisfied_by, either { "field": "..." } or { "human_action": "..." }.`);
  }
  // Presence again, not usefulness. A human_action written as an empty string is still an author
  // saying they wanted one, and pairing it with a field is still the ambiguity this refuses.
  if (satisfiedBy.field !== undefined && satisfiedBy.field !== null
    && satisfiedBy.human_action !== undefined && satisfiedBy.human_action !== null) {
    fail(`${where} satisfied_by names both a field and a human_action. A requirement is answered by `
      + 'one or the other. Split it into two requirements if the insurer wants both.');
  }
  if (typeof satisfiedBy.field === 'string') {
    const field = satisfiedBy.field.trim();
    if (!PATCHABLE_FIELDS.includes(field)) {
      fail(`${where} is satisfied by "${field}", which is not a claim field. Fields: ${PATCHABLE_FIELDS.join(', ')}.`);
    }
    return { field };
  }
  if (typeof satisfiedBy.human_action === 'string' && satisfiedBy.human_action.trim().length > 0) {
    return { human_action: satisfiedBy.human_action.trim() };
  }
  return fail(`${where} satisfied_by must name either a claim field or a human_action.`);
}

function normaliseRequirement(rule, index, seenIds) {
  refusalOrigin.ruleId = null;
  if (!rule || typeof rule !== 'object') fail(`requirement ${index} is not an object.`);
  const id = requireString(rule.id, `requirement ${index} id`);
  if (seenIds.includes(id)) fail(`requirement id "${id}" is used twice. Ids have to be unique inside a pack.`);
  seenIds.push(id);

  // From here on every refusal is about this rule, so a caller catching it can name the rule
  // without reading the sentence. Cleared above on the way in, so the rule before this one cannot
  // put its id on a refusal raised by this one.
  refusalOrigin.ruleId = id;

  const where = `requirement "${id}"`;
  const checkedWhen = checkConditionShape(rule.when, where);

  const normalised = {
    id,
    label: requireString(rule.label, `${where} label`),
    why: requireString(rule.why, `${where} why`),
    satisfied_by: normaliseSatisfiedBy(rule, where),
    // The checked and normalised condition, never the raw one. See checkConditionShape.
    when: checkedWhen,
  };

  if (rule.triggered_by !== undefined && rule.triggered_by !== null) {
    const field = requireString(rule.triggered_by, `${where} triggered_by`);
    if (!PATCHABLE_FIELDS.includes(field)) {
      fail(`${where} triggered_by names "${field}", which is not a claim field.`);
    }
    normalised.triggered_by = field;
  }

  refusalOrigin.ruleId = null;
  return normalised;
}

/* -------------------------------------------------------------------- load */

/**
 * Validate a parsed rule pack and return the normalised policy it describes.
 *
 * Every problem throws, with the pack, the rule and the offending value named,
 * because a pack that is half understood would silently drop an intake rule and
 * the page would then ask a claimant for less than the insurer asked for.
 *
 * @param {object} raw the parsed JSON of one pack file
 * @param {{expectedId?: string}} [options] `expectedId` is the id the thing that fetched this file
 *        was told it would find inside it, which is the manifest entry's id. Pass it and a file
 *        whose own id says something else is refused. Omit it and the pack answers for itself.
 * @returns {object} a frozen policy: id, insurer, currency, coverages,
 *                   excluded_drivers, period, requirements, contract
 * @throws {PackRefused} when anything about the pack is not usable. It extends TypeError, and
 *         carries the pack id and the rule id where those were known when it was raised
 */
export function loadPolicyPack(raw, options) {
  refusalOrigin = { packId: null, ruleId: null, coverageId: null };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`expected a parsed pack object, received ${JSON.stringify(raw ?? null)}.`);
  }

  // THE CONTRACT IS OPTIONAL AND STAYS OPTIONAL. An absent one means this build's own, which is a
  // decision this line has always made and which src/core/packet.js was written against: its
  // `pack_contract` row prints "no contract stated" for a pack that names none. Making it mandatory
  // now would refuse packs a downstream reader already handles. There is no separate version field
  // to require either. The version is the tail of the contract string, which is why "claim-intake.v9"
  // below is refused as a whole rather than compared piece by piece.
  //
  // A CONTRACT THAT IS PRESENT AND IS NOT A STRING IS A DIFFERENT THING, and it used to be read as
  // ours. Measured: `contract: 2` and `contract: null` both loaded, and the loaded pack came back
  // saying claim-intake.v1, so a pack written to some other convention was answered for under this
  // one. Saying nothing and saying something unreadable are not the same claim.
  if (raw.contract !== undefined && typeof raw.contract !== 'string') {
    fail(`contract is ${JSON.stringify(raw.contract)}, which names no convention. Write `
      + `"${PACK_CONTRACT}", or leave the key out to mean this one.`);
  }
  const contract = typeof raw.contract === 'string' ? raw.contract : PACK_CONTRACT;
  if (contract !== PACK_CONTRACT) {
    fail(`contract is "${contract}", this build reads ${PACK_CONTRACT}.`);
  }

  const id = requireString(raw.id, 'id');
  refusalOrigin.packId = id;

  // THE MANIFEST AND THE FILE HAVE TO AGREE ABOUT WHOSE RULES THESE ARE.
  //
  // The sample file lists the packs on offer as { id, path } and nothing checked that the id it
  // states is the id inside the file at that path. It matters because the page and the domain read
  // that identity from two different places. src/ui/app.js keys the picker, the borrowed rules note
  // and the tool context's packId on the MANIFEST id, while packIdentity in src/core/filing.js reads
  // the PACK's own id. Point a manifest entry called northwind at the kestrel file and those two
  // disagree: the page shows no borrowed rules banner because the manifest id matches the home
  // insurer, and canFile refuses the filing as borrowed because the pack id does not. The protection
  // and the thing it protects were reading two different names for one pack.
  //
  // Neither reader is wrong, so neither is changed. The disagreement is made unreachable instead, at
  // the one place both names are in the same room.
  const expectedId = options && typeof options.expectedId === 'string' && options.expectedId.trim().length > 0
    ? options.expectedId.trim()
    : null;
  if (expectedId && expectedId !== id) {
    fail(`the list of available packs calls this one "${expectedId}" and the file itself says "${id}". `
      + 'They have to be the same name, because the page decides whose rules these are from the list '
      + 'and the filing decides it from the file.');
  }

  const coverages = requireArray(raw.coverages, 'coverages');
  if (coverages.length === 0) fail(`pack "${id}" lists no coverages, so no claim could be checked against it.`);

  const seenIds = [];
  const pack = {
    contract,
    id,
    insurer: requireString(raw.insurer, 'insurer'),
    product: typeof raw.product === 'string' ? raw.product : null,
    currency: requireString(raw.currency, 'currency'),
    note: typeof raw.note === 'string' ? raw.note : null,
    period: normalisePeriod(raw.period),
    coverages: coverages.map(normaliseCoverage),
    excluded_drivers: requireArray(raw.excluded_drivers ?? [], 'excluded_drivers').map(normaliseExcludedDriver),
    requirements: requireArray(raw.requirements ?? [], 'requirements').map((rule, index) =>
      normaliseRequirement(rule, index, seenIds),
    ),
  };

  const codes = pack.coverages.map((coverage) => coverage.code);
  const duplicate = codes.find((code, index) => codes.indexOf(code) !== index);
  if (duplicate) fail(`pack "${id}" lists the coverage code "${duplicate}" twice.`);

  // ONE INCIDENT BELONGS TO ONE SECTION, BECAUSE THE COVER CHECK STOPS AT THE FIRST MATCH.
  //
  // findCoverage in src/core/coverage.js picks a section with Array.find, so the first entry that
  // names the incident answers and every later one is never read. Nothing said so, and nothing
  // refused a pack that named an incident twice. Measured on a deep copy of northwind with a second
  // glass section added, against one glass claim:
  //
  //   glass written first             clause GL-2.3, excess 0
  //   windscreen_extra written first  clause WX-1.1, excess 900
  //
  // Same pack, same claim, two answers, and the only thing between them is which line the author
  // typed first. The excess is the number a claimant reads off the page and plans around, so a file
  // that does not say which section answers is a file this build will not answer from. Refusing here
  // rather than picking in coverage.js keeps the decision a table lookup with one row per incident.
  const claimedBy = new Map();
  for (const coverage of pack.coverages) {
    for (const type of coverage.incident_types) {
      const already = claimedBy.get(type);
      if (already === coverage.code) {
        fail(`pack "${id}" writes the incident "${type}" into the "${coverage.code}" section twice. `
          + 'A section covers an incident or it does not, and a list saying it twice says nothing '
          + 'the first entry did not.');
      }
      if (already !== undefined) {
        fail(`pack "${id}" writes the incident "${type}" into both the "${already}" and the `
          + `"${coverage.code}" sections. The cover check answers from the first section that names `
          + 'an incident, so which clause and which excess a claimant is told would be decided by '
          + 'which of the two was written first. Name the incident under one section.');
      }
      claimedBy.set(type, coverage.code);
    }
  }

  // ONE PERSON, ONE ROW, AND THE COMPARISON IS THE ONE THE COVER CHECK MAKES.
  //
  // normaliseExcludedDriver trims a name and stops there, while findExcludedDriver in
  // src/core/coverage.js matches on trim AND lower case. So two spellings of one name are one
  // person to the decision and two people to everything that counts rows. Measured on a deep copy
  // of northwind carrying a second row reading "  nikos p.  ":
  //
  //   a claim naming Nikos P.  refused under clause EX-9.1, because find stops at the first row, so
  //                            which clause the claimant is shown depends on the row order
  //   a claim naming nobody    "this policy excludes 2 named drivers under clauses EX-9.1, EX-9.7"
  //
  // The second sentence is the one a claimant reads on a provisional yes. It tells them the policy
  // shuts out two people it does not, and it cites a clause that can never be the one that fires.
  const driverKeys = pack.excluded_drivers.map((entry) => entry.name.toLowerCase());
  const repeatedAt = driverKeys.findIndex((key, index) => driverKeys.indexOf(key) !== index);
  if (repeatedAt !== -1) {
    const first = pack.excluded_drivers[driverKeys.indexOf(driverKeys[repeatedAt])];
    fail(`pack "${id}" names "${first.name}" as an excluded driver twice, once as `
      + `"${pack.excluded_drivers[repeatedAt].name}". The cover check matches a driver on the `
      + 'trimmed lower cased name, so both rows are the same person to the decision and only the '
      + 'first one can ever supply the clause. Write the person once.');
  }

  // THE LAST LINE OF THE LOADER IS THE ONLY WAY INTO THE SET, AND IT IS REACHED ONLY BY A PACK THAT
  // GOT PAST EVERY CHECK ABOVE. Every `fail` throws, so nothing part way through arrives here.
  const checked = deepFreeze(pack);
  validatedPacks.add(checked);
  return checked;
}

/**
 * Read the list of packs on offer and say which entries may be fetched at all.
 *
 * PURE, LIKE THE REST OF THIS MODULE. It is handed the already parsed `available_packs` array and
 * hands back a plan. Fetching is somebody else's job, which is why this can be unit tested without a
 * page, a network or a document.
 *
 * WHY IT EXISTS. Two manifest entries could carry the same id and nothing said so. src/ui/app.js
 * keeps the loaded packs in a Map keyed by that id, so the second entry quietly overwrote the first:
 * the picker showed one row where two were listed, and which of the two files answered depended on
 * the order the fetches happened to settle in. That is a coin toss deciding which insurer's rules a
 * claimant is read against.
 *
 * BOTH COPIES ARE REFUSED, NOT JUST THE SECOND. Keeping the first would be a rule about ordering
 * rather than a rule about the manifest, and it would still leave the page answering under a file
 * nobody can point to from the list. A duplicated id means the list does not say which file it
 * means, and the honest answer to that is that neither of them is usable until someone fixes the
 * list. Everything else in the manifest still loads, so one bad pair does not take the page down.
 *
 * @param {*} listed the sample file's `available_packs`, or anything at all
 * @returns {Array<{id: string, path: string, refusal: (string|null)}>} one entry per listed pack, in
 *          the order given. `refusal` is a sentence for a reader when the entry may not be fetched,
 *          and null when it may
 */
export function planPackManifest(listed) {
  const entries = (Array.isArray(listed) ? listed : []).map((entry) => ({
    id: entry && typeof entry.id === 'string' ? entry.id.trim() : '',
    path: entry && typeof entry.path === 'string' ? entry.path.trim() : '',
  }));

  const counted = new Map();
  for (const entry of entries) counted.set(entry.id, (counted.get(entry.id) ?? 0) + 1);

  return entries.map((entry) => {
    if (entry.id.length === 0) {
      return { ...entry, id: 'unknown', refusal: 'this entry in the list of available packs states no id, so nothing can point at it.' };
    }
    if (counted.get(entry.id) > 1) {
      return {
        ...entry,
        refusal: `the list of available packs names "${entry.id}" ${counted.get(entry.id)} times. `
          + 'Two files cannot both be that pack, so neither is loaded until the list says which one is.',
      };
    }
    if (entry.path.length === 0) {
      return { ...entry, refusal: `the list of available packs names "${entry.id}" and gives no file to read it from.` };
    }
    return { ...entry, refusal: null };
  });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * What this insurer's schedule says, in a shape a tool can read out.
 *
 * These are facts about a policy, not a decision about a claim. A section that
 * was never bought is reported as not in force, with the clause that says so.
 *
 * @param {object} pack a pack from loadPolicyPack
 * @returns {Array<{code: string, label: string, clause: string, in_force: boolean,
 *                  excess: (number|null), currency: string, applies_to: string[], note: (string|null)}>}
 */
export function coverFacts(pack) {
  if (!pack || typeof pack !== 'object' || !Array.isArray(pack.coverages)) {
    throw new TypeError('coverFacts needs a policy pack from loadPolicyPack.');
  }
  return pack.coverages.map((coverage) => ({
    code: coverage.code,
    label: coverage.label,
    clause: coverage.clause,
    in_force: coverage.active === true,
    excess: coverage.active ? coverage.deductible : null,
    currency: pack.currency,
    applies_to: [...coverage.incident_types],
    note: coverage.inactive_reason ?? null,
  }));
}

/**
 * One line naming the pack that is loaded, for a page caption or a tool result.
 *
 * @param {object} pack
 * @returns {string}
 */
export function describePack(pack) {
  if (!pack || typeof pack !== 'object') {
    throw new TypeError('describePack needs a policy pack from loadPolicyPack.');
  }
  const inForce = pack.coverages.filter((coverage) => coverage.active).length;
  const product = pack.product ? `, ${pack.product}` : '';
  return (
    `${pack.insurer}${product}: ${inForce} of ${pack.coverages.length} sections in force, ` +
    `${pack.requirements.length} intake rules, amounts in ${pack.currency}.`
  );
}
