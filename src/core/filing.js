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
 * IT FAILS CLOSED ON IDENTITY TOO, AND THAT IS NEWER. A missing policy number and a missing home
 * insurer used to be waved through, so a draft with `policy_id: null` filed and produced a sealed
 * packet referenced `CR-UNKNOWN`, and a caller that named no home pack filed a policy under any
 * insurer's rules that happened to be loaded. Both are facts the answer depends on, so both are
 * asked in `filingIdentity` below and neither has a default. Nothing else closes: comparing packs,
 * reading requirements and checking cover all still answer without either fact, because none of
 * them asserts where the claim went.
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

import { checkClaimSnapshot, validateClaim } from './claim.js';
import { isValidatedPack } from './policy.js';
import {
  deriveRequirements,
  outstandingRequirements,
  fileGateStatement,
} from './requirements.js';

/**
 * The filing refusal vocabulary. A caller branches on the code rather than on the sentence.
 *
 * These are filing codes and are deliberately not the PATCH_REJECTED family in claim.js: a patch
 * and a filing are different acts, refused for different reasons, and one vocabulary covering both
 * would tell a reader less than either does now.
 *
 * The two identity codes are newer than the rest and they close a filing that used to go through
 * on facts nobody had supplied. NO_POLICY_ID is a draft that never says which policy it is on, and
 * NO_HOME_INSURER is a page that never says which insurer that policy is with. Neither is a
 * question about the claim's content, so both are answered before the fields and the requirements
 * are looked at.
 */
export const FILE_CODES = {
  alreadyFiled: 'FILE_REFUSED_ALREADY_FILED',
  noPack: 'FILE_REFUSED_NO_PACK',
  noPolicyId: 'FILE_REFUSED_NO_POLICY_ID',
  noHomeInsurer: 'FILE_REFUSED_NO_HOME_INSURER',
  borrowedRules: 'FILE_REFUSED_BORROWED_RULES',
  incomplete: 'FILE_REFUSED_INCOMPLETE',
  requirements: 'FILE_REFUSED_REQUIREMENTS',
  // Not about what the draft is missing. About what it holds: a severity this page has no word
  // for, a clock position of 47, an object where the claimant's account belongs. `checkClaimSnapshot`
  // in claim.js decides it and writes the sentence.
  unusableState: 'FILE_REFUSED_UNUSABLE_STATE',
  // Not a decision `canFile` ever reaches. A filing time is handed in by whoever files, and this
  // is the code `fileClaim` answers with when what arrived is not one. It lives here so every
  // filing refusal a caller can meet is named in one list.
  noFilingTime: 'FILE_REFUSED_NO_FILING_TIME',
};

/** Said when the insurer's rules never loaded. Named once so every surface says it identically. */
export const NO_PACK_FILING_REASON =
  'The insurer rule pack did not load, so this page cannot say what the intake still asks for, '
  + 'and filing stays closed until it does.';

/** Said when this claim has already been filed. */
export const ALREADY_FILED_REASON = 'This claim has already been filed.';

/**
 * Said when the draft does not say which policy it is on.
 *
 * A filing is an assertion about one policy. Without the number there is nothing to assert it
 * against, and the packet used to write the gap out as the word UNKNOWN inside a reference and a
 * null beside "Policy number", both of them sealed under a digest that made the gap look
 * deliberate. Refusing costs a claimant nothing, because the number is on the policy they are
 * claiming under and is not something they have to work out.
 */
export const NO_POLICY_ID_FILING_REASON =
  'This draft does not say which policy it is on, so there is nothing to file it against. A claim '
  + 'is filed on a policy number, and this page will not invent one.';

/**
 * Said when nothing has told this page which insurer the policy is with.
 *
 * THIS IS THE FACT THE BORROWED RULES CHECK IS BUILT ON, SO ITS ABSENCE CANNOT BE A PASS. The
 * check compares the pack in hand against the policy's own insurer. Where the second half is
 * missing the comparison has no opinion, and treating no opinion as a yes is what let a Northwind
 * policy file under the rules of whichever pack happened to be loaded. The comparison is not
 * available, so filing is not available, and the page says which of the two is missing.
 *
 * Only filing closes. Loading another insurer's pack, reading its requirements, checking the cover
 * and comparing the two are all still open, because none of them asserts anything about where the
 * claim went.
 */
