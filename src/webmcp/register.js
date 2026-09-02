/**
 * WebMCP registration layer, and the tool surface this page publishes.
 *
 * Feature detects the API, registers each tool under its own AbortController so any single tool
 * can be withdrawn later, and never throws when the API is absent. A browser with no agent falls
 * through to a normal page.
 *
 * The entry point moved from navigator.modelContext to document.modelContext, and both names are
 * still live in different builds, so both are probed.
 *
 * DESIGN RULE, NOT A TODO. Three actions are deliberately absent from this surface and must stay
 * absent:
 *   1. Filing the claim. No tool here reaches it. The person on the page presses the button.
 *   2. Unpinning a field the person pinned. Pinning is how they say "I checked this one myself",
 *      so no tool on this surface releases it.
 *   3. Requesting roadside assistance. An agent can read the options and say what they are. The
 *      button is pressed by a person.
 * An agent that has been talked into something by a poisoned web page can therefore draft, read
 * and check all it likes, and finds nothing here that files, unpins or dispatches. It is not
 * prevented from driving the page the way any browser automation drives a page, and no claim in
 * this repository says otherwise. Adding a tool for any of the three would make the product claim
 * false, and the readiness gate fails the build if one appears.
 *
 * THE TOOL SET IS NOT FIXED. get_assistance_options exists only while the claim says the vehicle
 * cannot be driven. It is registered when that answer becomes false and withdrawn when it stops
 * being false, so the surface an agent sees is a function of the claim, not a constant.
 *
 * A NOTE ON THE IMPORT CYCLE BELOW, AND A TRAP THAT WAS LIVE HERE. This module imports the tool
 * modules, and each tool module imports toResult from here. Two separate rules keep that working,
 * and an earlier version of this comment only knew about the first one.
 *
 *   1. Do not add a top level constant in a tool file that is computed from an import of this
 *      module. A tool file may only define a factory, because toResult and friends are function
 *      declarations that are not initialised until this module finishes evaluating.
 *   2. The tool lists below must not READ an imported binding while this module is evaluating,
 *      which is why every entry is wrapped in an arrow rather than named directly. Without the
 *      wrapper, importing any tool module before this one crashed the entire graph with
 *      "Cannot access 'describeClaimTool' before initialization": the tool module started, pulled
 *      in this module, and this module's array literal read a binding the half finished tool
 *      module had not yet assigned. Entering through this file happened to work, so the page was
 *      fine and the first per-tool test file would not have been. The arrows defer that read to
 *      call time, so the graph can now be entered through any module in it.
 */

import { isValidatedPack } from '../core/policy.js';

import describeClaimTool from './tools/describe_claim.js';
import readClaimStateTool from './tools/read_claim_state.js';
import applyClaimPatchTool from './tools/apply_claim_patch.js';
import validateClaimTool from './tools/validate_claim.js';
import checkCoverageTool from './tools/check_coverage.js';
import getRepairEstimateTool from './tools/get_repair_estimate.js';
import getRequirementsTool from './tools/get_requirements.js';
import readEvidenceNotesTool from './tools/read_evidence_notes.js';
import getAssistanceOptionsTool from './tools/get_assistance_options.js';

/** Chrome's secure tools guidance caps a single tool result at 1500 characters. */
export const MAX_TOOL_OUTPUT_CHARS = 1500;

const TRUNCATION_MARK = ' [output truncated]';

/** name -> AbortController, so unregisterTool(name) can withdraw exactly one tool. */
const controllers = new Map();

/**
 * The tools that exist for the whole life of the page.
 *
 * Each entry is an arrow that forwards to the factory rather than the factory itself. See rule 2
 * in the header: naming the imports directly here is what made this module unsafe to reach through
 * a tool file. The arrow costs one call and buys an import graph with no entry order to remember.
 */
export const ALWAYS_ON_TOOLS = [
  (ctx) => describeClaimTool(ctx),
  (ctx) => readClaimStateTool(ctx),
  (ctx) => getRequirementsTool(ctx),
  (ctx) => applyClaimPatchTool(ctx),
  (ctx) => validateClaimTool(ctx),
  (ctx) => checkCoverageTool(ctx),
  (ctx) => getRepairEstimateTool(ctx),
  (ctx) => readEvidenceNotesTool(ctx),
];

