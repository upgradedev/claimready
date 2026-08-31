/**
 * The one decision about whether this draft can be filed.
 *
 * PURE MODULE. No DOM, no browser globals, no network, no timers, no I/O. A rule pack is plain
 * data and is handed in, so this runs unchanged under `node --test` and inside a page.
 *
 * WHY IT EXISTS. The gate was asked three times, in three places, from three different inputs:
 * `fileClaim` read the static required list alone, the store's file action carried no rule pack at
 * all, and the File button read `ready` off the validation result. So a theft claim with no police
 * report reference reported one open intake requirement in the panel, in `get_requirements` and in
 * `read_claim_state`, and filed anyway, from the button and from a direct call. The insurer's own
 * derived requirements were absent from every layer that actually decided.
 *
 * One answer, computed once, read by all of them: the domain action, the store, the page and the
 * tool that reports readiness to a model. Nothing downstream re-derives it, so nothing downstream
 * can drift from it.
 *
 * IT FAILS CLOSED. Called with no usable rule pack it refuses, with a code and a sentence, rather
 * than falling back to the static list. Without the pack this page does not know what the intake
 * asks for, and filing on the strength of a list that never loaded is the same defect one step
 * further along. That is also why a direct call to `fileClaim` cannot be a way around the gate:
 * the refusal lives here and `fileClaim` has no second opinion.
 *
 * THE SENTENCE IS THE PANEL'S SENTENCE. `reason` is built by `fileGateStatement` for the three
 * cases that function covers, so the words beside the button, the words a refused call hands back
 * and the words `validate_claim` reports to a model are one string from one function rather than
 * three phrasings of one idea.
 *
 * A NOTE ON THE IMPORT CYCLE. `claim.js` imports `canFile` from here, and this module imports from
 * `claim.js` and from `requirements.js`, which imports `claim.js` too. That is a cycle, and it is
 * safe for exactly one reason, which is the same rule `src/webmcp/register.js` states in its own
 * header: no module in the cycle READS an imported binding while it is still evaluating. Every
 * reference below is inside a function body, so it resolves at call time when all three modules
 * have finished. Do not add a top level constant here that is computed from an import.
 * `tests/unit/filing.test.js` enters the graph through this module to keep that honest.
 */

import { validateClaim } from './claim.js';
import {
  deriveRequirements,
  outstandingRequirements,
  fileGateStatement,
} from './requirements.js';

/**
 * The filing refusal vocabulary. Four codes, no more, and a caller branches on the code rather
 * than on the sentence.
 *
 * These are filing codes and are deliberately not the PATCH_REJECTED family in claim.js: a patch
 * and a filing are different acts, refused for different reasons, and one vocabulary covering both
 * would tell a reader less than either does now.
 */
export const FILE_CODES = {
  alreadyFiled: 'FILE_REFUSED_ALREADY_FILED',
  noPack: 'FILE_REFUSED_NO_PACK',
  borrowedRules: 'FILE_REFUSED_BORROWED_RULES',
  incomplete: 'FILE_REFUSED_INCOMPLETE',
  requirements: 'FILE_REFUSED_REQUIREMENTS',
};

/** Said when the insurer's rules never loaded. Named once so every surface says it identically. */
export const NO_PACK_FILING_REASON =
  'The insurer rule pack did not load, so this page cannot say what the intake still asks for, '
  + 'and filing stays closed until it does.';

/** Said when this claim has already been filed. */
export const ALREADY_FILED_REASON = 'This claim has already been filed.';

/**
 * Said when the rules in hand belong to an insurer this policy is not with.
 *
 * The picker on the page loads another insurer's published rules against the same claim, which is
 * worth having: it is how a visitor sees that the requirements, the clause and the excess are the
 * pack talking rather than this page. What it is not is a way to file. A claim is filed under its
 * own insurer's rules, and a page that says "policy MTR-2026-0417 is not with Kestrel Assurance"
 * two panels above the File button and then files under Kestrel's intake is telling a reader two
 * different things at once. That was the shape of the first filing defect this module was written
 * to close, one input further out.
 *
 * @param {(string|null)} insurer the insurer whose rules are loaded
 * @returns {string}
 */
export function borrowedRulesReason(insurer) {
  const name = typeof insurer === 'string' && insurer.trim().length > 0 ? insurer.trim() : 'another insurer';
  return `These are ${name}'s published rules, read against a policy that is not with ${name}. `
    + 'A claim is filed under its own insurer\'s rules, so load this policy\'s own rule pack '
    + 'before filing. Everything else on the page still answers under the pack you picked.';
}

/**
 * Whether the thing handed in is a rule pack this module can read.
 *
 * Checked rather than trusted, and a half loaded pack counts as no pack. `deriveRequirements`
 * throws on anything else, and a throw here would reach a tool as a hard failure instead of a
 * sentence a model can act on.
 *
 * @param {*} pack
 * @returns {boolean}
 */
