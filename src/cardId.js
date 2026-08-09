/**
 * Card id allocation (fix for the counter half of Bug 16).
 *
 * ---------------------------------------------------------------------------
 * What was wrong
 * ---------------------------------------------------------------------------
 * Card ids came from a single project-wide integer counter (`nextId`) that was
 * trusted blindly, and it could regress below ids already in use:
 *
 * 1. Three write paths stored a missing counter as `1` while eleven read paths
 *    defaulted it to `10`. A project whose stored metadata lacked the counter was
 *    persisted with `1`, so the next cards were handed the ids "1", "2", "3", "4"
 *    -- exactly the ids of the four seed cards in the default workspace.
 * 2. The counter lives in the project metadata document on its own debounce,
 *    while cards live in per-workspace documents on another. Losing the metadata
 *    write left the counter behind the cards.
 * 3. Undo restored the counter from a snapshot, rewinding it below live ids.
 * 4. Two devices editing concurrently were handed the same numbers.
 * 5. `addNode` read the counter from its closure while incrementing via
 *    `setNextId(prev => prev + 1)`, so two creations in one React batch both read
 *    the same value and produced identical ids.
 *
 * Duplicate ids are the precondition for Bug 24: an edit to one card silently
 * rewrote every card sharing its id anywhere in the project.
 *
 * ---------------------------------------------------------------------------
 * The rule now
 * ---------------------------------------------------------------------------
 * Never trust the stored counter on its own. Before every allocation, derive a
 * floor from the ids actually present in the project and take whichever is
 * higher. In App.jsx this feeds a cursor that only ever moves forward, so none
 * of the five regressions above can hand out an id that is already taken.
 *
 * The stored counter is still respected when it is *ahead* of live data: cards
 * may have been deleted, and reusing a deleted card's id would let stale edges
 * or clone references latch onto the new card.
 *
 * This is deliberately not the UUID migration. It contains the cause; it does
 * not remove the counter.
 */

/** Historical default. Seed workspaces use ids 1-4, so allocation starts above them. */
export const DEFAULT_NEXT_ID = 10;

/**
 * Highest numeric card id anywhere in the project. Non-numeric ids (already
 * migrated, or imported from elsewhere) are ignored rather than throwing.
 */
export function highestNumericCardId(workspaces) {
  let highest = 0;
  if (!Array.isArray(workspaces)) return highest;
  for (const ws of workspaces) {
    // `ws.nodes` must be checked with Array.isArray, not just for truthiness:
    // `for (const n of {})` throws "object is not iterable". A half-written
    // import or a hand-edited file can leave `nodes` as an object, and this
    // function runs on the live allocation path (deriveNextId -> reserveCardIds
    // -> every card creation), so throwing here would break adding cards
    // altogether rather than degrading. Bug 58.
    const nodes = (ws && Array.isArray(ws.nodes)) ? ws.nodes : [];
    for (const node of nodes) {
      if (!node) continue;
      const num = Number(node.id);
      if (Number.isFinite(num) && num > highest) highest = num;
    }
  }
  return highest;
}

/**
 * The lowest id that is safe to hand out next.
 *
 * @param {Array}  workspaces    live workspaces for the project
 * @param {number} storedNextId  counter from project metadata (may be missing,
 *                               stale, or rewound)
 */
export function deriveNextId(workspaces, storedNextId = DEFAULT_NEXT_ID) {
  const parsed = Number(storedNextId);
  const stored = Number.isFinite(parsed) ? parsed : DEFAULT_NEXT_ID;
  return Math.max(
    highestNumericCardId(workspaces) + 1,
    stored,
    DEFAULT_NEXT_ID,
  );
}
