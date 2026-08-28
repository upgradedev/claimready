import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deriveRequirements,
  outstandingRequirements,
  summariseRequirements,
  packFieldDemands,
  fileGateStatement,
  fileGateIsSettled,
  optionalDetailsNote,
} from '../../src/core/requirements.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import {
  applyPatch,
  createClaim,
  validateClaim,
  requiredFieldsFor,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  INCIDENT_TYPES,
  SEVERITIES,
} from '../../src/core/claim.js';

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

const fixture = readJson('../../fixtures/demo-collision.json');
const northwind = loadPolicyPack(readJson('../../fixtures/insurers/northwind.json'));
const kestrel = loadPolicyPack(readJson('../../fixtures/insurers/kestrel.json'));

function patch(claim, field, value) {
  const result = applyPatch(claim, { field, value });
  assert.equal(result.ok, true, `setting ${field} should have been accepted: ${result.error}`);
  return result.claim;
}

function ids(requirements) {
  return requirements.map((entry) => entry.id);
}

function byId(requirements, id) {
  return requirements.find((entry) => entry.id === id);
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test('every requirement says what it is, why it is here and whether it is answered', () => {
  const requirements = deriveRequirements(northwind, createClaim(fixture));
  assert.ok(requirements.length > 0);

  for (const entry of requirements) {
    assert.equal(typeof entry.id, 'string');
    assert.ok(entry.id.length > 0);
    assert.equal(typeof entry.label, 'string');
    assert.equal(typeof entry.why, 'string');
    assert.ok(/[Cc]lause/.test(entry.why), `"${entry.id}" cites no clause: ${entry.why}`);
    assert.equal(typeof entry.satisfied, 'boolean');
    assert.ok(
      entry.triggeredBy === null || typeof entry.triggeredBy === 'string',
      `"${entry.id}" has a strange triggeredBy`,
    );
  }
});

test('deriveRequirements insists on a pack and a claim', () => {
  assert.throws(() => deriveRequirements(null, createClaim(fixture)), TypeError);
  assert.throws(() => deriveRequirements(northwind, null), TypeError);
});

test('a requirement the insurer always asks for is triggered by nothing', () => {
  const requirements = deriveRequirements(northwind, createClaim(fixture));
  assert.equal(byId(requirements, 'date_of_loss').triggeredBy, null);
  assert.equal(byId(requirements, 'date_of_loss').satisfied, true, 'the fixture supplies the date');
  assert.equal(byId(requirements, 'claimant_account').satisfied, false);
});

// ---------------------------------------------------------------------------
// The demo beat: a person answers one question and the intake changes shape
// ---------------------------------------------------------------------------

test('saying the car cannot be driven raises two requirements that were not there', () => {
  const drivable = patch(createClaim(fixture), 'vehicle_drivable', true);
  const before = deriveRequirements(northwind, drivable);

  assert.ok(!ids(before).includes('roadside_collection'));
  assert.ok(!ids(before).includes('collection_address'));

  const stranded = patch(drivable, 'vehicle_drivable', false);
  const after = deriveRequirements(northwind, stranded);

  const roadside = byId(after, 'roadside_collection');
  const address = byId(after, 'collection_address');

  assert.ok(roadside, 'a car that cannot move has to be collected');
  assert.ok(address, 'a recovery truck needs somewhere to go');
  assert.equal(roadside.triggeredBy, 'vehicle_drivable');
  assert.equal(address.triggeredBy, 'vehicle_drivable');
  assert.match(roadside.why, /the answer to "whether the car still drives" is no/);
  assert.equal(address.satisfied, false, 'the demo fixture leaves the location empty on purpose');
});

test('the same two requirements disappear again when the answer is corrected back', () => {
  const stranded = patch(createClaim(fixture), 'vehicle_drivable', false);
  assert.ok(ids(deriveRequirements(northwind, stranded)).includes('roadside_collection'));

  const driving = patch(stranded, 'vehicle_drivable', true);
  assert.ok(!ids(deriveRequirements(northwind, driving)).includes('roadside_collection'));
  assert.ok(!ids(deriveRequirements(northwind, driving)).includes('collection_address'));
});

test('answering the newly raised requirement satisfies it without changing the list', () => {
  const stranded = patch(createClaim(fixture), 'vehicle_drivable', false);
  const answered = patch(stranded, 'location', 'Car park, Harbour Road');

  const before = deriveRequirements(northwind, stranded);
  const after = deriveRequirements(northwind, answered);

  assert.deepEqual(ids(after), ids(before), 'answering a requirement must not add or remove one');
  assert.equal(byId(before, 'collection_address').satisfied, false);
  assert.equal(byId(after, 'collection_address').satisfied, true);
});

// Roadside collection is arranged by a person pressing a button on the page. No
// tool on the page reaches that button, so no field an agent can send answers
// it, and the text says so.
function stranded() {
  let claim = patch(createClaim(fixture), 'vehicle_drivable', false);
  claim = patch(claim, 'location', 'Car park, Harbour Road');
  claim = patch(claim, 'damage_zone', 10);
  claim = patch(claim, 'severity', 'structural');
  claim = patch(claim, 'description', 'The wing is folded into the wheel and the car will not roll.');
  claim = patch(claim, 'police_report_ref', 'PR-2026-55810');
  return claim;
}

test('no field an agent can send answers the requirement a person has to act on', () => {
  const roadside = byId(deriveRequirements(northwind, stranded()), 'roadside_collection');
  assert.equal(roadside.satisfied, false);
  assert.equal(roadside.field, null, 'no claim field answers this one');
  assert.match(roadside.humanAction, /Request roadside assistance/);
  assert.match(roadside.why, /no tool on this page reaches it/);
});

// The other half, and the one that was missing. A human action that HAS been
// carried out has to be able to report itself answered, or the panel can never
// reach "all requirements are answered" and three surfaces end up disagreeing.
test('a human action the page reports as done is answered, and only that one', () => {
  const claim = stranded();
  const before = deriveRequirements(northwind, claim);
  assert.equal(byId(before, 'roadside_collection').satisfied, false);

  const after = deriveRequirements(northwind, claim, ['roadside_collection']);
  assert.equal(byId(after, 'roadside_collection').satisfied, true);
  assert.match(byId(after, 'roadside_collection').why, /The page reports that this has now been done/);
  assert.deepEqual(ids(after), ids(before), 'reporting an action done must not add or remove a requirement');
  assert.equal(outstandingRequirements(after).length, 0, 'the demo has to be able to reach all answered');
  assert.equal(summariseRequirements(after), `All ${after.length} intake requirements are answered.`);
});

test('an unrelated id reported done satisfies nothing', () => {
  const after = deriveRequirements(northwind, stranded(), ['collection_address', 'not_a_requirement']);
  assert.equal(byId(after, 'roadside_collection').satisfied, false);
});

test('a Set and an array of completed actions are read the same way', () => {
  const fromArray = deriveRequirements(northwind, stranded(), ['roadside_collection']);
  const fromSet = deriveRequirements(northwind, stranded(), new Set(['roadside_collection']));
  assert.deepEqual(fromSet, fromArray);
});

test('a theft claim is not asked where the impact landed', () => {
  const collision = createClaim(fixture);
  assert.ok(ids(deriveRequirements(northwind, collision)).includes('impact_position'));

  const theft = patch(collision, 'incident_type', 'theft');
  const requirements = deriveRequirements(northwind, theft);
  assert.ok(!ids(requirements).includes('impact_position'));
  assert.equal(byId(requirements, 'police_report').triggeredBy, 'incident_type');
});

test('structural damage raises the police report requirement at this insurer', () => {
  const claim = createClaim(fixture);
  assert.ok(!ids(deriveRequirements(northwind, claim)).includes('police_report'));

  const structural = patch(claim, 'severity', 'structural');
  const raised = byId(deriveRequirements(northwind, structural), 'police_report');
  assert.ok(raised);
  assert.equal(raised.triggeredBy, 'severity');
  assert.equal(raised.satisfied, false);

  const answered = patch(structural, 'police_report_ref', 'PR-2026-55810');
  assert.equal(byId(deriveRequirements(northwind, answered), 'police_report').satisfied, true);
});

// ---------------------------------------------------------------------------
// Two packs, one claim, two intakes
// ---------------------------------------------------------------------------

test('the two rule packs ask for different things about the same claim', () => {
  const claim = createClaim(fixture);
  const here = ids(deriveRequirements(northwind, claim));
  const there = ids(deriveRequirements(kestrel, claim));

  assert.notDeepEqual(here, there, 'two insurers with identical intakes would prove nothing');
  assert.ok(!here.includes('named_witness'), 'northwind does not ask for a witness');
  assert.ok(there.includes('named_witness'), 'kestrel asks a collision claimant for a witness');
});

test('structural damage raises a police report at one insurer and not at the other', () => {
  const structural = patch(createClaim(fixture), 'severity', 'structural');

  assert.ok(ids(deriveRequirements(northwind, structural)).includes('police_report'));
  assert.ok(!ids(deriveRequirements(kestrel, structural)).includes('police_report'));
});

test('the drivable beat works the same under either pack, with each insurer clause', () => {
  const stranded = patch(createClaim(fixture), 'vehicle_drivable', false);

  const here = byId(deriveRequirements(northwind, stranded), 'roadside_collection');
  const there = byId(deriveRequirements(kestrel, stranded), 'roadside_collection');

  assert.equal(here.triggeredBy, 'vehicle_drivable');
  assert.equal(there.triggeredBy, 'vehicle_drivable');
  assert.match(here.why, /RA-3\.2/);
  assert.match(there.why, /KR-8\.3/);
  assert.notEqual(here.why, there.why, 'each insurer cites its own clause');
});

// ---------------------------------------------------------------------------
// Third party content changes nothing
// ---------------------------------------------------------------------------

test('the planted instruction in the evidence notes changes no requirement', () => {
  const withNote = patch(createClaim(fixture), 'vehicle_drivable', false);
  const withoutNote = patch(
    createClaim({ policy: fixture.policy, claim: { ...fixture.claim, evidence_notes: [] } }),
    'vehicle_drivable',
    false,
  );

  assert.ok(withNote.evidence_notes.length > 0, 'the fixture must still carry the note');
  assert.deepEqual(
    deriveRequirements(northwind, withNote),
    deriveRequirements(northwind, withoutNote),
  );
  assert.deepEqual(validateClaim(withNote), validateClaim(withoutNote));
});

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

test('outstanding requirements are the ones still waiting for an answer', () => {
  const requirements = deriveRequirements(northwind, createClaim(fixture));
  const open = outstandingRequirements(requirements);

  assert.ok(open.length > 0);
  assert.ok(open.every((entry) => entry.satisfied === false));
  assert.ok(open.length < requirements.length, 'the fixture answers at least one of them');
  assert.throws(() => outstandingRequirements(null), TypeError);
});

test('the summary line fits a tool result and says how many are open', () => {
  const requirements = deriveRequirements(northwind, createClaim(fixture));
  const line = summariseRequirements(requirements);

  assert.match(line, /still open/);
  assert.ok(line.length <= 300, `the summary was ${line.length} characters`);

  const empty = summariseRequirements([]);
  assert.match(empty, /no intake requirements/);
});

test('a claim that answers everything reports nothing outstanding', () => {
  let claim = createClaim(fixture.scenarios.find((scenario) => scenario.id === 'covered-collision'));
  claim = patch(claim, 'witness_name', 'A. Passer-by');

  const requirements = deriveRequirements(kestrel, claim);
  assert.deepEqual(outstandingRequirements(requirements), []);
  assert.match(summariseRequirements(requirements), /All \d+ intake requirements are answered/);
});

// ---------------------------------------------------------------------------
// The file gate and the insurer's own rules must not drift apart
//
// The gate that decides whether a claim can be filed lives in claim.js, because
// the store can reach it without a rule pack. What the intake asks for lives in
// the packs. Those are two statements of the same thing for any field a pack
// names, and they were contradicting each other: the gate demanded an impact
// position on a theft claim, refused to let it be cleared, and warned that it
// should not be there, while both packs said plainly that theft is not asked for
// one. This is the check that fails when they drift again.
// ---------------------------------------------------------------------------

const PACKS = [['northwind', northwind], ['kestrel', kestrel]];

/** Enough shapes to move every condition either pack writes. */
function claimMatrix() {
  const out = [];
  for (const incidentType of [null, ...INCIDENT_TYPES]) {
    for (const severity of [null, ...SEVERITIES]) {
      for (const drivable of [null, true, false]) {
        let claim = createClaim({});
        if (incidentType) claim = patch(claim, 'incident_type', incidentType);
        if (severity) claim = patch(claim, 'severity', severity);
        if (drivable !== null) claim = patch(claim, 'vehicle_drivable', drivable);
        out.push({ label: `${incidentType ?? 'no type'}/${severity ?? 'no severity'}/drivable ${drivable}`, claim });
      }
    }
  }
  return out;
}

/**
 * Every field either pack names, over the whole matrix, with nothing skipped.
 *
 * THE VERSION OF THIS TEST THAT SHIPPED FIRST WAS BLIND, AND BLIND IN THE ONE
 * DIRECTION THAT MATTERED. It opened with `if (!REQUIRED_FIELDS.includes(field))
 * continue;`, so it only ever compared the intersection where the two answers are
 * the same thing by construction, and disagreement was impossible inside its own
 * scope. police_report_ref, location and witness_name were never looked at once.
 * A guard that can only pass is not a forcing function, it is a decoration.
 *
 * The two directions are not the same claim and are asserted separately:
 *
 *   CONTRADICTION, and it must never happen. The file gate requires a field on a
 *   claim the pack does not ask for it on. That is the defect this test was
 *   written for: the gate demanded an impact position on a theft claim while both
 *   packs said theft is exempt.
 *
 *   BEYOND THE GATE, which is legitimate and has to be ENUMERATED rather than
 *   ignored. A pack may ask for more than the page blocks filing on, and both do.
 *   That gap is exactly what the file panel has to say out loud, so it is pinned
 *   here by name: a new rule cannot join the set without this test going red.
 */
test('for every field a pack names, the file gate never requires what the pack does not ask for', () => {
  const contradictions = [];
  const beyondTheGate = new Set();
  const examined = new Set();
  const matrix = claimMatrix();
  assert.ok(matrix.length >= 84, `the matrix collapsed to ${matrix.length} claims`);

  for (const [name, pack] of PACKS) {
    for (const { label, claim } of matrix) {
      const { asked, named } = packFieldDemands(pack, claim);
      const gate = requiredFieldsFor(claim);
      for (const field of named) {
        examined.add(field);
        const packWantsIt = asked.includes(field);
        const gateWantsIt = gate.includes(field);
        if (gateWantsIt && !packWantsIt) {
          contradictions.push(
            `${name} on ${label}: the file gate requires ${field}, the pack does not ask for it`,
          );
        }
        if (packWantsIt && !gateWantsIt) beyondTheGate.add(`${name}:${field}`);
      }
    }
  }

  assert.deepEqual(contradictions, [], contradictions.join(' | '));

  // The scope this test used to skip. Naming the three is what stops the skip
  // being reintroduced by a helper that quietly narrows the loop again.
  for (const field of ['police_report_ref', 'location', 'witness_name']) {
    assert.ok(examined.has(field), `${field} was never compared, so the guard is blind again`);
  }

  assert.deepEqual(
    [...beyondTheGate].sort(),
    [
      'kestrel:location',
      'kestrel:police_report_ref',
      'kestrel:witness_name',
      'northwind:location',
      'northwind:police_report_ref',
    ],
    'a pack asks for a field the file gate does not block filing on. That is allowed, and the file '
      + 'panel has to say so, but it is not allowed to appear here without being written down.',
  );
});

/**
 * The requirement no field can answer has to be visible to a caller asking what
 * the pack demands.
 *
 * packFieldDemands used to `continue` on any rule without satisfied_by.field, so
 * roadside_collection, the sharpest requirement either pack states and the only
 * one no patch from either side can close, was invisible to every reader of this
 * function including the guard above it.
 */
test('packFieldDemands surfaces the rules no field answers, by id', () => {
  const drivable = patch(createClaim(fixture), 'vehicle_drivable', true);
  const stranded = patch(createClaim(fixture), 'vehicle_drivable', false);

  for (const [name, pack] of PACKS) {
    assert.deepEqual(packFieldDemands(pack, drivable).humanOnly, [], `${name} asks for one too early`);
    assert.deepEqual(
      packFieldDemands(pack, stranded).humanOnly,
      ['roadside_collection'],
      `${name} hides the requirement no field can close`,
    );
    // And it is not a field demand in disguise: nothing in `named` answers it.
    assert.ok(!packFieldDemands(pack, stranded).named.includes('roadside_collection'));
  }
});

// The gap is real and deliberate, so it is written down rather than left to be
// rediscovered. Neither pack mentions incident_type; the page requires it on its
// own account because a cover check cannot run without one.
test('incident_type is required by the page although no pack names it', () => {
  for (const [name, pack] of PACKS) {
    const { named } = packFieldDemands(pack, createClaim(fixture));
    assert.ok(!named.includes('incident_type'), `${name} now names incident_type, revisit the gate`);
  }
  assert.ok(requiredFieldsFor(createClaim({})).includes('incident_type'));
});

test('a theft claim is not required to carry an impact position, and can clear one', () => {
  const theft = patch(patch(createClaim(fixture), 'incident_type', 'theft'), 'damage_zone', 10);

  assert.ok(!requiredFieldsFor(theft).includes('damage_zone'));
  assert.ok(
    !validateClaim(theft).missing.includes('damage_zone'),
    'a field the claim already holds, and the pack does not ask for, cannot be missing',
  );

  const cleared = applyPatch(theft, { field: 'damage_zone', value: null });
  assert.equal(cleared.ok, true, `clearing it was refused: ${cleared.error}`);
  assert.equal(cleared.claim.damage_zone, null);

  // And the same claim as a collision does have to answer it.
  const collision = patch(theft, 'incident_type', 'collision');
  assert.ok(requiredFieldsFor(collision).includes('damage_zone'));
  const refused = applyPatch(collision, { field: 'damage_zone', value: null });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'PATCH_REJECTED_VALUE');
});

