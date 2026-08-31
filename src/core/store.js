/**
 * The one place the claim draft lives while the page is open.
 *
 * PURE MODULE. No DOM, no browser globals, no network, no timers, no I/O.
 *
 * Both the person clicking the page and the visitor's agent go through this
 * store, which is why the two always see the same draft, the same revision and
 * the same history of who wrote what. All the rules live in claim.js. The store
 * never re-implements one.
 *
 * State shape:
 *   { claim, lastError, lastCode }
 *
 * `lastCode` is the refusal code from claim.js, so the page can style a stale
 * patch differently from a bad value without parsing the message.
 *
 * Treat the state and the claim inside it as read only. Never assign into them,
 * always dispatch. `getState()` hands back the live object rather than a copy,
 * so a render can compare by reference to decide whether anything changed.
 *
 * ACTIONS
 *   { type: 'patch', changes: [{field, value}], actor, baseRevision }
 *   { type: 'patch', field, value, actor, baseRevision }   one change, same thing
 *   { type: 'lock',   field }     human only, pins a field
 *   { type: 'unlock', field }     human only, releases it
 *   { type: 'file',   at, pack, completedHumanActions, homePackId }
 *                                 filing. The insurer rule pack and the human actions already
 *                                 carried out travel on the action, because the gate in
 *                                 src/core/filing.js reads both and this store holds neither.
 *                                 With no pack the domain refuses: see FILE_REFUSED_NO_PACK.
 *   { type: 'reset' }              restores the draft and advances the revision, never rewinds it
 *   { type: 'context', reason }   nothing on the claim changed, but what the tools ANSWER did.
 *                                 Moves the revision so a patch quoting the earlier number is
 *                                 refused as stale. The page dispatches it from exactly two
 *                                 places: switching the insurer rule pack, and a human action
 *                                 that closes a requirement. See noteContextChange in claim.js.
 *
 * `actor` defaults to 'human', because the page is the caller that can leave it
 * out. The tools layer passes actor 'agent' and the baseRevision the agent read,
 * and an agent patch without one is refused as stale by claim.js.
 *
 * Filing, pinning and unpinning are dispatched by the page's own controls and
 * must never be reachable from a registered tool.
 */

import {
  applyPatch,
  createClaim,
  fileClaim,
  hydrateClaim,
  lockField,
  noteContextChange,
  unlockField,
} from './claim.js';

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
      ? hydrateClaim(clone(seedClaim))
      : createClaim(initialState);

  let state = { claim: initialClaim, lastError: null, lastCode: null };
  let listeners = [];

  function getState() {
    return state;
  }

  function notify() {
    // Copy first: a listener is allowed to unsubscribe itself while we iterate.
    for (const listener of [...listeners]) listener(state);
  }

  function settle(result, applied) {
    state = {
      claim: result.claim,
      lastError: result.ok ? null : result.error,
      lastCode: result.ok ? null : result.code ?? null,
    };
    notify();
    return {
      ok: result.ok,
      error: result.error ?? null,
      code: result.code ?? null,
      applied: applied ?? result.applied ?? [],
      revision: result.revision,
      state,
    };
  }

  /**
   * @param {object} action see the action list at the top of this file
   * @returns {{ok: boolean, error: (string|null), code: (string|null),
   *            applied: string[], revision: number, state: object}}
   */
  function dispatch(action) {
    const type = action && typeof action === 'object' ? action.type : undefined;

    if (type === 'patch') {
      // One change or many. The page sends one field at a time; an agent that
      // has read the draft can send a whole correction in a single revision.
      const changes = Array.isArray(action.changes)
        ? action.changes
        : [{ field: action.field, value: action.value }];

      const result = applyPatch(state.claim, changes, {
        actor: action.actor === undefined ? 'human' : action.actor,
        baseRevision: action.baseRevision === undefined ? null : action.baseRevision,
      });
      return settle(result);
    }

    if (type === 'lock' || type === 'unlock') {
      const apply = type === 'lock' ? lockField : unlockField;
      const result = apply(state.claim, action.field);
      return settle(result, result.ok ? [action.field] : []);
    }

    if (type === 'reset') {
      // THE DRAFT GOES BACK. THE COUNTER DOES NOT.
      //
      // A revision number is a promise that a patch quoting it is patching the draft
      // the quoter read. Sending the counter back to where it started broke that
      // promise in a way nothing on the page could show: an agent read revision 0, a
      // person edited the draft to revision 1, the reset put a different draft back at
      // revision 0, and the agent's patch quoting 0 was then accepted against it. Two
      // different drafts wore one number and the stale check waved the second one
      // through, which is the one thing it exists to stop.
      //
      // So a reset is a change like any other and advances the counter past everything
      // anybody has read. The claim is restored; the number keeps counting. That is
      // also why there is no epoch here: the revision alone is what a patch quotes, and
      // one monotonic number needs no second one to agree with it.
      const restored = clone(initialClaim);
      const previous = Number.isInteger(state.claim.revision) ? state.claim.revision : 0;
      restored.revision = previous + 1;
      state = { claim: restored, lastError: null, lastCode: null };
      notify();
      return { ok: true, error: null, code: null, applied: [], revision: state.claim.revision, state };
    }

    if (type === 'context') {
      // The claim is untouched. Only the number moves, because only the number is what an agent
      // quotes back, and the answers it read are no longer the answers it would get.
      const result = noteContextChange(state.claim, action.reason);
      return settle(result, []);
    }

    if (type === 'file') {
      // THE ACTION CARRIES THE PACK AND THE COMPLETED HUMAN ACTIONS, THE STORE DOES NOT HOLD THEM.
      // Which insurer's rules are loaded and which buttons a person has pressed are facts about
      // the page, not about the draft, and a store that held them would be holding browser state.
      // Carrying them on the action keeps this module the same pure forwarder it is for a patch,
      // and it is what puts the insurer's derived requirements in front of the file gate: this
      // action used to pass neither, so the domain decided on the static field list alone.
      const result = fileClaim(state.claim, {
        at: action.at,
        pack: action.pack ?? null,
        completedHumanActions: action.completedHumanActions,
        // Whose policy this is. The picker can load another insurer's rules against the same
        // claim, and filing under those is refused in the domain rather than only in the page.
        homePackId: action.homePackId ?? null,
      });
      return settle(result, []);
    }

    // Unknown action. Change nothing, tell nobody, and do not throw.
    return {
      ok: false,
      error: `Unknown action type: ${String(type)}.`,
      code: null,
      applied: [],
      revision: state.claim.revision,
      state,
    };
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
