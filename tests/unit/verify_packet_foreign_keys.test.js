/**
 * The verifier refuses a document carrying keys this build never writes.
 *
 * WHAT IT USED TO DO. `checkPacketContent` validates the keys it knows and walks past every key it
 * does not, at every level. A reviewer walked through that with a text editor. Two forgeries, both
 * against the shipped example, both accepted:
 *
 *   1. Beside the packet. Add `insurer_receipt` and `status` as siblings of `content`, change
 *      nothing else. The digest covers the content and nothing else, so it still matched, and the
 *      verifier printed `The digest matches`. No recomputation was needed at all. This is the worse
 *      of the two, because it costs the forger nothing.
 *   2. Inside the digested region. Add `insurer_receipt`, `policy.underwriter_signature` and
 *      `coverage.settlement_authorised`, recompute the digest. Accepted, exit 0.
 *
 * WHY THE REFUSAL LIVES IN THE SCRIPT RATHER THAN IN src/core/packet.js. This script is the thing a
 * handler runs on a document somebody else handed them, which is the only place a foreign document
 * arrives. The page verifies only packets it has just built. Keeping it here also leaves the 26
 * files the page loads untouched, and the recording is frozen against those.
 *
 * The allowed lists are written out in the script rather than derived from the example file,
 * because a check that reads its expectation from a document agrees with whatever it is given.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// fileURLToPath, NOT `new URL(...).pathname`. A first version of this file sliced the leading
// character off the pathname, which turns Windows' `/C:/...` into a usable path and turns Linux's
// `/home/runner/...` into a relative one. It passed here and failed in CI with
// `Cannot find module '/home/runner/work/claimready/claimready/home/runner/work/...'`, the path
// doubled because a relative path was resolved against the working directory. That is the same
// class as the CRLF defect this repository already carries a lesson about: a test that only ever
// runs on one platform is a test that has only been checked on one platform.
const EXAMPLE = fileURLToPath(new URL('../../docs/handler-packet.example.json', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/verify_packet.mjs', import.meta.url));
const here = mkdtempSync(join(tmpdir(), 'claimready-forge-'));

/** Run the verifier on a file and hand back the exit code and what it said. */
function verify(file) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

function write(name, packet) {
  const file = join(here, name);
  writeFileSync(file, JSON.stringify(packet, null, 2), 'utf8');
  return file;
}

const original = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));

test('the packet this build ships still verifies', () => {
  const result = verify(EXAMPLE);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /The digest matches/);
});

test('a key added beside the packet is refused, and no digest work was needed to add it', () => {
  const forged = original();
  forged.insurer_receipt = { received: true, by: 'Northwind Claims', ref: 'NW-2026-88213' };
  forged.status = 'Accepted by the insurer. Handler A. Bell.';

  // The digest is untouched and still correct, which is the whole point of this case.
  assert.equal(forged.content_digest, original().content_digest);

  const result = verify(write('beside.json', forged));
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /beside the packet/);
  assert.match(result.out, /insurer_receipt/);
  assert.doesNotMatch(result.out, /The digest matches/);
});

test('keys added inside the digested region are refused, even with the digest recomputed', () => {
  const forged = original();
  forged.content.insurer_receipt = { received: true, by: 'Northwind Claims' };
  forged.content.policy.underwriter_signature = 'signed';
  forged.content.coverage.settlement_authorised = true;
  // The digest is deliberately left stale. The point is that the shape refusal comes FIRST, so a
  // forger who does recompute it never reaches the digest comparison either.
  const result = verify(write('inside.json', forged));
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /never writes/);
  for (const key of ['insurer_receipt', 'policy.underwriter_signature', 'coverage.settlement_authorised']) {
    assert.ok(result.out.includes(key), `${key} was not named in the refusal`);
  }
});

test('the refusal names every foreign key rather than stopping at the first', () => {
  const forged = original();
  forged.content.one = 1;
  forged.content.claim.two = 2;
  forged.content.filed.three = 3;
  const result = verify(write('several.json', forged));
  assert.equal(result.code, 2);
  assert.match(result.out, /3 key\(s\)/);
});
