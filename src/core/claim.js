/**
 * Claim draft model for the ClaimReady FNOL page.
 *
 * PURE MODULE. No DOM, no browser globals, no network, no timers, no I/O.
 * It runs unchanged under `node --test` and inside a page as an ES module.
 *
 * Everything here returns plain data. The WebMCP tools layer is responsible for
 * turning that data into tool output. Core never builds an MCP envelope.
 *
 * THE CLAIM IS THE SHARED STATE. A person on the page and a visitor's agent both
 * write to the same object, so the object itself has to carry who wrote what and
 * how many times it has moved:
 *
 *   revision    a counter that advances by exactly one on every accepted change
 *   provenance  { field: 'agent' | 'human' | 'policy' | 'derived' }
 *   locked      field names a person pinned, which no patch may move
 *   status      'draft' or 'filed'
 *
 * An agent patch must name the revision it read. If a person edited the page in
 * between, the revision has moved and the patch is refused as stale, with both
 * numbers in the message. That refusal is the point: it is what makes a shared
 * draft safe to write to from two sides at once.
 *
 * THE COUNTER VERSIONS THE ANSWERS, NOT ONLY THE FIELDS. It already moved for
 * things that touch no field at all: pinning, unpinning, filing and reloading the
 * draft. It has to, because each of those changes what a reader would be told
 * next. Two more things do that and used to be invisible here, so an agent could
 * quote a number it had read before either of them and still be accepted:
 *
 *   - the insurer rule pack the page is reading against. Switch it and the cover
 *     clauses, the excesses and the whole intake list change.
 *   - a human action carried out on the page, such as asking for a roadside
 *     collection, which closes a requirement no patch from either side can close.
 *
 * Neither is a claim field, and neither belongs on the claim. `noteContextChange`
 * is how the page says one of them happened: it moves the counter and nothing
 * else, so a patch quoting the earlier number is refused for the same reason and
 * with the same code as one written before a human edit. The guarantee is
 * therefore about the whole answering context and not only the draft, and every
 * surface that describes it says so.
 *
 * Treat every claim object as immutable. Every function here returns a new claim
 * on success and hands back the original, untouched, on failure.
 *
 * FILING IS DECIDED IN filing.js AND NOWHERE ELSE. `fileClaim` below asks `canFile`
 * and refuses on what it answers, so the insurer's derived requirements reach the
 * domain action rather than stopping at the page. See the import cycle note in
 * filing.js before adding anything to the top level of this module that reads it.
 */

import { canFile, FILE_CODES } from './filing.js';

/** Incident categories a claim may declare. Also the enum for the tool schema. */
export const INCIDENT_TYPES = ['collision', 'theft', 'glass', 'weather', 'fire', 'vandalism'];

/** Damage severity, ordered from lightest to heaviest. The order is meaningful. */
export const SEVERITIES = ['scratch', 'dent', 'structural'];

/** Impact position as a clock face. 12 is straight ahead, 3 is the right side. */
export const DAMAGE_ZONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Plain language name for each clock position, so the UI and the tools agree. */
export const ZONE_LABELS = {
  1: 'front right corner',
  2: 'right front wing',
  3: 'right side',
  4: 'right rear wing',
  5: 'rear right corner',
  6: 'rear centre',
  7: 'rear left corner',
  8: 'left rear wing',
  9: 'left side',
  10: 'left front wing',
  11: 'front left corner',
  12: 'front centre',
};

/**
 * How to say each field out loud.
 *
 * `validateClaim().missing` returns machine names, because the tools layer needs
 * those exact strings for its input schema. Anything a person or an agent reads
 * aloud should come through here instead, so the page captions, the spoken
 * summary and the agent all use the same words.
 */
export const FIELD_LABELS = {
  incident_date: 'the date it happened',
  incident_type: 'what kind of incident it was',
  damage_zone: 'where the impact was',
  severity: 'how bad the damage is',
  vehicle_drivable: 'whether the car still drives',
  description: 'your account of what happened',
  driver: 'who was driving',
  location: 'where it happened',
  police_report_ref: 'the police report reference',
  witness_name: 'the name of the witness',
};

/**
 * Every field a claim can be asked for before it is filed.
 *
 * THIS IS THE STATIC LIST, AND IT IS NOT THE ANSWER TO "what does this claim
 * need". Three things genuinely want a fixed list: the input schema of the one
 * writing tool, the group of rows the page builds, and PATCHABLE_FIELDS below.
 * What a PARTICULAR claim must answer is `requiredFieldsFor(claim)`, which is
 * narrower, because one of these is conditional. Read that, never this, when the
 * question is whether a field is missing.
 */
export const REQUIRED_FIELDS = [
  'incident_date',
  'incident_type',
  'damage_zone',
  'severity',
  'vehicle_drivable',
  'description',
];

/**
 * The fields on the static list that are only asked for under a condition, with
 * the condition written once.
 *
 * damage_zone is here because a stolen car has no impact position. Both shipped
 * rule packs say so in their own words, with `"when": {"field": "incident_type",
 * "not_equals": "theft"}` on the impact position rule, and validateClaim below
 * warns when a theft claim carries a zone anyway. Before this existed, the page
 * demanded a clock position on a theft claim, refused to clear it with
 * PATCH_REJECTED_VALUE, warned about it being there, and disagreed with the
 * insurer's own published rule, all at once.
 *
 * tests/unit/requirements.test.js checks this against every shipped pack: for
 * each field a pack names, the pack asking for it and this list requiring it
 * have to give the same answer on the same claim.
 */
const CONDITIONALLY_REQUIRED = {
  damage_zone: (claim) => claim.incident_type !== 'theft',
};

/**
 * The fields THIS claim has to answer before it can be filed.
 *
 * One source of truth for "is this field missing". validateClaim, the file gate
 * and the refusal that stops a required field being cleared all read it, so the
 * three can never disagree with one another.
 *
 * @param {object} claim
 * @returns {string[]} a subset of REQUIRED_FIELDS, in the same order
 */
export function requiredFieldsFor(claim) {
  const source = claim && typeof claim === 'object' ? claim : {};
  return REQUIRED_FIELDS.filter((field) => {
    const condition = CONDITIONALLY_REQUIRED[field];
    return condition ? condition(source) === true : true;
  });
}

/** Useful but not blocking. These may be set back to null to clear them. */
export const OPTIONAL_FIELDS = ['driver', 'location', 'police_report_ref', 'witness_name'];

/** Every field `applyPatch` will accept. Anything else is rejected by name. */
export const PATCHABLE_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

/** Bookkeeping the claim carries that no patch may ever write, from either side. */
export const PROTECTED_STORED_FIELDS = [
  'policy_id',
  'reference',
  'status',
  'filed_at',
  'revision',
  'provenance',
  'locked',
  'evidence_notes',
];

/**
 * Names that are computed from the claim rather than stored on it. Nobody may
 * patch them either, and naming them explicitly means an agent that tries gets
 * "this is derived" instead of the vaguer "no such field".
 */
export const DERIVED_NAMES = [
  'requirements',
  'validation',
  'ready',
  'missing',
  'warnings',
  'coverage',
  'covered',
  'deductible',
  'estimate',
];

/** Everything a patch refuses to touch, whoever is asking. */
export const PROTECTED_FIELDS = [...PROTECTED_STORED_FIELDS, ...DERIVED_NAMES];

/**
 * Kept as an alias because the earlier model called this set read only. Same
 * list, one name for it, so no reader has to work out which is authoritative.
 */
export const READ_ONLY_FIELDS = PROTECTED_FIELDS;

/** Who a patch may claim to be. 'policy' and 'derived' are set by core alone. */
export const ACTORS = ['human', 'agent'];

/** Every value that can appear in `claim.provenance`. */
export const PROVENANCE_SOURCES = ['human', 'agent', 'policy', 'derived'];

/**
 * The refusal vocabulary. These strings are part of the published contract in
 * docs/claim-intake.v1.json, so a model can branch on the code and a reader can
 * grep for it. Five codes, no more: anything a patch refuses is one of these.
 */
