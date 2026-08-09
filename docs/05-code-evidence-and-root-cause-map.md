# 05 — Code Evidence & Root Cause Map

## Purpose

This document is the **implementation companion** to *02 — Bug Architecture Issue Tracker*.

| Document | Answers | Audience |
| --- | --- | --- |
| **02 — Bug Tracker** | *What* is broken and *why* it matters | Owner, planning, prioritisation |
| **05 — This document** | *Where* the defect lives and *how* it was verified | Developer or LLM about to write the fix |

Doc 02 is deliberately prose-only — no file paths, no code, no line numbers. That is a strength: it stays readable and does not rot. This document carries the volatile detail so Doc 02 does not have to.

**Rule: no bug may appear here that is not in Doc 02, and no bug in Doc 02 that has been code-traced may be missing from here.** If the two disagree, Doc 02 wins on intent and this document wins on location.

---

## How to use this document

1. Find the bug ID you are fixing.
2. Read **Location** to find the code. Search by **function name**, not line number.
3. Read **Faulty expression** — this is the precise thing that is wrong.
4. Read **Verification** to understand how strong the evidence is before you trust it.
5. Read **Blast radius** to know what else you might break.

### Staleness policy

- Line numbers are **indicative only**, captured against commit `cd05793` on `main`.
- Function and variable names are the **stable** identifiers. Always search by name.
- When you fix a bug, update its entry to `Status: Fixed in <PR>` rather than deleting it. The historical trace is what prevents the bug being reintroduced.

---

## ⚠️ Verification status — read this before trusting anything below

Every finding in this document was produced by **reading source code**, not by running the application.

**The repository contains no test suite, no test runner, and no reproduction harness.** `package.json` declares only `dev`, `build`, and `preview` scripts. There is no `test` script, no testing dependency, and no test files anywhere in `src/`.

This has a direct consequence for how you should read this document:

| Level | Meaning | Trust |
| --- | --- | --- |
| **A — Proven by code** | The defect is unambiguous from the source. No runtime state could make the code correct. | High. Fix it. |
| **B — Code-traced, path-dependent** | The defect is real but only manifests on a specific path (a particular fallback firing, a particular timing). The path is identified but was not observed executing. | Medium. Confirm the path before designing the fix. |
| **C — Latent** | The code is incorrect in principle but currently produces correct behaviour by accident. No user impact today. | Low urgency, real risk on next edit. |

**Three findings from the Chat 10 review were withdrawn or corrected after deeper verification.** They are recorded in the Corrections Register below rather than deleted, because a wrong finding that was investigated and closed is more useful than a silently removed one.

---

## Owner decisions recorded (Chat 11)

> Two decisions previously listed as open have been answered by the owner. They are binding for implementation.

| # | Question | Decision | Affects |
| --- | --- | --- | --- |
| **D1** | Undo scope — per-workspace or global? | **Per-workspace** (Doc 06 Decision 1, Option A) | Bug 39, Bug 27 |
| **D2** | `deleteTask` removes the linked pin; `bulkDeleteTasks` converts it to standalone. Which is correct? | **Convert to standalone** — `deleteTask` changes to match `bulkDeleteTasks` | Bug 31 |

Neither decision has been implemented. Both are specified below and in Doc 06.

---

## ⛔ Bug-number policy

**Bug numbers are permanent. A withdrawn bug's number is retired, never reused, and never triggers renumbering of later bugs.**

Bug 25 was withdrawn after verification (see Corrections Register). Bugs 26–39 **keep their existing numbers**. Do not compact the sequence.

Rationale: bug numbers appear in commit messages, PR titles, branch names, and cross-document references. Renumbering breaks every existing reference and makes conversation history ambiguous. A visible gap costs nothing; a silent renumber costs traceability.

| Number | State |
| --- | --- |
| 1–23 | Original tracker, in use |
| **24** | In use — cross-workspace edit leak |
| **25** | 🚫 **RETIRED — withdrawn, wrong detection. Do not reuse this number.** |
| 26–39 | In use, numbers unchanged |
| 40+ | Next available for new findings |

---

## Corrections Register

> These entries correct earlier claims made during the Chat 10 review. They are kept visible so nobody re-files them.

### 🚫 Bug 25 — RETIRED (wrong detection)

**Claim:** "Card text edits cannot be undone — `updateNode` never calls `takeSnapshot()`."

**Verdict: incorrect. Number retired.**

The claim was based on observing that `updateNode` (App.jsx ~6403) contains no `takeSnapshot()` call, and inferring that text edits therefore have no undo coverage.

`updateNode` indeed does not snapshot — but **it does not need to.** Every text-editing entry point snapshots on *edit-session start*, which is the correct pattern:

| Editor | Location | Mechanism |
| --- | --- | --- |
| Canvas card title | App.jsx ~8265 | `onFocus={() => takeSnapshot()}` on the `<textarea>` |
| Canvas card content | App.jsx ~8298, ~8310 | `takeSnapshot()` in the `onClick` that enters edit mode |
| Outline view content | App.jsx ~6842 | `onFocus={() => takeSnapshot()}` |
| Card Editor Panel title | CardEditorPanel.jsx ~179 | `onFocus={() => onSnapshot()}` |
| Card Editor Panel content | CardEditorPanel.jsx ~192 | `onFocus={() => onSnapshot()}` |
| Card Editor Panel theme | CardEditorPanel.jsx ~73 | `onSnapshot()` before `onUpdateNode` |
| Inline theme / link pickers | App.jsx ~8373, ~8375, ~8386 | `takeSnapshot();` immediately before `updateNode` |
| Mobile sheet theme | App.jsx ~9393 | `takeSnapshot();` immediately before `updateNode` |

One snapshot per typing burst is exactly the coalescing behaviour a well-designed undo system should have.

> ### ⚠️ Do not "fix" this
> Adding a `takeSnapshot()` call inside `updateNode` would create **one history entry per keystroke**, making undo useless and multiplying the Bug 27 memory problem by the length of every sentence typed. If a future review flags `updateNode` as missing a snapshot, that review is repeating this error — point it at this entry.
>
> Doc 06 § 5.3 verification scenario 3 exists specifically to catch this regression.

