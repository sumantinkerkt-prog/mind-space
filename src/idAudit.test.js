import { describe, it, expect } from 'vitest';
import { auditProjectIds, summarizeAudit, formatAuditLines, compareIds, SEVERITY } from './idAudit';

/**
 * A healthy two-canvas project: unique ids, every edge resolves, no clones.
 * Each test that needs damage starts from a fresh copy of this.
 */
function healthyProject() {
  return [
    {
      id: 'ws-a',
      name: 'Canvas A',
      nodes: [
        { id: '10', workspaceId: 'ws-a', title: 'A1', content: '', groupId: null, cloneSourceId: null },
        { id: '11', workspaceId: 'ws-a', title: 'A2', content: '', groupId: null, cloneSourceId: null },
      ],
      edges: [{ id: 'e-1', source: '10', target: '11', workspaceId: 'ws-a' }],
      groups: [],
      images: [],
      pins: [],
    },
    {
      id: 'ws-b',
      name: 'Canvas B',
      nodes: [
        { id: '20', workspaceId: 'ws-b', title: 'B1', content: '', groupId: null, cloneSourceId: null },
      ],
      edges: [],
      groups: [],
      images: [],
      pins: [],
    },
  ];
}

describe('auditProjectIds - a clean project', () => {
  it('reports no problems and grades itself ok', () => {
    const report = auditProjectIds(healthyProject(), 30);
    expect(report.problemCount).toBe(0);
    expect(report.criticalCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.severity).toBe(SEVERITY.OK);
    expect(report.duplicateIds.size).toBe(0);
  });

  it('counts canvases, cards and distinct ids', () => {
    const report = auditProjectIds(healthyProject(), 30);
    expect(report.totals).toEqual({ canvases: 2, cards: 3, distinctIds: 3 });
  });
});

describe('auditProjectIds - duplicate ids (the Bug 24 precondition)', () => {
  it('finds the same id used on two different canvases', () => {
    const project = healthyProject();
    project[1].nodes[0].id = '10'; // now on both Canvas A and Canvas B
    const report = auditProjectIds(project, 30);

    expect(report.crossCanvas).toHaveLength(1);
    expect(report.crossCanvas[0].id).toBe('10');
    expect(report.crossCanvas[0].totalCards).toBe(2);
    expect(report.crossCanvas[0].places.map(p => p.workspaceName)).toEqual(['Canvas A', 'Canvas B']);
    expect(report.severity).toBe(SEVERITY.CRITICAL);
    expect(report.duplicateIds.has('10')).toBe(true);
  });

  it('finds the same id used twice on one canvas', () => {
    const project = healthyProject();
    project[0].nodes.push({ id: '10', workspaceId: 'ws-a', title: 'A1 again', content: '' });
    const report = auditProjectIds(project, 30);

    expect(report.withinCanvas).toHaveLength(1);
    expect(report.withinCanvas[0]).toMatchObject({ id: '10', workspaceName: 'Canvas A', count: 2 });
    expect(report.crossCanvas).toHaveLength(0);
    expect(report.severity).toBe(SEVERITY.CRITICAL);
  });

  it('treats the number 10 and the string "10" as the same id', () => {
    // An imported or hand-edited file can carry numeric ids while the app
    // allocates strings. If these did not collide the report would miss the
    // duplicate entirely.
    const project = healthyProject();
    project[1].nodes[0].id = 10;
    const report = auditProjectIds(project, 30);

    expect(report.crossCanvas).toHaveLength(1);
    expect(report.crossCanvas[0].id).toBe('10');
  });

  it('reports a cross-canvas duplicate that is also duplicated within a canvas', () => {
    const project = healthyProject();
    project[0].nodes.push({ id: '10', workspaceId: 'ws-a' });
    project[1].nodes[0].id = '10';
    const report = auditProjectIds(project, 30);

    expect(report.crossCanvas).toHaveLength(1);
    expect(report.crossCanvas[0].totalCards).toBe(3);
    expect(report.withinCanvas).toHaveLength(1);
    expect(report.withinCanvas[0].count).toBe(2);
  });

  it('sorts findings numerically, not lexicographically', () => {
    const project = [
      { id: 'ws-a', name: 'A', nodes: [{ id: '9' }, { id: '100' }, { id: '20' }], edges: [] },
      { id: 'ws-b', name: 'B', nodes: [{ id: '9' }, { id: '100' }, { id: '20' }], edges: [] },
    ];
    const report = auditProjectIds(project, 500);
    expect(report.crossCanvas.map(d => d.id)).toEqual(['9', '20', '100']);
  });
});

