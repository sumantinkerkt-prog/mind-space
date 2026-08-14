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
| 4 | 42 | Distinguish "no data" from "couldn't read"; never write or upload defaults after an indeterminate read | **Done** — PR #6, merged. Owner-verified over 3 rounds |
| 5 | 30 + minimal 43 | `guardedFirestoreSave` must return a real promise; route queued failures to `enqueueFailedWrite`; `confirmSynced` clears dirty only if the confirmed content hash still matches current local content | Not started |
| 6 | 47 (four leaks only) | Block writes in reference sessions: reminder scheduler metadata, retry-queue execution, canvas-switch local save/flush, `PinPanel` raw setters | Not started |

Then stop and let the owner use the app for 2-3 weeks before anything else.

## Carried forward after Fix 4 (do not lose these)

1. **`cm-debug-simulate-cloud-failure` must be removed after Fix 6.** It is the
   fault-injection switch that made Bug 42 testable at all. Owner agreed to keep it
   through the remediation work. Reuse it for Fix 5 (failed saves), then delete it
   and the manual-test references to it.
2. **The 20-30s blank page on a slow/unreachable cloud is still there.** Cloud
   reads have no time limit and the app renders nothing until they resolve, so a
   flaky connection is indistinguishable from a broken app. Pre-existing, not
   caused by Fix 4, but Fix 4's messages cannot appear until the read resolves.
   Offered to the owner as a follow-up (an ~8s cap plus a "Loading…" state); not
   yet accepted or scheduled.
3. **A missing (as opposed to corrupt) local workspace key is still silent.**
   `loadWorkspace` returning null because the key is ABSENT records no failure, so
   the canvas is dropped from the project with no read-only banner. Deliberately
   not treated as a failure: `workspaceIds` legitimately drifts from the actual
   documents (see the `updateDoc` / failed-precondition issue below), so treating
   every mismatch as damage risked putting the app permanently in read-only. The
   Fix 3 Data Health panel surfaces the consequence.
4. **Owner-testability constraints discovered the hard way** — apply these to every
   future manual test document:
   - The app is served over the internet, so **"turn off Wi-Fi" tests nothing**;
     the browser cannot fetch the app and shows Chrome's offline page.
   - An incognito window has empty local storage but a **full cloud**, so it does
     not produce a first-run state.
   - With a reachable cloud, localStorage is **not** the load source, so corrupting
     local keys exercises nothing on the cloud path (except the per-workspace
     adoption read, which is why the Group D tests did work).
   - Cloud reads take **20-30s** to fail. Any measurement needs a 40s wait, or the
     switch.
   - **No Console line goes into a manual test document until it has been run
     against a real browser.** Two rounds of the owner's time were lost to lines
     that could not have worked.

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
- The Projects panel has **no visible button** — it opens on **Alt+Shift+X**
  (`App.jsx`, "Secret Keyboard Shortcuts"). Ctrl+Shift+/ is a "boss key" that
  jumps to the default project. Worth knowing before hunting for a control that
  does not exist.
- Fragility found while building a test harness, **not fixed**: the Projects
  panel does `p.id.split('')` (App.jsx:7137) to pick a placeholder colour, so a
  project whose stored metadata lacks an `id` **white-screens the whole app** the
  moment the panel is opened, with no error boundary to contain it. A synthetic
  seed triggered it, but a partial cloud write could too. The app also then wrote
  a `cm-proj-undefined` key. Cheap hardening: default the colour index and stop
  trusting `p.id`.

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

## FIXED (PR #5): undo after deleting a project merged two projects together

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

**Fixed in two layers**, because fixing only the one call site would leave the
next author free to reintroduce it:

1. `deleteProject` now clears `pastRef`/`futureRef`/`dragSnapshot` and resets
   `canUndo`/`canRedo`, as `switchProject` and `cycleToProject` already did.
   `dragSnapshot` matters too — it is pushed onto the history when a drag ends.
2. Every snapshot is stamped with its project id and `performUndo`/`performRedo`
   refuse a snapshot belonging to a different project, discarding the stale
   history instead. Cheap to do, because every snapshot in the app is a deep
   clone of `stateRef.current`, so stamping that one object covers all of them
   (takeSnapshot, the undo/redo counter-snapshots, and the four drag snapshots).
   The rule is a pure function in `src/history.js` with tests.

Unstamped snapshots are deliberately allowed: that can only happen before the
app knows which project is open, when there is no other project to contaminate,
and refusing them would silently disable undo.

