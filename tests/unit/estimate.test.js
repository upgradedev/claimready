import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  estimateRepair,
  ESTIMATE_CURRENCY,
  ESTIMATE_DISCLAIMER,
  VEHICLE_CLASSES,
} from '../../src/core/estimate.js';
import { DAMAGE_ZONES, SEVERITIES } from '../../src/core/claim.js';

const FIXTURE_URL = new URL('../../fixtures/demo-collision.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

function sumLines(band) {
  return band.lines.reduce((total, line) => total + line.cost, 0);
}

test('the currency here is the same one the policy is written in', () => {
  assert.equal(ESTIMATE_CURRENCY, fixture.policy.currency);
});

test('the fixture vehicle is a class the parts table can price', () => {
  assert.ok(
    VEHICLE_CLASSES.includes(fixture.policy.vehicle.class),
    `vehicle class "${fixture.policy.vehicle.class}" has no pricing factor`,
  );
});

test('the disclaimer never calls the band a prediction', () => {
  assert.match(ESTIMATE_DISCLAIMER, /not a quote/i);
  assert.match(ESTIMATE_DISCLAIMER, /not a prediction/i);
});

test('a band comes back with the shape the tools layer expects', () => {
  const band = estimateRepair({ zone: 10, severity: 'dent', vehicleClass: 'compact' });

  assert.deepEqual(Object.keys(band).sort(), ['currency', 'high', 'lines', 'low']);
  assert.equal(band.currency, 'EUR');
  assert.ok(Number.isFinite(band.low) && band.low > 0);
  assert.ok(Number.isFinite(band.high) && band.high > band.low);
  assert.ok(band.lines.length > 0);
  for (const line of band.lines) {
    assert.equal(typeof line.part, 'string');
    assert.ok(Number.isInteger(line.cost) && line.cost > 0, `${line.part} has no usable cost`);
  }
});

// The band is built from the parts, so containment is a property of the table
// rather than a margin applied after the fact. Sweeping everything proves it.
test('the lines always add up to something inside the band', () => {
  for (const zone of DAMAGE_ZONES) {
    for (const severity of SEVERITIES) {
      for (const vehicleClass of VEHICLE_CLASSES) {
        const band = estimateRepair({ zone, severity, vehicleClass });
        const total = sumLines(band);
        const where = `zone ${zone}, ${severity}, ${vehicleClass}`;
        assert.ok(total >= band.low, `${where}: lines total ${total} is below low ${band.low}`);
        assert.ok(total <= band.high, `${where}: lines total ${total} is above high ${band.high}`);
      }
    }
  }
});

test('heavier damage always costs more, at every zone and every vehicle class', () => {
  for (const zone of DAMAGE_ZONES) {
    for (const vehicleClass of VEHICLE_CLASSES) {
      const bands = SEVERITIES.map((severity) => estimateRepair({ zone, severity, vehicleClass }));
      for (let i = 1; i < bands.length; i += 1) {
        const where = `zone ${zone}, ${vehicleClass}, ${SEVERITIES[i - 1]} to ${SEVERITIES[i]}`;
        assert.ok(bands[i].low > bands[i - 1].low, `${where}: low did not rise`);
        assert.ok(bands[i].high > bands[i - 1].high, `${where}: high did not rise`);
      }
    }
  }
});

test('a bigger vehicle class always costs more, at every zone and severity', () => {
  for (const zone of DAMAGE_ZONES) {
    for (const severity of SEVERITIES) {
      const bands = VEHICLE_CLASSES.map((vehicleClass) =>
        estimateRepair({ zone, severity, vehicleClass }),
      );
      for (let i = 1; i < bands.length; i += 1) {
        const where = `zone ${zone}, ${severity}, ${VEHICLE_CLASSES[i - 1]} to ${VEHICLE_CLASSES[i]}`;
        assert.ok(bands[i].low > bands[i - 1].low, `${where}: low did not rise`);
        assert.ok(bands[i].high > bands[i - 1].high, `${where}: high did not rise`);
      }
    }
  }
});

test('only structural damage brings the shell itself into the job', () => {
  const hasAlignment = (band) => band.lines.some((line) => /alignment/.test(line.part));

  assert.equal(hasAlignment(estimateRepair({ zone: 12, severity: 'scratch', vehicleClass: 'compact' })), false);
  assert.equal(hasAlignment(estimateRepair({ zone: 12, severity: 'dent', vehicleClass: 'compact' })), false);
  assert.equal(hasAlignment(estimateRepair({ zone: 12, severity: 'structural', vehicleClass: 'compact' })), true);
});

test('the parts named for a zone match the side of the car that was hit', () => {
  const right = estimateRepair({ zone: 3, severity: 'dent', vehicleClass: 'compact' });
  const left = estimateRepair({ zone: 9, severity: 'dent', vehicleClass: 'compact' });
  const rear = estimateRepair({ zone: 6, severity: 'dent', vehicleClass: 'compact' });

  assert.ok(right.lines.every((line) => !/left/.test(line.part)), 'a right side hit listed a left part');
  assert.ok(left.lines.every((line) => !/right/.test(line.part)), 'a left side hit listed a right part');
  assert.ok(rear.lines.some((line) => /rear|boot/.test(line.part)));

  // Mirrored zones cost the same. Nothing about the model says one side is dearer.
  assert.equal(right.low, left.low);
  assert.equal(right.high, left.high);
});

test('every zone prices without a gap in the table', () => {
  for (const zone of DAMAGE_ZONES) {
    const band = estimateRepair({ zone, severity: 'dent', vehicleClass: 'compact' });
    assert.ok(band.lines.length > 0, `zone ${zone} has no parts`);
  }
});

test('a zone sent as a string still prices, because that is what an agent sends', () => {
  const typed = estimateRepair({ zone: 10, severity: 'dent', vehicleClass: 'compact' });
  const asText = estimateRepair({ zone: '10', severity: 'dent', vehicleClass: 'compact' });
  assert.deepEqual(asText, typed);
});

test('estimateRepair refuses anything outside its tables instead of guessing', () => {
  assert.throws(() => estimateRepair({ zone: 0, severity: 'dent', vehicleClass: 'compact' }), RangeError);
  assert.throws(() => estimateRepair({ zone: 13, severity: 'dent', vehicleClass: 'compact' }), RangeError);
  assert.throws(() => estimateRepair({ zone: 12.5, severity: 'dent', vehicleClass: 'compact' }), RangeError);
  assert.throws(() => estimateRepair({ zone: 10, severity: 'severe', vehicleClass: 'compact' }), RangeError);
  assert.throws(() => estimateRepair({ zone: 10, severity: 'dent', vehicleClass: 'spaceship' }), RangeError);
  assert.throws(() => estimateRepair({ zone: 10, severity: 'dent' }), RangeError);
  assert.throws(() => estimateRepair(), RangeError);
});

test('estimateRepair gives the same answer every time it is asked', () => {
  const once = estimateRepair({ zone: 5, severity: 'structural', vehicleClass: 'suv' });
  const twice = estimateRepair({ zone: 5, severity: 'structural', vehicleClass: 'suv' });
  assert.deepEqual(once, twice);
});

test('bands stay in whole units a person can read out loud', () => {
  for (const zone of DAMAGE_ZONES) {
    const band = estimateRepair({ zone, severity: 'structural', vehicleClass: 'premium' });
    assert.equal(band.low % 10, 0, `low ${band.low} is not a round figure`);
    assert.equal(band.high % 10, 0, `high ${band.high} is not a round figure`);
  }
});
