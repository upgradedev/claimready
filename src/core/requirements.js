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

import { FIELD_LABELS, OPTIONAL_FIELDS } from './claim.js';

/** How many outstanding requirements the file panel names before it counts the rest. */
const MAX_NAMED_ASKS = 3;

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
 * A rule that no field can answer is reported too, under `humanOnly`, by id. It has
 * to be: a caller that only ever saw the field rules could not see the sharpest
 * requirement either pack states, which is the one no patch from either side can
 * close. The guard test in tests/unit/requirements.test.js was blind to
 * roadside_collection for exactly that reason.
 *
 * @param {object} policy a pack from policy.js
 * @param {object} claim a claim from claim.js
 * @returns {{asked: string[], named: string[], humanOnly: string[]}} `asked` is what
 *          the pack wants on this claim, `named` is every field any rule in the pack
 *          mentions, `humanOnly` is the ids of the rules asked for right now that no
 *          field answers
 */
export function packFieldDemands(policy, claim) {
  if (!policy || typeof policy !== 'object') {
    throw new TypeError('packFieldDemands needs a policy pack.');
  }
  const rules = Array.isArray(policy.requirements) ? policy.requirements : [];
  const named = new Set();
  const asked = new Set();
  const humanOnly = new Set();
  for (const rule of rules) {
    const field = rule.satisfied_by && typeof rule.satisfied_by.field === 'string'
      ? rule.satisfied_by.field
      : null;
    const matched = evaluate(rule.when, claim).matched;
    if (!field) {
      if (matched) humanOnly.add(rule.id);
      continue;
    }
    named.add(field);
    if (matched) asked.add(field);
  }
  return { asked: [...asked], named: [...named], humanOnly: [...humanOnly] };
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

/**
 * Whether the file panel has nothing left to flag.
 *
 * A draft that is ready to file while the intake is still asking for something is
 * not settled, and neither is one whose rule pack never loaded, because that is an
 * unknown rather than a clear answer.
 *
 * NOTHING ON THE PAGE DECIDES ANYTHING WITH THIS ANY MORE, AND THAT IS DELIBERATE.
 * The file button, the sentence beside it and the domain refusal all come off
 * canFile in src/core/filing.js, which is one decision rather than three readings
 * of one idea. This function stays because it answers the same question from the
 * derived state, which makes it a cross check: tests/unit/filing.test.js requires
 * the two to agree on every draft in a matrix, so the older answer cannot quietly
 * drift into a second one that some later caller reaches for. It is the same
 * forcing function packFieldDemands above provides for the pack rules.
 *
 * @param {object} state the same object fileGateStatement takes
 * @returns {boolean}
 */
export function fileGateIsSettled(state) {
  if (!state || state.ready !== true) return false;
  if (state.requirementsKnown === false) return false;
  return !Array.isArray(state.outstanding) || state.outstanding.length === 0;
}

/**
 * What the file panel says about a draft, in one sentence.
 *
 * TWO PANELS, ONE INPUT. The page prints two statements about one draft: what the
 * file gate still needs, and what the insurer's intake still asks for. They were
 * built from two different inputs, so on a draft where every required field was
 * filled and the intake still wanted something the page printed "The draft is
 * complete" a few inches above "1 of 7 intake requirements are still open". Both
 * sentences were true of the input each was handed, and the page was wrong.
 *
 * So the outstanding requirements come in here too, and the word complete is
 * reachable only when there are none of them. Where the intake is still asking,
 * the sentence says the two separate things that are actually true: every required
 * field is filled, AND this is what the insurer still wants.
 *
 * THE HUMAN ACTION IS NAMED AS ONE. A requirement with no field is one no patch
 * can close, from the page or from an agent, because there is no field to write.
 * Saying so is the honest version, and it is the same fact the requirements panel
 * and the tools already state.
 *
 * Whether the File button stays enabled is a separate decision and is not made
 * here. This function only ever produces the sentence beside it.
 *
 * @param {{ready: boolean, missing: string[], outstanding: Array<object>,
 *          insurer: (string|null), requirementsKnown: boolean}} state
 *        `outstanding` is the list from outstandingRequirements. `requirementsKnown`
 *        is false when no rule pack loaded, which is not the same as nothing being
 *        asked for and must never be printed as though it were.
 * @returns {string}
 */
export function fileGateStatement(state) {
  const ready = Boolean(state && state.ready);
  const missing = Array.isArray(state && state.missing) ? state.missing : [];
  const outstanding = Array.isArray(state && state.outstanding) ? state.outstanding : [];
  const known = state ? state.requirementsKnown !== false : true;

  if (!ready) {
    const labels = missing.map((field) => FIELD_LABELS[field] || field);
    return labels.length
      ? `Still needed before you can file: ${labels.join(', ')}.`
      : 'Waiting for the draft to be complete.';
  }

  if (!known) {
    return 'Every required field is filled. The insurer rule pack did not load, so this page cannot '
      + 'say what else the intake asks for.';
  }

  if (outstanding.length === 0) {
    return 'The draft is complete. Filing is yours to do.';
  }

  const insurer = typeof (state && state.insurer) === 'string' && state.insurer.trim().length > 0
    ? state.insurer.trim()
    : 'This insurer';

  // Named, and capped, for the same reason describeClaim caps its pinned list: a
  // panel that runs to ten labels buries the one line the claimant acts on.
  const named = outstanding.slice(0, MAX_NAMED_ASKS).map((entry) => entry.label);
  const rest = outstanding.length - named.length;
  const asks = `${named.join('; ')}${rest > 0 ? `, and ${rest} more` : ''}`;

  const humanOnly = outstanding.filter((entry) => !entry.field);
  const tail = humanOnly.length === 0
    ? ''
    : ` No field answers ${humanOnly.length === 1 ? 'that one' : 'those'} and no tool on this page `
      + `reaches ${humanOnly.length === 1 ? 'it' : 'them'}, so ${humanOnly.length === 1 ? 'it stays' : 'they stay'} `
      + 'open until you do it on this page.';

  return `Every required field is filled. ${insurer} still asks for: ${asks}.${tail}`;
}

/**
 * What to say above the optional details, so the sentence is true against the pack that is loaded.
 *
 * THE OLD SENTENCE WAS "Not needed to file", AND THE PACK CAN ASK FOR THESE VERY FIELDS. Both
 * shipped packs do: one asks for the police report reference on a structural or theft claim and
 * for the location of a vehicle that cannot be driven, the other asks a collision claimant for a
 * witness. All four of those are optional fields. The file gate really does not wait for them, so
 * the old sentence was true about the button and false about the claim, which is the worst kind of
 * true: a claimant reads it, folds the group away, and the insurer is still asking.
 *
 * SAME INPUT AS THE FILE PANEL, ON PURPOSE. It is handed the same `outstanding` list
 * fileGateStatement reads, so the two sentences about one draft cannot drift apart. That is the
 * rule this module already exists to enforce, applied once more.
 *
 * @param {{outstanding: Array<{label: string, field: (string|null)}>, insurer: (string|null),
 *          requirementsKnown: boolean}} state the same object fileGateStatement takes
 * @returns {string}
 */
export function optionalDetailsNote(state) {
  // THE OPENER IS A CLAIM ABOUT THE BUTTON, SO IT IS COMPUTED, NOT FIXED.
  //
  // This note used to open with "The File button does not wait for these" whatever the pack said,
  // and then name, in the next sentence, the field the pack was asking for. Both sentences were
  // drawn from the same input and they contradicted each other: an insurer requirement that names
  // an optional field is outstanding, an outstanding requirement refuses the filing in
  // src/core/filing.js, and the button beside this note was correctly disabled while the note said
  // it was not waiting. The panel is not allowed to disagree with the control it sits under.
  const closer = 'Your agent can set them too, and this group opens by itself when it does, so '
    + 'nothing is written where you cannot see it.';

  const known = state ? state.requirementsKnown !== false : true;
  if (!known) {
    return 'The File button is not waiting for these. This page cannot say whether the insurer '
      + `asks for any of them until its rules load. ${closer}`;
  }

  const outstanding = Array.isArray(state && state.outstanding) ? state.outstanding : [];
  const wanted = outstanding.filter((entry) => entry && OPTIONAL_FIELDS.includes(entry.field));

  const insurer = typeof (state && state.insurer) === 'string' && state.insurer.trim().length > 0
    ? state.insurer.trim()
    : 'This insurer';

  if (wanted.length === 0) {
    return 'The File button does not wait for these. '
      + `${insurer} is not asking for any of them on this draft. ${closer}`;
  }

  // Capped for the same reason the file panel caps its list: a note that runs to five labels is a
  // note nobody finishes reading.
  const named = wanted.slice(0, MAX_NAMED_ASKS).map((entry) => entry.label);
  const rest = wanted.length - named.length;
  const asks = `${named.join('; ')}${rest > 0 ? `, and ${rest} more` : ''}`;

  // A colon before the labels, the same as the file panel, because a pack writes them capitalised
  // and "asking for The name of a witness" reads as a mistake.
  return 'The File button is waiting for the ones this insurer asks for. '
    + `${insurer} is asking for: ${asks}. Filing stays closed until they are answered. ${closer}`;
}