test('packFieldDemands insists on a pack', () => {
  assert.throws(() => packFieldDemands(null, createClaim(fixture)), TypeError);
});

// ---------------------------------------------------------------------------
// The two panels have to be able to agree
//
// The file panel and the requirements panel are two statements about one draft,
// and they were printed from two different inputs. The file panel was handed the
// file gate's verdict alone, so on a draft where every required field was filled
// and the insurer still asked for something it printed "The draft is complete"
// three inches from "1 of 7 intake requirements are still open". Both sentences
// were drawn from the same store on the same tick.
//
// The claim below is that state, reached the way a person reaches it: answer the
// six required fields, say where the car is, then answer "still drivable" with no.
// Northwind's clause RA-3.2 then asks for a roadside collection, and that rule has
// no field at all, so no patch from either side can close it. Only the person
// pressing the button on the page can.
// ---------------------------------------------------------------------------

function strandedDraft() {
  let claim = createClaim(fixture);
  claim = patch(claim, 'incident_date', '2026-08-20');
  claim = patch(claim, 'incident_type', 'collision');
  claim = patch(claim, 'damage_zone', 10);
  claim = patch(claim, 'severity', 'dent');
  claim = patch(claim, 'description', 'A delivery van reversed into the left front wing while it was parked.');
  claim = patch(claim, 'location', 'Car park, Harbour Road');
  claim = patch(claim, 'vehicle_drivable', false);
  return claim;
}

