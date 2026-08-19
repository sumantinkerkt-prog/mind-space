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
| 5 | 30 + minimal 43 | `guardedFirestoreSave` must return a real promise; route queued failures to the retry queue; `confirmSynced` clears dirty only if the ack still covers current local content | **Done** — PR #7, merged (`b155ec3`). Owner-tested: 13 of 14 PASS, C3 FAIL |
| 5b | found by Fix 5's C3 result | The failed-write queue: no frozen payloads, one entry per document, drained during a session, and a failed write must mark its document dirty | **Built** — PR #8, branch `fix/bug-30-43b-retry-queue`, awaiting owner sign-off |
| 6 | 47 (four leaks only) | Block writes in reference sessions: reminder scheduler metadata, retry-queue execution, canvas-switch local save/flush, `PinPanel` raw setters | **Built** — PR #9, branch `fix/bug-47-reference-mode-writes`, awaiting owner sign-off |

Then stop and let the owner use the app for 2-3 weeks before anything else.

## Fix 5 (PR #7): honest saving — Bug 30 + minimal 43

Three changes, plus write-side fault injection so any of it can be tested.

**1. `guardedFirestoreSave` no longer lies (Bug 30).** It used to return `true`
the instant it decided to *queue* a write, before that write ran — so the caller
set the status to "synced" for something that had not happened. If the queued
write then failed, the result was swallowed by a fire-and-forget `.catch()`.
Replaced by `createWriteCoalescer()` in `src/saveAck.js`: the returned promise
resolves with the REAL result of the run that supersedes yours. Superseding is
still correct (whole-document writes, so an older pending write is redundant), but
every waiter now learns the truth. Unexpected throws are converted to `false` and
routed to `enqueueFailedWrite` via a new optional `retryEntry` argument.

**2. `confirmSynced` no longer clears dirty for edits it does not cover (Bug 43).**
`markDirty` now advances a monotonic `dirtySeq`. Each save captures that counter
**at the moment it reads the data** — deliberately outside the guarded callback,
because a coalesced callback runs later, by which time an edit may have bumped the
counter and we would wrongly conclude the ack covered it. `confirmSynced` clears
dirty only when the counter still matches; `baseRev` always advances (this device
did write that revision, and the next upload must build on it or the transactional
writer would conflict against our own write).

**WHY A COUNTER AND NOT A CONTENT HASH — do not "simplify" this back.** The fix
order text says "clears dirty only if the confirmed content hash still matches
current local content". That cannot work, and it fails in the worst direction.
`markDirty` and the upload payload record **different shapes** for the project
metadata document:

```
markDirty(metaPath, { nextId, reminders, pinGroups })      // App.jsx:2597
upload payload      = { ...allProjectMetadata, schemaVersion } // persistenceService
```

Those can never hash equal, so a hash comparison would find project metadata
permanently modified: dirty would never clear, the document would upload forever,
and the trust chip would permanently claim unsaved changes. A counter is shape
independent. Accepted trade-off: an undo back to identical content still costs one
redundant upload — the safe direction.

**3. The trust chip needed no change.** It derives `unsaved` from `hasDirtyDocs`
(App.jsx:7847) and that branch is evaluated **before** the green "Saved" branch,
so an accurate dirty flag makes the chip honest automatically. This is also why
the remaining "a conflict returns success" imprecision produces no visible lie —
the document stays dirty, so the chip still says Unsaved changes.

**Write-side fault injection added**, without which none of this is testable:
`cm-debug-slow-cloud-write` (delay in ms) and `cm-debug-fail-cloud-write`. The
slow one exists because Bug 43 only occurs between a write starting and finishing,
a window of ~200ms in real use. Applied inside `transactionalWrite` so all three
savers are covered, and so a simulated failure travels the genuine error path.
Both fail safe. **All three debug switches must be removed after Fix 6.**

