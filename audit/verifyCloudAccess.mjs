#!/usr/bin/env node
// =============================================================================
// Cloud Access Verification - run AFTER publishing the new Firestore rules
// =============================================================================
// Verifies, against the live Firestore backend over the REST API:
//   1. Rules are live      - reads no longer return PERMISSION_DENIED
//   2. Data is intact      - enumerates every project / workspace / task /
//                            snapshot document and reports counts
//   3. Backup              - writes a full JSON dump to audit/cloud-backup-*.json
//   4. Writes work         - creates, reads back, then DELETES a throwaway
//                            document, proving write + delete permission
//
// DATA SAFETY - this script never mutates real application data:
//   - Every operation on your actual documents is a READ (HTTP GET).
//   - The single write test targets userMeta/__kiro_healthcheck__, a scratch
//     doc. That path is deliberately chosen: persistenceService.js only ever
//     touches doc(db,'userMeta','main') and never enumerates the userMeta
//     collection, so the app can never see this doc. It is deleted afterwards.
//
// Usage:  node audit/verifyCloudAccess.mjs
// =============================================================================

import { writeFileSync } from 'node:fs';

const PROJECT_ID = 'upsworth-mind-rout';
const API_KEY = 'AIzaSyB6_DSBrLmINWOn2KZxC8vXIHPgdGF1BM0';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// NOTE: Firestore reserves any document ID matching the __.*__ pattern, so a
// leading/trailing double-underscore name is rejected with HTTP 400
// INVALID_ARGUMENT before rules are even consulted. Use a plain hyphenated id.
const HEALTHCHECK_DOC = 'userMeta/kiro-healthcheck-tmp';

let failures = 0;
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };
const info = (m) => console.log(`        ${m}`);
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

