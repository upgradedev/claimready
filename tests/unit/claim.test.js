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
  PROTECTED_FIELDS,
  READ_ONLY_FIELDS,
  PATCH_CODES,
  PROVENANCE_SOURCES,
  DESCRIPTION_MAX_LENGTH,
  DESCRIBE_MAX_LENGTH,
  FIELD_LABELS,
  createClaim,
  hydrateClaim,
  applyPatch,
  patchIsNoChange,
  lockField,
  unlockField,
  isLocked,
  provenanceOf,
  fileClaim,
  readEvidenceNotes,
  validateClaim,
  describeClaim,
} from '../../src/core/claim.js';

const FIXTURE_URL = new URL('../../fixtures/demo-collision.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * One change, as a person on the page makes it. Most of the tests below were
 * written against the older single field signature and still read better this
 * way. The batch form, the actor and the revision guard are exercised directly
 * further down, where they are the subject rather than the setup.
 */
function patch(claim, field, value, options) {
  return applyPatch(claim, { field, value }, options);
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

  const result = patch(claim, 'payout_amount', 5000);

  assert.equal(result.ok, false);
  assert.match(result.error, /payout_amount/);
  assert.ok(result.claim, 'a rejected patch must still hand back a usable claim');
  assert.deepEqual(snapshot(result.claim), before);
  assert.deepEqual(snapshot(claim), before, 'the input claim was mutated');
});

test('applyPatch refuses fields the insurer owns', () => {
  const claim = createClaim(fixture);
  for (const field of READ_ONLY_FIELDS) {
    const result = patch(claim, field, 'anything');
    assert.equal(result.ok, false, `${field} should not be writable`);
    assert.equal(result.code, PATCH_CODES.protected, `${field} should refuse as protected`);
    assert.match(result.error, new RegExp(`"${field}" is not patchable by anyone`));
    assert.equal(result.revision, claim.revision, 'a refused patch must not move the revision');
  }
});

test('applyPatch rejects an out of range damage_zone', () => {
  const claim = createClaim(fixture);
  const before = snapshot(claim);

  for (const bad of [0, 13, -1, 100]) {
    const result = patch(claim, 'damage_zone', bad);
    assert.equal(result.ok, false, `damage_zone ${bad} should be refused`);
    assert.deepEqual(snapshot(result.claim), before);
  }
});

test('applyPatch rejects a damage_zone that is not a whole number', () => {
  const claim = createClaim(fixture);
  for (const bad of [12.5, 'ten', '', '3.5', true, null]) {
    const result = patch(claim, 'damage_zone', bad);
    assert.equal(result.ok, false, `damage_zone ${String(bad)} should be refused`);
  }
});

test('applyPatch accepts every valid damage_zone', () => {
  const claim = createClaim(fixture);
  for (const zone of DAMAGE_ZONES) {
    const result = patch(claim, 'damage_zone', zone);
    assert.equal(result.ok, true, `damage_zone ${zone} should be accepted`);
    assert.equal(result.claim.damage_zone, zone);
  }
});

test('applyPatch returns a new claim and leaves the original alone', () => {
  const claim = createClaim(fixture);
  const before = snapshot(claim);

  const result = patch(claim, 'severity', 'dent');

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

  const zone = patch(claim, 'damage_zone', '10');
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
    const result = patch(claim, 'vehicle_drivable', word);
    assert.equal(result.ok, true, `vehicle_drivable "${word}" should be accepted`);
    assert.equal(result.claim.vehicle_drivable, expected);
  }

  const type = patch(claim, 'incident_type', '  Collision ');
  assert.equal(type.ok, true);
  assert.equal(type.claim.incident_type, 'collision');
});

test('applyPatch refuses a vehicle_drivable it cannot read as a yes or a no', () => {
  const claim = createClaim(fixture);
  for (const bad of [1, 0, 'maybe', 'sort of', {}]) {
    const result = patch(claim, 'vehicle_drivable', bad);
    assert.equal(result.ok, false, `vehicle_drivable ${String(bad)} should be refused`);
  }
});

