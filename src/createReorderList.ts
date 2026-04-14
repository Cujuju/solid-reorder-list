/**
 * createReorderList — generic drag-to-reorder primitive for SolidJS.
 *
 * Handles variable-height items, single-axis movement, and smooth CSS
 * transition reflow. Zero external dependencies beyond solid-js.
 * Works with any element type — spread `itemProps(id)` onto each
 * sortable item.
 *
 * Collision model (edge-overlap):
 *   - Dragged card follows the pointer via transform.
 *   - Swap triggers when the dragged card's leading edge overlaps a
 *     neighbor past a split threshold (40% forward, 70% reverse).
 *   - After a swap, effective positions shift by half the dragged size,
 *     creating a reduced dead zone that allows easy reversal.
 *   - Displaced cards animate via CSS transition ("pop" reflow).
 */

import { createSignal, createRoot, onCleanup, getOwner } from 'solid-js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReorderListOptions {
  /** Reactive list of IDs in current order */
  ids: () => string[];
  /** Called on drop with original and target indices */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Drag axis — 'y' (default) or 'x' */
  axis?: 'x' | 'y';
  /** Pixels of movement before drag activates (default: 5) */
  activateDistance?: number;
  /** Duration of displacement transition in ms (default: 200) */
  transitionMs?: number;
  /** CSS class applied to the active (dragged) item (default: 'reorder-active') */
  activeClass?: string;
  /** Scale factor for the dragged item's visual "lift" (default: 0.97).
   *  Set to 1.0 for no scale effect. */
  dragScale?: number;
  /** Whether to call stopPropagation on pointerdown. Set to false to allow
   *  pointer events to reach parent elements. (default: true) */
  stopPropagation?: boolean;
}

interface CachedRect {
  start: number;  // top (y) or left (x)
  size: number;   // height or width
  end: number;    // start + size
}

interface DragState {
  id: string;
  sourceIndex: number;
  startPointer: number;
  rects: CachedRect[];         // original positions, immutable during drag
  effectiveStarts: number[];   // mutable — updated after each swap for anti-jitter
  draggedSize: number;
  currentTarget: number;
  ids: string[];
}

// ── Primitive ──────────────────────────────────────────────────────────────

