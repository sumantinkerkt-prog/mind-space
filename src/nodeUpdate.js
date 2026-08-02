/**
 * Workspace-scoped card update (fix for Bug 24).
 *
 * Extracted from App.jsx `updateNode` as a pure function so it can be tested
 * without rendering the app. See nodeUpdate.test.js.
 *
 * ---------------------------------------------------------------------------
 * What the previous implementation did wrong
 * ---------------------------------------------------------------------------
 * 1. Any workspace that merely *contained* a card with the same id was pulled
 *    into the update, which cancelled out the "active workspace only" guard.
 * 2. That foreign card received the *entire* `updates` object, so it inherited
 *    theme and x/y as well as text -- it was silently moved as well as rewritten.
 * 3. The clone source was resolved by scanning workspaces in array order and
 *    taking the first match. New workspaces are appended, so older ones were
 *    searched first and the wrong card could be picked as the source.
 *
 * Because the resulting object reference changed, workspace autosave persisted
 * and uploaded the damage as a deliberate edit by this device.
 *
 * ---------------------------------------------------------------------------
 * Rules enforced here
 * ---------------------------------------------------------------------------
 * - The full `updates` object applies to exactly one card: the edited card on
 *   the active workspace.
 * - The clone source is resolved from the active workspace only.
 * - Title/content sync follows an explicit `cloneSourceId` relationship. A bare
 *   matching id is never sufficient.
 * - If the source id occurs more than once in the project the match is
 *   ambiguous, so syncing to the original is skipped and reported rather than
 *   guessed at.
 * - A workspace that is neither active nor holds a genuine clone is returned
 *   untouched by reference, so it is never marked dirty or uploaded.
 *
 * Deliberately unchanged: `deleteNode` still clears `cloneSourceId` only within
 * the active workspace, which leaves dangling clone links elsewhere. That is
 * Bug 17 and requires workspace-qualified clone identity -- a separate job.
 */

const passThroughLayout = (groups) => groups;

/**
 * @param {Array}  prevWorkspaces      current workspaces array
 * @param {Object} options
 * @param {string} options.id                 id of the card being edited
 * @param {Object} options.updates            fields to apply to that card
 * @param {string} options.activeWorkspaceId  workspace the user is looking at
 * @param {Function} [options.computeLayout]  (groups, nodes) => groups
 * @param {Function} [options.onAmbiguity]    called when a source id is duplicated
 * @returns {Array} new workspaces array, or `prevWorkspaces` unchanged
 */
export function applyNodeUpdate(prevWorkspaces, options) {
  const {
    id,
    updates,
    activeWorkspaceId,
    computeLayout = passThroughLayout,
    onAmbiguity = null,
  } = options || {};

  if (!Array.isArray(prevWorkspaces)) return prevWorkspaces;
  if (id === undefined || id === null) return prevWorkspaces;
  if (!updates || typeof updates !== 'object') return prevWorkspaces;

  // Only title and content are ever shared with clones. Position, theme, size
  // and every other field stay on the card the user actually edited.
  const syncFields = {};
  if (updates.title !== undefined) syncFields.title = updates.title;
  if (updates.content !== undefined) syncFields.content = updates.content;
  const shouldPropagate = Object.keys(syncFields).length > 0;

  // Rule 2: resolve the edited card from the ACTIVE workspace only.
  const activeWs = prevWorkspaces.find((w) => w && w.id === activeWorkspaceId);
  if (!activeWs) return prevWorkspaces;

  const editedNode = (activeWs.nodes || []).find((n) => n && n.id === id);
  // The card is not on the canvas the user is looking at, so there is nothing
  // legitimate to edit. Previously this still wrote to other workspaces.
  if (!editedNode) return prevWorkspaces;

  const sourceId = shouldPropagate
    ? (editedNode.cloneSourceId || editedNode.id)
    : null;

  // Rule 3: a real clone relationship must exist before anything propagates.
  let hasExplicitClone = false;
  let sourceIdMatchCount = 0;
  if (sourceId !== null && sourceId !== undefined) {
    for (const ws of prevWorkspaces) {
      for (const n of ((ws && ws.nodes) || [])) {
        if (!n) continue;
        if (n.cloneSourceId === sourceId) hasExplicitClone = true;
        if (n.id === sourceId) sourceIdMatchCount++;
      }
    }
  }

  const sourceIsUnambiguous = sourceIdMatchCount === 1;
  if (onAmbiguity && sourceId !== null && sourceIdMatchCount > 1) {
    onAmbiguity({ id, sourceId, matchCount: sourceIdMatchCount });
  }

  const propagate = shouldPropagate && sourceId !== null && hasExplicitClone;

  const isCloneParticipant = (n) =>
    !!n && (
      n.cloneSourceId === sourceId ||
      (n.id === sourceId && sourceIsUnambiguous)
    );

  return prevWorkspaces.map((ws) => {
    if (!ws) return ws;
    const isActiveWs = ws.id === activeWorkspaceId;
    const nodes = ws.nodes || [];

    // Rule 1: holding a card with a matching id is no longer a reason to touch
    // a workspace at all.
    const touchesThisWs = isActiveWs || (propagate && nodes.some(isCloneParticipant));
    if (!touchesThisWs) return ws;

    let changed = false;
    const updatedNodes = nodes.map((n) => {
      if (!n) return n;
      // The full edit lands on exactly one card, on the active canvas only.
      if (isActiveWs && n.id === id) {
        changed = true;
        return { ...n, ...updates };
      }
      // Clones receive title/content only -- never position or theme.
      if (propagate && isCloneParticipant(n)) {
        changed = true;
        return { ...n, ...syncFields };
      }
      return n;
    });

    // Returning the same reference keeps this workspace out of autosave.
    if (!changed) return ws;

    return { ...ws, nodes: updatedNodes, groups: computeLayout(ws.groups, updatedNodes) };
  });
}

/**
 * Clone instances for the Clone Panel.
 *
 * The panel previously matched `n.id === sourceId || n.cloneSourceId === sourceId`
 * across all workspaces, so an unrelated card that happened to share the id was
 * listed as a clone instance. Same flaw as Bug 24, same rule applied.
 *
 * @returns {{ instances: Array, ambiguousSource: boolean }}
 */
export function collectCloneInstances(workspaces, sourceId) {
  if (!Array.isArray(workspaces) || sourceId === null || sourceId === undefined) {
    return { instances: [], ambiguousSource: false };
  }

  let sourceIdMatchCount = 0;
  for (const ws of workspaces) {
    for (const n of ((ws && ws.nodes) || [])) {
      if (n && n.id === sourceId) sourceIdMatchCount++;
    }
  }
  const sourceIsUnambiguous = sourceIdMatchCount === 1;

  const instances = [];
  for (const ws of workspaces) {
    for (const n of ((ws && ws.nodes) || [])) {
      if (!n) continue;
      const isExplicitClone = n.cloneSourceId === sourceId;
      const isTheOriginal = n.id === sourceId && sourceIsUnambiguous;
      if (isExplicitClone || isTheOriginal) {
        instances.push({
          ...n,
          _workspaceId: ws.id,
          _workspaceName: ws.name,
          _edges: ws.edges,
        });
      }
    }
  }

  return { instances, ambiguousSource: sourceIdMatchCount > 1 };
}