function isUsablePack(pack) {
  if (!pack || typeof pack !== 'object') return false;
  // A list of requirements alone is not a pack. `{ requirements: [] }` used to pass here and then
  // answer for an insurer with no name, no id and no schedule, which is a worse failure than no
  // pack at all because it looks like an answer. The three fields below are the ones every surface
  // downstream reads: the id decides whose rules these are, the requirements decide the intake,
  // and the coverages decide the cover check.
  if (!Array.isArray(pack.requirements)) return false;
  if (!Array.isArray(pack.coverages)) return false;
  return typeof pack.id === 'string' && pack.id.trim().length > 0;
}

/** The pack's own id, trimmed, or null when it does not state one. */
function packIdOf(pack) {
  return pack && typeof pack.id === 'string' && pack.id.trim().length > 0 ? pack.id.trim() : null;
}

/** The insurer's own name, when the pack states one. */
function insurerOf(pack) {
  const name = pack && typeof pack.insurer === 'string' ? pack.insurer.trim() : '';
  return name.length > 0 ? name : null;
}

/**
 * Can this draft be filed, and if not, what is holding it up.
 *
 * The answer is complete whichever way it comes out: `missing` and `outstanding` are filled in on
 * every path they can be known on, so a refusal for one reason never hides the other fact. `code`
 * names the first thing blocking the filing, in the order the checks run below.
 *
 * @param {object|null} pack an insurer rule pack from policy.js, or null when none loaded
 * @param {object} claim a claim from claim.js
 * @param {(string[]|Set<string>)} [completedHumanActions] ids of the requirements whose human
 *        action the caller reports as carried out on the page. Omit it and none counts as done.
 * @returns {{ok: boolean, code: (string|null), reason: string, missing: string[],
 *            outstanding: Array<{id: string, label: string, field: (string|null),
 *                                humanAction: (string|null)}>,
 *            requirementsKnown: boolean, insurer: (string|null)}}
 * @throws {TypeError} when the claim is missing
 */
export function canFile(pack, claim, completedHumanActions, options) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('canFile needs a claim object.');
  }

  const known = isUsablePack(pack);
  const insurer = known ? insurerOf(pack) : null;

  // Whose policy this is, as the page states it, against whose rules are loaded. Absent, nothing
  // below changes: a caller that does not know the home insurer gets the same answer this function
  // gave before the borrowed check existed.
  const homePackId = options && typeof options.homePackId === 'string' && options.homePackId.trim().length > 0
    ? options.homePackId.trim()
    : null;
  const activeId = packIdOf(pack);
  const borrowed = Boolean(known && homePackId && activeId && activeId !== homePackId);

  // The static half comes from validateClaim rather than from a second filter, so "which required
  // fields are empty" has one answer in this repository and not two that agree by coincidence.
  const missing = validateClaim(claim).missing;

  const outstanding = known
    ? outstandingRequirements(deriveRequirements(pack, claim, completedHumanActions)).map((entry) => ({
      id: entry.id,
      label: entry.label,
      field: entry.field ?? null,
      humanAction: entry.humanAction ?? null,
    }))
    : [];

  const facts = { missing, outstanding, requirementsKnown: known, insurer, borrowed };

  if (claim.status === 'filed') {
    return { ok: false, code: FILE_CODES.alreadyFiled, reason: ALREADY_FILED_REASON, ...facts };
  }

  const said = fileGateStatement({
    ready: missing.length === 0,
    missing,
    outstanding,
    insurer,
    requirementsKnown: true,
  });

  // Before the field check, on purpose. Without the pack this page cannot answer the question that
  // was asked, and saying so is a different statement from listing what is missing. The empty
  // fields are named after it rather than instead of it, because both facts are true and a
  // claimant looking at a degraded page is still owed the one they can act on.
  if (!known) {
    const alsoEmpty = missing.length > 0 ? ` ${said}` : '';
    return { ok: false, code: FILE_CODES.noPack, reason: `${NO_PACK_FILING_REASON}${alsoEmpty}`, ...facts };
  }

  // Before the field and requirement checks, because a draft that is complete under the wrong
  // insurer's intake is not a draft that can be filed, and naming the missing fields first would
  // send a claimant to fill in answers for a pack that is not going to file anything.
  if (borrowed) {
    return {
      ok: false,
      code: FILE_CODES.borrowedRules,
      reason: borrowedRulesReason(insurer),
      ...facts,
    };
  }

  if (missing.length > 0) {
    return { ok: false, code: FILE_CODES.incomplete, reason: said, ...facts };
  }

  if (outstanding.length > 0) {
    return { ok: false, code: FILE_CODES.requirements, reason: said, ...facts };
  }

  return { ok: true, code: null, reason: said, ...facts };
}
