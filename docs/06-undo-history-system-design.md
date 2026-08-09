# 06 — Undo & History System Design

## Purpose

This document exists because **four separate tracker entries (Bugs 26, 27, 38, 39) are symptoms of one subsystem that was never designed.**

Fixing them independently would produce four inconsistent patches that interfere with each other:

- The fix for **Bug 27** (cap the history stack) changes what **Bug 39** (global undo scope) can guarantee.
- The fix for **Bug 26** (stale snapshot source) replaces the mechanism that **Bug 38** (variable shadowing) sits inside.
- Any change to snapshot *granularity* alters memory characteristics, so Bug 27 cannot be sized without first answering Bug 39.

This document therefore specifies the subsystem once, records the decisions the owner must make, and defines the implementation order.

**Scope:** the in-session undo/redo stack only. Cloud version history (`createSnapshot` / `listSnapshots` / `restoreSnapshot` in `persistenceService.js`) is a **separate system** and is out of scope — see § Relationship to Cloud Version History.

---

## Why this matters under the project's own principles

*Doc 01 — Project Memory* establishes that data safety outranks convenience (Principle 1) and that amplifier bugs are treated as near-critical (Principle 10). The undo system currently sits in an awkward position relative to those principles:

- The **cloud** side of data safety has received substantial investment: per-document sync state, base revisions, content fingerprints, conflict backups, tombstones, transactional writes, snapshot retention.
- The **local, in-session** side has received none. There is no design document, no capacity limit, and no scope model.

Doc 01 Stage 14 records the lesson directly: *"Data safety is not only about the cloud. Losing a paragraph the user just typed, with no way to recover it, is data loss regardless of how faithfully it was persisted."*

Undo is the user's only in-session recovery mechanism. It deserves the same deliberate treatment the sync layer received.

---

# Part 1 — Current implementation (as-is)

## 1.1 Data structures

```js
const pastRef    = useRef([]);   // App.jsx ~604 — undo stack
const futureRef  = useRef([]);   // App.jsx ~605 — redo stack
const stateRef   = useRef({ workspaces: defaultWorkspaces, activeTab: 'ws-1', nextId: 10 });  // ~609
const dragSnapshot = useRef(null);  // ~610 — holds a pre-drag snapshot until pointer-up

const [canUndo, setCanUndo] = useState(false);
const [canRedo, setCanRedo] = useState(false);
```

`stateRef` is refreshed in an effect:

```js
useEffect(() => {                                        // ~1508
  stateRef.current = { workspaces, activeTab, nextId };
}, [workspaces, activeTab, nextId]);
```

## 1.2 Snapshot shape

A snapshot is a **full deep copy of three values**:

```js
{ workspaces, activeTab, nextId }
```

`workspaces` is the entire array — every workspace, every card, edge, group, pin, and image in the project. Produced by `JSON.parse(JSON.stringify(...))`.

**Not captured:** tasks, taskGroups, reminders, pinGroups, transform (camera), selection. Task and reminder mutations are therefore not undoable at all — an intentional-looking omission that has never been documented as a decision.

## 1.3 Core operations

```js
const updateHistory = useCallback((past, future) => {     // ~2549
  pastRef.current = past;
  futureRef.current = future;
  setCanUndo(past.length > 0);
  setCanRedo(future.length > 0);
}, []);

const takeSnapshot = useCallback(() => {                  // ~2556
  const newPast = [...pastRef.current, JSON.parse(JSON.stringify(stateRef.current))];
  updateHistory(newPast, []);                             // [] clears redo — correct
}, [updateHistory]);

const performUndo = useCallback(() => {                   // ~2561
  if (isPreviewMode) return;
  if (pastRef.current.length === 0) return;
  const newPast = [...pastRef.current];
  const prev = newPast.pop();
  const newFuture = [JSON.parse(JSON.stringify(stateRef.current)), ...futureRef.current];
  updateHistory(newPast, newFuture);
  setWorkspaces(prev.workspaces);
  setActiveTab(prev.activeTab);
  setNextId(prev.nextId);
}, [updateHistory, isPreviewMode]);
```

