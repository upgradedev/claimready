/**
 * What this insurer's intake asks for, given what the claim currently says.
 *
 * PURE MODULE. No DOM, no browser globals, no network, no timers, no I/O.
 *
 * THIS IS THE PART THAT MAKES THE PAGE WORTH TALKING TO. An agent can fill a
 * form on its own. What it cannot know is that saying "the car will not start"
 * has just added two things to the list, and that one of them is something only
 * a person can do. The page derives that, deterministically, from the insurer's
 * rule pack and the claim as it stands right now. Nothing is predicted and
 * nothing is decided: the rules are a table, the claim is data, the answer is a
 * lookup that any reader can repeat by hand.
 *
 * Every requirement returned says where it came from:
 *   id           stable name, safe for an agent to key on
 *   label        what to ask the claimant for, in their words
 *   why          the clause or the field that makes it required
 *   satisfied    whether the claim already answers it
 *   field        the claim field that answers it, or null when none does
 *   humanAction  what a person has to do when no field answers it, or null
 *   triggeredBy  the claim field whose value brought it into existence, or null
 *                for a requirement this insurer always asks for
 *
 * A requirement that no field can satisfy is honest about it: roadside
 * collection is arranged by a person pressing a button on the page, and no tool
 * on this page reaches that button, so `why` says so and an agent reading it
 * should ask the person rather than look for a tool to call.
 *
 * THE THIRD ARGUMENT IS WHY THIS FILE IS THE ONLY ANSWER TO "is it satisfied".
 * Whether the person has pressed such a button is a fact about the page, not
 * about the claim, so it has to be handed in. Before it was, a human_action
 * requirement returned satisfied false for ever: the page said "1 of 7 still
 * open" on the same row that said "you pressed it at 10:31", get_requirements
 * and read_claim_state agreed it was open, and get_assistance_options quietly
 * disagreed by inferring completion from the presence of a page note. Passing
 * the completed actions in means every surface reads one answer, and no caller
 * has to infer anything.
 */

import { FIELD_LABELS } from './claim.js';

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim().length === 0;
}

/**
 * The "this appeared because" clause, written to be read out loud.
 *
 * A boolean field reads as an answer to a question, not as a value, because
 * "whether the car still drives is no" is not a sentence anyone says.
 */
function becauseClause(field, claim) {
  const label = FIELD_LABELS[field] || field;
  const value = claim ? claim[field] : undefined;

  if (value === true) return `the answer to "${label}" is yes`;
  if (value === false) return `the answer to "${label}" is no`;
  if (isEmptyValue(value)) return `"${label}" has not been answered yet`;
  return `the answer to "${label}" is ${String(value)}`;
}

/**
 * Evaluate one condition against the claim.
 *
 * @returns {{matched: boolean, by: (string|null)}} `by` names the field that
 *          decided it, which is what the page shows as "this appeared because".
 */
function evaluate(when, claim) {
  if (when === null || when === undefined) return { matched: true, by: null };

  if (Array.isArray(when.any_of)) {
    for (const inner of when.any_of) {
      const result = evaluate(inner, claim);
      if (result.matched) return { matched: true, by: result.by };
    }
    return { matched: false, by: null };
  }

  if (Array.isArray(when.all_of)) {
    let by = null;
    for (const inner of when.all_of) {
      const result = evaluate(inner, claim);
      if (!result.matched) return { matched: false, by: null };
      if (by === null) by = result.by;
    }
    return { matched: true, by };
  }

  const field = when.field;
  const value = claim ? claim[field] : undefined;

  if (when.is_set === true) return { matched: !isEmptyValue(value), by: field };
  if (when.is_not_set === true) return { matched: isEmptyValue(value), by: field };
  if (Array.isArray(when.in)) return { matched: when.in.includes(value), by: field };
  if (when.not_equals !== undefined) return { matched: value !== when.not_equals, by: field };
  if (when.equals !== undefined) return { matched: value === when.equals, by: field };

  // A condition that names a field and nothing else reads as "this field has an
  // answer", which is the only sensible meaning left.
  return { matched: !isEmptyValue(value), by: field };
}

/**
 * Whether this rule is answered, and by what.
 *
 * A rule answered by a field reads the claim. A rule answered by a human action
 * reads `done`, which is the set of actions the caller reports as carried out.
 * Nothing here guesses: an action nobody reported is not done.
 */
function satisfiedBy(rule, claim, done) {
  const target = rule.satisfied_by || {};
  if (typeof target.field === 'string') {
    return {
      satisfied: !isEmptyValue(claim ? claim[target.field] : undefined),
      field: target.field,
      humanAction: null,
    };
  }
  const humanAction = typeof target.human_action === 'string' ? target.human_action : null;
  return { satisfied: done.has(rule.id), field: null, humanAction };
}