/**
 * Tools that come and go with the claim.
 *
 * `present` is asked on every store change and answers from the claim alone, so the same claim
 * always produces the same tool set and a reader can predict it without running anything.
 *
 * `appears` and `disappears` are the reason clauses the page reads out to the person when the tool
 * is published or withdrawn. They live beside the rule that decides it, so a new conditional tool
 * arrives with its own wording instead of needing a matching edit in the UI layer.
 */
export const CONDITIONAL_TOOLS = [
  {
    factory: (ctx) => getAssistanceOptionsTool(ctx),
    present: (claim) => Boolean(claim) && claim.vehicle_drivable === false,
    appears: 'the claim says the vehicle cannot be driven',
    disappears: 'the vehicle is drivable again',
  },
];

/* ----------------------------------------------------------- the surface */

/**
 * What this page publishes to an agent, read from the two lists above.
 *
 * This is the registration path's own source of truth, asked without registering anything. It
 * never reads document.modelContext and never throws when the API is absent, so a browser with no
 * agent can still be told exactly what it would be handed. The page used to have no way to say
 * that, and the alternative, a list typed out again in the view, would drift from the tools the
 * first time one of them changed.
 *
 * The factories are called on every request rather than once at boot. Today none of them reads the
 * context while building its descriptor, but one that ever did, for instance to name the loaded
 * insurer, would go stale behind a change of rule pack if the answer were cached.
 *
 * Nothing here says a tool is registered. That is a fact about the browser, and only
 * registeredToolNames knows it.
 *
 * @param {object} [context] the same tool context the registration path is given
 * @returns {Array<object>} one entry per tool, in the order the page publishes them
 */
export function describeToolSurface(context = {}) {
  const surface = [];
  for (const factory of ALWAYS_ON_TOOLS) {
    const entry = describeOne(factory, context, null);
    if (entry) surface.push(entry);
  }
  for (const rule of CONDITIONAL_TOOLS) {
    const entry = describeOne(rule.factory, context, rule);
    if (entry) surface.push(entry);
  }
  return surface;
}

/**
 * One tool, built and read rather than registered.
 * @returns {object|null} null when the factory refused to produce a named descriptor
 */
function describeOne(factory, context, rule) {
  let descriptor;
  try {
    descriptor = factory(context);
  } catch (error) {
    return null;
  }
  if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) return null;

  const annotations = descriptor.annotations || {};
  const wording = typeof descriptor.description === 'string' ? descriptor.description : '';

  return {
    name: descriptor.name,
    purpose: firstSentence(wording),
    wording,
    readOnly: annotations.readOnlyHint === true,
    untrustedContent: annotations.untrustedContentHint === true,
    conditional: Boolean(rule),
    appears: rule ? rule.appears : null,
  };
}

/**
 * The opening sentence of a tool's own wording, for the one line the page shows beside its name.
 *
 * Split on a full stop followed by whitespace or the end of the text, never on the colon that
 * several of these sentences use to introduce a list: cutting there leaves a fragment that reads
 * like a defect rather than a summary.
 *
 * @param {string} text
 * @returns {string}
 */
function firstSentence(text) {
  const body = String(text === undefined || text === null ? '' : text).trim();
  const stop = body.search(/\.(\s|$)/);
  return stop === -1 ? body : body.slice(0, stop + 1);
}

/**
 * The live model context object, or null when this browser has no agent surface.
 * @returns {object|null}
 */
export function getModelContext() {
  if (typeof document !== 'undefined' && document && document.modelContext) {
    return document.modelContext;
  }
  if (typeof navigator !== 'undefined' && navigator && navigator.modelContext) {
    return navigator.modelContext;
  }
  return null;
}

/**
 * Which spelling of the API this browser exposes, for the status strip.
 * @returns {string|null}
 */
export function getApiName() {
  if (typeof document !== 'undefined' && document && document.modelContext) return 'document.modelContext';
  if (typeof navigator !== 'undefined' && navigator && navigator.modelContext) return 'navigator.modelContext';
  return null;
}