function panelState(claim, pack) {
  const entries = deriveRequirements(pack, claim, []);
  const verdict = validateClaim(claim);
  return {
    ready: verdict.ready,
    missing: verdict.missing,
    outstanding: outstandingRequirements(entries),
    insurer: pack.insurer,
    requirementsKnown: true,
    summary: summariseRequirements(entries),
  };
}

test('the file panel never says complete while the intake still asks for something', () => {
  const claim = strandedDraft();
  const state = panelState(claim, northwind);

  // The exact state from the audit, pinned so the test cannot drift off it.
  assert.equal(state.ready, true, 'every required field is filled');
  assert.deepEqual(state.missing, [], 'the file gate has nothing left to ask for');
  assert.equal(state.outstanding.length, 1, `outstanding: ${state.outstanding.map((e) => e.id).join(', ')}`);
  assert.equal(state.outstanding[0].id, 'roadside_collection');
  assert.equal(state.outstanding[0].field, null, 'no field answers it, so no patch can close it');
  assert.match(state.summary, /1 of 7 intake requirements are still open/);

  const sentence = fileGateStatement(state);
  assert.ok(
    !/complete/i.test(sentence),
    `the file panel called an incomplete draft complete: "${sentence}"`,
  );
  assert.match(sentence, /Every required field is filled/);
  assert.ok(
    sentence.includes(state.outstanding[0].label),
    `the panel does not name what the insurer still asks for: "${sentence}"`,
  );
  assert.ok(sentence.includes(northwind.insurer), 'the panel does not say whose intake is asking');
});

