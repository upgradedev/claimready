/**
 * src/webmcp/register.js, on the paths that only run when something has gone wrong.
 *
 * WHY A SECOND FILE ABOUT THIS MODULE. tests/unit/webmcp.test.js drives the happy registration
 * lifecycle: tools go up, the conditional one comes and goes, the surface is described. That left
 * this module at 103 of 147 branches and 46 of 50 functions, and the 44 that never ran are not
 * decoration. They are the module's whole failure behaviour: a browser with the other spelling of
 * the API, a host that refuses a tool, a factory that throws, a listener that throws, a store that
 * is not there, a budget that cannot be kept. Every one of those is a thing that can happen on a
 * judge's machine and nothing had ever executed one of them.
 *
 * EVERY TEST HERE NAMES A BEHAVIOUR AND FAILS WHEN IT CHANGES. None of them exists to touch a
 * line. Five of them were mutated in the module on purpose and each one went red; the mutations
 * and their output are in the handover.
 *
 * ITS OWN PROCESS, WHICH node:test GIVES EVERY FILE. register.js keeps its AbortControllers in a
 * module scope Map, and this file installs and removes globals that stand in for a browser. Both
 * of those would leak into a neighbour sharing the process.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALWAYS_ON_TOOLS,
  MAX_TOOL_OUTPUT_CHARS,
  budgetedBlock,
  clip,
  describeToolSurface,
  getApiName,
  getModelContext,
  onToolChange,
  packOf,
  registerTools,
  registeredToolNames,
  satisfiedByOf,
  startToolSurface,
  textOfResult,
  toResult,
  unregisterTool,
} from '../../src/webmcp/register.js';

/** A minimal stand in for a browser host. Named a fake, like every other one in this repository. */
function createFakeAgentHost(options = {}) {
  const held = new Map();
  const listeners = new Map();
  return {
    isFake: true,
    held,
    listeners,
    async registerTool(descriptor, init) {
      if (options.refuse && options.refuse.includes(descriptor.name)) {
        throw options.throwPlainString ? `this host refuses ${descriptor.name}` : new Error(`this host refuses ${descriptor.name}`);
      }
      held.set(descriptor.name, descriptor);
      const signal = init ? init.signal : null;
      if (signal) signal.addEventListener('abort', () => { held.delete(descriptor.name); }, { once: true });
    },
    addEventListener(type, handler) {
      if (options.refuseListeners) throw new Error('this host refuses listeners');
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (options.refuseDetach) throw new Error('this host refuses to detach');
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },
    fire(type, event) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
  };
}

function clearGlobals() {
  delete globalThis.document;
  delete globalThis.navigator;
}

function clearControllers() {
  for (const name of registeredToolNames()) unregisterTool(name);
}

/* ------------------------------------------------------- feature detection */

test('with no agent anywhere the page is told so, rather than being given something to call', () => {
  clearGlobals();
  assert.equal(getModelContext(), null);
  assert.equal(getApiName(), null);
});

// THE ENTRY POINT MOVED AND BOTH SPELLINGS ARE STILL LIVE. A build that only reads
// document.modelContext registers nothing at all on the other one, and the page would say "no
// agent detected" to a judge who has one.
test('a browser that spells it navigator.modelContext is served, and is named as that spelling', () => {
  clearGlobals();
  const host = createFakeAgentHost();
  globalThis.navigator = { modelContext: host };
  assert.equal(getModelContext(), host);
  assert.equal(getApiName(), 'navigator.modelContext');
});

test('document.modelContext wins when a browser offers both', () => {
  clearGlobals();
  const onDocument = createFakeAgentHost();
  const onNavigator = createFakeAgentHost();
  globalThis.document = { modelContext: onDocument };
  globalThis.navigator = { modelContext: onNavigator };
  assert.equal(getModelContext(), onDocument);
  assert.equal(getApiName(), 'document.modelContext');
});

