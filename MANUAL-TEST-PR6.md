
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
| **Cloud-failure switch** | A testing switch I added so you can make the app's cloud reads fail on purpose. Turn on with `localStorage.setItem('cm-debug-simulate-cloud-failure','1')`, off with `localStorage.removeItem('cm-debug-simulate-cloud-failure')`. Off unless you set it; only affects reading; if left on the app just refuses to save. See §7 item 7. |

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

> ## ⚠️ CORRECTED — this test is NOT valid on your machine. Mark it **N/A**.
>
> **My error, found by you.** This test was written for an app with no cloud
> connection. Yours has one, and that changes everything:
>
> A private/incognito window gives you empty **browser** storage — but your
> **cloud** is still full. So the app does not experience a first run at all; it
> downloads your real projects from the cloud. One of them is `proj-default`,
> whose first canvas still holds the original starter content. **That is why you
> saw exactly the expected cards** — you were looking at your own cloud data, not
> at a freshly created starter project. Completely different code path.
>
> Your instinct was right: marking this PASS would have proved nothing.
>
> **A genuine first run needs empty browser storage AND an empty cloud**, which
> is not something you can arrange without deleting your cloud data. So this one
> is not yours to test.
>
> **I verified it instead**, in a sandbox with the cloud connection disabled:
> empty storage → the starter project *is* created, saved, and shown; no blocking
> screen, no banner. Re-verified after every later change.
>
> **Mark:** ☑ N/A (verified by Kiro — sandbox, cloud disabled)

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

> ## ⚠️ CORRECTED TWICE — please use the steps below. No network fiddling.
>
> **Attempt 1 was wrong** (breaking `cm-meta` alone): while your cloud is
> reachable the app never reads that record — it loads from the cloud and ignores
> the local pointer. Breaking it changed nothing, exactly as you saw. Confirmed in
> code: that read is at `App.jsx:1293`, inside the `else` at line 1291, which only
> runs **after a cloud read has already failed**.
>
> **Attempt 2 was also wrong** (turn off Wi-Fi): **your app is served over the
> internet**, so with no connection the browser cannot fetch the app at all and
> you get Chrome's dinosaur page. You never reach the code. My sandbox served the
> app from the local machine, which is why I did not hit this.
>
> There is a structural problem underneath both mistakes: **the blocking screen
> can only appear when a cloud read fails, and you cannot fail the cloud read
> without also failing the page load.**
>
> **So I have added a switch for it.** One Console line makes the app's cloud
> reads fail on purpose, with the app itself loading normally. It is off unless
> you set it, it only affects *reading*, and it fails in the safe direction — if
> you ever forget to turn it off, the app simply refuses to save and tells you so.
> It cannot lose data. Details in §7 item 7, including how to have me remove it.

> ### ⏱ Expect this to be quick
> With the switch, the failure is immediate — no 20–30 second blank wait. If you
> ever *do* see a long blank page in normal use, that is the separate pre-existing
> problem in §7 item 5.

## C1 — A failed cloud read + broken pointer shows the blocking screen

**Preconditions:** the app open and loaded normally (B1 passed).

1. Open the **Console** (§3).
2. Paste this line and press Enter. It saves a copy of the pointer, then breaks it:

   ```
   sessionStorage.setItem('fix4-backup', localStorage.getItem('cm-meta')); localStorage.setItem('cm-meta', 'BROKEN{{{'); 'pointer broken'
   ```

   **Expected:** the Console prints `'pointer broken'`.

3. Paste this line and press Enter, to record what your data looks like *before*
   the reload. (It ignores `cm-device`, which the app rewrites on every load by
   design.)

   ```
   sessionStorage.setItem('fix4-keys', Object.keys(localStorage).filter(k=>k.startsWith('cm-')&&k!=='cm-device'&&!k.startsWith('cm-debug')).sort().join(',')); sessionStorage.getItem('fix4-keys')
   ```

   **Expected:** a list of names starting with `cm-`. Leave it on screen.

4. **⚠️ CORRECTED STEP — turn the cloud-failure switch ON** (do **not** touch your
   Wi-Fi):

   ```
   localStorage.setItem('cm-debug-simulate-cloud-failure', '1'); 'cloud reads will now fail on purpose'
   ```

5. **Reload the page.** It should settle within a few seconds.

