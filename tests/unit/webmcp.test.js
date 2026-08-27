/**
 * The WebMCP layer, driven against a FAKE AGENT HOST.
 *
 * Nothing under src/webmcp had a test of any kind before this file: `grep -rl modelContext tests/`
 * returned nothing at all. Everything that made this page's boundary interesting, the surface that
 * changes with the claim, the AbortController per tool, the three refusals the one writing tool can
 * give, was covered only by whatever a person happened to click.
 *
 * THE HOST HERE IS A FAKE AND IS NAMED ONE. createFakeAgentHost stands in for the browser's
 * document.modelContext: it records what it was handed and hands back what it was told to. It
 * proves what this page publishes and how it behaves when its own rules refuse something. It
 * proves nothing whatsoever about a real browser, and no row of the readiness gate may ever cite
 * it as evidence that tools are callable in a judge path.
 *
 * The module under test keeps its controller map at module scope, and node:test runs each file in
 * its own process, so isolation here is between tests rather than between files: every test
 * withdraws everything it registered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ALWAYS_ON_TOOLS,
  CONDITIONAL_TOOLS,
  describeToolSurface,
  registerTools,
  unregisterTool,
  registeredToolNames,
  startToolSurface,
  textOfResult,
  MAX_TOOL_OUTPUT_CHARS,
} from '../../src/webmcp/register.js';
import { createStore } from '../../src/core/store.js';
import { loadPolicyPack } from '../../src/core/policy.js';
import { PATCHABLE_FIELDS, PATCH_CODES } from '../../src/core/claim.js';

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

const fixture = readJson('../../fixtures/demo-collision.json');
const northwind = loadPolicyPack(readJson('../../fixtures/insurers/northwind.json'));

/* ------------------------------------------------------ the fake agent host */

/**
 * A stand in for document.modelContext.
 *
 * It is deliberately dumb. It records the descriptor and the AbortSignal it was given, it can be
 * told to refuse one named tool so the failure path is exercised, and it lets a test read back
 * exactly what the page handed it.
 *
 * @param {{refuse?: string[]}} [options]
 */
function createFakeAgentHost(options = {}) {
  const refuse = new Set(options.refuse || []);
  const held = new Map();
  const listeners = new Map();

  return {
    isFake: true,
    held,

    async registerTool(descriptor, init) {
      if (refuse.has(descriptor.name)) {
        throw new Error(`this fake host refuses ${descriptor.name}`);
      }
      held.set(descriptor.name, { descriptor, signal: init && init.signal });
    },

    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },

    removeEventListener(type, handler) {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },

    /** The browser telling the page the surface moved under it. */
    emitToolChange() {
      for (const handler of listeners.get('toolchange') || []) handler({ type: 'toolchange' });
    },

    listenerCount(type) {
      return (listeners.get(type) || new Set()).size;
    },

    toolNames() {
      return [...held.keys()];
    },

    descriptor(name) {
      const entry = held.get(name);
      return entry ? entry.descriptor : null;
    },

    signal(name) {
      const entry = held.get(name);
      return entry ? entry.signal : null;
    },
  };
}

/** Put the fake host where getModelContext looks, and take it away again. */
function installFakeHost(host) {
  globalThis.document = { modelContext: host };
  return () => { delete globalThis.document; };
}

/** Leave the module scoped controller map as this file found it. */
function withdrawEverything() {
  for (const name of registeredToolNames()) unregisterTool(name);
}

function makeContext(seed = {}) {
  const store = createStore({ ...fixture, claim: seed });
  return {
    store,
    pack: northwind,
    packId: 'northwind',
    homePackId: 'northwind',
    policy: northwind,
    policyId: 'MTR-2026-0417',
    currency: 'EUR',
    vehicleClass: 'compact',
    hasPolicySchedule: true,
    noScheduleReason: 'the schedule did not load',
    humanActions: [],
    getRequirements: () => [],
    publish: () => {},
  };
}

/** Run one registered tool the way the host would, through the descriptor it was handed. */
async function callRegistered(host, name, input) {
  const descriptor = host.descriptor(name);
  assert.ok(descriptor, `${name} is not registered with the fake host`);
  return textOfResult(await descriptor.execute(input, {}));
}

/* ------------------------------------------------------------ 1. descriptors */

