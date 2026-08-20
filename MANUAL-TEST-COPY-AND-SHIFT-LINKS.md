# Test for Copy description + Shift + Click links

Branch: `feature/card-copy-and-shift-click-links`.

---

## 1. What this changes

Two small things, nothing else.

**1. A Copy button in the card hover toolbar.** The toolbar that appears above a
card on hover was Link / Colour / Delete. It is now **Link / Colour / Copy /
Delete**. Copy puts that card's **description** on your clipboard — not the
title, not the ID, not any card metadata.

**2. Links inside card content now need Shift.** A plain click on a link no
longer opens anything. **Shift + Click** opens it in a new browser tab.

Before this change a plain click opened the link, which was too easy to trigger
by accident while selecting or dragging a card. Opening a link is now a
deliberate gesture.

---

## 2. Setup

You need a card whose description contains a real markdown link. Put this in a
card's description:

```
Docs here: [example site](https://example.com)
```

**The link must be written as markdown.** A bare `https://example.com` pasted on
its own is *not* turned into a link by this app, and never was. If you test with
a bare URL you will see plain text and nothing will happen on any click — that is
correct, not a bug.

---

## 3. Copy

| # | Do this | Expect |
|---|---|---|
| 1 | Hover a card in **Edit** mode | Toolbar shows four buttons: Link, Colour, **Copy**, Delete |
| 2 | Click **Copy** | Toast: **"Description copied"** |
| 3 | Paste into any text editor | Exactly the description text. **No title, no ID, no metadata** |
| 4 | Hover a card with an **empty** description, click Copy | Toast: **"No description to copy"**. Nothing on the clipboard changes |
| 5 | Switch to **Arrange** mode, hover a card, click Copy | Works the same |
| 6 | Click Copy on a card with a **multi-line** description | All lines paste, leading/trailing blank space trimmed |

### Copy must not have side effects — check each of these

| # | Do this | Expect |
|---|---|---|
| 7 | Click Copy, then look at the card | **Unchanged.** Same title, description, colour, position |
| 8 | Click Copy, then press **Ctrl+Z** (undo) | Undo steps back to whatever you did *before* the copy. **Copy is not an undo step** |
| 9 | Click Copy, then watch the sync/save indicator | **No save or sync is triggered.** No dirty state |
| 10 | Click Copy on card A, then use the app's own card **Cut/Copy/Paste** (the one that duplicates cards) | Still pastes the **card** you cut/copied, not the text. The two clipboards are separate and do not interfere |
| 11 | Click Copy | The card does **not** get selected, does **not** enter edit mode, and does **not** move |

### Where Copy appears

| # | Do this | Expect |
|---|---|---|
| 12 | Open the **View** route (`#/view/...`) and hover a card | **No hover toolbar at all** — so no Copy button either. This is unchanged behaviour: the toolbar has always been absent in View mode. See the note in section 5 |

---

## 4. Shift + Click links

Test all three modes. The behaviour must be **identical** in every one.

| # | Mode | Do this | Expect |
|---|---|---|---|
| 1 | **Edit** | **Plain click** the link | **Nothing opens.** No new tab, no navigation |
| 2 | **Edit** | **Shift + Click** the link | Opens `https://example.com` in a **new tab**. Your canvas tab stays where it was |
| 3 | **Arrange** | Plain click the link | Nothing opens |
| 4 | **Arrange** | Shift + Click the link | Opens in a new tab |
| 5 | **View** (`#/view/...`) | Plain click the link | Nothing opens |
| 6 | **View** | Shift + Click the link | Opens in a new tab |

**Point 5 and 6 are the important ones.** View mode is read-only, so it would be
easy for it to accidentally get its own link behaviour. It must not. Same rule
everywhere.

### Links must not disturb existing card interactions

| # | Do this | Expect |
|---|---|---|
| 7 | In **Edit** mode, plain click the link | The card does **not** enter description-edit mode. The click is absorbed by the link |
| 8 | In **Edit** mode, click the description *next to* the link | Enters edit mode as usual. Unchanged |
| 9 | Press and drag **starting on the link** | Card drags normally. No tab opens on release |
| 10 | Shift + Click the link | Card is **not** selected or moved as a side effect |
| 11 | Hover the link | Tooltip reads **"Shift + Click to open in a new tab"** |
| 12 | Open the new tab from Shift + Click, then check it | Opens with `noopener` — the new tab cannot reach back into the app |

### One zoom caveat worth knowing

| # | Do this | Expect |
|---|---|---|
| 13 | Zoom the canvas **far out** (below 25%), look at the card | Description renders as **plain text with no clickable link**. Markdown formatting is off at low zoom. Pre-existing behaviour, not changed here |
| 14 | Zoom back in above 25% | Link renders again, Shift + Click works |

### Also check the side editor panel

| # | Do this | Expect |
|---|---|---|
| 15 | Select a single card to open the card editor panel, look at its **preview** pane | Link is rendered there too |
| 16 | Plain click it in the preview, then Shift + Click it | Same rule: plain click does nothing, Shift + Click opens a new tab |

---

## 5. Known scope limit

**Copy is available in Edit and Arrange, not in the View route.**

The hover toolbar it lives in is gated on edit access and has never rendered in
View mode. Adding a toolbar to View just to hold Copy would have meant
introducing new UI into a read-only mode, which the brief for this change ruled
out. If you do want Copy while viewing, say so and it is a small follow-up: the
copy action itself is already read-only and safe to expose there.
