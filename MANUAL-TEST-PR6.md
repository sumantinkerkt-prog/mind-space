
**Milestone:** Fix 4 — tell "no data" apart from "couldn't read data" (Bug 42)
**Pull request:** #6
**Branch:** `fix/bug-42-indeterminate-read`
**Purpose of this document:** to prove that a failed read can no longer be
mistaken for an empty account, and that after a failed read the app writes
nothing at all. Nothing here requires a terminal.

---

## STOP — read this one paragraph before you start

> **Every test in this document is safe, but two of them deliberately break a
> piece of your browser's stored data.** You will be told exactly how to put it
> back, and the whole point of the fix is that the app does not touch your data
> while it is broken. Even so:
>
> **Take a fresh export of every project before you start** (the Export button),
> and keep it until you have finished. This is the same rule as always — never
> delete the previous backup.
>
> These tests only ever break the copy stored **inside your browser**. Your cloud
> copy is not touched by any step here, so the worst realistic outcome is that
> you reload the page and the app re-downloads everything from the cloud.

---

## 1. What you need

| Item | Detail |
|---|---|
| Browser | The one you normally use |
| Time | About 30 minutes |
| Data | Any real project of yours, plus the ability to open the browser's developer Console (see §3) |
| Risk | **Low.** No test edits, deletes or repairs a card. Two tests corrupt one stored key inside your browser and then restore it. Nothing is uploaded during those tests — proving that is the point. |

## 2. How to record results

Each test ends with a result line. Tick one box.

- **PASS** — the expected result happened exactly as written.
- **FAIL** — something different happened. Write what you saw on the Notes line.
- **BLOCKED** — you could not run the test.

If a step's expected result does not happen, stop that test, mark it FAIL, and
move on. Do not try to work around it.

## 3. The one technical skill these tests need

Two tests need you to type a line into the browser's **Console**. This is the
only way to simulate a read failure without waiting for a real one.

**To open the Console:** press **F12**, then click the tab named **Console**.
(On a Mac: **Cmd+Option+I**, then **Console**.)

You will paste a line, press **Enter**, and read what comes back. That is all.
If you would rather not do this, mark tests **C1**, **C2**, **D1** and **D2**
BLOCKED and tell me — I will run them and give you the evidence.

> **Important:** run these Console lines only in a tab showing **your own app**.
> Never paste a line someone else gave you into a Console on any other website.

## 4. Vocabulary used in the steps

| Term | Where it is |
|---|---|
| **Blocking screen** | A white card in the middle of an otherwise empty page, headed **"Could not read your data"**, with a **Reload and try again** button |
| **Red banner** | A thin red strip across the very top of the app reading **"Read-only: some of your data could not be loaded. Saving is OFF…"** with its own small **Reload** button |
| **Demo project** | The starter content the app used to invent: a canvas called **"Product Launch Roadmap"** containing cards named *User Interviews*, *Competitor Benchmark*, *Component Library*, *Launch Strategy Plan* |
| **Sync chip** | The little cloud status button in the top toolbar |
| **Sync now** | The button inside the panel that opens when you click the sync chip |
| **Console** | See §3 |

## 5. Requirement coverage

If every test below passes, this milestone is complete.

| # | Requirement | Tests |
|---|---|---|
| R1 | A failed read is **never** treated as "you have no data" | C1, C2 |
| R2 | After a failed read the app **never invents the demo project** | C1, C2 |
| R3 | After a failed read the app **writes nothing** to the browser | C1, C2, D2 |
| R4 | After a failed read the app **uploads nothing** to the cloud | C3, D3 |
| R5 | A *partly* failed read leaves the app **readable but not saveable** | D1, D2 |
| R6 | **Manual sync** is blocked too — it no longer bypasses the guard | C3, D3 |
| R7 | The user is **told, in plain language**, what happened and what to do | C1, D1 |
| R8 | A genuine first run **still** gets a starter project (no regression) | A1 |
| R9 | A normal healthy load is **completely unaffected** (no regression) | B1, B2, B3 |
| R10 | Recovery information is **not destroyed** by a failed load | D4 |

---

# GROUP A — the behaviour that must NOT change

## A1 — A genuine new browser still gets a starter project

**Why this test exists:** the fix makes the app refuse to create a starter
project after a failed read. It must still create one for a real new user.

