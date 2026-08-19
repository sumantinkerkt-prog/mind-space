// =============================================================================
// Fix 5b - end-to-end behaviour of the failed-write queue
// =============================================================================
// retryQueue.test.js covers the decision rules in isolation. This file drives
// the REAL persistenceService against a fake Firestore and a fake localStorage,
// because the defects being fixed were in the wiring, not in the rules:
//
//   - a queued retry uploaded a FROZEN copy of the document,
//   - the queue grew one entry per failed attempt,
//   - manualServerSync abandoned every canvas when the metadata write failed,
//   - a failed metadata write left nothing marked unsaved, so the status chip
//     stayed green and the retry policy could not tell pending from saved.
//
// Write failures are produced with the app's own `cm-debug-fail-cloud-write`
// switch, so the failures travel the same path they do in the owner's browser.
// =============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Fake Firestore documents, keyed by path. */
const cloud = new Map();
/** Paths whose transaction should throw, for per-document failure. */
const failPaths = new Set();
/** Every transaction attempt, so "no write happened" is provable. */
let attempts = [];

vi.mock('./firebase', () => ({
  db: { fake: true },
  storage: { fake: true },
  isFirebaseConfigured: () => true,
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  collection: (_db, ...parts) => ({ path: parts.join('/') }),
  runTransaction: async (_db, cb) => cb({
    get: async (ref) => ({
      exists: () => cloud.has(ref.path),
      data: () => cloud.get(ref.path),
    }),
    set: (ref, data, opts) => {
      attempts.push(ref.path);
      if (failPaths.has(ref.path)) throw new Error('simulated per-document failure');
      cloud.set(ref.path, opts && opts.merge ? { ...(cloud.get(ref.path) || {}), ...data } : data);
    },
  }),
  serverTimestamp: () => 'server-time',
  getDoc: async () => ({ exists: () => false, data: () => null }),
  getDocs: async () => ({ docs: [], forEach: () => {} }),
  setDoc: async () => {},
  deleteDoc: async () => {},
  updateDoc: async () => {},
  increment: (n) => n,
  arrayUnion: (...a) => a,
  arrayRemove: (...a) => a,
}));

const {
  saveProjectMeta, saveWorkspace, saveTasks, loadWorkspace,
  saveWorkspaceToFirestore, saveProjectToFirestore,
  processRetryQueue, manualServerSync,
  markDirty, isDirty, seedSyncState, wsPath, metaPath, tasksPath,
} = await import('./persistenceService.js');

const P = 'p1';
const W = 'w1';
const WS_DOC = `projects/${P}/workspaces/${W}`;
const META_DOC = `projects/${P}`;
const QUEUE_KEY = 'cm-retry-queue';

const queue = () => JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
const failWritesEverywhere = (on) => {
  if (on) localStorage.setItem('cm-debug-fail-cloud-write', '1');
  else localStorage.removeItem('cm-debug-fail-cloud-write');
};
const wsBody = (title) => ({ id: W, name: 'Canvas One', nodes: [{ id: 1, title }], edges: [], groups: [], pins: [], images: [], lastModified: Date.now() });
/** Jump forward past any backoff, without making the suite sleep. */
const advanceClock = async (ms, fn) => {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ms);
  try { return await fn(); } finally { spy.mockRestore(); }
};

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  });
  cloud.clear();
  failPaths.clear();
  attempts = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});

  saveProjectMeta(P, { id: P, name: 'Test Project', activeTab: W, nextId: 10, reminders: [], pinGroups: [], workspaceIds: [W] });
  saveWorkspace(P, W, wsBody('original'));
  saveTasks(P, { tasks: [], taskGroups: [] });
});

