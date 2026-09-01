/**
 * The clipboard is refused, and the reader still gets something they can actually check.
 *
 * ITS OWN FILE, for the reason in tests/support/boot_app.mjs: app.js boots at module top level, so
 * one plain import per process is what keeps app.js a single row in the coverage table. This
 * scenario needs a clipboard that says no from before boot, which no other file can be given.
 *
 * WHAT WAS WRONG. A browser that refuses navigator.clipboard is ordinary: Firefox refuses a write
 * that is not close enough to a user gesture, a locked down enterprise profile refuses it outright,
 * and Safari has refused it from an iframe for years. On that path the page said "Select the packet
 * above and copy it by hand". The packet above is Markdown. scripts/verify_packet.mjs parses JSON
 * and exits 2 on anything else, so the one instruction the page gave a reader who could not use the
 * clipboard was an instruction that cannot work. The digest is the whole claim this page makes
 * about the document a handler receives, and the fallback route to checking it was a dead end.
 *
 * WHAT IT DOES NOW. It writes the same canonical JSON the clipboard would have carried into a box
 * on the page and tells the reader to select it and save it. No network, because the page's own
 * policy allows none and a download would need a blob URL that policy also refuses. The test below
 * takes what that box holds, saves it, and runs the real verifier as a separate process.
 *
 * THE HOST HERE IS A FAKE AND IS NAMED ONE. It proves what the page publishes and what the page
 * does when something calls it. It proves nothing about a real browser or a real clipboard, and no
 * readiness row may cite it as evidence that a judge can drive this page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isFilingInstant } from '../../src/core/claim.js';
import { bootApp, rowFor, createFakeAgentHost } from '../support/boot_app.mjs';
import { fireEvent } from '../support/dom_double.mjs';

const ROOT = path.dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));

/**
 * A clipboard that refuses, installed before boot because the handler closes over the global.
 *
 * It rejects the way a browser does, with a DOMException shaped error rather than a string, so the
 * page's catch is meeting the thing it will meet in a browser.
 */
let attempts = 0;
globalThis.navigator = {
  clipboard: {
    async writeText() {
      attempts += 1;
      const error = new Error('Write permission denied.');
      error.name = 'NotAllowedError';
      throw error;
    },
  },
};

const host = createFakeAgentHost();
const { doc, net } = await bootApp({}, host);

/** Answer one row the way a visitor does. */
function setField(field, value) {
  const found = rowFor(doc, field);
  found.control.value = value;
  fireEvent(found.control, 'change');
}

/** Wait for the digest, which is computed asynchronously after the packet is drawn. */
async function settle() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (doc.el('packet-copy').disabled === false) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

test('a claim is completed and filed, which is the only state the packet exists in', async () => {
  setField('damage_zone', '10');
  setField('severity', 'dent');
  setField('vehicle_drivable', 'true');
  setField('location', 'Car park on Harbour Road');
  setField('description', 'A delivery van reversed into the left front wing while parked.');

  assert.equal(doc.el('file-btn').disabled, false,
    `the draft must be filable: ${doc.el('file-reason').textContent}`);

  fireEvent(doc.el('file-btn'), 'click');
  await settle();
  assert.equal(doc.el('packet-copy').disabled, false, 'the digest never arrived');

  // NOT OFFERED UNTIL IT IS NEEDED. Asserted here rather than before the filing, because the double
  // in tests/support/dom_double.mjs models properties and not attributes: every element it builds
  // starts with hidden false, whatever index.html says. What closes this block before the first
  // paint is the hidden attribute in index.html; what closes it here is renderPacket, which is the
  // half a test can see.
  assert.equal(doc.el('packet-fallback').hidden, true, 'the fallback was drawn before it was needed');
  assert.equal(doc.el('packet-json').textContent, '');
});