test('applyPatch validates incident_date as a real calendar date', () => {
  const claim = createClaim(fixture);
  for (const good of ['2026-08-20', '2024-02-29', '2026-12-31']) {
    assert.equal(patch(claim, 'incident_date', good).ok, true, `${good} should be accepted`);
  }
  for (const bad of ['2026-02-30', '2026-13-01', '20-08-2026', '2026-8-2', 'yesterday', '1999-01-01']) {
    assert.equal(patch(claim, 'incident_date', bad).ok, false, `${bad} should be refused`);
  }
});

test('applyPatch enforces the description cap', () => {
  const claim = createClaim(fixture);

  const atCap = patch(claim, 'description', 'x'.repeat(DESCRIPTION_MAX_LENGTH));
  assert.equal(atCap.ok, true);

  const overCap = patch(claim, 'description', 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1));
  assert.equal(overCap.ok, false);
  assert.match(overCap.error, new RegExp(String(DESCRIPTION_MAX_LENGTH)));

  assert.equal(patch(claim, 'description', '   ').ok, false, 'blank text should be refused');
});

test('applyPatch clears an optional field but never a required one', () => {
  const claim = createClaim(fixture);

  const cleared = patch(claim, 'location', null);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.claim.location, null);

  const refused = patch(claim, 'incident_type', null);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /required/);
  assert.equal(refused.claim.incident_type, 'collision');
});

test('applyPatch refuses every edit once the claim is filed', () => {
  const claim = { ...createClaim(fixture), status: 'filed' };
  const result = patch(claim, 'severity', 'dent');
  assert.equal(result.ok, false);
  assert.match(result.error, /already been filed/);
});

test('applyPatch accepts every value in every enum it publishes', () => {
  const claim = createClaim(fixture);
  for (const type of INCIDENT_TYPES) {
    assert.equal(patch(claim, 'incident_type', type).ok, true, `${type} should be accepted`);
  }
  for (const severity of SEVERITIES) {
    assert.equal(patch(claim, 'severity', severity).ok, true, `${severity} should be accepted`);
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
  const { claim } = patch(base, 'severity', 'structural');
  const { ready, warnings } = validateClaim(claim);

  assert.equal(ready, true, 'a warning must not make a complete claim unfilable');
  assert.ok(warnings.length > 0, 'structural damage with no police reference should warn');
  assert.ok(warnings.some((w) => /police report/i.test(w)));
});

test('validateClaim spots a claim that contradicts itself', () => {
  let claim = createClaim(fixture);
  claim = patch(claim, 'severity', 'scratch').claim;
  claim = patch(claim, 'vehicle_drivable', false).claim;

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

  const severityOnly = describeClaim(patch(base, 'severity', 'dent').claim);
  assert.match(severityOnly, /impact position still to be marked/);

  const zoneOnly = describeClaim(patch(base, 'damage_zone', 4).claim);
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
  assert.throws(() => patch(null, 'severity', 'dent'), TypeError);
});

// ---------------------------------------------------------------------------
// Revision, provenance and the guard that makes a shared draft safe
//
// This is the part the whole product rests on. Two writers, one draft. The
// revision is how an agent finds out that the person on the page corrected
// something after it last looked.
// ---------------------------------------------------------------------------

test('a new claim starts at revision 0 and credits the fixture to the policy', () => {
  const claim = createClaim(fixture);

  assert.equal(claim.revision, 0);
  assert.deepEqual(claim.locked, []);
  assert.equal(provenanceOf(claim, 'incident_type'), 'policy');
  assert.equal(provenanceOf(claim, 'driver'), 'policy');
  assert.equal(provenanceOf(claim, 'severity'), null, 'an unanswered field has no source');

  for (const source of Object.values(claim.provenance)) {
    assert.ok(PROVENANCE_SOURCES.includes(source), `"${source}" is not a provenance source`);
  }
});

test('every accepted patch moves the revision by exactly one', () => {
  let claim = createClaim(fixture);
  assert.equal(claim.revision, 0);

  claim = patch(claim, 'severity', 'dent').claim;
  assert.equal(claim.revision, 1);

  claim = patch(claim, 'damage_zone', 10).claim;
  assert.equal(claim.revision, 2);
});

test('a patch carrying four fields is still one revision', () => {
  const claim = createClaim(fixture);
  const result = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'description', value: 'A van reversed into the left front wing while the car was parked.' },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.revision, 1, 'four fields, one revision');
  assert.deepEqual(result.applied, ['damage_zone', 'severity', 'vehicle_drivable', 'description']);
  assert.equal(result.claim.damage_zone, 10);
  assert.equal(result.claim.severity, 'dent');
});

