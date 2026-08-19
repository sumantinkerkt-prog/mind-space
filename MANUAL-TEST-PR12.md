# Test for PR #12 — two keyboard shortcuts

Branch: `feat/export-sync-keyboard-shortcuts` (pull request #12).

**About 12 minutes.** Nothing is removed and no sync logic is changed. Two keyboard
shortcuts are added for two buttons you already have.

---

## 1. What this change does

| Shortcut | Does exactly what this does today |
|---|---|
| **Ctrl + Shift + E** | Clicking **Export** in the sidebar |
| **Ctrl + Shift + D** | Clicking **Sync to Server** in the sidebar |

That is the whole feature. The shortcuts call the *same two functions* the buttons
call — they do not have their own copy of the logic.

**On sync, specifically:** automatic sync is still **ON** and unchanged.
Ctrl+Shift+D is only a faster way to ask for the manual "push my work now" action you
already have. It still goes through every check it goes through today — the offline /
bad-load gate, the viewer boundary, and the version and conflict checks inside the
save layer. Nothing was skipped, added or reordered. The files that hold the sync
rules were not edited at all.

**Three things were added on top, deliberately:**

1. **Both shortcuts are editor-only.** In a read-only **View** tab, neither key does
   anything. (You asked for this. Note that the **Export button** is still there in a
   View tab and still works — only the *keyboard* shortcut is withheld.)
2. **A declined shortcut is swallowed, not passed on.** If you press Ctrl+Shift+D
   while a sync is already running, nothing happens — and, importantly, your
   *browser* does not get the keystroke either. Without this, Chrome would open its
   "bookmark all tabs" window at you.
3. **Neither shortcut works before your data has loaded.** If the app is still
   starting up, or it is showing the red "could not read your data" screen, both keys
   are dead. This one matters: otherwise Ctrl+Shift+E would hand you a backup file
   containing nothing, at the exact moment we know we could not read your work — and
   you would think you had a backup.

**Tooltips** now mention the shortcut, matching the existing "Toggle Mini Map (W)"
style. In a View tab the Export tooltip leaves the shortcut out, so it never promises
a key that will not fire.

---

## 2. Before you start

| | |
|---|---|
| **Where** | Open pull request #12 on GitHub. Scroll to the bottom. In the `vercel` comment, click **Preview**. |
| **How long** | About 12 minutes. |
| **What it touches** | Nothing. No cards, no groups, no settings. You will download a few small backup files, which you can delete. |
| **Risk** | Very low. |

**Which browser?** Please do at least **Group F** in Chrome, because that is where
the "bookmark all tabs" clash would show up.

**One line you may paste.** To open the Console: press **F12**, then click
**Console**. This line asks the app what kind of tab you are in:

```
(()=>{try{const p=window.mindspace.probe();return JSON.stringify({thisTabIs:p.role,willRefuseAllWrites:p.wouldBlockWrites,writesItHasRefused:p.refusedSoFar.length?p.refusedSoFar:"none so far"},null,1)}catch(e){return "This build does not have the check - tell Kiro ("+e.message+")"}})()
```

I call it **LINE P**. It changes nothing.

---

## Test 0 — am I testing the right build?

1. Open the Preview link. Wait for your project to appear.
2. Press **S** to open the sidebar.
3. Hover the mouse over the **Export** button and wait for the little tooltip.

| What you see | What it means |
|---|---|
| Tooltip says **Export Map JSON (Ctrl+Shift+E)** | ✅ Right build. Carry on. |
| Tooltip says just **Export Map JSON** | ❌ The Preview link has not updated. Stop and tell me. |

**Result: ☐ Right build ☐ Wrong build — I stopped**

---

# GROUP A — the shortcuts work

All in the normal editor tab.

## A1 — Ctrl+Shift+E takes a backup

1. Click once on an empty part of the canvas (so no card and no text box is active).
2. Press **Ctrl + Shift + E**.

**What should happen:** a file downloads, named like
`YourProjectName_2026-08-19_14-30-05.json`.

3. Now click the **Export** button in the sidebar.

**What should happen:** a second file downloads, in the same format. **The shortcut
and the button did the same thing.** (The two files' names differ only by the
seconds, and that is by design.)

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — Ctrl+Shift+D pushes to the server

1. Add a card. Title it `PR12 A2`.
2. Press **Ctrl + Shift + D**.

**What should happen:** the **Sync to Server** button in the sidebar changes to
**Syncing…** with a spinner, then settles — exactly as if you had clicked it.

3. Reload the page. The card is still there.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — The Sync tooltip mentions its shortcut

1. Hover over the **Sync to Server** button.

**What should happen:** the tooltip reads **Manually sync all data to server
(Ctrl+Shift+D)**.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — typing is never interrupted

This is the group that matters most. **Nothing should download and no sync should
start in any of these steps.**

## B1 — Typing in a card

1. Double-click a card's title so the cursor is in the text.
2. Type some letters, then press **Ctrl + Shift + E**, then **Ctrl + Shift + D**.

**What should happen:** nothing at all happens. No file downloads. The Sync button
does not say "Syncing…". Your typing is untouched.

3. Press **Escape** to leave the text box.

☐ PASS ☐ FAIL ☐ BLOCKED

## B2 — Typing in a longer text area

1. Open a card's description (or any multi-line box you use).
2. With the cursor inside it, press **Ctrl + Shift + E** and **Ctrl + Shift + D**.

**What should happen:** nothing happens, and the text is unchanged.

☐ PASS ☐ FAIL ☐ BLOCKED

## B3 — Typing a name in a panel

1. Press **S** for the sidebar, then rename a canvas (or open the project panel and
   click into the name box).
2. With the cursor in that box, press both shortcuts.

**What should happen:** nothing happens.

☐ PASS ☐ FAIL ☐ BLOCKED

## B4 — Delete the leftover card

1. Click empty canvas, then delete the `PR12 A2` card. Wait for the chip to go green.

☐ Done

---

# GROUP C — the shortcuts you already had still work

Click empty canvas first each time, so no text box is active.

## C1 — The single-letter shortcuts are untouched

1. Press **E**. The card editor panel opens. Press **E** again. It closes.
2. Press **M**. The badge at the bottom-left flips **Full Edit ↔ Arrange**. Press
   **M** again to put it back.
3. Press **W** (mini map), then **W** again. Press **R**, then **R** again.

**What should happen:** every one behaves exactly as it always has. In particular
plain **E** is still the card editor and has nothing to do with Ctrl+Shift+E.

☐ PASS ☐ FAIL ☐ BLOCKED

## C2 — Undo, copy and paste are untouched

1. Add a card, then press **Ctrl + Z**. It disappears.
2. Click a card, **Ctrl + C**, then **Ctrl + V**. A copy appears.
3. Delete the copy. Wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

## C3 — The two hidden shortcuts are untouched

1. Press **Alt + Shift + X**. The project panel opens. Press **Escape** to close it.
2. Press **Ctrl + Shift + ?** (the boss key). It jumps to your default project, as
   before.

**What should happen:** both still work. Neither was affected.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — the View tab: keys off, button on

This is the part you asked me to change, so please do all four steps.

## D1 — Neither shortcut fires in a View tab

1. Click **View** in the top bar. A new browser tab opens with `#/view/` in the
   address.
2. Click an empty part of that canvas.
3. Press **Ctrl + Shift + E**.

**What should happen:** **no file downloads.** Nothing happens.

4. Press **Ctrl + Shift + D**.

**What should happen:** nothing happens. No "Syncing…", and no browser window pops
up either.

☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — But the Export button still works there

1. Still in the View tab, press **S** for the sidebar.
2. There is no **Import**, no **Partial** and no **Sync to Server** — as before.
3. There **is** an **Export** button. Click it.

**What should happen:** a backup file downloads. **This is intentional** — a reader
is still allowed to take a copy by clicking. Only the keyboard shortcut is withheld.

☐ PASS ☐ FAIL ☐ BLOCKED

## D3 — And its tooltip does not promise the shortcut

1. Hover over that **Export** button in the View tab.

**What should happen:** the tooltip reads just **Export Map JSON** — with **no**
"(Ctrl+Shift+E)". It would be a lie here, so it is left out.

☐ PASS ☐ FAIL ☐ BLOCKED

## D4 — The reader's own shortcuts still work

1. Still in the View tab, press **Shift + D**. Card descriptions hide. Press again,
   they come back.
2. Press **Shift + F** for Focus Mode, then **Escape**.
3. Paste **LINE P** into the Console.

**What should happen:** Shift+D and Shift+F behave as always, and LINE P reports:

```
"thisTabIs": "viewer"
"willRefuseAllWrites": true
```

4. **Close the View tab.**

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP E — sync stays safe

Back in the editor tab.

## E1 — You cannot start a second sync on top of one

1. Press **Ctrl + Shift + D**, then immediately press it **three or four more times**
   while it still says **Syncing…**.

**What should happen:** one sync runs and finishes normally. The extra presses do
nothing at all.

☐ PASS ☐ FAIL ☐ BLOCKED

## E2 — Automatic sync still works on its own

1. Add a card called `PR12 E2`. **Do not press any shortcut.**
2. Wait and watch the chip in the top bar: **Unsaved changes** → **Syncing…** → green
   **Saved**.
3. Delete the card and wait for green again.

**What should happen:** saving happens by itself, as it always has. The shortcut is
an extra option, not a replacement.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP F — the browser clash (please do this one in Chrome)

## F1 — No "bookmark all tabs" window

In Chrome, Ctrl+Shift+D normally means "bookmark all tabs". The app should take that
key for itself and never let it through.

1. In the editor tab, click empty canvas.
2. Press **Ctrl + Shift + D** and let the sync finish.
3. Press **Ctrl + Shift + D** rapidly five or six times.

**What should happen:** at no point does a bookmark window, "save all tabs" dialog or
any other browser pop-up appear.

☐ PASS ☐ FAIL ☐ BLOCKED

## F2 — Same in a View tab

1. Open a **View** tab. Click empty canvas. Press **Ctrl + Shift + D** a few times.

**What should happen:** nothing happens, and still no bookmark window — even though
the app is deliberately ignoring the key here.

2. **Close the View tab.**

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 3. Finish up

1. Close any **View** tabs.
2. In the editor tab, check the chip is green and no card named `PR12…` is left.
3. Delete the backup files you downloaded, if you do not want them.

☐ Done

---

# 4. If something looks wrong

Write **FAIL** or **INCONCLUSIVE** and tell me what you saw. The most useful details:

- **Which browser**, since these key combinations are the sort of thing browsers
  claim for themselves.
- **Which tab** — the normal editor tab, or a `#/view/` tab.
- Whether a **text box was active** at the time.

---

# 5. What I tested myself

On this exact branch:

| Check | Result |
|---|---|
| `npm test` | **284 of 284 pass**, 11 files, no existing test changed |
| `npm run build` | builds cleanly |
| Ctrl+Shift+E and Ctrl+Shift+D previously used anywhere | no — both were free |
| Clash with plain **E** (card editor) | none: that handler quits if Ctrl is held |
| Clash with **Shift+D** (descriptions, View tabs) | none: that handler quits if Ctrl or Cmd is held |
| Clash with **Alt+Shift+X** | none: the new handler quits if Alt is held |
| Clash with **Ctrl+Shift+?** (boss key) | none: that one only answers to `?` and `/` |
| Sync files edited | **none** — `persistenceService.js` is untouched, and so is the sync handler itself |
| The "data not loaded yet" guard | I checked it is the exact mirror of the two points where the screen refuses to draw, so the keys are dead in precisely the states where the buttons do not exist |

**What I could not test:** anything using your real cloud — my sandbox has no working
Firebase, so I could not watch a real upload. This is why Group A2 and Group E are
worth your time. I also could not easily reproduce the red "could not read your data"
screen to confirm the keys are dead there; that guard is verified by reading the code
rather than by clicking.

---

# 6. About the code, in case you are curious

The whole change is in `src/App.jsx`: two small "pointer" variables, one keyboard
listener, and two tooltip strings. No other file was touched.

The listener holds *pointers* to the two functions rather than copies of them,
following the same pattern already used for the **M** and **N** keys. The reason is
dull but real: the export function is rebuilt every time the screen redraws and it
carries your current cards with it, so a listener that grabbed one copy at startup
would keep handing you a backup of an empty canvas forever.

One judgement call worth flagging: **Ctrl+Shift+E is now stricter than its own
button** — the button works in a View tab, the shortcut does not. That is what you
asked for, and there is a note in the code saying so, so that nobody later "tidies"
it back into line.

---

# 7. Owner sign-off

**Result: 17 of 17 PASS.** Signed off by the owner on 19 August 2026, covering all
six groups — the shortcuts firing (A), typing never being interrupted (B), every
pre-existing shortcut still working (C), the View tab having the keys off while the
Export button stays on (D), sync re-entrancy and automatic sync being untouched (E),
and no Chrome bookmark dialog (F).

Merged to `main` on that basis.

---

# 8. Changes to this document

- **v1** — written after you asked for both shortcuts to be editor-only, and for a
  declined shortcut not to leak through to the browser.
- **v2** — owner sign-off recorded: 17 of 17 PASS.
