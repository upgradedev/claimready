/**
 * src/ui/app.js booted against rule packs the loader refuses, rather than ones the network loses.
 *
 * ITS OWN FILE, for the reason given in tests/support/boot_app.mjs: one plain import per process, so
 * app.js stays a single row in the coverage table and a scenario that needs different conditions at
 * boot needs its own file.
 *
 * HOW THIS DIFFERS FROM app_boot_no_pack.test.js. That file serves a 404 for every pack, which is
 * the network failing. This one serves both packs successfully and they are then REFUSED by
 * src/core/policy.js, because a requirement in each states two contradictory tests in one block.
 * Those are the same outcome for a claimant and two different paths through the page, and only the
 * first was covered. The refusal path is the one a real insurer would hit, because a pack that is
 * merely wrong is far more likely than a file server that is down.
 *
 * WHAT IT PROTECTS. Three things, and the third is the one that was never tested.
 *   1. The page still comes up and is still usable. A pack nobody can read is not a reason to hand a
 *      claimant a blank screen.
 *   2. The intake is reported as UNKNOWN, never as empty. An empty requirements list reads as
 *      "nothing more is needed", which is a statement about someone's claim that this page has no
 *      basis for making.
 *   3. The refusal reaches the reader with the rule id in it. A person looking at this page has to
 *      be able to tell their insurer WHICH rule was rejected, and a bare "did not load" cannot.
 *
 * The fixtures on disk are never touched. Both malformed packs are deep copies made in memory and
 * served by the fetch double.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

/**
 * One shipped pack with one rule bent out of shape.
 *
 * The rule is impact_position in both packs, and the break is the plainest contradiction there is:
 * a block that says the incident type both is and is not theft. The old loader took this without a
 * word and let src/core/requirements.js pick the not_equals arm, so the rule silently disappeared
 * from a theft claim that the other half of the same block asks for.
 */
function refusedPack(relative) {
  const pack = readJson(relative);
  const rule = pack.requirements.find((entry) => entry.id === 'impact_position');
  rule.when = { field: 'incident_type', equals: 'theft', not_equals: 'theft' };
  return pack;
}

const { doc } = await bootApp({
  bodies: {
    'northwind.json': refusedPack('../../fixtures/insurers/northwind.json'),
    'kestrel.json': refusedPack('../../fixtures/insurers/kestrel.json'),
  },
});

test('the page still draws when every rule pack is refused', () => {
  assert.match(doc.el('persona-name').textContent, /^Signed in as /);
  assert.ok(doc.el('fields').children.length > 0, 'the draft is still there to fill in');
  assert.ok(doc.el('tools-list').children.length >= 8, 'the tool surface does not go with the packs');
});

// THE POINT OF TYPING THE REFUSAL. The message a person reads names the rule that was rejected, so
// the fault can be reported to whoever wrote the pack. Before this it was a TypeError raised deep
// inside a validator, and what reached the page was whatever sentence that throw happened to carry.
test('the reason on the page names the pack, the rule and what is wrong with it', () => {
  const note = doc.el('pack-note').textContent;

  assert.match(note, /rule pack did not load/);
  assert.match(note, /policy pack:/, 'the refusal keeps the prefix that says where it came from');
  assert.match(note, /impact_position/, 'a reader has to be able to say WHICH rule was refused');
  assert.match(note, /carries equals and not_equals in one block/);

  // THIS LINE USED TO ASSERT THE FALLBACK AND THE FALLBACK WAS THE DEFECT. It read
  // /falls back to the schedule stored with this policy/, and the page did exactly that: with the
  // pack refused it pointed the cover check at the sample file's own policy block, which
  // src/core/policy.js has never seen. So the sentence was true and what it described was wrong.
  // A refused pack now leaves no schedule at all, and the note says so.
  assert.match(note, /cover cannot be checked against it/);
  assert.doesNotMatch(note, /falls back to the schedule/, 'the page is announcing a fallback again');
});

test('an intake it will not read is said to be unknown, never drawn as empty', () => {
  assert.match(doc.el('req-summary').textContent, /did not load|cannot say/);
  assert.equal(doc.el('requirements').children.length, 0);
});

// FAIL CLOSED, THE SAME WAY THE 404 PATH DOES. A refused pack is not a pack, so the page must not
// open the control that says the intake is finished with this draft.
test('with every pack refused the File button stays closed, and says why', () => {
  for (const [field, value] of Object.entries({
    damage_zone: '10',
    severity: 'dent',
    vehicle_drivable: 'true',
    description: 'A car came out of a side road and hit the left front wing.',
  })) {
    const found = rowFor(doc, field);
    found.control.value = value;
    fireEvent(found.control, 'change');
  }

  assert.equal(doc.el('file-btn').disabled, true);
  assert.match(doc.el('file-reason').textContent, /^The insurer rule pack did not load/);
  assert.match(doc.el('file-reason').textContent, /filing stays closed until it does/);

  const held = doc.el('revision').textContent;
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent.trim(), '', 'nothing was filed');
  assert.equal(doc.el('revision').textContent, held, 'a refused filing moves no revision');
});

// A refused pack must not be half applied either. If any of it had reached the page, the requirement
// count would be drawn from a pack the loader said it could not read.
test('nothing from the refused pack reached the page', () => {
  assert.equal(doc.el('req-progress').hidden, true, 'there is no count to draw from a pack that was refused');
  assert.doesNotMatch(doc.el('pack-note').textContent, /sections in force/, 'describePack never ran');
});
