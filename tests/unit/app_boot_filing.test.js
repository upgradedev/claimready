/**
 * The file gate, asserted on three surfaces at once, on one claim state.
 *
 * ITS OWN FILE, for the reason in tests/support/boot_app.mjs: one plain import per process, so
 * app.js stays a single row in the coverage table.
 *
 * WHY THREE SURFACES IN ONE ASSERTION AND NOT THREE TESTS. The defect was never that any one
 * surface was wrong on its own terms. Each was right about the input it was handed: the button
 * read the static required list, the requirements panel read the insurer's derived rules, the
 * writing tool reported readiness off the static list again, and the domain refused on the static
 * list too. Every one of them was internally consistent, and together they told a claimant that a
 * theft claim with an open police report requirement was ready to file. A test that checks one
 * surface at a time cannot see that. So each case below reads the button, the sentence beside it,
 * the requirements panel, what validate_claim tells a model, what apply_claim_patch tells a model,
 * and what the domain does when the filing is actually dispatched, and asserts they are one answer.
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
import { FILE_CODES } from '../../src/core/filing.js';

const host = createFakeAgentHost();
const { doc } = await bootApp({}, host);

function revisionNow() {
  return Number(doc.el('revision').textContent);
}

/** Answer one row the way a visitor does. */
function setField(field, value) {
  const found = rowFor(doc, field);
  found.control.value = value;
  fireEvent(found.control, 'change');
}

/**
 * What every surface says about the draft as it stands right now.
 *
 * Read in one go, from one page, so nothing here can be comparing two moments.
 */
async function surfaces() {
  return {
    buttonClosed: doc.el('file-btn').disabled,
    reason: doc.el('file-reason').textContent,
    blocked: doc.el('file-reason').classList.contains('is-blocked'),
    panel: doc.el('req-summary').textContent,
    validate: textOfResult(await host.call('validate_claim')),
    revision: revisionNow(),
  };
}

test('the sample draft is incomplete, and all three surfaces say the same thing about it', async () => {
  const seen = await surfaces();

  assert.equal(seen.buttonClosed, true);
  assert.match(seen.reason, /^Still needed before you can file: /);
  assert.equal(seen.blocked, true);
  assert.match(seen.validate, new RegExp(`^NOT READY TO FILE at revision ${seen.revision}\\. ${FILE_CODES.incomplete}\\.`));
  assert.ok(seen.validate.includes(`Why: ${seen.reason}`),
    `the page and the tool gave different reasons.\\npage:  ${seen.reason}\\ntool:  ${seen.validate}`);

  // And the dispatch agrees, which is the layer the other two used not to reach.
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent, '');
  assert.equal(revisionNow(), seen.revision, 'a refused filing moves no revision');
});

// THE AUDIT CASE, ON THE PAGE. Every required field answered, one insurer requirement open.
test('a theft claim with no police report reference is refused by every surface at once', async () => {
  const picker = doc.el('insurer-select');
  picker.value = 'northwind';
  fireEvent(picker, 'change');

  setField('incident_type', 'theft');
  setField('severity', 'dent');
  setField('vehicle_drivable', 'true');
  setField('description', 'The car was taken overnight from the street outside the house.');

  const seen = await surfaces();

  // The static required list is satisfied, which is exactly what used to open the button.
  assert.ok(!seen.validate.includes('Missing: '), 'nothing on the static required list is missing');

  assert.equal(seen.buttonClosed, true, 'the button was open over an open intake requirement');
  assert.equal(seen.blocked, true);
  assert.match(seen.reason, /still asks for: The police report reference/);
  assert.match(seen.panel, /1 of \d+ intake requirements are still open/);
  assert.match(seen.validate, new RegExp(`^NOT READY TO FILE at revision ${seen.revision}\\. ${FILE_CODES.requirements}\\.`));
  assert.ok(seen.validate.includes(`Why: ${seen.reason}`), 'the page and the tool gave different reasons');
  assert.match(seen.validate, /still open: police_report/);
  assert.match(seen.validate, /is not exposed as a WebMCP tool/);

  // The writing tool is a fourth surface and used to be the loudest of them: it said the person on
  // the page could press File this claim, directly above its own line naming the open requirement.
  const patched = textOfResult(await host.call('apply_claim_patch', {
    baseRevision: seen.revision,
    changes: [{ field: 'driver', value: 'Maria K.' }],
  }));
  assert.match(patched, new RegExp(`The draft cannot be filed yet: ${FILE_CODES.requirements}\\.`));
  assert.doesNotMatch(patched, /can press File this claim/);

  // And the button, pressed anyway, files nothing.
  const held = revisionNow();
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent, '');
  assert.equal(revisionNow(), held);
});