**Expected result:** you see the **blocking screen** — a card headed **"Could not
read your data"**, with the smaller line *"Your data has not been changed."*, a
paragraph saying it is **not** showing your project and has **not** created a new
one, a green box telling you nothing will be saved and to reload, and a **Reload
and try again** button.

**You must NOT see:** the demo project, any canvas, or an empty editable canvas.

6. Click **Technical details** on that screen.

**Expected:** it lists **two** failed reads, naming both things that went wrong:

```
firestore:userMeta ×1 (critical)
localStorage:meta ×1 (critical)
```

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED
**Notes:**

## C2 — While that screen is showing, nothing was written

**Preconditions:** you are looking at the blocking screen from C1. **Do not
reload yet.**

1. Open the Console and paste this line:

   ```
   JSON.stringify({pointerStillBroken: localStorage.getItem('cm-meta')==='BROKEN{{{', keyListIdentical: sessionStorage.getItem('fix4-keys')===Object.keys(localStorage).filter(k=>k.startsWith('cm-')&&k!=='cm-device').sort().join(','), keysNow: Object.keys(localStorage).filter(k=>k.startsWith('cm-')&&k!=='cm-device').sort().join(',')})
   ```

**Expected result:** both of these are true of the answer:

| Field | Must be |
|---|---|
| `pointerStillBroken` | `true` — the app did **not** overwrite the broken pointer |
| `keyListIdentical` | `true` — not one stored record was added, removed or renamed |

> **Why this is not checking for `cm-proj-proj-default` any more:** the original
> version checked whether a `proj-default` record existed and expected `false`.
> **That check was wrong for your browser** — you already have a real
> `proj-default` project (it appears to be your 10-canvas legacy test project),
> so that field would have read `true` and looked like a failure when nothing was
> wrong. Comparing the whole list before and after is both stricter and correct.

> Before the fix, `pointerStillBroken` would have been `false` and the list would
> have gained new records. That is the whole bug.

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

   **Expected:** it prints `'pointer restored'`. If it prints `null` instead,
   **stop and tell me** — do not reload. (This would mean the backup from C1 was
   lost, e.g. because the tab was closed in between. Your data is still fine; I
   will give you a different recovery line.)

2. **⚠️ Turn the cloud-failure switch OFF** — important, do not skip:

   ```
   localStorage.removeItem('cm-debug-simulate-cloud-failure'); 'switch off: ' + (localStorage.getItem('cm-debug-simulate-cloud-failure') === null)
   ```

   **Expected:** it prints `switch off: true`.

3. **Reload the page.**

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

> ## ⚠️ REPLACED — reloading with no Wi-Fi cannot be tested this way
>
> Same problem as Group C: with no connection the browser cannot fetch the app,
> so you get Chrome's dinosaur page and never reach the code. **Skip the Wi-Fi
> version.** Use E2b below instead — it tests the same thing (the cloud is
> unreachable, your local copy is fine) using the switch.

**E2 (Wi-Fi version):** ☑ SKIP — not testable on a web-hosted app

## E2b — Cloud unreachable, local copy complete (replaces E2)

**This test decides an open design question.** Please read the result carefully
and tell me whether you are happy with the behaviour — see §7 item 6.

**Preconditions:** app loaded normally, your real project open. **Do not** break
`cm-meta` for this test — your local data must be healthy.

1. Open the Console and turn the switch on:

   ```
   localStorage.setItem('cm-debug-simulate-cloud-failure', '1'); 'armed'
   ```

2. **Reload the page.** Wait a few seconds.

**Expected result (this is what I measured):** your project **does** open, your
canvases and cards are all visible and correct — **but there is a red read-only
banner across the top and saving is switched off.**

3. Confirm the read-only part: add a card called `E2B CHECK`, wait 15 seconds,
   then reload.

**Expected:** `E2B CHECK` is gone. Nothing you typed was saved.

4. Turn the switch off and reload:

   ```
   localStorage.removeItem('cm-debug-simulate-cloud-failure'); 'switch off'
   ```

**Expected:** normal operation returns, no banner, saving works again.

**Now the question for you.** Before this fix, this situation let you keep working
offline and saving locally, syncing when the connection came back. Now it is
read-only. Which do you want?

