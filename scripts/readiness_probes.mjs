#!/usr/bin/env node
/**
 * The behaviour behind five readiness rows, run in a child process against one checkout.
 *
 * WHY THIS IS A SEPARATE PROGRAM AND NOT MORE CODE INSIDE scripts/readiness.mjs.
 *
 * The self test in that file breaks one input in a sandbox copy of this repository and then runs
 * the same check twice, once before the break and once after. A check written as a dynamic import
 * cannot see the second half: Node keeps an evaluated module in its registry for the life of the
 * process, so the broken file on disk is never read, and the case reports a pass on both halves,
 * which looks like a bad break step and is not one. A cache busting query on the entry module does
 * not help either, because its own static imports still resolve to the records already held.
 *
 * A child process re-reads every file, so a break anywhere in the graph is seen. That is the same
 * reason the unit test row and the style gate row already shell out.
 *
 * HOW A ROW USES IT. `node scripts/readiness_probes.mjs <name>` exits 0 when the behaviour holds
 * and 1 when it does not, and it says why on stdout either way. The row runs the copy that lives
 * in the tree being judged, with that tree as the working directory, so a sandbox is judged by its
 * own code rather than by this repository's.
 *
 * WHAT A PROBE IS ALLOWED TO DO. Read this checkout, import its modules, and drive them. No
 * network, no browser, and nothing written anywhere inside the tree. A probe that had to install
 * something or open a port would belong in CI instead.
 *
 * Usage:
 *   node scripts/readiness_probes.mjs --list          name every probe
 *   node scripts/readiness_probes.mjs provisional     run one probe, by name
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

/** Import a module of this checkout by repository relative path. */
const load = (relPath) => import(pathToFileURL(join(ROOT, relPath)).href);

const readJson = (relPath) => JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));

/** A deep copy, so a probe that bends a fixture cannot bend it for the probe after it. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/* --------------------------------------------------------------- the claim journeys */

/**
 * A complete draft that names no driver, which is the shape a provisional yes needs.
 *
 * `driver` is optional on a claim, and the shipped pack lists an excluded driver, so a claim that
 * is complete enough to file can still leave the cover answer depending on a name nobody has
 * given. That combination is the whole reason the packet had a wrong answer to print.
 */
function draftWithoutDriver(claimApi, fixture) {
  const seed = copy(fixture);
  seed.claim.driver = null;
  let claim = claimApi.createClaim(seed);
  claim = claimApi.applyPatch(claim, [
    { field: 'damage_zone', value: 10 },
    { field: 'severity', value: 'dent' },
    { field: 'vehicle_drivable', value: true },
    { field: 'description', value: 'A delivery van reversed into the left front wing while parked.' },
  ], { actor: 'agent', baseRevision: 0 }).claim;
  return claim;
}

/** The same draft with a driver on it, which is the control: nothing about it is provisional. */
function draftWithDriver(claimApi, fixture) {
  const claim = draftWithoutDriver(claimApi, fixture);
  return claimApi.applyPatch(claim, [{ field: 'driver', value: 'Maria K.' }], { actor: 'human' }).claim;
}

/* ------------------------------------------------------------------------ the probes */

/**
 * A yes that is not settled yet says so on the sealed packet, on the panel, and in the markdown.
 *
 * WHAT THIS IS ABOUT. The packet is the one artifact here that carries a digest, so a wrong answer
 * inside it looks checked. It wrote a flat `covered: true` on a claim whose yes still depended on
 * a name the claim had not given, while the panel two inches above read "Covered, provisionally".
 *
 * The comparison is against `openCoverQuestions`, which is the function both surfaces are built
 * from, rather than against a sentence typed out here. A literal would pass on the day somebody
 * changed the wording in one place and not the other, which is the drift being watched for.
 */
