/**
 * Shared helpers used by both 1-D and 2-D reorder primitives.
 *
 * Anything in this file MUST be contract-identical for both engines.
 * If a helper diverges between primitives, even slightly, duplicate it
 * back into the engine that needs it rather than parameterising here.
 */

/**
 * Default selector for skipping drag activation when the pointerdown
 * target is a focusable interactive control or a label forwarding to one.
 * A native `<select>` opens on pointerdown, so a drag starting there
 * steals the pick. Exported so consumers can compose, e.g.
 * `skipSelector: DEFAULT_SKIP_SELECTOR + ', [data-no-drag]'`.
 */
export const DEFAULT_SKIP_SELECTOR = 'button, input, select, textarea, label, a, [role="button"], [contenteditable]';

/**
 * Block the next document-level click after a drag commits.
 *
 * Document-capture + once eats the click, rAF safety net removes the
 * handler if the click never fires. This prevents a post-drag click
 * from triggering button/link handlers underneath the dragged item.
 */
export function blockNextClick(): void {
  const eatClick = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener('click', eatClick, { capture: true, once: true });
  requestAnimationFrame(() => {
    document.removeEventListener('click', eatClick, { capture: true });
  });
}

export interface CancelListeners {
  /** Attach Esc / window-blur / contextmenu cancellation listeners. */
  add(): void;
  /** Detach all cancellation listeners. */
  remove(): void;
}

/**
 * Create attach/detach pair for drag-cancellation listeners.
 *
 * Esc keypress, window blur, and contextmenu all invoke `onCancel`.
 * The returned `add` and `remove` are idempotent at the document level
 * (the underlying handler identities are stable per factory call).
 */
export function createCancelListeners(opts: { onCancel: () => void }): CancelListeners {
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') opts.onCancel();
  };
  const onBlur = () => opts.onCancel();
  const onContextMenu = () => opts.onCancel();

  return {
    add() {
      document.addEventListener('keydown', onEscape);
      document.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('blur', onBlur);
    },
    remove() {
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('blur', onBlur);
    },
  };
}

/** Default milliseconds a touch or pen press is held before it can drag. */
export const DEFAULT_TOUCH_HOLD_MS = 200;
/** Default pixels a held touch may wander before the hold is abandoned. */
export const DEFAULT_TOUCH_HOLD_TOLERANCE = 10;
/** Default class on an item whose touch hold has completed. */
export const DEFAULT_ARMED_CLASS = 'reorder-armed';

export interface PressHold {
  /** True once the press may start a drag: at once for a mouse, after the hold for touch and pen. */
  readonly held: boolean;
  /** Feed each pointermove before activation. Returns false when the press
   *  wandered too far during the hold, and the caller should give it up. */
  move(ev: PointerEvent): boolean;
  /** Clear the timer and listeners. Safe to call more than once. */
  stop(): void;
}

/**
 * Gate a press behind a hold. A touch or pen press must stay down, within
 * `tolerance` pixels of where it started, for `ms` before it may drag, so a
 * finger flick across a list scrolls or does nothing instead of grabbing an
 * item. A mouse is never held. `ms <= 0` turns the hold off.
 *
 * While a touch press is down, its contextmenu (the long-press menu) is
 * swallowed so it neither opens nor cancels the drag that follows.
 */
export function startPressHold(e: PointerEvent, opts: {
  ms: number;
  tolerance: number;
  onHeld: () => void;
}): PressHold {
  const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
  if (opts.ms <= 0 || !touch) {
    return { held: true, move: () => true, stop: () => {} };
  }
  const startX = e.clientX;
  const startY = e.clientY;
  let held = false;
  const swallowMenu = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
  const timer = setTimeout(() => { held = true; opts.onHeld(); }, opts.ms);
  document.addEventListener('contextmenu', swallowMenu, { capture: true });
  return {
    get held() { return held; },
    move(ev) {
      return held || Math.hypot(ev.clientX - startX, ev.clientY - startY) <= opts.tolerance;
    },
    stop() {
      clearTimeout(timer);
      document.removeEventListener('contextmenu', swallowMenu, { capture: true });
    },
  };
}
