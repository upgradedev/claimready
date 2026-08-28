/**
 * ClaimReady, the wiring.
 *
 * One store, two writers. The person on the page and the visitor's agent both go through the same
 * dispatch, so a tool call is visible on the page the moment it lands, field by field, and both
 * sides read the same revision number. That mirroring is the whole demonstration.
 *
 * Filing, roadside assistance and pinning a field are buttons, and no tool this page publishes
 * reaches any of them. That is the boundary, and it is a fact about the tool surface rather than a
 * claim about what a browser is able to click: an agent that has been talked into something by a
 * poisoned web page finds nothing in this page's tool list that commits anything.
 *
 * Who set each field lives on the claim, in src/core, not here. This file used to keep its own
 * parallel record and guess the writer from a depth counter. It no longer does: it reads
 * claim.provenance through the core helpers, so there is one record of who wrote what.
 *
 * The insurer's rules are data. A rule pack is fetched, checked by src/core/policy.js and handed to
 * the same tools, so switching insurer changes the answers and renames nothing.
 *
 * Which tools exist is not decided here either. src/webmcp/register.js owns the surface: this file
 * hands it the context and an instrument wrapper, and is told what changed. It used to keep its own
 * list of factories and its own register or withdraw loop alongside the one in that module, which
 * meant tool surface policy lived in the UI layer and two lifecycles had to agree.
 *
 * All the rules live in src/core. This file never validates a value or coerces a type: it hands
 * what it was given to dispatch and reports what came back.
 */

import { createStore } from '../core/store.js';
import { validateClaim, patchIsNoChange, PATCHABLE_FIELDS } from '../core/claim.js';
import { checkCoverage } from '../core/coverage.js';
import { estimateRepair } from '../core/estimate.js';
import { loadPolicyPack, describePack } from '../core/policy.js';
import { deriveRequirements, outstandingRequirements, summariseRequirements } from '../core/requirements.js';

import { createView } from './render.js';
import {
  startToolSurface,
  textOfResult,
  registeredToolNames,
  describeToolSurface
} from '../webmcp/register.js';

const FIXTURE_URL = './fixtures/demo-collision.json';
const LEDGER_LIMIT = 40;
const DESCRIPTION_DEBOUNCE_MS = 500;

const NO_PACK_REASON = 'The insurer rule pack did not load, so this page cannot say what the intake '
  + 'asks for. That is a loading problem on our side, not a statement that nothing is required.';

/**
 * Used only when the sample file cannot be fetched or is refused, so the page never renders empty.
 * Same shape as the fixture on disk, so the degraded path hands src/core exactly what the normal
 * path does, and it still points at the rule packs so the requirements panel can come up.
 */
const FALLBACK_FIXTURE = {
  policy: {
    id: 'MTR-2026-0417',
    currency: 'EUR',
    holder: { name: 'Maria K.' },
    vehicle: { make: 'Sample', model: 'Hatchback', plate: 'SYN-0000', class: 'compact' }
  },
  insurer_pack: 'northwind',
  available_packs: [
    { id: 'northwind', path: './fixtures/insurers/northwind.json' },
    { id: 'kestrel', path: './fixtures/insurers/kestrel.json' }
  ],
  claim: {}
};

boot();