export const PATCH_CODES = {
  stale: 'PATCH_REJECTED_STALE',
  locked: 'PATCH_REJECTED_LOCKED',
  protected: 'PATCH_REJECTED_PROTECTED',
  field: 'PATCH_REJECTED_FIELD',
  value: 'PATCH_REJECTED_VALUE',
};

/** Character caps. The tools layer should mirror these in its input schema. */
export const DESCRIPTION_MAX_LENGTH = 240;
export const DRIVER_MAX_LENGTH = 80;
export const LOCATION_MAX_LENGTH = 120;
export const POLICE_REF_MAX_LENGTH = 40;
export const WITNESS_MAX_LENGTH = 80;

/** `describeClaim` never returns a string longer than this. */
export const DESCRIBE_MAX_LENGTH = 1200;

const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

const BOOLEAN_TRUE = ['true', 'yes'];
const BOOLEAN_FALSE = ['false', 'no'];

/** Enough of the protected list to be useful in a refusal, without a wall of text. */
const PROTECTED_IN_MESSAGES = 'policy facts, the validation result, revision, provenance, locked and status';

/**
 * Whether this is a real day on the calendar, written the one way this build writes a date.
 *
 * EXPORTED BECAUSE A SECOND READER NEEDS THE SAME GRAMMAR AND MUST NOT WRITE ITS OWN. A rule pack
 * states a policy period as two dates, and src/core/coverage.js decides whether a loss falls inside
 * that period by comparing the strings: `date >= start && date <= end`. That comparison is only
 * chronological while every one of the three is YYYY-MM-DD, so the loader in src/core/policy.js has
 * to hold a pack's period to the same shape the claim's own date is held to. One function, two
 * callers, no copy to drift.
 *
 * THE YEAR WINDOW IS NOT PART OF THIS, ON PURPOSE. A claim on this page happens between 2000 and
 * 2099, which is a fact about the claim and not about the calendar. A policy period that starts
 * before 2000 is still two dates that compare correctly against a claim date inside the window, so
 * refusing it would be this build inventing a rule the schedule never agreed to. isIsoDate below
 * adds the window back for the field that genuinely has one.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Whether a claim on this page could carry this as its incident date.
 *
 * The calendar test above plus the window this build works in. It is the incident_date validator
 * below, and it is exported for the same reason isCalendarDate is: src/core/policy.js refuses a rule
 * pack that compares incident_date against a value no claim could ever hold, and the only honest
 * answer to "could a claim hold this" is the function the claim itself uses.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isIsoDate(value) {
  if (!isCalendarDate(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

function textField(label, maxLength) {
  return (value) => {
    if (typeof value !== 'string') {
      return { ok: false, error: `${label} must be text.` };
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: `${label} cannot be empty.` };
    }
    if (trimmed.length > maxLength) {
      return {
        ok: false,
        error: `${label} is ${trimmed.length} characters, the limit is ${maxLength}.`,
      };
    }
    return { ok: true, value: trimmed };
  };
}

function enumField(label, allowed) {
  return (value) => {
    if (typeof value !== 'string') {
      return { ok: false, error: `${label} must be one of: ${allowed.join(', ')}.` };
    }
    const normalised = value.trim().toLowerCase();
    if (!allowed.includes(normalised)) {
      return {
        ok: false,
        error: `"${value}" is not a valid ${label}. Use one of: ${allowed.join(', ')}.`,
      };
    }
    return { ok: true, value: normalised };
  };
}

/**
 * Per field coercion and validation.
 *
 * Agents send strings, because a WebMCP input schema most often types a value as
 * a string. So numeric strings and the four boolean words are coerced here, in
 * one place, and nowhere else. The tools layer must not add a second path.
 */
const VALIDATORS = {
  incident_date: (value) => {
    if (!isIsoDate(value)) {
      return {
        ok: false,
        error: 'incident_date must be a real calendar date written as YYYY-MM-DD.',
      };
    }
    return { ok: true, value };
  },

  incident_type: enumField('incident type', INCIDENT_TYPES),

  severity: enumField('severity', SEVERITIES),

  damage_zone: (value) => {
    const asNumber = typeof value === 'string' ? Number(value.trim()) : value;
    if (typeof asNumber !== 'number' || !Number.isInteger(asNumber)) {
      return {
        ok: false,
        error: 'damage_zone must be a whole clock position from 1 to 12.',
      };
    }
    if (!DAMAGE_ZONES.includes(asNumber)) {
      return {
        ok: false,
        error: `damage_zone ${asNumber} is out of range. Use a clock position from 1 to 12.`,
      };
    }
    return { ok: true, value: asNumber };
  },

  vehicle_drivable: (value) => {
    if (typeof value === 'boolean') return { ok: true, value };
    if (typeof value === 'string') {
      const word = value.trim().toLowerCase();
      if (BOOLEAN_TRUE.includes(word)) return { ok: true, value: true };
      if (BOOLEAN_FALSE.includes(word)) return { ok: true, value: false };
    }
    return {
      ok: false,
      error: 'vehicle_drivable must be true or false.',
    };
  },

  description: textField('description', DESCRIPTION_MAX_LENGTH),
  driver: textField('driver', DRIVER_MAX_LENGTH),
  location: textField('location', LOCATION_MAX_LENGTH),
  police_report_ref: textField('police_report_ref', POLICE_REF_MAX_LENGTH),
  witness_name: textField('witness_name', WITNESS_MAX_LENGTH),
};

/**
 * THE ONE SHAPE A FILING TIME TAKES, ANYWHERE IN THIS PROJECT.
 *
 * A full ISO-8601 instant in UTC, to the millisecond, which is exactly what
 * `new Date().toISOString()` writes. Nothing else is accepted through either door into this state:
 * `fileClaim` refuses a caller that hands in something else, and `hydrateClaim` refuses a stored
 * claim that carries something else.
 *
 * WHY THIS SHAPE AND NOT A FRIENDLIER ONE. The page used to hand `fileClaim` a local wall clock
 * reading, "19:15:31", and that string travelled untouched into the claim, into the sentence under
 * the File button, and into the sealed packet a handler receives, under a digest. So a handler in
 * another country was given a time with no date on it and no zone on it, sealed as though somebody
 * had checked it. A partial reading cannot be compared, ordered or converted, and those are the
 * only three things anyone ever does with a filing time.
 *
 * AN OFFSET IS REFUSED TOO, not only a missing one. "09:30:00.000Z" and "11:30:00.000+02:00" are
 * the same moment written two ways, and the digest is over the bytes rather than over the moment.
 * One shape means two exports of one filing agree, which is the whole promise of the digest.
 */
const FILING_INSTANT_EXAMPLE = '2026-09-01T09:15:00.000Z';

const FILING_INSTANT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Said wherever a filing time is refused, so every surface refuses it in the same words. */
const FILING_INSTANT_REASON =
  `a filing time is a full UTC instant like ${FILING_INSTANT_EXAMPLE}`;

/**
 * Is this a filing time this project is willing to write down.
 *
 * THE ROUND TRIP THROUGH Date IS THE LOAD BEARING HALF. The pattern on its own accepts
 * "2026-02-30T09:30:00.000Z", a day that does not exist, and a claim sealed as filed on it would
 * carry a date nobody can act on. Parsing it and asking for the same string back is what closes
 * that, and it costs one allocation on a path that runs once per filing.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isFilingInstant(value) {
  if (typeof value !== 'string' || !FILING_INSTANT_SHAPE.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/* --------------------------------------------------------------- internals */

function emptyClaim() {
  const claim = {
    policy_id: null,
    reference: null,
    status: 'draft',
    filed_at: null,
    revision: 0,
    provenance: {},
    locked: [],
    evidence_notes: [],
  };
  for (const field of PATCHABLE_FIELDS) claim[field] = null;
  return claim;
}

