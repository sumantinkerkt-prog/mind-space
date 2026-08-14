// Load-outcome classification (Bug 42)
// =============================================================================
// THE BUG THIS EXISTS TO KILL
//
// Every storage reader in this app used to collapse two completely different
// situations into the same value, `null`:
//
//   1. "I looked, and there is genuinely nothing stored yet."   (a real first run)
//   2. "I could not look. The network failed / permission was
//       denied / the stored JSON is corrupt."                   (a read FAILURE)
//
// `init()` in App.jsx then treated `null` as case 1, built a default demo
// project, wrote it to localStorage, and armed autosave on it. On the next
// upload that demo project overwrote the user's real cloud data. A transient
// network error was therefore enough to destroy the entire project.
//
// This module is the decision layer that separates those two cases. It is
// deliberately PURE - no imports, no I/O, no React - so every rule below is
// unit-testable without a browser, a Firebase mock, or a DOM.
//
// The collection side lives in persistenceService.js (`recordReadFailure`),
// which tags each failure with a source name. This module decides what those
// tags MEAN.
// =============================================================================

/**
 * How much a failed read matters.
 *
 * CRITICAL - the read was for authoritative user content, or for the
 *            bookkeeping that protects that content (the sync-state map, whose
 *            `dirty` flags are the ONLY thing making transactionalWrite raise a
 *            conflict instead of silently overwriting). If one of these fails
 *            we do not know what the user has, so we must not write anything.
 *
 * BENIGN   - the read was for a convenience or recovery feature. Losing it
 *            degrades behaviour but cannot cause data loss, so it must not put
 *            the whole app into read-only. Recorded anyway, for diagnostics.
 */
export const READ_SEVERITY = {
  CRITICAL: 'critical',
  BENIGN: 'benign',
};

/**
 * Severity per read source.
 *
 * Unlisted sources default to CRITICAL on purpose. This table fails CLOSED: if
 * a future reader is added and nobody updates this map, the app becomes
 * read-only and says so loudly, rather than quietly regaining the ability to
 * overwrite real data with defaults. A noisy false alarm is recoverable; a
 * silent overwrite is not.
 */
export const READ_SOURCE_SEVERITY = {
  // --- Authoritative content: localStorage -----------------------------------
  'localStorage:meta': READ_SEVERITY.CRITICAL,
  'localStorage:projectMeta': READ_SEVERITY.CRITICAL,
  'localStorage:workspace': READ_SEVERITY.CRITICAL,
  'localStorage:tasks': READ_SEVERITY.CRITICAL,
  // The sync-state map is content-critical even though it holds no content:
  // a corrupt map reads back as "every document is clean", which is exactly the
  // state in which the transactional writer skips its conflict check and
  // overwrites the server. See transactionalWrite's `localDirty` condition.
  'localStorage:syncState': READ_SEVERITY.CRITICAL,

  // --- Authoritative content: Firestore --------------------------------------
  'firestore:userMeta': READ_SEVERITY.CRITICAL,
  'firestore:project': READ_SEVERITY.CRITICAL,
  'firestore:workspace': READ_SEVERITY.CRITICAL,
  'firestore:allProjects': READ_SEVERITY.CRITICAL,
  'firestore:allWorkspaces': READ_SEVERITY.CRITICAL,
  'firestore:tasks': READ_SEVERITY.CRITICAL,
  // The outer catch around the whole Firestore phase in init().
  'firestore:loadSequence': READ_SEVERITY.CRITICAL,
  // The catch-all around the whole of init(). We have no idea how far it got.
  'init:exception': READ_SEVERITY.CRITICAL,

  // --- Convenience / recovery features --------------------------------------
  // A regenerated device id only mislabels "last edited by".
  'localStorage:device': READ_SEVERITY.BENIGN,
  // Losing tombstones can only resurrect a deleted workspace, never delete one.
  'localStorage:tombstones': READ_SEVERITY.BENIGN,
  // A lost retry queue means some failed uploads are not retried. The data is
  // still on disk and still dirty, so the next edit re-queues it.
  'localStorage:retryQueue': READ_SEVERITY.BENIGN,
  'localStorage:conflictBackups': READ_SEVERITY.BENIGN,
  // Version-history listing and the idle freshness probe are both read-only
  // extras; failing them shows less information, it does not risk content.
  'firestore:snapshot': READ_SEVERITY.BENIGN,
  'firestore:freshness': READ_SEVERITY.BENIGN,
  // Reconcile is itself a recovery mechanism for orphaned workspaces.
  'firestore:reconcile': READ_SEVERITY.BENIGN,
};

