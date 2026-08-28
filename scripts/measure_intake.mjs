#!/usr/bin/env node
/**
 * How many questions the intake asks, counted rather than asserted.
 *
 * Zero dependencies, Node 20, no network. Run it with:
 *
 *   node scripts/measure_intake.mjs
 *
 * WHAT THIS MEASURES, AND THE THREE THINGS IT IS NOT. It reads the rule packs in
 * fixtures/insurers/ and the required field list in src/core/claim.js, both of which are files in
 * this repository, and counts fields. That is the whole scope.
 *
 *   1. It is a measurement of THIS REPOSITORY'S OWN invented rule packs. Kestrel Assurance and
 *      Northwind Mutual do not exist. Nothing here is a measurement of any real insurer's intake
 *      form, and no real form was looked at.
 *   2. It is reproducible in one line. The command is printed in the output, above the numbers.
 *   3. It is not extrapolated. There is no claim about time, money, completion rates or how many
 *      claims anyone files. A field is counted, and nothing is inferred from the count.
 *
 * TWO COLUMNS, BECAUSE ONE WOULD BE MISLEADING WHICHEVER ONE IT WAS.
 *
 *   AT MOST is an envelope: the incident type is fixed and every other answer on the claim is left
 *   free, so the column is the union of every field any rule in that pack could ask for once the
 *   claimant has answered everything. It is computed by enumerating the values of every field the
 *   pack's own conditions read, exhaustively, not by sampling.
 *
 *   RIGHT NOW is a snapshot: the same pack, the same incident type, and nothing else answered yet.
 *   It is smaller, because a rule keyed on the severity or on whether the car drives cannot match
 *   until those are answered.
 *
 * The static form count this compares against is itself an envelope, over both packs and every
 * incident type, so AT MOST is the column that compares like with like and it is the one the
 * headline sentence uses. RIGHT NOW is printed beside it so a reader can see the count rise as
 * answers arrive, which is the mechanism the page is actually built on. Publishing only the
 * snapshot would be reading a wide number against a narrow one and calling the gap a result.
 *
 * WHAT IS DELIBERATELY OUTSIDE BOTH COUNTS is printed at the end rather than left silent: an
 * optional field no pack names, and the requirement no field can answer at all.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadPolicyPack } from '../src/core/policy.js';
import { packFieldDemands } from '../src/core/requirements.js';
import {
  createClaim,
  requiredFieldsFor,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  INCIDENT_TYPES,
  SEVERITIES,
  DAMAGE_ZONES,
} from '../src/core/claim.js';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const PACK_DIR = join(ROOT, 'fixtures', 'insurers');

/** The command a reader runs to get exactly this output. Printed, so it never has to be guessed. */
const COMMAND = 'node scripts/measure_intake.mjs';

/**
 * The values a conditioning field can hold, for the exhaustive enumeration.
 *
 * A field the packs read but that is not listed here is enumerated as answered or not answered,
 * which is all any condition in the contract can ask of a free text field: `is_set` and
 * `is_not_set` are the only operators that apply to one.
 */
const VALUE_DOMAINS = {
  incident_type: INCIDENT_TYPES,
  severity: SEVERITIES,
  vehicle_drivable: [true, false],
  damage_zone: DAMAGE_ZONES,
};

/** Any answer at all, for a free text field whose value no condition compares. */
const TEXT_PROBE = 'x';

/**
 * A ceiling on the enumeration, so a future pack that reads six fields fails loudly here instead
 * of hanging. Both shipped packs read three fields and produce a few dozen combinations.
 */
const MAX_COMBINATIONS = 50000;

/** Print fields in the order the page asks them, so two rows are comparable by eye. */
const FIELD_ORDER = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

function inFieldOrder(fields) {
  const known = FIELD_ORDER.filter((field) => fields.has(field));
  const rest = [...fields].filter((field) => !FIELD_ORDER.includes(field)).sort();
  return [...known, ...rest];
}

/* ------------------------------------------------------------------- packs */

/**
 * Every pack in fixtures/insurers/, discovered rather than named.
 *
 * Listing the directory is the load bearing part. A hardcoded pair would report the same two
 * numbers the day a third pack landed, and the count in the headline would quietly stop being a
 * measurement of what ships.
 *
 * @returns {Array<{file: string, pack: object}>}
 */
function loadPacks() {
  const files = readdirSync(PACK_DIR).filter((name) => name.endsWith('.json')).sort();
  return files.map((file) => ({
    file: `fixtures/insurers/${file}`,
    pack: loadPolicyPack(JSON.parse(readFileSync(join(PACK_DIR, file), 'utf8'))),
  }));
}

