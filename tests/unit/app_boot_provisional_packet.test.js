/**
 * A provisional yes, followed all the way to the sealed document a handler receives.
 *
 * ITS OWN FILE, for the reason in tests/support/boot_app.mjs: app.js boots at module top level, so
 * one plain import per process is what keeps app.js a single row in the coverage table.
 *
 * WHAT WAS WRONG. The panel drew "Covered, provisionally" and check_coverage answered
 * "COVERED, PROVISIONALLY" on a claim whose yes still depended on a name nobody had given. The
 * packet dropped the qualifier and wrote a plain `covered`, then hashed it. So the one surface a
 * claims handler actually receives was the one telling them the answer was settled, and the digest
 * beside it made that look checked rather than made up. A sealed document that contradicts the page
 * is worse than no document.
 *
 * WHY IT IS ASSERTED ACROSS ALL FOUR SURFACES AT ONCE. Each of them was internally consistent and
 * right about what it was handed. A test that reads one at a time cannot see them disagree, which
 * is the same reason tests/unit/app_boot_filing.test.js reads three surfaces in one assertion. This
 * one reads the panel, the tool, the packet JSON and the packet markdown on one claim state, at one
 * moment, and asserts they are one answer.
 *
 * THE HOST HERE IS A FAKE AND IS NAMED ONE. It proves what the page publishes and what the page
 * does when something calls it. It proves nothing about a real browser or a real agent, and no
 * readiness row may cite it as evidence that a judge can drive this page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { textOfResult } from '../../src/webmcp/register.js';
import { bootApp, rowFor, createFakeAgentHost } from '../support/boot_app.mjs';
import { fireEvent } from '../support/dom_double.mjs';

/**
 * The clipboard the copy control writes to, so the JSON a person would carry away can be read.
 *
 * This is the page's only export route, and reading the packet out of the module instead would be
 * asserting something no visitor can reach. Installed before boot because the handler closes over
 * the global.
 */
let copied = null;
globalThis.navigator = {
  clipboard: {
    async writeText(text) { copied = text; },
  },
};

const host = createFakeAgentHost();
const { doc } = await bootApp({}, host);

/** Answer one row the way a visitor does. */
function setField(field, value) {
  const found = rowFor(doc, field);
  found.control.value = value;
  fireEvent(found.control, 'change');
}

/** The verdict the cover panel is drawing right now. */
function panelVerdict() {
  const found = doc.el('coverage-body').descendants()
    .find((node) => node.classList.contains('verdict'));
  return found ? found.textContent : null;
}

/** Wait for the digest, which is computed asynchronously after the packet is drawn. */
async function settle() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (doc.el('packet-copy').disabled === false) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

/*
 * The draft this file works on. The sample claim names Maria K. as the driver, and Northwind
 * excludes one named driver, so emptying that field is what puts the cover decision back into the
 * state where a yes is not yet a yes. Everything else is filled so the claim can actually be filed,
 * because the packet only exists after a filing and this defect only shows on the packet.
 */
test('the draft is completed with nobody named as the driver', () => {
  setField('damage_zone', '10');
  setField('severity', 'dent');
  setField('vehicle_drivable', 'true');
  setField('location', 'Car park on Harbour Road');
  setField('description', 'A delivery van reversed into the left front wing while parked.');
  setField('driver', '');

  assert.equal(doc.el('file-btn').disabled, false, `the draft must be filable: ${doc.el('file-reason').textContent}`);
});

test('the panel and the tool both say the yes is provisional', async () => {
  fireEvent(doc.el('check-coverage-btn'), 'click');
  assert.equal(panelVerdict(), 'Covered, provisionally');

  const said = textOfResult(await host.call('check_coverage'));
  assert.match(said, /COVERED, PROVISIONALLY/);
  assert.match(said, /do not tell the claimant they are covered yet/i);
});

test('the packet a handler receives says it too, in the JSON and in the markdown', async () => {
  fireEvent(doc.el('file-btn'), 'click');
  await settle();

  const markdown = doc.el('packet-view').textContent;
  assert.ok(markdown.length > 0, 'the packet panel drew nothing');

  fireEvent(doc.el('packet-copy'), 'click');
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  assert.ok(copied, 'the copy control put nothing on the clipboard');
  const exported = JSON.parse(copied);
  const coverage = exported.content.coverage;

  // THE ASSERTION THIS FILE EXISTS FOR. This was `covered: true` with nothing beside it.
  assert.equal(coverage.covered, true);
  assert.equal(coverage.provisional, true, 'the sealed packet dropped the qualifier the page drew');
  assert.match(coverage.provisional_reason, /Nobody is named as the driver yet/);
  assert.match(coverage.provisional_reason, /excludes 1 named driver/);

  // And the markdown a handler reads without a JSON viewer says the same three words the page does.
  assert.match(markdown, /\*\*Decision:\*\* covered, provisionally/);
  assert.match(markdown, /\*\*Still open:\*\* Nobody is named as the driver yet/);
  assert.doesNotMatch(markdown, /\*\*Decision:\*\* covered\n/, 'the markdown still writes a flat yes');
});

test('the page, the JSON and the markdown agree on all four facts about the same claim', async () => {
  // One claim, one moment, four readings. The defect was never that any surface was wrong on its
  // own terms, so the only assertion that catches it is the one that reads them together.
  const exported = JSON.parse(copied);
  const coverage = exported.content.coverage;
  const markdown = doc.el('packet-view').textContent;
  const tool = textOfResult(await host.call('check_coverage'));

  assert.equal(panelVerdict(), 'Covered, provisionally');
  assert.match(tool, /COVERED, PROVISIONALLY/);
  assert.equal(coverage.covered && coverage.provisional, true);
  assert.match(markdown, /covered, provisionally/);

  // The clause and the excess are the two numbers a handler acts on, and they have to be the same
  // number everywhere they appear or the qualifier is the least of the problems.
  assert.equal(coverage.clause, 'OD-4.1');
  assert.equal(coverage.deductible, 250);
  assert.match(tool, /Clause: OD-4\.1/);
  assert.match(tool, /Deductible the claimant pays: 250 EUR/);
  assert.match(markdown, /\*\*Clause:\*\* OD-4\.1/);
  assert.match(markdown, /\*\*Excess:\*\* 250 EUR/);

  const shown = doc.el('coverage-body').descendants().map((node) => node.textContent).join(' ');
  assert.match(shown, /OD-4\.1/);
  assert.match(shown, /250/);
});

test('the digest on the page is the digest of what was exported', async () => {
  // The packet is only worth the qualifier being in it if the qualifier is inside the hash. It is
  // in `content`, so it is, and this is the check that says so from the page's own two artifacts
  // rather than from the module.
  const exported = JSON.parse(copied);

  assert.match(exported.content_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(doc.el('packet-digest').textContent, exported.content_digest);
  assert.ok(doc.el('packet-view').textContent.includes(exported.content_digest),
    'the markdown carries the digest the JSON claims');
  assert.equal(exported.content.version, 2, 'the qualifier arrived with a format version of its own');
});
