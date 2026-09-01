/**
 * The worked example on docs/handler-verification.md, checked the way a stranger would check it.
 *
 * WHY THIS EXISTS. Everything else that proves a packet digest is ours. src/core/packet.js computes
 * it, scripts/verify_packet.mjs recomputes it with the same function, and tests/unit/packet.test.js
 * agrees with both. That is one implementation marking its own homework three times. The document
 * this file guards hands an outside reader two routes that import nothing from here, and it prints
 * a real digest for a real packet so the reader has something to check the routes against.
 *
 * A printed digest rots. Change the packet and forget the page, or edit the page and forget the
 * packet, and the document goes out saying something the file does not, which is worse than saying
 * nothing. So the three things that have to agree are asserted here rather than remembered:
 *
 *   1. the digest inside docs/handler-packet.example.json
 *   2. the digest recomputed from that file by an implementation written from the five rules
 *   3. the digest written on docs/handler-verification.md
 *
 * THE RECOMPUTATION BELOW IS DELIBERATELY NOT AN IMPORT. `canonical` and `sha256` are written out
 * again from the specification in the document, over node:crypto rather than Web Crypto. If they
 * imported canonicalise and digestOf they would agree with the module by construction and this file
 * would be checking nothing. The module is imported all the same, at the end, to pin that the two
 * implementations still answer the same, because that agreement is itself a claim the document
 * makes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { canonicalise, digestOf, PACKET_KIND, PACKET_VERSION } from '../../src/core/packet.js';

const ROOT = new URL('../../', import.meta.url);
const EXAMPLE = new URL('docs/handler-packet.example.json', ROOT);
const PAGE = new URL('docs/handler-verification.md', ROOT);

const raw = readFileSync(EXAMPLE, 'utf8');
const example = JSON.parse(raw);
const page = readFileSync(PAGE, 'utf8');

/** Rule 1, 2 and 5 of the canonical form, written from the document, not imported from the code. */
function canonical(value) {
  const sort = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(sort);
    const out = {};
    for (const key of Object.keys(node).sort()) out[key] = sort(node[key]);
    return out;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Rule 4, and the hash, over node:crypto. The page never touches this implementation. */
function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** The packet with its excess moved by one character, which is the tamper the document shows. */
function tampered() {
  const copy = JSON.parse(raw);
  assert.equal(copy.content.coverage.deductible, 250, 'the example still carries the 250 excess');
  copy.content.coverage.deductible = 350;
  return copy.content;
}

/* --------------------------------------------------------------- the example is what it says */

test('the example packet is a packet, in the format this build writes', () => {
  assert.equal(example.content.kind, PACKET_KIND);
  assert.equal(example.content.version, PACKET_VERSION);
  assert.equal(example.content.synthetic, true, 'the example claim is synthetic and says so');
  assert.match(example.content.notice, /No insurer backend is connected/);
  assert.match(example.content_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(typeof example.generated_at, 'string');
});

test('an implementation written from the five rules recomputes the digest the file claims', () => {
  const recomputed = sha256(canonical(example.content));

  assert.equal(
    recomputed,
    example.content_digest,
    'docs/handler-packet.example.json no longer hashes to the digest it carries',
  );
});

/* ----------------------------------------------------------- and the page says the same thing */

test('the digest printed on the page is the digest the example actually has', () => {
  const hex = example.content_digest.slice('sha256:'.length);

  assert.ok(
    page.includes(example.content_digest),
    `docs/handler-verification.md does not print ${example.content_digest}`,
  );
  // The table shows the sha256sum and certutil rows as bare hex, because that is what those two
  // tools print. Both spellings have to be the live one.
  assert.ok(page.includes(hex), 'the bare hex rows on the page are stale');

  // Nothing else that looks like a digest may be sitting on the page claiming to be this packet's.
  // The tampered digest is the one legitimate exception and it is checked next.
  const others = [...page.matchAll(/\b[0-9a-f]{64}\b/g)].map((match) => match[0]);
  const tamperedHex = sha256(canonical(tampered())).slice('sha256:'.length);
  const strays = others.filter((value) => value !== hex && value !== tamperedHex);
  assert.deepEqual(strays, [], `the page prints a digest that belongs to nothing: ${strays.join(', ')}`);
});

test('the refusal the page demonstrates is the refusal that happens', () => {
  const moved = sha256(canonical(tampered()));

  assert.notEqual(moved, example.content_digest, 'one character inside content has to move it');
  assert.ok(
    page.includes(moved.slice('sha256:'.length)),
    `the page shows the wrong digest for the edited packet. It is now ${moved}`,
  );
});

test('generated_at sits outside the digest, which is the other half of the demonstration', () => {
  const moved = JSON.parse(raw);
  moved.generated_at = '2031-12-25T23:59:59.000Z';

  assert.equal(
    sha256(canonical(moved.content)),
    example.content_digest,
    'moving the clock moved the digest, so two exports of one filing no longer agree',
  );
});

test('a carriage return line feed checkout still verifies, as the page says it does', () => {
  // Git on Windows commonly converts line endings on checkout, so the file a reader opens may not
  // be the file that was committed. Route 1 and route 2 both parse the JSON and write the canonical
  // form out again, so the endings in the file never reach the hash. That is the reason the page
  // can promise it, and this is the proof.
  //
  // THE BASE IS NORMALISED FIRST, AND THAT IS THE WHOLE REPAIR. This used to build its copy with
  // `raw.split('\n').join('\r\n')` straight off the file on disk. On a Windows clone, where git had
  // already converted the file, `raw` was CRLF, so that line turned every "\r\n" into "\r\r\n" and
  // the size assertion below compared a doubled file against the number the page quotes. Measured
  // on 2026-09-01 in a fresh clone of this repository at ab2db69: `node --test tests/unit`, the
  // command the README quickstart tells a judge to run, printed `5022 !== 4864` and failed. The
  // same conversion applied to this working tree reproduced it as `5088 !== 4928`.
  //
  // The defect was in the FIXTURE, not in the thing under test: a test that builds its input from
  // whatever the checkout happened to do cannot say what it claims to say. So the base is pinned to
  // line feeds here, and the file is pinned to line feeds in .gitattributes as well, because one of
  // those alone leaves the other reader exposed.
  const lf = raw.split('\r\n').join('\n');
  const crlf = lf.split('\n').join('\r\n');
  assert.ok(!lf.includes('\r'), 'the normalised base still carries a carriage return');
  assert.notEqual(crlf.length, lf.length, 'the copy under test has to actually differ');

  assert.equal(sha256(canonical(JSON.parse(crlf).content)), example.content_digest);
  assert.equal(Buffer.byteLength(crlf, 'utf8'), 4928, 'the page quotes the size of that copy');
});

test('the byte counts the page quotes are the byte counts the file has', () => {
  // Sizes are measured over the canonical form rather than over the file on disk, for the reason
  // the test above demonstrates. A checkout that converted the line endings has a bigger file and
  // an identical canonical form, and the number a reader is told to compare against is the second
  // one.
  assert.equal(Buffer.byteLength(canonical(example.content), 'utf8'), 4300);
  assert.equal(Buffer.byteLength(canonical(example), 'utf8'), 4768);

  assert.ok(page.includes('4,300 bytes'), 'the page quotes a stale canonical size');
  assert.ok(page.includes('4,768 bytes'), 'the page quotes a stale file size');
  assert.ok(page.includes('4,928 bytes'), 'the page quotes a stale size for the converted copy');
});

/* ------------------------------------------------------- the two implementations still agree */

test('the outside implementation and src/core/packet.js answer the same', async () => {
  // The page tells a reader that a canonicaliser written from five rules agrees with the one that
  // built the packet. That is a claim about this repository, so it is checked here rather than
  // asserted there.
  assert.equal(canonical(example.content), canonicalise(example.content));
  assert.equal(await digestOf(canonical(example.content)), example.content_digest);
});

/* --------------------------------------------------------------- the limitations stay written */

test('the page keeps saying what the digest cannot do, and what nobody has checked', () => {
  // These two sentences are the difference between a document and an overclaim. A digest with no
  // key proves integrity and says nothing about origin, and no outside party has run any of it.
  // Either one is easy to lose in an edit that was only trying to tighten the prose.
  assert.match(page, /no key and no signature/i);
  assert.match(page, /does not tell you who made the packet/i);
  assert.match(page, /Nobody outside this project has run any of this yet/i);

  const gated = [...page.matchAll(/OWNER GATED/g)];
  assert.ok(gated.length >= 3, `the owner gated rows have gone missing, ${gated.length} left`);
});
