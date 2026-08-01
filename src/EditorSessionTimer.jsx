// =============================================================================
// EditorSessionTimer - auto-inactivity session countdown (editor tabs only)
// =============================================================================
// PURPOSE (architectural, not convenience): editor tabs are meant to be a
// SHORT-LIVED "active editing session". This component gives every editor tab a
// 5-minute countdown that lives in the top navigation bar. When it reaches zero
// the tab automatically converts into a read-only View/Reference tab (the parent
// performs a route-only redirect that preserves the workspace, project, camera
// and zoom - no reload, no data loss). This lets future multi-tab logic treat
// "an editor tab with a running countdown" as the only real editing session, so
// stale editor tabs self-clean into viewers.
//
// ISOLATION CONTRACT: this component owns ONLY its own countdown UI/state. It
// performs NO storage writes and NO sync calls. All side effects (flushing
// pending saves, navigating editor -> view) happen in the parent via `onExpire`,
// keeping the sync engine completely untouched by this feature.
//
// LIFECYCLE: the parent renders this component ONLY while on the editor route.
// Mounting starts a fresh 5:00 session; unmounting (leaving the editor route, or
// after the redirect) destroys the timer entirely. Returning to the editor route
// remounts it and starts a brand-new 5:00 session.
//
// TIMEKEEPING: the countdown consumes ELAPSED WALL-CLOCK TIME (delta between
// ticks), not "one tick == one second". Browsers throttle setInterval in hidden
// tabs, so a naive per-tick decrement would let a backgrounded editor tab run
// far longer than 5 minutes. Measuring real elapsed time keeps the session
// honest regardless of tab visibility, and a visibilitychange catch-up makes the
// display/redirect snap to the correct value the instant the tab is refocused.
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

// Session length and the two escalation thresholds (all in seconds).
export const SESSION_SECONDS = 5 * 60; // 05:00
const AMBER_THRESHOLD = 30;            // <=30s remaining -> amber (warning)
const CRITICAL_THRESHOLD = 10;         // <=10s remaining -> red + popup
// Backoff before retrying the expiry hand-off after it settles without the tab
// actually leaving the editor (e.g. a blocking dialog opened mid-flush, or an
// unexpected error). Prevents a tight 1 Hz redirect/flush loop while pinned at 0.
const RETRY_AFTER_DEFER_MS = 3000;
const RETRY_AFTER_ERROR_MS = 15000;

/** Format a whole-second count as mm:ss (never negative). */
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * @param {object}   props
 * @param {boolean}  props.blocked  When true the countdown PAUSES (a blocking
 *   flow - conflict dialog, save confirmation, etc. - is open). This guarantees
 *   the timer never fires a redirect out from under a blocking dialog.
 * @param {(ctx: { isCancelled: () => boolean }) => (void|Promise<void>)} props.onExpire
 *   Called when the countdown hits zero. The parent should flush any pending
 *   saves and then redirect editor -> view. It is handed an `isCancelled()`
 *   probe: if the user resets the timer ("Stay in Editor") while the parent is
 *   awaiting a save flush, `isCancelled()` starts returning true so the parent
 *   can abort the redirect instead of yanking the user to read-only view.
 */
