/**
 * Animation System - Public API
 *
 * Import from 'animations' to access all animation utilities:
 *
 *   import { AnimatePresence, useAnimatedMount, DURATION, EASING } from '../animations';
 */

export { default as AnimatePresence, AnimatedBackdrop } from './AnimatePresence';
export { default as Spinner } from './Spinner';
export { useAnimatedMount, useAnimatedList } from './useAnimatedMount';
export { DURATION, EASING, SCALE, OFFSET, Z_INDEX, buildTransition, durationClass } from './presets';