describe('auditProjectIds - the id counter', () => {
  it('is quiet when the counter sits above every live id', () => {
    const report = auditProjectIds(healthyProject(), 30);
    expect(report.counter.clashes).toEqual([]);
    expect(report.counter.highest).toBe(20);
    expect(report.counter.safeNextId).toBe(30);
  });

  it('lists exactly the live ids a rewound counter would collide with', () => {
    const report = auditProjectIds(healthyProject(), 11);
    expect(report.counter.storedNextId).toBe(11);
    expect(report.counter.clashes).toEqual(['11', '20']);
    // Fix 2 puts a floor under allocation, so the next id is still safe.
    expect(report.counter.safeNextId).toBe(21);
    expect(report.counter.containedByLiveFloor).toBe(true);
    // A wrong counter is a warning, not a data-loss risk.
    expect(report.severity).toBe(SEVERITY.WARNING);
    expect(report.criticalCount).toBe(0);
  });

  it('checks a counter supplied as a string instead of skipping it', () => {
    // The old script guarded on `typeof nextId === 'number'`, so a stored "11"
    // silently passed the check while being just as wrong.
    const report = auditProjectIds(healthyProject(), '11');
    expect(report.counter.clashes).toEqual(['11', '20']);
  });

  it('does not hang when a stray huge id sits far above a low counter', () => {
    // The previous implementation walked every integer from the counter to the
    // highest id, so this input meant a billion iterations and a frozen tab.
    const project = healthyProject();
    project[1].nodes.push({ id: '1000000000' });
    const started = Date.now();
    const report = auditProjectIds(project, 1);
    expect(Date.now() - started).toBeLessThan(200);
    expect(report.counter.highest).toBe(1000000000);
    expect(report.counter.clashes).toEqual(['10', '11', '20', '1000000000']);
  });

  it('flags a counter that is not a number at all', () => {
    const report = auditProjectIds(healthyProject(), 'banana');
    expect(report.counter.storedNextId).toBeNull();
    expect(report.anomalies.some(a => /not a number/.test(a.message))).toBe(true);
  });
});

describe('auditProjectIds - clone references', () => {
  it('flags a clone pointing at a source that no longer exists', () => {
    const project = healthyProject();
    project[1].nodes[0].cloneSourceId = '999';
    const report = auditProjectIds(project, 30);

    expect(report.cloneRefs.checked).toBe(1);
    expect(report.cloneRefs.problems).toHaveLength(1);
    expect(report.cloneRefs.problems[0]).toMatchObject({ kind: 'missing', sourceId: '999', nodeId: '20' });
  });

  it('flags a clone whose source id is ambiguous', () => {
    // Two cards share id "10", so a clone linked to "10" will sync to whichever
    // is found first - the mechanism by which a link writes to the wrong card.
    const project = healthyProject();
    project[0].nodes.push({ id: '10', workspaceId: 'ws-a' });
    project[1].nodes[0].cloneSourceId = '10';
    const report = auditProjectIds(project, 30);

    expect(report.cloneRefs.problems).toHaveLength(1);
    expect(report.cloneRefs.problems[0]).toMatchObject({ kind: 'ambiguous', sourceId: '10', candidates: 2 });
  });

  it('accepts a clone pointing at a single unambiguous source', () => {
    const project = healthyProject();
    project[1].nodes[0].cloneSourceId = '10';
    const report = auditProjectIds(project, 30);
    expect(report.cloneRefs.checked).toBe(1);
    expect(report.cloneRefs.problems).toHaveLength(0);
  });
});

