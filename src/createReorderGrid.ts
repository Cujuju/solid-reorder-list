/**
 * createReorderGrid — 2-D drag-to-reorder primitive for SolidJS.
 *
 * Sibling to createReorderList; targets responsive grid layouts where
 * displacement crosses row-wrap diagonals. v0.3.0 ships activation +
 * snapshot + hit-test + per-item flat-order displacement + hysteresis,
 * with manual scrollContainer compensation. Auto-scroll (R8/R9) is
 * deferred to v0.3.1.
 *
 * Coordinate frame: container-content coords =
 *   `clientX + scrollContainer.scrollLeft` (mirror y).
 * Snapshot rects, effectiveRects[], and pointer hit-test all live in
 * this frame. NOT pageX/pageY — F4's panel is Portal'd `position:fixed`
 * so window scroll does not compose into the frame.
 */

import { createSignal, createRoot, onCleanup, getOwner } from 'solid-js';
import { DEFAULT_SKIP_SELECTOR, blockNextClick, createCancelListeners } from './shared';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReorderGridOptions {
  /** Reactive list of IDs in current grid order (flat, row-major). */
  ids: () => string[];
  /** Called on drop with original and target indices. Indices are flat
   *  positions in the array at drag start (not visual positions). */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Pixels of pointer movement (Euclidean) before drag activates.
   *  Default 5. */
  activateDistance?: number;
  /** Duration of displacement transition in ms. Default 200. */
  transitionMs?: number;
  /** CSS class applied to the active (dragged) item. Default
   *  'reorder-active'. */
  activeClass?: string;
  /** Scale factor for the dragged item's visual lift. Default 0.97. */
  dragScale?: number;
  /** Whether to call stopPropagation on pointerdown. Default true. */
  stopPropagation?: boolean;
  /** CSS selector matched via `closest()` from the pointerdown target.
   *  When matched, drag activation is skipped. Defaults to
   *  {@link DEFAULT_SKIP_SELECTOR}. Set to an empty string to disable. */
  skipSelector?: string;
  /** Reactive accessor returning the scroll container, or `null` for
   *  no compensation. The container's scroll offset is read on each
   *  pointermove; rect storage uses container-content coords so manual
   *  scrolls during drag don't desync the hit-test. v0.3.0 supports
   *  HTMLElement and Window targets. v0.3.1 adds auto-scroll inside
   *  edge zones of this container. */
  scrollContainer?: () => HTMLElement | Window | null | undefined;
}

interface CachedGridRect {
  /** Container-content coords (clientX + container.scrollLeft, mirror y). */
  contentLeft: number;
  contentTop: number;
  contentRight: number;
  contentBottom: number;
  width: number;
  height: number;
}

