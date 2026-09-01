/**
 * src/ui/app.js booted against a sample file whose list of available packs does not tell the truth.
 *
 * ITS OWN FILE, for the reason given in tests/support/boot_app.mjs: one boot per process, and this
 * one needs a different sample file at boot than every other page test has.
 *
 * THE DEFECT THIS IS THE PAGE HALF OF. The sample file lists the packs on offer as { id, path }, and
 * nothing checked that the id it states is the id inside the file at that path. It matters because
 * this page and the domain read that identity from two different places:
 *
 *   src/ui/app.js          keys the picker, the borrowed rules banner and the tool context's packId
 *                          on the id in the LIST
 *   src/core/filing.js     packIdentity reads the id inside the PACK FILE, and the filing refusal
 *                          and the handler packet both come off that
 *
 * So a manifest entry called northwind pointing at the kestrel file put the page in a state where
 * its own borrowed rules protection read one name and the thing it protects read the other. Neither
 * reader is wrong, so neither was changed. The disagreement is refused at the one place both names
 * are in the same room, which is loadPolicyPack.
 *
 * The second half of the same list is an id written twice. The loaded packs live in a Map keyed by
 * that id, so the second entry overwrote the first: the picker drew one row where the list named
 * two, and which of the two files answered depended on the order the fetches settled in.
 *
 * The fixtures on disk are never touched. The bent sample file is a deep copy made in memory and
 * served by the fetch double.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/demo-collision.json', import.meta.url), 'utf8'));

/*
 * The claim stays with northwind, as the shipped sample says. The list is what lies.
 *
 *   northwind  points at the kestrel file, so the list and the file disagree about whose rules these
 *              are. This is the entry the whole file is about.
 *   kestrel    tells the truth, and is here so the page has one pack that loads. A test where
 *              nothing loads proves only what app_boot_no_pack.test.js already proves.
 *   harbour    written twice, at two different files.
 */
const bent = {
  ...fixture,
  insurer_pack: 'northwind',
  available_packs: [
    { id: 'northwind', path: './fixtures/insurers/kestrel.json' },
    { id: 'kestrel', path: './fixtures/insurers/kestrel.json' },
    { id: 'harbour', path: './fixtures/insurers/northwind.json' },
    { id: 'harbour', path: './fixtures/insurers/kestrel.json' },
  ],
};

const { doc } = await bootApp({ bodies: { 'demo-collision.json': bent } });

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

// THE HEADLINE. The kestrel file was listed under the home insurer's name, and the page did not let
// it answer under that name. Had the mismatch loaded, this page would be showing Kestrel's excesses
// and Kestrel's intake with no borrowed rules banner anywhere, because the banner is computed from
// the list and the list said northwind.
test('a file listed under the wrong name never answers under that name', () => {
  const note = doc.el('pack-note').textContent;

  assert.equal(doc.el('insurer-select').value, 'kestrel', 'the page fell back to the entry that tells the truth');
  assert.match(note, /Kestrel Assurance/, 'whatever answers is named honestly');
  assert.match(note, /not with Kestrel Assurance/, 'and the borrowed rules banner is drawn, as it must be');
});

test('the mismatched entry states both names when it is picked', () => {
  selectPack('northwind');
  const note = doc.el('pack-note').textContent;

  assert.match(note, /The northwind rule pack did not load/);
  assert.match(note, /calls this one "northwind" and the file itself says "kestrel"/);
  assert.match(note, /the page decides whose rules these are from the list/);
});

// A refusal must not strand the page. This is the same recovery app_boot_borrowed_pack.test.js pins
// for a pack that will not fetch, asked of a pack that will not validate.
test('picking a pack that does load recovers the page', () => {
  selectPack('kestrel');
  assert.match(doc.el('pack-note').textContent, /Kestrel Assurance/);
  assert.match(doc.el('req-summary').textContent, /\S/, 'the comparison still answers');
});

test('an id the list writes twice refuses both copies, and says so in the reader\'s words', () => {
  selectPack('harbour');
  const note = doc.el('pack-note').textContent;

  assert.match(note, /The harbour rule pack did not load/);
  assert.match(note, /names "harbour" 2 times/);
  assert.match(note, /neither is loaded until the list says which one is/);
});

// The picker draws one row per id, so the duplicate collapses whatever happens. What must not
// collapse is the honesty: the row that is left is a refusal, not a coin toss between two files.
test('the picker offers the three names the list can still mean', () => {
  const options = doc.el('insurer-select').children.map((node) => node.value);
  assert.deepEqual(options.sort(), ['harbour', 'kestrel', 'northwind']);
});

test('filing is refused under the borrowed pack, which is the protection that used to read the wrong name', () => {
  selectPack('kestrel');
  setField('damage_zone', '10');
  setField('severity', 'dent');
  setField('vehicle_drivable', 'true');
  setField('witness_name', 'M. Okafor');
  const description = rowFor(doc, 'description');
  description.control.value = 'A delivery van reversed into the left front wing while parked.';
  fireEvent(description.control, 'change');

  assert.equal(doc.el('file-btn').disabled, true, 'a claim is filed under its own insurer\'s rules');
  assert.match(doc.el('file-reason').textContent, /Kestrel Assurance/);
  assert.match(doc.el('file-reason').textContent, /not with/);

  const held = doc.el('revision').textContent;
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent.trim(), '', 'nothing was filed');
  assert.equal(doc.el('revision').textContent, held);
});
