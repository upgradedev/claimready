/**
 * Read every recorded run, score them all the same way, and print what happened.
 *
 *   node scripts/analyze_impact.mjs [--runs evidence/impact/runs] [--out evidence/impact/results.md]
 *                                   [--interpretation evidence/impact/interpretation-v1.md]
 *                                   [--contract claimready.impact.run.v1] [--check]
 *
 * IT REFUSES TO WRITE A HEADLINE IT CANNOT SUPPORT. The protocol fixes six scenarios, two arms and
 * three repeats: 36 runs. Anything less and this prints the counts it has, says the word
 * `AWAITING_RUNS` where a headline would go, and exits 1. That is the whole reason it exists as a
 * separate program: the temptation at the end of a hackathon is to write the sentence first and
 * collect the runs that agree with it.
 *
 * It also never says "significant", never extrapolates past the runs in the folder, and never
 * describes the participants as anything but what they were, which is language models.
 *
 * THE WHOLE ARTIFACT IS GENERATED, THE PROSE AT THE BOTTOM INCLUDED. It did not use to be.
 * `results.md` carried four hand written paragraphs this program had never produced, so running it
 * over the committed runs deleted them, and the committed file could not be reproduced from the
 * evidence it summarises. Reproduced before the change with:
 *
 *   node scripts/analyze_impact.mjs --out $TMP/regen.md
 *   diff evidence/impact/results.md $TMP/regen.md
 *
 * which printed 27 lines present in the committed file and absent from the regenerated one. The
 * human interpretation now lives in its own file and is inlined from there.
 *
 * `--check` WRITES NOTHING. It builds the report in memory, compares it with the file at `--out`,
 * and exits 1 on any difference. That is the only mode worth running in CI, because a gate that
 * rebuilds the artifact it is auditing cannot tell you what was committed.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalise, scoreRun } from '../evidence/impact/scoring.mjs';
import { loadPolicyPack } from '../src/core/policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const argOf = (name, fallback) => (process.argv.includes(name)
  ? process.argv[process.argv.indexOf(name) + 1]
  : fallback);

// BOTH PATHS RESOLVE, THEY DO NOT JOIN. `path.join` glues its arguments together whatever they
// are, so an absolute `--runs C:\...\fixture-runs` used to come out as the repository root with a
// second drive letter stapled on the end. The directory never existed, so the analyzer reported
// no runs and refused, which reads exactly like a real refusal and is not one. That mattered here
// because the only safe way to test the refusal is to point it at a throwaway directory somewhere
// else on the disk. `path.resolve` leaves an absolute argument alone and still treats a relative
// one as relative to the repository root, so the documented usage above is unchanged.
const runsDir = path.resolve(ROOT, argOf('--runs', 'evidence/impact/runs'));
const outFile = path.resolve(ROOT, argOf('--out', 'evidence/impact/results.md'));
const interpretationFile = path.resolve(ROOT, argOf('--interpretation', 'evidence/impact/interpretation-v1.md'));
const contract = argOf('--contract', 'claimready.impact.run.v1');
const checkOnly = process.argv.includes('--check');

const scenarios = JSON.parse(readFileSync(path.join(ROOT, 'evidence/impact/scenarios.json'), 'utf8'));
const pack = loadPolicyPack(JSON.parse(readFileSync(path.join(ROOT, 'fixtures/insurers/northwind.json'), 'utf8')));
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/demo-collision.json'), 'utf8'));

// The same policy with the demo file's pre-filled claim taken away. This is the control for the
// seeding. It is derived from the fixture rather than typed out, so a fixture whose policy id
// changed could not leave a stale literal sitting here.
const unseededFixture = { policy: fixture.policy };

const EXPECTED_REPEATS = 3;
const ARMS = ['published-rules', 'static-form'];
const EXPECTED_RUNS = scenarios.scenarios.length * ARMS.length * EXPECTED_REPEATS;

/* --------------------------------------------------------------------------- read and validate */

// v1 asked for the five keys a score needs. v2 asks for those plus the request and runtime
// metadata that v1 never captured, which is written up in `evidence/impact/errata-v1.md`. The
// contract named on the run file decides which list applies, so a v1 run cannot be laundered into
// a v2 folder and a v2 run cannot quietly drop the metadata rule.
const REQUIRED_KEYS = {
  'claimready.impact.run.v1': ['scenario_id', 'arm', 'repeat', 'model', 'fields'],
  'claimready.impact.run.v2': [
    'scenario_id', 'arm', 'repeat', 'model', 'fields',
    'model_snapshot', 'request_settings', 'response_ids', 'page_url', 'browser_version',
    'verified_runtime_sha',
  ],
};

