import { describe, it, expect } from 'vitest';
import { LOAD_OUTCOME } from './loadOutcome.js';
import {
  SESSION_MODE,
  isEditableSession,
  sessionMayPersist,
  sessionMayUploadToCloud,
} from './writeGate.js';

const ALL_OUTCOMES = Object.values(LOAD_OUTCOME);

describe('isEditableSession', () => {
  it('is true only for an editor session', () => {
    expect(isEditableSession(SESSION_MODE.EDITOR)).toBe(true);
    expect(isEditableSession(SESSION_MODE.REFERENCE)).toBe(false);
    expect(isEditableSession(SESSION_MODE.SHARED)).toBe(false);
  });

  it('fails closed on an unknown, missing or malformed mode', () => {
    expect(isEditableSession(undefined)).toBe(false);
    expect(isEditableSession(null)).toBe(false);
    expect(isEditableSession('')).toBe(false);
    expect(isEditableSession('print')).toBe(false);
    expect(isEditableSession('Editor')).toBe(false); // case matters, deliberately
    expect(isEditableSession({ mode: 'editor' })).toBe(false);
  });
});

describe('sessionMayPersist', () => {
  it('allows local writes in an editor session with a trustworthy load', () => {
    expect(sessionMayPersist({ mode: 'editor', outcome: LOAD_OUTCOME.LOADED_COMPLETE })).toBe(true);
    expect(sessionMayPersist({ mode: 'editor', outcome: LOAD_OUTCOME.EMPTY_CONFIRMED })).toBe(true);
    // Option A: offline with a complete local copy may still save locally.
    expect(sessionMayPersist({ mode: 'editor', outcome: LOAD_OUTCOME.LOADED_LOCAL_ONLY })).toBe(true);
  });

  it('refuses local writes in an editor session after an untrustworthy load', () => {
    expect(sessionMayPersist({ mode: 'editor', outcome: LOAD_OUTCOME.LOADED_PARTIAL })).toBe(false);
    expect(sessionMayPersist({ mode: 'editor', outcome: LOAD_OUTCOME.INDETERMINATE })).toBe(false);
  });

  it('refuses local writes in a reference session for EVERY load outcome', () => {
    for (const outcome of ALL_OUTCOMES) {
      expect(sessionMayPersist({ mode: 'reference', outcome })).toBe(false);
    }
  });

  it('refuses local writes in a shared session for EVERY load outcome', () => {
    for (const outcome of ALL_OUTCOMES) {
      expect(sessionMayPersist({ mode: 'shared', outcome })).toBe(false);
    }
  });

  it('fails closed with no argument, an empty object, or an unknown mode', () => {
    expect(sessionMayPersist()).toBe(false);
    expect(sessionMayPersist({})).toBe(false);
    expect(sessionMayPersist({ mode: 'embed', outcome: LOAD_OUTCOME.LOADED_COMPLETE })).toBe(false);
    expect(sessionMayPersist({ outcome: LOAD_OUTCOME.LOADED_COMPLETE })).toBe(false);
  });

  it('fails closed with an unknown load outcome, even in an editor session', () => {
    expect(sessionMayPersist({ mode: 'editor', outcome: 'something-new' })).toBe(false);
    expect(sessionMayPersist({ mode: 'editor', outcome: undefined })).toBe(false);
  });
});

describe('sessionMayUploadToCloud', () => {
  it('allows uploads only in an editor session that really read the cloud', () => {
    expect(sessionMayUploadToCloud({ mode: 'editor', outcome: LOAD_OUTCOME.LOADED_COMPLETE })).toBe(true);
    expect(sessionMayUploadToCloud({ mode: 'editor', outcome: LOAD_OUTCOME.EMPTY_CONFIRMED })).toBe(true);
  });

  it('refuses uploads in local-only mode - never upload blind', () => {
    expect(sessionMayUploadToCloud({ mode: 'editor', outcome: LOAD_OUTCOME.LOADED_LOCAL_ONLY })).toBe(false);
  });

  it('refuses uploads in a reference session for EVERY load outcome', () => {
    for (const outcome of ALL_OUTCOMES) {
      expect(sessionMayUploadToCloud({ mode: 'reference', outcome })).toBe(false);
    }
  });

  it('is never more permissive than sessionMayPersist, for any combination', () => {
    for (const mode of [...Object.values(SESSION_MODE), 'unknown', undefined]) {
      for (const outcome of [...ALL_OUTCOMES, 'unknown', undefined]) {
        const local = sessionMayPersist({ mode, outcome });
        const cloud = sessionMayUploadToCloud({ mode, outcome });
        if (cloud) expect(local).toBe(true);
      }
    }
  });

  it('fails closed with no argument', () => {
    expect(sessionMayUploadToCloud()).toBe(false);
    expect(sessionMayUploadToCloud({})).toBe(false);
  });
});

describe('the whole truth table, written out', () => {
  // Deliberately explicit: this is the table a future reader should check
  // against, rather than re-deriving it from two composed predicates.
  const table = [
    // mode        outcome                            local  cloud
    ['editor',    LOAD_OUTCOME.LOADED_COMPLETE,       true,  true],
    ['editor',    LOAD_OUTCOME.EMPTY_CONFIRMED,       true,  true],
    ['editor',    LOAD_OUTCOME.LOADED_LOCAL_ONLY,     true,  false],
    ['editor',    LOAD_OUTCOME.LOADED_PARTIAL,        false, false],
    ['editor',    LOAD_OUTCOME.INDETERMINATE,         false, false],
    ['reference', LOAD_OUTCOME.LOADED_COMPLETE,       false, false],
    ['reference', LOAD_OUTCOME.EMPTY_CONFIRMED,       false, false],
    ['reference', LOAD_OUTCOME.LOADED_LOCAL_ONLY,     false, false],
    ['reference', LOAD_OUTCOME.LOADED_PARTIAL,        false, false],
    ['reference', LOAD_OUTCOME.INDETERMINATE,         false, false],
    ['shared',    LOAD_OUTCOME.LOADED_COMPLETE,       false, false],
  ];

  it.each(table)('%s + %s -> local %s, cloud %s', (mode, outcome, local, cloud) => {
    expect(sessionMayPersist({ mode, outcome })).toBe(local);
    expect(sessionMayUploadToCloud({ mode, outcome })).toBe(cloud);
  });
});
