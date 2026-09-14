// Ownership model for conversation scroll positions.
//
// A browser clamp (content shrank under the viewport), a display:none
// restore, and a remount all produce scroll events that are indistinguishable
// from "the user scrolled" by looking at the numbers alone — yet only real
// user-driven scrolling may overwrite the remembered reading position or arm
// the auto-loadOlder trigger. A clamped value recorded over the good position
// destroys the restore target: once the transcript regrows, the view can no
// longer return to where the user was reading.
//
// The decision therefore tracks ownership: a scroll event is user-owned when
// it follows a wheel/pointer/touch/keyboard input within SCROLL_OWN_WINDOW_MS,
// or when it arrives inside a chain of owned events (momentum and smooth
// scrolling keep the chain alive). Programmatic clamps are never owned.
//
// Geometry alone cannot certify the pinned flag either: a transcript that
// shrinks (but stays taller than the viewport) clamps scrollTop onto the new
// bottom, and the resulting event READS as pinned. Recording that event —
// or letting it set the pinned flag — would both clobber the remembered
// mid-list position and suppress the restore, pinning the user to the bottom
// of a file that no longer contains what they were reading. Pinned-derived
// recording is therefore only trusted when the view was ALREADY pinned:
// streaming appends keep a pinned view pinned, which is exactly the case
// whose scrollTop is worthless for restore but whose flag must survive.

export const SCROLL_OWN_WINDOW_MS = 400;
export const SCROLL_PIN_THRESHOLD_PX = 72;
export const SCROLL_AUTO_LOAD_THRESHOLD_PX = 520;
export const SCROLL_SCROLLABLE_SLACK_PX = 80;

export interface ScrollEventDecision {
  /** Geometry-derived pin state; apply to the pinned flag ONLY when owned. */
  pinned: boolean;
  /** Whether this event is user-driven (input or the momentum chain). */
  owned: boolean;
  /** Carry-forward for the ownership chain; store it for the next event. */
  ownedUntil: number;
  /** Whether this event may overwrite the remembered reading position. */
  record: boolean;
  /** Whether this event may trigger an older-history page load. */
  autoLoadOlder: boolean;
}

export function evaluateScrollEvent(args: {
  now: number;
  lastUserInputAt: number;
  ownedUntil: number;
  previouslyPinned: boolean;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  isTrusted: boolean;
}): ScrollEventDecision {
  const { now, lastUserInputAt, previouslyPinned, clientHeight, scrollHeight, scrollTop, isTrusted } = args;
  const pinned = scrollHeight - scrollTop - clientHeight < SCROLL_PIN_THRESHOLD_PX;
  const scrollable = scrollHeight > clientHeight + SCROLL_SCROLLABLE_SLACK_PX;
  const owned =
    now - lastUserInputAt <= SCROLL_OWN_WINDOW_MS || now <= args.ownedUntil;
  const ownedUntil = owned ? now + SCROLL_OWN_WINDOW_MS : args.ownedUntil;
  return {
    pinned,
    owned,
    ownedUntil,
    record: scrollable && (owned || (pinned && previouslyPinned)),
    autoLoadOlder: isTrusted && scrollTop < SCROLL_AUTO_LOAD_THRESHOLD_PX && owned,
  };
}

/** A restore is warranted when the view sits more than a viewport above the
 * remembered position without any recent user input — the signature of a
 * clamp/display:none/remount losing the position, not of reading. */
export function shouldRestoreScrollPosition(args: {
  savedScrollTop: number;
  scrollTop: number;
  clientHeight: number;
  now: number;
  lastUserInputAt: number;
}): boolean {
  return (
    args.savedScrollTop - args.scrollTop > args.clientHeight &&
    args.now - args.lastUserInputAt > SCROLL_OWN_WINDOW_MS
  );
}
