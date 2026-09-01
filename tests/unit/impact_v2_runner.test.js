// tests/unit/impact_v2_runner.test.js
//
// The v2 runner has never been run and, if the deadline lands first, never will be. That is exactly
// why its guards are tested here instead of being discovered the first time somebody types
// --spend-credits at eleven at night.
//
// NOTHING IN THIS FILE MAKES A REQUEST. The module is imported, not executed as a program, and its
// CLI block is behind a check on process.argv[1], so importing it cannot reach the network. The one
// case that spawns the program spawns it in its default mode, which is the dry run.
//
// The two properties worth stating out loud:
//
//   1. The frozen v1 evidence is unreachable from the v2 runner, by every spelling of its path.
//   2. A record missing the metadata v1 lost is not written. The errata exists because v1 wrote
//      records anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_METADATA,
  REQUEST_SETTINGS,
  V1_RUNS_DIR,
  V2_CONTRACT,
  buildRecord,
  guardOutDir,
  missingMetadata,
  selfTests,
  stubTransport,
} from '../../evidence/impact/run_impact_v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const RUNNER = path.join(ROOT, 'evidence', 'impact', 'run_impact_v2.mjs');
const ANALYZER = path.join(ROOT, 'scripts', 'analyze_impact.mjs');

/** Name and content hash of every entry in a directory, so a silent edit anywhere shows up. */
function digestDirectory(directory) {
  return readdirSync(directory).sort().map((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return `${name}:<directory>`;
    return `${name}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`;
  }).join('\n');
}

function withTempDir(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claimready-v2-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- the runner's own dry run set */

test('every dry run check the v2 runner makes about itself passes', () => {
  const checks = selfTests();
  assert.ok(checks.length >= 10, `the self test set shrank to ${checks.length} checks`);
  const failed = checks.filter((check) => !check.ok);
  assert.deepEqual(failed.map((check) => check.name), [], 'a v2 guard stopped guarding');
});

/* ----------------------------------------------------------- the frozen v1 folder is out of reach */

test('the v2 runner refuses to write into the frozen v1 evidence, by every spelling', () => {
  for (const spelling of [
    'evidence/impact/runs',
    'evidence/impact/runs/',
    'evidence/impact/runs-v2/../runs',
    './evidence/impact/runs',
    V1_RUNS_DIR,
    path.join(V1_RUNS_DIR, 'nested'),
  ]) {
    const verdict = guardOutDir(spelling);
    assert.equal(verdict.ok, false, `${spelling} was allowed as an --out, and it lands on frozen evidence`);
    assert.match(verdict.error, /frozen v1 evidence/, `the refusal did not say why: ${verdict.error}`);
  }
});

test('the sibling v2 folder is allowed, so the guard is not simply refusing everything', () => {
  // A guard that says no to every path is not a guard, it is a broken program that looks safe.
  assert.equal(guardOutDir('evidence/impact/runs-v2').ok, true);
  assert.equal(guardOutDir('evidence/impact/runs-v3').ok, true);
});

test('an --out that is not given at all is refused rather than defaulted', () => {
  const verdict = guardOutDir(undefined);
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /--out is required/);
});

/* ------------------------------------------------------------------------- the metadata gate */

test('a record missing any of the six metadata fields names exactly the ones it is missing', () => {
  const complete = {
    model_snapshot: 'a-dated-snapshot',
    request_settings: REQUEST_SETTINGS,
    response_ids: [{ id: 'resp_1', system_fingerprint: 'fp_1', model: 'a-dated-snapshot' }],
    page_url: 'https://example.invalid/',
    browser_version: 'a browser build string',
    verified_runtime_sha: '0123456789abcdef',
  };
  assert.deepEqual(missingMetadata(complete), [], 'a complete record was reported as incomplete');

  for (const field of Object.keys(REQUIRED_METADATA)) {
    const holed = { ...complete };
    delete holed[field];
    assert.deepEqual(missingMetadata(holed), [field], `dropping ${field} was not noticed`);
  }
});

test('present but empty counts as missing, which is the shape the unmeasured field had', () => {
  // `attempted_human_only` was present on every v1 record and held nothing anybody measured. A key
  // check alone would have passed it. So the gate looks at the value.
  const empty = {
    model_snapshot: '',
    request_settings: {},
    response_ids: [],
    page_url: '   ',
    browser_version: null,
    verified_runtime_sha: undefined,
  };
  assert.deepEqual(missingMetadata(empty).sort(), Object.keys(REQUIRED_METADATA).sort());
});

test('a built record carries the v2 contract and no field nothing measures', () => {
  const record = buildRecord({ scenario_id: 'S1-carpark-dent', arm: 'static-form', repeat: 1, model: 'x' });
  assert.equal(record.contract, V2_CONTRACT);
  assert.equal(record.participants_were, 'a language model, not a person');
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'attempted_human_only'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'human_only_respected'), false);
});

