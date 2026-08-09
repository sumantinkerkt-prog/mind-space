# Test checklist — PR #2 (Bug 24 + Bug 16)

Every step has an expected result. If a result differs, stop and record which
step number failed.

**Corrected from an earlier draft:** Copy and Clone are different operations and
are tested separately. A copied card is fully independent. A cloned card shares
title and content only.

---

## What syncs and what does not

Verified in `src/nodeUpdate.js` (lines 66-70) — only these two fields are ever
shared between linked cards:

| Field | Shared between clones? |
|---|---|
| Title | **Yes** |
| Content (body text) | **Yes** |
| Position (x/y) | No |
| Theme / colour | No |
| Group membership | No |
| Connections / edges | No |
| Size | No |

Sync is **two-way**: editing the original updates its clones, and editing a
clone updates the original and its sibling clones.

## The six card operations

| Menu item | Where | Creates | Linked? |
|---|---|---|---|
| **Duplicate Card** | right-click card | copy on same canvas, title gains ` (Copy)`, offset +40/+40, keeps group | **No** |
| **Copy Node** → **Paste Node Here** | right-click card, then right-click canvas | copy at cursor, same title | **No** |
| **Clone Node** | right-click card | clone on same canvas, identical title, offset +60/+60, no group | **Yes** |
| **Clone to Tab…** | right-click card → pick tab | clone on another canvas, identical title, no group | **Yes** |
| **Cut Node** | right-click card | — | not tested, see note |
| **Delete Card** | right-click card | — | — |

`Cut Node` is excluded on purpose: the standing usage rule is to copy, verify,
then delete the original. Do not test Cut.

## Three tools you will use

1. **Duplicate-ID warning (X-Ray button).** Right-hand vertical toolbar, the
   stacked-layers icon, below the mini-map button. It turns **red on its own**
   when two cards on the *current* canvas share an ID. Hover it for the count.
   Clicking fades all cards to 50% so stacked cards become visible.
   It only checks the canvas you are looking at, not the whole project.
2. **Clone Nodes panel — press `C`.** Lists every card that has clones, and for
   each one, every linked instance with the canvas name.
3. **Browser console — `F12`, "Console" tab.** Card IDs are not shown in the UI,
   so this is where duplicate-ID warnings appear.

## Setup

1. Create a **new** project named `PR2-TEST`. Do not use your real project yet.
   - *Expected:* project opens with a default canvas.
2. Create two canvases named exactly `TEST-A` and `TEST-B`.
   - *Expected:* two tabs, both switchable.
3. Open `F12` → Console. Leave it open.
   - *Expected:* no red errors on load.

---

# Section 1 — COPY must stay independent

## 1A. Duplicate Card (same canvas)

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A`, create a card. Title `ORIGINAL`, content `original text`. | Card appears. |
| 2 | Right-click it → **Duplicate Card**. | A second card appears offset down-right, titled `ORIGINAL (Copy)`, content `original text`. |
| 3 | Change `ORIGINAL` title to `ORIGINAL-EDITED`. | Copy title stays `ORIGINAL (Copy)`. **Unchanged.** |
| 4 | Change `ORIGINAL` content to `changed text`. | Copy content stays `original text`. **Unchanged.** |
| 5 | Change `ORIGINAL` colour to red. | Copy keeps its original colour. |
| 6 | Edit the copy's content to `copy text`. | `ORIGINAL-EDITED` content stays `changed text`. **Unchanged.** |
| 7 | Drag `ORIGINAL-EDITED` across the canvas. | Copy does **not** move. Both drag independently. |
| 8 | Press `C`. | Clone panel says no clone nodes yet. Copies are not clones. |
| 9 | Check the X-Ray button. | **Not red.** |
| 10 | Delete `ORIGINAL-EDITED`. | Copy still exists, unchanged. |
| 11 | Reload the page (`F5`). | Copy still there with correct text. |

## 1B. Copy / Paste on the same canvas

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A`, create card `SRC` / content `src text`. | Card appears. |
| 2 | Right-click it → **Copy Node**. | Menu closes. No visible change. |
| 3 | Right-click empty canvas. | Menu now includes **Paste Node Here**. |
| 4 | Click **Paste Node Here**. | New card at the cursor, title `SRC`, content `src text`. |
| 5 | Edit `SRC` content to `src changed`. | Pasted card stays `src text`. **Unchanged.** |
| 6 | Edit the pasted card's title to `PASTED`. | `SRC` title unchanged. |
| 7 | Drag `SRC`. | Pasted card does not move. |
| 8 | X-Ray button. | **Not red.** |

