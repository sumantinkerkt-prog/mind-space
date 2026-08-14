import { describe, it, expect } from 'vitest';
import {
  LOAD_OUTCOME,
  READ_SEVERITY,
  READ_SOURCE_SEVERITY,
  severityForSource,
  criticalFailures,
  classifyLoadOutcome,
  mayCreateDefaultProject,
  mayPersist,
  mayUploadToCloud,
  onlyCloudBootstrapFailed,
  shouldBlockEditing,
  summarizeReadFailures,
  describeLoadOutcome,
} from './loadOutcome';

/** A failure entry in the shape persistenceService.recordReadFailure builds. */
function failure(source, message = 'boom') {
  return { source, severity: severityForSource(source), message, context: null, at: 1 };
}

// =============================================================================
// severityForSource
// =============================================================================

describe('severityForSource', () => {
  it('classifies authoritative content reads as critical', () => {
    expect(severityForSource('localStorage:meta')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('localStorage:projectMeta')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('localStorage:workspace')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('localStorage:tasks')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('firestore:userMeta')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('firestore:project')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('firestore:workspace')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('firestore:allProjects')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('firestore:tasks')).toBe(READ_SEVERITY.CRITICAL);
  });

  it('treats the sync-state map as critical even though it holds no content', () => {
    // A corrupt map reads back as "every document clean", which is the exact
    // state in which transactionalWrite skips its conflict check.
    expect(severityForSource('localStorage:syncState')).toBe(READ_SEVERITY.CRITICAL);
  });

  it('classifies convenience and recovery reads as benign', () => {
    expect(severityForSource('localStorage:device')).toBe(READ_SEVERITY.BENIGN);
    expect(severityForSource('localStorage:tombstones')).toBe(READ_SEVERITY.BENIGN);
    expect(severityForSource('localStorage:retryQueue')).toBe(READ_SEVERITY.BENIGN);
    expect(severityForSource('localStorage:conflictBackups')).toBe(READ_SEVERITY.BENIGN);
    expect(severityForSource('firestore:snapshot')).toBe(READ_SEVERITY.BENIGN);
    expect(severityForSource('firestore:freshness')).toBe(READ_SEVERITY.BENIGN);
    expect(severityForSource('firestore:reconcile')).toBe(READ_SEVERITY.BENIGN);
  });

  it('fails CLOSED: an unrecognised source is critical', () => {
    // If a future reader is added and this table is not updated, the app must go
    // read-only and complain, not quietly regain the ability to write defaults.
    expect(severityForSource('firestore:somethingNew')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource('')).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource(undefined)).toBe(READ_SEVERITY.CRITICAL);
    expect(severityForSource(null)).toBe(READ_SEVERITY.CRITICAL);
  });

  it('has a severity recorded for every source in the table', () => {
    for (const [source, severity] of Object.entries(READ_SOURCE_SEVERITY)) {
      expect([READ_SEVERITY.CRITICAL, READ_SEVERITY.BENIGN]).toContain(severity);
      expect(severityForSource(source)).toBe(severity);
    }
  });
});

// =============================================================================
// criticalFailures
// =============================================================================

describe('criticalFailures', () => {
  it('keeps only the blocking failures', () => {
    const list = [failure('localStorage:device'), failure('localStorage:meta'), failure('firestore:snapshot')];
    expect(criticalFailures(list).map(f => f.source)).toEqual(['localStorage:meta']);
  });

  it('returns an empty list for benign-only failures', () => {
    expect(criticalFailures([failure('localStorage:tombstones')])).toEqual([]);
  });

  it('tolerates missing, null and malformed input', () => {
    expect(criticalFailures(undefined)).toEqual([]);
    expect(criticalFailures(null)).toEqual([]);
    expect(criticalFailures([])).toEqual([]);
    // A malformed entry has no recognisable source, so it fails closed.
    expect(criticalFailures([{}]).length).toBe(1);
    expect(criticalFailures([null]).length).toBe(1);
  });
});

// =============================================================================
// classifyLoadOutcome - the four states
// =============================================================================