Note the guard could not raise a toast: `showToast` is declared after
`performUndo`, so naming it in the dependency array would throw a TDZ
ReferenceError during render. It logs `[History] Discarded ...` instead.

Verified: 71 unit tests pass, and in a real browser add-card → undo → redo still
works (4 → 5 → 4 → 5 cards) with the guard staying silent.

## FIXED (PR #6): a failed read was indistinguishable from "no data" (Bug 42)

Every storage reader collapsed two different situations into `null`: "there is
genuinely nothing stored" and "I could not look". `init()` treated `null` as the
first, built the default demo project (`defaultWorkspaces`, App.jsx:252 — note
this is demo *content*, not an empty canvas), wrote it to localStorage, and armed
autosave on it. One transient network error was enough to overwrite everything.

**Three things made it worse than it sounds.**

1. `loadUserMeta()` returning null skipped the *entire* Firestore phase, because
   the phase is gated on `if (userMeta && userMeta.activeProjectId)` — and
   `setSyncStatus('synced')` still ran afterwards.
2. `init()`'s catch-all rebuilt the default project on *any* throw, including a
   localStorage quota error from `saveProjectMeta`/`saveWorkspaceToLocal`, which
   are not try-wrapped.
3. The "Sync now" button in the trust popover set
   `firestoreLoadSucceededRef.current = true` unconditionally, deliberately
   defeating the failed-load guard. One click after a bad boot uploaded whatever
   was in localStorage.

**The shape of the fix.** A new pure module, `src/loadOutcome.js`, classifies
each load as one of FOUR states where the old code understood two:

| Outcome | Meaning | Default project? | Writes? |
|---|---|---|---|
| `LOADED_COMPLETE` | data, no failed reads | no | **yes** |
| `LOADED_PARTIAL` | data, but a read failed | no | **no** |
| `EMPTY_CONFIRMED` | no data, no failed reads | **yes** | **yes** |
| `INDETERMINATE` | no data because a read failed | **no** | **no** |

`LOADED_PARTIAL` matters as much as `INDETERMINATE`: if one workspace of five
fails to read, the project is displayed with four, and saving it would delete the
fifth on the server.

Collection side: `persistenceService.js` gained a read-failure registry. Each of
the ~17 swallowing `catch` blocks now calls `recordReadFailure(source, error)`
while still returning `null`, so **no reader signature changed** — a deliberately
small diff through a load path with no test coverage. Severity is per-source and
**fails closed**: an unrecognised source counts as critical, so a future reader
added without updating the table makes the app read-only and loud, rather than
silently able to overwrite again.

`localStorage:syncState` is classified critical even though it holds no content:
a corrupt map reads back as "every document clean", which is exactly the state in
which `transactionalWrite` skips its revision check and overwrites the server.

**The registry is append-only, read via an offset token** (`beginReadSession()`).
A clearing API would have been unsafe: StrictMode double-invokes the mount effect
in dev, so two `init()` runs overlap, and the second run's reset could wipe the
first run's recorded failure while it was still awaiting Firestore — that run
would then classify an empty result as `EMPTY_CONFIRMED` and create the default
project. The fix, reintroducing the bug. Verified in the browser: both StrictMode
runs independently reach INDETERMINATE.

**Write paths gated** on `writesAllowed()` (= `mayPersist(loadOutcomeRef.current)`):
all four autosave effects (including their *immediate* localStorage writes, which
were previously unguarded), the activeTab effect, the password effect (the one
autosave that never checked `firestoreLoadSucceededRef` at all), the
beforeunload/visibilitychange flush, `handleCanvasSwitch`, `handleManualServerSync`,
`pushDirtyNow`, the retry-queue drain, the dirty-flag recovery sync, and the
"Sync now" override. `applyLoadOutcome` also force-clears
`firestoreLoadSucceededRef` as an independent second layer.

**The dirty flag is no longer cleared after a bad load.** It is the only record
that a previous session had unsynced edits; clearing it destroys recovery
information, so it is now left set for a later healthy session.

**UI.** `INDETERMINATE` renders a blocking screen ("Could not read your data",
"Your data has not been changed", + Reload). This had to be placed **before**
`if (!initialized || !activeWs) return null;` (App.jsx) — with no project there is
no active workspace, so that bail-out otherwise rendered a blank white page,
which is the worst possible thing to show someone whose data you just failed to
read. Found in browser testing, not by reading the code. `LOADED_PARTIAL` renders
a red top banner and stays read-only but readable, so the owner can still copy
things out.

