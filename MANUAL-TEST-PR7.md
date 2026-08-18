
**Milestone:** Fix 5 — honest saving (Bug 30 + minimal Bug 43)
**Pull request:** #7
**Branch:** `fix/bug-30-43-honest-saving`

**This document was rewritten after the first attempt confused you. What changed
and why is in §9, so you can see I am not just reshuffling words.**

---

## 0. READ THIS FIRST — the two questions that broke the last attempt

### "Every line says `unsaved: false`. What now?"

That means **everything has already been uploaded.** It is the healthy, finished
state. Nothing is pending, nothing is wrong.

The `editCounter` was missing from your output for the same reason: the counter
only exists **while an edit is waiting to be uploaded.** Once a document is safely
in the cloud, the counter is deleted along with the rest of the pending state. So:

| What you see | What it means |
|---|---|
| `unsaved: false` and no `editCounter` | Everything is in the cloud. Normal, finished, good. |
| `unsaved: true` with an `editCounter` | Something is waiting to be uploaded. |
| `unsaved: true` and **no** `editCounter` | **You are running the OLD code** — see Test 0. |

**My mistake:** I told you to look for `unsaved: true` "at the moment the first
upload completes". That moment lasts a fraction of a second and cannot be caught
by hand. It was an impossible instruction. Group B no longer asks you to catch
anything mid-flight.

### "The card FIX5 EDIT-B exists — how do I know it wasn't uploaded?"

You could not, and that was the real flaw. Checking whether a card is *on screen*
proves nothing, because a card can sit on this device while never reaching the
cloud — that IS the bug.

**The new test uses something you cannot fake: reload the page.** The app loads
from the cloud, so a card that is on screen *after a reload* is a card that is
genuinely in the cloud. Under the old bug, the second card **visibly disappears**
after a reload. That is a plain, obvious, yes/no outcome.

---

## 1. Before anything else: are you even running the new code?

**PR #7 is not merged.** If the app you open is built from `main`, it does not
contain Fix 5 and every test below will mislead you. Test 0 settles it in one
minute.

> **I need to ask:** how did you get Fix 4 in front of you for testing before it
> was merged? Whatever that was — a deploy from the branch, a preview link — you
> need to do the same for `fix/bug-30-43-honest-saving` before testing. If you
> cannot, tell me and I will find another way; **do not run Groups B–D against
> old code**, the results would be meaningless.

## TEST 0 — Version check (do not skip)

The "make uploads fail" switch **only exists in Fix 5**. If it has no effect, you
are on the old code.

1. Open the app, let it load, press **F12** → **Console**.
2. Paste:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
3. Add a card titled `FIX5 TEST0`.
4. Wait about 8 seconds and look at the cloud chip in the toolbar.

| What the chip does | Verdict |
|---|---|
| Turns **red "Sync failed"** or stays **blue "Unsaved changes"** | ✅ You are running Fix 5. Continue. |
| Settles on **green "Saved"** | ❌ **Old code.** Stop. Deploy the branch first, or tell me. |

