/**
 * apply_claim_patch: the only tool that writes.
 *
 * It asserts neither readOnlyHint nor untrustedContentHint. readOnlyHint is declared false rather
 * than left out, because a default is not a statement and this is the one tool that changes
 * something. It cannot file, cancel or settle anything: it sets fields on a draft, and the page
 * shows the change straight away.
 *
 * THE REVISION IS THE POINT. The agent has to send back the revision it last read. If the person
 * on the page corrected something in between, the revision has moved, and the whole patch is
 * refused with nothing applied instead of quietly overwriting the correction. That refusal is not
 * a failure mode we tolerate, it is the feature: it is what makes the draft genuinely shared
 * rather than two parties taking turns to clobber each other.
 *
 * The patch is atomic. Several fields go in as one revision, all of them or none of them, so a
 * half applied batch never exists for either side to read.
 *
 * The schema types value loosely on purpose. A model may send "10" or 10, "yes" or true, and
 * src/core/claim.js coerces all of it in one place. This tool adds no second path: it dispatches
 * what it was given and hands back whatever the rules said, because those refusals already name
 * the field, the limit and the value ("damage_zone 14 is out of range. Use a clock position from
 * 1 to 12."), which is exactly what a model needs to correct itself.
 */

import { toResult, budgetedBlock, packOf } from '../register.js';
import { PATCHABLE_FIELDS, REQUIRED_FIELDS, validateClaim } from '../../core/claim.js';
import { deriveRequirements, summariseRequirements } from '../../core/requirements.js';

/**
 * Fields whose stored value is safe to read back: a date, an enum, a boolean, a clock position.
 * Anything not on this list is free text the claimant wrote, and this tool confirms its length
 * instead of repeating it. The caller already knows what it sent, so echoing adds nothing and
 * would put claimant prose in the one tool result that carries no untrusted content hint.
 */
const ECHOABLE_FIELDS = ['incident_date', 'incident_type', 'damage_zone', 'severity', 'vehicle_drivable'];

function confirm(field, stored) {
  if (stored === null || stored === undefined) return `${field} cleared`;
  if (ECHOABLE_FIELDS.includes(field)) return `${field} to ${JSON.stringify(stored)}`;
  const length = String(stored).length;
  return `${field} (${length} ${length === 1 ? 'character' : 'characters'} stored)`;
}

/** Accept the array the schema asks for, and a single change object, which models still send. */
function asChangeList(input) {
  const raw = input ? input.changes : undefined;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return [raw];
  if (input && typeof input.field === 'string') return [{ field: input.field, value: input.value }];
  return null;
}

export default (ctx) => ({
  name: 'apply_claim_patch',

  description:
    'Set one or more fields on the motor claim draft, all of them or none of them, as a single '
    + 'revision. Call read_claim_state first and send the revision it reported as baseRevision: if '
    + 'the person on the page has corrected something since you read, the patch is refused and '
    + 'nothing changes, so read again. Dates are YYYY-MM-DD, damage_zone is a clock position 1 to '
    + '12, vehicle_drivable is true or false. Filing the finished claim is a button on the page, '
    + 'and is deliberately not available as a tool.',

  inputSchema: {
    type: 'object',
    required: ['baseRevision', 'changes'],
    additionalProperties: false,
    properties: {
      baseRevision: {
        type: 'integer',
        minimum: 0,
        description: 'The revision you last read from the claim. If the draft has moved on since, the patch is refused whole.'
      },
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        description: 'The fields to set. Name each field at most once.',
        items: {
          type: 'object',
          required: ['field', 'value'],
          additionalProperties: false,
          properties: {
            field: {
              type: 'string',
              enum: [...PATCHABLE_FIELDS],
              description: 'Which claim field to set.'
            },
            value: {
              type: ['string', 'number', 'boolean', 'null'],
              description: 'The value to store. Null clears an optional field and is refused on a required one.'
            }
          }
        }
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

    const changes = asChangeList(input);
    if (!changes || changes.length === 0) {
      return toResult(
        'changes must be a list of { field, value }, and this call carried none. The fields that '
        + `exist are: ${PATCHABLE_FIELDS.join(', ')}. Nothing was changed.`
      );
    }

    const baseRevision = input ? input.baseRevision : undefined;

    // The store answers with the rules' own verdict, so there is nothing to check twice. The
    // refusal is passed through word for word, with its code, because the wording is written to
    // be acted on rather than summarised.
    const result = ctx.store.dispatch({
      type: 'patch',
      changes,
      actor: 'agent',
      baseRevision: baseRevision === undefined ? null : baseRevision,
    });

    if (!result.ok) {
      const code = result.code ? `${result.code}. ` : '';
      const message = String(result.error || 'The patch was refused.');
      const nothing = message.includes('Nothing was changed') ? '' : ' Nothing was changed.';
      return toResult(`${code}${message}${nothing}`);
    }

    const claim = ctx.store.getState().claim;
    const verdict = validateClaim(claim);
    const applied = Array.isArray(result.applied) ? result.applied : [];

    const head = [
      `Applied. The claim is now at revision ${result.revision}.`,
      `Set ${applied.map((field) => confirm(field, claim[field])).join(', ')}.`,
    ];

    const body = [];
    body.push(verdict.missing && verdict.missing.length
      ? `Still missing: ${verdict.missing.join(', ')}.`
      : 'Nothing required is missing. The person on the page can press File this claim now.');

    if (Array.isArray(verdict.warnings) && verdict.warnings.length) {
      body.push(`Warnings: ${verdict.warnings.join(' ')}`);
    }

    const pack = packOf(ctx);
    if (pack) {
      body.push(summariseRequirements(deriveRequirements(pack, claim, ctx.humanActions)));
      body.push('Call get_requirements if that list has changed since you last looked.');
    }

    const tail = [
      `Send baseRevision ${result.revision} on your next patch, or read the claim again first if you want to see what else moved.`,
    ];

    return toResult(budgetedBlock({ head, body, tail, more: (count) => `${count} further note(s) are on the page.` }));
  }
});
