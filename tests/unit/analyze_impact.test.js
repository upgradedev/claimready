// tests/unit/analyze_impact.test.js
//
// The analyzer is the one program in this repository whose output a stranger is asked to believe.
// Everything else can be re-derived by reading the source. `evidence/impact/results.md` cannot: it
// is a claim about 36 files that nobody outside will open. So the three properties that make it
// worth believing are asserted here rather than assumed.
//
//   1. Running it twice over the same runs gives byte identical output.
//   2. It never writes to, renames or deletes anything under the runs directory.
//   3. Its refusal really refuses. Too few runs, a duplicate or a malformed file and it declines to
//      write a headline instead of averaging the problem away.
//
// EVERY SPAWN IN THIS FILE PASSES `--out`. Without it the analyzer overwrites the real
// `evidence/impact/results.md`, and that file currently carries hand written commentary the
// analyzer does not regenerate. A test suite that quietly deleted a paragraph of the owner's own
// prose would be a worse bug than anything it caught.
//
// The refusal cases are driven against a throwaway directory under the system temp directory,
// built by copying the recorded runs out. Nothing here opens the real runs directory for writing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClaim } from '../../src/core/claim.js';
import { scoreRun } from '../../evidence/impact/scoring.mjs';
import { loadPolicyPack } from '../../src/core/policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const ANALYZER = path.join(ROOT, 'scripts', 'analyze_impact.mjs');
const REAL_RUNS = path.join(ROOT, 'evidence', 'impact', 'runs');

/**
 * Every entry in a directory, by name and content hash, sorted.
 *
 * Hashing only the `.json` files would miss the thing most worth catching. A program that renamed
 * a run, or dropped a stray file in beside them, or deleted the README that says what the folder
 * is, would leave every remaining hash intact. So the listing itself is part of the digest.
 */
function digestDirectory(directory) {
  return readdirSync(directory).sort().map((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return `${name}:<directory>`;
    return `${name}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`;
  }).join('\n');
}

