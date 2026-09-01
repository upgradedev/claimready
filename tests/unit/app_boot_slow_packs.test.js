/**
 * The window between the draft appearing and the rules arriving.
 *
 * WHAT WAS WRONG. `boot()` drew the claim rows, then awaited the rule pack fetches, then wired the
 * listeners. On a slow network that left a page where every control looked ordinary and none of
 * them was connected to anything: a visitor who answered a question during the load had the
 * keystroke ignored, and the redraw that followed the fetch painted the empty value back over it.
 * Nothing on the page said the draft was not open yet.
 *
 * The workspace standard is flat about this: no control is disabled without a visible reason, and
 * nothing is ever gated to null. The listeners are wired before anything is drawn now, and the
 * draft is closed with the reason on screen until the packs are in.
 *
 * THIS FILE CATCHES THE PAGE MID LOAD, which is the only place the defect ever existed. It starts
 * the boot without awaiting it and reads the page while the fetches are still outstanding.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

// Long enough to be caught in the act. The whole file costs about a second.
const booting = bootApp({ delayMs: 300 });

/** What the row prints as the stored answer, which is the store's value and not the control's. */
function valueTextOf(row) {
  return row.row.descendants().find((node) => node.classList.contains('field-value')).textContent;
}

/** The page as it is right now, mid load, without waiting for boot to finish. */
async function whileLoading() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const doc = globalThis.document;
    // The double's hooks start empty and unhidden, so "not hidden" is the state before boot has
    // said anything. The reason having text is the signal that setClaimBusy has run.
    const busy = doc && doc.el ? doc.el('claim-busy') : null;
    if (busy && busy.hidden === false && busy.textContent.trim().length > 0) return doc;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('the page never showed a loading state, so this test cannot see the window it is about');
}

/**
 * The page once the packs are in.
 *
 * `bootApp` returns when the persona line has been drawn, and that happens BEFORE the fetches are
 * awaited, so its resolution is not the page being ready. The reason line going away is.
 */
async function whenReady() {
  const { doc } = await booting;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (doc.el('claim-busy').hidden) return doc;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('the draft never opened, so the loading state is not being taken away');
}

test('while the rules are still arriving the draft is closed, and the page says why', async () => {
  const doc = await whileLoading();

  assert.equal(doc.el('claim-busy').hidden, false);
  assert.match(doc.el('claim-busy').textContent, /rules/i, 'the reason is a sentence, not an empty state');
  assert.equal(rowFor(doc, 'severity').control.disabled, true, 'and nothing can be typed into it');
  assert.equal(rowFor(doc, 'severity').pin.disabled, true);
});

test('nothing typed in that window can be silently lost, because nothing can be typed', async () => {
  const doc = await whileLoading();
  const row = rowFor(doc, 'severity');
  const before = doc.el('revision').textContent;

  // A disabled control in a browser does not raise this event at all. Firing it by hand is the
  // harsher test: even if something reached the handler, the page must not take it.
  row.control.value = 'structural';
  fireEvent(row.control, 'change');

  assert.equal(doc.el('revision').textContent, before, 'the revision did not move');
  assert.match(doc.el('field-error').textContent, /not open yet/i,
    'and the page said why rather than dropping the edit in silence');

  // THE REAL ASSERTION IS THE DRAFT, NOT THE CONTROL. The first version of this test read the
  // control's own value back, which was still the string this test had just assigned to it, so it
  // failed for a reason that had nothing to do with the defect. The field's printed value is what
  // the store holds.
  const settled = await whenReady();
  assert.equal(settled.el('claim-busy').hidden, true, 'and the reason goes when it stops applying');
  const after = rowFor(settled, 'severity');
  assert.equal(after.control.value, '', 'the value from the closed window is not on the draft');
  assert.equal(valueTextOf(after), 'Missing', 'and the claim never took it');
  assert.equal(after.control.disabled, false, 'while the draft itself opens when the rules are in');
});

test('once the rules are in, an answer is kept', async () => {
  const doc = await whenReady();
  const row = rowFor(doc, 'severity');
  row.control.value = 'dent';
  fireEvent(row.control, 'change');

  assert.equal(rowFor(doc, 'severity').control.value, 'dent');
});