// The refusal has to leave nothing behind. A batch that half applied would be
// worse than one refused outright, because the next reader could not tell which
// half landed.
test('a batch where the second change fails applies none of them', () => {
  const claim = createClaim(fixture);
  const before = snapshot(claim);

  const result = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'catastrophic' },
    { field: 'vehicle_drivable', value: true },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.value);
  assert.match(result.error, /severity/);
  assert.deepEqual(result.applied, []);
  assert.equal(result.revision, 0, 'a refused batch must not move the revision');
  assert.deepEqual(snapshot(result.claim), before, 'the first change must not have landed');
  assert.equal(result.claim.damage_zone, null);
});

test('a batch naming the same field twice is refused before anything is written', () => {
  const claim = createClaim(fixture);
  const result = applyPatch(claim, [
    { field: 'severity', value: 'dent' },
    { field: 'severity', value: 'scratch' },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.field);
  assert.match(result.error, /appears twice/);
  assert.equal(result.claim.severity, null);
});

test('an empty patch is refused rather than counted as a change', () => {
  const claim = createClaim(fixture);
  const result = applyPatch(claim, []);

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.field);
  assert.equal(result.revision, 0);
});

test('an agent patch with no baseRevision is refused as stale and told to read first', () => {
  const claim = createClaim(fixture);
  const result = patch(claim, 'severity', 'dent', { actor: 'agent' });

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.stale);
  assert.match(result.error, /baseRevision/);
  assert.match(result.error, /revision 0/);
  assert.equal(result.claim.severity, null);
});

test('a person editing the page needs no baseRevision', () => {
  const claim = createClaim(fixture);
  const result = patch(claim, 'severity', 'dent');

  assert.equal(result.ok, true);
  assert.equal(provenanceOf(result.claim, 'severity'), 'human');
});

// The demo beat, in one test. The agent reads revision 1, the claimant corrects
// the page, and the agent's patch arrives holding a number that is no longer true.
test('a stale agent patch is refused, names both revisions, and moves nothing', () => {
  let claim = createClaim(fixture);
  claim = patch(claim, 'vehicle_drivable', true).claim;
  const readByTheAgent = claim.revision;

  claim = patch(claim, 'vehicle_drivable', false).claim;
  assert.equal(claim.revision, readByTheAgent + 1);

  const before = snapshot(claim);
  const result = patch(claim, 'severity', 'scratch', {
    actor: 'agent',
    baseRevision: readByTheAgent,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.stale);
  assert.match(result.error, /expected revision 1, current revision 2/);
  assert.match(result.error, /Read the claim state again/);
  assert.deepEqual(snapshot(result.claim), before);
  assert.equal(result.claim.vehicle_drivable, false, 'the human correction stands');
});

test('an agent patch quoting the current revision is accepted and credited to the agent', () => {
  let claim = createClaim(fixture);
  claim = patch(claim, 'vehicle_drivable', true).claim;

  const result = patch(claim, 'severity', 'dent', { actor: 'agent', baseRevision: claim.revision });

  assert.equal(result.ok, true);
  assert.equal(result.revision, claim.revision + 1);
  assert.equal(provenanceOf(result.claim, 'severity'), 'agent');
  assert.equal(provenanceOf(result.claim, 'vehicle_drivable'), 'human', 'the earlier field keeps its own source');
});

test('baseRevision arrives as a string from an agent and is read as a number', () => {
  const claim = createClaim(fixture);
  const result = patch(claim, 'severity', 'dent', { actor: 'agent', baseRevision: '0' });
  assert.equal(result.ok, true);

  const nonsense = patch(claim, 'severity', 'dent', { actor: 'agent', baseRevision: 'latest' });
  assert.equal(nonsense.ok, false);
  assert.equal(nonsense.code, PATCH_CODES.stale);
});

test('an actor nobody recognises is refused before any rule runs', () => {
  const claim = createClaim(fixture);
  const result = patch(claim, 'severity', 'dent', { actor: 'insurer' });

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.value);
  assert.match(result.error, /actor must be one of: human, agent/);
});

