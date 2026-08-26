/**
 * ClaimReady, the wiring.
 *
 * One store, two writers. The person on the page and the visitor's agent both go through the same
 * dispatch, so a tool call is visible on the page the moment it lands, field by field, and both
 * sides read the same revision number. That mirroring is the whole demonstration.
 *
 * What an agent cannot do is filing. Filing, roadside assistance and pinning a field are buttons,
 * never tools, so an agent that has been talked into something by a poisoned web page can draft and
 * check all it likes and can commit nothing.
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
import { validateClaim, PATCHABLE_FIELDS } from '../core/claim.js';
import { checkCoverage } from '../core/coverage.js';
import { estimateRepair } from '../core/estimate.js';
import { loadPolicyPack, describePack } from '../core/policy.js';
import { deriveRequirements, summariseRequirements } from '../core/requirements.js';

import { createView } from './render.js';
import { startToolSurface, textOfResult, registeredToolNames } from '../webmcp/register.js';

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

  /* Page state that is not claim state. The store contract has no action for any of it. */
  const ui = { coverage: null, estimate: null, assistanceAt: null };
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

  /* Requirement redraw bookkeeping. The panel is rebuilt only when the derived list actually moves,
     so a keystroke in the description does not replay the "just appeared" highlight, and nothing is
     marked new on the first draw or after a reset. */
  let requirementIds = new Set();
  let requirementSignature = null;
  let requirementsPrimed = false;

  const context = {
    store,
    pack: null,
    policy: embeddedPolicy,
    policyId: persona.policyId,
    currency: persona.currency,
    vehicleClass: persona.vehicleClass,
    hasPolicySchedule: hasSchedule(embeddedPolicy),
    noScheduleReason,
    getRequirements,
    publish
  };

  view.renderPersona(persona);
  view.renderStatus({ available: false, api: null, registered: [], failed: [], fixtureSource, fixtureError });
  view.renderRevision(claimNow().revision);
  view.renderCoverage(null);
  view.renderEstimate(null);
  view.renderLedger(ledger);
  drawClaim([]);

  await loadPacks();
  applyPack(activePackId);
  view.renderPackChoices(packChoices(), activePackId);
  drawRequirements();

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
    drawClaim(changed);
    drawRequirements();
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
      context.policy = entry.pack;
      context.currency = entry.pack.currency;
      context.hasPolicySchedule = hasSchedule(entry.pack);
      view.renderPackNote(describePack(entry.pack));
      return;
    }

    context.pack = null;
    context.policy = embeddedPolicy;
    context.currency = persona.currency;
    context.hasPolicySchedule = hasSchedule(embeddedPolicy);
    view.renderPackNote(entry && entry.error
      ? `The ${entry.id} rule pack did not load: ${entry.error}. The cover check falls back to the schedule stored with this policy.`
      : NO_PACK_REASON);
  }

  /**
   * The requirements this insurer's intake raises right now, with the one page fact src/core cannot
   * know: whether the person has already pressed the button that no tool can press.
   */
  function getRequirements() {
    const pack = context.pack;
    if (!pack) return [];
    return deriveRequirements(pack, claimNow()).map((entry) => {
      const rule = pack.requirements.find((item) => item.id === entry.id);
      const humanOnly = Boolean(rule && rule.satisfied_by && rule.satisfied_by.human_action);
      const shown = { ...entry, humanOnly, humanNote: null };
      if (humanOnly && ui.assistanceAt) {
        shown.humanNote = `You pressed Request roadside assistance at ${ui.assistanceAt}. `
          + 'There is no tool for that button, so an agent could not have done it for you.';
      }
      return shown;
    });
  }

  /* Drawing */

  function drawClaim(changed) {
    const claim = claimNow();
    const verdict = validateClaim(claim);
    view.renderClaim(claim, changed);
    view.renderActions({
      ready: Boolean(verdict.ready),
      missing: verdict.missing || [],
      filed: claim.status === 'filed',
      filedAt: claim.filed_at,
      assistanceAt: ui.assistanceAt
    });
  }

  function drawRequirements() {
    if (!context.pack) {
      requirementIds = new Set();
      requirementSignature = null;
      requirementsPrimed = false;
      view.renderRequirements({ entries: [], summary: '', newIds: [], blocked: NO_PACK_REASON });
      return;
    }

    const entries = getRequirements();
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

  function publish(kind, payload) {
    const at = clockNow();
    if (kind === 'coverage') {
      ui.coverage = { ...payload, at, insurer: context.pack ? context.pack.insurer : null };
      view.renderCoverage(ui.coverage);
    } else if (kind === 'estimate') {
      ui.estimate = { ...payload, at };
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

  function refreshStatus() {
    view.renderStatus({
      ...toolStatus,
      registered: toolStatus.available ? registeredToolNames() : [],
      fixtureSource,
      fixtureError
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

    let descriptionTimer = null;
    view.els.fields.addEventListener('input', (event) => {
      const control = event.target;
      if (!control || control.tagName !== 'TEXTAREA') return;
      clearTimeout(descriptionTimer);
      descriptionTimer = setTimeout(() => commitControl(control), DESCRIPTION_DEBOUNCE_MS);
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
    view.showFieldError('');

    // An empty control means clear. The rules allow that for an optional field and refuse it for a
    // required one, and they say so themselves.
    const raw = control.value === '' ? null : control.value;

    const result = store.dispatch({ type: 'patch', field, value: raw });
    if (!result.ok) {
      view.showFieldError(result.error || 'That value was not accepted.');
      drawClaim([]);
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
    const pinned = button.getAttribute('aria-pressed') === 'true';
    const result = store.dispatch({ type: pinned ? 'unlock' : 'lock', field });
    if (!result.ok) {
      view.showFieldError(result.error || 'That field could not be pinned.');
      return;
    }
    view.showFieldError('');
    view.announce(pinned
      ? `You unpinned ${field}. An agent can change it again.`
      : `You pinned ${field}. No agent patch can move it now.`);
  }

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
    drawRequirements();
    view.announce(context.pack
      ? `Rules switched to ${context.pack.insurer}. The same tools now answer with that schedule.`
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
    const result = store.dispatch({ type: 'file', at: clockNow() });
    if (!result.ok) {
      view.showFieldError(result.error || 'The claim could not be filed.');
      return;
    }
    view.showFieldError('');
    view.announce('You filed the claim. The draft is closed to every writer, yours and your agent\'s.');
  }

  function requestAssistance() {
    if (ui.assistanceAt) return;
    ui.assistanceAt = clockNow();
    drawClaim([]);
    drawRequirements();
    view.announce('You requested roadside assistance. There is no tool for that button.');
    // Pressing this changes nothing about the tool surface. The tool that reads out the assistance
    // options exists while the claim says the vehicle cannot be driven, which is a fact about the
    // claim, and register.js is what watches it.
  }

  function startOver() {
    // Page state first, then the draft. The subscriber redraws the moment the reset lands, and it
    // should not redraw against a roadside request that this reset has already cancelled.
    ui.coverage = null;
    ui.estimate = null;
    ui.assistanceAt = null;
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
    drawClaim([]);
    drawRequirements();
    view.announce('The synthetic incident was loaded again. The draft is back at revision '
      + `${claimNow().revision}.`);
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
