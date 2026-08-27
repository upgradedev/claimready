// tests/unit/scenarios.test.js
//
// The generated patch corpus, checked against the real applyPatch. This file is what makes
// the corpus a gate rather than a claim: without it the generator runs and prints, and
// nothing ever compares it to the code it describes.
//
// Reproduce a single failure from its number alone:
//   node scripts/gen_scenarios.mjs --number <n>
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPatch } from '../../src/core/claim.js';
import { generateScenarios, buildClaim } from '../../scripts/gen_scenarios.mjs';

for (const scenario of generateScenarios()) {
  test(`scenario ${scenario.number} (${scenario.kind})`, () => {
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
        `scenario ${scenario.number}: expected the refusal to mention ` +
          `"${scenario.expect.errorIncludes}" but it said: ${result.error}`,
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

