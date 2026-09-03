/**
 * The packet describes ONE filing, as it happened, and every row it seals is a row it can read.
 *
 * TWO DEFECTS, BOTH MEASURED ON THIS TREE BEFORE ANY OF THIS WAS WRITTEN, BOTH UNDER A DIGEST.
 *
 * THE FIRST. The packet reported a filing revision that was not the one that was filed. A filed
 * claim goes on moving its counter: `noteContextChange` hands back a copy with the number advanced
 * and the filing receipt carried across, which is deliberate, because loading another insurer's
 * rules changes what every read tool answers. The receipt held the filing revision the whole time
 * and `buildFilingPacket` had no way to ask for it, so it read `claim.revision` off the claim in
 * front of it. Filing at revision 4 and then dispatching two context changes:
 *
 *   FILED at revision: 4
 *     control packet ok = true | reference CR-MTR-2026-0417-R4
 *     context change 1 ok= true  -> revision 5
 *     context change 2 ok= true  -> revision 6
 *   packet ok = true code = null
 *     reference : CR-MTR-2026-0417-R6
 *     filed     : {"at":"2026-09-01T09:15:00.000Z","revision":6, ...}
 *     >>> filing happened at revision 4 <<<
 *
 * A file under a SHA-256 digest said, in the block whose only job is to say when the filing
 * happened, that it happened at a revision it did not happen at.
 *
 * THE SECOND. A forged ledger row sealed and a malformed one vanished:
 *
 *   forged row ok = true code = null
 *     sealed tool_calls: [{"at":"not-a-time","tool":"check_coverage","refused":false,"code":null}]
 *   non-object row ok = true code = null | handed in 2, sealed 1
 *
 * So a caller could put a successful call to a real tool into a sealed file with a timestamp that
 * is not a time, and a null row went out of the packet without a word, which is the thing the
 * refusal beside it already called out in its own sentence: a shorter ledger than the one handed in
 * is a record a handler cannot tell has lost anything.
 *
 * WHAT THE TESTS BELOW ARE FOR, AND THE ONE THAT MATTERS MOST IS THE STRUCTURAL ONE. Naming the two
 * fields that carried a revision would have closed today's defect and nothing else. So the walk
 * below finds every field of the built packet that carries a revision or a reference, whatever it
 * is called and wherever it sits, and holds each one to the filing. A field added to the packet
 * later is covered by it on the commit that adds it, without anybody remembering this file exists.
 *
 * AND THE LAST TEST BOOTS THE REAL PAGE, because the ledger rows the page writes are not the rows
 * the fixtures here write. src/ui/app.js writes { at, name, args, text, error, refusals } with a
 * local wall clock reading in `at`, and a check that demanded a full UTC instant would have refused
 * every row this page has ever written and taken the packet panel down with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyPatch,
  createClaim,
  fileClaim,
  filedRevisionOf,
  lockField,
  noteContextChange,
  verifyFilingContext,
} from '../../src/core/claim.js';
import { buildFilingPacket, PACKET_CODES } from '../../src/core/packet.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { bootApp, rowFor, createFakeAgentHost } from '../support/boot_app.mjs';
import { fireEvent } from '../support/dom_double.mjs';

const northwind = loadPolicyPack(JSON.parse(readFileSync(
  new URL('../../fixtures/insurers/northwind.json', import.meta.url), 'utf8',
)));
const fixture = JSON.parse(readFileSync(
  new URL('../../fixtures/demo-collision.json', import.meta.url), 'utf8',
));

const AT = '2026-09-01T09:15:00.000Z';
const HOME = 'northwind';
const DONE = ['roadside_collection'];

/** The filmed journey, up to the moment before it is filed. */
function settledDraft() {
  let claim = createClaim(fixture);
  claim = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'location', value: 'Car park on Harbour Road' },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ], { actor: 'agent', baseRevision: 0 }).claim;
  claim = applyPatch(claim, [{ field: 'vehicle_drivable', value: false }], { actor: 'human' }).claim;
  return lockField(claim, 'vehicle_drivable').claim;
}

function build(claim, ledger = []) {
  return buildFilingPacket({
    claim, pack: northwind, homePackId: HOME, completedHumanActions: DONE, ledger,
  });
}

