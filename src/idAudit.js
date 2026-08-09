/**
 * Project-wide data integrity audit (Bugs 19 + 58).
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Two cards sharing an id is the precondition for Bug 24: an edit to one card
 * silently rewrote every card that shared its id, anywhere in the project, and
 * the damage was then saved and uploaded as if it were deliberate. Fix 1
 * (workspace-scoped updates) stops the leak, and Fix 2 (a live-data floor under
 * the id counter) stops NEW duplicates being minted. Neither of those tells the
 * owner whether duplicates ALREADY exist in the data they have today.
 *
 * Before this module there were only two ways to find out, and both were
 * inadequate:
 *
 *   - `audit/idAudit.mjs`, a command-line script that needs a terminal and an
 *     exported .json file. The owner of this project has neither. (Bug 19)
 *   - The X-Ray badge in the toolbar, which only ever inspected the canvas you
 *     were looking at. A card duplicated ACROSS two canvases - precisely the
 *     dangerous case - showed nothing at all.
 *
 * So the check that mattered most was the one nobody could run.
 *
 * ---------------------------------------------------------------------------
 * The rules this module follows
 * ---------------------------------------------------------------------------
 * 1. PURE AND READ-ONLY. It takes data and returns a report. It imports nothing
 *    from React, the browser, Firestore or the filesystem, mutates none of its
 *    inputs, and writes nothing anywhere. It is therefore safe to run in a
 *    read-only Reference tab, and safe to run on every data change.
 * 2. IT NEVER THROWS. A checker that crashes on odd data is worse than no
 *    checker, because the crash is indistinguishable from a clean result and it
 *    takes the surrounding render down with it. Every traversal here tolerates
 *    null, missing and wrong-typed values, and anything it cannot understand is
 *    REPORTED as an anomaly rather than thrown. (Bug 58)
 * 3. IT NEVER HANGS. See the counter check below - the previous implementation
 *    could loop billions of times on a single stray id. On the main thread that
 *    is a frozen app, which for the user is the same thing as a crash.
 * 4. IT IS THE SINGLE SOURCE OF TRUTH. `audit/idAudit.mjs` is now a thin
 *    printer over this module, so the terminal report and the in-app report can
 *    never drift apart and disagree.
 *
 * ---------------------------------------------------------------------------
 * What it does NOT do
 * ---------------------------------------------------------------------------
 * It does not repair anything. Every finding is a statement about the data, and
 * acting on it is a separate, deliberate decision. Automatic renumbering is
 * exactly the kind of silent bulk rewrite that caused the original incident.
 */

// Explicit .js extension: this module is imported both by Vite (which would
// resolve either form) and by `audit/idAudit.mjs` running under plain Node,
// where extensionless specifiers do not resolve.
import { DEFAULT_NEXT_ID, deriveNextId } from './cardId.js';

/** Severity ranking, low to high. Exported so the UI can compare without magic strings. */
export const SEVERITY = { OK: 'ok', WARNING: 'warning', CRITICAL: 'critical' };

/**
 * Anything that should be a list but might not be, becomes an empty list.
 *
 * `for (const x of value)` throws `TypeError: value is not iterable` when the
 * value is a truthy non-iterable - an object `{}` from a half-written import,
 * for example. That is the single most likely way a checker dies on real data,
 * so no traversal in this file iterates a raw input.
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** True when a value was supplied but is not a usable list. Worth reporting. */
function isMalformedList(value) {
  return value !== undefined && value !== null && !Array.isArray(value);
}

/**
 * Ids are compared as strings throughout.
 *
 * The app allocates string ids (`allocateCardId` returns `String(...)`) but an
 * imported or hand-edited file can carry numbers, so the number 72 and the
 * string "72" refer to the same card and must collide in this report. Returns
 * null for ids that cannot identify anything.
 */
function normalizeId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return null;
  const str = String(value);
  return str.length ? str : null;
}

/** Numeric-first ordering, falling back to text so mixed id styles still sort stably. */
export function compareIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