test('the refused clipboard puts the JSON on the page instead of pointing at the markdown', async () => {
  const askedBefore = net.asked.length;

  fireEvent(doc.el('packet-copy'), 'click');
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  assert.equal(attempts, 1, 'the page has to try the clipboard first');
  assert.equal(doc.el('packet-fallback').hidden, false, 'the fallback drew nothing');

  const said = doc.el('packet-said').textContent;
  assert.match(said, /would not let the page write to the clipboard/);
  assert.match(said, /\.json/, 'the reader is told what to save it as');
  assert.doesNotMatch(said, /packet above/,
    'the markdown above is not JSON and the verifier will not read it');

  // NOTHING LEFT THE PAGE TO MAKE THIS HAPPEN. The fallback is a string already in memory.
  assert.equal(net.asked.length, askedBefore, 'the fallback reached the network');
});

/**
 * THE ASSERTION THIS FILE EXISTS FOR.
 *
 * It spawns scripts/verify_packet.mjs as its own process against what the page actually drew,
 * rather than recomputing the digest here with the same module the page used. Re-deriving it in
 * process would prove that two calls to one function agree, which is not the question. The
 * question is whether the route the page hands a stranger ends in a check that passes.
 */
test('what the page offers instead passes the real verifier, as a separate process', () => {
  const offered = doc.el('packet-json').textContent;
  assert.ok(offered.length > 0, 'the box is empty');

  const parsed = JSON.parse(offered);
  assert.match(parsed.content_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(parsed.content_digest, doc.el('packet-digest').textContent,
    'the box carries the digest the page is showing');
  // BOTH TIMES ARE THE ONE SHAPE, read with the predicate src/core/claim.js refuses on, so a page
  // that started handing over a wall clock reading again fails here as well as in the domain.
  assert.ok(isFilingInstant(parsed.generated_at), `generated_at was ${parsed.generated_at}`);
  assert.ok(isFilingInstant(parsed.content.filed.at), `filed.at was ${parsed.content.filed.at}`);
  assert.ok(doc.el('file-result').textContent.includes(parsed.content.filed.at),
    'the page and the packet have to print one filing time, and they printed two');

  const dir = mkdtempSync(path.join(tmpdir(), 'claimready-packet-'));
  try {
    const file = path.join(dir, 'packet.json');
    writeFileSync(file, offered, 'utf8');

    const run = spawnSync(process.execPath, [path.join('scripts', 'verify_packet.mjs'), file], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    assert.equal(run.status, 0,
      `verify_packet.mjs refused what the page offered.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.match(run.stdout, /The digest matches/);
    assert.match(run.stdout, new RegExp(parsed.content_digest.replace('sha256:', '')));
    assert.match(run.stdout, /filed:\s+revision \d+ at \d{4}-\d{2}-\d{2}T/,
      'the verifier prints the filing time, which is where a wall clock reading used to show');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('none of this put the packet on the tool surface', () => {
  for (const name of host.toolNames()) {
    assert.doesNotMatch(name, /packet|export|download|receipt/,
      `${name} offers the document this page says only a person can produce`);
  }
});

/**
 * A RESET WITHDRAWS THE FALLBACK TOO, AND IT HAS TO CLEAR IT RATHER THAN ONLY HIDE IT.
 *
 * The box holds the whole packet: the policy number, the claimant's account of what happened, the
 * digest. tests/unit/app_boot_filing.test.js already asserts that a reset empties the readable
 * packet rather than folding it away, and this is the same rule one element over. It cannot be
 * asserted in that file, because the clipboard succeeds in that process and the box is empty there
 * whatever the code does, which is a test that passes for the wrong reason.
 *
 * Last, because a reset destroys the state every test above reads.
 */
test('a reset takes the fallback away with the packet it described, bytes and all', () => {
  assert.equal(doc.el('packet-fallback').hidden, false, 'the fallback has to be open for this to mean anything');
  assert.ok(doc.el('packet-json').textContent.length > 0);

  fireEvent(doc.el('reset-btn'), 'click');

  assert.equal(doc.el('packet-panel').hidden, true, 'nothing filed, nothing to describe');
  assert.equal(doc.el('packet-fallback').hidden, true);
  assert.equal(doc.el('packet-json').textContent, '', 'the packet was still on the page after a reset');
});
