import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createStore } from '../../src/core/store.js';
import { createClaim, validateClaim, PATCHABLE_FIELDS } from '../../src/core/claim.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { FILE_CODES } from '../../src/core/filing.js';

const FIXTURE_URL = new URL('../../fixtures/demo-collision.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

/**
 * The insurer rules the file action is decided against.
 *
 * The action carries them, because the gate in src/core/filing.js reads them and this store holds
 * no browser state. It used to carry nothing, so the domain decided filing on the static required
 * list and the insurer's own open requirements never reached it.
 */
const PACK_URL = new URL('../../fixtures/insurers/northwind.json', import.meta.url);
const pack = loadPolicyPack(JSON.parse(readFileSync(PACK_URL, 'utf8')));

/**
 * File the way the page does, with the rules, the human actions and the home insurer on the action.
 *
 * `homePackId` is on here for the same reason `pack` is. A filing asserts that this claim went to
 * this insurer, so the gate refuses one that cannot name which insurer that is, and an action
 * without it is not the action the page dispatches.
 */
/**
 * A filing time the store will accept, for the tests that are about something else.
 *
 * Every filing carries one now, so a helper that left it out would be testing the timestamp
 * refusal in fifteen places by accident.
 */
const FILED_AT = '2026-08-26T09:30:00.000Z';

function file(store, at = FILED_AT) {
  return store.dispatch({ type: 'file', at, pack, completedHumanActions: [], homePackId: 'northwind' });
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A store on a draft that is ready to file, on the policy the sample file names.
 *
 * The scenario carries claim fields and no policy number, which is right for a scenario. A filing
 * is a statement about one policy, so it is refused without one, and the store the page builds is
 * seeded from the whole sample file rather than from a scenario alone.
 */
function readyStore() {
  const scenario = fixture.scenarios.find((s) => s.id === 'covered-collision');
  return createStore({ policy: fixture.policy, claim: scenario.claim });
}

test('a store can be built from the fixture, from a scenario, or from a claim', () => {
  assert.equal(createStore(fixture).getState().claim.policy_id, 'MTR-2026-0417');
  assert.equal(createStore(fixture.scenarios[0]).getState().claim.incident_type, 'collision');

  const claim = createClaim(fixture);
  assert.equal(createStore(claim).getState().claim.severity, null);
});

test('the store starts on the fixture draft with nothing gone wrong yet', () => {
  const store = createStore(fixture);
  const state = store.getState();

  assert.equal(state.claim.incident_type, 'collision');
  assert.equal(state.claim.status, 'draft');
  assert.equal(state.lastError, null);
});

test('a patch updates the claim and tells every subscriber, synchronously', () => {
  const store = createStore(fixture);
  const seen = [];
  store.subscribe((state) => seen.push(state.claim.severity));

  const result = store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(store.getState().claim.severity, 'dent');
  assert.deepEqual(seen, ['dent'], 'the listener must have run before dispatch returned');
});

// The store must not carry its own copy of the rules. It delegates, so an agent
// cannot get through the store what applyPatch would have refused.
test('a rejected patch leaves the claim exactly as it was', () => {
  const store = createStore(fixture);
  const before = snapshot(store.getState().claim);

  const unknown = store.dispatch({ type: 'patch', field: 'payout_amount', value: 9999 });
  assert.equal(unknown.ok, false);
  assert.deepEqual(snapshot(store.getState().claim), before);

  const outOfRange = store.dispatch({ type: 'patch', field: 'damage_zone', value: 13 });
  assert.equal(outOfRange.ok, false);
  assert.deepEqual(snapshot(store.getState().claim), before);

  const readOnly = store.dispatch({ type: 'patch', field: 'status', value: 'filed' });
  assert.equal(readOnly.ok, false);
  assert.equal(store.getState().claim.status, 'draft');
});

test('a rejected patch records why, and the next good patch clears it', () => {
  const store = createStore(fixture);

  store.dispatch({ type: 'patch', field: 'damage_zone', value: 99 });
  assert.match(store.getState().lastError, /damage_zone/);

  store.dispatch({ type: 'patch', field: 'damage_zone', value: 4 });
  assert.equal(store.getState().lastError, null);
});

test('a rejected patch still notifies, so the page can show the reason', () => {
  const store = createStore(fixture);
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });

  store.dispatch({ type: 'patch', field: 'damage_zone', value: 99 });
  assert.equal(calls, 1);
});

