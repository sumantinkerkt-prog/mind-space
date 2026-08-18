import { describe, it, expect } from 'vitest';
import {
  MAX_RETRY_COUNT,
  MAX_BACKOFF_MS,
  MAX_QUEUE_ENTRIES,
  retryKey,
  backoffMs,
  normaliseEntry,
  normaliseQueue,
  mergeQueueEntry,
  planRetry,
  applyRetryOutcome,
  removeQueueEntry,
} from './retryQueue.js';

const NOW = 1_700_000_000_000;
const ws = (over = {}) => ({ type: 'workspace', projectId: 'p1', workspaceId: 'w1', ...over });
const meta = (over = {}) => ({ type: 'project', projectId: 'p1', ...over });

describe('retryKey', () => {
  it('identifies the document, not the attempt', () => {
    expect(retryKey(ws())).toBe('workspace:p1:w1');
    expect(retryKey(meta())).toBe('project:p1:-');
    expect(retryKey({ type: 'tasks', projectId: 'p1' })).toBe('tasks:p1:-');
  });

  it('separates the same workspace id in different projects', () => {
    expect(retryKey(ws({ projectId: 'p2' }))).not.toBe(retryKey(ws()));
  });

  it('returns an empty key for unusable input', () => {
    expect(retryKey(null)).toBe('');
    expect(retryKey({ type: 'workspace' })).toBe('');
    expect(retryKey({ projectId: 'p1' })).toBe('');
  });
});

describe('backoffMs', () => {
  it('doubles per attempt', () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(4)).toBe(16000);
  });

  it('is capped', () => {
    expect(backoffMs(5)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(99)).toBe(MAX_BACKOFF_MS);
  });

  it('treats rubbish as the first attempt', () => {
    expect(backoffMs(undefined)).toBe(1000);
    expect(backoffMs(-3)).toBe(1000);
    expect(backoffMs('2')).toBe(1000);
  });
});

describe('normaliseEntry', () => {
  it('drops the frozen payload carried by pre-Fix-5b entries', () => {
    const legacy = { id: 'x', type: 'workspace', projectId: 'p1', workspaceId: 'w1', data: { nodes: [{ id: 1 }] }, timestamp: NOW - 5000, retryCount: 2 };
    const e = normaliseEntry(legacy, NOW);
    expect(e.data).toBeUndefined();
    expect(e).toMatchObject({ key: 'workspace:p1:w1', type: 'workspace', projectId: 'p1', workspaceId: 'w1', retryCount: 2 });
  });

  it('maps a legacy timestamp onto both time fields', () => {
    const e = normaliseEntry({ type: 'tasks', projectId: 'p1', timestamp: NOW - 9000 }, NOW);
    expect(e.firstFailedAt).toBe(NOW - 9000);
    expect(e.lastAttemptAt).toBe(NOW - 9000);
  });

  it('defaults missing times to now', () => {
    const e = normaliseEntry(meta(), NOW);
    expect(e.firstFailedAt).toBe(NOW);
    expect(e.lastAttemptAt).toBe(NOW);
    expect(e.retryCount).toBe(0);
  });

  it('rejects unknown write kinds', () => {
    expect(normaliseEntry({ type: 'snapshot', projectId: 'p1' }, NOW)).toBeNull();
    expect(normaliseEntry({ type: 'userMeta', projectId: 'p1' }, NOW)).toBeNull();
  });

  it('rejects entries with nothing to identify them', () => {
    expect(normaliseEntry(null, NOW)).toBeNull();
    expect(normaliseEntry('nonsense', NOW)).toBeNull();
    expect(normaliseEntry({ type: 'project' }, NOW)).toBeNull();
    expect(normaliseEntry({ type: 'workspace', projectId: 'p1' }, NOW)).toBeNull();
  });

  it('does not keep a workspace id on a project or tasks entry', () => {
    expect(normaliseEntry({ type: 'project', projectId: 'p1', workspaceId: 'w1' }, NOW).workspaceId).toBeNull();
    expect(normaliseEntry({ type: 'tasks', projectId: 'p1', workspaceId: 'w1' }, NOW).workspaceId).toBeNull();
  });

  it('clamps a negative or non-numeric retry count', () => {
    expect(normaliseEntry(meta({ retryCount: -4 }), NOW).retryCount).toBe(0);
    expect(normaliseEntry(meta({ retryCount: 'lots' }), NOW).retryCount).toBe(0);
  });
});

