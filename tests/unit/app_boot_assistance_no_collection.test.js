/**
 * The roadside button against a pack that does not ask for a collection.
 *
 * WHAT WAS WRONG. Pressing it spent the button, stamped "Roadside assistance requested via the page
 * at 10:14", and announced "The revision has moved on to 3, so a patch quoting an earlier one is
 * refused" whether or not the loaded pack raised a requirement the button answers. Both shipped
 * packs do raise one, so nothing on this page showed it. A pack that names its collection something
 * else, which the contract allows and a comment in app.js already said it allows, got three
 * statements about a thing that had not happened, and the revision sentence was simply false: the
 * store was never dispatched to.
 *
 * The pack here is Northwind with the collection requirement taken out and nothing else changed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

const northwind = JSON.parse(readFileSync(new URL('../../fixtures/insurers/northwind.json', import.meta.url), 'utf8'));
const withoutCollection = {
  ...northwind,
  requirements: [
    ...northwind.requirements.filter((entry) => entry.id !== 'roadside_collection'),
    // A human action this page has no control for, which the contract allows. The page must say so
    // rather than leaving the row looking like something on screen covers it.
    {
      id: 'police_station_visit',
      label: 'Report the incident at a police station',
      why: 'Clause PR-8.4 asks for a station report when the vehicle cannot be driven away.',
      when: { field: 'vehicle_drivable', equals: false },
      satisfied_by: { human_action: 'the claimant reports it at a police station in person.' },
    },
  ],
};

const { doc } = await bootApp({ bodies: { 'northwind.json': withoutCollection } });

test('the pack that ships here is not the only pack, and this one raises no collection', () => {
  assert.ok(northwind.requirements.some((entry) => entry.id === 'roadside_collection'),
    'the fixture this test edits does raise one, so the edit is the only difference');
  assert.ok(!withoutCollection.requirements.some((entry) => entry.id === 'roadside_collection'));
});

test('pressing the roadside button reports what happened, which is nothing', () => {
  const drivable = rowFor(doc, 'vehicle_drivable');
  drivable.control.value = 'false';
  fireEvent(drivable.control, 'change');

  const before = doc.el('revision').textContent;
  assert.equal(doc.el('assistance-btn').disabled, false,
    'the draft says the car cannot be driven, so the button is open');

  fireEvent(doc.el('assistance-btn'), 'click');

  assert.match(doc.el('field-error').textContent, /do not ask for a roadside collection/i,
    'the page said why rather than reporting a request it had not made');
  assert.equal(doc.el('revision').textContent, before, 'and the revision did not move');
  assert.doesNotMatch(doc.el('assistance-state').textContent, /requested/i,
    'nothing was requested, so nothing says it was');
  assert.equal(doc.el('assistance-btn').disabled, false,
    'and the button is not spent, because it never did anything');
});

test('a human action this page has no control for says so rather than sitting blank', () => {
  const notes = doc.el('requirements').descendants()
    .filter((node) => node.classList.contains('req-human-note'))
    .map((node) => node.textContent);

  assert.ok(notes.some((note) => /no control that answers this one/i.test(note)),
    `a human only requirement with no button on this page is left unexplained: ${JSON.stringify(notes)}`);
});