**Lesson recorded:** absence of a call inside a function is not evidence of absence in the feature. Trace the call sites before concluding coverage is missing.

---

### ⚠️ CORRECTED — Keyboard shortcuts and `contentEditable` (Bug 32)

**Original claim:** single-letter shortcuts fire while typing in card titles because handlers do not guard `contentEditable`.

**This is wrong. There are zero `contentEditable` elements in the entire codebase.** Verified: `grep -n "contentEditable" src/*.jsx` returns only the guard expressions themselves (`e.target.isContentEditable`), never a JSX attribute. All card text editing uses `<textarea>`, which **every** keyboard handler correctly guards.

**Typing in a card does not trigger shortcuts.** The reported symptom does not exist.

There is however a **real but much narrower** defect, which is what Bug 32 now describes — see its entry below. It concerns `<select>` elements, of which there are 8.

---

### ⚠️ CORRECTED — Canvas wheel handler (Bug 35)

**Original claim:** `e.preventDefault()` in `handleWheel` blocks scrolling in panels that overlap the canvas.

**Both halves of this were wrong:**

1. **Panels are not affected.** `handleWheel` is bound via `onWheel` on the `<main>` element (App.jsx ~7818). `<main>` closes at ~8899. Every panel — Clone Panel, PinPanel, ReminderPanel, CardEditorPanel, FullTaskManager — renders *after* `</main>` as a **sibling**, not a descendant. Wheel events inside panels never reach this handler.

2. **The `preventDefault()` does not work at all.** React 18 attaches `wheel` as a **passive** listener on the root container. `preventDefault()` inside a React `onWheel` handler is a no-op and Chrome logs *"Unable to preventDefault inside passive event listener invocation."* React version confirmed as `^18.3.1` in `package.json`.

The genuine defect is therefore the **inverse** of the original claim: the handler *intends* to suppress native scroll while zooming and **fails to**. See Bug 35 below for the corrected description and fix.

**Lesson recorded:** framework event-system behaviour (passive listeners, delegation, synthetic events) can invert the meaning of otherwise-correct-looking code. Check the framework version before reasoning about event defaults.

---

# Part 1 — The Card Identity Cluster

> This is the highest-severity group. Bug 16 creates ambiguous identity; Bug 24 acts on it destructively; Bugs 28 and 29 are additional creators.

## Bug 24 — Cross-workspace card edit leak

**Verification: A — Proven by code**
**Priority: A (top)**

### Location
`src/App.jsx` → `updateNode(id, updates)` → ~line 6403

### The code

```js
const updateNode = (id, updates) => {
  if (isPreviewMode) return;
  const syncFields = {};
  if (updates.title   !== undefined) syncFields.title   = updates.title;
  if (updates.content !== undefined) syncFields.content = updates.content;
  const shouldPropagate = Object.keys(syncFields).length > 0;

  setWorkspaces(prev => {
    let sourceId = null;
    if (shouldPropagate) {
      for (const ws of prev) {                                  // ← FAULT 3
        const found = ws.nodes.find(n => n.id === id);
        if (found) { sourceId = found.cloneSourceId || found.id; break; }
      }
    }

    return prev.map(ws => {
      const isActiveWs      = ws.id === activeTab;
      const hasEditedNode   = ws.nodes.some(n => n.id === id);   // ← FAULT 1
      const hasRelatedClone = shouldPropagate && sourceId && ws.nodes.some(n =>
        n.id === sourceId || n.cloneSourceId === sourceId
      );

      if (!isActiveWs && !hasEditedNode && !hasRelatedClone) return ws;

      const updatedNodes = ws.nodes.map(n => {
        if (n.id === id) return { ...n, ...updates };            // ← FAULT 2
        if (shouldPropagate && sourceId && (n.id === sourceId || n.cloneSourceId === sourceId)) {
          return { ...n, ...syncFields };
        }
        return n;
      });

      return { ...ws, nodes: updatedNodes, groups: computeLayout(ws.groups, updatedNodes) };
    });
  });
};
```

### Faulty expressions

| # | Expression | Fault |
| --- | --- | --- |
| **1** | `ws.nodes.some(n => n.id === id)` | Un-skips **any** workspace containing a matching ID. The `!isActiveWs` guard is defeated by this clause. |
| **2** | `{ ...n, ...updates }` | Applies the **entire** update object, not just synced fields. The foreign card inherits `title`, `content`, `theme`, **and `x`/`y`** — it is silently teleported as well as overwritten. |
| **3** | `for (const ws of prev) { ... break; }` | Resolves the clone source from the **first** workspace in array order. New workspaces are appended (`addWorkspace`, ~4026), so **older workspaces are scanned first** and the source is derived from the wrong card. |

### The structural problem

Every node carries a `workspaceId` field, stamped at creation (`addNode` ~5952, `duplicateNode` ~6291, `cloneNodeToWorkspace` ~6358). **This function never reads it.** The data model is correct; the lookup ignores it.

### Blast radius

The corruption is persisted and uploaded as a legitimate edit:

- Workspace autosave (App.jsx ~2145–2172) saves **every workspace whose object reference changed**. `updateNode` returns a new object for the foreign workspace, so it is written to `localStorage`, passed to `markDirty()`, and stamped `lastEditedByDevice: getDeviceLabel()`.
- The debounced Firestore saver then uploads it. From the cloud's perspective this device deliberately edited that workspace.

### Also affected by the same ID-matching

- `deleteNode` (~6449) clears `cloneSourceId === id` **only within the active workspace** → dangling clone references elsewhere (this is Bug 17).
- Clone Panel instance aggregation (~8927) matches `n.id === selectedCloneSourceId || n.cloneSourceId === selectedCloneSourceId` across all workspaces → an unrelated same-ID card is listed as a clone instance.

### Fix sketch

```js
// 1. Scope the direct write to the active workspace.
if (n.id === id && ws.id === activeTab) return { ...n, ...updates };

// 2. Resolve sourceId from the ACTIVE workspace only.
const activeWsObj = prev.find(w => w.id === activeTab);
const found = activeWsObj?.nodes.find(n => n.id === id);
const sourceId = found ? (found.cloneSourceId || found.id) : null;

// 3. Require a genuine clone relationship, not bare ID equality.
//    A node is a clone participant only if it HAS cloneSourceId === sourceId,
//    or it IS the source AND at least one real clone exists.
```