/**
 * File, then move the counter on by `steps` context changes, the way the page does.
 *
 * The number of steps is the caller's and is nothing the packet reads. There is no paging window
 * and no retention count anywhere near this code to build a fixture out of, and the defect was
 * never about a particular distance: it was that the packet read the counter beside it instead of
 * the filing. So the tests below run it at two different distances and the assertions are written
 * against the number `fileClaim` handed back, which no part of the packet is involved in producing.
 */
function filedThenMovedOn(steps) {
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  assert.equal(filed.ok, true, filed.error);

  let claim = filed.claim;
  for (let step = 0; step < steps; step += 1) {
    const noted = noteContextChange(claim, 'the insurer published a new rule pack');
    assert.equal(noted.ok, true, noted.error);
    claim = noted.claim;
  }

  assert.equal(claim.revision, filed.revision + steps, 'the counter has to have moved for this to mean anything');
  return { claim, filedRevision: filed.revision, liveRevision: claim.revision };
}

/* ------------------------------------------------------- 1. the revision that was filed */

test('the packet reads the revision the filing landed on, not the counter beside it', () => {
  // TWO DISTANCES, because one would be satisfied by a packet that happened to be off by that much,
  // and because the whole defect is that the two numbers were ever allowed to be the same thing.
  for (const steps of [3, 7]) {
    const moved = filedThenMovedOn(steps);
    const where = `after ${steps} context changes`;

    // The claim in hand really is a later one, and the receipt really does still accept it. If this
    // stops being true the packet is being built from something else and the test below proves
    // nothing.
    assert.notEqual(moved.liveRevision, moved.filedRevision, `${where}: the counter did not move`);
    assert.equal(filedRevisionOf(moved.claim), moved.filedRevision, `${where}: the receipt moved`);

    const result = build(moved.claim);
    assert.equal(result.ok, true, `${where}: ${result.reason}`);

    assert.equal(result.packet.filed.revision, moved.filedRevision,
      `${where}: filed.revision is the live counter and not the filing`);
    assert.equal(result.packet.reference.endsWith(`-R${moved.filedRevision}`), true,
      `${where}: the reference reads ${result.packet.reference}`);
    assert.equal(result.packet.reference.includes(`-R${moved.liveRevision}`), false,
      `${where}: the reference carries the live counter ${moved.liveRevision}`);
  }
});

test('one filing is one packet, however long afterwards it is built', () => {
  // THE INVARIANT UNDERNEATH THE ONE ABOVE, and the reason the fix could not be to correct the
  // reference string alone. src/core/packet.js keeps `generated_at` outside the hashed content so
  // that a packet built twice from one filed snapshot produces one digest. A revision read off the
  // live claim broke that quietly: the same filing exported before and after a rule pack switch
  // gave two different documents and two different digests, and nothing said which was the filing.
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  assert.equal(filed.ok, true, filed.error);

  const atFiling = build(filed.claim);
  const noted = noteContextChange(filed.claim, 'a human action closed a requirement on this page');
  assert.equal(noted.ok, true, noted.error);
  const afterwards = build(noted.claim);

  assert.equal(atFiling.ok, true, atFiling.reason);
  assert.equal(afterwards.ok, true, afterwards.reason);
  assert.equal(afterwards.canonical, atFiling.canonical,
    'two exports of one filing are two files with one digest, or the digest says nothing');
});

/* ------------------- 2. the structural walk, so a field added later is covered by default */

/**
 * Every leaf of the packet that carries a revision or a reference, found rather than listed.
 *
 * TWO WAYS IN, because a field can carry a revision without being called one. A leaf is collected
 * when its own key names a revision or a reference, and separately when its value holds an `R`
 * followed by digits in the shape this page writes a reference suffix in. The second is what would
 * catch a revision hidden inside a sentence somebody added to the packet later.
 *
 * The `R` has to be preceded by something that is not a letter or a digit, so the policy number
 * MTR-2026-0417 and a police reference PR-2026-31007 are not read as revisions.
 */
const REVISION_IN_TEXT = /(?:^|[^A-Za-z0-9])R(\d+)\b/g;

