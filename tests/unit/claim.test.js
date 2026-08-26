import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  INCIDENT_TYPES,
  SEVERITIES,
  DAMAGE_ZONES,
  ZONE_LABELS,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  PATCHABLE_FIELDS,
  READ_ONLY_FIELDS,
  DESCRIPTION_MAX_LENGTH,
  DESCRIBE_MAX_LENGTH,
  FIELD_LABELS,
  createClaim,
  applyPatch,
  validateClaim,
  describeClaim,
} from '../../src/core/claim.js';

const FIXTURE_URL = new URL('../../fixtures/demo-collision.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Repo shape guards. These fail at authoring time rather than in CI.
// ---------------------------------------------------------------------------

// There is deliberately NO test here asserting that a root package.json avoids
// "type":"commonjs", and no one should add one. It cannot work: with that value
// this very file fails to parse, so the assertion never runs. Measured on Node
// 20.20.2, `node --test tests/unit` gives 0 passed and 4 failed files with only
// "SyntaxError: Cannot use import statement outside a module" to go on.
// The rule, for whoever adds the file: use "type":"module", or leave the type
// field out and let Node detect the syntax. Both were measured green.

test('the constant tables agree with each other', () => {
  assert.deepEqual(PATCHABLE_FIELDS, [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  assert.equal(DAMAGE_ZONES.length, 12);
  assert.deepEqual(DAMAGE_ZONES, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const zone of DAMAGE_ZONES) {
    assert.equal(typeof ZONE_LABELS[zone], 'string', `zone ${zone} has no label`);
  }
  // A read only field must never also be patchable, or an agent could edit it.
  for (const field of READ_ONLY_FIELDS) {
    assert.ok(!PATCHABLE_FIELDS.includes(field), `${field} is both read only and patchable`);
  }
});

test('severities are ordered from lightest to heaviest', () => {
  assert.deepEqual(SEVERITIES, ['scratch', 'dent', 'structural']);
});

// ---------------------------------------------------------------------------
// Fixture guard. A typo in the fixture must break a test, not quietly leave a
// field missing for all three layers of the app.
// ---------------------------------------------------------------------------

test('every field in the fixture draft and in every scenario is a real claim field', () => {
  const known = new Set([...PATCHABLE_FIELDS, ...READ_ONLY_FIELDS]);
  const blocks = [fixture.claim, ...fixture.scenarios.map((s) => s.claim)];
  for (const block of blocks) {
    for (const field of Object.keys(block)) {
      assert.ok(known.has(field), `"${field}" is not a claim field`);
    }
  }
});

test('createClaim accepts the fixture and every scenario without throwing', () => {
  assert.doesNotThrow(() => createClaim(fixture));
  for (const scenario of fixture.scenarios) {
    assert.doesNotThrow(() => createClaim(scenario), `scenario ${scenario.id} is not loadable`);
  }
});

test('createClaim rejects a fixture holding an invalid value', () => {
  assert.throws(
    () => createClaim({ policy: { id: 'MTR-2026-0417' }, claim: { damage_zone: 99 } }),
    /damage_zone/,
  );
  assert.throws(
    () => createClaim({ claim: { incident_type: 'meteorite' } }),
    /incident_type|incident type/,
  );
});

test('createClaim takes the policy id from the fixture and starts as a draft', () => {
  const claim = createClaim(fixture);
  assert.equal(claim.policy_id, 'MTR-2026-0417');
  assert.equal(claim.status, 'draft');
  assert.equal(claim.filed_at, null);
  assert.equal(claim.incident_type, 'collision');
});

// ---------------------------------------------------------------------------
// applyPatch
// ---------------------------------------------------------------------------

test('applyPatch rejects an unknown field and changes nothing', () => {
  const claim = createClaim(fixture);
  const before = snapshot(claim);

  const result = applyPatch(claim, 'payout_amount', 5000);

  assert.equal(result.ok, false);
  assert.match(result.error, /payout_amount/);
  assert.ok(result.claim, 'a rejected patch must still hand back a usable claim');
  assert.deepEqual(snapshot(result.claim), before);
  assert.deepEqual(snapshot(claim), before, 'the input claim was mutated');
});

test('applyPatch refuses fields the insurer owns', () => {
  const claim = createClaim(fixture);
  for (const field of READ_ONLY_FIELDS) {
    const result = applyPatch(claim, field, 'anything');
    assert.equal(result.ok, false, `${field} should not be writable`);
    assert.match(result.error, /cannot be changed|not a field/);
  }
});

test('applyPatch rejects an out of range damage_zone', () => {
  const claim = createClaim(fixture);
  const before = snapshot(claim);

  for (const bad of [0, 13, -1, 100]) {
    const result = applyPatch(claim, 'damage_zone', bad);
    assert.equal(result.ok, false, `damage_zone ${bad} should be refused`);
    assert.deepEqual(snapshot(result.claim), before);
  }
});

test('applyPatch rejects a damage_zone that is not a whole number', () => {
  const claim = createClaim(fixture);
  for (const bad of [12.5, 'ten', '', '3.5', true, null]) {
    const result = applyPatch(claim, 'damage_zone', bad);
    assert.equal(result.ok, false, `damage_zone ${String(bad)} should be refused`);
  }
});

test('applyPatch accepts every valid damage_zone', () => {
  const claim = createClaim(fixture);
  for (const zone of DAMAGE_ZONES) {
    const result = applyPatch(claim, 'damage_zone', zone);
    assert.equal(result.ok, true, `damage_zone ${zone} should be accepted`);
    assert.equal(result.claim.damage_zone, zone);
  }
});

test('applyPatch returns a new claim and leaves the original alone', () => {
  const claim = createClaim(fixture);
  const before = snapshot(claim);

  const result = applyPatch(claim, 'severity', 'dent');

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.notEqual(result.claim, claim, 'applyPatch must not return the same object on success');
  assert.equal(result.claim.severity, 'dent');
  assert.deepEqual(snapshot(claim), before, 'the input claim was mutated');
});

// This is the path that actually ships: a WebMCP input schema types the value as
// a string, so the agent sends "10" and "true", not 10 and true.
test('applyPatch coerces the strings an agent actually sends', () => {
  const claim = createClaim(fixture);

  const zone = applyPatch(claim, 'damage_zone', '10');
  assert.equal(zone.ok, true);
  assert.equal(zone.claim.damage_zone, 10);
  assert.equal(typeof zone.claim.damage_zone, 'number');

  for (const [word, expected] of [
    ['true', true],
    ['false', false],
    ['yes', true],
    ['no', false],
    ['TRUE', true],
    ['  No  ', false],
  ]) {
    const result = applyPatch(claim, 'vehicle_drivable', word);
    assert.equal(result.ok, true, `vehicle_drivable "${word}" should be accepted`);
    assert.equal(result.claim.vehicle_drivable, expected);
  }

  const type = applyPatch(claim, 'incident_type', '  Collision ');
  assert.equal(type.ok, true);
  assert.equal(type.claim.incident_type, 'collision');
});

test('applyPatch refuses a vehicle_drivable it cannot read as a yes or a no', () => {
  const claim = createClaim(fixture);
  for (const bad of [1, 0, 'maybe', 'sort of', {}]) {
    const result = applyPatch(claim, 'vehicle_drivable', bad);
    assert.equal(result.ok, false, `vehicle_drivable ${String(bad)} should be refused`);
  }
});

test('applyPatch validates incident_date as a real calendar date', () => {
  const claim = createClaim(fixture);
  for (const good of ['2026-08-20', '2024-02-29', '2026-12-31']) {
    assert.equal(applyPatch(claim, 'incident_date', good).ok, true, `${good} should be accepted`);
  }
  for (const bad of ['2026-02-30', '2026-13-01', '20-08-2026', '2026-8-2', 'yesterday', '1999-01-01']) {
    assert.equal(applyPatch(claim, 'incident_date', bad).ok, false, `${bad} should be refused`);
  }
});

test('applyPatch enforces the description cap', () => {
  const claim = createClaim(fixture);

  const atCap = applyPatch(claim, 'description', 'x'.repeat(DESCRIPTION_MAX_LENGTH));
  assert.equal(atCap.ok, true);

  const overCap = applyPatch(claim, 'description', 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1));
  assert.equal(overCap.ok, false);
  assert.match(overCap.error, new RegExp(String(DESCRIPTION_MAX_LENGTH)));

  assert.equal(applyPatch(claim, 'description', '   ').ok, false, 'blank text should be refused');
});

test('applyPatch clears an optional field but never a required one', () => {
  const claim = createClaim(fixture);

  const cleared = applyPatch(claim, 'location', null);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.claim.location, null);

  const refused = applyPatch(claim, 'incident_type', null);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /required/);
  assert.equal(refused.claim.incident_type, 'collision');
});

