/**
 * The packet schema, and the order the verifier asks its two questions in.
 *
 * WHAT WAS WRONG. `scripts/verify_packet.mjs` checked that a `content` object existed and that its
 * kind was ours, then hashed whatever was in it. A digest is a statement about bytes and says
 * nothing about whether those bytes describe a packet, so a document that is not one verified
 * perfectly as long as its digest was computed over itself. That is not hard to arrange, and it is
 * what an editor with a text editor and this repository's own instructions would produce.
 *
 * Measured on the shipped worked example with `filed.at` edited to a wall clock reading and one
 * provenance badge edited to a word this page never writes, then the digest recomputed over the
 * result:
 *
 *   claimed   : sha256:d83cf1ee1987cd1e754ca18d38ef7d834f9f07dc36ce8cbf3d1bcb25fc867f84
 *   recomputed: sha256:d83cf1ee1987cd1e754ca18d38ef7d834f9f07dc36ce8cbf3d1bcb25fc867f84
 *   filed.at  : 09:15
 *   provenance: via carrier pigeon
 *
 * The digest is real and it matches. The document is not a packet. The old script had nothing to
 * say about the second half, and the sentence it printed was about the first.
 *
 * ONE SCHEMA, TWO CALLERS. `checkPacketContent` runs inside `buildFilingPacket` as a post
 * condition before anything is canonicalised, and inside the verifier before anything is hashed. A
 * document this build emits and a document the verifier accepts are the same set, rather than two
 * lists that agree today.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFilingPacket,
  checkPacketContent,
  FILED_THROUGH,
  PACKET_ROUTES,
} from '../../src/core/packet.js';
import { applyPatch, createClaim, fileClaim, lockField, PROVENANCE_SOURCES } from '../../src/core/claim.js';
import { loadPolicyPack } from '../../src/core/policy.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLE = path.join(ROOT, 'docs', 'handler-packet.example.json');
const VERIFIER = path.join('scripts', 'verify_packet.mjs');

const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));

const northwind = loadPolicyPack(JSON.parse(readFileSync(
  path.join(ROOT, 'fixtures', 'insurers', 'northwind.json'), 'utf8',
)));
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'demo-collision.json'), 'utf8'));

/* -------------------------------------------------------------- the shipped example is a packet */

test('the worked example a judge is invited to check passes the schema', () => {
  // If this fails, the schema and the document a reader is told to verify have come apart, and the
  // document is the one that is published.
  const verdict = checkPacketContent(example().content);
  assert.equal(verdict.ok, true, verdict.problems.join(' '));
});

test('the ordinary filed journey passes its own post condition', () => {
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
    at: '2026-09-01T09:15:00.000Z',
    pack: northwind,
    completedHumanActions: ['roadside_collection'],
    homePackId: 'northwind',
  });
  assert.equal(filed.ok, true, filed.error);

  const built = buildFilingPacket({
    claim: filed.claim,
    pack: northwind,
    homePackId: 'northwind',
    completedHumanActions: ['roadside_collection'],
    ledger: [],
  });
  assert.equal(built.ok, true, built.reason);
  assert.equal(checkPacketContent(built.packet).ok, true);
});

/* -------------------------------------------------------------------- one break at a time */

/**
 * Every edit here is a single value, applied to the shipped example, and every one used to sail
 * through the verifier with a matching digest. The `expect` is a fragment of the sentence the
 * schema writes, so a rule that stops firing fails here rather than going quiet.
 */
