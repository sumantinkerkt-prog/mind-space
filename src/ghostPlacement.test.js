import { describe, it, expect } from 'vitest';
import {
  NEW_CARD_TITLE,
  NEW_CARD_CONTENT,
  UNFOCUSED_NEW_CARD_TITLE,
  isViewportMeasurable,
  viewportCentreInCanvas,
  centrePlacement,
  offscreenPlacement,
  ghostScreenSize,
  canvasToScreen,
  titleKeyIntent,
  TITLE_KEY_INTENT,
  shouldAutoFocusNewCard,
  titleEditKey,
  descriptionEditKey,
} from './ghostPlacement';

/**
 * A fresh card's real rendered size, per getNodeDimensions in App.jsx:
 *   width  = clamp(180, 180 + min(200, (title.length + content.length) * 1.2), 600)
 *   height = clamp(60,  60 + min(740, content.length * 0.3 + newlines * 18), 800)
 * With an empty title and empty content that is exactly 180 x 60.
 *
 * These tests take the size as an INPUT rather than deriving it, matching how
 * the module is used: App.jsx computes it with the real getNodeDimensions and
 * passes it in, so there is only ever one sizing implementation.
 */
const FRESH_CARD = { width: 180, height: 60 };

// =============================================================================
// isViewportMeasurable
// =============================================================================

describe('isViewportMeasurable', () => {
  it('accepts a laid-out canvas', () => {
    expect(isViewportMeasurable(1440, 900)).toBe(true);
  });

  it('rejects a 0x0 rect, which is what an unmounted canvas reports', () => {
    // The canvas is not rendered while the Outline/Backlog view is showing.
    // Centring on 0x0 would stack every new card on the same coordinate.
    expect(isViewportMeasurable(0, 0)).toBe(false);
    expect(isViewportMeasurable(1440, 0)).toBe(false);
    expect(isViewportMeasurable(0, 900)).toBe(false);
  });

  it('rejects non-finite and missing measurements', () => {
    expect(isViewportMeasurable(NaN, 900)).toBe(false);
    expect(isViewportMeasurable(Infinity, 900)).toBe(false);
    expect(isViewportMeasurable(undefined, undefined)).toBe(false);
    expect(isViewportMeasurable(-100, -100)).toBe(false);
  });
});

// =============================================================================
// viewportCentreInCanvas
// =============================================================================

describe('viewportCentreInCanvas', () => {
  it('is the geometric centre when the canvas is unpanned and unzoomed', () => {
    expect(viewportCentreInCanvas({
      viewportWidth: 1000,
      viewportHeight: 600,
      transform: { x: 0, y: 0, scale: 1 },
    })).toEqual({ x: 500, y: 300 });
  });

  it('subtracts pan, so panning right reveals smaller canvas coordinates', () => {
    // Dragging the canvas 200px right means the point under the centre is 200
    // canvas units further LEFT than it was.
    expect(viewportCentreInCanvas({
      viewportWidth: 1000,
      viewportHeight: 600,
      transform: { x: 200, y: 100, scale: 1 },
    })).toEqual({ x: 300, y: 200 });
  });

  it('divides by scale, so zooming in narrows the canvas span on screen', () => {
    expect(viewportCentreInCanvas({
      viewportWidth: 1000,
      viewportHeight: 600,
      transform: { x: 0, y: 0, scale: 2 },
    })).toEqual({ x: 250, y: 150 });
  });

  it('handles combined pan and zoom', () => {
    expect(viewportCentreInCanvas({
      viewportWidth: 1200,
      viewportHeight: 800,
      transform: { x: -300, y: 150, scale: 0.5 },
    })).toEqual({ x: (600 + 300) / 0.5, y: (400 - 150) / 0.5 });
  });

  it('survives a missing or degenerate transform instead of returning Infinity', () => {
    // A scale of 0 would make the division explode. Nothing should be able to
    // feed a NaN coordinate into a saved node.
    expect(viewportCentreInCanvas({ viewportWidth: 1000, viewportHeight: 600, transform: undefined }))
      .toEqual({ x: 500, y: 300 });
    expect(viewportCentreInCanvas({
      viewportWidth: 1000,
      viewportHeight: 600,
      transform: { x: 0, y: 0, scale: 0 },
    })).toEqual({ x: 500, y: 300 });
  });
});

// =============================================================================
// centrePlacement
// =============================================================================