/**
 * Every claim field the conditions in this pack read, walking any_of and all_of.
 *
 * This is what makes the envelope exhaustive rather than a guess. The enumeration below varies
 * exactly these fields, so no rule in the pack can be missed because nobody thought to vary the
 * field it keys on.
 *
 * @param {object} pack
 * @returns {string[]}
 */
export function conditionFields(pack) {
  const found = new Set();
  const walk = (when) => {
    if (!when || typeof when !== 'object') return;
    if (Array.isArray(when.any_of)) {
      when.any_of.forEach(walk);
      return;
    }
    if (Array.isArray(when.all_of)) {
      when.all_of.forEach(walk);
      return;
    }
    if (typeof when.field === 'string') found.add(when.field);
  };
  for (const rule of pack.requirements) walk(rule.when);
  return [...found].sort();
}

/** The cartesian product of a list of per field option lists. One empty combination when empty. */
function crossProduct(lists) {
  let out = [[]];
  for (const list of lists) {
    const next = [];
    for (const partial of out) {
      for (const option of list) next.push([...partial, option]);
    }
    out = next;
  }
  return out;
}

/**
 * The most this pack can ask for on a claim of this incident type, and the least.
 *
 * `atMost` fixes the incident type, then varies every other field the pack's conditions read,
 * through every value in its domain plus not answered at all, and unions the fields asked across
 * the lot. `rightNow` answers the incident type and nothing else.
 *
 * The page's own required list is unioned in on both, because a field the page insists on is a
 * question the claimant is asked whether or not a pack mentions it. `incident_type` itself is the
 * clearest case: neither shipped pack names it, and no cover check can run without it.
 *
 * @param {object} pack
 * @param {string} incidentType
 * @returns {{atMost: Set<string>, rightNow: Set<string>, humanOnly: Set<string>, combinations: number}}
 */
export function askedFor(pack, incidentType) {
  const free = conditionFields(pack).filter((field) => field !== 'incident_type');
  const lists = free.map((field) => {
    const domain = VALUE_DOMAINS[field] || [TEXT_PROBE];
    return [null, ...domain].map((value) => [field, value]);
  });

  const size = lists.reduce((total, list) => total * list.length, 1);
  if (size > MAX_COMBINATIONS) {
    throw new Error(
      `pack "${pack.id}" reads ${free.length} conditioning fields, which is ${size} combinations, `
      + `over the ceiling of ${MAX_COMBINATIONS}. Raise the ceiling deliberately or narrow the pack.`,
    );
  }

  const atMost = new Set();
  const humanOnly = new Set();
  let combinations = 0;

  for (const combo of crossProduct(lists)) {
    const seed = { incident_type: incidentType };
    for (const [field, value] of combo) {
      if (value !== null) seed[field] = value;
    }
    const claim = createClaim(seed);
    const demands = packFieldDemands(pack, claim);
    for (const field of requiredFieldsFor(claim)) atMost.add(field);
    for (const field of demands.asked) atMost.add(field);
    for (const id of demands.humanOnly) humanOnly.add(id);
    combinations += 1;
  }

  const bare = createClaim({ incident_type: incidentType });
  const rightNow = new Set([
    ...requiredFieldsFor(bare),
    ...packFieldDemands(pack, bare).asked,
  ]);

  return { atMost, rightNow, humanOnly, combinations };
}

/**
 * Every field a static form would have to carry.
 *
 * The union of every field any rule in any shipped pack names, under any condition, plus the
 * fields the page's own gate requires of every claim. A static form is printed before the
 * claimant arrives, so it cannot know which of the two policies it is looking at, and it cannot
 * know what kind of incident it was either. It has to carry all of them.
 *
 * @param {Array<{pack: object}>} packs
 * @returns {{fields: Set<string>, byPack: Array<{id: string, insurer: string, fields: string[]}>,
 *            core: string[]}}
 */
export function staticFormFields(packs) {
  const empty = createClaim({});
  const fields = new Set(REQUIRED_FIELDS);
  const byPack = [];
  for (const { pack } of packs) {
    const named = packFieldDemands(pack, empty).named;
    for (const field of named) fields.add(field);
    byPack.push({ id: pack.id, insurer: pack.insurer, fields: inFieldOrder(new Set(named)) });
  }
  return { fields, byPack, core: [...REQUIRED_FIELDS] };
}

/**
 * The pack and incident type the shipped sample claim opens on, or null when it cannot be read.
 *
 * Read from the fixture rather than typed here, so the row the documents quote follows the demo if
 * the demo ever changes. A missing or unreadable fixture is not fatal: the table above still stands
 * and this paragraph is simply not printed.
 *
 * @returns {{file: string, packId: string, incidentType: string}|null}
 */