async function boot() {
  const view = createView(document);

  const loaded = await loadFixture();
  let fixture = loaded.fixture;
  let fixtureSource = loaded.source;
  let fixtureError = null;

  // createClaim throws rather than silently dropping a bad seed field, so a fixture the rules
  // refuse must not take the page down with it.
  let store;
  try {
    store = createStore(fixture);
  } catch (error) {
    fixtureError = error && error.message ? error.message : String(error);
    fixture = FALLBACK_FIXTURE;
    fixtureSource = 'fallback';
    store = createStore(fixture);
  }

  const embeddedPolicy = fixture.policy || {};
  const holder = embeddedPolicy.holder && typeof embeddedPolicy.holder === 'object'
    ? embeddedPolicy.holder.name
    : embeddedPolicy.holder;

  // Without a schedule of coverages there is nothing to check a claim against, and the honest
  // answer is "cannot be checked", never "not covered". A policy with no sections would otherwise
  // read as a refusal, which would be a false statement about someone's cover.
  const noScheduleReason = 'The sample policy schedule did not load, so cover cannot be checked '
    + 'against it. This is a loading problem, not a decision about your cover.';

  const persona = {
    policyId: String(embeddedPolicy.id || embeddedPolicy.policy_id || 'unknown'),
    holder: String(holder || 'the policyholder'),
    currency: String(embeddedPolicy.currency || 'EUR'),
    vehicleClass: String((embeddedPolicy.vehicle && embeddedPolicy.vehicle.class) || 'compact'),
    note: 'Demonstration session. The claimant, the vehicle and the policy are invented for this demo.'
  };

  /**
   * Page state that is not claim state. The store contract has no action for any of it.
   *
   * `humanActions` holds the ids of intake requirements whose human action the person has
   * actually carried out on this page. It is the one fact src/core cannot work out for itself,
   * and it is handed to deriveRequirements rather than interpreted here, so the panel, the four
   * tools that read requirements and this file all get their answer from the same place.
   */
  const ui = { coverage: null, estimate: null, assistanceAt: null, humanActions: [] };
  const ledger = [];

  /**
   * Rule packs, keyed by the id the sample file gave them. Every pack listed is fetched at boot so
   * the picker can be labelled with the insurer's own name, and a pack that fails to load keeps its
   * entry with the reason attached rather than vanishing from the list.
   */
  const packs = new Map();
  let activePackId = null;

  /* Tool call bookkeeping. agentDepth says a tool is on the stack, and refusals raised while it is
     are collected into the buffer belonging to that call. Reading store.lastCode before and after a
     call would miss a refusal followed by a success inside the same call, which is exactly what a
     batched patch does. */
  let agentDepth = 0;
  let refusalBuffer = null;

  /* Tool registration. toolStatus holds what the browser last answered about the surface as a
     whole; the live list of names always comes from register.js rather than from here, because the
     conditional tool comes and goes and a remembered list would go stale. */
  let toolStatus = { available: false, api: null, registered: [], skipped: [], failed: [] };

  let snapshot = snapshotOf(claimNow());

  /* The commit a textarea has scheduled and not yet made. It lives out here because three things
     have to be able to cancel it: the next keystroke, whichever event commits the field first, and
     the reset. A pending commit that survives a reset writes the old account back over the draft
     that replaced it. */
  let pendingCommit = null;

  /* Requirement redraw bookkeeping. The panel is rebuilt only when the derived list actually moves,
     so a keystroke in the description does not replay the "just appeared" highlight, and nothing is
     marked new on the first draw or after a reset. */
  let requirementIds = new Set();
  let requirementSignature = null;
  let requirementsPrimed = false;

  /* Which pack this customer is actually with, as the sample file states it. The picker can load
     another insurer's published rules against the same claim, and where it has, every surface that
     names a policy has to say whose rules answered. */
  const homePackId = typeof fixture.insurer_pack === 'string' ? fixture.insurer_pack : null;

  const context = {
    store,
    pack: null,
    packId: null,
    homePackId,
    policy: embeddedPolicy,
    policyId: persona.policyId,
    currency: persona.currency,
    vehicleClass: persona.vehicleClass,
    hasPolicySchedule: hasSchedule(embeddedPolicy),
    noScheduleReason,
    humanActions: [],
    publish
  };

  // getRequirements is deliberately NOT on the context. It used to be, and the one tool that read
  // it worked out for itself, from a decoration on the page's own copy, whether a requirement had
  // been dealt with. That is how two tools came to give two answers about one claim. What a tool
  // needs is the completed actions, which is what humanActions carries, and it hands them to
  // src/core rather than deciding anything with them. Nothing under src/webmcp reads this
  // function now, and putting it back would put the inference back within reach.

  view.renderPersona(persona);
  refreshStatus();
  view.renderRevision(claimNow().revision);
  view.renderCoverage(null);
  view.renderEstimate(null);
  view.renderLedger(ledger);
  redraw([]);

  await loadPacks();
  applyPack(activePackId);
  view.renderPackChoices(packChoices(), activePackId);
  redraw([]);

  store.subscribe(() => {
    const state = store.getState();

    // A refusal notifies too. Whichever tool call is on the stack owns it, and the ledger shows it
    // next to the call that caused it.
    if (state.lastCode && agentDepth > 0 && refusalBuffer) {
      refusalBuffer.push({ code: state.lastCode, error: state.lastError });
    }

    const next = state.claim;
    const changed = [];
    for (const field of PATCHABLE_FIELDS) {
      if (Object.is(snapshot[field], next[field])) continue;
      changed.push(field);
    }
    snapshot = snapshotOf(next);

    view.renderRevision(next.revision);
    redraw(changed);

    // A revision that moved no field cannot have moved an answer. Filing, pinning and unpinning
    // all advance the counter without touching a value, so those re-stamp the panels instead of
    // clearing them: clearing a cover decision the instant the claim is filed would tell a viewer
    // the answer had changed when nothing it reads had.
    if (changed.length === 0) restampPanels(next.revision);
    else expirePanels(next.revision);
  });

  wireControls();

  // One call brings up the whole surface and keeps it matching the claim. register.js holds the
  // lists, subscribes to the same store, serialises its own registrations and listens for the
  // browser's toolchange event, so nothing about which tools exist is decided in this file.
  const surface = await startToolSurface(context, { instrument, onChange: onToolSurfaceChange });
  noteToolStatus(surface.status);
  refreshStatus();

  /* Reading the store */

  function claimNow() {
    return store.getState().claim;
  }

  /* Rule packs */

  async function loadPacks() {
    const listed = Array.isArray(fixture.available_packs) && fixture.available_packs.length
      ? fixture.available_packs
      : FALLBACK_FIXTURE.available_packs;

    const results = await Promise.all(listed.map((entry) => fetchPack(entry)));
    for (const entry of results) packs.set(entry.id, entry);

    // The sample file names the pack this customer is on. A pack that failed to load cannot be the
    // active one, or the page would report no requirements while looking perfectly healthy.
    const wanted = typeof fixture.insurer_pack === 'string' ? fixture.insurer_pack : null;
    const named = wanted ? packs.get(wanted) : null;
    const usable = results.find((entry) => entry.pack !== null);
    if (named && named.pack) activePackId = named.id;
    else if (usable) activePackId = usable.id;
    else activePackId = results[0] ? results[0].id : null;
  }

  async function fetchPack(entry) {
    const id = String(entry && entry.id ? entry.id : 'unknown');
    const path = entry && entry.path ? String(entry.path) : '';
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const pack = loadPolicyPack(await response.json());
      return { id, path, pack, error: null, label: pack.insurer };
    } catch (error) {
      return { id, path, pack: null, error: error && error.message ? error.message : String(error), label: id };
    }
  }

  function packChoices() {
    return Array.from(packs.values()).map((entry) => ({ id: entry.id, label: entry.label }));
  }

  /**
   * Point the whole page and every registered tool at one insurer's rules.
   *
   * The tools read ctx.policy inside execute rather than closing over it, so setting it here is all
   * it takes. The store is never rebuilt: the tools hold the one they were registered with, and a
   * second store would leave them writing to a draft nobody can see.
   */
  function applyPack(id) {
    const entry = id ? packs.get(id) : null;
    if (entry && entry.pack) {
      activePackId = entry.id;
      context.pack = entry.pack;
      context.packId = entry.id;
      context.policy = entry.pack;
      context.currency = entry.pack.currency;
      context.hasPolicySchedule = hasSchedule(entry.pack);

      // Say whose rules are loaded and whose policy the claim is on, whenever they differ. The
      // picker changes the schedule, not the customer: policy MTR-2026-0417 does not become a
      // policy with the other insurer because their rule pack was loaded against it, and the page
      // used to leave a reader to work that out from a policy number in a decision line.
      const borrowed = homePackId && entry.id !== homePackId;
      view.renderPackNote(borrowed
        ? `${describePack(entry.pack)} These are ${entry.pack.insurer}'s published rules, read `
          + `against the same claim. Policy ${persona.policyId} itself is not with ${entry.pack.insurer}.`
        : describePack(entry.pack));
      view.renderPersona({ ...persona, insurer: entry.pack.insurer, borrowed: Boolean(borrowed) });
      return;
    }

    context.pack = null;
    context.packId = null;
    context.policy = embeddedPolicy;
    context.currency = persona.currency;
    context.hasPolicySchedule = hasSchedule(embeddedPolicy);
    view.renderPersona({ ...persona, insurer: null, borrowed: false });
    view.renderPackNote(entry && entry.error
      ? `The ${entry.id} rule pack did not load: ${entry.error}. The cover check falls back to the schedule stored with this policy.`
      : NO_PACK_REASON);
  }

  /**
   * The requirements this insurer's intake raises right now.
   *
   * The one page fact src/core cannot know, which human actions the person has carried out, goes
   * IN as ui.humanActions rather than being applied to the result afterwards. Whether a
   * requirement is answered is decided in one place, by deriveRequirements, and this function only
   * adds the timestamp line the page prints beside the row. The tools never see that line and no
   * tool infers anything from it.
   */
  function getRequirements() {
    const pack = context.pack;
    if (!pack) return [];
    return deriveRequirements(pack, claimNow(), ui.humanActions).map((entry) => {
      const humanOnly = Boolean(entry.humanAction);
      const shown = { ...entry, humanOnly, humanNote: null };
      if (humanOnly && entry.satisfied && ui.assistanceAt) {
        shown.humanNote = `You pressed Request roadside assistance at ${ui.assistanceAt}. `
          + 'There is no tool for that button, so your agent had to ask you.';
      }
      return shown;
    });
  }

  /** Record that a human action has been carried out, and tell the tools. */
  function recordHumanActions(ids) {
    const merged = new Set(ui.humanActions);
    for (const id of ids) merged.add(id);
    ui.humanActions = [...merged];
    context.humanActions = ui.humanActions;
  }

  /* Drawing */

  /**
   * One redraw, one list of requirements.
   *
   * THE TWO PANELS ARE DRAWN FROM ONE INPUT BECAUSE THEY ARE TWO STATEMENTS ABOUT ONE DRAFT. They
   * used to be worked out separately, and the file panel was never handed the requirements at all,
   * so it printed "The draft is complete" over a draft the panel beside it was reporting as
   * incomplete. Two panels that read two inputs cannot be made to agree by wording; they have to
   * read the same answer, which is what this function is for.
   *
   * @param {string[]} changed the fields that moved since the last draw, for the row highlight
   */
  function redraw(changed) {
    const entries = getRequirements();
    drawClaim(changed, entries);
    drawRequirements(entries);
  }

  function drawClaim(changed, entries) {
    const claim = claimNow();
    const verdict = validateClaim(claim);
    const list = Array.isArray(entries) ? entries : [];
    view.renderClaim(claim, changed);
    view.renderActions({
      ready: Boolean(verdict.ready),
      missing: verdict.missing || [],
      // What the insurer still asks for, which is a wider question than what the file gate blocks
      // on. A rule with no field is the sharpest case: no patch from either side can close it.
      outstanding: outstandingRequirements(list).map((entry) => ({
        id: entry.id,
        label: entry.label,
        field: entry.field
      })),
      insurer: context.pack ? context.pack.insurer : null,
      // Not the same as nothing being asked for, and never printed as though it were.
      requirementsKnown: Boolean(context.pack),
      filed: claim.status === 'filed',
      filedAt: claim.filed_at,
      assistanceAt: ui.assistanceAt,
      assistanceAvailable: assistanceApplies(claim)
    });
  }

  function drawRequirements(entries) {
    if (!context.pack) {
      requirementIds = new Set();
      requirementSignature = null;
      requirementsPrimed = false;
      view.renderRequirements({ entries: [], summary: '', newIds: [], blocked: NO_PACK_REASON });
      return;
    }

    const signature = entries.map((entry) => `${entry.id}|${entry.satisfied}|${entry.why}|${entry.humanNote}`).join('~');
    if (signature === requirementSignature) return;

    const ids = entries.map((entry) => entry.id);
    const newIds = requirementsPrimed ? ids.filter((id) => !requirementIds.has(id)) : [];

    requirementIds = new Set(ids);
    requirementSignature = signature;
    requirementsPrimed = true;

    view.renderRequirements({
      entries,
      summary: summariseRequirements(entries),
      newIds,
      blocked: null
    });

    if (newIds.length) {
      const labels = entries.filter((entry) => newIds.includes(entry.id)).map((entry) => entry.label);
      view.announce(`The intake now asks for ${labels.join(', ')}.`);
    }
  }

  /**
   * Put a worked out answer on the page, stamped with what it was worked out against.
   *
   * THE STAMP IS THE WHOLE POINT OF THIS FUNCTION. A cover decision and a repair band are answers
   * to a question asked at one moment, about one draft, under one insurer's schedule. Without the
   * stamp nothing downstream could tell that the draft had moved underneath them, and it showed:
   * a claim could be changed from collision to theft and the panel went on reading COVERED under
   * clause OD-4.1 with a 250 excess, next to a draft that now said theft.
   *
   * The revision is stamped on both panels because both are answers about the draft. The pack id
   * is stamped on both and compared only for the cover decision, which is the one that reads the
   * insurer's schedule. The repair band comes from a fixed parts table and does not move with the
   * pack, which is also why switchPack leaves it alone.
   *
   * TWO NUMBERS, NOT ONE, AND THEY ARE DIFFERENT FACTS. `revision` is where this answer was worked
   * out and is never written again. `validAt` is the latest revision it is still an answer about,
   * and it moves when the draft advances without a field changing. Collapsing them into one number
   * would put a revision on the panel at which nothing was ever worked out, which is a smaller
   * version of the lie this whole panel now exists to prevent.
   */
  function publish(kind, payload) {
    const at = clockNow();
    const revision = claimNow().revision;
    if (kind === 'coverage') {
      ui.coverage = {
        ...payload,
        at,
        revision,
        validAt: revision,
        packId: activePackId,
        insurer: context.pack ? context.pack.insurer : null
      };
      view.renderCoverage(ui.coverage);
    } else if (kind === 'estimate') {
      ui.estimate = { ...payload, at, revision, validAt: revision, packId: activePackId };
      view.renderEstimate(ui.estimate);
    }
  }

  /**
   * Whether a panel is still an answer about the draft in front of the reader.
   *
   * @param {object|null} entry a published result, or null when the panel holds a message
   * @param {number} revision the revision the claim is at now
   * @param {boolean} readsThePack true for an answer taken from the insurer's schedule
   */
  function panelIsStale(entry, revision, readsThePack) {
    if (!entry || entry.blocked) return false;
    if (entry.validAt !== revision) return true;
    return readsThePack && entry.packId !== activePackId;
  }

  /**
   * Replace an answer that no longer describes this draft with a plain sentence saying so.
   *
   * NOTHING IS RECOMPUTED HERE, DELIBERATELY. A person pressed a button and got an answer. Quietly
   * working out a new one and swapping it in would change what the page says without anyone asking
   * and without anyone being told, which is the failure this whole page is arguing against. So the
   * panel says the draft has moved, names both revisions, and waits to be asked again.
   */
  function expirePanels(revision) {
    if (panelIsStale(ui.coverage, revision, true)) {
      const workedOutAt = ui.coverage.revision;
      ui.coverage = null;
      view.renderCoverage({
        blocked: `The draft has moved since this cover check was worked out at revision ${workedOutAt}. `
          + `It is at revision ${revision} now, so press Check cover again to see what this schedule says about it.`
      });
    }
    if (panelIsStale(ui.estimate, revision, false)) {
      const workedOutAt = ui.estimate.revision;
      ui.estimate = null;
      view.renderEstimate({
        blocked: `The draft has moved since this band was worked out at revision ${workedOutAt}. `
          + `It is at revision ${revision} now, so press Show the band again.`
      });
    }
  }

  /**
   * Carry a still valid answer forward.
   *
   * Only `validAt` moves. Where the answer was worked out is a fact about the past and stays put,
   * so the panel goes on naming the revision that produced it and adds the revision it is still
   * current at. Filing and pinning both land here.
   */
  function restampPanels(revision) {
    if (ui.coverage && ui.coverage.validAt !== revision) {
      ui.coverage = { ...ui.coverage, validAt: revision };
      view.renderCoverage(ui.coverage);
    }
    if (ui.estimate && ui.estimate.validAt !== revision) {
      ui.estimate = { ...ui.estimate, validAt: revision };
      view.renderEstimate(ui.estimate);
    }
  }

  /* Tool instrumentation: every call is ledgered with what it sent, what it got back, and every
     refusal the rules raised while it ran. The tools themselves stay unaware of the ledger. */

  function instrument(factory) {
    return (ctx) => {
      const descriptor = factory(ctx);
      const inner = descriptor.execute;

      return {
        ...descriptor,
        execute: async (input, options) => {
          const at = clockNow();
          const buffer = [];
          const outer = refusalBuffer;
          refusalBuffer = buffer;
          agentDepth += 1;

          let result;
          let failure = null;
          try {
            result = await inner.call(descriptor, input, options);
          } catch (error) {
            failure = error;
          } finally {
            agentDepth -= 1;
            refusalBuffer = outer;
          }

          addLedgerEntry({
            at,
            name: descriptor.name,
            args: safeArgs(input),
            text: failure ? `error: ${failure && failure.message ? failure.message : String(failure)}` : textOfResult(result),
            error: Boolean(failure),
            refusals: buffer
          });

          view.announce(buffer.length
            ? `Your agent called ${descriptor.name}. The page refused it: ${buffer[0].code}.`
            : `Your agent called ${descriptor.name}. The draft is at revision ${claimNow().revision}.`);

          if (failure) throw failure;
          return result;
        }
      };
    };
  }

  /**
   * What the browser last answered about the surface as a whole.
   *
   * A run that reports no failures leaves the last recorded ones alone, so a refusal the browser
   * raised stays on the strip instead of being cleared by the next quiet reconcile.
   */
  function noteToolStatus(next) {
    toolStatus = {
      ...toolStatus,
      ...next,
      failed: next && next.failed && next.failed.length ? next.failed : toolStatus.failed
    };
  }

  /**
   * The strip and the published tool list, redrawn together.
   *
   * They answer two different questions and must never be allowed to disagree. The strip says what
   * the browser offered; the list says what this page publishes and marks each row with whether the
   * browser is holding it. Both are read fresh here, the names from register.js and the surface
   * from the same two lists it registers from, so the count moves the moment the conditional tool
   * is published or withdrawn.
   */
  function refreshStatus() {
    const registered = toolStatus.available ? registeredToolNames() : [];

    view.renderStatus({
      ...toolStatus,
      registered,
      fixtureSource,
      fixtureError
    });

    view.renderToolSurface({
      tools: describeToolSurface(context),
      available: toolStatus.available,
      api: toolStatus.api,
      registered
    });
  }

  /**
   * register.js has changed the surface, or the browser has told it the surface changed.
   *
   * Every sentence read out here is built from the clause the rule in register.js wrote next to
   * itself, so a tool that comes and goes for some other reason announces itself correctly without
   * this file knowing anything about it. Nothing is read out for a registration the browser
   * refused: the failure goes to the strip, which is where a reason belongs.
   *
   * THE PAYLOAD IS THE ONLY SAFE SOURCE HERE. startToolSurface calls this during its own first
   * reconcile, which is before the const holding its return value has been assigned, so reading
   * that handle for available, api or the registered list would be a use before initialisation.
   * It would also be a quiet one, because register.js calls this inside a try. That is why the
   * strip reads registeredToolNames from the module, and why the returned reconcile and stop
   * handles have no caller: the page lives as long as the surface does.
   */
  function onToolSurfaceChange(change) {
    noteToolStatus({ available: change.available, api: change.api, failed: change.failed });

    for (const entry of change.changes || []) {
      const clause = sentenceCase(entry.because || 'the claim changed');
      view.announce(entry.published
        ? `${clause}, so this page has published ${entry.name} to your agent.`
        : `${clause}, so ${entry.name} has been withdrawn from your agent.`);
    }

    refreshStatus();
  }

  function addLedgerEntry(entry) {
    ledger.unshift(entry);
    if (ledger.length > LEDGER_LIMIT) ledger.length = LEDGER_LIMIT;
    view.renderLedger(ledger);
  }

  /* Human controls */

  function cancelPendingCommit() {
    if (pendingCommit === null) return;
    clearTimeout(pendingCommit);
    pendingCommit = null;
  }

  function wireControls() {
    const onChange = (event) => {
      const control = event.target;
      if (control && control.getAttribute && control.getAttribute('data-field')) commitControl(control);
    };
    const onClick = (event) => {
      const button = event.target && event.target.closest ? event.target.closest('[data-pin]') : null;
      if (button) togglePin(button);
    };

    for (const host of [view.els.fields, view.els.fieldsOptional]) {
      host.addEventListener('change', onChange);
      host.addEventListener('click', onClick);
    }

    // A textarea commits on a pause in the typing so an agent watching the page sees the account
    // as it is written. The timer belongs to the page, not to this function, because the reset
    // has to be able to cancel it too: a commit that fires after the draft has been reloaded
    // writes the old text back over the new one.
    view.els.fields.addEventListener('input', (event) => {
      const control = event.target;
      if (!control || control.tagName !== 'TEXTAREA') return;
      cancelPendingCommit();
      pendingCommit = setTimeout(() => {
        pendingCommit = null;
        commitControl(control);
      }, DESCRIPTION_DEBOUNCE_MS);
    });

    view.els.insurerSelect.addEventListener('change', (event) => {
      switchPack(event.target.value);
    });

    view.els.checkCoverageBtn.addEventListener('click', runCoverageByHand);
    view.els.checkEstimateBtn.addEventListener('click', runEstimateByHand);
    view.els.fileBtn.addEventListener('click', fileThisClaim);
    view.els.assistanceBtn.addEventListener('click', requestAssistance);
    view.els.resetBtn.addEventListener('click', startOver);
  }

  function commitControl(control) {
    const field = control.getAttribute('data-field');
    if (!field) return;

    // Whichever event got here first wins, and any commit still waiting on the typing timer is
    // dropped. Without this the timer fired, the change event on the way out of the field fired
    // too, and the same text was committed twice: two revisions for one edit, with the second one
    // re-stamping provenance on a draft nobody had moved.
    cancelPendingCommit();
    view.showFieldError('');

    // An empty control means clear. The rules allow that for an optional field and refuse it for a
    // required one, and they say so themselves.
    const raw = control.value === '' ? null : control.value;

    // The rules decide whether this is a change; this file still coerces nothing. A commit that
    // would store what is already stored is dropped rather than dispatched, because the store
    // cannot tell a second commit of one edit from a real one and would move the revision for it.
    // Anything the rules would refuse is NOT silence: patchIsNoChange answers false for a bad
    // value, a pinned field and a filed claim, so every refusal still reaches the page.
    if (patchIsNoChange(claimNow(), [{ field, value: raw }])) return;

    const result = store.dispatch({ type: 'patch', field, value: raw });
    if (!result.ok) {
      view.showFieldError(result.error || 'That value was not accepted.');
      redraw([]);
    }
  }

  /**
   * Pinning is human only and there is no tool for it, which is the point of the control. The
   * button's own pressed state says which way to go, so the page never holds a second copy of what
   * the claim already records.
   */
  function togglePin(button) {
    const field = button.getAttribute('data-pin');
    if (!field) return;

    // Pinning closes a field to every patch, so a commit already scheduled against it would be
    // refused as locked a moment after the person pinned it on purpose.
    cancelPendingCommit();

    const pinned = button.getAttribute('aria-pressed') === 'true';
    const result = store.dispatch({ type: pinned ? 'unlock' : 'lock', field });
    if (!result.ok) {
      view.showFieldError(result.error || 'That field could not be pinned.');
      return;
    }
    view.showFieldError('');
    view.announce(pinned
      ? `You unpinned ${field}. A patch can change it again.`
      : `You pinned ${field}. No patch can move it now.`);
  }

  /**
   * Point the page at another insurer's published rules.
   *
   * THE REVISION MOVES, AND THAT IS THE WHOLE POINT OF THE DISPATCH BELOW. Nothing on the claim
   * changes here, and every tool starts answering differently: different clauses, a different
   * excess, a different intake list. An agent holding the number it read a moment ago would have
   * been writing against answers that no longer exist, and its patch was accepted at the same
   * number. Recording the switch as a context change moves the counter, so that patch is refused
   * as stale with the same code as one written before a human edit, and the agent reads again.
   *
   * This is dispatched from the picker only, never from applyPack, which also runs once at boot.
   * Bumping the counter there would start the page at revision 1 and make every worked example
   * that quotes 0 wrong.
   */
  function switchPack(id) {
    if (!id || id === activePackId) return;
    applyPack(id);

    // A cover check run under another insurer's schedule is not this insurer's answer, so it goes
    // rather than sitting there looking current. The repair band comes from a parts table and does
    // not move with the pack, so it stays.
    ui.coverage = null;
    view.renderCoverage({
      blocked: context.pack
        ? `The rules changed to ${context.pack.insurer}. Run the cover check again to see what this schedule says.`
        : context.noScheduleReason
    });

    requirementSignature = null;
    requirementsPrimed = false;

    const insurer = context.pack ? context.pack.insurer : id;
    store.dispatch({ type: 'context', reason: `the insurer rule pack changed to ${insurer}` });

    redraw([]);
    view.announce(context.pack
      ? `Rules switched to ${context.pack.insurer}. The same tools now answer with that schedule, and the `
        + `revision has moved on to ${claimNow().revision}, so a patch quoting an earlier one is refused.`
      : 'That rule pack could not be loaded.');
  }

  function runCoverageByHand() {
    const claim = claimNow();
    if (!context.hasPolicySchedule) {
      view.renderCoverage({ blocked: context.noScheduleReason });
      return;
    }
    if (!claim.incident_type) {
      view.renderCoverage({ blocked: 'Pick what kind of incident it was first, then the cover can be checked.' });
      return;
    }
    publish('coverage', { decision: checkCoverage(context.policy, claim), source: 'you' });
  }

  function runEstimateByHand() {
    const claim = claimNow();
    if (isEmpty(claim.damage_zone) || isEmpty(claim.severity)) {
      view.renderEstimate({ blocked: 'The band needs a damage position and a severity on the draft above.' });
      return;
    }
    publish('estimate', {
      band: estimateRepair({ zone: claim.damage_zone, severity: claim.severity, vehicleClass: persona.vehicleClass }),
      zone: claim.damage_zone,
      severity: claim.severity,
      whatIf: false,
      source: 'you'
    });
  }

  function fileThisClaim() {
    // Same hazard as the reset, one control over. A commit still waiting on the typing timer would
    // land on a claim that is closed by the time it arrives, and the person who filed the draft
    // would watch a refusal paint under it a moment later for something they had already finished.
    cancelPendingCommit();

    const result = store.dispatch({ type: 'file', at: clockNow() });
    if (!result.ok) {
      view.showFieldError(result.error || 'The claim could not be filed.');
      return;
    }
    view.showFieldError('');
    view.announce('You filed the claim. The draft is closed to every writer, yours and your agent\'s.');
  }

  /**
   * Whether asking for a roadside collection is something this claim can ask for at all.
   *
   * Read from the claim, never from the button. A collection is what this insurer arranges for a
   * vehicle that cannot be driven, so the control is closed until the draft says that, with the
   * reason drawn beside it. It was open from the first paint before, on a draft that had not said
   * whether the car still drove, and pressing it recorded a recovery request against a claim that
   * had never asked for one.
   */
  function assistanceApplies(claim) {
    return Boolean(claim) && claim.vehicle_drivable === false && claim.status !== 'filed';
  }

  function requestAssistance() {
    if (ui.assistanceAt) return;

    // The control is disabled while this is false, so reaching here means the draft moved between
    // the paint and the press. Refusing is cheaper than trusting the button.
    const claim = claimNow();
    if (!assistanceApplies(claim)) {
      view.showFieldError('Roadside collection is for a vehicle that cannot be driven, and this '
        + 'draft does not say that. Answer whether the car still drives first.');
      redraw([]);
      return;
    }

    ui.assistanceAt = clockNow();
    // What the person just did, named by the requirements it answers, so src/core and every tool
    // read one answer rather than four surfaces guessing from a note on the page.
    const closed = getRequirements().filter((entry) => entry.humanOnly).map((entry) => entry.id);
    recordHumanActions(closed);

    // The claim did not move and the answers did: a requirement that every tool reported as open
    // is now answered. Same reasoning as switchPack, same action, same refusal for an agent still
    // holding the earlier number.
    if (closed.length) {
      store.dispatch({
        type: 'context',
        reason: `a human action closed ${closed.length === 1 ? 'a requirement' : `${closed.length} requirements`} on this page`
      });
    }

    view.showFieldError('');
    redraw([]);

    view.announce('You requested roadside assistance. No tool on this page reaches that button. The '
      + `revision has moved on to ${claimNow().revision}, so a patch quoting an earlier one is refused.`);
    // Pressing this changes nothing about the tool surface. The tool that reads out the assistance
    // options exists while the claim says the vehicle cannot be driven, which is a fact about the
    // claim, and register.js is what watches it.
  }

  function startOver() {
    // A commit the typing timer has scheduled would land after the reset and write the old account
    // back over the reloaded draft, so it goes first of all.
    cancelPendingCommit();

    // Page state first, then the draft. The subscriber redraws the moment the reset lands, and it
    // should not redraw against a roadside request that this reset has already cancelled.
    ui.coverage = null;
    ui.estimate = null;
    ui.assistanceAt = null;
    ui.humanActions = [];
    context.humanActions = ui.humanActions;
    ledger.length = 0;
    requirementSignature = null;
    requirementsPrimed = false;
    store.dispatch({ type: 'reset' });
    requirementSignature = null;
    requirementsPrimed = false;
    view.renderCoverage(null);
    view.renderEstimate(null);
    view.renderLedger(ledger);
    view.showFieldError('');
    redraw([]);

    // Said on the page as well as to the live region. On a draft nobody has touched yet, reloading
    // it changes no answer a visitor can see, and without a word the button reads as broken to the
    // one visitor most likely to press it first.
    //
    // The draft goes back and the counter does not, and the note says both. The revision is what a
    // patch quotes, so sending it back to a number an agent had already read let a patch written
    // against the draft that was just thrown away be accepted against the one that replaced it.
    const at = clockNow();
    view.renderResetNote(`Synthetic incident loaded again at ${at}. The draft is back as it was, the `
      + `ledger is empty and the panels are cleared. The revision has moved on to ${claimNow().revision}, `
      + 'so a patch quoting an earlier one is refused rather than applied to this draft.');
    view.announce('The synthetic incident was loaded again. The draft is back as it was and the '
      + `revision has moved on to ${claimNow().revision}.`);
  }
}

/* Helpers */

async function loadFixture() {
  try {
    const response = await fetch(FIXTURE_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== 'object') throw new Error('the sample file was not an object');
    return { fixture: data, source: 'file' };
  } catch (error) {
    return { fixture: FALLBACK_FIXTURE, source: 'fallback' };
  }
}

function hasSchedule(policy) {
  return Boolean(policy && Array.isArray(policy.coverages) && policy.coverages.length > 0);
}

function snapshotOf(claim) {
  const copy = {};
  for (const field of PATCHABLE_FIELDS) copy[field] = claim ? claim[field] : undefined;
  return copy;
}

function safeArgs(input) {
  try {
    return JSON.stringify(input === undefined ? {} : input);
  } catch (error) {
    return '[arguments could not be shown]';
  }
}

function clockNow() {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Start a reason clause as a sentence. The clauses are written lower case in register.js so they
 * read correctly inside a longer sentence too, and only the first letter moves here.
 */
function sentenceCase(text) {
  const body = String(text || '');
  return body.charAt(0).toUpperCase() + body.slice(1);
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}