describe('centrePlacement', () => {
  it('returns the top-left corner that centres the card', () => {
    const placement = centrePlacement({
      viewportWidth: 1000,
      viewportHeight: 600,
      transform: { x: 0, y: 0, scale: 1 },
      cardWidth: FRESH_CARD.width,
      cardHeight: FRESH_CARD.height,
    });
    // Centre is (500, 300); a 180x60 card centred there starts at (410, 270).
    expect(placement).toEqual({ x: 410, y: 270, width: 180, height: 60 });
  });

  it('actually centres the card - its midpoint equals the viewport centre', () => {
    // The property that matters, stated directly rather than as magic numbers.
    const viewportWidth = 1337;
    const viewportHeight = 811;
    const transform = { x: -420, y: 77, scale: 1.4 };
    const placement = centrePlacement({
      viewportWidth,
      viewportHeight,
      transform,
      cardWidth: FRESH_CARD.width,
      cardHeight: FRESH_CARD.height,
    });
    const centre = viewportCentreInCanvas({ viewportWidth, viewportHeight, transform });
    expect(placement.x + placement.width / 2).toBeCloseTo(centre.x, 10);
    expect(placement.y + placement.height / 2).toBeCloseTo(centre.y, 10);
  });

  it('corrects the old off-centre placement rather than reproducing it', () => {
    // REGRESSION GUARD. addNode used to subtract a hardcoded 150, 50 - half of a
    // 300x100 card that does not exist. A fresh card is 180x60, so cards landed
    // 60px left and 20px above where they should have. This was invisible until
    // the ghost drew the target, and it is the reason the ghost and the real
    // card must share one placement function.
    const args = {
      viewportWidth: 1000,
      viewportHeight: 600,
      transform: { x: 0, y: 0, scale: 1 },
      cardWidth: FRESH_CARD.width,
      cardHeight: FRESH_CARD.height,
    };
    const placement = centrePlacement(args);
    const legacyX = (1000 / 2 - 0) / 1 - 150;
    const legacyY = (600 / 2 - 0) / 1 - 50;
    expect(legacyX).toBe(350);
    expect(legacyY).toBe(250);
    expect(placement.x).toBe(410);
    expect(placement.y).toBe(270);
    expect(placement.x - legacyX).toBe(60);
    expect(placement.y - legacyY).toBe(20);
  });

  it('keeps the card centred at every zoom level', () => {
    for (const scale of [0.05, 0.25, 0.5, 1, 1.75, 3]) {
      const transform = { x: 90, y: -40, scale };
      const placement = centrePlacement({
        viewportWidth: 1024,
        viewportHeight: 768,
        transform,
        cardWidth: FRESH_CARD.width,
        cardHeight: FRESH_CARD.height,
      });
      const centre = viewportCentreInCanvas({ viewportWidth: 1024, viewportHeight: 768, transform });
      expect(placement.x + placement.width / 2).toBeCloseTo(centre.x, 8);
      expect(placement.y + placement.height / 2).toBeCloseTo(centre.y, 8);
    }
  });

  it('never produces a non-finite coordinate', () => {
    // A NaN x/y would be written straight to Firestore by the autosave effect.
    const placement = centrePlacement({
      viewportWidth: 1000,
      viewportHeight: 600,
      transform: { x: NaN, y: undefined, scale: 0 },
      cardWidth: FRESH_CARD.width,
      cardHeight: FRESH_CARD.height,
    });
    expect(Number.isFinite(placement.x)).toBe(true);
    expect(Number.isFinite(placement.y)).toBe(true);
  });
});

// =============================================================================
// The ghost must not lie
// =============================================================================