`performRedo` (~2576) is the mirror image using `shift()`.

## 1.4 Snapshot trigger inventory

`takeSnapshot()` is called from **44 sites**. Grouped by trigger type:

| Trigger type | Count | Representative sites | Notes |
| --- | --- | --- | --- |
| **Text edit session start** | 5 | ~6842, ~8265, ~8298, ~8310; CardEditorPanel ~179, ~192 | `onFocus` / entry-click. **This is correct coalescing.** |
| **Discrete mutations** | ~30 | `deleteNode`, `duplicateNode`, `cloneNode`, `createGroup`, `deleteGroup`, `clearAllNodes`, `removeEdge`, theme pickers, link pickers, `autoAlignWorkspace`, `disperseOverlappingNodes` | Pattern is `takeSnapshot(); mutate();` |
| **Clipboard** | 4 | `pasteNode`, `pasteGroup`, `pasteMultiSelection`, `executePartialImport` | |
| **Workspace management** | 3 | `addWorkspace`, `deleteWorkspace`, `duplicateWorkspace` | |
| **Drag / resize (deferred)** | 4 | ~7912, ~7962, ~8065, ~8213 write `dragSnapshot.current`; committed at ~5650, ~5703, ~5712, ~5754 | Bypasses `takeSnapshot()` entirely — appends directly to `pastRef` |

### The deferred-drag path

Drags do not snapshot on pointer-down. They stash a copy:

```js
dragSnapshot.current = JSON.parse(JSON.stringify(stateRef.current));   // pointer-down, ~7912
```

…and commit it on pointer-up **only if movement exceeded a threshold**:

```js
if (dragSnapshot.current) {                                            // ~5650
  const newPast = [...pastRef.current, dragSnapshot.current];
  updateHistory(newPast, []);
}
```

This is a genuinely good design — a click that does not move should not create a history entry. But it means **there are two independent code paths that append to the undo stack**, and any capacity limit must be enforced in both. Currently neither enforces one.

## 1.5 Reset points

| Event | History cleared? | Location |
| --- | --- | --- |
| Project switch (`switchProject`) | ✅ Yes | ~4402 |
| Project switch (`cycleToProject`) | ✅ Yes | ~4498 |
| **Workspace switch** | ❌ **No** | — |
| Preview mode enter/exit | ❌ No | — |
| Snapshot restore (`restoreSnapshot`) | ❌ No | — |
| Import (`handleImport`, `importAllData`) | ❌ No | — |

The three ❌ entries at the bottom are the source of Bug 39 and of a further defect noted in § 2.5.

---

# Part 2 — Defects

## 2.1 Bug 27 — No capacity limit (Priority B, proven)

`updateHistory` assigns arrays directly. There is no maximum depth, no pruning, no eviction.

**Amplified by the `onFocus` snapshot pattern.** Because text editors snapshot on focus, *clicking into* a card title produces a full-project deep copy even if the user types nothing. Clicking through 100 cards to read them creates 100 snapshots.

Rough sizing — a 10-workspace project with 50 cards each, ~200 characters of content per card:

| Quantity | Estimate |
| --- | --- |
| Serialised size of one snapshot | ~300–600 KB |
| Snapshots after a 1-hour session | 100–400 |
| Retained history memory | **30 MB – 240 MB** |

Every entry is retained for the whole session (or until a project switch). There is no upper bound.

## 2.2 Bug 39 — History is global, users perceive it as local (Priority B, proven)

A snapshot captures **all** workspaces; undo replaces **all** of them and restores `activeTab`.

Reproduction:
1. Edit a card in Workspace A
2. Switch to Workspace B *(history not cleared)*
3. Edit a card in Workspace B
4. Ctrl+Z

Result: B's edit reverts (expected). **A's edit also reverts** (not expected). The user is **teleported to Workspace A** by `setActiveTab(prev.activeTab)`.

**This contradicts the project's own architecture.** Doc 01 Stage 4 records that persistence was deliberately moved from project-level to workspace-level to shrink the conflict surface. The undo system was never migrated to match and remains project-global.