describe('classifyLoadOutcome', () => {
  it('LOADED_COMPLETE: data present and every critical read succeeded', () => {
    expect(classifyLoadOutcome({ projectCount: 3, readFailures: [] })).toBe(LOAD_OUTCOME.LOADED_COMPLETE);
  });

  it('LOADED_COMPLETE: benign failures alone do not downgrade a good load', () => {
    const benign = [failure('localStorage:device'), failure('firestore:freshness'), failure('localStorage:retryQueue')];
    expect(classifyLoadOutcome({ projectCount: 1, readFailures: benign })).toBe(LOAD_OUTCOME.LOADED_COMPLETE);
  });

  it('LOADED_PARTIAL: data present but a critical read failed', () => {
    expect(classifyLoadOutcome({ projectCount: 1, readFailures: [failure('firestore:workspace')] }))
      .toBe(LOAD_OUTCOME.LOADED_PARTIAL);
  });

  it('EMPTY_CONFIRMED: no data and no critical failure - a genuine first run', () => {
    expect(classifyLoadOutcome({ projectCount: 0, readFailures: [] })).toBe(LOAD_OUTCOME.EMPTY_CONFIRMED);
  });

  it('EMPTY_CONFIRMED: a benign failure on a genuine first run still allows setup', () => {
    // A brand new browser profile can easily have no device id yet.
    expect(classifyLoadOutcome({ projectCount: 0, readFailures: [failure('localStorage:device')] }))
      .toBe(LOAD_OUTCOME.EMPTY_CONFIRMED);
  });

  it('INDETERMINATE: no data because a critical read failed', () => {
    expect(classifyLoadOutcome({ projectCount: 0, readFailures: [failure('localStorage:meta')] }))
      .toBe(LOAD_OUTCOME.INDETERMINATE);
  });

  it('INDETERMINATE: a throw always wins, even if projects were already collected', () => {
    // We cannot know how far init() got or which state setters already ran.
    expect(classifyLoadOutcome({ projectCount: 5, readFailures: [], threw: true }))
      .toBe(LOAD_OUTCOME.INDETERMINATE);
    expect(classifyLoadOutcome({ projectCount: 0, readFailures: [], threw: true }))
      .toBe(LOAD_OUTCOME.INDETERMINATE);
  });

  it('defaults to EMPTY_CONFIRMED when called with no arguments', () => {
    expect(classifyLoadOutcome()).toBe(LOAD_OUTCOME.EMPTY_CONFIRMED);
    expect(classifyLoadOutcome({})).toBe(LOAD_OUTCOME.EMPTY_CONFIRMED);
  });

  it('treats a non-numeric or negative project count as no data', () => {
    expect(classifyLoadOutcome({ projectCount: undefined, readFailures: [] })).toBe(LOAD_OUTCOME.EMPTY_CONFIRMED);
    expect(classifyLoadOutcome({ projectCount: -1, readFailures: [] })).toBe(LOAD_OUTCOME.EMPTY_CONFIRMED);
  });
});

// =============================================================================
// The gates
// =============================================================================

describe('mayCreateDefaultProject', () => {
  it('allows the default project ONLY on a confirmed-empty read', () => {
    expect(mayCreateDefaultProject(LOAD_OUTCOME.EMPTY_CONFIRMED)).toBe(true);
  });

  it('refuses to create a default project after an indeterminate read', () => {
    // This single assertion is the fix for Bug 42's data-loss path: a network
    // blip must not manufacture a demo project that then overwrites the cloud.
    expect(mayCreateDefaultProject(LOAD_OUTCOME.INDETERMINATE)).toBe(false);
  });

  it('refuses in every other state', () => {
    expect(mayCreateDefaultProject(LOAD_OUTCOME.LOADED_COMPLETE)).toBe(false);
    expect(mayCreateDefaultProject(LOAD_OUTCOME.LOADED_PARTIAL)).toBe(false);
    expect(mayCreateDefaultProject('something-else')).toBe(false);
    expect(mayCreateDefaultProject(undefined)).toBe(false);
  });
});

// =============================================================================
// LOADED_LOCAL_ONLY - offline with a complete local copy
// =============================================================================