test('the store coerces the strings an agent sends, through the same one rule set', () => {
  const store = createStore(fixture);
  store.dispatch({ type: 'patch', field: 'damage_zone', value: '10' });
  store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: 'true' });

  assert.equal(store.getState().claim.damage_zone, 10);
  assert.equal(store.getState().claim.vehicle_drivable, true);
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

test('unsubscribing one listener leaves the others running', () => {
  const store = createStore(fixture);
  let first = 0;
  let second = 0;

  const stopFirst = store.subscribe(() => {
    first += 1;
  });
  store.subscribe(() => {
    second += 1;
  });

  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  assert.equal(first, 1);
  assert.equal(second, 1);

  stopFirst();
  store.dispatch({ type: 'patch', field: 'severity', value: 'scratch' });
  assert.equal(first, 1, 'the unsubscribed listener ran again');
  assert.equal(second, 2, 'the remaining listener stopped running');
});

test('a listener may unsubscribe itself in the middle of a notification', () => {
  const store = createStore(fixture);
  let firstCalls = 0;
  let secondCalls = 0;

  const stopFirst = store.subscribe(() => {
    firstCalls += 1;
    stopFirst();
  });
  store.subscribe(() => {
    secondCalls += 1;
  });

  assert.doesNotThrow(() => store.dispatch({ type: 'patch', field: 'severity', value: 'dent' }));
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1, 'removing a listener mid loop skipped the next one');
});

test('unsubscribing twice is harmless', () => {
  const store = createStore(fixture);
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });

  stop();
  stop();

  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  assert.equal(calls, 0);
});

test('subscribe insists on a function', () => {
  const store = createStore(fixture);
  assert.throws(() => store.subscribe('not a function'), TypeError);
  assert.throws(() => store.subscribe(), TypeError);
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

/**
 * The draft goes back and the counter does not, so the two are asserted apart.
 *
 * `snapshot` is the whole claim, revision included, and comparing the whole thing
 * is what these tests were doing. Loosening that comparison to make a reset pass
 * would have thrown away the check that the draft really is restored, so the claim
 * is compared field by field and the revision is asserted separately, in the
 * direction it is now required to move.
 */
function fieldsOnly(claim) {
  const out = {};
  for (const field of [...PATCHABLE_FIELDS, 'status', 'filed_at', 'policy_id', 'reference']) {
    out[field] = claim[field];
  }
  out.provenance = snapshot(claim.provenance);
  out.locked = snapshot(claim.locked);
  out.evidence_notes = snapshot(claim.evidence_notes);
  return out;
}

test('reset puts the draft back to how the fixture left it', () => {
  const store = createStore(fixture);
  const before = fieldsOnly(store.getState().claim);

  store.dispatch({ type: 'patch', field: 'severity', value: 'structural' });
  store.dispatch({ type: 'patch', field: 'damage_zone', value: 7 });
  assert.notDeepEqual(fieldsOnly(store.getState().claim), before);
  const movedTo = store.getState().claim.revision;

  const result = store.dispatch({ type: 'reset' });
  assert.equal(result.ok, true);
  assert.deepEqual(fieldsOnly(store.getState().claim), before);
  assert.equal(store.getState().lastError, null);

  // Everything but the number. A reset that rewound it would hand a second draft
  // the same revision an agent has already read.
  assert.ok(
    store.getState().claim.revision > movedTo,
    `the reset went back to revision ${store.getState().claim.revision} from ${movedTo}`,
  );
});

test('reset survives being run more than once', () => {
  const store = createStore(fixture);
  const before = fieldsOnly(store.getState().claim);
  const seen = [store.getState().claim.revision];

  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  store.dispatch({ type: 'reset' });
  seen.push(store.getState().claim.revision);
  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  store.dispatch({ type: 'reset' });
  seen.push(store.getState().claim.revision);

  assert.deepEqual(fieldsOnly(store.getState().claim), before);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), `the counter went backwards: ${seen.join(', ')}`);
  assert.equal(new Set(seen).size, seen.length, `a revision was reused: ${seen.join(', ')}`);
});

// ---------------------------------------------------------------------------
// The reset hole, reproduced then closed
//
// An agent reads revision 0. The person on the page edits, and the draft moves to
// revision 1. The person then presses Load synthetic incident, which threw the
// edit away AND put the counter back to 0. The agent's patch, quoting the 0 it
// read, was then accepted against a draft that was not the one it had read, and
// the stale check, which exists for exactly this, saw two equal numbers and waved
// it through. Same number, different draft: the classic shape of it.
// ---------------------------------------------------------------------------

