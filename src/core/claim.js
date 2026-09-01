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

import { canFile } from './filing.js';

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

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
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
 * @param {object} value
 * @returns {object} a complete, normalised claim
 * @throws {TypeError} when a stored field is unknown or its value is invalid
 */
export function hydrateClaim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hydrateClaim needs a claim object.');
  }

  const claim = emptyClaim();

  // Protected fields first, because the patchable ones are checked against the same rules a patch
  // uses and those rules do not describe a status or a revision.
  claim.policy_id = optionalString(value.policy_id, 'policy_id');
  claim.reference = optionalString(value.reference, 'reference');
  claim.revision = Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  claim.status = value.status === 'filed' ? 'filed' : 'draft';
  claim.filed_at = optionalString(value.filed_at, 'filed_at');
  claim.evidence_notes = normaliseNotes(value.evidence_notes);
  claim.locked = Array.isArray(value.locked)
    ? value.locked.filter((field) => PATCHABLE_FIELDS.includes(field))
    : [];

  // A filed claim with no filed_at is not a claim anyone can answer for. Rather than invent a
  // timestamp, which would be a fact this function made up, the state that carries no time is read
  // back as the draft it is indistinguishable from.
  if (claim.status === 'filed' && !claim.filed_at) claim.status = 'draft';
  if (claim.status !== 'filed') claim.filed_at = null;

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

  return claim;
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

  // The filed check comes first on purpose. A stale refusal tells the reader to
  // read again and retry, and on a filed claim that retry can never work. Saying
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
 *        `at` is a timestamp supplied by the caller and never invented here.
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

  const next = copyClaim(claim);
  next.status = 'filed';
  next.filed_at = typeof options.at === 'string' ? options.at : null;
  next.revision = revision + 1;
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