const BREAKS = [
  ['a kind from another document', (c) => { c.kind = 'something.else'; }, /kind is/],
  ['a version this build does not read', (c) => { c.version = 3; }, /version is/],
  ['a packet claiming it is not synthetic', (c) => { c.synthetic = false; }, /claiming a real filing/],
  ['a rewritten synthetic notice', (c) => { c.notice = 'All good, nothing to see.'; }, /notice is not/],
  ['no reference at all', (c) => { c.reference = '   '; }, /reference is/],
  ['a wall clock filing time', (c) => { c.filed.at = '09:15'; }, /full UTC instant/],
  ['a filing time with no zone', (c) => { c.filed.at = '2026-09-01T09:15:00'; }, /full UTC instant/],
  ['a revision that is not a number', (c) => { c.filed.revision = '4'; }, /filed\.revision is/],
  ['a negative revision', (c) => { c.filed.revision = -1; }, /filed\.revision is/],
  ['a filing route this page does not have', (c) => { c.filed.through = 'the insurer API'; }, /filing route this page does not have/],
  ['no policy number', (c) => { c.policy.number = null; }, /policy\.number is/],
  ['no insurer', (c) => { c.policy.insurer = ''; }, /policy\.insurer is/],
  ['no rule pack named', (c) => { c.policy.pack_id = null; }, /policy\.pack_id is/],
  ['a pack written to another convention', (c) => { c.policy.pack_contract = 'claim-intake.v9'; }, /pack_contract is/],
  ['a period date that is not a date', (c) => { c.policy.pack_period.start = 'January'; }, /pack_period\.start is/],
  ['a field this claim does not have', (c) => { c.claim.favourite_colour = { label: 'x', value: 'blue' }; }, /not a field on this claim/],
  ['an object where an answer belongs', (c) => { c.claim.severity.value = { deep: true }; }, /claim\.severity\.value is/],
  ['a route nobody defined', (c) => { c.provenance.severity = 'via carrier pigeon'; }, /A route nobody defined/],
  ['a route over an answer that is not there', (c) => { c.provenance.witness_name = 'via page'; }, /carries no such answer/],
  ['a pin on a field that does not exist', (c) => { c.pinned_by_the_claimant = ['favourite_colour']; }, /pinned_by_the_claimant names/],
  ['pins out of order', (c) => { c.pinned_by_the_claimant = ['vehicle_drivable', 'severity']; }, /not in order/],
  ['the same pin twice', (c) => { c.pinned_by_the_claimant = ['vehicle_drivable', 'vehicle_drivable']; }, /the same thing twice/],
  ['a cover decision that is neither yes nor no', (c) => { c.coverage.covered = 'maybe'; }, /coverage\.covered is/],
  ['an unsettled yes that says nothing', (c) => { c.coverage.provisional = true; }, /does not say what it is waiting on/],
  ['a qualifier on a settled decision', (c) => { c.coverage.provisional_reason = 'something'; }, /on a decision that is/],
  ['an excess that is not a number', (c) => { c.coverage.deductible = '250'; }, /coverage\.deductible is/],
  ['a negative excess', (c) => { c.coverage.deductible = -1; }, /coverage\.deductible is/],
  ['a currency that is not a code', (c) => { c.coverage.currency = 'euros'; }, /three letter code/],
  ['an amount with no currency', (c) => { c.coverage.currency = null; }, /names no currency/],
  ['an exclusion that is a bare string', (c) => { c.coverage.exclusions = ['EX-9.1']; }, /coverage\.exclusions\[0\] is/],
  ['a yes with an exclusion under it', (c) => {
    c.coverage.exclusions = [{ code: 'excluded_driver', clause: 'EX-9.1', reason: 'A named driver.' }];
  }, /lists an exclusion that fired/],
  ['no recomputed_from sentence', (c) => { c.coverage.recomputed_from = null; }, /recomputed_from is/],
  ['a requirement with no id', (c) => { c.requirements[0].id = null; }, /requirements\[0\]\.id is/],
  ['a requirement answered by nothing on this claim', (c) => { c.requirements[0].answered_by_field = 'favourite_colour'; }, /answered_by_field is/],
  ['a requirement that is neither answered nor open', (c) => { c.requirements[0].satisfied = 'yes'; }, /satisfied is/],
  ['a completed action this packet knows nothing about', (c) => { c.human_actions_completed = ['send_a_courier']; }, /human_actions_completed names/],
  ['a ledger entry that is not an entry', (c) => { c.tool_calls[0] = 'read_claim_state'; }, /tool_calls\[0\] is/],
  ['a ledger entry that will not say whether it was refused', (c) => { delete c.tool_calls[0].refused; }, /tool_calls\[0\]\.refused is/],
  ['a whole block missing', (c) => { delete c.requirements; }, /requirements is missing/],
  ['a block that is the wrong kind of thing', (c) => { c.provenance = []; }, /provenance is a list/],
];