test('clearing an optional field drops its provenance with it', () => {
  let claim = createClaim(fixture);
  claim = patch(claim, 'location', 'Car park, Harbour Road').claim;
  assert.equal(provenanceOf(claim, 'location'), 'human');

  claim = patch(claim, 'location', null).claim;
  assert.equal(claim.location, null);
  assert.equal(provenanceOf(claim, 'location'), null);
});

// ---------------------------------------------------------------------------
// Pinning: the one thing on the page no patch can argue with
// ---------------------------------------------------------------------------

test('a pinned field refuses every patch until a person unpins it', () => {
  let claim = createClaim(fixture);
  claim = patch(claim, 'vehicle_drivable', false).claim;

  const pinned = lockField(claim, 'vehicle_drivable');
  assert.equal(pinned.ok, true);
  assert.equal(isLocked(pinned.claim, 'vehicle_drivable'), true);
  assert.equal(pinned.revision, claim.revision + 1, 'pinning is a change an agent has to notice');

  const refused = patch(pinned.claim, 'vehicle_drivable', true, {
    actor: 'agent',
    baseRevision: pinned.claim.revision,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, PATCH_CODES.locked);
  assert.match(refused.error, /vehicle_drivable/);
  assert.match(refused.error, /person has to unpin it/);
  assert.equal(refused.claim.vehicle_drivable, false);

  const released = unlockField(pinned.claim, 'vehicle_drivable');
  assert.equal(released.ok, true);
  assert.equal(isLocked(released.claim, 'vehicle_drivable'), false);

  const accepted = patch(released.claim, 'vehicle_drivable', true, {
    actor: 'agent',
    baseRevision: released.claim.revision,
  });
  assert.equal(accepted.ok, true);
});

test('a pinned field blocks a whole batch, including the changes beside it', () => {
  let claim = createClaim(fixture);
  claim = patch(claim, 'severity', 'dent').claim;
  claim = lockField(claim, 'severity').claim;

  const result = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'structural' },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.locked);
  assert.equal(result.claim.damage_zone, null, 'the other change must not have landed');
});

test('pinning something twice changes nothing and does not move the revision', () => {
  let claim = createClaim(fixture);
  claim = lockField(claim, 'severity').claim;
  const again = lockField(claim, 'severity');

  assert.equal(again.ok, true);
  assert.equal(again.revision, claim.revision);
  assert.deepEqual(again.claim.locked, ['severity']);
});

test('there is nothing to pin on a field the insurer owns', () => {
  const claim = createClaim(fixture);
  const result = lockField(claim, 'status');
  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.protected);
});

// ---------------------------------------------------------------------------
// Protected paths and third party content
// ---------------------------------------------------------------------------

test('nothing derived and nothing structural is patchable, by either actor', () => {
  const claim = createClaim(fixture);
  for (const field of PROTECTED_FIELDS) {
    for (const actor of ['human', 'agent']) {
      const result = patch(claim, field, 'anything', { actor, baseRevision: claim.revision });
      assert.equal(result.ok, false, `${field} was writable by ${actor}`);
      assert.equal(result.code, PATCH_CODES.protected, `${field} refused with the wrong code`);
    }
  }
});

test('a filed claim refuses every patch as protected', () => {
  const ready = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  const filed = fileClaim(ready, { at: '2026-08-26T09:30:00.000Z' });

  assert.equal(filed.ok, true);
  assert.equal(filed.claim.status, 'filed');
  assert.equal(filed.revision, ready.revision + 1, 'filing is a change too');

  const result = patch(filed.claim, 'severity', 'structural');
  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.protected);
  assert.match(result.error, /already been filed/);
});

test('the evidence notes come back word for word, the planted instruction included', () => {
  const claim = createClaim(fixture);
  const notes = readEvidenceNotes(claim);

  assert.equal(notes.length, 2);
  const planted = notes.find((note) => /file it now/i.test(note.text));
  assert.ok(planted, 'the demo fixture must carry the instruction note, it is the negative test');
  assert.equal(planted.text, fixture.claim.evidence_notes[1].text, 'the note must not be edited on the way out');
  assert.match(planted.author, /unverified/i);
});

