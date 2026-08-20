/**
 * GHOST CARD / CENTRE PLACEMENT
 *
 * Pressing N has always created a card at "the canvas point under the centre of
 * the viewport" - that behaviour predates this module. What was missing was any
 * way for the user to SEE that point, so every new card had to be dragged into
 * place after the fact.
 *
 * The Ghost Card fixes that by drawing the rectangle the next card will occupy.
 * It is a visual readout of existing behaviour, NOT a new placement mechanism:
 *
 *   - it has no id, no node record and no entry in `workspaces`
 *   - it is therefore invisible to the autosave effect, the Firestore saver,
 *     `takeSnapshot`, the MiniMap and the id audit, all of which read from
 *     `workspaces` / `nodes`
 *   - pressing N still calls the one and only `addNode`
 *
 * The functions here are pure geometry and pure interaction rules so the parts
 * that are easy to get subtly wrong - the centring maths, and the agreement
 * between what the ghost promises and where the card actually lands - can be
 * tested without rendering React.
 *
 * DELIBERATELY NOT IN THIS MODULE: card sizing. `getNodeDimensions` in App.jsx
 * is the single source of truth for how big a card is, and callers pass the
 * result in as `cardWidth` / `cardHeight`. Re-deriving "a fresh card is 180x60"
 * here would create a second implementation free to drift from the first, and a
 * ghost that drew the wrong rectangle would be worse than no ghost at all.
 */

// A card created for immediate typing starts with an EMPTY title.
//
// The long-standing default was the literal string 'New Card'. That is fine for
// a card you will click into later, but it breaks a card you are about to type
// into: `autoFocus` on a textarea leaves the caret at offset 0, so the first
// keystroke lands in FRONT of the placeholder text and you get "RoadmapNew Card".
// An empty title renders the existing "Enter Title..." placeholder instead, and
// typing simply fills it.
export const NEW_CARD_TITLE = '';
export const NEW_CARD_CONTENT = '';

// Retained for the creation paths that do NOT focus the new card (the group
// "Add card" buttons, the More menu, "Add First Card", and right-click "Add Card
// Here"). Those produce a card the user has to find and click, and a card
// labelled 'New Card' is easier to find than a blank one, so their behaviour is
// left exactly as it was.
export const UNFOCUSED_NEW_CARD_TITLE = 'New Card';

/**
 * TRUE when the canvas element has real dimensions to centre against.
 *
 * `getBoundingClientRect()` returns zeros for an element that is not laid out -
 * the canvas is unmounted while the Outline/Backlog view is showing, for
 * instance. Centring on a 0x0 viewport would stack every new card at the same
 * spot, which is why `addNode` has always had a fallback for this case.
 */
export function isViewportMeasurable(viewportWidth, viewportHeight) {
  return (
    Number.isFinite(viewportWidth) &&
    Number.isFinite(viewportHeight) &&
    viewportWidth > 0 &&
    viewportHeight > 0
  );
}

function safeTransform(transform) {
  const scale = transform && Number.isFinite(transform.scale) && transform.scale !== 0 ? transform.scale : 1;
  return {
    x: transform && Number.isFinite(transform.x) ? transform.x : 0,
    y: transform && Number.isFinite(transform.y) ? transform.y : 0,
    scale,
  };
}

/**
 * The canvas coordinate currently sitting under the centre of the viewport.
 *
 * Inverse of the canvas layer's `translate(x, y) scale(s)` with
 * `transformOrigin: '0 0'`, i.e. screen = canvas * scale + pan, so
 * canvas = (screen - pan) / scale.
 */
export function viewportCentreInCanvas({ viewportWidth, viewportHeight, transform }) {
  const t = safeTransform(transform);
  return {
    x: (viewportWidth / 2 - t.x) / t.scale,
    y: (viewportHeight / 2 - t.y) / t.scale,
  };
}

/**
 * Where a card of the given size must be placed, in canvas coordinates, for it
 * to appear centred in the viewport. Returns the TOP-LEFT corner, because that
 * is what `node.x` / `node.y` mean.
 *
 * This corrects a long-standing off-centre bug. The previous code subtracted a
 * hardcoded `150, 50` - half of a 300x100 card - but a fresh card actually
 * renders at 180x60, so new cards landed up and to the left of the centre.
 * Nobody noticed while the target point was invisible; a ghost drawn at the
 * honest rectangle would have made it obvious. Deriving the offset from the real
 * card size fixes the placement and keeps the ghost truthful at the same time.
 */
