/**
 * Claim draft model for the ClaimReady FNOL page.
 *
 * PURE MODULE. No DOM, no window, no document, no fetch, no timers, no I/O.
 * It runs unchanged under `node --test` and inside the browser as an ES module.
 *
 * Everything here returns plain data. The WebMCP tools layer is responsible for
 * turning that data into tool output. Core never builds an MCP envelope.
 *
 * Treat every claim object as immutable. `applyPatch` returns a new claim on
 * success and hands back the original, untouched, on failure.
 */

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

/** A claim cannot be filed until every one of these holds a value. */
export const REQUIRED_FIELDS = [
  'incident_date',
  'incident_type',
  'damage_zone',
  'severity',
  'vehicle_drivable',
  'description',
];

/** Useful but not blocking. These may be set back to null to clear them. */
export const OPTIONAL_FIELDS = ['driver', 'location', 'police_report_ref', 'witness_name'];

/** Every field `applyPatch` will accept. Anything else is rejected by name. */
export const PATCHABLE_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

/** Fields the claim carries that no tool and no agent may ever write. */
export const READ_ONLY_FIELDS = ['policy_id', 'reference', 'status', 'filed_at'];

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

function emptyClaim() {
  const claim = {
    policy_id: null,
    reference: null,
    status: 'draft',
    filed_at: null,
  };
  for (const field of PATCHABLE_FIELDS) claim[field] = null;
  return claim;
}

/**
 * Build a claim from a fixture.
 *
 * Accepts either the whole parsed fixture (an object with `policy` and `claim`)
 * or a single scenario object (an object with `claim`), or a flat seed of claim
 * fields. Every seed value is pushed through `applyPatch`, so a typo or a bad
 * value in the fixture throws here instead of silently leaving a field missing
 * for the rest of the app.
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

  let claim = emptyClaim();
  claim.policy_id = source.policy?.id ?? flat.policy_id ?? null;
  claim.reference = flat.reference ?? null;
  claim.status = 'draft';
  claim.filed_at = null;

  for (const [field, value] of Object.entries(flat)) {
    if (READ_ONLY_FIELDS.includes(field)) continue;
    if (value === null || value === undefined) continue;
    const result = applyPatch(claim, field, value);
    if (!result.ok) {
      throw new TypeError(`Fixture claim field "${field}" is not usable: ${result.error}`);
    }
    claim = result.claim;
  }

  return claim;
}

/**
 * Set one field on a claim.
 *
 * PURE. On success it returns a brand new claim and leaves the input alone. On
 * failure it returns the original claim object unchanged, so a caller can
 * always keep using `result.claim`.
 *
 * Passing null clears an optional field. Passing null for a required field is
 * refused, because a required field that was answered should not be un answered
 * by an agent.
 *
 * @param {object} claim
 * @param {string} field
 * @param {*} value
 * @returns {{claim: object, ok: boolean, error: (string|null)}}
 */
export function applyPatch(claim, field, value) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('applyPatch needs a claim object.');
  }

  if (READ_ONLY_FIELDS.includes(field)) {
    return {
      claim,
      ok: false,
      error: `"${field}" is set by the insurer and cannot be changed here.`,
    };
  }

  if (!PATCHABLE_FIELDS.includes(field)) {
    return {
      claim,
      ok: false,
      error: `"${field}" is not a field on this claim. Editable fields are: ${PATCHABLE_FIELDS.join(', ')}.`,
    };
  }

  if (claim.status === 'filed') {
    return {
      claim,
      ok: false,
      error: 'This claim has already been filed and can no longer be edited.',
    };
  }

  if (value === null || value === undefined) {
    if (REQUIRED_FIELDS.includes(field)) {
      return {
        claim,
        ok: false,
        error: `${field} is required, so it cannot be cleared.`,
      };
    }
    return { claim: { ...claim, [field]: null }, ok: true, error: null };
  }

  const checked = VALIDATORS[field](value);
  if (!checked.ok) {
    return { claim, ok: false, error: checked.error };
  }

  return { claim: { ...claim, [field]: checked.value }, ok: true, error: null };
}

/**
 * Check whether the claim can be filed, and raise anything a handler should look at.
 *
 * Warnings never block. They are things worth saying out loud, not errors.
 *
 * @param {object} claim
 * @returns {{ready: boolean, missing: string[], warnings: string[]}}
 */
export function validateClaim(claim) {
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('validateClaim needs a claim object.');
  }

  const missing = REQUIRED_FIELDS.filter(
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
  return value !== null && value !== undefined;
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

  lines.push(`Claim draft on policy ${claim.policy_id ?? 'unknown'} (status: ${claim.status}).`);

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