function demoDefault() {
  const file = 'fixtures/demo-collision.json';
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'demo-collision.json'), 'utf8'));
    const packId = typeof raw.insurer_pack === 'string' ? raw.insurer_pack : null;
    const incidentType = raw.claim && typeof raw.claim.incident_type === 'string'
      ? raw.claim.incident_type
      : null;
    if (!packId || !incidentType) return null;
    return { file, packId, incidentType };
  } catch {
    return null;
  }
}

/**
 * Why a field a static form carries is not asked for on this claim.
 *
 * The reason is the pack's own condition, printed verbatim as it appears in the JSON, so a reader
 * can open the pack file and check the sentence rather than believe it.
 *
 * @param {object} pack
 * @param {string} field
 * @returns {string}
 */
export function reasonNotAsked(pack, field) {
  const rules = pack.requirements.filter(
    (rule) => rule.satisfied_by && rule.satisfied_by.field === field,
  );
  if (rules.length === 0) return `no rule in the ${pack.id} pack names it`;
  return rules
    .map((rule) => `rule "${rule.id}" asks for it only when ${JSON.stringify(rule.when)}`)
    .join('; ');
}

/* ------------------------------------------------------------------ report */

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padLeft(value, width) {
  const text = String(value);
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

function wrapList(fields, indent) {
  const lines = [];
  let line = '';
  for (const field of fields) {
    const piece = line === '' ? field : `, ${field}`;
    if (line.length + piece.length > 88) {
      lines.push(indent + line);
      line = field;
    } else {
      line += piece;
    }
  }
  if (line !== '') lines.push(indent + line);
  return lines;
}

export function buildReport() {
  const packs = loadPacks();
  const out = [];
  const say = (line = '') => out.push(line);

  const stat = staticFormFields(packs);
  const staticFields = inFieldOrder(stat.fields);
  const staticCount = staticFields.length;

  say('ClaimReady intake measurement');
  say('=============================');
  say('');
  say(`command: ${COMMAND}`);
  say(`measured: the ${packs.length} insurer rule packs in fixtures/insurers/, plus the required`);
  say('          field list in src/core/claim.js. Both are files in this repository.');
  say('scope:    these packs are invented for this demo and belong to no real policy. This is not');
  say('          a measurement of any real insurer\'s form, and nothing here is extrapolated to');
  say('          time, money or how complete anyone\'s claims arrive.');
  say('');

  say('1. What a static form has to ask everyone');
  say('-----------------------------------------');
  say('A form printed before the claimant arrives cannot know which policy it is looking at or');
  say('what kind of incident it was, so it carries every box any pack could ever ask for.');
  say('');
  say(`  the page's own required fields, src/core/claim.js REQUIRED_FIELDS: ${stat.core.length}`);
  for (const line of wrapList(stat.core, '    ')) say(line);
  for (const entry of stat.byPack) {
    say(`  fields named by rules in ${entry.id} (${entry.insurer}): ${entry.fields.length}`);
    for (const line of wrapList(entry.fields, '    ')) say(line);
  }
  say('');
  say(`  UNION, what a static form asks everyone: ${staticCount}`);
  for (const line of wrapList(staticFields, '    ')) say(line);
  say('');

  say('2. What this page derives instead, per pack and incident type');
  say('-------------------------------------------------------------');
  say('AT MOST fixes the incident type and leaves every other answer free, so it is the union over');
  say('every value the pack conditions read. That is the same kind of number as the static count');
  say('above, an envelope against an envelope, and it is the one the sentence below uses.');
  say('RIGHT NOW is the same pack and incident type with nothing else answered yet. The count');
  say('climbs from RIGHT NOW towards AT MOST as the claimant answers, which is the whole mechanism.');
  say('');

  const rows = [];
  for (const { pack } of packs) {
    for (const incidentType of INCIDENT_TYPES) {
      const measured = askedFor(pack, incidentType);
      rows.push({
        pack,
        incidentType,
        atMost: inFieldOrder(measured.atMost),
        rightNow: inFieldOrder(measured.rightNow),
        humanOnly: [...measured.humanOnly],
        combinations: measured.combinations,
      });
    }
  }

  const header = `  ${pad('pack', 11)}${pad('incident', 11)}${padLeft('static', 7)}`
    + `${padLeft('at most', 9)}${padLeft('right now', 11)}   not asked at all`;
  say(header);
  say(`  ${'-'.repeat(header.length - 2)}`);
  for (const rowEntry of rows) {
    const dropped = staticFields.filter((field) => !rowEntry.atMost.includes(field));
    say(
      `  ${pad(rowEntry.pack.id, 11)}${pad(rowEntry.incidentType, 11)}${padLeft(staticCount, 7)}`
      + `${padLeft(rowEntry.atMost.length, 9)}${padLeft(rowEntry.rightNow.length, 11)}   `
      + `${dropped.length === 0 ? 'none' : dropped.join(', ')}`,
    );
  }
  say('');
  say('  Each AT MOST cell is a union over every combination of the fields that pack\'s conditions');
  say('  read, beyond the incident type itself. The enumeration is exhaustive, not sampled:');
  for (const { pack } of packs) {
    const free = conditionFields(pack).filter((field) => field !== 'incident_type');
    const first = rows.find((entry) => entry.pack.id === pack.id);
    say(
      `    ${pack.id}: conditions read ${free.length === 0 ? 'nothing else' : free.join(', ')}, `
      + `${first.combinations} combinations per incident type`,
    );
  }
  say('');

  say('3. Which questions drop out, and the rule that drops them');
  say('---------------------------------------------------------');
  say('The condition is printed as it appears in the pack JSON, so it can be checked against the');
  say('file rather than believed.');
  say('');
  for (const rowEntry of rows) {
    const dropped = staticFields.filter((field) => !rowEntry.atMost.includes(field));
    if (dropped.length === 0) continue;
    say(`  ${rowEntry.pack.id}, ${rowEntry.incidentType}`);
    for (const field of dropped) {
      say(`    ${field}: ${reasonNotAsked(rowEntry.pack, field)}`);
    }
  }
  say('');

  const widest = rows.reduce((best, r) => (r.atMost.length < best.atMost.length ? r : best), rows[0]);
  const narrowest = rows.reduce((best, r) => (r.atMost.length > best.atMost.length ? r : best), rows[0]);

  // THE HEADLINE QUOTES THE ROW A JUDGE ACTUALLY LANDS ON, not the widest gap in the table. The
  // sample claim the page loads decides which pack and which incident type a visitor sees first,
  // and quoting a different row to a reader looking at this one would be picking the flattering
  // end of our own table. The widest and narrowest are both printed underneath either way.
  const demo = demoDefault();
  const shown = demo
    ? rows.find((entry) => entry.pack.id === demo.packId && entry.incidentType === demo.incidentType)
    : null;
  const headline = shown || widest;

  say('4. The one sentence this supports, and no stronger one');
  say('------------------------------------------------------');
  say(`  A static form has to ask everyone for ${staticCount} questions because it cannot know which`);
  say(`  policy it is looking at, while for ${headline.pack.insurer} and a ${headline.incidentType} claim this page's`);
  say(`  intake asks for ${headline.atMost.length}, and the command that counts both is ${COMMAND}`);
  say('');
  if (shown) {
    say(`  That row is the one a visitor sees first: the sample claim in ${demo.file}`);
    say(`  opens on the ${demo.packId} pack and a ${demo.incidentType} claim.`);
  }
  say(`  The widest gap in the table above is ${staticCount} against ${widest.atMost.length}, ${widest.pack.insurer} on a ${widest.incidentType} claim.`);
  say(`  The narrowest is ${staticCount} against ${narrowest.atMost.length}, ${narrowest.pack.insurer} on a ${narrowest.incidentType} claim. Every row`);
  say('  is printed above, so neither end of the range is hidden.');
  say('  Nothing follows from these numbers about time, money, completion rates or any form outside');
  say('  this repository, and none of that is claimed anywhere.');
  say('');

  say('5. What is outside both counts, said rather than left silent');
  say('------------------------------------------------------------');
  const unnamed = OPTIONAL_FIELDS.filter((field) => !stat.fields.has(field));
  if (unnamed.length > 0) {
    say(`  Optional fields the page offers that no pack names: ${unnamed.join(', ')}.`);
    say('  The page carries the box, no rule asks for it, and it is counted on neither side.');
  }
  const humanOnly = new Set();
  for (const rowEntry of rows) for (const id of rowEntry.humanOnly) humanOnly.add(id);
  if (humanOnly.size > 0) {
    say(`  Requirements no field can answer at all: ${[...humanOnly].join(', ')}.`);
    say('  A person presses a control on the page for those. They are not form questions, so they');
    say('  are counted on neither side either, and no tool on this page reaches them.');
  }
  say('  Human actions and free text length limits are not counted. Only fields are.');
  say('');
  say(`counted by: ${COMMAND}`);

  return out.join('\n');
}

/* -------------------------------------------------------------------- main */

function main() {
  process.stdout.write(`${buildReport()}\n`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
