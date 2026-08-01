# 02 — Bug & Architecture Issue Tracker

## Purpose

This document is the single source of truth for known defects and architecture risks in the application. It replaces the earlier tracker after a code-level audit of commit `cd05793ea54f6db8a1e88a09434d02f4cc74c2bc`.

Each entry records its context, observed or potential behavior, root cause, proposed solution, priority, confidence, and current status.

## Classification

- **P0 — Critical:** credible silent data loss, persistent corruption, or destructive security failure.
- **P1 — High:** substantial integrity, durability, read-only-boundary, or core workflow failure.
- **P2 — Medium:** user-visible functional defect, performance issue, or contained consistency problem.
- **P3 — Low:** minor UI issue or latent maintainability risk with no demonstrated current data loss.
- **Confidence: Proven:** behavior follows directly from the audited source.
- **Confidence: Path-dependent:** the vulnerable path is present, but triggering it requires timing, failure, malformed data, or concurrent clients.
- **Needs decision/verification:** intent or runtime behavior must be resolved before treating the item as a code defect.
- **Retired:** the documented reproduction or diagnosis is false; do not implement the old proposed fix.

---

# Existing tracker findings — Bugs 1–39

## Bug 1 — Multi-tab warning is global instead of project-aware

**Context:** The application warns users when another application tab is open.

**Bug:** A warning can appear when the other tab has a different project or workspace open.

**Root cause:** Presence communicates application-tab existence rather than maintaining per-tab identity and active project/workspace ownership.

**Proposed solution:** Assign a stable tab-session ID; broadcast tab ID, project ID, workspace ID, mode, and heartbeat; warn only for conflicting editors of the same data scope.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** The earlier “Fixed” status was incorrect and contradicted both the code and the old priority table.

---

## Bug 2 — Open tabs cannot be counted

**Context:** Users should know how many tabs are editing the same project or workspace.

**Bug:** Presence exposes only a yes/no condition.

**Root cause:** Active peers are not maintained as a map keyed by tab ID.

**Proposed solution:** Keep a TTL-based peer map containing tab ID, heartbeat, project ID, workspace ID, and mode; derive the count from live peers.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** Implement together with Bug 1.

---

## Bug 3 — Multi-tab warning can flicker after a tab closes

**Context:** More than two application tabs may remain open.

**Bug:** One leave event can temporarily remove the warning even though another conflicting tab is still active.

**Root cause:** A leave event controls a shared boolean instead of removing one peer from a set and recomputing the warning.

**Proposed solution:** Remove only the departing tab ID and derive warning state from all non-expired peers.

**Priority / confidence:** P3 / Proven architecture limitation.

**Status:** **Open.** Implement with Bugs 1–2.

---

## Bug 4 — localStorage presence fallback is unreliable

**Context:** Presence falls back to localStorage where `BroadcastChannel` is unavailable.

**Bug:** Tabs overwrite each other’s presence and peer state is lost.

**Root cause:** Multiple tabs write a shared key without per-tab records or merge semantics.

**Proposed solution:** Store a versioned map keyed by tab ID, merge on storage events, and expire stale heartbeats.

**Priority / confidence:** P3 / Proven.

**Status:** **Open.** Implement with the presence redesign.

---

## Bug 5 — Newer project metadata can be silently overwritten

**Context:** Reminders, pin groups, counters, workspace IDs, and other project metadata synchronize between clients.

**Bug:** A client can retain stale metadata and later upload it over newer cloud metadata.

**Root cause:** Metadata adoption and conflict handling do not consistently replace every project-scoped state slice in React and local storage.

**Proposed solution:** Treat metadata as one revisioned aggregate or independently revision each slice; on cloud adoption, update React state, local storage, content hash, and base revision together.

**Priority / confidence:** P0 / Proven architecture risk.

**Status:** **Open — critical.** Related to Bugs 9, 10, 40–44, and 49.

---

## Bug 6 — Missing base revision can bypass conflict detection

**Context:** Optimistic conflict detection depends on the revision from which local state was derived.

**Bug:** A write with an unknown baseline may be treated as safe.

**Root cause:** `baseRev == null` does not consistently block or rebase a write.

**Proposed solution:** Treat an unknown baseline as indeterminate: fetch server state, establish a base, then merge or raise a conflict before writing.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.** A clean-state variant is tracked as Bug 40.

---

## Bug 7 — Background tabs become stale

**Context:** Polling is reduced or stopped while a tab is hidden.

**Bug:** A background tab may remain stale until focused and can later make decisions from old state.

**Root cause:** No reliable cross-tab invalidation message supplements visibility-gated polling.

**Proposed solution:** Broadcast lightweight document revision/invalidation messages and fetch authoritative data before any stale tab writes.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** Do not solve this by blindly synchronizing full payloads between tabs.

---

## Bug 8 — Sync initialization may not recover after offline startup

**Context:** The application starts while Firebase or the network is unavailable.

**Bug:** Local changes can continue while remote synchronization remains disabled until reload.

**Root cause:** Failed initialization is not governed by a reconnect/retry state machine.

**Proposed solution:** Retry initialization on online/auth/configuration transitions with bounded backoff; expose degraded state; reconcile local dirty data before accepting remote state.

**Priority / confidence:** P0 / Proven architecture gap.

**Status:** **Open — critical.** Coordinate with Bugs 41–44 rather than adding an isolated retry callback.

---

## Bug 9 — “Keep Cloud” conflict resolution does not reliably refresh UI

**Context:** A user chooses the remote copy during metadata conflict resolution.

**Bug:** Stale local React state can remain visible and later be saved over the chosen cloud state.

**Root cause:** Conflict resolution updates persistence baselines without atomically replacing all in-memory project state.

**Proposed solution:** Route conflict adoption through the same complete project-activation/reconciliation function used at startup.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.** Related to Bug 49.

---

## Bug 10 — Metadata fingerprint can become inconsistent with its baseline

**Context:** Synchronization compares content hashes and revisions.

