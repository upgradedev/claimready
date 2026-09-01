/**
 * src/ui/render.js, running for the first time.
 *
 * WHAT WAS WRONG. This file is 989 lines. It draws every sentence a judge reads in the first
 * ninety seconds: the file panel, the provenance badges, a refused tool call in the ledger, the
 * reason beside every disabled control. It had never executed under a test, and it did not appear
 * in the coverage table at all, because Node counts only what the run loaded and the one test that
 * mentioned this module opened it with readFileSync and matched its TEXT. A repository can report
 * 94.84% while its two largest files have never run.
 *
 * The real module is imported here and driven against a DOM double, which is named a double in
 * tests/support/dom_double.mjs and states there what it does and does not prove.
 *
 * WHERE THE DATA COMES FROM. Claims are built with the real createClaim and moved with the real
 * applyPatch, so provenance on a badge is provenance the domain actually recorded rather than a
 * literal written next to the assertion that reads it. Nothing in this file restates a rule, so no
 * assertion here can pass because of something written in the test.
 *
 * THE FILE PANEL IS DRIVEN BY THE REAL DECISION, AND THAT CHANGED HERE. These tests used to hand
 * renderActions a state assembled by hand: a `ready` flag, an outstanding list and a
 * requirementsKnown flag, each written next to the assertion that read it. The view then decided
 * the button from `ready` alone, so a hand written state could not catch the defect that shipped,
 * which was the button staying open over an intake requirement the very same state described as
 * open. Every case below now builds a real claim, reads it against a shipped insurer pack through
 * the real canFile, and hands the view what the page hands it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDocumentDouble, hookNamesFromIndexHtml, installClockDouble } from '../support/dom_double.mjs';
import { createView, clockLabel } from '../../src/ui/render.js';
import { createClaim, applyPatch, lockField, fileClaim, PATCHABLE_FIELDS } from '../../src/core/claim.js';
import { canFile } from '../../src/core/filing.js';
import { loadPolicyPack } from '../../src/core/policy.js';

/** A shipped insurer pack, so the file panel is drawn against rules the page really loads. */
const northwind = loadPolicyPack(JSON.parse(readFileSync(
  new URL('../../fixtures/insurers/northwind.json', import.meta.url), 'utf8',
)));

/** What the page hands renderActions, built the way src/ui/app.js builds it. */
function actionState(claim, pack, extra = {}) {
  return {
    // The home insurer travels with the question, exactly as src/ui/app.js sends it. A filing
    // asserts which insurer the claim went to, so the gate refuses one that cannot name it, and a
    // call that leaves it out is not the call the page makes.
    decision: canFile(pack, claim, extra.humanActions || [], { homePackId: 'northwind' }),
    filed: claim.status === 'filed',
    filedAt: claim.filed_at,
    assistanceAt: null,
    assistanceAvailable: false,
    ...extra,
  };
}

/**
 * A view over a fresh document double, with the clock swapped out.
 *
 * Every test takes its own, because createView keeps highlight timers and the last revision in a
 * closure and a shared one would leak that state between assertions.
 */
function mount(options = {}) {
  const clock = installClockDouble();
  const doc = createDocumentDouble(options);
  let view;
  try {
    view = createView(doc);
  } catch (error) {
    clock.restore();
    throw error;
  }
  return { doc, view, clock };
}

function withView(options, body) {
  const mounted = mount(options);
  try {
    body(mounted);
  } finally {
    mounted.clock.restore();
  }
}

/** A claim with every required field answered, moved through the real patch path. */
function readyClaim(actor = 'human') {
  let claim = createClaim({ policy: { id: 'MTR-2026-0417' } });
  const result = applyPatch(claim, [
    { field: 'incident_date', value: '2026-08-02' },
    { field: 'incident_type', value: 'collision' },
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: false },
    { field: 'description', value: 'A car came out of a side road and hit the left front wing.' },
  ], { actor });
  assert.equal(result.ok, true, `the fixture patch must apply: ${result.error}`);
  claim = result.claim;
  return claim;
}

/**
 * The same claim with the car still drivable.
 *
 * readyClaim says the car cannot be driven, which is what raises the two collection rules in both
 * shipped packs, so it is the draft with something still open. Answering yes is what leaves the
 * intake with nothing to ask for, and it is the only draft the word complete is allowed on.
 */
function drivableClaim() {
  const result = applyPatch(readyClaim(), { field: 'vehicle_drivable', value: true });
  assert.equal(result.ok, true, `the drivable patch must apply: ${result.error}`);
  return result.claim;
}

/* The page and the view must agree on every hook */

test('every hook createView resolves is present in the shipped index.html', () => {
  // createView throws naming the absent hooks, so this passing is the assertion: the shipped page
  // and the shipped view still agree. Nothing checked that before, and a renamed data-el in
  // index.html would have surfaced as a blank page in front of a judge.
  withView({}, ({ doc }) => {
    assert.ok(doc.hooks.size >= 30, 'index.html should carry the page hooks');
  });
});

