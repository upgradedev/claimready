// tests/unit/video_freeze_list.test.js
//
// docs/submission/video.md states the superseded freeze declarations TWICE, in two shapes: once as
// a sentence inside the deliverable record row, and once as a list of bolded entries under a
// heading that counts them. Neither is derived from the other. Both are edited by hand, one
// unfreeze at a time.
//
// WHY THIS FILE EXISTS. They drifted, and the file shipped saying two different things about
// itself. At b5a43e8 the record row read "It supersedes 357410e, e942ee3, c93b138 and 9b64fb2, all
// named below with their reasons" while the section below named 39690d4, which was never declared,
// and omitted 357410e, which was. The row's promise, "all named below", was false in the shipped
// bytes. The fifth unfreeze then added 9450d70 to both, bumped the heading from four to five, and
// left the original disagreement exactly where it was: a fix that handled the example it was shown.
//
// So this test reads BOTH places out of the real file and requires them to agree as sets, and
// requires the number word in the heading to agree with both. A sixth unfreeze that updates one
// place and not the other cannot pass.
//
// THE FIXTURES ARE BUILT FROM A DIFFERENT LIST THAN THE CHECK READS. The synthetic documents below
// use deadbee, cafe123, 0ff1ce5, badf00d and 1234abc, and one case asserts that none of those five
// occurs anywhere in the real runbook. A fixture assembled from the same constants the parser reads
// out of the product cannot fail, so these are assembled from constants the product does not
// contain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNBOOK = path.join(HERE, '..', '..', 'docs', 'submission', 'video.md');

const NUMBER_WORDS = new Map([
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
]);

const SHA = '[0-9a-f]{7,40}';
const ROW_START = /^\|\s*Freeze commit\s*\|/;
const SECTION_HEADING = /^###\s+\w+\s+superseded declarations/i;

/**
 * Reads the two independent statements of the superseded list out of one runbook.
 *
 * Fails loudly rather than returning an empty list when an anchor is missing. A parser that
 * silently finds nothing is a gate that passes on a file it could not read, which is the shape
 * this whole file exists to refuse.
 */