## 2.3 Bug 26 — Snapshot source lags one render (Priority B, code-traced)

`stateRef` is refreshed in a `useEffect`, which runs after commit. A `takeSnapshot()` in the same tick as a preceding mutation reads the previous render's state.

Most call sites are safe because they follow `takeSnapshot(); mutate();` — the snapshot precedes its own mutation. The exposed cases are handlers that mutate then snapshot, and the four drag paths that deep-copy `stateRef.current` directly.

## 2.4 Bug 38 — Misleading variable name, silent-failure risk (Priority C, latent)

`const prev = newPast.pop()` uses the conventional state-updater parameter name for a plain value, then passes it to setters. If a snapshot were malformed and `prev.workspaces` were `undefined`, React interprets `undefined` as *no update* — the undo silently does nothing, with no error.

## 2.5 Undocumented: history survives destructive replacements

Not currently in the tracker; **recommend filing.**

`restoreSnapshot` (~2? in App.jsx), `handleImport`, and `importAllData` all call `setWorkspaces(...)` with entirely new data **without clearing the history stack**. The undo stack still holds snapshots from *before* the replacement.

Consequence: after restoring a cloud version, pressing Ctrl+Z reverts to the pre-restore state — silently discarding the restore. `restoreSnapshot` does create a `'pre-restore'` cloud snapshot first, so the data is recoverable, but the interaction is confusing and the two history systems fight each other.

`importAllData` is worse: it replaces **all projects**, and the surviving undo stack references workspace IDs that may no longer exist.

## 2.6 Undocumented: incomplete coverage

Not currently in the tracker; **recommend filing as a documented limitation rather than a bug**, pending owner decision.

| Mutation | Undoable? |
| --- | --- |
| Cards, edges, groups, images (canvas) | ✅ |
| Pins | ⚠️ Partially — `addPin` does **not** snapshot; `deletePin` does not snapshot |
| Tasks / task groups | ❌ Not captured in snapshots at all |
| Reminders | ❌ Not captured |
| Pin groups | ❌ Not captured |
| Workspace rename | ❌ `renameWorkspace` does not snapshot |
| Card z-order (`bringToFront` / `sendToBack`) | ❌ Neither snapshots |

Deleting a task is irreversible. Deleting a reminder is irreversible. Neither is documented as a limitation anywhere.

---

# Part 3 — Decisions

## Decision status

| # | Question | Status | Answer |
| --- | --- | --- | --- |
| **1** | Undo scope — per-workspace or global? | ✅ **DECIDED (Chat 11)** | **Per-workspace (Option A)** |
| **2** | History depth | ⬜ Open — recommendation stands | 50 entries per workspace |
| **3** | Tasks / reminders undoable? | ⬜ Open | — |
| **4** | Diff-based storage? | ⬜ Open — recommendation stands | Keep snapshots |

A related decision was also settled and is recorded in Doc 05 under Bug 31:

| # | Question | Status | Answer |
| --- | --- | --- | --- |
| **D2** | `deleteTask` removes the linked pin; `bulkDeleteTasks` converts it to standalone. Which is correct? | ✅ **DECIDED (Chat 11)** | **Convert to standalone** — `deleteTask` changes to match the bulk path |

Decision 1 was the only blocker for Phase 3. **Phases 0–3 are now fully specified and unblocked.** Only Phase 4 still waits on Decision 3.

---

## Decision 1 — Undo scope ✅ DECIDED: per-workspace

**The owner has selected Option A. History becomes per-workspace.**

### Consequences of this decision

| Area | Effect |
| --- | --- |
| **Bug 39** | Fully resolved. Ctrl+Z affects only the workspace on screen; no teleporting. |
| **Bug 27** | Largely resolved as a side effect — each snapshot holds one workspace instead of all, roughly a 10× size reduction on a 10-workspace project. |
| **Workspace switch** | No longer needs to clear history. Each workspace retains its own stack, which is a usability gain over the alternative. |
| **`activeTab` in snapshots** | Removed entirely. Undo never navigates. |
| **Accepted limitation** | `cloneNodeToWorkspace` and cross-workspace cut-paste span two workspaces. Undoing from the source will not reverse the effect in the target. This is a deliberate trade — see below. |