test('the file panel says out loud that no patch can close a human action', () => {
  const sentence = fileGateStatement(panelState(strandedDraft(), northwind));
  assert.match(sentence, /no tool on this page reaches it/i);
  assert.match(sentence, /No field answers/i);
});

test('the file panel still says complete when the intake is genuinely answered', () => {
  const claim = patch(strandedDraft(), 'vehicle_drivable', true);
  const state = panelState(claim, northwind);
  assert.equal(state.outstanding.length, 0, 'a drivable car raises neither roadside rule');
  assert.equal(fileGateStatement(state), 'The draft is complete. Filing is yours to do.');
});

test('an unfilled draft still names what is missing, and never claims completeness', () => {
  const state = panelState(createClaim(fixture), northwind);
  const sentence = fileGateStatement(state);
  assert.equal(state.ready, false);
  assert.match(sentence, /Still needed before you can file/);
  assert.ok(!/complete/i.test(sentence), sentence);
});

test('a draft the rule pack cannot be read against does not claim completeness either', () => {
  const claim = patch(strandedDraft(), 'vehicle_drivable', true);
  const sentence = fileGateStatement({
    ready: true,
    missing: [],
    outstanding: [],
    insurer: null,
    requirementsKnown: false,
  });
  assert.ok(!/complete/i.test(sentence), sentence);
  assert.match(sentence, /rule pack did not load/i);
  assert.equal(validateClaim(claim).ready, true, 'the file gate itself is still satisfied');
});

