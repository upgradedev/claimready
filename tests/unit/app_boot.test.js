/**
 * src/ui/app.js, booted for the first time, on the path a visitor actually takes.
 *
 * WHAT WAS WRONG. This is the wiring: 940 lines that fetch the sample claim, load the insurer rule
 * packs, build the tool context, register the surface, and connect every control on the page. Like
 * render.js it had never executed under a test and did not appear in the coverage table at all.
 * Unlike render.js it has no exports whatsoever and calls boot() at module top level against a
 * free `document` and a free `fetch`, so there is nothing to import and call.
 *
 * HOW IT IS REACHED ANYWAY. Both of those are free identifiers, resolved on globalThis when the
 * module runs, so seeding a DOM double and a fetch double that serves the SHIPPED fixtures off disk
 * and then importing the module boots the real page. tests/support/boot_app.mjs does that, once per
 * process, and says there why it must be once.
 *
 * ONE PAGE, RELOADED BETWEEN TESTS. Every test after the first begins by pressing the page's own
 * reset control, which is the same thing a visitor presses, so each starts from the loaded sample
 * rather than from whatever the previous test left behind. The first test runs before any reset,
 * because what it asserts is the state of a page nobody has touched.
 *
 * THESE TESTS ARE ORDERED AND MUST STAY SEQUENTIAL. There is one page in this process and they
 * take turns on it. node:test runs top level tests in a file in declaration order, which is what
 * makes that safe. Do not add concurrency here: they would then share one page at the same time
 * and fail in ways that look like defects in the page rather than in the test file. A scenario
 * that genuinely needs a second page needs a second file, for the reason boot_app.mjs gives.
 *
 * WHAT THIS DOES NOT PROVE. There is no browser here, no layout, no real network and no real agent.
 * These tests prove the wiring holds together and that the page is drawn from the shipped sample.
 * Whether it renders in Chrome is answered by the live URL and nothing else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

const { doc, net } = await bootApp();

/** Press the page's own reset, so the next test starts from the loaded sample. */
function reload() {
  fireEvent(doc.el('reset-btn'), 'click');
}

test('the page a visitor lands on is drawn from the shipped sample claim', () => {
  assert.match(doc.el('persona-name').textContent, /^Signed in as /);
  assert.match(doc.el('persona-policy').textContent, /^Policy /);

  // The sample file and both rule packs are what boot asked the network for.
  assert.ok(net.asked.some((path) => path.includes('demo-collision.json')));
  assert.ok(net.asked.some((path) => path.includes('insurers/')));

  // The whole published surface is listed whether or not an agent is here to take it.
  assert.ok(doc.el('tools-list').children.length >= 8,
    `only ${doc.el('tools-list').children.length} tool rows were drawn`);
  assert.match(doc.el('tools-count').textContent, /tools this page publishes to an agent/);

  // The panels a judge reads first are all populated rather than empty.
  assert.notEqual(doc.el('req-summary').textContent.trim(), '');
  assert.notEqual(doc.el('file-reason').textContent.trim(), '');
  assert.match(doc.el('coverage-body').textContent, /Not checked yet/);
  assert.match(doc.el('estimate-body').textContent, /No band yet/);
  assert.equal(doc.el('ledger-empty').classList.contains('hidden'), false);
  assert.equal(doc.el('revision').textContent, '0');
});

test('with no agent in the browser the page says so and still works', () => {
  reload();
  assert.match(doc.el('status-text').textContent, /No agent detected in this browser/);
  assert.equal(doc.el('strip').classList.contains('is-off'), true);
  // Not an apology. The whole surface is listed, with the reason none of it is registered.
  assert.match(doc.el('status-detail').textContent, /Everything on this page still works/);
  for (const row of doc.el('tools-list').children) {
    assert.equal(row.classList.contains('is-idle'), true);
  }
});

test('an edit on the page commits, moves the revision, and is badged as arriving via the page', () => {
  reload();
  const before = Number(doc.el('revision').textContent);

  const severity = rowFor(doc, 'severity');
  severity.control.value = 'structural';
  fireEvent(severity.control, 'change');

  assert.equal(Number(doc.el('revision').textContent), before + 1, 'a committed edit moves the counter');
  // The badge names the surface the answer came in on, which is what the claim records.
  assert.equal(rowFor(doc, 'severity').badge.textContent, 'via page');
  assert.equal(rowFor(doc, 'severity').row.classList.contains('is-missing'), false);
});

