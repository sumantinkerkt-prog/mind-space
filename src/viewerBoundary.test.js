// =============================================================================
// The viewer boundary (Fix 6, second attempt)
// =============================================================================
// EDITOR <-> SERVER: read and write.   VIEWER <- SERVER: read only.
//
// The first attempt guarded call sites in App.jsx and still leaked, because the
// load sequence writes the local cache and the sync bookkeeping from about a dozen
// places. So the rule now lives at the boundary, and this file proves it there.
//
// Every test runs TWICE by design: once as a viewer (must write nothing) and once
// as an editor (must write). Without the editor half, a boundary that blocked
// everything for everyone would pass, and the app would be broken.
// =============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const cloud = new Map();
let cloudWrites = [];

vi.mock('./firebase', () => ({
  db: { fake: true },
  storage: { fake: true },
  isFirebaseConfigured: () => true,
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  collection: (_db, ...parts) => ({ path: parts.join('/') }),
  runTransaction: async (_db, cb) => cb({
    get: async (ref) => ({ exists: () => cloud.has(ref.path), data: () => cloud.get(ref.path) }),
    set: (ref, data) => { cloudWrites.push(ref.path); cloud.set(ref.path, data); },
  }),
  serverTimestamp: () => 'server-time',
  getDoc: async () => ({ exists: () => false, data: () => null }),
  getDocs: async () => ({ docs: [], forEach: () => {} }),
  setDoc: async (ref) => { cloudWrites.push('setDoc:' + ref.path); },
  deleteDoc: async (ref) => { cloudWrites.push('deleteDoc:' + ref.path); },
  updateDoc: async (ref) => { cloudWrites.push('updateDoc:' + ref.path); },
  increment: (n) => n,
  arrayUnion: (...a) => a,
  arrayRemove: (...a) => a,
}));

const P = await import('./persistenceService.js');
const { SESSION_ROLE } = await import('./sessionRole.js');

const PID = 'p1';
const WID = 'w1';
let store;

/** Everything stored, so "did anything change?" is a single comparison. */
const snapshot = () => JSON.stringify([...store.entries()].sort());

const asRole = (role) => P.setSessionRole(role);

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  });
  cloud.clear();
  cloudWrites = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Start from a realistic stored project, written as an editor.
  asRole(SESSION_ROLE.EDITOR);
  P.saveMeta({ activeProjectId: PID, defaultProjectId: PID, schemaVersion: 2 });
  P.saveProjectMeta(PID, { id: PID, name: 'Test', activeTab: WID, nextId: 10, reminders: [], pinGroups: [], workspaceIds: [WID] });
  P.saveWorkspace(PID, WID, { id: WID, name: 'Canvas', nodes: [{ id: 1, title: 'real card' }], edges: [], groups: [], pins: [], images: [], lastModified: 1 });
  P.saveTasks(PID, { tasks: [], taskGroups: [] });
  P.seedSyncState(P.wsPath(PID, WID), 5, { nodes: [] });
});

// --- localStorage -----------------------------------------------------------

describe('a viewer writes nothing to local storage', () => {
  const localWriters = [
    ['the open-project pointer', () => P.saveMeta({ activeProjectId: 'HACKED' })],
    ['project settings',         () => P.saveProjectMeta(PID, { id: PID, name: 'HACKED', nextId: 999 })],
    ['a canvas',                 () => P.saveWorkspace(PID, WID, { id: WID, name: 'HACKED', nodes: [] })],
    ['removing a canvas',        () => P.removeWorkspaceLocal(PID, WID)],
    ['the task list',            () => P.saveTasks(PID, { tasks: [{ id: 't', title: 'HACKED' }], taskGroups: [] })],
    ['marking something unsaved', () => P.markDirty(P.wsPath(PID, WID), { nodes: [] })],
    ['seeding sync bookkeeping', () => P.seedSyncState(P.wsPath(PID, WID), 99, { nodes: [] })],
    ['confirming a save',        () => P.confirmSynced(P.wsPath(PID, WID), 99, { nodes: [] }, 1)],
    ['rebasing local edits',     () => P.rebaseDirty(P.wsPath(PID, WID), 99)],
    ['the device name',          () => P.setDeviceName('HACKED')],
  ];

  it.each(localWriters)('refuses: %s', (_label, write) => {
    asRole(SESSION_ROLE.VIEWER);
    const before = snapshot();
    write();
    expect(snapshot()).toBe(before);
  });

  it.each(localWriters)('but an editor still does it: %s', (_label, write) => {
    asRole(SESSION_ROLE.EDITOR);
    const before = snapshot();
    write();
    expect(snapshot()).not.toBe(before);
  });
});