## 1C. Copy across canvases — the important one

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A`, create card `A-CARD` / content `A text`. | Card appears. |
| 2 | Right-click → **Copy Node**. | Menu closes. |
| 3 | Switch to tab `TEST-B`. | `TEST-B` canvas shown. `A-CARD` is **not** here. |
| 4 | Right-click canvas → **Paste Node Here**. | Card appears on `TEST-B`, title `A-CARD`, content `A text`. |
| 5 | Rename the `TEST-B` card to `B-COPY`. | Title changes on `TEST-B`. |
| 6 | Switch to `TEST-A`. | `A-CARD` still titled `A-CARD`. **Unchanged.** |
| 7 | Edit `A-CARD` content to `A changed`. | — |
| 8 | Switch to `TEST-B`. | `B-COPY` content still `A text`. **Unchanged.** |
| 9 | Change `B-COPY` colour to green. | — |
| 10 | Switch to `TEST-A`. | `A-CARD` colour unchanged. |
| 11 | Drag `A-CARD` to a clearly different spot. Switch to `TEST-B`. | `B-COPY` has **not** moved. |
| 12 | On `TEST-A`, delete `A-CARD`. Switch to `TEST-B`. | `B-COPY` still exists, content `A text`. |
| 13 | Reload. Check both canvases. | `TEST-A` has no `A-CARD`; `TEST-B` still has `B-COPY`. |
| 14 | X-Ray button on both canvases. | **Not red** on either. |

**Any sync between the two in steps 6–12 is a bug. Stop and report it.**

---

# Section 2 — CLONE must stay linked

## 2A. Clone Node (same canvas)

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A`, create card `MASTER` / content `master text`. | Card appears. |
| 2 | Right-click → **Clone Node**. | Clone appears offset +60/+60, title **exactly** `MASTER` (no ` (Copy)`), content `master text`. |
| 3 | Edit `MASTER` title to `MASTER-V2`. | **Both** cards now read `MASTER-V2`. |
| 4 | Edit `MASTER-V2` content to `shared text`. | **Both** show `shared text`. |
| 5 | Edit the **clone's** content to `edited from clone`. | **Both** show `edited from clone`. Sync is two-way. |
| 6 | Edit the clone's title to `TITLE-FROM-CLONE`. | **Both** titles change. |
| 7 | Change the clone's colour to purple. | Only the clone turns purple. Original keeps its colour. **Colour does not sync.** |
| 8 | Drag the clone to a different spot. | Only the clone moves. Original stays put. **Position does not sync.** |
| 9 | Drag the original. | Only the original moves. |
| 10 | Press `C`. | Panel lists one clone group; selecting it shows **two** instances, both on `TEST-A`. |
| 11 | X-Ray button. | **Not red.** Clones have different IDs. |
| 12 | Reload. | Both cards present, same shared title/content, different colours and positions. |