/** A shallow copy that never shares the two containers a caller could mutate. */
function copyClaim(claim) {
  return {
    ...claim,
    provenance: { ...claim.provenance },
    locked: [...claim.locked],
    evidence_notes: [...claim.evidence_notes],
  };
}

function currentRevision(claim) {
  return Number.isInteger(claim.revision) ? claim.revision : 0;
}

function lockedList(claim) {
  return Array.isArray(claim.locked) ? claim.locked : [];
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim().length === 0;
}

/**
 * One evidence note, normalised and kept verbatim.
 *
 * The text is never parsed, never matched against a pattern and never acted on.
 * A note is third party content: it belongs to whoever uploaded it, and the only
 * thing this app does with it is hand it back exactly as it arrived.
 */
function normaliseNote(note, index) {
  const source = note && typeof note === 'object' ? note : {};
  return {
    id: typeof source.id === 'string' ? source.id : `note-${index + 1}`,
    author: typeof source.author === 'string' ? source.author : 'unknown',
    received_at: typeof source.received_at === 'string' ? source.received_at : null,
    text: typeof source.text === 'string' ? source.text : '',
  };
}

function normaliseNotes(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normaliseNote);
}

/** The single validation path. `applyPatch` and `createClaim` both go through it. */
function coerceField(field, value) {
  return VALIDATORS[field](value);
}

/* ------------------------------------------------------------------ create */

/**
 * Build a claim from a fixture.
 *
 * Accepts either the whole parsed fixture (an object with `policy` and `claim`)
 * or a single scenario object (an object with `claim`), or a flat seed of claim
 * fields. Every seed value is pushed through the same validators a patch uses,
 * so a typo or a bad value in the fixture throws here instead of silently
 * leaving a field missing for the rest of the app.
 *
 * A field that arrives from the fixture is attributed to 'policy': the insurer's
 * own page put it there, neither the claimant nor an agent did. The new claim is
 * at revision 0, because seeding is not a change anyone made.
 *
 * @param {object} [fixture]
 * @returns {object} a new claim
 * @throws {TypeError} when a seed field is unknown or its value is invalid
 */
export function createClaim(fixture) {
  const source = fixture && typeof fixture === 'object' ? fixture : {};

  // Two shapes are allowed. A fixture or scenario carries the draft under a
  // `claim` key, next to `policy` and other bookkeeping that is not claim data.
  // Anything else is read as a flat seed of claim fields, where an unrecognised
  // key is a mistake worth throwing over.
  const isWrapper = 'claim' in source || 'policy' in source;
  const seed = isWrapper && source.claim && typeof source.claim === 'object' ? source.claim : {};
  const flat = isWrapper ? seed : source;

  const claim = emptyClaim();
  claim.policy_id = source.policy?.id ?? flat.policy_id ?? null;
  claim.reference = flat.reference ?? null;
  claim.evidence_notes = normaliseNotes(flat.evidence_notes ?? source.evidence_notes);

  for (const [field, value] of Object.entries(flat)) {
    if (PROTECTED_FIELDS.includes(field)) continue;
    if (value === null || value === undefined) continue;
    if (!PATCHABLE_FIELDS.includes(field)) {
      throw new TypeError(
        `Fixture claim field "${field}" is not usable: "${field}" is not a field on this claim.`,
      );
    }
    const checked = coerceField(field, value);
    if (!checked.ok) {
      throw new TypeError(`Fixture claim field "${field}" is not usable: ${checked.error}`);
    }
    claim[field] = checked.value;
    claim.provenance[field] = 'policy';
  }

  return claim;
}

/**
 * Take an object that is already claim shaped and read it back as a claim, or refuse it.
 *
 * Used when a store is handed a claim rather than a fixture. A claim written
 * before the revision counter existed, or one that came back through JSON, still
 * has to satisfy every invariant the rest of core relies on.
 *
 * IT USED TO FILL IN THE GAPS AND TRUST THE REST. `{ ...emptyClaim(), ...value }` put whatever the
 * stored object held straight onto the claim: a severity of "banana", a damage_zone of 47, an
 * incident_date of "yesterday", a key that is not a field at all. `createClaim` pushes every seed
 * value through the same validators a patch uses and throws on a bad one, and there was no reason
 * for the other door into the same state to be the unchecked one. Everything downstream, the
 * requirements list, the coverage decision, the sealed handler packet, reads these values and
 * cannot tell a validated one from a stored one.
 *
 * So this is now the same door: every patchable field goes through `coerceField`, an unknown key
 * throws with the field named, and a provenance badge survives only when its source is one this
 * model knows and the field it is about actually holds a value.
 *
 * AND THE BOOKKEEPING IS HELD TO THE SAME STANDARD, which took a second pass. The revision, the
 * status, the pins and the filing time are not claim answers, they are what decides whether a later
 * writer is allowed to do anything, and every one of them used to be repaired in silence into the
 * more permissive reading. `storedRevision`, `storedStatus`, `storedLocks` and `storedFilingTime`
 * refuse instead, and the reasoning is written out above them.
 *
 * @param {object} value
 * @returns {object} a complete, normalised claim
 * @throws {TypeError} when a stored field is unknown, when its value is invalid, or when the
 *         claim as a whole is not one this page could have written
 */
export function hydrateClaim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hydrateClaim needs a claim object.');
  }

  const claim = emptyClaim();

  // Protected fields first, because the patchable ones are checked against the same rules a patch
  // uses and those rules do not describe a status or a revision. These four have rules of their
  // own, a few lines further down, and the shape of all four is the same: a missing value takes the
  // documented default, a present one that this model would never have written is refused.
  claim.policy_id = optionalString(value.policy_id, 'policy_id');
  claim.reference = optionalString(value.reference, 'reference');
  claim.revision = storedRevision(value.revision);
  claim.status = storedStatus(value.status);
  claim.filed_at = storedFilingTime(value.filed_at);
  claim.evidence_notes = normaliseNotes(value.evidence_notes);
  claim.locked = storedLocks(value.locked);

  // A FILED CLAIM WITH NO FILING TIME IS REFUSED. IT USED TO BE READ BACK AS A DRAFT.
  //
  // The two lines that stood here said `claim.status = 'draft'` on a stored claim marked filed that
  // carried no instant, and then blanked the instant on anything not marked filed. The reasoning
  // was that a filing with no time on it is indistinguishable from a draft, which is true about the
  // timestamp and false about the state. Filed is the closed state on this page: it is what stops a
  // patch, stops a second filing and stops the claimant's own answers being edited under a
  // reference a handler already has. Reading it back as a draft reopens all three, silently, on a
  // claim somebody stored. Measured before this changed, on a stored claim at revision 7:
  //
  //   stored status  : filed  filed_at: null
  //   hydrated status: draft  filed_at: null
  //   patch ok       : true   Something else entirely.
  //
  // An agent patch went straight through. That is the rule the block below `storedRevision` states
  // in capitals, broken by the one value that block did not cover, so the refusal now lives with
  // the rest of them in `checkClaimSnapshot`.
  //
  // WHAT THIS DOOR STILL DOES REPAIR, said here rather than left to be discovered. The provenance
  // loop below drops a badge whose source this model does not know, a badge over a field holding
  // nothing, and a badge naming a field that is not on the claim. That is a repair, and an earlier
  // version of this comment claimed the door repaired nothing, which a reviewer read twenty lines
  // above three `continue` statements doing exactly that. Dropping an unusable badge is safe in the
  // direction that matters, because it removes a claim about where a value came from rather than
  // inventing one, and `checkClaimSnapshot` refuses the same snapshot at every gate that decides
  // something. A lock is treated the other way and refused outright, because dropping a lock opens
  // a field the claimant closed.

  for (const [field, held] of Object.entries(value)) {
    if (PROTECTED_FIELDS.includes(field)) continue;
    if (!PATCHABLE_FIELDS.includes(field)) {
      throw new TypeError(
        `Stored claim field "${field}" is not usable: "${field}" is not a field on this claim.`,
      );
    }
    if (held === null || held === undefined) continue;
    const checked = coerceField(field, held);
    if (!checked.ok) {
      throw new TypeError(`Stored claim field "${field}" is not usable: ${checked.error}`);
    }
    claim[field] = checked.value;
  }

  // Provenance is a claim about who put a value there, so it is held to the same standard as the
  // value: a source has to be one this model knows, and it has to be about a field that exists and
  // that actually holds something. A badge over an empty field is a claim with nothing behind it.
  const held = value.provenance && typeof value.provenance === 'object' && !Array.isArray(value.provenance)
    ? value.provenance
    : {};
  for (const [field, source] of Object.entries(held)) {
    if (!PATCHABLE_FIELDS.includes(field)) continue;
    if (!PROVENANCE_SOURCES.includes(source)) continue;
    if (claim[field] === null || claim[field] === undefined) continue;
    claim.provenance[field] = source;
  }

  // THE POST-CONDITION, AND IT IS DELIBERATELY THE SAME FUNCTION THE FILE GATE ASKS.
  //
  // Everything above already refuses field by field, so on the ordinary path this passes by
  // construction and closes nothing on its own. Two things make it worth the call. It is where the
  // filed-with-no-time state is now refused, because nothing above looks at status and filed_at
  // together. And it means a claim that came back through this door and a claim the file gate will
  // accept are the same set, checked by one function, rather than two lists that agree today.
  const snapshot = checkClaimSnapshot(claim);
  if (!snapshot.ok) {
    throw new TypeError(`This stored claim cannot be read back. ${snapshot.problems.join(' ')}`);
  }

  return claim;
}

