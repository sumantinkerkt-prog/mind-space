
**Milestone:** Fix 5 — honest saving (Bug 30 + minimal Bug 43)
**Pull request:** #7
**Branch:** `fix/bug-30-43-honest-saving`
**Purpose of this document:** to prove the app no longer says "Saved" when it has
not saved, and no longer forgets an edit you made while it was uploading.

Every Console line below has been run against a real browser before being put in
this document.

---

## What this fix is about, in one paragraph

Two separate lies. **First**, when two saves of the same thing overlapped, the
second one was reported as successful *the moment it was queued* — before it had
run at all. If it then failed, nothing told you. **Second**, and worse: if you
kept typing while an upload was in progress, the upload finishing marked
*everything* as saved, including the words you typed after it started. Those
words existed only on this device but the app believed they were in the cloud, so
they were never uploaded — and a later "your cloud copy is newer" check could
legitimately throw them away.

---

## 1. What you need

| Item | Detail |
|---|---|
| Browser | The one you normally use, internet ON |
| Time | About 25 minutes |
| Data | Any real project. One test adds and deletes two cards. |
| Risk | **Low.** Nothing here deletes a canvas or a project. Two tests slow down or fail your cloud uploads on purpose, then put them back. A failed upload leaves your work on this device and queued for retry — it is never lost. |

## 1a. THE PANIC LINE — updated for this fix

If you get lost, confused or stuck at any point, paste this, press Enter, then
reload. It turns off **all three** testing switches and restores anything the
Fix 4 tests may have broken:

```
(()=>{['cm-debug-simulate-cloud-failure','cm-debug-slow-cloud-write','cm-debug-fail-cloud-write'].forEach(k=>localStorage.removeItem(k));const b=sessionStorage.getItem('fix4-backup');if(b)localStorage.setItem('cm-meta',b);const k=sessionStorage.getItem('fix4-ws-key'),v=sessionStorage.getItem('fix4-ws-val');if(k&&v!==null)localStorage.setItem(k,v);return 'all switches off, everything restored - now reload the page'})()
```

**Expected:** `all switches off, everything restored - now reload the page`

Verified working: after running it, all three switches read back as absent.

## 2. The switches this fix adds

Bug 43 only happens in the gap between an upload starting and finishing. Real
uploads take about a fifth of a second, so that gap is impossible to hit by hand.
These make it easy:

| Switch | What it does | Turn on |
|---|---|---|
| **Slow write** | Makes every cloud upload take 10 seconds, so you can type during one | `localStorage.setItem('cm-debug-slow-cloud-write','10000')` |
| **Fail write** | Makes every cloud upload fail | `localStorage.setItem('cm-debug-fail-cloud-write','1')` |
| Simulate read failure | (from Fix 4) makes cloud *reads* fail | `localStorage.setItem('cm-debug-simulate-cloud-failure','1')` |

Turn any of them off with `localStorage.removeItem('<name>')`, or use the panic
line to clear all three.

Both new switches fail in the safe direction: a slow upload is still a real
upload, and a failed upload leaves your work on this device, marked unsaved and
queued for retry.

## 3. Two inspection lines you will use repeatedly

**Line A — which documents are unsaved:**
```
(()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const s=JSON.parse(localStorage.getItem('cm-sync-state')||'{}');const rows=Object.entries(s).filter(([k])=>k.startsWith(m.activeProjectId+'/')).map(([k,v])=>({doc:k.slice(m.activeProjectId.length+1),unsaved:!!v.dirty,editCounter:v.dirtySeq,cloudVersion:v.baseRev}));return JSON.stringify(rows,null,1)})()
```
Returns one row per document, e.g. `{"doc":"ws-a","unsaved":true,"editCounter":5,"cloudVersion":2}`.
`__tasks` is your task list, `__meta` is project settings, anything else is a canvas.

**Line B — uploads waiting to be retried:**
```
(()=>{const q=JSON.parse(localStorage.getItem('cm-retry-queue')||'[]');return 'writes waiting to retry: '+q.length+(q.length?' ('+q.map(e=>e.type).join(', ')+')':'')})()
```

## 4. Requirement coverage

| # | Requirement | Tests |
|---|---|---|
| R1 | A save is never reported successful before it has run | B3, C2 |
| R2 | A failed upload is reported as failed, not as "Saved" | C1, C2 |
| R3 | A failed upload is queued for retry and eventually succeeds | C3, C4 |
| R4 | An edit made *during* an upload is not marked as saved | **B1, B2** |
| R5 | That edit is uploaded afterwards, not forgotten | **B3** |
| R6 | A quiet document still goes clean normally (no regression) | A2, B4 |
| R7 | Unsynced edits survive a failed load and sync afterwards | D1, D2 |
| R8 | Normal editing and saving are unaffected | A1, A2, A3 |

