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

You have two kinds of tab.

An **editor tab** is for working. It saves what you do. That is correct.

A **View tab** is for looking. It should save **nothing at all**. That is the whole
point of it. You can open a View tab, leave it open, walk away, and know that it is
not touching your data.

I found four places where a View tab did touch things. All four are now blocked.

| What went wrong | How bad it was |
|---|---|
| A View tab finished off uploads that had failed earlier in your editor tab, and sent them to the cloud itself. | **Bad. This one really did reach your cloud.** Group C tests it. |
| Moving to another canvas in a View tab saved the canvas you left. | **Bad.** I measured it. The saved copy of the canvas changed. |
| A viewer could add or delete a pin group, and switch reminders on and off. | **Not saved anywhere — but the screen lied.** You clicked, it looked like it worked, and it vanished on reload. |
| A timer kept running in a View tab. Every 60 seconds it changed when each reminder was next due. | **Nothing was saved.** Two other checks happened to stop it. But it was one small change away from writing to your project every minute. |

I also fixed the reason all four could happen. The app had one place that asked "is
it safe to save right now?" But that question only asked whether your data had
loaded properly. It never asked "am I a View tab?" Now it asks both. So a new
piece of code cannot forget this rule in future.

### Four small things a View tab may still change

None of these is your project data. They are settings for this browser only.
They cannot damage anything.

1. How wide you dragged a side panel.
2. Whether card descriptions are hidden (the **Shift+D** setting, made for
   presenting).
3. The clipboard, when you copy a card. Copying out is the main reason to use a
   View tab.
4. A small marker that some browsers use to notice the app is open twice.

The check in Group B lists these on their own line, so when you see them you know
they are fine.

**If you want a View tab to change nothing at all, not even these four, tell me.**
Each one is a one-line change.

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

**2. This test asks you to have an editor tab and a View tab open at the same time.**
I know we agreed not to do that. That rule exists *because* of the leaks I am fixing
here. So the only way to check they are gone is to do the thing that used to be
unsafe. Group C tells you when to close which tab. After this is merged, having both
open is fine.

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

## 5. The four lines you will paste

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

Two minutes. It stops you doing 20 minutes of work on the wrong version.

1. Open the Preview link. Wait until your project appears.
2. Click **View** in the top bar. A new browser tab opens.
3. Look at the address of the new tab. It has `#/view/` in it.
4. In that View tab, press the **S** key. A sidebar appears on the left.
5. Click **Pins** in the sidebar. The Pins panel opens on the right.
6. In the Pins panel, find the small **stacked-layers icon**. Hover it — the
   tooltip says "Manage Groups". Click it. A box appears saying "New group name…".
7. Type `FIX6 TEST GROUP` in that box. Click **Add**.

**Now look at the group list and the "All Groups" dropdown.**

| What you see | What it means |
|---|---|
| Nothing happened. No new group anywhere. | ✅ Right build. Go on to Group A. |
| The group `FIX6 TEST GROUP` appeared. | ❌ Wrong build. The Preview link has not updated yet. Stop and tell me. |

8. Leave this View tab open. Group B uses it.

**Result: ☐ Right build ☐ Wrong build — I stopped**

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

Do all of Group B in the **View tab** you opened in Test 0.

## B1 — Take the "before" note

1. Paste **LINE S**.

**What should happen:** it says `recorded the state of N stored items…`
(N is some number.)

☐ Ready

## B2 — Act like someone who is only reading

Still in the View tab. Do all six of these.

1. **Switch canvas.** Use the canvas-name dropdown at the top. Go to a second
   canvas. Then come back.
   *(Before this fix, this quietly re-saved the canvas you left.)*
2. **Try to add a pin group.** Press **S**, click **Pins**, click **Manage
   Groups**, type `FIX6 B2`, click **Add**. **Nothing should happen.** That is
   correct here.
3. **Copy a card.** Click a card, press **Ctrl+C**. *(This one is meant to work.)*
4. **Make a panel wider.** Drag the left edge of the open panel.
   *(Allowed — it is a browser setting. See section 2.)*
5. **Now leave it alone for 90 seconds.** Do not click anything. Do not move the
   mouse over the canvas. Just wait.
   *(This matters. It lets the app's background jobs run. Two of the four leaks
   were background jobs.)*
6. Do not open the reminder panel.

☐ Done

## B3 — Read the answer

1. Paste **LINE X**.

**What should happen — the line that matters:**

```
"YOUR_DATA_must_be_empty": "nothing written - PASS"
```

The other part, `per_device_ui_prefs_allowed`, may list one or more of the four
harmless settings from section 2. That is fine.

**If anything is listed under `YOUR_DATA_must_be_empty`, copy the whole answer and
send it to me.** That would be a leak I have not found.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — a View tab must not upload your editor's failed uploads

