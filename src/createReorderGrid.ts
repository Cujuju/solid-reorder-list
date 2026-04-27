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
  /** Pointer position at activate, in VIEWPORT coords (clientX/Y).
   *  Source-element transform reads this to translate the dragged item
   *  by the viewport delta as the pointer moves. */
  startPointerViewport: { x: number; y: number };
  /** Scroll offset at activate. Combined with startPointerViewport
   *  gives the activate-time content-frame anchor; combined with the
   *  current scroll gives the current content-frame pointer. */
  scrollAtActivate: { x: number; y: number };
  /** Original snapshot rects in container-content coords. Immutable
   *  during drag. */
  rects: CachedGridRect[];
  /** Mutable mirror of `rects[]` used for hysteresis. Same coordinate
   *  frame. Mutated on each target change by U4. */
  effectiveRects: CachedGridRect[];
  /** Inferred grid metrics. */
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

  /** Measure one element into a CachedGridRect in container-content
   *  coords (clientLeft/Top + scrollContainer.scrollLeft/Top, mirror y).
   *  When no scrollContainer is provided, falls back to window.scrollX/Y
   *  so the no-container path resolves to true page coords. */
  function measure(el: HTMLElement, scroll: { x: number; y: number }): CachedGridRect {
    const r = el.getBoundingClientRect();
    return {
      contentLeft: r.left + scroll.x,
      contentTop: r.top + scroll.y,
      contentRight: r.right + scroll.x,
      contentBottom: r.bottom + scroll.y,
      width: r.width,
      height: r.height,
    };
  }

  /** Same-row predicate using cell-height-relative tolerance to
   *  absorb sub-pixel jitter on HiDPI / fractional layouts. */
  function sameRow(a: CachedGridRect, b: CachedGridRect, cellHeight: number): boolean {
    return Math.abs(a.contentTop - b.contentTop) < cellHeight * 0.1;
  }

  /** Hit-test a content-frame pointer against the engine's
   *  effectiveRects[]. First match wins (flat-order tie-break for
   *  4-way corners). When no rect contains the point, returns the
   *  cell whose centre minimises Euclidean distance from the point. */
  function hitTest(point: { x: number; y: number }): number {
    if (!drag) return -1;
    const { effectiveRects, rects } = drag;
    for (let i = 0; i < effectiveRects.length; i++) {
      const r = effectiveRects[i];
      if (
        point.x >= r.contentLeft && point.x <= r.contentRight &&
        point.y >= r.contentTop && point.y <= r.contentBottom
      ) {
        return i;
      }
    }
    // Fallback — nearest by centre distance against the original
    // (un-inflated) rects, since centres are stable under hysteresis.
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const cx = (r.contentLeft + r.contentRight) / 2;
      const cy = (r.contentTop + r.contentBottom) / 2;
      const d = Math.hypot(point.x - cx, point.y - cy);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    return bestIdx;
  }

  /** Apply lift styling to the dragged element + neighbour transition
   *  styles. Captures the snapshot, infers grid metrics, builds the
   *  inflated effectiveRects[]. Displacement and commit logic land in U4. */
  function activate(
    id: string,
    sourceIndex: number,
    ids: string[],
    startPointerViewport: { x: number; y: number },
    scrollAtActivate: { x: number; y: number },
  ) {
    // Prune stale entries — items removed since last drag.
    const idSet = new Set(ids);
    for (const key of nodes.keys()) {
      if (!idSet.has(key)) nodes.delete(key);
    }

    // Snapshot — measure all registered rects in container-content coords.
    // Items missing from `nodes` (shouldn't happen in practice but defends
    // against partial registration) get zero-rects so indices stay aligned.
    const rects: CachedGridRect[] = ids.map((itemId) => {
      const el = nodes.get(itemId);
      return el
        ? measure(el, scrollAtActivate)
        : { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, width: 0, height: 0 };
    });

    // Cell-width / cell-height inference — first item's dimensions.
    const cellWidth = rects[0]?.width ?? 0;
    const cellHeight = rects[0]?.height ?? 0;

    // Dev-mode-only non-uniform-cell diagnostic. Production builds pay no
    // diagnostic cost; external adopters with mismatched cells get a
    // console signal instead of silent wrong displacement.
    // Skip zero-sized rects (unregistered-sentinel — see measure()'s
    // fallback path) so partial registration during incremental mounts
    // doesn't trip the warn.
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      for (const r of rects) {
        if (r.width === 0 && r.height === 0) continue;
        if (
          Math.abs(r.width - cellWidth) > cellHeight * 0.05 ||
          Math.abs(r.height - cellHeight) > cellHeight * 0.05
        ) {
          console.warn(
            '@cujuju/solid-reorder-list: createReorderGrid expects uniform cell sizes. ' +
            'See README "Scope assumptions". Mismatched cell detected: ' +
            `${r.width}x${r.height} vs expected ${cellWidth}x${cellHeight}.`,
          );
          break;
        }
      }
    }

    // Column count inference — count items in the first row by
    // content-top, using a cell-height-relative tolerance.
    let cols = 1;
    while (cols < rects.length && sameRow(rects[0], rects[cols], cellHeight)) cols++;

    // Defensive guard for degenerate cases — single-row when only one
    // row of items exists. Engine continues without crashing rather
    // than refuse to drag.
    if (cols < 1 || cols > rects.length) cols = rects.length;

    // Cross-validation invariant: row 1's content-top should be
    // distinctly below row 0's (offset by ~cellHeight + gutterY). If
    // sameRow reports they're on the same row at index `cols`, the
    // tolerance was too loose for this layout — emit dev-mode warn so
    // tight-row-spacing consumers see the signal instead of silent
    // wrong displacement.
    if (
      typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production' &&
      rects.length > cols && sameRow(rects[0], rects[cols], cellHeight)
    ) {
      console.warn(
        '@cujuju/solid-reorder-list: createReorderGrid column-count inference ' +
        'cross-validation failed. Inferred cols=' + cols + ' but row[0] and row[1] ' +
        `appear in the same row by cellHeight*0.1 tolerance (cellHeight=${cellHeight}). ` +
        'Likely cause: gutterY < cellHeight*0.1 (compact layout). ' +
        'Engine continues with inferred cols, but displacement may be incorrect.',
      );
    }

    // Gutter inference — defensive against degenerate layouts.
    const gutterX = rects[1] && sameRow(rects[0], rects[1], cellHeight)
      ? Math.max(0, rects[1].contentLeft - rects[0].contentRight)
      : 0;
    const gutterY = rects[cols]
      ? Math.max(0, rects[cols].contentTop - rects[0].contentBottom)
      : 0;

    // Inflated effectiveRects[] — tessellate cells with no gaps so
    // pointer-in-gutter has a deterministic target. Mutable copy lets
    // U4 apply per-target hysteresis adjustments in place.
    const effectiveRects: CachedGridRect[] = rects.map((r) => ({
      contentLeft: r.contentLeft - gutterX / 2,
      contentTop: r.contentTop - gutterY / 2,
      contentRight: r.contentRight + gutterX / 2,
      contentBottom: r.contentBottom + gutterY / 2,
      width: r.width + gutterX,
      height: r.height + gutterY,
    }));

    drag = {
      id,
      sourceIndex,
      startPointerViewport,
      scrollAtActivate,
      rects,
      effectiveRects,
      cellWidth,
      cellHeight,
      gutterX,
      gutterY,
      cols,
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

  // Hysteresis fraction — how much of a cell's width/height the
  // current target's boundary is biased on the side facing the
  // previous target. 0.5 = half-cell. Mirrors 1-D's halfShift idiom
  // (createReorderList.ts updateEffectivePositions) translated to
  // 2-D rects with axis-magnitude-proportional bias.
  const HYSTERESIS_FRACTION = 0.5;

  /** Reset effectiveRects[] back to inflated rects (gutter/2 on all
   *  sides), then apply axis-magnitude-proportional hysteresis to the
   *  prev/new target pair. Called on every target change.
   *
   *  Pure horizontal swap (next is right of prev): bias is full
   *  half-cell on the horizontal axis, zero on vertical.
   *  Pure vertical: mirror.
   *  Diagonal (row-wrap): both axes proportional to |unit-vector
   *  components|, so the perceived reversal-travel scales with the
   *  swap distance. */
  function applyHysteresis(state: GridDragState, prevTarget: number, newTarget: number) {
    const { rects, effectiveRects, cellWidth, cellHeight, gutterX, gutterY } = state;

    // Reset all effectiveRects to inflated copies of rects[].
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const e = effectiveRects[i];
      e.contentLeft = r.contentLeft - gutterX / 2;
      e.contentTop = r.contentTop - gutterY / 2;
      e.contentRight = r.contentRight + gutterX / 2;
      e.contentBottom = r.contentBottom + gutterY / 2;
      e.width = r.width + gutterX;
      e.height = r.height + gutterY;
    }

    if (prevTarget === newTarget) return;

    const prevR = rects[prevTarget];
    const nextR = rects[newTarget];
    if (!prevR || !nextR) return;

    const cxPrev = (prevR.contentLeft + prevR.contentRight) / 2;
    const cyPrev = (prevR.contentTop + prevR.contentBottom) / 2;
    const cxNext = (nextR.contentLeft + nextR.contentRight) / 2;
    const cyNext = (nextR.contentTop + nextR.contentBottom) / 2;
    const dx = cxNext - cxPrev;
    const dy = cyNext - cyPrev;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) return;

    const dxU = dx / mag;
    const dyU = dy / mag;
    const shrinkX = Math.abs(dxU) * cellWidth * HYSTERESIS_FRACTION;
    const shrinkY = Math.abs(dyU) * cellHeight * HYSTERESIS_FRACTION;

    const eNext = effectiveRects[newTarget];
    const ePrev = effectiveRects[prevTarget];

    // Shrink newTarget on the side facing prev (boundary between them
    // shifts into newTarget's territory) so reversing requires extra
    // pointer travel.
    if (dxU > 0) eNext.contentLeft += shrinkX;
    else if (dxU < 0) eNext.contentRight -= shrinkX;
    if (dyU > 0) eNext.contentTop += shrinkY;
    else if (dyU < 0) eNext.contentBottom -= shrinkY;

    // Expand prevTarget toward newTarget — the boundary on the prev
    // side stays put, and the source's "fallback zone" extends so the
    // user can reverse without immediately re-triggering on prev's
    // adjacent boundary.
    if (dxU > 0) ePrev.contentRight += shrinkX;
    else if (dxU < 0) ePrev.contentLeft -= shrinkX;
    if (dyU > 0) ePrev.contentBottom += shrinkY;
    else if (dyU < 0) ePrev.contentTop -= shrinkY;
  }

  /** Apply per-item flat-order displacement transforms when the target
   *  changes. Each item between sourceIndex and newTarget (inclusive
   *  on both ends, in flat-order sequence) translates to its
   *  predecessor's (forward drag) or successor's (reverse drag)
   *  snapshot position. Items outside this range get `transform: ''`.
   *  Source-element transform is owned by `updateDrag` (rAF-batched). */
  function applyDisplacement(state: GridDragState) {
    const { rects, ids, sourceIndex, currentTarget } = state;
    for (let i = 0; i < ids.length; i++) {
      if (i === sourceIndex) continue;
      const el = nodes.get(ids[i]);
      if (!el) continue;

      let destIdx = -1;
      if (currentTarget > sourceIndex && i > sourceIndex && i <= currentTarget) {
        // Forward drag: items shift backward by one flat-order slot.
        destIdx = i - 1;
      } else if (currentTarget < sourceIndex && i >= currentTarget && i < sourceIndex) {
        // Reverse drag: items shift forward by one flat-order slot.
        destIdx = i + 1;
      }

      if (destIdx === -1) {
        el.style.transform = '';
      } else {
        const dest = rects[destIdx];
        const cur = rects[i];
        const tx = dest.contentLeft - cur.contentLeft;
        const ty = dest.contentTop - cur.contentTop;
        el.style.transform = `translate(${tx}px, ${ty}px)`;
      }
    }
  }

  /** Per-pointermove tick. Two coordinate frames in play:
   *  - Source-element transform uses VIEWPORT delta (clientX/Y delta
   *    from `startPointerViewport`), so the dragged item stays glued
   *    to the user's pointer regardless of mid-drag scroll.
   *  - Hit-test uses the CONTENT-frame pointer (clientX + current
   *    scroll), so it tests against the activate-time snapshot rects
   *    that live in the same frame. */
  function updateDrag(ev: PointerEvent) {
    if (!drag) return;
    const { startPointerViewport } = drag;
    const dx = ev.clientX - startPointerViewport.x;
    const dy = ev.clientY - startPointerViewport.y;

    // Source-element transform — batched to one DOM write per frame.
    const draggedEl = nodes.get(drag.ids[drag.sourceIndex]);
    if (draggedEl) {
      if (dragRaf) cancelAnimationFrame(dragRaf);
      dragRaf = requestAnimationFrame(() => {
        draggedEl.style.transform = `translate(${dx}px, ${dy}px) scale(${DRAG_SCALE})`;
        dragRaf = 0;
      });
    }

    // Hit-test in content frame against the activate-time snapshot rects.
    // Manual scroll changes since activate are absorbed by re-reading
    // the live scroll on every tick (R7).
    const currentScroll = getScroll(getScrollContainer());
    const pointerContent = {
      x: ev.clientX + currentScroll.x,
      y: ev.clientY + currentScroll.y,
    };
    const newTarget = hitTest(pointerContent);

    if (newTarget !== drag.currentTarget) {
      const prevTarget = drag.currentTarget;
      drag.currentTarget = newTarget;
      setTargetIdx(newTarget);
      applyHysteresis(drag, prevTarget, newTarget);
      applyDisplacement(drag);
    }
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
          // Snapshot scroll at activate-time. startPointer is stored as
          // viewport coords (for source-element transform deltas);
          // scrollAtActivate carries the activate-time scroll separately
          // so hit-test can compute content-frame pointer at any later
          // time as `clientX + getScroll().x` (R7 live compensation).
          const scroll = getScroll(getScrollContainer());
          activate(
            id,
            sourceIndex,
            ids,
            { x: ev.clientX, y: ev.clientY },
            { x: scroll.x, y: scroll.y },
          );
        }
        return;
      }
      updateDrag(ev);
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
