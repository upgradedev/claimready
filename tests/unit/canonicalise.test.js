/**
 * The canonical form the digest is taken over, tested on its own.
 *
 * WHY IT NEEDED A FILE OF ITS OWN. Every other packet test reaches `canonicalise` through a whole
 * built packet, so the only key names it ever sees are the ones src/core/packet.js writes. That is
 * the wrong shape for this function: it is a general JSON walker, a handler receives a packet as
 * bytes, and the question that matters is whether two different documents can come out of it as one
 * string. They could.
 *
 * THE DEFECT THIS FILE WAS WRITTEN FOR. The walker built each level into a plain `{}`, so assigning
 * a key named `__proto__` hit the Object.prototype setter instead of creating an own property, and
 * JSON.stringify never saw it. Measured before the fix, on two objects parsed from different JSON:
 *
 *   own __proto__ on a: true
 *   canonical a: "{\n  \"reference\": \"CR-1\"\n}\n"
 *   canonical b: "{\n  \"reference\": \"CR-1\"\n}\n"
 *   same canonical: true
 *   same digest: true
 *
 * Two documents, one digest. A packet carrying that key would verify against a packet without it,
 * which is the one property the digest exists to provide.
 *
 * A NOTE ON THE FIXTURES. Every `__proto__` case below is built with JSON.parse, and each one
 * asserts `Object.hasOwn` before it asserts anything else. A source literal `{ __proto__: 'x' }`
 * triggers the same setter and creates no own key, so a fixture written that way would pass against
 * the broken code and report a defect that is not there.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalise, digestOf } from '../../src/core/packet.js';

/* --------------------------------------------------------------- the key that used to vanish */

test('an own __proto__ key survives canonicalisation at the top level', () => {
  const carrier = JSON.parse('{"__proto__": "stolen", "reference": "CR-1"}');
  assert.equal(Object.hasOwn(carrier, '__proto__'), true, 'the fixture has to hold the key itself');

  const plain = JSON.parse('{"reference": "CR-1"}');
  assert.notEqual(canonicalise(carrier), canonicalise(plain),
    'two different documents canonicalise to one string');
  assert.match(canonicalise(carrier), /"__proto__": "stolen"/);
});

test('an own __proto__ key survives inside a nested object', () => {
  const carrier = JSON.parse('{"policy": {"__proto__": "stolen", "number": "MTR-1"}}');
  assert.equal(Object.hasOwn(carrier.policy, '__proto__'), true, 'the fixture has to hold the key itself');

  const plain = JSON.parse('{"policy": {"number": "MTR-1"}}');
  assert.notEqual(canonicalise(carrier), canonicalise(plain));
  assert.match(canonicalise(carrier), /"__proto__": "stolen"/);
});

test('an own __proto__ key survives inside an object in an array', () => {
  const carrier = JSON.parse('{"tool_calls": [{"__proto__": "stolen", "tool": "read_claim_state"}]}');
  assert.equal(Object.hasOwn(carrier.tool_calls[0], '__proto__'), true,
    'the fixture has to hold the key itself');

  const plain = JSON.parse('{"tool_calls": [{"tool": "read_claim_state"}]}');
  assert.notEqual(canonicalise(carrier), canonicalise(plain));
});

test('two documents that differ only by an own __proto__ key get different digests', async () => {
  const carrier = JSON.parse('{"__proto__": "stolen", "reference": "CR-1"}');
  const plain = JSON.parse('{"reference": "CR-1"}');

  assert.notEqual(
    await digestOf(canonicalise(carrier)),
    await digestOf(canonicalise(plain)),
    'a packet carrying this key verifies against a packet without it',
  );
});

test('the canonical string is still parseable JSON when it carries __proto__', () => {
  // The round trip matters as much as the bytes. A verifier reads the file with JSON.parse, and
  // JSON.parse puts the key back as an own property rather than on the prototype, so a second pass
  // through canonicalise gives the same string. That is what makes the digest checkable twice.
  const carrier = JSON.parse('{"__proto__": "stolen", "reference": "CR-1"}');
  const once = canonicalise(carrier);
  const again = canonicalise(JSON.parse(once));

  assert.equal(again, once);
  assert.equal(Object.hasOwn(JSON.parse(once), '__proto__'), true);
});

/* ------------------------------------------------------------------- the properties it promises */

