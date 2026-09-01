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
import { patchIsNoChange, PATCHABLE_FIELDS } from '../core/claim.js';
import { canFile } from '../core/filing.js';
import {
  buildFilingPacket,
  canonicalise,
  digestOf,
  packetAsMarkdown,
} from '../core/packet.js';
import { checkCoverage } from '../core/coverage.js';
import { estimateRepair } from '../core/estimate.js';
import { loadPolicyPack, describePack } from '../core/policy.js';
import { deriveRequirements, outstandingRequirements, summariseRequirements } from '../core/requirements.js';

import { createView } from './render.js';
import {
  startToolSurface,
  textOfResult,
  registeredToolNames,
  describeToolSurface,
  clip,
  MAX_TOOL_OUTPUT_CHARS
} from '../webmcp/register.js';
import {
  EMPTY_SUBMISSION_REASON,
  FORM_REFUSED_EMPTY,
  FORM_TOOL_NAME,
  describeDeclarativeForm,
  describeOutcome,
  planSubmission
} from '../webmcp/declarative_form.js';

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

  /*
   * THE FORM'S SUBMIT IS CAUGHT BEFORE ANYTHING IS AWAITED, AND THAT IS THE WHOLE REASON THIS PAIR
   * EXISTS. The form carries an action, because both documented examples do, and a submit that
   * reached the browser's default would navigate and take the draft with it. The handler that does
   * the real work cannot be attached yet: it needs the store, and the store needs the sample file,
   * which is a fetch. So the listener goes on now, in the same synchronous run as createView, and
   * forwards to whatever is in this variable at the time. wireControls swaps in the real one.
   *
   * Nothing is silently dropped in between. A person is told the page is still coming up, and an
   * agent that submitted inside that window is answered rather than left waiting on a promise that
   * never resolves.
   */
  let onDeclaredSubmit = (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const said = 'The page is still loading the claim and the insurer rules, so nothing was '
      + 'written. Nothing on the draft changed. Try again in a moment.';
    view.renderDeclaredResult(said);
    if (event && event.agentInvoked === true && typeof event.respondWith === 'function') {
      try {
        event.respondWith(Promise.resolve(said));
      } catch (ignored) { /* a browser that refuses the response must not break the boot */ }
    }
  };
  view.els.declaredForm.addEventListener('submit', (event) => onDeclaredSubmit(event));

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

  /* The handler packet, once a person has filed. Null until then, and null again after a reset. */
  let packet = null;

  /**
   * Rule packs, keyed by the id the sample file gave them. Every pack listed is fetched at boot so
   * the picker can be labelled with the insurer's own name, and a pack that fails to load keeps its
   * entry with the reason attached rather than vanishing from the list.
   */
  const packs = new Map();
  let activePackId = null;
  let requestedPackId = null;

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

  /* Why the draft is closed, or null once it is open.

     THE CONTROLS ARE NOT THE GUARD. They are drawn disabled while the rule packs are in flight,
     which is what a person meets, but `disabled` is a property of one painted control and the
     handlers live on the two hosts. Anything that reaches a handler another way, an event
     dispatched by script or a control drawn before the flag was read, would otherwise be committed
     to a store whose subscriber is not attached yet: the value lands, the revision chip does not
     move, and the redraw after the fetch paints the empty field back over it. That is the exact
     silent loss this window was fixed for, so the refusal is here, in the one place every edit
     passes through, and it says so on the page rather than dropping the edit. */
  let loadingReason = 'The page is still reading the insurer rules, so the draft is not open yet. '
    + 'Nothing was written. Try again in a moment.';

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

  // WIRED BEFORE ANYTHING IS DRAWN. The listeners live on the two field hosts and read the event's
  // target, so they cost nothing before there is data and they cannot miss an edit once there is.
  // They used to be attached after the rule packs had been fetched, which left a window where the
  // draft looked open and was not.
  wireControls();

  view.renderPersona(persona);
  refreshStatus();
  view.renderRevision(claimNow().revision);
  view.renderCoverage(null);
  view.renderEstimate(null);
  view.renderLedger(ledger);
  // Closed until the rules are in, with the reason on the page. The redraw after the fetch would
  // paint over anything typed in the meantime, so the honest thing is to say the draft is not open
  // yet rather than to accept a keystroke and lose it.
  view.setClaimBusy("Reading this insurer's rules. The draft opens as soon as they are in.");
  redraw([]);

  await loadPacks();
  loadingReason = null;
  view.setClaimBusy(null);
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
    requestedPackId = activePackId;
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

    // Nothing loaded, so nothing is active. Leaving the previous id here was the other half of
    // the stranding above: the page reported a pack it was no longer answering under.
    activePackId = null;
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
        shown.humanNote = `Request roadside assistance was pressed on this page at ${ui.assistanceAt}. `
          + 'It is not exposed as a WebMCP tool, so an agent has to ask for it.';
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
    drawClaim(changed);
    drawRequirements(entries);
  }

  /**
   * THE BUTTON AND THE SENTENCE BESIDE IT COME FROM ONE DECISION, AND SO DOES THE DOMAIN.
   *
   * This used to hand the view three separate derivations: `ready` off validateClaim, an
   * outstanding list off the panel's own entries, and a `requirementsKnown` flag. The view then
   * disabled the button on `ready` alone, which is the static required list and knows nothing the
   * insurer derives, so the button stayed open over a panel reporting an open requirement and the
   * store filed the claim. `canFile` is now the only answer, it is the same answer src/core/claim.js
   * refuses on, and the view draws from it rather than deciding anything.
   *
   * It derives its own outstanding list rather than being handed this draw's, and that is not a
   * second opinion: it is the same pure function over the same pack, the same claim and the same
   * completed human actions, so the two cannot come out differently.
   */
  function drawClaim(changed) {
    const claim = claimNow();
    view.renderClaim(claim, changed);
    view.renderActions({
      decision: canFile(context.pack, claim, ui.humanActions, { homePackId: context.homePackId }),
      filed: claim.status === 'filed',
      filedAt: claim.filed_at,
      assistanceAt: ui.assistanceAt,
      assistanceAvailable: assistanceApplies(claim)
    });
    // The declarative form is part of the draft, so it closes when the draft closes and its hint
    // carries the revision an agent has to quote right now.
    view.renderDeclaredForm({ filed: claim.status === 'filed', revision: claim.revision });
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

    // BOTH HALVES OF THE API, IN ONE LIST, because a judge reading "nine tools" while their agent
    // holds ten would be right to distrust the page. The nine are read from register.js, which is
    // the same list it registers from. The tenth is the form in index.html, which nothing registers
    // and which the view therefore marks as declared rather than as registered.
    view.renderToolSurface({
      tools: [...describeToolSurface(context), describeDeclarativeForm()],
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

    // The listener is already on the form, from before the first await. This is where it stops
    // saying "still loading" and starts writing to the draft.
    onDeclaredSubmit = submitDeclaredForm;

    view.els.checkCoverageBtn.addEventListener('click', runCoverageByHand);
    view.els.checkEstimateBtn.addEventListener('click', runEstimateByHand);
    view.els.fileBtn.addEventListener('click', fileThisClaim);

    view.els.packetToggle.addEventListener('click', () => {
      if (!packet) return;
      packet.open = !packet.open;
      view.togglePacketView(packet.open);
      view.sayAboutPacket('');
    });

    view.els.packetCopy.addEventListener('click', async () => {
      const json = packetAsJson();
      // The control is closed while this is true, so reaching here means the draft moved between
      // the paint and the press. Refusing is cheaper than trusting the button.
      if (!json || !packet || !packet.digest) {
        view.sayAboutPacket('The digest is not ready yet, so there is nothing to copy that anyone '
          + 'could check.');
        return;
      }
      // navigator.clipboard is the only way out of this page that does not need a network request
      // or a blob URL, and the policy this page ships allows neither. A browser that refuses it
      // says so beside the button rather than failing quietly.
      try {
        await navigator.clipboard.writeText(json);
        view.sayAboutPacket('Copied. Save it as a .json file and run the command below.');
      } catch (ignored) {
        view.sayAboutPacket('This browser would not let the page write to the clipboard. Select '
          + 'the packet above and copy it by hand.');
      }
    });
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

    if (loadingReason) {
      view.showFieldError(loadingReason);
      return;
    }

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
   * The declarative form, submitted. One handler, two callers, one store.
   *
   * A PERSON AND AN AGENT ARRIVE HERE THE SAME WAY. The person presses the button. An agent calls
   * the tool the four attributes on the form declare, and the browser fills the controls and
   * submits them, which is what toolautosubmit asks it to do. The only thing this function reads
   * off the event to tell them apart is `agentInvoked`, which the WebMCP declarative API sets on
   * the SubmitEvent, and everything downstream of that is the same dispatch every other control
   * on this page makes.
   *
   * NOTHING IS FORKED. The changes go through store.dispatch, so src/core/claim.js decides them:
   * the same coercion, the same length caps, the same refusal for a pinned field or a filed claim,
   * the same stale check against the revision an agent quoted, and the same provenance recorded
   * against the actor. There is no second rule anywhere on this path.
   *
   * A REFUSAL REACHES THE AGENT. It is put in respondWith, in the words src/core used, so a model
   * is told what was wrong and, for a stale quote, which number to send next. It also lands in the
   * on page ledger with its code, next to the submission that caused it, so a viewer watching the
   * page sees the refusal at the same moment the agent does.
   *
   * FEATURE DETECTED THROUGHOUT. preventDefault and respondWith are both called only after they are
   * found to be functions, and a browser with no declarative API never sets agentInvoked, so this
   * is an ordinary submit handler there and the form is an ordinary form.
   */
  function submitDeclaredForm(event) {
    // Always, on both paths. This page commits through the store and never navigates, and on the
    // agent path the documentation requires preventDefault before respondWith.
    if (event && typeof event.preventDefault === 'function') event.preventDefault();

    const agentInvoked = Boolean(event && event.agentInvoked === true);

    // Same hazard as filing and resetting: a commit still waiting on the typing timer would land
    // after this one and write an older account over the draft this submission just moved.
    cancelPendingCommit();

    // READ ONCE, AT THE TOP, AND USED EVERYWHERE BELOW. The three controls are read here and
    // nowhere else in this handler. They used to be read twice: once to plan the submission and
    // again, further down, to build the ledger row. In between, an accepted submission emptied
    // them, so every agent submission the rules ACCEPTED was recorded on the ledger as an empty
    // witness, an empty police reference and an empty revision, beside a draft that had just
    // taken all three. The only path that recorded them correctly was the refusal path, because a
    // refusal does not clear. Capturing them once removes the window rather than reordering it.
    const submitted = {
      witness_name: view.els.declaredWitness.value,
      police_report_ref: view.els.declaredPolice.value,
      base_revision: view.els.declaredRevision.value
    };

    const plan = planSubmission({
      witnessName: submitted.witness_name,
      policeReportRef: submitted.police_report_ref,
      baseRevision: submitted.base_revision,
      agentInvoked
    });

    const at = clockNow();
    const buffer = [];
    let outcome;

    if (plan.empty) {
      // Nothing is dispatched, so no rule in src/core refused anything and no refusal reaches the
      // buffer on its own. The page puts one there itself, with this module's own code, so the
      // ledger row, the live region and the sentence the model is handed all report the refusal
      // that this is. Without it the row carried no code and the announcement read as a success.
      outcome = { empty: true, ok: false, code: FORM_REFUSED_EMPTY, revision: claimNow().revision };
      buffer.push({ code: FORM_REFUSED_EMPTY, error: EMPTY_SUBMISSION_REASON });
    } else if (!agentInvoked && patchIsNoChange(claimNow(), plan.changes)) {
      // The human path only, exactly as commitControl does it. An agent submission is always
      // dispatched, because the stale check is a rule about the agent rather than about the value
      // and short circuiting here would let a quote of an older revision through unexamined.
      outcome = { unchanged: true, ok: true, revision: claimNow().revision };
    } else {
      // Whatever the rules refuse while this submission is on the stack belongs to it, and the
      // ledger shows it beside the call. Same buffer the instrumented tool calls use.
      const outer = refusalBuffer;
      if (agentInvoked) {
        refusalBuffer = buffer;
        agentDepth += 1;
      }
      try {
        outcome = store.dispatch({
          type: 'patch',
          changes: plan.changes,
          actor: plan.actor,
          baseRevision: plan.baseRevision
        });
      } finally {
        if (agentInvoked) {
          agentDepth -= 1;
          refusalBuffer = outer;
        }
      }
    }

    const message = describeOutcome({ ...outcome, agentInvoked });
    const accepted = outcome.ok === true && outcome.unchanged !== true;

    view.renderDeclaredResult(message);

    if (agentInvoked) {
      addLedgerEntry({
        at,
        name: FORM_TOOL_NAME,
        args: safeArgs(submitted),
        text: message,
        error: false,
        refusals: buffer
      });

      view.announce(buffer.length
        ? `Your agent submitted the supporting details form. The page refused it: ${buffer[0].code}.`
        : `Your agent submitted the supporting details form. The draft is at revision ${claimNow().revision}.`);

      // The result the model is handed, held inside the same output budget every tool answer is
      // held inside. A browser that offers agentInvoked without respondWith still gets the page
      // updated above, and must not be broken by calling something that is not there.
      if (event && typeof event.respondWith === 'function') {
        try {
          event.respondWith(Promise.resolve(clip(message, MAX_TOOL_OUTPUT_CHARS)));
        } catch (ignored) { /* a browser that refuses the response must not break the page */ }
      }
    }

    // LAST IN THE HANDLER, AND ONLY WHERE THE RULES ACCEPTED THE SUBMISSION. Nothing below this
    // line reads a control, which is the structural half of the fix: the boxes cannot be emptied
    // before something that describes what was in them. A refusal keeps them, because what the
    // sender would correct and send again is exactly what is still sitting there.
    if (accepted) view.clearDeclaredInputs();
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

    // Same window as commitControl. A pin taken before the rules are in is a pin against a draft
    // the page is about to redraw, so it is refused with the reason rather than half applied.
    if (loadingReason) {
      view.showFieldError(loadingReason);
      return;
    }

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
    // Asked for, against loaded. A pack that fails to fetch leaves nothing loaded, and comparing
    // the request against the loaded id then read as "you are already on that one" and returned
    // early, which stranded the page in no pack mode with no way back: pick northwind, pick a
    // kestrel that 404s, pick northwind again, nothing happens. The retry of a pack that is not
    // loaded is always allowed, which is also what makes a failed fetch recoverable by picking the
    // same entry again.
    if (!id) return;
    if (id === requestedPackId && context.pack) return;
    requestedPackId = id;
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

    // The pack and the completed human actions travel with the action, because the gate that
    // decides this lives in src/core/filing.js and reads both. The button is drawn from the same
    // decision, so reaching here with a refusal means the draft moved between the paint and the
    // press, and the refusal is what says so rather than the click being trusted.
    const result = store.dispatch({
      type: 'file',
      at: clockNow(),
      pack: context.pack,
      completedHumanActions: ui.humanActions,
      homePackId: context.homePackId
    });
    if (!result.ok) {
      view.showFieldError(result.error || 'The claim could not be filed.');
      return;
    }
    view.showFieldError('');
    view.announce('The claim was filed through the page. The draft is closed to every writer, this '
      + 'page and any agent alike.');
    showTheHandlerPacket();
  }

  /**
   * THE PACKET IS BUILT HERE AND NOWHERE ELSE, WHICH IS WHAT KEEPS IT OFF THE TOOL SURFACE.
   *
   * It describes a filing, so it can only exist after one, and the only thing that files is the
   * control pressed a line above this. src/webmcp never imports src/core/packet.js, so no
   * registered tool builds it or returns it, the same way none of them files. Grep is the check,
   * and tests/unit/packet_is_not_a_tool.test.js is the gate.
   *
   * The digest is computed after the panel is drawn, because hashing is asynchronous and a panel
   * that waits for it would appear late for no reason a reader could see.
   */
  function showTheHandlerPacket() {
    // No coverage is passed. The packet works it out from the filed claim and the pack, because a
    // caller handing it an answer is how the packet came to contradict the panel above it.
    const built = buildFilingPacket({
      claim: claimNow(),
      pack: context.pack,
      homePackId: context.homePackId,
      completedHumanActions: ui.humanActions,
      ledger,
    });

    if (!built.ok) {
      // A filed claim that cannot be described is a defect somewhere else, and the honest thing is
      // to say so rather than to draw an empty panel or a packet that is not true.
      view.renderPacket({ available: false });
      view.showFieldError(built.reason);
      return;
    }

    packet = { content: built.packet, canonical: built.canonical, digest: null, open: false };
    // NOTHING LEAVES THIS PAGE WITHOUT ITS DIGEST. Hashing is asynchronous, and the copy control was
    // live for the few milliseconds before it resolved, so a fast hand could take away a packet with
    // content_digest: null in it. A packet nobody can check is the one thing this feature must not
    // produce, so the control is closed until the digest is on it.
    view.setPacketCopyable(false, 'working out the digest');
    view.renderPacket({
      available: true,
      notice: built.packet.notice,
      reference: built.packet.reference,
      digest: null,
      view: packetAsMarkdown(built.packet, null),
    });
    view.togglePacketView(false);

    digestOf(built.canonical).then((digest) => {
      if (!packet || packet.canonical !== built.canonical) return;
      packet.digest = digest;
      view.setPacketCopyable(true, '');
      view.renderPacket({
        available: true,
        notice: built.packet.notice,
        reference: built.packet.reference,
        digest,
        view: packetAsMarkdown(built.packet, digest),
      });
      view.togglePacketView(packet.open);
    }).catch(() => {
      // No digest, no export. The packet stays on screen to be read, because that is still true,
      // and the reason sits beside the control that is closed.
      view.setPacketCopyable(false, 'this browser would not compute the digest, so the packet '
        + 'cannot be copied from here. It is still readable above.');
      view.renderPacket({
        available: true,
        notice: built.packet.notice,
        reference: built.packet.reference,
        digest: 'this browser has no Web Crypto, so the digest could not be computed here',
        view: packetAsMarkdown(built.packet, null),
      });
      view.togglePacketView(packet.open);
    });
  }

  /** The JSON a person copies, digest included, in the shape verify_packet.mjs reads. */
  function packetAsJson() {
    if (!packet) return null;
    return canonicalise({
      content: packet.content,
      content_digest: packet.digest,
      generated_at: clockNow(),
    });
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
  /**
   * The requirement id the roadside control answers. Both shipped packs use it, and a pack that
   * names the collection something else leaves the button closing nothing rather than closing
   * whatever human action happened to be open.
   */
  const ROADSIDE_REQUIREMENT_ID = 'roadside_collection';

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
    // What the person just did, named by the requirement it answers, so src/core and every tool
    // read one answer rather than four surfaces guessing from a note on the page.
    //
    // ONE REQUIREMENT, NOT EVERY HUMAN ONLY ONE. This used to close every requirement no field
    // answers, which is right for the two packs that ship here and wrong for the contract: a pack
    // may name several unrelated human actions, and a button that says "Request roadside
    // assistance" would then have reported a police station visit as done as well. Where a pack
    // raises a human action this page has no control for, the requirement stays open and says so,
    // which is the honest outcome rather than a silent completion.
    const closed = getRequirements()
      .filter((entry) => entry.humanOnly && entry.id === ROADSIDE_REQUIREMENT_ID)
      .map((entry) => entry.id);
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

    view.announce('Roadside assistance was requested through the page. No tool on this page reaches '
      + `that button. The revision has moved on to ${claimNow().revision}, so a patch quoting an `
      + 'earlier one is refused.');
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
    // The packet describes a filing. A reset withdraws the draft it described, so it goes with it.
    packet = null;
    view.renderPacket({ available: false });
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
    // The declarative form is a control on this draft like any other, so the boxes and the sentence
    // under them go back with it. Leaving the last result there would have it describing a draft
    // that no longer exists.
    view.clearDeclaredInputs();
    view.renderDeclaredResult('');
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