**Verified in-browser (fake Firebase project, 8 checks):** the counter increments;
an ack for old data keeps dirty while advancing baseRev; a quiet document still
goes clean; legacy sync-state without a counter still clears (upgrade safety); a
failed write returns false AND lands in the retry queue; a coalesced write does
not settle before it runs and reports the real result; a failed write leaves
`hasDirtyDocs` true; the slow-write switch really delays. Plus 27 new unit tests
(154 total).

**Not verified by me:** the successful-ack path against a real cloud. A fake
project cannot produce a successful write, so Group B of MANUAL-TEST-PR7.md is the
owner's test against their real Firestore.

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

- **Do not merge the cross-tab branch** (cross-tab copy, multi-tab awareness,
  reminder separation). It white-screens. Not needed under one-tab discipline.
  Earlier notes called this "PR #8"; **that number is now Fix 5b** (opened Aug
  2026, see the table above). No open PR with that content exists on GitHub today
  — `gh api "repos/{owner}/{repo}/pulls?state=all"` lists only #1-#8 — so identify
  it by branch content, never by the number 8.
- **Do not start the UUID migration** (rest of Bug 16) or the import/restore
  rework (Bug 48). Largest changes, no safety net.
- **Do not add `takeSnapshot()` inside `updateNode`.** Bug 25 is retired; text
  undo already works via one snapshot per edit session. See Doc 05 corrections.
- **Do not "fix" Bug 15 by adding `workspaceIds` to the metadata fingerprint.**
  The metadata writer strips it on purpose.

## How the owner tests branch code (answered, Aug 2026)

**Vercel builds a preview deployment for every pull request.** On the PR page,
bottom of the conversation, the `vercel` bot comment → *Preview* link, e.g.
`https://mind-space-git-fix-bug-30-43-honest-saving-mind17.vercel.app/#/editor/<projectId>/<workspaceId>`.

Consequences for every future manual test document:

- The owner can test a branch **before** it is merged; a "Test 0" build check is
  still worth including, because a preview can be stale or the wrong link.
- **The preview talks to the owner's REAL Firebase project.** Tests must never
  delete or restructure data, and the test doc must say what it touches.
- Because it is served over the internet, "turn off Wi-Fi" remains untestable,
  and fault-injection switches remain the only way to test failure paths.
- Say which branch the doc belongs to, so the owner can find the right preview.

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


## MERGED (PR #7): Fix 5, honest saving (Bugs 30 + 43)

Owner-tested on the Vercel preview: **13 of 14 PASS, C3 FAIL.** Merged as
`b155ec3` because C3's failure was not caused by it — see Fix 5b below.

The result that mattered: **B2/B3 passed with `cloudVersion` V6 → V12**, i.e. two
separate uploads happened and the card typed during the first upload survived a
reload. That is the Bug 30/43 data-loss path, closed and confirmed in the owner's
own browser.

Two owner observations worth keeping:

- A2: the chip goes `Unsaved → Syncing → Unsaved → Saved`. That is correct, not a
  glitch: two documents (canvas + project settings) each complete their own
  upload, and the intermediate "Unsaved" is the second one still genuinely
  pending. The old code showed green there.
- D2: after recovery, a canvas sat on **Syncing… for over two minutes** and only
  went green after the owner added another card. Cause found in Fix 5b:
  `manualServerSync` uploaded project metadata FIRST and `return false`d on
  failure, so no canvas was uploaded at all; the new card went up via the
  separate per-canvas debounced path.

## Fix 5b: the failed-write queue (branch `fix/bug-30-43b-retry-queue`)

C3 asked for `writes waiting to retry: 0` after uploads recovered. That number
could not be reached, and chasing why exposed three defects plus two behind them.
**`processRetryQueue` was byte-identical to `main` before this branch** (verified),
so none of this was introduced by Fix 5 — Fix 5 merely stopped the app lying
about failures, which made the queue visible for the first time.