test('a hook missing from the page is refused at start up, by name', () => {
  const hooks = hookNamesFromIndexHtml().filter((name) => name !== 'ledger' && name !== 'file-btn');
  const clock = installClockDouble();
  try {
    assert.throws(
      () => createView(createDocumentDouble({ hooks })),
      (error) => {
        assert.match(error.message, /ClaimReady cannot start/);
        assert.match(error.message, /ledger/);
        // NAMED BY ITS INTERNAL KEY, NOT BY THE ATTRIBUTE. The hook whose attribute reads
        // data-el="file-btn" is reported as `fileBtn`, because the check lists the keys of the
        // els object rather than the selectors they were resolved from. Where the two spellings
        // happen to match, as with `ledger`, nobody notices. Where they do not, the message hands
        // a reader a string that appears nowhere in index.html to grep for. This asserts what the
        // shipped code does today; the fix belongs in src/ui/render.js, which this task may not
        // touch, so it is reported rather than changed.
        assert.match(error.message, /fileBtn/);
        return true;
      },
    );
  } finally {
    clock.restore();
  }
});

/* The file panel: open requirements versus answered */

test('the file panel names what is still needed while the draft is incomplete', () => {
  withView({}, ({ doc, view }) => {
    const state = actionState(createClaim({ policy: { id: 'MTR-2026-0417' } }), northwind);
    view.renderActions(state);

    assert.equal(doc.el('file-btn').disabled, true, 'an incomplete draft cannot be filed');
    // The sentence is the domain's, drawn word for word.
    assert.equal(doc.el('file-reason').textContent, state.decision.reason);
    assert.match(doc.el('file-reason').textContent, /Still needed before you can file/);
    assert.equal(doc.el('file-reason').classList.contains('is-blocked'), true);
    assert.equal(doc.el('file-result').textContent, '');
  });
});

test('a draft with every field filled but the intake still asking is not called complete', () => {
  withView({}, ({ doc, view }) => {
    // Every required field is answered and the car cannot be driven, which is what raises this
    // insurer's two collection rules. The draft is ready by the static list and not by the intake.
    const state = actionState(readyClaim(), northwind);
    assert.deepEqual(state.decision.missing, [], 'the static file gate has nothing left to ask for');
    assert.ok(state.decision.outstanding.length > 0, 'the intake is still asking for something');
    view.renderActions(state);

    const said = doc.el('file-reason').textContent;
    assert.equal(said, state.decision.reason);
    assert.doesNotMatch(said, /The draft is complete/, 'the intake is still asking, so it is not complete');
    assert.match(said, /Roadside collection for a car that cannot be driven/);
    // Not settled, so the colour beside the words must not read as a clear answer.
    assert.equal(doc.el('file-reason').classList.contains('is-blocked'), true);

    // THE DEFECT THIS WHOLE CHANGE EXISTS FOR. The sentence above said the insurer was still
    // asking and the button beside it was open, because the view disabled it on the static list
    // alone. A panel and a button that describe one draft cannot be allowed to disagree.
    assert.equal(doc.el('file-btn').disabled, true,
      'the button cannot be open while the sentence beside it names an open requirement');
  });
});

test('the file panel says filing is yours only when nothing is outstanding', () => {
  withView({}, ({ doc, view }) => {
    const state = actionState(drivableClaim(), northwind);
    assert.deepEqual(state.decision.outstanding, [], 'a drivable car raises neither collection rule');
    view.renderActions(state);

    assert.equal(doc.el('file-btn').disabled, false);
    assert.equal(doc.el('file-reason').textContent, 'The draft is complete. Filing is yours to do.');
    assert.equal(doc.el('file-reason').classList.contains('is-blocked'), false);
  });
});

test('a rule pack that never loaded is drawn as an unknown, not as a clear answer', () => {
  withView({}, ({ doc, view }) => {
    view.renderActions(actionState(drivableClaim(), null));
    assert.match(doc.el('file-reason').textContent, /did not load/);
    assert.equal(doc.el('file-reason').classList.contains('is-blocked'), true);

    // FAIL CLOSED IN THE VIEW TOO. Every required field is filled, so the old gate opened the
    // button on a draft nothing on this page could say the intake was finished with.
    assert.equal(doc.el('file-btn').disabled, true,
      'a draft whose rules never loaded is an unknown, and an unknown does not open the button');
  });
});

