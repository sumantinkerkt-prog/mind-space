#!/usr/bin/env node
/**
 * Read-only data audit for a ThoughtFlow project export.
 *
 * Writes nothing and touches no live data. Point it at an exported .json file:
 *
 *   node audit/idAudit.mjs ~/Downloads/my-project.json
 *
 * Accepts either a single-project export ({ workspaces, nextId, ... }) or a full
 * backup ({ type: 'thoughtflow-backup', projects: [...] }).
 *
 * Reports:
 *   1. Card ids that appear on more than one canvas   <- Bug 24 precondition
 *   2. Card ids that appear twice on one canvas
 *   3. Whether the stored nextId counter is below ids already in use
 *   4. cloneSourceId values that do not resolve, or resolve ambiguously
 *   5. Edges with a missing or unresolvable endpoint
 *   6. Objects whose groupId points at a group that no longer exists
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node audit/idAudit.mjs <export.json>');
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`Could not read or parse ${path}: ${err.message}`);
  process.exit(1);
}

const projects = Array.isArray(raw?.projects)
  ? raw.projects
  : [{ name: raw?.name || path, ...raw }];

let problemCount = 0;
const flag = (...args) => { problemCount++; console.log(...args); };
const numeric = (a, b) => (Number(a) - Number(b)) || String(a).localeCompare(b);

for (const project of projects) {
  const workspaces = Array.isArray(project?.workspaces) ? project.workspaces : [];
  console.log('\n' + '='.repeat(72));
  console.log(`PROJECT: ${project?.name ?? '(unnamed)'}`);
  console.log('='.repeat(72));

  const nameOf = (ws, i) => ws?.name || ws?.id || `canvas #${i + 1}`;

  // ---- gather ------------------------------------------------------------
  const byId = new Map();          // cardId -> [{ canvas, count }]
  let totalCards = 0;

  workspaces.forEach((ws, i) => {
    const local = new Map();
    for (const node of (ws?.nodes || [])) {
      if (!node || node.id === undefined || node.id === null) continue;
      totalCards++;
      local.set(String(node.id), (local.get(String(node.id)) || 0) + 1);
    }
    for (const [id, count] of local) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ canvas: nameOf(ws, i), count });
    }
  });

  console.log(`Canvases: ${workspaces.length}    Cards: ${totalCards}    Distinct ids: ${byId.size}`);

  // ---- 1. cross-canvas duplicates ---------------------------------------
  const cross = [...byId.entries()].filter(([, p]) => p.length > 1).sort(([a], [b]) => numeric(a, b));
  console.log(`\n-- Same id on more than one canvas: ${cross.length}`);
  if (cross.length) {
    console.log('   Editing one of these silently rewrites the others, including');
    console.log('   their position, and the damage is saved and uploaded.');
  }
  for (const [id, places] of cross) {
    flag(`   id "${id}" -> ` + places.map(p => p.canvas + (p.count > 1 ? ` (x${p.count})` : '')).join('  |  '));
  }

  // ---- 2. within-canvas duplicates --------------------------------------
  const within = [];
  for (const [id, places] of byId) {
    for (const p of places) if (p.count > 1) within.push([id, p]);
  }
  within.sort(([a], [b]) => numeric(a, b));
  console.log(`\n-- Same id twice on one canvas: ${within.length}`);
  for (const [id, p] of within) flag(`   id "${id}" -> ${p.canvas} (${p.count} cards)`);

  // ---- 3. counter forecast ----------------------------------------------
  console.log('\n-- Id counter');
  const nextId = project?.nextId;
  const liveNumbers = [...byId.keys()].map(Number).filter(Number.isFinite);
  const highest = liveNumbers.length ? Math.max(...liveNumbers) : 0;
  console.log(`   stored nextId: ${nextId ?? '(missing)'}    highest id in use: ${highest}`);
  if (typeof nextId === 'number' && nextId <= highest) {
    const clashes = [];
    for (let n = nextId; n <= highest; n++) if (byId.has(String(n))) clashes.push(n);
    flag(`   COUNTER IS TOO LOW. The next ${clashes.length} new card(s) would be born colliding:`);
    for (const n of clashes) flag(`     new card id "${n}" -> already on: ${byId.get(String(n)).map(p => p.canvas).join(', ')}`);
  } else {
    console.log('   Counter is above every live id.');
  }

  // ---- 4. clone references ----------------------------------------------
  console.log('\n-- Clone references');
  let cloneRefs = 0;
  workspaces.forEach((ws, i) => {
    for (const node of (ws?.nodes || [])) {
      const src = node?.cloneSourceId;
      if (!src) continue;
      cloneRefs++;
      const places = byId.get(String(src));
      if (!places) {
        flag(`   card "${node.id}" on ${nameOf(ws, i)} points at missing source "${src}"`);
      } else {
        const total = places.reduce((n, p) => n + p.count, 0);
        if (total > 1) {
          flag(`   card "${node.id}" on ${nameOf(ws, i)} points at AMBIGUOUS source "${src}" (${total} candidates)`);
        }
      }
    }
  });
  console.log(`   ${cloneRefs} clone reference(s) checked.`);

  // ---- 5. edges ---------------------------------------------------------
  console.log('\n-- Edges');
  workspaces.forEach((ws, i) => {
    const local = new Set();
    for (const n of (ws?.nodes || [])) if (n?.id != null) local.add(String(n.id));
    for (const g of (ws?.groups || [])) if (g?.id != null) local.add(String(g.id));
    for (const img of (ws?.images || [])) if (img?.id != null) local.add(String(img.id));
    for (const e of (ws?.edges || [])) {
      if (!e) continue;
      if (e.source == null) flag(`   ${nameOf(ws, i)}: edge "${e.id}" has no source`);
      else if (!local.has(String(e.source))) flag(`   ${nameOf(ws, i)}: edge "${e.id}" source "${e.source}" not found`);
      if (e.target == null) flag(`   ${nameOf(ws, i)}: edge "${e.id}" has no target`);
      else if (!local.has(String(e.target))) flag(`   ${nameOf(ws, i)}: edge "${e.id}" target "${e.target}" not found`);
    }
  });

  // ---- 6. group membership ----------------------------------------------
  console.log('\n-- Group membership');
  workspaces.forEach((ws, i) => {
    const groupIds = new Set((ws?.groups || []).filter(Boolean).map(g => String(g.id)));
    for (const kind of ['nodes', 'groups', 'images']) {
      for (const obj of (ws?.[kind] || [])) {
        if (!obj) continue;
        const gid = kind === 'groups' ? obj.parentGroupId : obj.groupId;
        if (gid && !groupIds.has(String(gid))) {
          flag(`   ${nameOf(ws, i)}: ${kind} "${obj.id}" belongs to missing group "${gid}"`);
        }
      }
    }
  });
}

console.log('\n' + '='.repeat(72));
console.log(problemCount === 0
  ? 'No problems found.'
  : `${problemCount} problem line(s) above. Nothing was changed by this script.`);
console.log('='.repeat(72));