test('applyPatch refuses every edit once the claim is filed', () => {
  const claim = { ...createClaim(fixture), status: 'filed' };
  const result = applyPatch(claim, 'severity', 'dent');
  assert.equal(result.ok, false);
  assert.match(result.error, /already been filed/);
});

test('applyPatch accepts every value in every enum it publishes', () => {
  const claim = createClaim(fixture);
  for (const type of INCIDENT_TYPES) {
    assert.equal(applyPatch(claim, 'incident_type', type).ok, true, `${type} should be accepted`);
  }
  for (const severity of SEVERITIES) {
    assert.equal(applyPatch(claim, 'severity', severity).ok, true, `${severity} should be accepted`);
  }
});

// ---------------------------------------------------------------------------
// validateClaim
// ---------------------------------------------------------------------------

// The expected list is written out by hand on purpose. Deriving it from
// REQUIRED_FIELDS would make this test pass no matter what the fixture holds.
test('validateClaim lists exactly the fields the demo fixture leaves open', () => {
  const claim = createClaim(fixture);
  const { ready, missing } = validateClaim(claim);

  assert.equal(ready, false);
  assert.deepEqual(missing, ['damage_zone', 'severity', 'vehicle_drivable', 'description']);
});

test('validateClaim reports every required field on an empty claim, in order', () => {
  const { ready, missing } = validateClaim(createClaim({}));
  assert.equal(ready, false);
  assert.deepEqual(missing, [
    'incident_date',
    'incident_type',
    'damage_zone',
    'severity',
    'vehicle_drivable',
    'description',
  ]);
});

