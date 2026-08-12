/**
 * Undo/redo history ownership.
 *
 * ---------------------------------------------------------------------------
 * What went wrong
 * ---------------------------------------------------------------------------
 * Undo snapshots are whole-project states: `{ workspaces, activeTab, nextId }`.
 * They are held in memory (`pastRef` / `futureRef` in App.jsx) and are only
 * meaningful for the project they were taken from. Every code path that swaps
 * the open project therefore has to empty the history, or the next Ctrl+Z
 * restores one project's canvases into a different project.
 *
 * `switchProject` and `cycleToProject` did that. `deleteProject` did not. So:
 * work in project A, delete project A, the app opens project B, press Ctrl+Z,
 * and every canvas of the deleted project A reappears inside project B.
 *
 * Reported by the owner after deleting a test project: canvases from two
 * different projects ended up listed together in one project.
 *
 * That is not a cosmetic glitch. The restored state arrives through the normal
 * `setWorkspaces` path, so autosave treats it as an edit and uploads the merged
 * project. It also restores the deleted project's `nextId`, and because the two
 * projects numbered their cards from independent counters, merging them can
 * produce cards that share an id -- the precondition for the cross-workspace
 * overwrite (Bug 24) that this whole remediation exists to remove.
 *
 * ---------------------------------------------------------------------------
 * The rule now
 * ---------------------------------------------------------------------------
 * Two layers, deliberately:
 *
 * 1. `deleteProject` empties the history, exactly as the other two paths do.
 *    That fixes the reported bug.
 * 2. Every snapshot records which project it came from, and undo/redo refuse to
 *    restore one that belongs to a different project. That makes the whole class
 *    of bug impossible rather than fixing the one instance of it, because it no
 *    longer depends on a future author remembering layer 1.
 *
 * Layer 2 is cheap because every snapshot in the app is a deep clone of
 * `stateRef.current`, so stamping that single object stamps all of them -- the
 * plain snapshots, the counter-snapshots that undo and redo push, and the four
 * drag snapshots.
 */

/**
 * Is this snapshot safe to restore into the currently open project?
 *
 * Unstamped snapshots are allowed. A snapshot can only lack a project id if it
 * was taken before the app knew which project was open, which is the boot
 * window before any project is loaded -- at which point there is no other
 * project for it to contaminate. Refusing them instead would silently break
 * legitimate undo, and a guard that breaks the feature it protects is worse than
 * the bug.
 *
 * @param {object} snapshot     a `{ workspaces, activeTab, nextId, projectId }` state clone
 * @param {string} openProjectId the project the app currently has open
 * @returns {boolean}
 */
export function snapshotBelongsToProject(snapshot, openProjectId) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const stamped = snapshot.projectId;
  if (stamped === undefined || stamped === null || stamped === '') return true;
  return String(stamped) === String(openProjectId);
}

/** An emptied history, in the shape `updateHistory(past, future)` expects. */
export const EMPTY_HISTORY = Object.freeze({ past: [], future: [] });
