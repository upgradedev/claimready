#!/usr/bin/env node
/**
 * Write docs/handler-packet.example.json from the module that builds a real packet.
 *
 *   node scripts/gen_packet_example.mjs           write the file
 *   node scripts/gen_packet_example.mjs --check   say whether the file on disk is what this writes
 *
 * Zero dependencies, Node 20, no network. Nothing here invents a fact: the claim is the sample
 * file this project ships, the rules are the shipped Northwind pack, and the packet comes out of
 * src/core/packet.js the same way the page gets it.
 *
 * WHY IT EXISTS. docs/handler-verification.md prints that packet's digest, two byte counts and the
 * digest of a deliberately edited copy, and tests/unit/handler_verification.test.js holds all of
 * them to the file. So the file cannot be edited by hand and it cannot be regenerated from memory
 * either: the next person to change the packet shape needs the command that produced the numbers,
 * not a description of how somebody once produced them. This is that command.
 *
 * TWO CLOCKS, BOTH SUPPLIED, NEITHER READ FROM THE MACHINE. `filed.at` is inside the digest and
 * `generated_at` is outside it, and a real clock in either would make this script write a different
 * file every run. The digest would move for no reason anybody could see, and the point of the
 * example is that it does not.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { applyPatch, createClaim, fileClaim, lockField } from '../src/core/claim.js';
import { loadPolicyPack } from '../src/core/policy.js';
import { buildFilingPacket, canonicalise, digestOf } from '../src/core/packet.js';

const ROOT = new URL('../', import.meta.url);
const TARGET = new URL('docs/handler-packet.example.json', ROOT);

/** The pack this policy is with, and the id the sample file gives it. */
const HOME = 'northwind';

/** The one human action this journey reports as carried out on the page. */
const DONE = ['roadside_collection'];

/** The moment the claim was filed, inside the digest. */
const FILED_AT = '2026-09-01T09:15:00.000Z';

/** The moment this copy was written out, outside the digest. */
const GENERATED_AT = '2026-09-01T09:15:31.000Z';

/**
 * The ledger the page would have collected by then.
 *
 * Newest first, which is the order the page holds it in, because buildFilingPacket turns it round
 * to oldest first on the way into the packet. Handing it the other way would produce a packet that
 * verifies and reads backwards.
 */
const LEDGER = [
  { at: '09:14:02', tool: 'validate_claim', refused: false, code: null },
  { at: '09:13:41', tool: 'apply_claim_patch', refused: true, code: 'PATCH_REJECTED_LOCKED' },
  { at: '09:12:10', tool: 'read_claim_state', refused: false, code: null },
];

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
}

/**
 * The journey the demonstration walks, ending in a filed claim.
 *
 * It is the journey tests/unit/packet.test.js drives, step for step, because two versions of one
 * story drift and the packet in the documents has to be the packet the tests hold. An agent fills
 * five fields, the person on the page corrects one of them and pins it, and then the person files.
 */
function filedClaim(pack, fixture) {
  let claim = createClaim(fixture);
  claim = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'location', value: 'Car park on Harbour Road' },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ], { actor: 'agent', baseRevision: 0 }).claim;
  claim = applyPatch(claim, [{ field: 'vehicle_drivable', value: false }], { actor: 'human' }).claim;
  claim = lockField(claim, 'vehicle_drivable').claim;

  const filed = fileClaim(claim, {
    pack,
    completedHumanActions: DONE,
    homePackId: HOME,
    at: FILED_AT,
  });
  if (!filed.ok) throw new Error(`the demonstration journey no longer files: ${filed.error}`);
  return filed.claim;
}

const pack = loadPolicyPack(readJson(`fixtures/insurers/${HOME}.json`));
const fixture = readJson('fixtures/demo-collision.json');

const built = buildFilingPacket({
  claim: filedClaim(pack, fixture),
  pack,
  homePackId: HOME,
  completedHumanActions: DONE,
  ledger: LEDGER,
});
if (!built.ok) throw new Error(`no packet was built: ${built.code}. ${built.reason}`);

const envelope = {
  content: built.packet,
  content_digest: await digestOf(built.canonical),
  generated_at: GENERATED_AT,
};

// The file on disk is the canonical envelope, not a pretty print of it. That is what lets route 3
// on docs/handler-verification.md quote a byte count for the whole file as well as for the content.
const text = canonicalise(envelope);

let current = null;
try {
  current = readFileSync(TARGET, 'utf8');
} catch {
  current = null;
}

// A checkout with converted line endings holds the same packet in more bytes, so the comparison is
// made over line feeds. Route 1 and route 2 both parse before they hash, for the same reason.
const normalised = current === null ? null : current.split('\r\n').join('\n');

console.log(`digest:            ${envelope.content_digest}`);
console.log(`content bytes:     ${Buffer.byteLength(built.canonical, 'utf8')}`);
console.log(`file bytes:        ${Buffer.byteLength(text, 'utf8')}`);
console.log(`converted copy:    ${Buffer.byteLength(text.split('\n').join('\r\n'), 'utf8')}`);

if (process.argv.includes('--check')) {
  if (normalised === text) {
    console.log('\ndocs/handler-packet.example.json is the file this script writes.');
    process.exit(0);
  }
  console.error('\ndocs/handler-packet.example.json is not what this script writes. Run it without '
    + '--check, then update the digests and byte counts on docs/handler-verification.md.');
  process.exit(1);
}

writeFileSync(TARGET, text, 'utf8');
console.log(`\nwrote ${new URL(TARGET).pathname.split('/').pop()}`);
