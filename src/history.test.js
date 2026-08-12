import { describe, it, expect } from 'vitest';
import { snapshotBelongsToProject, EMPTY_HISTORY } from './history';

/** A snapshot in the shape App.jsx clones out of stateRef. */
function snapshot(projectId, extra = {}) {
  return {
    workspaces: [{ id: 'ws-1', name: 'Canvas', nodes: [], edges: [] }],
    activeTab: 'ws-1',
    nextId: 10,
    projectId,
    ...extra,
  };
}

describe('snapshotBelongsToProject', () => {
  it('accepts a snapshot taken from the project that is open', () => {
    expect(snapshotBelongsToProject(snapshot('proj-a'), 'proj-a')).toBe(true);
  });

  it('refuses a snapshot taken from a different project', () => {
    // The reported bug: work in project A, delete A, land in B, press Ctrl+Z,
    // and A's canvases appear inside B.
    expect(snapshotBelongsToProject(snapshot('proj-a'), 'proj-b')).toBe(false);
  });

  it('allows an unstamped snapshot rather than breaking undo', () => {
    // Only possible before the app knows which project is open, when there is no
    // other project to contaminate. Refusing these would silently disable undo.
    expect(snapshotBelongsToProject(snapshot(undefined), 'proj-a')).toBe(true);
    expect(snapshotBelongsToProject(snapshot(null), 'proj-a')).toBe(true);
    expect(snapshotBelongsToProject(snapshot(''), 'proj-a')).toBe(true);
    expect(snapshotBelongsToProject({ workspaces: [], activeTab: '', nextId: 10 }, 'proj-a')).toBe(true);
  });

  it('compares as strings so a numeric project id still matches', () => {
    expect(snapshotBelongsToProject(snapshot(42), '42')).toBe(true);
    expect(snapshotBelongsToProject(snapshot('42'), 42)).toBe(true);
    expect(snapshotBelongsToProject(snapshot(42), '43')).toBe(false);
  });

  it('refuses anything that is not a usable snapshot', () => {
    for (const bad of [null, undefined, 'nonsense', 42, true]) {
      expect(snapshotBelongsToProject(bad, 'proj-a')).toBe(false);
    }
  });

  it('does not mistake a stamped snapshot for a match when no project is open', () => {
    // Boot or teardown: nothing is open, so a stamped snapshot must not be applied.
    expect(snapshotBelongsToProject(snapshot('proj-a'), '')).toBe(false);
    expect(snapshotBelongsToProject(snapshot('proj-a'), undefined)).toBe(false);
  });
});

describe('the invariant this protects, modelled end to end', () => {
  // Mirrors App.jsx: pastRef holds snapshots, undo pops one and applies it.
  function makeHistory() {
    let past = [];
    let openProject = 'proj-a';
    return {
      state: () => ({ past: [...past], openProject }),
      take(projectId = openProject) { past = [...past, snapshot(projectId)]; },
      switchOrDeleteTo(projectId, { clearHistory }) {
        openProject = projectId;
        if (clearHistory) past = [...EMPTY_HISTORY.past];
      },
      undo() {
        if (past.length === 0) return { applied: false, reason: 'nothing to undo' };
        const next = [...past];
        const prev = next.pop();
        if (!snapshotBelongsToProject(prev, openProject)) {
          past = [];
          return { applied: false, reason: 'foreign snapshot discarded' };
        }
        past = next;
        return { applied: true, restoredFrom: prev.projectId };
      },
    };
  }

  it('reproduces the bug when history is not cleared, and the guard stops it', () => {
    const h = makeHistory();
    h.take();                                                  // edit in project A
    h.switchOrDeleteTo('proj-b', { clearHistory: false });      // deleteProject's old behaviour
    const result = h.undo();

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('foreign snapshot discarded');
    // The stale history is dropped, so a second press cannot apply it either.
    expect(h.state().past).toEqual([]);
    expect(h.undo().reason).toBe('nothing to undo');
  });

  it('clearing the history on project change leaves nothing to misapply', () => {
    const h = makeHistory();
    h.take();
    h.switchOrDeleteTo('proj-b', { clearHistory: true });       // the fixed behaviour
    expect(h.state().past).toEqual([]);
    expect(h.undo().reason).toBe('nothing to undo');
  });

  it('still undoes normally within one project', () => {
    const h = makeHistory();
    h.take();
    h.take();
    expect(h.undo()).toEqual({ applied: true, restoredFrom: 'proj-a' });
    expect(h.undo()).toEqual({ applied: true, restoredFrom: 'proj-a' });
    expect(h.undo().reason).toBe('nothing to undo');
  });

  it('undoes normally after switching away and back', () => {
    const h = makeHistory();
    h.switchOrDeleteTo('proj-b', { clearHistory: true });
    h.take();                                                   // edit in B
    expect(h.undo().applied).toBe(true);
  });
});
