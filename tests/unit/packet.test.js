/**
 * The handler packet, at the level below the page.
 *
 * WHAT THESE HOLD. A packet describes a filing that happened, under rules that could have filed it.
 * Every refusal below is a case where one of those is not true, and each one is a way the page
 * could otherwise have handed a claims handler a document that looked official and was not.
 *
 * The digest is the other half. Two builds from one filed revision must agree, or nobody can use it
 * to check anything; and any change to the claim, the coverage, the requirements or the provenance
 * must move it, or it is decoration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildFilingPacket,
  canonicalise,
  digestOf,
  packetAsMarkdown,
  PACKET_CODES,
  PACKET_KIND,
} from '../../src/core/packet.js';
import { applyPatch, createClaim, fileClaim, lockField } from '../../src/core/claim.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { checkCoverage } from '../../src/core/coverage.js';

const pack = (name) => loadPolicyPack(JSON.parse(readFileSync(
  new URL(`../../fixtures/insurers/${name}.json`, import.meta.url), 'utf8',
)));

const northwind = pack('northwind');
const kestrel = pack('kestrel');
const fixture = JSON.parse(readFileSync(
  new URL('../../fixtures/demo-collision.json', import.meta.url), 'utf8',
));

const HOME = 'northwind';
const DONE = ['roadside_collection'];

/** The journey the video films, ending in a filed claim. */
function filedClaim() {
  let claim = createClaim(fixture);
  claim = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'location', value: 'Car park on Harbour Road' },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ], { actor: 'agent', baseRevision: 0 }).claim;
  claim = applyPatch(claim, [{ field: 'vehicle_drivable', value: false }], { actor: 'human' }).claim;
  claim = lockField(claim, 'vehicle_drivable').claim;
  const filed = fileClaim(claim, {
    pack: northwind,
    completedHumanActions: DONE,
    homePackId: HOME,
    at: '2026-09-01T09:15:00.000Z',
  });
  assert.equal(filed.ok, true, `the journey must file: ${filed.error}`);
  return filed.claim;
}

function build(claim, overrides = {}) {
  return buildFilingPacket({
    claim,
    pack: northwind,
    homePackId: HOME,
    completedHumanActions: DONE,
    ledger: [
      { at: '09:14:02', tool: 'validate_claim', refused: false, code: null },
      { at: '09:13:41', tool: 'apply_claim_patch', refused: true, code: 'PATCH_REJECTED_LOCKED' },
      { at: '09:12:10', tool: 'read_claim_state', refused: false, code: null },
    ],
    ...overrides,
  });
}

/* ------------------------------------------------------------------ what a handler receives */

test('a filed claim produces a packet that names the filing, the policy and the rules', () => {
  const result = build(filedClaim());

  assert.equal(result.ok, true, result.reason);
  const content = result.packet;
  assert.equal(content.kind, PACKET_KIND);
  assert.equal(content.synthetic, true);
  assert.match(content.notice, /No insurer backend is connected/);
  assert.equal(content.filed.revision, 4);
  assert.equal(content.filed.at, '2026-09-01T09:15:00.000Z');
  assert.match(content.filed.through, /not exposed as a WebMCP tool/);
  assert.equal(content.policy.pack_id, 'northwind');
  assert.equal(content.policy.insurer, 'Northwind Mutual');
  assert.match(content.reference, /^CR-MTR-2026-0417-R4$/);
});

test('it carries the route each answer arrived on, in the page\'s own two words', () => {
  const content = build(filedClaim()).packet;

  assert.equal(content.provenance.damage_zone, 'via tool');
  assert.equal(content.provenance.vehicle_drivable, 'via page');
  assert.deepEqual(content.pinned_by_the_claimant, ['vehicle_drivable']);
});

test('it carries the cover decision, the requirements and the human action', () => {
  const content = build(filedClaim()).packet;

  assert.equal(content.coverage.covered, true);
  assert.equal(content.coverage.clause, 'OD-4.1');
  assert.equal(content.coverage.deductible, 250);

  const roadside = content.requirements.find((entry) => entry.id === 'roadside_collection');
  assert.ok(roadside, 'the collection is in the list');
  assert.equal(roadside.satisfied, true);
  assert.match(roadside.answered_by_person, /presses Request roadside assistance/);
  assert.deepEqual(content.human_actions_completed, DONE);

  assert.equal(content.requirements.every((entry) => entry.satisfied), true, 'nothing was left open');
});

