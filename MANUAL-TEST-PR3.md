# Manual Test Document — PR #3 / Fix 3

**Milestone:** Project-wide, visible duplicate card-ID detector (Bugs 19 + 58)
**Branch:** `fix/bug-19-58-project-wide-id-detector`
**Purpose of this document:** to prove that everything promised in this milestone
was actually built and actually works. Nothing here requires a terminal, and
nothing here requires you to make a judgement call.

---

## STOP — read this one paragraph before you start

> **Do the Group B tests BEFORE you delete your old throwaway test project.**
>
> Group B is the only group that can prove the detector actually *detects*
> anything, and it needs a project that already contains duplicate IDs. Your old
> test project is the only one you have. Once it is deleted, Group B can never be
> run, because — and this is the point of Fix 2 — **the app can no longer create
> a duplicate ID through normal use.** There is no button, no copy, no paste and
> no import that will produce one for you.
>
> If you have already deleted it: mark all of Group B **BLOCKED** and tell me. I
> will re-run those checks and give you the evidence.

---

## 1. What you need

| Item | Detail |
|---|---|
| Browser | The one you normally use |
| Time | About 35 minutes for everything |
| Data | Your old test project (Group B) + one brand-new project you create in Group A |
| Risk | **None.** No test in this document edits, deletes or repairs any card. Two tests ask you to add cards to a *new* project only. |

## 2. How to record results

Each test ends with a result line. Tick one box.

- **PASS** — the expected result happened exactly as written.
- **FAIL** — something different happened. Write what you saw on the Notes line.
- **BLOCKED** — you could not run the test (e.g. the old project is gone).

If any step's expected result does not happen, stop that test, mark it FAIL, and
move to the next test. Do not try to work around it.

## 3. Vocabulary used in the steps

| Term | Where it is |
|---|---|
| **Right toolbar** | The narrow vertical strip of icon buttons on the right-hand edge of the canvas |
| **Shield button** | The new button at the **bottom of the right toolbar**, directly below the X-Ray button. It is a shield outline. |
| **X-Ray button** | The stacked-layers icon in the right toolbar, just above the shield |
| **Workspace Manager** | The gear icon next to the canvas name at the top of the screen (tooltip: "Manage Workspaces") |
| **Data Health panel** | The panel that opens on the right when you click the shield button |
| **Canvas** | What the app also calls a "workspace" — one map |
| **Crosshair button** | The small cross-shaped button on the right of a finding row inside the panel |

## 4. Requirement coverage

Every requirement in this milestone maps to at least one test. If every test
below passes, the milestone is complete.

| # | Requirement | Tests |
|---|---|---|
| R1 | The check covers the **whole project**, every canvas — not just the one on screen | A4, A5, B2 |
| R2 | The check is **visible in the normal app**, not hidden behind developer mode | A2, B1 |
| R3 | The badge **colours itself** without being asked (red / amber / grey) | A2, B1, A8 |
| R4 | Detects the same ID on **more than one canvas** | B3 |
| R5 | Detects the same ID **twice on one canvas** | B4 |
| R6 | Detects a **card counter that has fallen behind** the cards in use | B5 |
| R7 | Detects **clone links** that are missing or ambiguous | B6 |
| R8 | Detects **connections with a missing end** | B7 |
| R9 | Detects **items filed under a deleted group** | B8 |
| R10 | Reports data it **could not read**, instead of skipping it silently | B9 |
| R11 | Severity is honest: duplicates are **red**, broken links are only **amber** | A8, B1 |
| R12 | Every finding can be **jumped to** (switch canvas, centre, flash) | B10, B11 |
| R13 | Cards with a duplicated ID are **outlined in red dashes on the canvas**, including cross-canvas duplicates | B12 |
| R14 | The report can be **copied as text** | A7 |
| R15 | It is **read-only** and works in a **View / Reference tab** | C1, C2 |
| R16 | It **changes nothing** in your project | D1, D2 |
| R17 | It **does not slow down typing** and never freezes | E1, E2 |
| R18 | It **cannot crash** on odd data (Bug 58) | B9, F4, plus automated tests — see §7 |
| R19 | The report **re-checks itself** as data changes | A6 |
| R20 | Existing behaviour from PR #2 still works | F1, F2, F3 |