describe('ghost rectangle agrees with where the card is created', () => {
  /**
   * THE TEST THIS FEATURE EXISTS FOR.
   *
   * The ghost is drawn in SCREEN space (pinned to the centre of the canvas) while
   * the card is created in CANVAS space. Those are two different coordinate
   * systems, so "the ghost shows where the card will go" is a claim that can
   * silently break. Projecting the real placement to screen space and comparing
   * it against the ghost's own rectangle checks it directly.
   */
  const cases = [
    { name: 'default view', viewportWidth: 1000, viewportHeight: 600, transform: { x: 0, y: 0, scale: 1 } },
    { name: 'panned', viewportWidth: 1000, viewportHeight: 600, transform: { x: 340, y: -180, scale: 1 } },
    { name: 'zoomed in', viewportWidth: 1440, viewportHeight: 900, transform: { x: 0, y: 0, scale: 2.5 } },
    { name: 'zoomed out', viewportWidth: 1440, viewportHeight: 900, transform: { x: 0, y: 0, scale: 0.2 } },
    { name: 'panned and zoomed', viewportWidth: 1280, viewportHeight: 720, transform: { x: -911, y: 613, scale: 1.65 } },
    { name: 'minimum zoom', viewportWidth: 800, viewportHeight: 600, transform: { x: 12, y: 34, scale: 0.05 } },
    { name: 'maximum zoom', viewportWidth: 800, viewportHeight: 600, transform: { x: 12, y: 34, scale: 3 } },
    { name: 'narrow mobile viewport', viewportWidth: 375, viewportHeight: 667, transform: { x: 5, y: 5, scale: 0.8 } },
  ];

  cases.forEach(({ name, viewportWidth, viewportHeight, transform }) => {
    it(`matches on screen: ${name}`, () => {
      const placement = centrePlacement({
        viewportWidth,
        viewportHeight,
        transform,
        cardWidth: FRESH_CARD.width,
        cardHeight: FRESH_CARD.height,
      });

      // Where the real card's top-left corner will appear on screen.
      const cardOnScreen = canvasToScreen(placement, transform);

      // Where the ghost draws its top-left corner: centred at 50%/50%.
      const ghost = ghostScreenSize({
        transform,
        cardWidth: FRESH_CARD.width,
        cardHeight: FRESH_CARD.height,
      });
      const ghostLeft = viewportWidth / 2 - ghost.width / 2;
      const ghostTop = viewportHeight / 2 - ghost.height / 2;

      expect(cardOnScreen.x).toBeCloseTo(ghostLeft, 8);
      expect(cardOnScreen.y).toBeCloseTo(ghostTop, 8);
    });
  });

  it('agrees on size too, not just position', () => {
    const transform = { x: -50, y: 220, scale: 1.25 };
    const ghost = ghostScreenSize({ transform, cardWidth: 180, cardHeight: 60 });
    // A card 180 canvas units wide occupies 180 * scale screen pixels.
    expect(ghost.width).toBeCloseTo(225, 8);
    expect(ghost.height).toBeCloseTo(75, 8);
  });

  it('stays centred regardless of pan, because the ghost does not move', () => {
    // The mental model is "the ghost is fixed, the canvas moves underneath it".
    // Pan must therefore change the CANVAS coordinate but never the screen rect.
    const base = { viewportWidth: 1000, viewportHeight: 600, cardWidth: 180, cardHeight: 60 };
    const a = centrePlacement({ ...base, transform: { x: 0, y: 0, scale: 1 } });
    const b = centrePlacement({ ...base, transform: { x: 400, y: 250, scale: 1 } });
    expect(a.x).not.toBe(b.x);
    expect(a.y).not.toBe(b.y);

    const sizeA = ghostScreenSize({ transform: { x: 0, y: 0, scale: 1 }, cardWidth: 180, cardHeight: 60 });
    const sizeB = ghostScreenSize({ transform: { x: 400, y: 250, scale: 1 }, cardWidth: 180, cardHeight: 60 });
    expect(sizeA).toEqual(sizeB);
  });
});

// =============================================================================
// offscreenPlacement
// =============================================================================