async function probeProvisional() {
  const problems = [];
  const claimApi = await load('src/core/claim.js');
  const { loadPolicyPack } = await load('src/core/policy.js');
  const { checkCoverage, openCoverQuestions } = await load('src/core/coverage.js');
  const { buildFilingPacket, packetAsMarkdown, digestOf } = await load('src/core/packet.js');
  const { createView } = await load('src/ui/render.js');
  const { createDocumentDouble, installClockDouble } = await load('tests/support/dom_double.mjs');

  const pack = loadPolicyPack(readJson('fixtures/insurers/northwind.json'));
  const fixture = readJson('fixtures/demo-collision.json');

  const sealed = async (claim) => {
    const filed = claimApi.fileClaim(claim, {
      pack,
      completedHumanActions: [],
      homePackId: 'northwind',
      at: '2026-09-01T09:15:00.000Z',
    });
    if (!filed.ok) return { error: `the journey this probe drives no longer files: ${filed.error}` };
    const built = buildFilingPacket({
      claim: filed.claim,
      pack,
      homePackId: 'northwind',
      completedHumanActions: [],
      ledger: [],
    });
    if (!built.ok) return { error: `no packet was built: ${built.code}` };
    return { packet: built.packet, markdown: packetAsMarkdown(built.packet, await digestOf(built.canonical)) };
  };

  const open = draftWithoutDriver(claimApi, fixture);
  const decided = checkCoverage(pack, open);
  if (!decided.covered || decided.provisional !== true) {
    problems.push(`the draft this probe builds is no longer a provisional yes. checkCoverage said covered ${decided.covered} provisional ${decided.provisional}, so nothing below is about the case this row exists for`);
  }
  const questions = openCoverQuestions(pack, open);
  if (questions.length === 0) {
    problems.push('openCoverQuestions found nothing open on a claim that names no driver, so the two surfaces have nothing to agree about');
  }

  const openSealed = await sealed(open);
  if (openSealed.error) {
    problems.push(openSealed.error);
  } else {
    const cover = openSealed.packet.coverage || {};
    if (cover.provisional !== true) {
      problems.push(`the sealed packet says provisional ${JSON.stringify(cover.provisional ?? null)} on a claim the cover check calls provisional. That is a flat yes under a digest`);
    }
    if (cover.provisional_reason !== questions.join(' ')) {
      problems.push(`the packet's provisional_reason is not the open question the cover check names. packet: ${JSON.stringify(String(cover.provisional_reason ?? '').slice(0, 90))} cover check: ${JSON.stringify(questions.join(' ').slice(0, 90))}`);
    }
    if (!openSealed.markdown.includes('covered, provisionally')) {
      problems.push('the packet markdown does not print "covered, provisionally" for a provisional yes, so a handler reading the readable copy is told a flat yes');
    }
    if (!openSealed.markdown.includes('Still open')) {
      problems.push('the packet markdown prints no "Still open" row, so it says the answer is provisional and never says on what');
    }
  }

  const settled = draftWithDriver(claimApi, fixture);
  const settledDecision = checkCoverage(pack, settled);
  if (settledDecision.provisional !== false) {
    problems.push(`the control draft, which names a driver, came back provisional ${settledDecision.provisional}. A check that calls everything provisional is not a check`);
  }
  const settledSealed = await sealed(settled);
  if (settledSealed.error) {
    problems.push(settledSealed.error);
  } else {
    const cover = settledSealed.packet.coverage || {};
    if (cover.provisional !== false || cover.provisional_reason !== null) {
      problems.push(`the control packet carries provisional ${JSON.stringify(cover.provisional ?? null)} and provisional_reason ${JSON.stringify(cover.provisional_reason ?? null)}, and a settled yes has neither`);
    }
    if (settledSealed.markdown.includes('covered, provisionally')) {
      problems.push('the packet markdown calls the control claim provisional, so the word is being printed whatever the answer is');
    }
  }

  // The panel, drawn by the real view against the DOM double the unit tests use. It is a double and
  // it is named one here: it proves what the view writes into the document it is handed, and it
  // proves nothing about a browser.
  const clock = installClockDouble();
  try {
    const doc = createDocumentDouble();
    const view = createView(doc);
    view.renderCoverage({
      insurer: 'Northwind', at: '11:15:00', source: 'agent', revision: 3, validAt: 3, decision: decided,
    });
    const verdict = doc.el('coverage-body').textOfClass('verdict');
    if (verdict !== 'Covered, provisionally') {
      problems.push(`the panel drew ${JSON.stringify(verdict)} for the same decision the packet describes, and the two surfaces have to say the same thing`);
    }
    view.renderCoverage({
      insurer: 'Northwind', at: '11:15:00', source: 'agent', revision: 3, validAt: 3, decision: settledDecision,
    });
    const plain = doc.el('coverage-body').textOfClass('verdict');
    if (plain !== 'Covered') {
      problems.push(`the panel drew ${JSON.stringify(plain)} for a settled yes, so the provisional wording is not conditional on anything`);
    }
  } finally {
    clock.restore();
  }

  return {
    problems,
    summary: `the packet, its markdown and the panel all call one driverless claim provisional, and all three call the control a plain yes. ${questions.length} open question(s), quoted from the one function both read`,
  };
}

