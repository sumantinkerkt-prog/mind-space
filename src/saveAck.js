// Honest save acknowledgement (Bug 30 + minimal Bug 43)
// =============================================================================
// Two lies the save path used to tell, and the mechanisms here that stop them.
//
// LIE 1 - "Saved" before the write ran (Bug 30).
//   guardedFirestoreSave serialises writes per document. When a write was
//   already in flight it stored the new one as "queued" and returned `true`
//   IMMEDIATELY - reporting success for a write that had not even started. The
//   caller then set the status to "synced". If that queued write later failed,
//   nobody found out: its result was swallowed by a fire-and-forget `.catch()`.
//   -> createWriteCoalescer() below returns a promise that resolves with the
//      REAL result of the run that supersedes yours.
//
// LIE 2 - A stale acknowledgement covering newer edits (Bug 43).
//   confirmSynced() cleared the dirty flag whenever a write succeeded. But a
//   write takes time, and the user keeps typing. Sequence of events:
//     1. edit A -> markDirty -> upload of A begins
//     2. edit B -> markDirty (local content is now B)
//     3. upload of A succeeds -> confirmSynced -> dirty cleared
//   Edit B is now marked as safely saved when it only exists on this device. It
//   would never be uploaded until some later edit happened to re-dirty the
//   document, and a "return check" could legitimately discard it.
//   -> shouldClearDirty() below clears dirty ONLY if local content has not moved
//      on since the data being acknowledged was read.
//
// WHY A SEQUENCE NUMBER AND NOT A CONTENT HASH
//   The obvious implementation is "clear dirty only if the confirmed content
//   hash still matches the current local hash". That cannot work here, and it
//   would fail silently in the worst direction. markDirty and the upload record
//   DIFFERENT SHAPES for the project metadata document:
//
//     markDirty(metaPath, { nextId, reminders, pinGroups })
//     upload payload   =  { ...allProjectMetadata, schemaVersion }
//
//   Those two can never hash the same, so a hash comparison would find the
//   metadata document permanently "modified": dirty would never clear, the
//   document would be re-uploaded forever, and the UI would permanently claim
//   unsaved changes. A monotonic counter bumped by markDirty is shape
//   independent, so it works for every document.
//
//   Trade-off, accepted deliberately: if the user edits and then undoes back to
//   identical content, the counter still moves, so we keep the document dirty
//   and upload once more than strictly necessary. That is the safe direction -
//   an unnecessary upload of correct data, never a skipped upload of new data.
// =============================================================================

/**
 * Next value for a document's dirty counter. Monotonic; never reused.
 * @param {number|undefined} prevSeq
 * @returns {number}
 */
export function nextDirtySeq(prevSeq) {
  return (typeof prevSeq === 'number' && prevSeq >= 0 ? prevSeq : 0) + 1;
}

/**
 * May the dirty flag be cleared for a document whose upload just succeeded?
 *
 * @param {object} input
 * @param {number|undefined} input.confirmedSeq The counter value read at the
 *        same moment as the data that was uploaded.
 * @param {number|undefined} input.currentSeq   The document's counter value now.
 * @returns {boolean} true when the acknowledgement still covers local content.
 */
export function shouldClearDirty({ confirmedSeq, currentSeq } = {}) {
  // Legacy sync-state entries (written before this fix) carry no counter. Treat
  // a missing counter as "no newer edit known" and clear, which preserves the
  // previous behaviour rather than pinning old documents permanently dirty.
  // Self-healing: the next markDirty writes a counter.
  if (typeof confirmedSeq !== 'number' || typeof currentSeq !== 'number') return true;
  return confirmedSeq === currentSeq;
}

/**
 * Serialises writes per key, one at a time, and tells the truth about results.
 *
 * Behaviour:
 *  - Idle key: the function runs immediately and you get its result.
 *  - Busy key: your function is held as the single pending write. A later caller
 *    SUPERSEDES it (last write wins), which is correct because every write here
 *    is a complete document - an older pending write is strictly redundant.
 *    Everyone waiting on that key resolves with the real result of the run that
 *    actually happened.
 *  - A thrown error resolves as `false` (never a rejection, so no caller needs
 *    its own catch) and is reported to onUnexpectedError so it can be routed to
 *    the retry queue.
 *
 * No Firestore, no localStorage, no timers: fully unit-testable.
 */
export function createWriteCoalescer() {
  /** @type {Map<string, {inFlight: boolean, pending: {fn: Function, promise: Promise, resolve: Function}|null}>} */
  const slots = new Map();

  async function run(key, fn, onUnexpectedError) {
    let slot = slots.get(key);
    if (!slot) {
      slot = { inFlight: false, pending: null };
      slots.set(key, slot);
    }

    if (slot.inFlight) {
      if (!slot.pending) {
        let resolve;
        const promise = new Promise((r) => { resolve = r; });
        slot.pending = { fn, promise, resolve };
      } else {
        // Supersede the pending write; its waiters still get a real answer,
        // because they are waiting on the shared pending promise.
        slot.pending.fn = fn;
      }
      return slot.pending.promise;
    }

    slot.inFlight = true;
    let result;
    try {
      result = await fn();
    } catch (err) {
      if (typeof onUnexpectedError === 'function') {
        try { onUnexpectedError(err); } catch { /* diagnostics must not throw */ }
      }
      result = false;
    } finally {
      slot.inFlight = false;
    }

    // Hand over to the pending write, if any. Starting it synchronously here
    // sets inFlight back to true before the cleanup check below.
    const pending = slot.pending;
    if (pending) {
      slot.pending = null;
      run(key, pending.fn, onUnexpectedError).then(pending.resolve, () => pending.resolve(false));
    }

    // Drop idle slots so a long session cannot grow this map without bound.
    if (!slot.inFlight && !slot.pending) slots.delete(key);

    return result;
  }

  return {
    run,
    /** Test/diagnostic helpers. */
    isBusy: (key) => !!(slots.get(key) && slots.get(key).inFlight),
    hasPending: (key) => !!(slots.get(key) && slots.get(key).pending),
    trackedKeys: () => slots.size,
  };
}