/**
 * Wrap text as an MCP style content array and hold it inside the output budget.
 * Every tool returns through here, so the budget is structural rather than a thing we remember.
 * If a judge path turns out to want a bare string, this is the single line that changes.
 *
 * @param {string} text
 * @returns {{content: Array<{type: string, text: string}>}}
 */
export function toResult(text) {
  const body = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text);
  const clipped = body.length > MAX_TOOL_OUTPUT_CHARS
    ? body.slice(0, MAX_TOOL_OUTPUT_CHARS - TRUNCATION_MARK.length).trimEnd() + TRUNCATION_MARK
    : body;
  return { content: [{ type: 'text', text: clipped }] };
}

/**
 * Pull plain text back out of whatever a tool returned, for the on page ledger.
 * @param {unknown} result
 * @returns {string}
 */
export function textOfResult(result) {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  const content = result.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return String(result);
}

/* ------------------------------------------------------------------ budget */

/**
 * Assemble a result that fits the output budget by dropping detail, never by dropping the lines
 * that tell the agent what to do next.
 *
 * The head, the withheld notice and the tail are always kept whole. Body entries are added while
 * they fit, and when any are left over the caller's `more` line says how many, so a reader is
 * never quietly given a shorter list than the page actually holds. This is why the revision
 * belongs in the head: the one number the whole read then write protocol depends on can never be
 * the thing that got cut.
 *
 * THIS FUNCTION USED TO PROMISE THAT AND NOT KEEP IT, AND THE FAILURE WAS INVISIBLE. It measured
 * the head and the tail, never checked that the two of them fit, and when they did not it handed
 * back a string over the budget. toResult runs second and clips from the END, so the head survived
 * whole and the tail, which is where read_claim_state keeps the baseRevision instruction and the
 * filing boundary sentence, was cut off. Two functions disagreeing about which end is expendable,
 * with the loser being exactly the lines this one exists to protect. On a valid claim with every
 * free text field at the app's own cap it cost the entire body as well.
 *
 * So the arithmetic is now checked rather than assumed, in three places:
 *   1. The head and the tail have to fit before anything else is considered. When they do not,
 *      that is a bug in the head, not a result to be shortened, and it throws instead of returning
 *      something quietly wrong. A head is code, so a head that cannot fit is a defect a test can
 *      catch at authoring time. tests/unit/webmcp.test.js breaks one on purpose.
 *   2. The room reserved for the withheld notice is measured from `more(body.length)`, the longest
 *      notice this call could possibly print. Reserving for `more(dropped)` and then printing
 *      `more(stillDropped)` reserves for the shorter of the two, and a single extra digit in the
 *      count then pushed the result one character over.
 *   3. The assembled string is measured before it is returned, and body entries are given back one
 *      at a time until it fits. A `more` function is the caller's, so it can produce any length it
 *      likes and no reservation computed in advance is proof.
 *
 * @param {{head?: string[], body?: string[], tail?: string[], limit?: number, more?: Function}} parts
 * @returns {string}
 * @throws {RangeError} when the head and the tail cannot fit the budget between them
 */
export function budgetedBlock(parts) {
  const head = (parts && parts.head) || [];
  const body = (parts && parts.body) || [];
  const tail = (parts && parts.tail) || [];
  const limit = (parts && parts.limit) || MAX_TOOL_OUTPUT_CHARS;
  const more = (parts && parts.more) || ((count) => `${count} more not shown.`);

  // One newline is charged per line, head and tail alike. That over reserves by a character or
  // two, which is the right direction to be wrong in.
  const cost = (lines) => lines.reduce((sum, line) => sum + line.length + 1, 0);
  const fixed = cost(head) + cost(tail);

  if (fixed > limit) {
    throw new RangeError(
      `budgetedBlock cannot keep its promise: the head and tail come to ${fixed} characters and `
      + `the budget is ${limit}. Move the lines that vary in length into body, where they can be `
      + 'shortened and reported, and keep the head to what is always short.'
    );
  }

  const assemble = (taken) => {
    const dropped = body.length - taken.length;
    const lines = [...head, ...taken];
    if (dropped > 0) lines.push(more(dropped));
    return [...lines, ...tail].join('\n');
  };

  const fit = (reserve) => {
    let used = 0;
    const taken = [];
    for (const entry of body) {
      const spend = entry.length + 1;
      if (fixed + used + spend + reserve > limit) break;
      taken.push(entry);
      used += spend;
    }
    return taken;
  };

  let taken = fit(0);
  if (taken.length === body.length) return assemble(taken);

  // Something is being withheld, so the notice has to be paid for. Reserve for the longest one
  // this call could print, then verify, because `more` belongs to the caller.
  taken = fit(more(body.length).length + 1);
  let out = assemble(taken);
  while (out.length > limit && taken.length > 0) {
    taken = taken.slice(0, taken.length - 1);
    out = assemble(taken);
  }

  if (out.length > limit) {
    throw new RangeError(
      `budgetedBlock cannot keep its promise: the head and tail plus the withheld notice come to `
      + `${out.length} characters and the budget is ${limit}. Shorten the notice or the head.`
    );
  }

  return out;
}