test('a patch quoting a revision from before a reset is refused as stale', () => {
  const store = createStore(fixture);
  const readAt = store.getState().claim.revision;

  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  store.dispatch({ type: 'reset' });

  const stale = store.dispatch({
    type: 'patch',
    changes: [{ field: 'severity', value: 'structural' }],
    actor: 'agent',
    baseRevision: readAt,
  });

  assert.equal(stale.ok, false, 'the stale patch was accepted against a draft it never read');
  assert.equal(stale.code, 'PATCH_REJECTED_STALE');
  assert.match(stale.error, new RegExp(`expected revision ${readAt}`));
  assert.equal(store.getState().claim.severity, null, 'nothing was written');

  // And the agent that reads again is not stuck: the current number works.
  const fresh = store.dispatch({
    type: 'patch',
    changes: [{ field: 'severity', value: 'structural' }],
    actor: 'agent',
    baseRevision: store.getState().claim.revision,
  });
  assert.equal(fresh.ok, true, fresh.error);
  assert.equal(store.getState().claim.severity, 'structural');
});

// ---------------------------------------------------------------------------
// file
//
// Filing is the human-only action. It is dispatched by the page's own button and
// is deliberately never registered as a WebMCP tool, so an agent that has been
// talked into filing a claim has nothing to call.
// ---------------------------------------------------------------------------

test('an incomplete claim cannot be filed, and it says what is missing', () => {
  const store = createStore(fixture);

  const result = file(store);

  assert.equal(result.ok, false);
  assert.equal(result.code, FILE_CODES.incomplete);
  assert.match(result.error, /^Still needed before you can file: /);
  assert.match(result.error, /where the impact was/);
  assert.equal(store.getState().claim.status, 'draft');
});

// FAIL CLOSED. The action used to carry no rules at all, so this was the only path there was and
// it filed. With none it now refuses, deterministically, and says why rather than falling back to
// the static field list, which is the list that could not see the insurer's own requirements.
test('a file action carrying no rule pack is refused rather than decided without one', () => {
  const store = readyStore();
  assert.equal(validateClaim(store.getState().claim).ready, true, 'every required field is filled');

  const result = store.dispatch({ type: 'file', at: '2026-08-26T09:30:00.000Z', homePackId: 'northwind' });

  assert.equal(result.ok, false);
  assert.equal(result.code, FILE_CODES.noPack);
  assert.match(result.error, /^The insurer rule pack did not load/);
  assert.equal(store.getState().claim.status, 'draft');
  assert.equal(store.getState().claim.revision, 0, 'a refusal moves nothing');
});

