// =============================================================================
// Retry-queue policy (Fix 5b)
// =============================================================================
// Pure decision logic for the queue of cloud writes that failed and must be
// tried again. No localStorage, no Firestore, no timers - so every rule below
// is unit-tested.
//
// WHAT WAS WRONG WITH THE OLD QUEUE
//
// 1. IT CARRIED A FROZEN COPY OF THE DOCUMENT.
//    Each entry stored `data` as it looked at the moment the write failed. The
//    queue drained on the NEXT PAGE LOAD, which could be minutes or days later,
//    and wrote that frozen copy to the cloud. If the same document had been
//    saved successfully in between, the document was no longer marked dirty -
//    and `transactionalWrite`'s "don't overwrite newer cloud data" check only
//    applies to DIRTY documents. So a frozen copy could silently overwrite
//    newer content in the cloud and then be recorded as the new baseline.
//    -> Entries here carry NO content. A retry re-reads the CURRENT local copy.
//
// 2. IT NEVER COLLAPSED DUPLICATES.
//    Every failed attempt on the same document appended another entry. The
//    owner's Fix 5 test run produced 9 entries for 5 documents in one minute,
//    and 17 in an earlier round. Since every write here is a COMPLETE document,
//    all but the newest attempt are redundant by definition.
//    -> One entry per document, identified by `retryKey`.
//
// 3. NOTHING DRAINED IT DURING A SESSION.
//    It was processed on page load and on the browser's `online` event, and
//    nowhere else. A failed upload therefore waited for a reload, and the
//    "waiting to retry" count could not fall to zero while the app was open
//    even after uploads started working again (test C3).
//    -> `planRetry` drops entries whose document is no longer dirty, and the
//       caller drains on the existing 20-second heartbeat as well.
//
// THE RULE THAT MAKES THIS SAFE
//
//   A retry happens ONLY for a document that is still marked dirty.
//
// "Dirty" means "this device holds content the cloud has not confirmed". Two
// consequences, both load-bearing:
//   - Not dirty => nothing of ours is missing from the cloud => there is nothing
//     to retry, so the entry is dropped rather than sent. That is what stops the
//     stale overwrite in (1).
//   - Dirty => `transactionalWrite` performs its revision check, so a retry can
//     never clobber a newer cloud revision; it routes to the conflict flow.
// This depends on a failed write MARKING THE DOCUMENT DIRTY (see
// `noteWriteFailed` in persistenceService.js). Before Fix 5b, several project
// metadata writes could fail without marking anything dirty, so the failure was
// invisible to the status chip AND to this policy.
// =============================================================================

/** Give up on a document after this many failed attempts. */
export const MAX_RETRY_COUNT = 5;

/** Ceiling for the exponential backoff between attempts. */
export const MAX_BACKOFF_MS = 30000;

/**
 * Sanity cap. With one entry per document this should never be approached; it
 * exists so a pathological loop cannot fill localStorage.
 */
export const MAX_QUEUE_ENTRIES = 200;

/** Write kinds the queue understands. Anything else is rejected on the way in. */
export const RETRY_TYPES = ['project', 'workspace', 'tasks'];

/**
 * Identity of a queued write: the DOCUMENT, not the attempt.
 * @param {{type: string, projectId: string, workspaceId?: string|null}} d
 * @returns {string}
 */
export function retryKey(d) {
  if (!d || !d.type || !d.projectId) return '';
  return `${d.type}:${d.projectId}:${d.workspaceId || '-'}`;
}

/**
 * Delay before the next attempt: 1s, 2s, 4s, 8s, 16s, capped at MAX_BACKOFF_MS.
 * @param {number} retryCount
 * @returns {number} milliseconds
 */
export function backoffMs(retryCount) {
  const n = typeof retryCount === 'number' && retryCount > 0 ? retryCount : 0;
  return Math.min(1000 * Math.pow(2, n), MAX_BACKOFF_MS);
}

/**
 * Normalise one stored record into the current entry shape.
 *
 * Also migrates entries written before Fix 5b, which carried a `data` payload
 * and a single `timestamp`. The payload is DISCARDED on purpose - that frozen
 * copy is the hazard described at the top of this file, and any entry that
 * still matters is still marked dirty, so the retry will re-read live content.
 *
 * @param {object} raw
 * @param {number} now
 * @returns {object|null} normalised entry, or null if unusable
 */
export function normaliseEntry(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  if (!RETRY_TYPES.includes(raw.type)) return null;
  if (!raw.projectId || typeof raw.projectId !== 'string') return null;
  if (raw.type === 'workspace' && !raw.workspaceId) return null;
  const legacyTs = typeof raw.timestamp === 'number' ? raw.timestamp : null;
  const first = typeof raw.firstFailedAt === 'number' ? raw.firstFailedAt : (legacyTs != null ? legacyTs : now);
  const last = typeof raw.lastAttemptAt === 'number' ? raw.lastAttemptAt : (legacyTs != null ? legacyTs : now);
  return {
    key: retryKey(raw),
    type: raw.type,
    projectId: raw.projectId,
    workspaceId: raw.type === 'workspace' ? raw.workspaceId : null,
    firstFailedAt: first,
    lastAttemptAt: last,
    retryCount: typeof raw.retryCount === 'number' && raw.retryCount > 0 ? raw.retryCount : 0,
  };
}