**Bug:** Baseline revision and content fingerprint can refer to different versions.

**Root cause:** Some adoption/rebase paths advance revision state without regenerating the hash from the exact adopted payload.

**Proposed solution:** Store `{revision, hash, generation}` atomically from one canonical serialized payload.

**Priority / confidence:** P0 / Proven architecture risk.

**Status:** **Open — critical.** Fold into the sync-generation redesign in Bugs 43–44.

---

## Bug 11 — No-op saves create unnecessary revisions

**Context:** Autosave runs even when canonical persisted content has not changed.

**Bug:** Revisions can increase and conflicts can be amplified without a semantic change.

**Root cause:** The write path does not consistently compare the canonical outgoing hash with the last confirmed hash.

**Proposed solution:** Canonicalize persisted data and skip a write when its hash equals the confirmed content hash for the same base revision.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** Optimize only after correctness work in Bugs 40–44.

---

## Bug 12 — Browser close cannot guarantee final save or leave notification

**Context:** The browser may terminate or freeze a page immediately.

**Bug:** A final asynchronous save or presence leave message may never complete.

**Root cause:** Browser lifecycle events do not guarantee asynchronous work during shutdown.

**Proposed solution:** Keep continuous local durability, flush early on `visibilitychange`, retain dirty markers, expire presence through heartbeats, and reconcile on next launch. Do not promise guaranteed close-time cloud completion.

**Priority / confidence:** P2 / Proven platform limitation.

**Status:** **Partially mitigated.** `visibilitychange` and dirty tracking already exist; the previous proposed solution was therefore incomplete, not absent.

---

## Bug 13 — Presence fallback can leave ghost tabs

**Context:** A legacy/fallback client closes without a reliable leave event.

**Bug:** The closed tab can remain listed as active.

**Root cause:** Presence removal depends too heavily on explicit shutdown.

**Proposed solution:** Use heartbeat expiry as authority; explicit leave should only accelerate removal.

**Priority / confidence:** P3 / Proven architecture limitation.

**Status:** **Open.** Implement with Bugs 1–4.

---

## Bug 14 — Deleted workspaces can return

**Context:** One client deletes a workspace while another client has stale local or queued state.

**Bug:** The stale client can recreate the deleted workspace.

**Root cause:** Deletion is not represented by a durable server-authoritative tombstone throughout reconciliation and retries.

**Proposed solution:** Persist versioned tombstones; reject writes older than the tombstone; garbage-collect only after all retention/undo requirements expire.

**Priority / confidence:** P0 / Path-dependent.

**Status:** **Open — critical.** Bugs 45, 54, and 55 describe additional deletion failures.

---

## Bug 15 — Restore is non-atomic and can leave metadata inconsistent

**Context:** A historical project snapshot is restored.

**Bug:** A partial restore can leave workspace documents, workspace ID metadata, and local state describing different project versions.

**Root cause:** The original diagnosis—“workspace list missing from the metadata fingerprint”—is inaccurate. The metadata writer intentionally strips `workspaceIds`; restore manages IDs separately with deletion and `ensureWorkspaceIds`. The real defect is a multi-step, partially fire-and-forget restore with no atomic commit or complete rollback.

**Proposed solution:** Stage and validate the snapshot, create a restore journal/version epoch, commit documents and ID membership as one logical operation, and resume or roll back interrupted work deterministically.

**Priority / confidence:** P1 / Proven.

**Status:** **Open — diagnosis corrected.** Do not fix by merely adding `workspaceIds` to an unrelated fingerprint.

---

## Bug 16 — Duplicate card IDs

**Context:** Cards are created, imported, restored, or migrated.

**Bug:** A new or imported card can reuse an existing card ID in the same project.

**Root cause:** Card identity depends on a project-level `nextId` counter that can regress or default inconsistently. Card documents and metadata counters persist independently, undo can rewind the counter, and no project-wide uniqueness check exists.

**Proposed solution:** First contain the damage through Bug 24. Then migrate cards to collision-resistant IDs, remap edges/group/clone references, reconcile existing projects, and retain validator enforcement. If a counter remains temporarily, derive it from all live project cards before every allocation.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.** Whole-map import is tracked separately in Bug 51.

**Audit correction:** Cards are not the only collision-prone IDs. Pins use `pin-${Date.now()}` and groups use `g-${Date.now()}`; see Bug 66.

---

## Bug 17 — Clone references can become dangling

**Context:** A source card with clones is deleted or moved across workspaces.

**Bug:** Clones can retain a `cloneSourceId` that no longer resolves.

**Root cause:** Cleanup and validation are not consistently project-wide and identity lacks an explicit workspace-qualified source reference.

**Proposed solution:** Store clone source as `{workspaceId, nodeId}` or a project-global UUID; update or detach all dependents in one domain operation; validate dangling references.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.** Include in the identity migration.

---

## Bug 18 — Reminder runtime timestamps create excessive synchronization

**Context:** The scheduler advances `nextReminderAt` and `lastShownAt`.

**Bug:** Ephemeral scheduler activity causes project metadata writes and conflicts.

**Root cause:** Device/session runtime state is mixed into synchronized project configuration.

**Proposed solution:** Separate reminder definitions from runtime delivery state. Keep runtime state device-local unless cross-device delivery semantics are explicitly designed.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** Also contributes to the View-mode write leak in Bug 47.

---

## Bug 19 — Validator cannot detect duplicate or malformed identities

**Context:** Validation runs around imports and selected development workflows.

**Bug:** Duplicate card IDs and dangling clone references are not reliably reported.

**Root cause:** The validator creates an object-ID set for endpoint lookup but never checks whether insertion replaces an existing ID. Existing duplicate detection is scoped too narrowly. The validator also crashes on some malformed inputs; see Bug 58.

**Proposed solution:** Validate IDs project-wide, report every collision with workspace paths, validate edges/groups/clones, and run the validator before accepting import, restore, paste, migration, or remote adoption.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.** Must ship with the identity migration, but it does not replace scoped mutation APIs.

