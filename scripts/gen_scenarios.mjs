#!/usr/bin/env node
/**
 * Seeded, deterministic generator of adversarial patch scenarios.
 *
 * WHY THIS EXISTS. The hand written fixtures describe a claim a real customer might file. This
 * file describes the claims nobody files: a clock position of 13, a date in the last policy year,
 * an enum shouted in capitals, a description longer than the field allows, a batch whose second
 * change is poison, a revision that has already moved, a field a person pinned, a path nothing may
 * write. Those are the inputs a model actually produces when it is guessing, and they are exactly
 * the inputs a curated corpus never contains.
 *
 * EVERY SCENARIO CARRIES ITS ORACLE. A generator that emits inputs and no expected outcome is a
 * fuzzer, and a fuzzer cannot fail a build. Each scenario here names the exact refusal code from
 * PATCH_CODES that applyPatch must answer with, or says plainly that the patch is accepted. Two
 * of the eight edge cases in the brief are accepted rather than refused, and finding that out by
 * reading src/core/claim.js rather than assuming is the reason the oracle is worth anything:
 *
 *   - an enum in the wrong case is COERCED. enumField lowercases before it compares, so
 *     "COLLISION" is stored as "collision" and the patch succeeds.
 *   - a date before the policy started is ACCEPTED by the patch layer. isIsoDate checks the
 *     calendar, not the schedule. Whether the incident falls outside cover is a question for
 *     check_coverage and clause PL-1.2, and it is deliberately not the patch layer's to answer.
 *
 * Encoding either of those as a refusal would have produced a corpus that fails against correct
 * code, which is worse than no corpus.
 *
 * DETERMINISM. Scenario N depends only on the seed and on N. The generator seeds a fresh
 * generator per scenario from a hash of the two, so scenario 47 is identical whether you ask for
 * 50 scenarios or for that one alone, and `--number 47` reproduces a CI failure with no other
 * state. Nothing here reads the clock, the filesystem or the network.
 *
 * DEPENDENCY FREE. Node built ins only, and the constants come from src/core/claim.js so the
 * corpus cannot drift away from the rules it is checking.
 */

import {
  INCIDENT_TYPES,
  SEVERITIES,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  PATCHABLE_FIELDS,
  PATCH_CODES,
  DESCRIPTION_MAX_LENGTH,
  createClaim,
  hydrateClaim,
} from '../src/core/claim.js';

/** The seed used when nobody names one. Changing it changes every scenario, so it is pinned. */
export const DEFAULT_SEED = 20260903;

/** How many scenarios `--count` produces when nobody names a number. */
export const DEFAULT_COUNT = 40;

/* ------------------------------------------------------------ pinned limits */

/**
 * Limits restated as literals, next to the imported constant they must equal.
 *
 * A fixture built from the same constant the code reads cannot fail: move DESCRIPTION_MAX_LENGTH
 * to 500 and a `repeat(DESCRIPTION_MAX_LENGTH + 1)` fixture quietly follows it. So the number is
 * written out here as well, and the two are compared at generation time. If somebody changes the
 * limit, this throws and names the file to change, instead of a corpus silently agreeing.
 */
const PINNED = {
  DESCRIPTION_MAX_LENGTH: 240,
};

function assertPinned() {
  if (DESCRIPTION_MAX_LENGTH !== PINNED.DESCRIPTION_MAX_LENGTH) {
    throw new Error(
      `DESCRIPTION_MAX_LENGTH is ${DESCRIPTION_MAX_LENGTH} but scripts/gen_scenarios.mjs pins it at `
      + `${PINNED.DESCRIPTION_MAX_LENGTH}. One of the two is wrong. Change the literal in PINNED `
      + 'only after checking every other copy of the limit.',
    );
  }
}

/* -------------------------------------------------------------------- rng */

/** 32 bit mix, so a seed and an index become one well spread starting state. */
function hashSeed(seed, index) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (index + 0x85ebca6b), 0xcc9e2d51) >>> 0;
  h = ((h << 13) | (h >>> 19)) >>> 0;
  h = Math.imul(h, 0x1b873593) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32. Small, dependency free, and the same sequence on every platform. */
