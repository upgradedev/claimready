/**
 * The ordinary journey, filed through the real page, on a claim that is frozen the moment it files.
 *
 * ITS OWN FILE, for the reason in tests/support/boot_app.mjs: app.js boots at module top level, so
 * one plain import per process is what keeps app.js a single row in the coverage table.
 *
 * WHY IT EXISTS. `fileClaim` now deep freezes the graph it files, so the receipt in
 * src/core/claim.js attests the state that passed the gate rather than the address of an object
 * that can still be rewritten. tests/unit/filing_receipt_state.test.js proves that at the domain
 * and the store. What neither of those can prove is that the page still works afterwards, and that
 * is the half worth checking: every module here is strict, so a renderer or a tool that wrote to
 * the filed claim would now throw instead of quietly changing it, and the throw would land on the
 * one control this whole feature exists for. A deep freeze that breaks a renderer is a finding in
 * the renderer, and this is where it would be found.
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

/** The clipboard the copy control writes to. Installed before boot, where the handler looks. */
let copied = null;
globalThis.navigator = {
  clipboard: {
    async writeText(text) { copied = text; },
  },
};

const host = createFakeAgentHost();
const { doc } = await bootApp({}, host);

const ACCOUNT = 'A delivery van reversed into the left front wing while parked.';
const WHERE = 'Car park on Harbour Road';

/** Answer one row the way a visitor does. */
function setField(field, value) {
  const found = rowFor(doc, field);
  found.control.value = value;
  fireEvent(found.control, 'change');
}

/** Wait for the digest, which is worked out asynchronously after the panel is drawn. */
async function settle() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (doc.el('packet-copy').disabled === false) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

test('the visitor answers the draft and the page opens the file control', () => {
  setField('damage_zone', '10');
  setField('severity', 'dent');
  setField('vehicle_drivable', 'false');
  setField('location', WHERE);
  setField('description', ACCOUNT);

  // The car does not drive, so Northwind asks for a roadside collection and the page publishes
  // get_assistance_options. Pressing the control is what closes that requirement, and it is also
  // what puts the ninth tool on the surface, so the test below reads every tool this page has.
  fireEvent(doc.el('assistance-btn'), 'click');

  assert.equal(doc.el('file-btn').disabled, false,
    `the draft must be filable: ${doc.el('file-reason').textContent}`);
});

test('filing through the page builds the packet, and it holds what the page was told', async () => {
  fireEvent(doc.el('file-btn'), 'click');
  await settle();

  assert.equal(doc.el('field-error').textContent, '', 'the page reported an error while filing');

  fireEvent(doc.el('packet-copy'), 'click');
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  assert.ok(typeof copied === 'string' && copied.length > 0, 'the copy control handed over nothing');

  const exported = JSON.parse(copied);
  assert.equal(exported.content.claim.description.value, ACCOUNT);
  assert.equal(exported.content.claim.location.value, WHERE);
  assert.match(exported.content.filed.through, /not exposed as a WebMCP tool/);
  assert.match(exported.content_digest, /^sha256:[0-9a-f]{64}$/,
    'the packet left the page without its digest');
  assert.equal(doc.el('packet-digest').textContent, exported.content_digest);
});

test('the page and its tools go on reading the filed claim without writing to it', async () => {
  // A frozen claim refuses a write by throwing, and these are the readers that touch it after the
  // filing. If any of them wrote, this is where the page would fall over instead of answering.
  const before = doc.el('packet-view').textContent;

  const state = textOfResult(await host.call('read_claim_state'));
  assert.ok(state.includes(ACCOUNT), 'the read tool lost the filed account');

  const requirements = textOfResult(await host.call('get_requirements'));
  assert.ok(requirements.length > 0);

  // EVERY READING TOOL THE PAGE HAS PUBLISHED, NOT A SAMPLE OF THEM, and read off the host rather
  // than typed out, so a tool added later is covered the day it is registered. A tool that took a
  // local alias of a container and sorted it in place, `const pinned = claim.locked; pinned.sort()`,
  // passes silently on a draft and throws only on a filed claim, so a sample would have proved only
  // the sample. read_evidence_notes matters most of all: the notes are the nested container this
  // fix copies and freezes, and that tool is their only reader.
  const readers = host.toolNames().filter((name) => name !== 'apply_claim_patch');
  assert.ok(readers.length >= 8, `only ${readers.length} reading tools are published`);
  assert.ok(readers.includes('read_evidence_notes'), 'the notes reader is not published');
  assert.ok(readers.includes('get_assistance_options'), 'the conditional tool is not published');
  for (const name of readers) {
    const said = textOfResult(await host.call(name));
    assert.ok(typeof said === 'string' && said.length > 0, `${name} answered nothing on a filed claim`);
  }

  // And the writing tool is refused with a sentence, which is what it did before the freeze too.
  const refused = textOfResult(await host.call('apply_claim_patch', {
    changes: [{ field: 'location', value: 'Somewhere else entirely' }],
    base_revision: 4,
  }));
  assert.match(refused, /^PATCH_REJECTED_PROTECTED\. This claim has already been filed/);
  assert.match(refused, /Nothing was changed\.$/);

  // Nothing any of them did moved the sealed document.
  assert.equal(doc.el('packet-view').textContent, before,
    'reading the filed claim changed the packet the page had already sealed');

  const said = textOfResult(await host.call('read_claim_state'));
  assert.ok(said.includes(ACCOUNT), 'the filed account changed under the page');
});

test('the file control stays closed once the claim is filed', () => {
  assert.equal(doc.el('file-btn').disabled, true);
  assert.match(doc.el('file-reason').textContent, /has been filed/i);
});