/**
 * Filing refuses a claim that cannot say which policy it is on, or which insurer that policy is with.
 *
 * Both refusals are asked of the two entry points that can reach them, because the defect was one
 * of them asking and the other not. `canFile` guards the button and `buildFilingPacket` guards the
 * document, and a packet used to describe a filing the gate would have refused.
 *
 * The comparison is on the CODE and not on the sentence. A caller branches on the code, so a
 * refusal that arrives with the right words and the wrong code is a refusal nothing can act on.
 */
async function probeFilingIdentity() {
  const problems = [];
  const claimApi = await load('src/core/claim.js');
  const { loadPolicyPack } = await load('src/core/policy.js');
  const filing = await load('src/core/filing.js');
  const { buildFilingPacket, PACKET_CODES } = await load('src/core/packet.js');

  const pack = loadPolicyPack(readJson('fixtures/insurers/northwind.json'));
  const fixture = readJson('fixtures/demo-collision.json');
  const complete = draftWithDriver(claimApi, fixture);

  // A draft that says nothing about which policy it is on. policy_id is protected, so no patch can
  // put it there or take it away, and seeding it is the only way to reach the state.
  const noPolicy = copy(fixture);
  noPolicy.policy = { ...noPolicy.policy, id: null };
  const namelessClaim = draftWithDriver(claimApi, noPolicy);

  const cases = [
    {
      what: 'a draft that names no policy',
      claim: namelessClaim,
      options: { homePackId: 'northwind' },
      fileCode: filing.FILE_CODES.noPolicyId,
      packetCode: PACKET_CODES.noPolicyId,
    },
    {
      what: 'a page that has not been told which insurer the policy is with',
      claim: complete,
      options: {},
      fileCode: filing.FILE_CODES.noHomeInsurer,
      packetCode: PACKET_CODES.noHomeInsurer,
    },
  ];

  for (const one of cases) {
    const decision = filing.canFile(pack, one.claim, [], one.options);
    if (decision.ok !== false || decision.code !== one.fileCode) {
      problems.push(`canFile let ${one.what} through, or refused it with the wrong code. It answered ok ${decision.ok} code ${JSON.stringify(decision.code)}, and this call has to be ${one.fileCode}`);
    }
    const identity = filing.filingIdentity(pack, one.claim, one.options);
    if (!identity.refusal || identity.refusal.code !== one.fileCode) {
      problems.push(`filingIdentity did not refuse ${one.what}. It answered ${JSON.stringify(identity.refusal && identity.refusal.code)}`);
    }

    // The packet is asked about a claim that already reads as filed, because that is the only claim
    // it will build one from, and a filed claim short circuits canFile on ALREADY_FILED. So the two
    // gates are being asked the same question by two routes, which is the point of the shared
    // function underneath them.
    const filed = claimApi.fileClaim(one.claim, {
      pack, completedHumanActions: [], homePackId: 'northwind', at: '2026-09-01T09:15:00.000Z',
    });
    const packetClaim = filed.ok
      ? filed.claim
      : { ...one.claim, status: 'filed', filed_at: '2026-09-01T09:15:00.000Z' };
    const built = buildFilingPacket({
      claim: packetClaim, pack, homePackId: one.options.homePackId, completedHumanActions: [], ledger: [],
    });
    if (built.ok !== false || built.code !== one.packetCode) {
      problems.push(`buildFilingPacket sealed a packet for ${one.what}, or refused it with the wrong code. It answered ok ${built.ok} code ${JSON.stringify(built.code)}, and this call has to be ${one.packetCode}`);
    }
  }

  // The control. Everything named, and the gate opens. Without it the refusals above would prove
  // only that this gate refuses things.
  const good = filing.canFile(pack, complete, [], { homePackId: 'northwind' });
  if (good.ok !== true) {
    problems.push(`a complete draft on a named policy with a named insurer was refused with ${JSON.stringify(good.code)}, so the identity checks are closing more than they should: ${String(good.reason).slice(0, 120)}`);
  }

  return {
    problems,
    summary: `canFile, filingIdentity and buildFilingPacket each refuse a missing policy number and a missing home insurer, ${cases.length * 3} refusals compared by code, and a fully named draft still files`,
  };
}