// The extraction is only worth having while the view keeps calling it. A second
// copy of the sentence inside render.js would put the two panels back on two
// inputs without a single test going red, which is how this defect shipped.
// The colour beside the sentence is a claim of its own, so it is answered by the
// same module rather than by the view reading `ready` on its own.
test('the file panel is settled only when there is nothing left for anyone to do', () => {
  const stranded = panelState(strandedDraft(), northwind);
  assert.equal(fileGateIsSettled(stranded), false, 'the intake is still asking for something');

  const answered = panelState(patch(strandedDraft(), 'vehicle_drivable', true), northwind);
  assert.equal(fileGateIsSettled(answered), true);

  assert.equal(fileGateIsSettled(panelState(createClaim(fixture), northwind)), false, 'not ready');
  assert.equal(
    fileGateIsSettled({ ready: true, missing: [], outstanding: [], requirementsKnown: false }),
    false,
    'a pack that never loaded is an unknown, not a clear answer',
  );
  assert.equal(fileGateIsSettled(null), false);

  // And the two never disagree: settled is exactly the state the word complete is allowed in.
  for (const state of [stranded, answered]) {
    assert.equal(/complete/i.test(fileGateStatement(state)), fileGateIsSettled(state));
  }
});

test('the view prints the file panel sentence from this module and holds no copy of it', () => {
  const view = readFileSync(new URL('../../src/ui/render.js', import.meta.url), 'utf8');
  assert.match(
    view,
    /import \{ fileGateStatement, fileGateIsSettled, optionalDetailsNote \} from '\.\.\/core\/requirements\.js';/,
  );
  assert.match(view, /text\(els\.fileReason, fileGateStatement\(state\)\);/);
  assert.match(view, /classList\.toggle\('is-blocked', !fileGateIsSettled\(state\)\)/);
  assert.ok(
    !/The draft is complete/.test(view),
    'render.js carries its own copy of the file panel sentence again',
  );
  assert.ok(
    !/Still needed before you can file/.test(view),
    'render.js carries its own copy of the missing fields sentence again',
  );

  // The third sentence about the same draft, held to the same rule. The note above the optional
  // group is composed here and drawn there, from the state the file panel already receives, so a
  // copy of it in the view would be a second answer waiting to disagree with this one.
  assert.match(view, /text\(els\.optionalNote, optionalDetailsNote\(state\)\);/);
  assert.ok(
    !/Not needed to file/.test(view),
    'render.js carries its own copy of the optional details sentence again',
  );
});

