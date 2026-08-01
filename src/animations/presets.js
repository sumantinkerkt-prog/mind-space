/**
 * Animation Presets - Single source of truth for all animation timing.
 *
 * DESIGN PHILOSOPHY:
 * - Open animations are slightly longer (user needs to notice the element appearing)
 * - Close animations are faster (user already decided to dismiss, don't delay them)
 * - Button feedback is near-instant (must feel responsive)
 * - Notifications are theatrical (need to grab attention)
 *
 * EASING:
 * - ease-out-smooth: Apple-style deceleration curve for element entries
 * - ease-in-out-soft: For elements that both enter and leave with intention
 * - ease-in-fast: For exits (accelerates away quickly)
 */

// Duration constants (ms) -- these MUST stay in sync with the durations used
// in src/animations/index.css. The *Close/*Exit values are the ones
// useAnimatedMount/AnimatePresence rely on to time the unmount.
export const DURATION = {
  // Core interaction durations
  instant: 90,      // Button press feedback
  fast: 150,        // Menu/dropdown close, tooltip hide
  normal: 260,      // Fade / backdrop
  slow: 340,        // Modal open
  gentle: 420,      // Toast / large slides

  // Semantic aliases (open)
  buttonPress: 90,
  menuOpen: 200,
  modalOpen: 340,
  panelOpen: 360,
  sidebarOpen: 340,
  toastEnter: 420,
  bannerEnter: 400,
  contentReveal: 320,
  resultReveal: 360,

  // Semantic aliases (close) -- used to delay unmount
  menuClose: 150,
  modalClose: 220,
  backdropClose: 220,
  panelClose: 260,
  sidebarClose: 260,
  toastExit: 240,
  bannerExit: 240,
  fadeClose: 200,
};

// Easing curves (CSS cubic-bezier values) -- mirror the CSS custom properties
// defined in src/animations/index.css.
export const EASING = {
  // Primary curves
  easeOutSmooth: 'cubic-bezier(0.22, 1, 0.36, 1)',      // Decelerate to a calm stop (entries)
  easeInFast: 'cubic-bezier(0.4, 0, 1, 1)',             // Accelerate away (exits)
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',          // Slight overshoot (playful entry)

  // Tailwind-compatible name (used in tailwind.config.js)
  DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

// Scale values for open/close
export const SCALE = {
  modalFrom: 0.95,       // Modals start slightly smaller
  modalTo: 1,
  menuFrom: 0.92,        // Menus start a bit smaller (more "pop")
  menuTo: 1,
  buttonPress: 0.96,     // Button shrinks slightly on press
  closeScale: 0.97,      // Elements shrink slightly when closing
  notificationPop: 1.02, // Notifications slightly overshoot
};

// Transform offsets
export const OFFSET = {
  menuSlideY: -4,      // Menus slide up slightly from trigger
  panelSlideX: '100%', // Side panels slide from off-screen right
  sidebarSlideX: '-100%', // Sidebar slides from off-screen left
  toastSlideY: 8,      // Toasts slide up from below
  dropdownSlideY: -6,  // Dropdowns slide up slightly
};

// Z-index layers for animated elements
export const Z_INDEX = {
  backdrop: 100,
  modal: 200,
  dropdown: 150,
  toast: 300,
  tooltip: 250,
};

/**
 * Helper: Generates a CSS transition string from presets
 * @param {string[]} properties - CSS properties to animate
 * @param {number} duration - Duration in ms
 * @param {string} easing - Easing curve
 * @returns {string} CSS transition value
 */
export function buildTransition(properties = ['all'], duration = DURATION.normal, easing = EASING.easeOutSmooth) {
  return properties.map(prop => `${prop} ${duration}ms ${easing}`).join(', ');
}

/**
 * Helper: Returns Tailwind-compatible duration class suffix
 * @param {number} ms - Duration in milliseconds
 * @returns {string} e.g., "150" for use in "duration-150"
 */
export function durationClass(ms) {
  // Round to nearest Tailwind step
  const steps = [75, 100, 150, 200, 300, 500, 700, 1000];
  const closest = steps.reduce((prev, curr) =>
    Math.abs(curr - ms) < Math.abs(prev - ms) ? curr : prev
  );
  return String(closest);
}