test('a document with no modelContext on it is not mistaken for an agent', () => {
  clearGlobals();
  globalThis.document = {};
  assert.equal(getModelContext(), null);
  assert.equal(getApiName(), null);
});

/* ----------------------------------------------------------- the envelope */

test('a result over the budget is cut and says it was cut', () => {
  const long = 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 500);
  const text = textOfResult(toResult(long));
  assert.equal(text.length, MAX_TOOL_OUTPUT_CHARS);
  assert.ok(text.endsWith('[output truncated]'), `it ended ${JSON.stringify(text.slice(-30))}`);
});

test('a tool that answers with something that is not a string still produces readable text', () => {
  assert.equal(textOfResult(toResult(42)), '42');
  assert.equal(textOfResult(toResult(null)), '');
  assert.equal(textOfResult(toResult(undefined)), '');
});

test('text is pulled back out of every shape a tool can hand over', () => {
  assert.equal(textOfResult(undefined), '');
  assert.equal(textOfResult(null), '');
  assert.equal(textOfResult('already text'), 'already text');
  assert.equal(textOfResult({ content: [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }] }), 'one\ntwo');
  assert.equal(textOfResult({ nothing: true }), '[object Object]');
});

// The insurer's own text is what goes through clip: a clause, a reason, an exclusion label. None
// of it has a length of its own, so the caller states one. Every limit in the tree is 40 or more.
test('clip trims to the budget and marks it, whatever it was handed', () => {
  assert.equal(clip('short', 40), 'short');
  const cut = clip('y'.repeat(50), 20);
  assert.equal(cut.length, 20);
  assert.ok(cut.endsWith('[trimmed]'));

  // Not a string, because a rule pack is data this page is handed and a number in a clause field
  // must reach a reader as a clause rather than as a crash.
  assert.equal(clip(12345678, 40), '12345678');
  assert.equal(clip(null, 10), '');
  assert.equal(clip(undefined, 10), '');

  // The caller's own mark, which check_coverage does not use today and could.
  assert.equal(clip('z'.repeat(30), 12, ' (cut)'), 'zzzzzz (cut)');
});

/* --------------------------------------------------------------- budgets */

test('budgetedBlock called with nothing produces nothing rather than throwing', () => {
  assert.equal(budgetedBlock(), '');
  assert.equal(budgetedBlock({}), '');
});

// THE PROMISE THIS FUNCTION MAKES IS THAT WHAT COMES BACK FITS. The withheld notice belongs to the
// caller, so no reservation computed in advance is proof, and the assembled string has to be
// measured. A caller whose notice grows as fewer entries are dropped defeats the reservation
// exactly, and this is that caller.
test('a withheld notice longer than the room reserved for it still comes back inside the budget', () => {
  const limit = 140;
  const out = budgetedBlock({
    head: ['h'],
    tail: ['t'],
    body: ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)],
    limit,
    more: (count) => 'X'.repeat(200 - 60 * count),
  });
  assert.ok(out.length <= limit, `it came back ${out.length} characters against a budget of ${limit}`);
  assert.ok(out.startsWith('h'), 'the head is never the thing that gets dropped');
  assert.ok(out.endsWith('t'), 'the tail is never the thing that gets dropped');
  assert.ok(out.includes('a'.repeat(50)), 'the first body entry survived');
  assert.ok(!out.includes('b'.repeat(50)), 'the second was given back so the notice could fit');
});

test('a head and tail that cannot fit is a defect that throws, never a result that is quietly wrong', () => {
  assert.throws(
    () => budgetedBlock({ head: ['h'.repeat(900)], tail: ['t'.repeat(900)], body: [], limit: MAX_TOOL_OUTPUT_CHARS }),
    /cannot keep its promise/,
  );
});

test('a withheld notice that cannot fit either throws rather than returning an over long result', () => {
  assert.throws(
    () => budgetedBlock({
      head: ['h'],
      tail: ['t'],
      body: ['a'.repeat(150), 'b'.repeat(150)],
      limit: 200,
      more: () => 'X'.repeat(400),
    }),
    /Shorten the notice or the head/,
  );
});