/** Human label for a canvas, in the order of preference the owner would recognise. */
function workspaceLabel(ws, index) {
  const name = ws && typeof ws.name === 'string' && ws.name.trim();
  if (name) return name;
  const id = ws && normalizeId(ws.id);
  if (id) return id;
  return `canvas #${index + 1}`;
}

/**
 * Audit every canvas in a project at once.
 *
 * @param {Array}  workspaces    all workspaces of the open project. In App.jsx
 *                               these are all resident in memory (they load
 *                               eagerly at startup), so this needs no async and
 *                               no extra Firestore reads.
 * @param {number} storedNextId  the card counter from project metadata.
 * @returns {object} a structured, render-ready report. Never throws.
 */
export function auditProjectIds(workspaces, storedNextId = DEFAULT_NEXT_ID) {
  const list = asArray(workspaces);

  /** Odd data we tolerated rather than crashed on. Surfaced, not swallowed. */
  const anomalies = [];
  /** id -> [{ workspaceId, workspaceName, count }] */
  const byId = new Map();
  /** Every canvas's own set of linkable ids (cards + groups + images). */
  const localIdsByWorkspace = [];

  let totalCards = 0;

  if (isMalformedList(workspaces)) {
    anomalies.push({ scope: 'project', message: 'The workspace list is not a list. Nothing could be checked.' });
  }

  // ---- gather -------------------------------------------------------------
  list.forEach((ws, index) => {
    const workspaceName = workspaceLabel(ws, index);
    const workspaceId = (ws && normalizeId(ws.id)) || null;

    if (!ws || typeof ws !== 'object') {
      anomalies.push({ scope: 'workspace', workspaceName, message: 'This canvas entry is empty or not an object.' });
      localIdsByWorkspace.push({ workspaceId, workspaceName, ids: new Set() });
      return;
    }

    for (const key of ['nodes', 'edges', 'groups', 'images']) {
      if (isMalformedList(ws[key])) {
        anomalies.push({ scope: 'workspace', workspaceId, workspaceName, message: `"${key}" is not a list on this canvas, so it was skipped.` });
      }
    }

    // Cards, counted per canvas so "twice on one canvas" stays distinguishable
    // from "once on each of two canvases".
    const local = new Map();
    let idlessCards = 0;
    for (const node of asArray(ws.nodes)) {
      if (!node || typeof node !== 'object') {
        idlessCards++;
        continue;
      }
      const id = normalizeId(node.id);
      if (id === null) {
        idlessCards++;
        continue;
      }
      totalCards++;
      local.set(id, (local.get(id) || 0) + 1);
    }
    if (idlessCards > 0) {
      anomalies.push({
        scope: 'workspace', workspaceId, workspaceName,
        message: `${idlessCards} card${idlessCards > 1 ? 's' : ''} on this canvas ${idlessCards > 1 ? 'have' : 'has'} no usable id and could not be checked.`,
      });
    }

    for (const [id, count] of local) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ workspaceId, workspaceName, count });
    }

    // Edges may legitimately attach to cards, groups OR images, so all three
    // contribute linkable ids. Narrowing this to cards alone would report a
    // pile of false "broken edge" findings for perfectly healthy diagrams.
    const ids = new Set();
    for (const key of ['nodes', 'groups', 'images']) {
      for (const obj of asArray(ws[key])) {
        const id = obj && typeof obj === 'object' ? normalizeId(obj.id) : null;
        if (id !== null) ids.add(id);
      }
    }
    localIdsByWorkspace.push({ workspaceId, workspaceName, ids });
  });

  // ---- 1. the same id on more than one canvas (the Bug 24 precondition) ----
  const crossCanvas = [];
  for (const [id, places] of byId) {
    if (places.length > 1) {
      crossCanvas.push({
        id,
        places: places.map(p => ({ ...p })),
        totalCards: places.reduce((sum, p) => sum + p.count, 0),
      });
    }
  }
  crossCanvas.sort((a, b) => compareIds(a.id, b.id));

  // ---- 2. the same id twice on one canvas ---------------------------------
  const withinCanvas = [];
  for (const [id, places] of byId) {
    for (const place of places) {
      if (place.count > 1) withinCanvas.push({ id, ...place });
    }
  }
  withinCanvas.sort((a, b) => compareIds(a.id, b.id));

  // ---- 3. the id counter --------------------------------------------------
  // Bounded by design. The original walked every integer from the stored
  // counter up to the highest live id; one stray id of 1e9 in imported data
  // meant a billion iterations, which in the browser is a frozen tab. Instead
  // we look only at ids that actually exist: any live id at or above the
  // counter is exactly a future collision, and there can only ever be as many
  // of those as there are cards.
  const numericIds = [];
  for (const id of byId.keys()) {
    const num = Number(id);
    if (Number.isFinite(num)) numericIds.push({ id, num });
  }
  const highest = numericIds.length ? Math.max(...numericIds.map(n => n.num)) : 0;
  const parsedStored = Number(storedNextId);
  const storedIsUsable = Number.isFinite(parsedStored);
  if (!storedIsUsable && storedNextId !== undefined && storedNextId !== null) {
    anomalies.push({ scope: 'project', message: `The stored card counter ("${storedNextId}") is not a number.` });
  }
  const effectiveStored = storedIsUsable ? parsedStored : DEFAULT_NEXT_ID;
  const counterClashes = numericIds
    .filter(n => n.num >= effectiveStored)
    .sort((a, b) => a.num - b.num)
    .map(n => n.id);

  const counter = {
    storedNextId: storedIsUsable ? parsedStored : null,
    highest,
    // What the app will really hand out next. Fix 2 puts a live-data floor
    // under the stored counter, so this is the honest number even when the
    // stored one has been rewound.
    safeNextId: deriveNextId(list, storedNextId),
    clashes: counterClashes,
    // A low stored counter no longer causes duplicates by itself - the floor
    // above contains it. Reported so the discrepancy is visible, not hidden.
    containedByLiveFloor: counterClashes.length > 0,
  };

  // ---- 4. clone references ------------------------------------------------
  // COPY is independent; CLONE is linked and syncs title + content both ways.
  // A clone whose source id is ambiguous will sync to whichever card is found
  // first, which is how a link silently starts writing to the wrong card.
  const cloneProblems = [];
  let cloneRefsChecked = 0;
  list.forEach((ws, index) => {
    if (!ws || typeof ws !== 'object') return;
    const workspaceName = workspaceLabel(ws, index);
    const workspaceId = normalizeId(ws.id);
    for (const node of asArray(ws.nodes)) {
      if (!node || typeof node !== 'object') continue;
      const sourceId = normalizeId(node.cloneSourceId);
      if (sourceId === null) continue;
      cloneRefsChecked++;
      const places = byId.get(sourceId);
      if (!places) {
        cloneProblems.push({
          kind: 'missing', nodeId: normalizeId(node.id), workspaceId, workspaceName,
          sourceId, candidates: 0,
        });
        continue;
      }
      const candidates = places.reduce((sum, p) => sum + p.count, 0);
      if (candidates > 1) {
        cloneProblems.push({
          kind: 'ambiguous', nodeId: normalizeId(node.id), workspaceId, workspaceName,
          sourceId, candidates,
        });
      }
    }
  });

  // ---- 5. edges with an endpoint that does not resolve --------------------
  const brokenEdges = [];
  list.forEach((ws, index) => {
    if (!ws || typeof ws !== 'object') return;
    const workspaceName = workspaceLabel(ws, index);
    const workspaceId = normalizeId(ws.id);
    const known = localIdsByWorkspace[index]?.ids || new Set();
    for (const edge of asArray(ws.edges)) {
      if (!edge || typeof edge !== 'object') {
        brokenEdges.push({ kind: 'malformed', workspaceId, workspaceName, edgeId: null, endpoint: null, value: null });
        continue;
      }
      const edgeId = normalizeId(edge.id);
      for (const endpoint of ['source', 'target']) {
        const value = normalizeId(edge[endpoint]);
        if (value === null) {
          brokenEdges.push({ kind: 'empty', workspaceId, workspaceName, edgeId, endpoint, value: null });
        } else if (!known.has(value)) {
          brokenEdges.push({ kind: 'missing', workspaceId, workspaceName, edgeId, endpoint, value });
        }
      }
    }
  });

  // ---- 6. objects filed under a group that no longer exists --------------
  const orphanGroupMembers = [];
  list.forEach((ws, index) => {
    if (!ws || typeof ws !== 'object') return;
    const workspaceName = workspaceLabel(ws, index);
    const workspaceId = normalizeId(ws.id);
    const groupIds = new Set();
    for (const group of asArray(ws.groups)) {
      const id = group && typeof group === 'object' ? normalizeId(group.id) : null;
      if (id !== null) groupIds.add(id);
    }
    for (const kind of ['nodes', 'groups', 'images']) {
      for (const obj of asArray(ws[kind])) {
        if (!obj || typeof obj !== 'object') continue;
        // A group's own parent link has a different field name from a member's.
        const groupId = normalizeId(kind === 'groups' ? obj.parentGroupId : obj.groupId);
        if (groupId !== null && !groupIds.has(groupId)) {
          orphanGroupMembers.push({ workspaceId, workspaceName, kind, objectId: normalizeId(obj.id), groupId });
        }
      }
    }
  });

  // ---- severity -----------------------------------------------------------
  // Duplicate ids are the only findings that can cause silent data loss, so
  // they alone are critical. Everything else is a broken link: visible,
  // annoying, but it does not overwrite anyone's work. Grading them the same
  // would train the owner to ignore a red badge, which defeats the purpose.
  const criticalCount = crossCanvas.length + withinCanvas.length;
  const warningCount =
    brokenEdges.length + cloneProblems.length + orphanGroupMembers.length +
    counterClashes.length + anomalies.length;

  let severity = SEVERITY.OK;
  if (criticalCount > 0) severity = SEVERITY.CRITICAL;
  else if (warningCount > 0) severity = SEVERITY.WARNING;

  return {
    totals: { canvases: list.length, cards: totalCards, distinctIds: byId.size },
    counter,
    crossCanvas,
    withinCanvas,
    cloneRefs: { checked: cloneRefsChecked, problems: cloneProblems },
    brokenEdges,
    orphanGroupMembers,
    anomalies,
    criticalCount,
    warningCount,
    problemCount: criticalCount + warningCount,
    severity,
    /** Every card id that is duplicated anywhere in the project, for fast lookup while rendering. */
    duplicateIds: new Set([...crossCanvas.map(d => d.id), ...withinCanvas.map(d => d.id)]),
  };
}