test('every one of these used to verify, and every one is refused now', () => {
  // The control first. A table of breaks against a document that was already broken proves nothing.
  assert.equal(checkPacketContent(example().content).ok, true, 'the unbroken example has to pass');

  for (const [what, breakIt, expected] of BREAKS) {
    const content = example().content;
    breakIt(content);
    const verdict = checkPacketContent(content);
    assert.equal(verdict.ok, false, `${what} was accepted`);
    assert.ok(verdict.problems.some((problem) => expected.test(problem)),
      `${what} was refused for the wrong reason: ${verdict.problems.join(' ')}`);
  }
});

test('the verdict names every problem, not only the first', () => {
  // A reader fixing one at a time against a check that stopped early walks the list one pass per
  // problem. This is the same promise checkClaimSnapshot makes, kept by the same shape.
  const content = example().content;
  content.filed.at = '09:15';
  content.policy.insurer = '';
  content.provenance.severity = 'via carrier pigeon';

  const verdict = checkPacketContent(content);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.problems.length, 3, verdict.problems.join(' '));
});

test('anything that is not an object at all is refused without throwing', () => {
  for (const value of [null, undefined, 'a packet', 42, []]) {
    const verdict = checkPacketContent(value);
    assert.equal(verdict.ok, false, `${JSON.stringify(value)} was read as a packet`);
    assert.equal(verdict.problems.length, 1);
  }
});

/* ---------------------------------------------------- the vocabularies come from one place each */

test('every provenance source this page can write has a route badge of its own', () => {
  // The badge table in src/core/packet.js used to have a fall through that returned any string it
  // was handed, so it could never be out of step with claim.js and could never be right either. It
  // is a closed table now, which means a source added over there with nothing done here would lose
  // its badge in silence. One badge per source, and no badge answering for two.
  assert.equal(PACKET_ROUTES.length, new Set(PROVENANCE_SOURCES).size,
    `src/core/claim.js writes ${new Set(PROVENANCE_SOURCES).size} provenance sources and `
    + `src/core/packet.js has ${PACKET_ROUTES.length} route badges. Add the badge, or say here why `
    + 'two sources share one.');

  // And the schema knows exactly that set, so a badge added here without the schema being told
  // would be refused by the build it came out of.
  for (const route of PACKET_ROUTES) {
    const content = example().content;
    content.provenance.severity = route;
    assert.equal(checkPacketContent(content).ok, true, `the schema refuses its own badge ${route}`);
  }
});

test('the sentence filed.through carries is the one constant, not a copy of it', () => {
  assert.equal(example().content.filed.through, FILED_THROUGH);
});

/* ------------------------------------------------------------- the verifier, as a judge runs it */

