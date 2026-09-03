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
 * insurer asked for and got, who answered which field through which surface, and a checksum it can
 * recompute for itself.
 *
 * WHAT THE CHECKSUM IS, SAID IN THE ONE FORM EVERY SURFACE HERE HAS TO USE. It is a bare SHA-256
 * over the exact exported content. Recomputing it and getting the same value says the content in
 * front of you is the content that value was computed over, which is what catches a file changed in
 * transit or two copies that have drifted apart. It says nothing else. There is no key and no
 * signature anywhere in this system, so it does not show where the packet came from, who wrote it,
 * that nobody edited the content and recomputed the value to match, that the packet was stored
 * anywhere, or that an insurer ever received it. `docs/handler-verification.md` says the same thing
 * to the handler, and README, the page and the description say it in their own words. If one of
 * them starts claiming more, it is that surface that is wrong, not this paragraph.
 *
 * WHAT THE tool_calls BLOCK IS, AND WHAT NO CHECK IN HERE CAN MAKE IT. Every other block in the
 * packet is worked out here, from the filed claim and the validated rule pack, or bound to the
 * filing receipt. The ledger is neither. It arrives on the call, from whoever is building the
 * packet, and this module has no way to attest that any call in it was ever made. So it is checked
 * rather than believed, and what the checks can establish is the whole of what the block means:
 * these rows are well formed, each is written in one of the two shapes a ledger row on this page is
 * written in, each carries a time this page writes, and each names a tool this page publishes. That
 * is all. It does NOT say an agent made these calls, that the page saw them, that they happened in
 * this order, or that the list is the whole of what happened. The digest adds nothing to it either,
 * for the reason above: it is a statement about bytes, so it covers the rows as written and says
 * nothing about where they came from. On the page there is one caller and it hands in its own
 * ledger, so there the block is that ledger. A reader holding an exported file cannot tell that it
 * was, and this module will not say otherwise on their behalf.
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

import { FILE_CODES, filingIdentity } from './filing.js';
import { checkCoverage, openCoverQuestions } from './coverage.js';
import { deriveRequirements, outstandingRequirements, OPTIONAL_NOTE_CODES } from './requirements.js';
import {
  checkClaimSnapshot,
  FIELD_LABELS,
  PATCH_CODES,
  filedRevisionOf,
  isCalendarDate,
  isFilingInstant,
  PATCHABLE_FIELDS,
  validateClaim,
  verifyFilingContext,
  FILING_CONTEXT_MISMATCHES,
} from './claim.js';
import { PACK_CONTRACT } from './policy.js';
import { canonicalise } from './canonical.js';

/** Why a packet was refused. A caller branches on the code, never on the sentence. */
export const PACKET_CODES = {
  notFiled: 'PACKET_REFUSED_NOT_FILED',
  noPack: 'PACKET_REFUSED_NO_PACK',
  noPolicyId: 'PACKET_REFUSED_NO_POLICY_ID',
  noHomeInsurer: 'PACKET_REFUSED_NO_HOME_INSURER',
  borrowedRules: 'PACKET_REFUSED_BORROWED_RULES',
  unfileable: 'PACKET_REFUSED_UNFILEABLE',
  // The claim is not one this page could have written. Not a filing question at all, which is why
  // it is asked before the filing questions and has a code of its own.
  unusableState: 'PACKET_REFUSED_UNUSABLE_STATE',
  // Every refusal above asks whether this filing COULD have happened. This one asks whether it
  // DID, and it is the last question because it is the only one left once the others have passed.
  notFiledHere: 'PACKET_REFUSED_NOT_FILED_HERE',
  // A filing did happen, and this is not what it happened under. The pack, whose policy it is and
  // which steps a person had carried out all arrive on this call rather than off the claim, so
  // they are the three facts a caller can still substitute after the fact.
  notTheFilingContext: 'PACKET_REFUSED_NOT_THE_FILING_CONTEXT',
  // The ledger names a tool this page does not publish. A sealed row saying `file_claim` succeeded
  // is a document describing a tool that deliberately does not exist.
  unknownTool: 'PACKET_REFUSED_UNKNOWN_TOOL',
  // A ledger row that names no tool at all. It is a separate thing to be told and it keeps a code
  // of its own: `unknownTool` says the row named something this page never published, and this one
  // says the row named nothing, so there is no call for a handler to look up. Reusing the other
  // code would put a quoted name in a sentence that has no name to quote.
  namelessCall: 'PACKET_REFUSED_NAMELESS_CALL',
  // A ledger row that is not a row. A null, a number, a string or an array is not a call, and it
  // used to be dropped by a filter rather than refused, which sealed a ledger quietly shorter than
  // the one handed in. It cannot reuse `namelessCall`: that one says a call arrived with no name on
  // it, and this one says nothing that could carry a name arrived at all.
  unusableCall: 'PACKET_REFUSED_UNUSABLE_CALL',
  // A ledger row carrying a key this page never writes on one, or mixing the keys of the two shapes
  // it does write. The row may name a real tool and still not be a row this page produced, and a
  // packet that cannot say where a row came from should not be saying the row is a call.
  foreignCallKey: 'PACKET_REFUSED_FOREIGN_CALL_KEY',
  // A ledger row whose time is not one this page writes. `at` was any non-empty string, so
  // "not-a-time" sealed beside a successful call to a real tool, under a digest.
  callTime: 'PACKET_REFUSED_CALL_TIME',
  // The document was assembled and does not match the shape this build describes. On the ordinary
  // path it cannot happen, because every input was checked on the way in. It is what a change to
  // the build block trips over, and it is the code the verifier reports on a file off a disk.
  // A code is printed to a handler as something this page decided, so it is held to the four
  // registries this build publishes rather than to being a non empty string. It has its own name
  // because `unknownTool` already means the row named a tool nobody published, and a row can name a
  // real tool and a refusal that does not exist.
  unknownRefusalCode: 'PACKET_REFUSED_UNKNOWN_REFUSAL_CODE',
  malformed: 'PACKET_REFUSED_MALFORMED',
};

/** The label every surface uses for what this is, and what it is not. */
export const SYNTHETIC_NOTICE =
  'Synthetic, export ready FNOL packet. No insurer backend is connected and nothing was sent '
  + 'anywhere. Every name, policy number and vehicle in it is invented for this demonstration.';

/**
 * The packet format, so a reader can tell two versions apart without guessing.
 *
 * VERSION 2, AND HERE IS THE DECISION AND ITS REASON, BECAUSE THE NEXT PERSON TO CHANGE THIS BLOCK
 * WILL FACE THE SAME QUESTION.
 *
 * Version 1 wrote `coverage.covered: true` on a claim whose yes still depended on something the
 * claim had not said, while the panel two inches above read "Covered, provisionally" and the tool
 * answered "COVERED, PROVISIONALLY". The packet was the one surface telling a handler a flat yes,
 * and it was the surface with a digest on it, which made the wrong answer look checked.
 *
 * The fix adds `provisional` and `provisional_reason` beside `covered`. That is an addition, and a
 * reader who ignores keys it does not know would not break on it, so compatibility is not the
 * argument. The argument is the other way round: a version 1 reader that renders a decision from
 * `coverage.covered` alone now renders a false one, and it has no way to find that out. The version
 * is the only signal in the format that carries "this field needs its companion read too", so it
 * moves. A reader pinned to 1 stops rather than quietly going on being wrong.
 *
 * `kind` does not move. It is the same document about the same thing, written by the same page, and
 * a new kind would say a reader has to relearn the whole shape when only one block changed.
 *
 * The rule for next time: `kind` changes when the document becomes a different document, and the
 * version changes when a field a reader already reads starts meaning something it did not. Adding a
 * block nothing else depends on does not need either.
 */
export const PACKET_KIND = 'claimready.fnol.packet';
export const PACKET_VERSION = 2;

function refuse(code, reason) {
  return { ok: false, code, reason, packet: null, canonical: null };
}

