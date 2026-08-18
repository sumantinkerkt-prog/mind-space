# Manual test — Fix 6: a View tab must not change anything

Branch `fix/bug-47-reference-mode-writes`. This is the last fix in the list of six.

---

## 1. What this fix is about, in plain words

You have two kinds of tab:

- An **editor tab** — the normal app. Its address contains `#/editor/`. You can
  change things here, and it saves them.
- A **View tab** — opened with the **View** button in the top bar. It opens in a new
  browser tab and its address contains `#/view/`. It is meant to be a window you
  can look through and leave open, and it should **never change anything**.

The point of a View tab is that it is a safe place to leave the app sitting. If it
can still save things behind your back, it is not safe, and the habit we built
around it ("keep a View tab open instead of an editor tab") does not protect you.

I found four places where a View tab still did something it should not.

| What was happening | How bad was it, honestly |
|---|---|
| **Uploads.** A View tab picked up uploads that had failed earlier in your editor tab and sent them to the cloud itself. | **This one was real and it reached your cloud.** It is the reason for Group C below. |
| **Switching canvas.** Moving to another canvas in a View tab saved the canvas you were leaving back onto your computer. | **Real.** I measured it: the stored copy of the canvas changed. |
| **Pin groups and reminders.** A viewer could add, rename, recolour or delete a pin group, and switch reminders on and off. | **It never reached storage — but the panel pretended it worked.** You would add a group, watch it appear, and lose it on reload. |
| **The reminder timer** kept running every 60 seconds in a View tab and quietly changed when each reminder was next due. | **Nothing was actually saved**, because two other checks happened to stop it. But it was one small change away from writing to your project every minute. |

All four are now blocked. Alongside that I fixed the underlying cause: the app had
one place that asked "is it safe to save right now?", but that question only
considered whether your data had loaded properly — it never considered whether this
tab was a View tab. That is now part of the same question, so a path added in
future cannot forget it.

### Things a View tab is still allowed to change

Four small things. None of them is your project data — they are settings for this
browser only, and they cannot damage anything:

- how wide you dragged a side panel
- whether card descriptions are hidden (the Shift+D setting, which exists for
  presenting)
- the clipboard, when you copy a card — copying out of a View tab is the whole point
  of having one
- a marker some browsers use to notice that the app is open in more than one tab

The check in Group B lists these separately, so when you see them you know they are
expected and not a problem. **If you would rather a View tab changed literally
nothing at all, say so** — each one is a one-line change, and the only cost is that
a viewer loses those preferences.

---

## 2. Before you start

