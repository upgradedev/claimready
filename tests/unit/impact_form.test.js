/**
 * The control arm gets the form, not our writing about the form.
 *
 * v1 handed the model the whole of static-form.md: the sentence claiming the control is not a
 * strawman, the union count, and the names of the two shipped rule packs. A claimant is handed
 * none of that. This holds the slice to the form and holds the form to what it says it is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { formOnly, FORM_HEADING } from '../../evidence/impact/form.mjs';

const file = readFileSync(new URL('../../evidence/impact/static-form.md', import.meta.url), 'utf8');
const form = formOnly(file);

test('the slice starts at the form and carries none of the writing about it', () => {
  assert.ok(form.startsWith(FORM_HEADING), `the slice starts ${JSON.stringify(form.slice(0, 40))}`);
  for (const ours of [/strawman/i, /rule packs/i, /measure_intake/i, /arm B/i, /control/i]) {
    assert.doesNotMatch(form, ours, `${ours} is ours, not the insurer's`);
  }
});

test('the form asks ten questions, which is what it lists', () => {
  const numbered = form.match(/^\d+\. /gm) || [];
  assert.equal(numbered.length, 10);

  // The nine the intake measurement counts, and the tenth the page offers that no pack names. The
  // paragraph above the form said nine for as long as it listed ten; this is what stops that
  // returning, in the file rather than in a sentence.
  assert.match(file, /\*\*Ten questions\.\*\*/);
  assert.match(file, /who\s*\n?was driving, is a box the page offers that no pack names/);
});

test('a file with no form in it is refused rather than sent as one', () => {
  assert.throws(() => formOnly('# just a note\n\nnothing to fill in.'), /no longer contains/);
});
