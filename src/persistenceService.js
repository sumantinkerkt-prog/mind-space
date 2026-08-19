// =============================================================================
// Persistence Service - Per-Workspace Storage & Firestore Subcollection API
// =============================================================================
// This module implements:
// - Per-workspace localStorage schema (cm-meta, cm-proj-*, cm-ws-*, cm-tasks-*)
// - Firestore subcollection-based read/write functions
// - Debounced save helpers for App.jsx integration
// =============================================================================

import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc, increment, serverTimestamp, arrayUnion, arrayRemove, runTransaction } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { severityForSource, READ_SEVERITY } from './loadOutcome';
import { nextDirtySeq, shouldClearDirty, createWriteCoalescer } from './saveAck';
import {
  retryKey, normaliseQueue, mergeQueueEntry, planRetry, applyRetryOutcome, removeQueueEntry,
} from './retryQueue';
import { SESSION_ROLE, roleFromLocation } from './sessionRole';

// =============================================================================
// THE VIEWER BOUNDARY (Fix 6, second attempt - the owner's model)
// =============================================================================
// EDITOR <-> SERVER: read and write.
// VIEWER  <- SERVER: read only, one way. Load a copy and disconnect.
//
// Every write in this app goes through this module. So this is where a viewer is
// stopped - once, at the boundary - instead of at the forty-odd call sites in
// App.jsx that each had to remember. The first attempt at Fix 6 guarded the call
// sites and still missed the load sequence, which writes the local cache and the
// sync bookkeeping from about a dozen places.
//
// Reads are untouched: a viewer must still be able to load and look at everything.
//
// This covers localStorage as well as Firestore, deliberately. localStorage here is
// not a private scratchpad - an editor tab on the same device reads the same keys
// and uploads them, so a "local only" write by a viewer can still reach the server
// later, through the editor. In-memory experiments (panning, zooming, hiding
// descriptions, copying a card) are genuinely private and stay allowed.
// =============================================================================

/** Explicit role, set by App.jsx from the router. Null = work it out from the URL. */
let _sessionRoleOverride = null;

/**
 * Tell the persistence layer what this tab is. App.jsx calls this from the router,
 * so the answer follows the same source of truth as the rest of the app - including
 * the editor-session timer, which turns an editor tab into a viewer tab mid-session
 * without a reload.
 * @param {string} role a SESSION_ROLE value
 */
export function setSessionRole(role) {
  _sessionRoleOverride = (role === SESSION_ROLE.VIEWER || role === SESSION_ROLE.EDITOR) ? role : null;
}

/** True when this tab is a read-only viewer. */
export function sessionIsViewer() {
  if (_sessionRoleOverride) return _sessionRoleOverride === SESSION_ROLE.VIEWER;
  return roleFromLocation(typeof location !== 'undefined' ? location : null) === SESSION_ROLE.VIEWER;
}

/** Names already reported, so the console gets one line per kind, not thousands. */
const _refusedWrites = new Set();

/**
 * The gate. Returns true when the caller must NOT write.
 *
 * Logs the first refusal of each kind. That is on purpose: if a viewer tab is
 * quietly refusing writes all day, the console should say so once, so a future
 * "why did my change not save?" has an answer sitting right there.
 *
 * @param {string} what short label, e.g. 'workspace' or 'firestore:project'
 * @returns {boolean}
 */
function viewerMustNotWrite(what) {
  if (!sessionIsViewer()) return false;
  if (!_refusedWrites.has(what)) {
    _refusedWrites.add(what);
    console.info('[Persistence] This tab is a read-only View tab, so it did not write "%s". Reload an editor tab to make changes.', what);
  }
  return true;
}

/** Diagnostics: what this tab has refused to write (used by the manual test). */
export function refusedWriteKinds() {
  return Array.from(_refusedWrites);
}

// A read-only diagnostic, deliberately available in production.
//
// Unit tests can prove that every writer is guarded, but they cannot prove that a
// REAL browser tab on a `/view/` URL is recognised as a viewer - that depends on the
// live URL. This lets the owner ask the running tab directly, instead of inferring
// it from what did or did not change in storage. It exposes no way to write
// anything: `probe()` asks the gate a question and throws the answer away.
if (typeof window !== 'undefined') {
  window.mindspace = {
    /** 'viewer' (read-only tab) or 'editor'. */
    role: () => (sessionIsViewer() ? SESSION_ROLE.VIEWER : SESSION_ROLE.EDITOR),
    /** Kinds of write this tab has refused so far. */
    refused: () => refusedWriteKinds(),
    /** Ask the boundary whether a write would be allowed right now. Writes nothing. */
    probe: () => ({
      role: sessionIsViewer() ? SESSION_ROLE.VIEWER : SESSION_ROLE.EDITOR,
      wouldBlockWrites: sessionIsViewer(),
      refusedSoFar: refusedWriteKinds(),
    }),
  };
}

// =============================================================================
// READ-FAILURE REGISTRY (Bug 42)
// =============================================================================
//
// Every reader below has a catch block that returns null / {} / [] on failure.
// That value is indistinguishable from "there is nothing stored", which is how
// a transient network error used to make App.jsx build a default demo project
// and upload it over the user's real data.
//
// Rather than change ~17 return types (a large, risky diff through the whole
// load path), each catch now ALSO records the failure here. Callers that care -
// currently just init() in App.jsx - ask this registry whether the null they
// received meant "empty" or "broken". Callers that do not care are unaffected,
// so the readers keep their existing signatures.
//
// Severity classification lives in loadOutcome.js so it stays pure and testable.
// =============================================================================

/**
 * Append-only log of read failures. Append-only, and read via a start offset,
 * because a shared "clear then collect" registry is not safe here: React
 * StrictMode double-invokes the mount effect in development, so two init() runs
 * overlap. With a clearing API, the second run's reset could wipe the first
 * run's recorded failure while the first run was still awaiting Firestore - and
 * that run would then classify an empty result as EMPTY_CONFIRMED and create a
 * default project. Exactly the bug we are fixing, reintroduced by the fix.
 *
 * With an offset token each concurrent load sees only its OWN failures, and
 * neither can hide anything from the other.
 */
let _readFailures = [];

/** Hard cap so a pathological retry loop cannot grow this without bound. */
const MAX_RECORDED_READ_FAILURES = 500;

/**
 * Begin a read session. Returns an opaque token to pass to getReadFailures().
 * Cheap enough to call on every load.
 */
export function beginReadSession() {
  return _readFailures.length;
}

/**
 * Reset the log entirely. For tests; production code uses beginReadSession().
 */
export function resetReadFailures() {
  _readFailures = [];
}

/**
 * Record that a read could not be completed.
 *
 * Deliberately never throws: it is called from inside catch blocks, and a
 * failure to record a failure must not escalate into an unhandled exception on
 * the load path.
 *
 * @param {string} source - a key from READ_SOURCE_SEVERITY in loadOutcome.js
 * @param {unknown} error - the caught value (may be anything)
 * @param {object} [context] - optional identifying detail (projectId, workspaceId)
 */
export function recordReadFailure(source, error, context) {
  try {
    const severity = severityForSource(source);
    // Stop appending rather than dropping the oldest entries: shifting would
    // invalidate every outstanding session token.
    if (_readFailures.length >= MAX_RECORDED_READ_FAILURES) return;
    _readFailures.push({
      source,
      severity,
      message: (error && error.message) || String(error || 'unknown error'),
      context: context || null,
      at: Date.now(),
    });
    // Critical read failures are the ones that switch the app to read-only, so
    // they are worth a real console entry rather than the reader's quiet warn.
    if (severity === READ_SEVERITY.CRITICAL) {
      console.error('[Read] CRITICAL read failure (%s):', source, (error && error.message) || error, context || '');
    }
  } catch {
    /* never let diagnostics break the load */
  }
}

// =============================================================================
// FAULT INJECTION - make a cloud READ fail on purpose, for testing
// =============================================================================
//
// Why this exists in shipped code. The data-safety behaviour of this app is
// almost entirely about what happens when a read FAILS, and there is no way to
// exercise that from the outside:
//
//   * Turning off the network is useless - the app is served over the internet,
//     so the browser cannot fetch the app itself and you never reach the code.
//   * DevTools request blocking works but is eight fiddly steps, and the owner
//     is not a developer.
//   * The "no data at all" verdict is structurally UNREACHABLE while the cloud
//     is healthy, because a healthy cloud always returns the real projects.
//
// So the only practical way for the owner to verify the protection is a switch.
//
// SAFETY PROPERTIES, deliberately chosen:
//   1. OFF unless explicitly set. Absent key = normal behaviour.
//   2. It only makes READS fail. It never writes, deletes or corrupts anything.
//   3. It fails in the SAFE direction. A simulated read failure puts the app in
//      read-only mode, so a switch accidentally left on makes the app refuse to
//      save - annoying, visible, and harmless. It cannot cause data loss.
//   4. Verbosely named, and announced in the console on every read it blocks, so
//      it can never be mistaken for a real fault.
//
// Turn on:  localStorage.setItem('cm-debug-simulate-cloud-failure', '1')
// Turn off: localStorage.removeItem('cm-debug-simulate-cloud-failure')
// =============================================================================

/** localStorage key that, when set to '1', makes every cloud read fail. */
export const DEBUG_SIMULATE_CLOUD_FAILURE_KEY = 'cm-debug-simulate-cloud-failure';

/**
 * If the debug switch is on, return an Error to throw; otherwise null.
 * Each cloud reader throws it inside its own try block, so the failure travels
 * the REAL error path (same catch, same recordReadFailure, same verdict) rather
 * than a special case that might behave differently from a genuine fault.
 */
function simulatedCloudReadFailure(what) {
  try {
    if (localStorage.getItem(DEBUG_SIMULATE_CLOUD_FAILURE_KEY) === '1') {
      console.warn(
        '[Debug] Simulating a FAILED cloud read of "%s" because %s is set. ' +
        'This is a deliberate test switch, not a real fault. Remove the key to restore normal behaviour.',
        what, DEBUG_SIMULATE_CLOUD_FAILURE_KEY
      );
      return new Error(`Simulated cloud read failure (${what}) - ${DEBUG_SIMULATE_CLOUD_FAILURE_KEY} is set`);
    }
  } catch { /* localStorage unavailable: behave normally */ }
  return null;
}

/** Make cloud WRITES slow, so an edit can be made while one is in flight. */
export const DEBUG_SLOW_CLOUD_WRITE_KEY = 'cm-debug-slow-cloud-write';
/** Make cloud WRITES fail, to check failures are reported and queued. */
export const DEBUG_FAIL_CLOUD_WRITE_KEY = 'cm-debug-fail-cloud-write';

