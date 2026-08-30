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
 *   3. The `result` field is not asserted BY THE COPIED SCREEN. A returned value passes the
 *      harness's own `explicitToolFailure`, reproduced below, which this page's `toResult`
 *      envelope can never trip. That is the whole reason the negative control is written against
 *      tool availability rather than against a refusal message.
 *
 * ONE BEHAVIOUR IS ADDED ON TOP, AND IT IS NOT A CLAIM ABOUT ANY BROWSER.
 * `degradedAnswer` below is this replay's OWN screen. It is deliberately stronger than
 * `explicitToolFailure`, and it exists because a replay that only screens what the harness screens
 * cannot see the class of defect that was live in this file: `buildContext` read a field name the
 * page does not use, so `hasPolicySchedule` was false on every run, `check_coverage` answered "the
 * sample policy schedule did not load", and the suite reported 16 of 16.
 *
 * It screens ONE thing and says so: a result in which the page has told the caller that its own
 * data did not load. It does not screen refusals, because a refusal is the product working and
 * journey 2 requires one. Every sentence it screens is taken from the constant that produces it,
 * never retyped here, so a reworded sentence cannot quietly leave the screen's scope. Because it
 * is stronger than the harness, a step that fails only on this screen says so in its own words,
 * and no readiness row may cite it as evidence about a real browser.
 *
 * Zero dependencies, like everything else here. Node 20 or later.
 *
 *   node evals/replay.mjs                                        the three journeys, all must pass
 *   node evals/replay.mjs --negative-control                     the control, which must fail at step 8
 *   node evals/replay.mjs --selftest                             run every mutation, each must fail
 *   node evals/replay.mjs --mutate schedule-field-drift          against the journeys
 *   node evals/replay.mjs --negative-control --mutate applied-patch-refused
 *   node evals/replay.mjs --negative-control --mutate withdrawal-ignored
 *   node evals/replay.mjs --negative-control --mutate ninth-tool-never-registered
 *
 * The mutations are the proof that this file can fail. Each one is declared against the suite it
 * belongs to in MUTATIONS below, and `--selftest` runs every one of them and requires every one to
 * exit non zero. A mutation that no command runs is dead configuration, so the registry is the
 * single source and both this script and .github/workflows/evals.yml read it rather than keeping
 * their own list.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* -------------------------------------------------------------- mutations */

/**
 * Every mutation this file knows, and the suite each one belongs to.
 *
 * `suite` is load bearing rather than documentation. A mutation aimed at the journeys reports its
 * verdict through the positive path, which fails when any step errors, and a mutation aimed at the
 * control reports through the control path, which fails when the control stops holding. Running
 * one against the other suite would read the wrong verdict, so `--selftest` picks the suite from
 * here and the caller cannot get it wrong.
 *
 * ADDING A MUTATION IS ADDING A SELFTEST CASE. `--selftest` iterates this map, so a new entry is
 * run by CI the moment it exists. That is the whole reason the list lives here rather than in the
 * workflow, where the three that came first were typed out again and a fourth would have been
 * silently skipped.
 */
export const MUTATIONS = new Map([
  ['applied-patch-refused', {
    suite: 'negative',
    breaks: 'a page that refuses a patch it should have applied, so the control never reaches the withdrawal',
  }],
  ['withdrawal-ignored', {
    suite: 'negative',
    breaks: 'a host that keeps a tool after its signal aborts, so the ninth tool is still there at the last step',
  }],
  ['ninth-tool-never-registered', {
    suite: 'negative',
    breaks: 'a host that refuses the ninth tool outright, so the run dies before either half of the control',
  }],
  ['schedule-field-drift', {
    suite: 'positive',
    breaks: 'the context reading policy.sections, the field name the page does not use, which is the '
      + 'defect this file shipped with: check_coverage then answers that the schedule did not load '
      + 'and every step still passed',
  }],
]);

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
const SELFTEST = flag('--selftest');
const MUTATION = valueOf('--mutate', null);
const POLL_CAP_MS = Number(valueOf('--poll-ms', '750'));
const VERBOSE = !flag('--quiet');

