/**
 * The beat files and the runbook have to say the same thing, because the owner reads one of them
 * and the builder prints the other.
 *
 * WHAT WENT WRONG. `docs/submission/video.md` was corrected so beat 03's prompt stopped handing the
 * model the insurer's own vocabulary and started saying where the car is. `video/beats/03-agent-fills/beat.json`
 * was not, and that is the copy `python video/build_video.py --check-takes` prints. An owner
 * following the printed instructions would have recorded the old sentence, the agent would not have
 * written the location, and beat 07 would have stopped at a disabled File control for the second
 * time.
 *
 * So this file reads the shipped JSON rather than repeating it. A prompt that lives in two places
 * needs a check that both places agree, or it is one edit away from lying to whoever reads the
 * other one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const beat = (id) => JSON.parse(readFileSync(
  new URL(`../../video/beats/${id}/beat.json`, import.meta.url), 'utf8',
));

const runbook = readFileSync(
  new URL('../../docs/submission/video.md', import.meta.url), 'utf8',
);

const fill = beat('03-agent-fills');
const file = beat('07-human-files');

/** The claimant's sentence, which is the second thing typed in beat 03. */
const claimantPrompt = fill.record.prompts[1];

test('every prompt the beat file carries is in the runbook, word for word', () => {
  for (const prompt of fill.record.prompts) {
    assert.ok(
      runbook.includes(prompt),
      `the runbook does not carry this prompt, so the two would give an owner different '
      + 'instructions:\n${prompt}`,
    );
  }
});

test('the claimant never speaks the insurer\'s vocabulary', () => {
  // The clock face belongs to the rule pack and to the tool's enum. A claimant saying it out loud
  // leaves the agent nothing to translate, and the row fills by copying rather than by reading.
  assert.doesNotMatch(claimantPrompt, /o'clock/i);
  assert.doesNotMatch(claimantPrompt, /damage_zone/);
  assert.match(claimantPrompt, /left front wing/i, 'it says the panel in plain words instead');
});

test('the claimant says where the car is, because the filing gate needs it', () => {
  // Answering "cannot be driven" in beat 04 raises the collection address as well as the roadside
  // collection, and the address is a field. Without it in this sentence the session cannot file.
  assert.match(claimantPrompt, /Harbour Road/);
  assert.match(claimantPrompt, /still there|car is now|still at/i);
});

test('beat 03 requires the location row on camera', () => {
  const shown = fill.record.must_show.join(' | ').toLowerCase();
  assert.match(shown, /where it happened/);
  assert.match(shown, /via tool/);
});

test('beat 07 no longer says filing ignores the insurer intake, because it does not', () => {
  const note = file.record.note;
  assert.doesNotMatch(note, /not on this insurer's intake list/);
  assert.doesNotMatch(note, /allows a filing with an intake requirement open/);
  assert.match(note, /FILE_REFUSED_REQUIREMENTS/);
  assert.match(note, /collection address/i);
});

test('the two beats that depend on each other say so', () => {
  assert.match(file.record.note, /beat 03/, 'beat 07 names where its location comes from');
  assert.match(fill.record.note, /beat 07|filing|File this claim/i, 'beat 03 says what depends on it');
});
