#!/usr/bin/env node

/**
 * Offline replay of the eval journeys, against a FAKE AGENT HOST.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT.
 * The journeys under `evals/` are executed for real by the webmcp-evals smoke harness, in Chrome,
 * against the deployed page. That run is the evidence. This script is not a second opinion on it
 * and it is not evidence about any browser. It exists for one reason: a gate nobody has seen fail
 * is not a gate, and the negative control in `evals/negative-control.json` asserts something that
 * can only be seen by making the page behave WRONGLY. You cannot break the deployed page to prove
 * a gate has teeth. You can break a replay of it.
 *
 * SO THE CLASS OF EVIDENCE HERE IS EXACTLY THE CLASS OF `tests/unit/webmcp.test.js`: the real
 * registration path in `src/webmcp/register.js`, driven against a stand in for
 * `document.modelContext` that is named a fake in its own function name. It proves what this page
 * publishes and when it withdraws it. It proves nothing whatsoever about a real browser, and no
 * row of the readiness gate may cite it as evidence that tools are callable in a judge path.
 *
 * THE STEP LOOP IS A COPY OF THE HARNESS, DELIBERATELY.
 * Three behaviours are reproduced from `src/evaluator/smokeEvaluator.ts` at the pinned commit
 * d39eae4bd51e8c12736b8cae840bd98f190f3179, because a replay that is kinder or harsher than the
 * harness would report a verdict the real run cannot reach:
 *
 *   1. The tool list is re read before EVERY step, so a tool that appears or disappears mid case
 *      is seen.
 *   2. A step whose tool is missing is polled for, and only then fails with
 *      `tool "<name>" is not available.`, and the case stops there.
 *   3. The `result` field is NOT asserted. A returned value is screened only by the harness's own
 *      `explicitToolFailure`, reproduced below, which this page's `toResult` envelope can never
 *      trip. That is the whole reason the negative control is written against tool availability
 *      rather than against a refusal message.
 *
 * Zero dependencies, like everything else here. Node 20 or later.
 *
 *   node evals/replay.mjs                                        the three journeys, all must pass
 *   node evals/replay.mjs --negative-control                     the control, which must fail at step 7
 *   node evals/replay.mjs --negative-control --mutate applied-patch-refused
 *   node evals/replay.mjs --negative-control --mutate withdrawal-ignored
 *   node evals/replay.mjs --negative-control --mutate ninth-tool-never-registered
 *
 * The last three are the proof that the control can fail. The first two break one half each of
 * what the control asserts. The third breaks the run BEFORE it reaches either half, which is the
 * case a looser assertion would have read as a pass. All three must report NOT PROVEN and exit
 * non zero.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);

function flag(what) {
  return argv.includes(what);
}

function valueOf(what, fallback) {
  const at = argv.indexOf(what);
  if (at === -1 || at + 1 >= argv.length) return fallback;
  return argv[at + 1];
}

const NEGATIVE = flag('--negative-control');
const MUTATION = valueOf('--mutate', null);
const POLL_CAP_MS = Number(valueOf('--poll-ms', '750'));
const VERBOSE = !flag('--quiet');

const MUTATIONS = new Set(['applied-patch-refused', 'withdrawal-ignored', 'ninth-tool-never-registered']);
if (MUTATION !== null && !MUTATIONS.has(MUTATION)) {
  console.error(`Unknown mutation ${JSON.stringify(MUTATION)}.`);
  console.error(`Known: ${[...MUTATIONS].join(', ')}`);
  process.exit(2);
}

const EVAL_FILE = NEGATIVE
  ? join(HERE, 'negative-control.json')
  : join(HERE, 'evals.json');

/* -------------------------------------------------------- the fake host */

/**
 * A stand in for document.modelContext.
 *
 * It holds what it was handed and drops a tool when the AbortSignal it was registered with fires,
 * which is how a browser host behaves and how this page withdraws a tool. Nothing else.
 *
 * @param {{ignoreWithdrawal?: boolean, refuse?: string[]}} [options]
 */