/**
 * One-line plain-language summary. Used by the panel header and the toolbar
 * tooltip so both say the same thing.
 */
export function summarizeAudit(report) {
  if (!report) return 'Not checked yet.';
  if (report.severity === SEVERITY.OK) {
    return `No problems found across ${report.totals.canvases} canvas${report.totals.canvases === 1 ? '' : 'es'} and ${report.totals.cards} card${report.totals.cards === 1 ? '' : 's'}.`;
  }
  const parts = [];
  if (report.crossCanvas.length) parts.push(`${report.crossCanvas.length} id${report.crossCanvas.length > 1 ? 's' : ''} shared across canvases`);
  if (report.withinCanvas.length) parts.push(`${report.withinCanvas.length} id${report.withinCanvas.length > 1 ? 's' : ''} duplicated on one canvas`);
  if (report.brokenEdges.length) parts.push(`${report.brokenEdges.length} broken connection${report.brokenEdges.length > 1 ? 's' : ''}`);
  if (report.cloneRefs.problems.length) parts.push(`${report.cloneRefs.problems.length} clone link${report.cloneRefs.problems.length > 1 ? 's' : ''} unresolved`);
  if (report.orphanGroupMembers.length) parts.push(`${report.orphanGroupMembers.length} orphaned group member${report.orphanGroupMembers.length > 1 ? 's' : ''}`);
  if (report.counter.clashes.length) parts.push(`counter below ${report.counter.clashes.length} live id${report.counter.clashes.length > 1 ? 's' : ''}`);
  if (report.anomalies.length) parts.push(`${report.anomalies.length} unreadable item${report.anomalies.length > 1 ? 's' : ''}`);
  return parts.join(', ') + '.';
}