---

# GROUP A — normal use must be unaffected

## A1 — The app opens and works as before
1. Open the app normally. Wait for it to load.

**Expected:** your project opens, no banners, the cloud chip settles on
**Saved · …** (green).

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — A normal edit saves and reports honestly
1. Add a card titled `FIX5 A2`.
2. Watch the cloud chip. **Expected:** it shows **Unsaved changes** (blue) briefly,
   then **Syncing…**, then settles on **Saved · just now** (green).
3. Run **Line A**. **Expected:** every row shows `"unsaved":false`.
4. Reload. **Expected:** `FIX5 A2` is still there.
5. Delete the card. Wait for the green chip again.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — Switching canvases still works
1. Switch to another canvas and back.

**Expected:** both switches work, no banner, chip returns to green.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — Bug 43: typing while it uploads (the important group)

> This is the bug that could silently lose work. Read A2's expected chip
> behaviour first so you know what "normal" looks like.

## B1 — An edit made during an upload stays marked unsaved

1. Turn on the slow-write switch:
   ```
   localStorage.setItem('cm-debug-slow-cloud-write','10000'); 'uploads now take 10 seconds'
   ```
2. Add a card titled `FIX5 EDIT-A`.
3. **Wait about 4 seconds** — long enough for the upload to start (it starts ~3
   seconds after you stop typing). The chip should read **Syncing…**.
4. **While it still says Syncing…**, add a second card titled `FIX5 EDIT-B`.
5. Wait until the chip stops saying **Syncing…** (up to ~25 seconds; it may cycle
   through Syncing more than once).
6. Run **Line A**.

**✅ Expected:** the row for the canvas you are on shows **`"unsaved":true`** at
the moment the first upload completes — and then, once the second upload
finishes, it settles to `"unsaved":false`.

**The failure to look for:** if `unsaved` went straight to `false` while
`FIX5 EDIT-B` had not been uploaded, that is the old bug. The most reliable
evidence is step 7.

7. Keep going to B2 — do not delete the cards yet.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## B2 — The chip does not claim "Saved" while EDIT-B is still local

During step 5 above, the chip must **never** show green **Saved** while
`FIX5 EDIT-B` is still waiting. It may show **Unsaved changes** or **Syncing…**
for a while. Green is only correct once everything is up.

**✅ Expected:** you did not see green **Saved** until after the second upload
finished.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## B3 — EDIT-B actually reaches the cloud

1. Turn the slow-write switch off:
   ```
   localStorage.removeItem('cm-debug-slow-cloud-write'); 'normal speed'
   ```
2. Wait for the chip to show green **Saved**.
3. Run **Line A** — every row must show `"unsaved":false`.
4. **Reload the page.**

**✅ Expected:** **both** `FIX5 EDIT-A` and `FIX5 EDIT-B` are present.

> This is the point of the whole fix. Under the old behaviour `FIX5 EDIT-B` could
> be marked as saved without ever being uploaded, and a later cloud-freshness
> check could discard it.

5. Delete both cards. Wait for green.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## B4 — A quiet document still goes clean (no regression)

1. Add a card titled `FIX5 B4`. **Do not touch anything else.**
2. Wait for green **Saved**.
3. Run **Line A**.

**✅ Expected:** all rows `"unsaved":false`. The fix must not leave documents
stuck as permanently unsaved.

4. Delete the card, wait for green.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — Bug 30: a failed upload must say so

## C1 — A failing upload does not report "Saved"

1. Turn on the failing-write switch:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
2. Add a card titled `FIX5 C1`.
3. Wait about 6 seconds and watch the chip.

**✅ Expected:** the chip shows **Sync failed** (red) or **Unsaved changes**
(blue). It must **not** show green **Saved**.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## C2 — It is recorded as unsaved, not lost

1. Run **Line A**. **✅ Expected:** the current canvas shows `"unsaved":true`.
2. Run **Line B**. **✅ Expected:** `writes waiting to retry: 1` or more,
   mentioning `workspace`.

> Your card is safe on this device and queued. That is the honest state.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## C3 — Turning the failure off lets it recover

1. Turn the switch off:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
2. Make any small edit (e.g. add a card `FIX5 C3` and delete it again) to nudge a
   new upload, then wait for green **Saved**.
3. Run **Line A**. **✅ Expected:** all rows `"unsaved":false`.
4. Run **Line B**. **✅ Expected:** `writes waiting to retry: 0`.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## C4 — The card survives

1. **Reload the page.**

**✅ Expected:** `FIX5 C1` is present. It was written while uploads were failing,
and it still made it to the cloud.

