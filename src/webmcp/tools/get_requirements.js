/**
 * get_requirements: what this insurer's intake asks for, given the claim as it stands.
 *
 * Read only. It returns rule text the insurer published and field names, never the claimant's
 * wording, so it carries no untrusted content hint.
 *
 * THIS IS THE TOOL NOTHING ELSE REPLACES. An agent can read a form's fields off the page. Nothing
 * on the page says that answering "the car will not start" has just added two more things to the
 * list, that one of them is a field it may send, and that no tool here reaches the other. The page
 * derives that from the insurer's rule pack and the current claim, deterministically, and says
 * which answer brought each one into existence.
 *
 * Nothing here is predicted and nothing is decided. The rules are a table, the claim is data, and
 * the result is a lookup any reader can repeat by hand.
 */

import { ZONE_LABELS } from '../../core/claim.js';
import { toResult, budgetedBlock, clip, packOf, satisfiedByOf, NO_PACK_REASON } from '../register.js';
import { deriveRequirements, outstandingRequirements } from '../../core/requirements.js';

/** How much of one rule's reasoning to show when several are competing for the budget. */
const WHY_FLOOR = 110;
const WHY_CEILING = 420;

/**
 * How much of the pack's own strings may reach a head line.
 *
 * budgetedBlock keeps the head whole and refuses loudly when it cannot, so anything that goes in a
 * head has to have a length this file decides. The insurer name, the requirement ids and the
 * requirement labels are all rule pack data with no length of their own, and the id an agent asks
 * for is not even that: it is whatever the caller sent. A 2400 character label in a pack was
 * enough to make the single id answer refuse to assemble at all.
 */
const INSURER_ROOM = 80;
const ID_ROOM = 60;
const LABEL_ROOM = 300;
const KNOWN_IDS_ROOM = 800;

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
        const known = clip(requirements.map((entry) => entry.id).join(', '), KNOWN_IDS_ROOM);
        return toResult(
          `No requirement with the id "${clip(wanted, ID_ROOM)}" applies to this claim as it stands. `
          + `The ones that do: ${known || 'none'}.`
        );
      }
      return toResult(budgetedBlock({
        head: [`${clip(one.id, ID_ROOM)}, ${one.satisfied ? 'answered' : 'still open'}: ${clip(one.label, LABEL_ROOM)}`],
        body: [detail(pack, one, WHY_CEILING)],
        tail: [`Claim revision ${claim.revision}. This is what the intake asks for, not a decision about the claim.`],
        more: () => 'The clause behind this one did not fit and is on the page.',
      }));
    }

    const includeAll = Boolean(input && input.include === 'all');

    const head = [
      `${clip(String(pack.insurer), INSURER_ROOM)} intake rules, claim revision ${claim.revision}. `
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
      body.push(`Already answered: ${clip(answered.map((entry) => entry.id).join(', '), KNOWN_IDS_ROOM)}.`);
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
  return `${how}${vocabulary(target.field)}${trigger} ${clip(entry.why, room)}`;
}

/**
 * The one field whose values are a convention rather than a word, spelled out where an agent asks
 * what it needs.
 *
 * FOUND BY WATCHING A MODEL FAIL AT IT. In a run of the impact harness, a model was told "it caught
 * the left front wing" and left damage_zone empty, while the same model filled it in against a form
 * that spelled the convention out. The page's own select has always said "10 o'clock, left front
 * wing"; the tool surface said only that the field was required. That is this entry's whole claim
 * failing in miniature: the page is supposed to hand the agent the insurer's vocabulary, and here it
 * kept it on screen and out of the tools. Built from ZONE_LABELS so the two cannot drift.
 */
function vocabulary(field) {
  if (field !== 'damage_zone') return '';
  const examples = [12, 3, 6, 9, 10]
    .map((zone) => `${zone} is the ${ZONE_LABELS[zone]}`)
    .join(', ');
  return ` Positions are clock hours seen from above with 12 at the front: ${examples}.`;
}
