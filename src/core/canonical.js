/**
 * One canonical writing of a value, so two readers of one snapshot produce one string.
 *
 * PURE MODULE, AND A LEAF. No DOM, no browser globals, no network, no timers, no I/O, and no
 * imports at all. That last part is the reason this file exists on its own.
 *
 * WHY IT MOVED OUT OF src/core/packet.js. Two callers need the same canonical writing now. The
 * packet hashes it, and src/core/claim.js takes the canonical writing of the rule pack a filing was
 * decided under and binds it into the filing receipt. claim.js cannot import packet.js: packet.js
 * builds `PACKET_REFUSALS` at module top level from keys it imports out of filing.js, so it reads an
 * imported binding while it is still evaluating, and a cycle through it crashes the graph. A leaf
 * with no imports of its own can be reached from anywhere without that question being asked again.
 *
 * IT IS THE SAME FUNCTION IN BOTH PLACES, which is the whole point. packet.js re-exports it, so
 * every caller that already read it from there is unchanged, and there is no second canonical
 * writing in this repository to drift from this one.
 */

/**
 * Canonical JSON: sorted keys at every level, two space indent, LF, no undefined.
 *
 * The digest is only worth something if two runs over one snapshot produce one string, so key
 * order cannot be left to insertion order and a float cannot be left to its default formatting.
 * Numbers here are integers and fixed decimals from the rule packs, and they are written as they
 * arrive.
 *
 * THE LEVEL IS BUILT ON A NULL PROTOTYPE, AND THAT IS NOT TIDINESS. It used to be a plain `{}`,
 * which meant `out[key] = ...` for a key named `__proto__` ran the Object.prototype setter instead
 * of creating an own property, so JSON.stringify never saw it and the key left the document.
 * Measured before the change, on two objects parsed from different JSON:
 *
 *   own __proto__ on a: true
 *   same canonical: true
 *   same digest: true
 *
 * Two different documents, one digest. That is the single property this function exists to give,
 * and a handler comparing two packets would have been told they were the same packet.
 *
 * `Object.create(null)` has no setter to run, so the key lands as data. Nothing downstream ever
 * sees the object: this function returns a string, and the packet handed to a caller is the
 * original content. `tests/unit/canonicalise.test.js` holds the counterexamples, and every one of
 * them builds its fixture with JSON.parse, because a source literal `{ __proto__: 'x' }` trips the
 * same setter and would report the defect as fixed while it was still there.
 *
 * @param {*} value
 * @returns {string}
 */
export function canonicalise(value) {
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    const out = Object.create(null);
    for (const key of Object.keys(node).sort()) {
      if (node[key] === undefined) continue;
      out[key] = walk(node[key]);
    }
    return out;
  };
  return `${JSON.stringify(walk(value), null, 2)}\n`;
}