5. Clean up either way:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'switch off'
   ```
6. Wait for green, then delete `FIX5 TEST0` and wait for green again.

**Result:** ☐ Running Fix 5 ☐ Running old code — **stop here**

---

## 2. What you need

| Item | Detail |
|---|---|
| Browser | Your normal one, **internet ON** for everything |
| Time | About 30 minutes |
| Data | Any real project with at least one canvas. Tests add and delete a few cards. |
| Risk | **Low.** Nothing deletes a canvas or project. Some tests slow down or fail uploads on purpose, then put them back. A failed upload leaves your work on this device, marked unsaved and queued — never lost. |

**Take a fresh Export before you start** and keep it.

## 3. The panic line

Lost, confused or stuck at any point? Paste this, press Enter, reload:

```
(()=>{['cm-debug-simulate-cloud-failure','cm-debug-slow-cloud-write','cm-debug-fail-cloud-write'].forEach(k=>localStorage.removeItem(k));const b=sessionStorage.getItem('fix4-backup');if(b)localStorage.setItem('cm-meta',b);const k=sessionStorage.getItem('fix4-ws-key'),v=sessionStorage.getItem('fix4-ws-val');if(k&&v!==null)localStorage.setItem(k,v);return 'all switches off, everything restored - now reload the page'})()
```

Expected: `all switches off, everything restored - now reload the page`

## 4. LINE A — the one inspection line you will use

The old version printed twelve rows of unreadable IDs. This one reports **only
the canvas you have open**, by name:

```
(()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const pid=m.activeProjectId;const s=JSON.parse(localStorage.getItem('cm-sync-state')||'{}');const p=JSON.parse(localStorage.getItem('cm-proj-'+pid)||'{}');const urlWs=((location.hash||'').match(/\/(?:editor|view)\/[^/]+\/([^/?#]+)/)||[])[1];const wsId=urlWs||p.activeTab;const w=JSON.parse(localStorage.getItem('cm-ws-'+pid+'-'+wsId)||'{}');const st=s[pid+'/'+wsId]||{};const others=Object.entries(s).filter(([k,v])=>k.startsWith(pid+'/')&&v&&v.dirty&&k!==pid+'/'+wsId).map(([k])=>k.slice(pid.length+1));return JSON.stringify({openCanvas:(w&&w.name)||wsId,unsaved:!!st.dirty,editCounter:(st.dirtySeq===undefined?'none (nothing pending)':st.dirtySeq),cloudVersion:st.baseRev,otherUnsavedDocs:others.length?others:'none'},null,1)})()
```

Example output:

```
{ "openCanvas": "Map Phase 5",
  "unsaved": false,
  "editCounter": "none (nothing pending)",
  "cloudVersion": 153,
  "otherUnsavedDocs": "none" }
```

| Field | Meaning |
|---|---|
| `openCanvas` | The canvas you are looking at |
| `unsaved` | `true` = something is waiting to be uploaded |
| `editCounter` | Only present while something is pending |
| **`cloudVersion`** | **How many times this canvas has been written to the cloud. Group B depends on this number.** |
| `otherUnsavedDocs` | Anything else pending (`__tasks` = your task list) |

**LINE B — uploads waiting to be retried:**
```
(()=>{const q=JSON.parse(localStorage.getItem('cm-retry-queue')||'[]');return 'writes waiting to retry: '+q.length+(q.length?' ('+q.map(e=>e.type).join(', ')+')':'')})()
```

---

# GROUP A — normal use must be unaffected

## A1 — Opens and works normally
1. Open the app. Wait for it to load.

**Expect:** your project opens, no banners, chip settles on green **Saved · …**.

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — A normal edit saves, and the chip tells the truth
1. Add a card titled `FIX5 A2`.
2. Watch the chip: **Unsaved changes** (blue) → **Syncing…** → green **Saved**.
3. Run **Line A**. Expect `unsaved: false`, `otherUnsavedDocs: none`.
4. Reload. `FIX5 A2` is still there.
5. Delete it, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — Switching canvases
1. Switch to another canvas and back.

**Expect:** both work, no banner, chip green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — the important one: typing while it uploads

> **What this is really testing.** Uploads take about a fifth of a second. If you
> type during that fifth of a second, the old code marked your new text as
> "saved" when it was only on this device. It was then never uploaded — and the
> next time the app loaded, it took the cloud's version as correct and **your text
> vanished**.
>
> To make that fifth of a second reachable, `cm-debug-slow-cloud-write` stretches
> every upload to 2.5 seconds.
>
> **Why 2.5 and not 10 seconds:** the app waits 3 seconds after you stop typing
> before uploading. With a 10-second upload, the second card's own upload starts
> while the first is still going and gets bundled in — so the bug never shows and
> the test proves nothing. This was wrong in my first version of this document.
> The upload has to finish *before* the 3-second wait expires, so it must be
> shorter than 3 seconds.

## B1 — Set up and note the starting number

1. Pick a canvas you don't mind adding two cards to, and open it.
2. Run **Line A**. **Write down `cloudVersion`.** Call it **V**.
   *(In your earlier output the open canvas had `cloudVersion: 441`. Yours will
   differ — just note whatever number you get.)*
3. Turn on the slow-upload switch:
   ```
   localStorage.setItem('cm-debug-slow-cloud-write','2500'); 'uploads now take 2.5 seconds'
   ```
4. Position your mouse over the button you normally use to add a card, ready to
   click. **You will need to click it within a 2.5-second window.**

**V = ____________**

☐ Ready

## B2 — The timed part

Read all of this before doing it.

1. Add a card titled `FIX5 EDIT-A`.
2. **Watch the chip.** It shows **Unsaved changes** for about 3 seconds, then
   flips to **Syncing…**.
3. **The instant it says Syncing…, add a second card titled `FIX5 EDIT-B`.**
   You have about 2.5 seconds.
4. Stop touching anything. Wait until the chip settles on green **Saved** (up to
   about 15 seconds; it may flick through Syncing… more than once).

### Did you hit the window? Check before going further

5. Run **Line A** and look at `cloudVersion`. Compare with **V**:

| `cloudVersion` now | Meaning | Do this |
|---|---|---|
| **V + 2** (or more) | ✅ Two separate uploads happened. **Valid run** — go to B3. | Continue |
| **V + 1** | ⚠️ Both cards went up in one upload. The test proves nothing — **not a failure.** | Delete both cards, wait for green, then redo B1–B2 and click sooner |
| **V** unchanged | ⚠️ Nothing uploaded at all. | Wait longer for green, then re-check |

> Another way to tell you hit it: the chip said **Syncing…** at the moment you
> added the second card.

**cloudVersion after = ____________  →  ☐ Valid run (V+2) ☐ Inconclusive, retrying**

## B3 — The actual test: does EDIT-B survive a reload?

Only do this after B2 says **Valid run**.

1. Turn the switch off:
   ```
   localStorage.removeItem('cm-debug-slow-cloud-write'); 'normal speed'
   ```
2. Wait for the chip to show green **Saved**.
3. Run **Line A** — expect `unsaved: false`.
4. **Reload the page.** Wait for it to finish loading.

### ✅ PASS — both cards are still on the canvas

`FIX5 EDIT-A` **and** `FIX5 EDIT-B` are both there. The second card reached the
cloud, which is the whole point of this fix.

### ❌ FAIL — `FIX5 EDIT-B` has disappeared

The card was on screen before the reload and is gone after it. That is the bug:
it was marked as saved, never uploaded, and the reload replaced it with the
cloud's version. **If this happens, tell me immediately** and send the output of
Line A.

> Why a reload is trustworthy evidence: the app loads from the cloud, and you
> confirmed at step 3 that nothing was pending locally. So a card that survives a
> reload is a card that is genuinely in the cloud.

5. Delete both cards. Wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

## B4 — A quiet document must still go clean (no regression)

The fix must not leave things permanently stuck as "unsaved".

1. Add a card `FIX5 B4`. **Touch nothing else.**
2. Wait for green **Saved**.
3. Run **Line A**.

**Expect:** `unsaved: false`, `editCounter: none (nothing pending)`,
`otherUnsavedDocs: none`.

4. Delete the card, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — a failed upload must say so

## C1 — A failing upload never claims "Saved"
1. ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
2. Add a card titled `FIX5 C1`.
3. Wait about 8 seconds, watch the chip.

**Expect:** red **Sync failed** or blue **Unsaved changes**. **Never** green
**Saved**.

☐ PASS ☐ FAIL ☐ BLOCKED

## C2 — Recorded as unsaved and queued, not lost
1. Run **Line A**. Expect `unsaved: true` **with an `editCounter` number**.
2. Run **Line B**. Expect `writes waiting to retry: 1` or more, mentioning
   `workspace`.

☐ PASS ☐ FAIL ☐ BLOCKED

## C3 — Recovers when uploads work again
1. ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
2. Nudge a new upload: add a card `FIX5 NUDGE`, then delete it.
3. Wait for green **Saved**.
4. Run **Line A** → `unsaved: false`. Run **Line B** → `writes waiting to retry: 0`.

☐ PASS ☐ FAIL ☐ BLOCKED

## C4 — The card written during the outage survives
1. **Reload the page.**

**Expect:** `FIX5 C1` is present — written while uploads were failing, and it
still got there.

2. Delete it, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — Fix 4 and Fix 5 together

> The cross-fix test promised when we split these. Fix 4 made a failed load leave
> the "unsaved" marker alone instead of clearing it; Fix 5 changed how that marker
> clears. This checks they work together.

## D1 — Unsynced work survives a failed load
1. Stop uploads:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will fail'
   ```
2. Add a card titled `FIX5 SURVIVOR`.
3. Wait ~8 seconds. Run **Line A** → `unsaved: true`.
4. Now also break loading:
   ```
   localStorage.setItem('cm-debug-simulate-cloud-failure','1'); 'reads will fail too'
   ```
5. **Reload.**

**Expect:** the **amber** "Working offline — saved on this device only" banner from
Fix 4, and `FIX5 SURVIVOR` still on the canvas.

6. Run **Line A** → still `unsaved: true`. The marker was **not** wiped by the
   failed load.

☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — And it syncs once things are healthy
1. Both switches off:
   ```
   ['cm-debug-simulate-cloud-failure','cm-debug-fail-cloud-write'].forEach(k=>localStorage.removeItem(k)); 'both off'
   ```
2. **Reload.**

**Expect:** no banners, `FIX5 SURVIVOR` present, chip settles on green **Saved**.

3. Run **Line A** → `unsaved: false`.
4. **Reload again.** `FIX5 SURVIVOR` is still there — it reached the cloud.
5. Delete it, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 5. If a test is inconclusive

**Inconclusive is not failure.** B2 is a timing test and can legitimately miss.
Mark it **INCONCLUSIVE**, note the `cloudVersion` numbers, and either retry or
tell me — I would rather have an honest "I could not hit the window" than a PASS
that proved nothing. The two rounds we lost on Fix 4 came from exactly that.

# 6. What manual testing here CANNOT prove

1. **It cannot read your cloud directly.** The reload check is strong evidence
   (the app loads from the cloud, and you verified nothing was pending first), but
   proof needs the Firebase console — compare the canvas document's `revision`
   before and after.
2. **The switches simulate failures.** A real permission error, quota error or
   mid-write disconnection may behave differently.
3. **B2 depends on timing** and can miss the window. See §5.
4. **Two uploads of the same document overlapping is only unit-tested.** Hard to
   trigger by hand; covered by 27 automated tests plus a browser check of the
   mechanism.
5. **Nothing here tests two devices conflicting.** Out of scope.

# 7. Known limits left in this fix

1. **A conflict is still reported internally as a successful save.** No visible
   lie — the document stays marked unsaved and the chip reads that marker, not the
   status — but the internal value is imprecise. Left alone to keep the diff small.
2. **`saveUserMeta` has no retry entry** — it is the "which project was open"
   pointer, not content.
3. **Undo back to identical content still costs one extra upload.** Deliberate:
   comparing content fingerprints instead cannot work here, because the app
   records a different *shape* when marking a change than it sends when uploading
   project settings, so a fingerprint check would mark settings permanently
   unsaved and upload them forever.
4. **The 20–30 second blank page on a slow cloud** is still there (Fix 4, §7.5 of
   MANUAL-TEST-PR6.md).
5. **All three debug switches must be removed after Fix 6.**

# 8. Sign-off

| Group | Tests | Passed | Failed | Inconclusive |
|---|---|---|---|---|
| 0 — version check | 1 | | | |
| A — normal use | 3 | | | |
| B — typing during an upload | 4 | | | |
| C — failed upload | 4 | | | |
| D — cross-fix | 2 | | | |
| **Total** | **14** | | | |

**Tester:**  **Date:**  **Overall:** ☐ Accept ☐ Reject

If anything fails, send me **Line A**, **Line B**, and the chip colour at the time.

# 9. What changed from the first version of this document, and why

Recorded so the corrections are auditable rather than silent.

1. **Added Test 0.** There was no way to tell whether you were even running the
   new code. Since PR #7 is unmerged, that was a serious hole.
2. **Explained `unsaved: false` everywhere.** Your result was the healthy state,
   and the document did not say so. Added the lookup table in §0.
3. **Explained the missing `editCounter`.** It is deleted once a document is
   safely uploaded, so a synced app shows none. Verified in the code. Its absence
   *while something is pending* is now a documented signal of old code.
4. **Removed the impossible instruction.** The old B1 asked you to observe
   `unsaved: true` "at the moment the first upload completes" — a fraction of a
   second. Nothing now depends on catching an instant.
5. **Gave the test a falsifiable outcome.** Old B1 had no way to tell whether
   EDIT-B was uploaded, which was your exact question. It is now: reload, and see
   whether the card is still there.
6. **Changed the slow-upload delay from 10 seconds to 2.5** — and this was a real
   defect, not just wording. With 10 seconds the second card's own upload starts
   while the first is still running and gets bundled in, so the bug cannot appear
   and the test would have passed on broken code. The upload must finish inside
   the app's 3-second wait for the fault to be reachable.
7. **Added a validity check (`cloudVersion` V+2 vs V+1).** You can now tell
   whether your run actually exercised the bug, instead of guessing.
8. **Rewrote Line A.** It printed twelve rows of raw IDs; it now reports the open
   canvas by name.
9. **Added an "inconclusive" outcome** so a mistimed run is not recorded as PASS.