### Verification method for the fix
No automated test exists. Manual reproduction: create project → note seed card IDs are `'1'…'4'` in `ws-1` (App.jsx ~253) → force `nextId` to `1` in `localStorage` under `cm-proj-{id}` → create a second workspace → add 4 cards → edit them → return to `ws-1`. Cards must be unchanged after the fix.

---

## Bug 16 — Duplicate card IDs (root cause detail)

**Verification: B — Code-traced, path-dependent**
**Priority: A**

### The asymmetry that causes this

| Entity | ID generator | Collision-proof |
| --- | --- | --- |
| Project | `generateId()` → `crypto.randomUUID()` (persistenceService.js ~306) | ✅ |
| Workspace | `generateId()` | ✅ |
| Pin | `` `pin-${Date.now()}` `` | ✅ |
| Image | `` `img-${Date.now()}-${random}` `` | ✅ |
| Task | `` `task-${Date.now()}-${random}` `` | ✅ |
| Task group | `` `group-${Date.now()}-${random}` `` | ✅ |
| Canvas group | `` `g-${Date.now()}` `` | ✅ |
| **Card / node** | **`nextId.toString()`** — shared integer counter | ❌ |

**Card IDs are the only IDs in the system that are not collision-proof.** This is the finding that most strongly supports full UUID migration over counter reconciliation.

### The counter is project-global, not per-workspace

Declared at App.jsx ~459 (`useState(10)`). Stored in the **project metadata document**, never on a workspace. No workspace object carries a counter. Nothing anywhere computes it from existing data — verified by inspecting all `Math.max` uses in App.jsx; none touch IDs.

### The default-value mismatch — most probable cause of the reported data loss

Three write paths default the counter to **1**; every read path defaults to **10**.

| Direction | Location | Default |
| --- | --- | --- |
| **Write** | App.jsx ~1159 (Firestore → localStorage hydration) | `proj.nextId \|\| 1` |
| **Write** | App.jsx ~1295 (field-migration persist) | `proj.nextId \|\| 1` |
| **Write** | App.jsx ~5087 + ~5099 (full-backup import) | `proj.nextId \|\| 1` |
| Read | App.jsx ~1363 (init) | `activeProj.nextId \|\| 10` |
| Read | App.jsx ~2675 (exit Preview) | `if (hydrated.nextId)` |
| Read | App.jsx ~4378, ~4468 (project switch) | `\|\| 10` |
| Read | App.jsx ~4799 (project delete → switch) | `\|\| 10` |
| Read | App.jsx ~5019 (workspace import) | `\|\| 10` |
| Read | App.jsx ~5115 (default project) | `\|\| 10` |
| Read | App.jsx ~1698, ~1712, ~1749 (restore / preview snapshot) | `\|\| 10` |
| Read | persistenceService.js ~1722 (snapshot build) | `meta.nextId \|\| 10` |

A project whose stored metadata lacks the counter is persisted with **1**. New cards are then assigned `"1"`, `"2"`, `"3"`, `"4"` — **exactly the seed card IDs of the default workspace** (App.jsx ~253–256: `'1'` User Interviews, `'2'` Competitor Benchmark, `'3'` Component Library, `'4'` Launch Strategy Plan).

### Additional regression paths

| Path | Location | Mechanism |
| --- | --- | --- |
| **Split persistence** | App.jsx ~2336–2383 (metadata autosave) vs ~2138–2210 (workspace autosave) | Counter lives in the metadata document on its own 3s debounce + own dirty flag; cards live in per-workspace documents on a different debounce. Losing the metadata write regresses the counter below live IDs. |
| **Missing-metadata skip** | App.jsx ~2345 `if (projMeta) {` | If no metadata record exists, the counter is **never persisted locally at all**. |
| **Undo** | App.jsx ~2573, ~2588 | `setNextId(prev.nextId)` restores the counter from a snapshot, which can rewind it below live IDs. |
| **Same-batch double create** | App.jsx ~5951 | `addNode` reads `nextId` from closure while incrementing via `setNextId(prev => prev + 1)`. Two `addNode` calls in one React batch both read the same closure value → duplicate IDs within one workspace. |
| **Multi-device** | App.jsx ~2338 (comment claims "nextId ensures unique IDs across devices") | With a 3s debounce and last-write-wins metadata, two devices creating cards concurrently hand out identical IDs. The comment states a guarantee the code does not provide. |

### All card-creation sites (must all be migrated together)

| Site | Location | Assignment |
| --- | --- | --- |
| `addNode` | ~5951 | `nextId.toString()` |
| `duplicateNode` | ~6283 | `nextId.toString()` |
| `cloneNode` | ~6315 | `nextId.toString()` |
| `cloneNodeToWorkspace` | ~6352 | `nextId.toString()` |
| Paste single | ~2853 | `nextId.toString()` |
| Paste group | ~2998 | `idCounter` loop |
| Paste multi-selection | ~3288 | `idCounter` loop |
| `duplicateWorkspace` | ~4105 | `idCounter` loop |
| Partial import | ~5232 | `currentId` loop |
| Duplicate-selection toolbar button (inline) | ~9427 | `currentId` loop |

**Ten sites.** The inline handler at ~9427 is a single ~40-line JSX expression and is the easiest to miss.

---

## Bug 28 — Project duplication reuses card IDs

**Verification: A — Proven by code**
**Priority: A**

### Location
`src/App.jsx` → `duplicateProject(targetId)` → ~line 4588

### The code

```js
const cloned = JSON.parse(JSON.stringify(target));
const newWorkspaces = (cloned.workspaces || []).map(ws => {
  const newWsId = generateId();                                    // ✅ workspace ID regenerated
  return {
    ...ws,
    id: newWsId,
    nodes: (ws.nodes || []).map(n => ({ ...n, workspaceId: newWsId })),  // ❌ n.id untouched
    edges: (ws.edges || []).map(e => ({ ...e, workspaceId: newWsId })),  // ❌ endpoints untouched
    groups: (ws.groups || []).map(g => ({ ...g, workspaceId: newWsId })),// ❌ g.id untouched
    pins:  (ws.pins || []).map(p => ({ ...p, workspaceId: newWsId })),
    images:(ws.images || []).map(img => ({ ...img, workspaceId: newWsId }))
  };
});
```

