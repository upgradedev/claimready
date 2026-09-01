/**
 * The same loading window, from the writing side.
 *
 * tests/unit/app_boot_slow_packs.test.js closed the window for a person typing into a row. It did
 * not close it for anything else, because the fix that file was written for went in at the row
 * handler and the boot order moved underneath it afterwards. `wireControls()` now runs BEFORE the
 * rule packs are fetched, which is right, and it swaps the loading refusal off the declarative form
 * on its way past. So the form went back to being open during the load, and the store subscriber
 * was still being attached after the fetch.
 *
 * THREE THINGS COULD STILL HAPPEN WHILE THE PAGE SAID THE DRAFT WAS NOT OPEN YET.
 *
 * 1. The declarative form accepted a submission. A person's press wrote to the draft; an agent's
 *    submission quoting revision 0 was accepted and answered as a success.
 * 2. The store reached revision 1 while the chip on the page still read 0, because nothing was
 *    subscribed to the store yet. Two surfaces, one draft, two different numbers.
 * 3. Check cover answered from the schedule embedded in the sample file, which is not a pack that
 *    src/core/policy.js has ever seen, and the clause and the excess it printed stayed on screen
 *    after the validated pack arrived.
 *
 * ALL FOUR IN WINDOW TESTS SHARE ONE PAGE, and they run in the order they are written: the four
 * that need the window come first, then the two that read what the page settled to. The fetch
 * double delays every request, so the window is about one delay long and the tests inside it cost
 * microseconds each.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor, createFakeAgentHost } from '../support/boot_app.mjs';
import { textOfResult } from '../../src/webmcp/register.js';

// Long enough that four tests fit inside it comfortably. The file costs about two seconds.
const DELAY_MS = 900;

const host = createFakeAgentHost();
const booting = bootApp({ delayMs: DELAY_MS }, host);

/** The page as it is right now, mid load, without waiting for boot to finish. */
async function whileLoading() {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const doc = globalThis.document;
    const busy = doc && doc.el ? doc.el('claim-busy') : null;
    if (busy && busy.hidden === false && busy.textContent.trim().length > 0) return doc;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('the page never showed a loading state, so this test cannot see the window it is about');
}

/** The page once the packs are in. The reason line going away is the signal, not boot resolving. */
async function whenReady() {
  const { doc } = await booting;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (doc.el('claim-busy').hidden) return doc;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('the draft never opened, so the loading state is not being taken away');
}

/** What the row prints as the stored answer, which is the store's value and not the control's. */
function valueTextOf(row) {
  return row.row.descendants().find((node) => node.classList.contains('field-value')).textContent;
}

/** Everything the coverage panel currently says, as one string. */
function coverageText(doc) {
  return doc.el('coverage-body').descendants()
    .map((node) => node.textContent || '')
    .join(' ');
}

/** The revision the page's own chip is showing, as a number. */
function chipRevision(doc) {
  const found = /(\d+)/.exec(doc.el('revision').textContent || '');
  return found ? Number(found[1]) : NaN;
}

test('a field edit in the window is refused, and the chip does not move', async () => {
  const doc = await whileLoading();
  const before = chipRevision(doc);
  const row = rowFor(doc, 'location');

  // A disabled control raises no event in a browser. Firing it by hand is the harsher test: the
  // handler is the boundary, not the painted control.
  row.control.value = 'Harbour Road';
  fireEvent(row.control, 'change');

  assert.equal(chipRevision(doc), before, 'the revision did not move');
  assert.match(doc.el('field-error').textContent, /not open yet/i, 'and the page said why');
});

test('a declarative submit by a person in the window is refused, and nothing is written', async () => {
  const doc = await whileLoading();
  const before = chipRevision(doc);

  assert.equal(doc.el('declared-witness').disabled, true, 'the boxes are closed');
  assert.equal(doc.el('declared-submit').disabled, true, 'and so is the button');
  assert.match(doc.el('declared-revision-hint').textContent, /rules/i,
    'with the reason beside them rather than a control that reads as broken');

  doc.el('declared-witness').value = 'A person typing during the load';
  fireEvent(doc.el('declared-form'), 'submit');

  assert.match(doc.el('declared-result').textContent, /still loading|not open yet/i,
    'the submission is answered, not swallowed');
  assert.equal(chipRevision(doc), before, 'and the draft did not move under it');
});

test('a declarative submit by an agent in the window is refused, and the agent is told', async () => {
  const doc = await whileLoading();
  const before = chipRevision(doc);

  // The quote has to be a number the rules accept, or the refusal under test would be the stale
  // check rather than the loading one, and the window would look closed when it is open.
  doc.el('declared-witness').value = 'An agent submitting during the load';
  doc.el('declared-revision').value = String(before);

  const answers = [];
  fireEvent(doc.el('declared-form'), 'submit', {
    agentInvoked: true,
    respondWith(promise) { answers.push(promise); },
  });

  assert.equal(answers.length, 1, 'the caller is answered rather than left waiting on a promise');
  const said = await answers[0];
  assert.match(String(said), /still loading|not open yet/i, 'and told why in words it can act on');
  assert.equal(chipRevision(doc), before, 'the draft did not move');
});

