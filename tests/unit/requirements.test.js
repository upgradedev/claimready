import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deriveRequirements,
  outstandingRequirements,
  summariseRequirements,
  packFieldDemands,
} from '../../src/core/requirements.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import {
  applyPatch,
  createClaim,
  validateClaim,
  requiredFieldsFor,
  REQUIRED_FIELDS,
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

test('for every field a pack names, the pack and the file gate agree on every claim shape', () => {
  const disagreements = [];
  const matrix = claimMatrix();
  assert.ok(matrix.length >= 84, `the matrix collapsed to ${matrix.length} claims`);

  for (const [name, pack] of PACKS) {
    for (const { label, claim } of matrix) {
      const { asked, named } = packFieldDemands(pack, claim);
      const gate = requiredFieldsFor(claim);
      for (const field of named) {
        if (!REQUIRED_FIELDS.includes(field)) continue;
        const packWantsIt = asked.includes(field);
        const gateWantsIt = gate.includes(field);
        if (packWantsIt !== gateWantsIt) {
          disagreements.push(
            `${name} on ${label}: pack asks for ${field}=${packWantsIt}, file gate requires it=${gateWantsIt}`,
          );
        }
      }
    }
  }

  assert.deepEqual(disagreements, [], disagreements.join('\n'));
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