test('an edit that changes nothing does not move the revision', () => {
  reload();
  const zone = rowFor(doc, 'damage_zone');
  zone.control.value = '10';
  fireEvent(zone.control, 'change');
  const after = Number(doc.el('revision').textContent);

  // The counter is what tells a viewer a real write happened, so it must not tick for a write
  // that wrote nothing.
  zone.control.value = '10';
  fireEvent(zone.control, 'change');
  assert.equal(Number(doc.el('revision').textContent), after);
});

test('clearing a required field is refused and the page says which one', () => {
  reload();
  const type = rowFor(doc, 'incident_type');
  assert.notEqual(type.control.value, '', 'the sample should arrive with this answered');

  type.control.value = '';
  fireEvent(type.control, 'change');

  // The rules refuse it and the page prints their reason rather than failing silently.
  assert.notEqual(doc.el('field-error').textContent.trim(), '');
});

test('pinning a field from the page closes its control and prints the reason', () => {
  reload();
  const before = rowFor(doc, 'incident_type');
  assert.equal(before.control.disabled, false);

  fireEvent(before.pin, 'click');

  const after = rowFor(doc, 'incident_type');
  assert.equal(after.row.classList.contains('is-pinned'), true);
  assert.equal(after.control.disabled, true);
  assert.match(after.hint.textContent, /Pinned via the page/);
  assert.equal(after.pin.getAttribute('aria-pressed'), 'true');

  // And back again, because a pin nobody can undo is a trap.
  fireEvent(after.pin, 'click');
  const undone = rowFor(doc, 'incident_type');
  assert.equal(undone.row.classList.contains('is-pinned'), false);
  assert.equal(undone.control.disabled, false);
});

test('checking the cover by hand answers the panel, and leaves the tool ledger alone', () => {
  reload();
  fireEvent(doc.el('check-coverage-btn'), 'click');

  const body = doc.el('coverage-body').textContent;
  assert.doesNotMatch(body, /Not checked yet/, 'the panel should have been answered');
  assert.match(body, /draft revision \d+/, 'an answer must name the draft it belongs to');
  assert.match(body, /Run via the page at /, 'which surface ran it is part of the answer');

  // THE LEDGER IS FOR TOOL CALLS AND ONLY FOR TOOL CALLS. A button on the page runs the same
  // domain function directly, without going through the published surface, so nothing is ledgered.
  // That is what the ledger is for: telling an agent's writes apart from the visitor's own. The
  // panel says who ran it instead.
  assert.equal(doc.el('ledger').children.length, 0);
  assert.equal(doc.el('ledger-empty').classList.contains('hidden'), false);
});

test('an answer on the page is retired when the draft moves under it', () => {
  reload();
  fireEvent(doc.el('check-coverage-btn'), 'click');
  assert.match(doc.el('coverage-body').textContent, /draft revision \d+/);

  const description = rowFor(doc, 'description');
  description.control.value = 'A van came out of a side road and hit the left front wing.';
  fireEvent(description.control, 'change');

  // The answer was worked out against a draft that no longer exists, so the panel says so rather
  // than leaving a superseded verdict on screen.
  assert.match(doc.el('coverage-body').textContent, /The draft has moved since this cover check/);
});

test('pinning moves the revision without retiring an answer none of whose inputs changed', () => {
  reload();
  fireEvent(doc.el('check-coverage-btn'), 'click');
  const before = doc.el('coverage-body').textContent;
  assert.match(before, /draft revision \d+/);

  fireEvent(rowFor(doc, 'incident_type').pin, 'click');

  const after = doc.el('coverage-body').textContent;
  assert.doesNotMatch(after, /The draft has moved/, 'pinning changed no input to this decision');
  assert.match(after, /still current at \d+/, 'both numbers belong on the panel');
});