/**
 * Apply the write-side debug switches (Fix 5 needs both to be testable).
 *
 * `cm-debug-slow-cloud-write` holds a delay in milliseconds. It exists because
 * Bug 43 only happens in the window between a write starting and finishing: to
 * see it you must edit again DURING an upload, which is impossible by hand when
 * uploads take 200ms. Setting it to 10000 makes that window easy to hit.
 *
 * `cm-debug-fail-cloud-write` makes writes fail, to confirm a failure is
 * reported honestly and lands in the retry queue.
 *
 * Both are off unless set, and both fail in the safe direction: a slow write is
 * still a real write, and a failed write leaves the document marked unsaved and
 * queued for retry - never lost.
 */
async function applySimulatedWriteFaults(what) {
  let delayMs = 0;
  let shouldFail = false;
  try {
    delayMs = parseInt(localStorage.getItem(DEBUG_SLOW_CLOUD_WRITE_KEY) || '0', 10) || 0;
    shouldFail = localStorage.getItem(DEBUG_FAIL_CLOUD_WRITE_KEY) === '1';
  } catch { return; } // localStorage unavailable: behave normally
  if (delayMs > 0) {
    console.warn('[Debug] Delaying the cloud write of "%s" by %dms (%s is set).', what, delayMs, DEBUG_SLOW_CLOUD_WRITE_KEY);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  if (shouldFail) {
    console.warn('[Debug] Failing the cloud write of "%s" on purpose (%s is set).', what, DEBUG_FAIL_CLOUD_WRITE_KEY);
    throw new Error(`Simulated cloud write failure (${what}) - ${DEBUG_FAIL_CLOUD_WRITE_KEY} is set`);
  }
}

/**
 * Failures recorded since a session token was taken.
 * @param {number} [since] token from beginReadSession(); omit for all failures.
 */
export function getReadFailures(since = 0) {
  return _readFailures.slice(typeof since === 'number' && since >= 0 ? since : 0);
}

// =============================================================================
// CONSTANTS - localStorage key patterns
// =============================================================================

/** Meta key storing activeProjectId, defaultProjectId, schemaVersion */
const KEY_META = 'cm-meta';

/** Project metadata key pattern: cm-proj-{projectId} */
const KEY_PROJECT_PREFIX = 'cm-proj-';

/** Workspace data key pattern: cm-ws-{projectId}-{workspaceId} */
const KEY_WORKSPACE_PREFIX = 'cm-ws-';

/** Tasks key pattern: cm-tasks-{projectId} */
const KEY_TASKS_PREFIX = 'cm-tasks-';

/** Schema version for the per-workspace format */
export const SCHEMA_VERSION = 2;

/** Device identity (friendly name + hidden id) key */
const KEY_DEVICE = 'cm-device';

/** Per-document sync-state map key: { [docPath]: { baseRev, dirty, syncedHash } } */
const KEY_SYNC_STATE = 'cm-sync-state';

/** Recently-deleted workspace tombstones key: { [`${projectId}/${wsId}`]: timestamp } */
const KEY_TOMBSTONES = 'cm-tombstones';

/** How long a delete tombstone blocks reconcile re-attachment (ms) */
const TOMBSTONE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Tracks the lastModified timestamp of each workspace at the time it was last
 * successfully synced to Firestore. Used by manualServerSync to avoid spurious
 * revision bumps when data hasn't changed.
 * Key: `${projectId}/${workspaceId}`, Value: lastModified timestamp (number)
 */
const _lastSyncedTimestamps = new Map();

// =============================================================================
// DOC PATH HELPERS - canonical keys for per-document sync-state
// =============================================================================

/** Sync-state path for a project's metadata document. */
export function metaPath(projectId) { return `${projectId}/__meta`; }
/** Sync-state path for a project's tasks document. */
export function tasksPath(projectId) { return `${projectId}/__tasks`; }
/** Sync-state path for a specific workspace document. */
export function wsPath(projectId, workspaceId) { return `${projectId}/${workspaceId}`; }

// =============================================================================
// DEVICE IDENTITY - a hidden stable id + a friendly, user-chosen name
// =============================================================================

/**
 * Read the device identity stored on THIS device. Auto-generates a hidden id
 * on first access. The friendly name stays null until the user picks one
 * (Phase 2 UI); until then we fall back to a short id-based label.
 * @returns {{ id: string, name: string|null }}
 */
export function getDeviceIdentity() {
  try {
    const raw = localStorage.getItem(KEY_DEVICE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id) return { id: parsed.id, name: parsed.name || null };
    }
  } catch (e) {
    // Benign: a regenerated device id only mislabels "last edited by".
    recordReadFailure('localStorage:device', e);
  }
  const identity = { id: generateId(), name: null };
  try { localStorage.setItem(KEY_DEVICE, JSON.stringify(identity)); } catch { /* ignore */ }
  return identity;
}

