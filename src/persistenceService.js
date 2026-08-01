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
  } catch { /* fall through to regenerate */ }
  const identity = { id: generateId(), name: null };
  try { localStorage.setItem(KEY_DEVICE, JSON.stringify(identity)); } catch { /* ignore */ }
  return identity;
}

/** Set (or change) the friendly device name, preserving the hidden id. */
export function setDeviceName(name) {
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
  } catch { return {}; }
}

function saveSyncStateMap(map) {
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

/** Mark a document dirty (local edit made) and record its current fingerprint. */
export function markDirty(path, content) {
  const map = loadSyncStateMap();
  const prev = map[path] || { baseRev: null, dirty: false, syncedHash: null };
  map[path] = { ...prev, dirty: true, currentHash: content ? computeContentHash(content) : prev.currentHash };
  saveSyncStateMap(map);
}

/** Timestamp (ms) of the most recent confirmed successful cloud write. */
let _lastCloudSyncAt = 0;

/** Get the timestamp of the last confirmed successful cloud write (0 if none). */
export function getLastCloudSyncAt() { return _lastCloudSyncAt; }

/** After a confirmed successful upload: advance baseRev, clear dirty, record synced hash. */
export function confirmSynced(path, newServerRev, content) {
  const map = loadSyncStateMap();
  const prev = map[path] || {};
  map[path] = {
    baseRev: typeof newServerRev === 'number' ? newServerRev : (prev.baseRev || 0),
    dirty: false,
    syncedHash: content ? computeContentHash(content) : prev.syncedHash
  };
  saveSyncStateMap(map);
  _lastCloudSyncAt = Date.now();
  _syncedSinceSnapshot = true;
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
  } catch { return {}; }
}

function saveTombstones(map) {
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
  } catch {
    return null;
  }
}

/**
 * Save the meta object.
 * @param {object} meta - { activeProjectId, defaultProjectId, schemaVersion }
 */
export function saveMeta(meta) {
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
  } catch {
    return null;
  }
}

/**
 * Save project metadata.
 * @param {string} projectId
 * @param {object} data
 */
export function saveProjectMeta(projectId, data) {
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
  } catch {
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
  localStorage.setItem(KEY_WORKSPACE_PREFIX + projectId + '-' + workspaceId, JSON.stringify(data));
}

/**
 * Remove a workspace key from localStorage.
 * @param {string} projectId
 * @param {string} workspaceId
 */
export function removeWorkspaceLocal(projectId, workspaceId) {
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
  } catch {
    return null;
  }
}

/**
 * Save tasks and taskGroups for a project.
 * @param {string} projectId
 * @param {object} data - { tasks, taskGroups }
 */
