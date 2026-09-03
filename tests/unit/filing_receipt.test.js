/**
 * The packet says a filing happened. This is the check that one did.
 *
 * WHAT WAS WRONG. `content.filed.through` reads "a control on the page. Filing is not exposed as a
 * WebMCP tool." Nothing checked it. `status` is an ordinary string on an ordinary object, so a
 * caller that wrote the two bookkeeping values by hand got a whole FNOL packet, sealed under a
 * digest, asserting a filing that never took place. Measured before the fix, from a draft that had
 * never been through the file gate:
 *
 *   packet ok   : true
 *   reference   : CR-MTR-2026-0417-R4
 *   filed at    : 2026-09-01T09:15:00.000Z
 *   through     : a control on the page. Filing is not exposed as a WebMCP tool.
 *
 * AND THE HALF THAT STAYED OPEN AFTER THAT. Attesting the claim says nothing about what the claim
 * was filed UNDER, and the rule pack, whose policy it is and the completed human actions all arrive
 * on the packet's own call. So a separately valid pack carrying the same id sealed its insurer, its
 * clause and its excess under the digest. The measurement is at the counterfeit section below.
 *
 * THE FIX AND ITS LIMIT. `fileClaim` in src/core/claim.js records what the filing was decided under
 * in a WeakMap held privately in that module, keyed by the claim it returns, and `buildFilingPacket`
 * refuses a claim that is not in it and refuses a context that is not the recorded one. The same
 * mechanism src/core/policy.js uses for a validated pack, for the same reason: membership is not a
 * property, so it cannot be written, spread or stored.
 *
 * It is a browser local demonstration and the receipt is worth exactly that. It says this code path
 * ran in this page in this session. It says nothing to anybody outside the session, because the
 * whole record lives in memory and goes with the tab. It is not a signature and it is not an
 * insurer receipt. The tests below pin the behaviour; they do not claim more than that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyPatch,
  createClaim,
  fileClaim,
  filedRevisionOf,
  FILING_CONTEXT_MISMATCHES,
  hydrateClaim,
  lockField,
  verifyFilingContext,
  wasFiledHere,
} from '../../src/core/claim.js';
import { buildFilingPacket, PACKET_CODES, PUBLISHED_TOOL_NAMES } from '../../src/core/packet.js';
import { loadPolicyPack } from '../../src/core/policy.js';

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

function build(claim) {
  return buildFilingPacket({
    claim,
    pack: northwind,
    homePackId: HOME,
    completedHumanActions: DONE,
    ledger: [],
  });
}

/* -------------------------------------------------------------------------- the forgeries */

test('a status written by hand does not produce a packet', () => {
  // The exact shape that used to seal. Everything a packet asks for is present and correct, and
  // the one thing that is missing is the filing itself.
  const forged = { ...settledDraft(), status: 'filed', filed_at: AT, revision: 4 };
  const result = build(forged);

  assert.equal(result.ok, false, 'a hand written status was sealed as a filing');
  assert.equal(result.code, PACKET_CODES.notFiledHere);
  assert.equal(result.packet, null);
  assert.equal(result.canonical, null, 'there is nothing to hash, so nothing is offered to hash');
  assert.match(result.reason, /filed through the control on this page/);
});

test('a copy of a real filed claim is not the filed claim', () => {
  // A spread produces a different object, and a different object was not filed. This is the
  // intended reading rather than a rough edge: somebody assembled that object, this page did not.
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  assert.equal(filed.ok, true, filed.error);

  assert.equal(build(filed.claim).ok, true, 'the real filing has to build, or this proves nothing');
  assert.equal(build({ ...filed.claim }).code, PACKET_CODES.notFiledHere);
});

test('a filed claim read back from storage carries no receipt', () => {
  // Hydration is the door a stored claim comes through, and storage is caller controlled. Handing
  // the receipt back here would hand it to whoever wrote the storage, which is the forger. So a
  // filed claim that survived a reload is readable, patch refusing and closed, and this page will
  // not describe it as a filing it performed. It never happens on the demo path: this page keeps
  // no storage at all, and the packet is drawn from the same object the file gate returned.
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  const restored = hydrateClaim(JSON.parse(JSON.stringify(filed.claim)));

  assert.equal(restored.status, 'filed', 'the state survives the round trip');
  assert.equal(wasFiledHere(restored), false);
  assert.equal(build(restored).code, PACKET_CODES.notFiledHere);
});