/**
 * Nothing is written while the page is still saying the draft is not open yet.
 *
 * THE PAINTED CONTROL IS NOT THE BOUNDARY. Every event below is fired by hand, which is harsher
 * than a browser: a disabled button raises nothing, so a guard living only in the `disabled`
 * attribute would never be reached by a real click and is reached by every one of these.
 *
 * The last assertions are the ones that matter most. The store and the page have to agree once the
 * packs are in, because the failure that shipped was the store reaching revision 1 while the chip
 * still read 0, and either number on its own looked correct.
 */
async function probeLoadingWindow() {
  const problems = [];
  const { fireEvent } = await load('tests/support/dom_double.mjs');
  const { bootApp, rowFor, createFakeAgentHost } = await load('tests/support/boot_app.mjs');
  const { textOfResult } = await load('src/webmcp/register.js');

  // Long enough for every write below to be attempted inside the window. The probe costs about a
  // second and a half.
  const DELAY_MS = 900;
  const host = createFakeAgentHost();
  const booting = bootApp({ delayMs: DELAY_MS }, host);

  const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const chipRevision = (doc) => {
    const found = /(\d+)/.exec(doc.el('revision').textContent || '');
    return found ? Number(found[1]) : NaN;
  };

  let doc = null;
  for (let attempt = 0; attempt < 400 && doc === null; attempt += 1) {
    const current = globalThis.document;
    const busy = current && current.el ? current.el('claim-busy') : null;
    if (busy && busy.hidden === false && busy.textContent.trim().length > 0) doc = current;
    else await settle(5);
  }
  if (doc === null) {
    return {
      problems: ['the page never showed a loading state, so this probe cannot see the window it is about'],
      summary: '',
    };
  }

  const before = chipRevision(doc);

  // How the picker path was covered, filled in below. It is a separate sentence because it is the
  // one path here whose evidence is a read of the source rather than a fired event, and a summary
  // that counted it silently alongside the other four said "five write paths fired by hand" over
  // four. A reviewer proved that by deleting the guard and watching this probe still exit 0.
  let pickerNote = 'the insurer picker was switched during the load';

  // 1. A field edit.
  const row = rowFor(doc, 'location');
  row.control.value = 'Harbour Road';
  fireEvent(row.control, 'change');

  // 2. The declarative form, pressed by a person.
  doc.el('declared-witness').value = 'A person typing during the load';
  fireEvent(doc.el('declared-form'), 'submit');
  const answeredPerson = String(doc.el('declared-result').textContent || '');
  if (!/still loading|not open yet/i.test(answeredPerson)) {
    problems.push(`a person's submission during the load was not answered with the loading reason. The page said ${JSON.stringify(answeredPerson.slice(0, 120))}`);
  }

  // 3. The declarative form, submitted by an agent. A dropped submit leaves the sender waiting on a
  //    promise that never resolves, which is indistinguishable from a broken page.
  doc.el('declared-witness').value = 'An agent submitting during the load';
  doc.el('declared-revision').value = String(before);
  const answers = [];
  fireEvent(doc.el('declared-form'), 'submit', {
    agentInvoked: true,
    respondWith(promise) { answers.push(promise); },
  });
  if (answers.length !== 1) {
    problems.push(`the agent's submission during the load was answered ${answers.length} time(s), and a sender that is never answered waits for ever`);
  } else {
    const said = String(await answers[0]);
    if (!/still loading|not open yet/i.test(said)) {
      problems.push(`the agent was answered without being told why: ${JSON.stringify(said.slice(0, 120))}`);
    }
  }

  // 4. The cover check, which used to answer from the sample file's own schedule before any pack
  //    had been validated.
  fireEvent(doc.el('check-coverage-btn'), 'click');
  const coverageText = doc.el('coverage-body').descendants().map((node) => node.textContent || '').join(' ');
  if (/OD-4\.1/.test(coverageText) || /\b250\b/.test(coverageText)) {
    problems.push(`the cover panel printed a clause or an excess before any pack had been validated: ${JSON.stringify(coverageText.slice(0, 140))}`);
  }

  // 5. The insurer picker and the reset, both of which move the revision when they are accepted.
  const picker = doc.el('insurer-select');
  const other = picker.children.find((option) => option.value !== picker.value);
  if (other) {
    picker.value = other.value;
    fireEvent(picker, 'change');
  } else {
    // A PATH THAT COULD NOT BE EXERCISED IS A PROBLEM, NOT A SILENT SKIP. The picker is empty
    // during the loading window, because the choices are drawn from the sample file after it
    // arrives. So this branch never fired, and the row went on printing "five write paths fired by
    // hand" over four. A reviewer proved it by deleting the switchPack loading guard from
    // src/ui/app.js entirely and watching this probe still exit 0.
    //
    // The honest thing is to say the path was not reachable rather than to count it. The guard in
    // app.js is still checked, below, by reading the source: it is the one path here whose evidence
    // is a read rather than a fired event, and this sentence is what stops that being forgotten.
    // The whole function body, not a fixed window after its name. A first attempt at this looked
    // 600 characters past `function switchPack` and reported the guard missing, because the guard
    // sits behind eleven lines of comment explaining why it is there. A check that a comment can
    // push out of range is a check that fails for the wrong reason.
    const app = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
    const at = app.indexOf('function switchPack');
    const nextFunction = app.indexOf(`\n  function `, at + 1);
    const body = at === -1 ? '' : app.slice(at, nextFunction === -1 ? app.length : nextFunction);
    if (!body.includes('loadingReason')) {
      problems.push('the insurer picker cannot be exercised during the loading window, because it has '
        + 'no options until the sample file arrives, and switchPack in src/ui/app.js does not read '
        + 'loadingReason either. So nothing covers that path in either direction, and this row must '
        + 'not claim it does.');
    }
    pickerNote = 'the insurer picker was not reachable during the load, so its guard was checked by '
      + 'reading switchPack in src/ui/app.js instead of by firing at it';
  }
  fireEvent(doc.el('reset-btn'), 'click');

  const during = chipRevision(doc);
  if (during !== before) {
    problems.push(`the revision on the page moved from ${before} to ${during} while the draft was closed`);
  }

  // Now let the packs arrive, and ask the store and the page the same question.
  await booting;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (doc.el('claim-busy').hidden) break;
    await settle(5);
  }
  if (!doc.el('claim-busy').hidden) {
    problems.push('the draft never opened after the packs arrived, so the loading state is not being taken away');
    return { problems, summary: '' };
  }

  const settled = chipRevision(doc);
  const read = textOfResult(await host.call('read_claim_state', {}));
  const told = /revision (\d+)/.exec(read);
  if (!told) {
    problems.push(`read_claim_state named no revision, so the two surfaces cannot be compared: ${JSON.stringify(read.slice(0, 120))}`);
  } else if (Number(told[1]) !== settled) {
    problems.push(`the store is at revision ${told[1]} and the page is showing ${settled}. One draft, two numbers, and a reader of either is being told something the other denies`);
  }
  // THE VALUES THEMSELVES, LOOKED FOR BY NAME. A revision that did not move says nothing was
  // accepted; it says nothing about a write that landed without touching the counter. Each string
  // below was sent by one of the five attempts above, so finding any of them on the settled draft
  // means that attempt was taken. read_claim_state lists an optional field only once it holds
  // something, which is why the absence of the value is what is checked and not the presence of
  // the word "missing".
  for (const [what, sent] of [
    ['a witness name submitted by a person', 'A person typing during the load'],
    ['a witness name submitted by an agent', 'An agent submitting during the load'],
    ['a location typed into a field row', 'Harbour Road'],
  ]) {
    if (read.includes(sent)) {
      problems.push(`${what} while the draft was closed is on the claim afterwards, so the refusal on the page was cosmetic and the write went through`);
    }
  }

  return {
    problems,
    summary: `four write paths fired by hand during the load, nothing written, ${pickerNote}, and `
      + `the store and the page both settled at revision ${settled}`,
  };
}

