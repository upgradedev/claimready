/**
 * One boundary for "is this a rule pack this build actually checked", held at every trust point.
 *
 * WHAT WAS WRONG. `isUsablePack` in src/core/filing.js asked whether the thing in hand carried an
 * `id`, a `requirements` array and a `coverages` array. That is a description of a pack, not proof
 * that src/core/policy.js ever read one. So an object literal written by hand passed the file gate,
 * filed a claim through `fileClaim`, and came back out of `buildFilingPacket` as a sealed FNOL
 * naming an insurer nobody has heard of, under a clause id that exists nowhere, with an excess of
 * the author's choosing. Measured before the fix, on this claim, with this literal:
 *
 *   canFile ok: true code: null
 *   fileClaim ok: true status: filed
 *   sealed insurer : Totally Not An Insurer
 *   sealed pack id : northwind
 *   sealed clause  : MADE-UP-1
 *   sealed excess  : 1
 *
 * WHY A WeakSet AND NOT A FLAG. A public boolean such as `validated: true` is written by whoever
 * builds the object, so it proves nothing: the forgery above would simply have carried it. The
 * marker has to be something a caller cannot write, so it is a WeakSet held privately inside
 * src/core/policy.js, added to by `loadPolicyPack` and by nothing else. Only the reading half,
 * `isValidatedPack`, is exported. A pack is validated because this build validated THAT OBJECT, and
 * identity is the whole claim: a JSON round trip of a real pack is structurally perfect and is
 * refused, which is the case at the end of this file.
 *
 * The page half is in tests/unit/app_boot_no_pack_bad_embedded.test.js.
 */

import { canFile, filingIdentity, packIdentity, FILE_CODES } from '../../src/core/filing.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyPatch, createClaim, fileClaim } from '../../src/core/claim.js';
import { buildFilingPacket } from '../../src/core/packet.js';
import { loadPolicyPack, isValidatedPack } from '../../src/core/policy.js';
import { packOf } from '../../src/webmcp/register.js';

function readPack(name) {
  return loadPolicyPack(JSON.parse(readFileSync(
    new URL(`../../fixtures/insurers/${name}.json`, import.meta.url), 'utf8',
  )));
}

const northwind = readPack('northwind');
const HOME = { homePackId: 'northwind' };

/** The literal that used to file. It is shaped like a pack in every way a shape check can see. */
function forgedPack() {
  return {
    id: 'northwind',
    insurer: 'Totally Not An Insurer',
    currency: 'EUR',
    contract: 'claim-intake.v1',
    requirements: [],
    coverages: [{
      code: 'own_damage',
      label: 'Own damage',
      clause: 'MADE-UP-1',
      active: true,
      deductible: 1,
      incident_types: ['collision'],
    }],
  };
}

/** A collision draft the northwind intake has nothing left to ask about. */
function settledCollision() {
  const result = applyPatch(createClaim({ policy: { id: 'MTR-2026-0417' } }), [
    { field: 'incident_date', value: '2026-08-14' },
    { field: 'incident_type', value: 'collision' },
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'description', value: 'A car came out of a side road and hit the left front wing.' },
  ]);
  assert.equal(result.ok, true, `the draft must apply: ${result.error}`);
  return result.claim;
}

/* ------------------------------------------------- the marker itself, read from the outside */

test('a pack is validated because loadPolicyPack read that object, and for no other reason', () => {
  assert.equal(isValidatedPack(northwind), true);

  for (const notAPack of [null, undefined, 0, '', 'northwind', [], {}, forgedPack()]) {
    assert.equal(isValidatedPack(notAPack), false, 'something unvalidated was read as validated');
  }

  // A caller cannot talk its way in. There is nothing to set, because the marker is not a property.
  const claimsToBe = { ...forgedPack(), validated: true, __validated: true };
  assert.equal(isValidatedPack(claimsToBe), false, 'a pack that says it is validated was believed');
});

/* --------------------------------------------------------- every trust point shares the boundary */

