/**
 * get_requirements: what this insurer's intake asks for, given the claim as it stands.
 *
 * Read only. It returns rule text the insurer published and field names, never the claimant's
 * wording, so it carries no untrusted content hint.
 *
 * THIS IS THE TOOL NOTHING ELSE REPLACES. An agent can guess a form's fields. It cannot guess that
 * answering "the car will not start" has just added two more things to the list, that one of them
 * is a field it may send, and that no tool on this page reaches the other. The page derives that
 * from the insurer's rule pack and the current claim, deterministically, and says which answer
 * brought each one into existence.
 *
 * Nothing here is predicted and nothing is decided. The rules are a table, the claim is data, and
 * the result is a lookup any reader can repeat by hand.
 */

import { toResult, budgetedBlock, clip, packOf, satisfiedByOf, NO_PACK_REASON } from '../register.js';
import { deriveRequirements, outstandingRequirements } from '../../core/requirements.js';

/** How much of one rule's reasoning to show when several are competing for the budget. */
const WHY_FLOOR = 110;
const WHY_CEILING = 420;

export default (ctx) => ({
  name: 'get_requirements',

  description:
    "What this insurer's intake still asks for, worked out from its published rule pack and the "
    + 'claim as it stands right now. Each entry gives an id, what to ask the claimant for, the '
    + 'clause behind it, the field that answers it, and which answer on the draft brought it into '
    + 'existence. Call it again after anything changes: requirements appear and disappear as the '
    + 'claim changes, and some can only be satisfied by a person acting on the page.',

  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: {
        type: 'string',
        description: 'Optional. One requirement id, returned in full rather than shortened.'
      },
      include: {
        type: 'string',
        enum: ['outstanding', 'all'],
        description: 'Optional. Outstanding is the default. All adds the ones already answered.'
      }
    }
  },

  annotations: {
    readOnlyHint: true
  },

  async execute(input, options) {
    if (options && options.signal && options.signal.aborted) {
      return toResult('Cancelled before the requirements were read.');
    }

    const pack = packOf(ctx);
    if (!pack) return toResult(NO_PACK_REASON);

    const claim = ctx.store.getState().claim;
    // ctx.humanActions carries the ids of the human actions the page reports as carried out. It
    // goes to src/core rather than being interpreted here, so this tool, read_claim_state and the
    // panel on the page can only ever give one answer about what is still open.
    const requirements = deriveRequirements(pack, claim, ctx.humanActions);
    const open = outstandingRequirements(requirements);
    const answered = requirements.filter((entry) => entry.satisfied === true);

    const wanted = input && typeof input.id === 'string' ? input.id.trim() : '';
    if (wanted) {
      const one = requirements.find((entry) => entry.id === wanted);
      if (!one) {
        const known = requirements.map((entry) => entry.id).join(', ');
        return toResult(
          `No requirement with the id "${wanted}" applies to this claim as it stands. `
          + `The ones that do: ${known || 'none'}.`
        );
      }
      return toResult(budgetedBlock({
        head: [`${one.id}, ${one.satisfied ? 'answered' : 'still open'}: ${one.label}`],
        body: [detail(pack, one, WHY_CEILING)],
        tail: [`Claim revision ${claim.revision}. This is what the intake asks for, not a decision about the claim.`],
      }));
    }

    const includeAll = Boolean(input && input.include === 'all');

    const head = [
      `${pack.insurer} intake rules, claim revision ${claim.revision}. `
      + `${open.length} of ${requirements.length} requirement(s) still open.`,
    ];

    const room = Math.max(WHY_FLOOR, Math.floor(900 / Math.max(1, open.length)));
    const body = [];
    for (const entry of open) {
      body.push(`- ${entry.id}: ${entry.label}`);
      body.push(`  ${detail(pack, entry, Math.min(WHY_CEILING, room))}`);
    }

    if (includeAll && answered.length) {
      for (const entry of answered) {
        body.push(`- ${entry.id}: answered already, ${clip(entry.label, 80)}`);
      }
    } else if (answered.length) {
      body.push(`Already answered: ${answered.map((entry) => entry.id).join(', ')}.`);
    }

    const tail = [
      'Ask for one id to get its full wording. Nothing in this list adjudicates the claim.',
    ];

    return toResult(budgetedBlock({
      head,
      body,
      tail,
      more: (count) => `${count} more line(s) not shown. Ask for a single id to read one in full.`,
    }));
  }
});

/**
 * The reasoning behind one requirement, plus the only sentence that tells an agent what to do
 * about it: which field answers it, or that no field does.
 */
function detail(pack, entry, room) {
  const target = satisfiedByOf(pack, entry.id);
  const how = target.field
    ? `Answered by sending ${target.field} with apply_claim_patch.`
    : 'No field answers this one and no tool on this page reaches it. Ask the person on the page.';
  const trigger = entry.triggeredBy ? ` Brought in by ${entry.triggeredBy}.` : '';
  return `${how}${trigger} ${clip(entry.why, room)}`;
}