export const NO_HOME_INSURER_FILING_REASON =
  'This page has not been told which insurer this policy is with, so it cannot tell whether the '
  + 'rules in hand are that insurer\'s. Filing stays closed until it can. Comparing packs and '
  + 'checking the cover still work.';

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
 * Whether the thing handed in is a rule pack this build actually loaded and checked.
 *
 * THIS USED TO BE A SHAPE CHECK AND THE SHAPE WAS FORGEABLE. It asked for an `id`, a `requirements`
 * array and a `coverages` array, which is a description of a pack rather than evidence that
 * src/core/policy.js ever read one. Measured on an object literal typed out by hand:
 *
 *   canFile ok: true code: null
 *   fileClaim ok: true status: filed
 *   sealed insurer : Totally Not An Insurer
 *   sealed clause  : MADE-UP-1
 *   sealed excess  : 1
 *
 * A whole FNOL packet, sealed under a digest, describing an insurer that does not exist and a
 * clause that says nothing, and every one of those facts came from the caller.
 *
 * WHICH OF THE THREE MARKERS THIS MODULE USES, AND WHY. A public boolean such as `validated: true`
 * was rejected first, because the forgery above would just have carried it: a marker a caller can
 * write proves only that the caller wrote it. Deep revalidation at each boundary was rejected
 * second, because this function is called on every keystroke that redraws the file gate and running
 * the loader again each time is work a phone would feel. What is used instead is a WeakSet held
 * privately inside src/core/policy.js, which `loadPolicyPack` adds to on its last line and which
 * nothing else in this repository can reach. Membership is not a property, so it cannot be typed,
 * spread, copied or serialised in. `isValidatedPack` is the reading half and there is no exported
 * writing half.
 *
 * THE SHAPE CHECKS STAY, UNDERNEATH. They are cheap, they still name what every surface downstream
 * reads, and keeping them means the four counterexamples in
 * tests/unit/filing_borrowed_pack.test.js still fail for the reason they were written for.
 *
 * Still checked rather than trusted, and still a boolean rather than a throw: `deriveRequirements`
 * throws on anything else, and a throw here would reach a tool as a hard failure instead of a
 * sentence a model can act on.
 *
 * @param {*} pack
 * @returns {boolean}
 */