test('every tool this page publishes has the descriptor shape WebMCP asks for', () => {
  const context = makeContext();
  const factories = [...ALWAYS_ON_TOOLS, ...CONDITIONAL_TOOLS.map((rule) => rule.factory)];
  assert.ok(factories.length >= 9, `only ${factories.length} tools were found`);

  const seen = new Set();
  for (const factory of factories) {
    const descriptor = factory(context);

    assert.match(descriptor.name, /^[a-z][a-z0-9_]*$/, `${descriptor.name} is not lower snake case`);
    assert.ok(descriptor.name.length <= 30, `${descriptor.name} is over the 30 character budget`);
    assert.ok(!seen.has(descriptor.name), `${descriptor.name} is published twice`);
    seen.add(descriptor.name);

    assert.equal(typeof descriptor.description, 'string');
    assert.ok(descriptor.description.length > 0 && descriptor.description.length <= 500,
      `${descriptor.name} description is ${descriptor.description.length} characters`);

    assert.equal(descriptor.inputSchema.type, 'object', `${descriptor.name} takes no object`);
    assert.equal(descriptor.inputSchema.additionalProperties, false,
      `${descriptor.name} accepts properties it does not declare`);

    assert.equal(typeof descriptor.execute, 'function');
    assert.equal(typeof descriptor.annotations.readOnlyHint, 'boolean',
      `${descriptor.name} leaves readOnlyHint to a default instead of stating it`);
  }

  assert.ok(seen.has('apply_claim_patch'));
  assert.ok(seen.has('get_assistance_options'));
});

// The two hints WebMCP defines are the only two that may appear. Anything else is a copy from
// another dialect, and one of them in particular would be a claim this page must never make. The
// name is assembled rather than written out, or this test would report itself to the style gate.
test('no annotation outside the two WebMCP defines reaches a descriptor', () => {
  const forbidden = ['destructive', 'Hint'].join('');
  const context = makeContext();
  for (const factory of [...ALWAYS_ON_TOOLS, ...CONDITIONAL_TOOLS.map((rule) => rule.factory)]) {
    const descriptor = factory(context);
    const keys = Object.keys(descriptor.annotations);
    for (const key of keys) {
      assert.ok(
        ['readOnlyHint', 'untrustedContentHint'].includes(key),
        `${descriptor.name} declares ${key}, which WebMCP does not define`,
      );
      assert.notEqual(key, forbidden);
    }
  }
});

test('the tool that returns what a claimant typed says so, and the ones that do not, do not', () => {
  const context = makeContext();
  const byName = new Map();
  for (const factory of [...ALWAYS_ON_TOOLS, ...CONDITIONAL_TOOLS.map((rule) => rule.factory)]) {
    const descriptor = factory(context);
    byName.set(descriptor.name, descriptor.annotations);
  }

  assert.equal(byName.get('read_claim_state').untrustedContentHint, true, 'it returns free text');
  assert.equal(byName.get('read_evidence_notes').untrustedContentHint, true, 'it returns third party text');
  assert.equal(byName.get('apply_claim_patch').readOnlyHint, false, 'it is the one tool that writes');
  assert.equal(byName.get('check_coverage').readOnlyHint, true);
  assert.equal(byName.get('get_requirements').untrustedContentHint, undefined,
    'it returns insurer rule text, so claiming untrusted content would be noise');
});

test('describeToolSurface reports the same tools the page would register', () => {
  const surface = describeToolSurface(makeContext());
  const names = surface.map((entry) => entry.name);
  assert.ok(names.includes('get_assistance_options'));
  assert.equal(surface.find((entry) => entry.name === 'get_assistance_options').conditional, true);
  assert.equal(surface.find((entry) => entry.name === 'check_coverage').conditional, false);
  for (const entry of surface) {
    assert.ok(entry.purpose.length > 0, `${entry.name} has no opening sentence`);
    assert.ok(entry.purpose.length <= entry.wording.length);
  }
});

/* -------------------------------------------- 2. the surface follows the claim */

