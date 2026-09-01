/**
 * Read every recorded run, score them all the same way, and print what happened.
 *
 *   node scripts/analyze_impact.mjs [--runs evidence/impact/runs] [--out evidence/impact/results.md]
 *
 * IT REFUSES TO WRITE A HEADLINE IT CANNOT SUPPORT. The protocol fixes six scenarios, two arms and
 * three repeats: 36 runs. Anything less and this prints the counts it has, says the sentence
 * `AWAITING_RUNS`, and exits 1. That is the whole reason it exists as a separate program: the
 * temptation at the end of a hackathon is to write the sentence first and collect the runs that
 * agree with it.
 *
 * It also never says "significant", never extrapolates past the runs in the folder, and never
 * describes the participants as anything but what they were, which is language models.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreRun } from '../evidence/impact/scoring.mjs';
import { loadPolicyPack } from '../src/core/policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const argOf = (name, fallback) => (process.argv.includes(name)
  ? process.argv[process.argv.indexOf(name) + 1]
  : fallback);

const runsDir = path.join(ROOT, argOf('--runs', 'evidence/impact/runs'));
const outFile = path.join(ROOT, argOf('--out', 'evidence/impact/results.md'));

const scenarios = JSON.parse(readFileSync(path.join(ROOT, 'evidence/impact/scenarios.json'), 'utf8'));
const pack = loadPolicyPack(JSON.parse(readFileSync(path.join(ROOT, 'fixtures/insurers/northwind.json'), 'utf8')));
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/demo-collision.json'), 'utf8'));

const EXPECTED_REPEATS = 3;
const ARMS = ['published-rules', 'static-form'];
const EXPECTED_RUNS = scenarios.scenarios.length * ARMS.length * EXPECTED_REPEATS;

/* --------------------------------------------------------------------------- read and validate */

const REQUIRED_KEYS = ['scenario_id', 'arm', 'repeat', 'model', 'fields'];

function loadRuns(directory) {
  if (!existsSync(directory)) return { runs: [], problems: [`there is no ${path.relative(ROOT, directory)} directory yet`] };
  const problems = [];
  const runs = [];
  const seen = new Set();

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
    const missing = REQUIRED_KEYS.filter((key) => parsed[key] === undefined);
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
    attempted_human_only: rows.filter((row) => row.attempted_human_only).length,
    refused_values: rows.filter((row) => !row.accepted).length,
  };
}

const summaries = ARMS.map(summarise);
const complete = usable.length === EXPECTED_RUNS && problems.length === 0;

/* ------------------------------------------------------------------------------------- writing */

const lines = [];
lines.push('# Impact runs, scored');
lines.push('');
lines.push('Generated by `node scripts/analyze_impact.mjs`. Do not edit by hand: it is overwritten.');
lines.push('');
lines.push('**The participants were language models, not people.** This measures whether an agent');
lines.push('produces a first notice that is complete under this insurer\'s own rules, with and');
lines.push('without the page publishing those rules as typed tools. It measures nothing about time,');
lines.push('effort, satisfaction or real claims. The protocol is `evidence/impact/protocol-v1.md`,');
lines.push('written before any run.');
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

if (complete) {
  const [a, b] = summaries;
  lines.push('## The one sentence this supports');
  lines.push('');
  lines.push(`> Across ${scenarios.scenarios.length} synthetic scenarios, ${EXPECTED_REPEATS} runs `
    + `each, an agent produced a policy complete first notice in ${a.ready} of ${a.runs} runs with `
    + `the page's published rules and ${b.ready} of ${b.runs} against a static form. Participants `
    + 'were language models, not people.');
  lines.push('');
}

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

const report = `${lines.join('\n')}\n`;
writeFileSync(outFile, report, 'utf8');
console.log(report);

if (!complete) {
  console.error(`analyze_impact: incomplete. ${usable.length} of ${EXPECTED_RUNS} runs, `
    + `${problems.length} problem(s). results.md says AWAITING_RUNS.`);
  process.exit(1);
}
console.log(`analyze_impact: ${usable.length} runs scored, ${scored.length - usable.length} technical failure(s).`);