function runVerifier(json) {
  const dir = mkdtempSync(path.join(tmpdir(), 'claimready-schema-'));
  try {
    const file = path.join(dir, 'packet.json');
    writeFileSync(file, JSON.stringify(json, null, 2), 'utf8');
    return spawnSync(process.execPath, [VERIFIER, file], { cwd: ROOT, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the verifier checks the shape before the digest, and says which one failed', () => {
  // A packet whose digest is CORRECT and whose shape is wrong. This is the case the old script got
  // wrong, and it got it wrong in the direction that reassures a reader.
  const packet = example();
  packet.content.provenance.severity = 'via carrier pigeon';

  const run = runVerifier(packet);
  assert.equal(run.status, 2, `expected exit 2, got ${run.status}\n${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /not a packet this build describes/);
  assert.match(run.stderr, /A route nobody defined/);
  assert.doesNotMatch(run.stdout, /The digest matches/,
    'the digest was reported on a document that is not a packet');
});

test('a well shaped packet with a digest that does not match still exits 1', () => {
  // The schema is an addition, not a replacement. The digest question still gets asked and still
  // gets the old answer, so the two failures stay tellable apart.
  const packet = example();
  packet.content.coverage.deductible = 350;

  const run = runVerifier(packet);
  assert.equal(run.status, 1, `expected exit 1, got ${run.status}\n${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /recomputed:/);
  assert.match(run.stderr, /does not match the content/);
});

test('the shipped example still exits 0, and the success line claims no more than a hash can', () => {
  const run = spawnSync(process.execPath, [VERIFIER, EXAMPLE], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /this content is the content that digest was computed over/);
  // The old line said the packet "is the one the page built from that filed revision", which is a
  // claim about origin, and a bare SHA-256 cannot support one.
  assert.doesNotMatch(run.stdout, /is the one the page built/);
  assert.match(run.stdout, /no key and no signature/);
});

/* ------------------------------------------- the completed actions are scoped to this filing */

test('a completed action for a requirement this filing does not have is left out', () => {
  // THE REACHABLE PATH. The page remembers every button a person pressed and never forgets one,
  // which is right for the page: pressing Request roadside assistance happened. It is wrong for
  // this document. Answer that the car drives again, unpin the row, and file, and no collection
  // requirement is derived. A packet listing `roadside_collection` under human actions would be
  // telling a handler about a step for a requirement the same packet does not carry three lines up.
  //
  // This is a content change on a path a visitor can walk, so it gets a test of its own rather than
  // a comment. The value is dropped, and the requirement it belonged to is genuinely absent.
  let claim = createClaim(fixture);
  claim = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'location', value: 'Car park on Harbour Road' },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ], { actor: 'human', baseRevision: 0 }).claim;

  const filed = fileClaim(claim, {
    at: '2026-09-01T09:15:00.000Z',
    pack: northwind,
    // The stale id, exactly as the page would still be carrying it.
    completedHumanActions: ['roadside_collection'],
    homePackId: 'northwind',
  });
  assert.equal(filed.ok, true, filed.error);

  const built = buildFilingPacket({
    claim: filed.claim,
    pack: northwind,
    homePackId: 'northwind',
    completedHumanActions: ['roadside_collection'],
    ledger: [],
  });

  assert.equal(built.ok, true, built.reason);
  assert.equal(
    built.packet.requirements.some((entry) => entry.id === 'roadside_collection'),
    false,
    'the setup has to file a claim with no collection requirement, or this proves nothing',
  );
  assert.deepEqual(built.packet.human_actions_completed, [],
    'the packet lists an action for a requirement it does not carry');
});

test('a completed action for a requirement this filing does have is kept', () => {
  // The other half. Scoping that dropped everything would be a quieter defect than the one it
  // replaces, so the ordinary journey is asserted beside it.
  let claim = createClaim(fixture);
  claim = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: false },
    { field: 'location', value: 'Car park on Harbour Road' },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ], { actor: 'human', baseRevision: 0 }).claim;

  const filed = fileClaim(claim, {
    at: '2026-09-01T09:15:00.000Z',
    pack: northwind,
    completedHumanActions: ['roadside_collection'],
    homePackId: 'northwind',
  });
  assert.equal(filed.ok, true, filed.error);

  const built = buildFilingPacket({
    claim: filed.claim,
    pack: northwind,
    homePackId: 'northwind',
    completedHumanActions: ['roadside_collection'],
    ledger: [],
  });

  assert.equal(built.ok, true, built.reason);
  assert.deepEqual(built.packet.human_actions_completed, ['roadside_collection']);
});
