# Manual test — Fix 6: a View tab must write nothing (Bug 47)

Branch `fix/bug-47-reference-mode-writes`. The last fix in the agreed list.

## 1. What this fixes, in plain language

A `/view/` tab is meant to be the safe resting state: a window you can leave open
without any chance of it touching your data. Four paths ignored that.

| # | The leak | Was it actually writing? |
|---|---|---|
| 1 | The **reminder scheduler** ran its 60-second tick in a View tab and changed reminder state (when each one is next due) | **No — latent.** Two guards further away happened to block the write and hide the pop-up. It was one guard-removal away from writing project settings every minute. |
| 2 | The **retry queue** was drained by a View tab, on load and every time the browser reconnected | **Yes — into the cloud.** A read-only tab uploaded writes that belonged to the editor tab. The worst of the four. |
| 3 | **Switching canvas** in a View tab wrote the canvas you were leaving back to this device, and flushed pending cloud writes | **Yes — to local storage.** Measured: a canvas switch in a View tab rewrote `cm-ws-…`. |
| 4 | **Pin groups and reminders** were handed raw setters, so a viewer could add, rename, recolour, delete and reorder them | **Not to storage, but the panel lied.** Measured: a viewer could add a pin group, it appeared in the list, and it was silently discarded. |

### What changed

The app had a single "may I write?" gate for the *load verdict* (Fix 4) but no gate
for *what this tab is for* — reference-ness was enforced by scattered checks in
individual effects, so anything added without knowing that convention wrote from a
View tab. The mode is now folded into the gate itself, plus a named guard at each
of the four sites. The rules are a pure function (`src/writeGate.js`) with the
whole truth table under test, and it **fails closed**: only an explicit editor
session may write, so a future route is read-only until it deliberately opts in.

### Deliberately still written by a View tab

These are per-device interface preferences, not your data. They cannot corrupt
anything, and one of them (hiding card descriptions) exists *for* presenting:

- `tf-panel-width-pct` — how wide you dragged a side panel
- `tf-view-show-card-descriptions` — the Shift+D "hide descriptions" choice
- `nexus-clipboard…` — copying a card, which is exactly what a View tab is for
- `thoughtflow-tab-id` — the "open in another tab" detector, in browsers without
  BroadcastChannel

LINE X below lists these separately so you can see them and know they are expected.
**Tell me if you would rather a View tab wrote literally nothing** — it is a
one-line change each, at the cost of the viewer losing those preferences.

## 2. Before you start

| | |
|---|---|
| Where | The Vercel **preview** link on the pull request page for branch `fix/bug-47-reference-mode-writes` |
| Time | About 25 minutes |
| Data | Any real project with **at least two canvases**. Tests add and delete one card and one pin group. |
| Risk | **Low.** Nothing deletes a canvas or project. Group C makes uploads fail on purpose, then puts them back. |

**Take a fresh Export before you start** and keep it.

> **This test deliberately breaks your "never run a View tab next to an editor
> tab" rule** — that rule exists because of exactly the leaks being fixed here, so
> proving they are gone means opening both. Group C tells you when to close each
> tab. Do not skip those steps, and go back to the one-tab rule afterwards until
> this is merged.

**Opening a View tab:** the **View** button in the app header opens the canvas you
are on in a new read-only tab. Its address starts `#/view/…` instead of `#/editor/…`.

## 3. The panic line — LINE E

Lost, confused or stuck? Paste this in whichever tab, press Enter, reload:

```
(()=>{let n=0;try{n=(JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')||[]).length}catch{n='an unreadable number of'}localStorage.removeItem('cm-retry-queue');localStorage.removeItem('fix6-snapshot');['cm-debug-slow-cloud-write','cm-debug-fail-cloud-write','cm-debug-simulate-cloud-failure'].forEach(k=>localStorage.removeItem(k));return 'discarded '+n+' queued uploads, cleared the test snapshot, and turned every debug switch off - nothing on this device was deleted'})()
```

## 4. The inspection lines

**LINE A — the canvas you have open** (unchanged from Fix 5/5b):