/* ------------------------------------------------------------------------- the real thing */

test('the filing this page performs produces its packet', () => {
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });

  assert.equal(wasFiledHere(filed.claim), true);
  const result = build(filed.claim);
  assert.equal(result.ok, true, result.reason);
  assert.match(result.packet.filed.through, /not exposed as a WebMCP tool/);
});

test('a refused filing hands back the draft, and the draft holds no receipt', () => {
  // A refusal changes nothing, which the filing tests already pin. The receipt has to follow that
  // rule too, or a refused filing would leave a claim that could be sealed later.
  const refused = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: [], homePackId: HOME,
  });

  assert.equal(refused.ok, false);
  assert.equal(wasFiledHere(refused.claim), false);
});

test('wasFiledHere says no to anything that is not a claim, rather than throwing', () => {
  for (const value of [null, undefined, 'filed', 42, [], {}]) {
    assert.equal(wasFiledHere(value), false, `${JSON.stringify(value)} was treated as filed`);
  }
});

/* ----------------------------------------------------------- there is no way to write to it */

test('no module exports a way to put a claim in the receipt', () => {
  // The reading halves are exported and the writing half is not. A `markFiled` or a `FILED_HERE`
  // leaking out of claim.js would hand the forger the one thing the receipt exists to withhold, so
  // this is a grep over the source rather than a promise in a comment.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '..', '..', 'src', 'core', 'claim.js'), 'utf8');

  const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/gm)]
    .map((match) => match[1]);
  assert.equal(exported.includes('wasFiledHere'), true, 'the reading half has to be reachable');
  assert.equal(exported.includes('verifyFilingContext'), true, 'the second reading half too');
  assert.equal(exported.includes('filedRevisionOf'), true, 'and the third, which the packet reads');
  assert.equal(
    exported.some((name) => /^(markFiled|addFilingReceipt|sealAndReceipt|FILING_RECORDS|FILED_HERE|filingRecordOf)$/.test(name)),
    false,
    'a writing half is exported, so the receipt can be forged',
  );

  // And the map is written on exactly one line. The write moved out of fileClaim when
  // noteContextChange began preserving the receipt on a filed claim: both go through
  // sealAndReceipt, which freezes and then sets, so one line is still one writer. That helper is
  // private too, which is why its name is in the list above.
  const writes = source.split('\n').filter((line) => /FILING_RECORDS\.set\(/.test(line));
  assert.equal(writes.length, 1, `the receipt is written in ${writes.length} places`);

  // NO READER HANDS THE RECORD BACK. A record handed back is the exact set of values a caller
  // would need to replay at packet time, which is the thing the binding exists to stop. So the
  // verifier answers with a verdict and the boolean answers with a boolean.
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  }).claim;
  const verdict = verifyFilingContext(filed, {
    pack: northwind, homePackId: HOME, completedHumanActions: DONE,
  });
  assert.deepEqual(Object.keys(verdict).sort(), ['mismatch', 'ok', 'reason']);
  assert.equal(verdict.ok, true, verdict.reason);

  // AND THE THIRD READER HANDS BACK ONE NUMBER, WHICH IS NOT THE SAME THING. The packet has to
  // print the revision the filing landed on, and before `filedRevisionOf` existed it had no source
  // for it and read the live counter beside it instead. What comes back is a plain integer, not the
  // record and not a slice of it, so the pack, its canonical writing, the home pack id and the
  // completed actions all stay where they are. Those four are what `verifyFilingContext` compares
  // for equality, and they are what a substitution would have to guess.
  const revision = filedRevisionOf(filed);
  assert.equal(typeof revision, 'number', 'the packet has no source for the revision it prints');
  assert.equal(revision, filed.revision, 'the filing landed on the revision the claim came back at');
  assert.equal(filedRevisionOf({ ...filed }), null, 'a copy was assembled rather than filed here');
  for (const value of [null, undefined, 'filed', 42, [], {}]) {
    assert.equal(filedRevisionOf(value), null,
      `${JSON.stringify(value ?? null)} was treated as carrying a filing`);
  }
});

/* ------------------------------------------- the receipt binds the pack the filing happened under */