function requiredKeysFor(name) {
  const list = REQUIRED_KEYS[name];
  if (!list) {
    console.error(`analyze_impact: unknown contract ${name}. Known: ${Object.keys(REQUIRED_KEYS).join(', ')}`);
    process.exit(2);
  }
  return list;
}

function loadRuns(directory) {
  if (!existsSync(directory)) return { runs: [], problems: [`there is no ${path.relative(ROOT, directory)} directory yet`] };
  const problems = [];
  const runs = [];
  const seen = new Set();
  const required = requiredKeysFor(contract);

  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(directory, name);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, 'utf8'));
    } catch (error) {
      problems.push(`${name}: not readable JSON, ${error.message}`);
      continue;
    }
    // A run that names a contract has to name this one. A run that names none is read under the
    // contract asked for, which is how the v1 files stayed readable when v2 arrived.
    if (parsed.contract !== undefined && parsed.contract !== contract) {
      problems.push(`${name}: contract ${JSON.stringify(parsed.contract)} is not ${contract}`);
      continue;
    }
    const missing = required.filter((key) => parsed[key] === undefined);
    if (missing.length) {
      problems.push(`${name}: missing ${missing.join(', ')}`);
      continue;
    }
    if (!ARMS.includes(parsed.arm)) {
      problems.push(`${name}: arm ${JSON.stringify(parsed.arm)} is not one of ${ARMS.join(' or ')}`);
      continue;
    }
    const scenario = scenarios.scenarios.find((entry) => entry.id === parsed.scenario_id);
    if (!scenario) {
      problems.push(`${name}: scenario ${parsed.scenario_id} is not in scenarios.json`);
      continue;
    }
    const key = `${parsed.scenario_id}|${parsed.arm}|${parsed.repeat}`;
    if (seen.has(key)) {
      problems.push(`${name}: a second run for ${key}. Duplicates are not averaged away here`);
      continue;
    }
    seen.add(key);
    runs.push({ file: name, run: parsed, scenario });
  }
  return { runs, problems };
}

const { runs, problems } = loadRuns(runsDir);
const scored = runs.map(({ run, scenario, file }) => ({ file, ...scoreRun(run, { pack, scenario, fixture }) }));

// The same runs scored again with nothing pre-filled. No published number is taken from this pass.
// It exists so the counts above it can be read for what they are.
const unseeded = runs.map(({ run, scenario, file }) => ({
  file,
  ...scoreRun(run, { pack, scenario, fixture: unseededFixture }),
}));

/* ------------------------------------------------------------------------------------ counting */

const usable = scored.filter((row) => !row.technical_failure);
const byArm = (arm) => usable.filter((row) => row.arm === arm);
const median = (numbers) => {
  const list = numbers.filter((value) => typeof value === 'number').sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
};

function summarise(arm) {
  const rows = byArm(arm);
  return {
    arm,
    runs: rows.length,
    ready: rows.filter((row) => row.ready).length,
    median_open: median(rows.map((row) => row.open_requirements)),
    with_mismatch: rows.filter((row) => (row.truth_mismatches || []).length > 0).length,
    median_turns: median(rows.map((row) => row.turns)),
    refused_values: rows.filter((row) => !row.accepted).length,
    // The same arm with the demo fixture's three answers taken away.
    ready_unseeded: unseeded.filter((row) => !row.technical_failure && row.arm === arm && row.ready).length,
  };
}

/**
 * The endpoint protocol v2 preregisters, measured here on the v1 runs so the number exists before
 * a v2 run does.
 *
 * A scenario whose truth sheet names no clock position is left out of the denominator rather than
 * counted as a pass. S5 is the theft: the car is gone and there is no panel to point at.
 */
function damageZone(arm) {
  const rows = runs.filter(({ run }) => run.arm === arm);
  let asked = 0;
  let correct = 0;
  let absent = 0;
  let wrong = 0;
  for (const { run, scenario } of rows) {
    const truth = scenario.truth ? scenario.truth.damage_zone : undefined;
    if (truth === undefined || truth === null) continue;
    asked += 1;
    const answered = normalise(run.fields || {}).fields.damage_zone;
    if (answered === undefined || answered === null || answered === '') absent += 1;
    else if (answered === truth) correct += 1;
    else wrong += 1;
  }
  return { arm, asked, correct, absent, wrong };
}

const summaries = ARMS.map(summarise);
const zones = ARMS.map(damageZone);
const complete = usable.length === EXPECTED_RUNS && problems.length === 0;

/* ------------------------------------------------------------------------------------- writing */

