/**
 * get_assistance_options: what this insurer offers when the car cannot be driven.
 *
 * Read only, and it does not exist most of the time.
 *
 * THE TOOL SET IS PART OF THE STATE. This tool is registered only while the claim says the
 * vehicle cannot be driven, and it is withdrawn the moment that answer changes back. An agent
 * that lists the page's tools before and after the claimant answers that one question sees a
 * different set, which is the page telling it what is relevant now rather than publishing every
 * branch of the rulebook at once and hoping the model picks the right one. The registration and
 * the withdrawal both live in src/webmcp/register.js, one AbortController per tool.
 *
 * The options are read out of the insurer's rule pack, not composed here. Swap the pack and this
 * answer changes with no code edited.
 *
 * ONE FACT COMES FROM THE PAGE, AND THIS FILE DOES NOT INTERPRET IT. Whether the person has
 * already pressed the assistance button is page state, not claim state, so src/core cannot know
 * it and this tool would otherwise keep telling an agent to ask for something the claimant did a
 * minute ago. The page reports the completed actions as ids on ctx.humanActions, and those go
 * straight into deriveRequirements, which is the only thing in the tree that decides whether a
 * requirement is answered.
 *
 * THIS FILE USED TO DECIDE IT ITSELF, AND THAT WAS THE DEFECT. It inferred "done on the page"
 * from the presence of a note the page had attached, while get_requirements and read_claim_state
 * asked src/core and were told the same requirement was still open. Two tools, one claim, one
 * moment, two answers. Reading the same derivation as everybody else is the fix, and no tool may
 * infer completion from a decoration again.
 *
 * NOTHING HERE BOOKS ANYTHING. Arranging the collection is a button a person presses on the page.
 * No tool on this page reaches it and none ever should, because a recovery truck arriving at
 * somebody's house is exactly the sort of thing an agent should not be able to cause on its own.
 */

import { toResult, budgetedBlock, clip, packOf, NO_PACK_REASON } from '../register.js';
import { deriveRequirements } from '../../core/requirements.js';

const TRIGGER_FIELD = 'vehicle_drivable';

export default (ctx) => ({
  name: 'get_assistance_options',

  description:
    'What this insurer offers for a vehicle that cannot be driven, read from its published rule '
    + 'pack: what has to be arranged, the clause behind it, and which parts you can answer against '
    + 'the claim yourself. This tool is only registered while the claim says the vehicle cannot be '
    + 'driven. Arranging the collection itself is a button on the page that the person presses, '
    + 'and is deliberately not available as a tool.',

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
      return toResult('Cancelled before the options were read.');
    }

    const claim = ctx.store.getState().claim;

    // Defensive. The page withdraws this tool when the answer changes, but a call already in
    // flight must still answer honestly rather than describe a situation that has passed.
    if (!claim || claim[TRIGGER_FIELD] !== false) {
      return toResult(
        'The claim no longer says the vehicle cannot be driven, so these options do not apply. '
        + 'This tool is withdrawn while the vehicle is drivable. Read the claim state for where '
        + 'things now stand.'
      );
    }

    const pack = packOf(ctx);
    if (!pack) return toResult(NO_PACK_REASON);

    const triggered = deriveRequirements(pack, claim, ctx.humanActions)
      .filter((entry) => entry.triggeredBy === TRIGGER_FIELD);

    if (triggered.length === 0) {
      return toResult(
        `${pack.insurer} states nothing extra for a vehicle that cannot be driven on this claim. `
        + 'Ask the person on the page what they would like to do next.'
      );
    }

    const body = [];
    let index = 0;

    for (const entry of triggered) {
      index += 1;
      let how;
      if (entry.field) {
        how = `You can answer this one: send ${entry.field} with apply_claim_patch.`;
      } else if (entry.satisfied) {
        how = 'The person on the page has already done this one, so there is nothing to ask them '
          + 'for. No tool on this page reaches it.';
      } else {
        how = 'No tool on this page reaches this one. Ask the person on the page to press the button.';
      }
      body.push(`${index}. ${clip(entry.label, 110)} (${entry.satisfied ? 'answered' : 'still open'})`);
      body.push(`   ${how} ${clip(entry.why, 420)}`);
    }

    return toResult(budgetedBlock({
      head: [
        `${pack.insurer} options for a vehicle that cannot be driven, from the insurer's own rule `
        + `pack. Amounts on this policy are in ${pack.currency}.`,
      ],
      body,
      tail: [
        'This is what the policy provides for, not a booking and not a decision about the claim. '
        + 'The collection is arranged by the person on the page pressing the button.',
      ],
      more: (count) => `${count} more line(s) are on the page. Call get_requirements for the full list.`,
    }));
  }
});