Then at ~4621: `nextId: newProj.nextId || 10` — the counter is copied from the source project unchanged.

### Why this is independent of Bug 16

This produces guaranteed collisions with **no counter regression at all**. `duplicateWorkspace` (~4098) does this correctly — it builds `nodeIdMap`, `groupIdMap`, `pinIdMap` and advances the counter via `setNextId(idCounter)`. `duplicateProject` simply omits that logic.

**Contrast is the fix specification:** apply `duplicateWorkspace`'s remapping approach per workspace inside `duplicateProject`, including `cloneSourceId` remapping (`duplicateWorkspace` does this at ~4132).

### Blast radius
Both the original and the duplicate now contain cards with identical IDs. Because `updateNode` (Bug 24) matches across workspaces but **not across projects**, the two do not corrupt each other while separate. The collision becomes active if the projects are ever merged, or if a full-backup export/import round-trip brings both into one project's workspace list.

---

## Bug 29 — Cut and paste can delete the wrong card

**Verification: B — Code-traced, path-dependent**
**Priority: A**

### Location
`src/App.jsx` → `cutNode` ~6? / `pasteNode` → ~line 2828

### The code

`cutNode` stores only an ID:
```js
const clipData = {
  node: { ...node, id: undefined },
  action: 'cut',
  sourceWorkspaceId: activeTab,
  sourceNodeId: nodeId,        // ← the only identity recorded
  timestamp: Date.now()
};
localStorage.setItem('nexus-clipboard', JSON.stringify(clipData));
```

`pasteNode` removes by that ID:
```js
} else if (ws.id === clipData.sourceWorkspaceId) {
  const filteredNodes = ws.nodes.filter(n => n.id !== clipData.sourceNodeId);   // ← no verification
  return {
    ...ws,
    nodes: filteredNodes,
    edges: ws.edges.filter(e => e.source !== clipData.sourceNodeId && e.target !== clipData.sourceNodeId),
    groups: computeLayout(ws.groups, filteredNodes)
  };
}
```

### Two failure modes

1. **Wrong card deleted.** If the source workspace gained a card reusing that ID between cut and paste (via Bug 16, Bug 28, import, or another paste), that card is deleted instead. Its connections are removed too.
2. **Silent no-op.** If the source workspace was deleted between cut and paste, `filter` matches nothing. No error is raised. The user believes the card was moved; the original is simply gone from a deleted workspace and the paste created a copy.

### Aggravating factor
The clipboard persists in `localStorage` under `nexus-clipboard` with **no expiry check**. `timestamp` is written but never read. A cut performed days earlier is still actionable.

### Fix sketch
Store `sourceWorkspaceId` + `sourceNodeId` + a content fingerprint (`computeContentHash` already exists in persistenceService.js ~119). Before removing, verify the fingerprint matches. On mismatch or not-found, surface a message — do not fail silently. Add a staleness check against `timestamp`.

---

# Part 2 — Sync & Persistence

## Bug 30 — Queued cloud writes fail silently

**Verification: A — Proven by code**
**Priority: A**

### Location
`src/persistenceService.js` → `guardedFirestoreSave(path, saveFn)` → ~line 739

### The code

```js
async function guardedFirestoreSave(path, saveFn) {
  if (!firestoreWriteQueues.has(path)) {
    firestoreWriteQueues.set(path, { inFlight: false, queued: null });
  }
  const slot = firestoreWriteQueues.get(path);

  if (slot.inFlight) {
    slot.queued = saveFn;
    return true;                                          // ← FAULT 1: premature success
  }

  slot.inFlight = true;
  try {
    const result = await saveFn();
    return result;
  } finally {
    slot.inFlight = false;
    if (slot.queued) {
      const nextSave = slot.queued;
      slot.queued = null;
      guardedFirestoreSave(path, nextSave).catch(() => {}); // ← FAULT 2: fire-and-forget
    }
  }
}
```

### Faults

1. **`return true` before execution.** The caller records success for a write that has not run. All four write types route through this guard: `saveProjectToFirestore` (~814), `saveWorkspaceToFirestore` (~934), `saveTasksToFirestore` (~1157), `saveUserMeta` (~1202).
2. **`.catch(() => {})` discards the outcome.** If the queued write fails: no result reaches any caller, `enqueueFailedWrite` is never invoked, `confirmSynced` never runs, and the document's `dirty` flag stays set permanently.

### Why the existing safety nets do not catch it

`pushDirtyNow` (App.jsx ~2966) and the heartbeat (~3??) call `hasDirtyDocs(projectId)` and then `manualServerSync`. But `manualServerSync` (persistenceService.js ~1553) itself calls `saveWorkspaceToFirestore` → back through `guardedFirestoreSave`. If a write is still in flight the recovery attempt is *also* queued and *also* returns premature success. The document can remain dirty across repeated recovery attempts.

### Distinction from Bug 8
Bug 8 is failure to *restart* sync after an offline start. This occurs while **fully online and correctly configured**. The Bug 8 reconnect fix does not address it. Fix both together (Doc 02 execution order Step 5).

### Fix sketch
Return a real promise for queued writes so callers await the actual outcome:

```js
if (slot.inFlight) {
  return new Promise((resolve) => {
    slot.queued = async () => { resolve(await saveFn()); };
  });
}
```
Replace `.catch(() => {})` with routing through `enqueueFailedWrite`.

---

## Bug 33 — Workspace switch can save a stale copy

**Verification: B — Code-traced, path-dependent**
**Priority: B**

### Location
`src/App.jsx` → `handleCanvasSwitch(targetWorkspaceId)` → ~line 4869