describe('auditProjectIds - edges', () => {
  it('flags an edge endpoint that resolves to nothing', () => {
    const project = healthyProject();
    project[0].edges.push({ id: 'e-2', source: '10', target: 'gone' });
    const report = auditProjectIds(project, 30);

    expect(report.brokenEdges).toHaveLength(1);
    expect(report.brokenEdges[0]).toMatchObject({ kind: 'missing', edgeId: 'e-2', endpoint: 'target', value: 'gone' });
  });

  it('flags an edge with a missing endpoint field', () => {
    const project = healthyProject();
    project[0].edges.push({ id: 'e-3', source: null, target: '11' });
    const report = auditProjectIds(project, 30);
    expect(report.brokenEdges).toHaveLength(1);
    expect(report.brokenEdges[0]).toMatchObject({ kind: 'empty', endpoint: 'source' });
  });

  it('accepts edges that attach to groups and images, not just cards', () => {
    // Narrowing valid endpoints to cards would invent broken edges for healthy
    // diagrams, and a report full of false alarms gets ignored.
    const project = healthyProject();
    project[0].groups.push({ id: 'g-1', name: 'Group' });
    project[0].images.push({ id: 'img-1', url: 'x' });
    project[0].edges.push({ id: 'e-4', source: '10', target: 'g-1' });
    project[0].edges.push({ id: 'e-5', source: 'img-1', target: '11' });
    const report = auditProjectIds(project, 30);
    expect(report.brokenEdges).toHaveLength(0);
  });

  it('does not treat an id from another canvas as resolvable', () => {
    const project = healthyProject();
    project[0].edges.push({ id: 'e-6', source: '10', target: '20' }); // 20 lives on Canvas B
    const report = auditProjectIds(project, 30);
    expect(report.brokenEdges).toHaveLength(1);
    expect(report.brokenEdges[0]).toMatchObject({ endpoint: 'target', value: '20' });
  });
});

describe('auditProjectIds - group membership', () => {
  it('flags an object filed under a group that no longer exists', () => {
    const project = healthyProject();
    project[0].nodes[0].groupId = 'g-missing';
    const report = auditProjectIds(project, 30);

    expect(report.orphanGroupMembers).toHaveLength(1);
    expect(report.orphanGroupMembers[0]).toMatchObject({ kind: 'nodes', objectId: '10', groupId: 'g-missing' });
  });

  it('reads a group\'s own parent link from parentGroupId, not groupId', () => {
    const project = healthyProject();
    project[0].groups.push({ id: 'g-1', parentGroupId: 'g-missing' });
    const report = auditProjectIds(project, 30);
    expect(report.orphanGroupMembers).toHaveLength(1);
    expect(report.orphanGroupMembers[0]).toMatchObject({ kind: 'groups', objectId: 'g-1', groupId: 'g-missing' });
  });

  it('accepts membership of a group that exists', () => {
    const project = healthyProject();
    project[0].groups.push({ id: 'g-1', name: 'Group' });
    project[0].nodes[0].groupId = 'g-1';
    const report = auditProjectIds(project, 30);
    expect(report.orphanGroupMembers).toHaveLength(0);
  });
});

/**
 * Bug 58. A checker that throws is worse than no checker: the crash looks
 * exactly like a clean result to the user, and it takes the render down with
 * it. Every one of these inputs must produce a report, not an exception.
 */
