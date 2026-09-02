/**
 * Recompute a handler packet's digest and say whether it still describes what it claims to.
 *
 *   node scripts/verify_packet.mjs <packet.json>
 *
 * The packet a person downloads from the page carries `content`, `generated_at` and
 * `content_digest`. Only `content` is hashed, so two packets built from one filed revision agree
 * even though they were made at different moments. Edit one character of the claim, the coverage,
 * the requirements or the provenance and the digest stops matching, which is the whole point of
 * shipping it beside the data.
 *
 * TWO CHECKS, IN THIS ORDER. First the shape, against the same schema src/core/packet.js runs
 * before it seals anything: the filing instant, the provenance vocabulary, the pack contract, the
 * cover block and the ledger entries. Then the digest. A matching digest over a document that is
 * not a packet is the outcome most likely to be mistaken for a pass, so the shape goes first.
 *
 * AND SAY WHAT A MATCH IS WORTH. It is a bare SHA-256 with no key and no signature behind it, so it
 * shows the content in front of you is the content that digest was computed over, and it shows
 * nothing about who made the file. docs/handler-verification.md spells that out for a handler.
 *
 * Exit 0 when it matches, 1 when the content and the digest disagree, 2 when the file cannot be
 * read as a packet this build describes.
 */
import { readFileSync } from 'node:fs';

import { canonicalise, checkPacketContent, digestOf, PACKET_KIND } from '../src/core/packet.js';

const path = process.argv[2];
if (!path) {
  console.error('Give me a packet: node scripts/verify_packet.mjs <packet.json>');
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`${path} is not readable JSON: ${error.message}`);
  process.exit(2);
}

const content = parsed && parsed.content;
if (!content || content.kind !== PACKET_KIND) {
  console.error(
    `${path} does not look like a ClaimReady packet. A packet has a "content" object whose kind is `
    + `"${PACKET_KIND}".`,
  );
  process.exit(2);
}

// THE SHAPE IS CHECKED BEFORE THE DIGEST, AND THAT ORDER IS THE POINT.
//
// This script used to check that a content object existed and that its kind was ours, then hash
// whatever was in it. So a file whose filing time read "09:15", whose provenance said a word this
// page never writes, or whose cover said covered with an exclusion under it, verified perfectly:
// the digest is a statement about bytes and says nothing about whether those bytes describe a
// packet this page could have written. A handler was told the document was checked when only its
// hash had been.
//
// A matching digest over a malformed document is the worst of the four outcomes, because it is the
// one that looks settled. So the shape goes first, and it is checked by the same function
// src/core/packet.js runs before it seals anything, rather than by a second list kept here.
//
// Exit 2, with the unreadable file, rather than exit 1. Exit 1 means the content and the digest
// disagree, which is a real answer about a real packet. This is the other thing: it is not a packet
// this build describes, so there is no digest question to answer yet.
// KEYS THIS BUILD NEVER WRITES ARE REFUSED HERE, and this is the half checkPacketContent does not
// do. It validates the keys it knows and walks past every key it does not, at every level. A
// reviewer walked straight through that with a text editor: take the shipped example, add
// `insurer_receipt: {received: true, by: "Northwind Claims"}` and `policy.underwriter_signature`,
// recompute the digest, and the verifier printed `The digest matches` and exited 0. Outside the
// digested region it did not even need the recompute.
//
// That matters more here than anywhere else in this repository, because this script is the thing a
// handler runs on a document somebody else handed them. The page only ever verifies packets it just
// built. So the refusal lives here rather than in src/core/packet.js: this is where a foreign
// document arrives, and the runtime the takes are shot against does not move for it.
//
// The lists are written out rather than derived from the example file, because a check that reads
// its expectation from a document is a check that agrees with whatever it is given.
// THE ENVELOPE IS THE MORE DANGEROUS HALF, and it is the one a first pass at this missed. A key
// added beside `content` rather than inside it needs no recomputed digest at all: the digest covers
// the content and nothing else, so `insurer_receipt` sitting next to it survives untouched and the
// verifier goes on printing that the digest matches. A handler reading the file sees a receipt, and
// the line under it agrees.
const ALLOWED_ENVELOPE_KEYS = ['content', 'content_digest', 'generated_at'];