test('the dry run transport cannot be mistaken for an answer worth scoring', () => {
  const stub = stubTransport();
  assert.match(String(stub.fields.description), /^DRY RUN/);
  assert.equal(stub.turns, 0);
});

/* ------------------------------------------------------- the program, in the mode that is free */

test('running the v2 program with no --spend-credits writes nothing and asks nobody anything', () => {
  withTempDir((dir) => {
    const result = spawnSync(process.execPath, [
      RUNNER, '--scenario', 'S1-carpark-dent', '--arm', 'static-form', '--repeat', '1',
      '--out', dir,
    ], { cwd: ROOT, encoding: 'utf8' });

    assert.equal(result.status, 0, `the dry run failed: ${result.stderr}`);
    assert.match(result.stdout, /DRY RUN\. No request was made and no file was written\./);
    assert.deepEqual(readdirSync(dir), [], 'the dry run wrote a file');
  });
});

test('the v2 program refuses the frozen folder before it looks for a key', () => {
  // The order matters. A guard that runs after the key check is a guard that only protects
  // machines without a key, and every machine this runs on has one.
  //
  // The target file already exists, because it is one of the 36 recorded runs. That is the point:
  // a v2 run pointed here would overwrite published evidence, so the folder is hashed before and
  // after rather than merely checked for a new name.
  const before = digestDirectory(V1_RUNS_DIR);
  const result = spawnSync(process.execPath, [
    RUNNER, '--scenario', 'S1-carpark-dent', '--arm', 'static-form', '--repeat', '1',
    '--out', 'evidence/impact/runs', '--spend-credits',
  ], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: 'not-a-real-key' } });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /refused before spending anything/);
  assert.equal(
    digestDirectory(V1_RUNS_DIR),
    before,
    'the frozen v1 evidence changed while the v2 runner was refusing to write to it',
  );
});

/* ------------------------------------------------------------------- the v1 runner stays closed */

test('the v1 runner refuses to run at all and leaves the frozen evidence alone', () => {
  // What it did before: on any machine with OPENAI_API_KEY set, this exact command sent a request
  // and then wrote over evidence/impact/runs/S1-carpark-dent__static-form__1.json, which is one of
  // the 36 files behind a published number. writeFileSync does not care that the file is there.
  const runner = path.join(ROOT, 'evidence', 'impact', 'run_impact.mjs');
  const before = digestDirectory(V1_RUNS_DIR);

  const result = spawnSync(process.execPath, [
    runner, '--scenario', 'S1-carpark-dent', '--arm', 'static-form', '--repeat', '1',
  ], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: 'not-a-real-key' } });

  assert.equal(result.status, 2, 'the v1 runner ran, and a v1 run overwrites published evidence');
  assert.match(result.stderr, /run_impact\.mjs is closed/);
  assert.match(result.stderr, /Nothing was sent and nothing was written/);
  assert.equal(digestDirectory(V1_RUNS_DIR), before, 'the frozen v1 runs changed');
});

/* ----------------------------------------------------- the analyzer keeps the generations apart */

test('the analyzer will not read the v1 runs under the v2 contract', () => {
  withTempDir((dir) => {
    const out = path.join(dir, 'results-v2.md');
    const result = spawnSync(process.execPath, [
      ANALYZER, '--runs', V1_RUNS_DIR, '--out', out, '--contract', 'claimready.impact.run.v2',
    ], { cwd: ROOT, encoding: 'utf8' });

    assert.equal(result.status, 1, 'v1 records were accepted into a v2 analysis');
    assert.match(
      result.stdout,
      /contract "claimready\.impact\.run\.v1" is not claimready\.impact\.run\.v2/,
      `the contract mismatch was not reported: ${result.stdout}`,
    );
  });
});

test('the committed results-v2.md says it is waiting for runs, because it is', () => {
  const spawned = spawnSync(process.execPath, [
    ANALYZER,
    '--runs', 'evidence/impact/runs-v2',
    '--out', 'evidence/impact/results-v2.md',
    '--contract', 'claimready.impact.run.v2',
    '--interpretation', 'evidence/impact/interpretation-v2.md',
    '--check',
  ], { cwd: ROOT, encoding: 'utf8' });

  // Exit 1 because there are no runs, which is the honest state. What this pins is that the
  // committed artifact is still the one an empty folder produces, so nobody has hand written a
  // headline into it.
  assert.equal(spawned.status, 1, `the v2 results file is no longer the empty-folder artifact: ${spawned.stdout}`);
  assert.match(
    spawned.stderr,
    /the artifact matches the runs, but 0 of 36 runs/,
    `results-v2.md drifted from what an empty runs-v2 produces: ${spawned.stderr}`,
  );
});