export function centrePlacement({ viewportWidth, viewportHeight, transform, cardWidth, cardHeight }) {
  const centre = viewportCentreInCanvas({ viewportWidth, viewportHeight, transform });
  return {
    x: centre.x - cardWidth / 2,
    y: centre.y - cardHeight / 2,
    width: cardWidth,
    height: cardHeight,
  };
}

/**
 * Fallback position for when the canvas is not on screen and there is no centre
 * to speak of: drop the card to the right of the rightmost existing card.
 *
 * This is the pre-existing behaviour, moved here unchanged so `addNode` reads as
 * one decision instead of three inline branches.
 */
export function offscreenPlacement(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (list.length === 0) return { x: 200, y: 200 };
  let maxX = -Infinity;
  for (const node of list) {
    if (node && node.x > maxX) maxX = node.x;
  }
  if (!Number.isFinite(maxX)) return { x: 200, y: 200 };
  return { x: maxX + 320, y: 200 };
}

/**
 * The ghost's on-screen size.
 *
 * The ghost is drawn as a viewport-anchored overlay pinned to the centre of the
 * canvas, NOT as a child of the transformed canvas layer. That sounds like the
 * odd choice - the selection box lives inside the transform layer and gets pan
 * and zoom for free - but for something that must stay nailed to the centre of
 * the screen it is strictly simpler: "centre" is just 50%/50%, so there is no
 * pan arithmetic and no `getBoundingClientRect()` read during render (which
 * would otherwise go stale on a window resize that did not change `transform`).
 *
 * Only the SIZE has to follow zoom, so the card grows and shrinks with the
 * canvas exactly as a real card would.
 */
export function ghostScreenSize({ transform, cardWidth, cardHeight }) {
  const t = safeTransform(transform);
  return { width: cardWidth * t.scale, height: cardHeight * t.scale };
}

/** Project a canvas point to screen space. Used to prove the ghost does not lie. */
export function canvasToScreen(point, transform) {
  const t = safeTransform(transform);
  return { x: point.x * t.scale + t.x, y: point.y * t.scale + t.y };
}

// ---------------------------------------------------------------------------
// Interaction rules
// ---------------------------------------------------------------------------

/** What a keypress inside the card TITLE field should do. */
export const TITLE_KEY_INTENT = {
  /** Not ours - let the textarea handle it (ordinary typing, arrows, Shift+Tab). */
  NONE: 'none',
  /** Commit the title and leave edit mode. */
  COMMIT: 'commit',
  /** Commit the title and move straight into the description field. */
  TO_DESCRIPTION: 'toDescription',
};

/**
 * Enter commits and exits, which is what the title field already did.
 *
 * Tab moves into the description, so a card can be filled in without touching
 * the mouse. When the description is not rendered - the View route's Shift+D
 * "hide descriptions" setting - there is nothing to move into, so Tab falls back
 * to committing rather than appearing to do nothing.
 *
 * Shift+Tab is left alone: it is the browser's "focus the previous thing", and
 * hijacking it would trap keyboard users in the card.
 */
export function titleKeyIntent(key, options = {}) {
  if (options.shiftKey && key === 'Tab') return TITLE_KEY_INTENT.NONE;
  if (key === 'Enter') return TITLE_KEY_INTENT.COMMIT;
  if (key === 'Tab') {
    return options.descriptionVisible ? TITLE_KEY_INTENT.TO_DESCRIPTION : TITLE_KEY_INTENT.COMMIT;
  }
  return TITLE_KEY_INTENT.NONE;
}

/**
 * Whether a newly created card should open its title for typing.
 *
 * Gated on `editMode` (Full Edit and not read-only). Arrange mode exists to move
 * cards without editing text, and the title textarea renders purely on
 * `editingTextNode` matching - the `editMode` check elsewhere guards the CLICK
 * that sets it, not the render. So without this gate, pressing N in Arrange mode
 * would pop open an editable field and quietly undermine the mode.
 */
export function shouldAutoFocusNewCard({ editMode }) {
  return editMode === true;
}

// The two conventions `editingTextNode` uses, named so new code cannot typo them:
// `title-<id>` means the title is being edited, a bare `<id>` means the description is.
export function titleEditKey(nodeId) {
  return `title-${nodeId}`;
}
export function descriptionEditKey(nodeId) {
  return String(nodeId);
}