// Every path a reader is pointed at is the one this run actually used. A header that names
// protocol v1 above a folder of v2 runs is the kind of detail nobody checks and everybody trusts.
const asPosix = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');
const protocolPath = contract === 'claimready.impact.run.v2'
  ? 'evidence/impact/protocol-v2.md'
  : 'evidence/impact/protocol-v1.md';

const lines = [];
lines.push('# Impact runs, scored');
lines.push('');
lines.push('Generated by `node scripts/analyze_impact.mjs`. Do not edit by hand: it is overwritten.');
lines.push('Every word below, the interpretation at the bottom included, comes out of that program,');
lines.push(`from the run files in \`${asPosix(runsDir)}\` and from \`${asPosix(interpretationFile)}\`.`);
lines.push('To check the committed file against the runs without writing anything, run the same');
lines.push('command with `--check` on the end.');
lines.push('');
lines.push('**The participants were language models, not people.** This measures whether an agent');
lines.push('produces a first notice that is complete under this insurer\'s own rules, with and');
lines.push('without the page publishing those rules as typed tools. It measures nothing about time,');
lines.push(`effort, satisfaction or real claims. The protocol is \`${protocolPath}\`, written before`);
lines.push('any run it covers. What protocol v1 promised and its runs did not deliver is listed in');
lines.push('`evidence/impact/errata-v1.md`, which is worth reading before any number here.');
lines.push('');
lines.push('**Three answers were already on the file before any run was scored.** The scorer builds');
lines.push('its draft from the demo fixture the page opens on, and that fixture arrives with');
lines.push('`incident_date`, `incident_type` and `driver` filled in. Every count below is what a');
lines.push('model produced combined with those three. It is not a count of claims an agent completed');
lines.push('on its own, and the section under the counts shows what is left when they are removed.');
lines.push('');

if (!complete) {
  lines.push('## AWAITING_RUNS');
  lines.push('');
  lines.push(`The protocol fixes ${EXPECTED_RUNS} runs, ${ARMS.length} arms over `
    + `${scenarios.scenarios.length} scenarios with ${EXPECTED_REPEATS} repeats. `
    + `${usable.length} usable run(s) are on disk.`);
  lines.push('');
  lines.push('No headline is written from a partial set.');
  lines.push('');
}

lines.push('## Counts');
lines.push('');
lines.push('| Arm | Runs | Policy complete | Median open requirements | Runs with a truth mismatch | Median turns |');
lines.push('|---|---|---|---|---|---|');
for (const row of summaries) {
  lines.push(`| ${row.arm} | ${row.runs} | ${row.ready} | ${row.median_open ?? 'n/a'} `
    + `| ${row.with_mismatch} | ${row.median_turns ?? 'n/a'} |`);
}
lines.push('');

lines.push('## The three answers already on the file, and the counts without them');
lines.push('');
lines.push('`scoreRun` in `evidence/impact/scoring.mjs` starts every draft with');
lines.push('`createClaim(fixtures/demo-collision.json)`. That file is the demo the page opens on and it');
lines.push('carries `incident_date`, `incident_type` and `driver` already answered and badged `policy`.');
lines.push('None of the six briefs in `scenarios.json` states a date or says who was driving, so no run');
lines.push('in either arm could have produced `incident_date`, and every run in both arms is credited');
lines.push('with it anyway. The Policy complete column is a property of the model values plus those');
lines.push('three answers. Reading it as work the agent did would be wrong.');
lines.push('');
lines.push('Sensitivity, from the same run files scored a second time with the fixture replaced by the');
lines.push('policy alone and nothing pre-filled:');
lines.push('');
for (const row of summaries) {
  lines.push(`- **${row.arm}**: ${row.ready} policy complete out of ${row.runs} with the three answers `
    + `on file, and ${row.ready_unseeded} out of the same ${row.runs} without them.`);
}
lines.push('');
lines.push('The requirement that closes on the seed is `date_of_loss` in the Northwind pack, which reads');
lines.push('`incident_date`. The published counts are not re-scored and not withdrawn. They are printed');
lines.push('next to the number that says what they rest on.');
lines.push('');

if (complete) {
  const [a, b] = summaries;
  lines.push('## The one sentence this supports');
  lines.push('');
  lines.push(`> Across ${scenarios.scenarios.length} synthetic scenarios, ${EXPECTED_REPEATS} runs `
    + 'each, the values a model produced were combined with three answers already on the file, and '
    + `that combination was policy complete in ${a.ready} of ${a.runs} runs with the page's published `
    + `rules and ${b.ready} of ${b.runs} against a static form. Neither number is what an agent `
    + 'completed alone. Participants were language models, not people.');
  lines.push('');
}