/**
 * Normalise and de-duplicate a whole stored queue.
 *
 * Duplicates are merged conservatively: the EARLIEST first-failure is kept (so
 * "how long has this been stuck" stays honest), the LATEST attempt time is kept
 * (so backoff is not restarted), and the LOWEST retry count is kept, because
 * duplicate records describe the same document and retries now send current
 * content - being generous with attempts is the safe direction.
 *
 * @param {any} raw parsed contents of the stored queue
 * @param {number} now
 * @returns {object[]} normalised entries, insertion order preserved
 */
export function normaliseQueue(raw, now) {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map();
  for (const item of raw) {
    const e = normaliseEntry(item, now);
    if (!e) continue;
    const prev = byKey.get(e.key);
    if (!prev) { byKey.set(e.key, e); continue; }
    byKey.set(e.key, {
      ...prev,
      firstFailedAt: Math.min(prev.firstFailedAt, e.firstFailedAt),
      lastAttemptAt: Math.max(prev.lastAttemptAt, e.lastAttemptAt),
      retryCount: Math.min(prev.retryCount, e.retryCount),
    });
  }
  return Array.from(byKey.values()).slice(-MAX_QUEUE_ENTRIES);
}

/**
 * Record a failed write, collapsing it onto any existing entry for the same
 * document.
 *
 * An existing entry keeps its `retryCount` and `firstFailedAt`: this call means
 * "this document still needs uploading", not "start counting again". Only
 * `applyRetryOutcome` advances the count, so one attempt is one increment.
 *
 * @param {object[]} queue normalised queue
 * @param {{type: string, projectId: string, workspaceId?: string|null}} descriptor
 * @param {number} now
 * @returns {object[]} new queue (input is not mutated)
 */
export function mergeQueueEntry(queue, descriptor, now) {
  const incoming = normaliseEntry({ ...descriptor, firstFailedAt: now, lastAttemptAt: now, retryCount: 0 }, now);
  if (!incoming) return Array.isArray(queue) ? queue.slice() : [];
  const list = Array.isArray(queue) ? queue.slice() : [];
  const at = list.findIndex(e => e.key === incoming.key);
  if (at >= 0) {
    list[at] = { ...list[at], lastAttemptAt: now };
    return list;
  }
  list.push(incoming);
  // Cap by discarding the oldest first-failure, never the newest information.
  while (list.length > MAX_QUEUE_ENTRIES) list.shift();
  return list;
}

/**
 * Decide what to do with one queued entry.
 *
 * @param {object} entry normalised entry
 * @param {object} ctx
 * @param {number} ctx.now
 * @param {boolean} ctx.dirty        does this device still hold unsent content?
 * @param {boolean} ctx.hasLocalCopy is the document still present locally?
 * @returns {{action: 'send'|'wait'|'drop', reason: string}}
 */
export function planRetry(entry, ctx) {
  const { now = 0, dirty = false, hasLocalCopy = false } = ctx || {};
  if (!entry) return { action: 'drop', reason: 'unusable-entry' };
  // Deleted locally: there is no content to send, and re-creating it from a
  // frozen copy is exactly the behaviour this fix removes.
  if (!hasLocalCopy) return { action: 'drop', reason: 'no-local-copy' };
  // A later write for this document succeeded, so the cloud already has our
  // content. Sending anything now could only overwrite something newer.
  if (!dirty) return { action: 'drop', reason: 'already-saved' };
  if (entry.retryCount >= MAX_RETRY_COUNT) return { action: 'drop', reason: 'attempts-exhausted' };
  if (now - entry.lastAttemptAt < backoffMs(entry.retryCount)) return { action: 'wait', reason: 'backoff' };
  return { action: 'send', reason: 'dirty-and-due' };
}

/**
 * Apply the result of one attempt to the queue.
 *
 * Re-reads its input rather than assuming the queue is unchanged, so a write
 * that failed while this pass was awaiting Firestore (and merged itself in) is
 * not clobbered.
 *
 * @param {object[]} queue normalised queue as it is NOW
 * @param {string} key
 * @param {{ok: boolean, now: number}} outcome
 * @returns {object[]} new queue
 */
export function applyRetryOutcome(queue, key, { ok, now } = {}) {
  const list = Array.isArray(queue) ? queue.slice() : [];
  const at = list.findIndex(e => e.key === key);
  if (at < 0) return list;
  if (ok) { list.splice(at, 1); return list; }
  list[at] = { ...list[at], retryCount: list[at].retryCount + 1, lastAttemptAt: typeof now === 'number' ? now : list[at].lastAttemptAt };
  return list;
}

/**
 * Remove the entry for a document, used when a write is confirmed by another
 * route (the normal debounced upload, or a manual sync). Keeps the "waiting to
 * retry" count honest the moment a document is genuinely saved, instead of at
 * the next drain.
 *
 * @param {object[]} queue
 * @param {string} key
 * @returns {object[]}
 */
export function removeQueueEntry(queue, key) {
  if (!Array.isArray(queue)) return [];
  return queue.filter(e => e.key !== key);
}