/** Run the analyzer the way a person would, and hand back everything it said. */
function runAnalyzer({ runs, out }) {
  const result = spawnSync(process.execPath, [ANALYZER, '--runs', runs, '--out', out], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A temp directory that cleans itself up whatever the test does. */
function withTempDir(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claimready-impact-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// TAKEN AT MODULE LOAD, BEFORE ANY TEST IN THIS FILE HAS RUN THE ANALYZER, AND THAT ORDERING IS
// THE WHOLE POINT. The first version of the two read only tests below took their own `before`
// digest inside the test body. By then an earlier test had already run the analyzer once, so a
// stray file the analyzer creates every time was present in both the before and the after picture
// and the digests matched. A deliberate break that wrote `.scored` into the runs folder on every
// invocation passed all twelve tests. Measured once, watched failing, and this is the repair: the
// baseline is the folder as it was before this file did anything at all.
const RUNS_AT_LOAD = digestDirectory(REAL_RUNS);
const NAMES_AT_LOAD = readdirSync(REAL_RUNS).sort();

/**
 * A throwaway copy of the recorded runs, which the analyzer may be pointed at safely.
 *
 * It copies the names recorded at load and nothing else, for the same reason. A blind recursive
 * copy would carry any stray file forward into the sandbox, and the sandbox would then be blind to
 * exactly the thing it is watching for.
 */
function copyRecordedRuns(into) {
  mkdirSync(into, { recursive: true });
  for (const name of NAMES_AT_LOAD) {
    cpSync(path.join(REAL_RUNS, name), path.join(into, name), { recursive: true });
  }
  return into;
}

/* -------------------------------------------------------------------------- it is reproducible */

test('running the analyzer twice over the same runs produces byte identical output', () => {
  withTempDir((dir) => {
    const first = path.join(dir, 'first.md');
    const second = path.join(dir, 'second.md');

    const one = runAnalyzer({ runs: REAL_RUNS, out: first });
    const two = runAnalyzer({ runs: REAL_RUNS, out: second });

    assert.equal(one.status, 0, `the first pass refused: ${one.stderr}`);
    assert.equal(two.status, 0, `the second pass refused: ${two.stderr}`);

    // Bytes, not lines. A line comparison would forgive a trailing newline moving, and the whole
    // point of the property is that the artifact on disk is the same artifact.
    assert.deepEqual(
      readFileSync(first),
      readFileSync(second),
      'the analyzer wrote two different files from one set of runs, so results.md is not evidence '
      + 'of anything reproducible',
    );
  });
});

test('the analyzer resolves an absolute runs directory rather than gluing it to the repository', () => {
  withTempDir((dir) => {
    const runs = copyRecordedRuns(path.join(dir, 'runs'));
    const out = path.join(dir, 'results.md');
    const result = runAnalyzer({ runs, out });

    // The failure this pins is quiet and it is the worst kind. Joined rather than resolved, an
    // absolute path became a directory that cannot exist, the analyzer found no runs there, and it
    // wrote AWAITING_RUNS. That output is indistinguishable from an honest refusal, so a test
    // written against a temp directory would have passed while measuring nothing at all.
    assert.equal(result.status, 0, `the analyzer refused a complete set of runs: ${result.stderr}`);
    const text = readFileSync(out, 'utf8');
    assert.ok(!text.includes('AWAITING_RUNS'), 'a full copy of the recorded runs was read as empty');
  });
});

/* ------------------------------------------------------------------------------ it is read only */

test('the analyzer writes nothing under the runs directory', () => {
  withTempDir((dir) => {
    const out = path.join(dir, 'results.md');

    const result = runAnalyzer({ runs: REAL_RUNS, out });
    assert.equal(result.status, 0, `the analyzer refused: ${result.stderr}`);

    assert.equal(
      digestDirectory(REAL_RUNS),
      RUNS_AT_LOAD,
      'the recorded runs changed while the analyzer read them. They are the evidence a published '
      + 'claim rests on and nothing may edit them',
    );
  });
});

test('the analyzer writes nothing under the runs directory even when it is refusing', () => {
  withTempDir((dir) => {
    const runs = copyRecordedRuns(path.join(dir, 'runs'));
    rmSync(path.join(runs, 'S1-carpark-dent__published-rules__1.json'));
    const before = digestDirectory(runs);

    const result = runAnalyzer({ runs, out: path.join(dir, 'results.md') });
    assert.equal(result.status, 1, 'a short set was not refused');

    // The refusal path is the one that has never been watched. It is also the path where a program
    // would be most tempted to tidy up after itself.
    assert.equal(digestDirectory(runs), before, 'the analyzer edited the runs while refusing them');
  });
});

/* ----------------------------------------------------------------------- its refusal refuses */

test('fewer than the preregistered 36 runs is refused, exits 1 and says AWAITING_RUNS', () => {
  withTempDir((dir) => {
    const runs = copyRecordedRuns(path.join(dir, 'runs'));
    rmSync(path.join(runs, 'S6-structural-drivable__static-form__3.json'));
    const out = path.join(dir, 'results.md');

    const result = runAnalyzer({ runs, out });

    assert.equal(result.status, 1, 'the analyzer wrote a headline from 35 runs and exited 0');
    const text = readFileSync(out, 'utf8');
    assert.ok(text.includes('## AWAITING_RUNS'), 'the results file drew a conclusion from a partial set');
    assert.ok(
      !text.includes('## The one sentence this supports'),
      'the headline section survived a run going missing, so the headline counts nothing',
    );
    assert.ok(text.includes('35 usable run(s)'), `the refusal did not say how many it had: ${text}`);
  });
});

test('an empty runs directory is refused rather than read as a perfect score', () => {
  withTempDir((dir) => {
    const runs = path.join(dir, 'runs');
    mkdirSync(runs);
    const out = path.join(dir, 'results.md');

    const result = runAnalyzer({ runs, out });

    assert.equal(result.status, 1, 'no runs at all was not refused');
    assert.ok(readFileSync(out, 'utf8').includes('## AWAITING_RUNS'));
  });
});

test('a duplicate run is named as a problem and is not averaged into the counts', () => {
  withTempDir((dir) => {
    const runs = copyRecordedRuns(path.join(dir, 'runs'));

    // 37 files: the full preregistered 36, plus one more that repeats a scenario, arm and repeat
    // that is already there. The count on its own therefore says nothing is wrong, which is the
    // whole reason this case needs its own test. Only the duplicate check can catch it.
    const twin = JSON.parse(readFileSync(path.join(runs, 'S1-carpark-dent__published-rules__1.json'), 'utf8'));
    writeFileSync(path.join(runs, 'zzz-a-second-copy.json'), JSON.stringify(twin), 'utf8');

    const out = path.join(dir, 'results.md');
    const result = runAnalyzer({ runs, out });

    assert.equal(result.status, 1, 'a duplicated run was accepted and the analyzer exited 0');
    const text = readFileSync(out, 'utf8');
    assert.ok(text.includes('## Problems in the run files'), 'the duplicate was not reported anywhere');
    assert.ok(
      text.includes('zzz-a-second-copy.json'),
      `the problem list did not name the duplicate file: ${text}`,
    );
    assert.ok(
      text.includes('Duplicates are not averaged away here'),
      'the duplicate was counted rather than refused',
    );
    assert.ok(text.includes('## AWAITING_RUNS'), 'a headline was written over a set with a duplicate in it');

    // And the arm it duplicated still shows 18. A second copy that slipped into the counts would
    // read 19 here, and the median would have been computed over it.
    const countsBlock = text.split('## Counts')[1] || '';
    assert.ok(
      countsBlock.includes('| published-rules | 18 |'),
      `the duplicate reached the counts table: ${countsBlock}`,
    );
  });
});

test('a run file that is not readable JSON is reported, not skipped in silence', () => {
  withTempDir((dir) => {
    const runs = copyRecordedRuns(path.join(dir, 'runs'));
    writeFileSync(path.join(runs, 'zzz-truncated.json'), '{"scenario_id": "S1-carpark', 'utf8');

    const out = path.join(dir, 'results.md');
    const result = runAnalyzer({ runs, out });

    assert.equal(result.status, 1, 'a broken run file did not stop the headline');
    const text = readFileSync(out, 'utf8');
    assert.ok(text.includes('zzz-truncated.json: not readable JSON'), `the broken file was not named: ${text}`);
    assert.ok(text.includes('## AWAITING_RUNS'));
  });
});

test('a run missing the keys a score needs is reported by name and by key', () => {
  withTempDir((dir) => {
    const runs = copyRecordedRuns(path.join(dir, 'runs'));
    const stripped = JSON.parse(readFileSync(path.join(runs, 'S2-rear-scratch__static-form__1.json'), 'utf8'));
    delete stripped.model;
    delete stripped.fields;
    writeFileSync(path.join(runs, 'S2-rear-scratch__static-form__1.json'), JSON.stringify(stripped), 'utf8');

    const out = path.join(dir, 'results.md');
    const result = runAnalyzer({ runs, out });

    assert.equal(result.status, 1, 'a run with no answers in it was scored anyway');
    const text = readFileSync(out, 'utf8');
    assert.ok(
      text.includes('S2-rear-scratch__static-form__1.json: missing model, fields'),
      `the missing keys were not named: ${text}`,
    );
  });
});

test('a run naming an arm or a scenario that does not exist is refused', () => {
  withTempDir((dir) => {
    const runs = copyRecordedRuns(path.join(dir, 'runs'));
    const stray = JSON.parse(readFileSync(path.join(runs, 'S3-undrivable-front__published-rules__1.json'), 'utf8'));
    writeFileSync(
      path.join(runs, 'zzz-wrong-arm.json'),
      JSON.stringify({ ...stray, arm: 'published-rules-v2', repeat: 9 }),
      'utf8',
    );
    writeFileSync(
      path.join(runs, 'zzz-wrong-scenario.json'),
      JSON.stringify({ ...stray, scenario_id: 'S9-invented', repeat: 9 }),
      'utf8',
    );

    const out = path.join(dir, 'results.md');
    const result = runAnalyzer({ runs, out });

    assert.equal(result.status, 1);
    const text = readFileSync(out, 'utf8');
    assert.ok(text.includes('zzz-wrong-arm.json: arm "published-rules-v2"'), `arm not reported: ${text}`);
    assert.ok(text.includes('zzz-wrong-scenario.json: scenario S9-invented'), `scenario not reported: ${text}`);
  });
});

/* ------------------------------------------------- the seeded fields, pinned as a known limitation */

// WHAT FOLLOWS PINS A LIMITATION. It does not approve of it.
//
// `scoreRun` builds its draft with `createClaim(fixture)`, where the fixture is the demo file the
// page opens on. That fixture carries three answers already filled in, and they are therefore
// credited to every run in both arms before a single answer the run produced is applied. None of
// the six scenario briefs in `scenarios.json` states an incident date or who was driving.
//
// The measured consequence, from `node scripts/analyze_impact.mjs`, is that `incident_date` is the
// field the published headline rests on: no run in either arm produced it, and with it removed
// from the seed both arms score zero complete first notices instead of 5 and 6.
//
// This is recorded, not corrected. Correcting it would change a published number, and the runs and
// the result stand as they are until their owner decides otherwise. What these two tests buy is
// that the seeding cannot change again without somebody noticing, and that the next reader of
// `results.md` can find out from a test what the numbers include.
const FIXTURE = JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'demo-collision.json'), 'utf8'));
const SCENARIOS = JSON.parse(readFileSync(path.join(ROOT, 'evidence', 'impact', 'scenarios.json'), 'utf8'));
const PACK = loadPolicyPack(
  JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'insurers', 'northwind.json'), 'utf8')),
);