/**
 * The pack loader refuses values that are the right shape and cannot mean anything.
 *
 * Each case below is one field of a shipped pack bent one way, and every one of them loaded before
 * these refusals existed. A shape check passes all of them, which is why the row is about meaning:
 * an excess of minus 250 is a number, and it is not an excess.
 *
 * The control is at the end, and it is the half that stops this row from being satisfied by a
 * loader that refuses whatever it is handed.
 */
async function probePackValues() {
  const problems = [];
  const { loadPolicyPack, PackRefused } = await load('src/core/policy.js');
  const raw = readJson('fixtures/insurers/northwind.json');

  const cases = [
    ['an active flag written as the word true', (p) => { p.coverages[0].active = 'true'; }],
    ['an active flag written as 1', (p) => { p.coverages[0].active = 1; }],
    ['a section with no active flag at all', (p) => { delete p.coverages[0].active; }],
    ['an excess below zero', (p) => { p.coverages[0].deductible = -250; }],
    ['an excess that is not a finite number', (p) => { p.coverages[0].deductible = Number.POSITIVE_INFINITY; }],
    ['a section applying to an incident no claim can declare', (p) => { p.coverages[0].incident_types = ['banana']; }],
    ['a period written in words rather than as a date', (p) => { p.period.start = 'the first of January'; }],
    ['a period that runs backwards', (p) => { p.period.start = '2026-12-31'; p.period.end = '2026-01-01'; }],
    ['a contract that is present and is not a string', (p) => { p.contract = 2; }],
  ];

  const refusalFor = (change) => {
    const bent = copy(raw);
    change(bent);
    try {
      loadPolicyPack(bent);
      return null;
    } catch (error) {
      return error;
    }
  };

  for (const [what, change] of cases) {
    const refused = refusalFor(change);
    if (refused === null) {
      problems.push(`the loader accepted ${what}, and every surface downstream then answers from it`);
    } else if (!(refused instanceof PackRefused)) {
      problems.push(`${what} was refused with a ${refused.name} rather than a PackRefused, so a caller cannot tell a bad pack from a bug: ${String(refused.message).slice(0, 100)}`);
    }
  }

  // A condition written against a value the field can never hold. The rule quietly never applies,
  // so the claimant is never asked for the thing the insurer asked for, and nothing says so.
  const conditions = [
    ['a severity no claim can hold', { field: 'severity', equals: 'banana' }],
    ['a drivable flag written as the word false', { field: 'vehicle_drivable', equals: 'false' }],
    ['a clock position written as a string', { field: 'damage_zone', equals: '3' }],
    ['a list of nothing', { field: 'severity', in: [] }],
  ];
  for (const [what, when] of conditions) {
    const refused = refusalFor((p) => {
      const rule = p.requirements.find((entry) => entry.when !== undefined) || p.requirements[0];
      rule.when = when;
    });
    if (refused === null) {
      problems.push(`the loader accepted a rule watching ${what}, so that requirement silently never applies and the claimant is never asked for it`);
    }
  }

  // Both shipped packs still load, which is the half that proves none of the above is a loader that
  // has simply started refusing everything.
  const shipped = [];
  for (const name of ['northwind', 'kestrel']) {
    try {
      const pack = loadPolicyPack(readJson(`fixtures/insurers/${name}.json`));
      shipped.push(`${name} loaded with ${pack.coverages.length} section(s) and ${pack.requirements.length} rule(s)`);
    } catch (error) {
      problems.push(`the shipped ${name} pack no longer loads: ${String(error.message).slice(0, 160)}`);
    }
  }

  return {
    problems,
    summary: `${cases.length + conditions.length} bent value(s) refused, and ${shipped.join('; ')}`,
  };
}