// The other half of the same rule: rules that load but ask for something still open.
test('an open intake requirement refuses the filing, with the requirement code', () => {
  const store = readyStore();
  const kestrel = loadPolicyPack(JSON.parse(readFileSync(
    new URL('../../fixtures/insurers/kestrel.json', import.meta.url), 'utf8',
  )));

  // Kestrel asks a collision claimant for a witness. Northwind does not, and this claim names none.
  // The claim is read as a Kestrel policy here, because a borrowed pack is refused on identity
  // before any intake question is reached and that refusal is another file's subject.
  const result = store.dispatch({
    type: 'file', at: '2026-08-26T09:30:00.000Z', pack: kestrel, homePackId: 'kestrel',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, FILE_CODES.requirements);
  assert.match(result.error, /still asks for: The name of a witness to the collision/);
  assert.equal(store.getState().claim.status, 'draft');
});

test('a complete claim files, and the claim locks once it has', () => {
  const store = readyStore();
  assert.equal(validateClaim(store.getState().claim).ready, true);

  const result = file(store, '2026-08-26T09:30:00.000Z');

  assert.equal(result.ok, true);
  assert.equal(store.getState().claim.status, 'filed');
  assert.equal(store.getState().claim.filed_at, '2026-08-26T09:30:00.000Z');
});

/**
 * THIS TEST USED TO SAY THE OPPOSITE, AND WHAT IT PINNED WAS THE HOLE.
 *
 * It read "filing works without a timestamp, which stays null rather than invented", and it was
 * right that nothing may be invented. It was wrong about what the other option is. A filed claim
 * with `filed_at: null` is a state nothing downstream can answer for: the packet writes "Filed at
 * not recorded" under a digest, the page prints "Filed at null", and `hydrateClaim` reads the whole
 * thing back as a draft because a filing with no time on it is not one anybody can stand behind.
 * So the store produced a state that only one of its three readers could handle.
 *
 * Refusing is the third option, and it is the one that keeps both halves: nothing is invented and
 * no unanswerable state is written. The clock lives in src/ui/app.js, which is the only layer
 * allowed one.
 */
test('a filing with no time on it is refused, and the draft is left exactly as it was', () => {
  const store = readyStore();
  const before = snapshot(store.getState().claim);

  // Dispatched directly, with no `at` on the action at all. The helper above defaults one, and a
  // default is exactly what this test must not be reading.
  const result = store.dispatch({
    type: 'file', pack, completedHumanActions: [], homePackId: 'northwind',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, FILE_CODES.noFilingTime);
  assert.match(result.error, /full UTC instant/);
  assert.deepEqual(snapshot(store.getState().claim), before, 'a refused filing changes nothing');
  assert.equal(store.getState().claim.status, 'draft');
  assert.equal(store.getState().claim.filed_at, null);
});

test('a filed claim cannot be filed again or edited afterwards', () => {
  const store = readyStore();
  file(store);

  const again = file(store);
  assert.equal(again.ok, false);
  assert.equal(again.code, FILE_CODES.alreadyFiled);
  assert.match(again.error, /already been filed/);

  const edit = store.dispatch({ type: 'patch', field: 'severity', value: 'structural' });
  assert.equal(edit.ok, false);
  assert.equal(store.getState().claim.severity, 'dent');
});

test('filing tells the subscribers', () => {
  const store = readyStore();
  const seen = [];
  store.subscribe((state) => seen.push(state.claim.status));

  file(store);
  assert.deepEqual(seen, ['filed']);
});

// ---------------------------------------------------------------------------
// unknown actions
// ---------------------------------------------------------------------------

test('an unknown action changes nothing, notifies nobody, and does not throw', () => {
  const store = createStore(fixture);
  const before = store.getState();
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });

  for (const action of [{ type: 'delete_claim' }, { type: '' }, {}, null, undefined]) {
    let result;
    assert.doesNotThrow(() => {
      result = store.dispatch(action);
    }, `dispatch(${JSON.stringify(action)}) threw`);
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown action type/);
  }

  assert.equal(store.getState(), before, 'state should be the very same object');
  assert.equal(calls, 0, 'an unknown action must not wake the subscribers');
});

test('two stores built from one fixture do not share a claim', () => {
  const a = createStore(fixture);
  const b = createStore(fixture);

  a.dispatch({ type: 'patch', field: 'severity', value: 'structural' });

  assert.equal(a.getState().claim.severity, 'structural');
  assert.equal(b.getState().claim.severity, null, 'the two stores share state');
});

test('the fixture object itself is never written to', () => {
  const before = JSON.stringify(fixture);
  const store = createStore(fixture);

  store.dispatch({ type: 'patch', field: 'severity', value: 'structural' });
  store.dispatch({ type: 'reset' });

  assert.equal(JSON.stringify(fixture), before);
});

// ---------------------------------------------------------------------------
// One draft, two writers
//
// The store is where the page and the agent meet. Everything below is about
// what happens when both of them write to the same claim.
// ---------------------------------------------------------------------------

test('the store carries the revision, and a page edit moves it by one', () => {
  const store = createStore(fixture);
  assert.equal(store.getState().claim.revision, 0);

  const result = store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  assert.equal(result.revision, 1);
  assert.equal(store.getState().claim.revision, 1);
  assert.deepEqual(result.applied, ['severity']);
});

test('a page edit is a human edit, and a tool patch is an agent edit', () => {
  const store = createStore(fixture);

  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  assert.equal(store.getState().claim.provenance.severity, 'human');

  store.dispatch({
    type: 'patch',
    field: 'damage_zone',
    value: 10,
    actor: 'agent',
    baseRevision: store.getState().claim.revision,
  });
  assert.equal(store.getState().claim.provenance.damage_zone, 'agent');
  assert.equal(store.getState().claim.provenance.severity, 'human', 'the earlier field kept its source');
});