test('the estimate button says what it needs rather than drawing an empty band', () => {
  reload();
  // The sample lands with no damage position and no severity.
  fireEvent(doc.el('check-estimate-btn'), 'click');
  assert.match(doc.el('estimate-body').textContent, /needs a damage position and a severity/);

  const zone = rowFor(doc, 'damage_zone');
  zone.control.value = '10';
  fireEvent(zone.control, 'change');
  const severity = rowFor(doc, 'severity');
  severity.control.value = 'dent';
  fireEvent(severity.control, 'change');

  fireEvent(doc.el('check-estimate-btn'), 'click');
  const body = doc.el('estimate-body').textContent;
  assert.match(body, /Band/);
  assert.match(body, /not a quote/i);
});

test('roadside assistance opens only once the draft says the car cannot be driven', () => {
  reload();
  assert.equal(doc.el('assistance-btn').disabled, true);
  assert.match(doc.el('assistance-state').textContent, /Collection is for a vehicle that cannot be driven/);

  const drivable = rowFor(doc, 'vehicle_drivable');
  drivable.control.value = 'false';
  fireEvent(drivable.control, 'change');

  assert.equal(doc.el('assistance-btn').disabled, false);
  assert.match(doc.el('assistance-state').textContent, /yours to press/);

  // THE COUNTER HAS TO MOVE, AND NO FIELD CHANGED. Pressing this closes an intake requirement that
  // every tool was reporting as open, so a patch an agent wrote against the answers from a moment
  // ago is answering a question the page no longer asks. The revision is the only number a patch
  // quotes, so it is the only thing that can refuse that patch. Before this was asserted the whole
  // dispatch could be deleted from requestAssistance and every test here stayed green.
  const revisionBefore = Number(doc.el('revision').textContent);
  fireEvent(doc.el('assistance-btn'), 'click');
  assert.match(doc.el('assistance-state').textContent, /Roadside assistance requested via the page at /);
  assert.equal(doc.el('assistance-btn').disabled, true, 'it cannot be requested twice');
  assert.equal(Number(doc.el('revision').textContent), revisionBefore + 1,
    'a human action that closes a requirement changes what every tool answers, so it must move the '
    + 'revision, or a patch written before it is still accepted');
  assert.match(doc.el('live').textContent, /revision has moved on to/,
    'the page has to say why the number moved, or the refusal that follows looks arbitrary');
});

test('switching insurer reads the same claim against another published rule pack', () => {
  reload();
  const picker = doc.el('insurer-select');
  assert.ok(picker.children.length >= 2, 'the sample should offer more than one rule pack');

  const other = picker.children.find((option) => option.value !== picker.value);
  const summaryBefore = doc.el('req-summary').textContent;

  const revisionBefore = Number(doc.el('revision').textContent);
  picker.value = other.value;
  fireEvent(picker, 'change');

  // THE COUNTER HAS TO MOVE, AND NO FIELD CHANGED. Another insurer's schedule is now answering
  // get_requirements, check_coverage and read_claim_state, so an agent holding the number it read
  // before the switch is holding a number that no longer describes the answers it read. Asserted
  // here because the summary assertion below passes whether or not the dispatch happened.
  assert.equal(Number(doc.el('revision').textContent), revisionBefore + 1,
    'switching the rule pack changes what every tool answers, so it must move the revision, or a '
    + 'patch written against the previous insurer is still accepted');
  assert.match(doc.el('live').textContent, /revision has moved on to/,
    'the page has to say why the number moved, or the refusal that follows looks arbitrary');

  // The policy line has to name both, or a decision reads as though this policy belonged to
  // whichever insurer last answered.
  assert.match(doc.el('persona-policy').textContent, /read against .+ rules/);
  assert.notEqual(doc.el('pack-note').textContent.trim(), '');
  assert.notEqual(doc.el('req-summary').textContent, summaryBefore,
    'another insurer asking for exactly the same things would make the picker pointless');
});