```js
const handleCanvasSwitch = useCallback(async (targetWorkspaceId) => {
  if (targetWorkspaceId === activeTabRef.current) return;
  const activeWs = workspaces.find(ws => ws.id === activeTabRef.current);  // ← closure read
  if (activeWs) { saveWorkspaceToLocal(activeProjectId, activeWs.id, { ... }); }
  if (isFirebaseConfigured()) { await flushPendingServerSaves(); }
  setActiveTab(targetWorkspaceId);
}, [workspaces, activeProjectId]);
```

### Fault
`workspaces` is read from the callback closure. The function correctly uses `activeTabRef.current` for the tab ID — demonstrating the author knew refs were needed here — but did not apply the same treatment to the workspace list.

### Mitigating factor
`workspaces` is in the dependency array, so the callback is recreated on every workspace change. The stale window is narrow. However the write also **omits `lastEditedByDevice`**, unlike the autosave path (~2168) which includes it — so a switch-triggered save leaves the device attribution stale even when the content is correct.

### Fix
Read from `stateRef.current.workspaces`, and include `lastEditedByDevice: getDeviceLabel()` for consistency with the autosave payload.

---

# Part 3 — Undo & History

> **Design-level analysis for this whole cluster lives in *06 — Undo & History System Design*.** This section records only the code evidence. Do not fix these individually — see Doc 06 for why.
>
> **✅ Decision D1 is now settled: history becomes per-workspace.** This changes the shape of the fix for Bugs 26, 27, and 39 — read Doc 06 Part 4 before writing any of them. In particular, per-workspace snapshots shrink each entry roughly 10×, which changes how Bug 27's depth cap should be sized.

## Bug 26 — Snapshots can capture stale state

**Verification: B — Code-traced, path-dependent**
**Priority: B**

### Location
`src/App.jsx` → `stateRef` declaration ~609, refresh effect ~1508, `takeSnapshot` ~2556

```js
const stateRef = useRef({ workspaces: defaultWorkspaces, activeTab: 'ws-1', nextId: 10 });   // ~609

useEffect(() => {
  stateRef.current = { workspaces, activeTab, nextId };     // ~1508 — runs AFTER render
}, [workspaces, activeTab, nextId]);

const takeSnapshot = useCallback(() => {                     // ~2556
  const newPast = [...pastRef.current, JSON.parse(JSON.stringify(stateRef.current))];
  updateHistory(newPast, []);
}, [updateHistory]);
```

### Fault
`stateRef` is refreshed in an effect, which React runs **after** commit. Any `takeSnapshot()` executed in the same tick as a preceding mutation reads the previous render's state.

### Narrowed scope (corrected from initial review)
Most call sites are safe because they follow the pattern `takeSnapshot(); mutate();` — the snapshot precedes the mutation and `stateRef` is current for the *previous* action. The exposed cases are handlers that mutate **and then** snapshot, and the four drag paths that deep-copy `stateRef.current` directly at ~7912, ~7962, ~8065, ~8213.

### Also note
`takeSnapshot` calls `updateHistory(newPast, [])` — the empty array **clears the redo stack**. This is correct and intentional; do not change it.

---

## Bug 27 — History grows without bound

**Verification: A — Proven by code**
**Priority: B — upgraded from initial assessment**

### Location
`src/App.jsx` → `updateHistory` ~2549

```js
const updateHistory = useCallback((past, future) => {
  pastRef.current = past;        // ← no cap, no pruning
  futureRef.current = future;
  setCanUndo(past.length > 0);
  setCanRedo(future.length > 0);
}, []);
```

### Fault
No maximum stack depth anywhere. Every entry is a **full deep copy of all workspaces** via `JSON.parse(JSON.stringify(...))`.

### Why this is worse than first assessed
`takeSnapshot` is called from **44 sites**, and critically it fires `onFocus` for every text editor (see Corrections Register). **Clicking into 100 card titles produces 100 full-project deep copies**, even if the user types nothing. On a project with 10 workspaces × 50 cards, each copy is hundreds of kilobytes.

Appends occur at ~2558 (`takeSnapshot`), ~2569 (`performUndo`), ~2584 (`performRedo`), and the four drag paths ~5650, ~5703, ~5712, ~5754.

### Only reset point
Project switch — `pastRef.current = []` at ~4402 and ~4498. **Workspace switch does not clear history** (see Bug 39).

---

## Bug 39 — Undo is global and reverts unrelated workspaces ⭐ NEW

**Verification: A — Proven by code**
**Priority: B**
**Not previously reported. Discovered while writing this document.**

### Location
`src/App.jsx` → `performUndo` ~2561, `performRedo` ~2576

```js
const performUndo = useCallback(() => {
  const newPast = [...pastRef.current];
  const prev = newPast.pop();
  const newFuture = [JSON.parse(JSON.stringify(stateRef.current)), ...futureRef.current];
  updateHistory(newPast, newFuture);
  setWorkspaces(prev.workspaces);      // ← replaces ALL workspaces
  setActiveTab(prev.activeTab);        // ← teleports the user
  setNextId(prev.nextId);
}, [updateHistory, isPreviewMode]);
```

### The bug
Snapshots capture `{ workspaces, activeTab, nextId }` — **whole application state**. Undo replaces all of it.

Reproduction:
1. Edit a card in Workspace A.
2. Switch to Workspace B. *(History is not cleared on workspace switch.)*
3. Edit a card in Workspace B.
4. Press Ctrl+Z.

**Result:** Workspace B's edit is reverted (expected), Workspace A's edit is **also** reverted (not expected), and the user is **teleported back to Workspace A** because `setActiveTab(prev.activeTab)` restores the old tab.

### Why this matters architecturally
Doc 01 Stage 4 records that persistence was deliberately moved from project-level to workspace-level to reduce the conflict surface. **The undo system was never migrated to match.** It remains project-global, contradicting the workspace-scoped model the rest of the application follows.

This also interacts with Bug 24: an undo after a cross-workspace leak would revert *both* workspaces — which happens to be desirable here, but only by accident.

### Design decision required
Should history be per-workspace or global? This is not a mechanical fix. See **Doc 06 § Design Question 1**.

---

## Bug 38 — Undo variable shadowing

**Verification: C — Latent**
**Priority: C**

### Location
`src/App.jsx` ~2564

