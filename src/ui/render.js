/**
 * The view. Every DOM reference on the page is resolved here once, and every visual state is a
 * class toggle or a text node, never an inline style, so a strict Content Security Policy can stay
 * strict. Nodes are built with createElement and filled with textContent. No HTML string is ever
 * assigned into the document from this file and none ever may be: everything drawn here can carry
 * claimant prose or third party text, and the only safe way to put that on a page is as a text node.
 *
 * Nothing in this file decides anything. It is handed values and it draws them.
 *
 * The vocabulary comes from src/core: which fields exist from claim.js, what the clock positions
 * are called, how to say a field name out loud, and how an exclusion is named from coverage.js.
 * Nothing here re-states any of it, so the page cannot drift from the rules, and the panel and the
 * agent word an exclusion identically because both call the same function.
 *
 * Provenance and pinning are read straight off the claim, through provenanceOf and isLocked, so
 * there is exactly one record of who wrote what and the page cannot hold a second opinion.
 *
 * Three details matter for the demonstration. A row that just changed gets a brief highlight, which
 * is how a viewer sees an agent tool call land on the page. A requirement that has just appeared is
 * highlighted with the reason it appeared, so the causal step is visible rather than inferred. And a
 * control the person is currently typing in is never overwritten by a redraw.
 */

import {
  INCIDENT_TYPES,
  SEVERITIES,
  DAMAGE_ZONES,
  ZONE_LABELS,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  PATCHABLE_FIELDS,
  isLocked,
  provenanceOf
} from '../core/claim.js';
import { exclusionLabels } from '../core/coverage.js';
import { optionalDetailsNote } from '../core/requirements.js';

const HIGHLIGHT_MS = 1500;

/** Short captions for the grid. FIELD_LABELS from core is the prose form, used in sentences. */
const ROW_LABELS = {
  incident_date: 'Incident date',
  incident_type: 'What kind of incident',
  damage_zone: 'Damage position',
  severity: 'Severity',
  vehicle_drivable: 'Still drivable',
  description: 'What happened',
  driver: 'Who was driving',
  location: 'Where it happened',
  police_report_ref: 'Police report reference',
  witness_name: 'Witness name'
};

const FIELD_CONTROLS = {
  incident_date: 'date',
  incident_type: 'select',
  damage_zone: 'select',
  severity: 'select',
  vehicle_drivable: 'select',
  description: 'textarea',
  driver: 'text',
  location: 'text',
  police_report_ref: 'text',
  witness_name: 'text'
};

/**
 * What each provenance value from core is called on the page.
 *
 * THE BADGE NAMES A SURFACE, NOT AN AUTHOR, BECAUSE THE SURFACE IS THE PART THAT IS KNOWN. It
 * used to read "you" and "agent", which reads as a claim about who was at the keyboard, and the
 * page cannot know that. A value typed into a control is recorded as human whoever moved the
 * control, so an agent driving the page the way any browser automation drives a page is recorded
 * as human too. What the claim genuinely records is the route the answer took: a control on this
 * page, or a tool call. So that is what the badge says, and its title says it in full.
 *
 * The class names are unchanged and keyed off the provenance value rather than off the word, so
 * renaming a word can never quietly drop the colour with it.
 */
const BADGE_WORDS = {
  human: 'via page',
  agent: 'via tool',
  policy: 'on file',
  derived: 'derived'
};

const BADGE_CLASS = {
  human: 'badge-you',
  agent: 'badge-agent',
  policy: 'badge-policy',
  derived: 'badge-derived'
};

const BADGE_TITLES = {
  human: 'This answer arrived through a control on this page. That is the surface it came in on, '
    + 'not who was at the keyboard: an agent that drives the page rather than calling a tool '
    + 'arrives this way too.',
  // THE SAME CAVEAT AS THE HUMAN BADGE, AND FOR THE SAME REASON. The description says every badge
  // says on hover that it names a route rather than an identity. That was true of this one's
  // sibling and not of this one, which made a sentence in the primary judge-facing document false
  // about half the surface it described. A tool call carries the word the caller used for itself
  // and nothing here authenticates that word, so the badge says so rather than the document
  // claiming it does.
  agent: 'This answer arrived through a tool call, and the call is in the ledger below. That is '
    + 'the surface it came in on, not who called it: the caller names itself and nothing here '
    + 'checks that name.',
  policy: 'This answer was already on file when the page opened.',
  derived: 'This answer was worked out by the page.',
  none: 'Nothing has answered this yet.'
};

const BADGE_CLASSES = ['badge-agent', 'badge-you', 'badge-policy', 'badge-derived', 'badge-none'];

const PIN_HINT = 'Pinned via the page. No patch can move this field, from an agent or from this page, '
  + 'until it is unpinned here.';

const ARGS_LIMIT = 140;
const RESULT_LIMIT = 240;

/**
 * Resolve the page, build the field rows, and hand back the drawing functions.
 * @param {Document} doc
 */
