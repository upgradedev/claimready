/**
 * The handler packet: what a filed claim looks like to the person who has to work it.
 *
 * PURE MODULE. No DOM, no network, no timers. The one thing it reaches for is Web Crypto, through
 * `globalThis.crypto.subtle`, which exists in Node 20 and in every browser this page supports, and
 * even that is only in the digest function at the bottom. Everything above it is data in, data out.
 *
 * WHY IT EXISTS. Filing on this page used to mean a status change and a line under a button. That
 * is honest, and it is not useful: nothing left the page in a shape a first notice of loss handler
 * could read. A claim desk needs the facts, the clause the cover decision came from, what the
 * insurer asked for and got, who answered which field through which surface, and something that
 * proves the packet was not edited after it was made.
 *
 * WHAT IT IS NOT. It is not a filing. No insurer backend is connected, nothing is sent anywhere,
 * and the packet says so in its own first field rather than in a footnote. And it is not on the
 * tool surface: src/webmcp never imports this module, so nothing the page registers builds it or
 * returns it, and it only exists after the filing control on the page has been pressed.
 *
 * THE DIGEST COVERS THE CONTENT, NOT THE MOMENT. `content` is everything about the filed claim and
 * hashes to `content_digest`. `generated_at` sits outside it, because a packet built twice from one
 * filed snapshot must produce one digest, and a clock in the hashed part would break that on
 * purpose. `node scripts/verify_packet.mjs <file>` recomputes it.
 */

import { packIdentity } from './filing.js';
import { checkCoverage } from './coverage.js';
import { deriveRequirements, outstandingRequirements } from './requirements.js';
import { FIELD_LABELS, PATCHABLE_FIELDS, validateClaim } from './claim.js';

/** Why a packet was refused. A caller branches on the code, never on the sentence. */
export const PACKET_CODES = {
  notFiled: 'PACKET_REFUSED_NOT_FILED',
  noPack: 'PACKET_REFUSED_NO_PACK',
  borrowedRules: 'PACKET_REFUSED_BORROWED_RULES',
  unfileable: 'PACKET_REFUSED_UNFILEABLE',
};

/** The label every surface uses for what this is, and what it is not. */
export const SYNTHETIC_NOTICE =
  'Synthetic, export ready FNOL packet. No insurer backend is connected and nothing was sent '
  + 'anywhere. Every name, policy number and vehicle in it is invented for this demonstration.';

/** The packet format, so a reader can tell two versions apart without guessing. */
export const PACKET_KIND = 'claimready.fnol.packet';
export const PACKET_VERSION = 1;

function refuse(code, reason) {
  return { ok: false, code, reason, packet: null, canonical: null };
}

/**
 * Canonical JSON: sorted keys at every level, two space indent, LF, no undefined.
 *
 * The digest is only worth something if two runs over one snapshot produce one string, so key
 * order cannot be left to insertion order and a float cannot be left to its default formatting.
 * Numbers here are integers and fixed decimals from the rule packs, and they are written as they
 * arrive.
 *
 * @param {*} value
 * @returns {string}
 */
export function canonicalise(value) {
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    const out = {};
    for (const key of Object.keys(node).sort()) {
      if (node[key] === undefined) continue;
      out[key] = walk(node[key]);
    }
    return out;
  };
  return `${JSON.stringify(walk(value), null, 2)}\n`;
}

/**
 * The SHA-256 of a canonical string, as `sha256:<hex>`.
 *
 * @param {string} canonical
 * @returns {Promise<string>}
 */
export async function digestOf(canonical) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error('This runtime has no Web Crypto, so the packet cannot be digested here.');
  }
  const bytes = new TextEncoder().encode(canonical);
  const hash = await subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

/** The route an answer arrived on, in the two words the page uses everywhere else. */
function routeOf(claim, field) {
  const source = claim.provenance && claim.provenance[field];
  if (source === 'agent') return 'via tool';
  if (source === 'human') return 'via page';
  if (typeof source === 'string' && source.length > 0) return source;
  return null;
}

/**
 * Build the packet for a filed claim.
 *
 * @param {object} input
 * @param {object} input.claim the filed claim
 * @param {object|null} input.pack the insurer rule pack the filing was decided under
 * @param {(string|null)} [input.homePackId] whose policy this is, as the page states it
 * @param {(string[]|Set<string>)} [input.completedHumanActions]
 * Coverage is NOT an input. It is recomputed here from the filed claim and the validated pack.
 * @param {Array<object>} [input.ledger] the page's tool call ledger, newest first
 * @returns {{ok: boolean, code: (string|null), reason: string, packet: (object|null),
 *            canonical: (string|null)}}
 */
