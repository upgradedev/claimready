/**
 * src/ui/app.js booted with insurer rule packs that will not load.
 *
 * ITS OWN FILE, for the reason given in tests/support/boot_app.mjs: one plain import per process,
 * so app.js stays a single row in the coverage table.
 *
 * WHAT IT PROTECTS. With no pack the page does not know what the intake asks for. An empty
 * requirements list reads as "nothing more is needed", which is a statement about someone's claim
 * that the page has no basis for. So the summary must carry the reason and the list must stay
 * empty, and the file panel must not call the draft complete on the strength of a list it could
 * not read.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

const { doc } = await bootApp({ fail: /insurers\// });

test('the page still draws without any insurer rules', () => {
  assert.match(doc.el('persona-name').textContent, /^Signed in as /);
  assert.ok(doc.el('fields').children.length > 0);
  assert.ok(doc.el('tools-list').children.length >= 8, 'the tool surface is not the packs to withhold');
});

test('an intake it cannot read is said to be unknown, never drawn as empty', () => {
  assert.match(doc.el('req-summary').textContent, /did not load|cannot say/);
  assert.equal(doc.el('requirements').children.length, 0);
});

// FAIL CLOSED ON THE PAGE, NOT ONLY IN THE DOMAIN. With every required field answered and no rules
// to read the intake against, the old gate opened the button: it was disabled on the static list
// alone, and that list is satisfied. The page cannot say the intake is finished with this draft, so
// it does not open the control that says it is.
test('with no insurer rules the File button stays closed, and says why', () => {
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
  assert.equal(doc.el('file-reason').classList.contains('is-blocked'), true);

  const held = doc.el('revision').textContent;
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent, '', 'nothing was filed');
  assert.equal(doc.el('revision').textContent, held, 'a refused filing moves no revision');
});

test('the cover cannot be checked, and the page says that rather than saying not covered', () => {
  fireEvent(doc.el('check-coverage-btn'), 'click');
  const body = doc.el('coverage-body').textContent;
  assert.doesNotMatch(body, /Not covered/, 'no schedule is an unknown, never a no');
  assert.notEqual(body.trim(), '');
});
