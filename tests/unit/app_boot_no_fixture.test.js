/**
 * src/ui/app.js booted with a sample claim file that will not load.
 *
 * ITS OWN FILE, because the condition has to hold at boot and a module instance is a page load.
 * tests/support/boot_app.mjs says why one plain import per process is the rule: cache busting the
 * specifier to get a second boot in one file puts a second app.js row in the coverage table and
 * makes the reported total meaningless.
 *
 * WHAT IT PROTECTS. The page must never render empty, and must never let a visitor believe the
 * sample loaded when it did not. Both halves matter: a blank page in front of a judge is the worst
 * outcome, and a page that silently substitutes different data is the second worst.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bootApp, rowFor } from '../support/boot_app.mjs';

const { doc } = await bootApp({ fail: 'demo-collision' });

test('the page still draws, from the built in sample', () => {
  assert.match(doc.el('persona-name').textContent, /^Signed in as /);
  assert.match(doc.el('persona-policy').textContent, /^Policy /);
  assert.notEqual(doc.el('file-reason').textContent.trim(), '');
  assert.ok(doc.el('tools-list').children.length >= 8);
  assert.ok(doc.el('fields').children.length > 0, 'the draft rows must still be there');
});

test('and the page says out loud that it is not the sample file', () => {
  // Substituting data without a word is the failure this line prevents.
  assert.match(doc.el('status-detail').textContent, /a built in sample is being used/);
});

test('the built in sample is still a working draft, not a placeholder', () => {
  const zone = rowFor(doc, 'damage_zone');
  assert.equal(zone.control.disabled, false, 'the fallback must be editable like any other draft');
});