describe('auditProjectIds - never crashes on odd data (Bug 58)', () => {
  it('survives being handed nothing at all', () => {
    for (const input of [undefined, null, 'nonsense', 42, {}, true]) {
      const report = auditProjectIds(input, 10);
      expect(report.totals.cards).toBe(0);
      expect(report.severity).toBeDefined();
    }
  });

  it('reports rather than throws when the workspace list is not a list', () => {
    const report = auditProjectIds({ nope: true }, 10);
    expect(report.anomalies.some(a => /not a list/.test(a.message))).toBe(true);
  });

  it('survives null entries inside the workspace list', () => {
    const project = healthyProject();
    project.splice(1, 0, null);
    const report = auditProjectIds(project, 30);
    expect(report.totals.cards).toBe(3);
    expect(report.anomalies.some(a => /empty or not an object/.test(a.message))).toBe(true);
  });

  it('survives nodes/edges/groups/images being null', () => {
    const report = auditProjectIds(
      [{ id: 'ws-a', name: 'A', nodes: null, edges: null, groups: null, images: null }],
      10,
    );
    expect(report.totals.cards).toBe(0);
    expect(report.problemCount).toBe(0);
  });

  it('survives nodes being a truthy non-iterable object', () => {
    // `for (const n of {})` throws TypeError - the most likely way a checker
    // dies on a half-written import.
    const report = auditProjectIds([{ id: 'ws-a', name: 'A', nodes: { '0': { id: '1' } }, edges: {} }], 10);
    expect(report.totals.cards).toBe(0);
    expect(report.anomalies.some(a => /"nodes" is not a list/.test(a.message))).toBe(true);
    expect(report.anomalies.some(a => /"edges" is not a list/.test(a.message))).toBe(true);
  });

  it('survives null and id-less cards, and counts them as unreadable', () => {
    const report = auditProjectIds(
      [{ id: 'ws-a', name: 'A', nodes: [null, { id: '10' }, {}, { id: null }, { id: undefined }], edges: [] }],
      30,
    );
    expect(report.totals.cards).toBe(1);
    expect(report.anomalies.some(a => /4 cards on this canvas have no usable id/.test(a.message))).toBe(true);
  });

  it('survives null entries in the edge list', () => {
    const report = auditProjectIds([{ id: 'ws-a', name: 'A', nodes: [{ id: '10' }], edges: [null] }], 30);
    expect(report.brokenEdges).toHaveLength(1);
    expect(report.brokenEdges[0].kind).toBe('malformed');
  });

  it('survives a workspace with no id or name by labelling it positionally', () => {
    const report = auditProjectIds([{ nodes: [{ id: '10' }, { id: '10' }], edges: [] }], 30);
    expect(report.withinCanvas[0].workspaceName).toBe('canvas #1');
    expect(report.withinCanvas[0].workspaceId).toBeNull();
  });

  it('ignores an object used as a card id rather than stringifying it', () => {
    const report = auditProjectIds([{ id: 'ws-a', name: 'A', nodes: [{ id: {} }, { id: {} }], edges: [] }], 30);
    // Two "[object Object]" ids must not be reported as a real duplicate.
    expect(report.crossCanvas).toHaveLength(0);
    expect(report.withinCanvas).toHaveLength(0);
  });

  it('does not mutate the data it was given', () => {
    const project = healthyProject();
    const before = JSON.stringify(project);
    auditProjectIds(project, 11);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('summarizeAudit', () => {
  it('says so plainly when nothing is wrong', () => {
    expect(summarizeAudit(auditProjectIds(healthyProject(), 30)))
      .toBe('No problems found across 2 canvases and 3 cards.');
  });

  it('names each kind of problem it found', () => {
    const project = healthyProject();
    project[1].nodes[0].id = '10';
    const summary = summarizeAudit(auditProjectIds(project, 30));
    expect(summary).toContain('1 id shared across canvases');
  });

  it('handles being called before any check has run', () => {
    expect(summarizeAudit(null)).toBe('Not checked yet.');
  });
});

describe('formatAuditLines', () => {
  it('produces printable text for the command-line report', () => {
    const project = healthyProject();
    project[1].nodes[0].id = '10';
    const text = formatAuditLines(auditProjectIds(project, 30), { projectName: 'My Project' }).join('\n');

    expect(text).toContain('PROJECT: My Project');
    expect(text).toContain('Same id on more than one canvas: 1');
    expect(text).toContain('id "10" -> Canvas A  |  Canvas B');
  });

  it('does not throw on a report built from broken data', () => {
    const report = auditProjectIds([null, { nodes: {} }], 'x');
    expect(() => formatAuditLines(report).join('\n')).not.toThrow();
  });
});

describe('compareIds', () => {
  it('orders numbers numerically and mixes in text ids stably', () => {
    expect(['100', '9', '20'].sort(compareIds)).toEqual(['9', '20', '100']);
    expect(['b', 'a'].sort(compareIds)).toEqual(['a', 'b']);
    expect(() => ['a', '1', null, undefined].sort(compareIds)).not.toThrow();
  });
});