**Preconditions:** none. Use a **private/incognito window** so your real data is
untouched.

1. Open a **new private/incognito window**.
2. Go to your app's address.
3. Wait for it to finish loading.

**Expected result:** the **demo project** appears — a canvas called *Product
Launch Roadmap* with the four cards listed in §4. There is **no** blocking
screen and **no** red banner.

4. Close the private window.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

---

# GROUP B — a normal, healthy day (regression checks)

## B1 — Your real project opens exactly as before

**Preconditions:** normal browser window, online.

1. Open the app normally.
2. Wait for it to finish loading.

**Expected result:** your project opens as usual. **No** blocking screen, **no**
red banner. The sync chip behaves as it always has.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## B2 — Editing and saving still work

**Preconditions:** B1 passed. Pick a canvas you do not mind adding one card to.

1. Add one card. Give it the title `FIX4 CHECK`.
2. Wait about 10 seconds.
3. Reload the page.

**Expected result:** the card `FIX4 CHECK` is still there after the reload.
Saving is working normally.

4. Delete the card `FIX4 CHECK`. Wait 10 seconds. Reload. It stays deleted.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## B3 — Switching canvases still works

1. Switch to a different canvas, then back.

**Expected result:** both switches work, content is correct, no banner appears.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

---

# GROUP C — a completely failed read (the heart of Bug 42)

> This group breaks the small pointer record the app uses to find your projects,
> which makes the app unable to read anything. **Before the fix, this exact
> situation produced the demo project and then uploaded it over your real work.**

## C1 — A broken pointer shows the blocking screen, not the demo project

**Preconditions:** the app open and loaded normally (B1 passed).

1. Open the **Console** (§3).
2. Paste this line and press Enter. It saves a copy of the pointer, then breaks it:

   ```
   sessionStorage.setItem('fix4-backup', localStorage.getItem('cm-meta')); localStorage.setItem('cm-meta', 'BROKEN{{{'); 'pointer broken'
   ```

   **Expected:** the Console prints `'pointer broken'`.

3. Paste this line and press Enter, to record what your data looks like *before*
   the reload:

   ```
   sessionStorage.setItem('fix4-keys', Object.keys(localStorage).filter(k=>k.startsWith('cm-')).sort().join(',')); sessionStorage.getItem('fix4-keys')
   ```

   **Expected:** a list of names starting with `cm-`. Leave it on screen.

4. **Reload the page.**

**Expected result:** you see the **blocking screen** — a card headed **"Could not
read your data"**, with the smaller line *"Your data has not been changed."*, a
paragraph saying it is **not** showing your project and has **not** created a new
one, a green box telling you nothing will be saved and to reload, and a **Reload
and try again** button.

**You must NOT see:** the demo project, any canvas, or an empty editable canvas.

5. Click **Technical details** on that screen.

**Expected:** it lists `localStorage:meta ×1 (critical)` — naming the read that
failed.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## C2 — While that screen is showing, nothing was written

**Preconditions:** you are looking at the blocking screen from C1. **Do not
reload yet.**

1. Open the Console and paste this line:

   ```
   JSON.stringify({pointerStillBroken: localStorage.getItem('cm-meta')==='BROKEN{{{', demoProjectInvented: localStorage.getItem('cm-proj-proj-default')!==null, keysNow: Object.keys(localStorage).filter(k=>k.startsWith('cm-')).sort().join(','), keysBefore: sessionStorage.getItem('fix4-keys')})
   ```

**Expected result:** all three of these are true of the answer:

| Field | Must be |
|---|---|
| `pointerStillBroken` | `true` — the app did **not** overwrite the broken pointer with a new one |
| `demoProjectInvented` | `false` — the app did **not** create a demo project |
| `keysNow` vs `keysBefore` | **identical** lists (a `cm-device` entry may appear; anything starting `cm-proj-default` or `cm-ws-proj-default` is a FAIL) |

> Before the fix, `pointerStillBroken` would have been `false` and
> `demoProjectInvented` would have been `true`. That is the whole bug.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## C3 — There is no way to force an upload from that screen

**Preconditions:** still on the blocking screen.

1. Look at the screen.