/**
 * Sources that mean "we never reached the cloud at all".
 *
 * These are the BOOTSTRAP reads. If one of them fails, the Firestore phase is
 * abandoned before any cloud content is adopted, and the app falls back
 * wholesale to its complete local copy. Nothing is half-loaded.
 *
 * This is categorically different from a cloud CONTENT read failing
 * (firestore:workspace, firestore:tasks, firestore:project), which means we
 * committed to the cloud as the source of truth and then lost a piece of it -
 * leaving genuinely incomplete data that must not be saved.
 *
 * Conflating the two was a real mistake in the first version of this fix: it
 * made a simple offline reload switch the whole app to read-only, when the local
 * copy was complete and perfectly safe to edit.
 */
export const CLOUD_BOOTSTRAP_SOURCES = [
  'firestore:userMeta',     // gates the entire Firestore phase
  'firestore:allProjects',  // the project list
  'firestore:loadSequence', // the outer catch around the whole cloud phase
];

/** True if every blocking failure was a "could not reach the cloud" failure. */
export function onlyCloudBootstrapFailed(readFailures) {
  const blocking = criticalFailures(readFailures);
  if (blocking.length === 0) return false;
  return blocking.every(f => CLOUD_BOOTSTRAP_SOURCES.includes(f && f.source));
}

/**
 * The five states a load can end in. The old code only understood two of them
 * ("got projects" / "did not get projects"), which is the whole bug.
 */
export const LOAD_OUTCOME = {
  /** Data loaded and every critical read succeeded. Normal operation. */
  LOADED_COMPLETE: 'loaded-complete',
  /**
   * The cloud could not be reached at all, so we loaded a COMPLETE copy from
   * this device instead. Editing is safe and allowed - the data is whole, and
   * it is saved locally. Cloud uploads stay blocked until a healthy load,
   * because this session never learned what the cloud currently holds.
   */
  LOADED_LOCAL_ONLY: 'loaded-local-only',
  /**
   * Data loaded, but at least one critical read failed, so what we hold is an
   * INCOMPLETE picture. Dangerous to save: uploading a project whose 3rd
   * workspace failed to read would delete that workspace on the server.
   */
  LOADED_PARTIAL: 'loaded-partial',
  /**
   * Every critical read succeeded and all of them agreed there is nothing
   * stored. This is the ONLY state in which creating a default project is safe.
   */
  EMPTY_CONFIRMED: 'empty-confirmed',
  /**
   * No data AND a critical read failed (or init threw). We cannot tell whether
   * the user has no data or whether we simply failed to see it. Must not write,
   * must not create defaults, must not upload.
   */
  INDETERMINATE: 'indeterminate',
};

/** Normalise a possibly-missing failure list into a real array. */
function asList(readFailures) {
  return Array.isArray(readFailures) ? readFailures : [];
}

/**
 * Severity for a source name, defaulting to CRITICAL for anything unrecognised.
 * @param {string} source
 * @returns {string} a READ_SEVERITY value
 */
export function severityForSource(source) {
  return READ_SOURCE_SEVERITY[source] || READ_SEVERITY.CRITICAL;
}

/**
 * The subset of failures that must block writes.
 * @param {Array<{source: string}>} readFailures
 * @returns {Array<{source: string}>}
 */
export function criticalFailures(readFailures) {
  return asList(readFailures).filter(f => severityForSource(f && f.source) === READ_SEVERITY.CRITICAL);
}

/**
 * Decide what actually happened during a load.
 *
 * @param {object} input
 * @param {number} input.projectCount   How many projects the load produced.
 * @param {Array<{source: string}>} input.readFailures  Failures recorded during the load.
 * @param {boolean} input.threw         Whether init() itself threw.
 * @returns {string} a LOAD_OUTCOME value
 */
export function classifyLoadOutcome({ projectCount = 0, readFailures = [], threw = false } = {}) {
  // An exception anywhere in init() leaves us unable to say how far the load
  // got or which of the state setters already ran. There is no safe way to
  // interpret that as "the user has no data", so it is always indeterminate -
  // even if some projects were already collected before the throw.
  if (threw) return LOAD_OUTCOME.INDETERMINATE;

  const blocking = criticalFailures(readFailures).length > 0;
  const hasData = Number(projectCount) > 0;

  if (hasData) {
    if (!blocking) return LOAD_OUTCOME.LOADED_COMPLETE;
    // We have data AND something failed. Which something decides everything:
    //   - only the cloud was unreachable -> the local copy we fell back to is
    //     whole, so this is offline working, not damaged data.
    //   - anything else -> a piece is genuinely missing. Read-only.
    return onlyCloudBootstrapFailed(readFailures)
      ? LOAD_OUTCOME.LOADED_LOCAL_ONLY
      : LOAD_OUTCOME.LOADED_PARTIAL;
  }
  return blocking ? LOAD_OUTCOME.INDETERMINATE : LOAD_OUTCOME.EMPTY_CONFIRMED;
}

