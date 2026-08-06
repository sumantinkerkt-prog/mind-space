# Handover — mind-space remediation

Paste this into a new chat to pick up where the last one left off.
Repo: `sumantinkerkt-prog/mind-space`. Baseline commit: `cd05793`.

---

## 1. The situation

A mind-mapping web app (React 18.3, Vite, Firebase). Single owner, **not a
developer** — cannot read code, has no terminal, sees files through a read-only
file explorer. Explain in plain language and show output in chat.

The owner previously lost data. A code audit produced five documents (02–06) that
live outside the repo: 02 is the bug tracker, 05 maps bugs to code locations, 06
covers undo. Bug numbers below refer to those.

The goal is **not** a perfect app. It is the minimum set of fixes that makes daily
use safe. Accepted compromises: manual sync, one tab at a time, View/Reference
mode as the normal resting state.

**The repo had no tests at all.** Vitest and the first tests were added during
this work.

---

## 2. Where things stand

**[Pull Request #2](https://github.com/sumantinkerkt-prog/mind-space/pull/2)** on
branch `fix/bug-24-workspace-scoped-card-updates` — **open, not merged.**
22 tests pass, `npm run build` succeeds.

| Commit | Contents |
|---|---|
| `d0d804b` | Fix 1 — Bug 24, card edits scoped to the active canvas |
| `acf43fd` | `audit/idAudit.mjs` — read-only data audit tool |
| `372d42a` | `.kiro/steering/remediation-plan.md` — auto-loading rules |
| `45306b5` | Fix 2 — Bug 16 counter, ids derived from live data |

The PR *description* only describes Fix 1, because the available tools can create
a PR but not edit one and `gh` is unauthenticated. The commit messages are the
real record.

New files: `src/nodeUpdate.js`, `src/nodeUpdate.test.js`, `src/cardId.js`,
`src/cardId.test.js`, `audit/idAudit.mjs`, `.gitignore` (repo had none).

---

## 3. The plan — six fixes, then stop

| # | Bug(s) | What | Status |
|---|---|---|---|
| 1 | 24 | Card edits scoped to the active workspace; clone sync only via explicit `cloneSourceId`; ambiguous ids reported, not guessed | **Done** |
| 2 | 16 (counter only) | Ids derived from the highest live card id via a forward-only cursor; `\|\| 1` write defaults unified with the `\|\| 10` reads; all ten creation sites converted | **Done** |
| 3 | 19 + shape guard from 58 | Project-wide duplicate-id and dangling-clone check, non-throwing, **visible in production** (currently `import.meta.env.DEV`-gated and only looks at the active canvas) | **Next** |
| 4 | 42 | Distinguish "no data" from "couldn't read"; never write or upload defaults after an indeterminate read | Not started |
| 5 | 30 + minimal 43 | `guardedFirestoreSave` must return a real promise instead of `true` when it only queues; route queued failures to `enqueueFailedWrite`; `confirmSynced` clears dirty only if the confirmed content hash still matches current local content | Not started |
| 6 | 47 (four leaks only) | Block writes in reference sessions: reminder scheduler metadata, retry-queue execution, canvas-switch local save/flush, `PinPanel` raw setters | Not started |

Then **stop** and let the owner use the app for 2–3 weeks.

---

## 4. Do not do

- **Do not merge PR #8.** It white-screens. Contains cross-tab copy, multi-tab
  awareness and reminder separation — none needed under one-tab discipline. Note
  the owner's docs describe these as if shipped; they are not.
- **Do not start the UUID migration** (rest of Bug 16) or the import/restore
  rework (Bug 48). Largest changes, weakest safety net.
- **Do not add `takeSnapshot()` inside `updateNode`.** Bug 25 is retired — text
  undo already works via one snapshot per edit session. Adding it creates one
  history entry per keystroke.
- **Do not "fix" Bug 15 by adding `workspaceIds` to the metadata fingerprint.**
  The metadata writer strips it deliberately.
- **Do not replace committed-state reads with render-time ref assignments** for
  Bugs 26/33/37. Rejected as concurrent-render unsafe.

---

## 5. The owner's data

**It is a throwaway test project.** Decision: after PR #2 merges, delete it and
start fresh rather than repair it.

Audit of the Aug 2026 export (`node audit/idAudit.mjs <export.json>`):

- 10 canvases, 132 cards, **40 cards caught in id clashes**
- 14 ids shared across canvases — `hetercdtea` and `jdk` share twelve of them;
  `126` exists on `jdk`, `Map Phase 5` and `Map Phase 2 (Copy)`
- 6 ids used twice on a single canvas (all in `hetercdtea`)
- `nextId` was 129 while ids up to 152 were in use, so the next 15 new cards
  would have been born colliding
- 4 connector lines have no starting card
- Probable existing leak: card `126` holds the same long "App Testing Guide" text
  on both `jdk` and `Map Phase 5`, with no clone link between them

After Fix 2 the same project derives 153 as the next id, so it is no longer a
minefield — but it is still messy, so deleting remains the plan.

---

## 6. Usage rules given to the owner

One editing tab. One device. Never delete a canvas (rename to `ZZ-ARCHIVED-…`).
Never use Cut (copy, verify, then delete the original). Never use Import All.
Delete tasks via multi-select even for one task. Don't use multi-select to create
or delete groups. Don't use "export selection" for backups.

**Undo:** one step, immediately, on the canvas where the mistake happened. Never
repeatedly, never after switching canvas, never after a restore or import
(reload first). It does nothing for tasks, reminders, pin groups, canvas rename,
card layering, or pins.

Turn reminders off. Reload the editor tab every ~30 minutes. Export each project
separately (the full backup embeds password hashes; single-project export does
not) and keep the files outside the app.

If the app opens empty or says offline: **stop, don't edit, close the tab.**

---

## 7. Decisions already settled — do not re-litigate

- Undo scope is **per-workspace** (Doc 06 Decision 1, Option A).
- `deleteTask` should **convert** its linked pin to standalone, matching
  `bulkDeleteTasks` — not delete it (decision D2).
- Fixes 1 and 2 share one PR because neither is independently testable off main.
- Bugs 25, 28, 33, 37, 38 are **retired**. Do not count them as open or implement
  their old proposed fixes.
- Bugs 26, 34, 35, 36, 39 need a product decision or runtime verification and
  must not be presented as proven defects.

---

## 8. Working conventions

- One fix per commit. Verify with `npm test` and `npm run build` every time.
- **Prove each fix.** Run the new tests against the *old* logic first and show
  that they fail on it. A passing test that never could have failed is worthless.
- Extract logic into a pure module when that makes it testable — see
  `src/nodeUpdate.js` and `src/cardId.js`.
- Prefer a small reviewable diff over a tidy refactor.
- Never claim something is verified when only the build passed.

**Environment quirks**

- `npm` is not on the PATH. Prefix with
  `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null`.
- `gh` is installed but not authenticated — PR bodies cannot be edited.
- The sandbox checkout corrupted once mid-session (`fatal: bad object HEAD`).
  Push early; re-clone to recover.
- Images are inline base64 inside workspace documents, not Firebase Storage, so
  Bugs 52 and 54 don't apply to current data — but documents are large.

---

## 9. Immediate next actions

1. **Owner merges PR #2.** Quick manual check first: copy a card to another
   canvas; edit the original's title (copy should follow); **drag the original
   (copy must NOT move)**; edit the copy's text (original should follow); create
   two cards quickly (both should survive independently).
2. **Owner deletes the test project** and creates a fresh one.
3. **Agent starts Fix 3** on a new branch — the visible duplicate-id detector.

Live agent-facing rules are in `.kiro/steering/remediation-plan.md`, which loads
automatically in every session on this repo. If it disagrees with this file, that
file wins.