---

## Bug 20 — Card editor can show stale same-ID data

**Context:** A selected card changes outside the editor panel.

**Bug:** The panel does not refresh when the selected card object changes but its ID remains the same.

**Root cause:** The synchronization effect depends only on `selectedNode?.id`.

**Proposed solution:** Synchronize from the relevant card fields or version, while preserving unsaved draft/session semantics explicitly.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** Avoid resetting the draft on every keystroke from the same editor.

---

## Bug 21 — Reminder queue previously drained unattended

**Context:** Multiple reminders become due while the user is away.

**Bug:** The original one-at-a-time queue could auto-dismiss all reminders without a visible count or history.

**Root cause:** Delivery state was transient and advanced regardless of attention.

**Proposed solution:** Keep the staggered stack, pause in hidden modes, and add missed-reminder history or an unread count if required by product behavior.

**Priority / confidence:** P2 / Proven history gap.

**Status:** **Partially resolved on current `main`.** The max-three staggered stack is already present; documentation saying PR #22 is pending is stale. Missed-reminder history is still absent.

---

## Bug 22 — Hidden modes silently consume reminders

**Context:** Focus, Preview, or View mode suppresses reminder rendering.

**Bug:** Queue/timer lifecycle can continue while toasts are hidden, consuming reminders invisibly.

**Root cause:** Rendering is mode-gated but reminder lifecycle and metadata mutation are not governed by the same state machine.

**Proposed solution:** Separate detection, queueing, and presentation. Pause presentation expiration in modes where notifications are hidden, and define whether detection continues.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** View-mode mutation is additionally covered by Bug 47.

---

## Bug 23 — Reminder detection stalls while any notification is active

**Context:** The periodic reminder detection tick runs while another reminder is pending or visible.

**Bug:** Newly due reminders are not detected during that window.

**Root cause:** The scheduler returns before detection when `reminderNotificationRef.current` is truthy, instead of gating only presentation.

**Proposed solution:** Detect and enqueue on every tick; independently regulate what is displayed.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** The staggered stack does not fix this guard.

---

## Bug 24 — Card edits leak across workspaces

**Context:** A card is updated in the active workspace while another workspace contains the same card ID.

**Bug:** Every matching card in the project can receive the update, including title/content/theme/position changes.

**Root cause:** `updateNode(id, updates)` scans all workspaces and applies direct updates by bare ID. Clone-source lookup also relies on unqualified IDs. Bug 16 triggers the collision; Bug 24 creates the damage.

**Proposed solution:** Require workspace-qualified identity for every direct mutation; update only the intended workspace/card; resolve clone propagation from explicit relationships; reject ambiguous matches.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — first implementation priority.** Fix before the UUID migration because it immediately contains existing duplicate IDs.

---

## Bug 25 — Card text edits cannot be undone

**Context:** The original tracker claimed text changes were never snapshotted.

**Bug:** The claimed missing text-edit undo behavior is not present in the audited code.

**Root cause:** The original analysis overlooked that text-edit entry points snapshot at edit-session start. Adding snapshots inside `updateNode` would generate excessive entries and damage session-level undo behavior.

**Proposed solution:** No old fix. Keep one snapshot per edit session and document/test the session boundary. The card content editor’s focus/click paths should be reviewed for consistency without adding duplicate snapshots.

**Priority / confidence:** Retired / Proven false positive.

**Status:** **Retired.** Do not count as an open bug.

---

## Bug 26 — Undo snapshots may read a lagging ref

**Context:** Snapshot data is exposed through refs updated after rendering.

**Bug:** A same-frame snapshot could theoretically see prior committed state, but no concrete loss path was demonstrated in the reviewed handlers.

**Root cause:** Snapshot refs are refreshed after render, creating structural passive-effect lag. However, reviewed mutation paths normally call `takeSnapshot()` before mutation or capture drag state at interaction start.

**Proposed solution:** Instrument and test a specific failing sequence before changing architecture. If ref freshness is redesigned, update it from committed state with `useLayoutEffect` or capture state inside an authoritative reducer/updater. Do **not** assign refs from speculative render output.

**Priority / confidence:** Needs verification.

**Status:** **Unproven; monitor, not release-blocking.** The Document 06 render-time ref fix is rejected as concurrent-render unsafe.

---

## Bug 27 — Undo history grows without bound

**Context:** Many mutations snapshot all workspaces.

**Bug:** Long sessions can accumulate large deep copies and exhaust memory.

**Root cause:** History has no practical cap and uses whole-project snapshots for local actions.

**Proposed solution:** Cap entries by count and estimated bytes, clear/rebase on project epochs, and move toward workspace-scoped commands or structural diffs.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.** Related durability issues are covered by Bugs 55–56.

---

## Bug 28 — Project duplication reuses internal card IDs

**Context:** A project is duplicated into a new project ID.

**Bug:** Reused internal card IDs in a separately duplicated project were incorrectly classified as a direct cross-project collision.

**Root cause:** The prior analysis ignored project ID as the storage/Firestore namespace. Projects remain separate, and full-backup import preserves separate project workspace arrays rather than merging them.

**Proposed solution:** Regenerate internal IDs only as migration hygiene or to support future merge/import semantics; correctly remap references if implemented.

**Priority / confidence:** Retired as critical bug / Proven false consequence.

**Status:** **Retired from Priority A.** May remain as optional architecture cleanup, not a current corruption defect.

---

## Bug 29 — Cut/paste can remove an ambiguous same-ID source card

**Context:** A card is cut from one workspace and pasted after source data has changed.

**Bug:** If duplicate IDs exist in the source scope, deletion can target an unintended card or silently fail when the source workspace no longer exists.

**Root cause:** Clipboard source identity and removal verification are insufficiently strong for a system that permits duplicate IDs.

**Proposed solution:** Store source project/workspace/card identity, operation token, and optional content/version fingerprint; remove only an exact verified source; report unresolved moves instead of silently treating them as success.