**Expected result:** the only button is **Reload and try again** (plus the
*Technical details* toggle). There is **no** sync chip, **no** Sync now button,
and no canvas — so there is no control that could upload anything.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## C4 — Repairing the pointer brings everything back

**Preconditions:** C1–C3 done.

1. In the Console, paste this line to put the pointer back:

   ```
   localStorage.setItem('cm-meta', sessionStorage.getItem('fix4-backup')); 'pointer restored'
   ```

2. **Reload the page.**

**Expected result:** your project opens normally, with all canvases and all cards
present, exactly as in B1. No blocking screen, no red banner.

> This is the proof that nothing was lost while the pointer was broken.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

---

# GROUP D — a *partly* failed read (read-only mode)

> This group breaks **one canvas's** stored record while leaving the rest
> readable. The app can then show you most of your project but is missing a
> piece — so it shows what it has and refuses to save, because saving a project
> with a missing canvas is how that canvas gets deleted everywhere.

## D1 — One broken canvas gives the red read-only banner

**Preconditions:** app loaded normally. Pick a canvas that is **not** the one
currently on screen — note its name. You will need its internal id; step 1 finds
it for you.

1. Open the Console and paste this line. It lists your canvases and their ids:

   ```
   (()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const p=JSON.parse(localStorage.getItem('cm-proj-'+m.activeProjectId));return JSON.stringify({project:m.activeProjectId,canvases:(p.workspaceIds||[]).map(id=>({id,name:(JSON.parse(localStorage.getItem('cm-ws-'+m.activeProjectId+'-'+id)||'{}')||{}).name}))})})()
   ```

2. From that answer pick a canvas that is **not** the one on screen. Note its
   `id` (something like `ws-2`).
3. Paste this line, replacing `PUT_ID_HERE` with that id. It backs the canvas up,
   then breaks it:

   ```
   (()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const k='cm-ws-'+m.activeProjectId+'-'+'PUT_ID_HERE';sessionStorage.setItem('fix4-ws-key',k);sessionStorage.setItem('fix4-ws-val',localStorage.getItem(k));localStorage.setItem(k,'}}BROKEN');return 'broke '+k})()
   ```

   **Expected:** it prints `broke cm-ws-…`.

4. **Reload the page.**

**Expected result:** the app **does** open and you **can** see your project, but
there is a **red banner** across the very top reading **"Read-only: some of your
data could not be loaded. Saving is OFF so nothing can be erased - reload to
fix."** with a small **Reload** button.

The canvas you broke will be missing from the list. Every other canvas is there.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## D2 — In that state, an edit does not get saved

**Preconditions:** you are looking at the red banner from D1.

1. Add one card, title `SHOULD NOT SURVIVE`.
2. Wait 15 seconds (longer than the normal save delay).
3. Open the Console and paste:

   ```
   JSON.stringify({storedCardTitles: Object.keys(localStorage).filter(k=>k.startsWith('cm-ws-')).map(k=>{try{return (JSON.parse(localStorage.getItem(k)).nodes||[]).map(n=>n.title)}catch(e){return []}}).flat().filter(t=>t==='SHOULD NOT SURVIVE')})
   ```

**Expected result:** `storedCardTitles` is an **empty list** `[]`. The card you
typed exists only on screen; it was never written to storage.

4. **Reload the page.**

**Expected result:** the card `SHOULD NOT SURVIVE` is **gone**. Nothing you did
in read-only mode was kept — which is exactly the promise.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## D3 — Sync now refuses to upload in that state

**Preconditions:** re-do D1 steps 3–4 so the red banner is showing again.

1. Click the **sync chip** in the top toolbar to open its panel.
2. Click **Sync now**.

**Expected result:** a message appears saying sync is switched off because this
tab could not load your data properly, that nothing has been uploaded, and to
reload the page. The upload does **not** happen.

> Before the fix, this button deliberately switched the safety guard off, so one
> click here could upload a half-read project over your cloud copy.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## D4 — Repairing the canvas brings it back

1. In the Console, paste this line to restore the canvas you broke:

   ```
   localStorage.setItem(sessionStorage.getItem('fix4-ws-key'), sessionStorage.getItem('fix4-ws-val')); 'canvas restored'
   ```

2. **Reload the page.**

**Expected result:** the missing canvas is back with all its cards, the red
banner is gone, and the project is complete. Saving works again (re-run B2 if you
want to confirm).

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