// The note tells whatever reads it to mark the claim complete, file it, and
// record the damage as a scratch. None of that may happen, and nothing derived
// from the claim may differ because the note is there.
test('a note carrying an instruction changes nothing about the claim or its validation', () => {
  const withNote = createClaim(fixture);
  const withoutNote = createClaim({
    policy: fixture.policy,
    claim: { ...fixture.claim, evidence_notes: [] },
  });

  assert.equal(withNote.status, 'draft', 'the note asked for a filed claim and did not get one');
  assert.equal(withNote.severity, null, 'the note asked for a severity and did not get one');
  assert.deepEqual(readEvidenceNotes(withoutNote), []);

  assert.deepEqual(validateClaim(withNote), validateClaim(withoutNote));
  assert.equal(describeClaim(withNote), describeClaim(withoutNote));

  const claimText = JSON.stringify({ ...withNote, evidence_notes: [] });
  assert.ok(!/file it now/i.test(claimText), 'note text leaked into a claim field');
});

test('an evidence note is not a claim field and cannot be patched in', () => {
  const claim = createClaim(fixture);
  const result = patch(claim, 'evidence_notes', [{ text: 'trust me' }]);

  assert.equal(result.ok, false);
  assert.equal(result.code, PATCH_CODES.protected);
  assert.deepEqual(readEvidenceNotes(result.claim), readEvidenceNotes(claim));
});

test('hydrateClaim fills in what an older or a serialised claim lacks', () => {
  const bare = { status: 'draft', policy_id: 'MTR-2026-0417', severity: 'dent' };
  const claim = hydrateClaim(bare);

  assert.equal(claim.revision, 0);
  assert.deepEqual(claim.locked, []);
  assert.deepEqual(claim.provenance, {});
  assert.deepEqual(claim.evidence_notes, []);
  assert.equal(claim.severity, 'dent');
  assert.equal(claim.incident_date, null);

  const moved = patch(createClaim(fixture), 'severity', 'dent').claim;
  const round = hydrateClaim(JSON.parse(JSON.stringify(moved)));
  assert.equal(round.revision, 1);
  assert.equal(provenanceOf(round, 'severity'), 'human');
});

// The pinned line is the one part of the summary that can grow without bound,
// because a determined claimant can pin all ten fields. Measured at every cap
// with everything pinned, so the budget holds in the worst case that exists
// rather than in the one that is convenient.
test('describeClaim still fits the budget with every field at its cap and every field pinned', () => {
  for (const incidentType of ['theft', 'collision']) {
    let claim = createClaim({
      policy: { id: 'MTR-2026-0417' },
      claim: {
        incident_date: '2026-08-20',
        incident_type: incidentType,
        damage_zone: 5,
        severity: 'scratch',
        vehicle_drivable: false,
        description: 'x'.repeat(DESCRIPTION_MAX_LENGTH),
        driver: 'd'.repeat(80),
        location: 'l'.repeat(120),
        police_report_ref: 'p'.repeat(40),
        witness_name: 'w'.repeat(80),
      },
    });
    for (const field of PATCHABLE_FIELDS) claim = lockField(claim, field).claim;

    const text = describeClaim(claim);
    assert.equal(claim.locked.length, PATCHABLE_FIELDS.length);
    assert.ok(
      text.length <= DESCRIBE_MAX_LENGTH,
      `describeClaim returned ${text.length} characters, the cap is ${DESCRIBE_MAX_LENGTH}`,
    );
    assert.ok(!text.endsWith('...'), `describeClaim had to truncate at ${text.length} characters`);
    assert.match(text, /Pinned by the claimant/);
    assert.match(text, /and 8 more/);
    assert.match(text, /ready for the policyholder to file|Still needed before filing/);
  }
});

test('describeClaim states the revision an agent has to quote back', () => {
  const claim = createClaim(fixture);
  assert.match(describeClaim(claim), /revision 0/);

  const moved = patch(claim, 'severity', 'dent').claim;
  assert.match(describeClaim(moved), /revision 1/);
});

