// =============================================================================
// What is this tab FOR? (owner's model, Fix 6 second attempt)
// =============================================================================
// The owner described the architecture they want, and it is simpler than what the
// code had grown into:
//
//   EDITOR  <-> SERVER   read and write. Ask for the latest, work on it, send it
//                        back. The server keeps the latest version.
//   VIEWER   <- SERVER   read only, one way. Ask for the data, receive a copy,
//                        then you are done. To see newer data, ask again (reload).
//                        The server never accepts anything from a viewer.
//
// "Load a copy and disconnect." A viewer does not sync, does not resolve
// conflicts, does not keep bookkeeping, and does not hand work to anyone else.
//
// WHY THE FIRST ATTEMPT AT THIS FAILED
//
// Read-only was enforced by roughly forty separate checks spread through App.jsx
// (`if (isPreviewMode) return;`, `if (!isReferenceMode)`, `if (!writesAllowed())`).
// Every one of them is a chance to forget, and the load sequence alone calls
// `saveWorkspaceToLocal`, `saveProjectMeta` and `seedSyncState` from about a dozen
// places. Fixing them one at a time is guesswork, and it is impossible to prove
// you found them all.
//
// So this module answers ONE question - "is this tab a viewer?" - and
// persistenceService.js uses it to refuse writes at the point where storage is
// actually touched. There is no way around it: if a viewer's write is refused
// inside the one module that owns storage, no caller anywhere can leak.
//
// WHY LOCAL WRITES COUNT AS WRITES TOO
//
// The owner's note said a viewer may make local, temporary changes as long as
// nothing reaches the server. Almost - with one catch worth stating. This app's
// localStorage is NOT a private scratchpad for the tab: an editor tab on the same
// device reads the same keys and uploads them. So a "local only" write by a viewer
// can reach the server later, through the editor. In-memory experiments (moving the
// view, hiding descriptions, copying a card) are genuinely private and stay
// allowed. Anything that touches stored `cm-*` data does not.
// =============================================================================

/** The two roles a tab can have. */
export const SESSION_ROLE = {
  EDITOR: 'editor',
  VIEWER: 'viewer',
};

/**
 * Is this route path a viewer route?
 * Accepts either a hash (`#/view/p/w`) or a plain path (`/view/p/w`).
 * @param {string} route
 * @returns {boolean}
 */
export function isViewerRoute(route) {
  if (typeof route !== 'string' || route === '') return false;
  const path = route.replace(/^#/, '');
  return /^\/?view(\/|$)/.test(path);
}

/**
 * Work out the role from a browser location.
 *
 * Deliberately fails to EDITOR, not to VIEWER. This predicate only ever *adds* a
 * restriction: being a viewer requires being on a `/view/` URL, which is
 * unambiguous. Defaulting the other way would mean a parsing quirk could silently
 * stop the real editor from saving, which is a worse failure than the one being
 * prevented. The URL is the same source of truth the router uses.
 *
 * @param {{hash?: string, pathname?: string}} loc
 * @returns {string} a SESSION_ROLE value
 */
export function roleFromLocation(loc) {
  try {
    const hash = (loc && loc.hash) || '';
    const pathname = (loc && loc.pathname) || '';
    if (isViewerRoute(hash) || isViewerRoute(pathname)) return SESSION_ROLE.VIEWER;
  } catch {
    // fall through
  }
  return SESSION_ROLE.EDITOR;
}
