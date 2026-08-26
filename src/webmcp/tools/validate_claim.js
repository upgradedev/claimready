/**
 * validate_claim: is the draft ready, and what is holding it up.
 *
 * Read only. It returns field names, not the claimant's wording, so it carries no untrusted
 * content hint. It is also where the agent is told, plainly, that filing is not its to do.
 */

import { toResult } from '../register.js';
import { validateClaim } from '../../core/claim.js';

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

    const verdict = validateClaim(ctx.store.getState().claim);
    const lines = [];

    lines.push(verdict.ready
      ? 'READY. Every required field is filled.'
      : 'NOT READY.');

    if (verdict.missing && verdict.missing.length) {
      lines.push(`Missing: ${verdict.missing.join(', ')}.`);
      lines.push('Use apply_claim_patch, one field per call, to fill them.');
    }

    if (Array.isArray(verdict.warnings) && verdict.warnings.length) {
      lines.push(`Warnings: ${verdict.warnings.join(' ')}`);
    }

    lines.push(verdict.ready
      ? 'Tell the person on the page that they can press File this claim. You cannot press it.'
      : 'Filing is a human button on the page. It is not available as a tool.');

    return toResult(lines.join('\n'));
  }
});
