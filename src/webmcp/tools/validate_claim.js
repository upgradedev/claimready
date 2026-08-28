/**
 * validate_claim: is the draft ready, and what is holding it up.
 *
 * Read only. It returns field names, not the claimant's wording, so it carries no untrusted
 * content hint. It is also where the agent is told, plainly, that filing is not its to do.
 */

import { toResult, budgetedBlock, clip, packOf } from '../register.js';
import { validateClaim } from '../../core/claim.js';
import { deriveRequirements, outstandingRequirements } from '../../core/requirements.js';

/**
 * How much of the open requirement id list to show.
 *
 * The ids come from the insurer's rule pack, so their number and their length are both the pack's
 * business and not this file's. Joining every one of them and handing the result to toResult put
 * this tool at exactly 1500 characters on a pack with a long list, and the line that went was the
 * closing one: the sentence that says filing is not available as a tool. That sentence is the
 * whole point of this tool, so it is in the tail now and the id list is what gives way.
 */
const OPEN_IDS_ROOM = 300;
const WARNINGS_ROOM = 300;

export default (ctx) => ({
  name: 'validate_claim',

  description:
    'Check whether the claim draft on this page is complete enough to file. Returns whether it is '
    + 'ready, the required fields still missing, and any warnings about what has been entered. '
    + 'Filing the claim itself is a button on the page pressed by a person, and is deliberately not '
    + 'available as a tool, so finish the draft and then say it is ready.',

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

    // The verdict and the revision are the head. Both are short whatever the pack says.
    const head = [verdict.ready
      ? `READY at revision ${claim.revision}. Every required field is filled.`
      : `NOT READY at revision ${claim.revision}.`];

    const body = [];

    if (verdict.missing && verdict.missing.length) {
      body.push(`Missing: ${verdict.missing.join(', ')}.`);
      body.push('Read the claim state for the revision, then send them with apply_claim_patch in one call.');
    }

    // Two different questions, and conflating them would be the tool overstating itself. The
    // required fields can all be filled while the insurer's intake is still waiting on something,
    // for instance a collection that no tool on this page reaches.
    const pack = packOf(ctx);
    if (pack) {
      const open = outstandingRequirements(deriveRequirements(pack, claim, ctx.humanActions));
      body.push(open.length === 0
        ? "This insurer's intake requirements are all answered as well."
        : `Separately, ${open.length} of this insurer's intake requirements are still open: ${clip(open.map((entry) => entry.id).join(', '), OPEN_IDS_ROOM)}. Call get_requirements for why.`);
    }

    if (Array.isArray(verdict.warnings) && verdict.warnings.length) {
      body.push(`Warnings: ${clip(verdict.warnings.join(' '), WARNINGS_ROOM)}`);
    }

    const tail = [verdict.ready
      ? 'Tell the person on the page that they can press File this claim. No tool here reaches it.'
      : 'Filing is a button on the page. It is deliberately not available as a tool.'];

    return toResult(budgetedBlock({
      head,
      body,
      tail,
      more: (count) => `${count} further line(s) were withheld to fit the output budget. Call get_requirements for the intake list in full.`,
    }));
  }
});