## 2B. Clone to another canvas

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A`, create card `LINK-SRC` / content `link text`. | Card appears. |
| 2 | Right-click → **Clone to Tab…**. | Submenu lists other canvas names, including `TEST-B`. `TEST-A` is not listed. |
| 3 | Click `TEST-B`. | Menu closes. `TEST-A` looks unchanged. |
| 4 | Switch to `TEST-B`. | Clone present, title `LINK-SRC`, content `link text`, not in any group. |
| 5 | On `TEST-B`, edit content to `edited on B`. | `TEST-B` card updates. |
| 6 | Switch to `TEST-A`. | `LINK-SRC` content is **also** `edited on B`. Cross-canvas sync works. |
| 7 | On `TEST-A`, edit title to `RENAMED-ON-A`. | — |
| 8 | Switch to `TEST-B`. | Clone title is **also** `RENAMED-ON-A`. |
| 9 | On `TEST-B`, change the clone's colour to orange and drag it. | — |
| 10 | Switch to `TEST-A`. | Original's colour and position **unchanged**. |
| 11 | Press `C`. | Two instances listed, one on `TEST-A`, one on `TEST-B`, with canvas names. |
| 12 | Reload, check both canvases. | Shared title/content persisted; separate colours/positions persisted. |
| 13 | X-Ray on both canvases. | **Not red** on either. |

## 2C. Clone chain

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A`, create `CHAIN` and **Clone Node** it. | Two linked cards. |
| 2 | Right-click the **clone** → **Clone to Tab…** → `TEST-B`. | — |
| 3 | Edit content on the `TEST-B` card to `chain text`. | — |
| 4 | Switch to `TEST-A`. | **Both** `TEST-A` cards show `chain text`. All three share one source. |
| 5 | Press `C`, select the group. | **Three** instances listed: two on `TEST-A`, one on `TEST-B`. |

---

# Section 3 — Bug 16: IDs stay unique

Card IDs are not visible in the UI, so this section combines visible symptoms
with a definitive file check at the end.

## 3A. Rapid creation

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A`, create 5 cards as fast as you can, titling them `1`…`5`. | 5 separate cards. None vanish or merge. |
| 2 | Count them. | Exactly 5. |
| 3 | X-Ray button. | **Not red.** |
| 4 | Drag each one in turn. | Each moves alone. No card drags a second card with it. |
| 5 | Delete card `3`. | Only `3` disappears. Others remain. |
| 6 | Reload. | 4 cards, correct titles. |

## 3B. Bulk paste

| # | Action | Expected result |
|---|---|---|
| 1 | Select several cards (multi-select) and copy them. | — |
| 2 | Paste on `TEST-B`. | All pasted, each independently draggable. |
| 3 | X-Ray on `TEST-B`. | **Not red.** |
| 4 | Drag each pasted card. | Each moves alone. |

## 3C. Survives reload and undo

| # | Action | Expected result |
|---|---|---|
| 1 | Note how many cards are on `TEST-A`. | — |
| 2 | Reload, then create a new card. | New card appears; no existing card changes text or position. |
| 3 | X-Ray. | **Not red.** |
| 4 | Create a card, then press Undo once. | The new card disappears. Nothing else changes. |
| 5 | Create another card. | Appears as a new separate card. Does **not** overwrite or merge with anything. |
| 6 | X-Ray. | **Not red.** |

## 3D. Definitive check

| # | Action | Expected result |
|---|---|---|
| 1 | Export the `PR2-TEST` project on its own (single-project export, not full backup). | `.json` file downloads. |
| 2 | Send me that file and ask me to run the audit. | Report shows: **0 ids on more than one canvas, 0 ids twice on one canvas, 0 connectors with no starting card**, and stored `nextId` **above** the highest ID in use. |

Anything other than zero is a failure.

---

# Section 4 — Bug 24: only the intended canvas changes

## 4A. Untouched canvases stay untouched

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-B`, create 3 cards, note their exact text, colours and positions. | — |
| 2 | Switch to `TEST-A`. Edit titles, contents, colours; drag cards; add and delete cards. | `TEST-A` changes as expected. |
| 3 | Switch to `TEST-B`. | All 3 cards **byte-identical** to step 1: same text, colours, positions. Nothing moved. |
| 4 | Reload, check `TEST-B` again. | Still identical. Nothing was saved to `TEST-B`. |