export function readFreezeLists(markdown) {
  const lines = markdown.split(/\r?\n/);

  const rowLine = lines.find((line) => ROW_START.test(line));
  assert.ok(rowLine, 'no deliverable record row starting "| Freeze commit |" was found');
  const anchor = rowLine.toLowerCase().indexOf('superseded declarations are');
  assert.ok(
    anchor >= 0,
    'the freeze commit row no longer says "superseded declarations are", so this check cannot read '
      + 'it. Restore that phrasing or update this parser, and do not let it read nothing.',
  );
  const rowTail = rowLine.slice(anchor);
  const row = [...rowTail.matchAll(new RegExp('`(' + SHA + ')`', 'g'))].map((m) => m[1]);

  const headingAt = lines.findIndex((line) => SECTION_HEADING.test(line));
  assert.ok(headingAt >= 0, 'no "### <count> superseded declarations" heading was found');
  const headingWord = lines[headingAt].match(/^###\s+(\w+)/)[1].toLowerCase();
  assert.ok(
    NUMBER_WORDS.has(headingWord),
    'the superseded heading counts in a word this check cannot read: ' + headingWord,
  );

  const entryStart = new RegExp('^\\*\\*`(' + SHA + ')`');
  const section = [];
  for (let i = headingAt + 1; i < lines.length; i += 1) {
    if (/^###\s/.test(lines[i])) break;
    const entry = lines[i].match(entryStart);
    if (entry) section.push(entry[1]);
  }

  return { row, section, headingCount: NUMBER_WORDS.get(headingWord) };
}

/** True only when the row, the section and the heading count all say the same thing. */
export function listsAgree(lists) {
  const row = [...lists.row].sort();
  const section = [...lists.section].sort();
  if (row.length !== section.length) return false;
  if (row.some((sha, i) => sha !== section[i])) return false;
  return lists.headingCount === row.length;
}

/** A runbook in the real file's shape, with the two lists supplied separately on purpose. */
function runbook({ rowList, sectionList, headingWord }) {
  const quoted = rowList.map((sha) => '`' + sha + '`').join(', ');
  const entries = sectionList
    .map((sha) => '**`' + sha + '`, declared and superseded on a day.** A reason sits here.')
    .join('\n\n');
  return [
    '# A runbook',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| Freeze commit | NOT YET DECLARED. The superseded declarations are '
      + quoted + ', all named below with their reasons |',
    '',
    '### ' + headingWord + ' superseded declarations, each named with its reason',
    '',
    '**How this list was decided.** Prose that names no commit of its own.',
    '',
    entries,
    '',
    '**Why `not a sha` is absent.** Prose sitting after the entries.',
    '',
    '### A later heading',
    '',
    '**`0000000`, a commit under a different heading** that must not be counted.',
    '',
  ].join('\n');
}

// A list the product does not contain, so nothing below can be satisfied by the product's own
// constants. Checked by the first case rather than asserted in a comment.
const FOREIGN = ['deadbee', 'cafe123', '0ff1ce5', 'badf00d', '1234abc'];

test('the fixtures below are built from commits the runbook never mentions', () => {
  const text = readFileSync(RUNBOOK, 'utf8');
  for (const sha of FOREIGN) {
    assert.equal(
      text.includes(sha),
      false,
      sha + ' now appears in the runbook, so these fixtures share a constant with the file under '
        + 'test. Pick a different one.',
    );
  }
});

test('the record row and the named section list the same superseded declarations', () => {
  const lists = readFreezeLists(readFileSync(RUNBOOK, 'utf8'));
  assert.deepEqual(
    [...lists.section].sort(),
    [...lists.row].sort(),
    'the freeze commit row and the superseded section name different commits. The row promises '
      + '"all named below with their reasons", so a commit in one list and not the other makes '
      + 'that promise false in the shipped file.',
  );
});

test('the heading counts the entries it introduces, and the row agrees with the count', () => {
  const lists = readFreezeLists(readFileSync(RUNBOOK, 'utf8'));
  assert.equal(
    lists.headingCount,
    lists.section.length,
    'the number word in the superseded heading miscounts its own entries',
  );
  assert.equal(
    lists.headingCount,
    lists.row.length,
    'the number word in the superseded heading disagrees with the record row',
  );
  assert.ok(lists.row.length > 0, 'the record row named no superseded declaration at all');
});

test('agreement is reported when a foreign runbook says the same thing in both places', () => {
  const lists = readFreezeLists(runbook({
    rowList: FOREIGN, sectionList: FOREIGN, headingWord: 'Five',
  }));
  assert.deepEqual(lists.row, FOREIGN);
  assert.deepEqual(lists.section, FOREIGN);
  assert.equal(lists.headingCount, 5);
  assert.equal(listsAgree(lists), true);
});

test('a commit named in the row and missing from the section is caught', () => {
  // The shape that shipped: the row names one the section does not.
  const lists = readFreezeLists(runbook({
    rowList: FOREIGN,
    sectionList: FOREIGN.filter((sha) => sha !== 'cafe123'),
    headingWord: 'Five',
  }));
  assert.equal(lists.section.includes('cafe123'), false);
  assert.equal(listsAgree(lists), false);
});

test('a commit named in the section and missing from the row is caught', () => {
  const lists = readFreezeLists(runbook({
    rowList: FOREIGN.filter((sha) => sha !== 'badf00d'),
    sectionList: FOREIGN,
    headingWord: 'Five',
  }));
  assert.equal(listsAgree(lists), false);
});

test('two lists of equal length naming different commits are caught', () => {
  // This is the exact defect: one swapped commit, both lists the same length, so a check that
  // compared only counts would have passed it for a whole release.
  const swapped = FOREIGN.map((sha) => (sha === 'cafe123' ? 'abcdef0' : sha));
  const lists = readFreezeLists(runbook({
    rowList: FOREIGN, sectionList: swapped, headingWord: 'Five',
  }));
  assert.equal(lists.row.length, lists.section.length);
  assert.equal(listsAgree(lists), false);
});

test('a heading whose number word no longer counts its entries is caught', () => {
  const lists = readFreezeLists(runbook({
    rowList: FOREIGN, sectionList: FOREIGN, headingWord: 'Four',
  }));
  assert.equal(lists.headingCount, 4);
  assert.equal(lists.section.length, 5);
  assert.equal(listsAgree(lists), false);
});

test('entries under a later heading are not counted, and prose naming no commit is not either', () => {
  const lists = readFreezeLists(runbook({
    rowList: FOREIGN, sectionList: FOREIGN, headingWord: 'Five',
  }));
  assert.equal(lists.section.includes('0000000'), false);
  assert.equal(lists.section.length, 5);
});

test('a runbook the parser cannot read fails rather than reporting an empty agreement', () => {
  const noRow = [
    '# A runbook', '',
    '### Five superseded declarations, each named with its reason', '',
  ].join('\n');
  assert.throws(() => readFreezeLists(noRow), /no deliverable record row/);

  const noPhrase = [
    '# A runbook', '', '| Field | Value |', '| --- | --- |',
    '| Freeze commit | NOT YET DECLARED. Some other wording entirely |', '',
    '### Five superseded declarations, each named with its reason', '',
  ].join('\n');
  assert.throws(() => readFreezeLists(noPhrase), /superseded declarations are/);

  const noHeading = [
    '# A runbook', '', '| Field | Value |', '| --- | --- |',
    '| Freeze commit | NOT YET DECLARED. The superseded declarations are `deadbee`, named below |',
    '',
  ].join('\n');
  assert.throws(() => readFreezeLists(noHeading), /superseded declarations" heading/);
});