**Owner's evidence, after re-running C1–C3 without C4's reload:** LINE C showed
**9 entries for 5 documents, all one minute old, `triesSoFar: 0`**, while LINE D
said **`nothing unsaved anywhere`**. Nine pending uploads, nothing marked unsaved:
the queue and the dirty map disagreed completely.

### What was wrong

1. **Frozen payloads.** Each entry stored `data` as it was when the write failed,
   and the queue drained on the next page load. If that document had since been
   saved successfully it was no longer dirty — and `transactionalWrite`'s
   revision check only applies to DIRTY documents — so the frozen copy
   overwrote newer cloud content and `confirmSynced` recorded it as the baseline.
   A genuine data-loss route, pre-existing, and the reason the owner was told to
   check the canvases touched during the Fix 5 run.
2. **One entry per ATTEMPT.** 11 → 17 → 9-for-5-documents. Every write here is a
   complete document, so all but the newest attempt were redundant.
3. **No in-session drain.** Processed only at page load and on the `online`
   event. The self-rescheduling `setTimeout` only ran if the queue was already
   non-empty when a pass started, so a queue that filled up during a session was
   never touched until reload. Hence C3.
4. **`manualServerSync` abandoned everything after one failure** (the D2 note).
5. **A failed project-metadata write marked nothing dirty.**
   `saveProjectToFirestore` is called from ~10 places in App.jsx (rename, password
   effect, project hydration loop, import, canvas-management paths); most are
   fire-and-forget with no `markDirty`. So the failure was invisible to the chip
   AND unrecognisable to any retry policy. This is the best explanation for the
   six extra `project settings` entries the owner saw appear during C3.

### The shape of the fix

New pure module `src/retryQueue.js` (43 unit tests): `retryKey`, `backoffMs`,
`normaliseEntry`, `normaliseQueue`, `mergeQueueEntry`, `planRetry`,
`applyRetryOutcome`, `removeQueueEntry`.

**The load-bearing rule: a retry only ever happens for a document that is still
marked dirty.**

- Not dirty ⇒ nothing of ours is missing from the cloud ⇒ drop the entry WITHOUT
  writing. This is what removes defect 1.
- Dirty ⇒ `transactionalWrite` performs its revision check, so a retry cannot
  clobber a newer cloud revision; it routes to the conflict flow instead.

That rule depends on `noteWriteFailed()` (new) marking the document dirty on every
failed write — defect 5's fix is what makes defect 1's fix safe. **Do not remove
the `markDirty` in `noteWriteFailed` without re-reading this.**

Other decisions:

- Entries carry **no content**. A retry re-reads the current local copy
  (`loadProjectMeta` / `loadWorkspace` / `loadTasks`) and sends that.
- `loadRetryQueue` normalises on every read, which **migrates and defuses
  pre-Fix-5b entries already sitting in the owner's browser** — the frozen `data`
  is discarded, and duplicates collapse.
- `confirmSynced` calls `dropQueuedWriteForPath` when it clears dirty, so the
  count falls the moment a document is genuinely saved rather than at the next
  drain. This is what makes C3's expectation reachable.
- Drained on the existing 20-second heartbeat in App.jsx, gated on
  `cloudUploadAllowed()` like every other cloud write. The old self-scheduling
  timer is gone; it only existed because nothing else drained the queue.
- After `MAX_RETRY_COUNT` (5) the entry is dropped but the document **stays
  dirty**: it really is unsaved, the chip should keep saying so, and the next edit
  or heartbeat sync tries again.
- `manualServerSync` attempts every document and returns the aggregate result.

Verification: **211 unit tests** (154 before + 43 pure + 14 integration). The
integration file `src/retryQueueIntegration.test.js` drives the REAL
persistenceService against a fake Firestore and fake localStorage, using the app's
own `cm-debug-fail-cloud-write` switch so failures travel the genuine path. It
proves, among other things: a retry uploads current content and not the frozen
copy; a clean document's entry is dropped with **zero** write attempts; 12 failed
writes across 2 documents leave 2 entries; and a failing metadata write no longer
stops the canvas going up. Browser check: app boots, renders, survives past the
20-second heartbeat with a clean console (Firebase credentials neutered first,
then restored with `git checkout src/firebase.js`).

