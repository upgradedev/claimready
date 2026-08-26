/**
 * WebMCP registration layer.
 *
 * Feature detects the API, registers each tool under its own AbortController so any single tool
 * can be withdrawn later, and never throws when the API is absent. A browser with no agent falls
 * through to a normal page.
 *
 * The entry point moved from navigator.modelContext to document.modelContext, and both names are
 * still live in different builds, so both are probed.
 */

/** Chrome's secure tools guidance caps a single tool result at 1500 characters. */
export const MAX_TOOL_OUTPUT_CHARS = 1500;

const TRUNCATION_MARK = ' [output truncated]';

/** name -> AbortController, so unregisterTool(name) can withdraw exactly one tool. */
const controllers = new Map();

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

/**
 * Register tools with the browser's model context.
 *
 * Safe to call more than once. Names already registered are skipped rather than clobbered, so a
 * later call can add a single tool (for example one that only exists after a human presses a
 * button) without disturbing the controllers already held.
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

function messageOf(error) {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  return error.message ? String(error.message) : String(error);
}