lines.push('## The clock position, which protocol v2 preregisters as its primary endpoint');
lines.push('');
lines.push('Measured here on the v1 runs so the number exists before any v2 run does. The theft');
lines.push('scenario names no clock position in its truth sheet, so its runs stay out of the');
lines.push('denominator rather than counting as passes.');
lines.push('');
lines.push('| Arm | Runs whose truth sheet names a zone | Correct | Left empty | Contradicted the sheet |');
lines.push('|---|---|---|---|---|');
for (const row of zones) {
  lines.push(`| ${row.arm} | ${row.asked} | ${row.correct} | ${row.absent} | ${row.wrong} |`);
}
lines.push('');

lines.push('## Every run, including the ones that went badly');
lines.push('');
lines.push('| Scenario | Arm | Repeat | Ready | Open | Open ids | Truth mismatches | Turns | Model |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const row of scored) {
  lines.push(`| ${row.scenario_id} | ${row.arm} | ${row.repeat} | ${row.ready ? 'yes' : 'no'} `
    + `| ${row.open_requirements ?? 'n/a'} | ${(row.open_ids || []).join(' ') || 'none'} `
    + `| ${(row.truth_mismatches || []).join(' ') || 'none'} | ${row.turns ?? 'n/a'} | ${row.model} |`);
}
lines.push('');

if (problems.length) {
  lines.push('## Problems in the run files');
  lines.push('');
  for (const problem of problems) lines.push(`- ${problem}`);
  lines.push('');
}

// The one part a person wrote. It is inlined rather than left sitting at the bottom of the
// artifact, because a file that is half generated and half hand written cannot be checked against
// its own evidence, and this program used to delete it on every run.
if (existsSync(interpretationFile)) {
  lines.push(readFileSync(interpretationFile, 'utf8').replace(/\s+$/, ''));
  lines.push('');
}

const report = `${lines.join('\n')}\n`;

if (checkOnly) {
  if (!existsSync(outFile)) {
    console.error(`analyze_impact --check: ${path.relative(ROOT, outFile)} does not exist, so there is `
      + 'nothing to compare the runs against. Nothing was written.');
    process.exit(1);
  }
  const onDisk = readFileSync(outFile, 'utf8');
  if (onDisk !== report) {
    // SAID SEPARATELY BECAUSE IT IS A DIFFERENT PROBLEM WITH A DIFFERENT FIX. Node writes "\n" and
    // git on Windows rewrites text files to CRLF on checkout, so a fresh clone can differ on every
    // line while carrying identical evidence. `.gitattributes` pins this file to LF to stop it
    // happening. It still fails: the artifact on disk is still not the one these runs produce.
    if (onDisk.split('\r\n').join('\n') === report) {
      console.error(`analyze_impact --check: ${path.relative(ROOT, outFile)} differs from these runs `
        + 'only in its line endings. Something rewrote it to CRLF, which .gitattributes exists to '
        + 'prevent. Nothing was written. Regenerate it without --check.');
      process.exit(1);
    }
    const a = onDisk.split('\n');
    const b = report.split('\n');
    const at = a.findIndex((line, index) => line !== b[index]);
    const where = at === -1 ? Math.min(a.length, b.length) : at;
    console.error(`analyze_impact --check: ${path.relative(ROOT, outFile)} is not what these runs `
      + `produce. First difference at line ${where + 1}.`);
    console.error(`  on disk:   ${JSON.stringify(a[where] ?? null)}`);
    console.error(`  from runs: ${JSON.stringify(b[where] ?? null)}`);
    console.error('Nothing was written. Run the analyzer without --check to regenerate it.');
    process.exit(1);
  }
  if (!complete) {
    console.error(`analyze_impact --check: the artifact matches the runs, but ${usable.length} of `
      + `${EXPECTED_RUNS} runs and ${problems.length} problem(s) means it carries no headline.`);
    process.exit(1);
  }
  console.log(`analyze_impact --check: ${path.relative(ROOT, outFile)} matches the `
    + `${usable.length} run(s) in ${path.relative(ROOT, runsDir)} byte for byte. Nothing written.`);
  process.exit(0);
}

writeFileSync(outFile, report, 'utf8');
console.log(report);

if (!complete) {
  console.error(`analyze_impact: incomplete. ${usable.length} of ${EXPECTED_RUNS} runs, `
    + `${problems.length} problem(s). No headline was written.`);
  process.exit(1);
}
console.log(`analyze_impact: ${usable.length} runs scored, ${scored.length - usable.length} technical failure(s).`);
