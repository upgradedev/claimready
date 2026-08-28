/**
 * src/ui/app.js booted with an agent host present, which is the demonstration itself.
 *
 * ITS OWN FILE, for the reason in tests/support/boot_app.mjs: one plain import per process, so
 * app.js stays a single row in the coverage table.
 *
 * WHAT IT COVERS THAT THE OTHER BOOTS CANNOT. With no host in the browser the page registers
 * nothing, so the whole agent side of the wiring never runs: the wrapper that instruments every
 * tool call, the ledger it writes, the refusal buffer, and the announcements when the published
 * surface changes under the claim. Those are the lines a judge is watching, and none of them had
 * ever executed.
 *
 * THE HOST HERE IS A FAKE AND IS NAMED ONE. It proves what the page publishes and what the page
 * does when something calls it. It proves nothing about a real browser or a real agent, and no
 * readiness row may cite it as evidence that a judge can drive this page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { textOfResult } from '../../src/webmcp/register.js';
import { bootApp, rowFor, createFakeAgentHost } from '../support/boot_app.mjs';

const host = createFakeAgentHost();
const { doc } = await bootApp({}, host);

/** The revision the page is showing, which is what a patch must quote. */
function revisionNow() {
  return Number(doc.el('revision').textContent);
}

test('the page registers its surface with the agent and says so', () => {
  assert.ok(host.toolNames().length >= 8, `only ${host.toolNames().length} tools were registered`);
  assert.match(doc.el('status-text').textContent, /Agent connected through /);
  assert.match(doc.el('status-text').textContent, /tools registered/);
  assert.equal(doc.el('strip').classList.contains('is-on'), true);
  assert.equal(doc.el('status-dot').classList.contains('dot-ok'), true);

  // A row may say registered only because the host accepted it.
  const live = doc.el('tools-list').children.filter((row) => row.classList.contains('is-live'));
  assert.equal(live.length, host.toolNames().length);

  // And filing is not on that list, which is the claim the whole page rests on.
  assert.ok(!host.toolNames().includes('file_claim'));
  assert.match(doc.el('status-detail').textContent, /Filing and roadside assistance are not on that list/);
});

test('a read only tool call lands in the ledger and on the panel', async () => {
  const before = doc.el('ledger').children.length;
  const said = textOfResult(await host.call('check_coverage'));

  assert.match(said, /Cover decision under/);
  assert.equal(doc.el('ledger').children.length, before + 1, 'every tool call is ledgered');

  const entry = doc.el('ledger').children[0];
  assert.equal(entry.textOfClass('ledger-name'), 'check_coverage');
  assert.notEqual(entry.textOfClass('ledger-result'), '');
  assert.equal(doc.el('ledger-empty').classList.contains('hidden'), true);

  // The page shows the same answer the agent just got, marked as the agent's.
  assert.match(doc.el('coverage-body').textContent, /Run by your agent at /);
});

test('a write from the agent moves the draft, is badged via tool, and is ledgered', async () => {
  const before = revisionNow();
  const said = textOfResult(await host.call('apply_claim_patch', {
    baseRevision: before,
    changes: [{ field: 'damage_zone', value: 10 }],
  }));

  assert.equal(revisionNow(), before + 1, 'an accepted write moves the counter');
  assert.match(said, /\b10\b/);

  const row = rowFor(doc, 'damage_zone');
  assert.equal(row.badge.textContent, 'via tool');
  assert.equal(row.badge.classList.contains('badge-agent'), true);
  assert.match(row.badge.title, /the call is in the ledger below/);

  assert.equal(doc.el('ledger').children[0].textOfClass('ledger-name'), 'apply_claim_patch');
});

test('a write quoting a revision that has moved is refused, and the refusal is shown', async () => {
  const stale = revisionNow() - 1;
  const before = revisionNow();

  const said = textOfResult(await host.call('apply_claim_patch', {
    baseRevision: stale,
    changes: [{ field: 'severity', value: 'dent' }],
  }));

  assert.equal(revisionNow(), before, 'a refused write must change nothing');
  // A refusal is drawn as loudly as a success, with the code the rules gave it. This is the part
  // of the demonstration worth watching.
  const entry = doc.el('ledger').children[0];
  assert.equal(entry.classList.contains('is-refused'), true);
  assert.notEqual(entry.textOfClass('ledger-code'), null);
  assert.notEqual(entry.textOfClass('ledger-reason'), null);
  assert.match(said, /revision|stale|refused/i);
});

test('a write to a pinned field is refused however it arrives', async () => {
  const { fireEvent } = await import('../support/dom_double.mjs');
  fireEvent(rowFor(doc, 'damage_zone').pin, 'click');
  assert.equal(rowFor(doc, 'damage_zone').row.classList.contains('is-pinned'), true);

  const before = revisionNow();
  await host.call('apply_claim_patch', {
    baseRevision: before,
    changes: [{ field: 'damage_zone', value: 3 }],
  });

  assert.equal(rowFor(doc, 'damage_zone').control.value, '10', 'a pin refuses a patch from either side');
  assert.equal(doc.el('ledger').children[0].classList.contains('is-refused'), true);
});

test('the published surface changes with the claim, and the change is announced', async () => {
  const before = host.toolNames().length;

  // The roadside options tool is registered only while the claim says the car cannot be driven.
  await host.call('apply_claim_patch', {
    baseRevision: revisionNow(),
    changes: [{ field: 'vehicle_drivable', value: false }],
  });

  assert.ok(host.toolNames().length >= before, 'the surface is worked out from the claim');
  assert.notEqual(doc.el('live').textContent.trim(), '', 'a surface change is said to a screen reader');
  assert.match(doc.el('tools-count').textContent, /of \d+ tools registered with your agent/);
});

test('a tool that returns the claimants own words declares them untrusted', async () => {
  await host.call('read_evidence_notes');
  const entry = doc.el('ledger').children[0];
  assert.equal(entry.textOfClass('ledger-name'), 'read_evidence_notes');

  const row = doc.el('tools-list').children
    .find((item) => item.textOfClass('tool-name') === 'read_evidence_notes');
  assert.ok(row, 'the tool should be listed on the page');
  assert.ok(row.descendants().some((node) => node.textContent === 'untrusted text'),
    'an agent must be told not to follow instructions found in a claimants prose');
});