---

# GROUP A — A clean project tells the truth

**Purpose:** prove the all-clear is honest, the check really covers everything,
and the panel works. Uses a brand-new project so nothing of yours is touched.

### Fixed test data for Group A

| Thing | Exact name to use |
|---|---|
| Project | `PR3 Health Check` |
| First canvas | leave whatever name it is created with |
| Second canvas | `Bravo` |
| Cards you add on `Bravo` | `Bravo One`, `Bravo Two`, `Bravo Three` |

---

### A1 — Create the test project

**Verifies:** setup for Group A
**Preconditions:** App open, normal editing mode (no amber read-only banner).

1. Open the **Projects** panel (where you normally create and switch projects).
2. Click **New Project**.
3. In the name field type exactly: `PR3 Health Check`
4. Leave password off. Confirm/create the project.
5. Wait for the project to open.

**Expect:** you are now in a project called `PR3 Health Check`, with one canvas.

6. Look at the **right toolbar**.

**Expect:** at the bottom of it, **below** the stacked-layers X-Ray button, there
is a **shield** button. It is **grey**, not red, not amber.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### A2 — The shield is visible in the normal app and reports "no problems"

**Verifies:** R2, R3
**Preconditions:** A1 passed. You are in `PR3 Health Check`.

1. Hover the mouse over the shield button and wait for the tooltip.

**Expect:** the tooltip begins `Data Health:` and then says **"No problems
found across ..."** followed by a number of canvases and cards.
It must **not** say "duplicate".

2. Click the shield button.

**Expect:** a panel opens on the right-hand side titled **Data Health**.

3. Look at the coloured box at the top of the panel.

**Expect:** the box is **green**, and its bold heading reads exactly:
**No problems found**

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### A3 — Every section is present and reads zero

**Verifies:** R2, and that nothing is silently missing
**Preconditions:** A2 passed. Panel open.

1. Read down the panel. Confirm each of these seven section headings exists.
   Each has a number badge on its right.

| # | Section heading (must appear exactly) | Number must be | ☐ |
|---|---|---|---|
| 1 | Same card ID on more than one canvas | 0 | ☐ |
| 2 | Same card ID twice on one canvas | 0 | ☐ |
| 3 | Card ID counter | 0 | ☐ |
| 4 | Clone links that do not resolve | 0 | ☐ |
| 5 | Connections with a missing end | 0 | ☐ |
| 6 | Items filed under a group that no longer exists | 0 | ☐ |
| 7 | Data that could not be read | 0 | ☐ |

2. Click on the heading **Same card ID on more than one canvas**.

**Expect:** the section expands and shows an explanation paragraph, then the
words **"Nothing found."**

3. Scroll to the very bottom of the panel.

**Expect:** a grey note saying the panel **only reads your project** and never
changes, repairs or renumbers anything.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### A4 — The check counts your whole project, not just this canvas

**Verifies:** R1 — the single most important requirement of this milestone
**Preconditions:** A3 passed. Panel open.

1. In the panel's coloured box, read the last line. It looks like:
   *"Checked all N canvases and M cards in this project at HH:MM."*
2. Write the two numbers down here:

   Panel says canvases = ______  cards = ______

3. Now count for yourself. Click the **gear icon** (Manage Workspaces) next to
   the canvas name at the top.
4. Read the footer at the bottom-left of the Workspace Manager: *"N workspaces"*.

   Workspace Manager says = ______

**Expect:** this number is **the same** as the canvases number from step 2.

