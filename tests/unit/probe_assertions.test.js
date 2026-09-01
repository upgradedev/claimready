/**
 * The browser probe's judgement, broken eight ways on purpose.
 *
 * WHY. `evals/browser_probe.mjs` used to print what it saw and exit 0 whatever that was, including
 * `api: null` against a page with no WebMCP at all. A reader could not tell a proof from a blank.
 * The judgement now lives in `evals/probe_assertions.mjs`, and this file is the proof that it
 * fails: a good transcript passes, and each mutation below turns it red for its own reason.
 *
 * The transcript here is the shape the probe collects from a browser. It is not a claim about a
 * browser: the real run is `node evals/browser_probe.mjs` against the deployed page, and the two
 * meet at this transcript.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkTranscript,
  CONDITIONAL_TOOL,
  DECLARED_TOOL,
  EXPECTED_BOOT_TOOLS,
} from '../../evals/probe_assertions.mjs';

/** What a healthy run against this page looks like. */
function goodTranscript() {
  return {
    api: 'document.modelContext',
    bootTools: [...EXPECTED_BOOT_TOOLS],
    toolsWhenStuck: [...EXPECTED_BOOT_TOOLS, CONDITIONAL_TOOL],
    toolsAfterRecovery: [...EXPECTED_BOOT_TOOLS],
    stalePatch: {
      answer: 'PATCH_REJECTED_STALE. expected revision 0, current revision 1.',
      revisionBefore: 1,
      revisionAfter: 1,
    },
    declared: {
      name: DECLARED_TOOL,
      description: 'Record the two supporting details on this claim draft.',
      schema: '{"type":"object","properties":{"witness_name":{},"police_report_ref":{},"base_revision":{}}}',
      answer: 'Recorded the name of the witness on the draft. The draft is now at revision 3.',
      revisionBefore: 2,
      revisionAfter: 3,
    },
    consoleProblems: [],
    threw: [],
  };
}

test('a healthy transcript passes, and it checks more than a handful of things', () => {
  const verdict = checkTranscript(goodTranscript());

  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.ok, true);
  assert.ok(verdict.checks >= 15, `expected a real matrix, ran ${verdict.checks} checks`);
});

/* --------------------------------------------------------------------- the mutation registry */

const mutations = [
  ['no WebMCP API at all', (t) => { t.api = null; }, /no WebMCP API was found/],
  ['nothing observed', () => null, /no transcript/],
  ['a mandatory tool missing', (t) => { t.bootTools = t.bootTools.filter((n) => n !== 'validate_claim'); }, /tools at boot are not the ones/],
  ['a forbidden tool published', (t) => { t.bootTools.push('file_claim'); }, /file_claim reached the tool surface/],
  ['the conditional tool present at boot', (t) => { t.bootTools.push(CONDITIONAL_TOOL); }, /only published while the claim says/],
  ['the conditional tool never appearing', (t) => { t.toolsWhenStuck = [...EXPECTED_BOOT_TOOLS]; }, /did not appear when the claim said/],
  ['the withdrawal not honoured', (t) => { t.toolsAfterRecovery = [...EXPECTED_BOOT_TOOLS, CONDITIONAL_TOOL]; }, /did not honour the withdrawal/],
  ['a stale patch that was not refused', (t) => { t.stalePatch.answer = 'Applied. The claim is now at revision 2.'; }, /not refused as stale/],
  ['a refusal that moved the state anyway', (t) => { t.stalePatch.revisionAfter = 2; }, /moved the revision from 1 to 2/],
  ['the declared tool missing', (t) => { t.declared.name = null; }, /did not build record_supporting_details/],
  ['the declared tool with the wrong schema', (t) => { t.declared.schema = '{"type":"object","properties":{}}'; }, /schema is not the one the markup describes/],
  ['the declared tool not advancing the draft', (t) => { t.declared.revisionAfter = 2; }, /moves it by exactly one/],
  ['a console error', (t) => { t.consoleProblems = ['Failed to load resource: 404']; }, /console or page error/],
  ['a tool that threw', (t) => { t.threw = ['read_claim_state: TypeError']; }, /threw instead of answering/],
];

for (const [what, mutate, expected] of mutations) {
  test(`the probe fails on ${what}`, () => {
    const transcript = goodTranscript();
    const mutated = mutate(transcript);
    const verdict = checkTranscript(mutated === null ? null : transcript);

    assert.equal(verdict.ok, false, `${what} passed, which means the probe would report it as proof`);
    assert.ok(
      verdict.failures.some((line) => expected.test(line)),
      `the failure did not say why. It said: ${verdict.failures.join(' | ')}`,
    );
  });
}