test('check cover in the window answers with a reason, not with a clause', async () => {
  const doc = await whileLoading();

  // THE PRESS COMES BEFORE THE ASSERTIONS, WHICH IS NOT TIDINESS. An earlier draft of this file
  // asserted the button was closed first, so against the broken code it threw there and never
  // pressed anything, and the test below it then read a panel nothing had written to and passed.
  // Doing the thing under test first is what makes both tests fail for the right reason.
  fireEvent(doc.el('check-coverage-btn'), 'click');

  const said = coverageText(doc);
  assert.doesNotMatch(said, /OD-4\.1/, 'no clause was read out of the unvalidated sample schedule');
  assert.doesNotMatch(said, /\b250\b/, 'and no excess either');
  assert.match(said, /loading|not.*yet/i, 'and the panel says why rather than sitting empty');
  assert.equal(doc.el('check-coverage-btn').disabled, true, 'and the control is closed to a hand too');
});

test('nothing worked out against the embedded schedule survives the arrival of the validated pack', async () => {
  const doc = await whenReady();

  const said = coverageText(doc);
  assert.doesNotMatch(said, /OD-4\.1/,
    'the clause from the sample file is not still on the panel once the real rules are in');
  assert.doesNotMatch(said, /Excess/i, 'and neither is an excess');

  // And the panel is not gated to nothing: it says what to press.
  assert.match(said, /check the cover|Check cover/i);
});

test('after readiness the chip, read_claim_state and the form hint quote one revision', async () => {
  const doc = await whenReady();

  // FIRST, THE NUMBER THE PAGE SETTLED TO. The submission the test above sent while the draft was
  // closed is what this reads: if anything took it, the store is at 1 and the chip, which nothing
  // was subscribed to redraw, is still at 0. Two surfaces, one draft, two numbers, and a judge
  // reading either one of them is being told something the other one denies.
  const settled = chipRevision(doc);
  const before = textOfResult(await host.call('read_claim_state', {}));
  const beforeSaid = /revision (\d+)/.exec(before);
  assert.ok(beforeSaid, 'read_claim_state names a revision');
  assert.equal(Number(beforeSaid[1]), settled, 'and it is the one on the chip');
  assert.match(valueTextOf(rowFor(doc, 'witness_name')), /Missing/i,
    'and the witness submitted while the draft was closed is not on it');

  // THEN MOVED, ON PURPOSE. All three surfaces read the same at boot, so an agreement test taken
  // there agrees whatever the code does. One accepted edit is what makes the numbers separable.
  const row = rowFor(doc, 'location');
  row.control.value = 'Harbour Road';
  fireEvent(row.control, 'change');

  assert.equal(valueTextOf(row), 'Harbour Road', 'the edit was taken, so there is something to agree about');

  const chip = chipRevision(doc);
  assert.ok(chip > 0, `the revision moved off 0, and is ${chip}`);

  const hint = /revision (\d+) now/.exec(doc.el('declared-revision-hint').textContent || '');
  assert.ok(hint, 'the declarative hint names a revision for an agent to quote');
  assert.equal(Number(hint[1]), chip, 'and it is the one on the chip');

  const read = textOfResult(await host.call('read_claim_state', {}));
  const told = /revision (\d+)/.exec(read);
  assert.ok(told, 'read_claim_state names a revision');
  assert.equal(Number(told[1]), chip, 'and it is the same one again');
});

test('a cover decision does not outlive the schedule that produced it', async () => {
  const doc = await whenReady();

  // THE PICKER SIDE OF THE SAME TRIGGER. The boot case above proves an answer taken before the
  // validated pack arrived is dropped. This proves the general rule it is one instance of, and it
  // is here because the clearing moved out of switchPack and into applyPack, where both callers
  // reach it. Without a test on this path, moving it would have removed the only thing that
  // cleared the panel when a visitor changes insurer, and every test would still have passed.
  fireEvent(doc.el('check-coverage-btn'), 'click');
  assert.match(coverageText(doc), /OD-4\.1/, 'there is a decision on the panel to go stale');

  const picker = doc.el('insurer-select');
  const other = picker.children.find((option) => option.value !== picker.value);
  assert.ok(other, 'the sample offers a second rule pack');
  picker.value = other.value;
  fireEvent(picker, 'change');

  const said = coverageText(doc);
  assert.doesNotMatch(said, /OD-4\.1/, "the previous insurer's clause is not still on the panel");
  assert.match(said, /Run the cover check again/i, 'and the panel says what to press rather than sitting empty');
});
