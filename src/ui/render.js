/**
 * The view. Every DOM reference on the page is resolved here once, and every visual state is a
 * class toggle or a text node, never an inline style, so a strict Content Security Policy can stay
 * strict.
 *
 * Nothing in this file decides anything. It is handed values and it draws them.
 *
 * The vocabulary comes from src/core: which fields exist from claim.js, what the clock positions
 * are called, how to say a field name out loud, and how an exclusion is named from coverage.js.
 * Nothing here re-states any of it, so the page cannot drift from the rules, and the panel and the
 * agent word an exclusion identically because both call the same function.
 *
 * Two details matter for the demonstration. A row that just changed gets a brief highlight, which
 * is how a viewer sees an agent tool call land on the page. And a control the person is currently
 * typing in is never overwritten by a redraw.
 */

import {
  INCIDENT_TYPES,
  SEVERITIES,
  DAMAGE_ZONES,
  ZONE_LABELS,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  PATCHABLE_FIELDS,
  FIELD_LABELS
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
    statusDot: pick('status-dot'),
    statusText: pick('status-text'),
    statusDetail: pick('status-detail'),
    fields: pick('fields'),
    fieldsOptional: pick('fields-optional'),
    optionalDetails: pick('optional-details'),
    fieldError: pick('field-error'),
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

  buildFieldRows(doc, els.fields, REQUIRED_FIELDS, rows);
  buildFieldRows(doc, els.fieldsOptional, OPTIONAL_FIELDS, rows);

  return {
    els,

    renderPersona(persona) {
      text(els.personaName, `Signed in as ${persona.holder}`);
      text(els.personaPolicy, `Policy ${persona.policyId}`);
      text(els.personaNote, persona.note);
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
        text(els.statusText, 'No agent detected in this browser.');
      }

      const detail = [];
      if (status.available) {
        detail.push(`Available to your agent: ${status.registered.join(', ')}.`);
        if (status.failed.length) {
          detail.push(`Could not register: ${status.failed.map((item) => `${item.name} (${item.reason})`).join(', ')}.`);
        }
        detail.push('Filing and roadside assistance are not on that list. They are buttons only a person can press.');
      } else {
        detail.push('The page still works. Fill the draft yourself, or open it in a browser whose agent supports WebMCP.');
      }
      if (status.fixtureSource === 'fallback') {
        detail.push('The sample claim file did not load, so a built in sample is being used.');
      }
      if (status.fixtureError) {
        detail.push(`The sample claim file was refused: ${status.fixtureError}`);
      }
      text(els.statusDetail, detail.join(' '));
    },

    renderClaim(claim, provenance, changed) {
      const justChanged = new Set(changed || []);
      const filed = claim && claim.status === 'filed';
      let openOptional = false;

      for (const field of PATCHABLE_FIELDS) {
        const row = rows.get(field);
        if (!row) continue;

        const value = claim ? claim[field] : undefined;
        const missing = isEmpty(value);

        row.root.classList.toggle('is-missing', missing);
        text(row.value, missing ? 'Missing' : displayValue(field, value));

        applyBadge(row.badge, missing ? undefined : (provenance ? provenance.get(field) : undefined));

        // Once a claim is filed the rules refuse every edit, so the controls say so rather than
        // silently swallowing what the person types.
        row.control.disabled = Boolean(filed);

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
        text(els.fileReason, 'This claim has been filed. Press Start over to run the demonstration again.');
        els.fileReason.classList.remove('is-blocked');
        text(els.fileResult, `Filed by you at ${state.filedAt}. An agent could not have pressed this button.`);
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

      if (state.assistanceAt) {
        text(els.assistanceState, `Roadside assistance requested by you at ${state.assistanceAt}. In a live deployment the insurer's dispatch desk would pick this up.`);
        els.assistanceBtn.disabled = true;
      } else {
        text(els.assistanceState, 'Not requested. A person on this page asks for it, an agent cannot.');
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

    head.append(label, badge);

    const control = buildControl(doc, field);
    control.id = `f-${field}`;
    control.className = 'field-control';
    control.setAttribute('data-field', field);

    const value = doc.createElement('p');
    value.className = 'field-value';
    value.textContent = 'Missing';

    root.append(head, control, value);
    rows.set(field, { root, control, value, badge });
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

function coverageBlock(doc, entry) {
  const decision = entry.decision || {};
  const wrap = doc.createElement('div');

  const verdict = doc.createElement('p');
  verdict.className = `verdict ${decision.covered ? 'verdict-yes' : 'verdict-no'}`;
  verdict.textContent = decision.covered ? 'Covered' : 'Not covered';
  wrap.append(verdict);

  const list = doc.createElement('dl');
  list.className = 'kv';
  addPair(doc, list, 'Clause', decision.clause);
  addPair(doc, list, 'Reason', decision.reason);
  const applied = exclusionLabels(decision);
  if (applied.length) {
    addPair(doc, list, 'Exclusions', applied.join('; '));
  }
  if (decision.covered && decision.deductible !== undefined && decision.deductible !== null) {
    addPair(doc, list, 'Your excess', `${decision.deductible} ${decision.currency || ''}`.trim(), true);
  }
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

function ledgerItem(doc, entry) {
  const item = doc.createElement('li');
  item.className = entry.error ? 'ledger-item is-error' : 'ledger-item';

  const top = doc.createElement('div');
  top.className = 'ledger-top';

  const time = doc.createElement('span');
  time.className = 'ledger-time';
  time.textContent = entry.at;

  const name = doc.createElement('span');
  name.className = 'ledger-name';
  name.textContent = entry.name;

  top.append(time, name);
  item.append(top);

  const args = doc.createElement('p');
  args.className = 'ledger-args';
  args.textContent = clip(entry.args, ARGS_LIMIT);
  item.append(args);

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
  badge.classList.remove('badge-agent', 'badge-you', 'badge-none');
  if (source === 'agent') {
    badge.classList.add('badge-agent');
    badge.textContent = 'agent';
  } else if (source === 'you') {
    badge.classList.add('badge-you');
    badge.textContent = 'you';
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
