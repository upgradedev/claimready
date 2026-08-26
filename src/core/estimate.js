/**
 * Repair cost triage band.
 *
 * PURE MODULE. No DOM, no window, no document, no fetch, no timers, no I/O.
 *
 * This is a lookup against a fixed parts table, not a prediction and not a
 * model output. It answers "roughly what class of job is this", so a handler
 * can route the claim. It is never a quote and never an offer. Say "band", say
 * "triage", never say "estimate accuracy" and never say "predicted".
 *
 * The band is built from the parts themselves: `low` is the sum of every part
 * at its cheapest, `high` is the sum of every part at its dearest, and each
 * line in `lines` sits at the middle of its own range. So the sum of the lines
 * is always inside the band by construction, never by a fudge factor.
 */

import { DAMAGE_ZONES, SEVERITIES } from './claim.js';

/** Must match the `currency` on the policy fixture. A unit test pins the pair. */
export const ESTIMATE_CURRENCY = 'EUR';

/** Put this next to any figure shown to a person or returned to an agent. */
export const ESTIMATE_DISCLAIMER =
  'Triage band from a fixed parts table, not a quote and not a prediction. A repairer confirms the real figure.';

/** Vehicle classes the parts table knows how to price. */
export const VEHICLE_CLASSES = ['city', 'compact', 'estate', 'suv', 'premium'];

const CLASS_FACTOR = {
  city: 0.8,
  compact: 1.0,
  estate: 1.15,
  suv: 1.35,
  premium: 1.85,
};

/** Cost of the part plus its labour, for a compact car with an average dent. */
const PART_COSTS = {
  'front bumper': 340,
  bonnet: 420,
  'radiator grille': 180,
  'left headlight': 260,
  'right headlight': 260,
  'left wing': 300,
  'right wing': 300,
  'left front door': 380,
  'right front door': 380,
  'left rear door': 360,
  'right rear door': 360,
  'left sill': 240,
  'right sill': 240,
  'left rear wing': 330,
  'right rear wing': 330,
  'rear bumper': 320,
  'boot lid': 400,
  'rear panel': 290,
  'left tail light': 190,
  'right tail light': 190,
  'chassis alignment check': 220,
};

/** Which panels sit at each clock position. 12 is straight ahead, 3 is the right side. */
const ZONE_PARTS = {
  12: ['front bumper', 'bonnet', 'radiator grille'],
  1: ['front bumper', 'right headlight', 'right wing'],
  2: ['right wing', 'right front door'],
  3: ['right front door', 'right rear door', 'right sill'],
  4: ['right rear door', 'right rear wing'],
  5: ['rear bumper', 'right tail light', 'right rear wing'],
  6: ['rear bumper', 'boot lid', 'rear panel'],
  7: ['rear bumper', 'left tail light', 'left rear wing'],
  8: ['left rear door', 'left rear wing'],
  9: ['left front door', 'left rear door', 'left sill'],
  10: ['left wing', 'left front door'],
  11: ['front bumper', 'left headlight', 'left wing'],
};

/**
 * How much of a part's cost the job actually consumes, by severity.
 * `low` and `high` bound `nominal` for every severity, which is what keeps the
 * summed lines inside the summed band.
 */
const SEVERITY_BAND = {
  scratch: { low: 0.3, nominal: 0.45, high: 0.65 },
  dent: { low: 0.8, nominal: 1.0, high: 1.3 },
  structural: { low: 1.9, nominal: 2.4, high: 3.2 },
};

/** Only a structural hit pulls the shell itself out of true. */
const STRUCTURAL_EXTRA_PART = 'chassis alignment check';

/**
 * Produce the triage band for one damage zone.
 *
 * @param {object} input
 * @param {number|string} input.zone clock position, 1 to 12
 * @param {string} input.severity one of SEVERITIES
 * @param {string} input.vehicleClass one of VEHICLE_CLASSES
 * @returns {{low: number, high: number, currency: string, lines: {part: string, cost: number}[]}}
 * @throws {RangeError} when any input is outside its table
 */
export function estimateRepair({ zone, severity, vehicleClass } = {}) {
  const zoneNumber = typeof zone === 'string' ? Number(zone.trim()) : zone;
  if (!Number.isInteger(zoneNumber) || !DAMAGE_ZONES.includes(zoneNumber)) {
    throw new RangeError(`zone must be a clock position from 1 to 12, received ${String(zone)}.`);
  }
  if (!SEVERITIES.includes(severity)) {
    throw new RangeError(`severity must be one of: ${SEVERITIES.join(', ')}. Received ${String(severity)}.`);
  }
  if (!VEHICLE_CLASSES.includes(vehicleClass)) {
    throw new RangeError(
      `vehicleClass must be one of: ${VEHICLE_CLASSES.join(', ')}. Received ${String(vehicleClass)}.`,
    );
  }

  const band = SEVERITY_BAND[severity];
  const factor = CLASS_FACTOR[vehicleClass];
  const parts = [...ZONE_PARTS[zoneNumber]];
  if (severity === 'structural') parts.push(STRUCTURAL_EXTRA_PART);

  const lines = [];
  let low = 0;
  let high = 0;

  for (const part of parts) {
    const base = PART_COSTS[part] * factor;
    lines.push({ part, cost: Math.round(base * band.nominal) });
    low += Math.round(base * band.low);
    high += Math.round(base * band.high);
  }

  // Widening to the nearest ten reads better and can only keep the lines inside.
  return {
    low: Math.floor(low / 10) * 10,
    high: Math.ceil(high / 10) * 10,
    currency: ESTIMATE_CURRENCY,
    lines,
  };
}
