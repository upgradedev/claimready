/**
 * validate_claim: is the draft ready, and what is holding it up.
 *
 * Read only. It returns field names, not the claimant's wording, so it carries no untrusted
 * content hint. It is also where the agent is told, plainly, that filing is not its to do.
 */

import { toResult, packOf } from '../register.js';
import { validateClaim } from '../../core/claim.js';
import { deriveRequirements, outstandingRequirements } from '../../core/requirements.js';

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
    const lines = [];

    lines.push(verdict.ready
      ? `READY at revision ${claim.revision}. Every required field is filled.`
      : `NOT READY at revision ${claim.revision}.`);

    if (verdict.missing && verdict.missing.length) {
      lines.push(`Missing: ${verdict.missing.join(', ')}.`);
      lines.push('Read the claim state for the revision, then send them with apply_claim_patch in one call.');
    }

    if (Array.isArray(verdict.warnings) && verdict.warnings.length) {
      lines.push(`Warnings: ${verdict.warnings.join(' ')}`);
    }

    // Two different questions, and conflating them would be the tool overstating itself. The
    // required fields can all be filled while the insurer's intake is still waiting on something,
    // for instance a collection only a person can arrange.
    const pack = packOf(ctx);
    if (pack) {
      const open = outstandingRequirements(deriveRequirements(pack, claim));
      lines.push(open.length === 0
        ? "This insurer's intake requirements are all answered as well."
        : `Separately, ${open.length} of this insurer's intake requirements are still open: ${open.map((entry) => entry.id).join(', ')}. Call get_requirements for why.`);
    }

    lines.push(verdict.ready
      ? 'Tell the person on the page that they can press File this claim. You cannot press it.'
      : 'Filing is a human button on the page. It is not available as a tool.');

    return toResult(lines.join('\n'));
  }
});
