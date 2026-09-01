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
 * Exit 0 when it matches, 1 when it does not, 2 when the file cannot be read as a packet.
 */
import { readFileSync } from 'node:fs';

import { canonicalise, digestOf, PACKET_KIND } from '../src/core/packet.js';

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

console.log('\nThe digest matches, so this packet is the one the page built from that filed revision.');
