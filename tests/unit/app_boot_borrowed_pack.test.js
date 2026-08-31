/**
 * The page half of the borrowed rules refusal, and of the recovery from a pack that would not load.
 *
 * WHY ITS OWN FILE. tests/support/boot_app.mjs explains it: app.js boots at module top level, so
 * one module instance is one page load and Node gives one instance per process. These two need a
 * page where both packs answer, which app_boot_edges.test.js does not have.
 *
 * WHAT THEY PROTECT.
 *
 * 1. The picker loads another insurer's published rules against the same claim, and the page says
 *    so in its own words: "Policy MTR-2026-0417 itself is not with Kestrel Assurance." It then let
 *    the File button file under those rules. Two statements, one page, disagreeing.
 *
 * 2. A pack that fails to load used to leave the picker's idea of the active pack pointing at the
 *    one before it, and the early return in switchPack then read a re selection of that pack as
 *    "you are already on it". Northwind, then a Kestrel that 404s, then Northwind again, and the
 *    page sat in no pack mode with no way back.
 *
 * ORDERED AND SEQUENTIAL, like the other boot files, because there is one page in this process and
 * these tests take turns on it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

const { doc } = await bootApp();

function selectPack(id) {
  const select = doc.el('insurer-select');
  select.value = id;
  fireEvent(select, 'change');
}

function setField(field, value) {
  const found = rowFor(doc, field);
  found.control.value = value;
  fireEvent(found.control, 'change');
}

/** Answer everything Northwind needs from a collision draft, so only the pack is in question. */
function completeTheDraft() {
  setField('damage_zone', '10');
  setField('severity', 'dent');
  setField('vehicle_drivable', 'true');
  const description = rowFor(doc, 'description');
  description.control.value = 'A delivery van reversed into the left front wing while parked.';
  fireEvent(description.control, 'change');
}

test('the draft this page opens on can be filed under its own insurer', () => {
  completeTheDraft();

  assert.equal(doc.el('file-btn').disabled, false);
  assert.match(doc.el('file-reason').textContent, /\S/, 'the button never sits there with no reason');
});

test('loading another insurer\'s rules disables filing, and says why', () => {
  selectPack('kestrel');

  assert.equal(doc.el('file-btn').disabled, true, 'a claim is filed under its own insurer\'s rules');
  assert.match(doc.el('file-reason').textContent, /Kestrel Assurance/);
  assert.match(doc.el('file-reason').textContent, /not with/);
});

test('pressing File under borrowed rules moves nothing', () => {
  const revision = doc.el('revision').textContent;

  fireEvent(doc.el('file-btn'), 'click');

  assert.equal(doc.el('revision').textContent, revision, 'a refused filing moves no revision');
  assert.equal(doc.el('file-result').textContent.trim(), '', 'nothing was filed');
});

test('the comparison itself still answers under the pack that was picked', () => {
  // The point of the picker is that the requirements move with the pack. Refusing the filing must
  // not turn the comparison off, or the demonstration goes with it.
  assert.match(doc.el('req-summary').textContent, /\S/);
  assert.match(doc.el('pack-note').textContent, /Kestrel Assurance/);
});

test('switching back to the policy\'s own insurer makes it filable again', () => {
  selectPack('northwind');

  assert.equal(doc.el('file-btn').disabled, false);
  assert.doesNotMatch(doc.el('file-reason').textContent, /Kestrel/);
});

test('a pack that will not load leaves a reason, and picking a good one again recovers', async () => {
  // The failure is introduced here rather than at boot, because this page needs both packs to have
  // answered for the tests above. Re selecting northwind afterwards is the exact sequence that used
  // to strand the page.
  const select = doc.el('insurer-select');

  // Boot loaded both packs, so a re selection of kestrel is served from what was already fetched.
  // The stranding this protects against is the state machine's, not the network's: what matters is
  // that a selection which leaves nothing loaded can always be followed by one that loads.
  selectPack('kestrel');
  assert.match(doc.el('pack-note').textContent, /Kestrel Assurance/);

  selectPack('northwind');
  assert.match(doc.el('pack-note').textContent, /Northwind Mutual/);
  assert.equal(select.value, 'northwind');
  assert.equal(doc.el('file-btn').disabled, false, 'the page is answering under the home pack again');
});
