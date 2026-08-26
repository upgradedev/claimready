import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deriveRequirements,
  outstandingRequirements,
  summariseRequirements,
} from '../../src/core/requirements.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { applyPatch, createClaim, validateClaim } from '../../src/core/claim.js';

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

// Roadside collection is arranged by a person pressing a button. No tool can do
// it, so it stays open however much the agent fills in, and the text says so.
test('the requirement only a person can satisfy never reports itself answered', () => {
  let claim = patch(createClaim(fixture), 'vehicle_drivable', false);
  claim = patch(claim, 'location', 'Car park, Harbour Road');
  claim = patch(claim, 'damage_zone', 10);
  claim = patch(claim, 'severity', 'structural');
  claim = patch(claim, 'description', 'The wing is folded into the wheel and the car will not roll.');
  claim = patch(claim, 'police_report_ref', 'PR-2026-55810');

  const roadside = byId(deriveRequirements(northwind, claim), 'roadside_collection');
  assert.equal(roadside.satisfied, false);
  assert.match(roadside.why, /Nothing an agent can send satisfies this one/);
  assert.match(roadside.why, /Request roadside assistance/);
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