/** Accept an array, a Set, or nothing at all, and answer with a Set either way. */
function asDoneSet(completedHumanActions) {
  if (completedHumanActions instanceof Set) return completedHumanActions;
  if (Array.isArray(completedHumanActions)) return new Set(completedHumanActions);
  return new Set();
}

function because(field, claim) {
  return ` Asked for here because ${becauseClause(field, claim)}.`;
}

/**
 * The requirements this claim currently raises, in the order the pack lists them.
 *
 * A rule whose condition does not match is not in the list at all. That is the
 * point: change one answer on the page and a requirement appears or disappears,
 * and an agent that reads the list again sees exactly what changed.
 *
 * @param {object} policy a pack from policy.js, or anything carrying `requirements`
 * @param {object} claim a claim from claim.js
 * @param {(string[]|Set<string>)} [completedHumanActions] ids of the requirements
 *        whose human action the caller reports as already carried out. Omit it
 *        and no human action counts as done.
 * @returns {Array<{id: string, label: string, why: string, satisfied: boolean,
 *                  field: (string|null), humanAction: (string|null), triggeredBy: (string|null)}>}
 * @throws {TypeError} when either of the first two arguments is missing
 */
export function deriveRequirements(policy, claim, completedHumanActions) {
  if (!policy || typeof policy !== 'object') {
    throw new TypeError('deriveRequirements needs a policy pack.');
  }
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('deriveRequirements needs a claim object.');
  }

  const done = asDoneSet(completedHumanActions);
  const rules = Array.isArray(policy.requirements) ? policy.requirements : [];
  const out = [];

  for (const rule of rules) {
    const hit = evaluate(rule.when, claim);
    if (!hit.matched) continue;

    const triggeredBy = rule.triggered_by ?? hit.by ?? null;
    const answer = satisfiedBy(rule, claim, done);

    let why = rule.why;
    if (triggeredBy) why += because(triggeredBy, claim);
    if (!answer.field) {
      why += ` No field answers this one and no tool on this page reaches it: ${answer.humanAction}`;
      if (answer.satisfied) why += ' The page reports that this has now been done.';
    }

    out.push({
      id: rule.id,
      label: rule.label,
      why,
      satisfied: answer.satisfied,
      field: answer.field,
      humanAction: answer.humanAction,
      triggeredBy,
    });
  }

  return out;
}

/**
 * The fields on the file gate's static list that THIS pack asks for right now.
 *
 * The page's own gate lives in claim.js, because the store can reach it without
 * a pack. This is the same question asked of the insurer's published rules, and
 * tests/unit/requirements.test.js requires the two to give the same answer for
 * every field a pack names. That check is the forcing function: a pack rule and
 * the gate cannot drift apart without a test going red.
 *
 * A field no rule names is not in either answer here. Both shipped packs are
 * silent about incident_type, which the page requires on its own account because
 * a cover check cannot run without it.
 *
 * @param {object} policy a pack from policy.js
 * @param {object} claim a claim from claim.js
 * @returns {{asked: string[], named: string[]}} `asked` is what the pack wants on
 *          this claim, `named` is every field any rule in the pack mentions
 */
export function packFieldDemands(policy, claim) {
  if (!policy || typeof policy !== 'object') {
    throw new TypeError('packFieldDemands needs a policy pack.');
  }
  const rules = Array.isArray(policy.requirements) ? policy.requirements : [];
  const named = new Set();
  const asked = new Set();
  for (const rule of rules) {
    const field = rule.satisfied_by && typeof rule.satisfied_by.field === 'string'
      ? rule.satisfied_by.field
      : null;
    if (!field) continue;
    named.add(field);
    if (evaluate(rule.when, claim).matched) asked.add(field);
  }
  return { asked: [...asked], named: [...named] };
}

/**
 * The subset still waiting for an answer.
 *
 * @param {Array<{satisfied: boolean}>} requirements the list from deriveRequirements
 * @returns {Array<object>}
 */
export function outstandingRequirements(requirements) {
  if (!Array.isArray(requirements)) {
    throw new TypeError('outstandingRequirements needs the list from deriveRequirements.');
  }
  return requirements.filter((entry) => entry && entry.satisfied !== true);
}

/**
 * A short line for a tool result or a page caption. Never longer than 300 characters.
 *
 * @param {Array<object>} requirements
 * @returns {string}
 */
export function summariseRequirements(requirements) {
  const outstanding = outstandingRequirements(requirements);
  if (requirements.length === 0) {
    return 'This insurer states no intake requirements for a claim in this state.';
  }
  if (outstanding.length === 0) {
    return `All ${requirements.length} intake requirements are answered.`;
  }
  const names = outstanding.map((entry) => entry.label).join('; ');
  const line = `${outstanding.length} of ${requirements.length} intake requirements are still open: ${names}.`;
  return line.length <= 300 ? line : `${line.slice(0, 297)}...`;
}