describe('a failed cloud write is recorded honestly', () => {
  it('marks the document unsaved, so the status chip cannot stay green', async () => {
    seedSyncState(wsPath(P, W), 3, wsBody('original')); // clean to start with
    expect(isDirty(wsPath(P, W))).toBe(false);

    failWritesEverywhere(true);
    const ok = await saveWorkspaceToFirestore(P, W, wsBody('original'));

    expect(ok).toBe(false);
    expect(isDirty(wsPath(P, W))).toBe(true);
  });

  it('marks project settings unsaved too - the case that used to fail invisibly', async () => {
    seedSyncState(metaPath(P), 5, null);
    failWritesEverywhere(true);

    await saveProjectToFirestore(P, { id: P, name: 'Test Project', nextId: 11 });

    expect(isDirty(metaPath(P))).toBe(true);
    expect(queue()).toHaveLength(1);
  });

  it('queues ONE entry per document, however many attempts fail', async () => {
    failWritesEverywhere(true);
    for (let i = 0; i < 6; i++) {
      await saveWorkspaceToFirestore(P, W, wsBody('attempt ' + i));
      await saveProjectToFirestore(P, { id: P, name: 'Test Project', nextId: 10 + i });
    }
    // 12 failed writes, 2 documents.
    expect(queue()).toHaveLength(2);
  });

  it('stores no copy of the document content', async () => {
    failWritesEverywhere(true);
    await saveWorkspaceToFirestore(P, W, wsBody('secret text'));
    const entry = queue()[0];
    expect(entry.data).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('secret text');
    expect(entry).toMatchObject({ type: 'workspace', projectId: P, workspaceId: W, retryCount: 0 });
  });
});

describe('a retry sends what the device holds NOW, not a frozen copy', () => {
  it('uploads the current local content, not the content that failed', async () => {
    failWritesEverywhere(true);
    await saveWorkspaceToFirestore(P, W, wsBody('version one'));
    expect(queue()).toHaveLength(1);

    // The user keeps working: local content moves on while the upload is broken.
    saveWorkspace(P, W, wsBody('version two'));
    markDirty(wsPath(P, W), wsBody('version two'));

    failWritesEverywhere(false);
    await advanceClock(60000, () => processRetryQueue());

    expect(cloud.get(WS_DOC).nodes[0].title).toBe('version two');
    expect(queue()).toHaveLength(0);
  });

  it('migrates a pre-Fix-5b entry and ignores the payload it carried', async () => {
    // Exactly the old shape, carrying content that must never be uploaded.
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{
      id: 'legacy', type: 'workspace', projectId: P, workspaceId: W,
      data: wsBody('STALE COPY FROM THE OLD QUEUE'),
      timestamp: Date.now() - 60000, retryCount: 0,
    }]));
    saveWorkspace(P, W, wsBody('what the device holds now'));
    markDirty(wsPath(P, W), wsBody('what the device holds now'));

    await advanceClock(60000, () => processRetryQueue());

    expect(cloud.get(WS_DOC).nodes[0].title).toBe('what the device holds now');
    expect(JSON.stringify(cloud.get(WS_DOC))).not.toContain('STALE COPY');
  });

  it('DROPS the entry without writing when the document is already saved', async () => {
    // The exact hazard: a queued failure, then a successful save, then a drain.
    localStorage.setItem(QUEUE_KEY, JSON.stringify([{
      id: 'legacy', type: 'workspace', projectId: P, workspaceId: W,
      data: wsBody('OLD CONTENT'), timestamp: Date.now() - 60000, retryCount: 0,
    }]));
    cloud.set(WS_DOC, { ...wsBody('newer content from a successful save'), revision: 9 });
    seedSyncState(wsPath(P, W), 9, wsBody('newer content from a successful save')); // clean
    attempts = [];

    await processRetryQueue();

    expect(attempts).toEqual([]);                       // no write was attempted at all
    expect(cloud.get(WS_DOC).nodes[0].title).toBe('newer content from a successful save');
    expect(queue()).toHaveLength(0);
  });

  it('drops the entry when the document no longer exists on this device', async () => {
    failWritesEverywhere(true);
    await saveWorkspaceToFirestore(P, W, wsBody('doomed'));
    localStorage.removeItem('cm-ws-' + P + '-' + W);
    expect(loadWorkspace(P, W)).toBeNull();
    failWritesEverywhere(false);
    attempts = [];

    await advanceClock(60000, () => processRetryQueue());

    expect(attempts).toEqual([]);
    expect(queue()).toHaveLength(0);
  });
});