/**
 * Trim one piece of text to a length and say so when it happens.
 * @param {string} text
 * @param {number} limit
 * @param {string} [mark]
 * @returns {string}
 */
export function clip(text, limit, mark = ' [trimmed]') {
  const body = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text);
  if (body.length <= limit) return body;
  const room = Math.max(0, limit - mark.length);
  return body.slice(0, room).trimEnd() + mark;
}

/* -------------------------------------------------------------- rule pack */

/**
 * The sentence a tool says when the insurer's intake rules did not load.
 *
 * It is the same shape as the no schedule wording in check_coverage, and for the same reason:
 * "nothing is required" would be a false statement about someone's claim, so the honest answer
 * names the loading problem instead.
 */
export const NO_PACK_REASON =
  "The insurer's intake rules did not load on this page, so what the intake asks for cannot be "
  + 'listed. That is a loading problem on our side, not a statement that your claim needs nothing.';

/**
 * The one name the page hands the loaded rule pack under.
 *
 * src/ui/app.js sets ctx.pack in applyPack, and this is the only writer in the tree. Named here
 * once so a rename is a single grep rather than a hunt through nine tool files.
 */
const PACK_KEY = 'pack';

/**
 * The loaded rule pack, or null when the page has none.
 *
 * Read defensively on purpose. deriveRequirements throws when the pack is missing, and a tool
 * that throws reaches the agent as a hard failure instead of a sentence it can act on. The shape
 * is checked rather than trusted, so a half loaded pack is treated as no pack instead of throwing
 * somewhere further in.
 *
 * AND THE SHAPE ALONE IS NOT ENOUGH, WHICH IS NEWER. `Array.isArray(pack.requirements)` says the
 * object looks like a pack, not that src/core/policy.js ever read one, so anything that could put
 * an object on the context could put an insurer's name, a clause id and an excess in front of an
 * agent. This is the same boundary the file gate in src/core/filing.js uses and it comes from the
 * same function, so a pack the page will not file under is not a pack the tools will quote either.
 *
 * @param {object} ctx
 * @returns {object|null}
 */
export function packOf(ctx) {
  if (!ctx) return null;
  const pack = ctx[PACK_KEY];
  if (pack && typeof pack === 'object' && isValidatedPack(pack) && Array.isArray(pack.requirements)) return pack;
  return null;
}

/**
 * The schedule a cover decision may be worked out against, or null when there is none.
 *
 * WHY IT IS NOT `ctx.policy`. The page used to fall back to the policy block carried in the sample
 * file whenever no rule pack loaded, and check_coverage answered from it: verdict, clause, excess
 * and all, off data the strict loader had never seen and would have refused. Embedded data can
 * still name the policyholder and the policy number, which are display facts. It cannot decide
 * whether somebody is covered.
 *
 * @param {object} ctx
 * @returns {object|null}
 */
export function scheduleOf(ctx) {
  const pack = packOf(ctx);
  if (!pack || !Array.isArray(pack.coverages) || pack.coverages.length === 0) return null;
  return pack;
}