**Not verifiable by the owner** (recorded in MANUAL-TEST-FIX5B.md §7): the
Console switch fails ALL writes, so "only the project-settings write fails" and
"gives up after 5 attempts" are covered by automated tests only. Say so plainly
rather than implying the owner verified them.

### Still open in this area

- `saveUserMeta` still has no retry entry.
- `ensureWorkspaceIds` / `addWorkspaceIdToFirestore` / `removeWorkspaceIdFromFirestore`
  still use plain `updateDoc`, bypassing `guardedFirestoreSave` and the retry
  queue entirely.
- A conflict is still reported to the caller as a successful save (`return true`),
  and a retry of a conflicted document therefore drops its queue entry. The
  conflict flow owns the data at that point, so nothing is lost, but it is
  imprecise.
- **We still do not know whether the owner's project-metadata uploads fail for a
  real reason.** With Fix 5b such a failure is now visible (chip + LINE D), so
  the next test round answers it. If it does fail, get the exact text after
  `[PersistenceService] Error saving project to Firestore:` from the Console.

## Extra testing lessons (Fix 5 round)

Add to the list further up:

6. **Take a BASELINE reading before any test that counts something.** The Fix 5
   document asked the owner to compare a queue length without ever establishing
   what it was before the test started, so 11 was uninterpretable.
7. **Turn off every switch a group sets, inside that group.** Group B of the Fix 5
   doc set `cm-debug-slow-cloud-write` to 2500ms and never cleared it, so it was
   still set during Group C.
8. **Give the owner document NAMES, not internal types.** LINE B printed
   `workspace, project, project, ...`; the owner reasonably asked which workspace.
   LINE C now prints the project and canvas names.


### Owner sign-off (Fix 5b, PR #8): 12 of 12 PASS

Test 0 confirmed the Fix 5b build via the entry shape. Groups A-D all PASS,
including the two that mattered most:

- **B2** — the count stopped growing. Two runs: 6 documents stayed 6, and 3 stayed
  3, across a minute of continuous failure. The pre-Fix-5b queue reached 17 for
  the same amount of work.
- **C3** — a card written during an upload outage and a card written after it both
  survived **two** reloads, which is the check that the frozen copy is gone.
- **D1** — a failed project-settings upload now shows up in the unsaved list. That
  path was completely silent before.

Two behaviours the results revealed. **Neither is a fault, and neither blocked the
sign-off**, but do not "fix" them without reading this:

1. **During an outage, every canvas in the project ends up marked unsaved and
   queued** (the owner saw 4 canvases + settings + task list). This is a direct
   consequence of the Fix 5b change to `manualServerSync`: it no longer abandons
   the remaining documents when one write fails, so it now attempts every
   workspace whose `lastModified` is newer than `_lastSyncedTimestamps` — and that
   in-memory map is empty after a page load, so nothing is skipped. Each failed
   attempt then marks that canvas unsaved, honestly: this session never had a
   confirmed cloud write for it. The cost is that after an outage the app
   re-uploads canvases the user never edited (extra revision bumps, and real
   bandwidth for image-heavy canvases, since images are inline base64).
   **Available follow-up, NOT done:** skip non-dirty workspaces in
   `manualServerSync` the way the debounced workspace autosave already does
   (`if (!isDirty(wsPath(pid, wsId))) continue`). Deliberately not bundled into
   Fix 5b - it narrows the contract of the one path that exists to force
   everything up, and it would have needed another round of the owner's time.