5. Close the Workspace Manager (**X**).
6. Count the cards on the canvas you are looking at, by eye.

   Cards visible on this canvas = ______

**Expect:** because this project currently has only one canvas, this equals the
cards number from step 2.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### A5 — Add a second canvas: the count must grow

**Verifies:** R1, R19 — proves the report is not just reading the visible canvas
**Preconditions:** A4 passed.

1. Click the **gear icon** (Manage Workspaces).
2. Click **New Workspace** (bottom right of that window).
3. In the **Workspace name** box type exactly: `Bravo`
4. Click **Create**.
5. Click on `Bravo` in the list to open it.
6. Add three cards to `Bravo` using the **Add Card** button, and name them by
   double-clicking each card's title:
   `Bravo One`, `Bravo Two`, `Bravo Three`
7. Click the shield button to open the Data Health panel (if it closed).
8. Wait about 2 seconds, then read the last line of the coloured box again.

**Expect:**
- the canvases number has gone **up by exactly 1** compared with A4 step 2
- the cards number has gone **up by exactly 3**
- the box is still **green** / **No problems found**

   Now says canvases = ______  cards = ______

9. **Now the real test.** Switch back to the first canvas (gear icon → click the
   first canvas in the list), leaving the panel open.

**Expect:** the numbers **do not change**. The report still counts `Bravo` and
its three cards even though you are no longer looking at `Bravo`.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### A6 — The report refreshes itself after a change

**Verifies:** R19
**Preconditions:** A5 passed. Panel open.

1. Note the time shown at the end of the coloured box (`... at HH:MM`).
2. Add one more card anywhere. Name it `Refresh Check`.
3. Wait about 2 seconds and read the coloured box again.

**Expect:** the cards number has gone **up by 1**, and the box is still green.

4. Delete the `Refresh Check` card (right-click it → delete).
5. Wait about 2 seconds.

**Expect:** the cards number has gone back **down by 1**.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### A7 — Copy the report as text

**Verifies:** R14
**Preconditions:** Panel open.

1. In the panel header, click the **copy icon** (immediately left of the **X**).

**Expect:** the icon briefly turns into a green tick.

2. Paste into any text box (an empty card, a document, the browser address bar).

**Expect:** you get a plain-text report containing the line
`PROJECT: PR3 Health Check`, a `Canvases: ... Cards: ... Distinct ids: ...`
line, and headings such as `-- Same id on more than one canvas: 0`.

3. Undo/clear wherever you pasted it, if it was inside the app.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### A8 — The app cannot invent a duplicate (and the badge stays honest)

**Verifies:** R3, R11, R20 — this is also proof that Fix 2 is holding
**Preconditions:** A5 passed. You are in `PR3 Health Check`.

Do all four of these, checking the shield after each one:

| Step | Action | Shield must stay | ☐ |
|---|---|---|---|
| 1 | Add two more cards with the **Add Card** button | grey | ☐ |
| 2 | Select a card, copy it and paste it (Ctrl+C, Ctrl+V) | grey | ☐ |
| 3 | Gear icon → **Duplicate workspace** on `Bravo` | grey | ☐ |
| 4 | Undo several times (Ctrl+Z), then add one more card | grey | ☐ |

**Expect:** the shield stays **grey with a tick** throughout, and the panel keeps
saying **No problems found**.

**Expect NOT:** the shield turning red at any point. If it turns red here, the
app is still minting duplicate IDs and this is a **FAIL** — tell me immediately
and stop testing.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

# GROUP B — The old test project proves detection works

**Purpose:** prove each kind of problem is actually found, listed correctly, and
can be jumped to. **Run this before deleting that project.**

**Preconditions for all of Group B:** you have switched to your old throwaway
test project (10 canvases, including `hetercdtea`, `jdk`, `Map Phase 2`,
`Map Phase 5`, `Map Phase 2 (Copy)`).

> **Reminder:** you are only *looking*. Do not add, edit or delete anything in
> this project. Every step below is read-only.