### The accepted limitation, stated plainly

Two operations write to a workspace other than the active one:

- `cloneNodeToWorkspace` (App.jsx ~6336) — creates a clone in a target workspace
- Cross-workspace cut-paste (`pasteNode` ~2828, `pasteGroup` ~2974, `pasteMultiSelection` ~3260) — removes from the source workspace, adds to the active one

Under per-workspace history, undoing one of these from the workspace you are standing in will not reverse the half that landed elsewhere.

**Why this is acceptable:** the behaviour is *predictable and explainable* — "undo affects this canvas." Bug 39's current behaviour is neither predictable nor visible: it silently mutates workspaces the user cannot see. A limitation the user can learn is strictly better than a surprise they cannot.

**Recommended mitigation (not a blocker):** show a toast on cross-workspace operations — e.g. *"Cloned to Map Phase 2 — undo only affects this canvas."* This makes the boundary visible at the moment it matters. `showToast` already exists (~2616).

> ⚠️ **One risk worth flagging before implementation.** Cross-workspace cut-paste is the more dangerous of the two, because it *removes* data from the source workspace. Under per-workspace history, if the user cuts from workspace A, pastes into B, then undoes in B, the paste is reversed but **the card is not restored to A** — it is gone from both. This is a data-loss path that global history accidentally protected against.
>
> This must be addressed as part of Phase 3, not deferred. Two options:
> 1. **Record cut-paste in the source workspace's stack too** (a narrow application of Option C, limited to cut operations only), or
> 2. **Convert cross-workspace cut into copy-then-delete**, requiring the user to delete the source explicitly.
>
> Option 1 is preferred — it keeps the feature intact. Option 2 is simpler but changes user-facing behaviour. **This needs a decision during Phase 3 design, and it interacts with Bug 29 (cut-paste deletes the wrong card), so fix them together.**

### Options not chosen (kept for the record)

#### Option A — Per-workspace history ✅ SELECTED

Each workspace owns its own undo stack. Ctrl+Z only ever affects the workspace on screen.

| Pros | Cons |
| --- | --- |
| Matches user mental model — undo affects what you can see | Cross-workspace operations (`cloneNodeToWorkspace`, cut-paste across workspaces) span two stacks and need a defined rule |
| Aligns with Stage 4's workspace-level architecture | More bookkeeping |
| No teleporting between workspaces | Multi-workspace ops become non-atomic in history |
| **Snapshots shrink to one workspace → 10× smaller, largely resolving Bug 27** | |
| Switching workspaces no longer needs to clear history | |

#### Option B — Global history, but stop restoring `activeTab` ❌ not chosen

Minimal change: keep whole-project snapshots, delete `setActiveTab(prev.activeTab)`.

| Pros | Cons |
| --- | --- |
| Two-line change | Still reverts edits in workspaces the user cannot see — the core of Bug 39 remains |
| No structural risk | Snapshot size unchanged, so Bug 27 needs a separate fix |
| | Undo can silently change off-screen data — arguably worse than teleporting, because it is invisible |

#### Option C — Per-workspace, with cross-workspace ops recorded in both stacks ❌ not chosen as the general model

Option A plus: an operation touching two workspaces pushes a linked entry into both, undone together.

| Pros | Cons |
| --- | --- |
| Correct in all cases | Meaningfully more complex |
| | Undoing from workspace B would have to jump to A — reintroducing teleporting for this narrow case |

**Partially retained.** Option C's mechanism is the recommended answer to the cut-paste data-loss risk flagged above — applied **only** to cut operations, not adopted as the general model.

## Decision 2 — History depth

| Option | Memory (per-workspace snapshots) | Notes |
| --- | --- | --- |
| 20 entries | ~1 MB | May feel restrictive during heavy editing |
| **50 entries** | **~2–3 MB** | **Recommended** |
| 100 entries | ~5 MB | Generous; still bounded |
| Size-budget instead of count | Fixed ceiling | More complex; entry sizes vary widely |