/* ------------------------------------------------------------- rule pack */

test('a pack that is missing, or half loaded, is treated as no pack rather than throwing later', () => {
  assert.equal(packOf(null), null);
  assert.equal(packOf(undefined), null);
  assert.equal(packOf({}), null);
  assert.equal(packOf({ pack: null }), null);
  assert.equal(packOf({ pack: { requirements: 'not a list' } }), null);
  const good = { requirements: [] };
  assert.equal(packOf({ pack: good }), good);
});

test('a requirement the pack does not describe answers with nothing, not with a guess', () => {
  const pack = { requirements: [{ id: 'police_report', satisfied_by: { field: 'police_report_ref' } }] };
  assert.deepEqual(satisfiedByOf(pack, 'police_report'), { field: 'police_report_ref', humanAction: null });
  assert.deepEqual(satisfiedByOf(pack, 'not_a_requirement'), { field: null, humanAction: null });
  assert.deepEqual(satisfiedByOf(null, 'police_report'), { field: null, humanAction: null });
  assert.deepEqual(satisfiedByOf({ requirements: [{ id: 'x' }] }, 'x'), { field: null, humanAction: null });
});

/* -------------------------------------------------------- the description */

// THIS IS THE BEHAVIOUR THE READINESS GATE'S SUR ROW ASSERTS A COUNT AGAINST. describeOne swallows
// a throwing factory and describeToolSurface drops the null, so a broken tool leaves the page
// describing a SHORTER surface with nothing wrong in it. That silence is why the gate compares the
// built length against ALWAYS_ON_TOOLS.length + CONDITIONAL_TOOLS.length rather than trusting the
// list it is handed.
test('a tool factory that throws is dropped from the described surface, silently', () => {
  const before = describeToolSurface({});
  ALWAYS_ON_TOOLS.push(() => { throw new Error('this factory is broken'); });
  try {
    const after = describeToolSurface({});
    assert.equal(
      after.length,
      before.length,
      'the broken factory was counted, or it crashed the description instead of being dropped',
    );
    assert.deepEqual(after.map((entry) => entry.name), before.map((entry) => entry.name));
  } finally {
    ALWAYS_ON_TOOLS.pop();
  }
  assert.equal(describeToolSurface({}).length, before.length, 'the list was left with the broken factory in it');
});

test('a factory that returns nothing named is dropped the same way', () => {
  const before = describeToolSurface({});
  const listWas = ALWAYS_ON_TOOLS.length;
  ALWAYS_ON_TOOLS.push(() => null, () => ({ description: 'no name' }), () => ({ name: '' }));
  try {
    assert.equal(
      describeToolSurface({}).length,
      before.length,
      'a descriptor with no usable name was counted as a tool an agent can call',
    );
  } finally {
    ALWAYS_ON_TOOLS.length = listWas;
  }
  assert.equal(ALWAYS_ON_TOOLS.length, listWas, 'the module list was left longer than this test found it');
});

/* ------------------------------------------------------- registering them */

test('registering against a browser with no agent reports unavailable and registers nothing', async () => {
  clearGlobals();
  clearControllers();
  const status = await registerTools({}, [() => ({ name: 'x' })]);
  assert.equal(status.available, false);
  assert.equal(status.api, null);
  assert.deepEqual(status.registered, []);
  assert.deepEqual(registeredToolNames(), []);
});

test('registering nothing is not an error', async () => {
  clearGlobals();
  clearControllers();
  globalThis.document = { modelContext: createFakeAgentHost() };
  const status = await registerTools({}, undefined);
  assert.equal(status.available, true);
  assert.deepEqual(status.registered, []);
});

test('a ready made descriptor registers as readily as a factory', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };
  const status = await registerTools({}, [{ name: 'plain_descriptor', async execute() { return null; } }]);
  assert.deepEqual(status.registered, ['plain_descriptor']);
  assert.ok(host.held.has('plain_descriptor'));
  clearControllers();
});