**Priority / confidence:** P0 / Path-dependent.

**Status:** **Open — critical while Bug 16 exists.** Re-evaluate after identity migration and workspace-qualified APIs.

---

## Bug 30 — Queued cloud-write completion and retry semantics are incorrect

**Context:** Multiple saves target the same persistence path while one write is in flight.

**Bug:** A queued save can report success before execution; retry processing can drop it; a later failure can be suppressed; a prior write can clear dirty state belonging to newer content.

**Root cause:** Save functions do catch failures and call `enqueueFailedWrite`; the old statement that queued failures are never routed to retry is too broad. The actual problems are: `guardedFirestoreSave` returns `true` when merely replacing a queued callback; `processRetryQueue` treats that as success; re-enqueue is globally suppressed while `_isProcessingRetryQueue` is true; and completion has no generation ownership.

**Proposed solution:** Return a distinct promise for every requested generation, coalesce by path while retaining newest payload, retry actual execution failures, and clear dirty state only for the confirmed generation.

**Priority / confidence:** P0 / Proven architecture, path-dependent failure.

**Status:** **Open — critical.** Bugs 43–44 split out the generation and retry-queue dimensions.

---

## Bug 31 — Nested state update during task deletion

**Context:** Deleting a task with a linked location pin.

**Bug:** Workspace/pin state can be computed from inconsistent state, and single-delete behavior differs from bulk delete.

**Root cause:** `setWorkspaces` is invoked from inside a `setTasks` updater. Single deletion removes the pin, while bulk deletion converts linked pins to standalone records.

**Proposed solution:** Define one deletion policy, compute affected task/pin IDs before setters, and apply independent domain updates or a reducer transaction.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.** The inconsistency is broader than React batching alone.

---

## Bug 32 — R/S shortcuts can fire while using a select control

**Context:** Global single-letter keyboard shortcuts run while form controls have focus.

**Bug:** There is no current `contentEditable` card-title failure matching the old explanation. The confirmed defect is narrower: the R and S handlers omit `SELECT`, which breaks select type-ahead.

**Root cause:** Shortcut handlers use inconsistent, duplicated form-control guards instead of one shared policy.

**Proposed solution:** Route every shortcut through one `shouldIgnoreKeyEvent` helper covering `INPUT`, `TEXTAREA`, `SELECT`, `isContentEditable`, dialogs, and modifier/composition state.

**Priority / confidence:** P3 / Proven.

**Status:** **Open — scope corrected.** Do not retain the false contentEditable reproduction.

---

## Bug 33 — Workspace switch saves a stale closure copy

**Context:** The old tracker claimed `handleCanvasSwitch` saved stale data because its callback closure was not recreated.

**Bug:** The documented stale-closure save path is not present. A different path-dependent switch problem exists and is tracked in Bugs 40 and 57.

**Root cause:** The prior analysis overlooked that the handler depends on current workspaces/active project and reads/starts the save before its first `await`. The actual risks are forced stale-clean uploads and out-of-order asynchronous switch completion.

**Proposed solution:** No old fix. A different path-dependent problem—forced stale uploads and concurrent switch completion—is covered by Bugs 40 and 57.

**Priority / confidence:** Retired / Proven false reproduction.

**Status:** **Retired.** Do not replace committed-state reads with speculative render-time refs.

---

## Bug 34 — Export selection versus export branch semantics are ambiguous

**Context:** Exporting a node follows descendant connections; multi-select export wording is less explicit.

**Bug:** Single-node branch export intentionally includes descendants, while the less-specific multi-selection “Export” label leaves expected scope undefined.

**Root cause:** The old analysis treated descendant traversal as universally accidental, but the node context menu explicitly says **Export Branch**. This is an unresolved product/label contract, not a proven traversal defect.

**Proposed solution:** Confirm product semantics. Label actions “Export Selected Only” and “Export Branch,” or add an explicit descendant option. Selected-only export should retain only edges whose endpoints are included.

**Priority / confidence:** Needs product decision.

**Status:** **Not a confirmed code bug.** Resolve UX contract before changing traversal.

---

## Bug 35 — Canvas wheel cancellation may interfere with native scrolling

**Context:** The canvas root handles wheel input and calls `preventDefault()` unconditionally.

**Bug:** The source contains unconditional wheel cancellation, but the previously claimed panel-scrolling failure has not been established.

**Root cause:** The old analysis incorrectly treated canvas-overlapping panels as descendants; they are siblings. Whether React 18 listener/passive behavior causes ineffective cancellation or a browser-specific interaction problem requires runtime verification.

**Proposed solution:** Runtime-test wheel, trackpad, overlays, and browser combinations. If interference is reproduced, cancel only for canvas-owned targets and intentional pan/zoom gestures.

**Priority / confidence:** Needs runtime verification.

**Status:** **Narrowed; not source-proven at the old evidence level.**

---

## Bug 36 — Timer interval architecture is fragile but currently functional

**Context:** Countdown terminal behavior is executed from an interval using functional state updates.

**Bug:** No current user-visible failure was demonstrated. Future non-functional reads inside the interval could introduce stale closure behavior.

**Root cause:** Timing, terminal transition, and side effects are coupled in one interval callback.

**Proposed solution:** Treat this as refactoring: keep interval work minimal and react to the committed zero transition in a dedicated effect/reducer.

**Priority / confidence:** P3 latent risk.

**Status:** **Backlog; not a confirmed current defect.**

---

## Bug 37 — Selection box uses the wrong first-frame origin

**Context:** The old tracker claimed the first shift-drag move selected from a stale origin.

**Bug:** The claimed wrong-origin first frame is not produced by the audited selection flow. At most, an extremely early move can be ignored until the next event.

**Root cause:** The prior analysis overlooked that pointer-down initializes the correct origin and the first processed move uses it; an event arriving before state commit is skipped rather than calculated from a different origin.