test('an agent patch through the store must quote the revision it read', () => {
  const store = createStore(fixture);

  const blind = store.dispatch({ type: 'patch', field: 'severity', value: 'dent', actor: 'agent' });
  assert.equal(blind.ok, false);
  assert.equal(blind.code, 'PATCH_REJECTED_STALE');
  assert.equal(store.getState().claim.severity, null);
  assert.equal(store.getState().lastCode, 'PATCH_REJECTED_STALE');
});

// The whole demonstration in one test. The agent reads, the claimant corrects
// the page, and the agent's next write is refused rather than silently undoing
// the correction.
test('a human correction on the page beats an agent patch that has not seen it', () => {
  const store = createStore(fixture);

  store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: true, actor: 'agent', baseRevision: 0 });
  const readByTheAgent = store.getState().claim.revision;

  store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: false });

  const stale = store.dispatch({
    type: 'patch',
    field: 'severity',
    value: 'scratch',
    actor: 'agent',
    baseRevision: readByTheAgent,
  });

  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'PATCH_REJECTED_STALE');
  assert.match(stale.error, /expected revision 1, current revision 2/);
  assert.equal(store.getState().claim.vehicle_drivable, false, 'the correction stands');
  assert.equal(store.getState().claim.severity, null, 'nothing from the stale patch landed');

  const reread = store.getState().claim.revision;
  const retry = store.dispatch({
    type: 'patch',
    field: 'severity',
    value: 'structural',
    actor: 'agent',
    baseRevision: reread,
  });
  assert.equal(retry.ok, true, 'reading again is all it takes to recover');
});