describe('onlyCloudBootstrapFailed', () => {
  it('is true when only the cloud bootstrap reads failed', () => {
    expect(onlyCloudBootstrapFailed([failure('firestore:userMeta')])).toBe(true);
    expect(onlyCloudBootstrapFailed([failure('firestore:allProjects')])).toBe(true);
    expect(onlyCloudBootstrapFailed([failure('firestore:loadSequence')])).toBe(true);
    expect(onlyCloudBootstrapFailed([failure('firestore:userMeta'), failure('firestore:loadSequence')])).toBe(true);
  });

  it('is false when a cloud CONTENT read failed (that is genuinely partial data)', () => {
    expect(onlyCloudBootstrapFailed([failure('firestore:workspace')])).toBe(false);
    expect(onlyCloudBootstrapFailed([failure('firestore:tasks')])).toBe(false);
    expect(onlyCloudBootstrapFailed([failure('firestore:project')])).toBe(false);
  });

  it('is false when a LOCAL read failed, even alongside a cloud failure', () => {
    // The local copy we fell back to is itself damaged - not safe to edit.
    expect(onlyCloudBootstrapFailed([failure('firestore:userMeta'), failure('localStorage:workspace')])).toBe(false);
    expect(onlyCloudBootstrapFailed([failure('firestore:userMeta'), failure('localStorage:meta')])).toBe(false);
  });

  it('ignores benign failures when deciding', () => {
    expect(onlyCloudBootstrapFailed([failure('firestore:userMeta'), failure('localStorage:device')])).toBe(true);
  });

  it('is false when nothing blocking failed at all', () => {
    expect(onlyCloudBootstrapFailed([])).toBe(false);
    expect(onlyCloudBootstrapFailed([failure('localStorage:device')])).toBe(false);
  });
});

describe('classifyLoadOutcome - local-only', () => {
  it('cloud unreachable + complete local copy = LOADED_LOCAL_ONLY, not read-only', () => {
    // The correction: a plain offline reload used to switch the whole app to
    // read-only. The local copy is whole, so editing it is safe.
    expect(classifyLoadOutcome({ projectCount: 3, readFailures: [failure('firestore:userMeta')] }))
      .toBe(LOAD_OUTCOME.LOADED_LOCAL_ONLY);
  });

  it('cloud CONTENT read failed = still LOADED_PARTIAL (read-only)', () => {
    // Here a piece really is missing, so saving could erase it.
    expect(classifyLoadOutcome({ projectCount: 1, readFailures: [failure('firestore:workspace')] }))
      .toBe(LOAD_OUTCOME.LOADED_PARTIAL);
  });

  it('cloud unreachable AND local copy damaged = LOADED_PARTIAL (read-only)', () => {
    expect(classifyLoadOutcome({
      projectCount: 2,
      readFailures: [failure('firestore:userMeta'), failure('localStorage:workspace')],
    })).toBe(LOAD_OUTCOME.LOADED_PARTIAL);
  });

  it('cloud unreachable with NO local data is still INDETERMINATE', () => {
    // Nothing to fall back to - we cannot tell "no data" from "unreadable".
    expect(classifyLoadOutcome({ projectCount: 0, readFailures: [failure('firestore:userMeta')] }))
      .toBe(LOAD_OUTCOME.INDETERMINATE);
  });

  it('local-only permits local saving but NOT cloud uploads', () => {
    const o = LOAD_OUTCOME.LOADED_LOCAL_ONLY;
    expect(mayPersist(o)).toBe(true);        // edits are kept on this device
    expect(mayUploadToCloud(o)).toBe(false); // but never pushed blind
    expect(shouldBlockEditing(o)).toBe(false);
    expect(mayCreateDefaultProject(o)).toBe(false);
  });

  it('tells the user their work is local and to sync before switching device', () => {
    const msg = describeLoadOutcome(LOAD_OUTCOME.LOADED_LOCAL_ONLY, [failure('firestore:userMeta')]);
    expect(msg.tone).toBe('offline');
    expect(msg.title).toContain('Working offline');
    expect(msg.detail).toContain('NOT reached the cloud');
    expect(msg.action).toContain('backup');
    expect(msg.action).toContain('another device');
  });
});

describe('mayUploadToCloud', () => {
  it('allows uploads only after a healthy load', () => {
    expect(mayUploadToCloud(LOAD_OUTCOME.LOADED_COMPLETE)).toBe(true);
    expect(mayUploadToCloud(LOAD_OUTCOME.EMPTY_CONFIRMED)).toBe(true);
  });

  it('refuses uploads in every degraded state', () => {
    expect(mayUploadToCloud(LOAD_OUTCOME.LOADED_LOCAL_ONLY)).toBe(false);
    expect(mayUploadToCloud(LOAD_OUTCOME.LOADED_PARTIAL)).toBe(false);
    expect(mayUploadToCloud(LOAD_OUTCOME.INDETERMINATE)).toBe(false);
    expect(mayUploadToCloud(undefined)).toBe(false);
  });

  it('is never more permissive than mayPersist', () => {
    for (const o of Object.values(LOAD_OUTCOME)) {
      if (mayUploadToCloud(o)) expect(mayPersist(o)).toBe(true);
    }
  });
});

