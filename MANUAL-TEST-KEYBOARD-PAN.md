# Test for Keyboard Canvas Pan — moving the canvas without the mouse

Branch: `feature/keyboard-canvas-pan`.

---

## 1. What this changes

One new shortcut: **Shift + the Arrow keys move the canvas.**

That is the whole feature. It closes the last gap in the card-making loop, which
until now needed the mouse for one step:

**Ghost ON → `N` → title → `Tab` → description → `Esc` → `Shift+Arrow` → `N` → repeat**

The Ghost Card is still the aiming device. It stays nailed to the centre of the
screen, so `Shift+Arrow` slides the canvas underneath it, and the next `N` lands
wherever the outline ended up. Nothing else about `N`, the ghost, or card
placement changed.

**Shift + Arrow only.** The arrow keys on their own still do what they always
did: move the cards you have selected. That distinction is the thing to test
hardest — see section 4.

### Why Shift and not something else

| Combination | Why not |
|---|---|
| Plain arrows | Already taken. They nudge selected cards, and they steer the Mini Map frame. |
| `Alt` + arrows | That is the browser's Back and Forward. |
| `Ctrl` / `Cmd` + arrows | Claimed by the operating system, and by "jump a whole word" in text. |
| **`Shift` + arrows** | **Used by nothing in this app.** |

---

## 2. Words I use here

| Word | What it means |
|---|---|
| **the canvas** | The main area where cards live. |
| **the Ghost button** | The crosshair button in the bottom-right floating toolbar. Green when on. Or press **G**. |
| **the chip** | The badge in the top bar reading **Saved**, **Syncing…** or **Unsaved changes**. |
| **a press** | One tap of the key. Holding the key down repeats it, which pans continuously. |

---

## 3. The main thing to test

1. Open the app in an editor tab, on a workspace with a few cards.
2. Click an empty patch of canvas, so **no card is selected**.
3. Hold **Shift** and tap the **Right Arrow**.

You should get: the canvas slides, revealing more of the space to the right. The
cards move left across your screen. The grid moves with them.

4. Try all four arrows with Shift held. Each should move the view in the
   direction the arrow points.
5. **Hold** Shift+Right down. The canvas should pan smoothly and continuously,
   and stop the moment you let go.
6. Zoom right out with the mouse wheel, then pan again. Then zoom right in and
   pan again. **A press should always move the view the same distance on your
   screen**, whatever the zoom.

### The complete hands-off loop

7. Press **G** to turn the ghost on.
8. Press **N**, type a title, press **Tab**, type a description, press **Esc**.
9. Press **Shift+Right** two or three times.
10. Press **N** again and repeat.

You should get: a row of cards, none of them overlapping, **without your hands
leaving the keyboard at any point.** Two presses moves further than a card is
wide, so two or more presses between cards always leaves a clean gap.

---

## 4. What must NOT happen

This is the important section. The feature is meant to be invisible everywhere
except the canvas position.

### Typing is untouched

1. Press **N** to make a card and start typing a title.
2. With the cursor in the title, hold **Shift** and press the **Left Arrow**
   a few times.

You should get: **letters highlighted, one at a time — the normal way of
selecting text.** The canvas must not move even slightly.

3. Press **Tab** to get into the description. Type a sentence or two.
4. Use **Shift+Arrow** in there, including **Shift+Up** and **Shift+Down**.

You should get: normal text selection, across lines. The canvas must not move.

5. Try the same in the workspace-name box, the search box, and a task or pin
   name field. Same result everywhere: text selection, no panning.

The rule is that if the cursor is in something you can type into, `Shift+Arrow`
belongs to that field and this feature does not exist.

### Selected cards do not move

1. Click a card to select it.
2. Press the **arrow keys on their own.** The card should move, 20px a press,
   as it always has.
3. Now press **Shift+Arrow**.

You should get: **the canvas pans, and the card does not move.** The card stays
exactly where it is on the canvas — it just travels across your screen along with
everything else.

4. Press **Ctrl+Z**.

You should get: the undo that reverses **step 2**, the nudge. The panning from
step 3 must not appear in the undo history at all. Keep pressing Ctrl+Z — you
should never see the view jump back to a previous position.

### Nothing is saved and nothing is synced

1. Wait for the chip to read **Saved**.
2. Now pan a lot. Twenty or thirty presses, all four directions.
3. Watch the chip for the next ten seconds or so.

You should get: **the chip stays on Saved.** It must never flick to
**Unsaved changes** or **Syncing…**. Panning is a change to what you are looking
at, not a change to your project, so there is nothing to save.

4. Reload the page. Your cards should all be exactly where you left them. (The
   view itself will reset to the origin — that is the existing behaviour for
   zoom and position, unchanged by this branch.)

### The rest of the keyboard still works

Run through these with no card selected. All should behave as before:

- **G** ghost, **W** Mini Map, **N** new card, **F** focus, **E**, **T**, **R**,
  **C**, **A**, **M**, **S**, **P**
- **Shift+D** hide descriptions, **Shift+F** focus mode, **Shift+P** drop a pin
- **Ctrl+Z** / **Ctrl+Shift+Z** undo and redo
- **Ctrl+C** / **Ctrl+X** / **Ctrl+V**
- **Ctrl+Shift+E** export, **Ctrl+Shift+D** manual sync
- **Esc** clears a selection

The three Shift-letter shortcuts are worth a specific look, since this branch
adds a Shift combination: **Shift+D**, **Shift+F** and **Shift+P** must each do
their own job and must not pan.

### The Mini Map

1. Press **W** to open the Mini Map, then click its viewport frame to select it.
2. Press the **arrow keys on their own.** The frame moves, as before.
3. Press **Shift+Arrow**.

You should get: the canvas pans once, by the normal amount — not twice, and not
a double-speed jump. The Mini Map frame should follow along to show the new
position.

### Connections and selection

- Drawing a connection between two cards still works.
- Panning with the keyboard while cards are selected must not drop the
  selection, and must not create or break any connection.

---

## 5. Checking it really is viewport-only

If you want to confirm the claim in section 4 rather than take it on trust, the
short version is that the shortcut writes one thing — the same canvas
position value the mouse drag writes — and that value is not part of your
project data. It is in no save file, no snapshot, and no Firebase document.

A quick way to see it for yourself: pan a long way, then open a **second** tab on
the same project. The second tab shows the cards in their original places, at its
own view position. Nothing about your panning travelled between the two tabs,
because there was nothing to travel.

---

## 6. Sign-off

| # | Check | Pass / Fail |
|---|---|---|
| 1 | Shift+Arrow pans, all four directions | |
| 2 | Held key pans continuously, stops on release | |
| 3 | Same on-screen distance per press at any zoom | |
| 4 | Full loop: N → title → Tab → description → Esc → pan → N, no mouse | |
| 5 | Shift+Arrow in a card title selects text, no pan | |
| 6 | Shift+Arrow in a card description selects text, no pan | |
| 7 | Shift+Arrow in other text fields selects text, no pan | |
| 8 | Plain arrows still nudge selected cards | |
| 9 | Shift+Arrow does not move a selected card | |
| 10 | Panning creates no undo entry | |
| 11 | Chip stays Saved while panning | |
| 12 | Cards unchanged after reload | |
| 13 | Letter shortcuts unaffected | |
| 14 | Shift+D, Shift+F, Shift+P unaffected | |
| 15 | Undo / redo / copy / paste / export / sync unaffected | |
| 16 | Mini Map: plain arrows move frame, Shift+Arrow pans once | |
| 17 | Selection and connections unaffected | |