test('a draft nobody has placed with an insurer closes the button and says why', () => {
  withView({}, ({ doc, view }) => {
    // The rules loaded and the draft is complete. What is missing is the fact the borrowed rules
    // check compares against, and a comparison with one side missing has no opinion, so filing
    // closes. The point of this test is the sentence: a control drawn closed with nothing beside
    // it reads as a control that is broken, and this refusal is about a fact a visitor cannot see.
    const decision = canFile(northwind, drivableClaim(), [], {});
    view.renderActions({
      decision,
      filed: false,
      filedAt: null,
      assistanceAt: null,
      assistanceAvailable: false,
    });

    assert.equal(doc.el('file-btn').disabled, true);
    assert.equal(doc.el('file-reason').textContent, decision.reason, 'the sentence is the domain\'s, word for word');
    assert.match(doc.el('file-reason').textContent, /has not been told which insurer/);
    assert.equal(doc.el('file-reason').classList.contains('is-blocked'), true);

    // NEVER GATED TO NULL. The reason is a real sentence on the page, not an empty node beside a
    // dead control.
    assert.ok(doc.el('file-reason').textContent.trim().length > 40);
  });
});

test('a draft that names no policy closes the button and says that instead', () => {
  withView({}, ({ doc, view }) => {
    const decision = canFile(northwind, { ...drivableClaim(), policy_id: null }, [], { homePackId: 'northwind' });
    view.renderActions({
      decision,
      filed: false,
      filedAt: null,
      assistanceAt: null,
      assistanceAvailable: false,
    });

    assert.equal(doc.el('file-btn').disabled, true);
    assert.match(doc.el('file-reason').textContent, /does not say which policy/);
    assert.equal(doc.el('file-reason').classList.contains('is-blocked'), true);
  });
});

test('a filed claim says so, and says filing is not on the tool surface', () => {
  withView({}, ({ doc, view }) => {
    const filed = fileClaim(drivableClaim(), { at: '2026-09-01T11:04:22.000Z', pack: northwind, homePackId: 'northwind' });
    assert.equal(filed.ok, true, filed.error);
    view.renderActions(actionState(filed.claim, northwind));

    assert.equal(doc.el('file-btn').disabled, true);
    // NAMES THE SURFACE, NOT THE PRESSER. This line is printed by the very click that filed the
    // claim, and the page cannot know whether a person or a browser driving agent made it.
    assert.match(doc.el('file-result').textContent, /Filed via the page at 2026-09-01T11:04:22.000Z/);
    assert.doesNotMatch(doc.el('file-result').textContent, /by you/);
    assert.match(doc.el('file-result').textContent, /not exposed as a WebMCP tool/);
    assert.equal(doc.el('file-reason').classList.contains('is-blocked'), false);
  });
});

/* Every disabled control carries a visible reason */

test('all three roadside assistance states draw a reason beside the button', () => {
  const cases = [
    {
      what: 'already requested',
      state: { assistanceAt: '11:09:00', assistanceAvailable: false, filed: false },
      disabled: true,
      says: /Roadside assistance requested via the page at 11:09:00/,
    },
    {
      what: 'the car is still drivable',
      state: { assistanceAt: null, assistanceAvailable: false, filed: false },
      disabled: true,
      says: /Collection is for a vehicle that cannot be driven/,
    },
    {
      what: 'the claim is filed',
      state: { assistanceAt: null, assistanceAvailable: false, filed: true },
      disabled: true,
      says: /arranged with the handler/,
    },
    {
      what: 'open',
      state: { assistanceAt: null, assistanceAvailable: true, filed: false },
      disabled: false,
      says: /yours to press/,
    },
  ];

  for (const item of cases) {
    withView({}, ({ doc, view }) => {
      view.renderActions(actionState(drivableClaim(), northwind, item.state));
      assert.equal(doc.el('assistance-btn').disabled, item.disabled, item.what);
      const reason = doc.el('assistance-state').textContent;
      assert.match(reason, item.says, item.what);
      assert.notEqual(reason.trim(), '', `${item.what}: a control with no reason reads as broken`);
    });
  }
});

test('a pinned field closes its control and prints why, and so does a filed claim', () => {
  withView({}, ({ doc, view }) => {
    const pinned = lockField(readyClaim(), 'severity').claim;
    view.renderClaim(pinned, []);

    const row = doc.el('fields').descendants().find((node) => node.getAttribute('data-field') === 'severity');
    assert.ok(row, 'the severity row should exist');
    assert.equal(row.classList.contains('is-pinned'), true);

    const control = row.descendants().find((node) => node.classList.contains('field-control'));
    assert.equal(control.disabled, true, 'a pinned field is closed to a patch, so the control closes too');
    const hint = row.descendants().find((node) => node.classList.contains('field-hint'));
    assert.match(hint.textContent, /Pinned via the page/, 'a closed control with no reason is a dead end');

    const pin = row.descendants().find((node) => node.classList.contains('pin'));
    assert.equal(pin.getAttribute('aria-pressed'), 'true');
    assert.match(pin.getAttribute('aria-label'), /Unpin/);
  });
});

