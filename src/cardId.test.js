import { describe, it, expect } from 'vitest';
import { DEFAULT_NEXT_ID, highestNumericCardId, deriveNextId } from './cardId';

/**
 * Guards for the counter half of Bug 16. The scenario in the first block is the
 * one that produced the owner's real corruption: a project whose stored counter
 * had been written as 1 while the seed workspace already held cards 1-4.
 */

const seedProject = () => ([
  {
    id: 'ws-1',
    nodes: [
      { id: '1', title: 'User Interviews' },
      { id: '2', title: 'Competitor Benchmark' },
      { id: '3', title: 'Component Library' },
      { id: '4', title: 'Launch Strategy Plan' },
    ],
  },
]);

describe('deriveNextId - the regression that caused the data loss', () => {
  it('never hands out the seed card ids, even when the counter was stored as 1', () => {
    const next = deriveNextId(seedProject(), 1);
    expect(next).toBe(DEFAULT_NEXT_ID);
    expect(['1', '2', '3', '4']).not.toContain(String(next));
  });

  it('ignores a counter that has fallen behind the live cards', () => {
    // The owner's actual export: counter 129, ids in use up to 152.
    const workspaces = [
      { id: 'a', nodes: [{ id: '126' }, { id: '129' }, { id: '134' }] },
      { id: 'b', nodes: [{ id: '152' }, { id: '80' }] },
    ];
    expect(deriveNextId(workspaces, 129)).toBe(153);
  });

  it('respects a counter that is ahead, so deleted ids are not reused', () => {
    // Cards 60-99 were deleted. Reusing their ids would let stale edges and
    // clone references latch onto new cards.
    expect(deriveNextId(seedProject(), 100)).toBe(100);
  });

  it('survives a missing, null or nonsense counter', () => {
    expect(deriveNextId(seedProject(), undefined)).toBe(DEFAULT_NEXT_ID);
    expect(deriveNextId(seedProject(), null)).toBe(DEFAULT_NEXT_ID);
    expect(deriveNextId(seedProject(), 'banana')).toBe(DEFAULT_NEXT_ID);
    expect(deriveNextId(seedProject(), NaN)).toBe(DEFAULT_NEXT_ID);
  });

  it('looks across every workspace, not just the active one', () => {
    const workspaces = [
      { id: 'a', nodes: [{ id: '5' }] },
      { id: 'b', nodes: [{ id: '900' }] },
      { id: 'c', nodes: [] },
    ];
    expect(deriveNextId(workspaces, 6)).toBe(901);
  });
});

describe('highestNumericCardId', () => {
  it('handles an empty or malformed project without throwing', () => {
    expect(highestNumericCardId([])).toBe(0);
    expect(highestNumericCardId(null)).toBe(0);
    expect(highestNumericCardId(undefined)).toBe(0);
    expect(highestNumericCardId([{ id: 'ws', nodes: null }])).toBe(0);
    expect(highestNumericCardId([null, { id: 'ws', nodes: [null, { id: '7' }] }])).toBe(7);
  });

  it('ignores non-numeric ids instead of choking on them', () => {
    // Forward compatibility with the eventual UUID migration.
    const workspaces = [{
      id: 'ws',
      nodes: [{ id: 'a3f1-uuid-style' }, { id: '12' }, { id: null }, { id: undefined }],
    }];
    expect(highestNumericCardId(workspaces)).toBe(12);
    expect(deriveNextId(workspaces, 1)).toBe(13);
  });
});

describe('monotonic cursor behaviour (the App.jsx invariant, in miniature)', () => {
  // App.jsx keeps a cursor ref that only moves forward and is re-derived before
  // every allocation. This models it, and is the guard for the two regressions
  // that are not visible in deriveNextId alone: undo rewinding the stored
  // counter, and two creations landing in the same React batch.
  const makeAllocator = () => {
    let cursor = DEFAULT_NEXT_ID;
    return {
      allocate(workspaces, storedNextId) {
        const derived = deriveNextId(workspaces, storedNextId);
        if (derived > cursor) cursor = derived;
        return String(cursor++);
      },
    };
  };

  it('gives different ids to two creations in the same batch', () => {
    const alloc = makeAllocator();
    const workspaces = seedProject();          // state has not committed yet
    const first = alloc.allocate(workspaces, DEFAULT_NEXT_ID);
    const second = alloc.allocate(workspaces, DEFAULT_NEXT_ID);
    expect(first).not.toBe(second);
    expect([first, second]).toEqual(['10', '11']);
  });

  it('does not go backwards when the stored counter is rewound by undo', () => {
    const alloc = makeAllocator();
    const workspaces = seedProject();
    const before = alloc.allocate(workspaces, 50);   // -> "50"
    const after = alloc.allocate(workspaces, 12);    // undo rewound the counter
    expect(Number(after)).toBeGreaterThan(Number(before));
  });
});