export default function EditorSessionTimer({ blocked = false, onExpire }) {
  const [remaining, setRemaining] = useState(SESSION_SECONDS);
  // Brief visual "pressed" flash so a click on the pill is clearly acknowledged.
  const [flash, setFlash] = useState(false);

  // --- Mutable timekeeping state (refs so the single interval never re-creates
  //     and there are no stale closures / cadence drift on parent re-render) ---
  const remainingMsRef = useRef(SESSION_SECONDS * 1000); // session time left, ms
  const lastTickRef = useRef(Date.now());                // wall clock of last tick
  const blockedRef = useRef(blocked);
  const onExpireRef = useRef(onExpire);
  const expiringRef = useRef(false);   // true while a redirect hand-off is in flight
  const retryAfterRef = useRef(0);     // earliest time (ms) a new hand-off may fire
  const epochRef = useRef(0);          // bumped on reset to invalidate in-flight expiry
  const flashTimerRef = useRef(null);

  blockedRef.current = blocked;
  onExpireRef.current = onExpire;

  // Reset back to a full 5:00 session ("I'm still actively working"). Used by
  // both the pill click and the popup's "Stay in Editor" action. No confirm.
  // Bumping the epoch invalidates any expiry hand-off already awaiting a flush.
  const reset = useCallback(() => {
    epochRef.current += 1;
    expiringRef.current = false;
    retryAfterRef.current = 0;
    remainingMsRef.current = SESSION_SECONDS * 1000;
    lastTickRef.current = Date.now();
    setRemaining(SESSION_SECONDS);
    setFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(false), 240);
  }, []);

  // Fire the expiry hand-off at most once per "arming". If the parent defers
  // (returns without the tab leaving the editor) or errors, we back off before
  // allowing another attempt so we never hammer the network at 1 Hz.
  const fireExpiry = useCallback(() => {
    if (expiringRef.current) return;
    if (Date.now() < retryAfterRef.current) return;
    expiringRef.current = true;
    const epoch = epochRef.current;
    Promise.resolve()
      .then(() =>
        onExpireRef.current
          ? onExpireRef.current({ isCancelled: () => epoch !== epochRef.current })
          : undefined
      )
      .then(() => {
        // Resolved. If the session was reset mid-flight (epoch changed), reset()
        // already restored the countdown - leave it alone. Otherwise the parent
        // either navigated (we'll be unmounted momentarily) or deferred; allow a
        // short-backoff retry so a stale 0:00 tab still converts once unblocked.
        if (epoch === epochRef.current) {
          expiringRef.current = false;
          retryAfterRef.current = Date.now() + RETRY_AFTER_DEFER_MS;
        }
      })
      .catch(() => {
        // Unexpected failure - back off well before retrying.
        if (epoch === epochRef.current) {
          expiringRef.current = false;
          retryAfterRef.current = Date.now() + RETRY_AFTER_ERROR_MS;
        }
      });
  }, []);

  // One tick: consume the real elapsed time since the previous tick (unless
  // paused/handing off), refresh the display, and fire expiry at zero.
  const tick = useCallback(() => {
    const now = Date.now();
    const deltaMs = now - lastTickRef.current;
    lastTickRef.current = now;
    // Paused (blocking flow) or mid-hand-off: advance the clock reference but do
    // NOT consume session time, so the countdown effectively freezes.
    if (blockedRef.current || expiringRef.current) return;
    remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs);
    setRemaining(Math.ceil(remainingMsRef.current / 1000));
    if (remainingMsRef.current <= 0) fireExpiry();
  }, [fireExpiry]);

  // Single always-on ticker + a visibilitychange catch-up. Mounts with the
  // component (=> fresh session on entering the editor) and is cleaned up on
  // unmount (=> destroyed on leave).
  useEffect(() => {
    lastTickRef.current = Date.now();
    const id = setInterval(tick, 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [tick]);

  const isCritical = remaining <= CRITICAL_THRESHOLD;
  const isAmber = !isCritical && remaining <= AMBER_THRESHOLD;

  // --- Pill visual states -----------------------------------------------------
  // Normal: subtle neutral chip with #e0e0e0 icon+text (calm, non-distracting).
  // Amber (last 30s) / Red (last 10s): escalate colour; red also softly pulses.
  let pillStyle;
  if (isCritical) {
    pillStyle = { color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.35)' };
  } else if (isAmber) {
    pillStyle = { color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.35)' };
  } else if (flash) {
    // Click acknowledgement: momentary indigo tint so the reset is felt.
    pillStyle = { color: '#c7d2fe', backgroundColor: 'rgba(99,102,241,0.35)', borderColor: 'rgba(99,102,241,0.5)' };
  } else {
    pillStyle = { color: '#e0e0e0', backgroundColor: 'rgba(71,85,105,0.85)', borderColor: 'rgba(148,163,184,0.35)' };
  }

  return (
    <>
      <button
        type="button"
        onClick={reset}
        aria-label={`Editor session auto-redirects in ${formatTime(remaining)}. Click to reset to 5 minutes.`}
        title="Editor session timer - click to stay in the editor (resets to 5:00)"
        className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-semibold tabular-nums transition-colors shrink-0 select-none ${isCritical ? 'animate-attention' : ''}`}
        style={pillStyle}
      >
        <Clock className="w-3.5 h-3.5" />
        <span>{formatTime(remaining)}</span>
      </button>

      {/* Floating, NON-BLOCKING warning popup (last 10 seconds). No backdrop, so
          it never interrupts editing; it simply counts itself down. */}
      {isCritical && (
        <div
          className="fixed top-14 right-4 z-[200] w-72 max-w-[calc(100vw-2rem)] p-3.5 bg-white rounded-xl shadow-2xl border border-red-200 animate-toast-in"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 shrink-0 text-red-500 animate-attention">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 leading-snug">
                Redirecting to View Mode in {Math.max(0, remaining)} second{remaining === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                This editor session will automatically become read-only.
              </p>
              <button
                type="button"
                onClick={reset}
                className="mt-2.5 w-full px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                Stay in Editor
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