if (MUTATION !== null && !MUTATIONS.has(MUTATION)) {
  console.error(`Unknown mutation ${JSON.stringify(MUTATION)}.`);
  console.error(`Known: ${[...MUTATIONS.keys()].join(', ')}`);
  process.exit(2);
}

if (MUTATION !== null) {
  const wanted = MUTATIONS.get(MUTATION).suite;
  const asked = NEGATIVE ? 'negative' : 'positive';
  if (wanted !== asked) {
    console.error(`The mutation ${MUTATION} is declared against the ${wanted} suite and was run against the ${asked} one.`);
    console.error('That reads the wrong verdict. Run it with the suite it belongs to, or use --selftest.');
    process.exit(2);
  }
}

const EVAL_FILE = NEGATIVE
  ? join(HERE, 'negative-control.json')
  : join(HERE, 'evals.json');

/* ------------------------------------------- what the page itself decides */

/**
 * The field the page reads to decide whether it holds a schedule of coverages.
 *
 * MIRRORED FROM `hasSchedule` IN src/ui/app.js, WHICH EXPORTS NOTHING. app.js calls boot() at
 * module top level and has no exports at all, so this predicate cannot be imported and has to be
 * written twice. Writing it twice is exactly how it drifted: this file said `sections`, the page
 * says `coverages`, so `hasPolicySchedule` was false on every replay and check_coverage answered
 * that the schedule had not loaded while the suite reported every step green.
 *
 * So the copy is now held to the original by a test rather than by care.
 * tests/unit/replay_oracle.test.js reads `hasSchedule` out of src/ui/app.js and fails when the
 * field name here is not the field name there. Making app.js export the predicate would remove the
 * copy altogether and is the better fix; it is a change to src, which this task may not make, and
 * it is written up in the handover.
 */
const PAGE_SCHEDULE_FIELD = 'coverages';

/**
 * What the page says when it holds no schedule, character for character.
 *
 * MIRRORED FROM `noScheduleReason` IN src/ui/app.js, and held to it by the same test. This copy had
 * drifted too: it carried the first sentence and had lost the second, so the string this file used
 * to reason about was not the string the page produces.
 */
const PAGE_NO_SCHEDULE_REASON = 'The sample policy schedule did not load, so cover cannot be checked '
  + 'against it. This is a loading problem, not a decision about your cover.';

export const PAGE_MIRROR = Object.freeze({
  scheduleField: PAGE_SCHEDULE_FIELD,
  noScheduleReason: PAGE_NO_SCHEDULE_REASON,
});

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
 * Whether an object carries a schedule of coverages, by the page's own rule.
 *
 * The mutation is applied HERE rather than at the call site so that the broken behaviour is the
 * behaviour this file actually shipped with: the wrong field name, read off the same object, on
 * every path that asks.
 *
 * @param {object|null} policy
 * @param {string|null} mutation
 * @returns {boolean}
 */
function hasSchedule(policy, mutation) {
  const field = mutation === 'schedule-field-drift' ? 'sections' : PAGE_SCHEDULE_FIELD;
  return Boolean(policy && Array.isArray(policy[field]) && policy[field].length > 0);
}

/**
 * The tool context, built the way `src/ui/app.js` builds it, from the same fixtures the deployed
 * page fetches. Anything the page derives from the DOM is left out, because no tool reads it.
 *
 * WHY `policy` IS THE PACK AND NOT THE FIXTURE BLOCK. `applyPack` in src/ui/app.js sets
 * `context.policy = entry.pack` whenever a rule pack loads, and this fixture names a pack that
 * loads, so the page a judge opens is checking cover against the pack. A context that left the
 * fixture's own policy block there would be replaying a page nobody visits. Both objects decide
 * this claim the same way today, which is what makes the correction safe to make now rather than
 * a change of verdict smuggled in beside a fix.
 */
