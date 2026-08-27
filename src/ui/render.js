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
  FIELD_LABELS,
  isLocked,
  provenanceOf
} from '../core/claim.js';
import { exclusionLabels } from '../core/coverage.js';

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

/** What each provenance value from core is called on the page, for a reader who is not a developer. */
const BADGE_WORDS = {
  human: 'you',
  agent: 'agent',
  policy: 'policy',
  derived: 'derived'
};

const BADGE_CLASSES = ['badge-agent', 'badge-you', 'badge-policy', 'badge-derived', 'badge-none'];

const PIN_HINT = 'Pinned by you. No patch can move this field, from an agent or from this page, '
  + 'until you unpin it.';

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
    fieldsOptional: pick('fields-optional'),
    optionalDetails: pick('optional-details'),
    claimNote: pick('claim-note'),
    fieldError: pick('field-error'),
    requirements: pick('requirements'),
    reqSummary: pick('req-summary'),
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
      const liveCount = available ? tools.filter((tool) => live.has(tool.name)).length : 0;

      text(els.toolsCount, available
        ? `${liveCount} of ${total} tools registered with your agent`
        : `${total} tools this page publishes to an agent`);

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
     * panel redrew into the state it was already in, the revision did not move so it did not
     * flash, and the only word about it went to the live region, which is deliberately out of
     * sight. A control with no visible answer is read as a control that does nothing.
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
        row.control.disabled = filed || pinned;
        row.pin.disabled = filed;
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
        return;
      }

      els.reqSummary.classList.remove('is-blocked');
      const entries = (state && state.entries) || [];
      const fresh = new Set((state && state.newIds) || []);
      text(els.reqSummary, (state && state.summary) || '');
      els.requirements.replaceChildren(...entries.map((entry) => requirementItem(doc, entry, fresh.has(entry.id))));
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

    renderActions(state) {
      els.fileBtn.disabled = Boolean(state.filed) || !state.ready;

      if (state.filed) {
        text(els.fileReason, 'This claim has been filed. Load the synthetic incident again to run the demonstration from the start.');
        els.fileReason.classList.remove('is-blocked');
        // What is true here is a fact about the tool surface, not about what a browser can click.
        // This line is printed by the very click that filed the claim, so a sentence about who is
        // able to press a button would be answered by its own existence.
        text(els.fileResult, `Filed by you at ${state.filedAt}. No tool on this page reaches this button.`);
      } else {
        text(els.fileResult, '');
        if (state.ready) {
          text(els.fileReason, 'The draft is complete. Filing is yours to do.');
          els.fileReason.classList.remove('is-blocked');
        } else {
          const missing = (state.missing || []).map((field) => FIELD_LABELS[field] || field);
          text(els.fileReason, missing.length
            ? `Still needed before you can file: ${missing.join(', ')}.`
            : 'Waiting for the draft to be complete.');
          els.fileReason.classList.add('is-blocked');
        }
      }

      // Three states, and every one of them draws a reason. A control that is closed with nothing
      // beside it reads as a control that is broken, and this one used to be open from the first
      // paint on a draft that had not said whether the car could still be driven.
      if (state.assistanceAt) {
        text(els.assistanceState, `Roadside assistance requested by you at ${state.assistanceAt}. In a live deployment the insurer's dispatch desk would pick this up.`);
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
    head.append(label, badge, pin);

    const control = buildControl(doc, field);
    control.id = `f-${field}`;
    control.className = 'field-control';
    control.setAttribute('data-field', field);

    const value = doc.createElement('p');
    value.className = 'field-value';
    value.textContent = 'Missing';

    const hint = doc.createElement('p');
    hint.className = 'field-hint';

    root.append(head, control, value, hint);
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
  const item = doc.createElement('li');
  const classes = ['tool', isLive ? 'is-live' : 'is-idle'];
  if (tool.conditional) classes.push('is-conditional');
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
      : 'The one tool that writes. It declares readOnlyHint false, and a write is refused unless it quotes the revision it read.'
  ));

  if (tool.untrustedContent) {
    head.append(toolTag(
      doc,
      'untrusted text',
      'tag-untrusted',
      'It carries untrustedContentHint, because it returns words a person typed and an agent must never follow instructions found in them.'
    ));
  }

  head.append(toolTag(
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
  node.textContent = entry.source === 'agent'
    ? `Run by your agent at ${entry.at}.`
    : `Run by you at ${entry.at}.`;
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
    badge.classList.add(`badge-${word === 'you' ? 'you' : source}`);
    badge.textContent = word;
  } else {
    badge.classList.add('badge-none');
    badge.textContent = 'not set';
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
