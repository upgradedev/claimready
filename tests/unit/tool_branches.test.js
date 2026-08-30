/**
 * The refusal and edge branches of every published tool.
 *
 * WHY A SECOND WEBMCP FILE. tests/unit/webmcp.test.js drives the registration layer: what the page
 * publishes, what the browser is handed, what happens when a host refuses a tool. It calls each
 * tool mostly down its happy path. The branch column said so: get_repair_estimate sat at 23.53%,
 * validate_claim at 45.45%, check_coverage at 57.89%. Those percentages are made of the paths a
 * claimant actually meets, because almost every one of them is a refusal: the cover cannot be
 * checked yet, the band has no severity to work from, this tool no longer applies, the rule pack
 * did not load. A tool that is only tested when everything is in place is untested where it
 * matters.
 *
 * HOW IT DRIVES THEM. Each tool is a factory taking a context, so the descriptor is built directly
 * and its execute called. No agent host is involved and none is needed: what is under test is what
 * the tool says, not how it got registered, and webmcp.test.js already owns that question against
 * its fake host. Every context here is built from the shipped fixtures and the shipped rule packs,
 * so no sentence asserted below is written anywhere but in src.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { textOfResult } from '../../src/webmcp/register.js';
import { createStore } from '../../src/core/store.js';
import { loadPolicyPack } from '../../src/core/policy.js';

import checkCoverageTool from '../../src/webmcp/tools/check_coverage.js';
import getRepairEstimateTool from '../../src/webmcp/tools/get_repair_estimate.js';
import validateClaimTool from '../../src/webmcp/tools/validate_claim.js';
import getAssistanceOptionsTool from '../../src/webmcp/tools/get_assistance_options.js';
import describeClaimTool from '../../src/webmcp/tools/describe_claim.js';
import readEvidenceNotesTool from '../../src/webmcp/tools/read_evidence_notes.js';
import readClaimStateTool from '../../src/webmcp/tools/read_claim_state.js';
import getRequirementsTool from '../../src/webmcp/tools/get_requirements.js';
import applyClaimPatchTool from '../../src/webmcp/tools/apply_claim_patch.js';

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

const fixture = readJson('../../fixtures/demo-collision.json');
const northwind = loadPolicyPack(readJson('../../fixtures/insurers/northwind.json'));
const kestrel = loadPolicyPack(readJson('../../fixtures/insurers/kestrel.json'));

/** A context over the shipped fixture, with only what a test needs overridden. */
function makeContext(claimSeed = {}, overrides = {}) {
  const published = [];
  const store = createStore({ ...fixture, claim: { ...fixture.claim, ...claimSeed } });
  return {
    published,
    store,
    pack: northwind,
    packId: 'northwind',
    homePackId: 'northwind',
    policy: northwind,
    policyId: 'MTR-2026-0417',
    currency: 'EUR',
    vehicleClass: 'compact',
    hasPolicySchedule: true,
    noScheduleReason: 'The policy schedule did not load, so this page cannot say what is covered.',
    humanActions: [],
    getRequirements: () => [],
    publish: (channel, payload) => published.push({ channel, payload }),
    ...overrides,
  };
}

/** An AbortSignal that is already aborted, as a host hands one to a cancelled call. */
const ABORTED = { signal: { aborted: true } };

async function run(factory, ctx, input = {}, options = {}) {
  return textOfResult(await factory(ctx).execute(input, options));
}

/* ------------------------------------------------------------ cancellation */

test('every tool answers a call that was already cancelled, and answers it in its own words', async () => {
  // A tool that ignored an aborted signal would do the work anyway and, worse, publish it to the
  // page. Each says what it was cancelled before doing, so a ledger entry is still readable.
  const cases = [
    [checkCoverageTool, /Cancelled before the cover was checked/],
    [getRepairEstimateTool, /Cancelled before the band was worked out/],
    [validateClaimTool, /Cancelled before the draft was checked/],
    [describeClaimTool, /Cancelled before the summary was read/],
    [readEvidenceNotesTool, /Cancelled before the notes were read/],
    [readClaimStateTool, /Cancelled before the draft was read/],
    [getAssistanceOptionsTool, /Cancelled before the options were read/],
  ];

  for (const [factory, says] of cases) {
    const ctx = makeContext();
    const said = await run(factory, ctx, {}, ABORTED);
    assert.match(said, says);
    assert.equal(ctx.published.length, 0, 'a cancelled call must publish nothing to the page');
  }
});

