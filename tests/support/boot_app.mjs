/**
 * Boot the real src/ui/app.js once, in this process, against the doubles.
 *
 * WHY ONCE, AND WHY A PLAIN SPECIFIER. app.js calls boot() at module top level, so a module
 * instance is a page load. An earlier version of these tests reached several scenarios in one file
 * by importing `app.js?case=x` with a different query each time, which does work: each specifier is
 * a separate instance, so each boots its own page.
 *
 * It also silently wrecked the coverage report, which is the very thing these tests exist to fix.
 * Node keys coverage on the specifier, so fourteen cache busted imports put FOURTEEN app.js rows in
 * the table, each counting the same 940 lines again at partial coverage. The reported total fell
 * from 96% to 80% while the code under test had only got better covered. Replacing one dishonest
 * denominator with another is not a fix.
 *
 * So the specifier here is plain, this module is imported exactly once per process, and node:test
 * gives every test FILE its own process. Coverage is merged by path across those processes, so
 * app.js appears once, covered by the union of every scenario. A scenario that needs different
 * conditions at boot, such as a sample file that will not load, therefore needs its own test file.
 * That is the cost, and it is the right way round: the report stays honest and the tests pay.
 */

import { createDocumentDouble, installFetchDouble } from './dom_double.mjs';

/**
 * A stand in for the browser's WebMCP host, on document.modelContext where the page looks for it.
 *
 * IT IS A FAKE AND IS NAMED ONE, on the same terms as the one in tests/unit/webmcp.test.js. It
 * records the descriptors it is handed and hands back what it was told to. It proves what the page
 * publishes and what the page does when a tool it published is called. It proves nothing about a
 * real agent or a real browser, and no readiness row may cite it as evidence that tools are
 * callable in a judge path.
 */
export function createFakeAgentHost() {
  const held = new Map();
  const listeners = new Map();

  return {
    isFake: true,

    async registerTool(descriptor, init) {
      held.set(descriptor.name, { descriptor, signal: init && init.signal });
    },

    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },

    removeEventListener(type, handler) {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },

    toolNames() {
      return [...held.keys()];
    },

    /** Call a tool the page published, the way the host would. */
    async call(name, input = {}) {
      const entry = held.get(name);
      if (!entry) throw new Error(`${name} was never registered with this fake host`);
      return entry.descriptor.execute(input, { signal: entry.signal });
    },
  };
}

/**
 * @param {object} [fetchOptions] passed to the fetch double, to boot down a failure path
 * @param {object} [agentHost] put on document.modelContext before boot, where the page looks
 * @returns {Promise<{doc: object, net: object}>}
 */
export async function bootApp(fetchOptions = {}, agentHost = null) {
  const doc = createDocumentDouble();
  if (agentHost) doc.modelContext = agentHost;
  globalThis.document = doc;
  const net = installFetchDouble(fetchOptions);

  await import('../../src/ui/app.js');

  // boot() is a floating async call, so the import resolving is not the page being drawn. The page
  // appearing is the signal.
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (doc.el('persona-name').textContent) break;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  // And let the rule pack fetches that boot started settle too.
  await new Promise((resolve) => { setTimeout(resolve, 50); });

  return { doc, net };
}

/** The row for a field, the control inside it, and the parts of it a test reads. */
export function rowFor(doc, field) {
  for (const host of [doc.el('fields'), doc.el('fields-optional')]) {
    const row = host.descendants().find((node) => node.getAttribute('data-field') === field
      && node.classList.contains('field-row'));
    if (row) {
      return {
        row,
        control: row.descendants().find((node) => node.classList.contains('field-control')),
        pin: row.descendants().find((node) => node.classList.contains('pin')),
        hint: row.descendants().find((node) => node.classList.contains('field-hint')),
        badge: row.descendants().find((node) => node.classList.contains('badge')),
      };
    }
  }
  throw new Error(`no row for ${field}`);
}