This is the leak that really reached your cloud. **Group C is the only test of it.**
I could not test it myself, because my sandbox has no working cloud to upload to.

**The idea, in plain words:**
First we make some uploads fail on purpose in the editor tab. They pile up in a
waiting list. Then we close the editor tab, so only the View tab is left running.
Then we check that the waiting list did not move. If the View tab were still
uploading, the "tries so far" numbers would go up.

**Read all of Group C before you start it.**

## C1 — Make some uploads fail, in the editor tab

1. Go to the **editor tab**. Paste the **reset line** (section 4). Reload the page.
2. Paste **LINE C**. It must say `queue empty - nothing waiting to retry`.
   If it does not, paste the reset line again and reload.
3. Paste this. It makes uploads fail on purpose:
   ```
   localStorage.setItem('cm-debug-fail-cloud-write','1'); 'uploads will now fail'
   ```
4. Add a card. Title it `FIX6 C1`. Wait about 10 seconds.
5. Paste **LINE C**. **Write both numbers down:**

**`totalWaiting` = __________    `triesSoFar` = __________**

*(Your card is safe. It is saved on your computer. It will upload properly in C4.)*

☐ Ready

## C2 — Leave only the View tab running

1. Still in the editor tab, click **View**. A fresh View tab opens.
   (If you still have the one from Group B, reload that instead.)
2. **Close the editor tab.** This step is the important one. From now on only the
   View tab is running. So anything that happens to the waiting list was done by
   the View tab.
3. In the View tab, **reload the page**. Loading is exactly when the old version
   emptied the list.
4. **Wait 90 seconds.** Do nothing.

☐ Done

## C3 — Read the answer

1. In the **View tab**, paste **LINE C**.

**What should happen:** `totalWaiting` and every `triesSoFar` are **exactly the
numbers you wrote down in C1**. Nothing moved. That means the View tab never tried
to upload.

If the numbers went up, the View tab did try to upload. That is the bug, and I want
to know.

**`totalWaiting` now = __________    `triesSoFar` now = __________**

☐ PASS ☐ FAIL ☐ BLOCKED

## C4 — Put it all back

1. **Close the View tab.**
2. Open the app again as normal (an editor tab). Paste:
   ```
   localStorage.removeItem('cm-debug-fail-cloud-write'); 'uploads work again'
   ```
3. Wait for the chip to turn green **Saved**. Then wait about 25 seconds more.
4. Paste **LINE C**. It should now say `queue empty`. The failed uploads have gone
   through.
5. Delete the card `FIX6 C1`. Delete `FIX6 A1` too if it is still there. Wait for
   green.

**What should happen:** the waiting list empties on its own, and your test cards
are gone.

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

1. **Close every View tab.**
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

In the last two rounds, the mistakes were in **my** documents, not in the app. So
"this step does not make sense" is useful. It is not a failure on your part.

---

# 8. What this test cannot prove

I would rather list these than let the ticks look stronger than they are.

1. **It cannot look inside your cloud.** Group C works out "no upload happened"
   from the waiting list not moving. That is good evidence, because the list only
   moves when an upload is tried. Real proof would mean opening the Firebase
   console.
2. **I could not test the upload leak at all myself.** With no working cloud, the
   app goes into offline mode, where uploads are blocked for a different reason. So
   that code never runs in my sandbox, on either version. **Group C is the only
   real evidence, and it is all yours.**
3. **The reminder-timer leak has nothing you can see.** Pop-ups were already hidden
   in View tabs by other code, and what the timer changed was never saved. That fix
   rests on the code change and on automated tests.
4. **A View tab still changes the four browser settings in section 2.** On purpose.
5. **Nothing here tests two devices at once.**

**What I did test myself.** I wrote one browser script and ran it twice: once
against the app as it is now, once against this fix.

| Check | App as it is now | With this fix |
|---|---|---|
| View tab switches canvas | **the saved copy of the canvas changed** | nothing was written |
| Viewer adds a pin group | **the group appeared** | it does not appear |
| Viewer clicks a reminder switch | **the switch moved** | nothing moves at all |
| Editor tab does the same things | saves normally | saves normally — no change |

That is what tells me the checks above can really spot the problem, instead of
passing because they are looking in the wrong place.

---

# 9. Which test covers which fix

| The fix | Proven by |
|---|---|
| A View tab saves nothing when you switch canvas | B2 and B3, plus my before-and-after run |
| A viewer cannot change pin groups | Test 0, B2, B3, plus my before-and-after run |
| A viewer cannot change reminders | **My before-and-after run only** — kept out of your test on purpose |
| A View tab never uploads your editor's failed uploads | **Group C only** — see section 8.2 |
| The reminder timer does not run in a View tab | Code and automated tests only — see section 8.3 |
| The "is it safe to save?" rule itself | 24 automated tests |
| The editor still works | A1, A2, A3 |
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

- **v3** — rewritten again, much simpler, at your request.
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