// THE PIN COMES AFTER THE CONTROL IN THE DOM, WHICH IS THE TAB ORDER.
// render.js carries a nine line comment saying the pin was moved out of the head row for exactly
// this reason: a keyboard user was reaching "pin this answer" one tab before reaching the answer.
// Nothing pinned it. The move could be undone, or undone by a stylesheet edit that put it back in
// the head, and every test in this repository stayed green. Document order is what a browser tabs
// through, so document order is what this asserts, for every row the page draws rather than one.
test('every row puts its control before its pin, in document order, not only on the screen', () => {
  withView({}, ({ doc, view }) => {
    view.renderClaim(readyClaim(), []);

    const hosts = [doc.el('fields'), doc.el('fields-optional')];
    let checked = 0;
    for (const host of hosts) {
      for (const row of host.descendants()) {
        if (!row.classList.contains('field-row')) continue;
        const order = row.descendants();
        const control = order.findIndex((node) => node.classList.contains('field-control'));
        const pin = order.findIndex((node) => node.classList.contains('pin'));
        assert.notEqual(control, -1, 'every field row draws a control');
        assert.notEqual(pin, -1, 'every field row draws a pin');
        assert.ok(
          control < pin,
          `${row.getAttribute('data-field')} offers its pin at tab position ${pin} and the answer `
          + `it pins at ${control}, so a keyboard user is asked to pin a value they have not read yet`,
        );
        checked += 1;
      }
    }
    assert.equal(checked, PATCHABLE_FIELDS.length,
      `only ${checked} rows were checked, so the assertion stopped covering the page`);
  });

  withView({}, ({ doc, view }) => {
    const filed = fileClaim(drivableClaim(), { at: '2026-09-01T11:04:22.000Z', pack: northwind, homePackId: 'northwind' }).claim;
    view.renderClaim(filed, []);
    for (const field of PATCHABLE_FIELDS) {
      const row = doc.el('fields').descendants().concat(doc.el('fields-optional').descendants())
        .find((node) => node.getAttribute('data-field') === field);
      if (!row) continue;
      const control = row.descendants().find((node) => node.classList.contains('field-control'));
      assert.equal(control.disabled, true, `${field} must be closed on a filed claim`);
    }
    assert.match(doc.el('claim-note').textContent, /The draft is closed/);
  });
});

/* Provenance badges */

test('a badge names the surface each answer arrived on, from the recorded provenance', () => {
  withView({}, ({ doc, view }) => {
    const base = readyClaim('human');
    const byAgent = applyPatch(base, { field: 'location', value: 'Kifisias Avenue' }, { actor: 'agent', baseRevision: base.revision });
    assert.equal(byAgent.ok, true, byAgent.error);
    view.renderClaim(byAgent.claim, []);

    const badgeFor = (field) => {
      const row = doc.el('fields').descendants()
        .concat(doc.el('fields-optional').descendants())
        .find((node) => node.getAttribute('data-field') === field);
      return row.descendants().find((node) => node.classList.contains('badge'));
    };

    // THE BADGE NAMES A ROUTE, NOT AN AUTHOR. A value typed into a control is recorded as human
    // whoever moved the control, and an agent that drives the page the way any browser automation
    // drives a page arrives that way too. So the word is about the surface the answer came in on,
    // which is the part the claim actually records, and the title says that in full.
    const viaPage = badgeFor('severity');
    assert.equal(viaPage.textContent, 'via page');
    assert.equal(viaPage.classList.contains('badge-you'), true);
    assert.match(viaPage.title, /not who was at the keyboard/);

    const viaTool = badgeFor('location');
    assert.equal(viaTool.textContent, 'via tool');
    assert.equal(viaTool.classList.contains('badge-agent'), true);
    assert.match(viaTool.title, /the call is in the ledger below/);

    const unset = badgeFor('witness_name');
    assert.equal(unset.textContent, 'not set');
    assert.equal(unset.classList.contains('badge-none'), true);
    assert.match(unset.title, /Nothing has answered this yet/);
  });
});

test('a badge redrawn does not keep the class it had before', () => {
  withView({}, ({ doc, view }) => {
    const claim = readyClaim('human');
    view.renderClaim(claim, []);
    const row = doc.el('fields').descendants().find((node) => node.getAttribute('data-field') === 'severity');
    const badge = row.descendants().find((node) => node.classList.contains('badge'));
    assert.equal(badge.classList.contains('badge-you'), true);

    const moved = applyPatch(claim, { field: 'severity', value: 'structural' }, { actor: 'agent', baseRevision: claim.revision });
    assert.equal(moved.ok, true, moved.error);
    view.renderClaim(moved.claim, ['severity']);

    assert.equal(badge.textContent, 'via tool');
    assert.equal(badge.classList.contains('badge-agent'), true);
    assert.equal(badge.classList.contains('badge-you'), false, 'two provenance badges at once would be a lie');
  });
});

/* A refusal in the ledger */

