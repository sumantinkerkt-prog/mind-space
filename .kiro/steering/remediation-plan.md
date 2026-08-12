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
| 1 | 24 | Scope card edits to the active workspace; clone sync via explicit `cloneSourceId` only | **Done** — PR #2, merged (`56c3aef`) |
| 2 | 16 (counter subset only) | Unify the `nextId` default, derive the counter from the highest live card id before every allocation, fix `addNode`'s same-batch closure read | **Done** — PR #2, merged (`56c3aef`) |
| 3 | 19 (+ shape guard from 58) | Project-wide duplicate-id and dangling-clone check, non-throwing, **visible in production** (not DEV-gated) | **Done** — PR #3, branch `fix/bug-19-58-project-wide-id-detector` |
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
- `gh auth status` reports a login failure — cosmetic, auth works via credential
  helper. Use `gh api` (REST); GraphQL-backed commands like `gh pr` fail.
- Bare `git push` failed with HTTP 400 against the stored gateway remote. Use
  `git push https://github.com/{owner}/{repo}.git HEAD:{branch}`.
- The sandbox checkout was corrupted once mid-session (`fatal: bad object HEAD`,
  files vanished). Push early; re-clone to recover.
- Images are stored as inline base64 in workspace documents, not Firebase
  Storage, so the Storage-ownership bugs (52, 54) do not apply to current data.
- **`src/firebase.js` contains the owner's real, hardcoded Firebase credentials**
  (project `upsworth-mind-rout`), committed to a public repo. Two consequences:
  (a) it belongs in the Fix 6 "lock down the cloud" work — the config is public,
  so write access is only as safe as the Firestore rules; (b) **running the app
  in a sandbox talks to the owner's live cloud data.** Before any local browser
  testing, replace `apiKey` / `projectId` / `appId` with the
  `YOUR_..._HERE` placeholders so `isFirebaseConfigured()` returns false and the
  app stays on localStorage. Restore with `git checkout src/firebase.js`.
- Each sandbox bash call gets a **fresh namespace**: `/tmp` is empty again and
  background processes do not survive between calls. A dev server plus browser
  automation must run inside a single shell script in one call.

## Delivery conventions

- One fix per commit, on a branch per fix, so the owner reviews and merges once
  per fix. Fixes 1 and 2 were the exception: they are sequential and not
  independently testable, which is why they shared PR #2.
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

**Ghost cards on `hetercdtea` — the "React duplicate key" theory was retired too
early.** The owner reported that switching away from `hetercdtea` leaves exactly
**6** cards mounted on the next canvas. The handover said the duplicate-key
explanation was disproved because the audit found "0 same-canvas duplicates" —
but the audit found no such thing. Both this file and a re-run of
`audit/idAudit.mjs` against `audit/sample-transcription.json` report **6 ids used
twice on one canvas, all of them on `hetercdtea`**. Six stranded cards, six
same-canvas duplicate ids, same canvas. Not proof, but the number matches
exactly, and duplicate `key` props are known to make React drop and re-parent
siblings. Re-test on the fresh project before spending time on any other theory.

## Open bug: undo after deleting a project merges two projects together

Found by the owner during PR #3 sign-off (test G1). Not caused by PR #3.

Delete a project, then press Ctrl+Z: every canvas of the **deleted** project
appears inside the project that is now open. Confirmed by the owner with two
`Bravo (Copy)` canvases and `Product Launch Roadmap` all listed under `Test 2`.

**Cause, confirmed in code.** `switchProject` (App.jsx:4478-4481) resets the undo
history with `pastRef.current = []` / `futureRef.current = []`. `deleteProject`
(App.jsx:4808) does not. It swaps `activeProjectId`, calls `setWorkspaces` with
the next project's data, and leaves the history untouched — so the top of the
undo stack is still a `{ workspaces, activeTab, nextId }` snapshot belonging to
the project that was just deleted. `undo()` restores it into the open project.

**Why this is worse than it looks.** The restored state is not a display glitch:

1. It arrives through the normal `setWorkspaces` path, so autosave treats it as
   an edit and **uploads the merged project to the cloud**.
2. It restores the deleted project's `nextId`, rewinding the stored counter.
   Contained by the Fix 2 live-data floor, so no id is reissued, but the stored
   value is left wrong.
3. Canvases from two projects had ids allocated from two independent counters,
   so merging them can produce **cross-canvas duplicate ids** — the Bug 24
   precondition. Inert since Fix 1, but it is the exact condition this whole
   remediation exists to remove.

The Data Health panel from Fix 3 will go red afterwards, which is how this would
now be noticed.

**Fix (not yet applied):** clear `pastRef`/`futureRef` and reset `canUndo`/
`canRedo` in `deleteProject`, exactly as `switchProject` already does. Deliberately
not slipped into PR #3 — the owner had already signed that build off, and adding
code would have invalidated the sign-off. Do it as its own change.

Scope of exposure is narrow: project **switch** already clears history, and
deleting a *canvas* stays within one project where undo is legitimate. Project
deletion is the only route. The owner has said they do not delete projects.

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
