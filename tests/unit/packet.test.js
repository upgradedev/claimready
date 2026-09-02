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
import { FILE_CODES } from '../../src/core/filing.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { checkCoverage, openCoverQuestions } from '../../src/core/coverage.js';

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

/**
 * The journey the video films, ending in a filed claim.
 *
 * `extra` is applied to the draft, through the real patch path, immediately before it is filed.
 * A test that wants a different filed claim asks for it here rather than writing to the filed
 * snapshot afterwards: a claim built by hand is not one this page could have produced, and
 * src/core/packet.js now refuses to seal one.
 *
 * @param {Array<{field: string, value: *}>} [extra]
 */
function filedClaim(extra = []) {
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
  if (extra.length > 0) {
    const patched = applyPatch(claim, extra, { actor: 'human' });
    assert.equal(patched.ok, true, `the extra changes must apply: ${patched.error}`);
    claim = patched.claim;
  }
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

/* ------------------------------------------------------- the yes that is not settled yet */

/**
 * A filed claim whose cover decision is a yes that still depends on a name nobody has given.
 *
 * The sample claim names Maria K. as the driver and Northwind excludes one named driver, so
 * emptying that field is what puts the decision back into the state the panel draws as "Covered,
 * provisionally". Everything else stays as the filmed journey leaves it.
 */
function provisionallyFiled() {
  // Cleared on the draft rather than on the filed snapshot. Clearing a field through a patch also
  // drops the badge saying who answered it, and a badge left standing over an empty field is a
  // claim with nothing behind it, which is one of the states the snapshot check refuses.
  const claim = filedClaim([{ field: 'driver', value: null }]);
  const decided = checkCoverage(northwind, claim);
  assert.equal(decided.covered, true, 'the setup has to produce a yes, or there is nothing to qualify');
  assert.equal(decided.provisional, true, 'and a yes that is not settled');
  return claim;
}

test('a provisional yes reaches the packet as a provisional yes', () => {
  // WHAT WAS WRONG. The panel drew "Covered, provisionally", check_coverage answered
  // "COVERED, PROVISIONALLY", and this block wrote a plain covered and hashed it. The sealed
  // document a handler receives was the only surface stating a settled answer.
  const content = build(provisionallyFiled()).packet;

  assert.equal(content.coverage.covered, true);
  assert.equal(content.coverage.provisional, true);
  assert.match(content.coverage.provisional_reason, /Nobody is named as the driver yet/);
  assert.match(content.coverage.provisional_reason, /excludes 1 named driver under clause EX-9\.1/);
});

test('an ordinary named driver claim is still a plain yes, with nothing hanging over it', () => {
  // The other half. A qualifier that appears on every claim says nothing about any of them.
  const content = build(filedClaim()).packet;

  assert.equal(content.coverage.covered, true);
  assert.equal(content.coverage.provisional, false);
  assert.equal(content.coverage.provisional_reason, null);
});

test('the open question in the packet is the one src/core/coverage.js states', () => {
  // Not a second phrasing of the same idea. openCoverQuestions is where the sentence is written,
  // checkCoverage builds its reason from it, and the packet quotes it, so a change to the wording
  // cannot move one surface and leave the other behind.
  const claim = provisionallyFiled();
  const content = build(claim).packet;

  assert.equal(content.coverage.provisional_reason, openCoverQuestions(northwind, claim).join(' '));
  assert.ok(checkCoverage(northwind, claim).reason.includes(content.coverage.provisional_reason),
    'the claimant prose and the handler field say different things');
});

/**
 * The same agreement, on a decision that is a NO.
 *
 * The test above pins the wording of a provisional yes. This one pins a refusal, because that is
 * where the sentence a judge can read went wrong: an incident outside the policy period was refused
 * and the same string went on to tell the claimant that third party liability under clause TP-1.1
 * stayed in force. The pack does not say that. A refusal about the whole policy is not a statement
 * about one section of it.
 *
 * Measured before the fix, from the packet this test builds:
 *
 *   The incident date 2025-11-04 falls outside the policy period, which runs from 2026-01-01 to
 *   2026-12-31. That is clause PL-1.2. Third party liability under clause TP-1.1 is unaffected and
 *   stays in force.
 *
 * The negative assertion is the regression. The equality beside it is what stops a fix landing on
 * the packet and leaving the page saying something else, since both read decision.reason.
 */
test('a refusal reaches the packet word for word, and promises no cover it cannot show', () => {
  const claim = filedClaim([{ field: 'incident_date', value: '2025-11-04' }]);
  const decided = checkCoverage(northwind, claim);
  assert.equal(decided.covered, false, 'the setup has to produce a refusal, or there is nothing to check');

  const content = build(claim).packet;

  assert.equal(content.coverage.reason, decided.reason,
    'the sealed document and the page are reading one sentence, so they cannot disagree');
  assert.match(content.coverage.reason, /falls outside the policy period/);
  assert.doesNotMatch(content.coverage.reason, /TP-1\.1/,
    'the packet names a section as standing on a refusal the schedule scopes to the whole policy');
  assert.doesNotMatch(content.coverage.reason, /stays in force/i);
});

test('the markdown view draws the qualifier the JSON carries', () => {
  const provisional = packetAsMarkdown(build(provisionallyFiled()).packet, 'sha256:abc');
  const plain = packetAsMarkdown(build(filedClaim()).packet, 'sha256:abc');

  assert.match(provisional, /\*\*Decision:\*\* covered, provisionally/);
  assert.match(provisional, /\*\*Still open:\*\* Nobody is named as the driver yet/);

  assert.match(plain, /\*\*Decision:\*\* covered\n/);
  assert.doesNotMatch(plain, /provisionally/);
  assert.doesNotMatch(plain, /Still open/);
});

test('the qualifier is inside the digest, so it cannot be edited out quietly', async () => {
  // A field beside the decision is only worth anything if changing it changes the hash. It is in
  // `content`, which is the hashed half, and this is the assertion that says so.
  const claim = provisionallyFiled();
  const sealed = build(claim);
  const flattened = JSON.parse(sealed.canonical);
  flattened.coverage.provisional = false;
  flattened.coverage.provisional_reason = null;

  assert.notEqual(
    await digestOf(canonicalise(flattened)),
    await digestOf(sealed.canonical),
    'the qualifier could be removed without moving the digest',
  );
});

/* ---------------------------------------------------------------------------- the digest */

test('two builds from one filed revision produce one digest', async () => {
  const claim = filedClaim();
  const first = build(claim);
  const second = build(claim);

  assert.equal(first.canonical, second.canonical);
  assert.equal(await digestOf(first.canonical), await digestOf(second.canonical));
});

/**
 * The digest of a built packet, refusing to hash a refusal.
 *
 * WHY THIS EXISTS RATHER THAN `digestOf(build(x).canonical)`. A refusal returns `canonical: null`,
 * `digestOf` hashes the four characters of the string "null" quite happily, and every notEqual in
 * the test below then passes for the wrong reason. Two of those variants used to be built by
 * spreading a filed claim, which stopped producing a packet the moment the filing receipt landed,
 * and the test went on printing ok. So the assertion is made here, once, where it cannot be
 * forgotten at a call site.
 */
async function digestOfPacket(result) {
  assert.equal(result.ok, true, `there is no packet to hash: ${result.reason}`);
  return digestOf(result.canonical);
}

test('changing anything the packet describes changes the digest', async () => {
  const claim = filedClaim();
  const before = await digestOfPacket(build(claim));

  // A different filed revision is a different filing. It is produced by filing a draft that has
  // moved one more time, not by writing a number onto a filed claim: a claim assembled by hand is
  // not one this page filed, and src/core/packet.js refuses to describe one as a filing.
  const later = filedClaim([{ field: 'witness_name', value: 'A. Bystander' }]);
  assert.equal(later.revision, claim.revision + 1, 'the setup has to produce a later revision');
  assert.notEqual(await digestOfPacket(build(later)), before);

  // A different claim decides differently under the same rules, and the packet follows the claim
  // rather than anything a caller says. A loss outside the policy period is not covered.
  const outsidePeriod = filedClaim([{ field: 'incident_date', value: '2025-11-04' }]);
  assert.equal(build(outsidePeriod).packet.coverage.covered, false, 'the setup has to change the cover');
  assert.notEqual(await digestOfPacket(build(outsidePeriod)), before);

  // And a caller cannot inject one: coverage is not an input any more, so passing one changes
  // nothing at all. This is the assertion that would have caught the defect it replaces.
  const injected = build(claim, { coverage: { covered: false, clause: 'XX-9', deductible: 0 } });
  assert.equal(await digestOfPacket(injected), before);
  assert.equal(injected.packet.coverage.clause, 'OD-4.1');

  // And so is one with a different ledger.
  const otherLedger = build(claim, { ledger: [{ at: '09:00:00', tool: 'describe_claim' }] });
  assert.notEqual(await digestOfPacket(otherLedger), before);
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

/**
 * The two identity facts the packet used to assert without having them.
 *
 * A packet says this claim went to this insurer on this policy. Both halves were unchecked. A
 * filed claim carrying no policy number produced a document referenced `CR-UNKNOWN-R4` with a null
 * policy number under it, and a build that named no home pack sealed the claim under whichever
 * insurer's rules were handed in. Both were digested, which made the gap look deliberate.
 */
test('a filed claim that names no policy gets no packet, whatever the value looks like', () => {
  for (const value of [undefined, null, '', '   ']) {
    const result = build({ ...filedClaim(), policy_id: value, reference: null });

    assert.equal(result.ok, false, `policy_id ${JSON.stringify(value)} was sealed anyway`);
    assert.equal(result.code, PACKET_CODES.noPolicyId);
    assert.equal(result.packet, null);
    assert.equal(result.canonical, null, 'there is nothing to hash, so nothing is offered to hash');
    assert.match(result.reason, /A packet is a statement about one policy/);
  }
});

test('the reference no longer papers over a missing policy number', () => {
  // The exact string that used to go out. It cannot be produced any more, because the build that
  // would have produced it is refused before the reference is composed.
  const result = build({ ...filedClaim(), policy_id: null, reference: null });

  assert.equal(result.ok, false);
  assert.equal(result.packet, null);
  assert.doesNotMatch(result.reason, /^CR-UNKNOWN/);
});

test('a packet is not built for a filing nobody has placed with an insurer', () => {
  for (const homePackId of [undefined, null, '', '   ']) {
    const result = build(filedClaim(), { homePackId });

    assert.equal(result.ok, false, `homePackId ${JSON.stringify(homePackId)} was sealed anyway`);
    assert.equal(result.code, PACKET_CODES.noHomeInsurer);
    assert.equal(result.packet, null);
    assert.match(result.reason, /put our name on a guess/);
  }
});

test('the packet asks the identity questions in the order the file gate asks them', () => {
  // One claim failing every check at once. A reader chasing the first answer must be sent to the
  // same place the file panel would send them, or the two are describing different problems.
  const broken = { ...filedClaim(), policy_id: null };

  assert.equal(build(broken, { pack: null, homePackId: null }).code, PACKET_CODES.noPack);
  assert.equal(build(broken, { homePackId: null }).code, PACKET_CODES.noPolicyId);
  assert.equal(build(filedClaim(), { homePackId: null }).code, PACKET_CODES.noHomeInsurer);
  assert.equal(build(filedClaim(), { pack: kestrel }).code, PACKET_CODES.borrowedRules);
});

test('every identity refusal the file gate can raise has a packet code of its own', () => {
  // A new FILE_REFUSED identity code added to src/core/filing.js with nothing done here would
  // throw on the lookup rather than fall through to a packet. This is the check that says the two
  // vocabularies are still the same size.
  for (const code of [
    FILE_CODES.noPack, FILE_CODES.noPolicyId, FILE_CODES.noHomeInsurer, FILE_CODES.borrowedRules,
  ]) {
    const matched = Object.values(PACKET_CODES).some((value) => value.endsWith(code.replace('FILE_REFUSED_', '')));
    assert.ok(matched, `${code} has no packet code beside it`);
  }
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
