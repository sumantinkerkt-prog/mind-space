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
 * ---------------------------------------------------------------------------
 * This file is deliberately thin
 * ---------------------------------------------------------------------------
 * All the detection logic lives in `src/idAudit.js`, which the app itself uses
 * to render the in-app Data Health panel. This script only reads a file and
 * prints what that module found.
 *
 * That split is the point. When the checks lived here, the only way to run them
 * was from a terminal with an exported file in hand - which the owner of this
 * project does not have (Bug 19). Reimplementing them a second time for the UI
 * would have produced two checkers that quietly disagreed about the same data,
 * and then neither could be trusted. One set of findings, two ways to read it.
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
import { auditProjectIds, formatAuditLines, SEVERITY } from '../src/idAudit.js';

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

let totalProblems = 0;
let worstSeverity = SEVERITY.OK;

for (const project of projects) {
  const report = auditProjectIds(project?.workspaces, project?.nextId);
  totalProblems += report.problemCount;
  if (report.severity === SEVERITY.CRITICAL) worstSeverity = SEVERITY.CRITICAL;
  else if (report.severity === SEVERITY.WARNING && worstSeverity === SEVERITY.OK) worstSeverity = SEVERITY.WARNING;

  console.log(formatAuditLines(report, { projectName: project?.name ?? '(unnamed)' }).join('\n'));
}

const rule = '='.repeat(72);
console.log('\n' + rule);
console.log(totalProblems === 0
  ? 'No problems found.'
  : `${totalProblems} problem(s) reported above. Nothing was changed by this script.`);
if (worstSeverity === SEVERITY.CRITICAL) {
  console.log('At least one DUPLICATE CARD ID was found - see the sections above.');
}
console.log(rule);
