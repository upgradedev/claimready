/**
 * The declarative half of WebMCP, as it actually ships.
 *
 * WHAT IS PROVED HERE, AND WHAT IS NOT. Two different things are checked and they must not be
 * confused with one another.
 *
 *   1. THE MARKUP. The four attributes are read out of the shipped index.html and compared, string
 *      for string, with the constants in src/webmcp/declarative_form.js that the page publishes to
 *      a reader. This is a file fact. It proves the attributes ship and cannot drift from what the
 *      page says about them. It proves nothing about any browser.
 *
 *   2. THE HANDLER. The submit handler in src/ui/app.js is driven on both paths, a person pressing
 *      the button and an agent submission carrying agentInvoked and respondWith, against the DOM
 *      double. That double states in its own header what it does and does not prove. It proves the
 *      handler goes through the one store, records the right actor, returns the rules own refusal
 *      rather than swallowing it, and never throws when respondWith or preventDefault is absent.
 *      It proves NOTHING about whether Chrome's declarative API invokes that handler. No readiness
 *      row may cite this file as evidence that a judge can call this form.
 *
 * WHY THERE IS NO AGENT HOST IN THIS FILE. There is nothing for one to hold. A declarative tool is
 * never handed to registerTool: the browser reads it off the markup, so document.modelContext is
 * not on this path at all, and agentInvoked is a property of the SubmitEvent rather than a fact
 * about the page. One boot therefore reaches both paths, and a fake host here would be scenery.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { bootApp, rowFor } from '../support/boot_app.mjs';
import { fireEvent, createDocumentDouble, installClockDouble } from '../support/dom_double.mjs';
import { createView } from '../../src/ui/render.js';
import {
  FORM_CONTROLS,
  FORM_TOOL_DESCRIPTION,
  FORM_TOOL_NAME,
  REVISION_CONTROL,
  describeDeclarativeForm,
  describeOutcome,
  planSubmission,
} from '../../src/webmcp/declarative_form.js';

const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/** The budgets from the Chrome WebMCP tool security guidance, the same ones the style gate holds. */
const MAX_TOOL_NAME = 30;
const MAX_TOOL_DESCRIPTION = 500;
const MAX_PARAM_DESCRIPTION = 150;

/** The only attribute names the declarative API defines. Anything else on the form is invented. */
const DECLARATIVE_ATTRIBUTES = ['toolname', 'tooldescription', 'toolautosubmit', 'toolparamdescription'];

function attributeOf(tag, name) {
  const found = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return found ? found[1] : null;
}

function formTag() {
  const tags = HTML.match(/<form\b[^>]*>/g) || [];
  assert.equal(tags.length, 1, 'the page carries exactly one form, so one declared tool');
  return tags[0];
}

function inputTagNamed(name) {
  const tags = HTML.match(/<input\b[^>]*>/g) || [];
  const found = tags.filter((tag) => attributeOf(tag, 'name') === name);
  assert.equal(found.length, 1, `exactly one control is named ${name}`);
  return found[0];
}

const { doc } = await bootApp();

function revisionNow() {
  return Number(doc.el('revision').textContent);
}

function fill(values) {
  doc.el('declared-witness').value = values.witness === undefined ? '' : values.witness;
  doc.el('declared-police').value = values.police === undefined ? '' : values.police;
  doc.el('declared-revision').value = values.revision === undefined ? '' : String(values.revision);
}

/** Submit the way a person does: press the button, no agentInvoked anywhere. */
function submitAsPerson(values = {}) {
  fill(values);
  return fireEvent(doc.el('declared-form'), 'submit');
}

/**
 * Submit the way the declarative API says an agent submission arrives: agentInvoked true and a
 * respondWith that takes the promise. The promises it was handed come back, so a test can await
 * exactly what the model would have been given.
 */
function submitAsAgent(values = {}, options = {}) {
  fill(values);
  const answered = [];
  const extra = { agentInvoked: true };
  if (options.respondWith !== false) {
    extra.respondWith = (promise) => { answered.push(promise); };
  }
  if (options.preventDefault === false) extra.preventDefault = null;
  const event = fireEvent(doc.el('declared-form'), 'submit', extra);
  return { event, answered };
}

function newestLedgerEntry() {
  return doc.el('ledger').children[0];
}

/* ------------------------------------------------------- 1. the markup as shipped */