**Recommendation: 50 entries per workspace, evicting oldest.** With Option A snapshots this is a few MB total. If Option B is chosen for Decision 1, reduce to **20** — whole-project snapshots are ~10× larger.

## Decision 3 — Should tasks and reminders be undoable? ⬜ OPEN

Currently not captured at all. Task deletion is irreversible.

| Option | Assessment |
| --- | --- |
| Leave as-is, **document the limitation** | Cheapest. Acceptable only if the owner accepts irreversible task deletion. |
| Add tasks to snapshots | Tasks are project-scoped, not workspace-scoped — **now confirmed to conflict with per-workspace history** following Decision 1. Would need a second, project-scoped stack. |
| Separate undo for the Task Panel | Cleanest but a distinct feature. |

**Recommendation: document the limitation now, defer the feature.** Task deletion already has a confirmation dialog (`showDeleteConfirm` in `FullTaskManager.jsx`), which is a reasonable substitute for undo. Reminder deletion does not — **adding a confirmation there is a cheap partial mitigation** and should be done regardless.

**Decision 1 strengthens this recommendation.** Now that history is per-workspace, tasks cannot share the same structure at all — they are project-scoped. Adding task undo means building a second, separate stack with its own lifecycle rules. That is a feature, not a fix, and should not be bundled into this work.

### Note: Decision D2 partially mitigates the task-deletion risk

The related decision to make `deleteTask` **convert its linked pin to standalone** rather than delete it (Doc 05 Bug 31) removes the most damaging consequence of irreversible task deletion. Previously, deleting a task destroyed a canvas object with no undo path. After D2, the pin survives — so the irreversible part is limited to the task record itself, which is far less costly.

This makes deferring Decision 3 more comfortable than it was before.

## Decision 4 — Diff-based storage instead of snapshots?

| Option | Assessment |
| --- | --- |
| **Keep full snapshots (per-workspace)** | Simple, obviously correct, already the pattern. With Option A the memory case is acceptable. **Recommended.** |
| Store forward/inverse diffs | 10–50× smaller, but every mutation type needs an inverse operation and any missed one corrupts history silently. |

**Recommendation: keep snapshots.** This follows Doc 01 Principle 2 ("simpler architecture is preferred over smarter architecture") and Principle 8 ("remain understandable enough that bugs can be diagnosed quickly"). A diff system that is subtly wrong would produce exactly the class of silent corruption this project is trying to eliminate. Per-workspace snapshots make the memory problem small enough that the complexity is not justified.

---

# Part 4 — Design

> **Decision 1 is settled: per-workspace.** This design is therefore binding, not provisional.
> Depth (50) and storage (snapshots) remain recommendations pending Decisions 2 and 4, but neither changes the structure below.

## 4.1 Data structure

```js
// Map<workspaceId, { past: Snapshot[], future: Snapshot[] }>
const historyRef = useRef(new Map());

const HISTORY_MAX_DEPTH = 50;

// A snapshot is now ONE workspace plus the ID allocator, not the whole project.
// Shape: { workspaceId, workspace: <deep copy>, nextId }
```

`activeTab` is deliberately **not** part of a snapshot. Undo never navigates.

`nextId` remains included: undo must be able to restore the allocator, otherwise undoing a card creation leaves the counter advanced. *(Note: after the Bug 16 UUID migration, `nextId` disappears from snapshots entirely — one more reason to sequence this work after that migration. See §5.)*

## 4.2 Core operations

```js
function getHistory(wsId) {
  if (!historyRef.current.has(wsId)) {
    historyRef.current.set(wsId, { past: [], future: [] });
  }
  return historyRef.current.get(wsId);
}

function pushSnapshot(wsId, snapshot) {
  const h = getHistory(wsId);
  h.past.push(snapshot);
  if (h.past.length > HISTORY_MAX_DEPTH) h.past.shift();   // evict oldest
  h.future.length = 0;                                     // any new action clears redo
  syncCanUndoRedoFlags(wsId);
}

function captureSnapshot(wsId) {
  // Read from the LIVE value, never from a lagging ref — fixes Bug 26.
  const ws = liveWorkspaces().find(w => w.id === wsId);
  if (!ws) return null;
  return { workspaceId: wsId, workspace: structuredClone(ws), nextId: liveNextId() };
}
```