/** Set (or change) the friendly device name, preserving the hidden id. */
export function setDeviceName(name) {
  if (viewerMustNotWrite('device name')) return;
  const current = getDeviceIdentity();
  const next = { id: current.id, name: name || null };
  try { localStorage.setItem(KEY_DEVICE, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

/** Whether this device still needs to be named (for the first-run picker). */
export function deviceNeedsNaming() {
  return !getDeviceIdentity().name;
}

/** A human label for this device, falling back to a short id when unnamed. */
export function getDeviceLabel() {
  const { id, name } = getDeviceIdentity();
  return name || `Device-${id.slice(0, 4)}`;
}

// =============================================================================
// CONTENT FINGERPRINT - detect whether content ACTUALLY changed
// =============================================================================

/**
 * Compute a stable, order-insensitive-enough fingerprint of a document's
 * meaningful content. Used to skip uploads (and revision bumps) when a save
 * would not actually change anything on the server. This is what prevents old
 * data from being re-stamped as "newest".
 *
 * NOTE: This intentionally ignores volatile bookkeeping fields (revision,
 * lastModified, lastEditedByDevice) so identical content always hashes the same.
 *
 * @param {object} obj
 * @returns {string} a short hex fingerprint
 */
export function computeContentHash(obj) {
  const stripped = stripVolatileFields(obj);
  const json = stableStringify(stripped);
  // FNV-1a 32-bit hash - fast, dependency-free, good enough for change detection
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function stripVolatileFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { revision, lastModified, lastEditedByDevice, contentHash, ...rest } = obj;
  return rest;
}

/** Deterministic JSON stringify (sorts object keys) so hashes are stable. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// =============================================================================
// PER-DOCUMENT SYNC STATE - baseRev / dirty / syncedHash
// =============================================================================
//
// baseRev     : the server revision this device's local copy is built on.
// dirty       : this device has un-uploaded edits for this document.
// syncedHash  : content fingerprint of the last version successfully uploaded
//               (or loaded) - used to skip no-op uploads.
// =============================================================================

function loadSyncStateMap() {
  try {
    const raw = localStorage.getItem(KEY_SYNC_STATE);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    // Critical despite holding no content: an empty map reads back as "every
    // document is clean and non-dirty", which is precisely the state in which
    // transactionalWrite skips its revision check and overwrites the server.
    recordReadFailure('localStorage:syncState', e);
    return {};
  }
}

function saveSyncStateMap(map) {
  // Covers markDirty, seedSyncState, confirmSynced and rebaseDirty in one place.
  if (viewerMustNotWrite('sync bookkeeping')) return;
  try { localStorage.setItem(KEY_SYNC_STATE, JSON.stringify(map)); } catch { /* ignore */ }
}

/** Read the sync-state for a document path. */
export function getSyncState(path) {
  const map = loadSyncStateMap();
  return map[path] || { baseRev: null, dirty: false, syncedHash: null };
}

/**
 * Seed baseRev + syncedHash from freshly loaded server (or local) data.
 * Clears the dirty flag because the local copy now matches this baseline.
 * This is what makes the upgrade migration silent (missing revision -> 0).
 */
export function seedSyncState(path, serverRev, content) {
  const map = loadSyncStateMap();
  map[path] = {
    baseRev: typeof serverRev === 'number' ? serverRev : 0,
    dirty: false,
    syncedHash: content ? computeContentHash(content) : (map[path] ? map[path].syncedHash : null)
  };
  saveSyncStateMap(map);
}

/**
 * Mark a document dirty (local edit made) and record its current fingerprint.
 *
 * Bug 43: also advances `dirtySeq`, a monotonic counter. An upload captures this
 * counter at the moment it reads the data; confirmSynced then refuses to clear
 * the dirty flag if the counter has moved on, because that means the user edited
 * again while the upload was in flight and the acknowledgement does not cover
 * those newer edits. See src/saveAck.js for why a counter and not a hash.
 */
export function markDirty(path, content) {
  const map = loadSyncStateMap();
  const prev = map[path] || { baseRev: null, dirty: false, syncedHash: null };
  map[path] = {
    ...prev,
    dirty: true,
    currentHash: content ? computeContentHash(content) : prev.currentHash,
    dirtySeq: nextDirtySeq(prev.dirtySeq),
  };
  saveSyncStateMap(map);
}

/**
 * The document's current dirty counter, captured by an uploader at the same
 * moment it reads the data it is about to send.
 */
export function getDirtySeq(path) {
  return getSyncState(path).dirtySeq;
}

/** Timestamp (ms) of the most recent confirmed successful cloud write. */
let _lastCloudSyncAt = 0;

/** Get the timestamp of the last confirmed successful cloud write (0 if none). */
export function getLastCloudSyncAt() { return _lastCloudSyncAt; }

/**
 * After a confirmed successful upload: advance baseRev, and clear dirty ONLY if
 * the acknowledgement still covers what is on this device (Bug 43).
 *
 * `baseRev` always advances - this device really did write that revision, and
 * the next upload must build on it or the transactional writer would see the
 * cloud ahead of us and raise a conflict against our own write.
 *
 * `dirty` is conditional. If the user edited again while this upload was in
 * flight, `dirtySeq` has moved past the value captured when the uploaded data
 * was read, so the newer edits are NOT on the server and the document stays
 * dirty. Clearing it there was the bug: it marked unsent edits as safe, and the
 * trust chip (which derives "unsaved" from hasDirtyDocs) would show all-clear.
 *
 * @param {string} path
 * @param {number} newServerRev
 * @param {object} content    the payload that was actually written
 * @param {number} [confirmedSeq] dirtySeq captured when that payload was read
 */
export function confirmSynced(path, newServerRev, content, confirmedSeq) {
  const map = loadSyncStateMap();
  const prev = map[path] || {};
  const clearDirty = shouldClearDirty({ confirmedSeq, currentSeq: prev.dirtySeq });
  map[path] = {
    baseRev: typeof newServerRev === 'number' ? newServerRev : (prev.baseRev || 0),
    dirty: !clearDirty,
    syncedHash: content ? computeContentHash(content) : prev.syncedHash,
    // Keep the counter and the local fingerprint when edits are still pending,
    // so the next upload can be judged the same way.
    ...(clearDirty ? {} : { dirtySeq: prev.dirtySeq, currentHash: prev.currentHash }),
  };
  saveSyncStateMap(map);
  _lastCloudSyncAt = Date.now();
  _syncedSinceSnapshot = true;
  // Fix 5b: this document is now genuinely in the cloud, so any queued retry for
  // it is obsolete. Clearing it here (rather than at the next drain) is what
  // makes the "waiting to retry" count fall as soon as a recovery succeeds.
  if (clearDirty) dropQueuedWriteForPath(path);
  if (!clearDirty) {
    console.info(
      '[Sync] Upload of %s confirmed, but newer local edits exist (seq %s -> %s). ' +
      'Keeping it marked unsaved so those edits are uploaded too.',
      path, confirmedSeq, prev.dirtySeq
    );
  }
}

/**
 * Whether ANY document belonging to a project currently has un-uploaded local
 * edits (dirty). Used by the trust UI to show an "unsaved changes" state.
 * @param {string} projectId
 * @returns {boolean}
 */
export function hasDirtyDocs(projectId) {
  if (!projectId) return false;
  const map = loadSyncStateMap();
  const prefix = projectId + '/';
  return Object.keys(map).some(k => k.startsWith(prefix) && map[k] && map[k].dirty);
}

/** True if this device has un-uploaded edits for the given path. */
export function isDirty(path) {
  return !!getSyncState(path).dirty;
}

/**
 * Rebase local edits onto a new server revision while KEEPING the dirty flag.
 * Used by "use mine" conflict resolution: we accept the cloud's current revision
 * as our base (so the next write is not treated as a conflict) but retain our
 * local edits so they overwrite the cloud on the next upload.
 */
export function rebaseDirty(path, serverRev) {
  const map = loadSyncStateMap();
  const prev = map[path] || {};
  map[path] = { ...prev, baseRev: typeof serverRev === 'number' ? serverRev : (prev.baseRev || 0), dirty: true };
  saveSyncStateMap(map);
}

// =============================================================================
// TOMBSTONES - block reconcile from resurrecting an in-flight/just deleted ws
// =============================================================================

function loadTombstones() {
  try {
    const raw = localStorage.getItem(KEY_TOMBSTONES);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    // Benign: losing tombstones can only resurrect a deleted workspace.
    recordReadFailure('localStorage:tombstones', e);
    return {};
  }
}

function saveTombstones(map) {
  if (viewerMustNotWrite('tombstones')) return;
  try { localStorage.setItem(KEY_TOMBSTONES, JSON.stringify(map)); } catch { /* ignore */ }
}

/** Record that a workspace was intentionally deleted (prevents resurrection). */
export function addTombstone(projectId, workspaceId) {
  const map = loadTombstones();
  map[`${projectId}/${workspaceId}`] = Date.now();
  saveTombstones(map);
}

/** Whether a workspace has a fresh (non-expired) delete tombstone. */
export function hasTombstone(projectId, workspaceId) {
  const map = loadTombstones();
  const ts = map[`${projectId}/${workspaceId}`];
  if (!ts) return false;
  if (Date.now() - ts > TOMBSTONE_TTL_MS) {
    delete map[`${projectId}/${workspaceId}`];
    saveTombstones(map);
    return false;
  }
  return true;
}

// =============================================================================
// CONFLICT HANDLER REGISTRATION - App registers a callback for per-doc conflicts
// =============================================================================

let _conflictHandler = null;

/**
 * Register a callback invoked when a transactional write is refused because the
 * cloud is ahead of this device's baseRev AND this device has local edits.
 * Signature: (info) => void, where info = { path, kind, projectId, workspaceId,
 * serverRev, serverData, localData }.
 */
export function registerConflictHandler(fn) { _conflictHandler = fn; }
function emitConflict(info) { if (typeof _conflictHandler === 'function') { try { _conflictHandler(info); } catch { /* ignore */ } } }

// =============================================================================
// ID GENERATION
// =============================================================================

/**
 * Generate a unique ID using crypto.randomUUID() with fallback.
 * @returns {string} A UUID-like string
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers that lack crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =============================================================================
// LOCALSTORAGE READ/WRITE API
// =============================================================================

/**
 * Load the meta object (activeProjectId, defaultProjectId, schemaVersion).
 * @returns {object|null}
 */
export function loadMeta() {
  try {
    const raw = localStorage.getItem(KEY_META);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // Bug 42: a corrupt or unreadable cm-meta is NOT "no projects yet".
    recordReadFailure('localStorage:meta', e);
    return null;
  }
}

/**
 * Save the meta object.
 * @param {object} meta - { activeProjectId, defaultProjectId, schemaVersion }
 */
export function saveMeta(meta) {
  if (viewerMustNotWrite('which project is open')) return;
  localStorage.setItem(KEY_META, JSON.stringify(meta));
}

/**
 * Load project metadata for a given project.
 * @param {string} projectId
 * @returns {object|null}
 */
export function loadProjectMeta(projectId) {
  try {
    const raw = localStorage.getItem(KEY_PROJECT_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    recordReadFailure('localStorage:projectMeta', e, { projectId });
    return null;
  }
}

/**
 * Save project metadata.
 * @param {string} projectId
 * @param {object} data
 */
export function saveProjectMeta(projectId, data) {
  if (viewerMustNotWrite('project settings')) return;
  localStorage.setItem(KEY_PROJECT_PREFIX + projectId, JSON.stringify(data));
}

/**
 * Load workspace data for a specific project and workspace.
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {object|null}
 */
export function loadWorkspace(projectId, workspaceId) {
  try {
    const raw = localStorage.getItem(KEY_WORKSPACE_PREFIX + projectId + '-' + workspaceId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // Critical: callers push only truthy results into the workspace list, so a
    // swallowed failure here silently drops a whole canvas from the project.
    recordReadFailure('localStorage:workspace', e, { projectId, workspaceId });
    return null;
  }
}

/**
 * Save workspace data.
 * @param {string} projectId
 * @param {string} workspaceId
 * @param {object} data - { name, nodes, edges, groups, pins, images, lastModified }
 */
export function saveWorkspace(projectId, workspaceId, data) {
  if (viewerMustNotWrite('canvas')) return;
  localStorage.setItem(KEY_WORKSPACE_PREFIX + projectId + '-' + workspaceId, JSON.stringify(data));
}

/**
 * Remove a workspace key from localStorage.
 * @param {string} projectId
 * @param {string} workspaceId
 */
export function removeWorkspaceLocal(projectId, workspaceId) {
  if (viewerMustNotWrite('canvas removal')) return;
  localStorage.removeItem(KEY_WORKSPACE_PREFIX + projectId + '-' + workspaceId);
}

/**
 * Load tasks and taskGroups for a project.
 * @param {string} projectId
 * @returns {object|null} - { tasks, taskGroups }
 */
export function loadTasks(projectId) {
  try {
    const raw = localStorage.getItem(KEY_TASKS_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // Callers turn null into `tasks: []`, which autosave would then write back
    // over a real task list.
    recordReadFailure('localStorage:tasks', e, { projectId });
    return null;
  }
}

/**
 * Save tasks and taskGroups for a project.
 * @param {string} projectId
 * @param {object} data - { tasks, taskGroups }
 */
export function saveTasks(projectId, data) {
  if (viewerMustNotWrite('task list')) return;
  localStorage.setItem(KEY_TASKS_PREFIX + projectId, JSON.stringify(data));
}

/**
 * Scan localStorage for all project IDs by looking for cm-proj-* keys.
 * @returns {string[]} Array of project IDs
 */
export function loadAllProjectIds() {
  const ids = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(KEY_PROJECT_PREFIX)) {
      ids.push(key.slice(KEY_PROJECT_PREFIX.length));
    }
  }
  return ids;
}

// =============================================================================
// LOCAL-ONLY METADATA ENRICHMENT
// =============================================================================

/**
 * Enrich a project object with local-only metadata stored in localStorage.
 *
 * Firestore intentionally strips certain fields (e.g. password hashes) for
 * security reasons.  When we construct in-memory project objects from Firestore
 * data, we must merge back those local-only fields so that the React state
 * holds a complete picture.
 *
 * This function is idempotent: if the project already carries the field, or
 * localStorage has no entry for it, it returns the project unchanged.
 *
 * Current local-only fields:
 *   - password  (bcrypt-style SHA-256 hash)
 *
 * Future local-only fields can be added to LOCAL_ONLY_FIELDS below.
 *
 * @param {object} project - A project object (must have an `id` property)
 * @returns {object} The project enriched with local-only metadata
 */
export function enrichProjectWithLocalMetadata(project) {
  if (!project || !project.id) return project;

  const localMeta = loadProjectMeta(project.id);
  if (!localMeta) return project;

  // List of fields that exist only in localStorage and never in Firestore.
  // Extend this array when new local-only fields are introduced.
  const LOCAL_ONLY_FIELDS = ['password'];

  let enriched = project;
  for (const field of LOCAL_ONLY_FIELDS) {
    // Only enrich if the project does not already have a truthy value and
    // localStorage has one. This avoids overwriting a value that was set
    // during the current session (e.g. the user just changed password).
    if (!enriched[field] && localMeta[field]) {
      if (enriched === project) {
        enriched = { ...project }; // shallow copy on first mutation
      }
      enriched[field] = localMeta[field];
    }
  }

  return enriched;
}

// =============================================================================
// PROJECT HYDRATION
// =============================================================================

/**
 * Hydrate a project from storage, assembling a complete object with workspaces
 * and tasks. Tries localStorage first (already hydrated from Firestore during
 * init), then falls back to Firestore if workspace data is missing locally.
 *
 * @param {string} projectId - The project ID to hydrate
 * @returns {Promise<object|null>} A complete project object with workspaces and
 *   tasks arrays, or null if the project cannot be found.
 *
 * Returned shape:
 * {
 *   ...projectMetadata,
 *   workspaces: [ { id, name, nodes, edges, groups, pins, images } ],
 *   tasks: [ ... ],
 *   taskGroups: [ ... ]
 * }
 */
export async function hydrateProject(projectId) {
  // Step 1: Load project metadata from localStorage
  let meta = loadProjectMeta(projectId);

  // If localStorage has no metadata, try Firestore
  if (!meta) {
    meta = await loadProjectFromFirestore(projectId);
    if (!meta) return null;
    // Hydrate localStorage for future reads.
    // Note: since loadProjectMeta returned null, there is no existing password
    // to preserve here. The password field will be absent from Firestore data
    // (by design), which is correct for a project with no local password set.
    saveProjectMeta(projectId, meta);
  }

  // Step 2: Obtain workspaceIds
  const workspaceIds = meta.workspaceIds || [];

  // Step 3: Load all workspace data
  const workspaces = [];
  let needsFirestoreFallback = false;

  for (const wsId of workspaceIds) {
    const wsData = loadWorkspace(projectId, wsId);
    if (wsData) {
      workspaces.push(wsData);
    } else {
      needsFirestoreFallback = true;
      break;
    }
  }

  // If any workspace was missing locally, try loading all from Firestore
  if (needsFirestoreFallback) {
    workspaces.length = 0; // Reset
    const firestoreWorkspaces = await loadAllWorkspacesFromFirestore(projectId);
    if (firestoreWorkspaces && firestoreWorkspaces.size > 0) {
      for (const wsId of workspaceIds) {
        const wsData = firestoreWorkspaces.get(wsId);
        if (wsData) {
          workspaces.push(wsData);
          // Hydrate localStorage for future reads
          saveWorkspace(projectId, wsId, wsData);
        } else {
          // Workspace ID listed but no data found - create minimal placeholder
          workspaces.push({ id: wsId, name: 'Workspace', nodes: [], edges: [], groups: [], pins: [], images: [] });
        }
      }
    } else {
      // No workspace data from Firestore either - create placeholders
      for (const wsId of workspaceIds) {
        workspaces.push({ id: wsId, name: 'Workspace', nodes: [], edges: [], groups: [], pins: [], images: [] });
      }
    }
  }

  // Step 4: Load tasks and taskGroups
  let tasks = [];
  let taskGroups = [];

  const tasksData = loadTasks(projectId);
  if (tasksData) {
    tasks = tasksData.tasks || [];
    taskGroups = tasksData.taskGroups || [];
  } else {
    // Try Firestore fallback
    const firestoreTasks = await loadTasksFromFirestore(projectId);
    if (firestoreTasks) {
      tasks = firestoreTasks.tasks || [];
      taskGroups = firestoreTasks.taskGroups || [];
      // Hydrate localStorage for future reads
      saveTasks(projectId, { tasks, taskGroups });
    }
  }

  // Step 5: Assemble complete project object
  return {
    ...meta,
    id: projectId,
    workspaces,
    tasks,
    taskGroups
  };
}

// =============================================================================
// FIRESTORE SUBCOLLECTION API
// =============================================================================
//
// Firestore structure:
//   projects/{projectId}               -> project metadata document
//   projects/{projectId}/workspaces/{workspaceId} -> workspace data
//   projects/{projectId}/tasks/taskData -> tasks + taskGroups
//   userMeta/main                       -> activeProjectId, defaultProjectId
//
// --- Firebase Cost Documentation ---
// @cost Startup: 1 userMeta read + 1 project read + N workspace reads
//       (where N = workspaceIds.length) + 1 tasks read
// @cost Project switch: 1 project read + N workspace reads + 1 tasks read
// @cost Workspace switch: 0 reads (already loaded in memory)
// @cost Autosave workspace: 1 write
// @cost Autosave tasks: 1 write
// @cost Autosave metadata: 1 write
// =============================================================================

// Write-race guard for Firestore writes - per-path queuing to avoid dropping
// concurrent saves to different documents. Each document path gets its own
// in-flight/queued slot, so a workspace save cannot discard a metadata save.
// Serialises writes per document and resolves callers with the real outcome.
// Replaces a hand-rolled queue that reported success for writes it had merely
// queued. See src/saveAck.js for the reasoning and its unit tests.
const firestoreWriteCoalescer = createWriteCoalescer();

// =============================================================================
// RETRY QUEUE - Persist failed Firestore writes for later retry
// =============================================================================

const RETRY_QUEUE_KEY = 'cm-retry-queue';

/**
 * Load the retry queue from localStorage, normalised and de-duplicated.
 *
 * Normalising on every read is what migrates queues written before Fix 5b: they
 * carried a frozen copy of the document, which is discarded here. See the header
 * of src/retryQueue.js for why that copy was dangerous.
 *
 * @returns {Array} normalised entries (no content payloads)
 */
function loadRetryQueue() {
  try {
    const raw = localStorage.getItem(RETRY_QUEUE_KEY);
    return normaliseQueue(raw ? JSON.parse(raw) : [], Date.now());
  } catch (e) {
    // Benign: the data itself is still on disk and still marked dirty, so the
    // next edit re-queues it. Only the pending retry attempts are lost.
    recordReadFailure('localStorage:retryQueue', e);
    return [];
  }
}

/**
 * Persist the retry queue to localStorage.
 * @param {Array} queue
 */
function saveRetryQueue(queue) {
  if (viewerMustNotWrite('upload retry list')) return;
  try {
    localStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // If localStorage is full, log and move on
    console.warn('[PersistenceService] Could not persist retry queue to localStorage');
  }
}

/**
 * Sync-state path for a queued document, so the retry can ask "is this still
 * dirty?" - the question the whole policy turns on.
 * @param {object} entry
 * @returns {string}
 */
function pathForRetryEntry(entry) {
  if (entry.type === 'project') return metaPath(entry.projectId);
  if (entry.type === 'tasks') return tasksPath(entry.projectId);
  return wsPath(entry.projectId, entry.workspaceId);
}

/**
 * Is the document still present on this device? A retry re-reads live local
 * content, so a document that has been deleted locally has nothing to send.
 * @param {object} entry
 * @returns {boolean}
 */
function retryEntryHasLocalCopy(entry) {
  if (entry.type === 'project') return !!loadProjectMeta(entry.projectId);
  if (entry.type === 'tasks') return !!loadTasks(entry.projectId);
  return !!loadWorkspace(entry.projectId, entry.workspaceId);
}

/**
 * Record that a cloud write failed: mark the document dirty, then queue it.
 *
 * MARKING DIRTY IS THE POINT (Fix 5b). Project metadata is uploaded from about
 * ten places, and most of them never call markDirty - they just fire the write.
 * When one of those failed, nothing recorded it: the status chip derives
 * "unsaved" from the dirty flags, so it stayed green while the write was lost,
 * and the retry policy in retryQueue.js could not tell a pending document from a
 * saved one. Marking dirty here makes both honest, and has a third effect that
 * matters more: `transactionalWrite` only performs its "do not overwrite newer
 * cloud data" check on DIRTY documents, so every retry is now covered by it.
 *
 * Passing no content leaves `currentHash` alone - this is not a new edit, it is
 * the same content still failing to leave the device.
 *
 * @param {object} descriptor { type, projectId, workspaceId? }
 */
function noteWriteFailed(descriptor) {
  try {
    const path = pathForRetryEntry(descriptor);
    if (!isDirty(path)) markDirty(path, null);
  } catch { /* marking is best-effort; queuing below matters more */ }
  enqueueFailedWrite(descriptor);
}

/**
 * Queue a failed write for a later attempt. One entry per DOCUMENT: repeated
 * failures of the same document update the existing entry instead of appending
 * a new one. No content is stored - the retry re-reads the current local copy.
 * @param {object} descriptor { type: 'project'|'workspace'|'tasks', projectId, workspaceId? }
 */
function enqueueFailedWrite(descriptor) {
  saveRetryQueue(mergeQueueEntry(loadRetryQueue(), descriptor, Date.now()));
}

/**
 * Forget any queued retry for a document that has just been confirmed saved by
 * another route (the normal debounced upload, or a manual sync). Without this,
 * the "waiting to retry" count only fell at the next drain, which is what made
 * test C3 unpassable: the recovery had genuinely worked, but the count still
 * showed the old failures.
 * @param {string} path sync-state path
 */
function dropQueuedWriteForPath(path) {
  try {
    const queue = loadRetryQueue();
    if (queue.length === 0) return;
    const i = path.indexOf('/');
    if (i < 0) return;
    const projectId = path.slice(0, i);
    const docId = path.slice(i + 1);
    const descriptor = docId === '__meta'
      ? { type: 'project', projectId }
      : docId === '__tasks'
        ? { type: 'tasks', projectId }
        : { type: 'workspace', projectId, workspaceId: docId };
    const next = removeQueueEntry(queue, retryKey(descriptor));
    if (next.length !== queue.length) saveRetryQueue(next);
  } catch { /* bookkeeping only */ }
}

/** Guard against two overlapping drains (page-load drain + heartbeat drain). */
let _retryDrainInFlight = false;

/**
 * Attempt the queued writes that are due.
 *
 * Differences from the pre-Fix-5b version, all of them deliberate:
 *  - It sends the CURRENT local copy of each document, never a frozen copy.
 *  - It only sends documents that are still dirty; anything already saved by
 *    another route is dropped without a write.
 *  - It re-reads the stored queue around each attempt, so a write that fails
 *    while this pass is awaiting Firestore is not silently discarded by the
 *    pass writing back a stale list.
 *
 * @returns {Promise<void>}
 */
export async function processRetryQueue() {
  if (viewerMustNotWrite('upload retry')) return;
  if (!isFirebaseConfigured() || !db) return;
  if (_retryDrainInFlight) return;

  const queue = loadRetryQueue();
  if (queue.length === 0) return;

  _retryDrainInFlight = true;
  try {
    for (const entry of queue) {
      const path = pathForRetryEntry(entry);
      const plan = planRetry(entry, {
        now: Date.now(),
        dirty: isDirty(path),
        hasLocalCopy: retryEntryHasLocalCopy(entry),
      });

      if (plan.action === 'wait') continue;

      if (plan.action === 'drop') {
        if (plan.reason === 'attempts-exhausted') {
          // The document stays marked dirty on purpose: it really is unsaved,
          // the chip should keep saying so, and the next edit or manual sync
          // will try again.
          console.warn('[PersistenceService] Giving up on retrying %s after %d attempts - it is still marked unsaved.', path, entry.retryCount);
        } else {
          console.info('[PersistenceService] Dropping queued retry for %s (%s).', path, plan.reason);
        }
        saveRetryQueue(removeQueueEntry(loadRetryQueue(), entry.key));
        continue;
      }

      // Re-read live local content, so what goes up is what this device holds now.
      let ok = false;
      try {
        if (entry.type === 'project') {
          const meta = loadProjectMeta(entry.projectId);
          ok = meta ? await saveProjectToFirestore(entry.projectId, { ...meta, lastModified: Date.now() }) : false;
        } else if (entry.type === 'workspace') {
          const data = loadWorkspace(entry.projectId, entry.workspaceId);
          ok = data ? await saveWorkspaceToFirestore(entry.projectId, entry.workspaceId, data) : false;
        } else if (entry.type === 'tasks') {
          const t = loadTasks(entry.projectId);
          ok = t ? await saveTasksToFirestore(entry.projectId, { tasks: t.tasks || [], taskGroups: t.taskGroups || [] }) : false;
        }
      } catch {
        ok = false;
      }

      // A failed attempt re-queues itself through noteWriteFailed, which keeps
      // the existing count; this is the single place that advances it.
      saveRetryQueue(applyRetryOutcome(loadRetryQueue(), entry.key, { ok, now: Date.now() }));
    }
  } finally {
    _retryDrainInFlight = false;
  }

  // Anything still queued is retried by the caller's next drain (page load,
  // reconnect, or the 20-second heartbeat in App.jsx). No self-scheduling timer:
  // the old one only existed because nothing else ever drained the queue.
}

/**
 * Serialise writes per document and report the REAL outcome (Bug 30).
 *
 * Previously this returned `true` the instant it decided to queue a write,
 * before that write had run - so the caller set the status to "synced" for
 * something that had not happened yet, and if it later failed, the result was
 * swallowed by a fire-and-forget `.catch()`. Now the returned promise resolves
 * with the actual result of the run that supersedes yours.
 *
 * @param {string} key       Firestore document path, used purely as a mutex key.
 * @param {Function} saveFn  Performs the write; resolves true/false.
 * @param {object} [retryEntry] Descriptor for the retry queue, used only if
 *        saveFn throws unexpectedly (its own catch handles expected failures).
 */
async function guardedFirestoreSave(key, saveFn, retryEntry) {
  if (viewerMustNotWrite('cloud write')) return false;
  return firestoreWriteCoalescer.run(key, saveFn, (err) => {
    // saveFn is written to catch its own errors and enqueue them, so reaching
    // here means something escaped it. Route it to the retry queue anyway
    // rather than losing the write silently.
    console.warn('[PersistenceService] Unexpected error escaped a Firestore save:', (err && err.message) || err);
    if (retryEntry) noteWriteFailed(retryEntry);
  });
}

/**
 * Transactional, version-aware write.
 *
 * Reads the document's current server revision inside a Firestore transaction
 * and refuses to overwrite if the cloud has advanced beyond this device's
 * baseRev WHILE this device has local edits (dirty). This is the hard guarantee
 * that an idle/stale device can never clobber newer cloud data.
 *
 * @returns {Promise<{ status: 'ok'|'conflict', serverRev: number, serverData?: object }>}
 */
async function transactionalWrite({ docRef, path, payload, mergeMode }) {
  if (viewerMustNotWrite('cloud write')) throw new Error('A View tab does not write to the cloud.');
  // Debug switches, no-ops unless explicitly set. Placed before the transaction
  // so a simulated delay widens the real in-flight window and a simulated
  // failure travels the caller's genuine error path.
  await applySimulatedWriteFaults(path);
  const state = getSyncState(path);
  const expectedBaseRev = state.baseRev;
  const localDirty = state.dirty;
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    const exists = snap.exists();
    const currentRev = exists ? (snap.data().revision || 0) : 0;
    // Conflict ONLY when: the doc exists, the cloud moved past our baseRev,
    // AND we have un-uploaded local edits. A clean device never conflicts -
    // it simply adopts the cloud copy elsewhere (read-before-write).
    if (exists && localDirty && expectedBaseRev != null && currentRev > expectedBaseRev) {
      return { status: 'conflict', serverRev: currentRev, serverData: snap.data() };
    }
    const newRev = currentRev + 1;
    const finalPayload = {
      ...payload,
      revision: newRev,
      lastModified: serverTimestamp(),
      lastEditedByDevice: getDeviceLabel(),
      contentHash: computeContentHash(payload)
    };
    if (mergeMode) tx.set(docRef, finalPayload, { merge: true });
    else tx.set(docRef, finalPayload);
    return { status: 'ok', serverRev: newRev };
  });
}