- ☐ **Option A (I recommend this):** let me keep working offline — saving locally,
  uploads still blocked, with a gentler "working offline, not synced" notice
- ☐ **Option B:** leave it as it is — read-only whenever the cloud cannot be read
- ☐ Not sure, talk me through it again

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

5. **A blank page for 20–30 seconds when the cloud is unreachable.** *(Found
   while re-checking your test results — pre-existing, NOT caused by this fix.)*
   The app waits for the cloud read with no time limit and renders nothing at all
   until it either succeeds or gives up. So a flaky connection produces a blank
   white page that is indistinguishable from the app being broken. My fix cannot
   show its message until after that wait, because the decision it makes depends
   on the answer. **Recommended follow-up:** give the cloud read a time limit
   (about 8 seconds) and show "Loading…" instead of nothing. Small change, big
   improvement in how the app *feels* when the network is poor. Awaiting your go-ahead.

6. **OPEN DESIGN QUESTION: reloading with no internet now makes the app
   read-only.** *(Found while re-checking your results.)* Before this fix, a
   reload with no connection loaded your local copy and let you keep working,
   saving locally and syncing later ("local-only" mode). Now the failed cloud
   read counts as a critical failure, so you get the red banner and saving is
   off. My view is that this is **too strict, and I recommend changing it** —
   "the cloud is unreachable but my local copy is complete" is a different
   situation from "part of my project failed to load", and only the second one
   carries the risk of erasing something. See my message for the full reasoning
   and the two options. **This needs your decision, not mine.**

7. **I added a testing switch to the shipped app, and you can veto it.**
   `cm-debug-simulate-cloud-failure` makes the app's cloud reads fail on purpose.
   I added it because there was otherwise **no way for you to test the main thing
   this fix does** — see the corrected Group C header for why turning off Wi-Fi
   and breaking local data both fail to reach the code.

   Why I judged it safe to ship:

   - **Off unless explicitly set.** No key, no effect.
   - **Reads only.** It never writes, deletes or alters anything.
   - **Fails safe.** A simulated read failure puts the app in read-only mode. If
     you left it on by accident, the app refuses to save and says so on screen —
     visible and harmless. It cannot cause data loss.
   - **Impossible to mistake for a real fault.** It announces itself in the
     Console every time it blocks a read.
   - **Useful again for Fix 5**, which is all about failed saves.

   If you would rather not have test code in the app, say so and I will remove it
   before merge — but then Group C and E2b become untestable by you, and you would
   be trusting my sandbox results for the central claim of this fix. **My
   recommendation: keep it while the remediation work is ongoing, and I will
   remove it when we finish Fix 6.**

---

# 8. Sign-off

| Group | Tests | Passed | Failed | Blocked | N/A |
|---|---|---|---|---|---|
| A — no regression for new users | 1 | | | | 1 (not testable on your setup) |
| B — normal healthy day | 3 | 3 | | | |
| C — completely failed read | 4 | | | | *re-run with corrected steps* |
| D — partly failed read | 4 | 4 | | | |
| E — offline | 2 | 1 (E1) | | | *E2 re-run requested* |
| **Total** | **14** | | | | |

### Round 1 results (recorded)

| Test | Result | Note |
|---|---|---|
| A1 | **N/A** | Test invalid for a cloud-connected app — my error, you caught it |
| B1, B2, B3 | **PASS** | No regression in normal use |
| C1–C4 | **BLOCKED** | Test steps were wrong (needed the network off) — corrected above |
| D1, D2, D3, D4 | **PASS** | **The most valuable result in this round** — see below |
| E1 | **PASS** | |
| E2 | **PASS**, re-run requested | Expected result was under-specified; needs the exact observation |

**What Group D passing already proves**, on your real machine with your real
cloud connection: the app detected an unreadable canvas, went read-only, did
**not** invent anything, did **not** save an edit made in that state, did **not**
shorten your project's canvas list, blocked **Sync now** from uploading, and gave
everything back intact on repair. That is the core mechanism of this fix working
end to end — it is not a small result, and it is independent of the broken C
steps.

**Tester:**
**Date:**
**Overall:** ☐ Accept ☐ Reject

**If anything failed, the single most useful thing you can send me** is the
output of the Console line from the test that failed, plus a screenshot of the
screen you were looking at.
