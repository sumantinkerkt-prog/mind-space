# Test for Fix 6 — a View tab must not change anything

Branch: `fix/bug-47-reference-mode-writes` (pull request #9). This is the last of
the six fixes.

**About reminders: you do not need to touch reminders anywhere in this test.**
There is no reminder step. I removed it. I tested that part myself instead. See
section 10 for what I found out about your missing reminders.

---

## 1. Words I use in this test

| Word | What it means |
|---|---|
| **editor tab** | The normal app, where you work. Look at the web address: it has `#/editor/` in it. |
| **View tab** | A read-only window on the same data. You open it with the **View** button in the top bar. It opens a new browser tab. Its address has `#/view/` in it. |
| **the chip** | The small coloured badge in the top bar that says **Saved**, **Syncing…** or **Unsaved changes**. |
| **the Console** | A box where you can paste a line of text and press Enter. To open it: press **F12**, then click **Console**. |
| **a line** | One of the four blocks of text in section 5. You copy it, paste it in the Console, press Enter, and it prints an answer. It does not change your work. |

---

## 2. What this fix does

You told me the model you want, and it is simpler than what the code had grown into:

- **Editor and server talk both ways.** The editor asks for the latest data, works
  on it, and sends it back. The server keeps the latest version.
- **Viewer and server talk one way only.** The viewer asks for the data, gets a
  copy, and that is the end of it. To see newer data it asks again — that is what a
  reload is. The server never takes anything back from a viewer.

That is now how it works. "Load a copy and disconnect."

### Why my first attempt failed your test

You found two things I had not. You were right both times.

My first attempt put a "do not write" check in front of each place that writes —
about forty of them, spread through the app. Your Group B result showed that was not
enough: four canvases and other data still changed. Loading alone writes data from
about a dozen places, and I had missed some.

So I moved the rule. There is now **one gate**, inside the single file that owns all
storage. Every save in the app goes through that file. If a viewer's save is refused
there, no other part of the app can leak, because there is no other door. If a new
feature is added next year, it cannot forget the rule, because it does not get a
choice.

This is the change you asked for. It is also **less** code than chasing the call
sites: one gate, 24 refusals, and a test that checks every single one.

### Local saving counts as saving, too

One thing worth adding to your model. You said the viewer can make local or
temporary changes as long as nothing reaches the server. Almost — with one catch.

This app's local storage is **not private to the tab**. An editor tab on the same
computer reads the same local data and uploads it. So something saved "only locally"
by a viewer can still reach the server later, through the editor. That is how your
four canvases could have travelled.

So the viewer saves nothing at all — not to the server, not locally.
Things that live only in memory are still yours to play with: panning, zooming,
hiding descriptions, copying a card. Those are private to the tab and stay allowed.

### Four small things a View tab still writes

None of these is your project data. They are settings for this browser only, and
they never go to the server.

1. How wide you dragged a side panel.
2. Whether card descriptions are hidden (the **Shift+D** setting, made for
   presenting).
3. The clipboard, when you copy a card. Copying out is the main reason for a View tab.
4. A small marker some browsers use to notice the app is open twice.

The check in Group B lists these on their own line, so when you see them you know
they are fine.

**If you want a View tab to write nothing whatsoever, tell me.** Each is a one-line
change.

---

## 3. Before you start

| | |
|---|---|
| **Where** | Open pull request #9 on GitHub. Scroll to the bottom. In the `vercel` comment, click **Preview**. Same as last time. |
| **How long** | About 20 minutes. |
| **What you need** | A project with **two or more canvases**. |
| **What it changes** | It adds one card and one pin group, and deletes them again at the end. |
| **How risky** | Low. Group C makes uploads fail on purpose, then turns them back on. |

**Make a fresh Export first** and keep the file.

### Two things to know before you begin

**1. This build still has two buttons: Preview and View.**
Use **View**. It is the one that opens a new browser tab.
Ignore **Preview**. The next change (pull request #10) removes it.

**2. Only one tab runs at a time in this test.** Groups B and C tell you to close
the editor tab before letting the View tab run. That is deliberate: last time both
tabs were open, and the editor tab's normal background saving got blamed on the View
tab. Two of your FAILs came from that. Please follow the close-the-tab steps exactly
— they are what make the answer trustworthy.

---

## 4. If you get lost — the reset line

Paste this in the Console of any tab, press Enter, then reload the page.

```
(()=>{let n=0;try{n=(JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')||[]).length}catch{n='an unreadable number of'}localStorage.removeItem('cm-retry-queue');localStorage.removeItem('fix6-snapshot');['cm-debug-slow-cloud-write','cm-debug-fail-cloud-write','cm-debug-simulate-cloud-failure'].forEach(k=>localStorage.removeItem(k));return 'discarded '+n+' queued uploads, cleared the test snapshot, and turned every debug switch off - nothing on this device was deleted'})()
```

It switches off the three test switches and clears the list of waiting uploads.
It does not delete any of your work. Safe to run at any time.

I call this **the reset line**.

---

## 5. The five lines you will paste

You do not need to understand them. Each one prints an answer. None of them
changes your work.

**LINE A — how is the canvas I am looking at doing?**
It prints the canvas name, whether anything is still waiting to be saved, and how
many times that canvas has been saved to the cloud.

```
(()=>{const m=JSON.parse(localStorage.getItem('cm-meta'));const pid=m.activeProjectId;const s=JSON.parse(localStorage.getItem('cm-sync-state')||'{}');const p=JSON.parse(localStorage.getItem('cm-proj-'+pid)||'{}');const urlWs=((location.hash||'').match(/\/(?:editor|view)\/[^/]+\/([^/?#]+)/)||[])[1];const wsId=urlWs||p.activeTab;const w=JSON.parse(localStorage.getItem('cm-ws-'+pid+'-'+wsId)||'{}');const st=s[pid+'/'+wsId]||{};const others=Object.entries(s).filter(([k,v])=>k.startsWith(pid+'/')&&v&&v.dirty&&k!==pid+'/'+wsId).map(([k])=>k.slice(pid.length+1));return JSON.stringify({openCanvas:(w&&w.name)||wsId,unsaved:!!st.dirty,editCounter:(st.dirtySeq===undefined?'none (nothing pending)':st.dirtySeq),cloudVersion:st.baseRev,otherUnsavedDocs:others.length?others:'none'},null,1)})()
```

**LINE C — which uploads failed and are waiting to be tried again?**
The same line you used last time. Two numbers matter:
`totalWaiting` = how many are waiting. `triesSoFar` = how many times the app has
tried each one.

```
(()=>{let q;try{q=JSON.parse(localStorage.getItem('cm-retry-queue')||'[]')}catch{return 'the retry queue itself is unreadable (corrupt) - tell Kiro'}if(!Array.isArray(q))return 'the retry queue is not a list - tell Kiro';if(!q.length)return 'queue empty - nothing waiting to retry';const m=JSON.parse(localStorage.getItem('cm-meta')||'{}');const pn=(p)=>{try{return (JSON.parse(localStorage.getItem('cm-proj-'+p)||'{}').name)||p}catch{return p}};const wn=(p,w)=>{try{return (JSON.parse(localStorage.getItem('cm-ws-'+p+'-'+w)||'{}').name)||w}catch{return w}};const rows=q.map(e=>({what:e.type==='project'?'project settings':(e.type==='tasks'?'task list':'canvas'),project:pn(e.projectId),canvas:e.workspaceId?wn(e.projectId,e.workspaceId):'-',minutesOld:Math.round((Date.now()-(e.firstFailedAt||e.timestamp||Date.now()))/60000),triesSoFar:e.retryCount||0,isProjectImOn:e.projectId===m.activeProjectId}));return JSON.stringify({totalWaiting:q.length,rows},null,1)})()
```

**LINE P — what kind of tab am I in?**
Ask the app directly. `thisTabIs` says `editor` or `viewer`. `willRefuseAllWrites`
says whether this tab will refuse to save anything. `writesItHasRefused` lists any
save it has already blocked — so if the app ever *tries* to save from a View tab,
this is where you will see it.

```
(()=>{try{const p=window.mindspace.probe();return JSON.stringify({thisTabIs:p.role,willRefuseAllWrites:p.wouldBlockWrites,writesItHasRefused:p.refusedSoFar.length?p.refusedSoFar:"none so far"},null,1)}catch(e){return "This build does not have the check - tell Kiro ("+e.message+")"}})()
```

**LINE S — "remember how everything looks right now".**
Run this **before** you start clicking in the View tab. It writes down a note about
every piece of stored data. It writes its own note only. It does not change your
data.

```
(()=>{const h=(s)=>{let x=0;for(let i=0;i<s.length;i++){x=((x<<5)-x+s.charCodeAt(i))|0}return x};const snap={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k==="fix6-snapshot")continue;const v=localStorage.getItem(k)||"";snap[k]=v.length+":"+h(v)}localStorage.setItem("fix6-snapshot",JSON.stringify(snap));return "recorded the state of "+Object.keys(snap).length+" stored items - now do the viewer actions, then run LINE X"})()
```

**LINE X — "what changed since I said remember?"**
This is the answer to the whole of Group B.

```
(()=>{const h=(s)=>{let x=0;for(let i=0;i<s.length;i++){x=((x<<5)-x+s.charCodeAt(i))|0}return x};let before;try{before=JSON.parse(localStorage.getItem("fix6-snapshot"))}catch{before=null}if(!before)return "no snapshot found - run LINE S first";const now={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k==="fix6-snapshot")continue;const v=localStorage.getItem(k)||"";now[k]=v.length+":"+h(v)}const isData=(k)=>k.indexOf("cm-")===0;const added=Object.keys(now).filter(k=>!(k in before));const removed=Object.keys(before).filter(k=>!(k in now));const changed=Object.keys(now).filter(k=>k in before&&now[k]!==before[k]);const data=[...added.filter(isData).map(k=>"ADDED "+k),...removed.filter(isData).map(k=>"REMOVED "+k),...changed.filter(isData).map(k=>"CHANGED "+k)];const ui=[...added.filter(k=>!isData(k)).map(k=>"ADDED "+k),...removed.filter(k=>!isData(k)).map(k=>"REMOVED "+k),...changed.filter(k=>!isData(k)).map(k=>"CHANGED "+k)];return JSON.stringify({YOUR_DATA_must_be_empty:data.length?data:"nothing written - PASS",per_device_ui_prefs_allowed:ui.length?ui:"none"},null,1)})()
```

LINE X prints two parts:

- **`YOUR_DATA_must_be_empty`** — this must say `nothing written - PASS`.
  Anything listed here means a View tab changed your project data.
- **`per_device_ui_prefs_allowed`** — the four harmless browser settings from
  section 2. Anything here is fine.

---

## Test 0 — am I testing the right build?

One minute.

1. Open the Preview link. Wait until your project appears.
2. Open the Console (**F12**, then **Console**).
3. Paste **LINE P**.

**What should happen:** it says `"thisTabIs": "editor"` and
`"willRefuseAllWrites": false`.

| What you get instead | What it means |
|---|---|
| `This build does not have the check` | ❌ Wrong build — the Preview link has not updated. Stop and tell me. |

4. Now click **View** in the top bar. A new browser tab opens. Its address has
   `#/view/` in it.
5. In that **View tab**, open the Console and paste **LINE P** again.

**What should happen:** `"thisTabIs": "viewer"` and `"willRefuseAllWrites": true`.

| What you get instead | What it means |
|---|---|
| `"thisTabIs": "editor"` in the View tab | ❌ Something is wrong. Stop and tell me. |

**Result: ☐ Right build ☐ Wrong build — I stopped**

6. Close the View tab for now. Group B opens a fresh one.

---

# GROUP A — the editor must still work

Do all of Group A in the **editor tab** (address has `#/editor/`).

Group A checks I have not broken normal use.

**Reminders are not part of this test.** Do not open the reminder panel. Do not
switch any reminder on or off. I tested that part myself — see section 10.

## A1 — Adding a card still saves it

1. Add a card. Title it `FIX6 A1`.
2. Watch the chip. It should go **Unsaved changes**, then **Syncing…**, then green
   **Saved**.
   It is normal if it dips back to **Unsaved changes** once on the way. That is a
   second item finishing its own save.
3. Reload the page.

**What should happen:** the card `FIX6 A1` is still there.

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — Switching canvas still saves your work

1. Paste **LINE A**. Write down the number next to `cloudVersion`.
2. Drag a card a short way.
3. Straight away — do not wait — switch to another canvas. Then switch back.
4. Wait for the chip to turn green **Saved**.
5. Paste **LINE A** again.

**What should happen:** the card stayed where you dragged it, and `unsaved` says
`false`.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — Pin groups still work in the editor

This is the same action as Test 0. Here, in the editor, it **should** work.

1. Press **S**. Click **Pins**. Click the **Manage Groups** icon.
2. Type `FIX6 A3`. Click **Add**.
3. The group appears in the list and in the "All Groups" dropdown.
4. Reload the page. **The group is still there.** That means it was really saved.
5. Delete the group again. The controls are on the group's own row.
6. Wait for the chip to turn green.

**What should happen:** in the editor you can add a group, it survives a reload,
and you can remove it.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — the View tab must not change anything

## Why this group changed since last time

Last time this group said FAIL, and **it was my test that was wrong, not your app.**

The lines I gave you look at the whole browser's stored data. They cannot tell
**which tab** wrote something. You had your editor tab open at the same time, and
that editor tab kept doing its normal job in the background — saving the card you
dragged in A2, taking its ten-minute version snapshot, and so on.

One item in your result proves it: `cm-last-snapshot`. Only an editor tab can write
that. A View tab has no code path that reaches it. So at least part of what you saw
was the editor tab, being blamed on the View tab.

That was my fault twice over: my test could not tell them apart, and I told you to
leave both tabs open.

**The fix is simple: only one tab runs at a time.** Below, you take the "before"
note in the editor, then close the editor, and only then let the View tab run. After
that, anything that changes can only be the View tab.

This version is also stronger than the last one, because closing the editor first
means the **View tab's own loading** is inside the measurement. Loading was where
the leak actually was.

## B1 — Take the "before" note, in the editor tab

1. Go to the **editor tab**.
2. Wait until the chip shows green **Saved**. Do not skip this — it means there is
   nothing half-finished for the editor to write on its way out.
3. Paste **LINE S**.

**What should happen:** `recorded the state of N stored items…`

☐ Ready

## B2 — Close the editor, then open the View tab

1. Still in the editor tab, click **View**. A new tab opens.
2. **Now close the editor tab.** Only the View tab is left running.
3. In the View tab, **reload the page** (F5).
   *(This puts the View tab's own loading inside the test. Loading is where the
   trouble was.)*
4. Paste **LINE P**. It must say `"thisTabIs": "viewer"`.

☐ Done

## B3 — Act like someone who is only reading

All of this in the View tab. The editor tab stays closed.

1. **Switch canvas.** Use the canvas-name dropdown at the top. Go to a second
   canvas, then come back.
2. **Try to add a pin group.** Press **S**, click **Pins**, click **Manage
   Groups**, type `FIX6 B3`, click **Add**. Nothing should happen.
3. **Copy a card.** Click one, press **Ctrl+C**. *(Meant to work.)*
4. **Make a panel wider.** Drag the left edge of the open panel. *(Allowed.)*
5. **Leave it alone for 90 seconds.** Do not click anything. This lets the
   background jobs run.

☐ Done

## B4 — Read the answer

1. Paste **LINE X**.

**What should happen — the line that matters:**

```
"YOUR_DATA_must_be_empty": "nothing written - PASS"
```

The other part, `per_device_ui_prefs_allowed`, may list the harmless browser
settings from section 2. That is fine.

**One exception to expect:** if the only thing listed under
`YOUR_DATA_must_be_empty` is `cm-dirty-flag`, that is the editor tab's goodbye note
from when you closed it, not the View tab. Anything else is a real finding — copy
the whole answer and send it to me.

2. Paste **LINE P** once more and look at `writesItHasRefused`.

- `none so far` means nothing even tried to save. Good.
- A list of names means the app **tried** to save and the new gate **stopped it**.
  That is also a pass — and it is interesting, because on the old build those would
  have gone through. Please send me the list if you see one.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — a View tab must not upload your editor's failed uploads

This is the leak that reached your cloud. **Only you can test it** — my sandbox has
no working cloud to upload to.

## Why this group changed since last time

Same problem as Group B. You wrote the "before" numbers down **in the editor tab**,
and the editor tab kept retrying those uploads by itself every 20 seconds while you
were opening the View tab. So the numbers had already moved before the View tab did
anything. In your second run the count had already gone up before C1 even finished —
that is the editor, not the viewer.

**The fix: take the "before" numbers inside the View tab, after the editor is
closed.** Then nothing else is running and the numbers can only move if the View tab
moves them.

## C1 — Make some uploads fail, in the editor tab

1. In the **editor tab**, paste the **reset line** (section 4). Reload the page.
2. Paste **LINE C**. It must say `queue empty - nothing waiting to retry`.
3. Paste this to make uploads fail on purpose:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
4. Add a card. Title it `FIX6 C1`. Wait about 10 seconds.

*(Your card is safe. It is saved on your computer and will upload in C4.)*

☐ Done

## C2 — Hand the browser over to the View tab only

1. Click **View**. A new tab opens.
2. **Close the editor tab.** Only the View tab is running now.
3. In the View tab, **reload the page**.
4. Paste **LINE P**. It must say `"thisTabIs": "viewer"`.

☐ Done

## C3 — Take the "before" numbers, in the View tab

1. In the **View tab**, paste **LINE C**.
2. Write both numbers down. **This is the baseline** — taken with only the View tab
   alive.

**`totalWaiting` = __________    `triesSoFar` = __________**

☐ Done

## C4 — Wait, then read the answer

1. Still in the View tab, **wait 90 seconds**. Do nothing.
2. Paste **LINE C** again.

**What should happen:** both numbers are **exactly the same** as in C3. Nothing
moved. That means the View tab never tried to upload.

If `triesSoFar` went up, the View tab did try. That is the bug and I want to know.

**`totalWaiting` now = __________    `triesSoFar` now = __________**

3. Also paste **LINE P** and look at `writesItHasRefused`. If it mentions
   `upload retry`, the View tab tried and was stopped — send me that too.

☐ PASS ☐ FAIL ☐ BLOCKED

## C5 — Put it all back

1. **Close the View tab.**
2. Open the app again as normal (an editor tab). Paste:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
3. Wait for the chip to turn green **Saved**, then about 25 seconds more.
4. Paste **LINE C**. It should say `queue empty`.
5. Delete the card `FIX6 C1`, and `FIX6 A1` if it is still there. Wait for green.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — the View tab must still be worth using

Open a View tab again with the **View** button. Blocking saves is no good if it also
breaks looking.

## D1 — Everything a reader needs still works

In the View tab, check each one:

1. Switching between canvases works. The address still has `#/view/`.
2. Panning and zooming work.
3. Open the Data Health panel. Click a "jump to card" row. The view moves to that
   card.
4. Press **Shift+D**. Card descriptions hide. Press it again. They come back.
5. Copy a card with **Ctrl+C**. Then paste it in an editor tab. The copy worked.

☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — Editing is refused, quietly

1. Try to drag a card. It should not move, or it snaps back. Nothing is saved.
2. Look at the sidebar. There is no **Import** button, no **Partial** button and no
   **Sync to Server** button.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 6. Finish up

1. **Close every View tab.** From now on, keep to one tab at a time again until this
   change is merged.
2. In the editor tab, paste the **reset line** (section 4). Reload.
3. Check all of these:
   - the chip is green
   - no card or group named `FIX6…` is left
   - **LINE C** says `queue empty`

☐ Done

---

# 7. If you are not sure about a result

Write **INCONCLUSIVE** and tell me what you saw. Please do not guess a PASS.

Group C matters most here. If you are not sure the editor tab was really closed,
say so. A wrong PASS there would hide the one leak that reached your cloud.

In all three rounds so far, the mistakes were in **my** documents, not in your app.
Two of them you caught: a step that assumed a conversation you did not remember, and
a measurement that could not tell two tabs apart. So "this step does not make sense"
is useful information. It is not a failure on your part.

---

# 8. What this test cannot prove

1. **It cannot look inside your cloud.** Group C works out "no upload happened" from
   the waiting numbers not moving. That is good evidence, because those numbers only
   move when an upload is tried. Real proof would mean opening the Firebase console.
2. **I could not test the upload leak myself.** With no working cloud, my sandbox app
   goes into offline mode, where uploads are blocked for a different reason. So that
   code never runs there, on either version. **Group C is the only real evidence, and
   it is all yours.**
3. **A View tab still writes the four browser settings in section 2.** On purpose.
4. **Nothing here tests two devices at once.**

**What I did test myself, this time round:**

- **The gate, one writer at a time.** 39 automated tests call every single save the
  app has — canvases, project settings, task list, the open-project pointer, sync
  bookkeeping, the device name, all the cloud saves, version snapshots, manual sync
  and the upload retry list — once as a viewer and once as an editor. As a viewer,
  every one leaves storage untouched. As an editor, every one still saves. That
  second half matters: a gate that blocked everybody would pass the first half and
  break your app.
- **The two writes that leaked in your test.** There are named tests for exactly
  those: taking a cloud canvas into the local copy, and taking cloud project
  settings. Both refused, and the local copy still holds what it held before.
- **In a real browser.** A View tab loads, switches canvas, opens panels and sits for
  45 seconds: **no stored data changes at all.** An editor tab doing the same canvas
  switch still writes its canvas, its project settings and its last-place marker. And
  LINE P correctly says `viewer` on a `#/view/` address and `editor` on `#/editor/`,
  including when a tab changes from one to the other without reloading.

---

# 9. Which test covers which fix

| The fix | Proven by |
|---|---|
| A viewer cannot save anything, by any route | 39 automated tests, plus B4 in a real browser |
| The writes that leaked in your last run | Named automated tests, plus B4 |
| A View tab never uploads your editor's failed uploads | **Group C only** — see section 8.2 |
| A viewer cannot change pin groups | Test 0 last round, B3 this round |
| A viewer cannot change reminders | My browser run only — kept out of your test on purpose |
| This tab knows what it is | LINE P, checked in a real browser both ways |
| The editor still works | A1, A2, A3, plus the editor half of all 39 tests |
| A View tab is still useful | D1, D2 |

---

# 10. Your missing reminders — what I found

You said your reminder list emptied itself, with no message. You are right, and it
is a real bug. It is **not** caused by Fix 6. Here is what I found, and I could
reproduce it.

**How the app is meant to work.** The app ships with 8 built-in reminders (Drink
Water, Rest Your Eyes, and so on). 7 of them start switched on. That is why you saw
so many popping up.

**Where it goes wrong.** Two rules in the code disagree with each other:

1. When the app loads your project from the cloud, it copies the project's settings
   onto your computer. If the cloud copy has **no reminder list at all**, the app
   writes down an **empty list** instead.
2. When the app then reads that list, it only falls back to the 8 built-in
   reminders if the list is **missing**. An **empty** list counts as a real answer.

So "we did not find a list" turns into "there is no list", and then it sticks. No
message, no warning.

**I checked this in a browser.** With an empty list saved, the panel says "No
reminders yet", and reloading does not bring the built-in ones back — not once, not
ever. When I removed the list entirely instead, all 8 came back on the next reload.

**Two more things you should know:**

- **Your Exports do not contain reminders.** The export file holds canvases, cards,
  the card counter and tasks. Reminders and pin groups are not in it. So a backup
  file cannot bring them back. I did not know that either until I looked today.
- **I cannot tell you exactly when yours emptied.** I would only be guessing, and I
  would rather not.

**What I suggest.** This is a small, contained fix: stop turning "not found" into
"empty", and let an empty list fall back to the 8 built-ins the way the rest of the
app already does. It is not part of Fix 6, so I have not touched it. **Say the word
and I will do it as its own small change after pull request #10.**

Until then, please leave reminders alone. They have several other known bugs and we
agreed to keep them switched off anyway.

---

# 11. Changes to this document

- **v4** — rebuilt after your Group B and Group C results.
  - **Both of those FAILs were my test's fault, not your app's.** The lines look at
    the whole browser, so they could not tell which tab wrote something — and I had
    told you to keep the editor tab open. `cm-last-snapshot` in your output can only
    come from an editor tab, which is how I know. Groups B and C now close the editor
    tab first, so only one tab is ever running.
  - **The fix itself was rebuilt too**, the way you described: one gate at the
    boundary instead of forty checks scattered about. Section 2 explains it.
  - **New LINE P** so you can ask a tab what it is, instead of guessing from what
    changed.
  - Group B now measures the View tab's **loading** as well, which is where the real
    leak was.
- **v3** — rewritten, much simpler, at your request.
  - **The reminder step (old A4) is gone.** You asked whether you had to switch all
    reminders off. The answer is no: you do not touch reminders at all now. I tested
    the reminder part myself in a browser instead — see the table in section 8.
  - Added section 1, a short list of the words I use (editor tab, View tab, chip,
    Console, line).
  - Added section 10 about your wiped reminders.
  - Shorter sentences. One action per step. Every step now says what should happen
    right after it.
  - Group B lost one step (trying the reminder panel) and is 20 minutes now, not 25.
- **v2** — plainer wording after you said the first version was vague. Old A4 ended
  with "your standing rule", which assumed you remembered a talk from weeks ago.
- **v1** — first version, written after Fix 5b was merged.

**No test result changed between v1, v2 and v3.** The four pasted lines are
byte-for-byte the same as the ones I ran in a real browser before writing them down
(checked by comparing the files, not by eye).