2. **`triesSoFar` cycles instead of climbing.** The owner saw 3, then 2 on the
   next reading. Expected: at 5 attempts an entry is dropped
   (`attempts-exhausted`), the next failed write re-queues the same document at 0,
   and it climbs again. The document stays marked unsaved throughout, so nothing
   is lost or forgotten - "give up" only ends the current sequence of retries, it
   never abandons the data. Worth knowing before reading a counter as a total.

Still unanswered, and now testable: whether the owner's project-settings uploads
fail for a real reason when no debug switch is set. With Fix 5b such a failure
appears in the chip and in the unsaved list, so a normal session will show it. If
it happens, get the text after `[PersistenceService] Error saving project to
Firestore:` from the Console.


## Fix 6 (Bug 47): a reference tab writes nothing — branch `fix/bug-47-reference-mode-writes`

### The structural problem, which mattered more than the four leaks

The app had a gate for the LOAD VERDICT (`writesAllowed` / `cloudUploadAllowed`,
Fix 4) whose docblock claimed "every path that persists anything must pass through
this" — but it was **mode-blind**. Reference-ness was enforced separately, by
scattering `if (isPreviewMode) return;` / `if (isReferenceMode) return;` through
roughly twenty individual effects and handlers. Any path added without knowing that
convention wrote from a `/view/` tab. That is not four bugs, it is one missing
concept producing four bugs.

Fix 6 folds the mode INTO the gate:

```js
const routeModeRef = useRef('editor');                       // assigned every render
routeModeRef.current = isReferenceMode ? SESSION_MODE.REFERENCE : SESSION_MODE.EDITOR;
const writesAllowed      = () => sessionMayPersist({ mode: routeModeRef.current, outcome: loadOutcomeRef.current });
const cloudUploadAllowed = () => sessionMayUploadToCloud({ mode: routeModeRef.current, outcome: loadOutcomeRef.current });
```

**Why a ref and not the boolean.** The mode can change WITHOUT a remount: the
editor session timer redirects an editor tab to `/view/...` while the app stays
mounted. Several write paths live in `useCallback(..., [])` closures which would
keep reading the mode as it was on first render. A ref assigned during render is
always current, and matches the existing `editorSessionTimerBlockedRef` pattern.
**Do not "simplify" this to capturing `isReferenceMode` directly.**

Rules extracted to `src/writeGate.js` (pure, 24 tests, full truth table written out
explicitly rather than derived). It **fails closed**: only `mode === 'editor'` may
write, so the unbuilt `/shared/` route, and any future print/embed view, are
read-only by default and must opt in.

### The four leaks, and how much each was actually leaking

Worth recording honestly, because two of the four were latent and a future reader
should not think they were all live data loss:

| # | Leak | Reality |
|---|---|---|
| 1 | Reminder scheduler (App.jsx ~4001) ran its 60s tick and mutated `lastShownAt`/`nextReminderAt` | **Latent.** The metadata autosave blocked the write (`isPreviewMode`), and the notification render is also `!isPreviewMode` (App.jsx ~10092), so no write and no pop-up. One guard removal from writing project settings every minute. |
| 2 | Retry-queue drain on init and on `online` (App.jsx ~2131) | **LIVE, and into the cloud.** Only gated by `cloudUploadAllowed()`, which was true on a healthy `/view/` load. A read-only tab uploaded the editor tab's queued writes. The in-code comment there already said reference gating "belongs to Fix 6". |
| 2b | The same call inside the 20s heartbeat (added by Fix 5b) | Already safe — that whole effect returns on `isReferenceMode`. Do not remove that guard. |
| 3 | `handleCanvasSwitch` (App.jsx ~5179) wrote the canvas being left to localStorage and flushed pending cloud writes | **LIVE, to local storage. Measured in a browser.** Fixed by extending the existing early-out, NOT by returning: `setActiveTab` must still run or a viewer cannot navigate. |
| 4 | `setPinGroups` and `setReminders` passed raw to PinPanel / ReminderPanel (7 reminder handlers + 5 pin-group mutators) | **Not to storage, but the panels lied.** Measured: a viewer could add a pin group, it appeared in the list, and was silently discarded on reload. Now guarded at the setter (`setPinGroupsIfEditable`, `setRemindersIfEditable`) so it is safe wherever the call comes from. |