/**
 * What answers one requirement, read from the pack rule of that id.
 *
 * deriveRequirements reports whether a requirement is satisfied, not which field would satisfy
 * it, and an agent that has to guess the field name from the label will guess wrong. The pack
 * already holds the answer, so join on the id rather than inventing a mapping.
 *
 * @param {object|null} pack
 * @param {string} id
 * @returns {{field: (string|null), humanAction: (string|null)}}
 */
export function satisfiedByOf(pack, id) {
  const rules = pack && Array.isArray(pack.requirements) ? pack.requirements : [];
  for (const rule of rules) {
    if (!rule || rule.id !== id) continue;
    const target = rule.satisfied_by || {};
    return {
      field: typeof target.field === 'string' ? target.field : null,
      humanAction: typeof target.human_action === 'string' ? target.human_action : null,
    };
  }
  return { field: null, humanAction: null };
}

/* ---------------------------------------------------------- registration */

/**
 * Register tools with the browser's model context.
 *
 * Safe to call more than once. Names already registered are skipped rather than clobbered, so a
 * later call can add a single tool (for example one that only exists while the vehicle cannot be
 * driven) without disturbing the controllers already held.
 *
 * @param {object} context handed to every tool factory. Carries the store the tools write to.
 * @param {Array<Function|object>} tools tool factories, or ready made tool descriptors.
 * @returns {Promise<{available: boolean, api: string|null, registered: string[], skipped: string[], failed: Array<{name: string, reason: string}>}>}
 */
export async function registerTools(context, tools) {
  const registered = [];
  const skipped = [];
  const failed = [];

  const modelContext = getModelContext();
  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return { available: false, api: null, registered, skipped, failed };
  }

  for (const entry of tools || []) {
    let descriptor;
    try {
      descriptor = typeof entry === 'function' ? entry(context) : entry;
    } catch (error) {
      failed.push({ name: 'unknown', reason: messageOf(error) });
      continue;
    }

    if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) {
      failed.push({ name: 'unknown', reason: 'the tool factory did not return a named descriptor' });
      continue;
    }

    if (controllers.has(descriptor.name)) {
      skipped.push(descriptor.name);
      continue;
    }

    const controller = new AbortController();
    try {
      await modelContext.registerTool(descriptor, { signal: controller.signal });
      controllers.set(descriptor.name, controller);
      registered.push(descriptor.name);
    } catch (error) {
      try { controller.abort(); } catch (ignored) { /* the controller is already gone */ }
      failed.push({ name: descriptor.name, reason: messageOf(error) });
    }
  }

  return { available: true, api: getApiName(), registered, skipped, failed };
}

/**
 * Withdraw one tool by aborting the signal it was registered with.
 * @param {string} name
 * @returns {boolean} true when a tool was actually withdrawn.
 */
export function unregisterTool(name) {
  const controller = controllers.get(name);
  if (!controller) return false;
  try { controller.abort(); } catch (ignored) { /* nothing left to abort */ }
  controllers.delete(name);
  return true;
}

/**
 * Names this page currently believes are registered.
 * @returns {string[]}
 */
export function registeredToolNames() {
  return Array.from(controllers.keys());
}

/**
 * Listen for the browser telling us the tool set changed.
 * @param {Function} handler
 * @returns {Function} unsubscribe, safe to call when nothing was ever attached.
 */
export function onToolChange(handler) {
  const modelContext = getModelContext();
  if (!modelContext || typeof modelContext.addEventListener !== 'function') {
    return () => {};
  }
  const wrapped = (event) => {
    try { handler(event); } catch (ignored) { /* a listener must never break the page */ }
  };
  modelContext.addEventListener('toolchange', wrapped);
  return () => {
    try { modelContext.removeEventListener('toolchange', wrapped); } catch (ignored) { /* already detached */ }
  };
}

/* ------------------------------------------------------------- lifecycle */