/**
 * Save project metadata to Firestore.
 * Excludes the `password` field (credentials stay local) AND the `workspaceIds`
 * array (the workspace list is managed ONLY via arrayUnion/arrayRemove, so a
 * stale device can never drop a workspace it doesn't know about).
 * @param {string} projectId
 * @param {object} metadata - project metadata
 * @returns {Promise<boolean>} true on success or handled-conflict, false on error
 */
export async function saveProjectToFirestore(projectId, metadata) {
  if (viewerMustNotWrite('cloud: project settings')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  const path = metaPath(projectId);
  // Bug 43: capture the dirty counter NOW, paired with `metadata` as the caller
  // read it. Capturing inside the callback would be wrong: a coalesced write
  // runs later, by which time an edit may have bumped the counter, and we would
  // wrongly conclude the acknowledgement covered it.
  const confirmedSeq = getDirtySeq(path);
  return guardedFirestoreSave(`projects/${projectId}`, async () => {
    try {
      // Strip password (local-only) AND workspaceIds (delta-managed only)
      const { password, workspaceIds, ...safeMetadata } = metadata;
      const docRef = doc(db, 'projects', projectId);
      const payload = { ...safeMetadata, schemaVersion: safeMetadata.schemaVersion || SCHEMA_VERSION };
      const res = await transactionalWrite({ docRef, path, payload, mergeMode: true });
      if (res.status === 'conflict') {
        emitConflict({ path, kind: 'meta', projectId, serverRev: res.serverRev, serverData: res.serverData, localData: payload });
        return true; // handled via conflict flow, not an error
      }
      confirmSynced(path, res.serverRev, payload, confirmedSeq);
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error saving project to Firestore:', error.message);
      noteWriteFailed({ type: 'project', projectId });
      return false;
    }
  }, { type: 'project', projectId });
}

/**
 * Ensure the given workspace IDs are present in the project's workspaceIds
 * array using an atomic arrayUnion (safe against concurrent devices). Used by
 * project-creation paths since saveProjectToFirestore no longer writes the list.
 * @param {string} projectId
 * @param {string[]} ids
 * @returns {Promise<boolean>}
 */
export async function ensureWorkspaceIds(projectId, ids) {
  if (viewerMustNotWrite('cloud: canvas list')) return false;
  if (!isFirebaseConfigured() || !db || !ids || ids.length === 0) return false;
  try {
    await updateDoc(doc(db, 'projects', projectId), {
      workspaceIds: arrayUnion(...ids),
      lastModified: serverTimestamp()
    });
    return true;
  } catch {
    // Doc may not exist yet - create/merge it with the initial list
    try {
      await setDoc(doc(db, 'projects', projectId), { workspaceIds: ids, lastModified: serverTimestamp() }, { merge: true });
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error ensuring workspaceIds:', error.message);
      return false;
    }
  }
}

/**
 * Atomically add a workspace ID to the project's workspaceIds array in Firestore.
 * Uses arrayUnion to avoid clobbering concurrent changes from other devices.
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {Promise<boolean>}
 */
export async function addWorkspaceIdToFirestore(projectId, workspaceId) {
  if (viewerMustNotWrite('cloud: canvas list')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  try {
    const docRef = doc(db, 'projects', projectId);
    await updateDoc(docRef, {
      workspaceIds: arrayUnion(workspaceId),
      lastModified: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.warn('[PersistenceService] Error adding workspaceId to Firestore:', error.message);
    return false;
  }
}

/**
 * Atomically remove a workspace ID from the project's workspaceIds array in Firestore.
 * Uses arrayRemove to avoid clobbering concurrent changes from other devices.
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {Promise<boolean>}
 */
export async function removeWorkspaceIdFromFirestore(projectId, workspaceId) {
  if (viewerMustNotWrite('cloud: canvas list')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  try {
    const docRef = doc(db, 'projects', projectId);
    await updateDoc(docRef, {
      workspaceIds: arrayRemove(workspaceId),
      lastModified: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.warn('[PersistenceService] Error removing workspaceId from Firestore:', error.message);
    return false;
  }
}

/**
 * Load project metadata from Firestore.
 * @param {string} projectId
 * @returns {Promise<object|null>}
 */
export async function loadProjectFromFirestore(projectId) {
  if (!isFirebaseConfigured() || !db) return null;
  try {
    const sim = simulatedCloudReadFailure('project ' + projectId); if (sim) throw sim;
    const docRef = doc(db, 'projects', projectId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading project from Firestore:', error.message);
    recordReadFailure('firestore:project', error, { projectId });
    return null;
  }
}

/**
 * Save workspace data to Firestore subcollection.
 * @param {string} projectId
 * @param {string} workspaceId
 * @param {object} data - workspace data
 * @returns {Promise<boolean>}
 */
export async function saveWorkspaceToFirestore(projectId, workspaceId, data) {
  if (viewerMustNotWrite('cloud: canvas')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  const path = wsPath(projectId, workspaceId);
  const confirmedSeq = getDirtySeq(path); // Bug 43: paired with `data` as read
  return guardedFirestoreSave(`projects/${projectId}/workspaces/${workspaceId}`, async () => {
    try {
      const docRef = doc(db, 'projects', projectId, 'workspaces', workspaceId);
      // Full, explicit content payload -> written as a complete document so
      // deletions (e.g. removing the last node) propagate to the cloud.
      const payload = {
        id: data.id || workspaceId,
        name: data.name || 'Workspace',
        nodes: data.nodes || [],
        edges: data.edges || [],
        groups: data.groups || [],
        pins: data.pins || [],
        images: sanitizeWorkspaceImages(data.images)
      };
      const res = await transactionalWrite({ docRef, path, payload, mergeMode: false });
      if (res.status === 'conflict') {
        emitConflict({ path, kind: 'workspace', projectId, workspaceId, serverRev: res.serverRev, serverData: res.serverData, localData: payload });
        return true; // handled via conflict flow
      }
      confirmSynced(path, res.serverRev, payload, confirmedSeq);
      _lastSyncedTimestamps.set(`${projectId}/${workspaceId}`, data.lastModified || Date.now());
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error saving workspace to Firestore:', error.message);
      noteWriteFailed({ type: 'workspace', projectId, workspaceId });
      return false;
    }
  }, { type: 'workspace', projectId, workspaceId });
}

/**
 * Delete a workspace document from Firestore subcollection.
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {Promise<boolean>}
 */
export async function deleteWorkspaceFromFirestore(projectId, workspaceId) {
  if (viewerMustNotWrite('cloud: delete canvas')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  try {
    const docRef = doc(db, 'projects', projectId, 'workspaces', workspaceId);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    console.warn('[PersistenceService] Error deleting workspace from Firestore:', error.message);
    return false;
  }
}

/**
 * Safely delete a workspace so a crash/interruption can never resurrect it.
 *
 * Ordering is critical: (1) record a local tombstone, (2) delete the workspace
 * DOCUMENT first, (3) only then remove the ID from the list. If interrupted
 * between (2) and (3), the worst case is a harmless dangling ID (no document),
 * which reconcile ignores. The reverse order could leave a live-but-unlisted
 * document that reconcile would wrongly re-attach.
 *
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {Promise<boolean>}
 */
export async function deleteWorkspaceSafely(projectId, workspaceId) {
  if (viewerMustNotWrite('cloud: delete canvas')) return false;
  addTombstone(projectId, workspaceId);
  // Also drop any local sync-state for this doc
  try {
    const map = loadSyncStateMap();
    delete map[wsPath(projectId, workspaceId)];
    saveSyncStateMap(map);
  } catch { /* ignore */ }
  if (!isFirebaseConfigured() || !db) return true;
  try {
    await deleteWorkspaceFromFirestore(projectId, workspaceId); // (2) document first
    await removeWorkspaceIdFromFirestore(projectId, workspaceId); // (3) then the list entry
    return true;
  } catch (error) {
    console.warn('[PersistenceService] deleteWorkspaceSafely failed:', error.message);
    return false;
  }
}

/**
 * Delete an entire project from Firestore, including its workspace and task
 * subcollection documents and the project document itself.
 * @param {string} projectId
 * @param {string[]} workspaceIds - IDs of workspaces to delete from subcollection
 * @returns {Promise<boolean>}
 */
export async function deleteProjectFromFirestore(projectId, workspaceIds = []) {
  if (viewerMustNotWrite('cloud: delete project')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  try {
    // Delete all workspace subcollection documents
    for (const wsId of workspaceIds) {
      const wsRef = doc(db, 'projects', projectId, 'workspaces', wsId);
      await deleteDoc(wsRef);
    }
    // Delete the tasks subcollection document
    const tasksRef = doc(db, 'projects', projectId, 'tasks', 'taskData');
    await deleteDoc(tasksRef);
    // Delete the project document itself
    const projRef = doc(db, 'projects', projectId);
    await deleteDoc(projRef);
    return true;
  } catch (error) {
    console.warn('[PersistenceService] Error deleting project from Firestore:', error.message);
    return false;
  }
}

/**
 * Load a single workspace from Firestore subcollection.
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {Promise<object|null>}
 */
export async function loadWorkspaceFromFirestore(projectId, workspaceId) {
  if (!isFirebaseConfigured() || !db) return null;
  try {
    const sim = simulatedCloudReadFailure('workspace ' + workspaceId); if (sim) throw sim;
    const docRef = doc(db, 'projects', projectId, 'workspaces', workspaceId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading workspace from Firestore:', error.message);
    // The init loop does `if (wsData) loadedWorkspaces.push(wsData)`, so without
    // this record a failed read silently shortens the project by one canvas and
    // autosave then deletes it on the server.
    recordReadFailure('firestore:workspace', error, { projectId, workspaceId });
    return null;
  }
}

/**
 * Load all project documents from Firestore.
 * Queries the entire `projects` collection to enumerate all projects.
 * @returns {Promise<Map<string, object>|null>} Map of projectId -> metadata, or null on error
 */
export async function loadAllProjectsFromFirestore() {
  if (!isFirebaseConfigured() || !db) return null;
  try {
    const sim = simulatedCloudReadFailure('all projects'); if (sim) throw sim;
    const collRef = collection(db, 'projects');
    const snapshot = await getDocs(collRef);
    const projects = new Map();
    snapshot.forEach((docSnap) => {
      projects.set(docSnap.id, docSnap.data());
    });
    return projects;
  } catch (error) {
    console.warn('[PersistenceService] Error loading all projects from Firestore:', error.message);
    recordReadFailure('firestore:allProjects', error);
    return null;
  }
}

/**
 * Load all workspaces for a project from Firestore subcollection.
 * @param {string} projectId
 * @returns {Promise<Map<string, object>|null>} Map of workspaceId -> data
 */
export async function loadAllWorkspacesFromFirestore(projectId) {
  if (!isFirebaseConfigured() || !db) return null;
  try {
    const collRef = collection(db, 'projects', projectId, 'workspaces');
    const snapshot = await getDocs(collRef);
    const workspaces = new Map();
    snapshot.forEach((docSnap) => {
      workspaces.set(docSnap.id, docSnap.data());
    });
    return workspaces;
  } catch (error) {
    console.warn('[PersistenceService] Error loading all workspaces from Firestore:', error.message);
    recordReadFailure('firestore:allWorkspaces', error, { projectId });
    return null;
  }
}

/**
 * Reconcile workspace IDs in a project's metadata with the actual subcollection documents.
 * If any workspace documents exist in the subcollection but are NOT listed in workspaceIds,
 * they are re-added using arrayUnion to restore visibility.
 *
 * This protects against orphaned workspaces caused by array clobber from another device.
 *
 * @param {string} projectId
 * @returns {Promise<string[]>} Array of orphaned workspace IDs that were reconciled (empty if none)
 */
export async function reconcileWorkspaceIds(projectId) {
  if (!isFirebaseConfigured() || !db || !projectId) return [];

  try {
    // 1. Read the project doc to get current workspaceIds
    const projectDoc = await loadProjectFromFirestore(projectId);
    if (!projectDoc) return [];
    const knownIds = new Set(projectDoc.workspaceIds || []);

    // 2. Read all docs from the workspaces subcollection
    const collRef = collection(db, 'projects', projectId, 'workspaces');
    const snapshot = await getDocs(collRef);
    const subcollectionIds = [];
    snapshot.forEach((docSnap) => {
      subcollectionIds.push(docSnap.id);
    });

    // 3. Find orphaned IDs (a live subcollection doc that isn't in workspaceIds),
    //    but NEVER re-attach a workspace that was intentionally deleted recently
    //    (guarded by a local tombstone) - that would resurrect a deletion.
    const orphanedIds = subcollectionIds.filter(id => !knownIds.has(id) && !hasTombstone(projectId, id));

    // 4. Re-add each orphaned ID atomically
    for (const orphanId of orphanedIds) {
      await addWorkspaceIdToFirestore(projectId, orphanId);
      console.info('[PersistenceService] Reconciled orphaned workspace:', orphanId);
    }

    return orphanedIds;
  } catch (error) {
    console.warn('[PersistenceService] Error reconciling workspace IDs:', error.message);
    // Benign: reconcile is itself an orphan-recovery mechanism. Failing it means
    // orphans stay hidden, which is the pre-existing state, not new damage.
    recordReadFailure('firestore:reconcile', error, { projectId });
    return [];
  }
}

/**
 * Save tasks data to Firestore subcollection.
 * Path: projects/{projectId}/tasks/taskData
 * @param {string} projectId
 * @param {object} data - { tasks, taskGroups }
 * @returns {Promise<boolean>}
 */
export async function saveTasksToFirestore(projectId, data) {
  if (viewerMustNotWrite('cloud: task list')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  const path = tasksPath(projectId);
  const confirmedSeq = getDirtySeq(path); // Bug 43: paired with `data` as read
  return guardedFirestoreSave(`projects/${projectId}/tasks/taskData`, async () => {
    try {
      const docRef = doc(db, 'projects', projectId, 'tasks', 'taskData');
      const payload = { tasks: data.tasks || [], taskGroups: data.taskGroups || [] };
      const res = await transactionalWrite({ docRef, path, payload, mergeMode: false });
      if (res.status === 'conflict') {
        emitConflict({ path, kind: 'tasks', projectId, serverRev: res.serverRev, serverData: res.serverData, localData: payload });
        return true; // handled via conflict flow
      }
      confirmSynced(path, res.serverRev, payload, confirmedSeq);
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error saving tasks to Firestore:', error.message);
      noteWriteFailed({ type: 'tasks', projectId });
      return false;
    }
  }, { type: 'tasks', projectId });
}

/**
 * Load tasks data from Firestore subcollection.
 * Path: projects/{projectId}/tasks/taskData
 * @param {string} projectId
 * @returns {Promise<object|null>} - { tasks, taskGroups }
 */
export async function loadTasksFromFirestore(projectId) {
  if (!isFirebaseConfigured() || !db) return null;
  try {
    const sim = simulatedCloudReadFailure('tasks'); if (sim) throw sim;
    const docRef = doc(db, 'projects', projectId, 'tasks', 'taskData');
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading tasks from Firestore:', error.message);
    recordReadFailure('firestore:tasks', error, { projectId });
    return null;
  }
}

/**
 * Save user meta to Firestore.
 * Path: userMeta/main
 * @param {object} meta - { activeProjectId, defaultProjectId }
 * @returns {Promise<boolean>}
 */
export async function saveUserMeta(meta) {
  if (viewerMustNotWrite('cloud: which project is open')) return false;
  if (!isFirebaseConfigured() || !db) return false;
  return guardedFirestoreSave('userMeta/main', async () => {
    try {
      const docRef = doc(db, 'userMeta', 'main');
      await setDoc(docRef, meta, { merge: true });
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error saving userMeta to Firestore:', error.message);
      return false;
    }
  });
}

/**
 * Load user meta from Firestore.
 * Path: userMeta/main
 * @returns {Promise<object|null>} - { activeProjectId, defaultProjectId }
 */
export async function loadUserMeta() {
  if (!isFirebaseConfigured() || !db) return null;
  try {
    const sim = simulatedCloudReadFailure('userMeta'); if (sim) throw sim;
    const docRef = doc(db, 'userMeta', 'main');
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading userMeta from Firestore:', error.message);
    // Worst offender before this fix: init() gates the ENTIRE Firestore phase on
    // `if (userMeta && userMeta.activeProjectId)`. A failure here skipped the
    // cloud silently, fell through to localStorage, and still reported 'synced'.
    recordReadFailure('firestore:userMeta', error);
    return null;
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the persistence layer. Orchestrates the full load sequence:
 * 1. Try loading from Firestore (userMeta -> project -> workspaces -> tasks)
 * 2. If Firestore data found, hydrate localStorage with it
 * 3. Fall back to localStorage cm-* keys if Firestore fails/unavailable
 * 4. If no data exists anywhere, return empty state (caller creates default project)
 * 
 * Memory strategy: Only the active project's workspaces are loaded into memory.
 * 
 * @returns {Promise<{
 *   projects: Map<string, object>,
 *   activeWorkspaces: Map<string, object>,
 *   tasks: Array,
 *   taskGroups: Array,
 *   activeProjectId: string|null,
 *   defaultProjectId: string|null,
 *   source: 'firestore'|'localStorage'
 * }>}
 */
export async function initializePersistence() {
  // Step 1: Try Firestore first
  try {
    const userMeta = await loadUserMeta();
    if (userMeta && userMeta.activeProjectId) {
      const activeProjectId = userMeta.activeProjectId;
      const defaultProjectId = userMeta.defaultProjectId || activeProjectId;

      // Load ALL projects from Firestore (not just the active one)
      const allProjects = await loadAllProjectsFromFirestore();
      if (allProjects && allProjects.size > 0) {
        // Build projects map from all discovered project documents
        const projects = new Map();
        for (const [pid, pmeta] of allProjects) {
          projects.set(pid, pmeta);
        }

        // If the active project was not found in Firestore, fall through to localStorage
        const projectMeta = projects.get(activeProjectId);
        if (!projectMeta) {
          console.warn('[PersistenceService] Active project not found in Firestore projects collection, falling back.');
        } else {
          // Load workspaces only for the active project (performance optimization)
          const workspaceIds = projectMeta.workspaceIds || [];
          const activeWorkspaces = new Map();
          for (const wsId of workspaceIds) {
            const wsData = await loadWorkspaceFromFirestore(activeProjectId, wsId);
            if (wsData) {
              activeWorkspaces.set(wsId, wsData);
            }
          }

          // Load tasks for the active project
          const tasksData = await loadTasksFromFirestore(activeProjectId);
          const tasks = tasksData ? (tasksData.tasks || []) : [];
          const taskGroups = tasksData ? (tasksData.taskGroups || []) : [];

          // Hydrate localStorage with ALL project metadata
          saveMeta({ activeProjectId, defaultProjectId, schemaVersion: SCHEMA_VERSION });
          for (const [pid, pmeta] of projects) {
            // Preserve existing localStorage password hash (passwords are stored
            // only in localStorage and intentionally stripped from Firestore)
            const existingLocal = loadProjectMeta(pid);
            const preservedPassword = existingLocal ? existingLocal.password : null;
            saveProjectMeta(pid, { ...pmeta, password: preservedPassword || pmeta.password || null });
          }
          // Hydrate active project workspace data in localStorage
          for (const [wsId, wsData] of activeWorkspaces) {
            saveWorkspace(activeProjectId, wsId, wsData);
          }
          saveTasks(activeProjectId, { tasks, taskGroups });

          return {
            projects,
            activeWorkspaces,
            tasks,
            taskGroups,
            activeProjectId,
            defaultProjectId,
            source: 'firestore'
          };
        }
      }
    }
  } catch (firestoreErr) {
    console.warn('[PersistenceService] Firestore load failed, falling back to localStorage:', firestoreErr.message);
  }

  // Step 2: Fall back to localStorage cm-* keys
  const meta = loadMeta();
  if (meta && meta.activeProjectId) {
    const activeProjectId = meta.activeProjectId;
    const defaultProjectId = meta.defaultProjectId || activeProjectId;

    // Load all project IDs and their metadata
    const projectIds = loadAllProjectIds();
    const projects = new Map();
    for (const pid of projectIds) {
      const pmeta = loadProjectMeta(pid);
      if (pmeta) {
        projects.set(pid, pmeta);
      }
    }

    // Load workspaces for the active project
    const activeProjectMeta = projects.get(activeProjectId);
    const activeWorkspaces = new Map();
    if (activeProjectMeta && activeProjectMeta.workspaceIds) {
      for (const wsId of activeProjectMeta.workspaceIds) {
        const wsData = loadWorkspace(activeProjectId, wsId);
        if (wsData) {
          activeWorkspaces.set(wsId, wsData);
        }
      }
    }

    // Load tasks
    const tasksData = loadTasks(activeProjectId);
    const tasks = tasksData ? (tasksData.tasks || []) : [];
    const taskGroups = tasksData ? (tasksData.taskGroups || []) : [];

    return {
      projects,
      activeWorkspaces,
      tasks,
      taskGroups,
      activeProjectId,
      defaultProjectId,
      source: 'localStorage'
    };
  }

  // Step 3: Nothing found - return empty state
  return {
    projects: new Map(),
    activeWorkspaces: new Map(),
    tasks: [],
    taskGroups: [],
    activeProjectId: null,
    defaultProjectId: null,
    source: 'localStorage'
  };
}

// =============================================================================
// DEBOUNCED SAVE HELPERS
// =============================================================================

/**
 * Factory that creates a debounced save function.
 * Used by App.jsx to create independent debounce timers:
 * - workspace saves (300ms)
 * - task saves (500ms)
 * - metadata saves (200ms)
 * 
 * Uses clearTimeout/setTimeout pattern similar to the existing saveTimerRef logic.
 * 
 * @param {number} delayMs - Debounce delay in milliseconds
 * @returns {function} A function that accepts a save callback and debounces its execution
 */
export function createDebouncedSaver(delayMs) {
  let timerId = null;

  /**
   * Schedule a save callback to run after the debounce delay.
   * If called again before the delay elapses, the previous pending save is cancelled
   * and only the latest callback will execute.
   * @param {function} saveCallback - The async save function to debounce
   */
  function debouncedSave(saveCallback) {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      if (typeof saveCallback === 'function') {
        saveCallback();
      }
    }, delayMs);
  }

  // Attach a cancel method for cleanup
  debouncedSave.cancel = function () {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return debouncedSave;
}

// =============================================================================
// DEBOUNCED SERVER SAVER (Separate from local saves)
// =============================================================================

/**
 * Factory that creates a debounced server (Firestore) save function.
 * Unlike createDebouncedSaver, this stores the latest save callback so it can
 * be flushed immediately (e.g., before a canvas switch).
 *
 * @param {number} delayMs - Debounce delay in milliseconds (e.g., 3000)
 * @returns {object} An object with { schedule, cancel, flush }
 *   - schedule(saveCallback): Debounce the given async save callback
 *   - cancel(): Cancel any pending debounce timer without executing
 *   - flush(): Immediately execute the pending save callback (if any) and return its Promise
 */
export function createDebouncedServerSaver(delayMs, maxWaitMs = 0) {
  let timerId = null;
  let maxTimerId = null;
  let pendingCallback = null;

  function run() {
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
    if (maxTimerId !== null) { clearTimeout(maxTimerId); maxTimerId = null; }
    const cb = pendingCallback;
    pendingCallback = null;
    if (typeof cb === 'function') return cb();
  }

  function schedule(saveCallback) {
    pendingCallback = saveCallback;
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(run, delayMs);
    // Maximum-wait ceiling: even during nonstop editing, force an upload after
    // maxWaitMs so the cloud is never more than ~maxWaitMs behind. The ceiling
    // is armed on the first change of a burst and not reset by later changes.
    if (maxWaitMs > 0 && maxTimerId === null) {
      maxTimerId = setTimeout(run, maxWaitMs);
    }
  }

  function cancel() {
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
    if (maxTimerId !== null) { clearTimeout(maxTimerId); maxTimerId = null; }
    pendingCallback = null;
  }

  function flush() {
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
    if (maxTimerId !== null) { clearTimeout(maxTimerId); maxTimerId = null; }
    const cb = pendingCallback;
    pendingCallback = null;
    if (typeof cb === 'function') {
      return Promise.resolve(cb());
    }
    return Promise.resolve();
  }

  return { schedule, cancel, flush };
}

// =============================================================================
// FLUSH ALL PENDING SERVER SAVES
// =============================================================================

// Registry of all active server savers so we can flush them all at once.
const registeredServerSavers = [];

/**
 * Register a server saver instance so it can be flushed globally.
 * @param {object} saver - A saver object returned by createDebouncedServerSaver
 */
export function registerServerSaver(saver) {
  if (!registeredServerSavers.includes(saver)) {
    registeredServerSavers.push(saver);
  }
}

/**
 * Unregister a server saver instance (e.g., on component unmount).
 * Prevents dead saver references from accumulating in the registry.
 * @param {object} saver - A saver object to remove from the registry
 */
export function unregisterServerSaver(saver) {
  const idx = registeredServerSavers.indexOf(saver);
  if (idx !== -1) {
    registeredServerSavers.splice(idx, 1);
  }
}

/**
 * Immediately flush all registered debounced server savers.
 * Returns a Promise that resolves when all pending Firestore writes complete.
 * @returns {Promise<void>}
 */
export function flushPendingServerSaves() {
  return Promise.all(registeredServerSavers.map(s => s.flush()));
}

/**
 * Sanitize workspace images for persistence by stripping blob: URLs.
 * Blob URLs are ephemeral (valid only in the current browser session) and must
 * not be persisted to localStorage or Firestore.
 *
 * - If an image has a blob: URL and a `src` field (permanent URL), remove `url`.
 * - If an image has a blob: URL but no `src`, set `url` to undefined.
 * - Otherwise, keep the image unchanged.
 *
 * @param {Array} images - Array of image objects from a workspace
 * @returns {Array} Sanitized images array safe for persistence
 */
export function sanitizeWorkspaceImages(images) {
  return (images || []).map(im => {
    const isBlobUrl = im.url && im.url.startsWith('blob:');
    if (isBlobUrl && im.src) {
      const { url, ...rest } = im;
      return rest;
    }
    if (isBlobUrl && !im.src) {
      return { ...im, url: undefined };
    }
    return im;
  });
}

/**
 * Perform a full manual Firestore sync of the current project state.
 * Reads all data from localStorage (which is always up-to-date since autosave
 * writes immediately) to avoid stale closure state from React useCallback.
 *
 * @param {string} activeProjectId
 * @returns {Promise<boolean>} true if all saves succeeded, false if any failed
 */
export async function manualServerSync(activeProjectId) {
  if (viewerMustNotWrite('manual sync')) return false;
  if (!isFirebaseConfigured() || !db || !activeProjectId) return false;

  // First flush any pending debounced saves
  await flushPendingServerSaves();

  try {
    const projMeta = loadProjectMeta(activeProjectId);
    if (!projMeta) return false;

    const workspaceIds = projMeta.workspaceIds || [];

    // Read fresh workspace data from localStorage
    const workspaces = [];
    for (const wsId of workspaceIds) {
      const wsData = loadWorkspace(activeProjectId, wsId);
      if (wsData) {
        workspaces.push(wsData);
      }
    }

    // Read fresh tasks data from localStorage
    const tasksData = loadTasks(activeProjectId);
    const tasks = tasksData ? (tasksData.tasks || []) : [];
    const taskGroups = tasksData ? (tasksData.taskGroups || []) : [];

    const updatedMeta = {
      ...projMeta,
      workspaceIds: workspaces.map(ws => ws.id),
      lastModified: Date.now()
    };

    // Fix 5b: EVERY document is attempted, and the overall result is reported at
    // the end. This function used to `return false` the moment one write failed,
    // and project metadata is written first - so a single failing metadata write
    // meant no canvas was uploaded at all. That is what left the owner's canvas
    // stuck on "Syncing…" for two minutes in test D2 while its content sat
    // un-uploaded; adding another card went green only because that took a
    // different, per-canvas route. A failure on one document is no reason to
    // abandon the others.
    let allOk = true;

    // Save project metadata (note: saveProjectToFirestore intentionally strips
    // workspaceIds; we re-assert them additively below so this manual sync can
    // never remove a workspace another device added).
    const metaResult = await saveProjectToFirestore(activeProjectId, updatedMeta);
    if (!metaResult) allOk = false;
    await ensureWorkspaceIds(activeProjectId, workspaces.map(ws => ws.id));

    // Save all workspaces (skip unchanged ones to avoid spurious revision bumps)
    for (const ws of workspaces) {
      const syncKey = `${activeProjectId}/${ws.id}`;
      const lastSynced = _lastSyncedTimestamps.get(syncKey);
      const wsLastModified = ws.lastModified || 0;
      // Skip this workspace if its lastModified matches the last successful sync
      if (lastSynced && wsLastModified <= lastSynced) {
        continue;
      }
      const wsPayload = {
        id: ws.id,
        name: ws.name || 'Workspace',
        nodes: ws.nodes || [],
        edges: ws.edges || [],
        groups: ws.groups || [],
        pins: ws.pins || [],
        images: sanitizeWorkspaceImages(ws.images),
        lastModified: Date.now()
      };
      const wsResult = await saveWorkspaceToFirestore(activeProjectId, ws.id, wsPayload);
      if (!wsResult) allOk = false;
    }

    // Save tasks
    const tasksResult = await saveTasksToFirestore(activeProjectId, { tasks, taskGroups });
    if (!tasksResult) allOk = false;

    // Save userMeta
    await saveUserMeta({ activeProjectId });

    // Also update localStorage with latest metadata
    saveProjectMeta(activeProjectId, updatedMeta);

    return allOk;
  } catch (error) {
    console.warn('[PersistenceService] manualServerSync failed:', error.message);
    return false;
  }
}


// =============================================================================
// FRESHNESS PROBE - used by read-before-write (return triggers + background poll)
// =============================================================================

/**
 * Fetch the current server state needed to decide whether this device is behind.
 * Returns the project metadata document (with its revision + workspaceIds) and,
 * if a workspaceId is given, that workspace document (with its revision + data).
 *
 * The caller compares these revisions against its local baseRev (getSyncState)
 * to decide whether to silently adopt the cloud copy (clean docs) or route to
 * the conflict flow (dirty docs).
 *
 * @param {string} projectId
 * @param {string} [workspaceId]
 * @returns {Promise<{ metaRev: number|null, metaData: object|null, wsRev: number|null, wsData: object|null }>}
 */
export async function fetchServerFreshness(projectId, workspaceId) {
  const out = { metaRev: null, metaData: null, wsRev: null, wsData: null };
  if (!isFirebaseConfigured() || !db || !projectId) return out;
  try {
    const meta = await loadProjectFromFirestore(projectId);
    if (meta) { out.metaData = meta; out.metaRev = meta.revision || 0; }
    if (workspaceId) {
      const ws = await loadWorkspaceFromFirestore(projectId, workspaceId);
      if (ws) { out.wsData = ws; out.wsRev = ws.revision || 0; }
    }
  } catch (error) {
    console.warn('[PersistenceService] fetchServerFreshness failed:', error.message);
    // Benign for the load verdict, but note the consequence: `out` still has
    // all-null revisions, so the caller concludes "the server has nothing
    // newer". That belongs to the Fix 5 honest-sync work, not here.
    recordReadFailure('firestore:freshness', error, { projectId, workspaceId });
  }
  return out;
}


// =============================================================================
// VERSION HISTORY (Phase 3) - dated, restorable project snapshots
// =============================================================================
//
// Snapshots are stored at:  projects/{projectId}/snapshots/{stamp}
// where {stamp} is the REAL local date-time "YYYY-MM-DD_HH-mm-ss" (NOT v1/v2,
// NOT a session/window counter). Each snapshot is a full, self-consistent
// restore point for the whole project.
//
// - Auto snapshots are throttled to at most one per ~10 minutes of active syncing.
// - Retention: newest 30 are kept; older ones are pruned.
// - Timezone: the id uses this device's LOCAL clock; createdAtUtc (epoch ms) is
//   also stored so ordering is unambiguous across devices/timezones.
// - Images are captured as URLs only (no byte copies) - a documented limitation:
//   restoring after the underlying Storage file was deleted shows a broken image.
// - Cloud doc limit is ~1MB; very large projects may fail to snapshot (caught and
//   skipped) - those still have localStorage + conflict backups.
// =============================================================================

const KEY_LAST_SNAPSHOT = 'cm-last-snapshot';
const SNAPSHOT_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SNAPSHOT_KEEP = 30;
let _syncedSinceSnapshot = false;

/** Local wall-clock stamp "YYYY-MM-DD_HH-mm-ss". */
function snapshotStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/** Assemble a full, self-consistent project restore point from localStorage. */
function buildProjectSnapshotData(projectId) {
  const meta = loadProjectMeta(projectId);
  if (!meta) return null;
  const wsIds = meta.workspaceIds || [];
  const workspaces = [];
  for (const id of wsIds) {
    const w = loadWorkspace(projectId, id);
    if (w) {
      workspaces.push({
        id: w.id || id, name: w.name || 'Workspace',
        nodes: w.nodes || [], edges: w.edges || [], groups: w.groups || [],
        pins: w.pins || [], images: sanitizeWorkspaceImages(w.images)
      });
    }
  }
  const t = loadTasks(projectId) || { tasks: [], taskGroups: [] };
  return {
    meta: {
      name: meta.name || 'Untitled', description: meta.description || '',
      activeTab: meta.activeTab || wsIds[0] || '', nextId: meta.nextId || 10,
      reminders: meta.reminders || [], pinGroups: meta.pinGroups || [], workspaceIds: wsIds
    },
    workspaces,
    tasks: t.tasks || [], taskGroups: t.taskGroups || []
  };
}

/**
 * Create a version snapshot now (bypasses throttle). Returns the stamp id or null.
 * @param {string} projectId
 * @param {'auto'|'manual'|'conflict-backup'|'pre-restore'} reason
 */
export async function createSnapshot(projectId, reason = 'auto') {
  if (viewerMustNotWrite('cloud: version snapshot')) return null;
  if (!isFirebaseConfigured() || !db || !projectId) return null;
  const data = buildProjectSnapshotData(projectId);
  if (!data) return null;
  let stamp = snapshotStamp();
  // Burst-prone reasons can collide within the same second - add a short suffix.
  if (reason === 'conflict-backup' || reason === 'pre-restore') {
    stamp += '-' + Math.floor(10 + Math.random() * 89);
  }
  try {
    await setDoc(doc(db, 'projects', projectId, 'snapshots', stamp), {
      stamp, createdAtUtc: Date.now(), device: getDeviceLabel(), reason,
      projectName: data.meta.name, data
    });
    try { localStorage.setItem(KEY_LAST_SNAPSHOT, String(Date.now())); } catch { /* ignore */ }
    _syncedSinceSnapshot = false;
    pruneSnapshots(projectId, SNAPSHOT_KEEP).catch(() => {});
    return stamp;
  } catch (error) {
    console.warn('[PersistenceService] createSnapshot failed (project may exceed the 1MB cloud limit):', error.message);
    return null;
  }
}

/**
 * Create an auto snapshot only if (a) there has been a successful cloud sync
 * since the last snapshot and (b) at least ~10 minutes have passed. Forced
 * reasons bypass both checks.
 */
export async function maybeSnapshot(projectId, reason = 'auto') {
  if (!isFirebaseConfigured() || !db || !projectId) return null;
  if (reason === 'auto') {
    if (!_syncedSinceSnapshot) return null;
    let last = 0;
    try { last = parseInt(localStorage.getItem(KEY_LAST_SNAPSHOT) || '0', 10) || 0; } catch { /* ignore */ }
    if (Date.now() - last < SNAPSHOT_MIN_INTERVAL_MS) return null;
  }
  return await createSnapshot(projectId, reason);
}

/** List snapshots (metadata only) for a project, newest first. */
export async function listSnapshots(projectId) {
  if (!isFirebaseConfigured() || !db || !projectId) return [];
  try {
    const snap = await getDocs(collection(db, 'projects', projectId, 'snapshots'));
    const out = [];
    snap.forEach((d) => {
      const v = d.data();
      out.push({ id: d.id, stamp: v.stamp || d.id, device: v.device || '?', reason: v.reason || 'auto', createdAtUtc: v.createdAtUtc || 0, projectName: v.projectName || '' });
    });
    out.sort((a, b) => (b.createdAtUtc || 0) - (a.createdAtUtc || 0));
    return out;
  } catch (error) {
    console.warn('[PersistenceService] listSnapshots failed:', error.message);
    return [];
  }
}

/** Load a full snapshot document (including its data payload). */
export async function loadSnapshot(projectId, stampId) {
  if (!isFirebaseConfigured() || !db || !projectId) return null;
  try {
    const d = await getDoc(doc(db, 'projects', projectId, 'snapshots', stampId));
    return d.exists() ? d.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] loadSnapshot failed:', error.message);
    recordReadFailure('firestore:snapshot', error, { projectId, stampId });
    return null;
  }
}

/** Keep only the newest `keep` snapshots; delete the rest. */
export async function pruneSnapshots(projectId, keep = SNAPSHOT_KEEP) {
  if (!isFirebaseConfigured() || !db || !projectId) return;
  try {
    const snap = await getDocs(collection(db, 'projects', projectId, 'snapshots'));
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, at: (d.data().createdAtUtc) || 0 }));
    if (items.length <= keep) return;
    items.sort((a, b) => b.at - a.at);
    for (const it of items.slice(keep)) {
      await deleteDoc(doc(db, 'projects', projectId, 'snapshots', it.id));
    }
  } catch { /* best effort */ }
}