```js
const prev = newPast.pop();      // named identically to the state-updater convention
...
setWorkspaces(prev.workspaces);  // passing a VALUE that looks like an updater param
```

### Fault
React state setters accept either a value or an updater function. `prev.workspaces` is a value, so this works. But if a snapshot were ever malformed and `prev.workspaces` were `undefined`, React treats `undefined` as *no update* and the undo **silently does nothing** — no error, no console warning. The variable name actively misleads a reader into thinking this is the updater form.

### Fix
Rename to `snapshot` / `restored`, and validate shape before applying:
```js
if (!snapshot || !Array.isArray(snapshot.workspaces)) {
  console.error('[History] Malformed snapshot, refusing to apply', snapshot);
  return;
}
```

---

# Part 4 — State Management

## Bug 31 — Nested state update during task deletion

**Verification: A — Proven by code**
**Priority: B**

### Location
`src/App.jsx` → `deleteTask(taskId)` → ~line 6085

```js
const deleteTask = (taskId) => {
  if (isPreviewMode) return;
  setTasks(prev => {
    const task = prev.find(t => t.id === taskId);
    if (task && task.locationPinId) {
      setWorkspaces(wsArr => wsArr.map(ws => ({          // ← setter inside a setter
        ...ws,
        pins: (ws.pins || []).filter(p => p.id !== task.locationPinId),
      })));
    }
    return prev.filter(t => t.id !== taskId);
  });
};
```

### Fault
`setWorkspaces` is invoked from inside the `setTasks` updater. Under React 18 automatic batching the nested update can be scheduled against a workspace state that does not reflect earlier updates in the same batch. React updater functions are also expected to be **pure** — side effects inside them may run more than once in Strict Mode development builds, deleting pins twice.

### The correct pattern already exists in this file
`bulkDeleteTasks` (~6100) does it right:
```js
const tasksToDelete = tasks.filter(t => taskIds.includes(t.id));
const pinIdsToConvert = tasksToDelete.filter(t => t.locationPinId).map(t => t.locationPinId);
if (pinIdsToConvert.length > 0) { setWorkspaces(/* ... */); }   // outside
setTasks(prev => prev.filter(t => !taskIds.includes(t.id)));     // separate
```

### Second defect in the same function — behavioural inconsistency

The two deletion paths **disagree on what happens to the linked pin**:

| Path | Pin outcome | Location |
| --- | --- | --- |
| `deleteTask` (single) | Pin is **removed** from all workspaces | ~6090 `pins: (ws.pins \|\| []).filter(p => p.id !== task.locationPinId)` |
| `bulkDeleteTasks` (multi) | Pin is **converted to standalone** (`pinGroupId: 'default'`) | ~6113 |

Deleting one task and selecting that same task then bulk-deleting produce **different outcomes**. The single-task path destroys a canvas object; the bulk path preserves it.

### ✅ Owner decision D2 — convert to standalone

**`deleteTask` must be changed to convert the pin to standalone, matching `bulkDeleteTasks`.** The bulk path's behaviour is correct.

Rationale (consistent with Doc 01 Principle 1 — data safety over convenience): a pin is a canvas object the user placed deliberately and may have connected to surrounding cards. Deleting a *task* should not silently destroy a *canvas* object. Preserving the pin is the non-destructive choice, and it makes the single and bulk paths agree.

### Combined fix

Restructure `deleteTask` to mirror `bulkDeleteTasks` on **both** counts — compute outside the setter, and convert rather than remove:

```js
const deleteTask = (taskId) => {
  if (isPreviewMode) return;
  // 1. Read from live state BEFORE entering any setter (fixes the nesting fault).
  const task = tasks.find(t => t.id === taskId);
  const pinId = task && task.locationPinId;

  // 2. Convert the pin to standalone rather than deleting it (decision D2).
  if (pinId) {
    setWorkspaces(wsArr => wsArr.map(ws => ({
      ...ws,
      pins: (ws.pins || []).map(p =>
        p.id === pinId ? { ...p, pinGroupId: 'default' } : p
      ),
    })));
  }

  // 3. Remove the task in an independent update.
  setTasks(prev => prev.filter(t => t.id !== taskId));
};
```

### Note for the fix author
`bulkDeleteTasks` sets `pinGroupId: 'default'` but does **not** clear `locationPinId` / `locationWorkspaceId` on the task — irrelevant there because the task is being deleted. Confirm no other code treats a pin with `pinGroupId: 'default'` as orphaned in a way that would hide it from the Pin Panel. `PinPanel.jsx` receives `pinGroups` and should be checked for how it renders the `'default'` group.

---

# Part 5 — UI Correctness

## Bug 32 — `<select>` type-ahead broken by R and S shortcuts (CORRECTED)

**Verification: A — Proven by code**
**Priority: C**

> See Corrections Register — the original `contentEditable` claim was invalid.

### Guard audit

All 18 `e.target.tagName === 'INPUT'` guards in App.jsx, classified:

| Location | Handler | SELECT | contentEditable | Status |
| --- | --- | --- | --- | --- |
| ~683 | Shift+D descriptions | ✅ | ✅ | OK |
| ~2777 | Ctrl+Z/Y/C/X/V | ➖ | ✅ | OK |
| ~3436 | Ctrl+Z/C/X/V (2nd) | ➖ | ✅ | OK |
| **~3609** | **R — reminder panel** | **❌** | **❌** | **DEFECT** |
| **~3903** | **S — sidebar** | **❌** | **❌** | **DEFECT** |
| ~3512, 3530, 3573, 3623, 3637, 3651, 3678, 3692, 3917, 3932 | E, C, T, A, M, P, W, F, L, N | ✅ | ✅ | OK |
| ~3965 | Arrow keys | ✅ | ❌ | OK (no contentEditable exists) |

### The two real defects

```js
// ~3609 — R key
const handleReminderKey = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;   // no SELECT
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setShowReminderPanel(prev => !prev); }
};

// ~3903 — S key
const handleSidebarKey = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;   // no SELECT
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (e.key === 's') { e.preventDefault(); setShowSidebar(prev => !prev); }
};
```

