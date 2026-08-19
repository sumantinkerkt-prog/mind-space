# Test for the Ghost Card — aiming a new card before you make it

Branch: `feature/ghost-card-placement-guide`.

---

## 1. What this changes

Pressing **N** has always created a card at the centre of the part of the canvas
you can see. That never changed. What was missing was any way to *see* that
centre point, so every new card had to be dragged into place afterwards.

Three things are new:

1. **The Ghost Card.** A dashed outline showing the exact rectangle the next
    **N** press will fill. Toggle it with the **Ghost** button in the top bar, or
    the **G** key. It stays fixed in the middle of the screen; you pan the canvas
    underneath it until the outline sits where you want the card.
2. **N puts the cursor in the title.** You can type the title straight away
    instead of creating the card and then clicking it.
3. **Tab moves from the title to the description.** Enter still commits the
    title and leaves it, exactly as before.

The Ghost Card is a drawing and nothing else. It has no ID, it is not a card,
and it is not part of your project data. Section 5 is how you check that.

---

## 2. Words I use here

| Word | What it means |
|---|---|
| **the canvas** | The main area where cards live. |
| **the Ghost button** | A new button in the top bar labelled **Ghost**, with a crosshair icon. It turns green when the ghost is on. |
| **the chip** | The small badge in the top bar that says **Saved**, **Syncing…** or **Unsaved changes**. |
| **the Console** | A box where you can paste a line of text and press Enter. Press **F12**, then click **Console**. |

---

## 3. The main thing to test

1. Open the app in an editor tab and go to a workspace with some cards.
2. Click **Ghost** in the top bar (or press **G**). A dashed outline appears in
    the middle of the screen.
3. Drag the canvas around. **The outline must not move.** It stays in the middle
    of the screen while your cards slide underneath it.
4. Zoom in and out with the mouse wheel. **The outline must grow and shrink with
    your cards**, staying the same size relative to them.
5. Pan until the outline sits over an empty patch of canvas where you want a card.
6. Press **N**.

You should get: a new card appearing **exactly where the outline was**, with the
cursor already blinking in its title.

7. Type a title. Press **Enter**. The title is saved and the cursor leaves it.
8. The ghost is **still on**. Pan somewhere else and press **N** again.

Repeat a few times. Each card should land where the outline was, every time, at
any zoom level.

### The one thing that will feel different

After you press **N**, the cursor is inside the title. So pressing **N** a second
time **types the letter "n"** instead of making another card — the same as it
would in any text box.

To make the next card: press **Enter** first (which leaves the title), then pan,
then **N**. So the rhythm is:

> **N** → type the title → **Enter** → pan → **N** → type the title → **Enter** → …

---

## 4. The description

1. Press **N**. Type a title.
2. Press **Tab** instead of Enter. The cursor should move down into the
    description of the same card.
3. Type a description. It should appear on the card.
4. Click on empty canvas to finish.

Check the card kept both the title and the description.

**Known gap, and it is not new:** there is no key that gets you *out* of the
description — you click elsewhere to finish, exactly as you always have when
clicking into a description. Tell me if you want Escape to do it and I will add
it as a separate change.

Also check **Shift+Tab** in the title still moves focus backwards the way your
browser normally does. It should not jump to the description.

---

## 5. Proving the ghost is not data

This is the part that matters most, because a ghost that accidentally became a
real card would be a data problem.

1. Turn the ghost **on**. Do not press N.
2. Watch the chip in the top bar. **It must not change.** No "Unsaved changes",
    no "Syncing…". Turning the ghost on and off is not an edit and must not save
    anything.
3. Turn the ghost on and off ten times. Still nothing from the chip.
4. With the ghost on, open the mini map (**W**). **The ghost must not appear in
    the mini map.** Only real cards are in there.
5. With the ghost on, try to click the outline, drag it, and right-click it. All
    three should do nothing — clicks pass straight through to the canvas
    underneath, exactly as if the outline were not there.
6. With the ghost on, open the Data Health panel. The card count and the ID
    report should be identical whether the ghost is on or off.
7. Reload the page. **The ghost should come back OFF.** It is not remembered, on
    purpose — same as Arrange mode and the mini map.

Then, in the Console, paste this and press Enter:

```
Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.includes('workspace')))) || {})
```

It prints the parts of a saved workspace. There must be **no mention of a ghost**
anywhere in it.

---

## 6. Checking undo still behaves

1. Press **N**. Type `Hello`. Press **Enter**.
2. Press **Ctrl+Z** once.

The card should disappear on that **one** press. Not two.

(This is worth checking specifically. Creating a card saves an undo point, and
opening a title for editing also saves one. Doing both would have made the first
Ctrl+Z look like it did nothing. There is a guard for it — this step is how you
confirm the guard works.)

3. Press **Ctrl+Y** (redo). The card should come back.
4. Now press **N**, type a title, press **Tab**, type a description, click away.
    **Ctrl+Z** should take the description off first, and a second **Ctrl+Z**
    should remove the card. Two steps, because the title and the description are
    two separate edits — which is how it already worked when you clicked into
    them.

---

## 7. Checking nothing else moved

These are the parts I changed around, so they are the parts most worth a look.

1. **Arrange mode.** Press **M** to get into Arrange. Press **N**. A card should
    appear at the centre as usual, but **no text box should open** — Arrange mode
    is for moving cards, not typing in them. The card should say "New Card".
2. **Right-click → Add Card Here.** Should still put the card exactly where you
    right-clicked, and should still say "New Card".
3. **The "Add card" button on a group** (in the outline/backlog view). Still
    works, still says "New Card".
4. **Add Card in the "More" menu.** Same.
5. **Clicking an existing card's title** to edit it. Should work exactly as
    before, including Enter to finish.
6. **A View tab** (the read-only one). The **Ghost** button should not be there
    at all, and pressing **G** should do nothing visible.

### One deliberate difference

A card created with **N** now starts with an **empty** title instead of the words
"New Card", because the cursor is sitting in it ready for you to type — if it
said "New Card" your first letter would land in front of that text and you would
get "RoadmapNew Card".

Every other way of making a card still says "New Card", because those give you a
card you have to go and find, and a blank one is harder to spot.

So: if you press **N** and then click away without typing anything, you get a
card with an empty title showing the grey "Enter Title..." prompt. That is
expected. The card is still there and still fully editable.

### One deliberate fix

New cards now land **truly centred** on the middle of the screen. They used to
land about 60 pixels left and 20 pixels above centre, because the old code
assumed a card was 300×100 when a new one is really 180×60. Nobody could see it
while the target point was invisible. If cards feel very slightly further
right/down than they used to, that is this, and it is on purpose — it is also
what lets the outline tell the truth about where the card will go.

---

## 8. What is covered by automatic tests

`npm test` — 326 tests, 42 of them new, in `src/ghostPlacement.test.js`.

The important one is a group called **"ghost rectangle agrees with where the card
is created"**. The outline is drawn in screen coordinates and the card is created
in canvas coordinates — two different systems — so "the outline shows where the
card goes" is a claim that could quietly stop being true. That test works out
where the card will really appear on screen and compares it against the outline,
across eight combinations of panning and zooming including the 5% and 300% zoom
limits.

The rest cover the centring maths, the off-centre bug not coming back, what Enter
/ Tab / Shift+Tab do, not opening a text box in Arrange mode, and that no
combination of inputs can produce a `NaN` coordinate on a saved card.

What the tests **cannot** cover: whether the cursor actually lands in the title,
and whether Tab actually moves into the description. Those need a real browser
and a real keyboard, which is what sections 3 and 4 are for.
