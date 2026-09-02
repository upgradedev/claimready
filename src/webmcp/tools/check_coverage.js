/**
 * check_coverage: does this policy actually cover what happened.
 *
 * Read only, and the reason this page exists. The agent gets the insurer's own rules as a typed
 * call, so the claimant hears "your cover does not include that" while they are describing the
 * incident, not three days later in a letter.
 *
 * The decision is a deterministic table lookup in src/core/coverage.js, and it can say no. This
 * tool only asks the question and puts the answer on the page.
 */

import { toResult, budgetedBlock, clip, packOf, scheduleOf } from '../register.js';
import { checkCoverage, exclusionLabels } from '../../core/coverage.js';
import { packIdentity } from '../../core/filing.js';

/**
 * How much of each piece of insurer text to show.
 *
 * The clause, the reason and the exclusion labels all come out of the rule pack, which is data
 * this page is handed rather than anything the code decides, so none of them has a length of its
 * own. Joining them raw and handing the lot to toResult is what cost this tool its closing line:
 * an excluded driver with a long reason clause produced exactly 1500 characters, and the sentence
 * that says this is not a settlement decision was the part that got cut off the end.
 */
const CLAUSE_ROOM = 90;
const REASON_ROOM = 420;
const EXCLUSION_ROOM = 320;
const INSURER_ROOM = 80;

export default (ctx) => ({
  name: 'check_coverage',

  description:
    'Check the claim draft on this page against the policy it belongs to. Returns whether the '
    + 'incident is covered, the clause the decision rests on, the reason in plain language, any '
    + 'exclusion that applies, and the deductible the claimant would pay. The answer can be no, '
    + 'and a yes can be provisional while the claim has not said who was driving. Set '
    + 'incident_type first. This is a cover check, not a settlement offer.',

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
      return toResult('Cancelled before the cover was checked.');
    }

    // No schedule means no basis for a decision. Saying "not covered" here would be a false
    // statement about someone's cover, so the tool says what is actually wrong instead.
    //
    // ASKED TWICE, AND THE SECOND HALF IS THE ONE THAT MATTERS. `hasPolicySchedule` is a flag the
    // page sets, and the page used to set it true for the policy block carried in the sample file
    // whenever no rule pack loaded. This tool then read that block: verdict, clause and excess, off
    // data src/core/policy.js had never seen and would have refused. `scheduleOf` asks the question
    // the flag cannot, which is whether this build loaded and checked the thing being read. Both
    // have to say yes, and the same sentence answers either way.
    const schedule = scheduleOf(ctx);
    if (!ctx.hasPolicySchedule || !schedule) {
      return toResult(`${ctx.noScheduleReason} Do not tell the claimant they are uncovered.`);
    }

    const claim = ctx.store.getState().claim;
    if (!claim || !claim.incident_type) {
      return toResult(
        'Cannot check the cover yet: incident_type is empty. Set it with apply_claim_patch, then '
        + 'call check_coverage again.'
      );
    }

    // The schedule that decided is the validated one, never ctx.policy. They were the same object
    // whenever a pack had loaded and they were not when one had not, and that gap was the defect.
    const decision = checkCoverage(schedule, claim);
    // The page shows the same answer the agent just got. Guarded because a tool must still work
    // when it is driven from a harness that has no page to publish to.
    if (typeof ctx.publish === 'function') ctx.publish('coverage', { decision, source: 'agent' });

    // NAME THE SCHEDULE THAT DECIDED, NOT ONLY THE POLICY NUMBER. This line used to read "Cover
    // decision on policy MTR-2026-0417" whichever rule pack was loaded, so switching insurer
    // produced another insurer's clauses under this customer's policy number. The pack that
    // answered is the fact the reader needs, and where the two belong to different insurers the
    // tool says so in the next line rather than leaving it to be worked out.
    const pack = packOf(ctx);
    const insurer = pack ? clip(String(pack.insurer), INSURER_ROOM) : null;
    const source = insurer ? `${insurer} rules` : 'the policy schedule on this page';
    const policyId = clip(String(ctx.policyId), 40);

    let verdict = 'NOT COVERED';
    if (decision.covered) verdict = decision.provisional ? 'COVERED, PROVISIONALLY' : 'COVERED';

    // The verdict is the head and nothing else is, because the head is the one part budgetedBlock
    // has no way to shorten. Everything below grows with the rule pack.
    const head = [`Cover decision under ${source}, on the claim for policy ${policyId}: ${verdict}.`];

    // Ordered by what a claimant is harmed most by not hearing. A provisional yes read as a plain
    // yes is the worst outcome this tool can cause, so that warning goes first and the clause text
    // it rests on, which is the longest thing here, goes last.
    const body = [];

    if (decision.provisional) {
      body.push(
        'Provisional, so do not tell the claimant they are covered yet. Ask who was driving and '
        + 'send it with apply_claim_patch, then call check_coverage again.'
      );
    }

    // WHOSE RULES THESE ARE IS ONE ANSWER, AND IT COMES FROM src/core. This used to compare
    // ctx.packId against ctx.homePackId by hand, and ctx.packId was the id the manifest gave the
    // pack while the filing gate read the id inside the pack file. Two names for one thing, in two
    // places, either of which could go on saying yes while the other said no. packIdentity answers
    // it for the page, for the file gate and now for this line, so there is nothing left to drift.
    if (insurer && packIdentity(pack, { homePackId: ctx.homePackId }).borrowed) {
      body.push(
        `These are ${insurer}'s published rules, loaded on this page so the same claim can be `
        + `read against them. Policy ${policyId} is not with ${insurer}.`
      );
    }

    // exclusions holds objects. exclusionLabels is the one place that turns them into words.
    const applied = exclusionLabels(decision);
    if (applied.length) {
      body.push(`Exclusions that apply: ${clip(applied.join('; '), EXCLUSION_ROOM)}`);
    }

    if (decision.covered && decision.deductible !== undefined && decision.deductible !== null) {
      body.push(`Deductible the claimant pays: ${decision.deductible} ${decision.currency || ctx.currency}`);
    }

    if (decision.clause) body.push(`Clause: ${clip(String(decision.clause), CLAUSE_ROOM)}`);
    if (decision.reason) body.push(`Reason: ${clip(String(decision.reason), REASON_ROOM)}`);

    const tail = ['This is a check against the sample policy on this page, not a settlement decision.'];

    return toResult(budgetedBlock({
      head,
      body,
      tail,
      more: (count) => `${count} further line(s) of this decision were withheld to fit the output budget. They are on the page.`,
    }));
  }
});
