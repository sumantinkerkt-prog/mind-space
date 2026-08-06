# Remediation plan and working rules

Durable state for this repo. Read this first; it replaces re-reading the whole
conversation history.

## Context

Mind-mapping app (React 18.3 + Vite + Firebase). Single-owner, non-developer.
Owner's stated goal: **minimum safe path to daily use**, not a perfect app.
Accepted compromises: manual sync, one tab at a time, View/Reference mode as the
normal resting state.

Design docs live outside the repo (owner's documents 02-06). Doc 02 is the bug
tracker, Doc 05 maps bugs to code locations, Doc 06 covers undo. Bug numbers in
commits and below refer to those documents. Baseline commit: `cd05793`.

**The repo has no test suite before this work.** Vitest and the first tests were
added with the Bug 24 fix.

## Fix order (agreed with owner)

Only these six are in scope. Everything else is explicitly deferred.

| # | Bug(s) | What | Status |
|---|---|---|---|
| 1 | 24 | Scope card edits to the active workspace; clone sync via explicit `cloneSourceId` only | **Done** — PR #2, unmerged |
| 2 | 16 (counter subset only) | Unify the `nextId` default, derive the counter from the highest live card id before every allocation, fix `addNode`'s same-batch closure read | **Done** — PR #2, unmerged |
| 3 | 19 (+ shape guard from 58) | Project-wide duplicate-id and dangling-clone check, non-throwing, **visible in production** (not DEV-gated) | **Next** — new branch |
| 4 | 42 | Distinguish "no data" from "couldn't read"; never write or upload defaults after an indeterminate read | Not started |
| 5 | 30 + minimal 43 | `guardedFirestoreSave` must return a real promise; route queued failures to `enqueueFailedWrite`; `confirmSynced` clears dirty only if the confirmed content hash still matches current local content | Not started |
| 6 | 47 (four leaks only) | Block writes in reference sessions: reminder scheduler metadata, retry-queue execution, canvas-switch local save/flush, `PinPanel` raw setters | Not started |

Then stop and let the owner use the app for 2-3 weeks before anything else.

## Do NOT do

- **Do not merge PR #8** (cross-tab copy, multi-tab awareness, reminder
  separation). It white-screens. Not needed under one-tab discipline.
- **Do not start the UUID migration** (rest of Bug 16) or the import/restore
  rework (Bug 48). Largest changes, no safety net.
- **Do not add `takeSnapshot()` inside `updateNode`.** Bug 25 is retired; text
  undo already works via one snapshot per edit session. See Doc 05 corrections.
- **Do not "fix" Bug 15 by adding `workspaceIds` to the metadata fingerprint.**
  The metadata writer strips it on purpose.

## Environment quirks

- **`npm` is not on the PATH by default.** Prefix commands with
  `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null`
  or they fail with "npm: command not found".
- The `gh` CLI is present but **not authenticated**, so PR titles and
  descriptions cannot be edited. Put the real explanation in commit messages.
- The sandbox checkout was corrupted once mid-session (`fatal: bad object HEAD`,
  files vanished). Push early; re-clone to recover.
- Images are stored as inline base64 in workspace documents, not Firebase
  Storage, so the Storage-ownership bugs (52, 54) do not apply to current data.

## Delivery conventions

- One fix per commit, stacked on branch `fix/bug-24-workspace-scoped-card-updates`
  so the owner reviews and merges once. Fixes 1 and 2 are sequential and are not
  independently testable, which is why they share a PR.
- Verify with `npm test` and `npm run build` after every fix.
- Extract logic into a pure module when it makes a fix testable (see
  `src/nodeUpdate.js`).
- Prefer a small reviewable diff over a tidy refactor.

## Owner's data (as of the Aug 2026 export)

**The owner's current project is a throwaway test project.** Decision: once Fix 2
lands, delete it and start clean rather than repairing it.

Audit result (`node audit/idAudit.mjs <export.json>`): 10 canvases, 132 cards,
**40 cards caught in id clashes** — 14 ids shared across canvases, 6 ids used
twice on one canvas, and `nextId` at 129 while ids up to 152 are already in use,
so the next 15 new cards would be born colliding.

Probable existing leak: card `126` holds the same long "App Testing Guide" text
on both `jdk` and `Map Phase 5`, with no clone link between them.

## Usage rules given to the owner

Until the fixes land: one editing tab, one device, never delete a canvas, never
use Cut, never use Import All, delete tasks via multi-select, don't rely on undo
(it rewinds the id counter and can *create* the duplicate-id precondition),
turn reminders off, reload the editor tab every ~30 min, export each project
weekly and store the files outside the app.

Extra rules while the current test data is broken: **create no new cards
anywhere**, and don't edit anything on `hetercdtea`, `jdk`, `Map Phase 5`,
`Map Phase 2`, or `Map Phase 2 (Copy)`.

## Communication

The owner is not a developer and cannot read code. Explain in plain language,
name files rather than describing IDE actions, and surface command output and
diffs in chat — they cannot see the terminal. Never claim something is verified
when only the build passed.
