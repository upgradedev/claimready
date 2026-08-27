/**
 * The style gate must see files that are not committed yet.
 *
 * This exists because it did not, twice, in different ways, and both times the gate reported PASS
 * over work it had never opened:
 *
 *   1. Rule 4 chose files by searching their text for the literal `registerTool`. The page stopped
 *      holding its own tool list during a refactor, so it left the rule's scope and nothing said so.
 *   2. `collectFiles` listed only tracked files, so a video pipeline and an evals suite written in
 *      one sitting were scanned by nothing. The summary line still read "40 text files scanned",
 *      the same 40 as before they existed, which is exactly what makes this class of defect
 *      survive a careful reader.
 *
 * Coverage that shrinks quietly is worse than a gate that fails, because a failure gets fixed. So
 * the assertion is structural: whatever git reports as present and not ignored, the gate must be
 * looking at.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFiles } from '../../scripts/check_style.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const TEXT_EXTENSIONS = new Set([
  '.md', '.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json',
  '.yml', '.yaml', '.txt', '.svg', '.webmanifest', '.py',
]);

function gitList(args) {
  const out = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', ...args], { encoding: 'utf8' });
  if (out.status !== 0 || typeof out.stdout !== 'string') return null;
  return out.stdout.split('\0').filter(Boolean);
}

function normalise(paths) {
  return new Set(paths.map((p) => relative(ROOT, p).split('\\').join('/')));
}

function isScannable(rel) {
  return TEXT_EXTENSIONS.has(extname(rel).toLowerCase());
}

test('the gate scans untracked files that are not ignored', () => {
  const untracked = gitList(['--others', '--exclude-standard']);
  if (untracked === null) {
    // No git here. The gate falls back to a filesystem walk, which cannot miss a file by
    // definition, so there is nothing this assertion can add.
    return;
  }

  const scanned = normalise(collectFiles(ROOT));
  const missed = untracked.filter(isScannable).filter((rel) => !scanned.has(rel));

  assert.deepEqual(
    missed,
    [],
    'these files exist, are not ignored, and no style rule has ever opened them: ' + missed.join(', '),
  );
});

test('the gate scans every tracked text file', () => {
  const tracked = gitList([]);
  if (tracked === null) return;

  const scanned = normalise(collectFiles(ROOT));
  const missed = tracked.filter(isScannable).filter((rel) => !scanned.has(rel));

  assert.deepEqual(missed, [], 'tracked text files outside the gate: ' + missed.join(', '));
});

test('the gate lists each file once, however git reports it', () => {
  const scanned = collectFiles(ROOT);
  assert.equal(
    scanned.length,
    new Set(scanned).size,
    'a duplicated path would double count every finding in it',
  );
});