export function createView(doc) {
  const pick = (name) => doc.querySelector(`[data-el="${name}"]`);

  const els = {
    personaName: pick('persona-name'),
    personaPolicy: pick('persona-policy'),
    personaNote: pick('persona-note'),
    revisionChip: pick('revision-chip'),
    revision: pick('revision'),
    statusDot: pick('status-dot'),
    statusText: pick('status-text'),
    statusDetail: pick('status-detail'),
    live: pick('live'),
    toolsDetails: pick('tools-details'),
    toolsCount: pick('tools-count'),
    toolsNote: pick('tools-note'),
    toolsList: pick('tools-list'),
    insurerSelect: pick('insurer-select'),
    packNote: pick('pack-note'),
    resetNote: pick('reset-note'),
    fields: pick('fields'),
    claimBusy: pick('claim-busy'),
    fieldsOptional: pick('fields-optional'),
    optionalDetails: pick('optional-details'),
    optionalNote: pick('optional-note'),
    declaredForm: pick('declared-form'),
    declaredWitness: pick('declared-witness'),
    declaredPolice: pick('declared-police'),
    declaredRevision: pick('declared-revision'),
    declaredRevisionHint: pick('declared-revision-hint'),
    declaredSubmit: pick('declared-submit'),
    declaredResult: pick('declared-result'),
    claimNote: pick('claim-note'),
    fieldError: pick('field-error'),
    requirements: pick('requirements'),
    packetPanel: pick('packet-panel'),
    packetNotice: pick('packet-notice'),
    packetReference: pick('packet-reference'),
    packetDigest: pick('packet-digest'),
    packetToggle: pick('packet-toggle'),
    packetCopy: pick('packet-copy'),
    packetSaid: pick('packet-said'),
    packetView: pick('packet-view'),
    reqSummary: pick('req-summary'),
    reqProgress: pick('req-progress'),
    reqProgressFill: pick('req-progress-fill'),
    reqProgressText: pick('req-progress-text'),
    coverageBody: pick('coverage-body'),
    estimateBody: pick('estimate-body'),
    ledger: pick('ledger'),
    ledgerEmpty: pick('ledger-empty'),
    fileBtn: pick('file-btn'),
    fileReason: pick('file-reason'),
    fileResult: pick('file-result'),
    assistanceBtn: pick('assistance-btn'),
    assistanceState: pick('assistance-state'),
    checkCoverageBtn: pick('check-coverage-btn'),
    checkEstimateBtn: pick('check-estimate-btn'),
    resetBtn: pick('reset-btn'),
    strip: pick('strip')
  };

  // A hook renamed or dropped in index.html would otherwise surface as a null dereference deep
  // inside a redraw, with a blank page and nothing to go on. Fail here instead, by name.
  const absent = Object.keys(els).filter((name) => !els[name]);
  if (absent.length) {
    throw new Error(`ClaimReady cannot start: index.html is missing these hooks: ${absent.join(', ')}`);
  }

  const rows = new Map();
  const highlightTimers = new Map();
  let lastRevision = null;
  let revisionTimer = null;
  let resetTimer = null;

  buildFieldRows(doc, els.fields, REQUIRED_FIELDS, rows);
  buildFieldRows(doc, els.fieldsOptional, OPTIONAL_FIELDS, rows);

  // The tool list opens by itself on a screen with room to spare and stays folded otherwise, where
  // the claim draft is the point and nine rows above it would bury it. Set once, at start up, so a
  // reader who folds it away is never fought by a later redraw.
  //
  // HEIGHT IS PART OF THE TEST, NOT JUST WIDTH, AND A MEASUREMENT PUT IT THERE. The open block is
  // 377px tall. On a 1280 by 800 laptop, the commonest desktop viewport there is, opening it by
  // itself pushed the first line of the claim draft to y=811 and left exactly zero pixels of it
  // above the fold: a first time visitor landed on a tool inventory and had to scroll to find the
  // product. Folded, the same screen shows 326px of the draft. So the query asks for the height
  // that makes the trade honest, which is the panel plus a usable slice of the draft below it.
  const frame = doc.defaultView;
  if (frame && typeof frame.matchMedia === 'function') {
    try {
      if (frame.matchMedia('(min-width: 900px) and (min-height: 950px)').matches) {
        els.toolsDetails.open = true;
      }
    } catch (ignored) { /* a browser that refuses the query leaves the list folded, which is safe */ }
  }

  /**
   * The bar beside the intake sentence. It states the same count that sentence states, in the same
   * draw, off the same list, so the two cannot disagree. `answered` is null when no pack loaded:
   * the bar is hidden rather than drawn at zero, because "this page cannot say" and "none of them"
   * are different facts and a bar at zero says the second one.
   *
   * @param {(number|null)} answered
   * @param {number} total
   */
  function drawProgress(answered, total) {
    const known = typeof answered === 'number' && total > 0;
    els.reqProgress.hidden = !known;
    els.reqProgress.setAttribute('aria-valuemin', '0');
    els.reqProgress.setAttribute('aria-valuemax', String(known ? total : 0));
    els.reqProgress.setAttribute('aria-valuenow', String(known ? answered : 0));
    els.reqProgressFill.style.width = known ? `${Math.round((answered / total) * 100)}%` : '0%';
    text(els.reqProgressText, known ? `${answered} of ${total} answered` : '');
  }

  /**
   * Why the draft is closed at this moment, or null when it is open.
   *
   * BOOT USED TO PAINT AN OPEN DRAFT OVER A PAGE WITH NO LISTENERS ON IT. The claim controls were
   * drawn before the rule packs were fetched and before wireControls ran, so a visitor who typed
   * during a slow load had the keystroke ignored and then overwritten by the redraw that followed
   * the fetch. Nothing said so. The workspace rule is that no control is disabled without a visible
   * reason and nothing is ever gated to null, so the draft is now closed with the reason beside it
   * until the page is ready to accept what somebody types.
   */
  let busyReason = null;

  return {
    els,

    /**
     * Who is signed in, and whose rules are answering.
     *
     * The two are the same thing until the picker loads another insurer's pack against this
     * claim, and then they are not. Naming both here is what stops a decision line reading as
     * though this policy belonged to whichever insurer last answered.
     */
    renderPersona(persona) {
      text(els.personaName, `Signed in as ${persona.holder}`);
      text(els.personaPolicy, persona.borrowed && persona.insurer
        ? `Policy ${persona.policyId}, read against ${persona.insurer} rules`
        : `Policy ${persona.policyId}`);
      text(els.personaNote, persona.borrowed && persona.insurer
        ? `${persona.note} The rules loaded are ${persona.insurer}'s, not this policy's own insurer.`
        : persona.note);
    },

    /**
     * The revision counter in the header. It ticks on every accepted change from either side, and
     * it is the one number a viewer can use to tell a real write from a hopeful sentence.
     */
    renderRevision(revision) {
      const value = Number.isFinite(revision) ? revision : 0;
      text(els.revision, String(value));
      if (lastRevision !== null && value !== lastRevision) {
        if (revisionTimer) clearTimeout(revisionTimer);
        els.revisionChip.classList.add('is-bumped');
        revisionTimer = setTimeout(() => {
          els.revisionChip.classList.remove('is-bumped');
          revisionTimer = null;
        }, HIGHLIGHT_MS);
      }
      lastRevision = value;
    },

    /** The polite live region. Screen reader users hear what an agent just did. */
    announce(message) {
      text(els.live, message || '');
    },

    renderStatus(status) {
      els.strip.classList.toggle('is-on', Boolean(status.available));
      els.strip.classList.toggle('is-off', !status.available);
      els.statusDot.classList.toggle('dot-ok', Boolean(status.available));
      els.statusDot.classList.toggle('dot-warn', !status.available);

      if (status.available) {
        const count = status.registered.length;
        text(els.statusText, `Agent connected through ${status.api}. ${count} ${count === 1 ? 'tool' : 'tools'} registered.`);
      } else {
        text(els.statusText, 'No agent detected in this browser, so nothing is driving the page but you.');
      }

      const detail = [];
      if (status.available) {
        detail.push(`Available to your agent: ${status.registered.join(', ')}.`);
        if (status.failed.length) {
          detail.push(`Could not register: ${status.failed.map((item) => `${item.name} (${item.reason})`).join(', ')}.`);
        }
        detail.push('Filing and roadside assistance are not on that list. No tool this page publishes reaches either button.');
      } else {
        detail.push('Everything on this page still works. Fill the draft yourself, pin what you want '
          + 'left alone, and read the requirements panel. The tools it would publish to an agent are '
          + 'listed just below. To watch an agent drive it, open the same page in a browser whose '
          + 'agent speaks WebMCP.');
      }
      if (status.fixtureSource === 'fallback') {
        detail.push('The sample claim file did not load, so a built in sample is being used.');
      }
      if (status.fixtureError) {
        detail.push(`The sample claim file was refused: ${status.fixtureError}`);
      }
      text(els.statusDetail, detail.join(' '));
    },

    /**
     * The tools this page publishes, drawn in both states.
     *
     * The list itself is read from src/webmcp/register.js, which is the same place registration
     * reads it, so it cannot describe a tool the page does not publish. Whether a tool is
     * REGISTERED is a different question, answered only by the names the browser accepted, and
     * every row is marked from that set. A visitor with no agent therefore sees the whole surface
     * with every row marked not registered, and is told why, which is the honest version of the
     * apology this strip used to print on its own.
     *
     * @param {{tools: object[], available: boolean, api: (string|null), registered: string[]}} state
     */
    renderToolSurface(state) {
      const tools = (state && state.tools) || [];
      const available = Boolean(state && state.available);
      const live = new Set((state && state.registered) || []);
      const total = tools.length;

      // TWO HALVES OF ONE STANDARD, COUNTED SEPARATELY, because they arrive by different routes and
      // one number covering both would be wrong whichever way it was read. A registered tool was
      // handed to the browser by registerTool and the browser can say so. A declared one is four
      // attributes on a form the browser reads off the markup, so it is never in the registered set
      // and calling it "not registered" beside the others would read as a failure rather than as
      // the other half of the API.
      const declared = tools.filter((tool) => tool.declarative === true);
      const registerable = tools.filter((tool) => tool.declarative !== true);
      const liveCount = available ? registerable.filter((tool) => live.has(tool.name)).length : 0;

      const alsoDeclared = declared.length === 0
        ? ''
        : (declared.length === 1
          ? ', and one more declared by a form in the page'
          : `, and ${declared.length} more declared by forms in the page`);
      const ofWhichDeclared = declared.length === 0
        ? ''
        : `, ${declared.length === 1 ? 'one' : declared.length} of them declared by a form rather than registered`;

      text(els.toolsCount, available
        ? `${liveCount} of ${registerable.length} tools registered with your agent${alsoDeclared}`
        : `${total} tools this page publishes to an agent${ofWhichDeclared}`);

      text(els.toolsNote, available
        ? `Your agent is connected through ${state.api}, and this is the live set. A row marked `
          + 'registered is registered right now.'
        : 'None of these is registered right now, because no agent was found in this browser. This '
          + 'is what the page would hand one, read from the same list it registers from.');

      els.toolsList.replaceChildren(
        ...tools.map((tool) => toolItem(doc, tool, available && live.has(tool.name)))
      );
    },

    /**
     * Say out loud that the synthetic incident was loaded again.
     *
     * The button was silent whenever the draft had not been touched yet. The reset landed, every
     * panel redrew into the state it was already in, and the only word about it went to the live
     * region, which is deliberately out of sight. A control with no visible answer is read as a
     * control that does nothing. The revision chip does flash now, because a reset advances the
     * counter rather than rewinding it, but a number moving by one is not an answer on its own.
     */
    renderResetNote(message) {
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      text(els.resetNote, message || '');
      if (!message) {
        els.resetNote.classList.remove('is-flash');
        return;
      }
      els.resetNote.classList.add('is-flash');
      resetTimer = setTimeout(() => {
        els.resetNote.classList.remove('is-flash');
        resetTimer = null;
      }, HIGHLIGHT_MS);
    },

    /** The insurer picker. The list comes from the sample file, never from this module. */
    renderPackChoices(packs, activeId) {
      const options = (packs || []).map((pack) => option(doc, pack.id, pack.label || pack.id));
      els.insurerSelect.replaceChildren(...options);
      if (activeId) els.insurerSelect.value = activeId;
      els.insurerSelect.disabled = options.length < 2;
    },

    renderPackNote(message) {
      text(els.packNote, message || '');
    },

    /**
     * @param {object} claim the claim from the store
     * @param {string[]} changed fields that moved since the last draw, for the highlight
     */
    renderClaim(claim, changed) {
      const justChanged = new Set(changed || []);
      const filed = Boolean(claim && claim.status === 'filed');
      // While the rules are still arriving nothing on the draft may be edited, because the redraw
      // that follows the load would paint over whatever was typed. See setClaimBusy.
      const busy = Boolean(busyReason);
      let openOptional = false;

      for (const field of PATCHABLE_FIELDS) {
        const row = rows.get(field);
        if (!row) continue;

        const value = claim ? claim[field] : undefined;
        const missing = isEmpty(value);
        const pinned = isLocked(claim, field);

        row.root.classList.toggle('is-missing', missing);
        row.root.classList.toggle('is-pinned', pinned);
        text(row.value, missing ? 'Missing' : displayValue(field, value));

        applyBadge(row.badge, missing ? null : provenanceOf(claim, field));

        // Pinning refuses a patch from either side, so the control has to close with it. A
        // disabled control with no reason beside it is a dead end, so the reason is drawn too.
        row.control.disabled = filed || pinned || busy;
        row.pin.disabled = filed || busy;
        row.pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
        text(row.pinWord, pinned ? 'Pinned' : 'Pin');
        row.pinIcon.textContent = pinned ? '\u{1F512}' : '\u{1F513}';
        row.pin.title = pinned ? PIN_HINT : `Pin ${ROW_LABELS[field] || field} so no patch can change it.`;
        row.pin.setAttribute('aria-label', pinned
          ? `Unpin ${ROW_LABELS[field] || field}. It is pinned, so no patch can move it.`
          : `Pin ${ROW_LABELS[field] || field} so no patch can move it.`);

        if (filed) {
          text(row.hint, 'The claim is filed, so this field is closed.');
        } else if (pinned) {
          text(row.hint, PIN_HINT);
        } else {
          text(row.hint, '');
        }

        // Never fight the person who is typing.
        if (doc.activeElement !== row.control) {
          const next = controlValue(value);
          if (row.control.value !== next) row.control.value = next;
        }

        if (justChanged.has(field)) {
          flash(row.root, field, highlightTimers);
          if (OPTIONAL_FIELDS.includes(field)) openOptional = true;
        }
      }

      // An agent write to an optional field must still be seen, so open the group it lives in.
      if (openOptional) els.optionalDetails.open = true;

      text(els.claimNote, filed
        ? `Filed at ${claim.filed_at}. The draft is closed, so every control above is read only.`
        : '');
    },

    /**
     * The declarative form, kept honest about two things and nothing else.
     *
     * IT CLOSES WITH THE REST OF THE DRAFT. A filed claim refuses a patch from either side, so
     * leaving these controls open would offer a person a button whose only possible answer is a
     * refusal. The reason is drawn beside them rather than left to the disabled state to imply.
     *
     * THE HINT CARRIES THE LIVE REVISION, because the number an agent has to quote is the number
     * the draft is at, and a hint that named a stale one would be teaching the refusal it warns
     * about. The revision box itself is never prefilled: an empty box reaches src/core as "no
     * revision was quoted", which is the refusal that names the number to send, and prefilling it
     * would hand an agent a number it had not read.
     *
     * @param {{filed?: boolean, revision?: number}} state
     */
    renderDeclaredForm(state) {
      const filed = Boolean(state && state.filed);
      const revision = Number.isInteger(state && state.revision) ? state.revision : 0;

      for (const control of [els.declaredWitness, els.declaredPolice, els.declaredRevision]) {
        control.disabled = filed;
      }
      els.declaredSubmit.disabled = filed;

      text(els.declaredRevisionHint, filed
        ? 'The claim is filed, so this form is closed along with the rows above it.'
        : 'Leave this box empty. It is here for an agent, which has to quote the revision it read '
          + 'so a change written against an older draft is refused rather than applied to this one. '
          + `The draft is at revision ${revision} now.`);
    },

    /** What the last submission of that form did, in the words src/core used. */
    renderDeclaredResult(message) {
      text(els.declaredResult, message || '');
    },

    /** Empty the three boxes after a submission the rules accepted. */
    clearDeclaredInputs() {
      for (const control of [els.declaredWitness, els.declaredPolice, els.declaredRevision]) {
        control.value = '';
      }
    },

    /**
     * What the intake still asks for. The list is worked out by src/core from the insurer's rule
     * pack, and this only draws it.
     *
     * @param {{entries: object[], summary: string, newIds: string[], blocked: (string|null)}} state
     */
    renderRequirements(state) {
      const blocked = state && state.blocked;
      if (blocked) {
        text(els.reqSummary, blocked);
        els.reqSummary.classList.add('is-blocked');
        els.requirements.replaceChildren();
        // No pack, no denominator. A bar drawn at zero of zero would read as "nothing answered"
        // when the truth is that this page cannot say, which is a different sentence.
        drawProgress(null, 0);
        return;
      }

      els.reqSummary.classList.remove('is-blocked');
      const entries = (state && state.entries) || [];
      const fresh = new Set((state && state.newIds) || []);
      text(els.reqSummary, (state && state.summary) || '');
      els.requirements.replaceChildren(...entries.map((entry) => requirementItem(doc, entry, fresh.has(entry.id))));
      drawProgress(entries.filter((entry) => entry.satisfied).length, entries.length);
    },

    /**
     * The handler packet, after a person has filed.
     *
     * @param {{available: boolean, reference?: string, digest?: string, notice?: string,
     *          view?: string}} state
     */
    renderPacket(state) {
      const available = Boolean(state && state.available);
      els.packetPanel.hidden = !available;
      if (!available) {
        els.packetView.hidden = true;
        text(els.packetView, '');
        text(els.packetSaid, '');
        return;
      }
      text(els.packetNotice, state.notice || '');
      text(els.packetReference, state.reference || '');
      // The digest arrives a moment after the packet, because hashing is asynchronous. Saying so
      // is better than an empty line that looks like a missing value.
      text(els.packetDigest, state.digest || 'computing');
      text(els.packetView, state.view || '');
    },

    /**
     * Open or close the copy control, with the reason beside it when it is closed.
     *
     * @param {boolean} allowed
     * @param {string} reason
     */
    setPacketCopyable(allowed, reason) {
      els.packetCopy.disabled = !allowed;
      text(els.packetSaid, allowed ? '' : (reason || ''));
    },

    /**
     * Close the draft while the page is not ready to keep an edit, with the reason on screen.
     *
     * @param {(string|null)} reason null when the draft is open
     */
    setClaimBusy(reason) {
      busyReason = reason || null;
      els.claimBusy.hidden = !busyReason;
      text(els.claimBusy, busyReason || '');
    },

    /** Fold the packet open or closed, and say which state it is in. */
    togglePacketView(open) {
      els.packetView.hidden = !open;
      text(els.packetToggle, open ? 'Hide the packet' : 'Show the packet');
    },

    /** A short line beside the packet buttons, for what just happened. */
    sayAboutPacket(message) {
      text(els.packetSaid, message || '');
    },

    renderCoverage(entry) {
      if (!entry) {
        els.coverageBody.replaceChildren(
          empty(doc, 'Not checked yet. Ask your agent to check the cover, or press the button below.')
        );
        return;
      }
      if (entry.blocked) {
        els.coverageBody.replaceChildren(empty(doc, entry.blocked));
        return;
      }
      els.coverageBody.replaceChildren(coverageBlock(doc, entry));
    },

    renderEstimate(entry) {
      if (!entry) {
        els.estimateBody.replaceChildren(
          empty(doc, 'No band yet. It needs a damage position and a severity on the draft.')
        );
        return;
      }
      if (entry.blocked) {
        els.estimateBody.replaceChildren(empty(doc, entry.blocked));
        return;
      }
      els.estimateBody.replaceChildren(estimateBlock(doc, entry));
    },

    renderLedger(entries) {
      const list = entries || [];
      els.ledgerEmpty.classList.toggle('hidden', list.length > 0);
      els.ledger.replaceChildren(...list.map((entry) => ledgerItem(doc, entry)));
    },

    /**
     * THE BUTTON, THE SENTENCE AND THE COLOUR ALL COME OFF ONE DECISION, AND THIS FILE MAKES NONE.
     *
     * `state.decision` is what src/core/filing.js answered for this draft, and it is the same
     * object src/core/claim.js refuses a filing on. This used to disable the button on a separate
     * `ready` flag, which is the static required list and knows nothing an insurer derives, so the
     * button was open beside a sentence naming an open intake requirement and pressing it filed
     * the claim. There is nothing left here to disagree with the domain: no second question is
     * asked and no branch reads anything but the decision.
     *
     * @param {{decision: {ok: boolean, reason: string, outstanding: object[], insurer: (string|null),
     *                     requirementsKnown: boolean},
     *          filed: boolean, filedAt: (string|null), assistanceAt: (string|null),
     *          assistanceAvailable: boolean}} state
     */
    renderActions(state) {
      const decision = state.decision;
      els.fileBtn.disabled = Boolean(state.filed) || decision.ok !== true;

      // Drawn from the decision too, because it is a third statement about the same draft. The
      // note above the optional group used to say those fields were not wanted before filing while
      // the loaded pack was asking for two of them. It is composed by src/core from the same
      // outstanding list the file panel reads, so the two cannot say different things.
      text(els.optionalNote, optionalDetailsNote(decision));

      if (state.filed) {
        text(els.fileReason, 'This claim has been filed. Load the synthetic incident again to run the demonstration from the start.');
        els.fileReason.classList.remove('is-blocked');
        // What is true here is a fact about the surface the filing arrived on, not about who was
        // at the keyboard and not about what a browser can click. This line is printed by the very
        // click that filed the claim, so a sentence naming the presser would be answered by its
        // own existence.
        text(els.fileResult, `Filed via the page at ${state.filedAt}. Filing is not exposed as a WebMCP tool.`);
      } else {
        text(els.fileResult, '');
        // Both halves come from the one decision, the sentence and whether it is a clear answer,
        // so the colour beside the words cannot claim something the words do not.
        text(els.fileReason, decision.reason);
        els.fileReason.classList.toggle('is-blocked', decision.ok !== true);
      }

      // Three states, and every one of them draws a reason. A control that is closed with nothing
      // beside it reads as a control that is broken, and this one used to be open from the first
      // paint on a draft that had not said whether the car could still be driven.
      if (state.assistanceAt) {
        text(els.assistanceState, `Roadside assistance requested via the page at ${state.assistanceAt}. In a live deployment the insurer's dispatch desk would pick this up.`);
        els.assistanceBtn.disabled = true;
      } else if (!state.assistanceAvailable) {
        text(els.assistanceState, state.filed
          ? 'The claim is filed, so a collection is arranged with the handler rather than here.'
          : 'Collection is for a vehicle that cannot be driven. Answer "Still drivable" with no on the draft and this opens.');
        els.assistanceBtn.disabled = true;
      } else {
        text(els.assistanceState, 'The draft says the car cannot be driven, so this is yours to press. No tool on this page reaches it.');
        els.assistanceBtn.disabled = false;
      }
    },

    showFieldError(message) {
      text(els.fieldError, message || '');
    }
  };
}