test('a refused tool call is drawn with its code and its reason', () => {
  withView({}, ({ doc, view }) => {
    const locked = lockField(readyClaim(), 'severity').claim;
    const refused = applyPatch(locked, { field: 'severity', value: 'scratch' }, { actor: 'agent', baseRevision: locked.revision });
    assert.equal(refused.ok, false, 'a pinned field must refuse an agent patch');

    view.renderLedger([{
      at: '11:12:01',
      name: 'apply_claim_patch',
      args: '{"changes":[{"field":"severity","value":"scratch"}]}',
      text: 'Nothing was changed.',
      refusals: [{ code: refused.code, error: refused.error }],
    }]);

    const item = doc.el('ledger').children[0];
    assert.equal(item.classList.contains('is-refused'), true, 'a refusal is drawn as loudly as a success');
    assert.equal(item.textOfClass('ledger-code'), refused.code);
    assert.equal(item.textOfClass('ledger-reason'), refused.error);
    assert.equal(item.textOfClass('ledger-flag'), 'refused');
    assert.equal(doc.el('ledger-empty').classList.contains('hidden'), true);
  });
});

test('more than one refusal on a call is counted, and an empty ledger shows its empty line', () => {
  withView({}, ({ doc, view }) => {
    view.renderLedger([{
      at: '11:12:09',
      name: 'apply_claim_patch',
      args: '{}',
      text: 'Nothing was changed.',
      refusals: [
        { code: 'PINNED', error: 'Pinned.' },
        { code: 'STALE', error: 'Read it again.' },
      ],
    }]);
    assert.equal(doc.el('ledger').children[0].textOfClass('ledger-flag'), '2 refused');

    view.renderLedger([]);
    assert.equal(doc.el('ledger').children.length, 0);
    assert.equal(doc.el('ledger-empty').classList.contains('hidden'), false);
  });
});

test('a long argument and a long result are clipped rather than allowed to run away', () => {
  withView({}, ({ doc, view }) => {
    view.renderLedger([{
      at: '11:13:00',
      name: 'describe_claim',
      args: 'x'.repeat(400),
      text: 'y'.repeat(600),
      refusals: [],
    }]);
    const item = doc.el('ledger').children[0];
    assert.match(item.textOfClass('ledger-args'), /\[more\]$/);
    assert.match(item.textOfClass('ledger-result'), /\[more\]$/);
    assert.ok(item.textOfClass('ledger-args').length < 400);
  });
});

/* The stale panel wording */

test('a published answer names the revision it was worked out at, and the one it is still current at', () => {
  withView({}, ({ doc, view }) => {
    view.renderCoverage({
      insurer: 'Northwind',
      at: '11:14:00',
      source: 'agent',
      revision: 4,
      validAt: 4,
      decision: { covered: true, provisional: false, clause: 'OD-4.1', reason: 'Collision damage.', deductible: 250, currency: 'EUR' },
    });
    assert.match(doc.el('coverage-body').textContent, /draft revision 4/);
    assert.doesNotMatch(doc.el('coverage-body').textContent, /still current at/);
  });

  withView({}, ({ doc, view }) => {
    // Pinning a field moves the revision without moving an input, so the answer is still that
    // answer at a later revision. Both numbers have to be on the panel or the reader cannot check.
    view.renderCoverage({
      insurer: 'Northwind',
      at: '11:14:00',
      source: 'you',
      revision: 4,
      validAt: 6,
      decision: { covered: false, clause: 'EX-2', reason: 'Excluded driver.' },
    });
    assert.match(doc.el('coverage-body').textContent, /draft revision 4, still current at 6/);
  });
});

test('a stale panel is replaced by the sentence saying so, and nothing of the old answer is left', () => {
  withView({}, ({ doc, view }) => {
    view.renderCoverage({
      insurer: 'Northwind', at: '11:14:00', source: 'agent', revision: 4, validAt: 4,
      decision: { covered: true, provisional: false, clause: 'OD-4.1', reason: 'Collision damage.' },
    });
    assert.match(doc.el('coverage-body').textContent, /Covered/);

    view.renderCoverage({ blocked: 'The draft has moved since this cover check was worked out at revision 4.' });
    const body = doc.el('coverage-body').textContent;
    assert.match(body, /The draft has moved since this cover check/);
    assert.doesNotMatch(body, /OD-4\.1/, 'a superseded answer must not survive beside the sentence retiring it');
    assert.doesNotMatch(body, /Covered/);
  });
});

test('a provisional yes is never drawn as a plain yes', () => {
  withView({}, ({ doc, view }) => {
    view.renderCoverage({
      insurer: 'Northwind', at: '11:15:00', source: 'agent', revision: 3, validAt: 3,
      decision: { covered: true, provisional: true, clause: 'OD-4.1', reason: 'Awaiting the driver.' },
    });
    const verdict = doc.el('coverage-body').textOfClass('verdict');
    assert.equal(verdict, 'Covered, provisionally');
  });
});