/**
 * WHAT WAS WRONG, AND IT IS THE SECOND HALF OF THE SAME DEFECT THE FILE ABOVE CLOSES.
 *
 * The receipt attested the claim and nothing else. `buildFilingPacket` is handed the rule pack,
 * whose policy it is and the completed human actions on its own call, so a caller supplied whatever
 * it liked, and if the pack it supplied was separately valid the packet sealed that pack's insurer,
 * clause and excess under the digest. Measured on the shipped fixture, from a claim filed under
 * Northwind Mutual, clause OD-4.1, excess 250:
 *
 *   filed ok: true
 *   counterfeit pack id: northwind insurer: Counterfeit Northwind
 *   COUNTERFEIT PACKET ok: true code: null
 *   sealed coverage: {"covered":true,"provisional":false,"clause":"ALT-9.9","deductible":999,
 *                     "currency":"EUR","reason":"A collision claim is covered under Own damage,
 *                     clause ALT-9.9. You pay the first 999 EUR as the excess.", ...}
 *
 * SAME ID IS WHAT MADE IT SHARP. Every identity check in this repository compares ids, so a
 * substitution that keeps the id walks past all of them. A Kestrel substitution was already refused
 * on the same run, which is why it is not the case being closed here:
 *
 *   KESTREL ok: false code: PACKET_REFUSED_BORROWED_RULES
 *
 * Two more substitutions rode in on the same call and both are closed below:
 *
 *   INJECTED ok: true human_actions_completed: ["date_of_loss","roadside_collection"]
 *   LEDGER ok: true tool_calls: [{"at":"...","tool":"file_claim","refused":false,"code":null}]
 */

/** The raw Northwind file, so a test can edit it and hand the result to the real loader. */
const northwindRaw = JSON.parse(readFileSync(
  new URL('../../fixtures/insurers/northwind.json', import.meta.url), 'utf8',
));

/**
 * A pack the loader validated, carrying Northwind's id and somebody else's rules.
 *
 * It goes through `loadPolicyPack`, so it is a genuinely validated pack. Handing the packet an
 * unvalidated object is a different defect and tests/unit/validated_pack_boundary.test.js holds it.
 */
function counterfeitNorthwind() {
  const raw = JSON.parse(JSON.stringify(northwindRaw));
  raw.insurer = 'Counterfeit Northwind';
  for (const cover of raw.coverages) {
    if (cover.code === 'own_damage') {
      cover.clause = 'ALT-9.9';
      cover.deductible = 999;
    }
  }
  return loadPolicyPack(raw);
}

/** The filing this whole section is about, performed the ordinary way. */
function realFiling() {
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  assert.equal(filed.ok, true, `the real filing has to happen, or nothing below proves anything: ${filed.error}`);
  return filed.claim;
}

test('a same id counterfeit pack does not seal the filing that happened under the real one', () => {
  const filed = realFiling();

  // The control first. The pack the filing happened under still seals, so what follows is about the
  // substitution rather than about the packet having stopped working.
  const real = build(filed);
  assert.equal(real.ok, true, real.reason);
  assert.equal(real.packet.coverage.clause, 'OD-4.1');
  assert.equal(real.packet.coverage.deductible, 250);
  assert.equal(real.packet.policy.insurer, 'Northwind Mutual');

  const forged = counterfeitNorthwind();
  assert.equal(forged.id, 'northwind', 'the forgery keeps the id, which is the whole point of it');
  assert.equal(forged.insurer, 'Counterfeit Northwind');

  const substituted = buildFilingPacket({
    claim: filed, pack: forged, homePackId: HOME, completedHumanActions: DONE, ledger: [],
  });
  assert.equal(substituted.ok, false, 'a counterfeit pack sealed a filing it had nothing to do with');
  assert.equal(substituted.code, PACKET_CODES.notTheFilingContext);
  assert.equal(substituted.packet, null);
  assert.equal(substituted.canonical, null, 'there is nothing to hash, so nothing is offered to hash');
  assert.match(substituted.reason, /not the rules this claim was filed under/);

  // And the reason names which of the two pack questions answered no, so a reader can tell a
  // rewritten pack from a re-read one.
  const verdict = verifyFilingContext(filed, {
    pack: forged, homePackId: HOME, completedHumanActions: DONE,
  });
  assert.equal(verdict.mismatch, FILING_CONTEXT_MISMATCHES.packContent);
});