/**
 * Render the report as plain text lines.
 *
 * This is what the command-line script prints, which is the whole point: the
 * terminal report and the in-app report are produced from one set of findings,
 * so they cannot drift into disagreeing with each other.
 */
export function formatAuditLines(report, { projectName = '(unnamed)' } = {}) {
  const lines = [];
  const rule = '='.repeat(72);
  lines.push('', rule, `PROJECT: ${projectName}`, rule);
  lines.push(`Canvases: ${report.totals.canvases}    Cards: ${report.totals.cards}    Distinct ids: ${report.totals.distinctIds}`);

  lines.push('', `-- Same id on more than one canvas: ${report.crossCanvas.length}`);
  if (report.crossCanvas.length) {
    lines.push('   Editing one of these used to rewrite the others, including their');
    lines.push('   position, and the damage was saved and uploaded. Fix 1 scopes edits');
    lines.push('   to the active canvas, so these are now inert - but still worth clearing.');
  }
  for (const dup of report.crossCanvas) {
    lines.push(`   id "${dup.id}" -> ` + dup.places.map(p => p.workspaceName + (p.count > 1 ? ` (x${p.count})` : '')).join('  |  '));
  }

  lines.push('', `-- Same id twice on one canvas: ${report.withinCanvas.length}`);
  for (const dup of report.withinCanvas) {
    lines.push(`   id "${dup.id}" -> ${dup.workspaceName} (${dup.count} cards)`);
  }

  lines.push('', '-- Id counter');
  lines.push(`   stored nextId: ${report.counter.storedNextId ?? '(missing)'}    highest id in use: ${report.counter.highest}    next id the app will use: ${report.counter.safeNextId}`);
  if (report.counter.clashes.length) {
    lines.push(`   Stored counter is at or below ${report.counter.clashes.length} live id(s): ${report.counter.clashes.join(', ')}`);
    lines.push('   Contained: allocation takes a floor from live data, so no new card');
    lines.push('   can be born on one of these. Reported because the stored value is wrong.');
  } else {
    lines.push('   Counter is above every live id.');
  }

  lines.push('', `-- Clone references (${report.cloneRefs.checked} checked)`);
  for (const problem of report.cloneRefs.problems) {
    lines.push(problem.kind === 'missing'
      ? `   card "${problem.nodeId}" on ${problem.workspaceName} points at missing source "${problem.sourceId}"`
      : `   card "${problem.nodeId}" on ${problem.workspaceName} points at AMBIGUOUS source "${problem.sourceId}" (${problem.candidates} candidates)`);
  }

  lines.push('', `-- Edges: ${report.brokenEdges.length} problem(s)`);
  for (const edge of report.brokenEdges) {
    if (edge.kind === 'malformed') lines.push(`   ${edge.workspaceName}: an edge entry is empty or not an object`);
    else if (edge.kind === 'empty') lines.push(`   ${edge.workspaceName}: edge "${edge.edgeId}" has no ${edge.endpoint}`);
    else lines.push(`   ${edge.workspaceName}: edge "${edge.edgeId}" ${edge.endpoint} "${edge.value}" not found`);
  }

  lines.push('', `-- Group membership: ${report.orphanGroupMembers.length} problem(s)`);
  for (const orphan of report.orphanGroupMembers) {
    lines.push(`   ${orphan.workspaceName}: ${orphan.kind} "${orphan.objectId}" belongs to missing group "${orphan.groupId}"`);
  }

  if (report.anomalies.length) {
    lines.push('', `-- Data that could not be read: ${report.anomalies.length}`);
    for (const anomaly of report.anomalies) {
      lines.push(`   ${anomaly.workspaceName ? anomaly.workspaceName + ': ' : ''}${anomaly.message}`);
    }
  }

  return lines;
}
