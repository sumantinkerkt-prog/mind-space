import { describe, it, expect, vi } from 'vitest';
import { applyNodeUpdate, collectCloneInstances } from './nodeUpdate';

/**
 * The first tests in this repository.
 *
 * The most important one is "leaves an identically-id'd card on another
 * workspace untouched" -- that is the regression guard for Bug 24, the defect
 * behind the original data loss report. If that test ever fails, cross-workspace
 * corruption has been reintroduced.
 */

// Two workspaces that both contain cards with ids '1' and '2'. This is the state
// the nextId counter regression (Bug 16) produces: the seed workspace ships with
// cards '1'-'4', and a counter reset to 1 hands the same ids out again.
const duplicateIdProject = () => ([
  {
    id: 'ws-1',
    name: 'Seed canvas',
    nodes: [
      { id: '1', workspaceId: 'ws-1', title: 'User Interviews', content: 'original notes', theme: 'blue', x: 100, y: 100 },
      { id: '2', workspaceId: 'ws-1', title: 'Competitor Benchmark', content: 'original notes', theme: 'blue', x: 200, y: 100 },
    ],
    edges: [],
    groups: [],
  },
  {
    id: 'ws-2',
    name: 'Second canvas',
    nodes: [
      { id: '1', workspaceId: 'ws-2', title: 'Unrelated card', content: 'different notes', theme: 'green', x: 900, y: 900 },
      { id: '2', workspaceId: 'ws-2', title: 'Another card', content: 'different notes', theme: 'green', x: 950, y: 900 },
    ],
    edges: [],
    groups: [],
  },
]);

const nodeIn = (workspaces, wsId, nodeId) =>
  workspaces.find((w) => w.id === wsId).nodes.find((n) => n.id === nodeId);

describe('applyNodeUpdate - Bug 24 regression guard', () => {
  it('leaves an identically-id\'d card on another workspace completely untouched', () => {
    const before = duplicateIdProject();

    const after = applyNodeUpdate(before, {
      id: '1',
      updates: { title: 'Edited on canvas 2', content: 'new text', theme: 'red', x: 42, y: 43 },
      activeWorkspaceId: 'ws-2',
    });

    // The edit landed where it should.
    expect(nodeIn(after, 'ws-2', '1')).toMatchObject({
      title: 'Edited on canvas 2',
      content: 'new text',
      theme: 'red',
      x: 42,
      y: 43,
    });

    // The same-id card on the other canvas is byte-for-byte unchanged,
    // including its position -- the old code moved it as well as rewriting it.
    expect(nodeIn(after, 'ws-1', '1')).toEqual(nodeIn(before, 'ws-1', '1'));
  });

  it('does not change the other workspace object reference, so autosave never sees it', () => {
    const before = duplicateIdProject();

    const after = applyNodeUpdate(before, {
      id: '1',
      updates: { title: 'Edited' },
      activeWorkspaceId: 'ws-2',
    });

    // Reference equality is what workspace autosave uses to decide what to
    // persist and upload. An untouched canvas must keep its identity.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('does nothing at all when the card is not on the active workspace', () => {
    const before = [
      { id: 'ws-1', name: 'A', nodes: [{ id: '1', title: 'Card' }], edges: [], groups: [] },
      { id: 'ws-2', name: 'B', nodes: [], edges: [], groups: [] },
    ];

    const after = applyNodeUpdate(before, {
      id: '1',
      updates: { title: 'Should not apply' },
      activeWorkspaceId: 'ws-2',
    });

    expect(after).toBe(before);
  });

  it('reports duplicate source ids instead of guessing which card is the original', () => {
    const onAmbiguity = vi.fn();
    const before = duplicateIdProject();
    // ws-2 card '1' is a clone of card id '1', which exists twice in the project.
    before[1].nodes[0].cloneSourceId = '1';

    applyNodeUpdate(before, {
      id: '1',
      updates: { title: 'Edited clone' },
      activeWorkspaceId: 'ws-2',
      onAmbiguity,
    });

    expect(onAmbiguity).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: '1', matchCount: 2 })
    );
  });
});

