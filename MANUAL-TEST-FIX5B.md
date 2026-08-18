# Manual test — Fix 5b: the failed-upload queue

Branch `fix/bug-30-43b-retry-queue`. Follow-up to Fix 5 (PR #7, merged), which
found this. **Nothing here changes how editing or saving normally works** — it
changes what happens to an upload that has already failed.

## 1. What this fixes, in plain language

When a cloud upload fails, the app puts that document in a queue and tries again
later. Your Fix 5 test run showed three things wrong with that queue.

| What you saw | What was actually wrong |
|---|---|
| C3: "waiting to retry" never fell to 0, and only reset after a reload | The queue was only ever emptied at page load or when the browser reported reconnecting. Nothing emptied it while the app stayed open, so the number could not fall even though your uploads were working again. |
| C2/C3: the count climbed — 11, then 17, then 9 for 5 documents | Every failed attempt added another entry. Since each upload sends a **complete** document, all but the newest were pointless duplicates. |
| Line D said "nothing unsaved anywhere" while 9 uploads were still queued | Each queued entry carried a **frozen copy** of the document from the moment it failed. On the next reload the app uploaded those frozen copies — over content that had been saved successfully in the meantime. That is a route to losing work, and it is the most important thing fixed here. |

Plus two things behind them:

- **A canvas could sit on "Syncing…" for minutes** (your D2 note). The full sync
  uploaded project settings first and **gave up on everything else** if that one
  write failed — so no canvas was uploaded at all. Adding another card went green
  only because that takes a different route.
- **A failed project-settings upload was invisible.** Project settings are
  written from about ten places in the app, and most of them never marked
  anything as unsaved, so the chip could stay green while the write was lost.

### What now happens instead

1. A queued entry names the **document**, and carries **no copy of its content**.
   A retry re-reads what is on your device right now and sends that.
2. **One entry per document**, no matter how many attempts failed.
3. A retry only happens for a document still marked unsaved. If it was saved by
   any other route, the entry is **thrown away without writing anything** — that
   is what removes the overwrite risk.
4. The queue is also drained on the app's existing 20-second heartbeat, and an
   entry is cleared the instant its document is confirmed saved.
5. A failed upload always marks its document unsaved, so the chip tells the truth
   and — because the "don't overwrite newer cloud data" check only applies to
   unsaved documents — **every retry is now covered by that check.**

## 2. Before you start

| | |
|---|---|
| Where | The Vercel **preview** link on the pull request page for this branch (same way you tested PR #7). Test 0 below confirms you're on the right build. |
| Time | About 25 minutes |
| Data | Any real project with at least two canvases. Tests add and delete a few cards and rename a project (then rename it back). |
| Risk | **Low.** Nothing deletes a canvas or project. Some tests make uploads fail on purpose, then put them back. |

**Take a fresh Export before you start** and keep it.

## 3. The panic line — LINE E

Lost, confused or stuck at any point? Paste this, press Enter, reload:

```
(()=>{let n=0;try{n=(JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')||[]).length}catch{n='an unreadable number of'}localStorage.removeItem('cm-retry-queue');['cm-debug-slow-cloud-write','cm-debug-fail-cloud-write','cm-debug-simulate-cloud-failure'].forEach(k=>localStorage.removeItem(k));return 'discarded '+n+' queued uploads and turned every debug switch off - nothing on this device was deleted'})()
```

Expected: `discarded N queued uploads and turned every debug switch off - nothing
on this device was deleted` — then reload.

Safe to run at any time: it only clears the retry queue and the debug switches.
Anything genuinely unsaved stays marked unsaved and still gets uploaded.

## 4. The three inspection lines

**LINE A — the canvas you have open** (unchanged from the Fix 5 document):

```
(()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const pid=m.activeProjectId;const s=JSON.parse(localStorage.getItem('cm-sync-state')||'{}');const p=JSON.parse(localStorage.getItem('cm-proj-'+pid)||'{}');const urlWs=((location.hash||'').match(/\/(?:editor|view)\/[^/]+\/([^/?#]+)/)||[])[1];const wsId=urlWs||p.activeTab;const w=JSON.parse(localStorage.getItem('cm-ws-'+pid+'-'+wsId)||'{}');const st=s[pid+'/'+wsId]||{};const others=Object.entries(s).filter(([k,v])=>k.startsWith(pid+'/')&&v&&v.dirty&&k!==pid+'/'+wsId).map(([k])=>k.slice(pid.length+1));return JSON.stringify({openCanvas:(w&&w.name)||wsId,unsaved:!!st.dirty,editCounter:(st.dirtySeq===undefined?'none (nothing pending)':st.dirtySeq),cloudVersion:st.baseRev,otherUnsavedDocs:others.length?others:'none'},null,1)})()
```

**LINE C — what is waiting to be retried.** Replaces the old LINE B, and names
the project and canvas as you asked after C2. **This is a slightly updated
version of the line I sent you in chat** — use this one from now on, it reads the
time correctly on both the old and the new build:

```
(()=>{let q;try{q=JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')}catch{return 'the retry queue itself is unreadable (corrupt) - tell Kiro'}if(!Array.isArray(q))return 'the retry queue is not a list - tell Kiro';if(!q.length)return 'queue empty - nothing waiting to retry';const m=JSON.parse(localStorage.getItem('cm-meta')||'{}');const pn=(p)=>{try{return (JSON.parse(localStorage.getItem('cm-proj-'+p)||'{}').name)||p}catch{return p}};const wn=(p,w)=>{try{return (JSON.parse(localStorage.getItem('cm-ws-'+p+'-'+w)||'{}').name)||w}catch{return w}};const rows=q.map(e=>({what:e.type==='project'?'project settings':(e.type==='tasks'?'task list':'canvas'),project:pn(e.projectId),canvas:e.workspaceId?wn(e.projectId,e.workspaceId):'-',minutesOld:Math.round((Date.now()-(e.firstFailedAt||e.timestamp||Date.now()))/60000),triesSoFar:e.retryCount||0,isProjectImOn:e.projectId===m.activeProjectId}));return JSON.stringify({totalWaiting:q.length,rows},null,1)})()
```

The fields these tests use are **`totalWaiting`**, **`what`** and
**`triesSoFar`**.

**LINE D — everything unsaved, in every project** (Line A only looks at the
canvas you have open):

```
(()=>{let s;try{s=JSON.parse(localStorage.getItem('cm-sync-state')||'{}')}catch{return 'the saved/unsaved map is unreadable (corrupt) - tell Kiro'}const rows=Object.entries(s).filter(([,v])=>v&&v.dirty).map(([k,v])=>{const i=k.indexOf('/');const p=k.slice(0,i),d=k.slice(i+1);let pname=p;try{pname=(JSON.parse(localStorage.getItem('cm-proj-'+p)||'{}').name)||p}catch{}let dname;if(d==='__meta')dname='project settings';else if(d==='__tasks')dname='task list';else{let n=d;try{n=(JSON.parse(localStorage.getItem('cm-ws-'+p+'-'+d)||'{}').name)||d}catch{}dname='canvas: '+n}return{project:pname,unsavedDocument:dname,cloudVersion:v.baseRev,editCounter:v.dirtySeq}});return rows.length?JSON.stringify(rows,null,1):'nothing unsaved anywhere'})()
```

---

## Test 0 — am I on the Fix 5b build?

This takes two minutes and settles it, the same way Test 0 did for Fix 5. The
**shape** of a queued entry is different on this build: it no longer contains a
copy of your data.

1. Open the preview link, wait for the app to load, open the Console.
2. Run **LINE E**, then **reload** — so we start from an empty queue.
3. Break uploads on purpose:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
4. Add a card titled `FIX5B T0`. Wait about 10 seconds.
5. Run this:
   ```
   (()=>{let q;try{q=JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')}catch{return 'the retry queue is unreadable - tell Kiro'}if(!Array.isArray(q)||!q.length)return 'nothing queued yet - wait 10 more seconds and run this again';const e=q[0];return JSON.stringify({build:(e.key!==undefined&&e.data===undefined)?'Fix 5b':'older build',carriesACopyOfYourData:e.data!==undefined,fields:Object.keys(e).sort()},null,1)})()
   ```

| Output | Meaning |
|---|---|
| `"build": "Fix 5b"`, `"carriesACopyOfYourData": false` | ✅ **Fix 5b build.** Continue. |
| `"build": "older build"`, `"carriesACopyOfYourData": true` | ❌ Not this build — the preview link hasn't updated. Stop and tell me. |
| `nothing queued yet …` | Wait 10 more seconds and run it again. If it still says this after a minute, tell me. |

6. Clean up: fix uploads with
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
   wait for green **Saved**, delete the `FIX5B T0` card, wait for green again, then
   run **LINE E** and **reload**.

**Result: ☐ Fix 5b ☐ Older build — stop**

---

# GROUP A — normal use must be unaffected

## A1 — Opens and works normally
1. Open the app. Wait for it to load.

**Expect:** your project opens, no banners, chip settles on green **Saved · …**.

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — A normal edit still saves, and queues nothing
1. Run **LINE C**. **Expect `queue empty - nothing waiting to retry`.**
   *(If it is not empty, run LINE E and reload before going on — and tell me what
   it said, because that would mean something is failing outside these tests.)*
2. Add a card titled `FIX5B A2`.
3. Watch the chip: **Unsaved changes** → **Syncing…** → green **Saved**.
   (Dropping back to "Unsaved changes" once in between is normal — that is two
   documents each finishing their own upload.)
4. Run **LINE C** → still `queue empty`. Run **LINE D** → `nothing unsaved anywhere`.
5. Reload. `FIX5B A2` is still there.
6. Delete it, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — Switching canvases
1. Switch to another canvas and back.

**Expect:** both work, no banner, chip green, **LINE C** still `queue empty`.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — the queue no longer grows, and empties itself

> This is the direct replacement for tests C2 and C3.

## B1 — Baseline (the step the last document was missing)
1. Run **LINE C**. **Expect `queue empty - nothing waiting to retry`.**
2. Run **LINE D**. **Expect `nothing unsaved anywhere`.**

Do not continue until both are true — otherwise the counts below mean nothing.
Run **LINE E** and reload if needed.

☐ Ready

## B2 — One entry per document, no matter how long it keeps failing
1. Break uploads:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
2. Add a card titled `FIX5B B2`.
3. Wait about 10 seconds. Watch the chip: red **Sync failed** or blue **Unsaved
   changes**. **Never green Saved.**
4. Run **LINE A** → `unsaved: true`, with an `editCounter` number.
5. Run **LINE C**. **Write the number down.**

**Expect:** a small number — **1 to 3** rows (the canvas, project settings, and
possibly the task list). **Each document appears at most once.**

**totalWaiting = ____________**

6. Now wait **60 seconds**, touching nothing. (Three heartbeats pass, and the app
   keeps trying and failing.)
7. Run **LINE C** again.

**Expect:** the **same documents**, `totalWaiting` **unchanged**, and
`triesSoFar` now larger than 0. Before this fix the number climbed with every
attempt — that is what took your queue to 17.

**totalWaiting after 60s = ____________  (must equal the number above)**

> **Do not wait much longer than a minute here.** After five failed attempts the
> app deliberately stops retrying that document and removes it from the queue, so
> `totalWaiting` would fall towards 0 — correct behaviour, but it would spoil this
> particular comparison. The document stays marked unsaved (LINE D still lists
> it), and the next edit or the next full sync tries again. If you overshoot, just
> redo B1–B2.

☐ PASS ☐ FAIL ☐ BLOCKED

## B3 — It empties itself, without a reload
1. Fix uploads:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
2. Nudge an upload: add a card `FIX5B NUDGE`, then delete it.
3. Wait for green **Saved**, then wait **up to 25 more seconds** (the queue is
   also drained on a 20-second heartbeat).
4. Run **LINE A** → `unsaved: false`.
5. Run **LINE C** → **`queue empty - nothing waiting to retry`.**
6. Run **LINE D** → `nothing unsaved anywhere`.

**Do NOT reload during this test.** The whole point is that it clears itself
while the app stays open. (In your last run this only reset at C4's reload.)

☐ PASS ☐ FAIL ☐ BLOCKED

## B4 — The card written during the outage is really in the cloud
1. **Reload the page.**

**Expect:** `FIX5B B2` is present.

2. Delete it, wait for green, **LINE C** → `queue empty`.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — a failed upload can no longer overwrite newer work

> This is the dangerous one, and the reason I asked you to check your canvases
> after the last round. Before this fix, the queue held a frozen copy of the
> canvas as it was **at the moment of failure**, and wrote it on the next reload —
> even though newer content had been saved successfully in between.

## C1 — Set up
1. Run **LINE C** → `queue empty`. Run **LINE D** → `nothing unsaved anywhere`.
2. Break uploads:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
3. Add a card titled `FIX5B OLD`.
4. Wait about 10 seconds. Run **LINE C** → at least one row. **Write the number down.**

**totalWaiting = ____________**

☐ Ready

## C2 — Newer work is saved successfully on top
1. Fix uploads:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
2. Add a second card titled `FIX5B NEW`.
3. Wait for green **Saved**, then up to 25 more seconds.
4. Run **LINE C** → **`queue empty`** (the frozen copy has been discarded, not sent).

☐ PASS ☐ FAIL ☐ BLOCKED

## C3 — And it stays that way across two reloads
1. **Reload.** Expect **both** `FIX5B OLD` and `FIX5B NEW` on the canvas.
2. Run **LINE C** → `queue empty`.
3. **Reload again.** Expect **both cards still there.**

**Why twice:** the old behaviour would have uploaded the frozen copy during the
first reload — a copy containing `OLD` but **not** `NEW` — so `NEW` would have
disappeared on the *second* reload. If both cards survive two reloads, the frozen
copy is genuinely gone.

4. Delete both cards, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — a failed project-settings upload is now visible

> Project settings (your card counter, reminders, pin groups, project name) are
> uploaded from about ten places in the app, and most of them never marked
> anything unsaved. So this kind of failure used to be completely silent — the
> chip stayed green. This is my main suspect for the six extra `project settings`
> entries you saw appear in C3.

## D1 — A failing settings write says so
1. Run **LINE C** → `queue empty`. Run **LINE D** → `nothing unsaved anywhere`.
2. Break uploads:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
3. Open the Projects panel: **Alt+Shift+X**.
4. Find the edit control for the project you are currently on and change its
   **name** to `FIX5B RENAME TEST`. Save/apply, then close the panel.
   *(A rename is used because it writes project settings and nothing else. If you
   cannot find a rename control, mark this test **BLOCKED**, skip to §5, and tell
   me — the fix is covered by automated tests either way.)*
5. Wait about 10 seconds. Run **LINE D**.

**Expect:** a row with `unsavedDocument: "project settings"`. Before this fix,
Line D would have said `nothing unsaved anywhere` while the write was lost.

6. Run **LINE C** → a row with `what: "project settings"`.

☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — And it goes up once uploads work
1. Fix uploads:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
2. Wait for green **Saved**, then up to 25 more seconds.
3. Run **LINE D** → `nothing unsaved anywhere`. Run **LINE C** → `queue empty`.
4. **Reload.** The project name is still `FIX5B RENAME TEST` — it reached the cloud.
5. Rename it back to its real name via **Alt+Shift+X**, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 5. Finish and clean up

1. Run **LINE E** (turns every debug switch off).
2. **Reload.**
3. Confirm: chip green, no banners, your project name is correct, no `FIX5B`
   cards are left, **LINE C** says `queue empty`, **LINE D** says `nothing
   unsaved anywhere`.

☐ Done

# 6. If a test is inconclusive

**Inconclusive is not failure.** If you lose track of which switch is on, or a
count does not match, mark it **INCONCLUSIVE**, paste the LINE C / LINE D output
and tell me. A wrong expectation in my document is more likely than a bug in
yours — that is what C2 and C3 turned out to be.

# 7. What this manual test CANNOT prove

1. **It cannot read your cloud directly.** The reload checks are strong evidence
   (the app loads from the cloud, and you confirmed nothing was pending first),
   but proof needs the Firebase console — compare the document's `revision`
   before and after.
2. **The switch fails every upload at once.** From the Console there is no way to
   fail *only* the project-settings write, so the specific fix for "a failing
   settings write no longer stops every canvas from uploading" (your D2
   observation) is **covered by automated tests only** — 14 tests that drive the
   real save code against a fake cloud, including one that fails the settings
   document alone and proves the canvas still goes up. I could not put that in
   your hands, and I am not claiming you verified it.
3. **"Gives up after 5 attempts" is not tested here.** It needs five failures
   spread over increasing delays. Covered by unit tests.
4. **A real permission or quota error may behave differently** from a simulated one.
5. **Nothing here tests two devices conflicting.** Out of scope.

# 8. Requirement coverage

| Change | Proven by |
|---|---|
| Queued entries carry no frozen copy of your data | Test 0, C2, C3 + unit tests |
| A retry sends the current content of your device | C3 (both cards survive) + automated tests |
| One queue entry per document, not per attempt | B2 |
| The queue empties without a reload | B3, C2, D2 |
| An entry is dropped, unwritten, once its document is saved | C2, C3 |
| A failed upload always marks the document unsaved | B2 (LINE A), D1 (LINE D) |
| A failing settings upload no longer stops the canvases uploading | Automated tests only — see §7.2 |
| Give up after 5 attempts, still marked unsaved | Automated tests only — see §7.3 |
| Normal editing and saving unchanged | A1, A2, A3 |

# 9. Changelog for this document

- **v1** — first issue. Written after the Fix 5 (PR #7) results, and it fixes
  three faults in that document: no baseline reading of the queue before the
  tests (B1/C1/D1 now start with one), test C3 expected a count that the code
  could never reach, and Group B set `cm-debug-slow-cloud-write` without ever
  turning it off (no test here leaves a switch set — §5 clears them all).
- The old **LINE B** is retired. **LINE C** replaces it and names the project and
  canvas instead of printing bare document types.
- Every Console line in this document was run in a real browser before it was
  written down, including the `NaN` note under LINE C.