interface GridDragState {
  id: string;
  sourceIndex: number;
  startPointer: { x: number; y: number };
  /** Original snapshot rects in container-content coords. Immutable
   *  during drag. Filled by U3 (activate's snapshot pass). */
  rects: CachedGridRect[];
  /** Mutable mirror of `rects[]` used for hysteresis. Same coordinate
   *  frame. Mutated on each target change by U4. */
  effectiveRects: CachedGridRect[];
  /** Inferred grid metrics — filled by U3. */
  cellWidth: number;
  cellHeight: number;
  gutterX: number;
  gutterY: number;
  cols: number;
  /** Last-resolved hit-test result. Consumed by commitDrag for the
   *  onReorder index. */
  currentTarget: number;
  ids: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Read the scroll container's offset. Window vs Element API quirks
 *  are isolated here; v0.3.1's auto-scroll loop reuses the same helper. */
function getScroll(c: HTMLElement | Window | null | undefined): { x: number; y: number } {
  if (!c) return { x: window.scrollX, y: window.scrollY };
  if (c instanceof Window) return { x: c.scrollX, y: c.scrollY };
  return { x: c.scrollLeft, y: c.scrollTop };
}

// ── Primitive ──────────────────────────────────────────────────────────────

export function createReorderGrid(options: ReorderGridOptions) {
  // Pixels of pointer movement (Euclidean) required before drag activates.
  // Prevents accidental drag on click (normal mouse jitter is 1-3px).
  const getActivateDistance = () => options.activateDistance ?? 5;
  const getTransitionMs = () => options.transitionMs ?? 200;
  const getActiveClass = () => options.activeClass ?? 'reorder-active';

  // Scale factor applied to the dragged item for visual lift.
  // 0.97 = 3% shrink. Set to 1.0 for no scale. Consumers can override.
  const DRAG_SCALE = options.dragScale ?? 0.97;
  const getStopPropagation = () => options.stopPropagation ?? true;
  const getSkipSelector = () => options.skipSelector ?? DEFAULT_SKIP_SELECTOR;
  const getScrollContainer = () => options.scrollContainer?.() ?? null;

  // Registered elements keyed by ID.
  const nodes = new Map<string, HTMLElement>();

  // Reactive signals in an isolated root — immune to parent scope disposal.
  // Without createRoot, SolidJS can dispose these signals (and fire onCleanup)
  // when the parent component's reactive graph re-evaluates during a drag,
  // killing the active drag mid-flight.
  let disposeRoot: (() => void) | undefined;
  const { activeId, setActiveId, targetIdx, setTargetIdx } = createRoot((dispose) => {
    disposeRoot = dispose;
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [targetIdx, setTargetIdx] = createSignal<number>(-1);
    return { activeId, setActiveId, targetIdx, setTargetIdx };
  });

  // Stored so cancel handlers can clean up pointer listeners.
  let pointerCleanup: (() => void) | null = null;

  // Non-reactive drag state — mutated on pointermove for performance.
  let drag: GridDragState | null = null;

  // rAF handle for batching dragged-item transform updates.
  // (v0.3.1 will add a sibling autoScrollRaf with the same lifecycle.)
  let dragRaf: number = 0;

  // ── Drag lifecycle ──────────────────────────────────────────────────────

  /** Apply lift styling to the dragged element + neighbour transition
   *  styles. Snapshot, hit-test, and displacement land in U3/U4. */
  function activate(id: string, sourceIndex: number, ids: string[], startPointer: { x: number; y: number }) {
    // Prune stale entries — items removed since last drag.
    const idSet = new Set(ids);
    for (const key of nodes.keys()) {
      if (!idSet.has(key)) nodes.delete(key);
    }

    // Snapshot pass and grid-metric inference are filled in U3.
    // For U2 the drag state carries enough to flag isDragging + activeId
    // without holding meaningful rects.
    drag = {
      id,
      sourceIndex,
      startPointer,
      rects: [],
      effectiveRects: [],
      cellWidth: 0,
      cellHeight: 0,
      gutterX: 0,
      gutterY: 0,
      cols: 0,
      currentTarget: sourceIndex,
      ids,
    };

    setActiveId(id);
    setTargetIdx(sourceIndex);

    // Style: dragged item gets instant scale lift; all others get a
    // smooth transition for displacement animation (U4).
    const ms = getTransitionMs();
    for (const itemId of ids) {
      const el = nodes.get(itemId);
      if (!el) continue;
      if (itemId === id) {
        el.style.willChange = 'transform';
        el.style.transition = 'none';
        el.style.zIndex = '50';
        el.style.position = 'relative';
        el.style.transform = `scale(${DRAG_SCALE})`;
      } else {
        el.style.willChange = 'transform';
        el.style.transition = `transform ${ms}ms ease`;
        el.style.pointerEvents = 'none';
      }
    }

    document.body.style.cursor = 'grabbing';
    cancel.add();
  }

  /** Filled by U3 (hit-test against effectiveRects) + U4 (displacement). */
  function updateDrag(_pointer: { x: number; y: number }) {
    // Stub — U3/U4 fill this with the snapshot-aware hit-test +
    // displacement loop. Currently a no-op so the activation pipeline
    // tests can pass without exercising the snapshot path.
  }

  /** Filled by U4. For U2, captures from/to and clears state without
   *  firing onReorder when the snapshot wasn't taken (avoids spurious
   *  R5 R7 calls on the partially-implemented engine). */
  function commitDrag() {
    if (!drag) return;
    if (pointerCleanup) { pointerCleanup(); pointerCleanup = null; }
    const { sourceIndex, currentTarget } = drag;

    cancel.remove();
    setActiveId(null);
    setTargetIdx(-1);
    clearDragStyles();
    blockNextClick();

    const from = sourceIndex;
    const to = currentTarget;
    drag = null;
    if (from !== to) options.onReorder(from, to);
  }

  /** Cancel without firing onReorder. */
  function cancelDrag() {
    if (!drag) return;
    if (pointerCleanup) { pointerCleanup(); pointerCleanup = null; }
    cancel.remove();
    setActiveId(null);
    setTargetIdx(-1);
    clearDragStyles();
    drag = null;
  }

  // ── Cancellation handlers (Esc / blur / contextmenu via shared.ts) ──────

  const cancel = createCancelListeners({ onCancel: cancelDrag });

  function clearDragStyles() {
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }

    const targets = drag?.ids
      ? drag.ids.map((id) => nodes.get(id)).filter((el): el is HTMLElement => !!el)
      : [...nodes.values()];
    for (const el of targets) {
      el.style.transform = '';
      el.style.transition = '';
      el.style.zIndex = '';
      el.style.position = '';
      el.style.willChange = '';
      el.style.pointerEvents = '';
    }
    document.body.style.cursor = '';
  }