```
(()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const pid=m.activeProjectId;const s=JSON.parse(localStorage.getItem('cm-sync-state')||'{}');const p=JSON.parse(localStorage.getItem('cm-proj-'+pid)||'{}');const urlWs=((location.hash||'').match(/\/(?:editor|view)\/[^/]+\/([^/?#]+)/)||[])[1];const wsId=urlWs||p.activeTab;const w=JSON.parse(localStorage.getItem('cm-ws-'+pid+'-'+wsId)||'{}');const st=s[pid+'/'+wsId]||{};const others=Object.entries(s).filter(([k,v])=>k.startsWith(pid+'/')&&v&&v.dirty&&k!==pid+'/'+wsId).map(([k])=>k.slice(pid.length+1));return JSON.stringify({openCanvas:(w&&w.name)||wsId,unsaved:!!st.dirty,editCounter:(st.dirtySeq===undefined?'none (nothing pending)':st.dirtySeq),cloudVersion:st.baseRev,otherUnsavedDocs:others.length?others:'none'},null,1)})()
```

**LINE C — what is waiting to be retried** (from the Fix 5b document):

```
(()=>{let q;try{q=JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')}catch{return 'the retry queue itself is unreadable (corrupt) - tell Kiro'}if(!Array.isArray(q))return 'the retry queue is not a list - tell Kiro';if(!q.length)return 'queue empty - nothing waiting to retry';const m=JSON.parse(localStorage.getItem('cm-meta')||'{}');const pn=(p)=>{try{return (JSON.parse(localStorage.getItem('cm-proj-'+p)||'{}').name)||p}catch{return p}};const wn=(p,w)=>{try{return (JSON.parse(localStorage.getItem('cm-ws-'+p+'-'+w)||'{}').name)||w}catch{return w}};const rows=q.map(e=>({what:e.type==='project'?'project settings':(e.type==='tasks'?'task list':'canvas'),project:pn(e.projectId),canvas:e.workspaceId?wn(e.projectId,e.workspaceId):'-',minutesOld:Math.round((Date.now()-(e.firstFailedAt||e.timestamp||Date.now()))/60000),triesSoFar:e.retryCount||0,isProjectImOn:e.projectId===m.activeProjectId}));return JSON.stringify({totalWaiting:q.length,rows},null,1)})()
```

**LINE S — record what is stored right now** (run this in the View tab, before the
viewer actions):

```
(()=>{const h=(s)=>{let x=0;for(let i=0;i<s.length;i++){x=((x<<5)-x+s.charCodeAt(i))|0}return x};const snap={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k==="fix6-snapshot")continue;const v=localStorage.getItem(k)||"";snap[k]=v.length+":"+h(v)}localStorage.setItem("fix6-snapshot",JSON.stringify(snap));return "recorded the state of "+Object.keys(snap).length+" stored items - now do the viewer actions, then run LINE X"})()
```

**LINE X — what changed since LINE S:**

```
(()=>{const h=(s)=>{let x=0;for(let i=0;i<s.length;i++){x=((x<<5)-x+s.charCodeAt(i))|0}return x};let before;try{before=JSON.parse(localStorage.getItem("fix6-snapshot"))}catch{before=null}if(!before)return "no snapshot found - run LINE S first";const now={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k==="fix6-snapshot")continue;const v=localStorage.getItem(k)||"";now[k]=v.length+":"+h(v)}const isData=(k)=>k.indexOf("cm-")===0;const added=Object.keys(now).filter(k=>!(k in before));const removed=Object.keys(before).filter(k=>!(k in now));const changed=Object.keys(now).filter(k=>k in before&&now[k]!==before[k]);const data=[...added.filter(isData).map(k=>"ADDED "+k),...removed.filter(isData).map(k=>"REMOVED "+k),...changed.filter(isData).map(k=>"CHANGED "+k)];const ui=[...added.filter(k=>!isData(k)).map(k=>"ADDED "+k),...removed.filter(k=>!isData(k)).map(k=>"REMOVED "+k),...changed.filter(k=>!isData(k)).map(k=>"CHANGED "+k)];return JSON.stringify({YOUR_DATA_must_be_empty:data.length?data:"nothing written - PASS",per_device_ui_prefs_allowed:ui.length?ui:"none"},null,1)})()
```

> LINE S writes one key of its own, `fix6-snapshot`. LINE X ignores it, and LINE E
> removes it.

---

## Test 0 — am I on the Fix 6 build?

1. Open the preview link. Wait for it to load. Click **View** in the header — a
   new read-only tab opens (address contains `#/view/`).
