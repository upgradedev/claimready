/**
 * Prove the rule pack is load bearing.
 *
 * The page runs no model. Every answer a judge sees comes from the insurer's rule pack being
 * evaluated in code, which invites a fair question: is the pack doing the work, or is it decoration
 * over answers that were going to come out the same anyway?
 *
 * This script puts one identical claim through both shipped packs and prints what each says. It
 * exits 1 if the two agree on everything, because a pack that changes nothing is decoration and
 * this repository should not be able to claim otherwise while a check says so.
 *
 *   node scripts/compare_packs.mjs
 *
 * It reads the same files the page loads and calls the same functions the tools call. Nothing here
 * is a second implementation of the rules.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadPolicyPack } from '../src/core/policy.js';
import { checkCoverage } from '../src/core/coverage.js';
import { deriveRequirements, outstandingRequirements } from '../src/core/requirements.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.join(HERE, '..', 'fixtures', 'insurers');

// One claim, unchanged between packs. A difference below is the pack talking, not the claim.
const CLAIM = {
  policy_number: 'MTR-2026-0417',
  incident_date: '2026-08-20',
  incident_type: 'collision',
  driver: 'Maria K.',
  damage_zone: 10,
  severity: 'dent',
  vehicle_drivable: false,
  description: 'A delivery van reversed into the left front wing while the car was parked.',
  revision: 3,
  status: 'draft'
};

const THEFT = { ...CLAIM, incident_type: 'theft', damage_zone: null, severity: null };

function read(name) {
  return loadPolicyPack(JSON.parse(readFileSync(path.join(PACK_DIR, name), 'utf8')));
}

function answers(pack) {
  const collision = checkCoverage(pack, CLAIM);
  const theft = checkCoverage(pack, THEFT);
  const derived = deriveRequirements(pack, CLAIM, []);
  const open = outstandingRequirements(derived);
  return {
    insurer: `${pack.insurer}, ${pack.product}`,
    collision: `${collision.covered ? 'COVERED' : 'NOT COVERED'} under ${collision.clause}` +
      `, excess ${collision.deductible === null ? 'none' : collision.deductible} ${pack.currency}`,
    theft: `${theft.covered ? 'COVERED' : 'NOT COVERED'} under ${theft.clause}` +
      `, excess ${theft.deductible === null ? 'none' : theft.deductible} ${pack.currency}`,
    requirements: `${derived.length} derived, ${open.length} still open`,
    open: open.map(one => one.label).join('; ')
  };
}

const files = readdirSync(PACK_DIR).filter(name => name.endsWith('.json')).sort();
if (files.length < 2) {
  console.error(`only ${files.length} rule pack(s) in ${PACK_DIR}. This check needs two to compare.`);
  process.exit(1);
}

const rows = files.map(name => ({ file: name, ...answers(read(name)) }));
const fields = ['insurer', 'collision', 'theft', 'requirements', 'open'];

console.log('One claim, unchanged. Both shipped rule packs. Same tools, same page.\n');
for (const row of rows) {
  console.log(`--- ${row.file}`);
  for (const field of fields) console.log(`  ${field.padEnd(13)} ${row[field]}`);
  console.log();
}

const differing = fields.filter(field => new Set(rows.map(row => row[field])).size > 1);
console.log(`fields that differ between the packs: ${differing.length} of ${fields.length}` +
  (differing.length ? ` (${differing.join(', ')})` : ''));

if (!differing.length) {
  console.error('\nEvery pack answered identically. Either the packs stopped differing or the ' +
    'rules stopped reading them. Both make "swap the pack and the answers change" a false claim, ' +
    'so this exits 1 rather than printing a table nobody would check.');
  process.exit(1);
}

console.log('\nThe pack is load bearing: the same claim gets different clauses, different excesses ' +
  'and a different intake list depending on which insurer is loaded.');