function rngFrom(state) {
  let a = state >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const intBetween = (rng, low, high) => low + Math.floor(rng() * (high - low + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ------------------------------------------------------------------ pieces */

/** A description that is definitely inside the limit, for the valid half of a batch. */
const GOOD_DESCRIPTION = 'A van reversed into the wing while the car was parked and left a crease.';

const PROTECTED_TARGETS = ['status', 'revision', 'provenance', 'locked', 'reference', 'filed_at'];
const DERIVED_TARGETS = ['coverage', 'validation', 'requirements', 'deductible', 'estimate'];
const UNKNOWN_FIELDS = ['colour', 'vin', 'excess', 'claim_total', 'drivable', 'incidentDate'];

/** A valid change, used as the innocent first half of a batch whose second half is poison. */
function goodChange(rng) {
  return pick(rng, [
    { field: 'severity', value: pick(rng, SEVERITIES) },
    { field: 'damage_zone', value: intBetween(rng, 1, 12) },
    { field: 'vehicle_drivable', value: rng() < 0.5 },
    { field: 'description', value: GOOD_DESCRIPTION },
    { field: 'location', value: 'Car park, Harbour Road' },
  ]);
}

/**
 * The kinds, in a fixed order. Scenario N is kind N modulo this list, so the corpus spreads
 * evenly and a scenario number maps to a kind without consulting the seed.
 */
const KINDS = [
  'zone_out_of_range',
  'zone_not_whole',
  'date_before_policy_start',
  'date_not_a_calendar_day',
  'enum_wrong_case',
  'enum_unknown_value',
  'description_over_budget',
  'description_far_over_budget',
  'batch_second_change_invalid',
  'stale_base_revision',
  'missing_base_revision',
  'locked_field',
  'protected_path',
  'derived_path',
  'unknown_field',
  'duplicate_field_in_one_patch',
  'clear_required_field',
  'clear_optional_field',
];

/* --------------------------------------------------------------- scenarios */

/**
 * Build one scenario from the seed and its number.
 *
 * PRECEDENCE IS RESPECTED. applyPatch checks a filed claim, then staleness, then the shape of the
 * change list, then per change: protected, unknown, locked, null on a required field, and finally
 * the value itself. The first failure wins. So every scenario that is testing a per field refusal
 * carries a correct baseRevision, or staleness would answer first and the oracle would be wrong.
 *
 * @param {number} seed
 * @param {number} number zero based scenario number
 * @returns {object} scenario
 */
export function makeScenario(seed, number) {
  assertPinned();

  const rng = rngFrom(hashSeed(seed, number));
  const kind = KINDS[number % KINDS.length];

  // A claim that already holds a few answers, so a patch has something to collide with. The
  // revision is moved on deliberately: a scenario whose claim sits at revision 0 cannot tell a
  // correct baseRevision apart from a forgotten one.
  const revision = intBetween(rng, 1, 9);
  const setup = {
    revision,
    status: 'draft',
    locked: [],
    values: {
      incident_date: '2026-08-20',
      incident_type: 'collision',
      driver: 'Maria K.',
    },
  };

  const base = {
    number,
    seed,
    kind,
    actor: 'agent',
    baseRevision: revision,
    setup,
  };

  const accepted = (changes, note) => ({
    ...base,
    changes,
    expect: { ok: true, code: null, revisionAfter: revision + 1, appliedCount: changes.length },
    note,
  });

  const refused = (changes, code, note, errorIncludes) => ({
    ...base,
    changes,
    expect: { ok: false, code, revisionAfter: revision, appliedCount: 0, errorIncludes: errorIncludes || null },
    note,
  });

  switch (kind) {
    case 'zone_out_of_range': {
      // Includes 13 by construction, and 0 and negatives, which are the other side of the range.
      // The blank string is here deliberately: Number('') is 0, so a whitespace value does not
      // fail as unparseable, it silently becomes a zero and is caught by the range check instead.
      // The numeric string is here for the same reason in the other direction, because an agent
      // sending "13" must be refused exactly like an agent sending 13.
      const raw = pick(rng, [13, 13, '13', 0, -1, '  ', intBetween(rng, 14, 99)]);
      const coerced = typeof raw === 'string' ? Number(raw.trim()) : raw;
      return refused(
        [{ field: 'damage_zone', value: raw }],
        PATCH_CODES.value,
        `damage_zone ${JSON.stringify(raw)} resolves to ${coerced}, which is off the clock face.`,
        `damage_zone ${coerced} is out of range`,
      );
    }

    case 'zone_not_whole': {
      // Values that cannot become a whole number at all, which is a different refusal from a
      // whole number in the wrong range.
      const zone = pick(rng, [4.5, '12abc', 'front', true, 12.0001]);
      return refused(
        [{ field: 'damage_zone', value: zone }],
        PATCH_CODES.value,
        `damage_zone ${JSON.stringify(zone)} is not a whole clock position at all.`,
        'damage_zone must be a whole clock position',
      );
    }

    case 'date_before_policy_start': {
      // ACCEPTED. The policy period is a cover question, not a patch question.
      const date = `202${intBetween(rng, 0, 5)}-${String(intBetween(rng, 1, 12)).padStart(2, '0')}-1${intBetween(rng, 0, 8)}`;
      return accepted(
        [{ field: 'incident_date', value: date }],
        `The patch layer accepts ${date}. Whether it falls outside the policy period is answered `
        + 'by check_coverage against clause PL-1.2, not by applyPatch.',
      );
    }

    case 'date_not_a_calendar_day': {
      const date = pick(rng, ['2026-02-30', '2026-13-01', '2026-04-31', '2026-00-10', '1999-06-01']);
      return refused(
        [{ field: 'incident_date', value: date }],
        PATCH_CODES.value,
        `${date} is not a real calendar date in range.`,
        'incident_date must be a real calendar date',
      );
    }

    case 'enum_wrong_case': {
      // ACCEPTED and coerced. enumField trims and lowercases before comparing.
      const chosen = pick(rng, INCIDENT_TYPES);
      const shouted = rng() < 0.5 ? chosen.toUpperCase() : `  ${chosen[0].toUpperCase()}${chosen.slice(1)}  `;
      return {
        ...accepted(
          [{ field: 'incident_type', value: shouted }],
          `"${shouted}" is coerced to "${chosen}". Wrong case is not an error, it is normalised.`,
        ),
        expectStored: { incident_type: chosen },
      };
    }

    case 'enum_unknown_value': {
      const value = pick(rng, ['meteor', 'act of god', 'collision2', 'THEFTT', 'water']);
      return refused(
        [{ field: 'incident_type', value }],
        PATCH_CODES.value,
        `"${value}" is not an incident type this insurer recognises.`,
        'is not a valid incident type',
      );
    }

    case 'description_over_budget': {
      // Derived from the imported constant, so it sits exactly one character over wherever the
      // limit is. Its sibling below is an absolute length, which is the one that notices a move.
      const text = 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1);
      return refused(
        [{ field: 'description', value: text }],
        PATCH_CODES.value,
        `description at ${text.length} characters is one over the limit of ${DESCRIPTION_MAX_LENGTH}.`,
        `the limit is ${DESCRIPTION_MAX_LENGTH}`,
      );
    }

    case 'description_far_over_budget': {
      // A hardcoded length on purpose. This scenario starts from a different offset than the
      // limit, so it still fails if somebody edits DESCRIPTION_MAX_LENGTH and the derived
      // scenario above follows the edit.
      const text = 'The van reversed into the wing. '.repeat(40);
      return refused(
        [{ field: 'description', value: text }],
        PATCH_CODES.value,
        `description at ${text.trim().length} characters is far over the pinned limit of ${PINNED.DESCRIPTION_MAX_LENGTH}.`,
        `the limit is ${PINNED.DESCRIPTION_MAX_LENGTH}`,
      );
    }

    case 'batch_second_change_invalid': {
      // The whole point of an atomic patch. The first change is perfectly good and must not
      // survive the refusal of the second.
      const first = goodChange(rng);
      const poison = pick(rng, [
        { field: 'damage_zone', value: 13 },
        { field: 'incident_type', value: 'meteor' },
        { field: 'severity', value: 'catastrophic' },
        { field: 'incident_date', value: '2026-02-30' },
      ]);
      const changes = first.field === poison.field
        ? [{ field: 'location', value: 'Mill Street' }, poison]
        : [first, poison];
      return refused(
        changes,
        PATCH_CODES.value,
        `The first change (${changes[0].field}) is valid and the second (${poison.field}) is not. `
        + 'Nothing is written and the revision does not move.',
      );
    }

    case 'stale_base_revision': {
      const behind = intBetween(rng, 0, revision - 1);
      return {
        ...refused(
          [goodChange(rng)],
          PATCH_CODES.stale,
          `The agent quotes revision ${behind} while the claim is at ${revision}.`,
          `expected revision ${behind}, current revision ${revision}`,
        ),
        baseRevision: behind,
      };
    }

    case 'missing_base_revision': {
      return {
        ...refused(
          [goodChange(rng)],
          PATCH_CODES.stale,
          'An agent patch that carries no baseRevision is refused as stale rather than applied.',
          'has to carry baseRevision',
        ),
        baseRevision: null,
      };
    }

    case 'locked_field': {
      const field = pick(rng, ['severity', 'damage_zone', 'incident_type', 'description']);
      const value = field === 'damage_zone'
        ? intBetween(rng, 1, 12)
        : field === 'severity'
          ? pick(rng, SEVERITIES)
          : field === 'incident_type'
            ? pick(rng, INCIDENT_TYPES)
            : GOOD_DESCRIPTION;
      return {
        ...refused(
          [{ field, value }],
          PATCH_CODES.locked,
          `A person pinned ${field} on the page, so no patch may move it, however fresh the revision is.`,
          'was pinned by the person on the page',
        ),
        setup: { ...setup, locked: [field] },
      };
    }

    case 'protected_path': {
      const field = pick(rng, PROTECTED_TARGETS);
      return refused(
        [{ field, value: pick(rng, ['filed', 99, 'anything']) }],
        PATCH_CODES.protected,
        `${field} is bookkeeping the insurer's page owns. Neither side may patch it.`,
        'is not patchable by anyone',
      );
    }

    case 'derived_path': {
      const field = pick(rng, DERIVED_TARGETS);
      return refused(
        [{ field, value: true }],
        PATCH_CODES.protected,
        `${field} is computed from the claim, so writing to it is refused as protected rather than `
        + 'as an unknown field.',
        'is not patchable by anyone',
      );
    }

    case 'unknown_field': {
      const field = pick(rng, UNKNOWN_FIELDS);
      return refused(
        [{ field, value: 'blue' }],
        PATCH_CODES.field,
        `${field} is not a field on this claim, and the refusal lists the ones that are.`,
        'is not a field on this claim',
      );
    }

    case 'duplicate_field_in_one_patch': {
      const field = pick(rng, ['severity', 'damage_zone', 'location']);
      const one = field === 'damage_zone' ? 3 : field === 'severity' ? 'dent' : 'Mill Street';
      const two = field === 'damage_zone' ? 9 : field === 'severity' ? 'structural' : 'Harbour Road';
      return refused(
        [{ field, value: one }, { field, value: two }],
        PATCH_CODES.field,
        `${field} is named twice in one patch, so the intended end value is ambiguous.`,
        'appears twice in one patch',
      );
    }

    case 'clear_required_field': {
      const field = pick(rng, REQUIRED_FIELDS);
      return refused(
        [{ field, value: null }],
        PATCH_CODES.value,
        `${field} is required, so it cannot be cleared to null.`,
        'is required, so it cannot be cleared',
      );
    }

    case 'clear_optional_field': {
      // ACCEPTED. Clearing an optional field is a real thing a claimant does.
      const field = pick(rng, OPTIONAL_FIELDS);
      return accepted(
        [{ field, value: null }],
        `${field} is optional, so clearing it to null is accepted and the revision advances.`,
      );
    }

    default:
      throw new Error(`Unhandled scenario kind "${kind}". Add it to the switch or remove it from KINDS.`);
  }
}

/**
 * The whole corpus for a seed.
 *
 * @param {{seed?: number, count?: number}} [options]
 * @returns {object[]}
 */
export function generateScenarios(options = {}) {
  const seed = Number.isInteger(options.seed) ? options.seed : DEFAULT_SEED;
  const count = Number.isInteger(options.count) ? options.count : DEFAULT_COUNT;
  if (count < 1) throw new RangeError('count must be at least 1.');
  const out = [];
  for (let n = 0; n < count; n += 1) out.push(makeScenario(seed, n));
  return out;
}

/**
 * Build the claim a scenario starts from.
 *
 * Kept here rather than in the test, so the corpus and the thing it is run against cannot drift.
 * The claim is seeded through createClaim, which pushes every value through the same validators a
 * patch uses, then hydrated to place the revision and the locks that createClaim will not set.
 *
 * @param {object} scenario
 * @returns {object} a claim ready to hand to applyPatch
 */
export function buildClaim(scenario) {
  const seeded = createClaim({ claim: scenario.setup.values });
  return hydrateClaim({
    ...seeded,
    revision: scenario.setup.revision,
    status: scenario.setup.status,
    locked: scenario.setup.locked,
  });
}

/* --------------------------------------------------------------------- cli */

const SNIPPET = `// tests/unit/scenarios.test.js
// Add this file. Nothing under tests/ was edited by the agent that wrote the generator.
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPatch } from '../../src/core/claim.js';
import { generateScenarios, buildClaim } from '../../scripts/gen_scenarios.mjs';

for (const scenario of generateScenarios()) {
  test(\`scenario \${scenario.number} (\${scenario.kind})\`, () => {
    const claim = buildClaim(scenario);
    const result = applyPatch(claim, scenario.changes, {
      actor: scenario.actor,
      baseRevision: scenario.baseRevision,
    });

    assert.equal(result.ok, scenario.expect.ok, scenario.note);
    assert.equal(result.code, scenario.expect.code);
    assert.equal(result.revision, scenario.expect.revisionAfter);
    assert.equal(result.applied.length, scenario.expect.appliedCount);

    if (scenario.expect.errorIncludes) {
      assert.ok(
        String(result.error).includes(scenario.expect.errorIncludes),
        \`scenario \${scenario.number}: expected the refusal to mention \` +
          \`"\${scenario.expect.errorIncludes}" but it said: \${result.error}\`,
      );
    }

    // A refused patch must leave the draft untouched, not merely report that it did.
    if (!scenario.expect.ok) {
      assert.deepEqual(result.claim, claim);
    }

    // Coercion is asserted where the scenario pins a stored value.
    if (scenario.expectStored) {
      for (const [field, value] of Object.entries(scenario.expectStored)) {
        assert.equal(result.claim[field], value);
      }
    }
  });
}
`;

function usage() {
  return [
    'Usage: node scripts/gen_scenarios.mjs [options]',
    '',
    `  --seed <n>     Seed for the corpus. Default ${DEFAULT_SEED}.`,
    `  --count <n>    How many scenarios. Default ${DEFAULT_COUNT}.`,
    '  --number <n>   Print one scenario in full. Reproduces a CI failure from its number alone.',
    '  --json         Print the corpus as JSON.',
    '  --snippet      Print the test file that consumes this generator, and where to put it.',
    '  --help         This text.',
    '',
    'The corpus is a pure function of the seed and the scenario number. Nothing here reads the',
    'clock, the filesystem or the network, so the same seed gives the same corpus everywhere.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { seed: DEFAULT_SEED, count: DEFAULT_COUNT, number: null, json: false, snippet: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--snippet') args.snippet = true;
    else if (arg === '--seed') { args.seed = Number(argv[i += 1]); }
    else if (arg === '--count') { args.count = Number(argv[i += 1]); }
    else if (arg === '--number') { args.number = Number(argv[i += 1]); }
    else throw new Error(`Unknown option "${arg}". Run with --help.`);
  }
  if (!Number.isInteger(args.seed)) throw new Error('--seed must be a whole number.');
  if (!Number.isInteger(args.count)) throw new Error('--count must be a whole number.');
  if (args.number !== null && !Number.isInteger(args.number)) throw new Error('--number must be a whole number.');
  return args;
}

function describe(scenario) {
  const verdict = scenario.expect.ok
    ? 'ACCEPTED'
    : `REFUSED ${scenario.expect.code}`;
  return [
    `#${scenario.number}  ${scenario.kind}`,
    `  verdict     ${verdict}`,
    `  baseRevision ${JSON.stringify(scenario.baseRevision)} against a claim at revision ${scenario.setup.revision}`,
    scenario.setup.locked.length ? `  pinned      ${scenario.setup.locked.join(', ')}` : null,
    `  changes     ${JSON.stringify(scenario.changes)}`,
    `  why         ${scenario.note}`,
  ].filter(Boolean).join('\n');
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  if (args.help) { console.log(usage()); return 0; }
  if (args.snippet) {
    console.log('Add the following as tests/unit/scenarios.test.js:');
    console.log('');
    console.log(SNIPPET);
    return 0;
  }

  if (args.number !== null) {
    const scenario = makeScenario(args.seed, args.number);
    console.log(args.json ? JSON.stringify(scenario, null, 2) : describe(scenario));
    return 0;
  }

  const corpus = generateScenarios({ seed: args.seed, count: args.count });

  if (args.json) { console.log(JSON.stringify(corpus, null, 2)); return 0; }

  console.log(`${corpus.length} scenarios from seed ${args.seed}.`);
  console.log('');
  for (const scenario of corpus) { console.log(describe(scenario)); console.log(''); }

  const refused = corpus.filter((s) => !s.expect.ok).length;
  console.log(`${refused} refused, ${corpus.length - refused} accepted.`);
  console.log('Reproduce any one of them with: node scripts/gen_scenarios.mjs --number <n>');
  return 0;
}

// Only runs as a command. Importing this file must have no side effect beyond the exports.
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/gen_scenarios.mjs');
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