### Fixing Bug 26 — snapshot source

Two acceptable approaches:

**Approach 1 — refresh the ref during render (minimal change)**
```js
// Replace the useEffect at ~1508 with a synchronous assignment in the render body.
stateRef.current = { workspaces, activeTab, nextId };
```
Safe here because it is an idempotent write of already-rendered values. Removes the one-render lag with a one-line diff.

**Approach 2 — capture inside the state updater (most correct)**
```js
setWorkspaces(prev => {
  const ws = prev.find(w => w.id === activeTab);
  if (ws) pushSnapshot(activeTab, { workspaceId: activeTab, workspace: structuredClone(ws), nextId });
  return /* the mutation */;
});
```
Guaranteed current, but requires touching all 44 call sites.

**Recommendation: Approach 1 for this work.** It removes the lag globally with minimal risk. Approach 2 is the ideal but should not be bundled with a subsystem rewrite.

### Fixing Bug 38 — validate before applying

```js
function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' ||
      !snapshot.workspaceId || !snapshot.workspace ||
      !Array.isArray(snapshot.workspace.nodes)) {
    console.error('[History] Malformed snapshot, refusing to apply', snapshot);
    return false;   // fail loudly, never silently
  }
  setWorkspaces(prev => prev.map(ws =>
    ws.id === snapshot.workspaceId
      ? { ...snapshot.workspace,
          groups: computeLayout(snapshot.workspace.groups || [], snapshot.workspace.nodes || []) }
      : ws
  ));
  if (typeof snapshot.nextId === 'number') setNextId(snapshot.nextId);
  return true;
}
```

Note `computeLayout` must be re-run on restore — group geometry is derived, and every existing mutation path already recomputes it.

## 4.3 Lifecycle rules

| Event | Action | Reason |
| --- | --- | --- |
| Workspace switch | **Keep** that workspace's stack | Per-workspace history makes clearing unnecessary — this is a benefit of Option A |
| Project switch | **Clear the entire Map** | Snapshots reference workspace IDs from the old project |
| Workspace delete | **Delete that workspace's entry** | Prevents unbounded Map growth and stale references |
| Snapshot restore | **Clear the entire Map** | Fixes §2.5 — undo must not revert a restore |
| Import (either kind) | **Clear the entire Map** | Fixes §2.5 |
| Preview mode enter | **Keep** | Preview is non-destructive; history should survive the round trip |
| Reference mode | **Never record** | Doc 01 Principle 5: read-only means no writes, including in-memory history |

## 4.4 Preserving the deferred-drag behaviour

The existing "only record if movement ≥ threshold" logic is correct and must survive. Under the new structure the four drag paths change from appending to `pastRef` directly to:

```js
// pointer-down
dragSnapshot.current = captureSnapshot(activeTabRef.current);

// pointer-up, only if movement >= 5px
if (dragSnapshot.current) {
  pushSnapshot(dragSnapshot.current.workspaceId, dragSnapshot.current);
  dragSnapshot.current = null;
}
```

This routes both append paths through `pushSnapshot`, so the depth cap is enforced in one place — the specific failure the current two-path design allows.

## 4.5 Coalescing: keep the existing behaviour

The `onFocus` snapshot pattern already produces one entry per typing burst. **Preserve it exactly.** Do not add per-keystroke snapshots.

One gap worth closing: the canvas card *content* editor snapshots on the click that enters edit mode (~8298) but the `<textarea>` itself (~8290) has no `onFocus` handler. If edit mode is entered by any path other than that click, no snapshot is taken. Add `onFocus={() => takeSnapshot()}` to that textarea for consistency with the title editor. Duplicate snapshots from click-then-focus should be suppressed by a short-window guard:

```js
// Ignore a second capture for the same workspace within 100ms.
if (Date.now() - lastCaptureAtRef.current < 100) return;
```

---

# Part 5 — Implementation plan

## 5.1 Sequencing constraint — do this AFTER the UUID migration