// ---------------------------------------------------------------------------
// The note above the optional details, and the sentence it used to print
//
// index.html said "Not needed to file" over a group holding four fields that both
// shipped packs can ask for: the police report reference, the location of a car
// that cannot be driven, and, under the other insurer, a witness to a collision.
// The file gate genuinely does not wait for them, so the sentence was true about
// the button and false about the claim, and a claimant who read it and folded the
// group away was still short of what the intake wanted.
// ---------------------------------------------------------------------------

/** The demo draft with a collision on it, which is what the page opens on. */
function collisionDraft() {
  return createClaim(fixture);
}

test('the note names the optional fields the loaded pack is actually asking for', () => {
  // Kestrel asks a collision claimant for a witness, and witness_name is optional.
  const state = panelState(collisionDraft(), kestrel);
  const note = optionalDetailsNote(state);

  assert.match(note, /The File button does not wait for these/);
  assert.match(note, /Kestrel Assurance is asking for: /);
  assert.match(note, /witness/i);
  assert.doesNotMatch(note, /not asking for any/);
});

test('the note says so plainly when the pack asks for none of them', () => {
  // Northwind asks for a police report only on a structural or theft claim, and for a location
  // only when the car cannot be driven. Neither is true of the draft the page opens on.
  const state = panelState(collisionDraft(), northwind);
  const note = optionalDetailsNote(state);

  assert.match(note, /Northwind Mutual is not asking for any of them on this draft/);
  assert.doesNotMatch(note, /is asking for: /);
});