test('keys are sorted at every level, so insertion order cannot move the digest', () => {
  assert.equal(canonicalise({ b: 1, a: 2 }), canonicalise({ a: 2, b: 1 }));
  assert.equal(
    canonicalise({ outer: { z: 1, a: 2 }, first: [{ y: 1, b: 2 }] }),
    canonicalise({ first: [{ b: 2, y: 1 }] , outer: { a: 2, z: 1 } }),
  );
  assert.match(canonicalise({ b: 1, a: 2 }), /^\{\n {2}"a": 2,\n {2}"b": 1\n\}\n$/);
});

test('array order is content, so it is never sorted', () => {
  assert.notEqual(canonicalise({ calls: ['a', 'b'] }), canonicalise({ calls: ['b', 'a'] }));
});

test('an undefined value is dropped, and an explicit null is kept', () => {
  assert.equal(canonicalise({ a: 1, b: undefined }), canonicalise({ a: 1 }));
  assert.notEqual(canonicalise({ a: 1, b: null }), canonicalise({ a: 1 }));
  assert.match(canonicalise({ a: 1, b: null }), /"b": null/);
});

test('an undefined value is dropped at every depth, not only the top', () => {
  assert.equal(
    canonicalise({ policy: { number: 'MTR-1', insurer: undefined } }),
    canonicalise({ policy: { number: 'MTR-1' } }),
  );
});

test('the string ends in one line feed, because the digest is over those exact bytes', () => {
  const canonical = canonicalise({ a: 1 });
  assert.equal(canonical.endsWith('}\n'), true);
  assert.equal(canonical.includes('\r'), false, 'a carriage return would change the digest');
});

/**
 * Changing any single value moves the digest.
 *
 * WHAT THIS IS AND IS NOT. It walks an enumerated list of paths through a packet shaped document
 * and asserts that editing each one gives a different digest. That is coverage over those paths.
 * It is not a claim that SHA-256 has no collisions, and no test here could be.
 */
test('changing any one value in the document changes the digest', async () => {
  const original = () => JSON.parse(JSON.stringify({
    kind: 'claimready.fnol.packet',
    version: 2,
    synthetic: true,
    reference: 'CR-MTR-2026-0417-R4',
    filed: { at: '2026-09-01T09:15:00.000Z', revision: 4, through: 'a control on the page.' },
    policy: { number: 'MTR-2026-0417', insurer: 'Northwind Mutual', pack_id: 'northwind' },
    claim: { severity: { label: 'how bad the damage is', value: 'dent' } },
    provenance: { severity: 'via tool' },
    pinned_by_the_claimant: ['vehicle_drivable'],
    coverage: { covered: true, provisional: false, clause: 'OD-4.1', deductible: 250, exclusions: [] },
    requirements: [{ id: 'date_of_loss', satisfied: true }],
    human_actions_completed: ['roadside_collection'],
    tool_calls: [{ at: '09:12:10', tool: 'read_claim_state', refused: false, code: null }],
  }));

  const edits = [
    ['version', (doc) => { doc.version = 3; }],
    ['synthetic', (doc) => { doc.synthetic = false; }],
    ['reference', (doc) => { doc.reference = 'CR-MTR-2026-0417-R5'; }],
    ['filed.at', (doc) => { doc.filed.at = '2026-09-01T09:15:00.001Z'; }],
    ['filed.revision', (doc) => { doc.filed.revision = 5; }],
    ['policy.number', (doc) => { doc.policy.number = 'MTR-2026-0418'; }],
    ['policy.insurer', (doc) => { doc.policy.insurer = 'Kestrel Assurance'; }],
    ['claim value', (doc) => { doc.claim.severity.value = 'scrape'; }],
    ['claim label', (doc) => { doc.claim.severity.label = 'how bad it is'; }],
    ['provenance', (doc) => { doc.provenance.severity = 'via page'; }],
    ['pinned rows', (doc) => { doc.pinned_by_the_claimant = []; }],
    ['coverage.covered', (doc) => { doc.coverage.covered = false; }],
    ['coverage.deductible', (doc) => { doc.coverage.deductible = 0; }],
    ['coverage.clause', (doc) => { doc.coverage.clause = 'OD-4.2'; }],
    ['a requirement', (doc) => { doc.requirements[0].satisfied = false; }],
    ['a human action', (doc) => { doc.human_actions_completed = []; }],
    ['a tool call', (doc) => { doc.tool_calls[0].refused = true; }],
    ['a new key', (doc) => { doc.settlement = 'approved'; }],
    ['a removed key', (doc) => { delete doc.synthetic; }],
  ];

  const before = await digestOf(canonicalise(original()));
  for (const [what, edit] of edits) {
    const document = original();
    edit(document);
    assert.notEqual(await digestOf(canonicalise(document)), before,
      `${what} moved without moving the digest`);
  }
});