### Actual symptom
There are **8 `<select>` elements**: 5 in `FullTaskManager.jsx`, 2 in `PinPanel.jsx`, 1 in `ReminderPanel.jsx`. Native `<select>` supports letter type-ahead. With a dropdown focused:

- Pressing **r** → the Reminder Panel toggles **and** `preventDefault()` blocks the native jump-to-option.
- Pressing **s** → the sidebar toggles, same suppression.

Most visible in the Reminder Panel itself, where pressing "r" closes the panel the user is working in.

### Fix
Extract one shared guard and route all handlers through it — this also prevents the next handler from omitting a case:

```js
const shouldIgnoreKeyEvent = (e) => {
  const t = e.target;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
         t.tagName === 'SELECT' || t.isContentEditable;
};
```

---

## Bug 35 — Wheel `preventDefault` is a no-op (CORRECTED)

**Verification: A — Proven by code**
**Priority: C**

> See Corrections Register — the original "blocks panel scrolling" claim was invalid in both directions.

### Location
`src/App.jsx` → `handleWheel` ~906, bound via `onWheel={handleWheel}` at ~7818

### The facts

- React `^18.3.1` (`package.json`) attaches `wheel` as a **passive** listener on the root container.
- `e.preventDefault()` at ~907 is therefore **ineffective**; Chrome logs *"Unable to preventDefault inside passive event listener invocation."*
- `<main>` spans ~7811–8899. All panels render **after** `</main>` as siblings, so they never reach this handler and were never affected.

### Actual symptom
The handler intends to suppress native scrolling while zooming and fails. Any scrollable ancestor scrolls simultaneously with the zoom, and browser/OS page-zoom gestures are not suppressed.

### Fix
Bind a native non-passive listener instead of relying on the React prop:

```js
useEffect(() => {
  const el = workspaceRef.current;
  if (!el) return;
  const onWheelNative = (e) => { e.preventDefault(); /* zoom logic */ };
  el.addEventListener('wheel', onWheelNative, { passive: false });
  return () => el.removeEventListener('wheel', onWheelNative);
}, [/* deps */]);
```

---

## Bug 34 — Export of selected cards pulls the whole graph

**Verification: A — Proven by code**
**Priority: B**

### Location
`src/App.jsx` → `exportSelectedNodes(nodeIds)` → ~line 4939

```js
const collectedIds = new Set(nodeIds);
const queue = [...nodeIds];
while (queue.length > 0) {
  const current = queue.shift();
  if (visited.has(current)) continue;
  visited.add(current);
  collectedIds.add(current);
  const childEdges = edges.filter(e => e.source === current);   // follows ALL outgoing edges
  childEdges.forEach(e => { if (!visited.has(e.target)) queue.push(e.target); });
}
```

### Fault
Unbounded breadth-first traversal of outgoing connections. Selecting one card connected to a hub node exports the entire reachable subgraph. No depth limit, no user indication of how many cards will actually be written.

### Why this is Priority B rather than C
The output is a `.json` file the user may keep as a **backup**. A backup whose contents do not match what was selected is a data-integrity concern, not cosmetic. Doc 01 Principle 1 (data safety over convenience) applies.

### Fix
Export exactly the selection plus edges where both endpoints are selected. If descendant inclusion is wanted, make it an explicit opt-in with a card count shown before export.

---

## Bug 37 — Selection box first-frame flicker

**Verification: B — Code-traced, path-dependent**
**Priority: C**

### Location
`src/App.jsx` → `handlePointerMove` ~5470

```js
if (isMultiSelecting && selectionBox) {
  const coords = getWorkspaceCoords(e);
  setSelectionBox(prev => prev ? { ...prev, endX: coords.x, endY: coords.y } : null);
  const minX = Math.min(selectionBox.startX, coords.x);   // ← closure read, not the value just set
  ...
}
```

### Fault
The hit test reads the box origin from the callback closure rather than from live state. On the first move event after pointer-down, `selectionBox` in the closure may still be the pre-update value.

### Fix
Store the pointer-down origin in a ref (`selectionOriginRef`) and compute the hit test from it. Refs are already used correctly for `draggingNodeRef` at ~5497 — same pattern.

---

## Bug 36 — Timer interval stale closure

**Verification: C — Latent**
**Priority: C**

### Location
`src/App.jsx` → timer countdown effect ~1933

```js
useEffect(() => {
  if (timerRunning && !timerPaused && timerSeconds > 0) {
    timerIntervalRef.current = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          setTimerRunning(false);
          setTimerDone(true);
          setTimerNotification(true);
          try { /* Web Audio beep */ } catch (e) { }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }
  return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
}, [timerRunning, timerPaused]);        // ← timerSeconds omitted
```

### Why it currently works
`timerSeconds` is omitted from dependencies, but the countdown uses the functional updater form (`prev => prev - 1`) so it never reads the stale closure value. The `timerSeconds > 0` entry condition is evaluated only when the effect re-runs, which is acceptable because `startTimer` sets seconds and `timerRunning` together.

### Why it is still a defect
Terminal-state side effects (stop, mark done, notify, play sound) execute **inside a state updater**, which React expects to be pure. In Strict Mode development builds the updater may run twice — producing a double beep and a duplicated notification. Any future edit that reads `timerSeconds` directly inside the interval will silently use a stale value.

### Fix
Move terminal-state handling into a separate effect watching for zero:
```js
useEffect(() => {
  if (timerRunning && timerSeconds === 0) { setTimerRunning(false); setTimerDone(true); setTimerNotification(true); playBeep(); }
}, [timerSeconds, timerRunning]);
```

---

# Part 6 — Validation Gaps

## Bug 19 — Validator has no uniqueness checks

**Verification: A — Proven by code**
**Priority: B**

### Location
`src/workspaceValidator.js` → `validateWorkspaces(workspaces, context, tasks)` → ~line 25

### What it actually checks

| Check | Lines |
| --- | --- |
| Every node/group/pin/image has a `workspaceId` | ~57–125 |
| That `workspaceId` refers to an existing workspace | same |
| Warns when `obj.workspaceId !== ws.id` | same |
| Edge `source`/`target` resolve within the same workspace | ~145–158 |
| Task ↔ pin ↔ workspace consistency | ~161–196 |