export function createReorderList(options: ReorderListOptions) {
  const getAxis = () => options.axis ?? 'y';
  // Pixels of pointer movement required before drag activates.
  // Prevents accidental drag on click (normal mouse jitter is 1-3px).
  const getActivateDistance = () => options.activateDistance ?? 5;
  const getTransitionMs = () => options.transitionMs ?? 200;
  const getActiveClass = () => options.activeClass ?? 'reorder-active';

  // Scale factor applied to the dragged item for visual "lift" effect.
  // 0.97 = 3% shrink. Set to 1.0 for no scale. Consumers can override.
  const DRAG_SCALE = options.dragScale ?? 0.97;
  const getStopPropagation = () => options.stopPropagation ?? true;

  // Registered elements keyed by ID
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

  // Stored so cancel handlers can clean up pointer listeners from onPointerDown
  let pointerCleanup: (() => void) | null = null;

  // Non-reactive drag state — mutated in pointermove for performance
  let drag: DragState | null = null;

  // rAF handle for batching dragged item transform updates
  let dragRaf: number = 0;

  // ── Helpers ────────────────────────────────────────────────────────────

  const ptr = (e: PointerEvent) => getAxis() === 'y' ? e.clientY : e.clientX;
  const tx = (px: number) =>
    getAxis() === 'y' ? `translateY(${px}px)` : `translateX(${px}px)`;

  /** Measure one element into a CachedRect along the active axis */
  function measure(el: HTMLElement): CachedRect {
    const r = el.getBoundingClientRect();
    const start = getAxis() === 'y' ? r.top : r.left;
    const size = getAxis() === 'y' ? r.height : r.width;
    return { start, size, end: start + size };
  }

  /**
   * Edge-overlap target calculation.
   *
   * For each non-source item, compute how much the dragged card's leading
   * edge overlaps it. Uses split thresholds: 40% for forward swaps (stable),
   * 70% for reversals (easy undo). effectiveStarts shift by half the dragged
   * size after swaps, creating a moderate dead zone for anti-jitter.
   *
   * Returns sourceIndex + belowCount - aboveCount, since each overlapped
   * item below pushes the target forward and each above pulls it back.
   */
  function calcTarget(
    draggedStart: number,
    draggedEnd: number,
    sourceIndex: number,
    state: DragState,
  ): number {
    const { rects, effectiveStarts, draggedSize, currentTarget } = state;
    let belowCount = 0;
    let aboveCount = 0;

    for (let i = 0; i < rects.length; i++) {
      if (i === sourceIndex) continue;

      const targetSize = rects[i].size;
      const effectiveStart = effectiveStarts[i];
      const effectiveEnd = effectiveStart + targetSize;

      // Split threshold: displaced items use a HIGH threshold (easy to release),
      // non-displaced items use a LOW threshold (stable forward movement).
      const isDisplaced = (i > sourceIndex && i <= currentTarget)
                       || (i < sourceIndex && i >= currentTarget);
      const pct = isDisplaced ? 0.70 : 0.40;
      const overlapThreshold = Math.min(draggedSize, targetSize) * pct;

      if (i > sourceIndex) {
        const overlap = draggedEnd - effectiveStart;
        if (overlap > overlapThreshold) belowCount++;
      } else {
        const overlap = effectiveEnd - draggedStart;
        if (overlap > overlapThreshold) aboveCount++;
      }
    }

    return sourceIndex + belowCount - aboveCount;
  }

  /**
   * After the target changes, update effectiveStarts to create the anti-jitter
   * dead zone. Uses half of draggedSize (decoupled from visual displacement)
   * so reversals are easy while forward movement stays stable.
   */
  function updateEffectivePositions(state: DragState) {
    const { rects, sourceIndex, currentTarget, draggedSize, effectiveStarts } = state;
    const halfShift = draggedSize * 0.5;

    for (let i = 0; i < rects.length; i++) {
      if (i === sourceIndex) {
        effectiveStarts[i] = rects[i].start;
        continue;
      }

      if (currentTarget > sourceIndex && i > sourceIndex && i <= currentTarget) {
        effectiveStarts[i] = rects[i].start - halfShift;
      } else if (currentTarget < sourceIndex && i >= currentTarget && i < sourceIndex) {
        effectiveStarts[i] = rects[i].start + halfShift;
      } else {
        effectiveStarts[i] = rects[i].start;
      }
    }
  }

  // ── Drag lifecycle ─────────────────────────────────────────────────────

  function activate(id: string, sourceIndex: number, ids: string[], startPointer: number) {
    // Prune stale entries — items removed from the list since last drag
    const idSet = new Set(ids);
    for (const key of nodes.keys()) {
      if (!idSet.has(key)) nodes.delete(key);
    }

    // Snapshot all rects at drag start (measured once, cached for duration)
    const rects: CachedRect[] = ids.map(itemId => {
      const el = nodes.get(itemId);
      return el ? measure(el) : { start: 0, size: 0, end: 0 };
    });

    const effectiveStarts = rects.map(r => r.start);

    drag = {
      id,
      sourceIndex,
      startPointer,
      rects,
      effectiveStarts,
      draggedSize: rects[sourceIndex].size,
      currentTarget: sourceIndex,
      ids,
    };

    setActiveId(id);
    setTargetIdx(sourceIndex);

    // Style: dragged item gets instant scale lift,
    // all others get smooth transition for displacement animation.
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
    addCancelListeners();
  }

  function updateDrag(pointerPos: number) {
    if (!drag) return;
    const { sourceIndex, startPointer, rects, ids } = drag;
    const delta = pointerPos - startPointer;

    // Move dragged item — batched to one DOM write per frame
    const draggedEl = nodes.get(ids[sourceIndex]);
    if (draggedEl) {
      if (dragRaf) cancelAnimationFrame(dragRaf);
      dragRaf = requestAnimationFrame(() => {
        draggedEl.style.transform = `${tx(delta)} scale(${DRAG_SCALE})`;
        dragRaf = 0;
      });
    }

    // Dragged card's current edges
    const draggedStart = rects[sourceIndex].start + delta;
    const draggedEnd = draggedStart + rects[sourceIndex].size;

    const prevTarget = drag.currentTarget;
    const targetIndex = calcTarget(draggedStart, draggedEnd, sourceIndex, drag);
    drag.currentTarget = targetIndex;

    // Only update displacement transforms when the target actually changes
    if (targetIndex !== prevTarget) {
      updateEffectivePositions(drag);
      setTargetIdx(targetIndex);

      const { draggedSize } = drag;
      for (let i = 0; i < ids.length; i++) {
        if (i === sourceIndex) continue;
        const el = nodes.get(ids[i]);
        if (!el) continue;

        let shift = 0;
        if (targetIndex > sourceIndex && i > sourceIndex && i <= targetIndex) {
          shift = -draggedSize;
        } else if (targetIndex < sourceIndex && i >= targetIndex && i < sourceIndex) {
          shift = draggedSize;
        }

        el.style.transform = shift !== 0 ? tx(shift) : '';
      }
    }
  }

  /** Commit the drag — clear styles, block post-drag click, fire onReorder. */
  function commitDrag() {
    if (!drag) return;
    if (pointerCleanup) { pointerCleanup(); pointerCleanup = null; }
    const { sourceIndex, currentTarget } = drag;

    removeCancelListeners();
    setActiveId(null);
    setTargetIdx(-1);
    clearDragStyles();
    blockNextClick();

    const from = sourceIndex;
    const to = currentTarget;
    drag = null;
    if (from !== to) options.onReorder(from, to);
  }

  /** Cancel the drag — clear styles, don't commit reorder. */
  function cancelDrag() {
    if (!drag) return;
    if (pointerCleanup) { pointerCleanup(); pointerCleanup = null; }
    removeCancelListeners();
    setActiveId(null);
    setTargetIdx(-1);
    clearDragStyles();
    drag = null;
  }

  // ── Cancellation handlers ──────────────────────────────────────────────

  function onEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelDrag();
  }
  function onBlur() { cancelDrag(); }
  function onContextMenu() { cancelDrag(); }

  function addCancelListeners() {
    document.addEventListener('keydown', onEscape);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', onBlur);
  }

  function removeCancelListeners() {
    document.removeEventListener('keydown', onEscape);
    document.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('blur', onBlur);
  }

  function clearDragStyles() {
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }

    const targets = drag?.ids
      ? drag.ids.map(id => nodes.get(id)).filter((el): el is HTMLElement => !!el)
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

  /** Block the post-drag click. Document capture + once eats the click,
   *  rAF safety net removes the handler if click never fires. */
  function blockNextClick() {
    const eatClick = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', eatClick, { capture: true, once: true });
    requestAnimationFrame(() => {
      document.removeEventListener('click', eatClick, { capture: true });
    });
  }

  // ── Pointer event wiring ───────────────────────────────────────────────

  function onPointerDown(id: string, e: PointerEvent) {
    if (e.button !== 0) return;
    if (drag) return;

    // Don't start drag on interactive children (buttons, inputs, links).
    // Without this, clicking a button and moving 5px activates a drag
    // instead of the button's click handler — especially problematic for
    // delete buttons and trailing-column controls.
    if ((e.target as HTMLElement).closest('button, input, a, [role="button"]')) return;

    if (getStopPropagation()) e.stopPropagation();

    const ids = options.ids();
    const sourceIndex = ids.indexOf(id);
    if (sourceIndex === -1) return;

    const start = ptr(e);
    const threshold = getActivateDistance();
    let activated = false;

    const onMove = (ev: PointerEvent) => {
      if (!activated) {
        const distance = Math.abs(ptr(ev) - start);
        if (distance >= threshold) {
          activated = true;
          activate(id, sourceIndex, ids, ptr(ev));
        }
        return;
      }
      updateDrag(ptr(ev));
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

  // ── Cleanup ────────────────────────────────────────────────────────────

  // Guard: only register onCleanup if running inside a SolidJS reactive owner.
  // This makes the primitive safe to use in tests or imperative code outside
  // a component tree. When used inside a component, cleanup fires automatically
  // on unmount.
  if (getOwner()) {
    onCleanup(() => {
      if (drag) cancelDrag();
      nodes.clear();
      disposeRoot?.();
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    /** Spread onto each reorderable item element */
    itemProps: (id: string) => ({
      ref: (el: HTMLElement) => { nodes.set(id, el); },
      onPointerDown: (e: PointerEvent) => onPointerDown(id, e),
      classList: { [getActiveClass()]: activeId() === id },
      'data-reorder-id': id,
    }),

    /** Whether the given item is currently being dragged */
    isActive: (id: string) => activeId() === id,

    /** Whether any item is currently being dragged */
    isDragging: () => activeId() !== null,

    /** The ID of the item currently being dragged, or null */
    activeId,

    /** The current drop target index, or -1 if not dragging */
    targetIndex: targetIdx,

    /** Manually dispose the isolated reactive root. Call this if you created
     *  the primitive outside a SolidJS owner scope and need deterministic cleanup. */
    dispose: () => {
      if (drag) cancelDrag();
      nodes.clear();
      disposeRoot?.();
    },
  };
}