export function saveTasks(projectId, data) {
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
const firestoreWriteQueues = new Map(); // Map<string, { inFlight: boolean, queued: Function|null }>

// =============================================================================
// RETRY QUEUE - Persist failed Firestore writes for later retry
// =============================================================================

const RETRY_QUEUE_KEY = 'cm-retry-queue';
const MAX_RETRY_COUNT = 5;
const MAX_BACKOFF_MS = 30000;

/**
 * Load the retry queue from localStorage.
 * @returns {Array} Array of queued write entries
 */
function loadRetryQueue() {
  try {
    const raw = localStorage.getItem(RETRY_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Persist the retry queue to localStorage.
 * @param {Array} queue
 */
function saveRetryQueue(queue) {
  try {
    localStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // If localStorage is full, log and move on
    console.warn('[PersistenceService] Could not persist retry queue to localStorage');
  }
}

/**
 * Enqueue a failed write for later retry.
 * Skipped during retry processing to avoid duplicates.
 * @param {object} entry - { type: 'project'|'workspace'|'tasks', projectId, workspaceId?, data }
 */
let _isProcessingRetryQueue = false;

function enqueueFailedWrite(entry) {
  // Do not enqueue during retry processing - the retry loop handles re-queuing itself
  if (_isProcessingRetryQueue) return;
  const queue = loadRetryQueue();
  queue.push({
    id: generateId(),
    type: entry.type,
    projectId: entry.projectId,
    workspaceId: entry.workspaceId || null,
    data: entry.data,
    timestamp: Date.now(),
    retryCount: 0
  });
  saveRetryQueue(queue);
}

/**
 * Process the retry queue with exponential backoff.
 * Retries each entry up to MAX_RETRY_COUNT times with delays of 1s, 2s, 4s, 8s, 16s (capped at 30s).
 * Entries exceeding the retry limit are discarded with a warning.
 * @returns {Promise<void>}
 */
export async function processRetryQueue() {
  if (!isFirebaseConfigured() || !db) return;

  const queue = loadRetryQueue();
  if (queue.length === 0) return;

  _isProcessingRetryQueue = true;
  const remaining = [];

  for (const entry of queue) {
    if (entry.retryCount >= MAX_RETRY_COUNT) {
      console.warn('[PersistenceService] Retry limit reached, discarding failed write:', entry.type, entry.projectId, entry.workspaceId || '');
      continue;
    }

    // Calculate backoff delay: 1s * 2^retryCount, capped at MAX_BACKOFF_MS
    const backoffMs = Math.min(1000 * Math.pow(2, entry.retryCount), MAX_BACKOFF_MS);
    const elapsed = Date.now() - entry.timestamp;

    // Only retry if enough time has passed since last attempt
    if (elapsed < backoffMs) {
      remaining.push(entry);
      continue;
    }

    let success = false;
    try {
      if (entry.type === 'project') {
        success = await saveProjectToFirestore(entry.projectId, entry.data);
      } else if (entry.type === 'workspace') {
        success = await saveWorkspaceToFirestore(entry.projectId, entry.workspaceId, entry.data);
      } else if (entry.type === 'tasks') {
        success = await saveTasksToFirestore(entry.projectId, entry.data);
      }
    } catch {
      success = false;
    }

    if (!success) {
      // Update retry count and timestamp for next attempt
      remaining.push({
        ...entry,
        retryCount: entry.retryCount + 1,
        timestamp: Date.now()
      });
    }
    // If success, entry is dropped from queue (not re-added)
  }

  _isProcessingRetryQueue = false;
  saveRetryQueue(remaining);

  // If there are still items remaining, schedule another pass
  if (remaining.length > 0) {
    const nextDelay = Math.min(1000 * Math.pow(2, Math.min(...remaining.map(e => e.retryCount))), MAX_BACKOFF_MS);
    setTimeout(() => processRetryQueue(), nextDelay);
  }
}
async function guardedFirestoreSave(path, saveFn) {
  if (!firestoreWriteQueues.has(path)) {
    firestoreWriteQueues.set(path, { inFlight: false, queued: null });
  }
  const slot = firestoreWriteQueues.get(path);

  if (slot.inFlight) {
    slot.queued = saveFn;
    return true;
  }

  slot.inFlight = true;
  try {
    const result = await saveFn();
    return result;
  } finally {
    slot.inFlight = false;
    if (slot.queued) {
      const nextSave = slot.queued;
      slot.queued = null;
      guardedFirestoreSave(path, nextSave).catch(() => {});
    }
  }
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
  if (!isFirebaseConfigured() || !db) return false;
  const path = metaPath(projectId);
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
      confirmSynced(path, res.serverRev, payload);
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error saving project to Firestore:', error.message);
      enqueueFailedWrite({ type: 'project', projectId, data: metadata });
      return false;
    }
  });
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
    const docRef = doc(db, 'projects', projectId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading project from Firestore:', error.message);
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
  if (!isFirebaseConfigured() || !db) return false;
  const path = wsPath(projectId, workspaceId);
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
      confirmSynced(path, res.serverRev, payload);
      _lastSyncedTimestamps.set(`${projectId}/${workspaceId}`, data.lastModified || Date.now());
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error saving workspace to Firestore:', error.message);
      enqueueFailedWrite({ type: 'workspace', projectId, workspaceId, data });
      return false;
    }
  });
}

/**
 * Delete a workspace document from Firestore subcollection.
 * @param {string} projectId
 * @param {string} workspaceId
 * @returns {Promise<boolean>}
 */
export async function deleteWorkspaceFromFirestore(projectId, workspaceId) {
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
    const docRef = doc(db, 'projects', projectId, 'workspaces', workspaceId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading workspace from Firestore:', error.message);
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
    const collRef = collection(db, 'projects');
    const snapshot = await getDocs(collRef);
    const projects = new Map();
    snapshot.forEach((docSnap) => {
      projects.set(docSnap.id, docSnap.data());
    });
    return projects;
  } catch (error) {
    console.warn('[PersistenceService] Error loading all projects from Firestore:', error.message);
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
  if (!isFirebaseConfigured() || !db) return false;
  const path = tasksPath(projectId);
  return guardedFirestoreSave(`projects/${projectId}/tasks/taskData`, async () => {
    try {
      const docRef = doc(db, 'projects', projectId, 'tasks', 'taskData');
      const payload = { tasks: data.tasks || [], taskGroups: data.taskGroups || [] };
      const res = await transactionalWrite({ docRef, path, payload, mergeMode: false });
      if (res.status === 'conflict') {
        emitConflict({ path, kind: 'tasks', projectId, serverRev: res.serverRev, serverData: res.serverData, localData: payload });
        return true; // handled via conflict flow
      }
      confirmSynced(path, res.serverRev, payload);
      return true;
    } catch (error) {
      console.warn('[PersistenceService] Error saving tasks to Firestore:', error.message);
      enqueueFailedWrite({ type: 'tasks', projectId, data });
      return false;
    }
  });
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
    const docRef = doc(db, 'projects', projectId, 'tasks', 'taskData');
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading tasks from Firestore:', error.message);
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
    const docRef = doc(db, 'userMeta', 'main');
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.warn('[PersistenceService] Error loading userMeta from Firestore:', error.message);
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

    // Save project metadata (note: saveProjectToFirestore intentionally strips
    // workspaceIds; we re-assert them additively below so this manual sync can
    // never remove a workspace another device added).
    const metaResult = await saveProjectToFirestore(activeProjectId, updatedMeta);
    if (!metaResult) return false;
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
      if (!wsResult) return false;
    }

    // Save tasks
    const tasksResult = await saveTasksToFirestore(activeProjectId, { tasks, taskGroups });
    if (!tasksResult) return false;

    // Save userMeta
    await saveUserMeta({ activeProjectId });

    // Also update localStorage with latest metadata
    saveProjectMeta(activeProjectId, updatedMeta);

    return true;
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