describe('applyNodeUpdate - normal behaviour still works', () => {
  const cloneProject = () => ([
    {
      id: 'ws-1',
      name: 'Source canvas',
      nodes: [{ id: '10', title: 'Source', content: 'shared text', theme: 'blue', x: 0, y: 0 }],
      edges: [],
      groups: [],
    },
    {
      id: 'ws-2',
      name: 'Clone canvas',
      nodes: [{ id: '11', cloneSourceId: '10', title: 'Source', content: 'shared text', theme: 'purple', x: 500, y: 500 }],
      edges: [],
      groups: [],
    },
  ]);

  it('edits the intended card', () => {
    const after = applyNodeUpdate(cloneProject(), {
      id: '10',
      updates: { title: 'Renamed' },
      activeWorkspaceId: 'ws-1',
    });
    expect(nodeIn(after, 'ws-1', '10').title).toBe('Renamed');
  });

  it('still mirrors title and content to a real clone', () => {
    const after = applyNodeUpdate(cloneProject(), {
      id: '10',
      updates: { title: 'Renamed', content: 'new shared text' },
      activeWorkspaceId: 'ws-1',
    });
    expect(nodeIn(after, 'ws-2', '11')).toMatchObject({
      title: 'Renamed',
      content: 'new shared text',
    });
  });

  it('never sends position or theme to a clone', () => {
    const before = cloneProject();
    const after = applyNodeUpdate(before, {
      id: '10',
      updates: { title: 'Renamed', theme: 'red', x: 777, y: 888 },
      activeWorkspaceId: 'ws-1',
    });
    const clone = nodeIn(after, 'ws-2', '11');
    expect(clone.theme).toBe('purple');
    expect(clone.x).toBe(500);
    expect(clone.y).toBe(500);
  });

  it('mirrors from the clone back to its source', () => {
    const after = applyNodeUpdate(cloneProject(), {
      id: '11',
      updates: { content: 'edited from the clone' },
      activeWorkspaceId: 'ws-2',
    });
    expect(nodeIn(after, 'ws-1', '10').content).toBe('edited from the clone');
  });

  it('does not propagate when the card has no clones', () => {
    const before = duplicateIdProject();
    const after = applyNodeUpdate(before, {
      id: '2',
      updates: { title: 'Solo edit' },
      activeWorkspaceId: 'ws-1',
    });
    expect(nodeIn(after, 'ws-2', '2')).toEqual(nodeIn(before, 'ws-2', '2'));
  });

  it('recomputes group layout for workspaces it changed', () => {
    const computeLayout = vi.fn((groups) => groups);
    applyNodeUpdate(duplicateIdProject(), {
      id: '1',
      updates: { title: 'Edited' },
      activeWorkspaceId: 'ws-1',
      computeLayout,
    });
    expect(computeLayout).toHaveBeenCalledTimes(1);
  });
});

describe('applyNodeUpdate - malformed input is survivable', () => {
  it('returns the input unchanged rather than throwing', () => {
    expect(applyNodeUpdate(null, { id: '1', updates: {} })).toBe(null);
    expect(applyNodeUpdate(undefined, { id: '1', updates: {} })).toBe(undefined);

    const ws = [{ id: 'ws-1', nodes: null, edges: [], groups: [] }];
    expect(() =>
      applyNodeUpdate(ws, { id: '1', updates: { title: 'x' }, activeWorkspaceId: 'ws-1' })
    ).not.toThrow();

    const withHoles = [{ id: 'ws-1', nodes: [null, { id: '1', title: 'ok' }], edges: [], groups: [] }];
    expect(() =>
      applyNodeUpdate(withHoles, { id: '1', updates: { title: 'x' }, activeWorkspaceId: 'ws-1' })
    ).not.toThrow();
  });
});

describe('collectCloneInstances', () => {
  it('excludes an unrelated card that merely shares the id', () => {
    const workspaces = duplicateIdProject();
    workspaces[1].nodes[0].cloneSourceId = '99';

    const { instances, ambiguousSource } = collectCloneInstances(workspaces, '1');

    expect(ambiguousSource).toBe(true);
    expect(instances).toHaveLength(0);
  });

  it('lists the original plus its explicit clones when the id is unambiguous', () => {
    const workspaces = [
      { id: 'ws-1', name: 'A', nodes: [{ id: '10', title: 'Source' }], edges: [] },
      { id: 'ws-2', name: 'B', nodes: [{ id: '11', cloneSourceId: '10', title: 'Source' }], edges: [] },
    ];

    const { instances, ambiguousSource } = collectCloneInstances(workspaces, '10');

    expect(ambiguousSource).toBe(false);
    expect(instances.map((n) => n.id)).toEqual(['10', '11']);
    expect(instances.map((n) => n._workspaceId)).toEqual(['ws-1', 'ws-2']);
  });
});
