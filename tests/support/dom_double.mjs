/**
 * A DOUBLE for the small part of the DOM that src/ui/render.js actually touches. It is named a
 * double because that is what it is, and the distinction matters more here than usual.
 *
 * WHY THIS EXISTS. src/ui/render.js is 989 lines and had never executed under a test. It did not
 * appear in the coverage table at all, because Node's coverage denominator is only what the run
 * loaded, and the one test that mentioned the file read it as TEXT with readFileSync. A percentage
 * measured over a set that excludes the two largest files on the page is not a measurement of the
 * page. This file is what lets the real module run.
 *
 * WHAT IT IMPLEMENTS, and nothing beyond it: createElement, a document querySelector that
 * understands the single [data-el="..."] form and no other, defaultView, activeElement, and on a
 * node textContent, className, classList with the two argument toggle and the variadic remove that
 * render.js relies on, setAttribute, getAttribute, append, replaceChildren, addEventListener, and
 * the plain properties value, checked, disabled, open, title, id, type, rows and placeholder.
 *
 * WHAT IT DOES NOT IMPLEMENT, deliberately. There is no innerHTML, no insertAdjacentHTML and no
 * outerHTML on this object, at all. render.js is forbidden from assigning HTML strings into the
 * page, and a double that offered the property would let a regression pass here in silence. The
 * absence is the assertion. There is no layout, no cascade, no event dispatch beyond recording a
 * listener, and no matchMedia unless a test supplies one.
 *
 * WHAT IT DECIDES: nothing. No claim rule, no wording, no requirement, no provenance and no gate
 * lives in this file. Every sentence the tests assert on is produced by the real src modules. If
 * an assertion here ever passes because of something written in this file rather than in src, the
 * test is worthless, so this file holds only container mechanics.
 *
 * WHAT IT PROVES: that render.js draws what it is handed. It proves nothing whatsoever about a
 * real browser, and no row of the readiness gate may cite it as evidence that the page renders in
 * one. That evidence is the live URL and only the live URL.
 */

import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);

/** The one selector form this double understands. Anything else must fail loudly, not silently. */
const DATA_EL_SELECTOR = /^\[data-el="([^"]+)"\]$/;

class TextNode {
  constructor(data) {
    this.data = String(data);
    this.parentNode = null;
  }

  get textContent() {
    return this.data;
  }
}

class ElementDouble {
  constructor(tagName, ownerDocument) {
    // UPPER CASE, because that is what a browser returns for an HTML element and src/ui/app.js
    // branches on it: the typing debounce fires only where `control.tagName !== 'TEXTAREA'` is
    // false. A double that answered in lower case would take the other branch here and the right
    // one in a browser, which is the worst thing a double can do.
    this.tagName = String(tagName).toUpperCase();
    this.localName = String(tagName).toLowerCase();
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this._classes = [];

    // Plain properties. Present so render.js can assign them, inert so nothing here behaves.
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.title = '';
    this.id = '';
    this.type = '';
    this.rows = undefined;
    this.placeholder = '';
    this.hidden = false;
    // CSSOM, not the style attribute. render.js sets widths through this object on purpose: the
    // page ships style-src 'self' with no unsafe-inline, so a style ATTRIBUTE would be refused by
    // the browser while an assignment through CSSOM is not. A plain object is enough to record
    // what was set and to let a test read it back.
    this.style = {};

    const self = this;
    this.classList = {
      add(...names) {
        for (const name of names) {
          if (name && !self._classes.includes(name)) self._classes.push(name);
        }
      },
      remove(...names) {
        for (const name of names) {
          const at = self._classes.indexOf(name);
          if (at !== -1) self._classes.splice(at, 1);
        }
      },
      toggle(name, force) {
        // The two argument form is the one render.js leans on, so it is the one that must be right.
        const wanted = force === undefined ? !self._classes.includes(name) : Boolean(force);
        if (wanted) this.add(name);
        else this.remove(name);
        return wanted;
      },
      contains(name) {
        return self._classes.includes(name);
      },
      get length() {
        return self._classes.length;
      },
    };
  }

  get className() {
    return this._classes.join(' ');
  }

