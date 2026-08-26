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

function fail(message) {
  throw new TypeError(`policy pack: ${message}`);
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

function checkConditionShape(when, where) {
  if (when === undefined || when === null) return null;
  if (typeof when !== 'object' || Array.isArray(when)) {
    fail(`${where} when must be an object, received ${JSON.stringify(when)}.`);
  }

  for (const key of Object.keys(when)) {
    if (!CONDITION_KEYS.includes(key)) {
      fail(`${where} when uses "${key}", which is not a condition key. Use one of: ${CONDITION_KEYS.join(', ')}.`);
    }
  }

  if (when.any_of || when.all_of) {
    const group = when.any_of || when.all_of;
    const label = when.any_of ? 'any_of' : 'all_of';
    requireArray(group, `${where} when ${label}`);
    if (group.length === 0) fail(`${where} when ${label} is empty.`);
    return group.map((entry, index) => checkConditionShape(entry, `${where} when ${label}[${index}]`));
  }

  const field = requireString(when.field, `${where} when field`);
  if (!PATCHABLE_FIELDS.includes(field)) {
    fail(`${where} when watches "${field}", which is not a claim field. Fields: ${PATCHABLE_FIELDS.join(', ')}.`);
  }
  if (when.in !== undefined) requireArray(when.in, `${where} when in`);
  return null;
}

function normaliseSatisfiedBy(rule, where) {
  const satisfiedBy = rule.satisfied_by;
  if (!satisfiedBy || typeof satisfiedBy !== 'object' || Array.isArray(satisfiedBy)) {
    fail(`${where} needs satisfied_by, either { "field": "..." } or { "human_action": "..." }.`);
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
  if (!rule || typeof rule !== 'object') fail(`requirement ${index} is not an object.`);
  const id = requireString(rule.id, `requirement ${index} id`);
  if (seenIds.includes(id)) fail(`requirement id "${id}" is used twice. Ids have to be unique inside a pack.`);
  seenIds.push(id);

  const where = `requirement "${id}"`;
  checkConditionShape(rule.when, where);

  const normalised = {
    id,
    label: requireString(rule.label, `${where} label`),
    why: requireString(rule.why, `${where} why`),
    satisfied_by: normaliseSatisfiedBy(rule, where),
    when: rule.when === undefined ? null : rule.when,
  };

  if (rule.triggered_by !== undefined && rule.triggered_by !== null) {
    const field = requireString(rule.triggered_by, `${where} triggered_by`);
    if (!PATCHABLE_FIELDS.includes(field)) {
      fail(`${where} triggered_by names "${field}", which is not a claim field.`);
    }
    normalised.triggered_by = field;
  }

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
 * @returns {object} a frozen policy: id, insurer, currency, coverages,
 *                   excluded_drivers, period, requirements, contract
 * @throws {TypeError} when anything about the pack is not usable
 */
export function loadPolicyPack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`expected a parsed pack object, received ${JSON.stringify(raw ?? null)}.`);
  }

  const contract = typeof raw.contract === 'string' ? raw.contract : PACK_CONTRACT;
  if (contract !== PACK_CONTRACT) {
    fail(`contract is "${contract}", this build reads ${PACK_CONTRACT}.`);
  }

  const id = requireString(raw.id, 'id');
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