/**
 * A probe transcript that cannot name the commit it ran against is refused.
 *
 * A URL is a place and it serves whatever was deployed last, so a judgement naming only the place
 * stays green while the surface it describes is replaced underneath it. The three cases here are
 * the absent field, a word standing in for an answer, and a real commit, and the third is what
 * stops the first two from being satisfied by a judgement that refuses every transcript.
 *
 * WHAT THIS DOES NOT PROVE, written here rather than left to be assumed. Nothing in this probe
 * fetches anything. It shows the judgement refuses an unidentified transcript. Whether a host was
 * really serving that commit is settled by the verification step in .github/workflows/evals.yml,
 * which the row that runs this probe reads separately and reports separately.
 */
async function probeTranscriptSha() {
  const problems = [];
  const { checkTranscript } = await load('evals/probe_assertions.mjs');

  // The smallest transcript that reaches the build check. Plenty else about it will be refused, and
  // that is fine: what is being watched is whether the commit finding is among the findings.
  const transcriptWith = (build) => ({
    page: { origin: 'https://example.invalid' },
    url: 'https://example.invalid/',
    build,
    tools: [],
    toolsWhenStuck: [],
    toolsAfterRecovery: [],
    declared: {},
    consoleProblems: [],
    threw: [],
  });

  // The refusals come back on `failures`, and that is read rather than assumed: a judgement whose
  // shape changed would otherwise leave this probe filtering an empty list and reporting three
  // passes for a check it never made.
  const aboutTheCommit = (result) => {
    if (!result || !Array.isArray(result.failures)) {
      problems.push(`checkTranscript did not answer with a failures list, so this probe cannot read its refusals. It returned ${JSON.stringify(result).slice(0, 120)}`);
      return null;
    }
    return result.failures.some((failure) => /deployedsha|deployed commit/i.test(String(failure)));
  };

  if (aboutTheCommit(checkTranscript(transcriptWith({}))) === false) {
    problems.push('a transcript with no deployed commit on it was not refused for that, so a pass could be a statement about bytes nobody can identify');
  }
  if (aboutTheCommit(checkTranscript(transcriptWith({ deployedSha: 'unknown' }))) === false) {
    problems.push('a transcript whose deployed commit reads "unknown" was not refused for that, and a word in that field is the absence of an answer wearing the shape of one');
  }
  if (aboutTheCommit(checkTranscript(transcriptWith({ deployedSha: '9b64fb2' }))) === true) {
    problems.push('a transcript naming a real short commit was still refused for its commit, so this check refuses every transcript and proves nothing');
  }

  return {
    problems,
    summary: 'the judgement refuses a transcript carrying no deployed commit and one carrying a word instead, and it accepts a real short SHA',
  };
}