export function buildFilingPacket(input) {
  const settings = input && typeof input === 'object' ? input : {};
  const claim = settings.claim;
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('buildFilingPacket needs a claim object.');
  }

  // A PACKET DESCRIBES A FILING THAT HAPPENED. Every refusal below is a case where it did not, and
  // the order is the order a reader would ask the questions in.
  if (claim.status !== 'filed') {
    return refuse(
      PACKET_CODES.notFiled,
      'This claim has not been filed. The packet describes a filed claim, and there is nothing to '
      + 'describe until a person presses File this claim on the page.',
    );
  }

  const identity = packIdentity(settings.pack, { homePackId: settings.homePackId });
  if (!identity.usable) {
    return refuse(
      PACKET_CODES.noPack,
      'The insurer rule pack is not loaded, so the packet cannot say which rules this claim was '
      + 'filed under, and a packet that cannot say that is worse than no packet.',
    );
  }
  if (identity.borrowed) {
    return refuse(
      PACKET_CODES.borrowedRules,
      `These are ${identity.insurer}'s rules, read against a policy that is not with them. `
      + 'No filing could have happened under them, so there is nothing to describe.',
    );
  }

  const pack = settings.pack;
  const done = settings.completedHumanActions;

  // THE GATE THE FILING WENT THROUGH, ASKED AGAIN, MINUS THE ONE ANSWER IT CANNOT GIVE US.
  // canFile answers ALREADY_FILED on a filed claim and stops, by design: a filed claim is not a
  // filing question any more. So the two conditions it short circuits past are asked here directly,
  // against the filed snapshot. A claim carrying a filed status it could not have reached is the
  // shape a bug elsewhere would produce, and the packet refuses it rather than dressing it up in a
  // document that looks official.
  const derived = deriveRequirements(pack, claim, done);
  const stillOpen = outstandingRequirements(derived);
  const missing = validateClaim(claim).missing;
  if (missing.length > 0 || stillOpen.length > 0) {
    const why = missing.length > 0
      ? `FILE_REFUSED_INCOMPLETE. Required and empty: ${missing.join(', ')}.`
      : `FILE_REFUSED_REQUIREMENTS. Still open: ${stillOpen.map((entry) => entry.label).join('; ')}.`;
    return refuse(
      PACKET_CODES.unfileable,
      `This claim is marked filed and could not have passed the filing gate. ${why}`,
    );
  }

  const requirements = derived.map((entry) => ({
    id: entry.id,
    label: entry.label,
    satisfied: Boolean(entry.satisfied),
    answered_by_field: entry.field ?? null,
    answered_by_person: entry.humanAction ?? null,
  }));

  const fields = {};
  const provenance = {};
  for (const field of PATCHABLE_FIELDS) {
    const value = claim[field];
    if (value === null || value === undefined || value === '') continue;
    fields[field] = { label: FIELD_LABELS[field] || field, value };
    const route = routeOf(claim, field);
    if (route) provenance[field] = route;
  }

  const pinned = Array.isArray(claim.locked) ? [...claim.locked].sort() : [];
  const actions = Array.isArray(done) ? [...done].sort() : [...(done || [])].sort();

  const ledger = Array.isArray(settings.ledger) ? settings.ledger : [];
  const calls = ledger
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      at: entry.at ?? null,
      tool: entry.tool ?? entry.name ?? null,
      refused: Boolean(entry.refused || entry.code),
      code: entry.code ?? null,
    }))
    .reverse();

  // COVERAGE IS RECOMPUTED HERE AND IS NEVER TAKEN FROM A CALLER.
  //
  // It used to be handed in, and the page handed in the panel's state object, which wraps the
  // decision under a `decision` key along with when it was worked out. This module read the wrapper
  // as though it were the decision, so every field came back undefined: a packet went out saying
  // not covered, clause null, excess null, with a valid digest over it, while the panel two inches
  // above said COVERED under OD-4.1 with an excess of 250. A sealed document that contradicts the
  // page is worse than no document, and the digest made it worse still by looking like proof.
  //
  // The fix is not to read the wrapper correctly. It is to stop accepting the answer from anyone:
  // the packet describes a filed claim, so it works the cover out from that claim and the validated
  // pack, the same way every other surface does, and there is no shape left to get wrong.
  const decided = checkCoverage(pack, claim);
  const coverage = decided
    ? {
      covered: Boolean(decided.covered),
      clause: decided.clause ?? null,
      deductible: decided.deductible ?? null,
      currency: decided.currency ?? pack.currency ?? null,
      reason: decided.reason ?? null,
      exclusions: Array.isArray(decided.exclusions) ? [...decided.exclusions].sort() : [],
      recomputed_from: 'the filed claim and the loaded rule pack, not from the page',
    }
    : null;

  const content = {
    kind: PACKET_KIND,
    version: PACKET_VERSION,
    synthetic: true,
    notice: SYNTHETIC_NOTICE,
    reference: claim.reference
      ? `${claim.reference}-R${claim.revision}`
      : `CR-${claim.policy_id || 'UNKNOWN'}-R${claim.revision}`,
    filed: {
      at: claim.filed_at ?? null,
      revision: claim.revision,
      through: 'a control on the page. Filing is not exposed as a WebMCP tool.',
    },
    policy: {
      number: claim.policy_id ?? null,
      insurer: identity.insurer,
      pack_id: identity.packId,
      pack_contract: pack.contract ?? null,
      pack_product: pack.product ?? null,
      pack_period: pack.period ?? null,
    },
    claim: fields,
    provenance,
    pinned_by_the_claimant: pinned,
    coverage,
    requirements,
    human_actions_completed: actions,
    tool_calls: calls,
  };

  const canonical = canonicalise(content);
  return { ok: true, code: null, reason: 'Packet built from the filed revision.', packet: content, canonical };
}