/**
 * THE FOUR STORED VALUES THAT ARE NOT ANSWERS, AND THE RULE THEY ARE ALL READ UNDER.
 *
 * Revision, status, locked and filed_at are bookkeeping. Nobody types them. They decide what a
 * later writer is allowed to do: how many times this draft has moved, whether it is still open,
 * which fields a person pinned, and when it went in. Every one of them used to be repaired in
 * silence. A revision of "17" became 0, a status of "archived" became draft, a lock on a name this
 * model does not know was filtered out of the list, and a filing time could be any string at all.
 *
 * SECURITY RELEVANT PERSISTED STATE MUST NEVER SILENTLY RESET INTO A MORE PERMISSIVE STATE, and
 * every one of those repairs did exactly that. A counter reset to 0 makes a patch quoting a stale
 * revision look current, which is the one check that makes a draft safe to write to from two sides.
 * A lock dropped from the list makes a field the claimant pinned writable again by an agent. A
 * status that is not one of the two this model knows became the open one. None of them refused, and
 * a caller could not tell a repaired claim from a clean one, because the only difference was a
 * value that was no longer there.
 *
 * ABSENT IS NOT THE SAME AS PRESENT AND WRONG. A claim written before the revision counter existed
 * carries no revision at all, and opening it at 0 with an empty lock list is the documented way to
 * read an older draft. That is a gap, and the default fills it. A value somebody stored that this
 * model would never have written is not a gap. It is either a corrupted write or a forged one, and
 * the only safe answer to both is to refuse the whole claim by name.
 */
function storedRevision(held) {
  if (held === null || held === undefined) return 0;
  if (!Number.isInteger(held) || held < 0) {
    throw new TypeError(
      'Stored claim field "revision" is not usable: it must be a whole number of zero or more, '
      + `and it is ${JSON.stringify(held)}.`,
    );
  }
  return held;
}

function storedStatus(held) {
  if (held === null || held === undefined) return 'draft';
  if (held !== 'draft' && held !== 'filed') {
    throw new TypeError(
      'Stored claim field "status" is not usable: it must be "draft" or "filed", '
      + `and it is ${JSON.stringify(held)}.`,
    );
  }
  return held;
}

function storedFilingTime(held) {
  if (held === null || held === undefined) return null;
  if (!isFilingInstant(held)) {
    throw new TypeError(
      `Stored claim field "filed_at" is not usable: ${FILING_INSTANT_REASON}, `
      + `and it is ${JSON.stringify(held)}.`,
    );
  }
  return held;
}

/**
 * The pins, refused rather than filtered.
 *
 * A duplicate is refused too. Nothing this model writes produces one, so a list holding the same
 * field twice is a list something else built, and silently collapsing it would hide that.
 */
function storedLocks(held) {
  if (held === null || held === undefined) return [];
  if (!Array.isArray(held)) {
    throw new TypeError(
      'Stored claim field "locked" is not usable: it must be a list of field names, '
      + `and it is ${typeof held}.`,
    );
  }
  const locks = [];
  for (const field of held) {
    if (!PATCHABLE_FIELDS.includes(field)) {
      throw new TypeError(
        `Stored claim field "locked" is not usable: ${JSON.stringify(field)} is not a field a `
        + 'person can pin.',
      );
    }
    if (locks.includes(field)) {
      throw new TypeError(
        `Stored claim field "locked" is not usable: ${JSON.stringify(field)} is pinned twice.`,
      );
    }
    locks.push(field);
  }
  return locks;
}

/** A stored string field, or null. Anything else is a stored claim we cannot answer for. */
function optionalString(held, field) {
  if (held === null || held === undefined) return null;
  if (typeof held !== 'string') {
    throw new TypeError(
      `Stored claim field "${field}" is not usable: it must be a string or null, `
      + `and it is ${typeof held}.`,
    );
  }
  return held;
}

/* ---------------------------------------------------------- whole snapshot */

/**
 * Said first whenever a claim is refused for what it holds rather than for what it lacks.
 *
 * Named once so the file gate, the handler packet and the stored claim reader all open the same
 * way, and so a reader who meets the sentence twice knows it is one check talking.
 */
export const UNUSABLE_STATE_INTRO =
  'This claim holds values this page could not have written, so no decision can be taken on it.';

/** Every problem is one sentence, and the verdict is those sentences with the opener in front. */
function snapshotVerdict(problems) {
  return {
    ok: problems.length === 0,
    problems,
    reason: problems.length === 0 ? null : `${UNUSABLE_STATE_INTRO} ${problems.join(' ')}`,
  };
}

/** The two strings that say which policy this is and what this page calls the claim. */
const IDENTITY_STRINGS = ['policy_id', 'reference'];

/**
 * IS THIS WHOLE CLAIM ONE THIS PAGE COULD HAVE WRITTEN.
 *
 * WHY IT EXISTS. `validateClaim` answers one question, "which required field is empty", and it was
 * being read as though it answered a second one. It does not look at a single held value. So a
 * claim carrying `severity: "catastrophic"`, `damage_zone: 47`, an incident date of "yesterday",
 * `vehicle_drivable: "maybe"` or an object where the claimant's own account belongs passed the file
 * gate, filed, and was sealed into a handler packet under a digest. Measured before this existed,
 * on a claim built through the real patch path and then written to by hand:
 *
 *   unknown severity                canFile=true fileClaim=true packet=SEALED
 *   damage_zone out of range        canFile=true fileClaim=true packet=SEALED
 *   object where free text belongs  canFile=true fileClaim=true packet=SEALED ... {}
 *   negative revision               canFile=true fileClaim=true packet=SEALED ref=CR-...-R-4
 *
 * The last two are the ones worth reading twice. A handler was handed an empty JSON object under
 * the heading a claimant's account of the crash goes under, and a reference with a negative
 * revision in it, both under a digest that made them look checked.
 *
 * WHAT IT CHECKS, AND WHY IT IS ONE FUNCTION RATHER THAN THREE. Every patchable field against the
 * same validator a patch uses, the two identity strings, the revision, the status, the pins, the
 * provenance vocabulary and the filing time. Three surfaces need this answer, `canFile`,
 * `buildFilingPacket` and `hydrateClaim`, and three copies of it would be three chances to disagree
 * about what a usable claim is. That is the defect src/core/filing.js was written to close, one
 * input further out.
 *
 * ABSENT IS NOT WRONG. A field nobody has answered yet holds null, and this says nothing about it:
 * "which field is still empty" is `validateClaim`'s question and the file gate already asks it. A
 * draft halfway through being filled in has to pass here, or the ordinary journey stops.
 *
 * A HELD VALUE HAS TO BE IN THE FORM THIS PAGE WRITES, not merely one the validators could repair.
 * `damage_zone: "10"` and `severity: "DENT"` are values a patch accepts and coerces on the way in,
 * so a claim still carrying them was never written by a patch. Everything downstream compares and
 * seals these values exactly as they are.
 *
 * @param {*} claim
 * @returns {{ok: boolean, problems: string[], reason: (string|null)}}
 */