test('a structurally perfect copy of the pack the filing happened under does not substitute for it', () => {
  // THE SECOND PACK QUESTION, AND IT IS NOT THE FIRST ONE AGAIN. This object holds exactly what the
  // filing was decided under, so the canonical writings match and the content check has no opinion.
  // It is still an object this build has never read, which is the boundary src/core/policy.js draws
  // one step further out. Asking both means neither a rewritten pack nor a re-read one gets in.
  const filed = realFiling();
  const reread = loadPolicyPack(JSON.parse(JSON.stringify(northwindRaw)));

  assert.notEqual(reread, northwind, 'the copy has to be a different object for this to mean anything');
  const verdict = verifyFilingContext(filed, {
    pack: reread, homePackId: HOME, completedHumanActions: DONE,
  });
  assert.equal(verdict.ok, false, 'a pack this filing was not decided under stood in for the one it was');
  assert.equal(verdict.mismatch, FILING_CONTEXT_MISMATCHES.packIdentity);

  const substituted = buildFilingPacket({
    claim: filed, pack: reread, homePackId: HOME, completedHumanActions: DONE, ledger: [],
  });
  assert.equal(substituted.code, PACKET_CODES.notTheFilingContext);
});

test('a caller cannot add a human action to a filing after it happened', () => {
  // `date_of_loss` is the sharp one, and it is why an earlier attempt at this reported nothing. A
  // made up id such as `police_report_ack` is dropped by the scoping filter in packet.js, because
  // the pack does not raise that requirement for this claim. `date_of_loss` IS a requirement this
  // pack raises here, so it survived the filter and was sealed as a step a person had carried out.
  // It is not even a human action: it is answered by a field. Measured before the fix:
  //
  //   INJECTED ok: true human_actions_completed: ["date_of_loss","roadside_collection"]
  const filed = realFiling();

  const injected = buildFilingPacket({
    claim: filed,
    pack: northwind,
    homePackId: HOME,
    completedHumanActions: [...DONE, 'date_of_loss'],
    ledger: [],
  });
  assert.equal(injected.ok, false, 'a step nobody carried out was sealed into the packet');
  assert.equal(injected.code, PACKET_CODES.notTheFilingContext);
  assert.match(injected.reason, /not the steps this claim was filed with/);

  // The order of the same list is not a change, so it is not refused as one.
  const reordered = buildFilingPacket({
    claim: filed, pack: northwind, homePackId: HOME, completedHumanActions: [...DONE].reverse(), ledger: [],
  });
  assert.equal(reordered.ok, true, reordered.reason);
  assert.deepEqual(reordered.packet.human_actions_completed, ['roadside_collection']);
});

test('a caller cannot take a human action off a filing after it happened', () => {
  // This one is refused one gate earlier, and the code says so. Dropping the collection step
  // re-opens the requirement it answers, so the packet refuses the claim as one that could not have
  // passed the file gate before it ever reaches the receipt. Both answers are no, and the specific
  // diagnosis is the more useful of the two, which is why the receipt check is asked last.
  const filed = realFiling();

  const stripped = buildFilingPacket({
    claim: filed, pack: northwind, homePackId: HOME, completedHumanActions: [], ledger: [],
  });
  assert.equal(stripped.ok, false, 'a filing was described without the step it was filed with');
  assert.equal(stripped.code, PACKET_CODES.unfileable);

  // And the receipt refuses it too, on its own terms, so the answer does not depend on which gate
  // happens to be asked first.
  const verdict = verifyFilingContext(filed, {
    pack: northwind, homePackId: HOME, completedHumanActions: [],
  });
  assert.equal(verdict.mismatch, FILING_CONTEXT_MISMATCHES.actions);
});