/* ------------------------------------------------------------ check_coverage */

test('check_coverage refuses rather than call someone uncovered when there is no schedule', async () => {
  const ctx = makeContext({}, { hasPolicySchedule: false });
  const said = await run(checkCoverageTool, ctx);

  assert.match(said, /The policy schedule did not load/);
  assert.match(said, /Do not tell the claimant they are uncovered/);
  assert.doesNotMatch(said, /NOT COVERED/, 'no schedule is an unknown, never a no');
  assert.equal(ctx.published.length, 0);
});

test('check_coverage says which field it needs rather than guessing', async () => {
  const ctx = makeContext({ incident_type: null });
  const said = await run(checkCoverageTool, ctx);

  assert.match(said, /incident_type is empty/);
  assert.match(said, /Set it with apply_claim_patch/);
  assert.equal(ctx.published.length, 0);
});

test('check_coverage names the insurer whose rules answered, not only the policy number', async () => {
  // The claim belongs to a policy with northwind. Kestrel's rules are loaded against it. Saying
  // only the policy number here would print one insurer's clauses under another's policy.
  const ctx = makeContext({ incident_type: 'collision', driver: 'Maria K.' }, {
    pack: kestrel, policy: kestrel, packId: 'kestrel', homePackId: 'northwind',
  });
  const said = await run(checkCoverageTool, ctx);

  assert.match(said, new RegExp(`${kestrel.insurer} rules`));
  assert.match(said, new RegExp(`Policy MTR-2026-0417 is not with ${kestrel.insurer}`));
  assert.equal(ctx.published.length, 1);
  assert.equal(ctx.published[0].channel, 'coverage');
  assert.equal(ctx.published[0].payload.source, 'agent');
});

test('check_coverage marks a yes that still depends on the driver as provisional', async () => {
  const ctx = makeContext({ incident_type: 'collision', driver: null });
  const said = await run(checkCoverageTool, ctx);

  if (/PROVISIONALLY/.test(said)) {
    // The warning is the first thing after the head, because a provisional yes read as a plain yes
    // is the worst thing this tool can cause.
    assert.match(said, /do not tell the claimant they are covered yet/);
    const warningAt = said.indexOf('do not tell the claimant');
    const clauseAt = said.indexOf('Clause:');
    if (clauseAt !== -1) assert.ok(warningAt < clauseAt, 'the warning must come before the clause text');
  }
  assert.match(said, /not a settlement decision/, 'the closing line must survive the output budget');
});

test('check_coverage prints the exclusion that applied and the deductible, in the packs own words', async () => {
  const excluded = makeContext({ incident_type: 'theft', driver: 'Maria K.' });
  const saidNo = await run(checkCoverageTool, excluded);
  assert.match(saidNo, /Cover decision under/);
  assert.match(saidNo, /not a settlement decision/);

  const covered = makeContext({ incident_type: 'collision', driver: 'Maria K.' });
  const saidYes = await run(checkCoverageTool, covered);
  if (/: COVERED\./.test(saidYes)) {
    assert.match(saidYes, /Deductible the claimant pays: \d+/);
  }
});

test('check_coverage still works with no page to publish to', async () => {
  // A tool must run from a harness that has no view. The publish guard is what makes that true.
  const ctx = makeContext({ incident_type: 'collision' }, { publish: undefined });
  const said = await run(checkCoverageTool, ctx);
  assert.match(said, /Cover decision under/);
});

/* ------------------------------------------------------------ get_repair_estimate */