describe('the queue empties as soon as the document is genuinely saved', () => {
  it('a successful normal upload clears that document\'s queued retry', async () => {
    failWritesEverywhere(true);
    await saveWorkspaceToFirestore(P, W, wsBody('one'));
    expect(queue()).toHaveLength(1);

    failWritesEverywhere(false);
    await saveWorkspaceToFirestore(P, W, loadWorkspace(P, W));

    // Cleared immediately by confirmSynced, not at some later drain: this is the
    // behaviour test C3 was looking for and could not get.
    expect(queue()).toHaveLength(0);
    expect(isDirty(wsPath(P, W))).toBe(false);
  });

  it('leaves other documents\' entries alone', async () => {
    failWritesEverywhere(true);
    await saveWorkspaceToFirestore(P, W, wsBody('one'));
    await saveProjectToFirestore(P, { id: P, name: 'Test Project' });
    expect(queue()).toHaveLength(2);

    failWritesEverywhere(false);
    await saveWorkspaceToFirestore(P, W, loadWorkspace(P, W));

    expect(queue().map(e => e.type)).toEqual(['project']);
  });
});

describe('attempts are counted once each, then given up on', () => {
  it('advances the count by one per drain and stops at the limit', async () => {
    failWritesEverywhere(true);
    await saveWorkspaceToFirestore(P, W, wsBody('one'));

    // Backoff is 1s, 2s, 4s...; step the clock rather than waiting.
    let t = Date.now();
    const spy = vi.spyOn(Date, 'now');
    for (let i = 0; i < 6; i++) {
      t += 60000;
      spy.mockReturnValue(t);
      await processRetryQueue();
    }
    spy.mockRestore();

    // Given up on, so no longer queued - but still marked unsaved, because it is.
    expect(queue()).toHaveLength(0);
    expect(isDirty(wsPath(P, W))).toBe(true);
  });

  it('waits out the backoff instead of hammering the cloud', async () => {
    failWritesEverywhere(true);
    await saveWorkspaceToFirestore(P, W, wsBody('one'));
    attempts = [];

    await processRetryQueue(); // immediately: inside the 1s backoff

    expect(attempts).toEqual([]);
    expect(queue()).toHaveLength(1);
  });
});

describe('manualServerSync no longer abandons the canvases', () => {
  // manualServerSync skips a canvas whose `lastModified` is not newer than the last
  // successful sync, and that record lives in a module-level map which survives
  // between tests here. Stamping the body clearly in the future keeps these two tests
  // independent of how quickly the ones above them ran - without it they pass or fail
  // depending on whether two tests share a millisecond.
  const freshBody = (title) => ({ ...wsBody(title), lastModified: Date.now() + 60000 });

  it('uploads every canvas even when the project-settings write fails', async () => {
    // Only the project metadata document fails - the D2 situation.
    failPaths.add(META_DOC);
    saveWorkspace(P, W, freshBody('original'));
    markDirty(wsPath(P, W), freshBody('original'));
    markDirty(metaPath(P), null);

    const ok = await manualServerSync(P);

    expect(ok).toBe(false);                    // reported honestly
    expect(cloud.has(WS_DOC)).toBe(true);      // and the canvas still went up
    expect(cloud.get(WS_DOC).nodes[0].title).toBe('original');
    expect(isDirty(wsPath(P, W))).toBe(false); // canvas confirmed saved
    expect(isDirty(metaPath(P))).toBe(true);   // settings still pending
  });

  it('reports success when everything really did upload', async () => {
    saveWorkspace(P, W, freshBody('original'));
    markDirty(wsPath(P, W), freshBody('original'));
    markDirty(tasksPath(P), { tasks: [], taskGroups: [] });

    const ok = await manualServerSync(P);

    expect(ok).toBe(true);
    expect(cloud.has(WS_DOC)).toBe(true);
    expect(cloud.has(META_DOC)).toBe(true);
    expect(queue()).toHaveLength(0);
  });
});
