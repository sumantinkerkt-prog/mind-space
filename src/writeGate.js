// =============================================================================
// The session write gate (Fix 6 / Bug 47)
// =============================================================================
// Whether THIS TAB may write depends on two independent things:
//
//   1. WHAT HAPPENED AT LOAD  - handled by src/loadOutcome.js (Fix 4). After an
//      indeterminate or partial read we do not know what the user has, so
//      writing could destroy it.
//   2. WHAT THIS TAB IS FOR   - handled here. A `/view/` (reference) tab is a
//      read-only window onto the data. It exists precisely so the owner has a
//      safe resting state: a tab that can be left open without any chance of it
//      touching anything.
//
// Before this module, only (1) had a gate. `writesAllowed()` in App.jsx consulted
// the load verdict alone, and reference-ness was enforced ad hoc by scattering
// `if (isPreviewMode) return;` through individual effects. Anything a later
// author added without knowing that convention wrote from a `/view/` tab - which
// is exactly how Bug 47's four leaks happened:
//
//   - the retry-queue drain (a CLOUD write) ran on load and on every `online`
//     event in a reference tab, uploading whatever the editor tab had left
//     queued;
//   - a canvas switch wrote the canvas being left back to localStorage and
//     flushed pending cloud writes;
//   - the reminder scheduler mutated project state every 60 seconds;
//   - PinPanel and ReminderPanel were handed raw state setters.
//
// Folding the mode into the gate makes the gate what its docblock always claimed
// to be: the one place every write must pass through.
//
// FAIL CLOSED. Only an explicit `editor` session may write. An unknown or
// missing mode is treated as read-only, so a future route (`shared`, a print
// view, an embed) is safe by default and has to opt IN rather than remember to
// opt out.
// =============================================================================

import { mayPersist, mayUploadToCloud } from './loadOutcome';

/** Route modes, as produced by parseRouteIntent(). */
export const SESSION_MODE = {
  EDITOR: 'editor',
  REFERENCE: 'reference',
  SHARED: 'shared',
};

/**
 * Is this tab a session that is allowed to modify data at all?
 * @param {string} mode route mode from parseRouteIntent()
 * @returns {boolean}
 */
export function isEditableSession(mode) {
  return mode === SESSION_MODE.EDITOR;
}

/**
 * May this session write to local storage?
 *
 * Both conditions must hold: the load must have been trustworthy enough
 * (`mayPersist`) AND this tab must be an editor session.
 *
 * @param {object} input
 * @param {string} input.mode    route mode from parseRouteIntent()
 * @param {string} input.outcome LOAD_OUTCOME value
 * @returns {boolean}
 */
export function sessionMayPersist({ mode, outcome } = {}) {
  return isEditableSession(mode) && mayPersist(outcome);
}

/**
 * May this session upload to the cloud?
 *
 * Strictly narrower than sessionMayPersist: in local-only mode (cloud
 * unreachable, complete local copy) editing is allowed but uploading is not,
 * because this session never learned what the cloud holds.
 *
 * @param {object} input
 * @param {string} input.mode
 * @param {string} input.outcome
 * @returns {boolean}
 */
export function sessionMayUploadToCloud({ mode, outcome } = {}) {
  return isEditableSession(mode) && mayUploadToCloud(outcome);
}