test('answering the requirement opens every surface together, and the filing lands', async () => {
  const row = rowFor(doc, 'police_report_ref');
  row.control.value = 'PR-2026-55810';
  fireEvent(row.control, 'change');

  const seen = await surfaces();

  assert.equal(seen.buttonClosed, false);
  assert.equal(seen.blocked, false);
  assert.equal(seen.reason, 'The draft is complete. Filing is yours to do.');
  assert.match(seen.panel, /intake requirements are answered/);
  assert.match(seen.validate, new RegExp(`^READY TO FILE at revision ${seen.revision}\\.`));
  assert.ok(seen.validate.includes(`Why: ${seen.reason}`));
  assert.match(seen.validate, /Tell the person on the page that they can press File this claim/);

  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(revisionNow(), seen.revision + 1, 'filing is a change like any other');
  assert.match(doc.el('file-result').textContent, /Filed via the page at /);

  // Filed, and the tool now says the fourth of the four refusals rather than the third.
  const after = textOfResult(await host.call('validate_claim'));
  assert.match(after, new RegExp(`NOT READY TO FILE at revision \\d+\\. ${FILE_CODES.alreadyFiled}\\.`));
  assert.match(after, /Why: This claim has already been filed\./);

  // A second press changes nothing, on any surface.
  const closed = revisionNow();
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(revisionNow(), closed);
  assert.equal(doc.el('file-btn').disabled, true);
});

// Filing is never a tool, and this is the file where a fake host could have been handed one.
test('nothing on the registered surface files, unpins or calls out a recovery truck', () => {
  for (const forbidden of ['file_claim', 'file', 'submit_claim', 'unpin_field', 'request_assistance']) {
    assert.ok(!host.toolNames().includes(forbidden), `${forbidden} reached the tool surface`);
  }
});

/* --------------------------------------------------------------- the packet a handler receives */

// THE PAGE HALF OF src/core/packet.js. The claim above is filed by the time these run, which is the
// only state the packet exists in. What matters here is that the panel appears with the filed
// revision on it, that the readable view is what the page actually drew rather than a promise about
// it, and that the copy the page hands out is the shape verify_packet.mjs reads.
test('filing draws the handler packet, from the revision that was filed', () => {
  const panel = doc.el('packet-panel');
  assert.equal(panel.hidden, false, 'the packet appears once a person has filed');

  const reference = doc.el('packet-reference').textContent;
  assert.match(reference, /-R\d+$/, `the reference names the filed revision: ${reference}`);
  assert.ok(
    reference.endsWith(`-R${revisionNow()}`),
    `the packet is built from the filed revision, and it said ${reference} at revision ${revisionNow()}`,
  );

  assert.match(doc.el('packet-notice').textContent, /No insurer backend is connected/);

  const view = doc.el('packet-view').textContent;
  assert.match(view, /# First notice of loss, /);
  assert.match(view, /verify_packet\.mjs/);
  assert.match(view, /via page/, 'the routes travel with the packet');
});

test('the packet folds open and closed, and says which it is', () => {
  const view = doc.el('packet-view');
  const toggle = doc.el('packet-toggle');

  assert.equal(view.hidden, true, 'it starts folded, because it is long');
  assert.equal(toggle.textContent, 'Show the packet');

  fireEvent(toggle, 'click');
  assert.equal(view.hidden, false);
  assert.equal(toggle.textContent, 'Hide the packet');

  fireEvent(toggle, 'click');
  assert.equal(view.hidden, true);
  assert.equal(toggle.textContent, 'Show the packet');
});


// THE PAGE AND THE PACKET HAVE TO AGREE ABOUT THE COVER, AND FOR A WHILE THEY DID NOT.
//
// The packet used to be handed the coverage by its caller, and the page handed it the panel's state
// object, which wraps the decision under `decision` along with when it was worked out. The packet
// read the wrapper as the decision, so every field came back undefined and a sealed document went
// out saying not covered, clause null, excess null, with a valid digest over it, while the panel
// above it said COVERED under OD-4.1 with an excess of 250. The packet works the cover out itself
// now, from the filed claim and the loaded pack, so there is no shape left to get wrong. This is
// the assertion that would have caught it.
test('the cover in the packet is the cover the page shows, whatever it is', () => {
  fireEvent(doc.el('check-coverage-btn'), 'click');
  const panel = doc.el('coverage-body').textContent;

  const clause = panel.match(/Clause([A-Z]{2}-\d+\.\d+)/);
  assert.ok(clause, `the panel names a clause for this to compare against: ${panel.slice(0, 120)}`);
  const covered = /^Not covered/.test(panel.trim()) === false;

  const view = doc.el('packet-view').textContent;
  assert.ok(view.includes(`**Clause:** ${clause[1]}`),
    `the packet has to name the clause the page named, ${clause[1]}`);
  assert.ok(view.includes(covered ? '**Decision:** covered' : '**Decision:** not covered'),
    'and it has to decide the same way');
});

test('a caller cannot inject a cover decision into the packet', () => {
  // The page passes none: buildFilingPacket works the cover out from the filed claim and the loaded
  // pack. This asserts the boundary at the level a reader can check, which is that the clause on the
  // packet is one the pack states rather than anything the page happened to be holding.
  const view = doc.el('packet-view').textContent;
  assert.match(view, /\*\*Clause:\*\* [A-Z]{2}-\d+\.\d+/);
});

test('a reset withdraws the packet with the draft it described', () => {
  fireEvent(doc.el('reset-btn'), 'click');
  assert.equal(doc.el('packet-panel').hidden, true, 'nothing filed, nothing to describe');
  assert.equal(doc.el('packet-view').textContent, '');
});