export function checkClaimSnapshot(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    return snapshotVerdict([
      `A claim is an object, and this is ${Array.isArray(claim) ? 'a list' : typeof claim}.`,
    ]);
  }

  const problems = [];

  for (const field of PATCHABLE_FIELDS) {
    const held = claim[field];
    if (held === null || held === undefined) continue;
    const checked = coerceField(field, held);
    if (!checked.ok) {
      problems.push(`${field}: ${checked.error}`);
    } else if (checked.value !== held) {
      problems.push(
        `${field} holds ${JSON.stringify(held)}, and this page writes that answer as `
        + `${JSON.stringify(checked.value)}.`,
      );
    }
  }

  for (const field of IDENTITY_STRINGS) {
    const held = claim[field];
    if (held === null || held === undefined) continue;
    if (typeof held !== 'string') {
      problems.push(`${field} must be a string or null, and it is ${typeof held}.`);
    }
  }

  // The revision is the number a patch quotes back to prove it is writing to the draft it read, and
  // it is written into the packet reference. A missing one sealed the reference CR-MTR-2026-0417-Rundefined.
  if (!Number.isInteger(claim.revision) || claim.revision < 0) {
    problems.push(
      `revision is ${JSON.stringify(claim.revision ?? null)}, and it must be a whole number of `
      + 'zero or more.',
    );
  }

  // Status and the filing time are read together, because each of them says what the other must
  // hold. A claim marked filed with no instant on it is a closed state nobody can answer for, and a
  // claim marked draft that carries one is the same slide running the other way.
  const status = claim.status;
  if (status !== 'draft' && status !== 'filed') {
    problems.push(
      `status is ${JSON.stringify(status ?? null)}, and a claim is either "draft" or "filed".`,
    );
  } else if (status === 'filed' && !isFilingInstant(claim.filed_at)) {
    problems.push(
      `this claim is marked filed and its filing time is ${JSON.stringify(claim.filed_at ?? null)}, `
      + `and ${FILING_INSTANT_REASON}.`,
    );
  } else if (status === 'draft' && claim.filed_at !== null && claim.filed_at !== undefined) {
    problems.push(
      `this claim is marked draft and carries a filing time, ${JSON.stringify(claim.filed_at)}.`,
    );
  }

  const locked = claim.locked;
  if (locked !== null && locked !== undefined) {
    if (!Array.isArray(locked)) {
      problems.push(`locked must be a list of field names, and it is ${typeof locked}.`);
    } else {
      const seen = [];
      for (const field of locked) {
        if (!PATCHABLE_FIELDS.includes(field)) {
          problems.push(`${JSON.stringify(field)} is pinned, and it is not a field a person can pin.`);
        } else if (seen.includes(field)) {
          problems.push(`${JSON.stringify(field)} is pinned twice.`);
        } else {
          seen.push(field);
        }
      }
    }
  }

  // A badge is a claim about who put a value there, so it is held to the standard the value is.
  const badges = claim.provenance;
  if (badges !== null && badges !== undefined) {
    if (typeof badges !== 'object' || Array.isArray(badges)) {
      problems.push(`provenance must be an object of field names, and it is ${typeof badges}.`);
    } else {
      for (const [field, source] of Object.entries(badges)) {
        if (!PATCHABLE_FIELDS.includes(field)) {
          problems.push(`provenance names ${JSON.stringify(field)}, which is not a field on this claim.`);
        } else if (!PROVENANCE_SOURCES.includes(source)) {
          problems.push(
            `provenance says ${field} came from ${JSON.stringify(source)}, and this page writes `
            + `only ${PROVENANCE_SOURCES.join(', ')}.`,
          );
        } else if (claim[field] === null || claim[field] === undefined) {
          problems.push(`provenance says who answered ${field}, and ${field} holds nothing.`);
        }
      }
    }
  }

  return snapshotVerdict(problems);
}

/* ------------------------------------------------------------------- patch */

function refusal(claim, code, error) {
  return { claim, ok: false, error, code, applied: [], revision: currentRevision(claim) };
}

/**
 * Accept one change, an array of changes, or nothing usable.
 * @returns {{ok: true, list: Array}|{ok: false, error: string}}
 */
function normaliseChanges(changes) {
  const list = Array.isArray(changes) ? changes : [changes];

  if (list.length === 0) {
    return { ok: false, error: 'A patch has to carry at least one change. Send { field, value } or an array of them.' };
  }

  const seen = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false,
        error: `Every change must be an object shaped { field, value }. Received ${JSON.stringify(entry ?? null)}.`,
      };
    }
    if (typeof entry.field !== 'string' || entry.field.trim().length === 0) {
      return {
        ok: false,
        error: `Every change must name a field as a string. Received ${JSON.stringify(entry.field ?? null)}.`,
      };
    }
    const field = entry.field.trim();
    if (seen.includes(field)) {
      return {
        ok: false,
        error: `"${field}" appears twice in one patch. Name each field once, with the value you want it to end at.`,
      };
    }
    seen.push(field);
  }

  return { ok: true, list: list.map((entry) => ({ field: entry.field.trim(), value: entry.value })) };
}

function staleRefusal(claim, actor, baseRevision) {
  const revision = currentRevision(claim);

  if (baseRevision === null || baseRevision === undefined) {
    if (actor === 'agent') {
      return (
        `An agent patch has to carry baseRevision, and this one carried none. The claim is at revision ${revision}. ` +
        `Read the claim state again, then send the patch with baseRevision ${revision}.`
      );
    }
    return null;
  }

  const asNumber = typeof baseRevision === 'string' ? Number(baseRevision.trim()) : baseRevision;
  if (!Number.isInteger(asNumber) || asNumber < 0) {
    return (
      `baseRevision must be the whole number you read off the claim, and ${JSON.stringify(baseRevision)} is not one. ` +
      `The claim is at revision ${revision}.`
    );
  }

  if (asNumber !== revision) {
    return (
      `expected revision ${asNumber}, current revision ${revision}. ` +
      'Read the claim state again before patching: the draft, or the rules answering for it, moved after you read it, and what is on the page now wins until you have seen it.'
    );
  }

  return null;
}

/**
 * Apply a set of changes to a claim, all of them or none of them.
 *
 * ATOMIC. Every change is validated before any change is stored. If one is
 * refused, nothing is written and the revision does not move, so a partly
 * applied batch can never exist for anyone to read.
 *
 * REVISION GUARDED. `baseRevision` is the revision the caller last read. It is
 * optional for a person editing the page, because a person is looking at the
 * thing they are editing. It is required for an agent, which is not: an agent
 * patch with no baseRevision is refused as stale and told to read state first.
 *
 * On success the revision advances by exactly one, however many fields the
 * patch carried, and every field it wrote is attributed to the actor.
 *
 * @param {object} claim
 * @param {{field: string, value: *}|Array<{field: string, value: *}>} changes
 * @param {{actor?: 'human'|'agent', baseRevision?: (number|string|null)}} [options]
 * @returns {{claim: object, ok: boolean, error: (string|null), code: (string|null),
 *            applied: string[], revision: number}}
 */