const foreignEnvelope = Object.keys(parsed)
  .filter((key) => !ALLOWED_ENVELOPE_KEYS.includes(key));
if (foreignEnvelope.length > 0) {
  console.error(`${path} carries ${foreignEnvelope.length} key(s) beside the packet that this build `
    + 'never writes. The digest covers the content and nothing else, so a key added here is not '
    + 'protected by it and never was.');
  console.error('');
  for (const key of foreignEnvelope.sort()) console.error(`  ${key}`);
  process.exit(2);
}

const ALLOWED_KEYS = {
  '': ['claim', 'coverage', 'filed', 'human_actions_completed', 'kind', 'notice',
    'pinned_by_the_claimant', 'policy', 'provenance', 'reference', 'requirements', 'synthetic',
    'tool_calls', 'version'],
  filed: ['at', 'revision', 'through'],
  policy: ['insurer', 'number', 'pack_contract', 'pack_id', 'pack_period', 'pack_product'],
  coverage: ['clause', 'covered', 'currency', 'deductible', 'exclusions', 'provisional',
    'provisional_reason', 'reason', 'recomputed_from'],
  claim: ['damage_zone', 'description', 'driver', 'incident_date', 'incident_type', 'location',
    'severity', 'vehicle_drivable'],
};

const foreign = [];
for (const [where, allowed] of Object.entries(ALLOWED_KEYS)) {
  const held = where === '' ? content : content[where];
  if (!held || typeof held !== 'object' || Array.isArray(held)) continue;
  for (const key of Object.keys(held)) {
    if (!allowed.includes(key)) foreign.push(where === '' ? key : `${where}.${key}`);
  }
}
if (foreign.length > 0) {
  console.error(`${path} carries ${foreign.length} key(s) this build never writes, so it is not a `
    + 'packet this page produced, whatever its digest says.');
  console.error('An added key is how a document gets made to assert something the page never said.');
  console.error('');
  for (const key of foreign.sort()) console.error(`  ${key}`);
  process.exit(2);
}

const shape = checkPacketContent(content);
if (!shape.ok) {
  console.error(`${path} is not a packet this build describes, so the digest was not checked.`);
  console.error('A digest over a document like this would only make it look checked.');
  console.error('');
  for (const problem of shape.problems) console.error(`  ${problem}`);
  process.exit(2);
}

const canonical = canonicalise(content);
const recomputed = await digestOf(canonical);
const claimed = parsed.content_digest;

console.log(`packet:     ${content.reference}`);
console.log(`filed:      revision ${content.filed.revision} at ${content.filed.at || 'no time recorded'}`);
console.log(`claimed:    ${claimed}`);
console.log(`recomputed: ${recomputed}`);

if (claimed !== recomputed) {
  console.error('\nThe digest does not match the content. This packet has been edited since it was '
    + 'built, or it was not built by this version of the page.');
  process.exit(1);
}

// SAY WHAT THE MATCH IS WORTH AND NO MORE. This line used to read "so this packet is the one the
// page built from that filed revision", which is a claim about where the file came from, and a bare
// SHA-256 with no key and no signature behind it cannot support one. Anyone can edit the content and
// recompute the digest to match. What the match does give is worth having on its own, and it is what
// the sentence says now.
console.log('\nThe digest matches: this content is the content that digest was computed over.');
console.log('That catches a packet changed on the way to you, and two copies that have drifted');
console.log('apart. It is a bare SHA-256 with no key and no signature, so it does not show which');
console.log('page made this packet, who wrote it, or that nobody edited the content and recomputed');
console.log('the digest to match. docs/handler-verification.md says the same in more detail.');