test('one dispatch can carry several changes, and it is still one revision', () => {
  const store = createStore(fixture);
  const result = store.dispatch({
    type: 'patch',
    actor: 'agent',
    baseRevision: 0,
    changes: [
      { field: 'damage_zone', value: '10' },
      { field: 'severity', value: 'dent' },
      { field: 'vehicle_drivable', value: 'true' },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.applied, ['damage_zone', 'severity', 'vehicle_drivable']);
  assert.equal(store.getState().claim.damage_zone, 10);
  assert.equal(store.getState().claim.vehicle_drivable, true);
});

test('a batch that fails halfway leaves the store exactly where it was', () => {
  const store = createStore(fixture);
  const before = snapshot(store.getState().claim);

  const result = store.dispatch({
    type: 'patch',
    changes: [
      { field: 'damage_zone', value: 10 },
      { field: 'severity', value: 'terminal' },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PATCH_REJECTED_VALUE');
  assert.deepEqual(snapshot(store.getState().claim), before);
  assert.equal(store.getState().claim.revision, 0);
});

test('pinning a field on the page stops the agent moving it', () => {
  const store = createStore(fixture);
  store.dispatch({ type: 'patch', field: 'severity', value: 'structural' });

  const pinned = store.dispatch({ type: 'lock', field: 'severity' });
  assert.equal(pinned.ok, true);
  assert.deepEqual(store.getState().claim.locked, ['severity']);

  const refused = store.dispatch({
    type: 'patch',
    field: 'severity',
    value: 'scratch',
    actor: 'agent',
    baseRevision: store.getState().claim.revision,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'PATCH_REJECTED_LOCKED');
  assert.equal(store.getState().claim.severity, 'structural');

  store.dispatch({ type: 'unlock', field: 'severity' });
  assert.deepEqual(store.getState().claim.locked, []);
  const allowed = store.dispatch({
    type: 'patch',
    field: 'severity',
    value: 'scratch',
    actor: 'agent',
    baseRevision: store.getState().claim.revision,
  });
  assert.equal(allowed.ok, true);
});

test('pinning tells the subscribers, because the page has to redraw the pin', () => {
  const store = createStore(fixture);
  let calls = 0;
  store.subscribe(() => {
    calls += 1;
  });

  store.dispatch({ type: 'lock', field: 'severity' });
  assert.equal(calls, 1);
});

test('filing advances the revision too, so a cached read cannot miss it', () => {
  const store = readyStore();
  const before = store.getState().claim.revision;

  const result = file(store, '2026-08-26T09:30:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(store.getState().claim.revision, before + 1);
});

test('reset puts the revision, the pins and the provenance back as well', () => {
  const store = createStore(fixture);

  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  store.dispatch({ type: 'lock', field: 'severity' });
  assert.equal(store.getState().claim.revision, 2);

  store.dispatch({ type: 'reset' });
  const claim = store.getState().claim;
  assert.equal(claim.revision, 3, 'the reset is itself a change and advances the counter');
  assert.deepEqual(claim.locked, []);
  assert.equal(claim.provenance.severity, undefined);
  assert.equal(claim.provenance.incident_type, 'policy', 'what the fixture supplied is still the fixture');
});

test('the store carries the evidence notes and never lets a patch touch them', () => {
  const store = createStore(fixture);
  assert.equal(store.getState().claim.evidence_notes.length, 2);

  const result = store.dispatch({ type: 'patch', field: 'evidence_notes', value: [] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PATCH_REJECTED_PROTECTED');
  assert.equal(store.getState().claim.evidence_notes.length, 2);
});

// ---------------------------------------------------------------------------
// The answering context, and the hole the revision protocol did not cover
//
// The protocol promised that a patch quoting revision N lands on the context the
// quoter read at N. It covered the claim's own fields and nothing else, and two
// things on this page change what every tool ANSWERS without touching a field:
// loading another insurer's rule pack, and a person carrying out a human action
// that closes a requirement no patch can close.
//
// Before `context` existed, both left the counter where it was. An agent that had
// read the intake list under one insurer could patch, at the same number, against
// answers that no longer existed anywhere, and the page accepted it. The store
// answered `Unknown action type: context.` and moved nothing.
// ---------------------------------------------------------------------------

test('a context change moves the revision and touches nothing else on the claim', () => {
  const store = createStore(fixture);
  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  const before = snapshot(store.getState().claim);

  const result = store.dispatch({ type: 'context', reason: 'the insurer rule pack changed to Kestrel Assurance' });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.code, null);
  assert.deepEqual(result.applied, [], 'no field was written, so none is reported as applied');
  assert.equal(result.revision, before.revision + 1);

  const after = snapshot(store.getState().claim);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual({ ...after, revision: null }, { ...before, revision: null },
    'a context change writes no value, no provenance and no pin');
});

test('a context change tells every subscriber, the same as any other change', () => {
  const store = createStore(fixture);
  const seen = [];
  store.subscribe((state) => seen.push(state.claim.revision));

  store.dispatch({ type: 'context', reason: 'a human action closed a requirement on this page' });
  assert.deepEqual(seen, [1], 'the page redraws off this, so a silent one would leave a stale number on screen');
});

// The whole point, stated as the sequence it protects.
test('a patch quoting the revision from before a context change is refused as stale', () => {
  const store = createStore(fixture);

  // The agent reads. This is the number it will quote back.
  const readAt = store.getState().claim.revision;

  // The person switches the insurer rule pack. Nothing on the claim moves, and every tool that
  // reads the pack starts giving a different answer.
  store.dispatch({ type: 'context', reason: 'the insurer rule pack changed to Kestrel Assurance' });

  const result = store.dispatch({
    type: 'patch',
    actor: 'agent',
    baseRevision: readAt,
    changes: [{ field: 'severity', value: 'dent' }],
  });

  assert.equal(result.ok, false, 'this patch was written against answers that no longer exist');
  assert.equal(result.code, 'PATCH_REJECTED_STALE');
  assert.match(result.error, new RegExp(`expected revision ${readAt}, current revision ${readAt + 1}`));
  assert.equal(store.getState().claim.severity, null, 'a refused patch writes nothing');
});

test('reading again after a context change is all it takes to get the patch accepted', () => {
  const store = createStore(fixture);
  store.dispatch({ type: 'context', reason: 'the insurer rule pack changed to Kestrel Assurance' });

  const readAgain = store.getState().claim.revision;
  const result = store.dispatch({
    type: 'patch',
    actor: 'agent',
    baseRevision: readAgain,
    changes: [{ field: 'severity', value: 'dent' }],
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(store.getState().claim.severity, 'dent');
});

test('a context change with no reason moves nothing, so a counter never ticks unexplained', () => {
  const store = createStore(fixture);
  const before = store.getState().claim.revision;

  for (const action of [{ type: 'context' }, { type: 'context', reason: '   ' }, { type: 'context', reason: 7 }]) {
    const result = store.dispatch(action);
    assert.equal(result.ok, false, JSON.stringify(action));
    assert.equal(result.code, 'PATCH_REJECTED_VALUE');
    assert.equal(store.getState().claim.revision, before);
  }
});