describe('normaliseQueue', () => {
  it('collapses the owner\'s reported queue to one entry per document', () => {
    // Nine records, five documents - exactly the shape of the reported Line C output.
    const raw = [
      { type: 'project', projectId: 'p1', timestamp: NOW - 60000, retryCount: 0 },
      { type: 'workspace', projectId: 'p1', workspaceId: 'w1', timestamp: NOW - 60000, retryCount: 0 },
      { type: 'workspace', projectId: 'p1', workspaceId: 'w2', timestamp: NOW - 60000, retryCount: 0 },
      { type: 'workspace', projectId: 'p1', workspaceId: 'w3', timestamp: NOW - 60000, retryCount: 0 },
      { type: 'workspace', projectId: 'p1', workspaceId: 'w4', timestamp: NOW - 60000, retryCount: 0 },
      { type: 'project', projectId: 'p1', timestamp: NOW - 40000, retryCount: 0 },
      { type: 'project', projectId: 'p1', timestamp: NOW - 30000, retryCount: 0 },
      { type: 'project', projectId: 'p1', timestamp: NOW - 20000, retryCount: 0 },
      { type: 'project', projectId: 'p1', timestamp: NOW - 10000, retryCount: 0 },
    ];
    const q = normaliseQueue(raw, NOW);
    expect(q).toHaveLength(5);
    expect(q.filter(e => e.type === 'project')).toHaveLength(1);
  });

  it('keeps the earliest first failure and the latest attempt when merging', () => {
    const q = normaliseQueue([
      { type: 'project', projectId: 'p1', firstFailedAt: NOW - 9000, lastAttemptAt: NOW - 9000, retryCount: 3 },
      { type: 'project', projectId: 'p1', firstFailedAt: NOW - 2000, lastAttemptAt: NOW - 1000, retryCount: 1 },
    ], NOW);
    expect(q).toHaveLength(1);
    expect(q[0].firstFailedAt).toBe(NOW - 9000);
    expect(q[0].lastAttemptAt).toBe(NOW - 1000);
    expect(q[0].retryCount).toBe(1); // generous: retries send current content
  });

  it('discards unusable records instead of throwing', () => {
    const q = normaliseQueue([null, 'x', { type: 'nope', projectId: 'p1' }, meta()], NOW);
    expect(q).toHaveLength(1);
  });

  it('returns an empty queue for anything that is not a list', () => {
    expect(normaliseQueue(null, NOW)).toEqual([]);
    expect(normaliseQueue({}, NOW)).toEqual([]);
    expect(normaliseQueue('[]', NOW)).toEqual([]);
  });
});

describe('mergeQueueEntry', () => {
  it('adds a new document', () => {
    const q = mergeQueueEntry([], ws(), NOW);
    expect(q).toHaveLength(1);
    expect(q[0].key).toBe('workspace:p1:w1');
  });

  it('never grows for repeated failures of the same document', () => {
    let q = [];
    for (let i = 0; i < 20; i++) q = mergeQueueEntry(q, meta(), NOW + i * 1000);
    expect(q).toHaveLength(1);
  });

  it('does not restart the attempt count of an existing entry', () => {
    let q = mergeQueueEntry([], meta(), NOW);
    q = applyRetryOutcome(q, 'project:p1:-', { ok: false, now: NOW + 1000 });
    q = applyRetryOutcome(q, 'project:p1:-', { ok: false, now: NOW + 3000 });
    expect(q[0].retryCount).toBe(2);
    q = mergeQueueEntry(q, meta(), NOW + 4000);
    expect(q[0].retryCount).toBe(2);
    expect(q[0].lastAttemptAt).toBe(NOW + 4000);
  });

  it('keeps separate entries for different documents', () => {
    let q = mergeQueueEntry([], ws(), NOW);
    q = mergeQueueEntry(q, ws({ workspaceId: 'w2' }), NOW);
    q = mergeQueueEntry(q, meta(), NOW);
    q = mergeQueueEntry(q, { type: 'tasks', projectId: 'p1' }, NOW);
    expect(q).toHaveLength(4);
  });

  it('ignores an unusable descriptor without disturbing the queue', () => {
    const before = mergeQueueEntry([], ws(), NOW);
    const after = mergeQueueEntry(before, { type: 'workspace', projectId: 'p1' }, NOW);
    expect(after).toEqual(before);
  });

  it('does not mutate its input', () => {
    const before = mergeQueueEntry([], ws(), NOW);
    const copy = JSON.parse(JSON.stringify(before));
    mergeQueueEntry(before, meta(), NOW);
    expect(before).toEqual(copy);
  });

  it('respects the sanity cap by dropping the oldest', () => {
    let q = [];
    for (let i = 0; i < MAX_QUEUE_ENTRIES + 5; i++) {
      q = mergeQueueEntry(q, ws({ workspaceId: 'w' + i }), NOW + i);
    }
    expect(q).toHaveLength(MAX_QUEUE_ENTRIES);
    expect(q[0].key).toBe('workspace:p1:w5');
  });
});