test('the note follows the claim, so answering a question can add one of these fields', () => {
  const stranded = patch(patch(collisionDraft(), 'severity', 'structural'), 'vehicle_drivable', false);
  const note = optionalDetailsNote(panelState(stranded, northwind));

  // Two optional fields at once: the police report the structural rule raises, and the address
  // the collection rule raises.
  assert.match(note, /police report/i);
  assert.match(note, /Where the car is now/i);
});

test('a requirement that no field answers is not named as an optional field', () => {
  const stranded = patch(collisionDraft(), 'vehicle_drivable', false);
  const state = panelState(stranded, northwind);

  assert.ok(
    state.outstanding.some((entry) => entry.id === 'roadside_collection'),
    'the human action has to be outstanding for this test to mean anything',
  );
  assert.doesNotMatch(optionalDetailsNote(state), /Roadside collection/);
});

test('with no rule pack loaded the note claims nothing about what is asked for', () => {
  const note = optionalDetailsNote({ ready: false, missing: [], outstanding: [], requirementsKnown: false });
  assert.match(note, /The File button does not wait for these/);
  assert.doesNotMatch(note, /asking/);
});

// The two sentences about one draft are drawn from one input, which is the rule
// this module exists to hold. If the file panel is told the intake wants an
// optional field, this note has to name it.
test('the note and the file panel never disagree about the same draft', () => {
  // A complete draft whose only open asks are the collection and the address for it. Small enough
  // that neither statement has to cap its list, so the two can be compared word for word.
  const ready = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  const stranded = patch(patch(ready, 'vehicle_drivable', false), 'location', null);

  for (const pack of [northwind, kestrel]) {
    const state = panelState(stranded, pack);
    assert.equal(state.ready, true, 'the file gate is satisfied, which is the interesting case');
    const wanted = state.outstanding.filter((entry) => OPTIONAL_FIELDS.includes(entry.field));
    assert.ok(wanted.length > 0, `${pack.insurer} has to be asking for an optional field here`);
    assert.ok(state.outstanding.length <= 3, 'small enough that neither sentence has to cap its list');

    const gate = fileGateStatement(state);
    const note = optionalDetailsNote(state);
    for (const entry of wanted) {
      assert.ok(gate.includes(entry.label), `the file panel dropped ${entry.id}`);
      assert.ok(note.includes(entry.label), `the optional note dropped ${entry.id}`);
    }
  }
});