**Proposed solution:** No change unless a real dropped-first-move UX issue is reproduced; a ref may be used for responsiveness but is not a corruption fix.

**Priority / confidence:** Retired / Proven false reproduction.

**Status:** **Retired.**

---

## Bug 38 — Undo local-variable shadowing causes silent no-op

**Context:** The old tracker treated a local snapshot variable name as a setter ambiguity.

**Bug:** The claimed silent no-op from variable naming/setter behavior does not occur.

**Root cause:** The old analysis incorrectly assumed `setState(undefined)` is a no-op. It sets state to `undefined`; additionally, the guarded `pop()` cannot be undefined in the documented path, and the local variable name has no behavioral effect.

**Proposed solution:** Optional naming/shape validation may improve readability, but it is not a bug fix.

**Priority / confidence:** Retired / Proven false claim.

**Status:** **Retired.**

---

## Bug 39 — Global chronological undo may not match desired workspace-local semantics

**Context:** The previous review claimed that editing workspace A, editing B, and undoing once would revert A and teleport back to it.

**Bug:** The claimed first-undo teleport/reversion does not occur. The remaining possible issue is that global chronological undo may not match desired workspace-local semantics.

**Root cause:** The old reproduction misread snapshot order: the B edit records A’s edit and active workspace B, so first undo keeps A edited and reverts B. A second undo restores the earlier A state. Any remaining mismatch is a product-semantics decision, not that claimed implementation sequence.

**Potential issue:** Product intent remains undefined: history is global and chronological, while users may expect workspace-local undo.

**Proposed solution:** Decide between global-command history and per-workspace history. If global, make workspace changes during undo explicit. If local, partition history and define cross-workspace command behavior.

**Priority / confidence:** Needs product decision.

**Status:** **Documented reproduction retired; semantic question remains open.**

---

# New findings from the code audit — Bugs 40–66

## Bug 40 — Project/workspace switching can overwrite newer cloud data with clean stale state

**Context:** Switching projects or workspaces force-saves outgoing local data (`switchProject`, `cycleToProject`, and `handleCanvasSwitch`).

**Bug:** A locally “clean” but stale snapshot can be uploaded over a newer remote version. Rapid concurrent switches can also complete out of order.

**Root cause:** Conflict protection is strongest only when local data is marked dirty and has a known base revision. Force-saving outgoing state treats cleanliness as freshness, and asynchronous navigation lacks operation sequencing/cancellation.

**Proposed solution:** Make every write revision-conditional; skip unchanged outgoing uploads; fetch/rebase when freshness is unknown; assign a monotonically increasing navigation token and ignore superseded completions.

**Priority / confidence:** P0 / Path-dependent.

**Status:** **Open — critical.** This is the real switch-time stale-write issue; it replaces the false Bug 33 explanation.

---

## Bug 41 — Startup preserves dirty workspaces but not dirty tasks or metadata

**Context:** Startup reconciles local state with Firestore.

**Bug:** Unsynced local task, task-group, reminder, pin-group, counter, or metadata changes can be replaced by cloud content even though dirty workspace bodies are preserved.

**Root cause:** Dirty-state preservation is implemented explicitly for workspace documents but not symmetrically for every persisted document class.

**Proposed solution:** Use one reconciliation protocol for workspaces, tasks, metadata, and future document types: read sync state, preserve dirty generations, compare base/server revisions, and merge or conflict before adoption.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.**

---

## Bug 42 — Firestore read errors are treated like missing documents

**Context:** Firestore loaders return `null` for unavailable configuration, missing documents, and read failures.

**Bug:** Startup can interpret a transient network/permission failure as absent data, initialize empty/default state, and later persist the degraded state.

**Root cause:** Load APIs do not return a discriminated outcome.

**Proposed solution:** Return explicit results such as `{status: 'found'|'missing'|'offline'|'permission-denied'|'error', data}`. Never create or upload defaults after an indeterminate read.

**Priority / confidence:** P1 / Proven.

**Status:** **Open — high data-loss risk.** Applies to project, workspace, collection, and task loaders.

---

## Bug 43 — Older write completion can clear dirty state for a newer edit

**Context:** Write A is in flight when the user produces edit B on the same path.

**Bug:** Completion of A can mark the path synchronized even though B has not been uploaded.

**Root cause:** `confirmSynced(path, revision, content)` has no generation ownership check. Dirty state is path-level rather than generation-level.

**Proposed solution:** Increment a per-path generation for every local change. A completion may update its server revision but may clear dirty only if its generation and canonical hash still equal the current local generation/content.

**Priority / confidence:** P0 / Path-dependent.

**Status:** **Open — critical.** Implement with Bug 44.

---

## Bug 44 — Retry queue can acknowledge deferred writes and suppress their retry

**Context:** Retry processing invokes a guarded write while another write for the same path is already running.

**Bug:** The guarded call returns success after merely replacing the queued callback, so the retry entry is removed before execution. If deferred execution fails while global retry processing is active, re-enqueue is suppressed. Older payloads are not robustly coalesced with newer ones, and exhausted retries are silently discarded.

**Root cause:** Queue admission, execution completion, retry ownership, and global processing state are conflated.

**Proposed solution:** Persist/coalesce newest payload per path and generation; return a promise for actual execution; remove global re-enqueue suppression; retain terminal failures for user-visible recovery; use bounded backoff without silent discard.

**Priority / confidence:** P0 / Proven architecture, path-dependent trigger.

**Status:** **Open — critical.** Supersedes the incomplete explanation in Bug 30.

---

## Bug 45 — “Safe” workspace deletion can report success after remote failure

**Context:** Workspace deletion removes the document and its project membership.

**Bug:** `deleteWorkspaceSafely` can return success while one or both remote operations returned failure. A local one-hour tombstone does not protect other devices, which can restore the workspace.

**Root cause:** Boolean failure results are not propagated as operation failure, and deletion is not one durable server transaction/state transition.

**Proposed solution:** Commit a server-authoritative tombstone and membership update transactionally; retry until confirmed; return structured partial-failure state; garbage-collect later.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.** Coordinate with Bugs 14, 54, and 55.