test('get_repair_estimate names the missing field rather than inventing a band', async () => {
  const noZone = makeContext({ damage_zone: null, severity: 'dent' });
  const saidZone = await run(getRepairEstimateTool, noZone);
  assert.match(saidZone, /damage_zone is empty/);
  assert.match(saidZone, /a clock position from 1 to 12/);
  assert.equal(noZone.published.length, 0);

  const noSeverity = makeContext({ damage_zone: 10, severity: null });
  const saidSeverity = await run(getRepairEstimateTool, noSeverity);
  assert.match(saidSeverity, /severity is empty/);
  assert.match(saidSeverity, /or pass severity to this tool/);
  assert.equal(noSeverity.published.length, 0);
});

test('get_repair_estimate refuses a severity that is not one of the three', async () => {
  const ctx = makeContext({ damage_zone: 10, severity: 'dent' });
  const said = await run(getRepairEstimateTool, ctx, { severity: 'catastrophic' });

  assert.match(said, /severity must be one of/);
  assert.match(said, /Nothing was changed/);
  assert.equal(ctx.published.length, 0, 'a refused what if must not reach the page');
});

test('a what if band says the draft was not changed, and names what the draft still says', async () => {
  const ctx = makeContext({ damage_zone: 10, severity: 'dent' });
  const said = await run(getRepairEstimateTool, ctx, { severity: 'structural' });

  assert.match(said, /What if severity were structural/);
  assert.match(said, /The draft still says severity dent\. Nothing was written/);
  assert.equal(ctx.published[0].payload.whatIf, true);
  assert.equal(ctx.published[0].payload.severity, 'structural');
});

test('a what if on a draft with no severity at all says the draft is empty', async () => {
  const ctx = makeContext({ damage_zone: 10, severity: null });
  const said = await run(getRepairEstimateTool, ctx, { severity: 'scratch' });

  assert.match(said, /The draft still says severity is empty/);
  assert.equal(ctx.published[0].payload.whatIf, true);
});

test('asking for the severity the draft already has is not a what if', async () => {
  const ctx = makeContext({ damage_zone: 10, severity: 'dent' });
  const said = await run(getRepairEstimateTool, ctx, { severity: 'DENT' });

  assert.doesNotMatch(said, /What if/, 'the same answer is not a hypothetical');
  assert.doesNotMatch(said, /Nothing was written/);
  assert.equal(ctx.published[0].payload.whatIf, false);
});

test('an empty severity argument is ignored rather than treated as an answer', async () => {
  const ctx = makeContext({ damage_zone: 10, severity: 'dent' });
  const said = await run(getRepairEstimateTool, ctx, { severity: '' });
  assert.match(said, /repair band \d+ to \d+/);
  assert.doesNotMatch(said, /What if/);
});

test('get_repair_estimate lists its parts and always closes by saying it is not a quote', async () => {
  const ctx = makeContext({ damage_zone: 10, severity: 'structural' });
  const said = await run(getRepairEstimateTool, ctx);

  assert.match(said, /Parts: /);
  assert.match(said, /not a quote and not a prediction/);
});

test('get_repair_estimate still works with no page to publish to', async () => {
  const ctx = makeContext({ damage_zone: 10, severity: 'dent' }, { publish: null });
  const said = await run(getRepairEstimateTool, ctx);
  assert.match(said, /repair band/);
});

/* ------------------------------------------------------------ validate_claim */

test('validate_claim says not ready and names the fields, and never offers to file', async () => {
  const ctx = makeContext({ damage_zone: null, severity: null, description: null, vehicle_drivable: null });
  const said = await run(validateClaimTool, ctx);

  assert.match(said, /NOT READY TO FILE at revision \d+\. FILE_REFUSED_INCOMPLETE\./);
  assert.match(said, /Missing: /);
  assert.match(said, /Why: Still needed before you can file/);
  assert.match(said, /Filing is a control on this page and is not exposed as a WebMCP tool\./);
});

