// tests/unit/readiness_video_link.test.js
//
// Two defects in scripts/readiness.mjs, both found by an outside audit on 2026-09-04, and both in
// what the gate PRINTS rather than in what it decides. The README tells a judge to run this gate,
// so its output is a judge-facing surface and a wrong line there is a wrong line published.
//
// ONE. The D4 row read the video link with \S+, which does not stop at the end of a URL. The link
// in docs/submission/video.md is bolded, so the row printed the URL with the closing asterisks
// still attached, and a reader who copied what the gate printed got a 404.
//
// TWO. Four rows are OWNER GATED and no script can ever pass them. That is right and it stays. What
// was wrong is that the closing line said they were "still owed by a person" for a day after the
// entry was submitted. docs/submission/owner-attestation.md now records what the owner did, the
// gate prints it beside the row, and the row STAYS owner gated. The last case below is the one that
// matters: an attestation must never turn into a pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkVideo, ownerAttestations, ownerGatedRows } from '../../scripts/readiness.mjs';

/** A throwaway tree holding one file under docs/submission, and the function run against it. */
function overTree(name, body, run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claimready-rvl-'));
  try {
    mkdirSync(path.join(root, 'docs', 'submission'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'submission', name), body, 'utf8');
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const IDS = ownerGatedRows().map((o) => o.id);

test('REPRODUCED: a bolded link used to be printed with its markdown still on it', () => {
  const row = overTree('video.md', '| Public video URL | **https://youtu.be/cazdzwy2qKU** Published |\n', checkVideo);

  assert.equal(row.status, 'PASS');
  assert.equal(row.detail, 'https://youtu.be/cazdzwy2qKU');
  assert.doesNotMatch(row.detail, /[*_`~)\]>.,;:!?'"]$/, 'the row printed trailing punctuation');
});

test('a link at the end of a sentence loses the full stop and nothing else', () => {
  const row = overTree('video.md', 'Watch it at https://www.youtube.com/watch?v=cazdzwy2qKU.\n', checkVideo);

  assert.equal(row.detail, 'https://www.youtube.com/watch?v=cazdzwy2qKU');
});

test('a plain link is returned untouched, so the strip cannot eat a real URL', () => {
  const row = overTree('video.md', 'https://youtu.be/cazdzwy2qKU\n', checkVideo);

  assert.equal(row.detail, 'https://youtu.be/cazdzwy2qKU');
});

test('no link is still a FAIL, because the strip must not invent one', () => {
  const row = overTree('video.md', '| Public video URL | NOT YET UPLOADED |\n', checkVideo);

  assert.equal(row.status, 'FAIL');
  assert.match(row.detail, /no public video link recorded yet/);
});

test('the attestation file is read, and an absent one is not an error', () => {
  const said = overTree('owner-attestation.md', '| Row | Date | What |\n| --- | --- | --- |\n| O1 | 2026-09-03 | uploaded it |\n',
    (root) => ownerAttestations(root, IDS));

  assert.equal(said.size, 1);
  assert.deepEqual(said.get('O1'), { date: '2026-09-03', note: 'uploaded it' });

  const empty = mkdtempSync(path.join(os.tmpdir(), 'claimready-rvl-'));
  try {
    assert.equal(ownerAttestations(empty, IDS).size, 0);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('an id that is not an owner gated row is refused, not skipped', () => {
  assert.throws(
    () => overTree('owner-attestation.md', '| Row | Date | What |\n| --- | --- | --- |\n| O9 | 2026-09-03 | nothing |\n',
      (root) => ownerAttestations(root, IDS)),
    /attests "O9", which is not an owner gated row/,
  );
});

test('a date that is not an ISO date is refused', () => {
  assert.throws(
    () => overTree('owner-attestation.md', '| Row | Date | What |\n| --- | --- | --- |\n| O1 | yesterday | uploaded it |\n',
      (root) => ownerAttestations(root, IDS)),
    /needs an ISO date and a note/,
  );
});

test('THE ONE THAT MATTERS: attesting a row does not give it a status', () => {
  const said = overTree('owner-attestation.md', '| Row | Date | What |\n| --- | --- | --- |\n| O3 | 2026-09-03 | pressed Submit |\n',
    (root) => ownerAttestations(root, IDS));

  const row = said.get('O3');
  assert.deepEqual(Object.keys(row).sort(), ['date', 'note'], 'an attestation carries text and nothing else');
  assert.equal(row.status, undefined, 'an attestation must never carry a status');
  assert.equal(ownerGatedRows().some((o) => 'status' in o), false, 'no owner gated row may carry a status');
});