test('whose policy this is was settled at the filing and is not restated later', () => {
  // Asserted on the verifier rather than through the packet, and that is deliberate rather than a
  // convenience. A home pack id that disagrees with the pack in hand is already refused as borrowed
  // rules two gates earlier, and a missing one is refused as no home insurer, so this branch cannot
  // be reached through buildFilingPacket today. It is reachable through the exported verifier, and
  // it is what stops the next caller of that function trusting a fourth fact it was handed.
  const filed = realFiling();

  const verdict = verifyFilingContext(filed, {
    pack: northwind, homePackId: 'kestrel', completedHumanActions: DONE,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.mismatch, FILING_CONTEXT_MISMATCHES.homePack);

  assert.equal(verifyFilingContext(filed, {
    pack: northwind, homePackId: null, completedHumanActions: DONE,
  }).mismatch, FILING_CONTEXT_MISMATCHES.homePack);
});

test('the receipt refuses a context handed in with no pack at all, rather than throwing', () => {
  const filed = realFiling();
  for (const context of [undefined, {}, { pack: null }, { pack: 'northwind' }]) {
    const verdict = verifyFilingContext(filed, context);
    assert.equal(verdict.ok, false, `${JSON.stringify(context ?? null)} was accepted as the filing context`);
    assert.equal(verdict.mismatch, FILING_CONTEXT_MISMATCHES.packContent);
  }
});

test('a claim with no receipt is told no filing happened, not that the context is wrong', () => {
  // The two answers are different things to be told and they keep different codes. One says no
  // filing happened. The other says a filing happened and this is not what it happened under.
  const forged = { ...settledDraft(), status: 'filed', filed_at: AT, revision: 4 };

  assert.equal(verifyFilingContext(forged, {
    pack: northwind, homePackId: HOME, completedHumanActions: DONE,
  }).mismatch, FILING_CONTEXT_MISMATCHES.noReceipt);
  assert.equal(build(forged).code, PACKET_CODES.notFiledHere);

  for (const value of [null, undefined, 'filed', 42, [], {}]) {
    assert.equal(verifyFilingContext(value, {}).mismatch, FILING_CONTEXT_MISMATCHES.noReceipt,
      `${JSON.stringify(value)} was treated as carrying a filing context`);
  }
});

/* ------------------------------------------------------------------------- the caller's ledger */

/**
 * The two rows src/ui/app.js actually writes, copied off a booted page.
 *
 * WHY THEY ARE HERE AND WHY THE OLD CONTROL WAS NOT ENOUGH. The honest control in the first test
 * below used to be `{ at, tool: 'read_claim_state', refused: false, code: null }`. That is the
 * shape buildFilingPacket emits and the shape every fixture in this file writes, and it is not the
 * shape the page writes. src/ui/app.js ledgers `{ at, name, args, text, error, refusals }`, with
 * the tool under `name` and any refusal inside `refusals`, and it writes `record_supporting_details`
 * into that row whenever an agent submits the declarative form. So the control could not fail: it
 * named an imperative tool, in the packet's own vocabulary, and it went on passing while the
 * sequence a caller driving both halves of the API is most likely to take, an agent calling the
 * declarative form and a person then pressing File this claim, produced no packet at all.
 *
 * MEASURED, NOT INVENTED. Both rows were read off the real page booted through
 * tests/support/boot_app.mjs: insurer set to northwind, the rows answered until `file-btn` opened,
 * then `declared-form` submitted with `agentInvoked: true`. The accepted submission quoted the
 * current revision, the refused one quoted revision 1 after the draft had reached 5. What the page
 * printed:
 *
 *   declared result : "Recorded the name of the witness on the draft, submitted through the
 *                      WebMCP tool call. The draft is now at revision 6."
 *   declared result : "Refused. PATCH_REJECTED_STALE: expected revision 1, current revision 5. ..."
 *   ledger rows     : "21:05:54 record_supporting_details ..." and
 *                     "21:07:26 record_supporting_details refused PATCH_REJECTED_STALE ..."
 */
const PAGE_ROW_ACCEPTED = Object.freeze({
  at: '21:05:54',
  name: 'record_supporting_details',
  args: '{"witness_name":"Anna Petrou","police_report_ref":"","base_revision":"5"}',
  text: 'Recorded the name of the witness on the draft, submitted through the WebMCP tool call. '
    + 'The draft is now at revision 6.',
  error: false,
  refusals: [],
});

const PAGE_ROW_REFUSED = Object.freeze({
  at: '21:07:26',
  name: 'record_supporting_details',
  args: '{"witness_name":"Anna Petrou","police_report_ref":"","base_revision":"1"}',
  text: 'Refused. PATCH_REJECTED_STALE: expected revision 1, current revision 5.',
  error: false,
  refusals: [{ code: 'PATCH_REJECTED_STALE', error: 'expected revision 1, current revision 5.' }],
});

/** The packet's own row shape, which is what the rest of the fixtures in this file speak. */
function packetRow(tool, extra = {}) {
  return { at: AT, tool, refused: false, code: null, ...extra };
}

function sealWith(ledger) {
  return buildFilingPacket({
    claim: realFiling(),
    pack: northwind,
    homePackId: HOME,
    completedHumanActions: DONE,
    ledger,
  });
}

test('the ledger cannot seal a call to a tool this page does not publish', () => {
  // THE ONE INPUT THAT CANNOT BE BOUND. The ledger goes on collecting after the filing, so there is
  // nothing to compare it against, and every row was believed. `file_claim` is the case, by name:
  // filing is a control on the page and deliberately has no tool, which the packet asserts two
  // fields further up in its own `filed.through` sentence. Measured before the fix:
  //
  //   LEDGER ok: true tool_calls: [{"at":"...","tool":"file_claim","refused":false,"code":null}]
  const fabricated = sealWith([packetRow('file_claim')]);
  assert.equal(fabricated.ok, false, 'a successful call to a tool that does not exist was sealed');
  assert.equal(fabricated.code, PACKET_CODES.unknownTool);
  assert.match(fabricated.reason, /"file_claim"/);

  // A refused row naming the same tool is refused too. The claim being made is that the tool was
  // called at all, and that is the false half whichever way the row ends.
  assert.equal(sealWith([packetRow('file_claim', { refused: true, code: 'NOPE' })]).code,
    PACKET_CODES.unknownTool);

  // A row in the PAGE's shape naming something off the surface is refused on the same terms. The
  // name arrives under `name` rather than `tool` here, which is the reader the old control never
  // exercised at all.
  const pageFabricated = sealWith([{ ...PAGE_ROW_ACCEPTED, name: 'file_claim' }]);
  assert.equal(pageFabricated.code, PACKET_CODES.unknownTool);
  assert.match(pageFabricated.reason, /"file_claim"/);

  // AND THE REAL LEDGER STILL SEALS, IN BOTH SHAPES, or the checks above would only prove that
  // nothing gets through. The declarative row is the one that would have caught the short list, so
  // it is the one the control is built from, and the packet row rides beside it because both reach
  // the same reader in src/core/packet.js.
  const honest = sealWith([PAGE_ROW_ACCEPTED, packetRow('read_claim_state')]);
  assert.equal(honest.ok, true, honest.reason);
  // The ledger is newest first and the packet lists calls oldest first, so the order flips.
  assert.deepEqual(honest.packet.tool_calls, [
    { at: AT, tool: 'read_claim_state', refused: false, code: null },
    { at: '21:05:54', tool: 'record_supporting_details', refused: false, code: null },
  ]);

  // A refusal the page recorded travels as a refusal. src/ui/app.js puts it in `refusals` and
  // writes neither `refused` nor `code`, so a row the page had turned down would otherwise seal as
  // `refused: false, code: null`: a document stating under a digest that a refused call went
  // through.
  const refused = sealWith([PAGE_ROW_REFUSED]);
  assert.equal(refused.ok, true, refused.reason);
  assert.deepEqual(refused.packet.tool_calls, [{
    at: '21:07:26',
    tool: 'record_supporting_details',
    refused: true,
    code: 'PATCH_REJECTED_STALE',
  }]);
});

test('a ledger row that names no tool at all is refused, and not as an invented name', () => {
  // THE RESIDUE OF THE NAME CHECK. The invented name filter only ever inspected values that were
  // already strings, so everything else fell out of it and was sealed as `{"tool":null,...}`: a
  // handler is told an agent made a call and given nothing to look it up by, under a digest.
  // Measured before src/core/packet.js refused it, on a real filed claim:
  //
  //   {"at":"...","refused":false,"code":null}             ok: true  sealed {"tool":null,...}
  //   {"at":"...","tool":null,"refused":false,"code":null} ok: true  sealed {"tool":null,...}
  //
  // Every row below names nothing, in a different way, and one of them is the shape the page
  // writes. The blank string and the string of spaces are here because trimming a name into
  // existence is the other way this could have been closed and it is the wrong one: the page does
  // not publish " read_claim_state ".
  const nameless = [
    ['no key at all', { at: AT, refused: false, code: null }],
    ['a null tool', packetRow(null)],
    ['a null name, in the page shape', { ...PAGE_ROW_ACCEPTED, name: null }],
    ['an empty string', packetRow('')],
    ['a string of spaces', packetRow('   ')],
    ['a number', packetRow(42)],
    ['an object', packetRow({ name: 'read_claim_state' })],
  ];

  for (const [what, row] of nameless) {
    const built = sealWith([row]);
    assert.equal(built.ok, false, `${what} was sealed`);
    assert.equal(built.code, PACKET_CODES.namelessCall,
      `${what} was refused as ${built.code}, and a row that names nothing is a different thing to `
      + 'be told than a row that names something this page never published');
    assert.doesNotMatch(built.reason, /""/,
      `${what} produced a sentence quoting a name it does not have`);
  }

  // It counts the rows rather than reporting the first, because a handler comparing the ledger it
  // handed in against the document needs to know how much of it was the problem. Two nameless rows
  // beside one good one, and the sentence says so.
  const mixed = sealWith([packetRow(null), PAGE_ROW_ACCEPTED, { at: AT }]);
  assert.equal(mixed.code, PACKET_CODES.namelessCall);
  assert.match(mixed.reason, /2 of the 3 rows/);
});

test('the tool names the packet checks against are the tool names the page publishes', () => {
  // TWO LISTS THAT AGREE TODAY ARE TWO LISTS THAT DISAGREE LATER. src/core/packet.js states the
  // names rather than importing them, because src/webmcp must not appear in the packet's import
  // graph, so this is the check that keeps the stated list honest.
  //
  // IT READ ONE HALF OF THE SURFACE AND CALLED IT THE SURFACE. WebMCP has an imperative half, one
  // descriptor per file under src/webmcp/tools, and a declarative half, a `toolname` attribute on a
  // form in index.html. This check read the directory only, so the stated list held nine names
  // while the page published ten and the check was satisfied by the agreement. The repository
  // already knew: docs/architecture.md:151 says counting files in that directory does not count the
  // whole published surface any more, and docs/architecture.md:221 records the identical miss for
  // the human only name blocklist and names the command that closes it, grep -n 'toolname='
  // index.html. That command is the second read below.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(here, '..', '..');

  const dir = path.join(root, 'src', 'webmcp', 'tools');
  const imperative = readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .flatMap((file) => {
      const found = readFileSync(path.join(dir, file), 'utf8').match(/^\s*name: '([a-z_]+)',$/m);
      return found ? [found[1]] : [];
    });

  const markup = readFileSync(path.join(root, 'index.html'), 'utf8');
  const declarative = [...markup.matchAll(/\btoolname="([a-z_]+)"/g)].map((found) => found[1]);

  assert.equal(imperative.length > 0, true,
    'no tool names were read from src/webmcp/tools, so this check is comparing nothing');
  assert.equal(declarative.length > 0, true,
    'no toolname attribute was read from index.html, so the declarative half of the surface is '
    + 'unchecked again, which is the exact state this defect arrived in');

  // A `toolname=` this read did not turn into a name is a name gone missing, and once the two
  // halves are unioned that looks identical to a name that was never declared. So the attributes
  // are counted the plain way as well, and a declaration written with different quoting fails here
  // instead of quietly shrinking the surface this check believes in.
  const attributes = (markup.match(/\btoolname=/g) || []).length;
  assert.equal(declarative.length, attributes,
    `index.html declares ${attributes} tools and only ${declarative.length} were read as names`);

  const published = [...imperative, ...declarative].sort();
  assert.equal(new Set(published).size, published.length,
    'the same tool name was read from both halves of the surface, so one of the two reads is wrong');
  assert.equal(published.length > imperative.length, true,
    'the published surface was assembled from the tool files alone. It has two halves, and a list '
    + 'built from one of them is how a nine name list came to describe a ten tool page');

  assert.deepEqual([...PUBLISHED_TOOL_NAMES].sort(), published,
    'the list the packet checks a ledger against is not the list of tools this page publishes');
  assert.equal(PUBLISHED_TOOL_NAMES.includes('file_claim'), false,
    'filing is a control on the page and must never appear as a tool');
});