test('an unchecked panel says so rather than sitting empty', () => {
  withView({}, ({ doc, view }) => {
    view.renderCoverage(null);
    assert.match(doc.el('coverage-body').textContent, /Not checked yet/);
    view.renderEstimate(null);
    assert.match(doc.el('estimate-body').textContent, /No band yet/);
    view.renderEstimate({ blocked: 'The band needs a damage position and a severity on the draft above.' });
    assert.match(doc.el('estimate-body').textContent, /needs a damage position/);
  });
});

test('a what if band says on the panel that the draft was not changed', () => {
  withView({}, ({ doc, view }) => {
    view.renderEstimate({
      at: '11:16:00', source: 'agent', revision: 5, validAt: 5, whatIf: true,
      zone: 10, severity: 'structural',
      band: { low: 900, high: 1600, currency: 'EUR', lines: [{ part: 'Wing', cost: 400 }] },
    });
    const body = doc.el('estimate-body').textContent;
    assert.match(body, /What if it is structural/);
    assert.match(body, /The claim draft was not changed/);
    assert.match(body, /Wing/);
  });
});

/* The requirements panel */

test('a requirement that has just appeared is flagged, and one no field can answer is marked', () => {
  withView({}, ({ doc, view }) => {
    view.renderRequirements({
      summary: '2 of 3 intake requirements are still open.',
      newIds: ['police-report'],
      blocked: null,
      entries: [
        { id: 'police-report', label: 'A police report reference', why: 'Asked for here because the severity is structural.', satisfied: false, humanOnly: false },
        { id: 'garage-visit', label: 'An inspection at an approved garage', why: 'No field answers this one.', satisfied: false, humanOnly: true, humanNote: 'Marked done on this page.' },
        { id: 'date', label: 'The date it happened', why: 'Always asked.', satisfied: true, humanOnly: false },
      ],
    });

    const items = doc.el('requirements').children;
    assert.equal(items.length, 3);
    assert.equal(items[0].classList.contains('is-new'), true);
    assert.equal(items[0].textOfClass('req-new'), 'Just appeared');
    assert.equal(items[0].textOfClass('req-tag'), 'open');
    assert.equal(items[1].textOfClass('req-tag'), 'you only');
    assert.equal(items[1].classList.contains('is-human'), true);
    assert.equal(items[1].textOfClass('req-human-note'), 'Marked done on this page.');
    assert.equal(items[2].textOfClass('req-tag'), 'answered');
    assert.equal(items[2].classList.contains('is-answered'), true);
    assert.equal(doc.el('req-summary').textContent, '2 of 3 intake requirements are still open.');
  });
});

test('a requirements panel with no rule pack prints the reason and draws no list', () => {
  withView({}, ({ doc, view }) => {
    view.renderRequirements({ entries: [], summary: '', newIds: [], blocked: 'The insurer rule pack did not load.' });
    assert.equal(doc.el('req-summary').textContent, 'The insurer rule pack did not load.');
    assert.equal(doc.el('req-summary').classList.contains('is-blocked'), true);
    assert.equal(doc.el('requirements').children.length, 0, 'a list under a blocked summary would be inventing rules');
  });
});

/* The tool surface strip */

test('with no agent every tool row is marked not registered and the reason is given', () => {
  withView({}, ({ doc, view }) => {
    const tools = [
      { name: 'check_coverage', purpose: 'Check the cover.', readOnly: true, untrustedContent: false, conditional: false },
      { name: 'apply_claim_patch', purpose: 'Write a field.', readOnly: false, untrustedContent: false, conditional: false },
      { name: 'read_evidence_notes', purpose: 'Read the notes.', readOnly: true, untrustedContent: true, conditional: true, appears: 'the claim carries a note' },
    ];
    view.renderToolSurface({ tools, available: false, api: null, registered: [] });

    assert.equal(doc.el('tools-count').textContent, '3 tools this page publishes to an agent');
    assert.match(doc.el('tools-note').textContent, /None of these is registered right now/);
    const rows = doc.el('tools-list').children;
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.classList.contains('is-idle'), true);
      assert.ok(row.descendants().some((node) => node.textContent === 'not registered'));
    }
    assert.equal(rows[2].textOfClass('tool-when'), 'Registered only while the claim carries a note.');
  });
});