/* ------------------------------------------------------------------------ the packet schema */

/**
 * WHAT THIS IS FOR, AND WHY A DIGEST IS NOT ENOUGH ON ITS OWN.
 *
 * `scripts/verify_packet.mjs` used to check two things: that a `content` object existed and that its
 * kind was ours, and then it hashed whatever was there. So a file whose `filed.at` read "09:15", or
 * whose provenance said `via carrier pigeon`, or whose coverage said covered with no clause,
 * verified perfectly, because the digest is a statement about bytes and says nothing about whether
 * those bytes describe a packet this page could have written. A handler was told the document was
 * checked when only its hash was.
 *
 * So the shape is checked FIRST and the digest second, in the script and here. The order matters:
 * a matching digest over a malformed document is the worst of the four outcomes, because it is the
 * one that looks settled.
 *
 * IT IS THE SAME FUNCTION ON BOTH SIDES ON PURPOSE. `buildFilingPacket` calls it as a post
 * condition before it canonicalises, and the verifier calls it on a file off a handler's disk. Two
 * lists that agree today are two lists that disagree later.
 *
 * WHERE THE VOCABULARIES COME FROM. Field names come from PATCHABLE_FIELDS, the filing instant from
 * `isFilingInstant`, the pack contract from PACK_CONTRACT, and the route badges from the table this
 * module already uses to write them. Nothing here restates a rule that lives somewhere else, which
 * is why there is no second date parser and no second field list.
 *
 * IT REPORTS EVERY PROBLEM, not the first. A reader fixing one at a time against a check that
 * stopped early would walk the list one pass per problem.
 *
 * @param {*} content the `content` object of a packet
 * @returns {{ok: boolean, problems: string[]}}
 */
