/**
 * The declarative half of WebMCP, and what this page says about it.
 *
 * PURE MODULE. No DOM, no browser globals, no network, no timers, no I/O. The wiring that reads
 * the form and dispatches lives in src/ui/app.js, and the markup lives in index.html.
 *
 * WHY THERE IS A FORM AT ALL. The nine tools this page registers are written in JavaScript, one
 * descriptor each, which is the imperative half of the standard. The other half is four HTML
 * attributes on a form a page already has. An insurer with an intake form adopts WebMCP on that
 * path by adding attributes to markup they already ship, not by rewriting the page as tool
 * descriptors, and this form is that migration path shown rather than described. It is a real
 * control first: a person fills it in and presses the button, on any browser, with no agent
 * anywhere.
 *
 * THE FOUR ATTRIBUTES, read from the Chrome documentation for the declarative API on 2026-08-28,
 * https://developer.chrome.com/docs/ai/webmcp/declarative-api
 *   toolname              on the form. The name an agent calls.
 *   tooldescription       on the form. What the tool does.
 *   toolautosubmit        on the form. An agent's call fills the controls and submits, which is
 *                         the configuration the documented example uses to show respondWith
 *                         returning a result to the model.
 *   toolparamdescription  on a control. The description of that property in the schema the
 *                         browser synthesises. Without it the browser falls back to the label.
 * The browser builds the input schema from the form itself: input types become string properties,
 * a required control joins the required array, and a select becomes an enum. Nothing in this file
 * writes that schema, which is the point of the declarative half.
 *
 * WHAT IS NOT VERIFIED, and is written down here rather than left to a reader to assume. The
 * declarative API needs the same origin trial or the same testing flag as the imperative one, and
 * it is Chrome only. The WebMCP documentation for the ChatGPT desktop browser does not mention
 * declarative forms at all, so support on that surface is UNVERIFIED. On any browser that does not
 * implement it the four attributes are unknown attributes, which the HTML parser keeps and ignores,
 * and the form stays an ordinary form.
 *
 * THE SAME RULES AS EVERY OTHER WRITER. The submit handler dispatches through the one store, so a
 * pinned field, a filed claim, an over long value and a revision that has moved are refused here
 * exactly as they are refused on the imperative tool, by src/core/claim.js, in its words. This
 * module holds no rule of its own. It shapes the submission and reports what came back.
 */

import { FIELD_LABELS } from '../core/claim.js';

/** The name an agent calls. Lower snake case and inside the 30 character budget, like the rest. */
export const FORM_TOOL_NAME = 'record_supporting_details';

/**
 * What the form tells an agent it does. This string is asserted, character for character, against
 * the tooldescription attribute in index.html by tests/unit/declarative_form.test.js, so the page
 * and the surface the page reports cannot drift apart.
 */
export const FORM_TOOL_DESCRIPTION =
  'Record the two supporting details on this claim draft, the name of a witness and the police '
  + 'report reference. Every change goes through the insurer rules on this page, so a pinned field, '
  + 'a filed claim or a revision that has moved is refused.';

/**
 * The controls, in the order the form carries them.
 *
 * `field` is the claim field a control writes, or null for the control that carries no value of
 * its own. `description` is the toolparamdescription attribute, asserted against index.html by the
 * same test. Each is inside the 150 character parameter budget from the Chrome tool security
 * guidance, which is the budget the style gate holds every other parameter to.
 */
export const FORM_CONTROLS = [
  {
    name: 'witness_name',
    field: 'witness_name',
    description: 'The name of a witness to the incident. Leave it out to keep the name already on the draft.',
  },
  {
    name: 'police_report_ref',
    field: 'police_report_ref',
    description: 'The police report reference for this incident. Leave it out to keep the reference on the draft.',
  },
  {
    name: 'base_revision',
    field: null,
    description: 'The draft revision you read, from read_claim_state. A change quoting an older revision is refused.',
  },
];

/** The control that carries the revision an agent quotes, named once so a rename is one grep. */
export const REVISION_CONTROL = 'base_revision';

/**
 * How the page describes this tool in its own published list.
 *
 * It is shaped like the entries describeToolSurface returns for the nine registered tools, and
 * carries `declarative: true` so the view can say which half of the API it comes from. It is never
 * marked registered, in either state, because nothing registers it: the browser reads it off the
 * markup. A row that claimed otherwise would be a false statement about the surface.
 *
 * @returns {object} one surface entry
 */