Also made explicit: the dirty-flag branch at App.jsx ~1653 now checks
`!isReferenceMode` as well, because `writesAllowed()` being false in a reference
tab would otherwise make it log "this load was not trustworthy", which would be a
false diagnosis.

### Deliberately still written by a reference tab (owner told, decision open)

Per-device interface preferences, not project data, and one of them exists FOR
presenting. Recorded so nobody "fixes" them by accident:

- `tf-panel-width-pct` (App.jsx ~809) — panel width.
- `tf-view-show-card-descriptions` (App.jsx ~709) — the Shift+D choice, whose own
  comment says it is persisted so a presenter's choice sticks.
- `nexus-clipboard*` — `copyNode` is deliberately not preview-gated; copying out is
  what a collector tab is for.
- `thoughtflow-tab-id` (App.jsx ~2260) — 4-second heartbeat, only on browsers
  without BroadcastChannel.

The owner was asked in MANUAL-TEST-FIX6.md §1 whether they want literally zero
writes; if they say yes, each is a one-line change.

### Verification

**235 unit tests** (211 before + 24 for the gate). `npm run build` clean.

**Browser differential, run twice against the same script — once on `main`, once on
this branch** (Firebase credentials neutered first, restored after):

| Check | `main` | this branch |
|---|---|---|
| View tab: switch canvas, open panels, wait 70s → stored keys | **`cm-ws-proj-default-ws-1` CHANGED** | nothing changed at all |
| View tab: add a pin group | **appeared in the list** (and was not stored) | does not appear |
| Editor tab: same canvas switch | writes `cm-proj-*`, `cm-ws-*`, `cm-last-location` | identical — no regression |
| Editor tab: add a pin group | saved into `cm-proj-*` | identical — no regression |

**What could NOT be verified in the sandbox, and is said plainly in the test doc:**

- **Leak 2 is untestable locally.** With no working cloud the app enters local-only
  mode, where `cloudUploadAllowed()` is false for an unrelated reason, so the code
  path cannot be reached on either build. Only the owner's Group C (retry-queue
  counters unchanged in a View tab) can demonstrate it.
- **Leak 1 has no observable symptom** on either build, because pop-ups were
  already suppressed at render and the state it changed was never persisted. The
  fix rests on the code change plus the gate's tests. Do not let a future summary
  claim the owner verified it.

### After Fix 6 sign-off

1. **Remove the three debug switches** — `cm-debug-simulate-cloud-failure`,
   `cm-debug-slow-cloud-write`, `cm-debug-fail-cloud-write` — and their references
   in MANUAL-TEST-PR6/PR7/FIX5B/FIX6. Deliberately NOT done in this PR: they are
   what makes Fix 6's Group C testable, so they must survive until it passes.
   Removing them will break the panic lines in every existing test doc; that is
   fine, but say so when you do it.
2. **Then stop.** The owner uses the app for 2-3 weeks before any further work.
   The one-tab rule can relax once this is merged, but the one-DEVICE rule stays.
3. Still owed, documentation only: the five corrections to TESTING-PR2.md carried
   since PR #2, and the optional `manualServerSync` narrowing recorded under Fix 5b.


## FOUND, NOT FIXED: the reminder list wipes itself silently

