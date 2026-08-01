import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useAnimatedMount - Hook for managing mount/unmount animations.
 *
 * Problem: React removes elements from the DOM immediately when state changes,
 * which means exit animations never play. This hook delays the actual unmount
 * until the exit animation completes.
 *
 * Usage:
 *   const { shouldRender, animationClass } = useAnimatedMount(isOpen, {
 *     enterClass: 'animate-modal-in',
 *     exitClass: 'animate-modal-out',
 *     exitDuration: 150,
 *   });
 *
 *   return shouldRender ? (
 *     <div className={animationClass}>...</div>
 *   ) : null;
 *
 * @param {boolean} isVisible - Whether the element should be shown
 * @param {object} options - Animation configuration
 * @param {string} options.enterClass - CSS class for enter animation
 * @param {string} options.exitClass - CSS class for exit animation
 * @param {number} options.exitDuration - Duration of exit animation in ms (to delay unmount)
 * @returns {{ shouldRender: boolean, animationClass: string, isExiting: boolean }}
 */
export function useAnimatedMount(isVisible, options = {}) {
  const {
    enterClass = 'animate-fade-in',
    exitClass = 'animate-fade-out',
    exitDuration = 150,
  } = options;

  const [shouldRender, setShouldRender] = useState(isVisible);
  const [isExiting, setIsExiting] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (isVisible) {
      // Mount immediately when becoming visible
      setShouldRender(true);
      setIsExiting(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else if (shouldRender) {
      // Start exit animation, then unmount after duration
      setIsExiting(true);
      timeoutRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsExiting(false);
        timeoutRef.current = null;
      }, exitDuration);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isVisible, exitDuration]);

  // Determine which animation class to apply
  const animationClass = isExiting ? exitClass : (shouldRender ? enterClass : '');

  return { shouldRender, animationClass, isExiting };
}

/**
 * useAnimatedList - Hook for staggered list animations.
 *
 * Assigns increasing animation-delay to each item so they appear sequentially.
 *
 * Usage:
 *   const getItemStyle = useAnimatedList(items.length, { staggerMs: 30 });
 *   items.map((item, i) => <div style={getItemStyle(i)}>...</div>)
 *
 * @param {number} count - Number of items in the list
 * @param {object} options - Configuration
 * @param {number} options.staggerMs - Delay between each item (default: 30ms)
 * @param {number} options.maxDelay - Maximum total stagger (default: 300ms)
 * @returns {function} getItemStyle(index) - Returns style object for item
 */
export function useAnimatedList(count, options = {}) {
  const { staggerMs = 30, maxDelay = 300 } = options;

  const getItemStyle = useCallback((index) => {
    const delay = Math.min(index * staggerMs, maxDelay);
    return {
      animationDelay: `${delay}ms`,
      animationFillMode: 'both',
    };
  }, [staggerMs, maxDelay]);

  return getItemStyle;
}

export default useAnimatedMount;