export function applyPatch(claim, changes, options = {}) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('applyPatch needs a claim object.');
  }

  const settings = options && typeof options === 'object' ? options : {};
  const actor = settings.actor === undefined ? 'human' : settings.actor;
  const baseRevision = settings.baseRevision === undefined ? null : settings.baseRevision;

  if (!ACTORS.includes(actor)) {
    return refusal(
      claim,
      PATCH_CODES.value,
      `actor must be one of: ${ACTORS.join(', ')}. Received ${JSON.stringify(actor)}.`,
    );
  }

  // THE DOOR THAT WRITES ASKS THE SAME QUESTION THE DOORS THAT READ ASK.
  //
  // `canFile`, `buildFilingPacket` and `hydrateClaim` all refuse a claim holding a value this page
  // could not have written. This one used to accept it and then move it on. Measured before the
  // check, patching the description of a draft somebody had written to by hand:
  //
  //   unknown severity   patch ok=true revision 1 -> 2 still holds "catastrophic"
  //   zone out of range  patch ok=true revision 1 -> 2 still holds 47
  //   negative revision  patch ok=true revision -5 -> -4
  //
  // So the bad value survived under a revision that had moved, which is worse than where it
  // started: the counter is the one thing a later writer trusts to prove it read what it is
  // writing to. The refusal is PATCH_REJECTED_VALUE because that is what it is, a value this model
  // will not stand behind, and a caller already branches on that code.
  const snapshot = checkClaimSnapshot(claim);
  if (!snapshot.ok) {
    return refusal(claim, PATCH_CODES.value, `${snapshot.reason} Nothing was changed.`);
  }

  // The filed check comes first among the state checks on purpose. A stale refusal tells the reader
  // to read again and retry, and on a filed claim that retry can never work. Saying
  // "this is closed" straight away costs one round trip less and is the truth.
  if (claim.status === 'filed') {
    return refusal(
      claim,
      PATCH_CODES.protected,
      'This claim has already been filed, so every field on it is closed to changes. Reading it again will not help. Nothing was changed.',
    );
  }

  const stale = staleRefusal(claim, actor, baseRevision);
  if (stale) return refusal(claim, PATCH_CODES.stale, stale);

  const normalised = normaliseChanges(changes);
  if (!normalised.ok) return refusal(claim, PATCH_CODES.field, normalised.error);

  const locked = lockedList(claim);
  const staged = [];

  // Pass one: check everything. Nothing is written in this loop, which is what
  // makes the whole patch all or nothing.
  for (const change of normalised.list) {
    const { field, value } = change;

    if (PROTECTED_FIELDS.includes(field)) {
      return refusal(
        claim,
        PATCH_CODES.protected,
        `"${field}" is not patchable by anyone, by the page or by an agent: ${PROTECTED_IN_MESSAGES} are set by the insurer's page. Nothing was changed.`,
      );
    }

    if (!PATCHABLE_FIELDS.includes(field)) {
      return refusal(
        claim,
        PATCH_CODES.field,
        `"${field}" is not a field on this claim. The fields that exist are: ${PATCHABLE_FIELDS.join(', ')}. Nothing was changed.`,
      );
    }

    if (locked.includes(field)) {
      return refusal(
        claim,
        PATCH_CODES.locked,
        `"${field}" was pinned by the person on the page, so no patch can move it. A person has to unpin it on the page before this value can change. Nothing was changed.`,
      );
    }

    if (value === null || value === undefined) {
      staged.push({ field, value: null });
      continue;
    }

    const checked = coerceField(field, value);
    if (!checked.ok) {
      return refusal(claim, PATCH_CODES.value, `${checked.error} Nothing was changed.`);
    }
    staged.push({ field, value: checked.value });
  }

  // Pass one, part two: what this claim is required to answer is a fact about where
  // the patch ENDS, not about where it started, so it is asked of the staged result
  // rather than of the claim on the way in.
  //
  // A batch is one revision, and half of it cannot be true. Reading requiredFieldsFor
  // off the incoming claim made "collision with an impact position" answer for a patch
  // whose whole point was that the claim would no longer be a collision. Sending
  // incident_type theft and damage_zone null together was refused in BOTH orders,
  // while the same two changes sent one after the other were both accepted, so the
  // atomic path was strictly weaker than the sequential one at the exact moment
  // atomicity was worth having.
  //
  // Nothing here relaxes a refusal: the candidate is only consulted about which fields
  // are required, and a claim that still requires the field it is clearing is refused
  // exactly as before.
  const candidate = { ...claim };
  for (const { field, value } of staged) candidate[field] = value;
  const requiredAtTheEnd = requiredFieldsFor(candidate);

  for (const { field, value } of staged) {
    if (value !== null) continue;
    if (requiredAtTheEnd.includes(field)) {
      return refusal(
        claim,
        PATCH_CODES.value,
        `${field} is required, so it cannot be cleared. Send the corrected value instead of an empty one. Nothing was changed.`,
      );
    }
  }

  // Pass two: write. Everything below here is known to be valid.
  const next = copyClaim(claim);
  const applied = [];

  for (const { field, value } of staged) {
    next[field] = value;
    if (value === null) delete next.provenance[field];
    else next.provenance[field] = actor;
    applied.push(field);
  }

  next.revision = currentRevision(claim) + 1;

  return { claim: next, ok: true, error: null, code: null, applied, revision: next.revision };
}

/**
 * Would this patch leave every field exactly where it already is?
 *
 * A PREDICATE, NOT A GATE. It refuses nothing and changes nothing. It exists so a
 * caller that can be asked for the same value twice, which on a web page is any
 * control with both a keystroke timer and a change event, can tell a second commit
 * of the same text from a real edit WITHOUT coercing anything itself. The
 * comparison runs through the same validators a patch runs through, so "  hello  "
 * and "hello" are one answer here for the same reason they are one answer there.
 *
 * It answers false whenever the rules would have something to say. A value the
 * validators refuse, a field a person pinned and a claim that has been filed are
 * all changes as far as this function is concerned, so the caller still dispatches
 * them and the refusal still reaches the page. Silence is only ever returned for a
 * patch that would be accepted and would move nothing.
 *
 * applyPatch itself is deliberately NOT wired to this. Its result is read by the
 * writing tool, which reports what it applied and the revision it reached, and an
 * accepted patch that applied nothing would read strangely there. The page uses
 * this instead, on the one path where the same value genuinely arrives twice.
 *
 * @param {object} claim
 * @param {{field: string, value: *}|Array<{field: string, value: *}>} changes
 * @returns {boolean} true when applying it would store nothing new
 */
export function patchIsNoChange(claim, changes) {
  if (!claim || typeof claim !== 'object') return false;
  if (claim.status === 'filed') return false;

  const normalised = normaliseChanges(changes);
  if (!normalised.ok) return false;

  const locked = lockedList(claim);

  return normalised.list.every(({ field, value }) => {
    if (!PATCHABLE_FIELDS.includes(field)) return false;
    if (locked.includes(field)) return false;

    const current = claim[field] === undefined ? null : claim[field];
    if (value === null || value === undefined) return current === null;

    const checked = coerceField(field, value);
    if (!checked.ok) return false;
    return Object.is(current, checked.value);
  });
}

/* -------------------------------------------------------------- lock, file */

function lockGuard(claim, field) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('lockField needs a claim object.');
  }
  if (claim.status === 'filed') {
    return {
      code: PATCH_CODES.protected,
      error: 'This claim has already been filed, so pinning a field on it changes nothing.',
    };
  }
  if (PROTECTED_FIELDS.includes(field)) {
    return {
      code: PATCH_CODES.protected,
      error: `"${field}" is not a field a person fills in, so there is nothing to pin.`,
    };
  }
  if (!PATCHABLE_FIELDS.includes(field)) {
    return {
      code: PATCH_CODES.field,
      error: `"${field}" is not a field on this claim. The fields that exist are: ${PATCHABLE_FIELDS.join(', ')}.`,
    };
  }
  return null;
}