The UUID migration (Doc 02 Bug 16) **removes `nextId` from the application entirely.** Since `nextId` is part of the snapshot shape, doing history work first means building it around a field that is about to be deleted, then rewriting it.

**Correct order:** Doc 02 execution Step 0 (Bug 24) → Step 1 (Bugs 16 + 28, UUID migration) → then this work.

Bug 38's validation guard is the one exception — it is independent and can land immediately as a two-line safety improvement.

## 5.2 Phases

### Phase 0 — Immediate, unblocked (~30 min)
- Bug 38: rename the shadowed variable, add snapshot shape validation, fail loudly on malformed input.
- Add a confirmation dialog to reminder deletion (partial mitigation for §2.6).

**Independent of everything else. Land now.**

### Phase 1 — Bound the memory (~2 hours)
- Introduce `HISTORY_MAX_DEPTH` and enforce it in `updateHistory`.
- Route the four drag paths through the same append function so the cap cannot be bypassed.
- Keep the current global structure — this phase only stops unbounded growth.

**Ships Bug 27 without waiting for Decision 1.** Worth doing early if the UUID migration is not imminent.

### Phase 2 — Fix the snapshot source (~1 hour)
- Move the `stateRef` refresh from `useEffect` into the render body (Approach 1).
- Verify no call site depends on the lag. *(Reviewed: none appear to, but this is a code-traced conclusion with no test coverage — exercise the drag paths manually.)*

**Ships Bug 26.**

### Phase 3 — Restructure to per-workspace (~1–1.5 days) ✅ UNBLOCKED
- Replace `pastRef` / `futureRef` with `historyRef` (a Map keyed by workspace ID).
- Change the snapshot shape to a single workspace.
- Update all 44 call sites — most only need the active workspace ID passed through.
- Remove `setActiveTab` from undo/redo.
- Implement the § 4.3 lifecycle rules.
- Make `canUndo` / `canRedo` derive from the active workspace's stack.
- Delete that workspace's Map entry on workspace delete.
- **Handle the cross-workspace cut-paste data-loss risk** (Part 3, Decision 1). Record cut operations in the *source* workspace's stack as well, so undoing a cross-workspace cut restores the original. **Coordinate with Bug 29** — both touch the same clipboard code and should land in one PR.

**Ships Bugs 39, 27 (thoroughly), and §2.5.** Estimate raised from 1 day to 1–1.5 days to cover the cut-paste work.

### Phase 4 — Coverage (~variable) ⬜ requires Decision 3
- Add snapshots to `addPin`, `deletePin`, `renameWorkspace`, `bringToFront`, `sendToBack`.
- Either add task/reminder history or document the limitation in Doc 01 §5 as an intentional workflow rule.

### Separate, not part of this work — Decision D2
`deleteTask` must be changed to convert its linked pin to standalone rather than delete it, and to compute outside the state updater (Doc 05 Bug 31). **This is a Bug 31 fix, not a history fix** — it does not depend on any phase here and can land independently at any time. It is listed only because it was decided in the same conversation.

## 5.3 Verification

**No test suite exists** (see Doc 05 Appendix B). The following must be verified manually, or — preferably — by extracting the history reducer into a pure module and adding the first three tests in the repository.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Edit card in A, switch to B, edit card in B, Ctrl+Z | Only B reverts. Stays on B. |
| 2 | 60 discrete edits in one workspace | Stack holds 50. Oldest 10 evicted. Undo works 50 times. |
| 3 | Type a 200-char sentence, Ctrl+Z once | Entire sentence reverts, not one character. |
| 4 | Drag a card <5px | No history entry created. |
| 5 | Drag a card 100px, Ctrl+Z | Card returns to original position. |
| 6 | Restore a cloud version, then Ctrl+Z | Undo does **nothing** (stack cleared). Restore is not silently reverted. |
| 7 | Delete a workspace, check `historyRef.size` | Entry removed. |
| 8 | Undo/redo in Reference Mode | No-op. No history recorded. |
| 9 | Import a full backup, then Ctrl+Z | Undo does nothing. |
| 10 | Clone a card to another workspace, Ctrl+Z in source | Documented behaviour occurs (under Option A: source reverts, clone remains). |

