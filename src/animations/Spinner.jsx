import React from 'react';

/**
 * Spinner - Reusable, GPU-friendly loading indicator.
 *
 * Uses the `.anim-spinner` class from src/animations/index.css (a CSS-only
 * rotating ring that animates `transform` on the compositor thread).
 *
 * Usage:
 *   <Spinner />                         // inherits current text color, 1em size
 *   <Spinner size={20} />               // fixed pixel size
 *   <Spinner label="Saving..." />       // spinner + text, announced to a11y tree
 *
 * Props:
 * @param {number} [size]      - Pixel size. Omit to size with the font (1em).
 * @param {string} [label]     - Optional text shown next to the spinner.
 * @param {string} [className] - Extra classes for the wrapper.
 */
export default function Spinner({ size, label, className = '' }) {
  const style = size ? { width: size, height: size } : undefined;

  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="anim-spinner" style={style} aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
