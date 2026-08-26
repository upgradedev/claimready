import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createStore } from '../../src/core/store.js';
import { createClaim, validateClaim } from '../../src/core/claim.js';

const FIXTURE_URL = new URL('../../fixtures/demo-collision.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function readyStore() {
  return createStore(fixture.scenarios.find((s) => s.id === 'covered-collision'));
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

test('reset puts the draft back to how the fixture left it', () => {
  const store = createStore(fixture);
  const before = snapshot(store.getState().claim);

  store.dispatch({ type: 'patch', field: 'severity', value: 'structural' });
  store.dispatch({ type: 'patch', field: 'damage_zone', value: 7 });
  assert.notDeepEqual(snapshot(store.getState().claim), before);

  const result = store.dispatch({ type: 'reset' });
  assert.equal(result.ok, true);
  assert.deepEqual(snapshot(store.getState().claim), before);
  assert.equal(store.getState().lastError, null);
});

test('reset survives being run more than once', () => {
  const store = createStore(fixture);
  const before = snapshot(store.getState().claim);

  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  store.dispatch({ type: 'reset' });
  store.dispatch({ type: 'patch', field: 'severity', value: 'dent' });
  store.dispatch({ type: 'reset' });

  assert.deepEqual(snapshot(store.getState().claim), before);
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

  const result = store.dispatch({ type: 'file' });

  assert.equal(result.ok, false);
  assert.match(result.error, /not ready/i);
  assert.match(result.error, /damage_zone/);
  assert.equal(store.getState().claim.status, 'draft');
});

test('a complete claim files, and the claim locks once it has', () => {
  const store = readyStore();
  assert.equal(validateClaim(store.getState().claim).ready, true);

  const result = store.dispatch({ type: 'file', at: '2026-08-26T09:30:00.000Z' });

  assert.equal(result.ok, true);
  assert.equal(store.getState().claim.status, 'filed');
  assert.equal(store.getState().claim.filed_at, '2026-08-26T09:30:00.000Z');
});

test('filing works without a timestamp, which stays null rather than invented', () => {
  const store = readyStore();
  assert.equal(store.dispatch({ type: 'file' }).ok, true);
  assert.equal(store.getState().claim.filed_at, null);
});

test('a filed claim cannot be filed again or edited afterwards', () => {
  const store = readyStore();
  store.dispatch({ type: 'file' });

  const again = store.dispatch({ type: 'file' });
  assert.equal(again.ok, false);
  assert.match(again.error, /already been filed/);

  const edit = store.dispatch({ type: 'patch', field: 'severity', value: 'structural' });
  assert.equal(edit.ok, false);
  assert.equal(store.getState().claim.severity, 'dent');
});

test('filing tells the subscribers', () => {
  const store = readyStore();
  const seen = [];
  store.subscribe((state) => seen.push(state.claim.status));

  store.dispatch({ type: 'file' });
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