test('the conditional tool appears when the claim says the car cannot be driven', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext();
  const announced = [];

  try {
    const surface = await startToolSurface(context, { onChange: (change) => announced.push(change) });

    assert.equal(surface.status.available, true);
    assert.equal(surface.status.api, 'document.modelContext');
    assert.ok(!host.toolNames().includes('get_assistance_options'),
      'nothing on the draft says the car cannot be driven yet');

    context.store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: false });
    await surface.reconcile('test');

    assert.ok(host.toolNames().includes('get_assistance_options'), 'it should have been published');
    assert.ok(registeredToolNames().includes('get_assistance_options'));

    const published = announced.flatMap((change) => change.changes || []).filter((c) => c.published);
    assert.equal(published.length, 1);
    assert.equal(published[0].name, 'get_assistance_options');
    assert.match(published[0].because, /cannot be driven/);

    surface.stop();
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('and disappears again when the answer is corrected back', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext();
  const announced = [];

  try {
    const surface = await startToolSurface(context, { onChange: (change) => announced.push(change) });

    context.store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: false });
    await surface.reconcile('test');
    assert.ok(registeredToolNames().includes('get_assistance_options'));
    const signal = host.signal('get_assistance_options');

    context.store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: true });
    await surface.reconcile('test');

    assert.ok(!registeredToolNames().includes('get_assistance_options'), 'it should have been withdrawn');
    assert.equal(signal.aborted, true, 'withdrawing a tool means aborting the signal it was registered with');

    const withdrawn = announced.flatMap((change) => change.changes || []).filter((c) => !c.published);
    assert.equal(withdrawn.length, 1);
    assert.match(withdrawn[0].because, /drivable again/);

    surface.stop();
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('a host that refuses one tool keeps the rest, and the refusal is reported', async () => {
  const host = createFakeAgentHost({ refuse: ['check_coverage'] });
  const uninstall = installFakeHost(host);

  try {
    const status = await registerTools(makeContext(), ALWAYS_ON_TOOLS);
    assert.ok(!status.registered.includes('check_coverage'));
    assert.ok(status.registered.includes('read_claim_state'), 'one refusal must not take the rest down');
    assert.equal(status.failed.length, 1);
    assert.equal(status.failed[0].name, 'check_coverage');
    assert.match(status.failed[0].reason, /refuses check_coverage/);
    assert.ok(!registeredToolNames().includes('check_coverage'),
      'a refused registration must not be remembered as held');
  } finally {
    withdrawEverything();
    uninstall();
  }
});

/* ---------------------------------------------------- 3. abort, then unregister */