test('the tool calls are oldest first, and a refusal keeps its code', () => {
  const content = build(filedClaim()).packet;

  assert.deepEqual(content.tool_calls.map((call) => call.tool), [
    'read_claim_state', 'apply_claim_patch', 'validate_claim',
  ]);
  const refused = content.tool_calls.find((call) => call.refused);
  assert.equal(refused.code, 'PATCH_REJECTED_LOCKED');
});

/* ---------------------------------------------------------------------------- the digest */

test('two builds from one filed revision produce one digest', async () => {
  const claim = filedClaim();
  const first = build(claim);
  const second = build(claim);

  assert.equal(first.canonical, second.canonical);
  assert.equal(await digestOf(first.canonical), await digestOf(second.canonical));
});

test('changing anything the packet describes changes the digest', async () => {
  const claim = filedClaim();
  const before = await digestOf(build(claim).canonical);

  // A different filed revision is a different filing.
  const later = { ...claim, revision: claim.revision + 1 };
  assert.notEqual(await digestOf(build(later).canonical), before);

  // A different claim decides differently under the same rules, and the packet follows the claim
  // rather than anything a caller says. A theft is not covered by this pack.
  const asTheft = { ...claim, incident_type: 'theft' };
  assert.notEqual(await digestOf(build(asTheft).canonical), before);

  // And a caller cannot inject one: coverage is not an input any more, so passing one changes
  // nothing at all. This is the assertion that would have caught the defect it replaces.
  const injected = build(claim, { coverage: { covered: false, clause: 'XX-9', deductible: 0 } });
  assert.equal(await digestOf(injected.canonical), before);
  assert.equal(injected.packet.coverage.clause, 'OD-4.1');

  // And so is one with a different ledger.
  const otherLedger = build(claim, { ledger: [{ at: '09:00:00', tool: 'describe_claim' }] });
  assert.notEqual(await digestOf(otherLedger.canonical), before);
});

test('the canonical form sorts keys, so insertion order cannot move the digest', () => {
  assert.equal(canonicalise({ b: 1, a: 2 }), canonicalise({ a: 2, b: 1 }));
  assert.match(canonicalise({ b: 1, a: 2 }), /^\{\n {2}"a": 2,\n {2}"b": 1\n\}\n$/);
});

/* --------------------------------------------------------------------------- the refusals */

test('a draft that was never filed gets no packet', () => {
  const draft = applyPatch(createClaim(fixture), [{ field: 'severity', value: 'dent' }], { actor: 'human' }).claim;
  const result = build(draft);

  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_CODES.notFiled);
  assert.equal(result.packet, null);
});

test('no rule pack, no packet', () => {
  const result = build(filedClaim(), { pack: null });

  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_CODES.noPack);
});

test('a half built pack is refused the same way as none at all', () => {
  const result = build(filedClaim(), { pack: { requirements: [] } });

  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_CODES.noPack);
});

test('another insurer\'s rules cannot describe this policy\'s filing', () => {
  const result = build(filedClaim(), { pack: kestrel });

  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_CODES.borrowedRules);
  assert.match(result.reason, /Kestrel Assurance/);
});

test('a claim marked filed that the gate would refuse gets no packet either', () => {
  // The shape a bug elsewhere would produce: status filed, and an intake requirement still open
  // because the human action was never carried out. The packet refuses rather than dressing it up.
  const claim = { ...filedClaim() };
  const result = build(claim, { completedHumanActions: [] });

  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_CODES.unfileable);
  assert.match(result.reason, /FILE_REFUSED_REQUIREMENTS/);
});

/* ------------------------------------------------------------------------ the readable view */

test('the markdown view says what it is, and names the clause and the routes', () => {
  const result = build(filedClaim());
  const view = packetAsMarkdown(result.packet, 'sha256:abc');

  assert.match(view, /# First notice of loss, CR-MTR-2026-0417-R4/);
  assert.match(view, /No insurer backend is connected/);
  assert.match(view, /\*\*Clause:\*\* OD-4\.1/);
  assert.match(view, /via tool/);
  assert.match(view, /via page/);
  assert.match(view, /verify_packet\.mjs/);
});