export function describeDeclarativeForm() {
  return {
    name: FORM_TOOL_NAME,
    purpose: firstSentenceOf(FORM_TOOL_DESCRIPTION),
    wording: FORM_TOOL_DESCRIPTION,
    readOnly: false,
    untrustedContent: false,
    conditional: false,
    appears: null,
    declarative: true,
  };
}

/**
 * The opening sentence of the tool wording, for the one line the page prints beside the name.
 * Same rule as register.js: split on a full stop followed by whitespace or the end of the text.
 * @param {string} text
 * @returns {string}
 */
function firstSentenceOf(text) {
  const body = String(text === undefined || text === null ? '' : text).trim();
  const stop = body.search(/\.(\s|$)/);
  return stop === -1 ? body : body.slice(0, stop + 1);
}

/**
 * Turn what the form carried into an action the store understands.
 *
 * AN EMPTY CONTROL MEANS "LEAVE THE DRAFT ALONE", NOT "CLEAR IT", and that is a decision worth
 * stating. An agent that fills one property leaves the other empty, and reading an empty control as
 * a clear would wipe an answer nobody asked to wipe. The rows above the form are where a value is
 * cleared, by emptying the row and letting the rules decide, which is the path that has always
 * existed and is unchanged.
 *
 * THE REVISION IS PASSED THROUGH, NEVER REPAIRED. An empty revision control becomes null rather
 * than a number, because src/core/claim.js reads null as "no revision was quoted" and answers with
 * the sentence that names the number to quote, while an empty string coerces to zero and would be
 * refused as a stale quote of revision 0 instead. The difference is the whole usefulness of the
 * refusal: one tells an agent what to do next, the other reads as an off by one.
 *
 * @param {{witnessName?: string, policeReportRef?: string, baseRevision?: string,
 *          agentInvoked?: boolean}} input what the controls carried
 * @returns {{changes: Array<{field: string, value: string}>, actor: string,
 *            baseRevision: (string|null), empty: boolean, fields: string[]}}
 */
export function planSubmission(input = {}) {
  const changes = [];
  const witness = trimmed(input.witnessName);
  const police = trimmed(input.policeReportRef);

  if (witness !== '') changes.push({ field: 'witness_name', value: witness });
  if (police !== '') changes.push({ field: 'police_report_ref', value: police });

  const quoted = trimmed(input.baseRevision);

  return {
    changes,
    actor: input.agentInvoked === true ? 'agent' : 'human',
    baseRevision: input.agentInvoked === true && quoted !== '' ? quoted : null,
    empty: changes.length === 0,
    fields: changes.map((change) => change.field),
  };
}

/**
 * The sentence that goes back to whoever submitted, and into the ledger when an agent did.
 *
 * A REFUSAL IS REPORTED IN THE RULES OWN WORDS AND IS NEVER SWALLOWED. What src/core/claim.js said
 * is what the agent is handed, code and all, because that message is the one that names the field,
 * the reason and, for a stale patch, the number to quote next. Rewriting it here would lose the
 * only part an agent can act on.
 *
 * @param {{empty?: boolean, unchanged?: boolean, ok?: boolean, error?: (string|null),
 *          code?: (string|null), applied?: string[], revision?: number,
 *          agentInvoked?: boolean}} outcome
 * @returns {string}
 */
export function describeOutcome(outcome = {}) {
  const revision = Number.isInteger(outcome.revision) ? outcome.revision : 0;

  if (outcome.empty) {
    return 'Nothing was submitted. Fill in the name of the witness, the police report reference, '
      + `or both, and send it again. The draft is at revision ${revision}.`;
  }

  // Storing what is already stored would move the revision for an edit nobody made, and every
  // reader who had quoted the earlier number would then be stale for nothing.
  if (outcome.unchanged) {
    return 'Those details are already on the draft, so nothing was changed and the revision has not '
      + `moved. It is at revision ${revision}.`;
  }

  if (outcome.ok !== true) {
    const code = outcome.code ? `${outcome.code}: ` : '';
    const said = outcome.error || 'The rules refused this change.';
    return `Refused. ${code}${said} Nothing on the draft changed, and it is at revision ${revision}.`;
  }

  // Said out loud through FIELD_LABELS, the one place this repository keeps the words for a field,
  // so the form, the rows above it and every tool call name the same answer the same way.
  const applied = Array.isArray(outcome.applied) ? outcome.applied : [];
  const said = applied.map((field) => FIELD_LABELS[field] || field);
  const written = said.length === 1 ? said[0] : said.join(' and ');
  const who = outcome.agentInvoked === true ? 'your agent' : 'you';
  return `Recorded ${written} on the draft, written by ${who}. The draft is now at revision ${revision}.`;
}

function trimmed(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
