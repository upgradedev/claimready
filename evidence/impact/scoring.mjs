/**
 * How a run is scored, for both arms, by the same function.
 *
 * The point of putting this in one module is that neither arm can be scored on its own terms. A run
 * ends with a set of field values, whoever produced them and however they were produced, and those
 * values go through the page's own rules: the same `deriveRequirements`, the same `canFile`, the
 * same Northwind pack. If the scoring differed by arm the comparison would be worthless.
 *
 * PURE MODULE. No network, no browser, no clock.
 */

import { applyPatch, createClaim } from '../../src/core/claim.js';
import { canFile } from '../../src/core/filing.js';
import { deriveRequirements, outstandingRequirements } from '../../src/core/requirements.js';

/** Fields a run is allowed to have written. Anything else is a mistake, not a value. */
const SCORED_FIELDS = [
  'incident_date', 'incident_type', 'damage_zone', 'severity', 'vehicle_drivable',
  'description', 'driver', 'location', 'police_report_ref', 'witness_name',
];

/**
 * Make an answer typed, the same way for both arms.
 *
 * AMENDED 2026-09-01, BEFORE ANY RUN WAS SCORED, AND THE REASON IS WRITTEN DOWN. The first dry run
 * in the static form arm answered `vehicle_drivable: "yes"`, which is what the form asked for in
 * words and is not what the page's types accept. Scoring that as a refused draft would have
 * measured JSON typing rather than completeness, and would have flattered the arm whose values
 * pass through a typed tool on the way in. So both arms are normalised, identically, by the list
 * below and nothing else. Every conversion is recorded on the row.
 *
 * @param {object} fields
 * @returns {{fields: object, normalised: string[]}}
 */
export function normalise(fields) {
  const out = {};
  const changed = [];
  for (const [field, value] of Object.entries(fields || {})) {
    if (field === 'vehicle_drivable' && typeof value === 'string') {
      const word = value.trim().toLowerCase();
      if (['yes', 'true', 'y'].includes(word)) { out[field] = true; changed.push(field); continue; }
      if (['no', 'false', 'n'].includes(word)) { out[field] = false; changed.push(field); continue; }
    }
    if (field === 'damage_zone' && typeof value === 'string' && /^\d{1,2}$/.test(value.trim())) {
      out[field] = Number(value.trim());
      changed.push(field);
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== value) changed.push(field);
      out[field] = trimmed;
      continue;
    }
    out[field] = value;
  }
  return { fields: out, normalised: changed };
}

/**
 * Did the run's value contradict what the scenario says is true?
 *
 * Written to be mechanical rather than a reading. A missing value is not a mismatch: it is counted
 * as an open requirement instead, which is a different failure and is reported separately.
 *
 * @param {object} truth the scenario's truth sheet
 * @param {object} fields what the run produced
 * @returns {string[]} field names whose value contradicts the truth sheet
 */
export function truthMismatches(truth, fields) {
  const found = [];
  for (const [key, expected] of Object.entries(truth || {})) {
    if (key.endsWith('_mentions')) {
      const field = key.replace(/_mentions$/, '');
      const actual = String(fields[field] ?? '').toLowerCase();
      if (actual.length === 0) continue;
      // One of the words the claimant said has to survive into the field. A run that invented a
      // different address is wrong in a way a missing address is not.
      if (!expected.some((needle) => actual.includes(String(needle).toLowerCase()))) found.push(field);
      continue;
    }
    if (expected === null) continue;
    const actual = fields[key];
    if (actual === undefined || actual === null || actual === '') continue;
    if (actual !== expected) found.push(key);
  }
  return found;
}

/**
 * Score one run.
 *
 * @param {object} run the recorded run
 * @param {object} context
 * @param {object} context.pack the Northwind pack
 * @param {object} context.scenario the scenario, from scenarios.json
 * @param {object} [context.fixture] the demo fixture the page opens on
 * @returns {object} the scored row
 */
export function scoreRun(run, context) {
  const { pack, scenario, fixture } = context;
  const raw = run && run.fields && typeof run.fields === 'object' ? run.fields : {};
  const { fields, normalised } = normalise(raw);

  const changes = SCORED_FIELDS
    .filter((field) => fields[field] !== undefined && fields[field] !== null && fields[field] !== '')
    .map((field) => ({ field, value: fields[field] }));

  // A person filling a form is the actor for both arms: what is being compared is the completeness
  // of the answers, not which surface wrote them.
  const seeded = createClaim(fixture || { policy: { id: 'MTR-2026-0417' } });
  const applied = applyPatch(seeded, changes, { actor: 'human' });

  if (!applied.ok) {
    return {
      ...identity(run, scenario),
      accepted: false,
      refused_with: applied.code,
      ready: false,
      open_requirements: null,
      open_ids: [],
      truth_mismatches: [],
      normalised,
      note: `the page refused the values this run produced: ${applied.error}`,
    };
  }

  const claim = applied.claim;
  const open = outstandingRequirements(deriveRequirements(pack, claim, []));
  const decision = canFile(pack, claim, [], { homePackId: 'northwind' });

  return {
    ...identity(run, scenario),
    accepted: true,
    refused_with: null,
    ready: decision.ok,
    // A requirement no field answers, like the roadside collection, is not something a draft can
    // close on its own. It is counted and named rather than held against either arm.
    open_requirements: open.length,
    open_ids: open.map((entry) => entry.id),
    open_human_only: open.filter((entry) => entry.humanAction).map((entry) => entry.id),
    truth_mismatches: truthMismatches(scenario.truth, fields),
    normalised,
    file_code: decision.code,
  };
}

function identity(run, scenario) {
  return {
    scenario_id: scenario.id,
    arm: run.arm,
    repeat: run.repeat,
    model: run.model,
    deployed_sha: run.deployed_sha ?? null,
    turns: run.turns ?? null,
    tool_calls: Array.isArray(run.tool_calls) ? run.tool_calls.length : null,
    refusals: Array.isArray(run.tool_calls)
      ? run.tool_calls.filter((call) => call && call.refused).length
      : null,
    attempted_human_only: Boolean(run.attempted_human_only),
    technical_failure: Boolean(run.technical_failure),
  };
}