---

# GROUP E — offline behaviour

## E1 — Going offline mid-session does not trigger the blocking screen

**Why this test exists:** the blocking screen is only for a failed **load**.
Losing the network *while working* is a different situation and must not wipe
your screen.

**Preconditions:** app loaded normally, project open.

1. Turn off your Wi-Fi / disconnect the network.
2. Wait 20 seconds. Do not reload.

**Expected result:** the app keeps working. The sync chip shows an offline or
error state. **No** blocking screen. Your cards stay on screen.

3. Reconnect the network.

**Expected result:** the app recovers; the sync chip returns to normal.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## E2 — Reloading *while* offline

**Preconditions:** E1 finished, app loaded.

1. Turn off your Wi-Fi.
2. **Reload the page.**

**Expected result:** one of two acceptable outcomes, depending on what your
browser still has cached:

- **Either** your project opens from the local copy (with the sync chip showing
  offline / local-only) — this is fine, the local read succeeded;
- **or** the **blocking screen** appears — also fine, that means the cloud read
  failed and the app correctly refused to guess.

**Unacceptable:** the demo project appearing, or an empty editable canvas.

3. Reconnect and reload. Your project must open normally and completely.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

---

# 6. What manual testing here CANNOT prove

Being honest about the limits of this document.

1. **It cannot prove the cloud was never written to.** Every test above reads the
   copy inside your browser. Confirming that nothing reached Firestore needs the
   Firebase console (check the project's `lastModified` / `revision` fields before
   and after Group C and D) or a network trace. What the tests do prove is that
   the code path which would have done the uploading never ran, because the
   local write that always precedes it never happened either.

2. **It cannot reproduce a real cloud read failure.** Groups C and D simulate
   failure by corrupting stored data, which exercises the same decision code but
   not the actual Firestore error path. A true permission-denied or timeout was
   verified only in automated tests and by reading the code.

3. **It cannot prove the fix covers every write path.** I gated the ones I found
   and listed them in the PR description. A write path I did not find would not
   show up in any test here. The known remaining gaps are listed in §7.

4. **Group A uses a private window, not a genuinely new machine.** A real new
   device could differ in ways a private window does not model.

5. **Timing is approximate.** "Wait 15 seconds" assumes the normal 3-second save
   delay with its 30-second ceiling. On a slow machine a longer wait may be
   needed before concluding that nothing was saved.

6. **These tests say nothing about Bug 30 / 43 (honest saving) or Bug 47
   (read-only View mode).** Those are Fixes 5 and 6. In particular, "saved"
   still appears before a cloud write completes — that is Fix 5's job, not this
   one's.

# 7. Known gaps deliberately left in this fix

These are real, they are out of scope for Fix 4, and they are recorded so they
are not forgotten.

1. **Two early writes still happen before the verdict is reached.** During the
   Firestore phase the app writes each successfully-read canvas into its local
   cache, and writes each project's metadata into the local cache. Both only ever
   write data that was actually read successfully, and both write per-document
   (never a shortened list), so neither can destroy a canvas. Moving the verdict
   earlier would have meant restructuring the whole load sequence — a much larger
   and riskier change than this fix.

2. **`fetchServerFreshness` still reports "nothing newer" when it fails.** Its
   failure is now recorded, but it happens after load, so it does not change the
   verdict. Belongs with Fix 5.

3. **The `p.id.split('')` white-screen in the Projects panel is still there**
   (a project whose stored record has no `id` crashes the app when the panel
   opens). Unrelated to this fix, still cheap to harden.

4. **No error boundary.** If React itself throws during render, the page still
   goes blank. The blocking screen only covers load failures that the load code
   detects.

---

# 8. Sign-off

| Group | Tests | Passed | Failed | Blocked |
|---|---|---|---|---|
| A — no regression for new users | 1 | | | |
| B — normal healthy day | 3 | | | |
| C — completely failed read | 4 | | | |
| D — partly failed read | 4 | | | |
| E — offline | 2 | | | |
| **Total** | **14** | | | |

**Tester:**
**Date:**
**Overall:** ☐ Accept ☐ Reject

**If anything failed, the single most useful thing you can send me** is the
output of the Console line from the test that failed, plus a screenshot of the
screen you were looking at.