test('validateClaim turns ready once the last required field lands', () => {
  const claim = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  const { ready, missing } = validateClaim(claim);
  assert.equal(ready, true);
  assert.deepEqual(missing, []);
});

test('warnings never block filing', () => {
  const base = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  const { claim } = applyPatch(base, 'severity', 'structural');
  const { ready, warnings } = validateClaim(claim);

  assert.equal(ready, true, 'a warning must not make a complete claim unfilable');
  assert.ok(warnings.length > 0, 'structural damage with no police reference should warn');
  assert.ok(warnings.some((w) => /police report/i.test(w)));
});

test('validateClaim spots a claim that contradicts itself', () => {
  let claim = createClaim(fixture);
  claim = applyPatch(claim, 'severity', 'scratch').claim;
  claim = applyPatch(claim, 'vehicle_drivable', false).claim;

  const { warnings } = validateClaim(claim);
  assert.ok(
    warnings.some((w) => /not drivable/i.test(w)),
    'a scratch that leaves the car undrivable should be questioned',
  );
});

// ---------------------------------------------------------------------------
// describeClaim
// ---------------------------------------------------------------------------

test('describeClaim summarises a part filled draft and names what is missing', () => {
  const text = describeClaim(createClaim(fixture));
  assert.match(text, /MTR-2026-0417/);
  assert.match(text, /collision/);
  assert.match(text, new RegExp(FIELD_LABELS.damage_zone));
  assert.ok(text.length < DESCRIBE_MAX_LENGTH);
});

// describeClaim is read out loud by the visitor's agent. Field names are for the
// tool schema, not for a sentence.
test('describeClaim never leaks a machine field name into its prose', () => {
  const claims = [
    createClaim(fixture),
    createClaim({}),
    createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision')),
    createClaim(fixture.scenarios.find((s) => s.id === 'uncovered-theft')),
  ];
  for (const claim of claims) {
    const text = describeClaim(claim);
    for (const field of PATCHABLE_FIELDS) {
      assert.ok(!text.includes(field), `describeClaim said "${field}" out loud: ${text}`);
    }
  }
});

