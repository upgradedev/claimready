/**
 * ClaimReady, the wiring.
 *
 * One store, two writers. The person on the page and the visitor's agent both go through the same
 * dispatch, so a tool call is visible on the page the moment it lands, field by field. That
 * mirroring is the whole demonstration.
 *
 * What an agent cannot do is filing. Filing and roadside assistance are buttons, never tools, so an
 * agent that has been talked into something by a poisoned web page can draft and check all it likes
 * and can commit nothing.
 *
 * Provenance (who set each field) lives here rather than in the store, because the store's action
 * shape carries no source. A tool call raises a depth counter while it runs, so anything that
 * changes during it is attributed to the agent, and anything else to the person.
 *
 * All the rules live in src/core. This file never validates a value or coerces a type: it hands
 * what it was given to dispatch and reports what came back.
 */

import { createStore } from '../core/store.js';
import { validateClaim, PATCHABLE_FIELDS } from '../core/claim.js';
import { checkCoverage } from '../core/coverage.js';
import { estimateRepair } from '../core/estimate.js';

import { createView } from './render.js';
import { registerTools, textOfResult, onToolChange, registeredToolNames } from '../webmcp/register.js';

import describeClaimTool from '../webmcp/tools/describe_claim.js';
import readClaimStateTool from '../webmcp/tools/read_claim_state.js';
import applyClaimPatchTool from '../webmcp/tools/apply_claim_patch.js';
import validateClaimTool from '../webmcp/tools/validate_claim.js';
import checkCoverageTool from '../webmcp/tools/check_coverage.js';
import getRepairEstimateTool from '../webmcp/tools/get_repair_estimate.js';

const FIXTURE_URL = './fixtures/demo-collision.json';
const LEDGER_LIMIT = 40;
const DESCRIPTION_DEBOUNCE_MS = 500;

/**
 * Used only when the sample file cannot be fetched or is refused, so the page never renders empty.
 * Same shape as the fixture on disk, so the degraded path hands src/core exactly what the normal
 * path does.
 */
const FALLBACK_FIXTURE = {
  policy: {
    id: 'MTR-2026-0417',
    currency: 'EUR',
    holder: { name: 'Maria K.' },
    vehicle: { make: 'Sample', model: 'Hatchback', plate: 'SYN-0000', class: 'compact' }
  },
  claim: {}
};