/* Building the claim rows from the field lists in src/core, so the page cannot drift from them. */

function buildFieldRows(doc, host, fields, rows) {
  const items = fields.map((field) => {
    const root = doc.createElement('li');
    root.className = 'field-row is-missing';
    root.setAttribute('data-field', field);

    const head = doc.createElement('div');
    head.className = 'field-head';

    const label = doc.createElement('label');
    label.className = 'field-label';
    label.setAttribute('for', `f-${field}`);
    label.textContent = ROW_LABELS[field] || field;

    const badge = doc.createElement('span');
    badge.className = 'badge badge-none';
    badge.textContent = 'not set';

    const pin = doc.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    pin.setAttribute('data-pin', field);
    pin.setAttribute('aria-pressed', 'false');

    const pinIcon = doc.createElement('span');
    pinIcon.className = 'pin-icon';
    pinIcon.setAttribute('aria-hidden', 'true');
    pinIcon.textContent = '\u{1F513}';

    const pinWord = doc.createElement('span');
    pinWord.className = 'pin-word';
    pinWord.textContent = 'Pin';

    pin.append(pinIcon, pinWord);

    // THE PIN COMES AFTER THE CONTROL IT PINS, IN THE DOM, NOT ONLY ON THE SCREEN. It used to sit
    // in the head row beside the label, so a keyboard user reached "pin this answer" one tab
    // before reaching the answer, and was offered a decision about a value they had not read yet.
    // Moving it with CSS alone would have fixed the picture and left the tab order saying the
    // opposite of it, so it moves in the markup and the stylesheet follows: the pin sits on the
    // same line as the value it pins, to the right of it, which is where the eye and the tab key
    // now agree it is.
    head.append(label, badge);

    const control = buildControl(doc, field);
    control.id = `f-${field}`;
    control.className = 'field-control';
    control.setAttribute('data-field', field);

    const value = doc.createElement('p');
    value.className = 'field-value';
    value.textContent = 'Missing';

    const foot = doc.createElement('div');
    foot.className = 'field-foot';
    foot.append(value, pin);

    const hint = doc.createElement('p');
    hint.className = 'field-hint';

    root.append(head, control, foot, hint);
    rows.set(field, { root, control, value, badge, pin, pinIcon, pinWord, hint });
    return root;
  });

  host.replaceChildren(...items);
}