  set className(value) {
    this._classes = String(value).split(/\s+/).filter(Boolean);
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof ElementDouble);
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(value) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    const body = value === null || value === undefined ? '' : String(value);
    if (body !== '') {
      const node = new TextNode(body);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  setAttribute(name, value) {
    const key = String(name);
    if (key === 'class') {
      this.className = value;
      return;
    }
    this.attributes.set(key, String(value));
  }

  getAttribute(name) {
    const key = String(name);
    if (key === 'class') return this.className;
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  hasAttribute(name) {
    return String(name) === 'class' ? this._classes.length > 0 : this.attributes.has(String(name));
  }

  append(...nodes) {
    for (const node of nodes) this._adopt(node);
  }

  appendChild(node) {
    this._adopt(node);
    return node;
  }

  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    for (const node of nodes) this._adopt(node);
  }

  addEventListener(type, handler) {
    const key = String(type);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(handler);
  }

  /**
   * The nearest element at or above this one matching [attribute], as the wiring uses it to find
   * the pin button a click landed inside.
   *
   * Only the [attr] form is understood, for the same reason querySelector understands only one
   * selector: a double that guesses at a selector it cannot parse reports a wrong answer instead
   * of stopping.
   */
  closest(selector) {
    const match = /^\[([a-zA-Z-]+)\]$/.exec(String(selector));
    if (!match) throw new Error(`The DOM double understands only [attribute] in closest: ${selector}`);
    let node = this;
    while (node) {
      if (node.attributes && node.attributes.has(match[1])) return node;
      node = node.parentNode;
    }
    return null;
  }

  _adopt(node) {
    const child = node instanceof ElementDouble || node instanceof TextNode
      ? node
      : new TextNode(node);
    if (child.parentNode) {
      const at = child.parentNode.childNodes.indexOf(child);
      if (at !== -1) child.parentNode.childNodes.splice(at, 1);
    }
    child.parentNode = this;
    this.childNodes.push(child);
  }

  /* Reading helpers for the tests. Not DOM API, and named so they cannot be mistaken for it. */

  /** Every element at or below this one, in document order. */
  descendants() {
    const out = [];
    for (const child of this.children) {
      out.push(child);
      out.push(...child.descendants());
    }
    return out;
  }

  /** Elements at or below this one carrying a class, by class name. */
  byClass(name) {
    return this.descendants().filter((node) => node.classList.contains(name));
  }

  /** The text of the first descendant carrying a class, or null when there is none. */
  textOfClass(name) {
    const found = this.byClass(name);
    return found.length ? found[0].textContent : null;
  }
}

class DocumentDouble {
  constructor(hookNames) {
    this.hooks = new Map();
    for (const name of hookNames) {
      const node = new ElementDouble('div', this);
      node.setAttribute('data-el', name);
      this.hooks.set(name, node);
    }
    this.activeElement = null;
    this.defaultView = null;
    this.createdTags = [];
  }

  createElement(tagName) {
    this.createdTags.push(String(tagName).toLowerCase());
    return new ElementDouble(tagName, this);
  }

  querySelector(selector) {
    const match = DATA_EL_SELECTOR.exec(String(selector));
    if (!match) {
      // Refusing here rather than returning null is the point. A selector this double cannot
      // honestly answer must stop the test, not quietly report that the page is missing a hook.
      throw new Error(
        `The DOM double understands only [data-el="..."], and was asked for: ${selector}`,
      );
    }
    return this.hooks.get(match[1]) || null;
  }

  /** The hook by name, for a test that wants to read what render.js drew into it. */
  el(name) {
    const node = this.hooks.get(name);
    if (!node) throw new Error(`No such hook in this document double: ${name}`);
    return node;
  }
}

/**
 * The hook names the shipped page actually carries.
 *
 * READ OUT OF index.html RATHER THAN LISTED HERE, and that is not a convenience. createView
 * resolves every data-el hook by name and throws naming the absent ones, so a document double
 * holding a hand written list would agree with render.js forever while index.html drifted away
 * from both. Reading the real file means the tests that build on this also check, for free, that
 * the shipped page and the shipped view still agree on every hook. That check did not exist.
 */
export function hookNamesFromIndexHtml() {
  const html = readFileSync(new URL('index.html', ROOT), 'utf8');
  const names = new Set();
  const pattern = /data-el="([^"]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    names.add(match[1]);
    match = pattern.exec(html);
  }
  return [...names];
}

