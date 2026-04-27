/**
 * Shared helpers used by both 1-D and 2-D reorder primitives.
 *
 * Anything in this file MUST be contract-identical for both engines.
 * If a helper diverges between primitives, even slightly, duplicate it
 * back into the engine that needs it rather than parameterising here.
 */

/**
 * Default selector for skipping drag activation when the pointerdown
 * target is a focusable interactive control. Exported so consumers can
 * compose, e.g.
 * `skipSelector: DEFAULT_SKIP_SELECTOR + ', [data-no-drag]'`.
 */
export const DEFAULT_SKIP_SELECTOR = 'button, input, a, [role="button"]';

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