async function req(method, path, body) {
  const url = `${BASE}/${path}${path.includes('?') ? '&' : '?'}key=${API_KEY}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body, e.g. DELETE */ }
  return { status: res.status, json };
}

/** Convert Firestore REST typed values into plain JS. */
function decode(value) {
  if (value == null) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  return '<unsupported>';
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decode(v);
  return out;
}
const docId = (name) => name.split('/').pop();

// -----------------------------------------------------------------------------

console.log('='.repeat(72));
console.log(' Firestore Cloud Access Verification');
console.log(` Project: ${PROJECT_ID}`);
console.log(` Time:    ${new Date().toISOString()}`);
console.log('='.repeat(72));

// --- 1. Are the rules live? --------------------------------------------------
head('1. Rules reachability');
const probe = await req('GET', 'projects');

if (probe.status === 403) {
  fail('Still PERMISSION_DENIED (HTTP 403).');
  info('The new rules have NOT been published yet, or the publish did not take.');
  info('Go to the Firebase console -> Firestore Database -> Rules, paste the');
  info('new ruleset, and click Publish. Then re-run this script.');
  process.exit(1);
}
if (probe.status !== 200) {
  fail(`Unexpected HTTP ${probe.status}`);
  info(JSON.stringify(probe.json, null, 2).slice(0, 800));
  process.exit(1);
}
pass('Reads permitted - HTTP 200. New rules are live.');
pass('No PERMISSION_DENIED, so the expired test-mode ruleset is gone.');

// --- 2. Enumerate existing data ---------------------------------------------
head('2. Existing data inventory (read-only)');

const projectDocs = probe.json.documents || [];
if (projectDocs.length === 0) {
  info('No documents in the "projects" collection.');
  info('If you expected projects here, do NOT create new data yet - tell me first.');
} else {
  pass(`projects collection listable - ${projectDocs.length} project document(s) found.`);
}

const backup = { exportedAt: new Date().toISOString(), projectId: PROJECT_ID, userMeta: null, projects: [] };
let totalWorkspaces = 0, totalNodes = 0, totalSnapshots = 0, totalTasks = 0;

for (const pdoc of projectDocs) {
  const pid = docId(pdoc.name);
  const pdata = decodeFields(pdoc.fields || {});
  const entry = { id: pid, metadata: pdata, workspaces: [], tasks: null, snapshots: [] };

  info('');
  info(`Project "${pdata.name || '(unnamed)'}"  [${pid}]`);
  info(`  revision=${pdata.revision ?? 'n/a'}  schemaVersion=${pdata.schemaVersion ?? 'n/a'}  lastEditedByDevice=${pdata.lastEditedByDevice ?? 'n/a'}`);
  const declaredIds = Array.isArray(pdata.workspaceIds) ? pdata.workspaceIds : [];
  info(`  workspaceIds declared in metadata: ${declaredIds.length}`);

  // workspaces subcollection
  const ws = await req('GET', `projects/${pid}/workspaces`);
  if (ws.status === 200) {
    const wdocs = ws.json.documents || [];
    totalWorkspaces += wdocs.length;
    info(`  workspaces subcollection: ${wdocs.length} document(s)`);
    for (const w of wdocs) {
      const wid = docId(w.name);
      const wdata = decodeFields(w.fields || {});
      const nodes = Array.isArray(wdata.nodes) ? wdata.nodes.length : 0;
      const edges = Array.isArray(wdata.edges) ? wdata.edges.length : 0;
      const images = Array.isArray(wdata.images) ? wdata.images.length : 0;
      totalNodes += nodes;
      info(`    - "${wdata.name || '(unnamed)'}" [${wid}]  nodes=${nodes} edges=${edges} images=${images} rev=${wdata.revision ?? 'n/a'}`);
      entry.workspaces.push({ id: wid, data: wdata });
    }
    // cross-check metadata against reality
    const actualIds = wdocs.map(w => docId(w.name));
    const orphaned = declaredIds.filter(id => !actualIds.includes(id));
    const unlisted = actualIds.filter(id => !declaredIds.includes(id));
    if (orphaned.length) info(`    NOTE: ${orphaned.length} id(s) in workspaceIds have no document: ${orphaned.join(', ')}`);
    if (unlisted.length) info(`    NOTE: ${unlisted.length} document(s) not listed in workspaceIds: ${unlisted.join(', ')}`);
    if (!orphaned.length && !unlisted.length && declaredIds.length) pass(`  metadata workspaceIds match stored workspace documents exactly.`);
  } else {
    fail(`  could not read workspaces subcollection (HTTP ${ws.status})`);
  }

  // tasks
  const tk = await req('GET', `projects/${pid}/tasks/taskData`);
  if (tk.status === 200) {
    const tdata = decodeFields(tk.json.fields || {});
    const n = Array.isArray(tdata.tasks) ? tdata.tasks.length : 0;
    const g = Array.isArray(tdata.taskGroups) ? tdata.taskGroups.length : 0;
    totalTasks += n;
    info(`  tasks/taskData: ${n} task(s), ${g} group(s)`);
    entry.tasks = tdata;
  } else if (tk.status === 404) {
    info('  tasks/taskData: not present (fine if no tasks were ever created)');
  } else {
    fail(`  tasks read returned HTTP ${tk.status}`);
  }

  // snapshots (version history)
  const sn = await req('GET', `projects/${pid}/snapshots`);
  if (sn.status === 200) {
    const sdocs = sn.json.documents || [];
    totalSnapshots += sdocs.length;
    info(`  snapshots: ${sdocs.length} version-history entr(ies)`);
    entry.snapshots = sdocs.map(s => ({ id: docId(s.name), data: decodeFields(s.fields || {}) }));
  } else if (sn.status !== 404) {
    fail(`  snapshots read returned HTTP ${sn.status}`);
  }

  backup.projects.push(entry);
}

// userMeta/main
const um = await req('GET', 'userMeta/main');
info('');
if (um.status === 200) {
  const udata = decodeFields(um.json.fields || {});
  backup.userMeta = udata;
  pass(`userMeta/main readable - activeProjectId=${udata.activeProjectId ?? 'n/a'} defaultProjectId=${udata.defaultProjectId ?? 'n/a'}`);
} else if (um.status === 404) {
  info('userMeta/main does not exist yet (the app will create it on next save).');
} else {
  fail(`userMeta/main read returned HTTP ${um.status}`);
}

// --- 3. Backup ---------------------------------------------------------------
head('3. Backup');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `audit/cloud-backup-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
pass(`Full cloud export written to ${backupPath}`);
info(`Totals: ${projectDocs.length} project(s), ${totalWorkspaces} workspace(s), ${totalNodes} node(s), ${totalTasks} task(s), ${totalSnapshots} snapshot(s)`);

// --- 4. Write + delete test on a throwaway doc -------------------------------
head('4. Write permission test (throwaway document only)');
info(`Target: ${HEALTHCHECK_DOC} - not read or enumerated by the app.`);

const token = `kiro-verify-${Date.now()}`;
const w = await req('PATCH', HEALTHCHECK_DOC, { fields: { token: { stringValue: token } } });
if (w.status === 200) {
  pass('Write succeeded (HTTP 200) - the app can save to Firestore.');
} else {
  fail(`Write failed (HTTP ${w.status}) - saves will not work.`);
  info(JSON.stringify(w.json, null, 2).slice(0, 500));
}

const rb = await req('GET', HEALTHCHECK_DOC);
if (rb.status === 200 && decodeFields(rb.json.fields || {}).token === token) {
  pass('Read-back matched the written value - round-trip persistence confirmed.');
} else {
  fail('Read-back did not match - writes are not persisting correctly.');
}

const del = await req('DELETE', HEALTHCHECK_DOC);
if (del.status === 200) {
  pass('Throwaway document deleted - no residue left in your database.');
} else {
  fail(`Cleanup delete returned HTTP ${del.status} - please remove ${HEALTHCHECK_DOC} manually.`);
}

// --- Summary ----------------------------------------------------------------
head('Summary');
if (failures === 0) {
  console.log('  \x1b[32mAll checks passed.\x1b[0m Cloud reads, writes, and deletes are working.');
  console.log(`  Your existing data is intact and backed up to ${backupPath}.`);
} else {
  console.log(`  \x1b[31m${failures} check(s) failed.\x1b[0m See above.`);
}
console.log('');
process.exit(failures === 0 ? 0 : 1);