test('the demo fixture the scorer seeds from carries exactly three pre-filled answers', () => {
  const seeded = createClaim(FIXTURE);
  assert.deepEqual(
    Object.keys(seeded.provenance).sort(),
    ['driver', 'incident_date', 'incident_type'],
    'the set of answers the scorer starts every run with has changed. Whatever the change was, the '
    + 'counts in evidence/impact/results.md were produced under the old set and no longer describe '
    + 'what this code does',
  );
  assert.equal(seeded.incident_date, '2026-08-20');
  assert.equal(seeded.incident_type, 'collision');
  assert.equal(seeded.driver, 'Maria K.');
  for (const field of Object.keys(seeded.provenance)) {
    assert.equal(seeded.provenance[field], 'policy', `${field} is seeded but is not badged as such`);
  }
});

test('a run that answered none of the three seeded fields is still scored as having them', () => {
  const scenario = SCENARIOS.scenarios.find((entry) => entry.id === 'S1-carpark-dent');
  const run = {
    scenario_id: scenario.id,
    arm: 'static-form',
    repeat: 1,
    model: 'fixture, not a model',
    // Everything the truth sheet asks for, and deliberately no incident_date, no incident_type and
    // no driver. A form filler who answered this much and stopped left question 1 of
    // evidence/impact/static-form.md blank, and that question is marked required.
    fields: {
      damage_zone: 10,
      severity: 'dent',
      vehicle_drivable: true,
      location: 'Car park, Harbour Road',
      description: 'A delivery van reversed into the left front wing while the car was parked.',
    },
  };

  const withFixture = scoreRun(run, { pack: PACK, scenario, fixture: FIXTURE });
  const withoutFixture = scoreRun(run, { pack: PACK, scenario, fixture: { policy: { id: 'MTR-2026-0417' } } });

  assert.equal(withFixture.ready, true, 'the seeding this test exists to describe is no longer happening');
  assert.equal(
    withoutFixture.ready,
    false,
    'the same answers scored complete without the fixture, so the seeding is not what makes the '
    + 'difference and this limitation should be re-measured',
  );
  // The requirement is called `date_of_loss` in the Northwind pack. The field it reads is
  // `incident_date`, and that is the one the fixture fills in.
  assert.ok(
    withoutFixture.open_ids.includes('date_of_loss'),
    `date_of_loss is the requirement the seed closes, and it was not open without it: ${withoutFixture.open_ids}`,
  );
});

/* ------------------------------------------------------------------------------- the last word */

// Declared last so it runs last. Every test above pointed the analyzer at something, and this one
// asks the only question that matters afterwards: are the 36 recorded runs and the README beside
// them exactly as this file found them. It is cheap and it covers the cases the individual read
// only tests do not name.
test('the recorded runs are byte for byte as this file found them', () => {
  assert.equal(
    digestDirectory(REAL_RUNS),
    RUNS_AT_LOAD,
    'something in this test file changed the frozen evidence. Restore it from git before trusting '
    + 'any number in evidence/impact/results.md',
  );
});