/* --------------------------------------------------------------------------- dispatch */

const PROBES = {
  provisional: probeProvisional,
  'filing-identity': probeFilingIdentity,
  'loading-window': probeLoadingWindow,
  'pack-values': probePackValues,
  'transcript-sha': probeTranscriptSha,
};

async function main() {
  const name = process.argv[2];
  if (name === undefined) {
    console.log(`name a probe. Known: ${Object.keys(PROBES).join(', ')}`);
    process.exit(2);
  }
  if (name === '--list') {
    console.log(Object.keys(PROBES).join('\n'));
    process.exit(0);
  }
  const probe = PROBES[name];
  if (!probe) {
    console.log(`no probe called ${name}. Known: ${Object.keys(PROBES).join(', ')}`);
    process.exit(2);
  }

  const { problems, summary } = await probe();
  if (problems.length > 0) {
    for (const problem of problems) console.log(problem);
    process.exit(1);
  }
  console.log(`ok: ${summary}`);
  process.exit(0);
}

/*
 * THREE EXIT CODES, AND THE THIRD ONE IS THE POINT.
 *
 *   0  the behaviour holds
 *   1  the behaviour does not hold, and the lines above say how
 *   2  this program was asked for a probe it does not have
 *   3  the probe threw before it could judge anything
 *
 * A crash used to exit 1 like a finding, and the row that reads this would then have printed its
 * own label, which says a behaviour regressed, over a stack trace that says no behaviour was
 * examined at all. That is a row diagnosing a cause it never tested, which is the one thing the
 * rows in scripts/readiness.mjs are not allowed to do. Delete a file this probe imports and the
 * difference is the whole message a reader gets.
 */
main().catch((error) => {
  const where = error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error);
  console.log(`the ${process.argv[2]} probe threw before it could judge anything: ${where}`);
  process.exit(3);
});