function isUsablePack(pack) {
  if (!pack || typeof pack !== 'object') return false;
  // The one question that cannot be answered by the object itself.
  if (!isValidatedPack(pack)) return false;
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

/**
 * Whose rules are these, and are they this policy's.
 *
 * Exported because more than one decision needs the same answer and none of them may compute it
 * separately: the file gate below, and the handler packet in src/core/packet.js, which must refuse
 * to describe a filing that could not have happened. One function, one answer, both callers.
 *
 * @param {*} pack an insurer rule pack, or anything at all
 * @param {{homePackId?: (string|null)}} [options] whose policy this is, as the page states it
 * @returns {{usable: boolean, packId: (string|null), insurer: (string|null),
 *            homePackId: (string|null), borrowed: boolean}}
 */
export function packIdentity(pack, options) {
  const usable = isUsablePack(pack);
  const packId = usable ? packIdOf(pack) : null;
  const homePackId = options && typeof options.homePackId === 'string' && options.homePackId.trim().length > 0
    ? options.homePackId.trim()
    : null;
  return {
    usable,
    packId,
    insurer: usable ? insurerOf(pack) : null,
    homePackId,
    borrowed: Boolean(usable && homePackId && packId && packId !== homePackId),
  };
}

/** The insurer's own name, when the pack states one. */
function insurerOf(pack) {
  const name = pack && typeof pack.insurer === 'string' ? pack.insurer.trim() : '';
  return name.length > 0 ? name : null;
}

/**
 * The policy number this claim states, trimmed, or null when it does not state one.
 *
 * `policy_id` is a protected field on a claim, so it is not in the required list `validateClaim`
 * walks and no patch can put it there. That is right for a field the page seeds from the policy,
 * and it meant nothing anywhere checked it was present: a claim carrying null filed, and the
 * sealed packet wrote the hole out as `CR-UNKNOWN-R2` with a null policy number under it.
 *
 * A whitespace only value is treated as absent for the same reason a whitespace only pack id is.
 * A number nobody can read is not a number.
 *
 * @param {*} claim
 * @returns {(string|null)}
 */
export function policyIdOf(claim) {
  if (!claim || typeof claim !== 'object') return null;
  return typeof claim.policy_id === 'string' && claim.policy_id.trim().length > 0
    ? claim.policy_id.trim()
    : null;
}

/**
 * May this claim be filed under this pack at all, on identity alone.
 *
 * WHY THIS IS ITS OWN FUNCTION. Three entry points have to answer this identically: `canFile`
 * below, `fileClaim` in claim.js which has no second opinion and reaches it through `canFile`, and
 * `buildFilingPacket` in packet.js, which cannot use `canFile` because a filed claim short circuits
 * it on ALREADY_FILED. Before this existed the packet re-asked two of the four questions in its own
 * words and never asked the other two, so a packet could describe a filing the gate would refuse.
 * One function, one order, one set of codes.
 *
 * IT FAILS CLOSED ON EVERY MISSING FACT, and the order is the order a reader would ask in. Whose
 * rules are these, which policy is this, whose insurer is that policy with, and do the first and
 * the third agree. A missing answer refuses. It never guesses, and in particular it never reads the
 * pack in hand as evidence of whose policy this is, because that is the assumption the whole check
 * exists to remove.
 *
 * `refusal` carries a FILE_REFUSED code. A caller with its own vocabulary, which is packet.js,
 * translates it rather than inventing a fifth ordering of the same questions.
 *
 * @param {*} pack an insurer rule pack, or anything at all
 * @param {object} claim a claim from claim.js
 * @param {{homePackId?: (string|null)}} [options] whose policy this is, as the page states it
 * @returns {{usable: boolean, packId: (string|null), insurer: (string|null),
 *            homePackId: (string|null), borrowed: boolean, policyId: (string|null),
 *            refusal: ({code: string, reason: string}|null)}}
 */
export function filingIdentity(pack, claim, options) {
  const identity = packIdentity(pack, options);
  const policyId = policyIdOf(claim);

  let refusal = null;
  if (!identity.usable) {
    refusal = { code: FILE_CODES.noPack, reason: NO_PACK_FILING_REASON };
  } else if (!policyId) {
    refusal = { code: FILE_CODES.noPolicyId, reason: NO_POLICY_ID_FILING_REASON };
  } else if (!identity.homePackId) {
    refusal = { code: FILE_CODES.noHomeInsurer, reason: NO_HOME_INSURER_FILING_REASON };
  } else if (identity.borrowed) {
    refusal = { code: FILE_CODES.borrowedRules, reason: borrowedRulesReason(identity.insurer) };
  }

  return { ...identity, policyId, refusal };
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
 * @param {{homePackId?: (string|null)}} [options] which pack the policy is actually with, as the
 *        page states it. Omit it and filing is refused: this is a fact the answer depends on, not
 *        a decoration on it, and a caller that cannot supply it is a caller that cannot file.
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

  // WHAT THE DRAFT HOLDS IS ASKED BEFORE WHAT IT IS MISSING, AND BEFORE ANYTHING ELSE.
  //
  // `validateClaim` below answers one question, which required field is empty, and it does not look
  // at a single held value. So a claim carrying `severity: "catastrophic"`, `damage_zone: 47` or an
  // object where the claimant's own account belongs came through this gate reading "The draft is
  // complete. Filing is yours to do." and was sealed into a handler packet. Both doors into a claim
  // push every value through the field validators, so a snapshot that fails here did not come
  // through either of them and there is nothing this function can honestly say about it.
  //
  // IT IS A REFUSAL RATHER THAN A THROW, like every other answer here, so the page draws it beside
  // the button and a model reads it as a sentence it can act on.
  const snapshot = checkClaimSnapshot(claim);
  if (!snapshot.ok) {
    return {
      ok: false,
      code: FILE_CODES.unusableState,
      reason: snapshot.reason,
      // Still as complete as it can honestly be, which is what the docstring promises: filled in on
      // every path they can be KNOWN on. Nothing was derived from the pack, so the requirements are
      // not known and every reader downstream fails closed on that.
      //
      // WHICH FIELD IS EMPTY IS ASKED ONLY WHEN THE CLAIM CAN BE READ. This line used to say
      // `missing` was safe to compute on any object because it only asks which fields are empty.
      // That was true until the snapshot check started refusing a claim that answers a field from
      // a getter, because asking a getter runs somebody else's code. Measured on a claim carrying
      // a getter on `driver` that throws:
      //
      //   fileClaim THREW Error: boom, from validateClaim on this line
      //
      // So the gate refused the claim and then crashed reporting the refusal. `readable` says the
      // snapshot's shape gate passed, which is exactly the condition under which reading a field
      // returns a stored value.
      missing: snapshot.readable ? validateClaim(claim).missing : [],
      outstanding: [],
      requirementsKnown: false,
      insurer: null,
      borrowed: false,
    };
  }

  // One answer about whose rules these are and whose policy this is, shared with src/core/packet.js.
  const identity = filingIdentity(pack, claim, options);
  const known = identity.usable;
  const insurer = identity.insurer;
  const borrowed = identity.borrowed;

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

  // EVERY IDENTITY QUESTION IS ANSWERED BEFORE ANY QUESTION ABOUT THE CONTENT, on purpose. A draft
  // that is complete under the wrong insurer's intake, or on a policy nobody has named, is not a
  // draft that can be filed, and listing the empty fields first would send a claimant off to fill
  // in answers for a filing that was never going to happen.
  //
  // The no pack case is the one that also names the empty fields, because that page is degraded
  // rather than wrong: the claimant cannot fix the missing rules and can fix the missing fields, so
  // both facts are true and they are owed the one they can act on. The other three are refusals
  // about the claim's identity, and a list of empty fields beside them would read as the thing to
  // go and do next, which it is not.
  if (identity.refusal) {
    const alsoEmpty = identity.refusal.code === FILE_CODES.noPack && missing.length > 0 ? ` ${said}` : '';
    return { ok: false, code: identity.refusal.code, reason: `${identity.refusal.reason}${alsoEmpty}`, ...facts };
  }

  if (missing.length > 0) {
    return { ok: false, code: FILE_CODES.incomplete, reason: said, ...facts };
  }

  if (outstanding.length > 0) {
    return { ok: false, code: FILE_CODES.requirements, reason: said, ...facts };
  }

  return { ok: true, code: null, reason: said, ...facts };
}
