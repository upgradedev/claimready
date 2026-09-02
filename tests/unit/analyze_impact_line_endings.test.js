// tests/unit/analyze_impact_line_endings.test.js
//
// The analyzer builds every line of its report itself, except one. The interpretation is copied off
// the disk and inlined verbatim, so the report carries whatever line endings that file arrived
// with, while the rest of the report carries the ones this program writes.
//
// That mattered on 2026-09-02. `.gitattributes` pinned results-v2.md to LF and said nothing about
// interpretation-v2.md, so a Windows clone with core.autocrlf true got a CRLF interpretation and an
// LF artifact, and `--check` refused at line 71 over `"## What this supports"` against the same
// heading with a carriage return on the end. `node --test tests/unit` was 770 of 771 on that
// checkout and green on Linux CI, which is the worst shape a defect can have: it only appears for
// the reader following the quickstart.
//
// WHY THIS FILE DOES NOT READ THE REPOSITORY'S OWN FILES. A regression that asserted something
// about the committed interpretation-v2.md would pass or fail depending on how the reader's git is
// configured, which is the variable under test. So every case here writes both spellings of the
// same interpretation into a temporary directory and requires the analyzer to produce the same
// bytes from each. That holds on a checkout where nothing was converted and on one where
// everything was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const ANALYZER = path.join(ROOT, 'scripts', 'analyze_impact.mjs');

/** The interpretation text both spellings are built from. Short, and it carries a heading. */
const INTERPRETATION = [
  '## What this supports',
  '',
  'Nothing. This copy exists so a test can write it twice with different line endings.',
  '',
  'A second paragraph, because a one line file cannot show a mid-file difference.',
  '',
].join('\n');

function withTempDir(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claimready-eol-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run the analyzer over an empty runs folder with the interpretation written in one spelling.
 *
 * The runs folder is empty on purpose. An empty folder still produces the whole report: the
 * preamble, the AWAITING_RUNS block, the zero table and the inlined interpretation. That is enough
 * to compare bytes, and it needs no run files and no network.
 *
 * @param {string} dir a temporary directory
 * @param {string} eol either '\n' or '\r\n'
 * @returns {{status: number, bytes: Buffer, out: string}}
 */
function generate(dir, eol, label) {
  // The report prints the paths it read, so both spellings use identical basenames inside their
  // own directory. Only that one directory name differs, and the comparison below replaces it with
  // a fixed word. Different basenames would show up as a difference that has nothing to do with
  // the test. The names are deliberately odd, so replacing them cannot hit ordinary prose.
  const home = path.join(dir, label);
  const runs = path.join(home, 'runs');
  mkdirSync(runs, { recursive: true });
  const interpretation = path.join(home, 'interpretation.md');
  writeFileSync(interpretation, INTERPRETATION.split('\n').join(eol));
  const out = path.join(home, 'results.md');

  const result = spawnSync(process.execPath, [
    ANALYZER,
    '--runs', runs,
    '--out', out,
    '--contract', 'claimready.impact.run.v2',
    '--interpretation', interpretation,
  ], { cwd: ROOT, encoding: 'utf8' });

  return {
    status: result.status, bytes: readFileSync(out), out, runs, interpretation, label, stderr: result.stderr,
  };
}

// The report names its inputs RELATIVE TO THE REPOSITORY ROOT, so an absolute temporary path never
// appears in it and cannot be what is replaced here. The only part of the printed path that
// differs between the two spellings is the one directory name, so that is what is flattened.
const flatten = (bytes, label) => bytes.toString('utf8').split(`/${label}/`).join('/<here>/');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('the interpretation arriving with carriage returns produces the same report bytes', () => {
  withTempDir((dir) => {
    const lf = generate(dir, '\n', 'spelling-one');
    const crlf = generate(dir, '\r\n', 'spelling-two');

    // Both refuse with 1, because an empty folder carries no headline. That is not what is under
    // test here, it is only the reason the exit code is not zero.
    assert.equal(lf.status, 1, `the LF run did not reach the refusal: ${lf.stderr}`);
    assert.equal(crlf.status, 1, `the CRLF run did not reach the refusal: ${crlf.stderr}`);

    assert.equal(
      sha(Buffer.from(flatten(lf.bytes, lf.label))),
      sha(Buffer.from(flatten(crlf.bytes, crlf.label))),
      'the analyzer produced different bytes from the same interpretation written two ways',
    );
  });
});

test('the report the analyzer writes carries no carriage return at all', () => {
  withTempDir((dir) => {
    const crlf = generate(dir, '\r\n', 'spelling-two');
    const carriageReturns = crlf.bytes.filter((byte) => byte === 0x0d).length;
    assert.equal(
      carriageReturns,
      0,
      `${carriageReturns} carriage return(s) reached the generated report from the interpretation`,
    );
  });
});

test('--check still refuses an artifact whose own line endings were rewritten', () => {
  // THE HALF THAT MUST NOT BE WEAKENED. Flattening the interpretation on read fixes the input.
  // It says nothing about the artifact on disk, and an artifact somebody rewrote to CRLF is still
  // not the file these runs produce. This case exists so that a later "just normalise both sides"
  // cannot land without turning a test red.
  withTempDir((dir) => {
    const lf = generate(dir, '\n', 'spelling-one');
    const rewritten = readFileSync(lf.out, 'utf8').split('\n').join('\r\n');
    writeFileSync(lf.out, rewritten);

    const result = spawnSync(process.execPath, [
      ANALYZER,
      '--runs', lf.runs,
      '--out', lf.out,
      '--contract', 'claimready.impact.run.v2',
      '--interpretation', lf.interpretation,
      '--check',
    ], { cwd: ROOT, encoding: 'utf8' });

    assert.equal(result.status, 1, 'a CRLF artifact was accepted by --check');
    assert.match(
      result.stderr,
      /differs from these runs only in its line endings/,
      `the line ending refusal did not fire: ${result.stderr}`,
    );
  });
});