// The opening beat of the demo is describeClaim on the fixture draft, where four
// required fields are still null. It has to read like a sentence, not a form.
test('describeClaim leaves unanswered fields out instead of printing placeholders', () => {
  const text = describeClaim(createClaim(fixture));
  assert.ok(!/not set/.test(text), `placeholder text leaked into the summary: ${text}`);
  assert.ok(!/undefined|null/.test(text), `a raw value leaked into the summary: ${text}`);
  assert.ok(!/Damage:/.test(text), 'the damage sentence should be skipped while both halves are empty');
  assert.match(text, /Still needed before filing/);
});

test('describeClaim does not double a full stop after a name ending in one', () => {
  const text = describeClaim(createClaim(fixture));
  assert.match(text, /Maria K\./);
  assert.ok(!/\.\./.test(text), `two full stops in a row: ${text}`);
});

test('describeClaim describes damage when only half of it is known', () => {
  const base = createClaim(fixture);

  const severityOnly = describeClaim(applyPatch(base, 'severity', 'dent').claim);
  assert.match(severityOnly, /impact position still to be marked/);

  const zoneOnly = describeClaim(applyPatch(base, 'damage_zone', 4).claim);
  assert.match(zoneOnly, /severity still to be set/);
  assert.match(zoneOnly, /4 o'clock/);
});

test('every field a person can fill has something to call it', () => {
  for (const field of PATCHABLE_FIELDS) {
    assert.equal(typeof FIELD_LABELS[field], 'string', `${field} has no human label`);
    assert.ok(FIELD_LABELS[field].length > 0);
    assert.ok(!FIELD_LABELS[field].includes('_'), `${field} label is still a machine name`);
  }
});

test('describeClaim spells out the clock position in words', () => {
  const claim = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  const text = describeClaim(claim);
  assert.match(text, /10 o'clock/);
  assert.match(text, new RegExp(ZONE_LABELS[10]));
});

// The point of this test is that the natural worst case fits the budget on its
// own. If it only fits because describeClaim truncated it, the budget is fiction.
test('describeClaim fits the budget without truncating, even at every cap', () => {
  const worstCases = [
    {
      incident_date: '2026-08-20',
      incident_type: 'collision',
      damage_zone: 10,
      severity: 'structural',
      vehicle_drivable: false,
      description: 'x'.repeat(240),
      driver: 'd'.repeat(80),
      location: 'l'.repeat(120),
      police_report_ref: 'p'.repeat(40),
      witness_name: 'w'.repeat(80),
    },
    {
      // No police reference, so several warnings fire at once.
      incident_date: '2026-08-20',
      incident_type: 'theft',
      damage_zone: 5,
      severity: 'scratch',
      vehicle_drivable: false,
      description: 'x'.repeat(240),
      driver: 'd'.repeat(80),
      location: 'l'.repeat(120),
      witness_name: 'w'.repeat(80),
    },
  ];

  for (const seed of worstCases) {
    const claim = createClaim({ policy: { id: 'MTR-2026-0417' }, claim: seed });
    const text = describeClaim(claim);
    assert.ok(
      text.length <= DESCRIBE_MAX_LENGTH,
      `describeClaim returned ${text.length} characters, the cap is ${DESCRIBE_MAX_LENGTH}`,
    );
    assert.ok(
      !text.endsWith('...'),
      `describeClaim had to truncate at ${text.length} characters, so the template is too long`,
    );
  }
});

test('describeClaim says the claim is ready once it is', () => {
  const claim = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  const text = describeClaim(claim);
  assert.match(text, /ready/i);
  assert.ok(!/Still needed/.test(text));
});

test('the core model refuses to work on something that is not a claim', () => {
  assert.throws(() => validateClaim(null), TypeError);
  assert.throws(() => describeClaim(undefined), TypeError);
  assert.throws(() => applyPatch(null, 'severity', 'dent'), TypeError);
});