## 4B. Clone sync is the only exception

| # | Action | Expected result |
|---|---|---|
| 1 | On `TEST-A` create `ISOLATED` (no clone) and `LINKED`, then **Clone to Tab…** `LINKED` to `TEST-B`. | — |
| 2 | On `TEST-B`, add card `B-ONLY` / content `B only text`. | — |
| 3 | On `TEST-A`, edit `ISOLATED` content to `isolated changed`. | — |
| 4 | Switch to `TEST-B`. | `B-ONLY` unchanged. No new card appeared. Clone of `LINKED` unchanged. |
| 5 | On `TEST-A`, edit `LINKED` content to `linked changed`. | — |
| 6 | Switch to `TEST-B`. | **Only** the clone of `LINKED` shows `linked changed`. `B-ONLY` still `B only text`. |
| 7 | Drag `LINKED` on `TEST-A`, then check `TEST-B`. | Clone has not moved. |

## 4C. Real-data regression test (your existing project)

This is the strongest test available, because your current project genuinely
contains 40 cards caught in ID clashes. **Do this before deleting it.** Read
only — do not try to repair anything.

| # | Action | Expected result |
|---|---|---|
| 1 | Open the old project. Go to canvas `hetercdtea`. | Canvas loads. |
| 2 | Look at the X-Ray button. | **Red**, tooltip reports about **6 duplicate card IDs in this workspace**. This is the detector correctly reporting existing damage. |
| 3 | Click it. | All cards fade to 50%; stacked duplicates become visible. |
| 4 | Go to canvas `jdk` and find card `126` ("App Testing Guide"). | Card present. |
| 5 | Note the exact text of card `126` on `Map Phase 5` and on `Map Phase 2 (Copy)`. | Same long text on all three. |
| 6 | On `jdk`, add the word `MARKER` to the start of card `126`'s content. | `jdk` copy shows `MARKER…`. |
| 7 | Check the console. | Warning appears: `Card id "126" exists 3 times in this project. Clone sync to the original was skipped…` |
| 8 | Go to `Map Phase 5`, then `Map Phase 2 (Copy)`. | **Neither shows `MARKER`.** Both unchanged. **This is the Bug 24 fix working.** Before the fix, both would have been rewritten and moved. |
| 9 | Undo the `MARKER` edit, or just don't sync. | — |
| 10 | Export this project and send it to me. | Audit should report the same 40 clashes as before (the fix contains the damage, it does not repair it) but `nextId` now derives to **153**, above the highest ID in use (152). Before the fix it was 129, which would have collided on the next 15 cards. |

---

# Section 5 — Known, expected, do NOT report

These are already-known and deliberately deferred. Seeing them is not a
regression.

1. **Delete an original whose clone is on another canvas** (Bug 17). The clone
   survives but keeps a stale internal link. It will not sync to anything and is
   harmless. Deleting an original whose clone is on the *same* canvas cleanly
   unlinks the clone.
2. **The X-Ray warning only checks the canvas you are on.** Duplicate IDs spread
   across two different canvases are not flagged visually. That project-wide
   check is Fix 3, not yet built.
3. **Two devices or two tabs at once can still create duplicate IDs.** Not fixed
   by this PR. Keep to one tab, one device.
4. **Undo covers one step, on the current canvas, immediately.** It does nothing
   for tasks, reminders, pin groups, canvas rename, layering or pins.
5. **Existing duplicate IDs are not repaired.** The fix stops new ones and stops
   the damage spreading.

---

# Result

- Section 1 (Copy independent): PASS / FAIL — failed step: ____
- Section 2 (Clone linked): PASS / FAIL — failed step: ____
- Section 3 (Bug 16 unique IDs): PASS / FAIL — failed step: ____
- Section 4 (Bug 24 isolation): PASS / FAIL — failed step: ____

All four PASS → merge PR #2, delete the old test project, start fresh.