### The gap

```js
const objectIds = new Set();          // ~48
...
for (const node of nodes) {
  objectIds.add(node.id);             // ~57 — added, never tested for prior membership
  ...
}
```

`objectIds` is populated and then used **only** for edge-endpoint resolution. There is no `if (objectIds.has(id))` uniqueness assertion anywhere — not within a workspace, not across workspaces. `cloneSourceId` targets are never validated either, so dangling clone references (Bug 17) are equally invisible.

### The second gap
`duplicateNodeIds` in App.jsx ~2604:
```js
const duplicateNodeIds = useMemo(() => {
  const seen = new Set(); const dupes = new Set();
  for (const n of nodes) (seen.has(n.id) ? dupes : seen).add(n.id);
  return dupes;
}, [nodes]);                          // ← `nodes` = ACTIVE workspace only
```

`nodes` is derived from `activeWs` (~2596). **The cross-workspace collision behind Bug 24 is never flagged, even in development builds.** The detector's own comment describes exactly the corruption it cannot see.

### Fix requirement
The guardrail must assert uniqueness **project-wide**, across all workspaces, and must validate `cloneSourceId` resolvability. Per-workspace checking is insufficient for the highest-severity bug in the tracker.

### Where it is invoked
App.jsx ~1344 (after init migration), ~4917 (before export), ~4432/4522 (after project switch/cycle), ~5033 (after import), ~5100 (after full-backup import). All gated on `import.meta.env.DEV`.

---

## Bug 23 — Reminder detection stalls (confirmation)

**Verification: A — Proven by code**
**Priority: B**

### Location
`src/App.jsx` → reminder scheduling engine ~3760, guard at ~3817

```js
reminderCheckIntervalRef.current = setInterval(() => {
  const now = Date.now();
  if (reminderNotificationRef.current) return;      // ← aborts the entire detection pass
  ...
}, 60000);
```

### Why the guard is broader than it looks

```js
useEffect(() => {                                   // ~3745
  reminderNotificationRef.current =
    (reminderNotificationQueue.length > 0 || visibleReminders.length > 0) ? true : null;
}, [reminderNotificationQueue, visibleReminders]);
```

The ref is truthy whenever anything is pending **or** on screen. With `REMINDER_LIFETIME_MS = 12000` and `REMINDER_STACK_MAX = 3`, a full stack keeps it truthy for a sustained period.

### The compounding effect
Bug 21's fix (PR #22, the staggered stack) **lengthened** on-screen time from 8s single-toast to up to 12s × 3 staggered. The suppression window grew. **PR #22 measurably worsens the missed-reminder problem it was built to solve, unless Bug 23 lands with it.**

### Consequence
A reminder falling due inside the suppression window is never detected, and `nextReminderAt` is never advanced — so it does not fire late, it is skipped entirely until the next natural interval.

---

# Appendix A — Bug ID → Location index

| Bug | Priority | Verification | File | Function |
| --- | --- | --- | --- | --- |
| 16 | A | B | App.jsx | 10 creation sites + 11 load paths |
| 19 | B | A | workspaceValidator.js | `validateWorkspaces` |
| 23 | B | A | App.jsx | reminder interval ~3817 |
| **24** | **A** | **A** | **App.jsx** | **`updateNode` ~6403** |
| ~~25~~ | — | — | — | 🚫 **RETIRED — wrong detection. Number not reused.** |
| 26 | B | B | App.jsx | `stateRef` ~609 / `takeSnapshot` ~2556 |
| 27 | B | A | App.jsx | `updateHistory` ~2549 |
| 28 | A | A | App.jsx | `duplicateProject` ~4588 |
| 29 | A | B | App.jsx | `cutNode` / `pasteNode` ~2828 |
| 30 | A | A | persistenceService.js | `guardedFirestoreSave` ~739 |
| 31 | B | A | App.jsx | `deleteTask` ~6085 |
| 32 | C | A | App.jsx | `handleReminderKey` ~3609, `handleSidebarKey` ~3903 |
| 33 | B | B | App.jsx | `handleCanvasSwitch` ~4869 |
| 34 | B | A | App.jsx | `exportSelectedNodes` ~4939 |
| 35 | C | A | App.jsx | `handleWheel` ~906 |
| 36 | C | C | App.jsx | timer effect ~1933 |
| 37 | C | B | App.jsx | `handlePointerMove` ~5470 |
| 38 | C | C | App.jsx | `performUndo` ~2564 |
| **39** | **B** | **A** | **App.jsx** | **`performUndo` ~2561 / `performRedo` ~2576** |

---

# Appendix B — Testing infrastructure gap

**This is the single largest risk multiplier in the project and is not currently tracked in Doc 02.**

The repository has:
- No test script in `package.json`
- No testing dependency (no Vitest, Jest, Testing Library, Playwright)
- No test files in `src/`
- No CI configuration

Consequences for the remediation plan:

1. **Every fix in the execution order will be verified manually or not at all.** The card-identity cluster (Bugs 16, 24, 28, 29) involves subtle multi-workspace state — precisely the category humans verify unreliably.
2. **Regression is likely.** Bug 24 is latent-by-default: it only appears when IDs collide. A future change could reintroduce it and nobody would notice until a user reports data loss again.
3. **The UUID migration (Bug 16) is high-risk without tests.** It touches 10 creation sites, 11 load paths, and requires one-time reconciliation of existing numeric-ID projects.

### Minimum viable recommendation

Before starting the UUID migration, add Vitest and **three** pure-function tests. This requires no UI test infrastructure because the functions are extractable:

| Test | Target | Asserts |
| --- | --- | --- |
| 1 | Extracted `updateNode` reducer | An edit to a card in workspace A leaves an identically-ID'd card in workspace B untouched |
| 2 | `validateWorkspaces` | A project with a duplicate card ID across two workspaces produces an error |
| 3 | Extracted ID allocator | 1000 sequential allocations across simulated workspace switches yield zero duplicates |

Test 1 is the regression guard for the bug that caused the original user report. It is worth more than the other two combined.

**Suggested addition to Doc 02:** track this as its own entry rather than leaving it implicit, so it appears in the execution order rather than being assumed.
