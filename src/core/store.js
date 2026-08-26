/**
 * The one place the claim draft lives while the page is open.
 *
 * PURE MODULE. No DOM, no window, no document, no fetch, no timers, no I/O.
 *
 * Both the person clicking the page and the visitor's agent calling WebMCP tools
 * go through this store, which is why the two always see the same draft. All the
 * validation is delegated to claim.js. The store never re-implements a rule.
 *
 * State shape:
 *   { claim, lastError }
 *
 * Treat the state and the claim inside it as read only. Never assign into them,
 * always dispatch. `getState()` hands back the live object rather than a copy,
 * so a render can compare by reference to decide whether anything changed.
 *
 * Filing is deliberately a separate action from patching, and only the page's
 * own human-only button dispatches it. `{type:'file'}` must never be reachable
 * from a registered tool.
 */

import { applyPatch, createClaim, validateClaim } from './claim.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} initialState a claim object, or `{claim}`, or a fixture
 * @returns {{getState: Function, dispatch: Function, subscribe: Function}}
 */
export function createStore(initialState) {
  const seedClaim =
    initialState && typeof initialState === 'object' && initialState.claim
      ? initialState.claim
      : initialState;

  const initialClaim =
    seedClaim && typeof seedClaim === 'object' && 'status' in seedClaim
      ? clone(seedClaim)
      : createClaim(initialState);

  let state = { claim: initialClaim, lastError: null };
  let listeners = [];

  function getState() {
    return state;
  }

  function notify() {
    // Copy first: a listener is allowed to unsubscribe itself while we iterate.
    for (const listener of [...listeners]) listener(state);
  }

  /**
   * @param {{type: string, field?: string, value?: *, at?: string}} action
   * @returns {{ok: boolean, error: (string|null), state: object}} so a caller can
   *          report why a patch was refused without subscribing
   */
  function dispatch(action) {
    const type = action && typeof action === 'object' ? action.type : undefined;

    if (type === 'patch') {
      const result = applyPatch(state.claim, action.field, action.value);
      state = { claim: result.claim, lastError: result.ok ? null : result.error };
      notify();
      return { ok: result.ok, error: result.error, state };
    }

    if (type === 'reset') {
      state = { claim: clone(initialClaim), lastError: null };
      notify();
      return { ok: true, error: null, state };
    }

    if (type === 'file') {
      if (state.claim.status === 'filed') {
        const error = 'This claim has already been filed.';
        state = { claim: state.claim, lastError: error };
        notify();
        return { ok: false, error, state };
      }
      const { ready, missing } = validateClaim(state.claim);
      if (!ready) {
        const error = `The claim is not ready to file. Still needed: ${missing.join(', ')}.`;
        state = { claim: state.claim, lastError: error };
        notify();
        return { ok: false, error, state };
      }
      const filed = {
        ...state.claim,
        status: 'filed',
        filed_at: typeof action.at === 'string' ? action.at : null,
      };
      state = { claim: filed, lastError: null };
      notify();
      return { ok: true, error: null, state };
    }

    // Unknown action. Change nothing, tell nobody, and do not throw.
    return { ok: false, error: `Unknown action type: ${String(type)}.`, state };
  }

  /**
   * @param {Function} listener called synchronously after every state change
   * @returns {Function} call it to unsubscribe. Safe to call more than once.
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe needs a function.');
    }
    listeners.push(listener);
    let live = true;
    return function unsubscribe() {
      if (!live) return;
      live = false;
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  return { getState, dispatch, subscribe };
}