describe('planRetry', () => {
  const entry = (over = {}) => normaliseEntry({ ...ws(), lastAttemptAt: NOW - 60000, ...over }, NOW);

  it('sends a dirty document whose backoff has elapsed', () => {
    expect(planRetry(entry(), { now: NOW, dirty: true, hasLocalCopy: true }))
      .toEqual({ action: 'send', reason: 'dirty-and-due' });
  });

  it('DROPS a document that is no longer dirty - this is the stale-overwrite fix', () => {
    expect(planRetry(entry(), { now: NOW, dirty: false, hasLocalCopy: true }))
      .toEqual({ action: 'drop', reason: 'already-saved' });
  });

  it('drops a document that no longer exists on this device', () => {
    expect(planRetry(entry(), { now: NOW, dirty: true, hasLocalCopy: false }))
      .toEqual({ action: 'drop', reason: 'no-local-copy' });
  });

  it('waits while the backoff is still running', () => {
    const e = entry({ lastAttemptAt: NOW - 500, retryCount: 0 });
    expect(planRetry(e, { now: NOW, dirty: true, hasLocalCopy: true }).action).toBe('wait');
  });

  it('sends the instant the backoff expires', () => {
    const e = entry({ lastAttemptAt: NOW - 1000, retryCount: 0 });
    expect(planRetry(e, { now: NOW, dirty: true, hasLocalCopy: true }).action).toBe('send');
  });

  it('honours the growing backoff', () => {
    const e = entry({ lastAttemptAt: NOW - 5000, retryCount: 3 }); // needs 8s
    expect(planRetry(e, { now: NOW, dirty: true, hasLocalCopy: true }).action).toBe('wait');
    expect(planRetry(e, { now: NOW + 4000, dirty: true, hasLocalCopy: true }).action).toBe('send');
  });

  it('gives up after the attempt limit', () => {
    const e = entry({ retryCount: MAX_RETRY_COUNT });
    expect(planRetry(e, { now: NOW, dirty: true, hasLocalCopy: true }))
      .toEqual({ action: 'drop', reason: 'attempts-exhausted' });
  });

  it('prefers "already saved" over "exhausted" so a saved document is never re-sent', () => {
    const e = entry({ retryCount: MAX_RETRY_COUNT });
    expect(planRetry(e, { now: NOW, dirty: false, hasLocalCopy: true }).reason).toBe('already-saved');
  });

  it('drops an unusable entry', () => {
    expect(planRetry(null, { now: NOW, dirty: true, hasLocalCopy: true }).action).toBe('drop');
  });

  it('treats a missing context as "do not send"', () => {
    expect(planRetry(entry(), undefined).action).toBe('drop');
  });
});

describe('applyRetryOutcome', () => {
  it('removes the entry on success', () => {
    const q = mergeQueueEntry([], ws(), NOW);
    expect(applyRetryOutcome(q, 'workspace:p1:w1', { ok: true, now: NOW })).toHaveLength(0);
  });

  it('counts one attempt per failure', () => {
    let q = mergeQueueEntry([], ws(), NOW);
    q = applyRetryOutcome(q, 'workspace:p1:w1', { ok: false, now: NOW + 1000 });
    expect(q[0].retryCount).toBe(1);
    expect(q[0].lastAttemptAt).toBe(NOW + 1000);
  });

  it('reaches the give-up point after exactly MAX_RETRY_COUNT failures', () => {
    let q = mergeQueueEntry([], ws(), NOW);
    for (let i = 0; i < MAX_RETRY_COUNT; i++) {
      q = applyRetryOutcome(q, 'workspace:p1:w1', { ok: false, now: NOW + i });
    }
    expect(planRetry(q[0], { now: NOW + 10 * MAX_BACKOFF_MS, dirty: true, hasLocalCopy: true }).reason)
      .toBe('attempts-exhausted');
  });

  it('ignores an unknown key, so a queue rewritten mid-pass is not corrupted', () => {
    const q = mergeQueueEntry([], ws(), NOW);
    expect(applyRetryOutcome(q, 'project:p1:-', { ok: true, now: NOW })).toEqual(q);
  });

  it('leaves other documents untouched', () => {
    let q = mergeQueueEntry(mergeQueueEntry([], ws(), NOW), meta(), NOW);
    q = applyRetryOutcome(q, 'workspace:p1:w1', { ok: true, now: NOW });
    expect(q.map(e => e.key)).toEqual(['project:p1:-']);
  });

  it('does not mutate its input', () => {
    const before = mergeQueueEntry([], ws(), NOW);
    const copy = JSON.parse(JSON.stringify(before));
    applyRetryOutcome(before, 'workspace:p1:w1', { ok: false, now: NOW + 5 });
    expect(before).toEqual(copy);
  });
});

describe('removeQueueEntry', () => {
  it('clears the entry for a document confirmed saved elsewhere', () => {
    const q = mergeQueueEntry(mergeQueueEntry([], ws(), NOW), meta(), NOW);
    expect(removeQueueEntry(q, 'project:p1:-').map(e => e.key)).toEqual(['workspace:p1:w1']);
  });

  it('is a no-op for a document that is not queued', () => {
    const q = mergeQueueEntry([], ws(), NOW);
    expect(removeQueueEntry(q, 'tasks:p1:-')).toEqual(q);
  });

  it('tolerates a missing queue', () => {
    expect(removeQueueEntry(null, 'x')).toEqual([]);
  });
});