/**
 * Bring up the whole tool surface and keep it matching the claim.
 *
 * This is the only call the page needs to make. It registers the always on tools, works out
 * which conditional tools the current claim calls for, subscribes to the store so that answer is
 * recomputed on every change from either side, and listens for the browser's own toolchange
 * event.
 *
 * Reconciles are queued behind one another because registering is asynchronous and the store is
 * not: two answers arriving in the same tick would otherwise race to register the same name. That
 * queue is the first of two guards. The second is inside registerTools, which skips a name it
 * already holds a controller for, so even a racing caller cannot register the same tool twice.
 *
 * @param {object} context the tool context, carrying at least `store`
 * @param {{instrument?: Function, onChange?: Function}} [options]
 *        instrument wraps each factory, which is how the page ledgers calls
 *        onChange is called with every change to the registered set. It is called inside a try, so
 *        a listener that throws cannot take down the page that is still booting behind it.
 * @returns {Promise<{status: object, registered: Function, reconcile: Function, stop: Function}>}
 */
export async function startToolSurface(context, options = {}) {
  const instrument = typeof options.instrument === 'function' ? options.instrument : (factory) => factory;
  const listener = typeof options.onChange === 'function' ? options.onChange : () => {};

  // A listener that throws must not break the page. The first reconcile is awaited by the caller
  // while the rest of the page is still being wired, so an unguarded throw here would take the
  // boot down with it rather than losing one announcement.
  const announce = (payload) => {
    try { listener(payload); } catch (ignored) { /* a listener must never break the page */ }
  };

  const conditional = CONDITIONAL_TOOLS.map((entry) => ({ ...entry, name: null }));

  const status = await registerTools(context, ALWAYS_ON_TOOLS.map(instrument));

  let chain = Promise.resolve();
  const queue = (work) => {
    chain = chain.then(work, work);
    return chain;
  };

  function claimNow() {
    const store = context && context.store;
    if (!store || typeof store.getState !== 'function') return null;
    const state = store.getState();
    return state ? state.claim : null;
  }

  async function reconcileNow(reason) {
    if (!status.available) return { reason, added: [], removed: [], failed: [], changes: [] };

    const claim = claimNow();
    const added = [];
    const removed = [];
    const failed = [];

    // One entry per tool that actually moved, carrying the clause its own rule wrote. The page
    // reads these out, so a second conditional tool gets an announcement without the UI layer
    // learning anything new about it.
    const changes = [];

    for (const entry of conditional) {
      let wanted = false;
      try {
        wanted = entry.present(claim) === true;
      } catch (error) {
        wanted = false;
      }

      const held = Boolean(entry.name) && controllers.has(entry.name);

      if (wanted && !held) {
        const result = await registerTools(context, [instrument(entry.factory)]);
        if (result.registered.length) {
          entry.name = result.registered[0];
          added.push(entry.name);
          changes.push({ name: entry.name, published: true, because: entry.appears });
        } else if (result.skipped.length) {
          entry.name = result.skipped[0];
        }
        for (const problem of result.failed) failed.push(problem);
      } else if (!wanted && held) {
        const name = entry.name;
        if (unregisterTool(name)) {
          removed.push(name);
          changes.push({ name, published: false, because: entry.disappears });
        }
      }
    }

    if (added.length || removed.length || failed.length) {
      announce({
        reason,
        added,
        removed,
        failed,
        changes,
        registered: registeredToolNames(),
        available: status.available,
        api: status.api,
      });
    }

    return { reason, added, removed, failed, changes };
  }

  const reconcile = (reason) => queue(() => reconcileNow(reason || 'claim changed'));

  let unsubscribeStore = () => {};
  if (context && context.store && typeof context.store.subscribe === 'function') {
    // The store notifies synchronously and nobody awaits this, so the rejection has to be caught
    // here or a refused registration becomes an unhandled rejection on the page.
    unsubscribeStore = context.store.subscribe(() => {
      reconcile('claim changed').catch(() => { /* the queue already reported what it could */ });
    });
  }

  const unsubscribeToolChange = onToolChange(() => {
    announce({
      reason: 'the browser reported a tool change',
      added: [],
      removed: [],
      failed: [],
      changes: [],
      registered: registeredToolNames(),
      available: status.available,
      api: status.api,
    });
  });

  await reconcile('page opened');

  return {
    status,
    registered: registeredToolNames,
    reconcile,
    stop() {
      unsubscribeStore();
      unsubscribeToolChange();
    },
  };
}

function messageOf(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  return error.message ? String(error.message) : String(error);
}
