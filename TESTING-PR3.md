# Testing PR #3 — the Data Health check (Fix 3, Bugs 19 + 58)

No terminal needed. Everything here is done in the app.

## What this PR adds, in one paragraph

The app can now check **your whole project** for duplicate card IDs and broken
links, and it shows you the result. Before this, that check existed only as a
command-line script that needed an exported file — so the most important check in
the app was one you could never run. There is now a shield button in the
right-hand toolbar that **turns red by itself** when something is wrong, and
opens a report listing every problem with a button to jump straight to it.

**It only reads your data.** It never changes, repairs or renumbers anything, so
you cannot break your project by opening it or clicking anything inside it.

## Where to find it

The right-hand vertical toolbar, at the bottom, below the X-Ray (layers) button.

| Shield colour | Meaning |
|---|---|
| Grey with a tick | No problems found |
| Amber with "!" | Minor problems (broken connections, a wrong counter) |
| Red with "!" | Duplicate card IDs — the serious one |

Hover it for a one-line summary without opening anything.

---

## Test 1 — the honest all-clear (fresh project)

1. Open a brand-new project with a few cards.
2. Look at the shield button.

**Expect:** grey with a tick. Hovering says something like
*"No problems found across 1 canvas and 4 cards."*

3. Click it.

**Expect:** a panel opens on the right. Green box, "No problems found". Every
section shows `0` and says "Nothing found."

**This is the result you want to see on the new project.** If the fresh project
shows red, stop and tell me — that would mean new duplicates are still being
created, which Fix 2 was supposed to have stopped.

---

## Test 2 — it really does check every canvas, not just the one you're on

This is the whole point of the fix, so it is worth proving.

1. Open the panel and read the last line of the coloured box at the top:
   *"Checked all N canvases and M cards in this project at HH:MM."*
2. Check that **N matches your real number of canvases** and M your real number
   of cards — not just the canvas you happen to be looking at.

**Expect:** N = all your canvases. If N is 1 when you have 6 canvases, the check
is not project-wide and the fix has failed.

---

## Test 3 — the old test project (only if you still have it)

Open the throwaway test project and click the shield.

**Expect:** red, with roughly these numbers:

- Same card ID on more than one canvas: **14**
- Same card ID twice on one canvas: **6** (all on `hetercdtea`)
- Card ID counter: stored **129**, highest in use **152**
- The panel also tells you the ID the next new card would *actually* get, which
  should be **153** — i.e. safe, because Fix 2 put a floor under it.

This is the same result the command-line script gives, because both now use the
same checking code.

> While you are here: the six same-canvas duplicates are all on `hetercdtea`, and
> `hetercdtea` is the canvas that strands **six** ghost cards when you switch away
> from it. I previously told you the duplicate-key theory was disproved. That was
> wrong — the audit never said "0 same-canvas duplicates". Six and six is very
> likely not a coincidence. Worth re-checking on the fresh project.

---

## Test 4 — jump to a problem

1. In the panel, find any finding with a small crosshair button on its right.
2. Click the crosshair.

**Expect:**
- If the card is on another canvas, the app switches to that canvas.
- The view centres on the card.
- The card flashes with a blue ring for about 2.5 seconds, then stops.

**Expect NOT:** any change to the card itself. Nothing is edited, moved or
renamed by jumping to it.

---

## Test 5 — duplicates are now visible on the canvas itself

Cards whose ID is duplicated **anywhere in the project** get a red dashed
outline.

1. Go to a canvas that the panel says contains a duplicated ID.

**Expect:** those cards have a red dashed outline around them.

This is a real change: previously a card duplicated *across two canvases* showed
**no outline at all**, because each canvas only ever saw one copy of it. That was
exactly the dangerous case, and it was invisible.

---

## Test 6 — safe in a View / Reference tab

1. Open a workspace in a read-only View tab (the "Open in Reference tab" button).
2. Click the shield there.

**Expect:** the panel opens and works normally, and the amber "Reference view
(read-only)" banner stays. Reading your data is all it does, so it is allowed
here.

---

## Test 7 — copy the report to send to me

1. Open the panel and click the copy icon in its header (next to the X).
2. Paste into any text box.

**Expect:** a plain-text version of the whole report. This is the easiest way to
show me what your project looks like without exporting a file.

---

## Test 8 — it does not slow down typing

1. Open a card with a lot of text and type continuously for ten seconds.

**Expect:** typing feels exactly as it did before. The check deliberately waits
until about half a second after you stop, so it never runs while you type. The
timestamp in the panel updates shortly after you stop.

---

## Things that are NOT part of this PR

- **Nothing is repaired.** Fixing a duplicate ID means you deliberately recreate
  or re-enter that card. Automatic bulk renumbering is exactly the kind of silent
  rewrite that caused your original data loss, so the checker refuses to do it.
- The counter is still a counter. The **UUID migration is still not done** — that
  is the separate job for the fresh project.
- No sync, save or View-mode write-blocking work is in here. Those are Fixes 4-6.

## Console messages you can ignore

- `Unable to preventDefault inside passive event listener` — pre-existing, from
  canvas scrolling.
- `React Router Future Flag Warning` — library notice, harmless.
- `[WorkspaceValidator: ...]` messages — the older development-only checker.
  Unrelated to this panel, and only visible in a dev build.
