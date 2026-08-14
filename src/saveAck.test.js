import { describe, it, expect, vi } from 'vitest';
import { nextDirtySeq, shouldClearDirty, createWriteCoalescer } from './saveAck';

/** A deferred promise, so tests control exactly when a "write" completes. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// =============================================================================
// nextDirtySeq
// =============================================================================

describe('nextDirtySeq', () => {
  it('starts at 1 for a document that has never been dirty', () => {
    expect(nextDirtySeq(undefined)).toBe(1);
    expect(nextDirtySeq(null)).toBe(1);
  });

  it('increments monotonically', () => {
    expect(nextDirtySeq(1)).toBe(2);
    expect(nextDirtySeq(41)).toBe(42);
  });

  it('recovers from a corrupt or negative stored value', () => {
    expect(nextDirtySeq(-5)).toBe(1);
    expect(nextDirtySeq('nonsense')).toBe(1);
    expect(nextDirtySeq({})).toBe(1);
  });

  it('never returns the value it was given', () => {
    for (const v of [0, 1, 7, 999, undefined, -1, 'x']) {
      expect(nextDirtySeq(v)).not.toBe(v);
    }
  });
});

// =============================================================================
// shouldClearDirty - the Bug 43 decision
// =============================================================================

describe('shouldClearDirty', () => {
  it('clears when nothing changed while the upload was in flight', () => {
    expect(shouldClearDirty({ confirmedSeq: 4, currentSeq: 4 })).toBe(true);
  });

  it('REFUSES to clear when the user edited during the upload', () => {
    // The core of Bug 43: acknowledging edit A must not mark edit B as saved.
    expect(shouldClearDirty({ confirmedSeq: 4, currentSeq: 5 })).toBe(false);
  });

  it('refuses to clear after several edits during one upload', () => {
    expect(shouldClearDirty({ confirmedSeq: 1, currentSeq: 9 })).toBe(false);
  });

  it('clears for legacy sync-state entries that carry no counter', () => {
    // Written before this fix. Treated as "no newer edit known" so old documents
    // are not pinned permanently dirty; self-heals on the next markDirty.
    expect(shouldClearDirty({ confirmedSeq: undefined, currentSeq: undefined })).toBe(true);
    expect(shouldClearDirty({ confirmedSeq: 3, currentSeq: undefined })).toBe(true);
    expect(shouldClearDirty({ confirmedSeq: undefined, currentSeq: 3 })).toBe(true);
  });

  it('tolerates being called with nothing', () => {
    expect(shouldClearDirty()).toBe(true);
    expect(shouldClearDirty({})).toBe(true);
  });

  it('a lower current counter still counts as unchanged only when equal', () => {
    // Counters never go backwards in practice; if one does, prefer keeping the
    // document dirty over silently dropping edits.
    expect(shouldClearDirty({ confirmedSeq: 5, currentSeq: 4 })).toBe(false);
  });
});

// =============================================================================
// createWriteCoalescer - the Bug 30 decision
// =============================================================================

describe('createWriteCoalescer', () => {
  it('runs an idle key immediately and returns its result', async () => {
    const c = createWriteCoalescer();
    await expect(c.run('doc', async () => true)).resolves.toBe(true);
    await expect(c.run('doc', async () => false)).resolves.toBe(false);
  });

  it('never reports success for a write that has not run yet', async () => {
    // THE Bug 30 regression test. The old code returned `true` here immediately.
    const c = createWriteCoalescer();
    const first = deferred();
    const p1 = c.run('doc', () => first.promise);

    let secondRan = false;
    const p2 = c.run('doc', async () => { secondRan = true; return false; });

    // p2 must NOT have resolved while its write has not run.
    let p2Settled = false;
    p2.then(() => { p2Settled = true; });
    await Promise.resolve();
    expect(secondRan).toBe(false);
    expect(p2Settled).toBe(false);

    first.resolve(true);
    await expect(p1).resolves.toBe(true);
    // Now the queued write runs, and p2 reports ITS real result.
    await expect(p2).resolves.toBe(false);
    expect(secondRan).toBe(true);
  });

  it('serialises writes to the same key - never concurrent', async () => {
    const c = createWriteCoalescer();
    let concurrent = 0;
    let maxConcurrent = 0;
    const write = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 5));
      concurrent--;
      return true;
    };
    await Promise.all([c.run('doc', write), c.run('doc', write), c.run('doc', write)]);
    expect(maxConcurrent).toBe(1);
  });

  it('runs different keys in parallel', async () => {
    const c = createWriteCoalescer();
    const a = deferred();
    const b = deferred();
    let aRan = false, bRan = false;
    const pa = c.run('docA', () => { aRan = true; return a.promise; });
    const pb = c.run('docB', () => { bRan = true; return b.promise; });
    expect(aRan).toBe(true);
    expect(bRan).toBe(true); // not blocked by docA
    a.resolve(true); b.resolve(true);
    await Promise.all([pa, pb]);
  });

  it('supersedes a pending write - last one wins, and only it runs', async () => {
    const c = createWriteCoalescer();
    const first = deferred();
    const p1 = c.run('doc', () => first.promise);

    const ran = [];
    const p2 = c.run('doc', async () => { ran.push('second'); return true; });
    const p3 = c.run('doc', async () => { ran.push('third'); return true; });

    first.resolve(true);
    await Promise.all([p1, p2, p3]);

    // The middle write is redundant: these are whole-document writes, so the
    // third contains everything the second would have written.
    expect(ran).toEqual(['third']);
  });

  it('gives every waiter on a superseded write the real result of the run', async () => {
    const c = createWriteCoalescer();
    const first = deferred();
    const p1 = c.run('doc', () => first.promise);
    const p2 = c.run('doc', async () => true);
    const p3 = c.run('doc', async () => false); // supersedes; this one fails

    first.resolve(true);
    await expect(p1).resolves.toBe(true);
    // Both waiters learn the truth: the write that happened returned false.
    await expect(p2).resolves.toBe(false);
    await expect(p3).resolves.toBe(false);
  });

  it('converts a thrown error into false rather than a rejection', async () => {
    const c = createWriteCoalescer();
    await expect(c.run('doc', async () => { throw new Error('network died'); })).resolves.toBe(false);
  });

  it('reports an escaped error so it can reach the retry queue', async () => {
    const c = createWriteCoalescer();
    const onError = vi.fn();
    await c.run('doc', async () => { throw new Error('boom'); }, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('boom');
  });

  it('reports an escaped error from a QUEUED write too', async () => {
    // The old code swallowed queued failures with a fire-and-forget catch.
    const c = createWriteCoalescer();
    const onError = vi.fn();
    const first = deferred();
    const p1 = c.run('doc', () => first.promise, onError);
    const p2 = c.run('doc', async () => { throw new Error('queued boom'); }, onError);
    first.resolve(true);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('queued boom');
  });

  it('a failing write does not wedge the key for later writes', async () => {
    const c = createWriteCoalescer();
    await c.run('doc', async () => { throw new Error('x'); });
    await expect(c.run('doc', async () => true)).resolves.toBe(true);
    expect(c.isBusy('doc')).toBe(false);
  });

  it('an error inside the error reporter cannot break the write', async () => {
    const c = createWriteCoalescer();
    const bad = () => { throw new Error('reporter is broken'); };
    await expect(c.run('doc', async () => { throw new Error('write failed'); }, bad)).resolves.toBe(false);
  });

  it('does not leak slots for keys that are finished', async () => {
    const c = createWriteCoalescer();
    for (let i = 0; i < 50; i++) {
      await c.run('doc-' + i, async () => true);
    }
    expect(c.trackedKeys()).toBe(0);
  });

  it('keeps tracking a key while a write is still in flight', async () => {
    const c = createWriteCoalescer();
    const d = deferred();
    const p = c.run('doc', () => d.promise);
    expect(c.isBusy('doc')).toBe(true);
    c.run('doc', async () => true);
    expect(c.hasPending('doc')).toBe(true);
    d.resolve(true);
    await p;
  });

  it('handles a long chain of writes arriving during each other', async () => {
    const c = createWriteCoalescer();
    const order = [];
    const d1 = deferred();
    const p1 = c.run('doc', () => { order.push('start1'); return d1.promise; });
    const p2 = c.run('doc', async () => { order.push('run2'); return true; });
    d1.resolve(true);
    await Promise.all([p1, p2]);
    const p3 = c.run('doc', async () => { order.push('run3'); return true; });
    await p3;
    expect(order).toEqual(['start1', 'run2', 'run3']);
  });
});

// =============================================================================
// The two bugs, end to end
// =============================================================================

describe('Bug 30 and 43 scenarios', () => {
  it('Bug 30: a queued write that fails is reported as a failure, not "saved"', async () => {
    const c = createWriteCoalescer();
    const inFlight = deferred();
    const statuses = [];
    const report = (ok) => statuses.push(ok ? 'synced' : 'error');

    const p1 = c.run('ws', () => inFlight.promise).then(report);
    const p2 = c.run('ws', async () => false).then(report); // the upload fails

    inFlight.resolve(true);
    await Promise.all([p1, p2]);

    // Before the fix the second call resolved `true` instantly and the UI said
    // "synced" for a write that had not run and then failed.
    expect(statuses).toEqual(['synced', 'error']);
  });

  it('Bug 43: an ack for edit A does not mark edit B as saved', () => {
    // Upload of A reads the data at seq 4.
    const confirmedSeq = 4;
    // The user makes edit B while A is uploading.
    const currentSeq = nextDirtySeq(confirmedSeq); // 5
    expect(shouldClearDirty({ confirmedSeq, currentSeq })).toBe(false);
    // After B is uploaded with its own captured seq, it may clear.
    expect(shouldClearDirty({ confirmedSeq: currentSeq, currentSeq })).toBe(true);
  });

  it('Bug 43: a quiet document still clears normally', () => {
    // The behaviour that must NOT regress: no edit during the upload -> clean.
    expect(shouldClearDirty({ confirmedSeq: 7, currentSeq: 7 })).toBe(true);
  });
});
