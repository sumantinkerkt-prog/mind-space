# Test for PR #10 — the Preview button is gone

Branch: `chore/retire-preview-mode` (pull request #10).

**This is a small one.** About 8 minutes. Nothing is added, nothing is deleted, and
no data is touched. One button and one icon are removed.

---

## 1. What this change does

The top bar had two buttons that did nearly the same thing: **Preview** and **View**.
You asked whether they shared the same code, said View was better, and asked for
Preview to go.

**The answer to your question:** the read-only part was the same code. Both buttons
fed one switch inside the app, and every "do not let them edit" check read that one
switch. What differed was how you turned it on, and what came with it:

| | Preview (now removed) | View (kept) |
|---|---|---|
| How it started | A button. Same tab. | Opens a new browser tab, with `#/view/` in the address. |
| Could you turn it off? | Yes, click again. The tab was still an editor tab. | No. Read-only comes from the address. |
| Extras | None. | Focus Mode, Shift+D to hide descriptions, read-only version preview, no Import or Sync buttons, and the whole of Fix 6. |

So Preview was the weaker twin. It is gone.

**What was removed:**

1. The **Preview** button in the top bar.
2. The **eye icon** in the tall thin toolbar on the right.

**One more thing fixed:** in a View tab, the little badge at the bottom-left of the
canvas used to say **"Preview"**. That was the exact mix-up this change is about. It
now says **"View"**.

---

## 2. Before you start

| | |
|---|---|
| **Where** | Open pull request #10 on GitHub. Scroll to the bottom. In the `vercel` comment, click **Preview**. |
| **How long** | About 8 minutes. |
| **What it touches** | Nothing. No test cards, no groups, no settings. |
| **Risk** | Very low. |

**This build also contains Fix 6**, which you just approved, so a couple of steps
double-check that Fix 6 still behaves after the two changes were put together.

**One line you will paste.** To open the Console: press **F12**, then click
**Console**. This line asks the app what kind of tab you are in:

```
(()=>{try{const p=window.mindspace.probe();return JSON.stringify({thisTabIs:p.role,willRefuseAllWrites:p.wouldBlockWrites,writesItHasRefused:p.refusedSoFar.length?p.refusedSoFar:"none so far"},null,1)}catch(e){return "This build does not have the check - tell Kiro ("+e.message+")"}})()
```

I call it **LINE P**. It changes nothing.

---

## Test 0 — am I testing the right build?

1. Open the Preview link. Wait for your project to appear.
2. Look at the top bar.

| What you see | What it means |
|---|---|
| There is a **View** button, and **no Preview button** | ✅ Right build. Carry on. |
| Both **Preview** and **View** are there | ❌ The Preview link has not updated. Stop and tell me. |

**Result: ☐ Right build ☐ Wrong build — I stopped**

---

# GROUP A — the editor still works

All in the normal editor tab.

## A1 — The two removed controls are really gone

1. Look along the top bar. There is **no Preview button**.
2. Look at the tall thin toolbar on the right side of the canvas. There is **no eye
   icon**.
3. The **View** button is still in the top bar.

**What should happen:** Preview is gone in both places, View is still there.

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — Editing still works

1. Add a card. Title it `PR10 A2`.
2. Watch the chip in the top bar: **Unsaved changes** → **Syncing…** → green
   **Saved**.
3. Reload the page. The card is still there.
4. Delete the card. Wait for green.

**What should happen:** adding, saving and deleting all behave as normal.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — The Full Edit / Arrange switch still works

The Preview button used to sit next to this one, so this checks I did not disturb it.

1. Look at the badge at the bottom-left of the canvas. It says **Full Edit**.
2. Press the **M** key. It changes to **Arrange**.
3. Press **M** again. It goes back to **Full Edit**.
4. The same switch is in the top bar as a button. Click it twice and watch the badge
   do the same thing.

**What should happen:** the badge changes both ways, by key and by button.

☐ PASS ☐ FAIL ☐ BLOCKED

## A4 — Switching canvas still saves

1. Drag a card a short way.
2. Straight away, switch to another canvas, then switch back.
3. Wait for the chip to go green.

**What should happen:** the card stayed where you dragged it.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — the View tab still works, and is still read-only

## B1 — The badge now says View, not Preview

1. Click **View** in the top bar. A new browser tab opens.
2. Check the address of the new tab: it has `#/view/` in it.
3. Look at the badge at the bottom-left of the canvas.

**What should happen:** it says **View**. It used to say **Preview** here — that was
the mix-up this change removes.

☐ PASS ☐ FAIL ☐ BLOCKED

## B2 — The View tab is still read-only (Fix 6 still holds)

1. In the View tab, open the Console and paste **LINE P**.

**What should happen:**

```
"thisTabIs": "viewer"
"willRefuseAllWrites": true
```

2. Try to drag a card. It does not move, or it snaps back.
3. Press **S** for the sidebar. There is no **Import**, no **Partial** and no
   **Sync to Server** button.
4. There is no **Preview** button in this tab either.

**What should happen:** the tab says it is a viewer, and refuses to be edited.

☐ PASS ☐ FAIL ☐ BLOCKED

## B3 — Reading still works

Still in the View tab:

1. Switch between canvases. The address stays `#/view/`.
2. Pan and zoom.
3. Press **Shift+D**. Descriptions hide. Press again. They come back.
4. Click a card and press **Ctrl+C**. Then paste it into the editor tab.

**What should happen:** everything a reader needs still works.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 3. Finish up

1. **Close the View tab.**
2. In the editor tab, check the chip is green and no card named `PR10…` is left.

☐ Done

---

# 4. If something looks wrong

Write **FAIL** or **INCONCLUSIVE** and tell me what you saw. If a button you expected
is missing, or one you expected to be gone is still there, say which one and where —
top bar or right-hand toolbar.

---

# 5. What I tested myself

In a browser, on this exact branch with Fix 6 merged in (my Firebase settings were
switched off first and put back afterwards):

| Check | Result |
|---|---|
| Editor: Preview button | gone |
| Editor: View button | still there |
| Editor: **M** key | **Full Edit → Arrange → Full Edit**, both ways |
| Editor: canvas switch still saves | wrote its canvas, its settings and its last-place marker |
| View tab: badge | says **View** |
| View tab: LINE P | `viewer`, refuses all writes |
| View tab: Import / Sync buttons | not shown |
| View tab: switch canvas, then wait | **nothing written at all** |

284 automated tests pass and the app builds cleanly.

**What I could not test:** anything involving your real cloud. My sandbox has no
working cloud. Nothing in this change touches saving or uploading, though — it only
removes two controls from the screen.

---

# 6. About the code, in case you are curious

The switch behind Preview is gone, along with the function that flipped it — about
65 lines removed in total.

One thing I deliberately did **not** do: the internal name for "this tab is
read-only" is still `isPreviewMode`, even though Preview is gone. About forty checks
across the file read that name, and renaming them all would mean touching every path
the last six fixes just made safe. It now simply means "this is a View tab", and
there is a note in the code explaining why the old name stayed.

---

# 7. Changes to this document

- **v1** — first version, written after you approved Fix 6 (PR #9).