/**
 * Pin a field, so no patch from either side can move it.
 *
 * A human only concept. There is no tool for it and there should never be one:
 * pinning is how the person on the page says "I have checked this one myself".
 * Pinning a field that is already pinned is allowed and changes nothing, so the
 * revision does not move.
 *
 * @param {object} claim
 * @param {string} field
 * @returns {{claim: object, ok: boolean, error: (string|null), code: (string|null), revision: number}}
 */
export function lockField(claim, field) {
  const refused = lockGuard(claim, field);
  if (refused) {
    return { claim, ok: false, error: refused.error, code: refused.code, revision: currentRevision(claim) };
  }
  if (lockedList(claim).includes(field)) {
    return { claim, ok: true, error: null, code: null, revision: currentRevision(claim) };
  }

  const next = copyClaim(claim);
  next.locked = [...lockedList(claim), field];
  next.revision = currentRevision(claim) + 1;
  return { claim: next, ok: true, error: null, code: null, revision: next.revision };
}

/**
 * Unpin a field. Human only, same as pinning it.
 *
 * @param {object} claim
 * @param {string} field
 * @returns {{claim: object, ok: boolean, error: (string|null), code: (string|null), revision: number}}
 */
export function unlockField(claim, field) {
  const refused = lockGuard(claim, field);
  if (refused) {
    return { claim, ok: false, error: refused.error, code: refused.code, revision: currentRevision(claim) };
  }
  if (!lockedList(claim).includes(field)) {
    return { claim, ok: true, error: null, code: null, revision: currentRevision(claim) };
  }

  const next = copyClaim(claim);
  next.locked = lockedList(claim).filter((entry) => entry !== field);
  next.revision = currentRevision(claim) + 1;
  return { claim: next, ok: true, error: null, code: null, revision: next.revision };
}

/**
 * Record that something outside the claim changed what a reader would be told.
 *
 * WHAT THIS EXISTS FOR. The revision is what an agent quotes back, and the promise behind
 * quoting it is that the patch is landing on the context the quoter actually read. Two things
 * on this page break that promise without touching a field: loading another insurer's rule pack,
 * and a person carrying out a human action that closes a requirement. Both change what
 * get_requirements, read_claim_state, check_coverage and the rest answer. Before this existed the
 * counter stood still through either one, so a patch written against the answers from before the
 * switch was accepted at the same number afterwards.
 *
 * It moves the counter and nothing else. No field is written, no provenance is stamped, nothing
 * is validated, and the reason is not stored on the claim: it is handed back so the caller can
 * say it out loud. The claim is data about the incident and the pack that is loaded is not.
 *
 * A FILED CLAIM IS ALLOWED THROUGH, on purpose. A patch on a filed claim is refused as protected
 * before the stale check ever runs, so refusing here would buy nothing, and the read tools still
 * report the revision, which should go on describing the context they are reading.
 *
 * @param {object} claim
 * @param {string} reason what changed, in the caller's words. Required, so a counter never moves
 *        without something a person can be told.
 * @returns {{claim: object, ok: boolean, error: (string|null), code: (string|null), revision: number}}
 */
export function noteContextChange(claim, reason) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('noteContextChange needs a claim object.');
  }
  const revision = currentRevision(claim);

  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return {
      claim,
      ok: false,
      error: 'A context change has to name what changed, so the page can say why the revision moved. Nothing was changed.',
      code: PATCH_CODES.value,
      revision,
    };
  }

  const next = copyClaim(claim);
  next.revision = revision + 1;
  return { claim: next, ok: true, error: null, code: null, revision: next.revision };
}

/** Whether a person has pinned this field. */
export function isLocked(claim, field) {
  return Boolean(claim && typeof claim === 'object') && lockedList(claim).includes(field);
}

/** Who set this field, or null if nobody has. */
export function provenanceOf(claim, field) {
  if (!claim || typeof claim !== 'object' || !claim.provenance) return null;
  const source = claim.provenance[field];
  return PROVENANCE_SOURCES.includes(source) ? source : null;
}

/**
 * THE FILING RECEIPT. Every claim object this function has actually filed, and nothing else.
 *
 * WHAT IT CLOSES. The handler packet's own `filed.through` field says the claim was filed through a
 * control on the page. Nothing checked that. `status` is an ordinary string on an ordinary object,
 * so a caller that wrote `{ ...draft, status: 'filed', filed_at: '2026-09-01T09:15:00.000Z' }` got a
 * document that said a filing had happened, with a digest over it, and no filing had happened.
 *
 * WHY A WeakSet AND NOT A FIELD. This is the same mechanism src/core/policy.js uses for a validated
 * rule pack, and the reasoning is the same one written out at `isUsablePack` in src/core/filing.js.
 * A public marker such as `filed_here: true` proves only that somebody wrote it, because the forgery
 * above would carry it too. Membership of a set held privately in this module is not a property: it
 * cannot be typed out, spread, cloned, serialised or restored from storage. `wasFiledHere` below is
 * the reading half and there is no exported writing half, so no tool, no page and no test can put a
 * claim in here without going through the file gate.
 *
 * A COPY IS NOT THE CLAIM. `{ ...filed }` produces a different object and is not a member, and that
 * is the intended reading rather than a rough edge. A copied filed claim was assembled by somebody
 * rather than filed here, so the packet refuses to describe it as a filing.
 *
 * AND HERE IS ITS LIMIT, WHICH IS REAL AND HAS TO TRAVEL WITH IT. This is a browser local
 * demonstration. The receipt proves that this code path ran in this page in this session, to this
 * module, and nothing more. It proves nothing at all to anybody outside that session: a reader
 * holding an exported packet has no way to check it, because the whole record lives in memory and
 * disappears with the tab. It is not a signature, it is not an insurer receipt, and it is not
 * evidence a handler could rely on. It stops this page describing a filing it did not perform.
 * `docs/handler-verification.md` says the same to a handler.
 */
const FILED_BY_THIS_MODULE = new WeakSet();

/**
 * Did this exact claim object come out of `fileClaim` here.
 *
 * The reading half of the receipt above. Read the limit written there before you rely on this: it
 * is a statement about one object in one browser session, not about the world.
 *
 * @param {*} claim
 * @returns {boolean}
 */
export function wasFiledHere(claim) {
  return Boolean(claim) && typeof claim === 'object' && FILED_BY_THIS_MODULE.has(claim);
}

/**
 * Mark the claim filed. There is no tool for it on this page's surface.
 *
 * Filing is a change like any other, so it advances the revision: an agent
 * holding an older number finds out that the draft moved under it.
 *
 * THE GATE IS canFile AND THIS FUNCTION HAS NO SECOND OPINION. It used to read
 * validateClaim alone, which sees the static required list and nothing the
 * insurer derives, so a theft claim with an open police report requirement was
 * filed by a direct call while every surface on the page reported the
 * requirement as open. Passing the pack in closes that, and passing none is
 * refused rather than waved through: a caller that reaches this function
 * directly gets the same answer the button gets.
 *
 * A REFUSAL CHANGES NOTHING. The original claim object is handed straight back,
 * so the revision, the status and every field are the same values and the same
 * reference they were before the call.
 *
 * @param {object} claim
 * @param {{at?: string, pack?: (object|null),
 *          completedHumanActions?: (string[]|Set<string>)}} [options]
 *        `at` is the filing time, supplied by the caller and never invented here.
 *        It has to be a full UTC instant, `2026-09-01T09:15:00.000Z`, and a
 *        filing that arrives without one is refused rather than recorded with a
 *        null or a wall clock reading in its place.
 *        `pack` is the insurer rule pack the page is reading against, as plain
 *        data. `completedHumanActions` are the ids of requirements whose human
 *        action has been carried out on the page.
 * @returns {{claim: object, ok: boolean, error: (string|null), code: (string|null), revision: number}}
 */