test('a row is marked registered only from the names the browser accepted', () => {
  withView({}, ({ doc, view }) => {
    const tools = [
      { name: 'check_coverage', purpose: 'Check the cover.', readOnly: true, untrustedContent: false, conditional: false },
      { name: 'read_evidence_notes', purpose: 'Read the notes.', readOnly: true, untrustedContent: true, conditional: true, appears: 'the claim carries a note' },
    ];
    // The page publishes both. The browser accepted one. Nothing may say registered about the other.
    view.renderToolSurface({ tools, available: true, api: 'navigator.modelContext', registered: ['check_coverage'] });

    assert.equal(doc.el('tools-count').textContent, '1 of 2 tools registered with your agent');
    const rows = doc.el('tools-list').children;
    assert.equal(rows[0].classList.contains('is-live'), true);
    assert.equal(rows[1].classList.contains('is-live'), false);
    assert.ok(rows[1].descendants().some((node) => node.textContent === 'not registered'));
    assert.equal(rows[1].textOfClass('tool-when'), 'Registered only while the claim carries a note.');
    assert.ok(rows[1].descendants().some((node) => node.textContent === 'untrusted text'));
    assert.ok(rows[0].descendants().some((node) => node.textContent === 'reads'));
  });
});

test('the strip says which tools an agent has, and that filing is not one of them', () => {
  withView({}, ({ doc, view }) => {
    view.renderStatus({
      available: true,
      api: 'navigator.modelContext',
      registered: ['check_coverage'],
      failed: [{ name: 'get_repair_estimate', reason: 'refused by the browser' }],
      fixtureSource: 'file',
      fixtureError: null,
    });
    assert.match(doc.el('status-text').textContent, /1 tool registered/);
    assert.match(doc.el('status-detail').textContent, /Could not register: get_repair_estimate \(refused by the browser\)/);
    assert.match(doc.el('status-detail').textContent, /No tool this page publishes reaches either button/);
    assert.equal(doc.el('strip').classList.contains('is-on'), true);
    assert.equal(doc.el('status-dot').classList.contains('dot-ok'), true);
  });
});

test('a sample file that did not load is said out loud on the strip', () => {
  withView({}, ({ doc, view }) => {
    view.renderStatus({
      available: false, api: null, registered: [], failed: [],
      fixtureSource: 'fallback',
      fixtureError: 'HTTP 404',
    });
    assert.match(doc.el('status-detail').textContent, /a built in sample is being used/);
    assert.match(doc.el('status-detail').textContent, /The sample claim file was refused: HTTP 404/);
    assert.equal(doc.el('strip').classList.contains('is-off'), true);
    assert.equal(doc.el('status-dot').classList.contains('dot-warn'), true);
  });
});

/* The redraw must not fight the person typing */

test('a redraw never overwrites the control the person is typing in', () => {
  withView({}, ({ doc, view }) => {
    const claim = readyClaim();
    view.renderClaim(claim, []);

    const row = doc.el('fields').descendants().find((node) => node.getAttribute('data-field') === 'description');
    const control = row.descendants().find((node) => node.classList.contains('field-control'));

    control.value = 'half a sentence the person is still typ';
    doc.activeElement = control;
    view.renderClaim(claim, []);
    assert.equal(control.value, 'half a sentence the person is still typ', 'a redraw must not fight the typist');

    doc.activeElement = null;
    view.renderClaim(claim, []);
    assert.equal(control.value, claim.description, 'once the focus leaves, the draft wins again');
  });
});

/* Highlights, both halves */

test('a changed row is highlighted and the highlight is taken off again', () => {
  withView({}, ({ doc, view, clock }) => {
    const claim = readyClaim();
    view.renderClaim(claim, ['severity']);
    const row = doc.el('fields').descendants().find((node) => node.getAttribute('data-field') === 'severity');
    assert.equal(row.classList.contains('is-changed'), true, 'this is how a viewer sees a tool call land');
    assert.equal(clock.pendingCount, 1);
    clock.runAll();
    assert.equal(row.classList.contains('is-changed'), false);
  });
});

test('an agent write to an optional field opens the group it lives in', () => {
  withView({}, ({ doc, view }) => {
    const start = readyClaim();
    const moved = applyPatch(start, { field: 'witness_name', value: 'A. Papadopoulos' }, { actor: 'agent', baseRevision: start.revision });
    assert.equal(moved.ok, true, moved.error);
    assert.equal(doc.el('optional-details').open, false);
    view.renderClaim(moved.claim, ['witness_name']);
    assert.equal(doc.el('optional-details').open, true, 'a write nobody can see is a write nobody believes');
  });
});

test('the revision chip flashes only when the number actually moves', () => {
  withView({}, ({ doc, view, clock }) => {
    view.renderRevision(3);
    assert.equal(doc.el('revision').textContent, '3');
    assert.equal(doc.el('revision-chip').classList.contains('is-bumped'), false, 'the first paint is not a change');

    view.renderRevision(4);
    assert.equal(doc.el('revision-chip').classList.contains('is-bumped'), true);
    clock.runAll();
    assert.equal(doc.el('revision-chip').classList.contains('is-bumped'), false);

    view.renderRevision(4);
    assert.equal(doc.el('revision-chip').classList.contains('is-bumped'), false, 'a redraw at the same number is not a change');

    view.renderRevision(undefined);
    assert.equal(doc.el('revision').textContent, '0');
  });
});

