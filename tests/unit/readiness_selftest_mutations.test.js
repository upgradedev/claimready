// tests/unit/readiness_selftest_mutations.test.js
//
// The readiness selftest breaks one thing in a copy of the repository and requires the row that
// watches it to refuse. Every one of those cases rests on a step that has to actually change a
// file. A step that searches for text the file does not contain writes it back untouched, and the
// broken half then runs against an intact tree.
//
// That happened. On 2026-09-02 the QCK case that renames the clone directory looked for the literal
// `\ncd claimready\n`. A Windows clone with core.autocrlf true gets a README whose lines end
// `\r\n`, the literal matched nothing, and the case measured an intact file while Linux CI stayed
// green. Observed on this machine with the README converted to CRLF:
//
//   BAD  QCK   intact PASS     broken crashed  the quickstart changes into a directory the clone
//                                              does not create
//
// Two things are pinned here, and neither of them needs a sandbox or a 45 case run:
//
//   1. editFile refuses an edit that changed nothing, so a mutation that misses can never be
//      counted as a mutation that landed.
//   2. replaceAnyEol finds the same text whichever way the checkout spelled its line endings, and
//      writes the replacement back in the spelling the file was already using.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { editFile, replaceAnyEol } from '../../scripts/readiness.mjs';

/** The two lines of a quickstart that the QCK case rewrites, in both spellings. */
const QUICKSTART = [
  '```bash',
  'git clone https://github.com/upgradedev/claimready',
  'cd claimready',
  'node --test tests/unit',
  '```',
  '',
].join('\n');

function withSandbox(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claimready-mut-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------- the helper that finds the text */

test('replaceAnyEol finds a multi-line literal in a file written with plain newlines', () => {
  const out = replaceAnyEol(QUICKSTART, '\ncd claimready\n', '\ncd claim-ready\n');
  assert.notEqual(out, QUICKSTART, 'the replacement did not land on an LF file');
  assert.match(out, /\ncd claim-ready\n/);
});

test('replaceAnyEol finds the same literal in a file the checkout converted to CRLF', () => {
  // The case the old code could not do. `String.prototype.replace` with a literal is exact, so the
  // newline in the pattern has to be widened before it can match a file that spells it `\r\n`.
  const crlf = QUICKSTART.split('\n').join('\r\n');
  const out = replaceAnyEol(crlf, '\ncd claimready\n', '\ncd claim-ready\n');
  assert.notEqual(out, crlf, 'the replacement did not land on a CRLF file');
  assert.match(out, /\r\ncd claim-ready\r\n/);
});

test('replaceAnyEol writes the replacement back in the line endings the file already had', () => {
  // A break step that left one LF line inside an otherwise CRLF file would be a second difference
  // nobody asked for, and a byte comparison somewhere else would then fail for the wrong reason.
  const crlf = QUICKSTART.split('\n').join('\r\n');
  const out = replaceAnyEol(crlf, '\ncd claimready\n', '\ncd claim-ready\n');
  // ASSERTED BEFORE THE COUNT, because a helper that replaced nothing at all would leave a
  // perfectly uniform CRLF file and pass the count on its own. Watched happening on 2026-09-02
  // while the fix was deliberately removed: this case stayed green for that exact reason.
  assert.match(out, /cd claim-ready/, 'the replacement did not land, so the count below proves nothing');
  const lonelyNewlines = out.split('\n').filter((_, index, all) => index < all.length - 1)
    .filter((piece) => !piece.endsWith('\r')).length;
  assert.equal(lonelyNewlines, 0, `the replacement left ${lonelyNewlines} bare newline(s) in a CRLF file`);
});

test('replaceAnyEol leaves the text alone when the literal is genuinely absent', () => {
  // It reports the miss by returning the text unchanged. editFile is what turns that into a
  // refusal, which is the split tested below: finding is one job, refusing is the other.
  const out = replaceAnyEol(QUICKSTART, '\ncd somewhere-else\n', '\ncd elsewhere\n');
  assert.equal(out, QUICKSTART);
});

/* ------------------------------------------------------- the assertion that a mutation happened */

test('editFile refuses a break step whose pattern is not in the file', () => {
  withSandbox((dir) => {
    const file = 'README.md';
    writeFileSync(path.join(dir, file), QUICKSTART.split('\n').join('\r\n'));

    assert.throws(
      () => editFile(dir, file, (t) => t.replace('\ncd claimready\n', '\ncd claim-ready\n')),
      /the edit changed nothing/,
      'a mutation that matched nothing was accepted as a mutation',
    );
  });
});

test('editFile names the file and says what to do about it', () => {
  withSandbox((dir) => {
    writeFileSync(path.join(dir, 'README.md'), QUICKSTART);
    let message = '';
    try {
      editFile(dir, 'README.md', (t) => t);
    } catch (error) {
      message = String(error.message);
    }
    assert.match(message, /README\.md/, `the refusal did not name the file: ${message}`);
    assert.match(message, /replaceAnyEol/, `the refusal did not say how to fix it: ${message}`);
  });
});

test('editFile writes the file when the break step really did change it', () => {
  // The other half. A guard that refused everything would pass the test above and stop the whole
  // selftest from working, so the accepting case is asserted next to the refusing one.
  withSandbox((dir) => {
    const full = path.join(dir, 'README.md');
    writeFileSync(full, QUICKSTART.split('\n').join('\r\n'));

    editFile(dir, 'README.md', (t) => replaceAnyEol(t, '\ncd claimready\n', '\ncd claim-ready\n'));

    assert.match(readFileSync(full, 'utf8'), /cd claim-ready/);
  });
});