export function fileClaim(claim, options = {}) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('fileClaim needs a claim object.');
  }
  const revision = currentRevision(claim);

  const decision = canFile(options.pack ?? null, claim, options.completedHumanActions, {
    homePackId: options.homePackId ?? null,
  });
  if (!decision.ok) {
    return {
      claim,
      ok: false,
      error: decision.reason,
      code: decision.code,
      revision,
    };
  }

  // ONE SHAPE FOR A FILING TIME, REFUSED HERE RATHER THAN INVENTED HERE.
  //
  // This module owns no clock. It has no DOM, no browser globals, no network, no timers and no
  // I/O, and a timestamp made up in here would be a fact about the filing that nobody observed.
  // So the caller reads the clock and hands the instant over, and this is where a caller that
  // hands over something else is stopped. It used to be `typeof options.at === 'string'`, which
  // let "19:15:31" through and wrote a filing time with no date and no zone into a document that
  // then got hashed.
  //
  // IT RUNS AFTER THE GATE ON PURPOSE. A draft that is not ready still hears which of the
  // claimant's own answers are missing, because that is the half a person can act on. A bad
  // timestamp is our bug, and our bug does not get to speak over theirs.
  if (!isFilingInstant(options.at)) {
    return {
      claim,
      ok: false,
      error: `This filing was not recorded: ${FILING_INSTANT_REASON}, and it is `
        + `${JSON.stringify(options.at ?? null)}.`,
      code: FILE_CODES.noFilingTime,
      revision,
    };
  }

  const next = copyClaim(claim);
  next.status = 'filed';
  next.filed_at = options.at;
  next.revision = revision + 1;
  // The receipt, written on the one line where a filing actually happens and nowhere else. See
  // FILED_BY_THIS_MODULE above for what it is worth and, more importantly, what it is not.
  FILED_BY_THIS_MODULE.add(next);
  return { claim: next, ok: true, error: null, code: null, revision: next.revision };
}

/* ------------------------------------------------------------- read only */

/**
 * The evidence notes attached to this claim, exactly as they arrived.
 *
 * A note is third party content. It may be a garage's write up, a message from
 * another driver, or anything else someone uploaded. Core reads it, copies it
 * and returns it. Core never follows an instruction inside it, never lets it
 * change what the claim requires, and never lets it change what validation says.
 * The tool that surfaces these must carry untrustedContentHint.
 *
 * @param {object} claim
 * @returns {Array<{id: string, author: string, received_at: (string|null), text: string}>}
 */
export function readEvidenceNotes(claim) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('readEvidenceNotes needs a claim object.');
  }
  return normaliseNotes(claim.evidence_notes);
}

/**
 * Check whether the claim can be filed, and raise anything a handler should look at.
 *
 * Warnings never block. They are things worth saying out loud, not errors. This
 * function reads the claim's own fields and nothing else: not the evidence
 * notes, not the policy, not anything a third party wrote.
 *
 * `missing` comes from requiredFieldsFor(claim), so it narrows with the claim: a
 * theft claim is not asked for an impact position and does not report one as
 * missing.
 *
 * @param {object} claim
 * @returns {{ready: boolean, missing: string[], warnings: string[]}}
 */
export function validateClaim(claim) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('validateClaim needs a claim object.');
  }

  const missing = requiredFieldsFor(claim).filter(
    (field) => claim[field] === null || claim[field] === undefined,
  );
  const warnings = [];

  if (claim.incident_type === 'theft' && claim.damage_zone !== null) {
    warnings.push(
      'A theft claim usually has no impact position. Check whether this is attempted theft rather than theft.',
    );
  }
  if (claim.vehicle_drivable === false && claim.severity === 'scratch') {
    warnings.push(
      'The vehicle is marked as not drivable but the damage is recorded as a scratch. One of the two looks wrong.',
    );
  }
  if (claim.severity === 'structural' && !claim.police_report_ref) {
    warnings.push('Structural damage is normally filed with a police report reference.');
  }
  if (claim.incident_type === 'theft' && !claim.police_report_ref) {
    warnings.push('A theft claim is normally filed with a police report reference.');
  }
  if (typeof claim.description === 'string' && claim.description.length < 20) {
    warnings.push('The description is very short. A handler will usually ask for more detail.');
  }
  if (claim.incident_type === 'collision' && !claim.driver) {
    warnings.push('Nobody is named as the driver, and cover depends on who was driving.');
  }

  return { ready: missing.length === 0, missing, warnings };
}

function isSet(value) {
  return !isEmptyValue(value);
}

function zoneText(zone) {
  return `${zone} o'clock (${ZONE_LABELS[zone]})`;
}

/** Free text may already end in a stop. An initial like "Maria K." usually does. */
function stop(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * A short human readable summary of the claim.
 *
 * Written to be read out loud, so a field nobody has answered yet is left out of
 * the sentence rather than filled with a placeholder, and the closing line names
 * what is still needed in words rather than in field names.
 *
 * The revision is stated because an agent needs it to patch: it is the number it
 * has to send back as baseRevision.
 *
 * Kept inside the WebMCP tool output budget. The return value is never longer
 * than DESCRIBE_MAX_LENGTH characters.
 *
 * @param {object} claim
 * @returns {string}
 */
export function describeClaim(claim) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('describeClaim needs a claim object.');
  }

  const { ready, missing, warnings } = validateClaim(claim);
  const lines = [];

  lines.push(
    `Claim draft on policy ${claim.policy_id ?? 'unknown'} (status: ${claim.status}, revision ${currentRevision(claim)}).`,
  );

  const type = claim.incident_type;
  const date = claim.incident_date;
  if (type && date) lines.push(`Incident: ${type}, on ${date}.`);
  else if (type) lines.push(`Incident: ${type}, on a date not given yet.`);
  else if (date) lines.push(`Something happened on ${date}, but the type is not set yet.`);
  else lines.push('No incident details have been recorded yet.');

  if (claim.location) lines.push(stop(`Location: ${claim.location}`));
  if (claim.driver) lines.push(stop(`Driver at the time: ${claim.driver}`));

  const hasZone = isSet(claim.damage_zone);
  const hasSeverity = isSet(claim.severity);
  if (hasZone && hasSeverity) {
    lines.push(`Damage: ${claim.severity} at ${zoneText(claim.damage_zone)}.`);
  } else if (hasSeverity) {
    lines.push(`Damage: ${claim.severity}, with the impact position still to be marked.`);
  } else if (hasZone) {
    lines.push(`Impact at ${zoneText(claim.damage_zone)}, with the severity still to be set.`);
  }

  if (isSet(claim.vehicle_drivable)) {
    lines.push(`The car ${claim.vehicle_drivable ? 'still drives' : 'is not drivable'}.`);
  }

  if (claim.description) lines.push(stop(`Account given: ${claim.description}`));
  if (claim.police_report_ref) lines.push(stop(`Police report: ${claim.police_report_ref}`));
  if (claim.witness_name) lines.push(stop(`Witness: ${claim.witness_name}`));

  // Named, but never at the cost of the summary. Two of them read as a sentence;
  // ten would eat the budget and push the "still needed" line off the end, which
  // is the one line the claimant actually acts on.
  const pinned = lockedList(claim);
  if (pinned.length > 0) {
    const named = pinned.slice(0, 2).map((field) => FIELD_LABELS[field]);
    const rest = pinned.length - named.length;
    lines.push(
      `Pinned by the claimant, so no patch can move ${pinned.length === 1 ? 'it' : 'them'}: ${named.join(', ')}${
        rest > 0 ? ` and ${rest} more` : ''
      }.`,
    );
  }

  lines.push(
    ready
      ? 'Every required field is answered, so the claim is ready for the policyholder to file.'
      : `Still needed before filing: ${missing.map((field) => FIELD_LABELS[field]).join(', ')}.`,
  );

  if (warnings.length > 0) {
    const extra = warnings.length > 1 ? ` (and ${warnings.length - 1} more to review)` : '';
    lines.push(`Worth checking: ${warnings[0]}${extra}`);
  }

  const out = lines.join(' ');
  if (out.length <= DESCRIBE_MAX_LENGTH) return out;
  return `${out.slice(0, DESCRIBE_MAX_LENGTH - 3)}...`;
}