test('loading the synthetic incident again says so, and moves the revision on rather than back', () => {
  reload();
  const severity = rowFor(doc, 'severity');
  severity.control.value = 'structural';
  fireEvent(severity.control, 'change');
  const moved = Number(doc.el('revision').textContent);
  assert.ok(moved > 0);

  fireEvent(doc.el('reset-btn'), 'click');

  // A control with no visible answer reads as a control that does nothing.
  assert.match(doc.el('reset-note').textContent, /Synthetic incident loaded again at /);
  assert.equal(doc.el('reset-note').classList.contains('is-flash'), true);
  assert.equal(rowFor(doc, 'severity').row.classList.contains('is-missing'), true,
    'the draft should be back as it was');

  // The counter does not rewind. A patch quoting an earlier revision must still be refused.
  assert.ok(Number(doc.el('revision').textContent) > moved,
    'sending the revision backwards would let a patch written against a discarded draft land');
  assert.equal(doc.el('ledger').children.length, 0, 'the ledger is cleared with the draft');
});

/** Set one row on the page the way a visitor does, and commit it. */
function setField(field, value) {
  const found = rowFor(doc, field);
  found.control.value = value;
  fireEvent(found.control, 'change');
}

// Filing is last, because it is the one action the page cannot be reloaded out of within a test
// that follows it without depending on reset to reopen a closed draft.
//
// THIS IS THE PAGE HALF OF THE FILE GATE, AND IT IS THE DEFECT THAT PROMPTED THE MODULE. The
// button was disabled on the static required list alone, so the moment those six fields were full
// it opened, over a requirements panel that was still naming an open intake requirement, and
// pressing it filed the claim. Every step below is now decided by src/core/filing.js.
test('filing waits for the insurer intake, not only for the required fields', () => {
  reload();

  // Pinned rather than inherited. The reset restores the draft and not the rule pack, so without
  // this the gate under test would be whichever insurer an earlier test happened to leave loaded.
  const picker = doc.el('insurer-select');
  picker.value = 'northwind';
  fireEvent(picker, 'change');

  assert.equal(doc.el('file-btn').disabled, true, 'an incomplete draft cannot be filed');

  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent, '',
    'a disabled button that filed anyway would be the whole defect');

  // Every required field answered, and the car cannot be driven, which is what raises this
  // insurer's roadside collection rule and its collection address rule.
  setField('damage_zone', '10');
  setField('severity', 'dent');
  setField('vehicle_drivable', 'false');
  setField('description', 'A car came out of a side road and hit the left front wing.');

  assert.match(doc.el('req-summary').textContent, /intake requirements are still open/,
    'the panel beside the button says the intake is still asking');
  assert.equal(doc.el('file-btn').disabled, true,
    'the button stayed open over an open intake requirement, which is the defect this guards');
  assert.match(doc.el('file-reason').textContent, /still asks for/);
  assert.equal(doc.el('file-reason').classList.contains('is-blocked'), true);

  // Pressing it anyway changes nothing: the domain refuses the same decision the button drew.
  const held = doc.el('revision').textContent;
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent, '', 'nothing was filed');
  assert.equal(doc.el('revision').textContent, held, 'a refused filing moves no revision');

  // Answer the question that raised them, and both requirements go with it.
  setField('vehicle_drivable', 'true');
  assert.match(doc.el('req-summary').textContent, /intake requirements are answered/);
  assert.equal(doc.el('file-btn').disabled, false, 'a draft the intake is finished with is the visitor to file');
  assert.equal(doc.el('file-reason').textContent, 'The draft is complete. Filing is yours to do.');

  fireEvent(doc.el('file-btn'), 'click');

  // The line names the surface the filing arrived on. It is printed by the very click that filed
  // the claim, and the page cannot know whether a person or a browser driving agent made it.
  assert.match(doc.el('file-result').textContent, /Filed via the page at /);
  assert.doesNotMatch(doc.el('file-result').textContent, /by you/);
  assert.match(doc.el('file-result').textContent, /not exposed as a WebMCP tool/);
  assert.match(doc.el('claim-note').textContent, /The draft is closed/);
  assert.equal(rowFor(doc, 'severity').control.disabled, true);

  // And a filed claim refuses a further edit rather than quietly taking it.
  const revision = doc.el('revision').textContent;
  const severity = rowFor(doc, 'severity');
  severity.control.value = 'structural';
  fireEvent(severity.control, 'change');
  assert.equal(doc.el('revision').textContent, revision, 'a filed claim is closed to changes');

  // A second press of a button the page has already closed files nothing twice.
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('revision').textContent, revision, 'a filed claim cannot be filed again');
});
