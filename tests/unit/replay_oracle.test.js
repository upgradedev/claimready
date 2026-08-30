/**
 * The replay oracle, and the two copies of the page it is forced to keep.
 *
 * WHAT WENT WRONG, AND WHY A TEST RATHER THAN A COMMENT. `evals/replay.mjs` built its tool context
 * with `Array.isArray(policy.sections)`. The page decides the same question with
 * `Array.isArray(policy.coverages)`, in `hasSchedule` in src/ui/app.js. So `hasPolicySchedule` was
 * false on every replay that has ever run, `check_coverage` answered "The sample policy schedule
 * did not load", and the suite printed `Passed steps: 16/16`. Nothing was red. The oracle was
 * checking a field that does not exist and reporting a green run over a page that had told it, in
 * plain words, that it could not answer.
 *
 * src/ui/app.js exports nothing at all: it calls boot() at module top level, so `hasSchedule` and
 * `noScheduleReason` cannot be imported and the replay has to hold a copy of each. A copy held by
 * care is how this happened. This file holds them by assertion instead, reading the originals out
 * of src/ui/app.js and failing the moment the two disagree. Exporting the predicate from app.js
 * would delete the copy and is the better fix; it is a change to src, so it is written up in the
 * handover rather than made here.
 *
 * THE SECOND HALF OF THIS FILE IS ABOUT THE SCREEN ITSELF. The replay now applies its own result
 * screen on top of the one it copies from the harness. A screen is only worth having if it refuses
 * the right things and passes the rest, so both directions are asserted: a degraded answer is
 * caught, and a refusal, which is the product working correctly, is not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MUTATIONS, PAGE_MIRROR, degradationScreens, degradedAnswer } from '../../evals/replay.mjs';
import { NO_PACK_REASON } from '../../src/webmcp/register.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const APP = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8');

/**
 * The body of a named function declaration in a source file.
 *
 * Selected by NAME, never by searching for the text we hope to find. A search for the field name
 * would pass by matching anything, anywhere, which is the same defect one layer up.
 *
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function functionBody(source, name) {
  const opened = source.indexOf(`function ${name}(`);
  assert.notEqual(
    opened,
    -1,
    `src/ui/app.js no longer declares function ${name}. The replay mirrors it, so the mirror is now `
    + 'pointing at nothing and this test cannot check it. Find where the page decides this and '
    + 'repoint both.',
  );
  const brace = source.indexOf('{', opened);
  let depth = 0;
  for (let at = brace; at < source.length; at += 1) {
    if (source[at] === '{') depth += 1;
    else if (source[at] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, at);
    }
  }
  throw new Error(`function ${name} in src/ui/app.js is not brace balanced.`);
}

/**
 * The value of a `const <name> = '...' + '...';` declaration, joined.
 *
 * Only single quoted string parts are read, which is every string in this repository, and the
 * count of parts found is asserted so a declaration that changed shape fails loudly instead of
 * yielding an empty string that would then match anything.
 *
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function stringConstant(source, name) {
  const opened = source.indexOf(`const ${name} =`);
  assert.notEqual(opened, -1, `src/ui/app.js no longer declares const ${name}.`);
  const end = source.indexOf(';', opened);
  assert.notEqual(end, -1, `const ${name} in src/ui/app.js has no terminator.`);
  const slice = source.slice(opened, end);
  const parts = [...slice.matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]);
  assert.ok(parts.length > 0, `const ${name} in src/ui/app.js holds no single quoted string parts.`);
  return parts.join('').replace(/\\'/g, "'");
}

/* --------------------------------------------- the two mirrors of the page */