test('the reset note is said out loud and then cleared', () => {
  withView({}, ({ doc, view, clock }) => {
    view.renderResetNote('The synthetic incident was loaded again.');
    assert.equal(doc.el('reset-note').classList.contains('is-flash'), true);
    clock.runAll();
    assert.equal(doc.el('reset-note').classList.contains('is-flash'), false);

    view.renderResetNote('Again.');
    view.renderResetNote('');
    assert.equal(doc.el('reset-note').textContent, '');
    assert.equal(doc.el('reset-note').classList.contains('is-flash'), false);
  });
});

/* The insurer picker and the smaller drawing paths */

test('the insurer picker closes itself when there is nothing to pick between', () => {
  withView({}, ({ doc, view }) => {
    view.renderPackChoices([{ id: 'northwind', label: 'Northwind' }], 'northwind');
    assert.equal(doc.el('insurer-select').disabled, true, 'one option is not a choice');
    assert.equal(doc.el('insurer-select').value, 'northwind');

    view.renderPackChoices([{ id: 'northwind', label: 'Northwind' }, { id: 'kestrel' }], 'kestrel');
    assert.equal(doc.el('insurer-select').disabled, false);
    assert.equal(doc.el('insurer-select').children.length, 2);
    assert.equal(doc.el('insurer-select').children[1].textContent, 'kestrel', 'a pack with no label falls back to its id');
  });
});

test('a borrowed rule pack is named on the persona, so a decision cannot read as this insurer', () => {
  withView({}, ({ doc, view }) => {
    view.renderPersona({ holder: 'Maria K.', policyId: 'MTR-2026-0417', note: 'A sample claim.', borrowed: true, insurer: 'Kestrel' });
    assert.equal(doc.el('persona-policy').textContent, 'Policy MTR-2026-0417, read against Kestrel rules');
    assert.match(doc.el('persona-note').textContent, /not this policy's own insurer/);

    view.renderPersona({ holder: 'Maria K.', policyId: 'MTR-2026-0417', note: 'A sample claim.', borrowed: false, insurer: null });
    assert.equal(doc.el('persona-policy').textContent, 'Policy MTR-2026-0417');
    assert.equal(doc.el('persona-note').textContent, 'A sample claim.');
  });
});

test('the live region and the field error are drawn, and clear to empty', () => {
  withView({}, ({ doc, view }) => {
    view.announce('The agent set the severity to structural.');
    assert.equal(doc.el('live').textContent, 'The agent set the severity to structural.');
    view.announce(null);
    assert.equal(doc.el('live').textContent, '');

    view.showFieldError('That date is in the future.');
    assert.equal(doc.el('field-error').textContent, 'That date is in the future.');
    view.showFieldError(undefined);
    assert.equal(doc.el('field-error').textContent, '');

    view.renderPackNote('Kestrel rules loaded.');
    assert.equal(doc.el('pack-note').textContent, 'Kestrel rules loaded.');
    view.renderPackNote(null);
    assert.equal(doc.el('pack-note').textContent, '');
  });
});

/* The tool list opening rule, all three of its outcomes */

test('the tool list opens by itself only on a screen with room, and never crashes the page', () => {
  const cases = [
    { what: 'no window at all', view: null, open: false },
    { what: 'a window with no matchMedia', view: {}, open: false },
    { what: 'a screen too small', view: { matchMedia: () => ({ matches: false }) }, open: false },
    { what: 'a screen with room', view: { matchMedia: () => ({ matches: true }) }, open: true },
    {
      what: 'a browser that refuses the query',
      view: { matchMedia: () => { throw new Error('refused'); } },
      open: false,
    },
  ];

  for (const item of cases) {
    withView({ view: item.view }, ({ doc }) => {
      assert.equal(doc.el('tools-details').open, item.open, item.what);
    });
  }
});

/* Formatting the page and the tools share */

test('a damage position is named the same way everywhere', () => {
  assert.equal(clockLabel(10), "10 o'clock, left front wing");
  assert.equal(clockLabel('10'), "10 o'clock, left front wing");
  assert.equal(clockLabel(99), "99 o'clock");
  assert.equal(clockLabel('nowhere'), 'nowhere');
});

test('the value line spells out each kind of field for a reader', () => {
  withView({}, ({ doc, view }) => {
    const claim = readyClaim();
    view.renderClaim(claim, []);
    const valueOf = (field) => {
      const row = doc.el('fields').descendants()
        .concat(doc.el('fields-optional').descendants())
        .find((node) => node.getAttribute('data-field') === field);
      return row.textOfClass('field-value');
    };
    assert.equal(valueOf('damage_zone'), "10 o'clock, left front wing");
    assert.equal(valueOf('vehicle_drivable'), 'No');
    assert.equal(valueOf('severity'), 'Dent');
    assert.equal(valueOf('incident_type'), 'Collision');
    assert.equal(valueOf('witness_name'), 'Missing');
  });
});
