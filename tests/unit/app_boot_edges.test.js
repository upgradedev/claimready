/**
 * src/ui/app.js on the paths a visitor reaches by pressing the wrong thing, or the right thing
 * twice, or by picking an insurer whose rules will not load.
 *
 * WHY ITS OWN FILE. tests/support/boot_app.mjs explains it: app.js calls boot() at module top
 * level, so a module instance is a page load and Node gives one instance per process. A scenario
 * that needs different conditions at boot needs its own file. This one boots with the Kestrel rule
 * pack refused by the network, which is a condition, so it cannot live in app_boot.test.js.
 *
 * WHAT THESE PROTECT. app.js sat at 130 of 180 branches. The fifty that never ran were almost all
 * on this side of the page: the refusal beside a control somebody pressed early, the second press
 * of a one time action, the insurer whose schedule did not arrive. Those are the moments a judge
 * with ninety seconds is most likely to create by accident, and the workspace rule about them is
 * flat: no control is disabled without a visible reason beside it, and nothing is ever gated to
 * null. Nothing had ever executed one of them.
 *
 * ORDERED AND SEQUENTIAL, like app_boot.test.js, because there is one page in this process and
 * these tests take turns on it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fireEvent } from '../support/dom_double.mjs';
import { bootApp, rowFor } from '../support/boot_app.mjs';

// One insurer's rules answer, the other's do not. Both halves matter: a page with no rules at all
// is a different test, in app_boot_no_pack.test.js.
const { doc } = await bootApp({ fail: /insurers\/kestrel/ });

function reload() {
  fireEvent(doc.el('reset-btn'), 'click');
}

function setField(field, value) {
  const found = rowFor(doc, field);
  found.control.value = value;
  fireEvent(found.control, 'change');
}

test('the page comes up on the insurer whose rules did answer', () => {
  assert.match(doc.el('persona-name').textContent, /^Signed in as /);
  assert.match(doc.el('req-summary').textContent, /\S/, 'the intake summary is never left empty');
  assert.equal(doc.el('revision').textContent, '0');
});

// H2 AND H3 FROM THE STANDARD, ON THE CONTROL A JUDGE IS MOST LIKELY TO PRESS EARLY. Roadside
// collection is for a car that cannot be driven. On a draft that has not said so, pressing it must
// produce a reason to read, not a recovery request against a claim that never asked for one.
test('asking for roadside collection on a draft that has not said the car is stuck is refused, with the reason on the page', () => {
  reload();
  setField('vehicle_drivable', 'true');
  const before = doc.el('revision').textContent;

  fireEvent(doc.el('assistance-btn'), 'click');

  assert.match(doc.el('field-error').textContent, /vehicle that cannot be driven/);
  assert.notEqual(doc.el('field-error').textContent.trim(), '', 'a refusal is never rendered as an empty state');
  assert.equal(doc.el('revision').textContent, before, 'a refused request moves no revision');
});

test('a roadside collection is recorded once, and pressing again changes nothing', () => {
  reload();
  setField('vehicle_drivable', 'false');

  fireEvent(doc.el('assistance-btn'), 'click');
  const afterFirst = doc.el('revision').textContent;
  assert.equal(doc.el('field-error').textContent, '', 'the accepted request clears the earlier refusal');
  assert.notEqual(afterFirst, '0', 'the request closed a requirement, so the revision moved');

  fireEvent(doc.el('assistance-btn'), 'click');
  assert.equal(
    doc.el('revision').textContent,
    afterFirst,
    'the second press recorded a second collection, which is a request the claimant never made',
  );
});

// EMPTYING A REQUIRED FIELD ON THE PAGE IS REFUSED, AND THE REASON IS PUT BESIDE IT. This was
// written expecting the cover check to be asked with no incident type, and the page would not let
// that state exist: the store refuses the clear, so the draft never reaches it. The branch in
// runCoverageByHand that answers an empty incident type is therefore defensive, and it is named in
// the handover rather than reached by a test that pretends otherwise.
test('a required field cannot be emptied on the page, and the refusal names the field', () => {
  reload();
  const before = doc.el('revision').textContent;
  setField('incident_type', '');

  assert.match(doc.el('field-error').textContent, /incident_type is required/);
  assert.match(doc.el('field-error').textContent, /Nothing was changed/);
  assert.equal(doc.el('revision').textContent, before, 'a refused clear moves no revision');
  assert.equal(rowFor(doc, 'incident_type').control.value, 'collision', 'the control kept the value the claim still holds');
});

test('a cover check on a complete draft gives a decision, so the refusal above was about the draft', () => {
  reload();
  fireEvent(doc.el('check-coverage-btn'), 'click');
  const body = doc.el('coverage-body').textContent;
  assert.match(body, /COVERED|NOT COVERED/i, `the panel said ${JSON.stringify(body.slice(0, 120))}`);
});

// THE INSURER PICKER, POINTED AT RULES THAT DID NOT ARRIVE. The page must say the pack did not
// load and must withdraw the cover answer it had, because that answer was decided by another
// insurer's schedule and is not this one's.
test('switching to an insurer whose rules did not load says so, and does not leave the old answer standing', () => {
  reload();
  fireEvent(doc.el('check-coverage-btn'), 'click');
  assert.match(doc.el('coverage-body').textContent, /COVERED|NOT COVERED/i);

  const select = doc.el('insurer-select');
  select.value = 'kestrel';
  fireEvent(select, 'change');

  assert.match(doc.el('pack-note').textContent, /did not load/);
  const body = doc.el('coverage-body').textContent;
  assert.doesNotMatch(body, /^Cover decision/, 'the previous insurer answer was left on the page');
  assert.notEqual(body.trim(), '', 'the panel was gated to nothing instead of given a reason');
});

test('an insurer whose rules did not load leaves the intake unknown, never empty', () => {
  assert.match(doc.el('req-summary').textContent, /did not load|cannot say/);
  assert.equal(doc.el('requirements').children.length, 0);
});

/* ------------------------------------------------- the declarative form */

