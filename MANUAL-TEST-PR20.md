# Test for PR #20 — the Links section in the Card Editor

Branch: `feat/card-editor-links` (pull request #20).

**About 10 minutes.** Nothing is removed and nothing about how cards are saved is
touched. A new **Links** strip appears at the bottom of the Card Editor, listing the
web addresses already written on the card you have selected.

---

## 1. What this change does

When the card you are editing contains a web address, the Card Editor grows a strip
along its bottom edge:

```
  ⌄  🔗  LINKS (3)
     ┌──────────────────────────────────────────────────┐
     │ Ashford Joinery quote            ↗ Open in new tab│
     │ https://www.ashford-joinery.com/quotes/8812       │
     ├──────────────────────────────────────────────────┤
     │ planning.example.gov.uk          ↗ Open in new tab│
     │ https://planning.example.gov.uk/applications/...  │
     └──────────────────────────────────────────────────┘
```

Each row gives the link a name, the full address underneath it, and an **Open in new
tab** button. One click on the button opens that address in a **new browser tab**.
Clicking the name does the same thing — the button is there so the action is obvious,
but the whole name is a link too.

**Four ways of writing a link are recognised:**

| What you type on the card | What the list shows |
|---|---|
| `[Ashford quote](https://ashford.com/q/8812)` | named **Ashford quote** |
| `https://planning.gov.uk/apps/4471` on its own | named after the site |
| `<https://pinterest.com/board/kitchen>` | named after the site |
| `www.surveyors.org/find` — no `https://` | named after the site, opened over https |

**The section only exists when the card has links.** A card of plain notes looks
exactly as it does today — no empty box, no extra heading, nothing.

## What it deliberately does NOT do

- **It stores nothing.** There is no new information saved on your cards. The list is
  re-read from the card's own text every time you look at it, which is the reason it
  can never drift out of step with what the card actually says. Nothing new is sent
  to the server, nothing new is written to a backup, and there is nothing to undo.
- **It does not change your card text.** Read-only, start to finish.
- **It does not touch the canvas, the Task Manager, or the card hover toolbar.** Only
  the Card Editor panel.
- **It skips addresses inside a fenced code block** (text between ``` marks), because
  those are examples being quoted rather than places to visit. A link wrapped in
  single backticks — `` `https://api.example.com` `` — still counts.

---

## 2. Before you start

| | |
|---|---|
| **Where** | Open pull request #20 on GitHub. Scroll to the bottom. In the `vercel` comment, click **Preview**. |
| **How long** | About 10 minutes. |
| **What it touches** | Nothing is saved or changed. You will type some test text into a card, which you can delete afterwards. |
| **Risk** | Very low — the feature only reads. |

**Test cards.** Make one new card for this and reuse it; you can delete it at the end.

---

## Test 0 — am I testing the right build?

1. Open the Preview link and wait for your project to appear.
2. Click a card, then open the **Card Editor** (the sidebar button, or **E**).
3. In the **Content** box, type: `https://example.com`

| What you see | What it means |
|---|---|
| A **LINKS (1)** strip appears at the bottom of the panel | ✅ Right build. Carry on. |
| No strip appears | ❌ The Preview link has not updated. Stop and tell me. |

**Result: ☐ Right build ☐ Wrong build — I stopped**

---

# GROUP A — the four ways of writing a link

Work in one card, with the Card Editor open. Clear the Content box between tests.

## A1 — a plain address

1. Put this in Content: `Planning portal: https://planning.example.gov.uk/apps/4471`

**What should happen:** **LINKS (1)**, one row, named after the site
(`planning.example.gov.uk`), with the full address underneath.

☐ PASS ☐ FAIL ☐ BLOCKED

## A2 — a named link

1. Replace Content with: `See [the quote](https://example.com/quotes/8812) first`

**What should happen:** **LINKS (1)**, and the row is named **the quote** — not named
after the site. The address still shows underneath.

☐ PASS ☐ FAIL ☐ BLOCKED

## A3 — an address with no https://

1. Replace Content with: `Ref www.surveyors-assoc.example.org/find`

**What should happen:** **LINKS (1)**. Click **Open in new tab** — the address bar in
the new tab starts with `https://`.

☐ PASS ☐ FAIL ☐ BLOCKED

## A4 — an address in angle brackets

1. Replace Content with: `Ideas <https://pinterest.example.com/board/kitchen>`

**What should happen:** **LINKS (1)**, one row. Note there is **one** row, not two —
the brackets are not counted as a second link.

☐ PASS ☐ FAIL ☐ BLOCKED

## A5 — a link in the title

1. Empty the Content box completely.
2. Put `https://example.com/parked` in the **Title** box.

**What should happen:** **LINKS (1)**. The title is searched as well as the content,
because parking a bare address in a card's title is a normal thing to do.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP B — opening a link

## B1 — the button opens a NEW TAB

1. Put `https://example.com` in Content.
2. Click **Open in new tab**.

**What should happen:** a **new tab** opens in your existing browser window — the tab
strip along the top gains a tab. It must **not** be a separate small window floating
on its own.

3. Go back to the mind-space tab.

**What should happen:** your project is exactly as you left it — same card selected,
same scroll position, nothing reloaded.

☐ PASS ☐ FAIL ☐ BLOCKED

## B2 — clicking the name works too

1. Click the blue **name** of the link (not the button).

**What should happen:** the same new tab behaviour.

☐ PASS ☐ FAIL ☐ BLOCKED

## B3 — clicking a link does not disturb the card

1. Note which card is selected. Click **Open in new tab**, then return to the app.

**What should happen:** the same card is still selected. Clicking the link did **not**
select a different card, deselect, move anything, or count as an edit you could undo.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP C — the list keeps up, and stays out of the way

## C1 — it appears and disappears as you type

1. Clear the Content box. **No LINKS strip should be visible at all.**
2. Type `https://example.com` — the strip appears as you finish typing.
3. Delete what you typed — the strip disappears completely.

☐ PASS ☐ FAIL ☐ BLOCKED

## C2 — a plain card looks untouched

1. Put only ordinary notes in the card: `Ring the surveyor before Friday.`

**What should happen:** no LINKS strip, no empty heading, no extra space. The panel is
exactly as it was before this change.

☐ PASS ☐ FAIL ☐ BLOCKED

## C3 — switching cards switches the list

1. Select a card with links, then select a different card with different links.

**What should happen:** the list changes to the second card's links immediately.

☐ PASS ☐ FAIL ☐ BLOCKED

## C4 — many links stay inside their own box

1. Put six or seven different addresses in one card.

**What should happen:** the strip stops growing at about four rows and **scrolls
inside itself**. The Title and Content boxes above it stay usable — the links must
never squeeze the editor off the panel.

☐ PASS ☐ FAIL ☐ BLOCKED

## C5 — it folds away

1. Click the **LINKS (n)** heading.

**What should happen:** the rows collapse; the heading with its count stays. Click
again and the rows come back. It stays folded as you move between cards, until you
unfold it.

☐ PASS ☐ FAIL ☐ BLOCKED

## C6 — it works with the Preview open

1. On a card with links, click the **eye** button to show the markdown Preview.

**What should happen:** Content, Preview and the Links strip are all on screen at
once. The Links strip stays pinned at the bottom. Nothing overlaps.

☐ PASS ☐ FAIL ☐ BLOCKED

## C7 — the same address twice is one row

1. Put this in Content: `[first](https://example.com/x) and again [second](https://example.com/x)`

**What should happen:** **LINKS (1)** — one row, named **first**. The same
destination twice is two rows that would do the same thing.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP D — the judgement calls

These are the cases where the list has to decide, and they are the ones most likely
to feel wrong to you. If any of them do, say so — they are choices, not laws.

## D1 — a full stop at the end of a sentence is not part of the address

1. Put in Content: `Read https://example.com/guide before Friday.`
2. Click **Open in new tab**.

**What should happen:** the address opened is `https://example.com/guide` with **no
full stop** on the end.

☐ PASS ☐ FAIL ☐ BLOCKED

## D2 — brackets that belong to the address are kept

1. Put in Content: `(see https://en.wikipedia.org/wiki/Cat_(animal))`

**What should happen:** the address keeps `_(animal)` — the bracket that is part of
the address survives, and the one that closes your sentence is dropped.

☐ PASS ☐ FAIL ☐ BLOCKED

## D3 — code samples are left out

1. Put this in Content — five lines, with the three back-ticks on their own lines:

        Real one: https://real.example.com

        ```js
        fetch('https://sample.example.com/api')
        ```

   (Type the back-ticks and the indented lines without the leading spaces shown here.)

**What should happen:** **LINKS (1)** — only `real.example.com`. The address inside
the code block is not offered.

☐ PASS ☐ FAIL ☐ BLOCKED

## D4 — a file path is not a link

1. Put in Content: `See [the notes](/docs/setup.md)`

**What should happen:** **no LINKS strip.** There is no website to open — a card is
not a web page, so there is nothing for `/docs/setup.md` to be relative to.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# GROUP E — safety, and read-only tabs

## E1 — a dangerous link is refused

**This is the one test worth doing carefully.** Card text can arrive from a file you
imported, so the list must never turn just any text into something clickable.

1. Put exactly this in Content: `[click me](javascript:alert('gotcha'))`

**What should happen:** **no LINKS strip appears at all.** Nothing becomes clickable
and no pop-up ever appears. Your text stays in the Content box exactly as you typed it
— the card is not edited, the address is simply not offered as a link.

☐ PASS ☐ FAIL ☐ BLOCKED

## E2 — a View tab shows links and stays read-only

1. Open a read-only **View** tab (the "Open View tab" button).
2. Select a card that has links, with the Card Editor open.

**What should happen:** the Links strip is there and the links open normally. It reads
only, so it is allowed in a View tab. The View tab still writes nothing — the Title
and Content boxes are still not editable.

☐ PASS ☐ FAIL ☐ BLOCKED

## E3 — Arrange mode is unaffected

1. Turn on **Arrange** mode with a linked card selected.

**What should happen:** the Links strip still lists and still opens links. Arranging
still works as before.

☐ PASS ☐ FAIL ☐ BLOCKED

---

# 6. What I checked, and what I could not

**Automated tests: 362 passing** (326 before this change, plus **36 new**). The new
ones cover the parsing decisions above — every case in Group A and Group D, the
duplicate rule in C7, and the refusal in E1.

I also mounted the real Card Editor panel in a test browser and confirmed, on the
actual rendered panel: the strip appears with the right count, every link carries the
"open in a new tab" instruction, a click on the button keeps that instruction intact
while **not** leaking through to the canvas underneath (which is what B3 checks), the
strip vanishes for a card with no links, no clickable element is produced for the
`javascript:` case, and folding works. Two screenshots of the rendered panel are on
the pull request.

**What that does not prove, and why you are still needed:**

- **That a real browser opens a tab rather than a window.** A test browser cannot tell
  me what your Chrome does with it. Test B1 is the only proof.
- **That it feels right at your panel width, with your cards.** The screenshots are at
  the narrowest the panel goes.
- **Group E2 and E3** — the View and Arrange behaviour — I checked the panel in those
  modes in isolation, not a genuine second tab against the live server.

**One thing you should know, which is not new.** The Card Editor has always filled its
Title and Content boxes when you *select* a card, and does not refresh them if that
card's text is changed from somewhere else while it sits open. The Links list reads
from the same boxes, so it always agrees with what the editor is showing you. It is
worth knowing that this is inherited behaviour, not something this change introduced.

---

# 7. Owner sign-off

**Result: ☐ ___ of 22 PASS.** Not yet signed off.

---

# 8. Changes to this document

- **v1** — written with the feature.