function createFakeAgentHost(options = {}) {
  const ignoreWithdrawal = options.ignoreWithdrawal === true;
  const refuse = new Set(options.refuse || []);
  const held = new Map();

  return {
    isFake: true,
    held,

    async registerTool(descriptor, init) {
      if (refuse.has(descriptor.name)) {
        throw new Error(`this fake host refuses ${descriptor.name}`);
      }
      held.set(descriptor.name, descriptor);
      const signal = init ? init.signal : null;
      if (signal && typeof signal.addEventListener === 'function' && !ignoreWithdrawal) {
        signal.addEventListener('abort', () => { held.delete(descriptor.name); }, { once: true });
      }
    },

    addEventListener() {},
    removeEventListener() {},

    toolNames() {
      return [...held.keys()];
    },
  };
}

/* ----------------------------------------- the harness screen, reproduced */

/**
 * A copy of `explicitToolFailure` from the pinned smoke evaluator.
 *
 * It is copied rather than approximated on purpose. This is the one and only screen the harness
 * applies to a tool's return value, and every answer this page gives comes back through
 * `toResult`, which produces `{content:[{type:'text',...}]}`. That object has no `success`, no
 * `isError` and no `error`, so it cannot trip this function whatever the text inside it says. A
 * replay that read the text would be claiming teeth the real run does not have.
 *
 * @param {unknown} result
 * @returns {string|undefined} a reason when the harness would call this an explicit failure
 */
function explicitToolFailure(result) {
  let value = result;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^error[:\s]/i.test(trimmed)) return `tool reported failure: ${trimmed}`;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (value === null || typeof value !== 'object') return undefined;
  const response = value;
  if (
    response.success === false
    || response.isError === true
    || (response.error !== undefined && typeof response.error === 'string')
  ) {
    const detail = response.error === undefined ? response.message : response.error;
    return typeof detail === 'string' && detail.trim()
      ? `tool reported failure: ${detail}`
      : `tool reported failure: ${JSON.stringify(value)}`;
  }
  return undefined;
}

/**
 * A copy of the harness's step compiler, minus the `$` operator resolution these files never use.
 * `ordered` and `unordered` groups are flattened in the authored order, and an optional call is
 * skipped, exactly as the harness does it.
 */
function compileSteps(nodes, into = []) {
  for (const node of nodes || []) {
    if (node && Array.isArray(node.ordered)) { compileSteps(node.ordered, into); continue; }
    if (node && Array.isArray(node.unordered)) { compileSteps(node.unordered, into); continue; }
    if (!node || typeof node.functionName !== 'string' || node.optional) continue;
    const args = node.arguments;
    if (args === undefined || args === null || Array.isArray(args) || typeof args !== 'object') {
      throw new Error(`step ${into.length + 1} (${node.functionName}) needs a concrete arguments object.`);
    }
    for (const key of Object.keys(args)) {
      if (key.startsWith('$')) {
        throw new Error(`step ${into.length + 1} (${node.functionName}) uses the operator ${key}, which smoke replaces with a sample value.`);
      }
    }
    into.push({ functionName: node.functionName, arguments: args, stepIndex: into.length + 1 });
  }
  return into;
}

/* ------------------------------------------------------------ the context */

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The tool context, built the way `src/ui/app.js` builds it, from the same fixtures the deployed
 * page fetches. Anything the page derives from the DOM is left out, because no tool reads it.
 */