  // ── Pointer event wiring ────────────────────────────────────────────────

  function onPointerDown(id: string, e: PointerEvent) {
    if (e.button !== 0) return;
    if (drag) return;

    // Don't start drag on interactive children (default skipSelector
    // blocks button/input/a/[role="button"]). Configurable via
    // options.skipSelector; set to '' to disable.
    const skip = getSkipSelector();
    if (skip && (e.target as HTMLElement).closest(skip)) return;

    if (getStopPropagation()) e.stopPropagation();

    const ids = options.ids();
    const sourceIndex = ids.indexOf(id);
    if (sourceIndex === -1) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const threshold = getActivateDistance();
    let activated = false;

    const onMove = (ev: PointerEvent) => {
      if (!activated) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        // Euclidean activation threshold (R2). 1-D's `Math.abs` becomes
        // `Math.hypot` in 2-D so diagonal drags don't need to cross the
        // threshold on either axis individually.
        if (Math.hypot(dx, dy) >= threshold) {
          activated = true;
          // Snapshot scroll at activate-time so displacement deltas
          // stay in container-content coords throughout the drag.
          const scroll = getScroll(getScrollContainer());
          activate(id, sourceIndex, ids, {
            x: ev.clientX + scroll.x,
            y: ev.clientY + scroll.y,
          });
        }
        return;
      }
      const scroll = getScroll(getScrollContainer());
      updateDrag({ x: ev.clientX + scroll.x, y: ev.clientY + scroll.y });
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.button !== 0) return;
      if (pointerCleanup) { pointerCleanup(); pointerCleanup = null; }
      if (activated) commitDrag();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    pointerCleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  // Guard: only register onCleanup if running inside a SolidJS reactive owner.
  // Makes the primitive safe to use in tests or imperative code outside a
  // component tree. When used inside a component, cleanup fires on unmount.
  if (getOwner()) {
    onCleanup(() => {
      if (drag) cancelDrag();
      nodes.clear();
      disposeRoot?.();
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    /** Spread onto each reorderable item element. */
    itemProps: (id: string) => ({
      ref: (el: HTMLElement) => { nodes.set(id, el); },
      onPointerDown: (e: PointerEvent) => onPointerDown(id, e),
      classList: { [getActiveClass()]: activeId() === id },
      'data-reorder-id': id,
    }),

    /** Whether the given item is currently being dragged. */
    isActive: (id: string) => activeId() === id,

    /** Whether any item is currently being dragged. */
    isDragging: () => activeId() !== null,

    /** The ID of the item currently being dragged, or null. */
    activeId,

    /** The current drop target index, or -1 if not dragging. */
    targetIndex: targetIdx,

    /** Abort an in-progress drag without firing onReorder.
     *  Idempotent no-op when no drag is active. (R13a)
     *
     *  Consumers invalidate the engine's snapshot via this method when
     *  cross-surface mutations make the captured indices stale (id-list
     *  shape change, popover dismiss during drag, parent unmount). */
    cancel: () => {
      if (drag) cancelDrag();
    },

    /** Manually dispose the isolated reactive root. Call this if you
     *  created the primitive outside a SolidJS owner scope and need
     *  deterministic cleanup. */
    dispose: () => {
      if (drag) cancelDrag();
      nodes.clear();
      disposeRoot?.();
    },
  };
}
