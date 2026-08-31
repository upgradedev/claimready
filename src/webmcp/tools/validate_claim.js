/**
 * validate_claim: can this draft be filed, and what is holding it up.
 *
 * Read only. It returns field names, not the claimant's wording, so it carries no untrusted
 * content hint. It is also where the agent is told, plainly, that filing is not on this surface.
 *
 * IT REPORTS THE PAGE'S OWN DECISION, NOT A SECOND ONE. The verdict here is `canFile` from
 * src/core/filing.js, the same object the File button is drawn from and the same object
 * src/core/claim.js refuses a filing on. This tool used to answer from `validateClaim` alone, so
 * on a theft claim with no police report reference it said READY while its own next line said an
 * intake requirement was still open, and a model reading it told the claimant to press a button
 * the page would have refused. The static field check is still reported, because "which fields are
 * empty" is a useful separate fact, but it is no longer the answer to "can this be filed".
 */

import { toResult, budgetedBlock, clip, packOf } from '../register.js';
import { validateClaim } from '../../core/claim.js';
import { canFile } from '../../core/filing.js';

/**
 * How much of the open requirement id list to show.
 *
 * The ids come from the insurer's rule pack, so their number and their length are both the pack's
 * business and not this file's. Joining every one of them and handing the result to toResult put
 * this tool at exactly 1500 characters on a pack with a long list, and the line that went was the
 * closing one: the sentence that says filing is not on this surface. That sentence is the whole
 * point of this tool, so it is in the tail now and the id list is what gives way.
 */
const OPEN_IDS_ROOM = 300;
const WARNINGS_ROOM = 300;

/**
 * How much of the filing reason to print.
 *
 * THE REASON IS BODY AND NOT TAIL, AND THAT IS ARITHMETIC RATHER THAN TASTE. budgetedBlock throws
 * when the head and the tail cannot fit between them, and this sentence grows with the insurer's
 * rule pack: it names up to three requirement labels a pack writes and a pack chooses their
 * length. A line that grows belongs where it can be shortened and reported. It is the FIRST body
 * line so that it is the last one to give way, because it is the line a model acts on.
 */
const REASON_ROOM = 400;

/** Said whichever way the answer comes out, so the boundary is stated on every call. */
const NOT_A_TOOL = 'Filing is a control on this page and is not exposed as a WebMCP tool.';

export default (ctx) => ({
  name: 'validate_claim',

  description:
    'Check whether the claim draft on this page can be filed. Returns the filing decision with its '
    + 'refusal code, the required fields still missing, the intake requirements this insurer still '
    + 'has open, and any warnings about what has been entered. Filing the claim itself is a control '
    + 'on this page and is deliberately not exposed as a WebMCP tool, so finish the draft and then '
    + 'say it is ready.',

  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },

  annotations: {
    readOnlyHint: true
  },

  async execute(input, options) {
    if (options && options.signal && options.signal.aborted) {
      return toResult('Cancelled before the draft was checked.');
    }

    const claim = ctx.store.getState().claim;
    const verdict = validateClaim(claim);
    const pack = packOf(ctx);

    // The one decision. Same pack, same claim and same completed human actions as the page, so
    // what a model is told here and what a visitor sees beside the button are one answer.
    const decision = canFile(pack, claim, ctx.humanActions, { homePackId: ctx.homePackId ?? null });

    // The head is short whatever the pack says: a fixed sentence, a small number and a code from a
    // list of four. Everything that grows with the claim or the pack is below it.
    const head = [decision.ok
      ? `READY TO FILE at revision ${claim.revision}.`
      : `NOT READY TO FILE at revision ${claim.revision}. ${decision.code}.`];

    const body = [`Why: ${clip(decision.reason, REASON_ROOM)}`];

    if (verdict.missing && verdict.missing.length) {
      body.push(`Missing: ${verdict.missing.join(', ')}.`);
      body.push('Read the claim state for the revision, then send them with apply_claim_patch in one call.');
    }

    // Two different questions, and conflating them would be the tool overstating itself. The
    // required fields can all be filled while the insurer's intake is still waiting on something,
    // for instance a collection that no tool on this page reaches. Both now feed the one filing
    // decision above, and this line is what says which of them is still open.
    if (pack) {
      const open = decision.outstanding;
      body.push(open.length === 0
        ? "This insurer's intake requirements are all answered as well."
        : `Separately, ${open.length} of this insurer's intake requirements are still open: ${clip(open.map((entry) => entry.id).join(', '), OPEN_IDS_ROOM)}. Call get_requirements for why.`);
    }

    if (Array.isArray(verdict.warnings) && verdict.warnings.length) {
      body.push(`Warnings: ${clip(verdict.warnings.join(' '), WARNINGS_ROOM)}`);
    }

    const tail = [decision.ok
      ? `Tell the person on the page that they can press File this claim. ${NOT_A_TOOL}`
      : `${NOT_A_TOOL} It refuses a filing while the reason above stands, from the button and from a direct call alike.`];

    return toResult(budgetedBlock({
      head,
      body,
      tail,
      more: (count) => `${count} further line(s) were withheld to fit the output budget. Call get_requirements for the intake list in full.`,
    }));
  }
});