async function buildContext(core, mutation) {
  const fixture = readJson(join(ROOT, 'fixtures', 'demo-collision.json'));
  const packFile = readJson(join(ROOT, 'fixtures', 'insurers', 'northwind.json'));
  const store = core.createStore(fixture);
  const policy = fixture.policy || {};
  const vehicle = policy.vehicle || {};

  if (mutation === 'applied-patch-refused') {
    // THE MUTATION. Stand in for a page that refuses a patch it should have applied. It refuses
    // the one change the negative control depends on landing, and changes nothing, which is
    // exactly what a wrongly refused patch looks like from outside.
    const real = store.dispatch;
    store.dispatch = (action) => {
      const isPatch = action && action.type === 'patch';
      const list = isPatch && Array.isArray(action.changes)
        ? action.changes
        : [{ field: action ? action.field : null, value: action ? action.value : null }];
      const touchesIt = isPatch && list.some((c) => c && c.field === 'vehicle_drivable' && c.value === true);
      if (touchesIt) {
        const state = store.getState();
        return {
          ok: false,
          error: 'PATCH_REJECTED_STALE. injected by the replay mutation applied-patch-refused. Nothing was changed.',
          code: 'PATCH_REJECTED_STALE',
          applied: [],
          revision: state.claim.revision,
          state,
        };
      }
      return real(action);
    };
  }

  return {
    store,
    pack: core.loadPolicyPack(packFile),
    packId: typeof fixture.insurer_pack === 'string' ? fixture.insurer_pack : null,
    homePackId: typeof fixture.insurer_pack === 'string' ? fixture.insurer_pack : null,
    policy,
    policyId: String(policy.id || policy.policy_id || 'unknown'),
    currency: String(policy.currency || 'EUR'),
    vehicleClass: String(vehicle.class || 'compact'),
    hasPolicySchedule: Array.isArray(policy.sections) && policy.sections.length > 0,
    noScheduleReason: 'The sample policy schedule did not load, so cover cannot be checked against it.',
    humanActions: [],
    publish() {},
  };
}

/* --------------------------------------------------------------- the loop */

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

/**
 * The harness re reads the tool list before every step and, when the tool is not there, polls for
 * it before giving up. Absence is therefore never a race that happened to be read too early.
 */
async function waitForTool(host, wanted, capMs) {
  if (host.toolNames().includes(wanted)) return true;
  const started = Date.now();
  while (Date.now() - started < capMs) {
    await sleep(10);
    if (host.toolNames().includes(wanted)) return true;
  }
  return false;
}

async function runCase(testCase, register, core, index) {
  const label = testCase.name || `Case ${index + 1}`;
  const steps = compileSteps(testCase.expectedCall);
  if (steps.length === 0) throw new Error(`case "${label}" has no required tool call.`);

  // A fresh page per case, which is what the harness gives each one. Fresh host, fresh store,
  // and the module scope controller map emptied so nothing leaks between cases.
  for (const name of register.registeredToolNames()) register.unregisterTool(name);
  const host = createFakeAgentHost({
    ignoreWithdrawal: MUTATION === 'withdrawal-ignored',
    refuse: MUTATION === 'ninth-tool-never-registered' ? ['get_assistance_options'] : [],
  });
  globalThis.document = { modelContext: host };

  const context = await buildContext(core, MUTATION);
  const surface = await register.startToolSurface(context);

  if (VERBOSE) console.log(`\n[Replay] Opening a fresh fake host for "${label}"`);

  const results = [];
  for (const step of steps) {
    if (VERBOSE) {
      console.log(
        `[Replay] Case "${label}" Step ${step.stepIndex}/${steps.length}: `
        + `Calling tool "${step.functionName}" with args: ${JSON.stringify(step.arguments)}`,
      );
    }

    const there = await waitForTool(host, step.functionName, POLL_CAP_MS);
    if (!there) {
      const reason = `tool "${step.functionName}" is not available.`;
      results.push({ ...step, outcome: 'error', error: `Smoke test "${label}" step ${step.stepIndex} (${step.functionName}): ${reason}` });
      if (VERBOSE) console.log(`  ERROR: ${reason}`);
      break;
    }

    const descriptor = host.held.get(step.functionName);
    let value;
    try {
      value = await descriptor.execute(step.arguments, {});
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({ ...step, outcome: 'error', error: `Smoke test "${label}" step ${step.stepIndex} (${step.functionName}): ${reason}` });
      if (VERBOSE) console.log(`  ERROR: ${reason}`);
      break;
    }

    const reported = explicitToolFailure(value);
    if (reported) {
      results.push({ ...step, outcome: 'error', error: `Smoke test "${label}" step ${step.stepIndex} (${step.functionName}): ${reported}` });
      if (VERBOSE) console.log(`  ERROR: ${reported}`);
      break;
    }

    if (VERBOSE) {
      const text = register.textOfResult(value);
      console.log(`  PASS: Output: ${String(text).slice(0, 110)}`);
    }
    results.push({ ...step, outcome: 'pass' });
  }

  surface.stop();
  for (const name of register.registeredToolNames()) register.unregisterTool(name);

  return { label, steps, results };
}