async function buildContext(core, mutation) {
  const fixture = readJson(join(ROOT, 'fixtures', 'demo-collision.json'));
  const packFile = readJson(join(ROOT, 'fixtures', 'insurers', 'northwind.json'));
  const store = core.createStore(fixture);
  const embeddedPolicy = fixture.policy || {};
  const pack = core.loadPolicyPack(packFile);
  const policy = pack;
  const vehicle = embeddedPolicy.vehicle || {};

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
    pack,
    packId: typeof fixture.insurer_pack === 'string' ? fixture.insurer_pack : null,
    homePackId: typeof fixture.insurer_pack === 'string' ? fixture.insurer_pack : null,
    policy,
    // The policy NUMBER stays the claimant's own, from the fixture, exactly as the page's persona
    // does. Loading an insurer's rule pack does not move the policy to that insurer.
    policyId: String(embeddedPolicy.id || embeddedPolicy.policy_id || 'unknown'),
    currency: String(policy.currency || 'EUR'),
    vehicleClass: String(vehicle.class || 'compact'),
    hasPolicySchedule: hasSchedule(policy, mutation),
    noScheduleReason: PAGE_NO_SCHEDULE_REASON,
    humanActions: [],
    publish() {},
  };
}

/* ------------------------------------------- the replay's own result screen */

/**
 * Build the list of sentences that mean "this page could not answer from its own data".
 *
 * EVERY ENTRY COMES FROM THE CONSTANT THAT PRODUCES IT. None of them is retyped here, because a
 * screen assembled from hand written phrases stops covering a sentence the moment somebody rewords
 * it, and nothing says so. That failure mode is the reason this screen exists at all.
 *
 * WHAT IS DELIBERATELY NOT SCREENED. A refusal is not a degraded answer. `PATCH_REJECTED_STALE` is
 * the product working, and journey 2 requires one at step 5, so screening refusals would turn a
 * passing product into a failing suite. The line is drawn at data that did not load.
 *
 * @param {object} register the loaded src/webmcp/register.js namespace
 * @returns {Array<{label: string, text: string, from: string}>}
 */
export function degradationScreens(register) {
  const screens = [
    {
      label: 'the insurer rule pack did not load',
      text: register.NO_PACK_REASON,
      from: 'src/webmcp/register.js NO_PACK_REASON',
    },
    {
      label: 'the policy schedule did not load',
      text: PAGE_NO_SCHEDULE_REASON,
      from: 'src/ui/app.js noScheduleReason, mirrored in this file and held by tests/unit/replay_oracle.test.js',
    },
  ];

  // A screen list that quietly emptied itself would pass everything and look identical from the
  // outside, which is the shape of the bug it is here to catch. So it is checked rather than
  // trusted, at startup, before a single step runs.
  if (screens.length < 2) {
    throw new Error('the degradation screen has fewer entries than it was written with.');
  }
  for (const screen of screens) {
    if (typeof screen.text !== 'string' || screen.text.trim().length < 40) {
      throw new Error(
        `the degradation screen entry "${screen.label}" resolved to ${JSON.stringify(screen.text)} `
        + `from ${screen.from}. A screen matching an empty or tiny string matches nothing or `
        + 'everything, and either way it is not a screen.',
      );
    }
  }
  return screens;
}

/**
 * THE REPLAY'S OWN SCREEN, STRONGER THAN THE HARNESS'S ON PURPOSE.
 *
 * The harness copy above screens the envelope. This screens the TEXT, for the one class of answer
 * that means the page failed rather than decided: it told the caller its own data did not load, or
 * it said nothing at all. It is not a claim about a browser, and the message it produces says which
 * screen it is so a reader can never mistake the two.
 *
 * @param {string} text the text pulled out of the tool result
 * @param {Array<{label: string, text: string}>} screens from degradationScreens
 * @returns {string|undefined} a reason when the answer is degraded
 */