test('the forged pack is refused at every point that decides something', () => {
  const claim = settledCollision();
  const forged = forgedPack();

  assert.equal(packIdentity(forged, HOME).usable, false, 'packIdentity');
  assert.equal(packIdentity(forged, HOME).packId, null, 'packIdentity read an id off an unchecked object');

  const identity = filingIdentity(forged, claim, HOME);
  assert.equal(identity.usable, false, 'filingIdentity');
  assert.equal(identity.refusal.code, FILE_CODES.noPack);

  const gate = canFile(forged, claim, [], HOME);
  assert.equal(gate.ok, false, 'canFile let a forged pack file');
  assert.equal(gate.code, FILE_CODES.noPack);
  assert.equal(gate.requirementsKnown, false);
  assert.equal(gate.insurer, null, 'an unchecked object was read out as an insurer');

  const filed = fileClaim(claim, { at: '2026-09-02T03:00:00.000Z', pack: forged, ...HOME });
  assert.equal(filed.ok, false, 'fileClaim filed against a forged pack');
  assert.equal(filed.code, FILE_CODES.noPack);
  assert.equal(filed.claim.status, 'draft');

  assert.equal(packOf({ pack: forged }), null, 'the tools would have read a forged pack');
});

test('a claim that reached filed anyway cannot be sealed against a forged pack', () => {
  // The packet has its own reason to ask: it cannot call canFile, because a filed claim short
  // circuits that. So the boundary is asserted on the packet's own path rather than assumed from
  // the gate one step back. The claim here is filed under the real pack and the packet is then
  // offered the forgery, which is the substitution the seal has to notice.
  const filed = fileClaim(settledCollision(), { at: '2026-09-02T03:00:00.000Z', pack: northwind, ...HOME });
  assert.equal(filed.ok, true, `the claim must file under the real pack: ${filed.error}`);

  const packet = buildFilingPacket({ claim: filed.claim, pack: forgedPack(), homePackId: 'northwind' });
  assert.equal(packet.ok, false, 'a packet was sealed against a pack nothing validated');
  assert.match(packet.reason, /rule pack/i);
});

/* ------------------------------------------------------- the real pack still does everything */

test('a pack that loadPolicyPack read files, seals and answers, exactly as before', () => {
  const claim = settledCollision();

  assert.equal(packIdentity(northwind, HOME).usable, true);
  assert.equal(packIdentity(northwind, HOME).packId, 'northwind');
  assert.equal(canFile(northwind, claim, [], HOME).ok, true);
  assert.equal(packOf({ pack: northwind }), northwind);

  const filed = fileClaim(claim, { at: '2026-09-02T03:00:00.000Z', pack: northwind, ...HOME });
  assert.equal(filed.ok, true, filed.error);

  const packet = buildFilingPacket({ claim: filed.claim, pack: northwind, homePackId: 'northwind' });
  assert.equal(packet.ok, true, packet.reason);
  assert.equal(packet.packet.policy.pack_id, 'northwind');
});

/* --------------------------------------------- identity is the claim, so a perfect copy is not one */

test('a structurally perfect copy of a real pack is refused, because nothing validated the copy', () => {
  // THE PROOF THAT THE GATE IS NOT A SHAPE CHECK WEARING A NEW NAME. This object holds exactly what
  // the loader produced, and the loader has never seen it. If it passed, the marker would be
  // decoration and the forgery above would only have failed on its shape.
  const clone = JSON.parse(JSON.stringify(northwind));
  assert.deepEqual(clone, JSON.parse(JSON.stringify(northwind)), 'the copy must be the same data');

  assert.equal(isValidatedPack(clone), false);
  assert.equal(canFile(clone, settledCollision(), [], HOME).code, FILE_CODES.noPack);
  assert.equal(packOf({ pack: clone }), null);

  // And it passes again the moment this build reads it for itself, which is the one way in.
  const reloaded = loadPolicyPack(clone);
  assert.equal(isValidatedPack(reloaded), true);
  assert.equal(canFile(reloaded, settledCollision(), [], HOME).ok, true);
});