/* ------------------------------------------------------------------ main */

async function main() {
  // The host has to exist before the registration path looks for it. Nothing in src reads it at
  // import time, but installing it first removes the question.
  globalThis.document = { modelContext: createFakeAgentHost() };

  const register = await import('../src/webmcp/register.js');
  const core = {
    ...(await import('../src/core/store.js')),
    ...(await import('../src/core/policy.js')),
  };

  const cases = readJson(EVAL_FILE);
  const runs = [];
  for (let i = 0; i < cases.length; i += 1) {
    runs.push(await runCase(cases[i], register, core, i));
  }

  const all = runs.flatMap((run) => run.results);
  const total = runs.reduce((sum, run) => sum + run.steps.length, 0);
  const passed = all.filter((r) => r.outcome === 'pass').length;
  const errored = all.filter((r) => r.outcome === 'error');

  console.log(`\nPassed steps: ${passed}/${total} across ${runs.length} case(s).`);
  for (const bad of errored) console.log(bad.error);

  console.log(`\nfile:     ${EVAL_FILE.slice(ROOT.length + 1).split('\\').join('/')}`);
  console.log(`mutation: ${MUTATION === null ? 'none' : MUTATION}`);

  if (!NEGATIVE) {
    if (errored.length > 0) {
      console.log('\nVERDICT: the journeys did not replay clean.');
      process.exit(1);
    }
    console.log('\nVERDICT: every journey replayed clean against the fake host.');
    process.exit(0);
  }

  // The negative control is expected to FAIL, at a named step, for a named reason. Passing is the
  // failure. Failing anywhere else is also a failure, because it would mean the run never reached
  // the thing being controlled for.
  const run = runs[0];
  const last = run.steps.length;
  // Where the patch that has to LAND actually sits, read from the file rather than assumed, so that
  // adding or removing a settling step cannot make this sentence describe the wrong line.
  const patchSteps = run.steps.filter((s) => s.functionName === 'apply_claim_patch');
  const landingPatch = patchSteps.length ? patchSteps[patchSteps.length - 1].stepIndex : null;
  const wantedSummary = `Passed steps: ${last - 1}/${last} across 1 case(s).`;
  const wantedError = `step ${last} (get_assistance_options): tool "get_assistance_options" is not available.`;

  const observedSummary = `Passed steps: ${passed}/${total} across ${runs.length} case(s).`;
  const summaryOk = observedSummary === wantedSummary;
  const errorOk = errored.length === 1 && errored[0].error.includes(wantedError);

  console.log('\nThe negative control asserts two things at once, and both have to hold.');
  console.log(`  every step up to ${last - 1} passed, so the patch at step ${landingPatch} was APPLIED: ${summaryOk ? 'yes' : 'NO'}`);
  console.log(`  step ${last} then found the ninth tool WITHDRAWN:                     ${errorOk ? 'yes' : 'NO'}`);
  console.log(`  expected summary: ${wantedSummary}`);
  console.log(`  observed summary: ${observedSummary}`);
  console.log(`  expected error:   ...${wantedError}`);
  console.log(`  observed error:   ${errored.length === 0 ? 'none, every step passed' : errored[0].error}`);

  if (summaryOk && errorOk) {
    console.log('\nVERDICT: PROVEN. The lifecycle answered a patch that was applied.');
    process.exit(0);
  }
  console.log('\nVERDICT: NOT PROVEN. One half of the control did not hold. Read the two lines above.');
  process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(2);
});