**Verified in a real browser** (Firebase credentials neutered first), 7 scenarios:
genuine first run still gets the starter project; corrupt `cm-meta` with real data
present → blocking screen, `cm-meta` NOT overwritten, no `cm-proj-proj-default`
created, real keys untouched; corrupt single workspace → red banner, other canvas
visible, `workspaceIds` NOT truncated; healthy load unaffected. The decisive
differential: after a partial load, `cm-sync-state` and `cm-tasks-*` are never
created, while a healthy load creates both — proving autosave genuinely did not
run rather than the test being blind. 113 unit tests pass (71 existing + 42 new).

### Round-2 corrections after owner sign-off

Owner's round-1 results: B and D groups all PASS; A1 and C1-C4 unrunnable; C2
FAIL. Every one of those was a defect in **my test document**, caused by writing
it against a sandbox with Firebase disabled. Lessons worth keeping:

- **A cloud-connected app takes a different path than a cloud-less one.** The
  localStorage pointer (`cm-meta`) is only read at App.jsx:1293, inside the `else`
  at 1291 — i.e. only after a cloud read has already failed. Corrupting it while
  the cloud is healthy changes nothing. A1 was invalid for the same reason: an
  incognito window has empty local storage but a full cloud, so the app downloads
  real projects instead of experiencing a first run.
- **"Turn off Wi-Fi" cannot test a web-hosted app.** The browser cannot fetch the
  app itself; you get Chrome's offline page and never reach the code. My sandbox
  served from localhost, which hid this.
- **Cloud reads take 20-30s to fail, not instantly.** Early re-checks used 9s
  waits and wrongly looked like nothing happened. Anything measuring a cloud
  failure needs a 40s wait.
- Therefore: `cm-debug-simulate-cloud-failure` (fault-injection switch) was added
  so the owner can test this at all. Off unless set; reads only; fails in the safe
  direction; announces itself. Also needed for Fix 5. Remove after Fix 6.

### Option A: LOADED_LOCAL_ONLY (owner's decision)

The first version of this fix treated a failed cloud bootstrap read the same as a
failed cloud *content* read, so **a plain offline reload switched the whole app to
read-only** — a regression against the pre-existing 'local-only' mode. Owner chose
Option A ("allow offline editing, with a warning"). Implemented as a fifth outcome:

`CLOUD_BOOTSTRAP_SOURCES` (`firestore:userMeta`, `firestore:allProjects`,
`firestore:loadSequence`) mean the Firestore phase was abandoned before adopting
any cloud content, so the fallback local copy is whole. When those are the ONLY
blocking failures and data loaded → `LOADED_LOCAL_ONLY`:

- `mayPersist` → true (local saves allowed)
- new `mayUploadToCloud` → **false** (never upload blind; this session never read
  the cloud). Edits stay dirty and upload after the next healthy load.
- amber banner + Sync now explains how to get the data uploaded.

Read-only (`LOADED_PARTIAL`) is retained for: cloud unreachable **and** local copy
damaged, or a cloud content read failing part-way.

**This split required a second gate.** `writesAllowed()` (local) vs
`cloudUploadAllowed()` (cloud). Three paths were using the local gate where they
needed the upload gate, and the first version of Option A therefore attempted an
upload while offline, failed, and queued a retry — caught by a browser check that
asserted *no upload attempt at all*, not by unit tests:

- the password effect (both the effect and the project-panel handler),
- the retry-queue drain,
- the canvas-switch flush.

`maybeSnapshot` (a cloud write) was also gated explicitly; its internal
"only after a real sync" guard already blocked it, but that was a coincidence.

**Verified in-browser:** offline + complete local copy → amber banner, editing
works, local save happens, no upload attempted; offline + damaged local copy →
red read-only; offline + no usable pointer → blocking screen; and a
content-level before/after comparison of every stored record proving a blocked
load writes **nothing** (that comparison replaced a broken C2 check which
compared key *names* with mismatched filters). 127 unit tests pass.

**Deliberately left undone** (recorded in MANUAL-TEST-PR6.md §7):

- Two writes still precede the verdict: the per-workspace adoption cache write and
  the project-metadata hydration loop, both inside the Firestore success path.
  Both only write data that was read successfully, and both write per-document
  rather than a shortened list, so neither can destroy a canvas. Moving the
  verdict earlier means restructuring the whole load sequence.
- `fetchServerFreshness` still returns all-null revisions on failure, so the
  caller concludes "nothing newer". Recorded but benign for the load verdict;
  belongs to Fix 5.
- No React error boundary: a render-time throw still blanks the page. The
  blocking screen only covers load failures the load code detects.

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