describe('offscreenPlacement', () => {
  it('places the first card at a fixed spot', () => {
    expect(offscreenPlacement([])).toEqual({ x: 200, y: 200 });
  });

  it('places later cards to the right of the rightmost card', () => {
    expect(offscreenPlacement([{ x: 100 }, { x: 640 }, { x: 300 }])).toEqual({ x: 960, y: 200 });
  });

  it('treats a missing or non-array node list as empty', () => {
    expect(offscreenPlacement(undefined)).toEqual({ x: 200, y: 200 });
    expect(offscreenPlacement(null)).toEqual({ x: 200, y: 200 });
  });

  it('does not return NaN when node coordinates are malformed', () => {
    // Preferable to the old Math.max(...nodes.map(n => n.x)) spread, which
    // returned NaN for a single bad node and would have written NaN to storage.
    const result = offscreenPlacement([{ x: undefined }, { x: null }]);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it('ignores malformed entries but still uses valid ones', () => {
    expect(offscreenPlacement([{ x: undefined }, { x: 500 }])).toEqual({ x: 820, y: 200 });
  });
});

// =============================================================================
// titleKeyIntent
// =============================================================================

describe('titleKeyIntent', () => {
  it('commits on Enter, preserving the existing behaviour of the title field', () => {
    expect(titleKeyIntent('Enter', { descriptionVisible: true })).toBe(TITLE_KEY_INTENT.COMMIT);
    expect(titleKeyIntent('Enter', { descriptionVisible: false })).toBe(TITLE_KEY_INTENT.COMMIT);
  });

  it('moves into the description on Tab', () => {
    expect(titleKeyIntent('Tab', { descriptionVisible: true })).toBe(TITLE_KEY_INTENT.TO_DESCRIPTION);
  });

  it('commits on Tab when there is no description field to move into', () => {
    // Descriptions can be hidden on the View route (Shift+D). Tab must not look
    // broken; committing is the honest fallback.
    expect(titleKeyIntent('Tab', { descriptionVisible: false })).toBe(TITLE_KEY_INTENT.COMMIT);
  });

  it('leaves Shift+Tab to the browser so keyboard users are not trapped', () => {
    expect(titleKeyIntent('Tab', { descriptionVisible: true, shiftKey: true })).toBe(TITLE_KEY_INTENT.NONE);
  });

  it('ignores ordinary typing and navigation keys', () => {
    for (const key of ['a', 'Z', '1', ' ', 'ArrowDown', 'Backspace', 'Escape', 'Home']) {
      expect(titleKeyIntent(key, { descriptionVisible: true })).toBe(TITLE_KEY_INTENT.NONE);
    }
  });

  it('does not require an options object', () => {
    expect(titleKeyIntent('Enter')).toBe(TITLE_KEY_INTENT.COMMIT);
    // Without knowing whether a description is visible, do not promise to jump to it.
    expect(titleKeyIntent('Tab')).toBe(TITLE_KEY_INTENT.COMMIT);
  });
});

// =============================================================================
// shouldAutoFocusNewCard
// =============================================================================

describe('shouldAutoFocusNewCard', () => {
  it('opens the title for typing in Full Edit mode', () => {
    expect(shouldAutoFocusNewCard({ editMode: true })).toBe(true);
  });

  it('does not open an editable field in Arrange mode', () => {
    // The title textarea renders purely on editingTextNode matching - the
    // editMode check elsewhere guards the click that sets it, not the render.
    // Without this gate, N in Arrange mode would pop open a text field.
    expect(shouldAutoFocusNewCard({ editMode: false })).toBe(false);
  });

  it('is false for anything other than an explicit true', () => {
    expect(shouldAutoFocusNewCard({})).toBe(false);
    expect(shouldAutoFocusNewCard({ editMode: undefined })).toBe(false);
    expect(shouldAutoFocusNewCard({ editMode: 'yes' })).toBe(false);
  });
});

// =============================================================================
// New-card defaults and edit keys
// =============================================================================

describe('new card defaults', () => {
  it('gives a focused card an empty title so the first keystroke is not prepended', () => {
    // autoFocus leaves the caret at offset 0. With a 'New Card' placeholder,
    // typing "Roadmap" produced "RoadmapNew Card".
    expect(NEW_CARD_TITLE).toBe('');
    expect(NEW_CARD_CONTENT).toBe('');
  });

  it('leaves the unfocused creation paths labelled as before', () => {
    // Group "Add card", the More menu, "Add First Card" and right-click "Add
    // Card Here" produce a card the user must locate and click, so the visible
    // label is kept.
    expect(UNFOCUSED_NEW_CARD_TITLE).toBe('New Card');
  });
});

describe('editingTextNode keys', () => {
  it('encodes the title convention', () => {
    expect(titleEditKey('42')).toBe('title-42');
    expect(titleEditKey(42)).toBe('title-42');
  });

  it('encodes the description convention as the bare id', () => {
    expect(descriptionEditKey('42')).toBe('42');
    expect(descriptionEditKey(42)).toBe('42');
  });

  it('produces keys that cannot collide', () => {
    // A single scalar distinguishes "editing the title" from "editing the
    // description" for the same card, so the two encodings must never match.
    expect(titleEditKey('7')).not.toBe(descriptionEditKey('7'));
  });
});