| | |
|---|---|
| **Where** | The **Preview** link on the pull request page for this branch (the `vercel` comment at the bottom of PR #9) — same as last time |
| **How long** | About 25 minutes |
| **What you need** | A project with **at least two canvases** |
| **What it touches** | Adds and deletes one card and one pin group. Nothing is deleted permanently. |
| **Risk** | Low. Group C makes uploads fail on purpose, then puts them back. |

**Take a fresh Export before you start** and keep the file.

**Opening the Console:** press **F12**, then click the **Console** tab. That is
where you paste the lines below. Each line is one paste, then Enter.

### Two things to know before you begin

**1. This build still has both buttons.** The top bar shows **Preview** and **View**.
Use **View** — the one that opens a new browser tab. (Preview is removed by the
next change, PR #10. Ignore it here.)

**2. This test asks you to have an editor tab and a View tab open at the same time.**
That goes against the habit we agreed earlier — but that habit exists *because* of
the leaks being fixed here, so the only way to check they are gone is to do the
thing that used to be unsafe. Group C tells you exactly when to close which tab.
Once this is merged, having both open is fine.

---

## 3. If you get lost — the reset line

Paste this into the Console of whichever tab you are in, press Enter, then reload
the page. It is safe to run at any time, in any tab.

```
(()=>{let n=0;try{n=(JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')||[]).length}catch{n='an unreadable number of'}localStorage.removeItem('cm-retry-queue');localStorage.removeItem('fix6-snapshot');['cm-debug-slow-cloud-write','cm-debug-fail-cloud-write','cm-debug-simulate-cloud-failure'].forEach(k=>localStorage.removeItem(k));return 'discarded '+n+' queued uploads, cleared the test snapshot, and turned every debug switch off - nothing on this device was deleted'})()
```

It clears the list of uploads waiting to be retried, removes the note this test
keeps, and switches off the three testing switches. It does not delete any of your
work. I will call this **the reset line**.

---

## 4. The four lines you will paste

You do not need to understand them. Each one just reports something.

**LINE A — what is happening with the canvas you are looking at.** Tells you the
canvas name, whether anything is waiting to be saved, and how many times that
canvas has been saved to the cloud.

```
(()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const pid=m.activeProjectId;const s=JSON.parse(localStorage.getItem('cm-sync-state')||'{}');const p=JSON.parse(localStorage.getItem('cm-proj-'+pid)||'{}');const urlWs=((location.hash||'').match(/\/(?:editor|view)\/[^/]+\/([^/?#]+)/)||[])[1];const wsId=urlWs||p.activeTab;const w=JSON.parse(localStorage.getItem('cm-ws-'+pid+'-'+wsId)||'{}');const st=s[pid+'/'+wsId]||{};const others=Object.entries(s).filter(([k,v])=>k.startsWith(pid+'/')&&v&&v.dirty&&k!==pid+'/'+wsId).map(([k])=>k.slice(pid.length+1));return JSON.stringify({openCanvas:(w&&w.name)||wsId,unsaved:!!st.dirty,editCounter:(st.dirtySeq===undefined?'none (nothing pending)':st.dirtySeq),cloudVersion:st.baseRev,otherUnsavedDocs:others.length?others:'none'},null,1)})()
```

**LINE C — uploads that failed and are waiting to be tried again.** Same line you
used last time. `totalWaiting` is how many are waiting. `triesSoFar` is how many
times the app has tried each one.

```
(()=>{let q;try{q=JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')}catch{return 'the retry queue itself is unreadable (corrupt) - tell Kiro'}if(!Array.isArray(q))return 'the retry queue is not a list - tell Kiro';if(!q.length)return 'queue empty - nothing waiting to retry';const m=JSON.parse(localStorage.getItem('cm-meta')||'{}');const pn=(p)=>{try{return (JSON.parse(localStorage.getItem('cm-proj-'+p)||'{}').name)||p}catch{return p}};const wn=(p,w)=>{try{return (JSON.parse(localStorage.getItem('cm-ws-'+p+'-'+w)||'{}').name)||w}catch{return w}};const rows=q.map(e=>({what:e.type==='project'?'project settings':(e.type==='tasks'?'task list':'canvas'),project:pn(e.projectId),canvas:e.workspaceId?wn(e.projectId,e.workspaceId):'-',minutesOld:Math.round((Date.now()-(e.firstFailedAt||e.timestamp||Date.now()))/60000),triesSoFar:e.retryCount||0,isProjectImOn:e.projectId===m.activeProjectId}));return JSON.stringify({totalWaiting:q.length,rows},null,1)})()
```

**LINE S — "remember how everything looks right now".** Takes a note of every piece
of stored data, so LINE X can tell you afterwards what changed. It does not change
any of your data; it only writes its own note.

```
(()=>{const h=(s)=>{let x=0;for(let i=0;i<s.length;i++){x=((x<<5)-x+s.charCodeAt(i))|0}return x};const snap={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k==="fix6-snapshot")continue;const v=localStorage.getItem(k)||"";snap[k]=v.length+":"+h(v)}localStorage.setItem("fix6-snapshot",JSON.stringify(snap));return "recorded the state of "+Object.keys(snap).length+" stored items - now do the viewer actions, then run LINE X"})()
```

**LINE X — "what changed since I said remember".** This is the answer to the whole
of Group B.

```
(()=>{const h=(s)=>{let x=0;for(let i=0;i<s.length;i++){x=((x<<5)-x+s.charCodeAt(i))|0}return x};let before;try{before=JSON.parse(localStorage.getItem("fix6-snapshot"))}catch{before=null}if(!before)return "no snapshot found - run LINE S first";const now={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k==="fix6-snapshot")continue;const v=localStorage.getItem(k)||"";now[k]=v.length+":"+h(v)}const isData=(k)=>k.indexOf("cm-")===0;const added=Object.keys(now).filter(k=>!(k in before));const removed=Object.keys(before).filter(k=>!(k in now));const changed=Object.keys(now).filter(k=>k in before&&now[k]!==before[k]);const data=[...added.filter(isData).map(k=>"ADDED "+k),...removed.filter(isData).map(k=>"REMOVED "+k),...changed.filter(isData).map(k=>"CHANGED "+k)];const ui=[...added.filter(k=>!isData(k)).map(k=>"ADDED "+k),...removed.filter(k=>!isData(k)).map(k=>"REMOVED "+k),...changed.filter(k=>!isData(k)).map(k=>"CHANGED "+k)];return JSON.stringify({YOUR_DATA_must_be_empty:data.length?data:"nothing written - PASS",per_device_ui_prefs_allowed:ui.length?ui:"none"},null,1)})()
```

LINE X answers in two parts:

- **`YOUR_DATA_must_be_empty`** — anything here means a View tab changed your
  project data. This must say `nothing written - PASS`.
- **`per_device_ui_prefs_allowed`** — the harmless browser settings listed in §1.
  Anything here is fine and expected.

---

## Test 0 — am I testing the right build?

Two minutes, and it saves you doing 25 minutes of work on the wrong version.

1. Open the Preview link and wait for your project to appear.
2. Click **View** in the top bar. A new browser tab opens. Check its address
   contains `#/view/`.
3. In that **View tab**, press the **S** key. The sidebar appears on the left.
4. Click **Pins** in the sidebar. The Pins panel opens on the right.
5. In the Pins panel, click the small **stacked-layers icon** (hover it — the
   tooltip says "Manage Groups"). A box appears with "New group name…".
6. Type `FIX6 TEST GROUP` and click **Add**.

| What happens | What it means |
|---|---|
| **Nothing happens.** No new group appears in the list, and `FIX6 TEST GROUP` is not in the "All Groups" dropdown. | ✅ You are on the right build. Carry on. |
| The group appears | ❌ You are on an older build — the Preview link has not updated. Stop and tell me. |

7. Keep this View tab open. Group B uses it.

**Result: ☐ Right build ☐ Older build — stopped**

---

# GROUP A — the editor must work exactly as before

Everything in this group happens in the **editor tab** (address contains
`#/editor/`). The point of Group A is to prove I have not broken normal use while
locking down the View tab.

## A1 — Adding a card still saves
1. Add a card and title it `FIX6 A1`.
2. Watch the small status chip in the top bar. It should go
   **Unsaved changes** → **Syncing…** → green **Saved**.
   (It is normal for it to dip back to "Unsaved changes" once on the way. That is a
   second thing finishing its own save.)
3. Reload the page. `FIX6 A1` is still there.

**Expected:** the card saves and survives a reload.

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — Switching canvas still saves your work
1. Paste **LINE A**. Write down the number next to `cloudVersion`.
2. Drag a card a short distance.
3. Straight away — without waiting — switch to another canvas, then switch back.
4. Wait for the chip to go green **Saved**.
5. Paste **LINE A** again.

**Expected:** the card stayed where you dragged it, and `unsaved` says `false`.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — Pin groups still work in the editor
This is the same action as Test 0, but in the editor, where it *should* work.

1. Press **S** for the sidebar, click **Pins**, click the **Manage Groups** icon.
2. Type `FIX6 A3` and click **Add**.
3. The group appears in the list and in the "All Groups" dropdown.
4. Reload the page. **The group is still there** — which means it was really saved.
5. Delete the group again (the controls are on the group's own row), and wait for
   the chip to go green.

**Expected:** in the editor you can add a group, it survives a reload, and you can
remove it again.

☐ PASS ☐ FAIL ☐ BLOCKED

## A4 — Reminders still work in the editor
I changed how reminder switches are handled, so this checks I did not break them
for the editor.

1. Press **S** for the sidebar and click **Reminders** (or just press **R**).
2. Switch one reminder **off**, then **on** again. It should respond both times.
3. Reload the page. The reminder is in whatever state you left it — so the change
   was really saved.
4. **Now switch that reminder off again before you move on.**

**Why step 4:** reminders themselves are still buggy — they fire at the wrong
times, some never fire at all, and they cause pointless cloud writes. We agreed a
while ago to keep all reminders switched **off** until those bugs are fixed, and
none of them is fixed yet. This test needs you to click a reminder switch, so
please put it back off afterwards.

**Expected:** the switch responds, the change survives a reload, and you leave all
reminders off.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — the View tab must not change anything

Everything in this group happens in the **View tab** you opened in Test 0.

## B1 — Take the "before" note
1. In the View tab, paste **LINE S**.

**Expected:** `recorded the state of N stored items …` (N will be some number).

☐ Ready

## B2 — Now behave like someone reading, for about two minutes
Still in the View tab, do all of these:

1. **Switch canvas** using the canvas name dropdown at the top: go to a second
   canvas, then come back.
   *(Before this fix, this quietly rewrote the canvas you left.)*
2. Press **S**, click **Pins**, open **Manage Groups**, and try to add a group
   called `FIX6 B2`. **Nothing should happen** — that is correct here.
3. Press **R** for Reminders and try switching one on. **Nothing should happen** —
   also correct.
4. Click a card and press **Ctrl+C** to copy it. *(This one is supposed to work.)*
5. Drag the left edge of the open panel to make it wider. *(Allowed — it is a
   browser setting, see §1.)*
6. **Now leave it completely alone for 90 seconds.** Do not click anything. This
   matters: it lets the 60-second reminder timer come round, plus several of the
   app's 20-second background checks. Those background jobs were two of the four
   leaks.

☐ Done

## B3 — Read the answer
1. Paste **LINE X**.

**Expected — the important line:**

```
"YOUR_DATA_must_be_empty": "nothing written - PASS"
```

`per_device_ui_prefs_allowed` may list one or more of the harmless browser settings
from §1 (panel width, clipboard, descriptions, tab marker). That is fine.

**If anything at all is listed under `YOUR_DATA_must_be_empty`, copy the whole
output and send it to me.** That would be a leak I have not found.

☐ PASS ☐ FAIL ☐ BLOCKED

## B4 — No reminder pop-ups at a viewer
1. Think back over the 90 seconds in B2: did any reminder pop-up appear in the View
   tab?

**Expected:** none.

*(Being straight with you: this one is a weak check. Reminder pop-ups were already
hidden in View tabs by an older piece of code, so "no pop-up" would also have been
true before my fix. It is worth noting, but it does not prove anything on its own —
see §7.)*

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — a View tab must not upload your editor's failed uploads

This is the one leak that genuinely reached your cloud, and **this group is the only
real test of it** — I could not reproduce it in my sandbox, because my sandbox has
no working cloud to upload to.

**The idea:** we make some uploads fail on purpose in the editor tab, so they pile
up in a waiting list. Then we close the editor tab, leaving only a View tab running,
and check that the waiting list does not move. If the View tab were still uploading,
the "tries so far" numbers would climb.

**Read the whole group before starting.**

## C1 — Make some uploads fail, in the editor tab
1. In the **editor tab**, paste the **reset line** (§3), then reload the page.
2. Paste **LINE C**. It must say `queue empty - nothing waiting to retry`.
   If it does not, run the reset line again and reload.
3. Paste this to make uploads fail on purpose:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
4. Add a card and title it `FIX6 C1`. Wait about 10 seconds.
5. Paste **LINE C**. **Write down both numbers:**

**`totalWaiting` = __________   `triesSoFar` = __________**

*(The card itself is safe — it is saved on your computer, and it will upload
properly in step C4.)*

☐ Ready

## C2 — Leave only the View tab running
1. Still in the editor tab, click **View** to open a fresh View tab. (If you still
   have the one from Group B, reload it instead.)
2. **Close the editor tab.** This is the important step: from now on, only the View
   tab is running, so anything that happens to the waiting list was done by the View
   tab.
3. In the View tab, **reload the page**. Loading is exactly when the old version
   emptied the list.
4. **Wait 90 seconds**, doing nothing.

☐ Done

## C3 — Read the answer
1. In the **View tab**, paste **LINE C**.

**Expected:** `totalWaiting` and every `triesSoFar` are **exactly the numbers you
wrote down in C1**. Unchanged means the View tab never tried to upload anything.

If they went up, the View tab tried to upload — which is the bug, and I want to know.

**`totalWaiting` now = __________   `triesSoFar` now = __________**

☐ PASS ☐ FAIL ☐ BLOCKED

## C4 — Put everything back
1. **Close the View tab.**
2. Open the app normally (an editor tab) and paste:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
3. Wait for the chip to go green **Saved**, then wait about another 25 seconds.
4. Paste **LINE C**. It should now say `queue empty` — the uploads that had failed
   have gone through.
5. Delete the card `FIX6 C1` (and `FIX6 A1` if it is still there). Wait for green.

**Expected:** the waiting list empties by itself and your test cards are gone.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — the View tab must still be worth having

Open a View tab again with the **View** button. Blocking writes is no good if it
also breaks reading.

## D1 — Everything a viewer needs still works
In the View tab, check each of these:

1. Switching between canvases works, and the address still contains `#/view/`.
2. Panning and zooming work.
3. Opening the Data Health panel and clicking a "jump to card" row moves the view to
   that card.
4. **Shift+D** hides card descriptions, and again shows them.
5. Copy a card with **Ctrl+C**. Then, in an editor tab, paste it — the copy worked.

☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — Editing is refused, without fuss
1. Try to drag a card. It should not move, or should snap back — and nothing is
   saved.
2. Look at the sidebar: there is no **Import**, no **Partial** and no
   **Sync to Server** button.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 5. Finish up

1. **Close every View tab.**
2. In the editor tab, paste the **reset line** (§3) and reload.
3. Check: chip is green, no `FIX6` cards or groups are left, **LINE C** says
   `queue empty`, and all reminders are off.

☐ Done

---

# 6. If you are not sure about a result

Write **INCONCLUSIVE** and tell me what you saw. Please do not guess a PASS. In
Group C especially — if you are not certain the editor tab was really closed, say
so, because a wrong PASS there hides the one leak that reached your cloud.

The last two rounds both had mistakes in *my* documents rather than in the app, so
"this step does not make sense" is useful information, not a failure on your part.

---

# 7. What this test cannot prove

I would rather list these than let the ticks look stronger than they are.

1. **It cannot look inside your cloud.** Group C works out "no upload happened" from
   the waiting list not moving. That is good evidence, because the list only moves
   when an upload is attempted — but real proof would mean checking the Firebase
   console.
2. **I could not test the upload leak at all in my sandbox.** With no working cloud,
   the app goes into offline mode, where uploads are blocked for a completely
   different reason — so the code in question never runs there, on either version.
   **Group C is the only real evidence for it, and it is entirely in your hands.**
3. **The reminder-timer leak has nothing visible to check** (see B4). Pop-ups were
   already hidden in a View tab by other code, and what the timer changed was never
   saved. That fix rests on the code change and on automated tests, not on anything
   you can see. I am not claiming B4 proves it.
4. **A View tab still changes the four browser settings in §1.** On purpose, not by
   accident.
5. **Nothing here tests two devices at once.**

**What I did verify myself:** I wrote one browser script and ran it twice — once
against the current app and once against this fix. On the current app, a View tab
switching canvas **changed the stored copy of the canvas**, and a viewer **could add
a pin group**. With this fix, nothing was written at all and the group does not
appear. An editor tab behaved identically in both runs. That is what tells me the
checks above can actually detect the problem, rather than passing because they are
looking in the wrong place.

---

# 8. Which test covers which fix

| The fix | Proven by |
|---|---|
| Switching canvas in a View tab saves nothing | B2 + B3 (and my before/after browser run) |
| A viewer cannot change pin groups or reminders | Test 0, B2, B3 (and my before/after browser run) |
| A View tab never uploads your editor's failed uploads | **Group C only** — see §7.2 |
| The reminder timer does not run in a View tab | Code and automated tests only — see §7.3 |
| The underlying "is it safe to save?" rule | 24 automated tests |
| The editor still works normally | A1, A2, A3, A4 |
| A View tab is still useful | D1, D2 |

---

# 9. Changes to this document

- **v2** — rewritten in plainer language at the owner's request. No new tests and
  no changed expectations; only the wording. In particular A4 used to end "your
  standing rule", which assumed you remembered a conversation from weeks ago — it
  now says what the rule is and why it exists. Also added: how to open the Console,
  a note that this build still shows both **Preview** and **View** buttons (use
  View; Preview is removed by PR #10), a plain-English explanation of what each
  pasted line reports, and an honest note on B4 being a weak check.
- **v1** — first issue, after Fix 5b was merged. Carries forward the lessons from
  earlier rounds: take a "before" reading before counting anything (B1, C1), switch
  off anything a group switched on inside that same group (C4, §5), no "turn off
  Wi-Fi" steps, and every pasted line run in a real browser before it went into the
  document — LINE S and LINE X were checked with no note taken, with nothing
  changed, with something changed, and with something removed.
