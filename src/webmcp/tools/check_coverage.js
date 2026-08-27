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

import { toResult, packOf } from '../register.js';
import { checkCoverage, exclusionLabels } from '../../core/coverage.js';

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
    if (!ctx.hasPolicySchedule) {
      return toResult(`${ctx.noScheduleReason} Do not tell the claimant they are uncovered.`);
    }

    const claim = ctx.store.getState().claim;
    if (!claim || !claim.incident_type) {
      return toResult(
        'Cannot check the cover yet: incident_type is empty. Set it with apply_claim_patch, then '
        + 'call check_coverage again.'
      );
    }

    const decision = checkCoverage(ctx.policy, claim);
    // The page shows the same answer the agent just got. Guarded because a tool must still work
    // when it is driven from a harness that has no page to publish to.
    if (typeof ctx.publish === 'function') ctx.publish('coverage', { decision, source: 'agent' });

    // NAME THE SCHEDULE THAT DECIDED, NOT ONLY THE POLICY NUMBER. This line used to read "Cover
    // decision on policy MTR-2026-0417" whichever rule pack was loaded, so switching insurer
    // produced another insurer's clauses under this customer's policy number. The pack that
    // answered is the fact the reader needs, and where the two belong to different insurers the
    // tool says so in the next line rather than leaving it to be worked out.
    const pack = packOf(ctx);
    const source = pack ? `${pack.insurer} rules` : 'the policy schedule on this page';

    let verdict = 'NOT COVERED';
    if (decision.covered) verdict = decision.provisional ? 'COVERED, PROVISIONALLY' : 'COVERED';

    const lines = [`Cover decision under ${source}, on the claim for policy ${ctx.policyId}: ${verdict}.`];

    if (pack && ctx.packId && ctx.homePackId && ctx.packId !== ctx.homePackId) {
      lines.push(
        `These are ${pack.insurer}'s published rules, loaded on this page so the same claim can be `
        + `read against them. Policy ${ctx.policyId} is not with ${pack.insurer}.`
      );
    }

    if (decision.clause) lines.push(`Clause: ${decision.clause}`);
    if (decision.reason) lines.push(`Reason: ${decision.reason}`);

    if (decision.provisional) {
      lines.push(
        'Provisional, so do not tell the claimant they are covered yet. Ask who was driving and '
        + 'send it with apply_claim_patch, then call check_coverage again.'
      );
    }

    // exclusions holds objects. exclusionLabels is the one place that turns them into words.
    const applied = exclusionLabels(decision);
    if (applied.length) {
      lines.push(`Exclusions that apply: ${applied.join('; ')}`);
    }

    if (decision.covered && decision.deductible !== undefined && decision.deductible !== null) {
      lines.push(`Deductible the claimant pays: ${decision.deductible} ${decision.currency || ctx.currency}`);
    }

    lines.push('This is a check against the sample policy on this page, not a settlement decision.');

    return toResult(lines.join('\n'));
  }
});