test('the form carries the four declarative attributes, and only those four', () => {
  const tag = formTag();

  assert.equal(attributeOf(tag, 'toolname'), FORM_TOOL_NAME);
  assert.equal(attributeOf(tag, 'tooldescription'), FORM_TOOL_DESCRIPTION);
  assert.match(tag, /\btoolautosubmit(?=[\s>])/, 'toolautosubmit is a bare boolean attribute');

  // An attribute this API does not define would be read by nothing and would read to a reviewer as
  // a capability the page does not have. Same rule the style gate applies to annotation names.
  //
  // SCOPED TO THE TAGS, NOT THE FILE, and the values are stripped before the names are read. The
  // first version of this scanned the whole document for the word, and reported the prose in the
  // comments above the form as invented attributes. A check that fires on the explanation of the
  // thing it checks gets deleted by the next person, so it reads tags.
  const tags = [tag, ...FORM_CONTROLS.map((control) => inputTagNamed(control.name))];
  const invented = tags
    .flatMap((one) => [...one.replace(/="[^"]*"/g, '=').matchAll(/\s([a-zA-Z][a-zA-Z0-9-]*)/g)])
    .map((match) => match[1])
    .filter((name) => name.startsWith('tool'))
    .filter((name) => !DECLARATIVE_ATTRIBUTES.includes(name));
  assert.deepEqual([...new Set(invented)], [], 'an attribute the declarative API does not define is on the page');

  // And the check has to be able to fail, or it is a regex that matches nothing.
  const broken = tag.replace('toolautosubmit', 'toolautosubmit toolreadonly');
  const caught = [...broken.replace(/="[^"]*"/g, '=').matchAll(/\s([a-zA-Z][a-zA-Z0-9-]*)/g)]
    .map((match) => match[1])
    .filter((name) => name.startsWith('tool') && !DECLARATIVE_ATTRIBUTES.includes(name));
  assert.deepEqual(caught, ['toolreadonly'], 'the scanner does not actually catch an invented attribute');
});

test('the declared tool name and descriptions are inside the published budgets', () => {
  assert.ok(FORM_TOOL_NAME.length <= MAX_TOOL_NAME, `the name is ${FORM_TOOL_NAME.length} characters`);
  assert.match(FORM_TOOL_NAME, /^[a-z][a-z0-9_]*$/, 'lower snake case, like every registered tool');
  assert.ok(FORM_TOOL_DESCRIPTION.length <= MAX_TOOL_DESCRIPTION);

  for (const control of FORM_CONTROLS) {
    assert.ok(
      control.description.length <= MAX_PARAM_DESCRIPTION,
      `${control.name} description is ${control.description.length} characters`,
    );
  }
});

test('the declared tool is not one of the actions this page keeps to a person', () => {
  // The same list src/webmcp/register.js keeps absent from the registered surface. A declared tool
  // is a tool, so the boundary has to hold on this path too or the product claim is false.
  const humanOnly = ['file', 'file_claim', 'submit_claim', 'request_assistance', 'pin_field', 'unpin_field'];
  assert.ok(!humanOnly.includes(FORM_TOOL_NAME));
  assert.ok(!/\bfile\b|\bassistance\b|\bpin\b/i.test(FORM_TOOL_DESCRIPTION),
    'the declared tool does not offer any of the three actions that stay with the person');
});

test('every control maps to a schema property description, and to a label a person can read', () => {
  for (const control of FORM_CONTROLS) {
    const tag = inputTagNamed(control.name);
    assert.equal(
      attributeOf(tag, 'toolparamdescription'),
      control.description,
      `${control.name} description has drifted from src/webmcp/declarative_form.js`,
    );

    // Without toolparamdescription the browser falls back to the label, so the label has to exist
    // either way. It is also the only thing a person filling this in by hand ever reads.
    const id = attributeOf(tag, 'id');
    assert.ok(id, `${control.name} has no id, so no label can point at it`);
    assert.match(HTML, new RegExp(`<label[^>]*\\bfor="${id}"`), `${control.name} has no label`);
  }
});

test('the form cannot navigate while the page is still booting', () => {
  // The form carries an action, so a submit that reached the default would leave the page. The
  // real handler needs the store, and the store needs a fetch, so it cannot be attached first.
  // What is attached first is a listener that always prevents the default and answers. This is a
  // structural check because the window it closes is over before a test can fire an event into
  // it: it asserts the listener goes on ahead of the first await in boot, which is the only thing
  // that makes the window empty rather than short.
  const source = readFileSync(new URL('../../src/ui/app.js', import.meta.url), 'utf8');
  const bootAt = source.indexOf('async function boot()');
  assert.ok(bootAt > 0, 'boot has been renamed');
  const listenerAt = source.indexOf("declaredForm.addEventListener('submit'", bootAt);
  const firstAwaitAt = source.indexOf('await ', bootAt);
  assert.ok(listenerAt > bootAt, 'the submit listener is not attached inside boot');
  assert.ok(
    listenerAt < firstAwaitAt,
    'the submit listener is attached after boot yields, which leaves a window where a submit navigates',
  );
});

test('the form is a real control before it is an API surface', () => {
  const tag = formTag();
  // Same origin, and never fired, because the handler prevents the default on both paths. It is
  // here because both documented examples carry one and nothing is gained by leaving it out.
  assert.equal(attributeOf(tag, 'action'), './');
  assert.match(HTML, /<button type="submit"/, 'a person needs a button to press');
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(HTML), 'no inline script, the page ships a strict policy');
  assert.ok(!/\sstyle="/i.test(HTML), 'no style attribute, the same policy blocks it');
});

/* -------------------------------------------- 2. the page reports both halves honestly */

test('the declared tool is listed on the page, and never as a registered one', () => {
  const rows = doc.el('tools-list').children;
  const row = rows.find((item) => item.textOfClass('tool-name') === FORM_TOOL_NAME);
  assert.ok(row, 'the tenth tool is missing from the list the page publishes');

  assert.equal(row.classList.contains('is-declared'), true);
  assert.equal(row.classList.contains('is-live'), false, 'nothing registered it, so nothing may say it did');
  assert.ok(row.descendants().some((node) => node.textContent === 'declared by a form'));
  assert.ok(!row.descendants().some((node) => node.textContent === 'registered'));

  // And the count says which half each one came from, rather than folding ten into one number.
  assert.match(doc.el('tools-count').textContent, /tools this page publishes to an agent/);
  assert.match(doc.el('tools-count').textContent, /declared by a form rather than registered/);
});

test('the surface entry carries the same wording the form does', () => {
  const entry = describeDeclarativeForm();
  assert.equal(entry.name, FORM_TOOL_NAME);
  assert.equal(entry.wording, FORM_TOOL_DESCRIPTION);
  assert.ok(entry.purpose.length > 0);
  assert.ok(entry.purpose.length <= entry.wording.length, 'the purpose is an opening sentence, not a new claim');
  assert.equal(entry.declarative, true);
  assert.equal(entry.readOnly, false, 'it writes, and the row must not read as a read only tool');
});

/* -------------------------------------------------- 3. a person, with no agent present */

test('a person fills the form in and presses the button, and the draft moves', () => {
  const before = revisionNow();
  assert.equal(rowFor(doc, 'witness_name').row.classList.contains('is-missing'), true);

  const event = submitAsPerson({ witness: 'Anna Vella' });

  assert.equal(event.defaultPrevented, true, 'the page commits through the store and never navigates');
  assert.equal(revisionNow(), before + 1, 'an accepted change moves the counter');

  const row = rowFor(doc, 'witness_name');
  assert.equal(row.row.classList.contains('is-missing'), false);
  assert.equal(row.control.value, 'Anna Vella', 'the row above the form shows what the form wrote');
  assert.equal(row.badge.textContent, 'via page', 'a person at the keyboard is provenance via the page');
  assert.equal(row.badge.classList.contains('badge-you'), true);

  assert.match(doc.el('declared-result').textContent, /^Recorded the name of the witness on the draft, written by you\./);
  assert.match(doc.el('declared-result').textContent, new RegExp(`revision ${before + 1}\\.$`));
  assert.equal(doc.el('declared-witness').value, '', 'an accepted submission empties the boxes');
});

test('a submission a person makes is not a tool call and is not ledgered as one', () => {
  const before = doc.el('ledger').children.length;
  submitAsPerson({ police: 'PR-2026-55810' });
  assert.equal(doc.el('ledger').children.length, before, 'the ledger is the record of what an agent called');
  assert.equal(rowFor(doc, 'police_report_ref').badge.textContent, 'via page');
});

test('resubmitting what is already on the draft changes nothing and moves no revision', () => {
  const before = revisionNow();
  submitAsPerson({ police: 'PR-2026-55810' });
  assert.equal(revisionNow(), before, 'a revision that moved for no edit makes every earlier read stale for nothing');
  assert.match(doc.el('declared-result').textContent, /already on the draft/);
});

test('an empty submission says so instead of pretending something happened', () => {
  const before = revisionNow();
  submitAsPerson({});
  assert.equal(revisionNow(), before);
  assert.match(doc.el('declared-result').textContent, /^Nothing was submitted\./);
});

/* ------------------------------------------------------- 4. an agent, through the form */

test('an agent submission without the revision it read is refused, and told what to send', async () => {
  const before = revisionNow();
  const { event, answered } = submitAsAgent({ witness: 'Petros Iliou' });

  assert.equal(event.defaultPrevented, true, 'the documentation requires preventDefault before respondWith');
  assert.equal(revisionNow(), before, 'nothing was written');

  assert.equal(answered.length, 1, 'the agent is answered, not left waiting');
  const said = await answered[0];

  // The refusal reaches the model in the words src/core used, including the number to quote next.
  assert.match(said, /^Refused\. PATCH_REJECTED_STALE: /);
  assert.match(said, /baseRevision/);
  assert.match(said, new RegExp(`revision ${before}`));
  assert.equal(doc.el('declared-result').textContent, said, 'the page shows what the agent was told');

  // And a viewer sees it, on the same ledger every other agent action lands on.
  const entry = newestLedgerEntry();
  assert.equal(entry.textOfClass('ledger-name'), FORM_TOOL_NAME);
  assert.equal(entry.classList.contains('is-refused'), true);
  assert.equal(entry.textOfClass('ledger-code'), 'PATCH_REJECTED_STALE');
  assert.match(entry.textOfClass('ledger-args'), /Petros Iliou/);
  assert.match(doc.el('live').textContent, /The page refused it: PATCH_REJECTED_STALE\./);
});

test('an agent submission quoting the revision it read is applied, and badged as the agent', async () => {
  const before = revisionNow();
  const ledgerBefore = doc.el('ledger').children.length;
  const { answered } = submitAsAgent({ witness: 'Petros Iliou', revision: before });

  assert.equal(revisionNow(), before + 1);

  const row = rowFor(doc, 'witness_name');
  assert.equal(row.control.value, 'Petros Iliou');
  assert.equal(row.badge.textContent, 'via tool', 'the form is a tool when an agent submits it');
  assert.equal(row.badge.classList.contains('badge-agent'), true);

  const said = await answered[0];
  assert.match(said, /^Recorded the name of the witness on the draft, written by your agent\./);
  assert.match(said, new RegExp(`revision ${before + 1}\\.$`));

  const entry = newestLedgerEntry();
  assert.equal(doc.el('ledger').children.length, ledgerBefore + 1);
  assert.equal(entry.textOfClass('ledger-name'), FORM_TOOL_NAME);
  assert.equal(entry.classList.contains('is-refused'), false);
  assert.equal(entry.textOfClass('ledger-result'), said);
  assert.equal(doc.el('declared-witness').value, '');
});

test('an agent quoting a revision the draft has moved past is refused with both numbers', async () => {
  const stale = revisionNow() - 1;
  const now = revisionNow();
  const { answered } = submitAsAgent({ police: 'PR-2026-00001', revision: stale });

  assert.equal(revisionNow(), now, 'a patch written against an older draft is not applied to this one');
  const said = await answered[0];
  assert.match(said, /^Refused\. PATCH_REJECTED_STALE: /);
  assert.match(said, new RegExp(`expected revision ${stale}, current revision ${now}`));
});

test('a field a person pinned refuses the form too, and the agent is told which one', async () => {
  // Pinning is a human only control and there is no tool for it. It has to hold on this path.
  const pin = rowFor(doc, 'witness_name').pin;
  fireEvent(pin, 'click');
  assert.equal(rowFor(doc, 'witness_name').pin.getAttribute('aria-pressed'), 'true');

  const now = revisionNow();
  const { answered } = submitAsAgent({ witness: 'Someone Else', revision: now });

  assert.equal(revisionNow(), now);
  const said = await answered[0];
  assert.match(said, /^Refused\. PATCH_REJECTED_LOCKED: /);
  assert.match(said, /witness_name/);
  assert.equal(newestLedgerEntry().textOfClass('ledger-code'), 'PATCH_REJECTED_LOCKED');

  // Put it back, so the tests after this one start from an unpinned draft.
  fireEvent(rowFor(doc, 'witness_name').pin, 'click');
  assert.equal(rowFor(doc, 'witness_name').pin.getAttribute('aria-pressed'), 'false');
});

test('a value the rules will not take is refused rather than trimmed to fit', async () => {
  const now = revisionNow();
  const { answered } = submitAsAgent({ police: 'X'.repeat(400), revision: now });

  assert.equal(revisionNow(), now);
  const said = await answered[0];
  assert.match(said, /^Refused\. /);
  assert.match(said, /police_report_ref/);
});

/* --------------------------------------------------------- 5. feature detection */

test('a browser that sets agentInvoked but offers no respondWith is not broken by it', () => {
  const before = revisionNow();
  assert.doesNotThrow(() => submitAsAgent({ police: 'PR-2026-77777', revision: before }, { respondWith: false }));

  assert.equal(revisionNow(), before + 1, 'the draft is still written, and the page still shows it');
  assert.equal(rowFor(doc, 'police_report_ref').badge.textContent, 'via tool');
  assert.equal(newestLedgerEntry().textOfClass('ledger-name'), FORM_TOOL_NAME);
});

test('an event with no preventDefault is handled rather than thrown on', () => {
  const before = revisionNow();
  assert.doesNotThrow(() => submitAsAgent({ witness: 'Kyra Manos', revision: before }, { preventDefault: false }));
  assert.equal(revisionNow(), before + 1);
});

test('the form closes with the draft, and its hint names the revision to quote', () => {
  const clock = installClockDouble();
  try {
    const view = createView(createDocumentDouble());

    view.renderDeclaredForm({ filed: false, revision: 7 });
    assert.equal(view.els.declaredSubmit.disabled, false);
    assert.equal(view.els.declaredRevision.disabled, false);
    assert.match(view.els.declaredRevisionHint.textContent, /at revision 7 now/);
    assert.match(view.els.declaredRevisionHint.textContent, /Leave this box empty/);

    view.renderDeclaredForm({ filed: true, revision: 8 });
    assert.equal(view.els.declaredSubmit.disabled, true);
    assert.equal(view.els.declaredWitness.disabled, true);
    assert.equal(view.els.declaredPolice.disabled, true);
    assert.equal(view.els.declaredRevision.disabled, true);
    assert.match(view.els.declaredRevisionHint.textContent, /The claim is filed/);

    view.renderDeclaredResult('anything');
    assert.equal(view.els.declaredResult.textContent, 'anything');
    view.els.declaredWitness.value = 'x';
    view.clearDeclaredInputs();
    assert.equal(view.els.declaredWitness.value, '');
  } finally {
    clock.restore();
  }
});

/* ---------------------------------------------------- 6. the module on its own */

test('planSubmission reads an empty control as leave it alone, never as clear it', () => {
  const plan = planSubmission({ witnessName: ' Anna ', policeReportRef: '   ', agentInvoked: true, baseRevision: '4' });
  assert.deepEqual(plan.changes, [{ field: 'witness_name', value: 'Anna' }]);
  assert.deepEqual(plan.fields, ['witness_name']);
  assert.equal(plan.actor, 'agent');
  assert.equal(plan.baseRevision, '4');
  assert.equal(plan.empty, false);
});

test('planSubmission turns an empty revision into no quote at all, not into revision zero', () => {
  // Number('') is 0, so passing the empty string through would be read as a quote of revision 0 and
  // refused as stale with an off by one. Null is what makes src/core say which number to send.
  const plan = planSubmission({ witnessName: 'Anna', baseRevision: '   ', agentInvoked: true });
  assert.equal(plan.baseRevision, null);
});

test('planSubmission ignores the revision box entirely when a person submits', () => {
  const plan = planSubmission({ witnessName: 'Anna', baseRevision: '2' });
  assert.equal(plan.actor, 'human');
  assert.equal(plan.baseRevision, null, 'a person is not asked to quote a revision anywhere else either');
});

test('planSubmission reports an empty form as empty rather than as a patch of nothing', () => {
  const plan = planSubmission({});
  assert.equal(plan.empty, true);
  assert.deepEqual(plan.changes, []);
});

test('describeOutcome hands back the rules own refusal, code and all', () => {
  const said = describeOutcome({
    ok: false,
    code: 'PATCH_REJECTED_LOCKED',
    error: 'witness_name is pinned.',
    revision: 5,
    agentInvoked: true,
  });
  assert.match(said, /PATCH_REJECTED_LOCKED: witness_name is pinned\./);
  assert.match(said, /Nothing on the draft changed/);
  assert.match(said, /revision 5/);
});

test('describeOutcome names both fields when both were written', () => {
  const said = describeOutcome({
    ok: true,
    applied: ['witness_name', 'police_report_ref'],
    revision: 6,
    agentInvoked: false,
  });
  assert.equal(
    said,
    'Recorded the name of the witness and the police report reference on the draft, written by you. '
    + 'The draft is now at revision 6.',
  );
});

test('describeOutcome falls back to a refusal sentence when the rules gave no words', () => {
  assert.match(describeOutcome({ ok: false, revision: 2 }), /The rules refused this change\./);
  assert.match(describeOutcome({ empty: true }), /revision 0\./);
});

test('the revision control is named once, and that name is what the markup carries', () => {
  assert.equal(REVISION_CONTROL, 'base_revision');
  assert.equal(attributeOf(inputTagNamed(REVISION_CONTROL), 'type'), 'number');
});