/**
 * May the app create (and persist) a fresh default project?
 *
 * ONLY when the reads definitively agreed there is nothing there. This single
 * predicate is the fix for the original data-loss path.
 */
export function mayCreateDefaultProject(outcome) {
  return outcome === LOAD_OUTCOME.EMPTY_CONFIRMED;
}

/**
 * May the app write at all - localStorage, Firestore, autosave, manual sync?
 *
 * Both failure outcomes say no:
 *  - INDETERMINATE, because whatever is in memory is not the user's data.
 *  - LOADED_PARTIAL, because what is in memory is missing pieces, and saving a
 *    subset is how you delete the rest.
 */
export function mayPersist(outcome) {
  return outcome === LOAD_OUTCOME.LOADED_COMPLETE ||
         outcome === LOAD_OUTCOME.EMPTY_CONFIRMED ||
         // Offline with a complete local copy: saving to THIS DEVICE is allowed
         // and safe. Cloud uploads are governed separately by mayUploadToCloud.
         outcome === LOAD_OUTCOME.LOADED_LOCAL_ONLY;
}

/**
 * May the app push to the CLOUD?
 *
 * Stricter than mayPersist. Local-only mode never learned what the cloud
 * currently holds, so uploading from it would mean overwriting the cloud blind.
 * Those edits are kept, marked dirty, and uploaded after the next healthy load -
 * which is why the local-only banner tells the user to reconnect and reload.
 */
export function mayUploadToCloud(outcome) {
  return outcome === LOAD_OUTCOME.LOADED_COMPLETE || outcome === LOAD_OUTCOME.EMPTY_CONFIRMED;
}

/**
 * Should the UI be blocked outright rather than shown read-only?
 *
 * Only for INDETERMINATE. There we have no trustworthy data to display, so
 * showing an editable-looking canvas would invite the user to type into a void.
 * LOADED_PARTIAL does have real (if incomplete) data worth displaying, so it
 * gets a warning banner instead.
 */
export function shouldBlockEditing(outcome) {
  return outcome === LOAD_OUTCOME.INDETERMINATE;
}

/** Group failures by source with a count, for logs and the UI. */
export function summarizeReadFailures(readFailures) {
  const counts = new Map();
  for (const f of asList(readFailures)) {
    const source = (f && f.source) || 'unknown';
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count, severity: severityForSource(source) }))
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

/**
 * Plain-language explanation for the owner, who is not a developer and cannot
 * read a console. Returned rather than rendered so it stays testable.
 *
 * @returns {{tone: string, title: string, detail: string, action: string}|null}
 *          null when there is nothing to say (a normal load).
 */
export function describeLoadOutcome(outcome, readFailures) {
  const summary = summarizeReadFailures(readFailures);
  const sources = summary.filter(s => s.severity === READ_SEVERITY.CRITICAL).map(s => s.source);
  const sourceNote = sources.length > 0 ? ` (failed while reading: ${sources.join(', ')})` : '';

  if (outcome === LOAD_OUTCOME.INDETERMINATE) {
    return {
      tone: 'error',
      title: 'Could not read your data',
      detail:
        'Something went wrong while loading, so this tab does not know what you have saved. ' +
        'It is NOT showing your project, and it has not created a new one.' + sourceNote,
      action:
        'Nothing has been changed or saved, and nothing will be saved while this message is showing. ' +
        'Reload the page. If it happens again, check your internet connection before reloading.',
    };
  }
  if (outcome === LOAD_OUTCOME.LOADED_LOCAL_ONLY) {
    return {
      tone: 'offline',
      title: 'Working offline — saved on this device only',
      detail:
        'The cloud could not be reached, so this is the copy stored on this device. It is complete, ' +
        'and you can edit normally. Your changes are being saved here, but they have NOT reached the cloud.' +
        sourceNote,
      action:
        'Keep an export as backup. Before you open this app in another tab, or on another device, ' +
        'reconnect and reload this page so these changes reach the cloud first — otherwise the two ' +
        'copies will disagree.',
    };
  }
  if (outcome === LOAD_OUTCOME.LOADED_PARTIAL) {
    return {
      tone: 'warning',
      title: 'Read-only: some of your data could not be loaded',
      detail:
        'Your project opened, but at least one part of it failed to load, so what you see may be ' +
        'incomplete.' + sourceNote,
      action:
        'Saving is switched off so the missing parts cannot be erased. You can look and copy, ' +
        'but do not edit. Reload the page to try loading the missing parts again.',
    };
  }
  return null;
}
