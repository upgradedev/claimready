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

import { PATCHABLE_FIELDS } from './claim.js';

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
 */
export class PackRefused extends TypeError {
  constructor(message, origin) {
    super(message);
    this.name = 'PackRefused';
    this.packId = (origin && origin.packId) || null;
    this.ruleId = (origin && origin.ruleId) || null;
  }
}

/**
 * Which pack, and which rule inside it, the refusal being raised belongs to.
 *
 * WHY A MODULE VARIABLE RATHER THAN AN ARGUMENT. `fail` is reached from requireString and
 * requireArray, which are called from a dozen places that have no idea which rule is being read.
 * Threading an origin through all of them would touch every call site to carry a value that does not
 * change for the whole of one load. The variable is safe because `loadPolicyPack` is synchronous
 * from its first line to its last: no await, no callback out to anyone else's code, so on one thread
 * only one load can ever be part way through. It is reset at the top of every load, so a refusal
 * from an earlier call cannot leak its rule id into a later one.
 */
let refusalOrigin = { packId: null, ruleId: null };

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

function normaliseCoverage(entry, index) {
  if (!entry || typeof entry !== 'object') fail(`coverage ${index} is not an object.`);
  const code = requireString(entry.code, `coverage ${index} code`);
  const coverage = {
    code,
    label: requireString(entry.label, `coverage "${code}" label`),
    clause: requireString(entry.clause, `coverage "${code}" clause`),
    active: entry.active === true,
    deductible: typeof entry.deductible === 'number' ? entry.deductible : null,
    incident_types: requireArray(entry.incident_types, `coverage "${code}" incident_types`).map((type) =>
      requireString(type, `coverage "${code}" incident type`),
    ),
  };
  if (typeof entry.inactive_reason === 'string') coverage.inactive_reason = entry.inactive_reason;
  if (coverage.active && coverage.deductible === null) {
    fail(`coverage "${code}" is active but names no deductible. Write 0 if there is no excess.`);
  }
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

function normalisePeriod(period) {
  if (period === undefined || period === null) return null;
  if (typeof period !== 'object') fail('period must be an object holding start, end and clause.');
  return {
    start: requireString(period.start, 'period start'),
    end: requireString(period.end, 'period end'),
    clause: typeof period.clause === 'string' ? period.clause : null,
  };
}

/* --------------------------------------------------------- condition shape */

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

  if (when.in !== undefined) requireArray(when.in, `${where} when in`);

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
  refusalOrigin = { packId: null, ruleId: null };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`expected a parsed pack object, received ${JSON.stringify(raw ?? null)}.`);
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

  return deepFreeze(pack);
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