describe('mayPersist', () => {
  it('allows writing after a complete load or a confirmed-empty first run', () => {
    expect(mayPersist(LOAD_OUTCOME.LOADED_COMPLETE)).toBe(true);
    expect(mayPersist(LOAD_OUTCOME.EMPTY_CONFIRMED)).toBe(true);
  });

  it('blocks writing after an indeterminate read', () => {
    expect(mayPersist(LOAD_OUTCOME.INDETERMINATE)).toBe(false);
  });

  it('blocks writing after a PARTIAL load, because saving a subset deletes the rest', () => {
    expect(mayPersist(LOAD_OUTCOME.LOADED_PARTIAL)).toBe(false);
  });

  it('blocks on an unknown outcome', () => {
    expect(mayPersist('who-knows')).toBe(false);
    expect(mayPersist(undefined)).toBe(false);
    expect(mayPersist(null)).toBe(false);
  });
});

describe('shouldBlockEditing', () => {
  it('blocks the editor only when there is no trustworthy data to show', () => {
    expect(shouldBlockEditing(LOAD_OUTCOME.INDETERMINATE)).toBe(true);
  });

  it('lets a partial load stay visible (read-only) because the data is real', () => {
    expect(shouldBlockEditing(LOAD_OUTCOME.LOADED_PARTIAL)).toBe(false);
  });

  it('does not block a healthy load', () => {
    expect(shouldBlockEditing(LOAD_OUTCOME.LOADED_COMPLETE)).toBe(false);
    expect(shouldBlockEditing(LOAD_OUTCOME.EMPTY_CONFIRMED)).toBe(false);
  });
});

// =============================================================================
// summarizeReadFailures
// =============================================================================

describe('summarizeReadFailures', () => {
  it('counts repeated failures from the same source', () => {
    const list = [failure('firestore:workspace'), failure('firestore:workspace'), failure('firestore:tasks')];
    expect(summarizeReadFailures(list)).toEqual([
      { source: 'firestore:tasks', count: 1, severity: READ_SEVERITY.CRITICAL },
      { source: 'firestore:workspace', count: 2, severity: READ_SEVERITY.CRITICAL },
    ]);
  });

  it('returns a stable alphabetical order', () => {
    const a = summarizeReadFailures([failure('firestore:tasks'), failure('localStorage:meta')]);
    const b = summarizeReadFailures([failure('localStorage:meta'), failure('firestore:tasks')]);
    expect(a).toEqual(b);
  });

  it('labels an entry with no source as unknown, and critical', () => {
    expect(summarizeReadFailures([{}])).toEqual([
      { source: 'unknown', count: 1, severity: READ_SEVERITY.CRITICAL },
    ]);
  });

  it('handles empty and missing input', () => {
    expect(summarizeReadFailures([])).toEqual([]);
    expect(summarizeReadFailures(undefined)).toEqual([]);
  });
});

// =============================================================================
// describeLoadOutcome - the message the owner actually sees
// =============================================================================

