// tests/unit/readiness_freeze_row.test.js
//
// The FRZ readiness row reads docs/submission/video.md and asks one question: has a person written
// down the commit the takes are shot against, before shooting them?
//
// WHY THIS FILE EXISTS. On 2026-09-02 the row was green while the declaration was wrong twice over.
// The live head was 39690d4, the runbook declared c93b138, and runtime code had changed in the
// working tree, so neither SHA described what a take would show. The row could not tell the
// difference, because it took the first line anywhere in the file that said "freeze commit" and
// carried a backticked hex string. A paragraph explaining which freeze had been SUPERSEDED was
// enough to satisfy it. That is the worst shape a gate can have: it goes green precisely when a
// person is being careful enough to write down what is no longer true.
//
// So the declaration is now the deliverable-record row, and the SHA has to be the first thing in
// its cell. History belongs in prose and prose no longer votes. The four cases below were all run
// against the older check first: the two marked REPRODUCED returned PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkFreezeCommit } from '../../scripts/readiness.mjs';

/** Runs the row against a throwaway tree holding one video.md, and hands back the row it printed. */
function frzOver(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claimready-frz-'));
  try {
    mkdirSync(path.join(root, 'docs', 'submission'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'submission', 'video.md'), body, 'utf8');
    return checkFreezeCommit(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The deliverable record, with the row under test dropped in. */
function runbook(freezeCell, prose = '') {
  return [
    '# ClaimReady demo video',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| Public video URL | NOT YET UPLOADED |',
    `| Freeze commit | ${freezeCell} |`,
    '',
    prose,
    '',
  ].join('\n');
}

test('the row passes when the record names a SHA and names it first', () => {
  const frz = frzOver(runbook('`c93b138`. Declared 2026-09-02, before any take was shot'));
  assert.equal(frz.status, 'PASS');
  assert.match(frz.detail, /c93b138/);
});

test('REPRODUCED: a superseded SHA in prose does not declare anything', () => {
  // The shape this file was written for. The record says plainly that nothing is declared yet, and
  // a paragraph below explains which two freeze commits were superseded and why. Under the older
  // check the paragraph was the declaration, and FRZ reported PASS against a commit the runbook had
  // just finished disowning.
  const frz = frzOver(runbook(
    'not yet declared. Pending the release of the work now in the tree',
    'The freeze commit `c93b138` declared on 2026-09-02 is superseded, and so is the freeze commit\n'
    + '`39690d4` a default dispatch would have written. Runtime code moved after both.',
  ));
  assert.equal(frz.status, 'FAIL');
  assert.match(frz.detail, /not yet declared/);
});

test('REPRODUCED: a superseded SHA inside the record cell does not declare anything either', () => {
  // The near miss. Moving the history into the cell puts a hex string back on the row, and a check
  // that only asked whether the row carried one would go green again. The SHA has to be the first
  // thing in the cell, because that is the only position a declaration can occupy.
  const frz = frzOver(runbook('not yet declared, supersedes `c93b138` and `39690d4`'));
  assert.equal(frz.status, 'FAIL');
  assert.match(frz.detail, /supersedes/);
});

test('the row refuses a runbook with no freeze record at all', () => {
  const frz = frzOver('# ClaimReady demo video\n\nNothing here says what is being recorded.\n');
  assert.equal(frz.status, 'FAIL');
  assert.match(frz.detail, /Freeze commit/);
});

test('the row refuses a runbook that is not there', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claimready-frz-'));
  try {
    const frz = checkFreezeCommit(root);
    assert.equal(frz.status, 'FAIL');
    assert.match(frz.detail, /does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