---

## Bug 46 — Workspace creation is non-atomic

**Context:** Adding a workspace creates a document and updates the project’s workspace-ID membership.

**Bug:** Partial success can create an orphan workspace document or an ID pointing to a missing/blank document.

**Root cause:** Membership and content are persisted independently without a transactional creation state.

**Proposed solution:** Use a Firestore batch/transaction, or derive membership from workspace documents. Make create idempotent with an operation ID so retries cannot produce divergent state.

**Priority / confidence:** P1 / Proven architecture, failure is path-dependent.

**Status:** **Open.**

---

## Bug 47 — Reference/View mode is not a true zero-write boundary

**Context:** `#/view/:project/:workspace` is described as read-only but copyable.

**Bug:** Multiple paths can still mutate or persist data: canvas switching performs local saves/flushes; retry processing is not fully mode-gated; `PinPanel` receives raw state setters; reminder callbacks and the scheduler mutate reminder metadata; some paste callbacks can retain stale mode guards.

**Root cause:** Read-only behavior is enforced through scattered UI checks rather than at the domain-command and persistence boundaries.

**Proposed solution:** Add an immutable session capability (`editor` or `reference`) checked by every mutation command and persistence adapter; provide read-only component APIs; stop scheduler metadata writes and retry execution in reference sessions.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.** Treat as an architecture boundary, not a list of button patches.

---

## Bug 48 — Full-backup import is neither atomic replacement nor rollback-safe

**Context:** “Import All” appears to replace application data from a full backup.

**Bug:** Projects/workspaces omitted from the backup are not reliably removed, writes occur incrementally, and failure rollback restores only part of React state rather than completed local/cloud writes.

**Root cause:** Import performs validation, mutation, persistence, and activation in one non-transactional sequence without a migration journal or explicit merge/replacement contract.

**Proposed solution:** Declare merge versus replace semantics; fully validate and normalize before writes; stage an import generation; commit a deterministic plan; record progress for resume/rollback; remove omitted data only after successful replacement confirmation.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.** Do not market current import as a reliable disaster-recovery restore.

---

## Bug 49 — Full import can retain reminders and pin groups from the previous project

**Context:** Import activates an imported project immediately.

**Bug:** The prior project’s reminder and pin-group state can remain in React and later be saved into the imported project.

**Root cause:** Normal initialization replaces those project-scoped slices, but the full-import activation path does not use the same complete activation routine.

**Proposed solution:** Centralize project activation and atomically replace workspaces, active workspace, tasks, task groups, reminders, pin groups, counters, history epoch, and sync baselines.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.** Related to Bugs 5 and 9.

---

## Bug 50 — Full backups include local password hashes

**Context:** Full export spreads complete local project objects into the downloaded JSON.

**Bug:** Password hashes are included even though single-project export strips password data. Backup sharing or compromise exposes hashes to offline guessing.

**Root cause:** Full export lacks an explicit safe serialization schema and copies persistence objects wholesale.

**Proposed solution:** Serialize from an allowlist and exclude authentication/secrets by default. If credential backup is required, make it explicit and encrypt the backup with a separate user-supplied key.

**Priority / confidence:** P2 Security / Proven.

**Status:** **Open.** Existing exported backups should be treated as sensitive.

---

## Bug 51 — Whole-map import preserves unsafe IDs and trusts `nextId`

**Context:** A workspace/map is imported into an existing project.

**Bug:** Imported cards can duplicate existing IDs, contain internal duplicates, or exceed a stale `nextId`, making the next card allocation collide immediately.

**Root cause:** Import trusts serialized identity and counter state instead of validating/remapping it against the destination project.

**Proposed solution:** Validate first; generate an ID map for imported cards/groups/images as needed; remap edges/clones/memberships; compute any transitional counter from all resulting cards; reject unresolved references.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.** Distinct from retired Bug 28 because this operation can combine data within one project identity scope.

---

## Bug 52 — Duplicated workspace images remain owned by the source storage path

**Context:** Workspace duplication creates new workspace and object IDs while copying image metadata/URLs.

**Bug:** The duplicate still points at Firebase Storage objects under the source workspace. Deleting the source deletes those objects and breaks images in the duplicate.

**Root cause:** Metadata is duplicated without copying bytes or changing asset ownership.

**Proposed solution:** Prefer project-level immutable assets with reference counting. Alternatively copy each object to a new workspace path and update URLs before exposing the duplicate as complete.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.**

---

## Bug 53 — Image upload/delete race can recreate orphaned storage objects

**Context:** Image upload is asynchronous; the image or workspace may be deleted before upload completes.

**Bug:** The late upload can complete after deletion and leave an unreferenced Storage object, or a late callback can try to reinsert stale metadata.

**Root cause:** Upload has no cancellation/generation ownership and does not verify that its owner still exists before accepting the result.

**Proposed solution:** Give uploads operation IDs and abort signals; maintain deletion tombstones; on completion, verify current ownership/generation and immediately delete rejected late objects.

**Priority / confidence:** P2 / Path-dependent.

**Status:** **Open.**

---

## Bug 54 — Workspace deletion removes images before durable data deletion

**Context:** Workspace deletion starts Storage cleanup before remote workspace deletion is durably confirmed.

**Bug:** If Firestore deletion fails or another client resurrects the workspace, its image metadata remains but the image bytes are permanently gone.

**Root cause:** Irreversible child-resource deletion precedes the authoritative soft-delete transition.

**Proposed solution:** Commit a tombstone first, retain assets through an undo/retention window, then garbage-collect only when deletion is durable and no live references remain.

**Priority / confidence:** P1 / Proven architecture, failure is path-dependent.

**Status:** **Open.**

---

## Bug 55 — Undoing workspace deletion is not durable

**Context:** The user deletes a workspace and invokes undo.