// A FACTORY THAT THROWS MUST NOT TAKE THE OTHER TOOLS DOWN WITH IT. A page that registers eight of
// nine tools is a page a judge can still use; a page that throws during boot is a blank screen.
test('one broken factory is reported and the tools beside it still register', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };
  const status = await registerTools({}, [
    () => { throw new Error('the factory blew up'); },
    () => ({ name: 'still_here', async execute() { return null; } }),
  ]);
  assert.deepEqual(status.registered, ['still_here']);
  assert.equal(status.failed.length, 1);
  assert.equal(status.failed[0].name, 'unknown');
  assert.match(status.failed[0].reason, /the factory blew up/);
  clearControllers();
});

test('a factory that returns no name is refused and named as such', async () => {
  clearGlobals();
  clearControllers();
  globalThis.document = { modelContext: createFakeAgentHost() };
  const status = await registerTools({}, [() => ({ description: 'no name here' }), () => null, () => ({ name: '' })]);
  assert.deepEqual(status.registered, []);
  assert.equal(status.failed.length, 3);
  for (const failure of status.failed) {
    assert.match(failure.reason, /did not return a named descriptor/);
  }
});

test('a host that refuses a tool leaves it unregistered and says why, in the host words', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost({ refuse: ['refused_tool'] });
  globalThis.document = { modelContext: host };
  const status = await registerTools({}, [
    () => ({ name: 'refused_tool', async execute() { return null; } }),
    () => ({ name: 'accepted_tool', async execute() { return null; } }),
  ]);
  assert.deepEqual(status.registered, ['accepted_tool']);
  assert.deepEqual(status.failed, [{ name: 'refused_tool', reason: 'this host refuses refused_tool' }]);
  assert.deepEqual(registeredToolNames(), ['accepted_tool'], 'no controller is left behind for a tool that never registered');
  clearControllers();
});

test('a host that throws something that is not an Error is still reported readably', async () => {
  clearGlobals();
  clearControllers();
  globalThis.document = { modelContext: createFakeAgentHost({ refuse: ['thrown_string'], throwPlainString: true }) };
  const status = await registerTools({}, [() => ({ name: 'thrown_string', async execute() { return null; } })]);
  assert.deepEqual(status.failed, [{ name: 'thrown_string', reason: 'this host refuses thrown_string' }]);
});

test('registering the same name twice skips rather than clobbering the controller that can withdraw it', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };
  const descriptor = () => ({ name: 'only_once', async execute() { return null; } });
  await registerTools({}, [descriptor]);
  const second = await registerTools({}, [descriptor]);
  assert.deepEqual(second.registered, []);
  assert.deepEqual(second.skipped, ['only_once']);

  // The point of the skip: the FIRST controller is still the one held, so withdrawal still works.
  assert.equal(unregisterTool('only_once'), true);
  assert.equal(host.held.has('only_once'), false, 'the tool was not actually withdrawn from the host');
});

test('withdrawing a tool nobody registered says so instead of pretending', () => {
  clearControllers();
  assert.equal(unregisterTool('never_registered'), false);
});

/* ------------------------------------------------------- the change event */

test('listening for tool changes on a browser with no agent hands back a safe unsubscribe', () => {
  clearGlobals();
  let called = 0;
  const off = onToolChange(() => { called += 1; });
  assert.equal(typeof off, 'function');
  off();
  off();
  assert.equal(called, 0);
});

// A LISTENER THAT THROWS MUST NOT BREAK THE PAGE. The page is what the claimant is using; a
// bad handler is a bug in the handler.
test('a tool change handler that throws does not escape into the page', () => {
  clearGlobals();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };
  const off = onToolChange(() => { throw new Error('the handler is broken'); });
  assert.doesNotThrow(() => host.fire('toolchange', {}));
  off();
  assert.equal(host.listeners.get('toolchange').size, 0, 'the listener was not detached');
});