/**
 * A document double carrying exactly the hooks the shipped page carries.
 * @param {{hooks?: string[], view?: object}} [options] hooks overrides the set, to test the
 *   missing hook path. view supplies doc.defaultView, to test the tool list opening rule.
 */
export function createDocumentDouble(options = {}) {
  const doc = new DocumentDouble(options.hooks || hookNamesFromIndexHtml());
  if (options.view !== undefined) doc.defaultView = options.view;
  return doc;
}

/**
 * Fire an event at a node and let it bubble, which is the only way to reach the wiring in
 * src/ui/app.js: it listens on the two field hosts and works out which row the event came from.
 *
 * This is a test affordance and is deliberately not called dispatchEvent, so nothing here can be
 * mistaken for the DOM method. It decides nothing: it walks up the parent chain calling the
 * handlers that were registered, with the originating node as event.target, which is what a
 * browser does and all that the wiring reads.
 */
export function fireEvent(target, type, extra = {}) {
  // preventDefault is container mechanics and decides nothing, so it lives here rather than in
  // every caller. A submit handler has to be able to call it, and a double that left it off would
  // fail the wiring for a reason that has nothing to do with what the wiring does. `extra` is
  // spread last, so a test that wants to watch the call can still supply its own.
  const event = {
    type: String(type),
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...extra,
  };
  let node = target;
  while (node) {
    for (const handler of (node.listeners && node.listeners.get(String(type))) || []) {
      handler(event);
    }
    node = node.parentNode;
  }
  return event;
}

/**
 * A stand in for the network, so src/ui/app.js can boot without one.
 *
 * It serves the SHIPPED files off disk rather than an invented body, so what the page is handed
 * under test is the same sample claim and the same rule packs a visitor is handed. A test that
 * wants the failure path asks for it by name through `fail`.
 *
 * @param {{fail?: (string|RegExp|boolean), status?: number}} [options]
 */
export function installFetchDouble(options = {}) {
  const realFetch = globalThis.fetch;
  const asked = [];

  const wanted = (path) => {
    if (options.fail === undefined || options.fail === false) return false;
    if (options.fail === true) return true;
    if (options.fail instanceof RegExp) return options.fail.test(path);
    return String(path).includes(String(options.fail));
  };

  globalThis.fetch = async (path) => {
    const asString = String(path);
    asked.push(asString);
    if (wanted(asString)) {
      const status = options.status || 404;
      // A refused file is a status, not a thrown error, on the path a real server takes.
      return { ok: false, status, async json() { throw new Error('not read'); } };
    }
    const onDisk = new URL(asString.replace(/^\.\//, ''), ROOT);
    const body = readFileSync(onDisk, 'utf8');
    return { ok: true, status: 200, async json() { return JSON.parse(body); } };
  };

  return {
    asked,
    restore() {
      if (realFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = realFetch;
    },
  };
}

/**
 * A controllable stand in for the global clock.
 *
 * render.js schedules real timeouts for the highlight on a changed row, the revision chip and the
 * reset note, all at 1500ms. Left alone those keep the process alive after the assertions are
 * done and, worse, the removal half of every highlight never runs inside a test, so the branch
 * that takes the class back off is never measured. Swapping the clock makes both halves reachable.
 *
 * render.js calls setTimeout as a free identifier, resolved on the global at call time, so this
 * needs no import ordering.
 */
export function installClockDouble() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pending = new Map();
  let nextId = 1;

  globalThis.setTimeout = (fn, ms) => {
    const id = nextId++;
    pending.set(id, { fn, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    pending.delete(id);
  };

  return {
    /** How many timeouts are waiting. */
    get pendingCount() {
      return pending.size;
    },
    /** Run every waiting timeout, in the order they were scheduled. */
    runAll() {
      const due = [...pending.entries()].sort((a, b) => a[0] - b[0]);
      pending.clear();
      for (const [, entry] of due) entry.fn();
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      pending.clear();
    },
  };
}