---

### B1 — The shield goes red on its own

**Verifies:** R2, R3, R11
**Preconditions:** old test project open. Panel closed.

1. Switch to the old test project. Wait for it to finish loading (about 5
   seconds).
2. **Without clicking anything**, look at the shield button in the right toolbar.

**Expect:** it is **red** with an exclamation mark, not grey.

3. Hover it.

**Expect:** the tooltip mentions **ids shared across canvases**.

4. Click it.

**Expect:** the panel opens; the box at the top is **red** and its heading reads
exactly: **Duplicate card IDs found**

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B2 — It scanned all ten canvases

**Verifies:** R1
**Preconditions:** B1 passed.

1. Read the last line of the red box.

   Panel says canvases = ______  cards = ______

**Expect:** the canvases number is **10** (or whatever the gear icon's
"N workspaces" footer says — check it and confirm they match).

**Expect NOT:** `1`. If it says 1, the check is not project-wide — **FAIL**.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B3 — Same ID on more than one canvas

**Verifies:** R4
**Preconditions:** B1 passed. Panel open.

1. Find the section **Same card ID on more than one canvas** and make sure it is
   expanded (click the heading if not).
2. Record the number on its badge: ______  *(reference value: 14)*
3. Now check these three specific findings are listed. Scroll within the section.

| Look for | Expected canvases listed | ☐ |
|---|---|---|
| **ID 126** | three canvases: `jdk`, `Map Phase 5`, `Map Phase 2 (Copy)` | ☐ |
| **ID 50** | two canvases: `hetercdtea`, `Map Phase 2` | ☐ |
| **ID 94** | `hetercdtea` — marked **(2 cards here)** — and `jdk` | ☐ |

4. Read the explanation paragraph at the top of the section.

**Expect:** it explains that editing one of these used to rewrite the others, and
that edits are now confined to the canvas you are on.

**PASS if:** the badge number is 1 or more **and** all three findings above are
present as described.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B4 — Same ID twice on one canvas

**Verifies:** R5
**Preconditions:** Panel open.

1. Expand **Same card ID twice on one canvas**.
2. Record the badge number: ______  *(reference value: 6)*
3. Check the listed IDs.

**Expect:** six rows, for IDs **94, 95, 96, 101, 102, 103**, and **every one of
them says canvas `hetercdtea`**, each with **2 cards**.

**PASS if:** all six IDs above are listed against `hetercdtea`.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B5 — The card ID counter

**Verifies:** R6
**Preconditions:** Panel open.

1. Expand **Card ID counter**.
2. Read the three numbers in the grey box.

**Expect exactly:**

| Label | Expected value | Actual | ☐ |
|---|---|---|---|
| Stored counter | **129** | ______ | ☐ |
| Highest ID actually in use | **152** | ______ | ☐ |
| ID the next new card will actually get | **153**, shown in green | ______ | ☐ |

3. Read the finding row below the grey box.

**Expect:** it says the stored counter is at or below **15** IDs already in use,
lists them starting `129, 130, 131 ...`, and states that this is **contained** —
that no new card can be born on one of these.

4. Look at the section's badge colour.

**Expect:** **amber**, not red. This is a warning, not a data-loss risk, because
the app now takes the highest live ID as a floor.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B6 — Clone links

**Verifies:** R7
**Preconditions:** Panel open.

1. Expand **Clone links that do not resolve**.
2. Record the badge number: ______

**Expect:** for each row listed (if any), the text names a card and a canvas and
says either that it points at a card that **no longer exists**, or that the link
is **ambiguous** because more than one card has that ID.

**PASS if:** the section is present and every row reads as one of those two
sentences. A count of 0 is a valid PASS — it means this project has no broken
clone links.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B7 — Connections with a missing end

**Verifies:** R8
**Preconditions:** Panel open.

1. Expand **Connections with a missing end**.
2. Record the badge number: ______  *(reference value: 4)*