Scenario 1 is the regression guard for Bug 39. Scenario 3 guards against the mistake of "fixing" the withdrawn Bug 25 by snapshotting inside `updateNode`.

## 5.4 Estimate

| Phase | Effort | Blocked by | Ships |
| --- | --- | --- | --- |
| 0 | 30 min | Nothing | Bug 38 + reminder-delete confirmation |
| 1 | 2 hours | Nothing | Bug 27 (interim cap) |
| 2 | 1 hour | Nothing | Bug 26 |
| 3 | 1–1.5 days | UUID migration only *(Decision 1 now settled)* | Bugs 39, 27 (final), §2.5, cut-paste safety |
| 4 | 0.5–2 days | **Decision 3** | §2.6 coverage |

Phases 0–2 total ~3.5 hours and are unblocked today. Phase 3 is now unblocked on the decision side and waits only on the UUID migration for sequencing reasons (§5.1).

### If Phase 3 will follow soon, consider skipping Phase 1

Phase 1 adds a depth cap to the current global structure; Phase 3 replaces that structure entirely. If the UUID migration and Phase 3 are landing within the same cycle, Phase 1 is throwaway work — go straight to Phase 3 and let it deliver the cap.

Do Phase 1 only if Phase 3 is more than a few weeks out, since unbounded memory growth is live in production today.

---

# Part 6 — Relationship to Cloud Version History

These are **two separate systems** and must not be conflated.

| | In-session history (this document) | Cloud version history |
| --- | --- | --- |
| Storage | React refs, memory only | Firestore `projects/{id}/snapshots/{stamp}` |
| Lifetime | Current tab session | Newest 30 kept (`SNAPSHOT_KEEP`) |
| Granularity | Per user action | ~10 min auto (`SNAPSHOT_MIN_INTERVAL_MS`), plus manual / conflict / pre-restore |
| Scope | One workspace (proposed) | Whole project |
| Trigger | Ctrl+Z | Version History panel |
| Survives reload | ❌ | ✅ |
| Cross-device | ❌ | ✅ |
| Code | `App.jsx` ~2549–2590 | `persistenceService.js` ~1690–1810 |

## The interaction that needs fixing

Restoring a cloud version calls `setWorkspaces(restoredWs)` but **leaves the in-session undo stack intact**. Ctrl+Z afterwards reverts to pre-restore state, silently undoing the restore.

`restoreSnapshot` does create a `'pre-restore'` cloud snapshot first, so nothing is permanently lost — but the two systems are fighting. **§4.3's rule (clear all history on restore) resolves this.** After the fix, the cloud snapshot is the only way to reverse a restore, which is the correct and explainable model: *in-session undo covers your edits; version history covers restores.*

## Recommendation for the UI

Once Phase 3 lands, the Version History panel copy should state that restoring clears in-session undo. The panel currently says restoring is "undoable" because it saves the current version first — accurate, but a user may reasonably read "undoable" as "Ctrl+Z will work."

---

# Appendix — Tracker cross-reference

| Doc 02 Bug | Addressed in | Priority |
| --- | --- | --- |
| Bug 26 — stale snapshot source | Phase 2 | B |
| Bug 27 — unbounded history | Phase 1 (interim), Phase 3 (final) | B |
| Bug 29 — cut-paste deletes wrong card | **Phase 3** — same clipboard code, land together | A |
| Bug 31 — nested setState in `deleteTask` | Independent of all phases; decision D2 recorded | B |
| Bug 38 — variable shadowing | Phase 0 | C |
| Bug 39 — global undo scope | Phase 3 ✅ *(Decision 1 settled)* | B |
| *§2.5 — history survives restore/import* | Phase 3 | **Not yet filed — recommend filing** |
| *§2.6 — incomplete coverage* | Phase 4 *(needs Decision 3)* | **Not yet filed — recommend filing as documented limitation** |
| ~~Bug 25~~ | 🚫 **RETIRED — wrong detection. Number not reused; Bugs 26–39 keep their numbers.** | — |