export function checkPacketContent(content) {
  const problems = [];
  const say = (message) => problems.push(message);

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: false, problems: [`content is ${describe(content)}, and a packet is an object.`] };
  }

  /* what document this is */
  if (content.kind !== PACKET_KIND) {
    say(`kind is ${describe(content.kind)}, and this build reads "${PACKET_KIND}".`);
  }
  if (content.version !== PACKET_VERSION) {
    say(`version is ${describe(content.version)}, and this build reads ${PACKET_VERSION}. A `
      + 'reader pinned to one version stops here rather than going on being wrong about a field '
      + 'that changed meaning.');
  }
  if (content.synthetic !== true) {
    say(`synthetic is ${describe(content.synthetic)}. Every packet this page builds is synthetic, `
      + 'and a packet that says otherwise is claiming a real filing.');
  }
  if (content.notice !== SYNTHETIC_NOTICE) {
    say('notice is not the synthetic notice this build writes, so the sentence that says no insurer '
      + 'backend is connected has been changed.');
  }
  if (!isText(content.reference)) {
    say(`reference is ${describe(content.reference)}, and a packet is referenced by a string.`);
  }

  /* the filing */
  const filed = objectAt(content, 'filed', say);
  if (filed) {
    if (!isFilingInstant(filed.at)) {
      say(`filed.at is ${describe(filed.at)}, and a filing time has to be a full UTC instant such `
        + 'as 2026-09-01T09:15:00.000Z. A time with no date and no zone is unreadable to a handler '
        + 'in another country.');
    }
    if (!Number.isInteger(filed.revision) || filed.revision < 0) {
      say(`filed.revision is ${describe(filed.revision)}, and a revision is a whole number from 0 up.`);
    }
    if (filed.through !== FILED_THROUGH) {
      say('filed.through is not the sentence this build writes, so the packet is describing a '
        + 'filing route this page does not have.');
    }
  }

  /* the policy and whose rules decided it */
  const policy = objectAt(content, 'policy', say);
  if (policy) {
    if (!isText(policy.number)) say(`policy.number is ${describe(policy.number)}, and a packet is a statement about one policy.`);
    if (!isText(policy.insurer)) say(`policy.insurer is ${describe(policy.insurer)}, and a filing happens with a named insurer.`);
    if (!isText(policy.pack_id)) say(`policy.pack_id is ${describe(policy.pack_id)}, and the packet has to say whose rules decided it.`);
    if (policy.pack_contract !== PACK_CONTRACT) {
      say(`policy.pack_contract is ${describe(policy.pack_contract)}, and this build reads `
        + `"${PACK_CONTRACT}". A pack written to another convention was read under rules that are `
        + 'not its own.');
    }
    if (policy.pack_product !== null && !isText(policy.pack_product)) {
      say(`policy.pack_product is ${describe(policy.pack_product)}, and it is a product name or null.`);
    }
    checkPeriod(policy.pack_period, say);
  }

  /* the answers, and the route each one arrived on */
  const answers = objectAt(content, 'claim', say);
  if (answers) {
    for (const [field, entry] of Object.entries(answers)) {
      if (!PATCHABLE_FIELDS.includes(field)) {
        say(`claim names ${JSON.stringify(field)}, which is not a field on this claim.`);
        continue;
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        say(`claim.${field} is ${describe(entry)}, and every answer is a label and a value.`);
        continue;
      }
      if (!isText(entry.label)) say(`claim.${field}.label is ${describe(entry.label)}.`);
      const held = entry.value;
      const usable = typeof held === 'string' || typeof held === 'number' || typeof held === 'boolean';
      if (!usable) {
        say(`claim.${field}.value is ${describe(held)}, and an answer is text, a number or a yes `
          + 'or no. An object here reads as [object Object] wherever a handler renders it.');
      }
    }
  }

  const provenance = objectAt(content, 'provenance', say);
  if (provenance && answers) {
    for (const [field, route] of Object.entries(provenance)) {
      if (!Object.hasOwn(answers, field)) {
        say(`provenance says who answered ${field}, and the packet carries no such answer.`);
      } else if (!PACKET_ROUTES.includes(route)) {
        say(`provenance says ${field} arrived ${describe(route)}, and this page writes only `
          + `${PACKET_ROUTES.join(', ')}. A route nobody defined tells a handler nothing and looks `
          + 'like it tells them something.');
      }
    }
  }

  checkNameList(content.pinned_by_the_claimant, 'pinned_by_the_claimant', PATCHABLE_FIELDS, say);

  /* the cover decision */
  if (content.coverage !== null) {
    const cover = objectAt(content, 'coverage', say);
    if (cover) checkCoverageBlock(cover, say);
  }

  /* what the intake asked for, and what answered it */
  const requirements = arrayAt(content, 'requirements', say);
  const ids = [];
  if (requirements) {
    for (const [index, entry] of requirements.entries()) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        say(`requirements[${index}] is ${describe(entry)}.`);
        continue;
      }
      if (!isText(entry.id)) say(`requirements[${index}].id is ${describe(entry.id)}.`);
      else ids.push(entry.id.trim());
      if (!isText(entry.label)) say(`requirements[${index}].label is ${describe(entry.label)}.`);
      if (typeof entry.satisfied !== 'boolean') {
        say(`requirements[${index}].satisfied is ${describe(entry.satisfied)}, and it is a yes or a no.`);
      }
      if (entry.answered_by_field !== null && !PATCHABLE_FIELDS.includes(entry.answered_by_field)) {
        say(`requirements[${index}].answered_by_field is ${describe(entry.answered_by_field)}, and `
          + 'it names a field on this claim or nothing at all.');
      }
      if (entry.answered_by_person !== null && !isText(entry.answered_by_person)) {
        say(`requirements[${index}].answered_by_person is ${describe(entry.answered_by_person)}.`);
      }
    }
  }

  // A completed action names a requirement THIS packet carries. An id from some other filing is a
  // fact about a claim the handler is not reading.
  checkNameList(content.human_actions_completed, 'human_actions_completed', ids, say);

  /* the ledger */
  const calls = arrayAt(content, 'tool_calls', say);
  if (calls) {
    for (const [index, call] of calls.entries()) {
      if (!call || typeof call !== 'object' || Array.isArray(call)) {
        say(`tool_calls[${index}] is ${describe(call)}.`);
        continue;
      }
      if (call.at !== null && !isText(call.at)) say(`tool_calls[${index}].at is ${describe(call.at)}.`);
      if (call.tool !== null && !isText(call.tool)) say(`tool_calls[${index}].tool is ${describe(call.tool)}.`);
      if (typeof call.refused !== 'boolean') {
        say(`tool_calls[${index}].refused is ${describe(call.refused)}, and it is a yes or a no.`);
      }
      if (call.code !== null && !isText(call.code)) say(`tool_calls[${index}].code is ${describe(call.code)}.`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/** A value named in a sentence a person reads, short enough to sit inside one. */
function describe(value) {
  if (typeof value === 'string' && value.length > 60) return `${JSON.stringify(value.slice(0, 57))}...`;
  if (value === undefined) return 'missing';
  if (Array.isArray(value)) return 'a list';
  if (value !== null && typeof value === 'object') return 'an object';
  return JSON.stringify(value);
}

/** A string with something in it. Whitespace alone is absence wearing a value's clothes. */
function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function objectAt(content, key, say) {
  const held = content[key];
  if (!held || typeof held !== 'object' || Array.isArray(held)) {
    say(`${key} is ${describe(held)}, and a packet carries it as an object.`);
    return null;
  }
  return held;
}

function arrayAt(content, key, say) {
  const held = content[key];
  if (!Array.isArray(held)) {
    say(`${key} is ${describe(held)}, and a packet carries it as a list.`);
    return null;
  }
  return held;
}

/** A list of names, each one from a known set, sorted and without repeats. */
function checkNameList(held, key, known, say) {
  if (!Array.isArray(held)) {
    say(`${key} is ${describe(held)}, and a packet carries it as a list.`);
    return;
  }
  for (const name of held) {
    if (!known.includes(name)) say(`${key} names ${describe(name)}, which this packet does not know.`);
  }
  const sorted = [...held].sort();
  if (held.some((name, index) => name !== sorted[index])) {
    // Order is not decoration here. The digest is over the bytes, so an unsorted list would give
    // two digests for one filing and nobody could compare two exports.
    say(`${key} is not in order, so two exports of one filing would not agree.`);
  }
  if (new Set(held).size !== held.length) say(`${key} names the same thing twice.`);
}

function checkPeriod(period, say) {
  if (period === null || period === undefined) return;
  if (typeof period !== 'object' || Array.isArray(period)) {
    say(`policy.pack_period is ${describe(period)}, and it is the period object or null.`);
    return;
  }
  if (!isCalendarDate(period.start)) say(`policy.pack_period.start is ${describe(period.start)}, and it is a YYYY-MM-DD date.`);
  if (!isCalendarDate(period.end)) say(`policy.pack_period.end is ${describe(period.end)}, and it is a YYYY-MM-DD date.`);
  if (period.clause !== undefined && period.clause !== null && !isText(period.clause)) {
    say(`policy.pack_period.clause is ${describe(period.clause)}.`);
  }
}

function checkCoverageBlock(cover, say) {
  if (typeof cover.covered !== 'boolean') say(`coverage.covered is ${describe(cover.covered)}, and it is a yes or a no.`);
  if (typeof cover.provisional !== 'boolean') say(`coverage.provisional is ${describe(cover.provisional)}, and it is a yes or a no.`);

  // THE ONE INVARIANT THAT MADE THIS BLOCK WORTH VERSIONING. A yes that is not settled has to say
  // what it is waiting on, and a settled yes has nothing hanging over it. A packet holding one
  // without the other is the shape that told a handler a flat covered on an unsettled claim.
  if (cover.provisional === true && !isText(cover.provisional_reason)) {
    say('coverage.provisional says the yes is not settled and coverage.provisional_reason does not '
      + 'say what it is waiting on.');
  }
  if (cover.provisional === false && cover.provisional_reason !== null) {
    say(`coverage.provisional_reason is ${describe(cover.provisional_reason)} on a decision that is `
      + 'not provisional.');
  }

  if (cover.clause !== null && !isText(cover.clause)) say(`coverage.clause is ${describe(cover.clause)}.`);
  if (cover.reason !== null && !isText(cover.reason)) say(`coverage.reason is ${describe(cover.reason)}.`);
  if (cover.deductible !== null && !(Number.isFinite(cover.deductible) && cover.deductible >= 0)) {
    say(`coverage.deductible is ${describe(cover.deductible)}, and an excess is a number from 0 up, or null.`);
  }
  if (cover.currency !== null && !/^[A-Z]{3}$/.test(String(cover.currency))) {
    say(`coverage.currency is ${describe(cover.currency)}, and a currency is a three letter code `
      + 'such as EUR, or null. A number beside no currency is a number a handler cannot bank.');
  }
  if (cover.deductible !== null && cover.deductible > 0 && cover.currency === null) {
    say('coverage.deductible names an amount and coverage.currency names no currency.');
  }
  if (!Array.isArray(cover.exclusions)) {
    say(`coverage.exclusions is ${describe(cover.exclusions)}, and it is a list.`);
  } else {
    for (const [index, entry] of cover.exclusions.entries()) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        say(`coverage.exclusions[${index}] is ${describe(entry)}, and an exclusion is a code, a `
          + 'clause and the sentence it is refused in.');
        continue;
      }
      if (!isText(entry.code)) say(`coverage.exclusions[${index}].code is ${describe(entry.code)}.`);
      if (entry.clause !== null && !isText(entry.clause)) say(`coverage.exclusions[${index}].clause is ${describe(entry.clause)}.`);
      if (!isText(entry.reason)) say(`coverage.exclusions[${index}].reason is ${describe(entry.reason)}.`);
    }
  }
  if (cover.covered === true && Array.isArray(cover.exclusions) && cover.exclusions.length > 0) {
    // A yes with an exclusion under it is the same defect class as a flat covered on an unsettled
    // claim: the headline says one thing and the detail says another, under one digest.
    say('coverage.covered is a yes and coverage.exclusions lists an exclusion that fired.');
  }
  if (!isText(cover.recomputed_from)) {
    say(`coverage.recomputed_from is ${describe(cover.recomputed_from)}, and it is the sentence `
      + 'saying the decision was worked out here rather than handed in.');
  }
}

/**
 * One filing refusal, said again in the packet's voice.
 *
 * The ORDER of the identity questions lives in `filingIdentity` and is not repeated here. All this
 * table does is turn the code that came back into this module's own code and its own sentence,
 * because the reader is different: the file gate is talking to somebody who wants to file, and a
 * packet refusal is explaining why no document exists. Every entry is keyed by the filing code, so
 * a new refusal added over there fails loudly here rather than quietly falling through.
 */
const PACKET_REFUSALS = {
  [FILE_CODES.noPack]: {
    code: PACKET_CODES.noPack,
    reason: () =>
      'The insurer rule pack is not loaded, so the packet cannot say which rules this claim was '
      + 'filed under, and a packet that cannot say that is worse than no packet.',
  },
  [FILE_CODES.noPolicyId]: {
    code: PACKET_CODES.noPolicyId,
    reason: () =>
      'This claim does not say which policy it is on. A packet is a statement about one policy, so '
      + 'there is nothing here to make one from, and a reference reading UNKNOWN over a null policy '
      + 'number is a hole dressed up as a filing.',
  },
  [FILE_CODES.noHomeInsurer]: {
    code: PACKET_CODES.noHomeInsurer,
    reason: () =>
      'Nothing has said which insurer this policy is with, so the packet cannot say the rules it '
      + 'was filed under were that insurer\'s. Sealing that claim under a digest would put our name '
      + 'on a guess.',
  },
  [FILE_CODES.borrowedRules]: {
    code: PACKET_CODES.borrowedRules,
    reason: (identity) =>
      `These are ${identity.insurer}'s rules, read against a policy that is not with them. `
      + 'No filing could have happened under them, so there is nothing to describe.',
  },
};

/**
 * Canonical JSON: sorted keys at every level, two space indent, LF, no undefined.
 *
 * IT LIVES IN src/core/canonical.js NOW AND IS RE-EXPORTED HERE. Two modules need the one canonical
 * writing: this one hashes it, and src/core/claim.js binds the canonical writing of a rule pack into
 * the filing receipt. claim.js cannot import this module, because the refusal table above is built at
 * top level out of keys imported from filing.js, so a cycle through here reads a binding that is
 * still evaluating. The function moved to a leaf with no imports and nothing else changed. Every
 * caller that reads `canonicalise` from this module goes on reading it from this module, and
 * tests/unit/canonicalise.test.js still enters through here.
 */
export { canonicalise };

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

/**
 * The route badge for each provenance source this page can write.
 *
 * IT IS A TABLE NOW, AND IT USED TO HAVE A FALL THROUGH. The old code returned any non-empty string
 * it was handed, so a provenance value this page never writes travelled into a sealed document and
 * a handler read it as a route. `checkClaimSnapshot` refuses such a claim before this line is
 * reached, which means the fall through closed nothing and could only ever disagree with the check
 * that does. Every key here is a value from PROVENANCE_SOURCES in src/core/claim.js, and
 * `tests/unit/packet_schema.test.js` fails if a source is added there with no badge here.
 */
const ROUTE_BY_SOURCE = {
  agent: 'via tool',
  human: 'via page',
  policy: 'policy',
  derived: 'derived',
};

/** Every route badge a packet may carry. A handler reading `provenance` sees one of these. */
export const PACKET_ROUTES = Object.freeze([...new Set(Object.values(ROUTE_BY_SOURCE))]);

/** The one sentence `filed.through` may hold, named so the schema checks it instead of trusting it. */
export const FILED_THROUGH = 'a control on the page. Filing is not exposed as a WebMCP tool.';

/**
 * Every tool this page publishes, so a ledger row naming anything else is refused rather than sealed.
 *
 * WHY THE LIST IS HERE AND NOT IMPORTED FROM src/webmcp. "src/webmcp never imports src/core/packet.js"
 * is what keeps the packet off the tool surface, and tests/unit/packet_is_not_a_tool.test.js greps for
 * it. An edge the other way would not break that rule, but it would put the module that must not be a
 * tool in the same import graph as the module that publishes tools, and the next reader would have to
 * work out which direction was the load bearing one. So this module states the list and
 * tests/unit/filing_receipt.test.js reads the tool files and fails when the two disagree, which is the
 * same arrangement `ROUTE_BY_SOURCE` above has with PROVENANCE_SOURCES in src/core/claim.js.
 *
 * FILING IS NOT ON IT, AND THAT IS THE POINT. There is no `file_claim`, no packet tool, no dispatch,
 * no pin and no unlock, because none of those is a tool on this page.
 *
 * THE SURFACE HAS TWO HALVES AND THIS LIST HELD ONLY ONE OF THEM. WebMCP has an imperative half,
 * one descriptor per file under src/webmcp/tools, and a declarative half, a `toolname` attribute on
 * a form in index.html. This list named the nine imperative tools and stopped, so the tenth name on
 * the surface, `record_supporting_details`, read here as a tool the page does not publish. An agent
 * calling the form and a person then pressing File this claim produced no packet at all: the row
 * the page writes to the ledger for that call was refused as an invented name, on the one journey a
 * caller driving both halves of the API is most likely to take. Measured through the booted page
 * before this line was added, on a claim filed after one agent submission of the declarative form:
 *
 *   file-result  : "Filed via the page at 2026-09-02T16:17:58.172Z. Filing is not exposed as a WebMCP tool."
 *   packet hidden: true
 *   field-error  : "The ledger names \"record_supporting_details\", which this page does not publish as a tool."
 *
 * The name was always on the published surface. What was wrong was this list, which claims to be
 * that surface, so adding it corrects a short list rather than widening a check.
 *
 * BOTH HALVES ARE READ BACK BY THE CROSS CHECK, which is the only reason this stated list can be
 * trusted. tests/unit/filing_receipt.test.js reads the tool descriptors under src/webmcp/tools AND
 * every `toolname=` attribute in index.html, the command docs/architecture.md names for the second
 * half, and fails when the union disagrees with what is written here. It also fails if the
 * declarative half reads as empty, because a list assembled from one source is how this defect
 * arrived. docs/architecture.md says the same thing about counting files in that directory: it does
 * not count the whole published surface.
 */
export const PUBLISHED_TOOL_NAMES = Object.freeze([
  'apply_claim_patch',
  'check_coverage',
  'describe_claim',
  'get_assistance_options',
  'get_repair_estimate',
  'get_requirements',
  'read_claim_state',
  'read_evidence_notes',
  // The declarative half. Nothing registers it: the browser builds it from the four attributes on
  // the form in index.html, and src/ui/app.js writes it to the ledger under FORM_TOOL_NAME when an
  // agent submits it. It is not imported from src/webmcp for the reason stated above.
  'record_supporting_details',
  'validate_claim',
]);

/**
 * The tool a ledger row names, or null when it names nothing.
 *
 * TWO SHAPES REACH THIS, AND THE FALL THROUGH IS LOAD BEARING. src/ui/app.js writes a row as
 * `{ at, name, args, text, error, refusals }`, and the packet's own output and every fixture in the
 * tests write `{ at, tool, refused, code }`. Both are read here so that a control built out of a
 * real page row and a control built out of a packet row exercise the same line.
 *
 * NULL IS THE ANSWER FOR EVERYTHING THAT IS NOT A NAME, not just for a missing key. A number, an
 * object, an empty string and a string of spaces all name no tool, and the whole point of this
 * function is that the caller cannot be handed a value it then has to guess about. The value is
 * returned untrimmed, because trimming here would quietly accept " read_claim_state " as a name
 * this page publishes, and it does not publish that.
 */
function nameOnRow(entry) {
  const raw = entry.tool ?? entry.name;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/**
 * The refusal code on a ledger row, or null if the row records no refusal.
 *
 * THE PAGE AND THE PACKET WROTE REFUSALS IN DIFFERENT WORDS AND ONLY ONE OF THEM WAS READ. A row
 * off src/ui/app.js carries `refusals`, the list the page collects while a call is on the stack,
 * and `error` for a call that threw. It carries no `refused` and no `code` at all, so a real page
 * row that the page had refused sealed as `refused: false, code: null`: a document stating under a
 * digest that a call the page turned down went through. Measured on the booted page, an agent
 * submission of the declarative form with no baseRevision was refused with PATCH_REJECTED_STALE and
 * its row carries that code inside `refusals` and nowhere else.
 */
function refusalCodeOnRow(entry) {
  if (typeof entry.code === 'string' && entry.code.trim() !== '') return entry.code;
  const refusals = Array.isArray(entry.refusals) ? entry.refusals : [];
  const first = refusals.find((one) => one && typeof one.code === 'string' && one.code.trim() !== '');
  return first ? first.code : null;
}

/**
 * Every refusal code this build publishes, from the four registries that publish them.
 *
 * A CODE THIS PAGE NEVER WROTE READ AS A MACHINE STATEMENT ABOUT THE CLAIM. `refusalCodeOnRow`
 * returned whatever non empty string the caller put there, the mapping copied it into the packet
 * unchecked, and `packetAsMarkdown` printed it. Measured before this list existed:
 *
 *   sealed  : [{"at":"09:13:41","tool":"check_coverage","refused":true,
 *               "code":"INSURER_APPROVED_PAYOUT_EUR_4200"}]
 *   markdown: - 09:13:41 check_coverage REFUSED INSURER_APPROVED_PAYOUT_EUR_4200
 *
 * A forged time reads as junk. That reads as this page having been told the insurer approved a
 * payout, under a digest, in the document a handler works from. The tool NAME was already held to
 * the published surface and the code was held to nothing, which is the same question asked of one
 * half of the row and not the other.
 *
 * IT IS THE UNION OF THE FOUR AND NOT A LIST WRITTEN HERE, so a code added to any of them is
 * accepted the day it is added and a fifth registry is a compile time import rather than a silent
 * gap. `tests/unit/packet_seals_the_filing.test.js` holds the count against the four registries
 * read separately, so a registry dropped from this import fails there rather than here.
 */
const PUBLISHED_REFUSAL_CODES = Object.freeze(new Set([
  ...Object.values(PATCH_CODES),
  ...Object.values(FILE_CODES),
  ...Object.values(PACKET_CODES),
  ...Object.values(OPTIONAL_NOTE_CODES),
]));

/**
 * The two shapes a ledger row on this page is written in, and every key each one carries.
 *
 * THE SAME TWO SHAPES `nameOnRow` AND `refusalCodeOnRow` ALREADY READ, stated once so the reading
 * and the checking cannot come to different views of what a row is. src/ui/app.js writes the first
 * at both of the two places it ledgers a call, and this module's own output writes the second, which
 * is what a fixture, a round trip through `scripts/verify_packet.mjs` and a packet off a disk all
 * carry.
 *
 * A ROW BELONGS TO ONE SHAPE OR IT IS REFUSED, and that is what catches a row carrying a key nobody
 * published as well as a row mixing keys from both. Mixing matters because neither writer produces
 * it, so a row wearing `tool` beside `refusals` was assembled by somebody rather than ledgered here.
 *
 * IT IS A SUBSET RULE AND NOT AN EQUALITY, DELIBERATELY. A row is refused for carrying a key that
 * belongs to no shape, never for leaving one out. The defect is foreignness: this module cannot say
 * a row it did not write is a call that happened, and a key nobody publishes is the plainest sign
 * that the row came from somewhere else. Incompleteness is a different thing and is already handled
 * further down, where a missing `refused` reads as no refusal and a missing name is refused by
 * `nameOnRow`. Equality would also refuse `{ at, tool }`, which is a row the packet's own tests hand
 * in, so demanding it would be this check inventing a rule the page never followed.
 */
const LEDGER_ROW_SHAPES = Object.freeze([
  Object.freeze({
    what: 'the one src/ui/app.js writes',
    keys: Object.freeze(['at', 'name', 'args', 'text', 'error', 'refusals']),
  }),
  Object.freeze({
    what: 'the one this module writes',
    keys: Object.freeze(['at', 'tool', 'refused', 'code']),
  }),
]);

/**
 * The keys on a row that belong to no shape this page writes, or an empty list where it fits one.
 *
 * Where a row fits nothing, the keys are reported against whichever shape it strayed from least, so
 * the sentence names the keys that actually strayed rather than every key of the shape that lost.
 */
function foreignKeysOn(entry) {
  const held = Object.keys(entry);
  let closest = null;
  for (const shape of LEDGER_ROW_SHAPES) {
    const strange = held.filter((key) => !shape.keys.includes(key));
    if (strange.length === 0) return [];
    if (closest === null || strange.length < closest.length) closest = strange;
  }
  return closest;
}

/**
 * Is this a time a ledger row on this page is written with.
 *
 * TWO SHAPES, AND THE SECOND ONE IS THE PAGE'S OWN. src/core/claim.js refuses anything but a full
 * UTC instant for a FILING time, because a handler in another country reads that one. A ledger row
 * is not that: src/ui/app.js writes it with `clockNow`, which is `toTimeString().slice(0, 8)`, a
 * local wall clock reading such as "19:15:31", and the comment beside it says why the two are split
 * on purpose. A packet the page builds carries those readings straight through, and so does
 * docs/handler-packet.example.json. So requiring an instant here would have refused every row this
 * page has ever written and taken the packet panel down with it, which is why this states the two
 * shapes the page actually produces rather than the one that would read better.
 *
 * THE WALL CLOCK READING IS RANGE CHECKED, NOT PATTERN MATCHED. Three pairs of digits accepts
 * "99:99:99", which is no more a time than "not-a-time" is, and a check that only caught the
 * example in the report would be the wrong half of the fix.
 *
 * WHAT THIS CANNOT DO. It says the value is shaped like a time this page writes. It does not say
 * this page wrote it, and no check on a caller supplied row can. See the header of this module.
 */
function isLedgerTime(value) {
  if (isFilingInstant(value)) return true;
  if (typeof value !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes, seconds] = value.split(':').map(Number);
  return hours <= 23 && minutes <= 59 && seconds <= 59;
}

/** The route an answer arrived on, in the two words the page uses everywhere else. */
function routeOf(claim, field) {
  const source = claim.provenance && claim.provenance[field];
  return Object.hasOwn(ROUTE_BY_SOURCE, source) ? ROUTE_BY_SOURCE[source] : null;
}

/**
 * Build the packet for a filed claim.
 *
 * @param {object} input
 * @param {object} input.claim the filed claim
 * @param {object|null} input.pack the insurer rule pack the filing was decided under
 * @param {(string|null)} [input.homePackId] whose policy this is, as the page states it. Leave it
 * out and no packet is built: it is one of the four identity facts a packet asserts, not a hint.
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

  // FIRST, IS THIS A CLAIM THIS PAGE COULD HAVE WRITTEN. EVERY OTHER QUESTION ASSUMES IT IS.
  //
  // The refusals below all ask whether the filing could have happened. None of them looks at what
  // the claim holds, and neither does `validateClaim` further down, which only reports empty
  // required fields. So a claim marked filed by hand, carrying `severity: "catastrophic"` or an
  // object where the claimant's account belongs, was sealed here: the fields block copies held
  // values straight into the document and the digest went over them, which is the one thing that
  // makes a wrong value look checked. A packet is the surface a handler acts on, so it is the
  // surface that can least afford to describe a claim nobody can answer for.
  //
  // The same function the file gate asks, so the two cannot come to different views of what a
  // usable claim is.
  const snapshot = checkClaimSnapshot(claim);
  if (!snapshot.ok) {
    return refuse(
      PACKET_CODES.unusableState,
      `${snapshot.reason} A packet is sealed under a digest, and a digest over a value nobody `
      + 'could have written makes it look checked.',
    );
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

  // THE SAME IDENTITY QUESTIONS THE FILE GATE ASKS, FROM THE SAME FUNCTION, IN THE SAME ORDER.
  //
  // This block used to ask two of the four in its own words and never ask the other two, so a
  // packet described filings the gate would have refused: a draft carrying no policy number was
  // sealed as `CR-UNKNOWN-R2` with a null policy number under it, and a claim filed with nobody
  // having said which insurer the policy is with was sealed under whichever pack was loaded.
  //
  // It cannot call `canFile`, because a filed claim short circuits that on ALREADY_FILED by design.
  // So it calls the identity half directly, and translates the filing code into this module's own
  // vocabulary rather than keeping a second opinion about the order the questions come in.
  const identity = filingIdentity(settings.pack, claim, { homePackId: settings.homePackId });
  if (identity.refusal) {
    const translated = PACKET_REFUSALS[identity.refusal.code];
    return refuse(translated.code, translated.reason(identity));
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

  // AND LAST, DID THIS FILING ACTUALLY HAPPEN HERE, AND IS THIS WHAT IT HAPPENED UNDER.
  //
  // Everything above asks whether a filing COULD have happened: whose rules, which policy, whose
  // insurer, what the intake still wanted. None of them looks at whether one DID, and `status` is
  // an ordinary string on an ordinary object, so a caller writing two bookkeeping values by hand
  // got the whole document. Measured before this block existed, from a draft that had never been
  // through the file gate:
  //
  //   packet ok   : true
  //   reference   : CR-MTR-2026-0417-R4
  //   filed at    : 2026-09-01T09:15:00.000Z
  //   through     : a control on the page. Filing is not exposed as a WebMCP tool.
  //
  // AND THE HALF THAT STAYED OPEN AFTER THAT. The receipt attested the claim and nothing else, so
  // the pack, the home pack id and the completed human actions on THIS call were still believed.
  // A pack loaded from the shipped Northwind file with the insurer, the clause and the excess
  // edited and the id left alone is separately valid, and every identity check in this repository
  // compares ids, so it walked straight through. Measured against a claim filed under Northwind
  // Mutual, clause OD-4.1, excess 250:
  //
  //   COUNTERFEIT PACKET ok: true code: null
  //   sealed coverage: {"covered":true,"clause":"ALT-9.9","deductible":999, ...}
  //   INJECTED ok: true human_actions_completed: ["date_of_loss","roadside_collection"]
  //
  // `content.filed.through` is the sentence the first half makes true, and the policy block, the
  // coverage block and `human_actions_completed` are the sentences the second half makes true.
  // `verifyFilingContext` reads a WeakMap that only `fileClaim` writes to, and src/core/claim.js
  // states what that receipt is worth and what it is not: it is a browser local demonstration, so
  // it shows this code path ran in this session and shows nothing whatever to a reader holding the
  // exported file.
  //
  // IT IS ASKED LAST ON PURPOSE. A claim missing its policy number is better told that than told
  // it was never filed, so the specific diagnosis goes first and this catches what is left, which
  // is precisely the claim that would otherwise have been sealed.
  //
  // THE NO RECEIPT CASE KEEPS ITS OWN CODE AND ITS OWN SENTENCE, because it is a different thing
  // to be told. One says no filing happened. The other says a filing happened and this is not what
  // it happened under, which is the more alarming of the two and should not be read as the first.
  const attested = verifyFilingContext(claim, {
    pack,
    homePackId: settings.homePackId,
    completedHumanActions: done,
  });
  if (!attested.ok && attested.mismatch === FILING_CONTEXT_MISMATCHES.noReceipt) {
    return refuse(
      PACKET_CODES.notFiledHere,
      'This claim was not filed through the control on this page. It carries a filed status, and a '
      + 'status is something anybody can write, so the packet has nothing to describe. A copy of a '
      + 'filed claim reads the same way, because a copy was assembled rather than filed.',
    );
  }
  if (!attested.ok) {
    return refuse(
      PACKET_CODES.notTheFilingContext,
      `${attested.reason} The packet describes one filing as it happened, so it is built from what `
      + 'that filing was decided under and not from what a later caller offers.',
    );
  }

  // THE REVISION THE FILING LANDED ON, TAKEN FROM THE FILING AND NEVER OFF THE CLAIM IN FRONT OF US.
  //
  // A filed claim goes on moving its counter. `noteContextChange` hands back a copy with the number
  // advanced and the receipt carried across, and that is deliberate: loading another insurer's rules
  // changes what every read tool answers, so the number an agent quotes has to move. The verdict a
  // few lines above accepts that copy, and it is right to, because a counter that has moved FORWARD
  // is not a substitution. Nothing here was reading the filing, though. It read `claim.revision`,
  // which is the counter as it stands now. Measured on this tree, filing at revision 4 and then
  // dispatching two context changes:
  //
  //   reference : CR-MTR-2026-0417-R6
  //   filed     : {"at":"2026-09-01T09:15:00.000Z","revision":6, ...}
  //   >>> filing happened at revision 4 <<<
  //
  // So the block whose whole job is to say when the filing happened said it happened at a revision
  // it did not happen at, under a digest, which is the one thing that makes a wrong value look
  // checked. `filed.at` was right the whole time, because `verifyFilingContext` compares it against
  // the record and no packet is built until it matches. The revision had no such source until
  // `filedRevisionOf` gave it one.
  //
  // TWO WAYS WERE OPEN AND THIS IS THE ONE THAT WAS TAKEN. The other was to refuse to build at all
  // once the live claim is no longer the exact filing. It would close the same hole and it would
  // cost more than it closes: src/core/claim.js states at `verifyFilingContext` that a counter moved
  // forward is a legitimate thing this page does, and refusing it would put back the defect measured
  // at `noteContextChange`, where the page went on saying `status: "filed"` while refusing to
  // describe the filing it had just performed. So the packet is built from the filing instead.
  //
  // THE RULE THE BLOCK BELOW KEEPS: no field in `content` reads `claim.revision`. Read the filing
  // revision from this binding, which has exactly one source, and add nothing that reads the live
  // counter beside it. tests/unit/packet_seals_the_filing.test.js walks the built packet for every
  // field carrying a revision or a reference, so a field added later is held to this without
  // anybody remembering to add a case for it.
  const filedRevision = filedRevisionOf(claim);

  // THE LEDGER IS THE ONE INPUT THAT CANNOT BE BOUND, SO IT IS CHECKED INSTEAD.
  //
  // It goes on collecting after the filing, which is right: a page that stopped recording tool
  // calls at the moment of filing would be hiding the calls a handler most wants to see. So there
  // is nothing to compare it against, and it was believed row for row. Measured on the same run as
  // the substitutions above:
  //
  //   LEDGER ok: true tool_calls: [{"at":"...","tool":"file_claim","refused":false,"code":null}]
  //
  // `file_claim` is not a tool. Filing is a control on the page and deliberately has no tool, which
  // is a claim this project makes in its README, in the packet's own `filed.through` sentence and
  // in tests/unit/packet_is_not_a_tool.test.js. A sealed row saying it ran and was not refused
  // contradicts all three, under a digest.
  //
  // The row is refused rather than dropped. Dropping it would seal a document that is true and
  // quietly shorter than the ledger the caller handed in, and a handler comparing the two would
  // have no way to find out which rows went missing.
  //
  // AND A ROW THAT NAMES NOTHING IS REFUSED TOO, WHICH THE NAME CHECK ON ITS OWN COULD NOT DO. The
  // filter above only ever inspected values that were already strings, so everything else fell out
  // of it and was sealed. Measured before this block, on a real filed claim:
  //
  //   {"at":"...","refused":false,"code":null}             ok: true  sealed {"tool":null,...}
  //   {"at":"...","tool":null,"refused":false,"code":null} ok: true  sealed {"tool":null,...}
  //
  // `{"tool":null}` under a digest tells a handler an agent made a call and gives them nothing to
  // look it up by, which is worse than the missing row it stands in for, because the digest makes
  // it look checked. So a row either names a tool this page publishes or the packet refuses.
  //
  // NOTHING THAT WAS REFUSED BECOMES ACCEPTED BY THIS. Two shapes that used to be caught late are
  // now caught here and named properly instead: `tool: 42` reached PACKET_REFUSED_MALFORMED off the
  // schema at the bottom of the build, and `tool: ""` reached PACKET_REFUSED_UNKNOWN_TOOL with an
  // empty pair of quotes in the sentence.
  // AND THE ROW THAT WAS NOT A ROW WENT OUT SILENTLY, WHICH THIS LINE USED TO DO ITSELF. The filter
  // here read `entry && typeof entry === 'object'` and threw away everything else without a word, so
  // a null, a number or a bare string handed in on the ledger simply was not in the packet.
  // Measured on this tree, two rows handed in and one of them a null:
  //
  //   non-object row ok = true code = null | handed in 2, sealed 1
  //
  // That is the same defect the two refusals below exist to stop, committed by the line that was
  // meant to prepare their input, and the sentence six lines down says so in its own words: a
  // shorter ledger than the one handed in is a record a handler cannot tell has lost anything. So
  // nothing is dropped here any more. Every row the caller handed in either reaches the packet or
  // the packet refuses and says which row and why.
  // AND THE CONTAINER IS THE SAME DEFECT AS THE ROW, ONE LINE HIGHER UP.
  //
  // This read `Array.isArray(settings.ledger) ? settings.ledger : []`, so a ledger that was not an
  // array became no calls at all, silently, which is the shortest ledger there is and exactly what
  // the sentence above forbids. Measured before this branch:
  //
  //   ledger = "two rows as a string"                     ok=true code=null sealed rows=0
  //   ledger = 42                                         ok=true code=null sealed rows=0
  //   ledger = {"0": {...}, "length": 1}                   ok=true code=null sealed rows=0
  //   ledger = new Set([{ at, tool, refused, code }])      ok=true code=null sealed rows=0
  //
  // The Set is the sharp one: a caller holding real calls in the wrong container was told the
  // packet had described them. An absent ledger is a different thing and stays legal, because most
  // callers have no ledger to offer and the page's own tests hand none in.
  if (settings.ledger !== undefined && settings.ledger !== null && !Array.isArray(settings.ledger)) {
    return refuse(
      PACKET_CODES.unusableCall,
      `The ledger handed in is ${describe(settings.ledger)} rather than a list of calls. A packet `
      + 'lists the calls an agent made against this page, and a container this module cannot read '
      + 'row by row would be sealed as no calls at all, which tells a handler that nothing was '
      + 'called. Hand in a list, or hand in nothing.',
    );
  }
  const ledger = Array.isArray(settings.ledger) ? settings.ledger : [];

  const unusable = ledger
    .map((entry, index) => ({ entry, index }))
    .filter((row) => !row.entry || typeof row.entry !== 'object' || Array.isArray(row.entry));
  if (unusable.length > 0) {
    return refuse(
      PACKET_CODES.unusableCall,
      `${unusable.length} of the ${ledger.length} rows on the ledger are not calls at all: `
      + `${unusable.map((row) => `row ${row.index} is ${describe(row.entry)}`).join(', ')}. A row `
      + 'carries a tool name, a time and whether the page refused it, and none of those can be read '
      + 'off that. It is refused rather than dropped, because a ledger quietly shorter than the one '
      + 'handed in is a record a handler cannot tell has lost anything.',
    );
  }

  const rows = ledger;

  const nameless = rows.filter((entry) => nameOnRow(entry) === null);
  if (nameless.length > 0) {
    return refuse(
      PACKET_CODES.namelessCall,
      `${nameless.length} of the ${rows.length} rows on the ledger name no tool at all. A packet `
      + 'carries the tool calls its caller hands in for this filing, and a call with no name is not '
      + 'one a handler can look up or this page can stand behind. The row is refused rather than dropped, '
      // THE WORD HERE IS "record" AND NOT "document", AND THAT IS THE READINESS GATE, NOT TASTE.
      // checkCorePurity in scripts/readiness.mjs matches its banned word list against the source
      // with comments stripped and STRING LITERALS LEFT IN, so an ordinary English "document"
      // inside a refusal sentence reads to it as src/core reaching for the browser. It failed that
      // way once, on this exact line: PUR intact FAIL, "packet.js uses document", which also broke
      // the gate's own selftest. The gate was not loosened to accept the sentence, a day out from a
      // deadline, so the sentence gives way instead. Every refusal string in src/core has to avoid
      // document, window, navigator, fetch and the timer names as plain English words.
      + 'for the same reason the row below it is: a shorter ledger than the one handed in is a '
      + 'record a handler cannot tell has lost anything.',
    );
  }

  const invented = rows
    .map((entry) => nameOnRow(entry))
    .filter((name) => !PUBLISHED_TOOL_NAMES.includes(name));
  if (invented.length > 0) {
    return refuse(
      PACKET_CODES.unknownTool,
      `The ledger names ${[...new Set(invented)].map((name) => `"${name}"`).join(', ')}, which this `
      + 'page does not publish as a tool. A packet carries the tool calls its caller hands in for '
      + 'this filing, so a call to something that was never on the surface is not one this page can '
      + 'describe.',
    );
  }

  // A ROW THIS PAGE NEVER WROTE, WEARING THE NAME OF A TOOL IT DOES PUBLISH. The two checks above
  // read the name and stopped, so everything else on the row went unlooked at. Measured on this
  // tree, one row naming a real tool with one key invented on the end:
  //
  //   foreign key row ok = true code = null
  //
  // Nothing of that key reached the packet, because the block further down copies four fields by
  // name. That is the reason it is worth refusing rather than the reason it is not: a row carrying a
  // key neither writer produces did not come off this page's ledger, and the block it is going into
  // is the one block in the packet this module cannot work out for itself. See LEDGER_ROW_SHAPES for
  // why this is a subset rule and not an equality.
  const strange = rows
    .map((entry, index) => ({ index, keys: foreignKeysOn(entry) }))
    .filter((row) => row.keys.length > 0);
  if (strange.length > 0) {
    return refuse(
      PACKET_CODES.foreignCallKey,
      `${strange.length} of the ${rows.length} rows on the ledger carry keys this page never writes `
      + `on a call: ${strange.map((row) => `row ${row.index} carries `
        + `${row.keys.map((key) => JSON.stringify(key)).join(', ')}`).join('; ')}. A row on this `
      + `ledger is written in one of two shapes, ${LEDGER_ROW_SHAPES.map((shape) => shape.what).join(' or ')}`
      + ', and a row belonging to neither was assembled by somebody rather than recorded here.',
    );
  }

  // A TIME THAT IS NOT A TIME, SEALED BESIDE A SUCCESSFUL CALL TO A REAL TOOL. `at` was any string
  // with something in it, and nothing else was ever asked of it. Measured on this tree:
  //
  //   forged row ok = true code = null
  //     sealed tool_calls: [{"at":"not-a-time","tool":"check_coverage","refused":false,"code":null}]
  //
  // A handler reading that is told when a call happened by a value that cannot be ordered, compared
  // or converted, with a digest over it. The two shapes this page writes are stated at
  // `isLedgerTime`, and a row is refused for holding anything else, a missing time included: every
  // row src/ui/app.js writes carries one, so a row without one is not one of them.
  const untimed = rows
    .map((entry, index) => ({ index, at: entry.at }))
    .filter((row) => !isLedgerTime(row.at));
  if (untimed.length > 0) {
    return refuse(
      PACKET_CODES.callTime,
      `${untimed.length} of the ${rows.length} rows on the ledger say they happened at a value that `
      + `is not a time: ${untimed.map((row) => `row ${row.index} at ${describe(row.at)}`).join(', ')}`
      + '. This page writes a call time either as a wall clock reading such as "19:15:31" or as a '
      + 'full UTC instant such as 2026-09-01T09:15:00.000Z, and anything else tells a handler when a '
      + 'call happened in a form nobody can order, compare or convert.',
    );
  }

  // THE OTHER THREE HALVES OF THE ROW, ASKED THE SAME QUESTION THE NAME AND THE TIME ARE ASKED.
  //
  // The name was held to the published surface and the time to two stated forms. These three were
  // held to nothing, and each fails in its own direction. Measured before this block:
  //
  //   refusals as a string     handed in a row the caller marked refused, with the code inside a
  //                            string rather than a list. Sealed as refused: false, code: null. The
  //                            exact failure `refusalCodeOnRow` above exists to stop, one shape to
  //                            the left: a call the page turned down, sealed as one that went
  //                            through.
  //   refused: 'no'            sealed as refused: true. It errs safe and the sealed row is still
  //                            not the row handed in, and nothing said so.
  //   code: 'INSURER_APPROVED_PAYOUT_EUR_4200'
  //                            sealed verbatim and rendered into the handler's markdown.
  //
  // A list is required rather than tolerated because `refusalCodeOnRow` reads it as one, and a
  // boolean is required rather than coerced because a document under a digest has to hold the value
  // it was given or say it refused it.
  const malformedRefusals = rows
    .map((entry, index) => ({ index, value: entry.refusals }))
    .filter((row) => row.value !== undefined && !Array.isArray(row.value));
  if (malformedRefusals.length > 0) {
    return refuse(
      PACKET_CODES.unusableCall,
      `${malformedRefusals.length} of the ${rows.length} rows on the ledger carry a refusals value `
      + `that is not a list: ${malformedRefusals.map((row) => `row ${row.index} carries `
        + `${describe(row.value)}`).join(', ')}. The page writes the refusals it collected while a `
      + 'call was on the stack as a list, and anything else is read as no refusals at all, which '
      + 'seals a call this page turned down as one that went through.',
    );
  }

  const badFlags = rows
    .map((entry, index) => ({ index, refused: entry.refused, error: entry.error }))
    .filter((row) => (row.refused !== undefined && typeof row.refused !== 'boolean')
      || (row.error !== undefined && typeof row.error !== 'boolean'));
  if (badFlags.length > 0) {
    return refuse(
      PACKET_CODES.unusableCall,
      `${badFlags.length} of the ${rows.length} rows on the ledger say whether the call was refused `
      + `in something other than true or false: ${badFlags.map((row) => `row ${row.index} carries `
        + `refused ${describe(row.refused)} and error ${describe(row.error)}`).join('; ')}. Reading `
      + 'those as truthy would seal a row that is not the row handed in.',
    );
  }

  const inventedCodes = rows
    .map((entry, index) => ({ index, code: refusalCodeOnRow(entry) }))
    .filter((row) => row.code !== null && !PUBLISHED_REFUSAL_CODES.has(row.code));
  if (inventedCodes.length > 0) {
    return refuse(
      PACKET_CODES.unknownRefusalCode,
      `${inventedCodes.length} of the ${rows.length} rows on the ledger name a refusal this build never `
      + `publishes: ${inventedCodes.map((row) => `row ${row.index} names `
        + `${JSON.stringify(row.code)}`).join(', ')}. A code in this block is printed to a handler as `
      + 'something this page decided, so a string nobody here can produce would read as a statement '
      + 'about the claim that no part of this build ever made.',
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

  // THE COMPLETED ACTIONS ARE SCOPED TO THE REQUIREMENTS THIS PACKET CARRIES.
  //
  // The page accumulates the buttons a person has pressed and never forgets one, which is right for
  // the page: pressing Request roadside assistance happened, whatever the draft says afterwards. It
  // is wrong for this document. A claim filed with the car drivable derives no collection
  // requirement, so a packet listing `roadside_collection` under human actions would be telling a
  // handler about a step for a requirement the same packet does not carry, three lines further up.
  // Scoping it means the two lists cannot disagree, and it is what lets the schema check the ids
  // against something rather than waving any string through.
  const known = new Set(requirements.map((entry) => entry.id));
  const offered = Array.isArray(done) ? done : [...(done || [])];
  const actions = [...new Set(offered.filter((id) => known.has(id)))].sort();

  // THE SAME TWO READERS THE REFUSALS ABOVE USED, so the row that was checked is the row that is
  // sealed. `error` counts as a refusal here because the alternative is sealing `refused: false` on
  // a call the page recorded as having thrown, and a handler reading that is told it succeeded.
  const calls = rows
    .map((entry) => {
      const code = refusalCodeOnRow(entry);
      return {
        at: entry.at ?? null,
        tool: nameOnRow(entry),
        refused: Boolean(entry.refused) || Boolean(entry.error) || code !== null,
        code,
      };
    })
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
  //
  // AND A YES THAT IS NOT SETTLED YET SAYS SO. Recomputing was only half of it. The decision has
  // carried `provisional` since the panel learned to draw "Covered, provisionally", and this block
  // dropped it, so the one surface with a digest on it was the one telling a handler a flat
  // `covered` on a claim whose yes still depended on a name or a date nobody had given. The page
  // said one thing, the tool said the same thing, and the sealed document said the friendlier half.
  // Both fields are here now: the boolean for a reader that branches, and the sentence for a reader
  // that has to act on it. `provisional_reason` repeats words that are also inside `reason`, and
  // that is deliberate. `reason` is prose written for a claimant, and a handler system reading the
  // open question out of it would be scraping.
  //
  // A true `provisional` with an empty reason beside it cannot happen, and it is worth saying so
  // rather than guarding against it. checkCoverage sets `provisional` from whether that same list
  // of open questions is empty, so the two come from one call in one module. A defensive branch
  // here would only ever hide a real defect over there.
  const decided = checkCoverage(pack, claim);
  const coverage = decided
    ? {
      covered: Boolean(decided.covered),
      provisional: Boolean(decided.provisional),
      provisional_reason: decided.provisional ? openCoverQuestions(pack, claim).join(' ') : null,
      clause: decided.clause ?? null,
      deductible: decided.deductible ?? null,
      currency: decided.currency ?? pack.currency ?? null,
      reason: decided.reason ?? null,
      // EACH EXCLUSION IS COPIED FIELD BY FIELD, AND THE LIST IS NOT SORTED.
      //
      // This used to read `[...decided.exclusions].sort()`, which looks like it makes the order
      // stable and does nothing at all: these are objects, the default comparator turns every one
      // of them into the string "[object Object]", and a stable sort then leaves them where they
      // were. The order is already fixed, because src/core/coverage.js builds the list by walking
      // EXCLUSION_ORDER, so two exports of one filing agree without any sorting here.
      //
      // Naming the three fields rather than spreading the object is the other half. A key added to
      // an exclusion over there would otherwise walk straight into a sealed document that nobody
      // had decided to publish, and the schema below would be describing a shape that had moved.
      exclusions: (Array.isArray(decided.exclusions) ? decided.exclusions : [])
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          code: entry.code ?? null,
          clause: entry.clause ?? null,
          reason: entry.reason ?? null,
        })),
      recomputed_from: 'the filed claim and the loaded rule pack, not from the page',
    }
    : null;

  const content = {
    kind: PACKET_KIND,
    version: PACKET_VERSION,
    synthetic: true,
    notice: SYNTHETIC_NOTICE,
    reference: claim.reference
      ? `${claim.reference}-R${filedRevision}`
      : `CR-${claim.policy_id || 'UNKNOWN'}-R${filedRevision}`,
    filed: {
      at: claim.filed_at ?? null,
      revision: filedRevision,
      through: FILED_THROUGH,
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

  // THE POST CONDITION, AND IT IS THE SAME FUNCTION THE VERIFIER RUNS ON A HANDLER'S DISK.
  //
  // Everything above is built from checked inputs, so on the ordinary path this passes by
  // construction and closes nothing on its own. It is here for two reasons. It means a document
  // this module emits and a document `scripts/verify_packet.mjs` accepts are the same set, checked
  // by one function rather than two lists that agree today. And it fails at the moment a change to
  // the block above starts writing a shape the schema does not describe, which is cheaper than
  // finding out from a handler holding the file.
  const shape = checkPacketContent(content);
  if (!shape.ok) {
    return refuse(
      PACKET_CODES.malformed,
      `This packet was built and does not describe a filing this page could have written. `
      + `${shape.problems.join(' ')} Nothing is offered to hash, because a digest over that would `
      + 'only make it look checked.',
    );
  }

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
    // The same three words the panel and the tool use. A handler reading the markdown rather than
    // the JSON was the last reader still being told a flat yes on an unsettled claim.
    const provisional = content.coverage.covered && content.coverage.provisional === true;
    row('Decision', content.coverage.covered
      ? (provisional ? 'covered, provisionally' : 'covered')
      : 'not covered');
    if (provisional && content.coverage.provisional_reason) {
      row('Still open', content.coverage.provisional_reason);
    }
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
  lines.push('');
  // A HANDLER HOLDING THIS DOES NOT HOLD THE REPOSITORY. The line above is the only route this
  // document used to offer, and it asks a stranger to fetch our code and run it, which is us
  // marking our own work. The page it now names is a specification of the canonical form with two
  // routes written from it, so the check survives being separated from us.
  lines.push('Or with no copy of this repository at all. `docs/handler-verification.md` states the '
    + 'canonical form in five rules and gives a plain Node route and a plain Python route that '
    + 'recompute the digest from those rules, importing nothing from here.');
  return `${lines.join('\n')}\n`;
}