describe('the writes that actually leaked in the owner\'s test', () => {
  // The load sequence adopts cloud data by calling these directly - which is how a
  // View tab changed four canvases and the sync bookkeeping despite the App-level
  // guards. They are the reason the rule moved to the boundary.
  it('adopting a cloud canvas into the local cache is refused', () => {
    asRole(SESSION_ROLE.VIEWER);
    const before = snapshot();
    P.saveWorkspace(PID, WID, { id: WID, name: 'from the cloud', nodes: [{ id: 9 }] });
    P.seedSyncState(P.wsPath(PID, WID), 42, { nodes: [{ id: 9 }] });
    expect(snapshot()).toBe(before);
    // and the local copy still holds what it held before
    expect(P.loadWorkspace(PID, WID).nodes[0].title).toBe('real card');
  });

  it('hydrating project settings from the cloud is refused', () => {
    asRole(SESSION_ROLE.VIEWER);
    P.saveProjectMeta(PID, { id: PID, name: 'from the cloud', reminders: [] });
    expect(P.loadProjectMeta(PID).name).toBe('Test');
  });
});

// --- Firestore --------------------------------------------------------------

describe('a viewer sends nothing to the cloud', () => {
  const cloudWriters = [
    ['project settings',   () => P.saveProjectToFirestore(PID, { id: PID, name: 'HACKED' })],
    ['a canvas',           () => P.saveWorkspaceToFirestore(PID, WID, { id: WID, nodes: [] })],
    ['the task list',      () => P.saveTasksToFirestore(PID, { tasks: [], taskGroups: [] })],
    ['the user pointer',   () => P.saveUserMeta({ activeProjectId: PID })],
    ['the canvas list',    () => P.ensureWorkspaceIds(PID, [WID])],
    ['adding to the list', () => P.addWorkspaceIdToFirestore(PID, 'w2')],
    ['removing from it',   () => P.removeWorkspaceIdFromFirestore(PID, WID)],
    ['deleting a canvas',  () => P.deleteWorkspaceFromFirestore(PID, WID)],
    ['deleting a project', () => P.deleteProjectFromFirestore(PID, [WID])],
    ['a manual sync',      () => P.manualServerSync(PID)],
    ['a version snapshot', () => P.createSnapshot(PID, 'manual')],
    ['draining retries',   () => P.processRetryQueue()],
  ];

  it.each(cloudWriters)('refuses: %s', async (_label, write) => {
    asRole(SESSION_ROLE.VIEWER);
    const before = snapshot();
    await write();
    expect(cloudWrites).toEqual([]);
    expect(cloud.size).toBe(0);
    expect(snapshot()).toBe(before); // and no local side effects either
  });

  it('but an editor really does upload', async () => {
    asRole(SESSION_ROLE.EDITOR);
    P.markDirty(P.wsPath(PID, WID), { nodes: [] });
    const ok = await P.saveWorkspaceToFirestore(PID, WID, { id: WID, name: 'Canvas', nodes: [] });
    expect(ok).toBe(true);
    expect(cloudWrites.length).toBeGreaterThan(0);
  });
});

// --- reads, and the role itself ---------------------------------------------

describe('a viewer can still read everything', () => {
  it('reads local data normally', () => {
    asRole(SESSION_ROLE.VIEWER);
    expect(P.loadMeta().activeProjectId).toBe(PID);
    expect(P.loadProjectMeta(PID).name).toBe('Test');
    expect(P.loadWorkspace(PID, WID).nodes[0].title).toBe('real card');
    expect(P.loadTasks(PID)).toEqual({ tasks: [], taskGroups: [] });
    expect(P.getSyncState(P.wsPath(PID, WID)).baseRev).toBe(5);
    expect(P.isDirty(P.wsPath(PID, WID))).toBe(false);
  });

  it('reports what it refused, for diagnostics', () => {
    asRole(SESSION_ROLE.VIEWER);
    P.saveWorkspace(PID, WID, { id: WID, nodes: [] });
    expect(P.refusedWriteKinds().length).toBeGreaterThan(0);
  });
});

describe('the role itself', () => {
  it('is a viewer only when told so, or when the URL says /view/', () => {
    asRole(SESSION_ROLE.VIEWER);
    expect(P.sessionIsViewer()).toBe(true);
    asRole(SESSION_ROLE.EDITOR);
    expect(P.sessionIsViewer()).toBe(false);
  });

  it('falls back to the URL when nothing has been set', () => {
    P.setSessionRole(null);
    vi.stubGlobal('location', { hash: '#/view/p1/w1', pathname: '/' });
    expect(P.sessionIsViewer()).toBe(true);
    vi.stubGlobal('location', { hash: '#/editor/p1/w1', pathname: '/' });
    expect(P.sessionIsViewer()).toBe(false);
  });
});
