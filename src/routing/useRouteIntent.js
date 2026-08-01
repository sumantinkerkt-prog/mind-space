// =============================================================================
// useRouteIntent - pure "link -> view intent" reader
// =============================================================================
// Routing in this app is PURELY STRUCTURAL: the URL never owns data and never
// triggers saving/loading. It only describes an *intent* - which view the single
// (always-mounted) app should present. This module converts the current hash
// path into that intent object.
//
// Intent shape (stable contract for the app to consume):
//   {
//     mode: 'editor' | 'reference' | 'shared',
//     projectId:   string | null,   // IDs, never names (agreed decision #6)
//     workspaceId: string | null,
//     sharedId:    string | null,
//   }
//
// MILESTONE 1 SCOPE: the editor route `#/editor/:projectId/:workspaceId` is
// parsed here. `#/view/...` (reference) and `#/shared/...` arrive in M2/M6; for
// now any non-editor path safely falls back to editor intent so nothing breaks.
//
// IMPORTANT: this parser is side-effect free. IDs (never names) are carried in
// the path (agreed decision #6). The app treats the URL as the per-tab source
// of truth for which workspace is shown, but never as authoritative for data.
// =============================================================================

import { useLocation } from 'react-router-dom';

/** The safe default intent: the normal editor, no specific target. */
export const EDITOR_INTENT = Object.freeze({
  mode: 'editor',
  projectId: null,
  workspaceId: null,
  sharedId: null,
});

/** Decode a single path segment without ever throwing on malformed input. */
function safeDecode(segment) {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // malformed escape - use the raw segment rather than crash
  }
}

/**
 * Pure parser: turn a hash-route pathname into a view intent.
 *
 * Exported separately from the hook so it can be reasoned about / unit-tested
 * without React. It must remain side-effect free (no storage, no navigation).
 *
 * Recognised shapes:
 *   /editor/:projectId/:workspaceId  -> editor intent with target ids
 *   /editor, /editor/:projectId      -> editor intent with partial/no target
 *   anything else (/, /view/..., ...) -> editor intent, no target (safe default)
 *
 * @param {string} pathname - the router pathname (the part after the `#`),
 *   e.g. "/", "/editor/p1/w2". Null/undefined are handled safely.
 * @returns {{mode:'editor'|'reference'|'shared', projectId:string|null, workspaceId:string|null, sharedId:string|null}}
 */
export function parseRouteIntent(pathname) {
  const path = typeof pathname === 'string' ? pathname : '';
  const segments = path.split('/').filter(Boolean); // drop leading/empty parts

  if (segments[0] === 'editor') {
    return {
      mode: 'editor',
      projectId: safeDecode(segments[1]),
      workspaceId: safeDecode(segments[2]),
      sharedId: null,
    };
  }

  // Reference / Collector mode: read-only-but-copyable view of a workspace.
  if (segments[0] === 'view') {
    return {
      mode: 'reference',
      projectId: safeDecode(segments[1]),
      workspaceId: safeDecode(segments[2]),
      sharedId: null,
    };
  }

  // 'shared' is added in a later milestone. For the root / any unknown path,
  // fall back to editor with no target so the app behaves exactly as before.
  return { ...EDITOR_INTENT };
}

/** Build the canonical editor path for a project + workspace (ids -> path). */
export function buildEditorPath(projectId, workspaceId) {
  return `/editor/${encodeURIComponent(projectId)}/${encodeURIComponent(workspaceId)}`;
}

/** Build the canonical reference/view path for a project + workspace. */
export function buildViewPath(projectId, workspaceId) {
  return `/view/${encodeURIComponent(projectId)}/${encodeURIComponent(workspaceId)}`;
}

/**
 * React hook: the current view intent, derived from the live location.
 * Pure with respect to app state - it only reads the URL.
 * @returns intent object (see module header)
 */
export default function useRouteIntent() {
  const location = useLocation();
  return parseRouteIntent(location.pathname);
}