function revisionBearingLeaves(content) {
  const found = [];
  const walk = (value, where, key) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${where}[${index}]`, key));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [name, held] of Object.entries(value)) walk(held, `${where}.${name}`, name);
      return;
    }
    const named = typeof key === 'string' && /revision|reference/i.test(key);
    const carried = typeof value === 'string'
      ? [...value.matchAll(REVISION_IN_TEXT)].map((match) => Number(match[1]))
      : [];
    if (named || carried.length > 0) found.push({ where, value, named, carried });
  };
  walk(content, 'content', null);
  return found;
}

test('every field of the packet that carries a revision or a reference reads the filing', () => {
  const moved = filedThenMovedOn(5);
  const result = build(moved.claim, [
    { at: '09:12:10', tool: 'read_claim_state', refused: false, code: null },
    { at: '09:13:41', tool: 'apply_claim_patch', refused: true, code: 'PATCH_REJECTED_LOCKED' },
  ]);
  assert.equal(result.ok, true, result.reason);

  const leaves = revisionBearingLeaves(result.packet);

  // FOUND, NOT ASSUMED. A rename that left the walk matching nothing would otherwise pass this test
  // by having nothing to check, which is the failure mode a structural test is most prone to.
  assert.ok(leaves.length >= 2,
    `the walk found ${leaves.length} revision bearing fields, and the packet has at least two: `
    + `${leaves.map((leaf) => leaf.where).join(', ') || 'none'}`);
  assert.ok(leaves.some((leaf) => leaf.named && typeof leaf.value === 'number'),
    'no field states the filing revision as a number any more');
  assert.ok(leaves.some((leaf) => leaf.carried.length > 0),
    'no field carries the revision inside a reference any more');

  for (const leaf of leaves) {
    if (typeof leaf.value === 'number') {
      assert.equal(leaf.value, moved.filedRevision,
        `${leaf.where} is ${leaf.value} and the filing landed at ${moved.filedRevision}`);
    }
    for (const carried of leaf.carried) {
      assert.equal(carried, moved.filedRevision,
        `${leaf.where} reads ${JSON.stringify(leaf.value)} and the filing landed at ${moved.filedRevision}`);
    }
    assert.notEqual(leaf.value, moved.liveRevision,
      `${leaf.where} carries the live counter ${moved.liveRevision}`);
  }

  // And the same question asked of the bytes that get hashed, so a field the walk cannot reach
  // still cannot smuggle the live counter into the file.
  assert.equal(result.canonical.includes(`-R${moved.liveRevision}`), false,
    'the canonical form carries the live counter in a reference');
  assert.equal(result.canonical.includes(`"revision": ${moved.liveRevision}`), false,
    'the canonical form carries the live counter in a revision field');
});

test('the receipt still accepts a claim past its filing, which is why the packet has to carry the filing', () => {
  // WHICH OF THE TWO HONEST FIXES THIS IS, STATED AS A MEASUREMENT RATHER THAN AS A COMMENT. The
  // packet could have been built from the filing record, or the build could have refused once the
  // live claim was no longer that exact filing. This is the check that says which was done: the
  // verifier goes on accepting a claim whose counter has moved forward, so the packet is built from
  // the filing and reads the filing revision everywhere.
  //
  // Refusing forward movement was the other candidate and it would have cost more than it closed.
  // src/core/claim.js states at `verifyFilingContext` that a counter moved on is a legitimate thing
  // this page does, and refusing it would put back the defect measured at `noteContextChange`,
  // where the page went on reading status "filed" while refusing to describe the filing it had
  // just performed.
  const moved = filedThenMovedOn(2);
  const verdict = verifyFilingContext(moved.claim, {
    pack: northwind, homePackId: HOME, completedHumanActions: DONE,
  });

  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.mismatch, null);
  assert.equal(build(moved.claim).packet.filed.revision, moved.filedRevision);
});

/* ------------------------------------------------- 3. the rows the packet is willing to seal */

function filedClaim() {
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  assert.equal(filed.ok, true, filed.error);
  return filed.claim;
}

test('a row whose time is not a time is refused, and named for that', () => {
  // The exact row from the report. It names a tool this page really does publish and records it as
  // having succeeded, so every check that existed had nothing to say about it.
  const result = build(filedClaim(), [
    { at: 'not-a-time', tool: 'check_coverage', refused: false, code: null },
  ]);

  assert.equal(result.ok, false, 'a call at a time that is not a time was sealed');
  assert.equal(result.code, PACKET_CODES.callTime);
  assert.equal(result.packet, null);
  assert.equal(result.canonical, null, 'there is nothing to hash, so nothing is offered to hash');
  assert.match(result.reason, /not a time/);

  // AND NOT BY PATTERN ALONE. Three pairs of digits is not a clock reading, and a check that only
  // caught the string in the report would have been the wrong half of the fix.
  for (const at of ['99:99:99', '24:00:00', '09:60:00', '09:00:60', '', null, undefined, 42,
    '2026-09-01T09:15:00Z', '2026-02-30T09:15:00.000Z']) {
    const each = build(filedClaim(), [{ at, tool: 'check_coverage', refused: false, code: null }]);
    assert.equal(each.code, PACKET_CODES.callTime, `${JSON.stringify(at ?? null)} was accepted as a call time`);
  }
});

test('a row that names no tool is refused, and named for that', () => {
  const result = build(filedClaim(), [
    { at: '09:12:10', tool: null, refused: false, code: null },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_CODES.namelessCall);
  assert.equal(result.packet, null);
  assert.match(result.reason, /name no tool at all/);
});

test('a row that is not a row is refused rather than quietly dropped', () => {
  // THE HALF THAT WAS SILENT. It was a filter, so the row simply was not in the packet, and the
  // sentence six lines below it in the source already said why that is the wrong answer.
  for (const row of [null, undefined, 42, 'read_claim_state', [], true]) {
    const result = build(filedClaim(), [
      { at: '09:12:10', tool: 'read_claim_state', refused: false, code: null },
      row,
    ]);
    assert.equal(result.ok, false, `${JSON.stringify(row ?? null)} was accepted as a call`);
    assert.equal(result.code, PACKET_CODES.unusableCall,
      `${JSON.stringify(row ?? null)} was not refused as an unusable row`);
    assert.equal(result.packet, null);
  }

  // The count is the thing a handler could never check for themselves, so it is checked here.
  const handedIn = [
    { at: '09:12:10', tool: 'read_claim_state', refused: false, code: null },
    { at: '09:13:41', tool: 'apply_claim_patch', refused: true, code: 'PATCH_REJECTED_LOCKED' },
    { at: '09:14:02', tool: 'validate_claim', refused: false, code: null },
  ];
  const sealed = build(filedClaim(), handedIn);
  assert.equal(sealed.ok, true, sealed.reason);
  assert.equal(sealed.packet.tool_calls.length, handedIn.length,
    'the sealed ledger is a different length from the one handed in');
});

test('a row carrying a key this page never writes is refused, and named for that', () => {
  const result = build(filedClaim(), [
    { at: '09:12:10', tool: 'check_coverage', refused: false, code: null, settled_in_full: true },
  ]);

  assert.equal(result.ok, false, 'a row this page never wrote was sealed as a call it recorded');
  assert.equal(result.code, PACKET_CODES.foreignCallKey);
  assert.equal(result.packet, null);
  assert.match(result.reason, /"settled_in_full"/);

  // A row wearing keys from both shapes is one neither writer produces, so it goes the same way.
  const mixed = build(filedClaim(), [
    { at: '09:12:10', tool: 'check_coverage', refusals: [] },
  ]);
  assert.equal(mixed.code, PACKET_CODES.foreignCallKey);
});

test('the two shapes this page really writes are both sealed, refusal codes and all', () => {
  // The page's own row is not the packet's own row, and both reach this module. A check written
  // against one of them would refuse the other, which is the way this fix could have killed the
  // packet panel while closing the defect.
  const result = build(filedClaim(), [
    {
      at: '19:15:31',
      name: 'apply_claim_patch',
      args: '{"baseRevision":0}',
      text: 'The page refused it.',
      error: false,
      refusals: [{ code: 'PATCH_REJECTED_STALE' }],
    },
    { at: '2026-09-01T09:15:00.000Z', tool: 'read_claim_state', refused: false, code: null },
  ]);

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.packet.tool_calls.length, 2);

  // Oldest first, so the page's newest first ledger comes back reversed.
  const [older, newer] = result.packet.tool_calls;
  assert.equal(older.tool, 'read_claim_state');
  assert.equal(newer.tool, 'apply_claim_patch');
  assert.equal(newer.refused, true, 'a row the page refused sealed as one that went through');
  assert.equal(newer.code, 'PATCH_REJECTED_STALE');
});

/* ---------------------------------------------- 4. the journey the video films, on the real page */

const host = createFakeAgentHost();
const { doc } = await bootApp({}, host);

function revisionNow() {
  return Number(doc.el('revision').textContent);
}

test('the filmed journey still seals a packet, with the ledger the page itself writes', async () => {
  // BEAT 03. The agent fills the draft in one patch, quoting the revision it read.
  await host.call('apply_claim_patch', {
    baseRevision: revisionNow(),
    changes: [
      { field: 'damage_zone', value: 10 },
      { field: 'severity', value: 'dent' },
      { field: 'vehicle_drivable', value: true },
      { field: 'location', value: 'Car park on Harbour Road' },
      { field: 'description', value: 'A delivery van reversed into the left front wing while it was parked.' },
    ],
  });

  // BEAT 04. The person corrects the drivable answer by hand and pins it.
  const drivable = rowFor(doc, 'vehicle_drivable');
  drivable.control.value = 'false';
  fireEvent(drivable.control, 'change');
  fireEvent(rowFor(doc, 'vehicle_drivable').pin, 'click');

  // BEAT 05. The planted note is read out and the instruction inside it is refused, which is the
  // ledger row carrying a refusal code inside `refusals` and nowhere else.
  await host.call('read_evidence_notes', {});
  await host.call('apply_claim_patch', {
    baseRevision: revisionNow(),
    changes: [{ field: 'vehicle_drivable', value: true }],
  });

  // BEAT 06. The agent submits the declarative form, which is the tenth name on the surface and
  // the row that is written under it rather than by a registered tool.
  doc.el('declared-witness').value = 'Sofia Marin';
  doc.el('declared-police').value = '';
  doc.el('declared-revision').value = String(revisionNow());
  fireEvent(doc.el('declared-form'), 'submit', {
    agentInvoked: true,
    respondWith: () => {},
  });

  // BEAT 07. The person presses Request roadside assistance, which closes a requirement no tool
  // reaches and moves the counter through noteContextChange.
  assert.equal(doc.el('assistance-btn').disabled, false, 'the collection has to be pressable here');
  fireEvent(doc.el('assistance-btn'), 'click');

  // Every row the page has written by now, in the shape it writes them.
  const rows = doc.el('ledger').children.length;
  assert.ok(rows >= 4, `the page wrote ${rows} ledger rows and the journey makes at least four`);

  // BEAT 08. The person files.
  const before = revisionNow();
  assert.equal(doc.el('file-btn').disabled, false, doc.el('file-reason').textContent);
  fireEvent(doc.el('file-btn'), 'click');
  assert.equal(revisionNow(), before + 1, 'filing is a change like any other');
  assert.match(doc.el('file-result').textContent, /Filed via the page at /);

  // AND THE PACKET PANEL IS THERE, WHICH IS THE THING A FIX TO THE LEDGER CHECK COULD HAVE KILLED.
  // Every row above carries a local wall clock reading in `at`, because src/ui/app.js writes one
  // there on purpose, so a check demanding a full UTC instant would have refused the lot and drawn
  // the field error instead of this panel.
  assert.equal(doc.el('packet-panel').hidden, false,
    `the packet was refused: ${doc.el('field-error').textContent}`);
  assert.equal(doc.el('field-error').textContent, '');

  const reference = doc.el('packet-reference').textContent;
  assert.equal(reference.endsWith(`-R${revisionNow()}`), true,
    `the packet is built from the filed revision, and it said ${reference} at revision ${revisionNow()}`);

  // The digest lands after the panel is drawn, so it is waited for rather than assumed. The field
  // holds a placeholder until then, which is why this waits for the value and not for the field to
  // stop being empty.
  const digested = () => /^sha256:/.test(doc.el('packet-digest').textContent);
  for (let attempt = 0; attempt < 200 && !digested(); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  assert.match(doc.el('packet-digest').textContent, /^sha256:[0-9a-f]{64}$/,
    'the packet was sealed without a digest a handler can recompute');

  // And the calls the page recorded are in the sealed view, which is the half the ledger checks
  // exist to protect. The view is what the panel actually drew.
  const view = doc.el('packet-view').textContent;
  assert.match(view, /## Tool calls, oldest first/);
  assert.match(view, /apply_claim_patch/);
  assert.match(view, /record_supporting_details/,
    'the declarative half of the surface has to survive the ledger checks too');
});