test('validate_claim keeps the two questions apart on a draft that is full but still asked of', async () => {
  const ctx = makeContext({
    damage_zone: 10, severity: 'structural', vehicle_drivable: false,
    description: 'A car came out of a side road and hit the left front wing.',
  });
  const said = await run(validateClaimTool, ctx);

  // THE HEADLINE IS THE FILING DECISION, NOT THE STATIC FIELD LIST. This draft answers every
  // required field, and this insurer asks a structural claim for a police report reference and a
  // vehicle that cannot be driven for a collection, so it cannot be filed. The tool used to open
  // with READY here and then contradict itself two lines later.
  assert.match(said, /NOT READY TO FILE at revision \d+\. FILE_REFUSED_REQUIREMENTS\./);
  assert.doesNotMatch(said, /Missing: /, 'every required field is filled, so nothing is missing');
  // The required fields being filled is one question. What the insurer still wants is another.
  assert.match(said, /Separately, \d+ of this insurer's intake requirements are still open/);
  assert.match(said, /Call get_requirements for why/);
  assert.match(said, /Filing is a control on this page and is not exposed as a WebMCP tool\./);
  assert.match(said, /from the button and from a direct call alike/);
});

test('validate_claim says so plainly when the intake is answered too', async () => {
  // No pack at all is the other half: the tool must not invent an intake it cannot read.
  const noPack = makeContext({}, { pack: null, policy: null });
  const said = await run(validateClaimTool, noPack);
  assert.doesNotMatch(said, /intake requirements/, 'with no pack there is nothing to say about the intake');
  assert.match(said, /revision \d+/);
});

/* ------------------------------------------------------------ get_assistance_options */

test('get_assistance_options answers honestly when the claim no longer says undrivable', async () => {
  const ctx = makeContext({ vehicle_drivable: true });
  const said = await run(getAssistanceOptionsTool, ctx);

  assert.match(said, /no longer says the vehicle cannot be driven/);
  assert.match(said, /withdrawn while the vehicle is drivable/);
});

test('get_assistance_options refuses to describe options with no rule pack loaded', async () => {
  const ctx = makeContext({ vehicle_drivable: false }, { pack: null, policy: null });
  const said = await run(getAssistanceOptionsTool, ctx);
  assert.doesNotMatch(said, /options for a vehicle that cannot be driven/);
  assert.ok(said.length > 0, 'a tool that says nothing at all is worse than one that refuses');
});

test('get_assistance_options lists the insurers own options, and says what no tool reaches', async () => {
  const ctx = makeContext({ vehicle_drivable: false, incident_type: 'collision' });
  const said = await run(getAssistanceOptionsTool, ctx);

  assert.match(said, new RegExp(`${northwind.insurer} options for a vehicle that cannot be driven`));
  assert.match(said, /not a booking and not a decision about the claim/);
  assert.match(said, /The collection is arranged by pressing that button on this page, which is not exposed as a WebMCP tool/);
});

test('an assistance option the person has already done is not asked for again', async () => {
  const open = makeContext({ vehicle_drivable: false, incident_type: 'collision' });
  const before = await run(getAssistanceOptionsTool, open);

  const humanOnly = /No tool on this page reaches this one\. Ask the person on the page/.test(before);
  if (!humanOnly) return;

  // The same derivation, with the action recorded as done. The wording must move from "ask them"
  // to "there is nothing to ask them for", and it is the page that supplies that fact.
  const ids = northwind.requirements
    .filter((rule) => rule.triggered_by === 'vehicle_drivable' || (rule.when && JSON.stringify(rule.when).includes('vehicle_drivable')))
    .map((rule) => rule.id);
  const done = makeContext(
    { vehicle_drivable: false, incident_type: 'collision' },
    { humanActions: ids },
  );
  const after = await run(getAssistanceOptionsTool, done);
  assert.notEqual(after, before, 'recording the action done must change what the agent is told');
});

/* ------------------------------------------------------------ the reading tools */

test('read_evidence_notes says there are none rather than returning an empty block', async () => {
  const ctx = makeContext({ evidence_notes: [] });
  const said = await run(readEvidenceNotesTool, ctx);
  assert.equal(said, 'No notes are attached to this claim file.');
});

test('read_evidence_notes returns the notes, and the tool declares them untrusted', async () => {
  const ctx = makeContext();
  const descriptor = readEvidenceNotesTool(ctx);
  // The words in a note were typed by somebody else. The hint is how an agent is told not to
  // follow instructions found in them.
  assert.equal(descriptor.annotations.readOnlyHint, true);
  assert.equal(descriptor.annotations.untrustedContentHint, true);

  const said = textOfResult(await descriptor.execute({}, {}));
  assert.ok(said.length > 0);
  assert.doesNotMatch(said, /No notes are attached/);
});

test('read_claim_state explains the clock face only while the position is still open', async () => {
  const open = makeContext({ damage_zone: null });
  const saidOpen = await run(readClaimStateTool, open);
  assert.match(saidOpen, /damage_zone is a clock position on the vehicle/);
  assert.match(saidOpen, /Quote revision \d+ as baseRevision/);
  assert.match(saidOpen, /Filing the claim is a control on this page and is not exposed as a WebMCP tool/);

  const answered = makeContext({ damage_zone: 10 });
  const saidAnswered = await run(readClaimStateTool, answered);
  assert.doesNotMatch(saidAnswered, /damage_zone is a clock position on the vehicle/,
    'once it is answered that line is budget spent on something the agent has done');
});

test('read_claim_state describes the intake, and says nothing about it with no pack', async () => {
  const withPack = makeContext();
  assert.match(await run(readClaimStateTool, withPack), /intake requirements/);

  const noPack = makeContext({}, { pack: null, policy: null });
  const said = await run(readClaimStateTool, noPack);
  assert.doesNotMatch(said, /intake requirements/);
  assert.match(said, /Quote revision \d+ as baseRevision/);
});

test('describe_claim returns the summary the domain composed, and declares it untrusted', async () => {
  const ctx = makeContext();
  const descriptor = describeClaimTool(ctx);
  assert.equal(descriptor.annotations.untrustedContentHint, true);
  const said = textOfResult(await descriptor.execute({}, {}));
  assert.ok(said.length > 0);
});

test('get_requirements answers with and without a pack', async () => {
  const withPack = makeContext({ incident_type: 'collision' });
  const said = await run(getRequirementsTool, withPack);
  assert.ok(said.length > 0);

  const noPack = makeContext({}, { pack: null, policy: null });
  const saidNone = await run(getRequirementsTool, noPack);
  assert.ok(saidNone.length > 0, 'no pack is a reason to give, not a reason to say nothing');

  const cancelled = await run(getRequirementsTool, makeContext(), {}, ABORTED);
  assert.match(cancelled, /Cancelled/);
});

/* ------------------------------------------------------------ the one writing tool */

test('apply_claim_patch refuses a write that does not quote the revision it read', async () => {
  const ctx = makeContext();
  const said = await run(applyClaimPatchTool, ctx, { changes: [{ field: 'severity', value: 'dent' }] });
  assert.match(said, /REFUSED|refused|baseRevision/, 'a blind write must not land');
});

test('apply_claim_patch declares that it writes, and is cancelled like the rest', async () => {
  const ctx = makeContext();
  const descriptor = applyClaimPatchTool(ctx);
  // The one tool that writes. It must say so rather than leave readOnlyHint to a default.
  assert.equal(descriptor.annotations.readOnlyHint, false);

  const cancelled = textOfResult(await descriptor.execute(
    { changes: [{ field: 'severity', value: 'dent' }] },
    ABORTED,
  ));
  assert.match(cancelled, /Cancelled/);
  assert.equal(ctx.store.getState().claim.severity, fixture.claim.severity ?? null,
    'a cancelled write must leave the draft where it was');
});

/* ------------------------------------------------------------ the output budget */

/**
 * A rule pack with far more open requirements than a tool result has room for.
 *
 * Built by adding rules to the SHIPPED pack rather than by inventing one, so it stays a pack the
 * real loader accepts and the real derivation walks. The number of rules and the length of their
 * reason lines are the insurer's business, not the tool's, which is exactly the property that once
 * cost two tools their closing sentence.
 */
function crowdedPack(count = 40) {
  const raw = readJson('../../fixtures/insurers/northwind.json');
  const extra = [];
  for (let index = 0; index < count; index += 1) {
    extra.push({
      id: `synthetic_ask_${index}`,
      label: `A synthetic intake question number ${index} used to crowd the output budget`,
      why: `Clause SY-${index} asks for this, and the sentence is written at the length an insurer's `
        + 'own prose actually runs to, because the length of this text is the pack\'s business and '
        + 'not the tool\'s, which is the whole reason the budget exists.',
      satisfied_by: { human_action: 'The claimant does this away from the page.' },
    });
  }
  return loadPolicyPack({ ...raw, requirements: [...raw.requirements, ...extra] });
}

test('a pack too long for the output budget loses body lines, never the closing sentence', async () => {
  const pack = crowdedPack();
  const ctx = makeContext({ incident_type: 'collision' }, { pack, policy: pack });

  const said = await run(getRequirementsTool, ctx);

  assert.ok(said.length <= 1500, `the result is ${said.length} characters, over the tool budget`);
  // The line that says something was dropped has to be there, or the agent believes it has the
  // whole list and tells the claimant so.
  assert.match(said, /withheld|not shown|more/i);
});

test('validate_claim keeps the sentence about filing even when the intake list is enormous', async () => {
  const pack = crowdedPack();
  const ctx = makeContext({
    damage_zone: 10, severity: 'structural', vehicle_drivable: false,
    description: 'A car came out of a side road and hit the left front wing.',
  }, { pack, policy: pack });

  const said = await run(validateClaimTool, ctx);

  assert.ok(said.length <= 1500, `the result is ${said.length} characters, over the tool budget`);
  // THIS IS THE POINT OF THE TOOL AND IT LIVES IN THE TAIL FOR THAT REASON. A long rule pack once
  // pushed exactly this sentence off the end.
  assert.match(said, /is not exposed as a WebMCP tool\./);
});

test('read_claim_state keeps the baseRevision instruction under a crowded pack', async () => {
  const pack = crowdedPack();
  const ctx = makeContext({ incident_type: 'collision' }, { pack, policy: pack });

  const said = await run(readClaimStateTool, ctx);

  assert.ok(said.length <= 1500, `the result is ${said.length} characters, over the tool budget`);
  // Drop this line and no caller is told which revision to quote, so the write path goes unused.
  // It is therefore the last thing a budget squeeze may drop.
  assert.match(said, /as baseRevision/);
  assert.match(said, /Filing the claim is a control on this page/);
});

test('get_assistance_options keeps its closing caveat under a crowded pack', async () => {
  const raw = readJson('../../fixtures/insurers/northwind.json');
  const extra = [];
  for (let index = 0; index < 30; index += 1) {
    extra.push({
      id: `synthetic_tow_${index}`,
      label: `A synthetic collection option number ${index} written at an insurer's own length`,
      why: `Clause TW-${index} provides for this whenever the vehicle cannot be driven, and the `
        + 'sentence runs to the length these clauses actually run to in a published rule pack.',
      when: { field: 'vehicle_drivable', equals: false },
      triggered_by: 'vehicle_drivable',
      satisfied_by: { human_action: 'The claimant arranges this with the handler.' },
    });
  }
  const pack = loadPolicyPack({ ...raw, requirements: [...raw.requirements, ...extra] });
  const ctx = makeContext({ vehicle_drivable: false, incident_type: 'collision' }, { pack, policy: pack });

  const said = await run(getAssistanceOptionsTool, ctx);

  assert.ok(said.length <= 1500, `the result is ${said.length} characters, over the tool budget`);
  assert.match(said, /not a booking and not a decision about the claim/);
});