2. Delete `FIX5 C1`. Wait for green.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — the cross-fix test (Fix 4 + Fix 5 together)

> This is the test I promised when we agreed to do Fix 4 and Fix 5 separately.
> Fix 4 made a failed load leave the "unsaved changes" marker in place instead of
> clearing it. Fix 5 changed how that marker is cleared. This checks the two work
> together rather than each being fine alone.

## D1 — Unsynced work survives a failed load

1. Turn on the failing-write switch so an edit cannot reach the cloud:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will fail'
   ```
2. Add a card titled `FIX5 SURVIVOR`.
3. Wait ~6 seconds. Run **Line A** and confirm the canvas shows `"unsaved":true`.
4. Now also make the *load* fail, so the next start is a bad one:
   ```
   localStorage.setItem('cm-debug-simulate-cloud-failure','1'); 'reads will fail too'
   ```
5. **Reload the page.**

**✅ Expected:** the **amber** "Working offline — saved on this device only"
banner from Fix 4, and `FIX5 SURVIVOR` **still on the canvas**.

6. Run **Line A**. **✅ Expected:** the canvas still shows `"unsaved":true` — the
   marker was **not** cleared by the failed load.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — And it syncs once things are healthy again

1. Turn **both** switches off:
   ```
   ['cm-debug-simulate-cloud-failure','cm-debug-fail-cloud-write'].forEach(k=>localStorage.removeItem(k)); 'both off'
   ```
2. **Reload the page.**

**✅ Expected:** no banners, `FIX5 SURVIVOR` still present, and within a few
seconds the chip settles on green **Saved**.

3. Run **Line A**. **✅ Expected:** all rows `"unsaved":false`.
4. **Reload once more.** **✅ Expected:** `FIX5 SURVIVOR` is still there — it
   reached the cloud.
5. Delete the card. Wait for green.

**Result:** ☐ PASS ☐ FAIL ☐ BLOCKED

---

# 5. What manual testing here CANNOT prove

1. **It cannot prove the cloud actually holds the data.** Every check reads this
   device. "Reload and it is still there" is strong evidence but not proof — a
   reload can be served from the local copy. Proving the cloud side needs the
   Firebase console (compare the document's `revision` before and after).

2. **The switches simulate failures; they are not real ones.** A real Firestore
   permission error, quota error or mid-write disconnection may behave
   differently from a thrown error at the same point in the code.

3. **Group B's timing is approximate.** "Wait 4 seconds, then type" depends on
   the 3-second upload delay. If you are too quick or too slow, both cards end up
   in the same upload and the test proves nothing — the give-away is that you
   never saw **Syncing…** while typing the second card. Re-run it if unsure.

4. **The coalescing case is only unit-tested.** Two uploads of the *same document*
   overlapping is hard to trigger by hand. Its honesty is covered by 27 automated
   tests and a browser check of the mechanism itself, not by a click-through here.

5. **Nothing here tests conflicts between two devices.** Out of scope; that is
   the existing conflict flow.

# 6. Known limits deliberately left in this fix

1. **A conflict is still reported internally as a successful save.** When the
   cloud has moved ahead, the write is turned into a conflict prompt and the save
   reports success. The document correctly stays marked unsaved, and the chip
   shows **Unsaved changes** because it reads that marker rather than the status —
   so there is no visible lie — but the internal status is imprecise. Left alone
   to keep this change small.

2. **`saveUserMeta` has no retry entry.** If saving the "which project was open"
   pointer fails, it is not queued. It is a convenience pointer, not content.

3. **An undo back to identical content still causes one extra upload.** The
   counter moves even when the text returns to what it was, so the document is
   uploaded once more than strictly needed. Deliberate: the alternative
   (comparing content fingerprints) cannot work here, because `markDirty` and the
   upload record different shapes for project settings, and a fingerprint
   comparison would mark that document permanently unsaved and upload it forever.

4. **The 20–30 second blank page on a slow cloud is still there** (carried over
   from Fix 4, §7 item 5 of MANUAL-TEST-PR6.md).

5. **All three debug switches must be removed after Fix 6.**

---

# 7. Sign-off

| Group | Tests | Passed | Failed | Blocked |
|---|---|---|---|---|
| A — normal use unaffected | 3 | | | |
| B — editing during an upload | 4 | | | |
| C — a failed upload says so | 4 | | | |
| D — cross-fix (Fix 4 + Fix 5) | 2 | | | |
| **Total** | **13** | | | |

**Tester:**
**Date:**
**Overall:** ☐ Accept ☐ Reject

If anything fails, the most useful thing to send me is the output of **Line A**
and **Line B** at the moment it failed, plus which colour the chip was showing.