describe('describeLoadOutcome', () => {
  it('says nothing on a healthy load', () => {
    expect(describeLoadOutcome(LOAD_OUTCOME.LOADED_COMPLETE, [])).toBeNull();
    expect(describeLoadOutcome(LOAD_OUTCOME.EMPTY_CONFIRMED, [])).toBeNull();
  });

  it('explains an indeterminate read without claiming data was lost', () => {
    const msg = describeLoadOutcome(LOAD_OUTCOME.INDETERMINATE, [failure('firestore:userMeta')]);
    expect(msg.tone).toBe('error');
    expect(msg.title).toBe('Could not read your data');
    // Must state the two reassurances that matter: nothing shown, nothing created.
    expect(msg.detail).toContain('has not created a new one');
    expect(msg.action).toContain('Reload');
    // And it must name the failing read so a report back is actionable.
    expect(msg.detail).toContain('firestore:userMeta');
  });

  it('explains a partial load as read-only', () => {
    const msg = describeLoadOutcome(LOAD_OUTCOME.LOADED_PARTIAL, [failure('firestore:workspace')]);
    expect(msg.tone).toBe('warning');
    expect(msg.title).toContain('Read-only');
    expect(msg.action).toContain('Saving is switched off');
    expect(msg.detail).toContain('firestore:workspace');
  });

  it('does not list benign sources in the message', () => {
    const msg = describeLoadOutcome(LOAD_OUTCOME.INDETERMINATE, [
      failure('localStorage:meta'),
      failure('localStorage:device'),
    ]);
    expect(msg.detail).toContain('localStorage:meta');
    expect(msg.detail).not.toContain('localStorage:device');
  });

  it('still produces a message when the failure list is empty', () => {
    // Reachable via `threw: true` with no recorded read failure.
    const msg = describeLoadOutcome(LOAD_OUTCOME.INDETERMINATE, []);
    expect(msg).not.toBeNull();
    expect(msg.detail).not.toContain('failed while reading');
  });
});

// =============================================================================
// End-to-end scenarios - the real situations from the bug report
// =============================================================================

describe('Bug 42 scenarios', () => {
  it('offline boot with real cloud data: read-only, no defaults, no writes', () => {
    // loadUserMeta throws -> init skips the whole Firestore phase -> localStorage
    // is also empty on this device. Before the fix this produced the demo project
    // and uploaded it over everything.
    const outcome = classifyLoadOutcome({ projectCount: 0, readFailures: [failure('firestore:userMeta')] });
    expect(outcome).toBe(LOAD_OUTCOME.INDETERMINATE);
    expect(mayCreateDefaultProject(outcome)).toBe(false);
    expect(mayPersist(outcome)).toBe(false);
    expect(shouldBlockEditing(outcome)).toBe(true);
  });

  it('one workspace of five fails to read: shows four, refuses to save', () => {
    // Saving here would upload a project whose workspaceIds lost an entry,
    // deleting the fifth canvas on the server.
    const outcome = classifyLoadOutcome({ projectCount: 1, readFailures: [failure('firestore:workspace')] });
    expect(outcome).toBe(LOAD_OUTCOME.LOADED_PARTIAL);
    expect(mayPersist(outcome)).toBe(false);
    expect(shouldBlockEditing(outcome)).toBe(false); // the four real canvases stay visible
  });

  it('genuine first run on a new device: default project is allowed', () => {
    // The behaviour that must NOT regress: a real new user still gets a project.
    const outcome = classifyLoadOutcome({ projectCount: 0, readFailures: [] });
    expect(outcome).toBe(LOAD_OUTCOME.EMPTY_CONFIRMED);
    expect(mayCreateDefaultProject(outcome)).toBe(true);
    expect(mayPersist(outcome)).toBe(true);
  });

  it('corrupt cm-sync-state: data loads but writing is blocked', () => {
    // Without the dirty flags, transactionalWrite cannot detect a conflict, so
    // an upload would silently overwrite a newer cloud copy.
    const outcome = classifyLoadOutcome({ projectCount: 2, readFailures: [failure('localStorage:syncState')] });
    expect(outcome).toBe(LOAD_OUTCOME.LOADED_PARTIAL);
    expect(mayPersist(outcome)).toBe(false);
  });

  it('a quota exception thrown mid-init never yields a default project', () => {
    // saveProjectMeta / saveWorkspaceToLocal are not try-wrapped, so a full disk
    // throws straight into init()'s catch-all, which used to build the default.
    const outcome = classifyLoadOutcome({ projectCount: 2, readFailures: [], threw: true });
    expect(outcome).toBe(LOAD_OUTCOME.INDETERMINATE);
    expect(mayCreateDefaultProject(outcome)).toBe(false);
    expect(mayPersist(outcome)).toBe(false);
  });

  it('healthy normal boot is entirely unaffected', () => {
    const outcome = classifyLoadOutcome({ projectCount: 4, readFailures: [] });
    expect(outcome).toBe(LOAD_OUTCOME.LOADED_COMPLETE);
    expect(mayPersist(outcome)).toBe(true);
    expect(shouldBlockEditing(outcome)).toBe(false);
    expect(describeLoadOutcome(outcome, [])).toBeNull();
  });
});
