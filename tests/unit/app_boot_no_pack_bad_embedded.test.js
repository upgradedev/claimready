/**
 * src/ui/app.js booted with every insurer rule pack refused AND a sample file whose own policy
 * block is not a schedule anything checked.
 *
 * ITS OWN FILE, for the reason given in tests/support/boot_app.mjs: one plain import per process,
 * so app.js stays a single row in the coverage table.
 *
 * WHAT IT PROTECTS, AND IT IS THE HALF tests/unit/app_boot_no_pack.test.js LEAVES OPEN. That file
 * boots with the packs refused and the shipped sample file intact, so the block the page fell back
 * to happened to be sane. The fallback itself was the defect: with no pack loaded the page set
 * context.policy to the sample file's own policy block and both the cover button and the real
 * check_coverage tool answered from it. src/core/policy.js had never seen that block. Nothing had
 * checked the clause ids, the excess amounts, the incident types or the period, so whatever the
 * sample file happened to say was read out as this customer's cover.
 *
 * So the schedule served here is deliberately one the strict loader refuses: theft is written as
 * active with an excess of 9999 where the shipped policy carries no theft cover at all, the clause
 * ids are invented, and the period runs backwards. If any of that reaches a reader, the page is
 * telling a claimant they are covered on the strength of data it never validated.
 *
 * The bar is the same one the rest of this repository keeps: no schedule is an unknown with a
 * reason, never a yes and never a no.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { fireEvent } from '../support/dom_double.mjs';
import { textOfResult } from '../../src/webmcp/register.js';
import { bootApp, rowFor, createFakeAgentHost } from '../support/boot_app.mjs';

const shipped = JSON.parse(readFileSync(new URL('../../fixtures/demo-collision.json', import.meta.url), 'utf8'));

/**
 * The sample file, with a policy block no loader would accept.
 *
 * Everything a persona is drawn from is kept, because that is the one thing embedded data is still
 * allowed to supply. Only the schedule is poisoned, so a failure here can only be about cover.
 */
const poisoned = {
  ...shipped,
  policy: {
    ...shipped.policy,
    period: { start: '2026-12-31', end: '2026-01-01', clause: 'NOT-A-CLAUSE' },
    coverages: [
      {
        code: 'own_damage',
        label: 'Own damage',
        clause: 'INVENTED-1',
        active: 'yes',
        deductible: -250,
        incident_types: ['collision', 'not_an_incident_type'],
      },
      {
        code: 'theft',
        label: 'Theft',
        clause: 'INVENTED-2',
        active: true,
        deductible: 9999,
        incident_types: ['theft'],
      },
    ],
  },
};

const host = createFakeAgentHost();
const { doc } = await bootApp({ fail: /insurers\//, bodies: { 'demo-collision.json': poisoned } }, host);

/** Answer the draft the way a claimant would, so nothing below is refused for an empty field. */
function fillTheDraft() {
  for (const [field, value] of Object.entries({
    incident_type: 'collision',
    damage_zone: '10',
    severity: 'dent',
    vehicle_drivable: 'true',
    description: 'A car came out of a side road and hit the left front wing.',
  })) {
    const found = rowFor(doc, field);
    found.control.value = value;
    fireEvent(found.control, 'change');
  }
}

test('the persona still comes from the sample file, because that is a display fact', () => {
  // Embedded data is not banned. It is demoted. A name, a policy number and a currency are things
  // the page prints; they decide nothing about cover.
  assert.match(doc.el('persona-name').textContent, /^Signed in as /);
  assert.ok(doc.el('fields').children.length > 0);
});

test('the cover panel refuses, and never prints a decision from the unvalidated schedule', () => {
  fillTheDraft();
  fireEvent(doc.el('check-coverage-btn'), 'click');

  const body = doc.el('coverage-body').textContent;
  assert.notEqual(body.trim(), '', 'a blank panel tells a claimant nothing');
  assert.doesNotMatch(body, /COVERED|Covered|covered,/, 'an unvalidated schedule decided the cover');
  assert.doesNotMatch(body, /Not covered/, 'no schedule is an unknown, never a no');
  assert.doesNotMatch(body, /9999|-250|INVENTED-/, 'an unchecked excess or clause reached the panel');
});

test('check_coverage answers with the no valid schedule refusal, not with a verdict', async () => {
  // THE TOOL, NOT THE BUTTON. The button is guarded while the packs are in flight and the tool is
  // not, so the tool is the surface that could still answer from the embedded block after boot.
  const said = textOfResult(await host.call('check_coverage'));

  assert.doesNotMatch(said, /Cover decision under/, 'the tool decided cover from data nothing validated');
  assert.doesNotMatch(said, /\bCOVERED\b|\bNOT COVERED\b/, 'a verdict was reported without a schedule');
  assert.doesNotMatch(said, /Deductible/, 'an unchecked excess was reported to an agent');
  assert.doesNotMatch(said, /9999|-250|INVENTED-/, 'unchecked pack text reached an agent');
  assert.match(said, /did not load|cannot be checked/, 'the refusal has to say what is actually wrong');
});

test('filing stays refused and no packet is built', () => {
  assert.equal(doc.el('file-btn').disabled, true);
  assert.match(doc.el('file-reason').textContent, /^The insurer rule pack did not load/);

  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(doc.el('file-result').textContent, '', 'nothing was filed');
  assert.equal(doc.el('packet-reference').textContent, '', 'a packet was sealed against no validated pack');
});