**Expect:** rows naming a canvas and saying either that a connection has **no
starting point / no end point**, or that it **points at something that no longer
exists**. Canvases named should include `hetercdtea`, `Map Phase 2`,
`Map Phase 7` and `Map Phase 2 (Copy)`.

3. Check the badge colour.

**Expect:** **amber**, not red.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B8 — Items filed under a deleted group

**Verifies:** R9
**Preconditions:** Panel open.

1. Expand **Items filed under a group that no longer exists**.
2. Record the badge number: ______  *(reference value: 0)*

**Expect:** if 0, it says **"Nothing found."** If more than 0, each row names a
Card/Group/Image, the canvas, and the missing group.

**PASS if:** the section exists and reads as described.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B9 — Unreadable data is reported, and nothing crashes

**Verifies:** R10, R18
**Preconditions:** Panel open on the old project.

1. Expand **Data that could not be read**.
2. Record the badge number: ______

**Expect:** the section exists. If 0, "Nothing found." If more than 0, each row
describes what could not be read (for example a card with no usable ID).

3. Now the real check. Scroll the panel from top to bottom, expanding **every**
   section.

**Expect:**
- no blank white screen
- no error message
- no section that fails to open
- the panel stays usable throughout

This project is the messiest data you have — broken connections, duplicate IDs, a
rewound counter. If the checker were fragile, this is where it would fall over.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B10 — Jump to a card on the canvas you are already on

**Verifies:** R12
**Preconditions:** Panel open on the old project.

1. Note which canvas you are currently on: ______________
2. In **Same card ID twice on one canvas**, find a row for `hetercdtea`.
3. First switch to `hetercdtea` yourself (gear icon → `hetercdtea`).
4. Click the **crosshair button** on the right of that row.

**Expect:**
- the view moves so the card is in the middle of the screen
- the card flashes with a **blue ring** for about 2–3 seconds, then the ring
  disappears on its own

**Expect NOT:** the card's title, text or position changing in any way.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B11 — Jump to a card on a *different* canvas

**Verifies:** R12 — the harder case
**Preconditions:** Panel open. You are on `hetercdtea`.

1. In **Same card ID on more than one canvas**, find the row for **ID 126**.
2. Under it there are three canvas names. Click the **crosshair** next to
   `Map Phase 5`.

**Expect, in this order:**
- the app **switches canvas** to `Map Phase 5` (the canvas name at the top
  changes)
- the view **centres** on card 126
- the card **flashes with a blue ring**, then stops after 2–3 seconds

3. Now click the **crosshair** next to `Map Phase 2 (Copy)` for the same ID 126.

**Expect:** the app switches again to `Map Phase 2 (Copy)` and flashes its
copy of card 126.

**Expect NOT:** any card being edited, moved or renamed by this.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### B12 — Duplicated cards are outlined in red dashes on the canvas

**Verifies:** R13 — **this is the behaviour that did not exist before this PR**
**Preconditions:** Panel open on the old project.

1. Switch to `jdk`.
2. Look at card **126** on the canvas.

**Expect:** it has a **red dashed outline** around it.

3. Switch to `Map Phase 5` and find card 126 there.

**Expect:** it also has a **red dashed outline**.

> Why this matters: card 126 is duplicated **across** canvases. Each canvas only
> contains one copy of it, so before this PR **neither of them was outlined** —
> the dangerous case was completely invisible. Seeing the outline on both is the
> proof.

4. Hover the **X-Ray** button (stacked layers, just above the shield).

**Expect:** the tooltip says how many cards on this canvas **share an ID with
another card in this project**, and mentions the red dashes.

5. Switch to a canvas the panel reported **no** duplicates for.

**Expect:** no red dashed outlines there.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

# GROUP C — Read-only safety

### C1 — Works in a View / Reference tab

**Verifies:** R15
**Preconditions:** Any project open in normal editing mode.