/**
 * The same packet as something a handler can read without a JSON viewer.
 *
 * @param {object} content the `content` object from buildFilingPacket
 * @param {(string|null)} [digest]
 * @returns {string}
 */
export function packetAsMarkdown(content, digest) {
  const lines = [];
  const row = (label, value) => lines.push(`- **${label}:** ${value}`);

  lines.push(`# First notice of loss, ${content.reference}`);
  lines.push('');
  lines.push(`> ${content.notice}`);
  lines.push('');
  lines.push('## The filing');
  row('Filed at', content.filed.at || 'not recorded');
  row('Draft revision', content.filed.revision);
  row('Route', content.filed.through);
  if (digest) row('Content digest', digest);
  lines.push('');

  lines.push('## The policy');
  row('Policy number', content.policy.number || 'not recorded');
  row('Insurer', content.policy.insurer || 'not recorded');
  row('Rule pack', `${content.policy.pack_id} (${content.policy.pack_contract || 'no contract stated'})`);
  lines.push('');

  lines.push('## The claim');
  for (const [field, entry] of Object.entries(content.claim)) {
    const route = content.provenance[field];
    row(entry.label, `${entry.value}${route ? ` (${route})` : ''}`);
  }
  lines.push('');

  if (content.coverage) {
    lines.push('## Cover, under this insurer\'s own rules');
    row('Decision', content.coverage.covered ? 'covered' : 'not covered');
    row('Clause', content.coverage.clause || 'not stated');
    row('Excess', content.coverage.deductible === null
      ? 'none stated'
      : `${content.coverage.deductible} ${content.coverage.currency || ''}`.trim());
    if (content.coverage.reason) row('Reason', content.coverage.reason);
    lines.push('');
  }

  lines.push('## What the intake asked for');
  for (const entry of content.requirements) {
    const mark = entry.satisfied ? 'answered' : 'OPEN';
    const how = entry.answered_by_field
      ? `field ${entry.answered_by_field}`
      : (entry.answered_by_person ? 'a person, no tool reaches it' : 'not stated');
    lines.push(`- ${mark}: ${entry.label} (${how})`);
  }
  lines.push('');

  if (content.pinned_by_the_claimant.length) {
    lines.push('## Pinned by the claimant, so no patch could move them');
    for (const field of content.pinned_by_the_claimant) lines.push(`- ${field}`);
    lines.push('');
  }

  if (content.tool_calls.length) {
    lines.push('## Tool calls, oldest first');
    for (const call of content.tool_calls) {
      lines.push(`- ${call.at || 'no time'} ${call.tool}${call.refused ? ` REFUSED ${call.code || ''}`.trimEnd() : ''}`);
    }
    lines.push('');
  }

  lines.push('Verify the digest with: `node scripts/verify_packet.mjs <this packet as JSON>`');
  return `${lines.join('\n')}\n`;
}