const TOOL_FACTORIES = [
  describeClaimTool,
  readClaimStateTool,
  applyClaimPatchTool,
  validateClaimTool,
  checkCoverageTool,
  getRepairEstimateTool
];

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

  const policy = fixture.policy || {};
  const holder = policy.holder && typeof policy.holder === 'object' ? policy.holder.name : policy.holder;

  // Without a schedule of coverages there is nothing to check a claim against, and the honest
  // answer is "cannot be checked", never "not covered". A policy with no sections would otherwise
  // read as a refusal, which would be a false statement about someone's cover.
  const hasPolicySchedule = Array.isArray(policy.coverages) && policy.coverages.length > 0;
  const noScheduleReason = 'The sample policy schedule did not load, so cover cannot be checked '
    + 'against it. This is a loading problem, not a decision about your cover.';

  const persona = {
    policyId: String(policy.id || policy.policy_id || 'unknown'),
    holder: String(holder || 'the policyholder'),
    currency: String(policy.currency || 'EUR'),
    vehicleClass: String((policy.vehicle && policy.vehicle.class) || 'compact'),
    note: 'Demonstration session. The claimant, the vehicle and the policy are invented for this demo.'
  };

  /* Page state that is not claim state. The store contract has no action for any of it. */
  const ui = { coverage: null, estimate: null, assistanceAt: null };
  const ledger = [];
  const provenance = new Map();

  let agentDepth = 0;
  let snapshot = snapshotOf(claimNow());

  seedProvenance();

  view.renderPersona(persona);
  view.renderStatus({ available: false, api: null, registered: [], failed: [], fixtureSource, fixtureError });
  view.renderCoverage(null);
  view.renderEstimate(null);
  view.renderLedger(ledger);
  drawClaim([]);

  store.subscribe(() => {
    const next = claimNow();
    const changed = [];

    for (const field of PATCHABLE_FIELDS) {
      if (Object.is(snapshot[field], next[field])) continue;
      changed.push(field);
      if (isEmpty(next[field])) provenance.delete(field);
      else provenance.set(field, agentDepth > 0 ? 'agent' : 'you');
    }

    snapshot = snapshotOf(next);
    drawClaim(changed);
  });

  const context = {
    store,
    policy,
    policyId: persona.policyId,
    currency: persona.currency,
    vehicleClass: persona.vehicleClass,
    hasPolicySchedule,
    noScheduleReason,
    getProvenance: () => provenance,
    publish
  };

  wireControls();

  const status = await registerTools(context, TOOL_FACTORIES.map(instrument));
  view.renderStatus({ ...status, fixtureSource, fixtureError });

  // The browser tells us when the tool set changes. The count on screen should never be a stale
  // claim about what an agent can actually call.
  onToolChange(() => {
    view.renderStatus({ ...status, registered: registeredToolNames(), fixtureSource, fixtureError });
  });

  /* Reading the store */

  function claimNow() {
    return store.getState().claim;
  }

  function seedProvenance() {
    // A field that arrives already filled was started by the claimant, not by an agent.
    const claim = claimNow();
    for (const field of PATCHABLE_FIELDS) {
      if (!isEmpty(claim[field])) provenance.set(field, 'you');
    }
  }

  /* Drawing */

  function drawClaim(changed) {
    const claim = claimNow();
    const verdict = validateClaim(claim);
    view.renderClaim(claim, provenance, changed);
    view.renderActions({
      ready: Boolean(verdict.ready),
      missing: verdict.missing || [],
      filed: claim.status === 'filed',
      filedAt: claim.filed_at,
      assistanceAt: ui.assistanceAt
    });
  }

  function publish(kind, payload) {
    const at = clockNow();
    if (kind === 'coverage') {
      ui.coverage = { ...payload, at };
      view.renderCoverage(ui.coverage);
    } else if (kind === 'estimate') {
      ui.estimate = { ...payload, at };
      view.renderEstimate(ui.estimate);
    }
  }

  /* Tool instrumentation: every call is ledgered, and anything it changes is attributed to the
     agent. The tools themselves stay unaware of the ledger. */

  function instrument(factory) {
    return (ctx) => {
      const descriptor = factory(ctx);
      const inner = descriptor.execute;

      return {
        ...descriptor,
        execute: async (input, options) => {
          const at = clockNow();
          agentDepth += 1;
          let result;
          let failure = null;
          try {
            result = await inner.call(descriptor, input, options);
          } catch (error) {
            failure = error;
          } finally {
            agentDepth -= 1;
          }

          addLedgerEntry({
            at,
            name: descriptor.name,
            args: safeArgs(input),
            text: failure ? `error: ${failure && failure.message ? failure.message : String(failure)}` : textOfResult(result),
            error: Boolean(failure)
          });

          if (failure) throw failure;
          return result;
        }
      };
    };
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
    view.els.fields.addEventListener('change', onChange);
    view.els.fieldsOptional.addEventListener('change', onChange);

    let descriptionTimer = null;
    view.els.fields.addEventListener('input', (event) => {
      const control = event.target;
      if (!control || control.tagName !== 'TEXTAREA') return;
      clearTimeout(descriptionTimer);
      descriptionTimer = setTimeout(() => commitControl(control), DESCRIPTION_DEBOUNCE_MS);
    });

    view.els.checkCoverageBtn.addEventListener('click', runCoverageByHand);
    view.els.checkEstimateBtn.addEventListener('click', runEstimateByHand);
    view.els.fileBtn.addEventListener('click', fileClaim);
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

  function runCoverageByHand() {
    const claim = claimNow();
    if (!hasPolicySchedule) {
      view.renderCoverage({ blocked: noScheduleReason });
      return;
    }
    if (!claim.incident_type) {
      view.renderCoverage({ blocked: 'Pick what kind of incident it was first, then the cover can be checked.' });
      return;
    }
    publish('coverage', { decision: checkCoverage(policy, claim), source: 'you' });
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

  function fileClaim() {
    const result = store.dispatch({ type: 'file', at: clockNow() });
    if (!result.ok) {
      view.showFieldError(result.error || 'The claim could not be filed.');
      return;
    }
    view.showFieldError('');
  }

  function requestAssistance() {
    if (ui.assistanceAt) return;
    ui.assistanceAt = clockNow();
    drawClaim([]);
    // A tool that only exists after this click is registered by calling registerTools again with
    // that one factory. register.js keeps a controller per tool and skips names already held, so a
    // second call adds without disturbing the six already registered.
  }

  function startOver() {
    store.dispatch({ type: 'reset' });
    provenance.clear();
    seedProvenance();
    ui.coverage = null;
    ui.estimate = null;
    ui.assistanceAt = null;
    ledger.length = 0;
    view.renderCoverage(null);
    view.renderEstimate(null);
    view.renderLedger(ledger);
    view.showFieldError('');
    drawClaim([]);
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

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}