test('the replay reads the same policy field the page reads', () => {
  const body = functionBody(APP, 'hasSchedule');
  const fields = [...new Set([...body.matchAll(/policy\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];

  assert.ok(fields.length > 0, 'hasSchedule in src/ui/app.js reads no property of policy at all.');
  assert.deepEqual(
    fields,
    [PAGE_MIRROR.scheduleField],
    'src/ui/app.js decides whether a schedule is present from ' + fields.join(', ')
    + `, and evals/replay.mjs mirrors "${PAGE_MIRROR.scheduleField}". While these differ, every `
    + 'replay runs against a page that believes its own schedule did not load, and the suite '
    + 'reports every step green. Change the mirror in evals/replay.mjs, never this assertion.',
  );
});

test('the replay carries the page sentence for a missing schedule, character for character', () => {
  assert.equal(
    stringConstant(APP, 'noScheduleReason'),
    PAGE_MIRROR.noScheduleReason,
    'the sentence the page says when it has no schedule is not the sentence evals/replay.mjs '
    + 'screens for. A screen matching a sentence nothing produces catches nothing.',
  );
});

test('the mirrored sentence is the one check_coverage actually hands back', async () => {
  // Not a second reading of the same file: this drives the shipped tool with a context that has no
  // schedule and asserts the text that comes out of it carries the mirrored sentence. If the tool
  // ever stopped using ctx.noScheduleReason, the two assertions above would still both pass.
  const { default: checkCoverageTool } = await import('../../src/webmcp/tools/check_coverage.js');
  const { textOfResult } = await import('../../src/webmcp/register.js');
  const tool = checkCoverageTool({
    hasPolicySchedule: false,
    noScheduleReason: PAGE_MIRROR.noScheduleReason,
    store: { getState: () => ({ claim: {} }) },
  });
  const said = textOfResult(await tool.execute({}, {}));
  assert.ok(
    said.includes(PAGE_MIRROR.noScheduleReason),
    `check_coverage answered ${JSON.stringify(said)}, which does not carry the mirrored sentence.`,
  );
});

/* ------------------------------------------------------------- the screen */

test('the screen refuses an answer that says the rule pack did not load', () => {
  const screens = degradationScreens({ NO_PACK_REASON });
  const said = degradedAnswer(`${NO_PACK_REASON} Ask the claimant to reload.`, screens);
  assert.match(String(said), /the replay screen/);
  assert.match(String(said), /the insurer rule pack did not load/);
});

test('the screen refuses an answer that says the schedule did not load', () => {
  const screens = degradationScreens({ NO_PACK_REASON });
  const said = degradedAnswer(
    `${PAGE_MIRROR.noScheduleReason} Do not tell the claimant they are uncovered.`,
    screens,
  );
  assert.match(String(said), /the policy schedule did not load/);
});

test('the screen refuses an answer with no text in it', () => {
  const screens = degradationScreens({ NO_PACK_REASON });
  assert.match(String(degradedAnswer('', screens)), /no text at all/);
  assert.match(String(degradedAnswer('   \n  ', screens)), /no text at all/);
});

// THE OTHER DIRECTION, AND IT MATTERS MORE THAN THE THREE ABOVE. A refusal is the product working.
// Journey 2 requires a stale patch to be refused at step 5, so a screen that treated refusals as
// failures would turn the page's best behaviour into a red suite and the next person would widen
// the screen to get their build back.
test('the screen passes a refusal, which is the product working', () => {
  const screens = degradationScreens({ NO_PACK_REASON });
  for (const said of [
    'PATCH_REJECTED_STALE. expected revision 0, current revision 1. Read the claim state again.',
    'NOT READY TO FILE at revision 0. FILE_REFUSED_INCOMPLETE.',
    'Refused. FORM_REFUSED_EMPTY: Nothing was submitted.',
    'Cover decision under Northwind Mutual rules: NOT COVERED.',
  ]) {
    assert.equal(degradedAnswer(said, screens), undefined, `the screen wrongly refused: ${said}`);
  }
});

test('a screen sourced from an empty constant is refused at build time, not at match time', () => {
  // The failure this guards is silent by nature. An empty screen matches nothing, so every step
  // passes and the run looks exactly like a healthy one.
  assert.throws(
    () => degradationScreens({ NO_PACK_REASON: '' }),
    /not a screen/,
    'degradationScreens accepted an empty sentence and would have screened nothing.',
  );
  assert.throws(() => degradationScreens({}), /not a screen/);
});

/* ---------------------------------------------------- the mutation registry */

test('every mutation names a suite the runner knows', () => {
  assert.ok(MUTATIONS.size >= 4, `only ${MUTATIONS.size} mutations are registered.`);
  for (const [name, spec] of MUTATIONS) {
    assert.ok(['positive', 'negative'].includes(spec.suite), `${name} names the suite ${spec.suite}`);
    assert.ok(String(spec.breaks).length > 20, `${name} does not say what it breaks`);
  }
  const suites = new Set([...MUTATIONS.values()].map((m) => m.suite));
  assert.deepEqual(
    [...suites].sort(),
    ['negative', 'positive'],
    'both suites need at least one mutation, or one of them has never been watched to fail.',
  );
});

// A MUTATION NO COMMAND RUNS IS DEAD CONFIGURATION. The workflow used to list the three mutations
// by hand, so a fourth would have been registered here and executed by nothing. It now calls
// --selftest, which iterates the registry.
test('CI runs the whole mutation registry rather than a copy of it', () => {
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'evals.yml'), 'utf8');
  assert.ok(
    workflow.includes('evals/replay.mjs --selftest'),
    '.github/workflows/evals.yml does not run node evals/replay.mjs --selftest, so a mutation '
    + 'added to the registry would be run by nothing.',
  );
});