1. In the right toolbar, click the **external-link** button
   (tooltip: *"Open this workspace in a new read-only Reference tab"*).
2. A new browser tab opens. Wait for it to load.

**Expect:** an **amber banner** across the top: *"Reference view (read-only
snapshot). Editing, saving, importing and switching are disabled here."*

3. Find the **shield button** in this read-only tab's right toolbar.

**Expect:** it is present, and coloured the same as in the editor tab (red for
the old project, grey for the clean one).

4. Click it.

**Expect:** the Data Health panel opens and works normally — sections expand,
findings are listed.

5. Check the amber banner is **still there**.

**Expect:** still there. Opening the panel did not take the tab out of read-only
mode.

6. Close this Reference tab.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### C2 — Works in Preview mode

**Verifies:** R15
**Preconditions:** Editor tab, any project.

1. In the right toolbar click the **eye** button (tooltip: *"Enter Preview
   Mode"*).
2. Click the shield button.

**Expect:** the panel opens and works.

3. Click the eye button again to leave Preview Mode.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### C3 — The panel closes cleanly

**Verifies:** basic hygiene
**Preconditions:** Panel open.

1. Click the **X** in the panel header.

**Expect:** the panel slides closed. The shield button remains, still coloured
according to the findings.

2. Click the shield again.

**Expect:** it re-opens, showing the same findings.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

# GROUP D — It changes nothing

### D1 — The old project is byte-for-byte untouched

**Verifies:** R16 — the most important safety promise in this milestone
**Preconditions:** You are in the **old test project**. You have just finished
Group B (so you have opened the panel, expanded every section, and jumped to
several cards).

1. Open the **Projects** panel.
2. Find the old test project, open its **⋮** menu and click **Export Project**.
   Save the file as `after-testing.json`.
3. Compare it against a project export you made **before** this test session, if
   you have one. If you do not have one, do this instead:
   - re-open the Data Health panel
   - confirm the numbers are **identical** to what you recorded in B2, B3, B4
     and B5

**Expect:** the same canvas count, card count, and the same findings with the
same IDs. Nothing was added, renumbered or removed by using the panel.

4. Look at card 126 on `jdk`.

**Expect:** its title and text are exactly as they were. Jumping to it in B11 did
not modify it.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### D2 — Nothing offers to "fix" anything

**Verifies:** R16
**Preconditions:** Panel open with findings (old project).

1. Read every finding row and the whole panel carefully.

**Expect:** there is **no** button anywhere in the panel labelled Fix, Repair,
Renumber, Clean up, Resolve or similar. The only buttons are: expand/collapse
section headings, the crosshair (jump to), copy, and close.

2. Read the grey note at the very bottom of the panel.

**Expect:** it states the panel only reads your project, never changes, repairs
or renumbers anything, and that fixing a duplicate ID means deliberately editing
or recreating the card yourself.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

# GROUP E — Speed

### E1 — Typing is not slowed down

**Verifies:** R17
**Preconditions:** Old test project (the biggest one), Data Health panel **open**.

1. Open a card with a reasonable amount of text, on a canvas with many cards.
2. Type a sentence continuously for about 10 seconds, then delete what you typed.

**Expect:** typing feels exactly as it did before this PR. No stutter, no lag, no
characters arriving late.

3. Watch the time at the end of the coloured box while typing.

**Expect:** it does **not** update on every keystroke. It updates shortly after
you **stop** typing. (The check deliberately waits about half a second so it
never runs while you type.)

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### E2 — Opening the panel is instant, on the worst data you have

**Verifies:** R17, R18
**Preconditions:** Old test project. Panel closed.

1. Click the shield button and watch.

**Expect:** the panel appears and is fully populated in **under 2 seconds**.

2. Switch canvas five times in a row with the panel open.

**Expect:** no freeze, no white screen, no "page unresponsive" warning from the
browser.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

# GROUP F — Nothing else broke

### F1 — Creating cards still works

**Verifies:** R20
**Preconditions:** `PR3 Health Check` project (the clean one). **Not** the old
project.

1. Add three cards with **Add Card**. Name them `F1 A`, `F1 B`, `F1 C`.
2. Open the Data Health panel.

**Expect:** all three exist, the shield is still **grey**, and card count went up
by 3.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### F2 — Copy is still independent, Clone is still linked

**Verifies:** R20 — the distinction you corrected me on
**Preconditions:** `PR3 Health Check`.

1. Right-click card `F1 A` and choose **Duplicate Card**.
2. Change the **duplicate's** title to `F1 A COPY EDIT`.

**Expect:** the original `F1 A` is **unchanged**. A duplicate is fully
independent.

3. Now right-click card `F1 B` and choose **Clone Node**.
4. Change the **clone's** title to `F1 B CLONE EDIT`.

**Expect:** the original `F1 B` title **also** changes — clones stay linked on
title and content.

5. Move the clone to a different position.

**Expect:** the original does **not** move. Position never syncs.

6. Check the shield.

**Expect:** still **grey**.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### F3 — Undo/redo still works

**Verifies:** R20
**Preconditions:** `PR3 Health Check`.

1. Add a card named `Undo Me`.
2. Press Ctrl+Z.

**Expect:** the card disappears.

3. Press Ctrl+Shift+Z (or the redo button).

**Expect:** the card comes back.

4. Check the shield.

**Expect:** still **grey** — undo did not rewind the counter into a collision.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

### F4 — The X-Ray button still does its original job

**Verifies:** R13, R20 — confirms the two features were not tangled together
**Preconditions:** Any project.

1. Click the **X-Ray** button (stacked layers).

**Expect:** all cards fade to about half opacity, revealing any perfectly
stacked cards.

2. Click it again.

**Expect:** cards return to full opacity.

3. Confirm the shield button is a **separate** button that still opens the panel.

**Expect:** two independent buttons — X-Ray fades cards, shield opens the report.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

# GROUP G — Tidy up

### G1 — Remove the test project

**Preconditions:** All other tests recorded.

1. Open the Projects panel.
2. Delete the `PR3 Health Check` project.

**Expect:** it disappears from the list and your real project is unaffected.

> Do **not** delete the old throwaway test project until every Group B test is
> recorded as PASS or FAIL.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:** ________________________________________________

---

# 5. Results summary

| Test | What it proves | PASS | FAIL | BLOCKED |
|---|---|---|---|---|
| A1 | Test project created, shield button exists | ☐ | ☐ | ☐ |
| A2 | Visible in normal app; honest all-clear | ☐ | ☐ | ☐ |
| A3 | All seven sections present, all zero | ☐ | ☐ | ☐ |
| A4 | Counts match the real project | ☐ | ☐ | ☐ |
| A5 | **Covers canvases you are not looking at** | ☐ | ☐ | ☐ |
| A6 | Re-checks after changes | ☐ | ☐ | ☐ |
| A7 | Report copies as text | ☐ | ☐ | ☐ |
| A8 | App cannot create new duplicates | ☐ | ☐ | ☐ |
| B1 | **Shield goes red on its own** | ☐ | ☐ | ☐ |
| B2 | Scanned all 10 canvases | ☐ | ☐ | ☐ |
| B3 | Cross-canvas duplicates found | ☐ | ☐ | ☐ |
| B4 | Same-canvas duplicates found | ☐ | ☐ | ☐ |
| B5 | Counter reported, and shown as contained | ☐ | ☐ | ☐ |
| B6 | Clone links checked | ☐ | ☐ | ☐ |
| B7 | Broken connections found | ☐ | ☐ | ☐ |
| B8 | Orphaned group members checked | ☐ | ☐ | ☐ |
| B9 | Unreadable data reported; no crash | ☐ | ☐ | ☐ |
| B10 | Jump to card, same canvas | ☐ | ☐ | ☐ |
| B11 | Jump to card, different canvas | ☐ | ☐ | ☐ |
| B12 | **Cross-canvas duplicates now outlined** | ☐ | ☐ | ☐ |
| C1 | Works in read-only Reference tab | ☐ | ☐ | ☐ |
| C2 | Works in Preview mode | ☐ | ☐ | ☐ |
| C3 | Opens and closes cleanly | ☐ | ☐ | ☐ |
| D1 | **Your data is untouched** | ☐ | ☐ | ☐ |
| D2 | Nothing offers to auto-fix | ☐ | ☐ | ☐ |
| E1 | No typing lag | ☐ | ☐ | ☐ |
| E2 | Fast on the worst data; no freeze | ☐ | ☐ | ☐ |
| F1 | Card creation still works | ☐ | ☐ | ☐ |
| F2 | Copy independent, Clone linked | ☐ | ☐ | ☐ |
| F3 | Undo/redo still works | ☐ | ☐ | ☐ |
| F4 | X-Ray unchanged and separate | ☐ | ☐ | ☐ |
| G1 | Test project removed | ☐ | ☐ | ☐ |

**Milestone is complete when:** every test above is PASS, with Group B either all
PASS or all BLOCKED-because-the-project-was-already-deleted.

**Tested by:** ______________  **Date:** ______________
**Build / branch:** `fix/bug-19-58-project-wide-id-detector`

---

# 6. Known issues that are NOT failures

Do not record these as FAIL.

| What you may see | Why |
|---|---|
| Console message `Unable to preventDefault inside passive event listener` | Pre-existing, from canvas scrolling. Present before this PR. |
| Console `React Router Future Flag Warning` | Library notice. Harmless. |
| Console `[WorkspaceValidator: ...]` errors/warnings | The older development-only checker. Unrelated to this panel, and not visible in the real app. |
| Ghost cards when leaving `hetercdtea` | A separate, still-unexplained rendering bug. Not caused by this PR, and this PR does not claim to fix it. See §7. |
| Firestore `400` / `failed-precondition` on Commit | Known issue (b) in the handover, unrelated to this PR. |
| Canvas-switch feeling slow on the old project | Known issue (g): images are stored inline as base64. Unrelated to this PR. |

---

# 7. What this document deliberately does NOT prove

Being straight with you about the limits of manual testing.

| Requirement | Why you cannot test it by hand | How it is covered instead |
|---|---|---|
| **R18 — cannot crash on odd data** (Bug 58) | You would have to hand-edit a project file into a broken shape, which needs a terminal. | 8 automated tests in `src/idAudit.test.js` feed it null workspaces, `nodes: null`, null cards, cards with no ID, non-list values and object IDs. Plus B9, which runs it on your messiest real project. |
| **Cannot freeze** | Needs a project containing a card ID like 1,000,000,000. | Automated test asserts the check finishes in under 200ms with a stray ID of 1e9. E2 is the real-world proxy. |
| **Terminal report and in-app report agree** | Needs a terminal. | Both now call the same module; the CLI only prints. I verified identical numbers against `audit/sample-transcription.json`. |
| **A crash in card creation was fixed** | Needs malformed data to trigger. | Regression test in `src/cardId.test.js`. This was a real bug found by the new tests: one malformed canvas used to break adding cards across the whole project. |

**Also still open, and not part of this milestone:** the UUID migration, and
Fixes 4–6 (honest saving, cloud-first checks, real read-only View mode).

**And one correction I owe you, carried over:** the ghost-card explanation I
dismissed — "React duplicate keys" — was dismissed on a false premise. I said the
audit found 0 same-canvas duplicates. It found **6, all on `hetercdtea`**, which
test B4 will confirm with your own eyes. `hetercdtea` is the canvas that strands
exactly **6** cards. That is not proof, but the numbers match and it should be
re-checked before anyone builds a different theory.
