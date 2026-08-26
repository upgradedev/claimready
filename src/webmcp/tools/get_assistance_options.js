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
 * ONE FACT COMES FROM THE PAGE, AND ONLY AS A YES OR NO. Whether the person has already pressed
 * the assistance button is page state, not claim state, so src/core cannot know it and this tool
 * would otherwise keep telling an agent to ask for something the claimant did a minute ago. The
 * page offers it through ctx.getRequirements. This file reads presence and nothing else, and
 * writes its own sentence about it, so every character returned here is still either insurer rule
 * text or wording from this file. See pageDecoration at the foot of the file.
 *
 * NOTHING HERE BOOKS ANYTHING. Arranging the collection is a button a person presses on the page.
 * There is no tool for it and there must never be one, because a recovery truck arriving at
 * somebody's house is exactly the sort of thing an agent should not be able to cause on its own.
 */

import { toResult, budgetedBlock, clip, packOf, satisfiedByOf, NO_PACK_REASON } from '../register.js';
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

    const triggered = deriveRequirements(pack, claim).filter((entry) => entry.triggeredBy === TRIGGER_FIELD);

    if (triggered.length === 0) {
      return toResult(
        `${pack.insurer} states nothing extra for a vehicle that cannot be driven on this claim. `
        + 'Ask the person on the page what they would like to do next.'
      );
    }

    // What the page knows and src/core cannot: whether the person has already pressed the button.
    // That fact is page state, not claim state, so it never reaches deriveRequirements. Without it
    // this tool goes on telling an agent to ask for something the claimant did ten seconds ago,
    // which is the one thing that would make the whole exchange read as scripted.
    const handled = pageDecoration(ctx);

    const body = [];
    let index = 0;

    for (const entry of triggered) {
      index += 1;
      const target = satisfiedByOf(pack, entry.id);
      const done = handled.has(entry.id);
      const how = target.field
        ? `You can answer this one: send ${target.field} with apply_claim_patch.`
        : done
          ? 'The person on the page has already pressed this button, so there is nothing to ask '
            + 'them for. It was never available to you as a tool.'
          : 'Only a person can do this one, using the button on the page. There is no tool for it.';
      const state = entry.satisfied ? 'already answered' : done ? 'done on the page' : 'still open';
      body.push(`${index}. ${clip(entry.label, 110)} (${state})`);
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

/**
 * The ids of requirements the page reports a person has already dealt with by hand.
 *
 * PRESENCE ONLY, AND THAT IS DELIBERATE. The page's decorated entry carries a humanNote sentence,
 * and the obvious thing would be to quote it. This reads only whether one exists, and the sentence
 * below is composed here from the pack. That keeps a true statement true: everything this tool
 * returns is insurer rule text or wording from this file, so the result stays free of anything a
 * claimant or a third party wrote and needs no untrusted content hint. Quoting the page's string
 * would have made that contract depend on src/ui/app.js never interpolating a field value into it,
 * which is not a promise this file can keep on another file's behalf.
 *
 * The decoration is optional on purpose. This tool is also driven from harnesses with no page at
 * all, so a missing, malformed or throwing getRequirements degrades to "still open" rather than
 * failing the call. The satisfied flag is never read from the page: only the insurer's own rules
 * decide whether an intake requirement is answered.
 *
 * @param {object} ctx
 * @returns {Set<string>}
 */
function pageDecoration(ctx) {
  const done = new Set();
  if (!ctx || typeof ctx.getRequirements !== 'function') return done;
  let decorated;
  try {
    decorated = ctx.getRequirements();
  } catch (error) {
    return done;
  }
  if (!Array.isArray(decorated)) return done;
  for (const entry of decorated) {
    if (entry && typeof entry.id === 'string' && typeof entry.humanNote === 'string' && entry.humanNote) {
      done.add(entry.id);
    }
  }
  return done;
}