Reported by the owner during Fix 6 testing ("all the reminders wipe out, and it
happened silently"), then reproduced in a browser. **Not caused by Fix 5, 5b or 6** —
every line involved predates them. Small data, but it is silent loss of project
settings, which is the exact class this remediation exists to remove.

**Two rules in the code contradict each other.**

1. `App.jsx` ~1272 (cloud-load metadata hydration loop) and ~1435 (migration
   write-back) both do `reminders: proj.reminders || []`. If the source document has
   **no** `reminders` field, "not found" is written down as **an explicitly empty
   list**.
2. `App.jsx` ~1489 hydrates state with `activeProj.reminders || DEFAULT_REMINDERS`.
   **In JavaScript an empty array is truthy**, so `[]` counts as a real answer and
   the 8 built-in reminders never come back.

Rule 1 converts the self-healing case (field missing) into the sticky case (field
empty). After that the list stays empty forever, with no message.

**Reproduced in a real browser** (credentials neutered): with `reminders: []` stored,
the panel shows "No reminders yet", counter `0/0`, and repeated reloads never restore
the built-ins. Delete the `reminders` FIELD instead and one reload restores all 8
(`7/8` enabled) and re-saves them. So the difference between "empty" and "missing" is
the whole bug.

Two related facts found while checking:

- **A brand-new project is created with `reminders: []`** (App.jsx ~4619/4630), so a
  new project starts with zero reminders rather than the 8 built-ins. Same for
  duplicate-project (~4970) and import-all (~5488).
- **`exportData` does NOT include reminders or pinGroups** — it is
  `{ workspaces, activeTab, nextId, tasks, taskGroups }` (App.jsx ~5308). The owner's
  weekly export files therefore cannot restore a lost reminder list. Worth telling
  them before promising any recovery from a backup.

**Recovery is unreliable while the cloud copy is empty**, because the hydration loop
re-copies the cloud value on every load. Deleting the local field helps only if the
CLOUD document also lacks the field (then state falls back to the built-ins each
load). If the cloud holds `[]`, the fix has to be in code.

**Proposed fix (owner asked to decide, not yet approved):** stop writing `|| []` in
the two hydration paths (leave the field alone when the source has none), and treat
an empty list as "use the built-ins", which is what the snapshot-restore path at
~1920 already does (`d.meta.reminders && d.meta.reminders.length ? ... : DEFAULT_REMINDERS`).
The init path is simply inconsistent with it. Keep it a separate PR after #10.

## Manual test document: reminders removed from the owner's test

The Fix 6 document originally asked the owner to toggle a reminder (A4) to prove the
new guarded setter still works in an editor tab. Two rounds of feedback later, that
step is **deleted**: reminders are a known-buggy area, the owner had just lost their
list, and asking them to click a broken feature to test an unrelated fix was a bad
trade. **I verified both halves myself in a browser instead**, and the test document
says so rather than implying the owner checked it:

- Editor tab: clicking a reminder's Disable switch changed stored state (7 enabled →
  6, `Drink Water=off` persisted).
- View tab: 8 switches render, clicking one changes **nothing** — not the stored data
  and not even the panel's own `7/8` counter.

General lesson for future test docs: **never ask the owner to exercise a feature that
is on the known-broken list in order to test something else.** Verify it yourself and
report it, or leave it out.


## Fix 6, SECOND ATTEMPT: the viewer boundary (the owner's model)

The first attempt (commit `8c70953`) **failed the owner's test**, and the owner then
described the architecture they actually wanted. They were right, and it is simpler
than what the code had grown into:

```
EDITOR <-> SERVER    read and write
VIEWER  <- SERVER    read only, one way: "load a copy and disconnect"
```

### Why attempt one failed

It guarded **call sites** — roughly forty `if (isPreviewMode) return;` /
`if (!isReferenceMode)` / `if (!writesAllowed())` checks spread through App.jsx. The
load sequence alone calls `saveWorkspaceToLocal`, `saveProjectMeta` and
`seedSyncState` from about a dozen places, and guarding them one at a time is
guesswork you cannot prove complete. The owner's Group B result showed four canvases,
`cm-sync-state`, `cm-proj-*` and `cm-last-snapshot` changing during a View session.

