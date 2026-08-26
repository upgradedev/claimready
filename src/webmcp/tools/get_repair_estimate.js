/**
 * get_repair_estimate: a triage band, never a prediction.
 *
 * Read only. The numbers come from a fixed parts table in src/core/estimate.js, keyed on the
 * damage clock position, the severity and the vehicle class. Nothing is learned, nothing is
 * guessed, and the wording says so on the page and in the tool result.
 *
 * The optional severity argument lets an agent ask "and if it turns out to be structural" without
 * writing anything to the draft. The page labels that answer as a what if.
 */

import { toResult } from '../register.js';
import { SEVERITIES } from '../../core/claim.js';
import { estimateRepair } from '../../core/estimate.js';

const MAX_LINES_SHOWN = 6;

export default (ctx) => ({
  name: 'get_repair_estimate',

  description:
    'Get the repair cost band for the damage on the claim draft, from a fixed parts table keyed on '
    + 'the damage position, the severity and the vehicle class. Returns a low and high figure and '
    + 'the parts behind it. Needs damage_zone and severity on the draft first. Pass severity to try '
    + 'a different one as a what if without changing the draft. This is a triage band, not a quote '
    + 'and not a prediction.',

  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      severity: {
        type: 'string',
        enum: [...SEVERITIES],
        description: 'Optional. Try this severity as a what if. The claim draft is not changed.'
      }
    }
  },

  annotations: {
    readOnlyHint: true
  },

  async execute(input, options) {
    if (options && options.signal && options.signal.aborted) {
      return toResult('Cancelled before the band was worked out.');
    }

    const claim = ctx.store.getState().claim;
    const zone = claim ? claim.damage_zone : null;
    const onDraft = claim ? claim.severity : null;

    if (zone === null || zone === undefined || zone === '') {
      return toResult(
        'Cannot work out a band yet: damage_zone is empty. Set it with apply_claim_patch (a clock '
        + 'position from 1 to 12), then call get_repair_estimate again.'
      );
    }

    let severity = onDraft;
    let whatIf = false;

    if (input && input.severity !== undefined && input.severity !== null && input.severity !== '') {
      const asked = String(input.severity).trim().toLowerCase();
      if (!SEVERITIES.includes(asked)) {
        return toResult(
          `severity must be one of ${SEVERITIES.join(', ')}, received ${JSON.stringify(input.severity)}. Nothing was changed.`
        );
      }
      severity = asked;
      whatIf = asked !== onDraft;
    }

    if (severity === null || severity === undefined || severity === '') {
      return toResult(
        `Cannot work out a band yet: severity is empty. Set it with apply_claim_patch (one of `
        + `${SEVERITIES.join(', ')}), or pass severity to this tool to try one without changing the draft.`
      );
    }

    const band = estimateRepair({ zone, severity, vehicleClass: ctx.vehicleClass });
    // Guarded for the same reason as in check_coverage: the page is the usual caller, not the only
    // possible one.
    if (typeof ctx.publish === 'function') {
      ctx.publish('estimate', { band, zone, severity, whatIf, source: 'agent' });
    }

    const currency = band.currency || ctx.currency;
    const lines = [];

    lines.push(
      `${whatIf ? 'What if severity were ' + severity + ': ' : ''}`
      + `repair band ${band.low} to ${band.high} ${currency} `
      + `(${zone} o'clock, ${severity}, ${ctx.vehicleClass}).`
    );

    if (Array.isArray(band.lines) && band.lines.length) {
      const shown = band.lines.slice(0, MAX_LINES_SHOWN);
      lines.push(`Parts: ${shown.map((line) => `${line.part} ${line.cost} ${currency}`).join('; ')}`);
      if (band.lines.length > shown.length) {
        lines.push(`${band.lines.length - shown.length} more line items are shown on the page.`);
      }
    }

    if (whatIf) {
      lines.push(`The draft still says severity ${onDraft === null || onDraft === undefined || onDraft === '' ? 'is empty' : onDraft}. Nothing was written.`);
    }

    lines.push('This is a triage band from a fixed parts table. It is not a quote and not a prediction.');

    return toResult(lines.join('\n'));
  }
});