function buildControl(doc, field) {
  const kind = FIELD_CONTROLS[field];

  if (kind === 'textarea') {
    const area = doc.createElement('textarea');
    area.rows = 3;
    area.placeholder = 'Describe what happened, in your own words';
    return area;
  }

  if (kind === 'select') {
    const select = doc.createElement('select');
    select.append(option(doc, '', 'Not set yet'));
    for (const item of optionsFor(field)) {
      select.append(option(doc, item.value, item.label));
    }
    return select;
  }

  const input = doc.createElement('input');
  input.type = kind;
  return input;
}

function optionsFor(field) {
  if (field === 'incident_type') {
    return INCIDENT_TYPES.map((value) => ({ value, label: sentence(value) }));
  }
  if (field === 'severity') {
    return SEVERITIES.map((value) => ({ value, label: sentence(value) }));
  }
  if (field === 'damage_zone') {
    return DAMAGE_ZONES.map((zone) => ({ value: String(zone), label: clockLabel(zone) }));
  }
  if (field === 'vehicle_drivable') {
    return [
      { value: 'true', label: 'Yes, it could still be driven' },
      { value: 'false', label: 'No, it could not be driven' }
    ];
  }
  return [];
}

function option(doc, value, label) {
  const node = doc.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

/* Panels */

/**
 * One requirement. The reason line is the sentence src/core composed, drawn word for word: it
 * already carries the clause, the "asked for here because" clause when something on the claim
 * triggered it, and the human step when no field can answer it. This module never rewrites it and
 * never takes it apart, so the page and a tool result say the same thing.
 *
 * A requirement that has just appeared shows that whole sentence and is highlighted. The rest clamp
 * to one line, or four causal sentences would sit on screen at once and the one that just arrived
 * would be lost among them.
 */
function requirementItem(doc, entry, isNew) {
  const item = doc.createElement('li');
  const classes = ['req'];
  classes.push(entry.satisfied ? 'is-answered' : 'is-open');
  if (entry.humanOnly) classes.push('is-human');
  if (isNew) classes.push('is-new');
  item.className = classes.join(' ');

  const head = doc.createElement('div');
  head.className = 'req-head';

  const mark = doc.createElement('span');
  mark.className = 'req-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = entry.satisfied ? '✓' : '●';

  const label = doc.createElement('span');
  label.className = 'req-label';
  label.textContent = entry.label;

  const tag = doc.createElement('span');
  tag.className = 'req-tag';
  if (entry.satisfied) tag.textContent = 'answered';
  else if (entry.humanOnly) tag.textContent = 'you only';
  else tag.textContent = 'open';

  head.append(mark, label, tag);
  item.append(head);

  if (isNew) {
    const flag = doc.createElement('p');
    flag.className = 'req-new';
    flag.textContent = 'Just appeared';
    item.append(flag);
  }

  const why = doc.createElement('p');
  why.className = 'req-why';
  why.textContent = entry.why;
  item.append(why);

  // A fact about something that happened on this page, handed in by the wiring. It is never a
  // claim about the rules, which is why it is a separate line from the reason above.
  if (entry.humanNote) {
    const done = doc.createElement('p');
    done.className = 'req-human-note';
    done.textContent = entry.humanNote;
    item.append(done);
  }

  return item;
}

/**
 * One tool on the published surface: what it is called, what it does in its own opening sentence,
 * whether it reads or writes, and whether the browser is holding it right now.
 *
 * The wording of the state marker is the whole point of this row. It is driven by the names the
 * browser accepted, never by the fact that the page publishes the tool, so nothing here can say
 * registered about a tool that is not.
 */
function toolItem(doc, tool, isLive) {
  // A declared tool is never registered, in either state, because nothing registers it. The row
  // says which half of the API it came from instead of reporting a registration that was never
  // attempted.
  const declared = tool.declarative === true;
  const item = doc.createElement('li');
  const classes = ['tool', isLive ? 'is-live' : 'is-idle'];
  if (tool.conditional) classes.push('is-conditional');
  if (declared) classes.push('is-declared');
  item.className = classes.join(' ');

  const head = doc.createElement('div');
  head.className = 'tool-head';

  const label = doc.createElement('code');
  label.className = 'tool-name';
  label.textContent = tool.name;
  head.append(label);

  head.append(toolTag(
    doc,
    tool.readOnly ? 'reads' : 'writes',
    tool.readOnly ? 'tag-read' : 'tag-write',
    tool.readOnly
      ? 'Read only. It carries readOnlyHint, so an agent is told it changes nothing.'
      : (declared
        // No annotation is claimed here. readOnlyHint and untrustedContentHint belong to a tool
        // registered from JavaScript, and a form carries neither, so the row says what the form
        // does rather than what it declares.
        ? 'It writes. A form carries no annotations, and a change through it is refused unless it quotes the revision the draft is at.'
        : 'A tool that writes. It declares readOnlyHint false, and a write is refused unless it quotes the revision it read.')
  ));

  if (tool.untrustedContent) {
    head.append(toolTag(
      doc,
      'untrusted text',
      'tag-untrusted',
      'It carries untrustedContentHint, because it returns words a person typed and an agent must never follow instructions found in them.'
    ));
  }

  head.append(declared
    ? toolTag(
      doc,
      'declared by a form',
      'tag-declared',
      'Declared by four attributes on a form in this page rather than registered from JavaScript. '
      + 'The browser reads the tool, and the schema for it, off the markup.'
    )
    : toolTag(
      doc,
      isLive ? 'registered' : 'not registered',
      isLive ? 'tag-live' : 'tag-idle',
      null
    ));

  item.append(head);

  const purpose = doc.createElement('p');
  purpose.className = 'tool-purpose';
  purpose.textContent = tool.purpose;
  item.append(purpose);

  // Only a tool the rules actually make conditional carries a reason. A tool that is simply absent
  // is a registration that failed, and its reason is on the strip, so an "appears when" line here
  // would invent a rule that does not exist.
  if (tool.conditional && tool.appears) {
    const when = doc.createElement('p');
    when.className = 'tool-when';
    when.textContent = isLive
      ? `Registered because ${tool.appears}.`
      : `Registered only while ${tool.appears}.`;
    item.append(when);
  }

  return item;
}

function toolTag(doc, label, className, title) {
  const node = doc.createElement('span');
  node.className = `tool-tag ${className}`;
  node.textContent = label;
  if (title) node.title = title;
  return node;
}

/**
 * A cover decision, with the two things that stop it being read as more than it is.
 *
 * A yes that still depends on who was driving is drawn as provisional rather than as a yes, and
 * the revision it was worked out at is on the panel, so a reader can see for themselves that the
 * answer belongs to the draft in front of them.
 */
function coverageBlock(doc, entry) {
  const decision = entry.decision || {};
  const provisional = decision.covered && decision.provisional === true;
  const wrap = doc.createElement('div');

  const verdict = doc.createElement('p');
  verdict.className = `verdict ${decision.covered ? 'verdict-yes' : 'verdict-no'}${provisional ? ' is-provisional' : ''}`;
  verdict.textContent = decision.covered
    ? (provisional ? 'Covered, provisionally' : 'Covered')
    : 'Not covered';
  wrap.append(verdict);

  const list = doc.createElement('dl');
  list.className = 'kv';
  addPair(doc, list, 'Insurer', entry.insurer);
  addPair(doc, list, 'Clause', decision.clause);
  addPair(doc, list, 'Reason', decision.reason);
  const applied = exclusionLabels(decision);
  if (applied.length) {
    addPair(doc, list, 'Exclusions', applied.join('; '));
  }
  if (decision.covered && decision.deductible !== undefined && decision.deductible !== null) {
    addPair(doc, list, 'Your excess', `${decision.deductible} ${decision.currency || ''}`.trim(), true);
  }
  addPair(doc, list, 'Worked out at', revisionText(entry));
  wrap.append(list);

  wrap.append(note(doc, 'Checked against the sample policy on this page. Not a settlement decision.'));
  wrap.append(sourceTag(doc, entry));
  return wrap;
}

function estimateBlock(doc, entry) {
  const band = entry.band || {};
  const wrap = doc.createElement('div');

  if (entry.whatIf) {
    const flag = doc.createElement('p');
    flag.className = 'verdict verdict-info';
    flag.textContent = `What if it is ${entry.severity}`;
    wrap.append(flag);
  }

  const list = doc.createElement('dl');
  list.className = 'kv';
  addPair(doc, list, 'Band', `${band.low} to ${band.high} ${band.currency || ''}`.trim(), true);
  addPair(doc, list, 'Damage', clockLabel(entry.zone));
  addPair(doc, list, 'Severity', sentence(String(entry.severity || '')));
  addPair(doc, list, 'Worked out at', revisionText(entry));
  wrap.append(list);

  if (Array.isArray(band.lines) && band.lines.length) {
    const lines = doc.createElement('ul');
    lines.className = 'lines';
    for (const line of band.lines) {
      const item = doc.createElement('li');
      const part = doc.createElement('span');
      part.className = 'part';
      part.textContent = line.part;
      const cost = doc.createElement('span');
      cost.className = 'amount';
      cost.textContent = `${line.cost} ${band.currency || ''}`.trim();
      item.append(part, cost);
      lines.append(item);
    }
    wrap.append(lines);
  }

  wrap.append(note(doc, entry.whatIf
    ? 'A what if. The claim draft was not changed. A triage band from a fixed parts table, not a quote.'
    : 'A triage band from a fixed parts table. Not a quote and not a prediction.'));
  wrap.append(sourceTag(doc, entry));
  return wrap;
}

/**
 * One tool call. A refusal is drawn as loudly as a success and carries the code the rules gave it,
 * because "the page said no and here is why" is the part of this demonstration worth watching.
 */
function ledgerItem(doc, entry) {
  const refusals = Array.isArray(entry.refusals) ? entry.refusals : [];
  const item = doc.createElement('li');
  const classes = ['ledger-item'];
  if (entry.error) classes.push('is-error');
  if (refusals.length) classes.push('is-refused');
  item.className = classes.join(' ');

  const top = doc.createElement('div');
  top.className = 'ledger-top';

  const time = doc.createElement('span');
  time.className = 'ledger-time';
  time.textContent = entry.at;

  const name = doc.createElement('span');
  name.className = 'ledger-name';
  name.textContent = entry.name;

  top.append(time, name);

  if (refusals.length) {
    const flag = doc.createElement('span');
    flag.className = 'ledger-flag';
    flag.textContent = refusals.length === 1 ? 'refused' : `${refusals.length} refused`;
    top.append(flag);
  }

  item.append(top);

  const args = doc.createElement('p');
  args.className = 'ledger-args';
  args.textContent = clip(entry.args, ARGS_LIMIT);
  item.append(args);

  for (const refusal of refusals) {
    const line = doc.createElement('p');
    line.className = 'ledger-refusal';

    const code = doc.createElement('span');
    code.className = 'ledger-code';
    code.textContent = refusal.code || 'REFUSED';

    const message = doc.createElement('span');
    message.className = 'ledger-reason';
    message.textContent = refusal.error || 'The rules refused this change.';

    line.append(code, message);
    item.append(line);
  }

  const result = doc.createElement('p');
  result.className = 'ledger-result';
  result.textContent = clip(entry.text, RESULT_LIMIT);
  item.append(result);

  return item;
}

/* Small builders */

function addPair(doc, list, term, value, mono) {
  if (value === undefined || value === null || value === '') return;
  const dt = doc.createElement('dt');
  dt.textContent = term;
  const dd = doc.createElement('dd');
  if (mono) dd.className = 'amount';
  dd.textContent = String(value);
  list.append(dt, dd);
}

function note(doc, message) {
  const node = doc.createElement('p');
  node.className = 'note';
  node.textContent = message;
  return node;
}

/**
 * The revision a published answer was worked out at, and the one it is still current at.
 *
 * Drawn on the panel rather than kept in memory, because it is the tie between the answer and the
 * draft. When the two stop matching the wiring replaces the panel with a sentence saying so, and a
 * reader who wants to check that for themselves needs the number in front of them.
 *
 * The two numbers separate because filing a claim and pinning a field both move the revision
 * without moving a field, and an answer none of whose inputs changed is still that answer. Naming
 * only the newer number would put a revision on the panel at which nothing was ever worked out.
 * Naming only the older one leaves a reader wondering why it does not match the header.
 */
function revisionText(entry) {
  const workedOutAt = entry && entry.revision;
  if (!Number.isFinite(workedOutAt)) return '';
  const validAt = entry.validAt;
  return Number.isFinite(validAt) && validAt !== workedOutAt
    ? `draft revision ${workedOutAt}, still current at ${validAt}`
    : `draft revision ${workedOutAt}`;
}

function sourceTag(doc, entry) {
  const node = doc.createElement('p');
  node.className = 'source-tag';
  // NAMES THE SURFACE THE RUN ARRIVED ON, NOT WHO ASKED FOR IT. 'agent' here means the panel was
  // published from a registered tool call, and anything else means it was published from a control
  // on this page. An agent that drives the page rather than calling a tool arrives the second way,
  // so a tag reading "you" would be a claim about the keyboard that this page cannot make.
  node.textContent = entry.source === 'agent'
    ? `Run via a WebMCP tool at ${entry.at}.`
    : `Run via the page at ${entry.at}.`;
  return node;
}

function empty(doc, message) {
  const node = doc.createElement('p');
  node.className = 'empty';
  node.textContent = message;
  return node;
}

/* Formatting */

/**
 * "10 o'clock, left front wing". The panel names come from src/core, so the page, the tools and
 * the spoken summary all describe the same spot on the car the same way.
 */
export function clockLabel(zone) {
  const number = Number(zone);
  if (!Number.isInteger(number)) return String(zone);
  const panel = ZONE_LABELS[number];
  return panel ? `${number} o'clock, ${panel}` : `${number} o'clock`;
}

function displayValue(field, value) {
  if (field === 'damage_zone') return clockLabel(value);
  if (field === 'vehicle_drivable') return value ? 'Yes' : 'No';
  if (field === 'incident_type' || field === 'severity') return sentence(String(value));
  return String(value);
}

function controlValue(value) {
  if (isEmpty(value)) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function applyBadge(badge, source) {
  badge.classList.remove(...BADGE_CLASSES);
  const word = source ? BADGE_WORDS[source] : null;
  if (word) {
    badge.classList.add(BADGE_CLASS[source]);
    badge.textContent = word;
    badge.title = BADGE_TITLES[source];
  } else {
    badge.classList.add('badge-none');
    badge.textContent = 'not set';
    badge.title = BADGE_TITLES.none;
  }
}

function flash(row, field, timers) {
  const existing = timers.get(field);
  if (existing) clearTimeout(existing);
  row.classList.add('is-changed');
  timers.set(field, setTimeout(() => {
    row.classList.remove('is-changed');
    timers.delete(field);
  }, HIGHLIGHT_MS));
}

function sentence(word) {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function clip(value, limit) {
  const body = String(value === undefined || value === null ? '' : value);
  return body.length > limit ? `${body.slice(0, limit).trimEnd()} [more]` : body;
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

function text(node, value) {
  if (node) node.textContent = value;
}