**Bug:** React state may be restored while the remote workspace, membership, tombstone, local persistence, or image bytes remain deleted. Reload can lose the apparently restored workspace.

**Root cause:** Undo replays an in-memory snapshot rather than executing a durable inverse deletion command; irreversible image deletion may already have occurred.

**Proposed solution:** Model deletion as a soft-delete command with an operation ID and grace period. Undo must cancel the durable deletion and restore membership before hard asset cleanup.

**Priority / confidence:** P0 / Proven.

**Status:** **Open — critical.**

---

## Bug 56 — Restore/import can leave stale undo history active

**Context:** A project is replaced by import or historical restore, then the user invokes undo.

**Bug:** History entries from the previous project version can reintroduce obsolete state and reverse parts of the replacement.

**Root cause:** Destructive replacement does not consistently clear or rebase local history, and snapshots have no project-version epoch.

**Proposed solution:** Increment a project history epoch on import/restore/replacement; clear redo and incompatible undo entries; require every command/snapshot to match current project ID and epoch.

**Priority / confidence:** P1 / Proven architecture risk.

**Status:** **Open.**

---

## Bug 57 — Live URL navigation is one-way after startup

**Context:** The URL seeds project/workspace state once; a later effect mirrors state back to the URL.

**Bug:** Browser back/forward or an in-app route target change does not reliably activate the requested project/workspace and may be overwritten by the state-to-URL mirror. Rapid asynchronous switches can also finish out of order.

**Root cause:** Route intent is not treated as a reactive input after initialization, and navigation operations have no source/version coordination.

**Proposed solution:** Reconcile route-to-state on every relevant location change; distinguish user route navigation from state mirroring; sequence asynchronous activation and discard superseded completions.

**Priority / confidence:** P1 / Proven one-way design; completion race is path-dependent.

**Status:** **Open.**

---

## Bug 58 — Workspace validator crashes on malformed structures

**Context:** Validator input may come from import, restore, local corruption, or future schema versions.

**Bug:** A null workspace can crash `workspaces.map(ws => ws.id)` before validation reports an error. Child collections are also assumed to be iterable and object-shaped.

**Root cause:** Traversal occurs before top-level and nested schema guards.

**Proposed solution:** Add a schema-validation phase before semantic/reference checks; return structured errors with paths; never throw for user-supplied backup data; validate before any state mutation.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.** Combine with Bug 19 but track malformed-shape safety separately.

---

## Bug 59 — Re-enabled reminders can remain unscheduled forever

**Context:** A disabled reminder has `nextReminderAt: null` and is enabled without changing its frequency.

**Bug:** It can retain a null next-due timestamp, which the scheduler skips indefinitely.

**Root cause:** Scheduling is recalculated for some frequency changes but not reliably for the disabled-to-enabled transition.

**Proposed solution:** Detect the transition and initialize `nextReminderAt` from current time, frequency, active hours, and any randomization policy.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.**

---

## Bug 60 — `showOnWorkspaceOpen` does not run on normal workspace switches

**Context:** A reminder may be configured to show when a workspace opens.

**Bug:** The behavior occurs during initial/project setup but not every ordinary workspace activation.

**Root cause:** The trigger is attached to initialization rather than the authoritative successful workspace-switch event.

**Proposed solution:** Trigger after a workspace activation commits, with per-activation deduplication and clear mode/visibility rules.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.**

---

## Bug 61 — Reminder `randomMode` is stored but not implemented

**Context:** Reminder configuration exposes and persists a random-mode option.

**Bug:** Scheduler behavior does not use the option, so the UI promises behavior that does not occur.

**Root cause:** Configuration schema and scheduler implementation diverged.

**Proposed solution:** Define the random distribution and bounds, implement deterministic scheduling rules, or remove/disable the option until supported.

**Priority / confidence:** P2 / Proven.

**Status:** **Open.**

---

## Bug 62 — Custom reminder frequencies display incorrect labels

**Context:** The UI formats arbitrary minute values.

**Bug:** Values are bucketed into preset labels—for example, 2 minutes can display as 15m and 16 as 30m.

**Root cause:** `getFrequencyLabel` uses upper-bound ranges rather than exact preset matching plus custom formatting.

**Proposed solution:** Match known presets exactly; otherwise render the actual minutes/hours with appropriate pluralization.

**Priority / confidence:** P3 / Proven.

**Status:** **Open.**

---

## Bug 63 — Multi-select group operations violate group invariants

**Context:** Multi-selection can create groups or delete selected groups and cards.

**Bug:** A created group may omit `workspaceId`; deleting selected groups can leave child cards/groups with dangling `groupId` values.

**Root cause:** Multi-select actions construct/filter raw arrays without using the invariant-preserving single-group domain behavior.

**Proposed solution:** Centralize group creation/deletion commands; require workspace ownership; explicitly cascade, detach, or reject child relationships; run validator checks after the operation.

**Priority / confidence:** P1 / Proven.

**Status:** **Open.**

---

## Bug 64 — Resize-handle unmount can leave global body styles stuck

**Context:** Panel resizing sets `document.body.style.cursor` and `userSelect` while dragging.

**Bug:** If the handle unmounts before mouse-up, the body can remain non-selectable with a resize cursor.

**Root cause:** Listener cleanup does not also restore the body styles; restoration is tied to the mouse-up handler.

**Proposed solution:** Restore both styles in effect cleanup and use pointer capture/pointer events to make termination more reliable.

**Priority / confidence:** P3 / Path-dependent.

**Status:** **Open.**

---

## Bug 65 — MiniMap uses fixed card dimensions for variable-size cards

**Context:** MiniMap world bounds and node rendering assume cards are 240×120.

**Bug:** Dynamically resized or differently rendered cards produce inaccurate minimap bounds, positions, and viewport navigation.

**Root cause:** Geometry is duplicated as constants instead of sourced from authoritative card dimensions or measurements.

**Proposed solution:** Persist or derive node dimensions in one geometry model and pass them to both canvas and minimap; include group/image bounds consistently.

