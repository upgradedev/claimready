/**
 * The packet says a filing happened. This is the check that one did.
 *
 * WHAT WAS WRONG. `content.filed.through` reads "a control on the page. Filing is not exposed as a
 * WebMCP tool." Nothing checked it. `status` is an ordinary string on an ordinary object, so a
 * caller that wrote the two bookkeeping values by hand got a whole FNOL packet, sealed under a
 * digest, asserting a filing that never took place. Measured before the fix, from a draft that had
 * never been through the file gate:
 *
 *   packet ok   : true
 *   reference   : CR-MTR-2026-0417-R4
 *   filed at    : 2026-09-01T09:15:00.000Z
 *   through     : a control on the page. Filing is not exposed as a WebMCP tool.
 *
 * THE FIX AND ITS LIMIT. `fileClaim` in src/core/claim.js adds the claim it returns to a WeakSet
 * held privately in that module, and `buildFilingPacket` refuses a claim that is not in it. The
 * same mechanism src/core/policy.js uses for a validated pack, for the same reason: membership is
 * not a property, so it cannot be written, spread or stored.
 *
 * It is a browser local demonstration and the receipt is worth exactly that. It says this code path
 * ran in this page in this session. It says nothing to anybody outside the session, because the
 * whole record lives in memory and goes with the tab. It is not a signature and it is not an
 * insurer receipt. The tests below pin the behaviour; they do not claim more than that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyPatch,
  createClaim,
  fileClaim,
  hydrateClaim,
  lockField,
  wasFiledHere,
} from '../../src/core/claim.js';
import { buildFilingPacket, PACKET_CODES } from '../../src/core/packet.js';
import { loadPolicyPack } from '../../src/core/policy.js';

const northwind = loadPolicyPack(JSON.parse(readFileSync(
  new URL('../../fixtures/insurers/northwind.json', import.meta.url), 'utf8',
)));
const fixture = JSON.parse(readFileSync(
  new URL('../../fixtures/demo-collision.json', import.meta.url), 'utf8',
));

const AT = '2026-09-01T09:15:00.000Z';
const HOME = 'northwind';
const DONE = ['roadside_collection'];

/** The filmed journey, up to the moment before it is filed. */
function settledDraft() {
  let claim = createClaim(fixture);
  claim = applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'location', value: 'Car park on Harbour Road' },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ], { actor: 'agent', baseRevision: 0 }).claim;
  claim = applyPatch(claim, [{ field: 'vehicle_drivable', value: false }], { actor: 'human' }).claim;
  return lockField(claim, 'vehicle_drivable').claim;
}

function build(claim) {
  return buildFilingPacket({
    claim,
    pack: northwind,
    homePackId: HOME,
    completedHumanActions: DONE,
    ledger: [],
  });
}

/* -------------------------------------------------------------------------- the forgeries */

test('a status written by hand does not produce a packet', () => {
  // The exact shape that used to seal. Everything a packet asks for is present and correct, and
  // the one thing that is missing is the filing itself.
  const forged = { ...settledDraft(), status: 'filed', filed_at: AT, revision: 4 };
  const result = build(forged);

  assert.equal(result.ok, false, 'a hand written status was sealed as a filing');
  assert.equal(result.code, PACKET_CODES.notFiledHere);
  assert.equal(result.packet, null);
  assert.equal(result.canonical, null, 'there is nothing to hash, so nothing is offered to hash');
  assert.match(result.reason, /filed through the control on this page/);
});

test('a copy of a real filed claim is not the filed claim', () => {
  // A spread produces a different object, and a different object was not filed. This is the
  // intended reading rather than a rough edge: somebody assembled that object, this page did not.
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  assert.equal(filed.ok, true, filed.error);

  assert.equal(build(filed.claim).ok, true, 'the real filing has to build, or this proves nothing');
  assert.equal(build({ ...filed.claim }).code, PACKET_CODES.notFiledHere);
});

test('a filed claim read back from storage carries no receipt', () => {
  // Hydration is the door a stored claim comes through, and storage is caller controlled. Handing
  // the receipt back here would hand it to whoever wrote the storage, which is the forger. So a
  // filed claim that survived a reload is readable, patch refusing and closed, and this page will
  // not describe it as a filing it performed. It never happens on the demo path: this page keeps
  // no storage at all, and the packet is drawn from the same object the file gate returned.
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });
  const restored = hydrateClaim(JSON.parse(JSON.stringify(filed.claim)));

  assert.equal(restored.status, 'filed', 'the state survives the round trip');
  assert.equal(wasFiledHere(restored), false);
  assert.equal(build(restored).code, PACKET_CODES.notFiledHere);
});

/* ------------------------------------------------------------------------- the real thing */

test('the filing this page performs produces its packet', () => {
  const filed = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: DONE, homePackId: HOME,
  });

  assert.equal(wasFiledHere(filed.claim), true);
  const result = build(filed.claim);
  assert.equal(result.ok, true, result.reason);
  assert.match(result.packet.filed.through, /not exposed as a WebMCP tool/);
});

test('a refused filing hands back the draft, and the draft holds no receipt', () => {
  // A refusal changes nothing, which the filing tests already pin. The receipt has to follow that
  // rule too, or a refused filing would leave a claim that could be sealed later.
  const refused = fileClaim(settledDraft(), {
    at: AT, pack: northwind, completedHumanActions: [], homePackId: HOME,
  });

  assert.equal(refused.ok, false);
  assert.equal(wasFiledHere(refused.claim), false);
});

test('wasFiledHere says no to anything that is not a claim, rather than throwing', () => {
  for (const value of [null, undefined, 'filed', 42, [], {}]) {
    assert.equal(wasFiledHere(value), false, `${JSON.stringify(value)} was treated as filed`);
  }
});

/* ----------------------------------------------------------- there is no way to write to it */

test('no module exports a way to put a claim in the receipt', () => {
  // The reading half is exported and the writing half is not. A `markFiled` or a `FILED_HERE`
  // leaking out of claim.js would hand the forger the one thing the WeakSet exists to withhold, so
  // this is a grep over the source rather than a promise in a comment.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '..', '..', 'src', 'core', 'claim.js'), 'utf8');

  const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/gm)]
    .map((match) => match[1]);
  assert.equal(exported.includes('wasFiledHere'), true, 'the reading half has to be reachable');
  assert.equal(
    exported.some((name) => /^(markFiled|addFilingReceipt|FILED_BY_THIS_MODULE|FILED_HERE)$/.test(name)),
    false,
    'a writing half is exported, so the receipt can be forged',
  );

  // And the set is touched on exactly one line, which is the line inside fileClaim.
  const adds = source.split('\n').filter((line) => /FILED_BY_THIS_MODULE\.add\(/.test(line));
  assert.equal(adds.length, 1, `the receipt is written in ${adds.length} places`);
});
