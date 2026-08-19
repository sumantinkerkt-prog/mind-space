# Handover — mind-space

Paste this into a new chat to pick up where the last one left off.
Repo: `sumantinkerkt-prog/mind-space`. `main` = **`a36a5cf`**. 284 tests, green.

---

## READ FIRST

`.kiro/steering/remediation-plan.md` loads automatically and is the durable source
of truth — full design notes, every fix's reasoning, all the traps. **Trust it over
memory, and over this summary.** This file is the short version.

## WHO I AM

Project owner. **Not a developer.** No terminal. I see files through GitHub or a
read-only file explorer. So: plain language, name files rather than IDE actions,
show command output in chat, and **never tell me something is verified when only the
build passed.**

## WHERE THINGS STAND — the remediation is finished

All six agreed fixes are merged, plus two extras. Nine PRs, and a test suite that
went from **zero to 284**.

| # | Bug(s) | What | Status |
|---|---|---|---|
| 1 | 24 | Card edits no longer leak across workspaces | merged (PR #2) |
| 2 | 16 | Card-ID counter contained | merged (PR #2) |
| 3 | 19+58 | Duplicate-ID detector, visible in production | merged (PR #3) |
| — | — | Firestore + Storage security rules | merged (PR #4) |
| — | — | Undo after deleting a project no longer merges two projects | merged (PR #5) |
| 4 | 42 | A failed read is no longer treated as "no data" | merged (PR #6), I verified |
| 5 | 30+43 | Honest saving — no "Saved" before it is saved | merged (PR #7), 13/14 |
| 5b | — | The failed-upload queue | merged (PR #8), 12/12 |
| 6 | 47 | A View tab writes nothing | merged (PR #9), 13/13 |
| — | — | Preview mode retired; View is the only read-only mode | merged (PR #10), 8/8 |

**My rules can relax in exactly one way: a View tab is now safe to leave open next
to an editor tab.** I proved that myself. **One device at a time still stands** —
nothing here fixed two devices working at once.

## WHAT IS STILL OWED

1. **The reminder wipe — found, reproduced, NOT fixed. Do this first.** Details below.
2. **Remove the three debug switches** (`cm-debug-simulate-cloud-failure`,
   `cm-debug-slow-cloud-write`, `cm-debug-fail-cloud-write`). They only existed to
   make Fixes 4/5/6 testable. They live in `src/persistenceService.js` and are
   referenced by MANUAL-TEST-PR6/PR7/FIX5B/FIX6 — removing them breaks the reset
   lines in those documents, which is now fine. Say so when doing it.
3. **Five corrections to `TESTING-PR2.md`**, carried since PR #2, documentation only:
   rename 2C "Clone chain" → "Clone of a clone"; add a console ignore-list; fix the
   4C step-2 red X-Ray expectation; rewrite the Section 5 ghost-card note (the stated
   cause is wrong); add "never run /view/ tabs alongside an editor tab" — **now
   obsolete after Fix 6, so replace that one with a note that it used to be unsafe.**
4. **Housekeeping when I ask:** PR #1 is a stale docs branch, still open on purpose.
   Eight merged branches can be deleted.

Then the plan says **stop and use the app for 2–3 weeks** before anything else.

## THE REMINDER WIPE (open bug, small, mine was hit)

My reminder list emptied itself with no message. Reproduced in a browser. **Not
caused by any of the six fixes** — all the code involved is older.

Two rules contradict each other:

1. `App.jsx` ~1272 and ~1435 do `reminders: proj.reminders || []`. A **missing**
   field becomes an **explicitly empty list**.
2. `App.jsx` ~1489 hydrates state with `activeProj.reminders || DEFAULT_REMINDERS`.
   **An empty array is truthy in JavaScript**, so `[]` counts as a real answer and
   the 8 built-in reminders never come back.

Missing self-heals. Empty sticks forever. Rule 1 turns the first into the second.

Proven in a browser: with `[]` stored, the panel says "No reminders yet" and reloads
never restore the built-ins. Delete the **field** instead and one reload restores all
8 (`7/8` enabled). Two related findings: **a brand-new project is created with
`reminders: []`** (so it starts with none), and **`exportData` contains neither
reminders nor pinGroups** — my backups cannot restore a lost list.

**Proposed fix** (my go-ahead still needed): stop writing `|| []` in the two hydration
paths, and treat an empty list as "use the built-ins" — which the snapshot-restore
path at ~1920 already does. The init path is simply inconsistent with it.

## HOW FIX 6 ENDED UP (read this before touching read-only behaviour)

**The first attempt failed my test.** It guarded ~40 call sites in `App.jsx`. The load
sequence alone writes from a dozen places and it missed some, so a View tab still
changed four canvases, `cm-sync-state` and `cm-proj-*`.

I then described the model I wanted, and it turned out simpler than the code:

```
EDITOR <-> SERVER    read and write
VIEWER  <- SERVER    read only, one way — "load a copy and disconnect"
```

The rebuild puts **one gate at the boundary**: `src/sessionRole.js` answers "is this
tab a viewer?", and `persistenceService.js` — the only module that owns storage —
refuses **24 distinct writes** when it is. `imageStorageService.js` guards its three
Storage calls the same way. Reads untouched. **Do not go back to guarding call sites.**

Three things not to undo:

- **Role detection fails to EDITOR**, deliberately the opposite of `writeGate.js`.
  That one answers "is it safe to save?" and must fail closed; this one only *adds* a
  restriction, and defaulting to viewer would stop the real editor saving.
- **localStorage counts as a write.** It is not private to the tab: an editor tab on
  the same device reads the same keys and uploads them, so a "local only" viewer write
  can still reach the server later. In-memory state (pan, zoom, Shift+D, clipboard)
  stays free.
- **`window.mindspace.probe()`** is a read-only diagnostic, exposed in production on
  purpose: unit tests cannot prove a real tab on a real `/view/` URL is recognised.
  Returns `{ role, wouldBlockWrites, refusedSoFar }`. It exposes no writers.

Also: `isPreviewMode` still exists as a name but now simply means `isReferenceMode`.
~40 guards read it; renaming them would touch every path the six fixes just secured.

## TESTING LESSONS — every one of these cost me a round

1. **The app is served over the internet.** "Turn off Wi-Fi" tests nothing.
2. **Incognito = empty local storage but a FULL cloud.** Not a first-run state.
3. **With a reachable cloud, localStorage is not the load source.** Corrupting local
   keys while online exercises nothing.
4. **Cloud reads take 20–30s to fail.** Any measurement needs a 40s wait, or a switch.
5. **No console line goes into a test document until it has been run in a real
   browser.** Check it mechanically afterwards, not by eye.
6. **Take a baseline before counting anything.**
7. **Turn off every switch a group sets, inside that group.**
8. **Give me document NAMES, not internal types.**
9. **A localStorage snapshot cannot tell you WHICH TAB wrote.** Both of my Fix 6 FAILs
   came from this — my editor tab was open beside the View tab doing its normal
   autosave. `cm-last-snapshot` was the giveaway: only an editor tab can write it.
   **Any "did this tab write?" test must leave exactly one tab running.** Closing the
   other tab first also brings the View tab's own LOAD inside the measurement, which
   is where the real leak was.
10. **Never take a baseline in one tab and the reading in another.**
11. **`npm run build` after EVERY `App.jsx` edit.** A scripted edit left a missing
    comma; `vitest` passed because it does not compile `App.jsx`, and only a browser
    check caught the blank page.
12. **Never ask me to exercise a known-broken feature to test something else.** A
    reminder-toggle step got deleted for this reason — verify it yourself and say so.

## HOW I TEST BRANCH CODE

**Vercel builds a preview for every PR.** On the PR page, bottom of the conversation,
the `vercel` comment → **Preview** link. So I can test before merging.
**That preview talks to my REAL Firebase project** — no test may delete or restructure
data, and the document must say what it touches. Always name the branch so I can find
the right preview.

## TEST SUITE

284 tests, 11 files: `cardId`, `nodeUpdate`, `idAudit`, `history`, `loadOutcome`,
`saveAck`, `retryQueue`, `retryQueueIntegration`, `writeGate`, `sessionRole`,
`viewerBoundary`. `npm test` = `vitest --run`. Run `npm ci` first in a fresh sandbox.

Two patterns worth keeping: **extract pure modules** to make fixes testable, and for
boundary rules **test both halves** — a viewer must not write AND an editor must still
write. A gate that blocks everyone passes the first half and breaks the app.

## OPEN / KNOWN ISSUES (logged, not blocking)

- **20–30s blank page when the cloud is slow or unreachable.** Pre-existing. The app
  renders nothing until the read resolves. An ~8s cap plus a "Loading…" state was
  offered; **I have not decided.**
- **After an upload outage the app re-uploads canvases I never edited.** Caused by
  Fix 5b making `manualServerSync` attempt everything instead of giving up. Honest but
  wasteful with image-heavy canvases. One-line narrowing is written down in the plan
  file, not applied.
- `triesSoFar` in the retry queue **cycles 0→5 then restarts** — expected, not a bug.
- A **missing** (vs corrupt) local workspace key is still silent — deliberate.
- **No React error boundary** — a render-time throw still blanks the page.
- A conflict is still reported internally as a successful save (no visible lie).
- `saveUserMeta` has no retry entry; `ensureWorkspaceIds` /
  `add|removeWorkspaceIdFromFirestore` still use plain `updateDoc`, bypassing the
  retry queue.
- Uploader maintains `syncedHash` but never uses it as a skip guard.
- Projects panel does `p.id.split('')` (~App.jsx:7137) → a project whose metadata
  lacks an `id` **white-screens the app** when the panel opens.
- Jump-to-card centring is instant, not animated. Canvas-switch INP ~229ms. Images are
  inline base64.
- `thoughtflow-tab-presence` warning is a global boolean with no project scoping.
- Ignore: "Unable to preventDefault inside passive event listener", React Router
  future-flag warnings, `[WorkspaceValidator: ...]` dev logs.

## STILL TRUE ABOUT MY DATA

- **Card IDs are still counter-based.** UUID migration deliberately deferred. Fix 2's
  forward-only cursor (`src/cardId.js`, `DEFAULT_NEXT_ID=10`) stops new duplicates.
- **My legacy test project** (10 canvases): 14 ids shared across canvases, 6 duplicated
  on one canvas (all on `hetercdtea`: 94,95,96,101,102,103), nextId 129 vs highest-in-use
  152, 5 broken connections. **Keep it** — it is the only fixture that proves the
  detector detects anything. Do not debug or delete without asking.
- **Ghost cards: theory still unconfirmed.** Switching away from `hetercdtea` strands
  exactly 6 cards; the audit finds exactly 6 same-canvas duplicate ids, all on
  `hetercdtea`. Six and six. Re-check that before building any other theory.
- **COPY / "Duplicate Card"** = fully independent. **CLONE / "Clone Node"** = linked,
  title+content sync both ways, position does not (`nodeUpdate.js` ~66–70).
- **Cloud security is partial.** Rules deny everything outside the exact paths used,
  but there is **no Firebase Auth anywhere**, so all requests are unauthenticated, and
  `src/firebase.js` holds real credentials in a public repo. Development posture only —
  store nothing private. An authenticated ruleset is at the bottom of `firestore.rules`.

## ENVIRONMENT QUIRKS (saves an hour)

- Repo at `/projects/sandbox/mind-space`. Run `npm ci` first.
- npm needs: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22`
- Push explicitly: `git push https://github.com/sumantinkerkt-prog/mind-space.git HEAD:<branch>`
  (bare `git push` fails HTTP 400).
- `gh pr` / `gh issue` FAIL (GraphQL). Use `gh api` REST only. Merge with
  `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=merge`.
- Each bash call is a FRESH namespace: `/tmp` empties, background processes die.
  Files written with the file tool are not visible to bash under `/tmp` — write them
  inside the repo instead.
- **`execute_bash` blocks on inline dev servers.** Write a shell script, then
  `nohup ./script.sh &` + `sleep N` + `cat` the log, all in ONE call.
- **Parallel tool calls can race** — sequence dependent ones.
- **Before any local browser testing:** neuter `src/firebase.js` (`apiKey`,
  `projectId`, `appId` → the `YOUR_..._HERE` placeholders) so the app stays on
  localStorage, or point it at a fake-but-non-placeholder project to test cloud
  FAILURE. Always restore with `git checkout src/firebase.js` and confirm
  `git status` is clean.
- `agent-browser`: `click` by selector is unreliable — use `eval` + `element.click()`.
  It has a `console` command. For a React controlled input, set the value with the
  native setter then dispatch an `input` event.
- Projects panel has **no visible button: Alt+Shift+X**. Ctrl+Shift+/ is a boss key.
- Audit: `node audit/idAudit.mjs <export.json>`; also `audit/verifyCloudAccess.mjs`.

## DELIVERY CONVENTIONS

One fix per commit and per branch/PR. `npm test` **and** `npm run build` after every
fix. Extract pure modules to make fixes testable. Prefer a small reviewable diff over
a tidy refactor. Always give me a manual test document in the style of
`MANUAL-TEST-FIX6.md`: test IDs, plain 5th-grade language, one action per step with the
expected result right after it, fixed test data, PASS/FAIL/BLOCKED/INCONCLUSIVE boxes,
a coverage table, a reset line, an honest section on what the test **cannot** prove,
and a changelog when a document is corrected. **Ask before touching anything outside
the current fix's scope.**

## START HERE

1. Ask me whether to do **the reminder fix** now (recommended — silent data loss,
   small, context is fresh) or to start my 2–3 week usage period first.
2. If yes: one PR, plus a short test document. Do not bundle anything else with it.
3. Then the debug-switch removal and the `TESTING-PR2.md` corrections, whenever suits.
4. Nothing else without asking. The remediation list is complete, and the next thing
   the app needs is me actually using it.