test('unregistering a tool aborts the signal it was registered with, once', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);

  try {
    await registerTools(makeContext(), ALWAYS_ON_TOOLS);
    const signal = host.signal('validate_claim');
    assert.ok(signal, 'the page has to hand the host a signal it can be withdrawn by');
    assert.equal(signal.aborted, false);

    let aborts = 0;
    signal.addEventListener('abort', () => { aborts += 1; });

    assert.equal(unregisterTool('validate_claim'), true);
    assert.equal(signal.aborted, true);
    assert.ok(!registeredToolNames().includes('validate_claim'));

    // Withdrawing what is already gone changes nothing and says so.
    assert.equal(unregisterTool('validate_claim'), false);
    assert.equal(unregisterTool('a_tool_that_never_existed'), false);
    assert.equal(aborts, 1, 'a second withdrawal must not fire the signal again');

    // Every other tool is untouched: one AbortController per tool is the point.
    assert.equal(host.signal('read_claim_state').aborted, false);
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('registering twice skips the name already held rather than replacing it', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);

  try {
    await registerTools(makeContext(), ALWAYS_ON_TOOLS);
    const signal = host.signal('describe_claim');

    const second = await registerTools(makeContext(), ALWAYS_ON_TOOLS);
    assert.deepEqual(second.registered, []);
    assert.ok(second.skipped.includes('describe_claim'));
    assert.equal(host.signal('describe_claim'), signal, 'the held controller must not be swapped out');
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('the page listens for the browser reporting a change, and stops listening', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const announced = [];

  try {
    const surface = await startToolSurface(makeContext(), { onChange: (change) => announced.push(change) });
    assert.equal(host.listenerCount('toolchange'), 1);

    host.emitToolChange();
    assert.equal(announced.at(-1).reason, 'the browser reported a tool change');

    surface.stop();
    assert.equal(host.listenerCount('toolchange'), 0);
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('with no host at all the page registers nothing and does not throw', async () => {
  delete globalThis.document;
  const status = await registerTools(makeContext(), ALWAYS_ON_TOOLS);
  assert.equal(status.available, false);
  assert.equal(status.api, null);
  assert.deepEqual(status.registered, []);
  assert.deepEqual(registeredToolNames(), []);
});

/* ---------------------------------------------------------- 4. the refusals */

const READY_CLAIM = {
  incident_date: '2026-08-20',
  incident_type: 'collision',
  damage_zone: 10,
  severity: 'dent',
  vehicle_drivable: true,
  description: 'A delivery van reversed into the left front wing while the car was parked.',
};

test('a patch that quotes a revision the draft has left is refused whole', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    await registerTools(context, ALWAYS_ON_TOOLS);

    // The agent reads, the person on the page corrects something, the agent then patches.
    const readAt = context.store.getState().claim.revision;
    context.store.dispatch({ type: 'patch', field: 'severity', value: 'structural' });
    const movedTo = context.store.getState().claim.revision;
    assert.notEqual(readAt, movedTo);

    const text = await callRegistered(host, 'apply_claim_patch', {
      baseRevision: readAt,
      changes: [{ field: 'severity', value: 'scratch' }, { field: 'location', value: 'Harbour Road' }],
    });

    assert.match(text, new RegExp(PATCH_CODES.stale));
    assert.match(text, /Nothing was changed/);
    const claim = context.store.getState().claim;
    assert.equal(claim.severity, 'structural', "the person's correction wins");
    assert.equal(claim.location, null, 'the other half of the batch must not have landed either');
    assert.equal(claim.revision, movedTo, 'a refused patch does not move the revision');

    // And the same patch, quoting what it now says, is accepted.
    const retry = await callRegistered(host, 'apply_claim_patch', {
      baseRevision: movedTo,
      changes: [{ field: 'location', value: 'Harbour Road' }],
    });
    assert.match(retry, /Applied/);
    assert.equal(context.store.getState().claim.location, 'Harbour Road');
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('a patch with no baseRevision at all is refused as stale', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    await registerTools(context, ALWAYS_ON_TOOLS);
    const text = await callRegistered(host, 'apply_claim_patch', {
      changes: [{ field: 'severity', value: 'scratch' }],
    });
    assert.match(text, new RegExp(PATCH_CODES.stale));
    assert.equal(context.store.getState().claim.severity, 'dent');
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('a patch to a field the person pinned is refused, and says a person has to release it', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    await registerTools(context, ALWAYS_ON_TOOLS);
    context.store.dispatch({ type: 'lock', field: 'severity' });
    const revision = context.store.getState().claim.revision;

    const text = await callRegistered(host, 'apply_claim_patch', {
      baseRevision: revision,
      changes: [{ field: 'severity', value: 'structural' }, { field: 'location', value: 'Harbour Road' }],
    });

    assert.match(text, new RegExp(PATCH_CODES.locked));
    assert.match(text, /pinned by the person on the page/i);
    assert.equal(context.store.getState().claim.severity, 'dent');
    assert.equal(context.store.getState().claim.location, null, 'the whole patch is refused, not part of it');
    assert.equal(context.store.getState().claim.revision, revision);

    // Nothing on the tool surface can release it. That is the point of pinning.
    const names = host.toolNames();
    assert.ok(!names.some((name) => /unlock|unpin/.test(name)), `a tool would release it: ${names.join(', ')}`);
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('a patch aimed at the bookkeeping the claim carries is refused as protected', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    await registerTools(context, ALWAYS_ON_TOOLS);

    for (const field of ['status', 'policy_id', 'revision', 'locked', 'provenance', 'filed_at']) {
      const revision = context.store.getState().claim.revision;
      const text = await callRegistered(host, 'apply_claim_patch', {
        baseRevision: revision,
        changes: [{ field, value: 'filed' }],
      });
      assert.match(text, new RegExp(PATCH_CODES.protected), `${field} was not refused as protected`);
      assert.equal(context.store.getState().claim.status, 'draft', `${field} moved the claim`);
      assert.equal(context.store.getState().claim.revision, revision);
    }

    // A name that is worked out rather than stored is refused too, and told which it is.
    const derived = await callRegistered(host, 'apply_claim_patch', {
      baseRevision: context.store.getState().claim.revision,
      changes: [{ field: 'covered', value: true }],
    });
    assert.match(derived, new RegExp(PATCH_CODES.protected));

    // A name that is not on the claim at all gets the other refusal, with the list.
    const unknown = await callRegistered(host, 'apply_claim_patch', {
      baseRevision: context.store.getState().claim.revision,
      changes: [{ field: 'settlement_amount', value: 5000 }],
    });
    assert.match(unknown, new RegExp(PATCH_CODES.field));
    assert.match(unknown, new RegExp(PATCHABLE_FIELDS[0]));
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('a filed claim is closed to the writing tool, and says so without asking for a retry', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    await registerTools(context, ALWAYS_ON_TOOLS);
    context.store.dispatch({ type: 'file', at: '10:00:00' });

    const text = await callRegistered(host, 'apply_claim_patch', {
      baseRevision: context.store.getState().claim.revision,
      changes: [{ field: 'severity', value: 'structural' }],
    });

    assert.match(text, new RegExp(PATCH_CODES.protected));
    assert.match(text, /Reading it again will not help/);
    assert.equal(context.store.getState().claim.severity, 'dent');
  } finally {
    withdrawEverything();
    uninstall();
  }
});

/* -------------------------------------------------- 5. the boundary, and budget */

test('nothing that commits anything is on the surface the fake host was handed', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    context.store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: false });
    const surface = await startToolSurface(context);
    await surface.reconcile('test');

    const names = host.toolNames();
    for (const forbidden of ['file', 'file_claim', 'submit', 'submit_claim', 'request_assistance',
      'request_roadside', 'dispatch', 'unlock_field', 'unpin_field']) {
      assert.ok(!names.includes(forbidden), `${forbidden} is on the surface`);
    }
    assert.ok(names.includes('get_assistance_options'),
      'reading the options out is allowed, arranging the collection is not');

    surface.stop();
  } finally {
    withdrawEverything();
    uninstall();
  }
});

/**
 * The refusal beat, end to end, in the shape the demonstration records it.
 *
 * A third party note on the file asks whatever reads it to change the answer the claimant pinned
 * and to file the claim. An agent that does exactly as it is told gets one refusal with a code,
 * and finds nothing at all to call for the other half. Both halves have to be true on the same
 * claim at the same moment, or "following it changes nothing" is a slogan rather than a fact.
 */
test('an agent that obeys a planted note is refused on one half and finds no tool for the other', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    context.store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: false });
    context.store.dispatch({ type: 'lock', field: 'vehicle_drivable' });
    const surface = await startToolSurface(context);
    await surface.reconcile('test');
    const revision = context.store.getState().claim.revision;

    // Half one: change the pinned answer. Refused, with a code, and nothing moves.
    const patched = await callRegistered(host, 'apply_claim_patch', {
      baseRevision: revision,
      changes: [{ field: 'vehicle_drivable', value: true }],
    });
    assert.match(patched, new RegExp(PATCH_CODES.locked));
    assert.equal(context.store.getState().claim.vehicle_drivable, false);
    assert.equal(context.store.getState().claim.revision, revision, 'a refusal does not move the draft');

    // Half two: file it. There is nothing to call, so there is nothing to refuse.
    const names = host.toolNames();
    assert.ok(!names.some((name) => /file|submit|commit/.test(name)),
      `something on the surface could commit the claim: ${names.join(', ')}`);
    assert.equal(context.store.getState().claim.status, 'draft');

    surface.stop();
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('every registered tool answers inside the output budget', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    context.store.dispatch({ type: 'patch', field: 'vehicle_drivable', value: false });
    const surface = await startToolSurface(context);
    await surface.reconcile('test');

    for (const name of host.toolNames()) {
      const input = name === 'apply_claim_patch'
        ? { baseRevision: context.store.getState().claim.revision, changes: [{ field: 'location', value: 'Harbour Road' }] }
        : {};
      const text = await callRegistered(host, name, input);
      assert.ok(text.length > 0, `${name} answered with nothing`);
      assert.ok(text.length <= MAX_TOOL_OUTPUT_CHARS,
        `${name} answered with ${text.length} characters, the budget is ${MAX_TOOL_OUTPUT_CHARS}`);
    }

    surface.stop();
  } finally {
    withdrawEverything();
    uninstall();
  }
});

test('a tool asked to stop before it starts changes nothing', async () => {
  const host = createFakeAgentHost();
  const uninstall = installFakeHost(host);
  const context = makeContext(READY_CLAIM);

  try {
    await registerTools(context, ALWAYS_ON_TOOLS);
    const controller = new AbortController();
    controller.abort();

    const descriptor = host.descriptor('apply_claim_patch');
    const text = textOfResult(await descriptor.execute(
      { baseRevision: context.store.getState().claim.revision, changes: [{ field: 'location', value: 'Harbour Road' }] },
      { signal: controller.signal },
    ));

    assert.match(text, /Cancelled before anything was changed/);
    assert.equal(context.store.getState().claim.location, null);
  } finally {
    withdrawEverything();
    uninstall();
  }
});