// THE FORM IS A REAL CONTROL FIRST. A person fills it in and presses the button, with no agent
// anywhere, and the same rules answer.
test('the form submitted with nothing in it is refused, in the words the module keeps for it', () => {
  reload();
  const before = doc.el('revision').textContent;
  doc.el('declared-witness').value = '';
  doc.el('declared-police').value = '';

  fireEvent(doc.el('declared-form'), 'submit');

  assert.match(doc.el('declared-result').textContent, /^Refused\. FORM_REFUSED_EMPTY/);
  assert.equal(doc.el('revision').textContent, before, 'a refused submission moves no revision');
});

test('the form submitted by a person records the detail and empties the boxes', () => {
  reload();
  const before = Number(doc.el('revision').textContent);
  doc.el('declared-witness').value = 'A. Neighbour';
  doc.el('declared-police').value = '';

  fireEvent(doc.el('declared-form'), 'submit');

  assert.match(doc.el('declared-result').textContent, /^Recorded /);
  assert.match(doc.el('declared-result').textContent, /through the page UI/);
  assert.equal(Number(doc.el('revision').textContent), before + 1);
  assert.equal(doc.el('declared-witness').value, '', 'an accepted submission empties the boxes');
});

// THE AGENT PATH, AND THE REFUSAL THAT REACHES IT. A quote of a revision that has moved is refused
// by the same rule that refuses an imperative patch, and the refusal has to travel back through
// respondWith or the model never learns what to do next.
test('an agent submission quoting a revision that has moved is refused, and the refusal reaches the model', async () => {
  reload();
  doc.el('declared-witness').value = 'B. Witness';
  doc.el('declared-police').value = '';
  doc.el('declared-revision').value = '0';

  // Move the draft under the agent, exactly as a person editing the page does.
  setField('severity', 'structural');
  assert.notEqual(doc.el('revision').textContent, '0');

  let answered = null;
  fireEvent(doc.el('declared-form'), 'submit', {
    agentInvoked: true,
    respondWith(promise) { answered = promise; },
  });

  const said = doc.el('declared-result').textContent;
  assert.match(said, /^Refused\. PATCH_REJECTED_STALE/);
  assert.ok(answered, 'the browser was never handed a result, so the model heard nothing');
  assert.equal(await answered, said, 'the model was told something other than what the page shows');
  assert.equal(doc.el('declared-witness').value, 'B. Witness', 'a refusal keeps what the sender would correct and send again');
});

test('an agent submission the rules accept is reported as arriving through the tool call', async () => {
  reload();
  doc.el('declared-witness').value = 'C. Witness';
  doc.el('declared-police').value = 'PR-2026-118';
  doc.el('declared-revision').value = doc.el('revision').textContent;

  let answered = null;
  fireEvent(doc.el('declared-form'), 'submit', {
    agentInvoked: true,
    respondWith(promise) { answered = promise; },
  });

  const said = doc.el('declared-result').textContent;
  assert.match(said, /^Recorded /);
  assert.match(said, /through the WebMCP tool call/);
  assert.equal(await answered, said);
  assert.ok(doc.el('ledger').children.length > 0, 'an agent submission is never left off the ledger');
});

// A BROWSER THAT SETS agentInvoked AND OFFERS NO respondWith MUST NOT BREAK THE PAGE, and neither
// must one whose respondWith throws. The page is what the claimant is using.
test('a browser with no respondWith, or one that refuses it, still updates the page', () => {
  reload();
  doc.el('declared-witness').value = 'D. Witness';
  doc.el('declared-police').value = '';
  doc.el('declared-revision').value = doc.el('revision').textContent;
  assert.doesNotThrow(() => fireEvent(doc.el('declared-form'), 'submit', { agentInvoked: true }));
  assert.match(doc.el('declared-result').textContent, /^Recorded /);

  reload();
  doc.el('declared-witness').value = 'E. Witness';
  doc.el('declared-police').value = '';
  doc.el('declared-revision').value = doc.el('revision').textContent;
  assert.doesNotThrow(() => fireEvent(doc.el('declared-form'), 'submit', {
    agentInvoked: true,
    respondWith() { throw new Error('this browser refuses the response'); },
  }));
  assert.match(doc.el('declared-result').textContent, /^Recorded /);
});