### The fix: one gate, at the boundary

`src/sessionRole.js` (pure, 10 tests) answers one question: is this tab a viewer?
`persistenceService.js` — the only module that owns storage — refuses **24** distinct
writes when it is, via `viewerMustNotWrite(label)`. Covered: `cm-meta`, project
metadata, canvases, canvas removal, tasks, the whole sync-state map (which covers
`markDirty` / `seedSyncState` / `confirmSynced` / `rebaseDirty` in one place),
tombstones, the retry queue and its drain, the device name, `guardedFirestoreSave`,
`transactionalWrite`, all five Firestore savers, the three workspace-list mutators,
the two delete paths, `manualServerSync` and `createSnapshot`. `imageStorageService`
guards its three Storage calls the same way.

Reads are deliberately untouched.

**Role detection fails to EDITOR, not viewer** (`roleFromLocation`). Note this is the
opposite choice from `writeGate.js`, on purpose: that predicate answers "is it safe to
save?" and must fail closed, while this one only ADDS a restriction, and a parsing
quirk defaulting to viewer would stop the real editor from saving — a worse failure
than the leak. Being a viewer requires a `/view/` URL, which is unambiguous.
App.jsx also calls `setSessionRole()` on every render so the answer follows the
router explicitly, not just the sniffed URL.

**localStorage counts as a write, and this is worth defending.** The owner's note said
a viewer may make local changes as long as nothing reaches the server. But this app's
localStorage is not private to the tab: an editor tab on the same device reads the
same keys and uploads them, so a "local only" viewer write can reach the server later
through the editor. In-memory state (pan, zoom, hide descriptions, clipboard) stays
free.

**A read-only diagnostic is exposed in production**: `window.mindspace.probe()` →
`{ role, wouldBlockWrites, refusedSoFar }`. Unit tests cannot prove that a real tab on
a real `/view/` URL is recognised; this lets the owner ask the running tab. It exposes
no writers. Verified in a browser: `editor` on `#/editor/`, `viewer` on `#/view/`, and
it flips correctly when a tab's URL changes to `/view/` **without a reload** — the
editor-session-timer case.

### Verification

**284 tests** (245 + 39 new). `src/viewerBoundary.test.js` calls every writer twice:
as a viewer (storage must be untouched) and as an editor (it must still write). The
editor half is not decoration — a gate that blocked everyone would pass the viewer
half and break the app. Browser: a View tab loads, switches canvas, opens panels, sits
45s → **no `cm-*` change at all**; an editor tab doing the same switch still writes
`cm-proj-*`, `cm-ws-*`, `cm-last-location`.

**Still not verifiable in the sandbox:** the cloud-upload leak. Without a working
cloud the app enters local-only mode, where uploads are blocked for an unrelated
reason, so that path is unreachable on either build. Only the owner's Group C reaches
it.

## Testing lessons from this round (expensive ones)

9. **A localStorage snapshot cannot tell you WHICH TAB wrote.** Both of the owner's
   FAILs came from this. Their editor tab was open beside the View tab, doing its
   normal autosave and its ten-minute snapshot, and my LINE S/LINE X pair blamed the
   View tab. `cm-last-snapshot` was the giveaway: only an editor tab can write it.
   **Any "did this tab write?" test must leave exactly one tab running** — take the
   baseline, close the other tab, then act. Doing so also brought the View tab's own
   LOAD inside the measurement, which is where the real leak was.
10. **Do not take a baseline in one tab and the reading in another.** Group C's
    "before" numbers were taken in the editor tab, which then kept retrying uploads
    every 20 seconds by itself. The numbers had already moved before the viewer did
    anything.
11. **`npm run build` after EVERY App.jsx edit, not just after the last one.** A
    scripted edit left a missing comma in an import list. `vitest` passed (it does not
    compile App.jsx), and the blank page was only caught by a browser check. Tests
    passing is not the same as the app loading.