2. In that **View tab**: open the sidebar (press **S**), click **Pins**.
3. In the Pins panel click the **layers** icon (title "Manage Groups").
4. Type `FIX6 TEST GROUP` in "New group name…" and click **Add**.

| What happens | Meaning |
|---|---|
| **Nothing.** No new group appears in the list or the "All Groups" dropdown. | ✅ **Fix 6 build.** Continue. |
| The group appears in the list | ❌ Older build — the preview hasn't updated. Stop and tell me. |

5. Leave the View tab open; you need it for Group B.

**Result: ☐ Fix 6 ☐ Older build — stop**

---

# GROUP A — the editor must be completely unaffected

Do all of this in the **editor** tab.

## A1 — Opens and saves normally
1. Add a card titled `FIX6 A1`.
2. Chip: **Unsaved changes** → **Syncing…** → green **Saved**.
3. Reload. The card is still there.

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — Canvas switching still saves
1. Run **LINE A**, note `cloudVersion`.
2. Move a card slightly, then immediately switch to another canvas and back.
3. Wait for green. Run **LINE A** → `unsaved: false`, and the card kept its new
   position.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — Pin groups still work in the editor
1. Sidebar (**S**) → **Pins** → layers icon → type `FIX6 A3` → **Add**.
2. The group appears in the list and in the "All Groups" dropdown.
3. Reload. **The group is still there** (it was saved).
4. Delete the group again, wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

## A4 — Reminders still work in the editor
1. Sidebar → **Reminders** (or press **R**). Toggle one reminder off and on again.
2. It responds, and after a reload it is in the state you left it.
3. **Then turn reminders back off** — your standing rule.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — the View tab writes nothing

Do all of this in the **View tab** from Test 0.

## B1 — Record the starting state
1. Run **LINE S**.

**Expect:** `recorded the state of N stored items …`

☐ Ready

## B2 — Behave like a viewer for two minutes
In the View tab:

1. **Switch canvas** using the header dropdown. Switch to a second canvas, then
   back. *(This is leak 3 — measured writing `cm-ws-…` before this fix.)*
2. Press **S** for the sidebar, open **Pins**, open the group manager, try to add a
   group `FIX6 B2` (nothing should happen).
3. Open **Reminders** (**R**), try toggling one on (nothing should happen).
4. Copy a card: click one, press **Ctrl+C**. *(Copying is meant to work.)*
5. Drag a panel edge to resize it. *(A per-device preference — expected to be saved.)*
6. Now **wait 90 seconds without touching anything.** This crosses the 60-second
   reminder tick (leak 1) and several 20-second heartbeats.

☐ Done

## B3 — The verdict
1. Run **LINE X**.

**Expect exactly:**
```
"YOUR_DATA_must_be_empty": "nothing written - PASS"
```
`per_device_ui_prefs_allowed` may list `tf-panel-width-pct`, `nexus-clipboard`,
`tf-view-show-card-descriptions` or `thoughtflow-tab-id` — all expected (§1).

**If anything appears under `YOUR_DATA_must_be_empty`, paste it to me — that is a
leak I have not found.**

☐ PASS ☐ FAIL ☐ BLOCKED

## B4 — Reminders never fire at a viewer
1. Still in the View tab: did any reminder pop-up appear during B2's 90 seconds?

**Expect:** none.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — a View tab must not upload the editor's failed writes

> This is leak 2, the one that reached the cloud, and the only test that needs your
> real Firebase — I cannot reproduce it in a sandbox, because a sandbox has no
> working cloud to upload to. Read the whole group before starting.

## C1 — Create some queued failed writes (editor tab)
1. In the **editor** tab, run **LINE E**, then **reload**.
2. Confirm **LINE C** says `queue empty`.
3. Break uploads:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
4. Add a card titled `FIX6 C1`. Wait about 10 seconds.
5. Run **LINE C**. **Write down `totalWaiting` and the `triesSoFar` numbers.**

**totalWaiting = __________   triesSoFar = __________**

☐ Ready

## C2 — Hand the browser over to the View tab only
1. Still in the editor tab, click **View** to open a fresh View tab (or reuse the
   one from Group B — reload it).
2. **Close the editor tab.** From here only the View tab is running, so anything
   that happens to the queue was done by the View tab.
3. In the View tab, **reload the page** (loading is when the old build drained the
   queue) and then **wait 90 seconds**.

☐ Done