export function degradedAnswer(text, screens) {
  const body = typeof text === 'string' ? text : '';
  if (body.trim() === '') {
    return 'the replay screen: the tool answered with no text at all, which is never a decision.';
  }
  for (const screen of screens) {
    if (body.includes(screen.text)) {
      return `the replay screen: the answer says ${screen.label}, so the page could not decide `
        + 'anything and this step proved nothing. The harness cannot see this; the replay can.';
    }
  }
  return undefined;
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

async function runCase(testCase, register, core, index, screens) {
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

    const text = register.textOfResult(value);

    // The added screen. It runs after the copied one and never instead of it, so a result that
    // would have failed in the real harness still fails here for the harness's reason.
    const degraded = degradedAnswer(text, screens);
    if (degraded) {
      results.push({ ...step, outcome: 'error', error: `Smoke test "${label}" step ${step.stepIndex} (${step.functionName}): ${degraded}` });
      if (VERBOSE) console.log(`  ERROR: ${degraded}`);
      if (VERBOSE) console.log(`         it answered: ${String(text).slice(0, 160)}`);
      break;
    }

    if (VERBOSE) {
      console.log(`  PASS: Output: ${String(text).slice(0, 110)}`);
    }
    results.push({ ...step, outcome: 'pass' });
  }

  surface.stop();
  for (const name of register.registeredToolNames()) register.unregisterTool(name);

  return { label, steps, results };
}

/* -------------------------------------------------------------- selftest */

/**
 * Run every mutation in the registry, against the suite it declares, and require each to fail.
 *
 * A GATE NOBODY HAS SEEN FAIL IS NOT A GATE, and that applies to this file as much as to the page
 * it replays. Each mutation is run as a separate process, because the mutation is read at module
 * scope and one process is one configuration. The exit code is the assertion: a mutation that
 * leaves the run green has broken something the suite does not measure, which means the suite does
 * not measure it.
 */
function selftest() {
  const self = fileURLToPath(import.meta.url);
  const results = [];

  console.log('replay selftest');
  console.log('every mutation below breaks the page or the context on purpose.');
  console.log('each one must make its own suite refuse. A green mutation is a suite with no teeth.\n');

  for (const [name, spec] of MUTATIONS) {
    const args = [self, '--mutate', name, '--quiet'];
    if (spec.suite === 'negative') args.splice(1, 0, '--negative-control');
    const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    const refused = run.status !== 0;
    results.push({ name, suite: spec.suite, refused, status: run.status, output });
    console.log(`  ${refused ? 'ok  ' : 'BAD '} ${name}`);
    console.log(`        suite ${spec.suite}, exit ${run.status}`);
    console.log(`        breaks: ${spec.breaks}`);
    if (!refused) {
      console.log('        THIS MUTATION DID NOT BREAK ANYTHING. Its full output follows.');
      for (const line of output.split(/\r?\n/)) console.log(`        | ${line}`);
    }
  }

  const bad = results.filter((r) => !r.refused);
  console.log(`\n${results.length} mutation(s) over ${new Set([...MUTATIONS.values()].map((m) => m.suite)).size} suite(s).`);
  if (bad.length > 0) {
    console.error(`\nselftest FAILED. ${bad.map((r) => r.name).join(', ')} left the suite green.`);
    console.error('Fix the suite so it sees the damage. Never delete the mutation.');
    process.exit(1);
  }
  console.log('\nselftest passed. Every mutation was watched to make its own suite refuse.');
  process.exit(0);
}

/* ------------------------------------------------------------------ main */

async function main() {
  if (SELFTEST) {
    selftest();
    return;
  }

  // The host has to exist before the registration path looks for it. Nothing in src reads it at
  // import time, but installing it first removes the question.
  globalThis.document = { modelContext: createFakeAgentHost() };

  const register = await import('../src/webmcp/register.js');
  const core = {
    ...(await import('../src/core/store.js')),
    ...(await import('../src/core/policy.js')),
  };

  const screens = degradationScreens(register);
  if (VERBOSE) {
    console.log('[Replay] The added screen, beyond the harness copy, will refuse any answer that says:');
    for (const screen of screens) console.log(`[Replay]   ${screen.label}  (from ${screen.from})`);
  }

  const cases = readJson(EVAL_FILE);
  const runs = [];
  for (let i = 0; i < cases.length; i += 1) {
    runs.push(await runCase(cases[i], register, core, i, screens));
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

/**
 * Run only when this file is the process entry point.
 *
 * WHY THE GUARD. tests/unit/replay_oracle.test.js imports MUTATIONS and PAGE_MIRROR from here, so
 * that the test holds the real values rather than a second copy of them, and a copy is the exact
 * defect this file was fixed for. Without the guard that import would boot the whole replay,
 * install a fake document on the test process and call process.exit.
 */
const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(2);
  });
}
