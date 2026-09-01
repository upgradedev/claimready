/**
 * The control arm's form, told apart from the writing about it.
 *
 * v1 HANDED THE MODEL THE WHOLE OF `static-form.md`, our own methodology preamble included: "This
 * is the control. It is not a strawman", the union count, and a sentence naming the two shipped
 * rule packs. That is commentary about the experiment sitting inside the experiment's own input,
 * and it is not what a claimant would be handed. Correcting that preamble made it longer, which
 * made it worse, so the file is sliced at the form's own heading instead.
 *
 * The eighteen arm B runs already on disk were produced with the whole file. They are not re-run.
 * `protocol-v2.md` records the difference and says which way it is expected to cut, which is
 * towards the control rather than towards the page.
 *
 * It is a module of its own so a test can import it. `run_impact.mjs` runs a scenario the moment it
 * is imported, by design, so nothing can import that file to check one pure function inside it.
 */

/** The heading the form itself starts at. Everything above it is ours, not the insurer's. */
export const FORM_HEADING = '## Motor claim, first notice';

/**
 * @param {string} file the contents of static-form.md
 * @returns {string} the form a claimant would be handed, and nothing else
 */
export function formOnly(file) {
  const at = String(file).indexOf(FORM_HEADING);
  if (at === -1) {
    throw new Error(`static-form.md no longer contains ${JSON.stringify(FORM_HEADING)}, so this `
      + 'cannot tell the form from the writing about it. Fix the file rather than sending both.');
  }
  return String(file).slice(at).trim();
}