## C3 — The verdict
1. In the **View tab**, run **LINE C**.

**Expect:** `totalWaiting` **and** every `triesSoFar` **exactly as you wrote them
down in C1.** Unchanged means the View tab never attempted a single upload.

On the previous build the View tab would have tried on load and again on
reconnect, so `triesSoFar` would have climbed (and entries would eventually
disappear as the app gave up).

**totalWaiting now = __________   triesSoFar now = __________**

☐ PASS ☐ FAIL ☐ BLOCKED

## C4 — Put everything back
1. **Close the View tab.**
2. Open the app normally (editor). Run:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
3. Wait for green **Saved**, then up to 25 more seconds. **LINE C** → `queue empty`.
4. Delete the `FIX6 C1` card (and `FIX6 A1` if still present), wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — the View tab must still be useful

Open a View tab again (header **View** button).

## D1 — Reading and navigating all work
1. Switch between canvases — works, and the address stays `#/view/…`.
2. Pan and zoom — work.
3. Open the Data Health panel and use a "jump to card" row — it moves the view.
4. Shift+D hides/shows card descriptions.
5. Copy a card with **Ctrl+C**, switch to the editor tab later and paste it — the
   copy still works.

☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — Editing is refused, quietly
1. Try to drag a card — it does not move (or snaps back), and nothing is saved.
2. There is no Import, Partial import or Sync-to-Server button in the sidebar.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 5. Finish and clean up

1. **Close every View tab.**
2. In the editor: run **LINE E**, reload.
3. Confirm: chip green, no `FIX6` cards or groups left, **LINE C** says
   `queue empty`, reminders off.

☐ Done

# 6. If a test is inconclusive

Mark it **INCONCLUSIVE** and tell me what you saw. Group C in particular depends
on tab timing; if you are unsure whether the editor tab was really closed, say so
rather than guessing — a false PASS there is worse than no result.

# 7. What this manual test CANNOT prove

1. **It cannot read your cloud directly.** Group C infers "no upload happened"
   from the retry queue not advancing. That is strong (the queue only advances when
   an upload is attempted), but proof needs the Firebase console.
2. **I could not test leak 2 in the sandbox at all.** With no working cloud the
   app switches to local-only mode, where uploads are blocked for a different
   reason, so the code path cannot be reached. Group C is the only real evidence
   for it, and it is entirely in your hands. What I *can* say is that the guard is
   the first line of the effect and is covered by the unit-tested gate.
3. **Leak 1 has no visible symptom to check.** Reminder pop-ups were already
   hidden in a View tab by a separate guard, and the state it changed was never
   saved — so "no pop-up in B4" is consistent with both builds. The fix stops the
   scheduler running at all, which is verified by code and by 24 tests of the gate,
   not by anything you can see. I am not claiming B4 proves it.
4. **A View tab still writes the four per-device preferences in §1.** By choice,
   not by accident. If you want literally zero writes, say so.
5. **Nothing here tests two devices**, or a `/shared/` route (which does not exist
   yet — the gate treats it as read-only in advance).

# 8. Requirement coverage

| Change | Proven by |
|---|---|
| Leak 3: canvas switch writes nothing in a View tab | B2 + B3 (**differential measured in a real browser**: the old build rewrote `cm-ws-…`, this build writes nothing) |
| Leak 4: pin groups / reminders cannot be changed by a viewer | Test 0, B2, B3 (**differential measured**: old build added the group, this build does not) |
| Leak 2: retry queue is never drained by a View tab | **C1–C3 only** — see §7.2 |
| Leak 1: reminder scheduler does not run in a View tab | Code + unit tests only — see §7.3 |
| The gate itself (mode + load outcome, fails closed) | 24 unit tests, full truth table |
| The editor is unaffected | A1–A4 (and the same differential script confirmed an editor tab still writes `cm-ws-…`, `cm-proj-…` on a canvas switch, and still saves a new pin group) |
| A View tab is still usable | D1, D2 |

# 9. Changelog for this document

- **v1** — first issue. Written after Fix 5b was merged. Carries forward the
  lessons from earlier rounds: a baseline reading before anything is counted
  (B1, C1), every switch turned off inside the group that set it (C4, §5), no
  "turn off Wi-Fi" step, and every Console line run in a real browser before being
  written down — LINE S and LINE X were checked against no-snapshot, nothing-changed,
  something-changed and something-removed cases.