test('a host that refuses to detach a listener does not break the caller either', () => {
  clearGlobals();
  globalThis.document = { modelContext: createFakeAgentHost({ refuseDetach: true }) };
  const off = onToolChange(() => {});
  assert.doesNotThrow(off);
});

/* ----------------------------------------------------------- the lifecycle */

test('the surface comes up against a context with no store, and asks for no conditional tool', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };

  const surface = await startToolSurface({});
  assert.equal(surface.status.available, true);
  assert.equal(surface.status.registered.length, 8, 'the always on tools are what a page with no claim publishes');
  assert.ok(!host.held.has('get_assistance_options'), 'a conditional tool cannot be wanted by a claim that is not there');
  surface.stop();
  clearControllers();
});

// A CONDITIONAL RULE THAT THROWS IS ANSWERED WITH "NOT WANTED", NEVER WITH "PUBLISH IT ANYWAY".
// Publishing on an unreadable claim would hand an agent a tool whose precondition nobody could
// evaluate, which is the wrong way to fail on a page about someone's insurance.
test('a conditional rule that throws withholds its tool rather than publishing it', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };

  // The claim is there and reading a field off it throws, which is what an unreadable claim looks
  // like from inside `present`. The rule for get_assistance_options asks for vehicle_drivable, so
  // this is the exact question the rule puts to the claim.
  const unreadable = new Proxy({}, {
    get() { throw new Error('the claim cannot be read'); },
  });
  const listeners = new Set();
  const store = {
    getState: () => ({ claim: unreadable }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  const surface = await startToolSurface({ store });
  assert.equal(surface.status.available, true);
  assert.ok(!host.held.has('get_assistance_options'));

  // And it stays withheld when the store notifies, rather than being retried into existence.
  for (const fn of listeners) fn();
  await surface.reconcile();
  assert.ok(!host.held.has('get_assistance_options'));
  surface.stop();
  clearControllers();
});

test('an onChange listener that throws does not take down the page booting behind it', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };

  const state = { claim: { vehicle_drivable: false } };
  const store = { getState: () => state, subscribe: () => () => {} };

  let surface;
  await assert.doesNotReject(async () => {
    surface = await startToolSurface({ store }, { onChange: () => { throw new Error('the announcement is broken'); } });
  });
  assert.ok(host.held.has('get_assistance_options'), 'the tool was published even though announcing it threw');
  surface.stop();
  clearControllers();
});

test('reconcile called with no reason still reports one', async () => {
  clearGlobals();
  clearControllers();
  globalThis.document = { modelContext: createFakeAgentHost() };
  const store = { getState: () => ({ claim: { vehicle_drivable: true } }), subscribe: () => () => {} };
  const surface = await startToolSurface({ store });
  const answer = await surface.reconcile();
  assert.equal(answer.reason, 'claim changed');
  surface.stop();
  clearControllers();
});

test('nothing reconciles when the browser has no agent, and it does not throw trying', async () => {
  clearGlobals();
  clearControllers();
  const store = { getState: () => ({ claim: { vehicle_drivable: false } }), subscribe: () => () => {} };
  const surface = await startToolSurface({ store });
  assert.equal(surface.status.available, false);
  const answer = await surface.reconcile('a claim changed on a page with no agent');
  assert.deepEqual(answer.added, []);
  assert.deepEqual(answer.changes, []);
  surface.stop();
});

test('stopping the surface detaches from the store and from the browser', async () => {
  clearGlobals();
  clearControllers();
  const host = createFakeAgentHost();
  globalThis.document = { modelContext: host };
  let subscribed = 0;
  const store = {
    getState: () => ({ claim: { vehicle_drivable: true } }),
    subscribe() { subscribed += 1; return () => { subscribed -= 1; }; },
  };
  const surface = await startToolSurface({ store });
  assert.equal(subscribed, 1);
  surface.stop();
  assert.equal(subscribed, 0);
  assert.equal(host.listeners.get('toolchange').size, 0);
  clearControllers();
});