// ---------------------------------------------------------------------------
// A batch is one revision, so what it requires is read off where it ENDS
//
// Turning a collision into a theft means two things at once: the type changes and
// the impact position goes away, because a stolen car has no impact position and
// both packs say so. Sent as the atomic patch this API exists for, it was refused
// in BOTH orders, because pass one asked requiredFieldsFor about the claim on the
// way IN, which was still a collision. The same two changes sent one after the
// other were both accepted. The atomic path was strictly weaker than the
// sequential one at the exact moment atomicity was worth having.
// ---------------------------------------------------------------------------

test('a batch that turns a collision into a theft may clear the impact position, in either order', () => {
  const collision = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  assert.equal(collision.incident_type, 'collision');
  assert.equal(collision.damage_zone, 10);

  const typeFirst = applyPatch(collision, [
    { field: 'incident_type', value: 'theft' },
    { field: 'damage_zone', value: null },
  ]);
  assert.equal(typeFirst.ok, true, `refused: ${typeFirst.error}`);
  assert.equal(typeFirst.claim.incident_type, 'theft');
  assert.equal(typeFirst.claim.damage_zone, null);
  assert.equal(typeFirst.revision, collision.revision + 1, 'two changes, one revision');
  assert.deepEqual([...typeFirst.applied].sort(), ['damage_zone', 'incident_type']);

  const clearFirst = applyPatch(collision, [
    { field: 'damage_zone', value: null },
    { field: 'incident_type', value: 'theft' },
  ]);
  assert.equal(clearFirst.ok, true, `refused: ${clearFirst.error}`);
  assert.equal(clearFirst.claim.damage_zone, null);

  // The order the changes arrive in cannot change the answer.
  assert.deepEqual(snapshot(typeFirst.claim), snapshot(clearFirst.claim));

  // And the atomic path now agrees with the sequential one, which always worked.
  const sequential = applyPatch(
    applyPatch(collision, { field: 'incident_type', value: 'theft' }).claim,
    { field: 'damage_zone', value: null },
  ).claim;
  assert.equal(sequential.damage_zone, null);
  assert.equal(sequential.incident_type, 'theft');
});

test('a claim that is still a collision at the end of the patch keeps its impact position', () => {
  const collision = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));

  // On its own: nothing about the claim changed, so the field is still required.
  const alone = patch(collision, 'damage_zone', null);
  assert.equal(alone.ok, false);
  assert.equal(alone.code, PATCH_CODES.value);
  assert.match(alone.error, /damage_zone is required/);
  assert.equal(alone.claim.damage_zone, 10, 'nothing was written');
  assert.equal(alone.revision, collision.revision, 'a refused patch does not move the revision');

  // Beside a change that leaves it a collision: still required, still refused.
  const beside = applyPatch(collision, [
    { field: 'severity', value: 'structural' },
    { field: 'damage_zone', value: null },
  ]);
  assert.equal(beside.ok, false);
  assert.equal(beside.code, PATCH_CODES.value);
  assert.equal(beside.claim.severity, 'dent', 'the whole batch is refused, not part of it');
  assert.equal(beside.claim.damage_zone, 10);

  // Changing the type to another kind that is asked for a position: still refused.
  const glass = applyPatch(collision, [
    { field: 'incident_type', value: 'glass' },
    { field: 'damage_zone', value: null },
  ]);
  assert.equal(glass.ok, false);
  assert.equal(glass.code, PATCH_CODES.value);
  assert.equal(glass.claim.incident_type, 'collision', 'nothing was written');

  // And a theft claim going back to a collision cannot arrive without one either.
  const theft = applyPatch(collision, [
    { field: 'incident_type', value: 'theft' },
    { field: 'damage_zone', value: null },
  ]).claim;
  const back = patch(theft, 'incident_type', 'collision');
  assert.equal(back.ok, true, 'the type itself may change');
  assert.deepEqual(validateClaim(back.claim).missing, ['damage_zone'], 'and the position is asked for again');
});

