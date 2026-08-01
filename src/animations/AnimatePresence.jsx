import React from 'react';
import { useAnimatedMount } from './useAnimatedMount';

/**
 * AnimatePresence - Lightweight wrapper for mount/unmount animations.
 *
 * This is a drop-in replacement for conditional rendering that adds
 * exit animations. Instead of:
 *
 *   {isOpen && <Modal />}
 *
 * Use:
 *
 *   <AnimatePresence show={isOpen} type="modal">
 *     <Modal />
 *   </AnimatePresence>
 *
 * The `type` prop selects from predefined animation presets.
 * You can also pass custom classes via `enterClass` and `exitClass`.
 *
 * Props:
 * @param {boolean} show - Whether to show the children
 * @param {string} type - Preset type: 'modal', 'menu', 'panel', 'sidebar', 'toast', 'banner', 'fade'
 * @param {string} enterClass - Custom enter animation class (overrides type)
 * @param {string} exitClass - Custom exit animation class (overrides type)
 * @param {number} exitDuration - Custom exit duration in ms (overrides type)
 * @param {string} className - Additional classes on the wrapper
 * @param {React.ReactNode} children - Content to animate
 * @param {boolean} noWrapper - If true, applies class to child directly (child must accept className)
 */

// Preset configurations for each animation type
const PRESETS = {
  modal: {
    enterClass: 'animate-modal-in',
    exitClass: 'animate-modal-out',
    exitDuration: 220,
  },
  backdrop: {
    enterClass: 'animate-backdrop-in',
    exitClass: 'animate-backdrop-out',
    exitDuration: 220,
  },
  menu: {
    enterClass: 'animate-menu-in',
    exitClass: 'animate-menu-out',
    exitDuration: 150,
  },
  panel: {
    enterClass: 'animate-panel-in',
    exitClass: 'animate-panel-out',
    exitDuration: 260,
  },
  sidebar: {
    enterClass: 'animate-sidebar-in',
    exitClass: 'animate-sidebar-out',
    exitDuration: 260,
  },
  toast: {
    enterClass: 'animate-toast-in',
    exitClass: 'animate-toast-out',
    exitDuration: 240,
  },
  banner: {
    enterClass: 'animate-banner-in',
    exitClass: 'animate-banner-out',
    exitDuration: 240,
  },
  fade: {
    enterClass: 'animate-fade-in',
    exitClass: 'animate-fade-out',
    exitDuration: 200,
  },
  content: {
    enterClass: 'animate-content-in',
    exitClass: 'animate-fade-out',
    exitDuration: 200,
  },
  result: {
    enterClass: 'animate-result-in',
    exitClass: 'animate-fade-out',
    exitDuration: 200,
  },
};

export default function AnimatePresence({
  show,
  type = 'fade',
  enterClass,
  exitClass,
  exitDuration,
  className = '',
  children,
  noWrapper = false,
}) {
  // Resolve animation config from type preset or custom props
  const preset = PRESETS[type] || PRESETS.fade;
  const config = {
    enterClass: enterClass || preset.enterClass,
    exitClass: exitClass || preset.exitClass,
    exitDuration: exitDuration ?? preset.exitDuration,
  };

  const { shouldRender, animationClass } = useAnimatedMount(show, config);

  if (!shouldRender) return null;

  // If noWrapper, clone the child and inject the animation class
  if (noWrapper && React.isValidElement(children)) {
    const childClassName = children.props.className || '';
    return React.cloneElement(children, {
      className: `${childClassName} ${animationClass} ${className}`.trim(),
    });
  }

  // Default: wrap children in a div with the animation class
  return (
    <div className={`${animationClass} ${className}`.trim()}>
      {children}
    </div>
  );
}

/**
 * AnimatedBackdrop - Convenience component for modal/dialog backdrops.
 *
 * Usage:
 *   <AnimatedBackdrop show={isOpen} onClick={onClose} />
 */
export function AnimatedBackdrop({ show, onClick, className = '' }) {
  const { shouldRender, animationClass } = useAnimatedMount(show, {
    enterClass: 'animate-backdrop-in',
    exitClass: 'animate-backdrop-out',
    exitDuration: 220,
  });

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 bg-slate-900/40 backdrop-blur-sm ${animationClass} ${className}`.trim()}
      onClick={onClick}
    />
  );
}