**Priority / confidence:** P3 / Proven.

**Status:** **Open.**

---

## Bug 66 — Pin and canvas-group IDs can collide

**Context:** Pins and groups are created rapidly or by programmatic/batched interactions.

**Bug:** Multiple objects created within the same millisecond can receive identical IDs.

**Root cause:** Pins use `pin-${Date.now()}` and groups use `g-${Date.now()}` without random or monotonic disambiguation.

**Proposed solution:** Use `crypto.randomUUID()` or the shared collision-resistant ID helper for every entity type; validate existing duplicates during load/import.

**Priority / confidence:** P2 / Path-dependent.

**Status:** **Open.** Corrects the old assertion that all non-card IDs are collision-proof.

---

# Consolidated status

## Tracker totals

| Classification | Count | Meaning |
|---|---:|---|
| Confirmed actionable or partially mitigated | **56** | Source-supported issues that remain open or only partly resolved |
| Needs product decision/runtime verification | **5** | Bugs 26, 34, 35, 36, and 39 |
| Retired false/misguided findings | **5** | Bugs 25, 28, 33, 37, and 38 |
| **Total tracked entries** | **66** | Includes corrected and retired entries for audit history |

Retired findings must not be included in open-bug or severity counts. “Needs decision/verification” findings must not be presented as source-proven defects.

## Critical release-blocking cluster

The following should be treated as the release-blocking data-integrity set:

1. **Bug 24:** workspace-qualified card mutations.
2. **Bugs 5, 6, 9, 10, and 40–44:** revision, adoption, dirty-generation, and retry correctness.
3. **Bugs 14, 45, 54, and 55:** durable deletion and reversible cleanup.
4. **Bugs 16, 19, 29, 51, and 58:** identity safety, import validation, and malformed-data containment.
5. **Bug 48:** atomic, truthful full-backup restore behavior.

## Revised execution order

| Step | Work item | Required outcome |
|---:|---|---|
| **0** | **Bug 24** | Scope all direct card mutations to explicit workspace/card identity; reject ambiguity. |
| **1** | **Bugs 40–44 plus 5, 6, 9, 10, and 30** | Replace path-level optimistic saves with revisioned, generation-owned writes and durable retry semantics. |
| **2** | **Bugs 41–42** | Reconcile every document class symmetrically and distinguish missing data from failed reads. |
| **3** | **Bugs 14, 45–46, and 52–55** | Make create/delete/asset lifecycle durable, idempotent, reversible during grace periods, and transactionally observable. |
| **4** | **Bugs 16, 19, 29, 51, 58, and 66** | Migrate identities, remap references, harden clipboard/import, and enforce project-wide validation. |
| **5** | **Bugs 48–50 and 56** | Implement staged backup import/restore, safe serialization, complete activation, rollback/recovery, and history epochs. |
| **6** | **Bug 47** | Enforce View/reference read-only capability at domain and persistence boundaries. |
| **7** | **Bugs 27, 31, 39, and 56** | Define undo semantics, eliminate nested transitions, cap memory, and prevent cross-epoch restoration. |
| **8** | **Bugs 1–4, 7, 12–13, and 57** | Rework presence/session/routing state machines after persistence correctness is established. |
| **9** | **Bugs 17–23 and 59–61** | Repair clone and reminder lifecycle behavior; separate synchronized configuration from runtime delivery. |
| **10** | **Bugs 20, 32, 34–36, and 62–65** | Resolve editor/UI issues after product decisions and runtime verification where required. |

## Architecture decisions recorded by this revision

1. **Project ID is an identity namespace.** Reusing an internal card ID in a separately duplicated project is not itself a cross-project collision; this retires Bug 28’s critical consequence.
2. **Workspace-qualified mutation is required even after UUID migration.** UUIDs reduce collisions but must not be the authorization/scope mechanism for writes.
3. **Clean does not mean fresh.** Every cloud write needs server revision protection, including forced switch-time saves.
4. **Dirty state belongs to a content generation.** An old completion cannot clear a newer edit.
5. **Read failure is not absence.** Defaults must never be uploaded after an indeterminate remote read.
6. **Read-only mode is a capability boundary.** Scattered component guards are insufficient.
7. **Deletion is a durable state transition, not immediate hard cleanup.** Images should be garbage-collected only after confirmed deletion and the undo window.
8. **Import/restore must be staged and versioned.** React rollback alone cannot undo persistence side effects.
9. **Refs must reflect committed state.** Do not assign shared refs during render to solve history freshness; abandoned concurrent renders can leak speculative values.
10. **Validator input is untrusted.** Shape validation must occur before traversal or mutation.

## Current project status

- **Data integrity:** Release-blocking paths remain in cross-workspace card updates, sync generation/retry behavior, import, and deletion.
- **Sync architecture:** Functional in normal conditions but not safe under stale-clean clients, overlapping writes, failed reads, or partial retry execution.
- **Backup/restore:** Not currently reliable as an atomic disaster-recovery replacement.
- **Reference/View mode:** Visually read-only in many paths but not a complete zero-write session.
- **Undo:** Text-edit undo exists, contrary to the old tracker. The real issues are unbounded memory, durable deletion reversal, replacement epochs, and undefined global-versus-workspace semantics.
- **Identity:** Card counters are unsafe; pins and groups also have timestamp-only collision risk. Project duplication is not a current cross-project collision.
- **Reminder system:** Detection, hidden-mode lifecycle, scheduler persistence, re-enable scheduling, workspace-open behavior, and random mode need correction.
- **Validation:** Duplicate/reference checks are incomplete and malformed data can crash validation.

## Verification note

This revision is based on static code-path analysis at commit `cd05793ea54f6db8a1e88a09434d02f4cc74c2bc` plus a successful production build (`npm run build`, 1,778 modules). The repository has no meaningful automated test suite. Timing-dependent browser, multi-device Firestore, and React event-listener behaviors are therefore marked path-dependent or requiring runtime verification rather than overstated as reproduced facts.