test('a required field can never be cleared by a batch, whatever else is in it', () => {
  const collision = createClaim(fixture.scenarios.find((s) => s.id === 'covered-collision'));
  for (const field of ['incident_date', 'severity', 'vehicle_drivable', 'description']) {
    const result = applyPatch(collision, [
      { field: 'incident_type', value: 'theft' },
      { field, value: null },
    ]);
    assert.equal(result.ok, false, `${field} was cleared by a batch`);
    assert.equal(result.code, PATCH_CODES.value);
    assert.match(result.error, new RegExp(`${field} is required`));
    assert.equal(result.claim.incident_type, 'collision', 'and nothing beside it landed either');
  }
});

// ---------------------------------------------------------------------------
// The same value, twice
//
// A page control can hand the store the same answer twice over: a keystroke timer
// commits it, then the change event commits it again on the way out of the field.
// Both are accepted, so the revision moves twice and the second one re-stamps
// provenance over a draft nobody moved. patchIsNoChange is how a caller tells the
// two apart without coercing anything itself.
// ---------------------------------------------------------------------------

test('patchIsNoChange sees through the coercions a patch would apply', () => {
  const claim = applyPatch(createClaim(fixture), [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'description', value: 'A van reversed into the wing.' },
  ]).claim;

  assert.equal(patchIsNoChange(claim, { field: 'damage_zone', value: '10' }), true, 'a numeric string');
  assert.equal(patchIsNoChange(claim, { field: 'severity', value: ' DENT ' }), true, 'case and padding');
  assert.equal(patchIsNoChange(claim, { field: 'vehicle_drivable', value: 'yes' }), true, 'a boolean word');
  assert.equal(
    patchIsNoChange(claim, { field: 'description', value: '  A van reversed into the wing.  ' }),
    true,
    'the exact double commit a textarea produces',
  );
  assert.equal(
    patchIsNoChange(claim, [{ field: 'damage_zone', value: '10' }, { field: 'severity', value: 'dent' }]),
    true,
  );

  assert.equal(patchIsNoChange(claim, { field: 'damage_zone', value: 11 }), false, 'a real edit');
  assert.equal(patchIsNoChange(claim, { field: 'location', value: 'Harbour Road' }), false, 'an empty field filled');
  assert.equal(
    patchIsNoChange(claim, [{ field: 'damage_zone', value: 10 }, { field: 'severity', value: 'scratch' }]),
    false,
    'one real change in a batch makes the batch a change',
  );
});

test('patchIsNoChange keeps every refusal reachable', () => {
  const claim = applyPatch(createClaim(fixture), { field: 'severity', value: 'dent' }).claim;

  // A value the rules would refuse is not silence. The page has to dispatch it so
  // the refusal is drawn beside the control.
  assert.equal(patchIsNoChange(claim, { field: 'severity', value: 'catastrophic' }), false);
  assert.equal(patchIsNoChange(claim, { field: 'damage_zone', value: 14 }), false);
  assert.equal(patchIsNoChange(claim, { field: 'settlement_amount', value: 1 }), false);
  assert.equal(patchIsNoChange(claim, { field: 'revision', value: 0 }), false);
  assert.equal(patchIsNoChange(claim, []), false);

  // Clearing a required field that already holds a value is a refusal, not silence.
  assert.equal(patchIsNoChange(claim, { field: 'severity', value: null }), false);
  // Clearing an empty optional field really does nothing.
  assert.equal(patchIsNoChange(claim, { field: 'witness_name', value: null }), true);

  // A pinned field and a filed claim both have something to say, so neither is silence.
  const pinned = lockField(claim, 'severity').claim;
  assert.equal(patchIsNoChange(pinned, { field: 'severity', value: 'dent' }), false);
  assert.equal(patchIsNoChange({ ...claim, status: 'filed' }, { field: 'severity', value: 'dent' }), false);
});

test('patchIsNoChange never writes anything or moves the revision', () => {
  const claim = applyPatch(createClaim(fixture), { field: 'severity', value: 'dent' }).claim;
  const before = snapshot(claim);
  patchIsNoChange(claim, { field: 'severity', value: 'dent' });
  patchIsNoChange(claim, { field: 'severity', value: 'scratch' });
  assert.deepEqual(snapshot(claim), before);
});
