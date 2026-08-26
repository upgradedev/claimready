/**
 * apply_claim_patch: the only tool that writes.
 *
 * It carries neither readOnlyHint nor untrustedContentHint. It cannot file, cancel, or settle
 * anything: it sets one field on a draft, and the page shows the change straight away.
 *
 * The schema types value loosely on purpose. A model may send "10" or 10, "yes" or true, and
 * src/core/claim.js coerces all of it in one place. This tool adds no second path: it dispatches
 * what it was given and hands back whatever the rules said, because those refusals already name
 * the field, the limit and the value ("damage_zone 14 is out of range. Use a clock position from 1
 * to 12."), which is exactly what a model needs to correct itself.
 */

import { toResult } from '../register.js';
import { PATCHABLE_FIELDS, REQUIRED_FIELDS, validateClaim } from '../../core/claim.js';

/**
 * Fields whose stored value is safe to read back: a date, an enum, a boolean, a clock position.
 * Anything not on this list is free text the claimant wrote, and this tool confirms its length
 * instead of repeating it. The caller already knows what it sent, so echoing adds nothing and
 * would put claimant prose in the one tool result that carries no untrustedContentHint.
 */
const ECHOABLE_FIELDS = ['incident_date', 'incident_type', 'damage_zone', 'severity', 'vehicle_drivable'];

function confirm(field, stored) {
  if (stored === null || stored === undefined) return 'to empty';
  if (ECHOABLE_FIELDS.includes(field)) return `to ${JSON.stringify(stored)}`;
  const length = String(stored).length;
  return `(${length} ${length === 1 ? 'character' : 'characters'} stored)`;
}

export default (ctx) => ({
  name: 'apply_claim_patch',

  description:
    'Set one field on the motor claim draft. The page updates immediately and shows that you made '
    + 'the change. Required: incident_date (YYYY-MM-DD), incident_type, damage_zone (clock position '
    + '1 to 12), severity, vehicle_drivable (true or false), description. Optional: driver, '
    + 'location, police_report_ref, witness_name. Returns what was stored and what is still '
    + 'missing. Filing the finished claim is a human button and is not available as a tool.',

  inputSchema: {
    type: 'object',
    required: ['field', 'value'],
    additionalProperties: false,
    properties: {
      field: {
        type: 'string',
        enum: [...PATCHABLE_FIELDS],
        description: 'Which claim field to set. One field per call.'
      },
      value: {
        type: ['string', 'number', 'boolean'],
        description: 'The new value. Dates are YYYY-MM-DD, damage_zone is a clock position 1 to 12, vehicle_drivable is true or false.'
      }
    }
  },

  // Stated rather than left out. This is the one tool that writes, and readOnlyHint false says so
  // to the agent instead of leaving it to a default. untrustedContentHint is absent because the
  // result is a confirmation this tool composed, not text the claimant supplied.
  annotations: { readOnlyHint: false },

  async execute(input, options) {
    if (options && options.signal && options.signal.aborted) {
      return toResult('Cancelled before anything was changed.');
    }

    const field = typeof input?.field === 'string' ? input.field.trim() : '';
    if (!PATCHABLE_FIELDS.includes(field)) {
      return toResult(
        `field must be one of ${PATCHABLE_FIELDS.join(', ')}, received ${JSON.stringify(input?.field ?? null)}. `
        + 'Nothing was changed.'
      );
    }

    // The store answers with the rules' own verdict, so there is nothing to check twice.
    const result = ctx.store.dispatch({ type: 'patch', field, value: input?.value });
    if (!result.ok) {
      return toResult(`${result.error} Nothing was changed.`);
    }

    const claim = ctx.store.getState().claim;
    const verdict = validateClaim(claim);

    const rest = verdict.missing && verdict.missing.length
      ? `Still missing: ${verdict.missing.join(', ')}.`
      : 'Nothing required is missing. The person on the page can press File this claim now.';

    const warnings = Array.isArray(verdict.warnings) && verdict.warnings.length
      ? ` Warnings: ${verdict.warnings.join(' ')}`
      : '';

    const optionalNote = REQUIRED_FIELDS.includes(field) ? '' : ' (an optional field)';

    return toResult(`Set ${field}${optionalNote} ${confirm(field, claim[field])}. ${rest}${warnings}`);
  }
});
