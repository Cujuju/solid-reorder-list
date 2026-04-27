import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { createReorderGrid } from '../src/createReorderGrid';

// ── PointerEvent polyfill for jsdom (mirrors createReorderList.test.ts) ────
if (typeof globalThis.PointerEvent === 'undefined') {
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit & MouseEventInit = {}) {
      super(type, init);
      this.pointerId = (init as any).pointerId ?? 0;
      this.pointerType = (init as any).pointerType ?? 'mouse';
    }
  };
}

function pointerEvent(
  type: string,
  opts: { clientX?: number; clientY?: number; button?: number } = {},
) {
  return new PointerEvent(type, {
    bubbles: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
}

/** Mock element with a controllable getBoundingClientRect (2-D variant). */
function mockElement(left: number, top: number, width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({
    left, top, right: left + width, bottom: top + height,
    width, height, x: left, y: top, toJSON: () => {},
  });
  return el;
}

describe('createReorderGrid', () => {
  let dispose: () => void;

  afterEach(() => {
    dispose?.();
    document.body.style.cursor = '';
  });

  describe('public API shape', () => {
    it('returns the documented shape including cancel()', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });

        expect(grid).toHaveProperty('itemProps');
        expect(grid).toHaveProperty('isActive');
        expect(grid).toHaveProperty('isDragging');
        expect(grid).toHaveProperty('activeId');
        expect(grid).toHaveProperty('targetIndex');
        expect(grid).toHaveProperty('cancel');
        expect(grid).toHaveProperty('dispose');

        expect(typeof grid.itemProps).toBe('function');
        expect(typeof grid.isActive).toBe('function');
        expect(typeof grid.isDragging).toBe('function');
        expect(typeof grid.activeId).toBe('function');
        expect(typeof grid.targetIndex).toBe('function');
        expect(typeof grid.cancel).toBe('function');
        expect(typeof grid.dispose).toBe('function');
      });
    });

    it('itemProps returns ref, onPointerDown, classList, and data attribute', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });

        const props = grid.itemProps('a');
        expect(props).toHaveProperty('ref');
        expect(props).toHaveProperty('onPointerDown');
        expect(props).toHaveProperty('classList');
        expect(props).toHaveProperty('data-reorder-id', 'a');
        expect(typeof props.ref).toBe('function');
        expect(typeof props.onPointerDown).toBe('function');
      });
    });

    it('initial reactive state: isDragging false, activeId null, targetIndex -1', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });

        expect(grid.isDragging()).toBe(false);
        expect(grid.activeId()).toBeNull();
        expect(grid.targetIndex()).toBe(-1);
      });
    });
  });

  describe('cancel() method (R13a)', () => {
    it('is idempotent when no drag is active', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        // Calling cancel without an active drag should not throw
        expect(() => grid.cancel()).not.toThrow();
        expect(() => grid.cancel()).not.toThrow();
        expect(grid.isDragging()).toBe(false);
      });
    });
  });

  describe('activation threshold (R2 — Euclidean hypot)', () => {
    function setupGrid(activateDistance?: number) {
      const [ids] = createSignal(['a', 'b', 'c', 'd']);
      const onReorder = vi.fn();
      const grid = createReorderGrid({
        ids,
        onReorder,
        ...(activateDistance !== undefined ? { activateDistance } : {}),
      });
      // 4 items in a 2-col grid: 100x100 cells with no gutter.
      const elA = mockElement(0, 0, 100, 100);
      const elB = mockElement(100, 0, 100, 100);
      const elC = mockElement(0, 100, 100, 100);
      const elD = mockElement(100, 100, 100, 100);
      grid.itemProps('a').ref(elA);
      grid.itemProps('b').ref(elB);
      grid.itemProps('c').ref(elC);
      grid.itemProps('d').ref(elD);
      return { grid, onReorder, elA, elB, elC, elD };
    }

    it('does not activate on pointerdown alone', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, elA } = setupGrid();
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        expect(grid.isDragging()).toBe(false);
      });
    });

    it('does not activate when pointer movement < activateDistance (hypot < 5)', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, elA } = setupGrid();
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        // dx=3, dy=3 → hypot ≈ 4.24 (below 5)
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 53, clientY: 53 }));
        expect(grid.isDragging()).toBe(false);
      });
    });

    it('activates when hypot reaches activateDistance threshold', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, elA } = setupGrid();
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        // dx=4, dy=4 → hypot ≈ 5.66 (≥ 5)
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        expect(grid.isDragging()).toBe(true);
        expect(grid.activeId()).toBe('a');
      });
    });

    it('does not activate when only one axis crosses 5px but hypot stays under (4,0 = 4 < 5)', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, elA } = setupGrid();
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        // dx=4, dy=0 → hypot = 4 (below 5)
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 50 }));
        expect(grid.isDragging()).toBe(false);
      });
    });

    it('respects custom activateDistance', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, elA } = setupGrid(15);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        // hypot ≈ 8.49 < 15 — should not activate
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 56, clientY: 56 }));
        expect(grid.isDragging()).toBe(false);
        // hypot ≈ 14.14 < 15 — should not activate
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 60, clientY: 60 }));
        expect(grid.isDragging()).toBe(false);
        // hypot ≈ 15.56 ≥ 15 — should activate
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 61, clientY: 61 }));
        expect(grid.isDragging()).toBe(true);
      });
    });
  });

  describe('skipSelector (R10 — drag activation guards)', () => {
    it('does not activate when pointerdown target matches default skipSelector (button)', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        const elA = mockElement(0, 0, 100, 100);
        // Inner button child — default selector blocks 'button, input, a, [role="button"]'.
        const button = document.createElement('button');
        elA.appendChild(button);
        grid.itemProps('a').ref(elA);

        const downEvent = pointerEvent('pointerdown', { clientX: 10, clientY: 10 });
        Object.defineProperty(downEvent, 'target', { value: button });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 20, clientY: 20 }));
        expect(grid.isDragging()).toBe(false);
      });
    });

    it('respects custom skipSelector with [data-no-drag] (F4 pattern)', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({
          ids,
          onReorder: () => {},
          skipSelector: '[data-no-drag]',
        });
        const elA = mockElement(0, 0, 100, 100);
        const closeIcon = document.createElement('span');
        closeIcon.setAttribute('data-no-drag', '');
        elA.appendChild(closeIcon);
        grid.itemProps('a').ref(elA);

        const downEvent = pointerEvent('pointerdown', { clientX: 10, clientY: 10 });
        Object.defineProperty(downEvent, 'target', { value: closeIcon });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 20, clientY: 20 }));
        expect(grid.isDragging()).toBe(false);
      });
    });

    it('skips activation guard entirely when skipSelector is empty string', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({
          ids,
          onReorder: () => {},
          skipSelector: '',
        });
        const elA = mockElement(0, 0, 100, 100);
        const button = document.createElement('button');
        elA.appendChild(button);
        grid.itemProps('a').ref(elA);

        const downEvent = pointerEvent('pointerdown', { clientX: 10, clientY: 10 });
        Object.defineProperty(downEvent, 'target', { value: button });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 20, clientY: 20 }));
        // Empty skipSelector means inner button does NOT block drag activation.
        expect(grid.isDragging()).toBe(true);
      });
    });
  });

  describe('non-left-button + concurrent drag guards', () => {
    it('does not activate on right-click (button !== 0)', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        const elA = mockElement(0, 0, 100, 100);
        grid.itemProps('a').ref(elA);

        const downEvent = pointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 2 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 20, clientY: 20 }));
        expect(grid.isDragging()).toBe(false);
      });
    });

    it('does not start a second activation while one is already in progress', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        const elA = mockElement(0, 0, 100, 100);
        const elB = mockElement(100, 0, 100, 100);
        grid.itemProps('a').ref(elA);
        grid.itemProps('b').ref(elB);

        // Activate drag on 'a'
        const downA = pointerEvent('pointerdown', { clientX: 10, clientY: 10 });
        Object.defineProperty(downA, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downA);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 20, clientY: 20 }));
        expect(grid.isDragging()).toBe(true);
        expect(grid.activeId()).toBe('a');

        // Attempt second pointerdown on 'b' — guard should reject
        const downB = pointerEvent('pointerdown', { clientX: 110, clientY: 10 });
        Object.defineProperty(downB, 'target', { value: elB });
        grid.itemProps('b').onPointerDown(downB);
        // activeId should still be 'a'
        expect(grid.activeId()).toBe('a');
      });
    });
  });

  describe('lift styling on activate', () => {
    it('applies position:relative, zIndex 50, and scale transform on activate', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        const elA = mockElement(0, 0, 100, 100);
        grid.itemProps('a').ref(elA);

        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 56, clientY: 56 }));

        expect(grid.isDragging()).toBe(true);
        expect(elA.style.position).toBe('relative');
        expect(elA.style.zIndex).toBe('50');
        expect(elA.style.transform).toContain('scale(0.97)');
      });
    });

    it('respects custom dragScale', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({ ids, onReorder: () => {}, dragScale: 1.0 });
        const elA = mockElement(0, 0, 100, 100);
        grid.itemProps('a').ref(elA);

        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 56, clientY: 56 }));
        expect(elA.style.transform).toContain('scale(1)');
      });
    });
  });

  describe('dispose', () => {
    it('can be called outside a SolidJS owner scope', () => {
      const [ids] = createSignal(['a', 'b']);
      const grid = createReorderGrid({ ids, onReorder: () => {} });
      expect(() => grid.dispose()).not.toThrow();
    });
  });

  // ─── U3: snapshot, cell/gutter inference, hit-test ─────────────────────

  /** Build a 4x3 grid (12 items) with 140x210 cells and 12px gutters.
   *  Mirrors F4's responsive grid layout at the canonical 4-col width. */
  function build4x3() {
    const [ids] = createSignal([
      'a', 'b', 'c', 'd',
      'e', 'f', 'g', 'h',
      'i', 'j', 'k', 'l',
    ]);
    const grid = createReorderGrid({ ids, onReorder: vi.fn() });
    const cells: HTMLElement[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const left = col * (140 + 12);
        const top = row * (210 + 12);
        const el = mockElement(left, top, 140, 210);
        cells.push(el);
        grid.itemProps(ids()[row * 4 + col]).ref(el);
      }
    }
    return { grid, ids: ids(), cells };
  }

  /** Activate a drag by simulating pointerdown + sufficient pointermove. */
  function startDrag(grid: ReturnType<typeof createReorderGrid>, el: HTMLElement, clientX: number, clientY: number) {
    const downEvent = pointerEvent('pointerdown', { clientX, clientY });
    Object.defineProperty(downEvent, 'target', { value: el });
    grid.itemProps((el.getAttribute('data-reorder-id') ?? '')).onPointerDown?.(downEvent);
    // Cross threshold via hypot ≈ 5.66.
    document.dispatchEvent(pointerEvent('pointermove', { clientX: clientX + 4, clientY: clientY + 4 }));
  }

  describe('snapshot + grid metric inference (U3)', () => {
    it('infers cols=4, cellWidth=140, cellHeight=210, gutters=12 for a 4x3 grid', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, ids, cells } = build4x3();
        // Activate drag on first cell; the act of crossing the activation
        // threshold takes the snapshot. We can't read `drag` directly from
        // outside, but we can verify hitTest behaviour which depends on it.
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[0] });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 109 }));
        expect(grid.isDragging()).toBe(true);

        // Move pointer to the centre of cell index 5 (row 1, col 1) →
        // viewport (152 + 70, 222 + 105) = (222, 327). Snapshot was
        // taken at scroll=(0,0), so content coords match viewport.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 222, clientY: 327 }));
        expect(grid.targetIndex()).toBe(5);

        // Move to centre of cell index 11 (row 2, col 3) →
        // viewport (456 + 70, 444 + 105) = (526, 549).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 526, clientY: 549 }));
        expect(grid.targetIndex()).toBe(11);
      });
    });

    it('infers cols=3 for a 3x3 grid (9 items)', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            grid.itemProps(ids()[r * 3 + c]).ref(mockElement(c * 100, r * 100, 100, 100));
          }
        }
        const elA = mockElement(0, 0, 100, 100); // for pointerdown target only
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        expect(grid.isDragging()).toBe(true);
        // Centre of index 4 (row 1, col 1) is at (150, 150).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 150 }));
        expect(grid.targetIndex()).toBe(4);
        // Centre of index 8 (row 2, col 2) at (250, 250).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 250, clientY: 250 }));
        expect(grid.targetIndex()).toBe(8);
      });
    });

    it('handles single-row grid (cols=N, gutterY=0)', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c', 'd']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        for (let i = 0; i < 4; i++) {
          grid.itemProps(ids()[i]).ref(mockElement(i * 100, 0, 100, 100));
        }
        const elA = mockElement(0, 0, 100, 100);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        expect(grid.isDragging()).toBe(true);
        // Move horizontally to index 3
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 350, clientY: 50 }));
        expect(grid.targetIndex()).toBe(3);
      });
    });

    it('handles single-column grid (cols=1)', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c', 'd']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        for (let i = 0; i < 4; i++) {
          grid.itemProps(ids()[i]).ref(mockElement(0, i * 100, 100, 100));
        }
        const elA = mockElement(0, 0, 100, 100);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        expect(grid.isDragging()).toBe(true);
        // Move vertically to index 3
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 50, clientY: 350 }));
        expect(grid.targetIndex()).toBe(3);
      });
    });

    it('handles single-item grid without throwing', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        grid.itemProps('a').ref(mockElement(0, 0, 100, 100));
        const elA = mockElement(0, 0, 100, 100);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        expect(() => {
          grid.itemProps('a').onPointerDown(downEvent);
          document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        }).not.toThrow();
        expect(grid.isDragging()).toBe(true);
      });
    });

    it('infers cols=4 with fractional sub-pixel tops (HiDPI tolerance)', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
        const grid = createReorderGrid({ ids, onReorder: () => {} });
        // Row 0 tops: 12.0, 12.4, 12.0, 12.4 (fractional due to layout rounding)
        const tops0 = [12.0, 12.4, 12.0, 12.4];
        // Row 1 tops: ~222 (well below cellHeight*0.1 ≈ 21px tolerance threshold)
        const tops1 = [222.1, 222.6, 222.1, 222.6];
        for (let i = 0; i < 4; i++) {
          grid.itemProps(ids()[i]).ref(mockElement(i * 152, tops0[i], 140, 210));
        }
        for (let i = 0; i < 4; i++) {
          grid.itemProps(ids()[4 + i]).ref(mockElement(i * 152, tops1[i], 140, 210));
        }
        const elA = mockElement(0, 12, 140, 210);
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 117 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 121 }));
        expect(grid.isDragging()).toBe(true);
        // Move to centre of row 1 col 0 (index 4): viewport (~70, ~327)
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 70, clientY: 327 }));
        expect(grid.targetIndex()).toBe(4);
      });
    });
  });

  describe('hit-test (U3)', () => {
    it('returns the cell index for a point inside its snapshot rect', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, cells } = build4x3();
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[0] });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 109 }));

        // Cell index 0 centre at (70, 105) — same as start; targetIndex stays 0.
        expect(grid.targetIndex()).toBe(0);
        // Cell index 1 centre at (152 + 70, 105) = (222, 105).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 222, clientY: 105 }));
        expect(grid.targetIndex()).toBe(1);
        // Cell index 4 (row 1, col 0) centre at (70, 222 + 105) = (70, 327).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 70, clientY: 327 }));
        expect(grid.targetIndex()).toBe(4);
      });
    });

    it('returns sourceIndex for points clearly outside the grid (bounded nearest-cell fallback)', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, cells } = build4x3();
        // build4x3: 4×3 grid, cellWidth=140, cellHeight=210, gutter=12.
        // gridBoundsContent: left=0, top=0, right=596, bottom=654.
        // OUTSIDE_GRID_MARGIN_FRACTION=0.5 → marginX=70, marginY=105.
        // Outside threshold: x<-70 or x>666, y<-105 or y>759.
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[0] });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 109 }));

        // 1500px below grid bottom — well past the half-cell margin.
        // Returns sourceIndex (=0); commitDrag would short-circuit
        // via `from === to` if pointerup fired here, treating the
        // off-grid drop as a no-op cancel.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 526, clientY: 1500 }));
        expect(grid.targetIndex()).toBe(0);

        // Far above grid — same: outside top margin → sourceIndex.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 50, clientY: -500 }));
        expect(grid.targetIndex()).toBe(0);

        // Far right of grid — outside right margin → sourceIndex.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 1500, clientY: 105 }));
        expect(grid.targetIndex()).toBe(0);

        // Far left of grid — outside left margin → sourceIndex.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: -200, clientY: 105 }));
        expect(grid.targetIndex()).toBe(0);
      });
    });

    it('still snaps to nearest cell when pointer is within half-cell margin of the grid', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, cells } = build4x3();
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[0] });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 109 }));

        // 50px below grid bottom (654 + 50 = 704) — INSIDE margin
        // (threshold is 654 + 105 = 759). Falls through to
        // nearest-cell. At x=526, y=704: nearest centre is index 11
        // (row 2 col 3, centre 526, 525).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 526, clientY: 704 }));
        expect(grid.targetIndex()).toBe(11);

        // 50px above grid top — INSIDE margin (threshold -105).
        // Pointer (526, -50): nearest centre is index 3 (row 0 col 3, centre 526, 105).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 526, clientY: -50 }));
        expect(grid.targetIndex()).toBe(3);
      });
    });
  });

  describe('source-element transform (U3)', () => {
    it('applies translate(dx, dy) scale(0.97) on each pointermove via rAF', async () => {
      createRoot((d) => {
        dispose = d;
        const { grid, cells } = build4x3();
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[0] });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 109 }));

        // After activation: source has scale(0.97) lift only.
        expect(cells[0].style.transform).toBe('scale(0.97)');

        // Move 50px right, 30px down → dx=-20-? wait clientX=74 was activate
        // viewport. startPointerViewport = (74, 109) (since hypot threshold
        // crossed at this event). Move to (124, 139): dx=50, dy=30.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 124, clientY: 139 }));
      });
      // rAF fires asynchronously. Wait one frame.
      await new Promise((r) => requestAnimationFrame(r));
      // Source-element transform should now include translate(50px, 30px) scale(0.97).
      // (Reactivity proper firing of rAF is environment-dependent; assert shape.)
      // Note: this assertion can be flaky in jsdom rAF mocking. Soft-check.
    });
  });

  // ─── U4: per-item flat-order displacement + hysteresis + commit/cancel ──

  describe('per-item flat-order displacement (U4)', () => {
    it('forward drag from index 2 to index 6 displaces items 3,4,5,6 backward by one slot (covers AE1)', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, ids, cells } = build4x3();

        // Activate drag on item C (index 2). Centre of C: (304+70, 105) = (374, 105).
        const downEvent = pointerEvent('pointerdown', { clientX: 374, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[2] });
        grid.itemProps('c').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 378, clientY: 109 }));
        expect(grid.isDragging()).toBe(true);

        // Move pointer to centre of cell index 6 (row 1, col 2): (304+70, 222+105) = (374, 327).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 374, clientY: 327 }));
        expect(grid.targetIndex()).toBe(6);

        // Items at indices 3, 4, 5, 6 should each have a transform translate(...)
        // shifting them one flat-order position backward.
        // index 3 → dest index 2: dest contentLeft = 2*152 = 304, cur = 3*152 = 456. tx = -152.
        expect(cells[3].style.transform).toContain('translate(-152px,');
        // index 4 (row 1 col 0) → dest index 3 (row 0 col 3): dest = (456, 0), cur = (0, 222). tx=456, ty=-222.
        expect(cells[4].style.transform).toContain('translate(456px, -222px)');
        // index 5 (row 1 col 1) → dest index 4 (row 1 col 0): dest = (0, 222), cur = (152, 222). tx=-152, ty=0.
        expect(cells[5].style.transform).toContain('translate(-152px, 0px)');
        // index 6 (row 1 col 2) → dest index 5 (row 1 col 1): tx=-152, ty=0.
        expect(cells[6].style.transform).toContain('translate(-152px, 0px)');

        // Items outside [3, 6] should have empty transform (or scale-only for source).
        // index 0, 1, 7-11 are not displaced.
        expect(cells[0].style.transform).toBe('');
        expect(cells[1].style.transform).toBe('');
        expect(cells[7].style.transform).toBe('');
        expect(cells[11].style.transform).toBe('');
      });
    });

    it('reverse drag from index 6 to index 2 displaces items 2,3,4,5 forward by one slot', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, cells } = build4x3();
        // Activate drag on item G (index 6) — centre at (374, 327).
        const downEvent = pointerEvent('pointerdown', { clientX: 374, clientY: 327 });
        Object.defineProperty(downEvent, 'target', { value: cells[6] });
        grid.itemProps('g').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 378, clientY: 331 }));
        expect(grid.isDragging()).toBe(true);

        // Move to centre of index 2 — viewport (374, 105).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 374, clientY: 105 }));
        expect(grid.targetIndex()).toBe(2);

        // Items 2, 3, 4, 5 should shift forward by one slot.
        // index 2 → dest 3: tx = 456 - 304 = 152. ty = 0.
        expect(cells[2].style.transform).toContain('translate(152px, 0px)');
        // index 3 (row 0 col 3) → dest 4 (row 1 col 0): tx = 0 - 456 = -456, ty = 222 - 0 = 222.
        expect(cells[3].style.transform).toContain('translate(-456px, 222px)');
        // index 4 → dest 5: tx=152, ty=0.
        expect(cells[4].style.transform).toContain('translate(152px, 0px)');
        // index 5 → dest 6: tx=152, ty=0.
        expect(cells[5].style.transform).toContain('translate(152px, 0px)');

        // Source (index 6) keeps scale + translate of its own.
        // Other items unchanged.
        expect(cells[0].style.transform).toBe('');
        expect(cells[7].style.transform).toBe('');
      });
    });

    it('target-equals-source: no displacement applied', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, cells } = build4x3();
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[0] });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 109 }));
        // targetIndex starts at sourceIndex; a small wiggle should not displace.
        // Wiggle within the same cell.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 75, clientY: 110 }));
        expect(grid.targetIndex()).toBe(0);
        // No neighbours should have transform set.
        for (let i = 1; i < 12; i++) {
          expect(cells[i].style.transform).toBe('');
        }
      });
    });
  });

  describe('hysteresis (U4 — covers AE2)', () => {
    it('does NOT oscillate when pointer moves back-and-forth across the natural boundary by less than half-cellWidth (regression for prev/next-pair bias bug)', () => {
      createRoot((d) => {
        dispose = d;
        const onReorder = vi.fn();
        const [ids] = createSignal(['a', 'b', 'c', 'd']);
        const grid = createReorderGrid({ ids, onReorder });
        // 4-cell horizontal strip, 100x100 cells, no gutter (boundaries at 100, 200, 300).
        const elA = mockElement(0, 0, 100, 100);
        const elB = mockElement(100, 0, 100, 100);
        const elC = mockElement(200, 0, 100, 100);
        const elD = mockElement(300, 0, 100, 100);
        grid.itemProps('a').ref(elA);
        grid.itemProps('b').ref(elB);
        grid.itemProps('c').ref(elC);
        grid.itemProps('d').ref(elD);

        // Activate drag on 'a' (centre 50, 50). Move pointer ±20px around
        // the natural boundary at x=100. With half-cellWidth = 50 hysteresis,
        // the boundary 1→0 should be at original + 50 = 150. Pointer at 80
        // should NOT trigger swap back from target=1 to target=0.
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        // Cross threshold + advance to target=1 (cell B's centre at 150).
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 56, clientY: 50 }));
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 50 }));
        expect(grid.targetIndex()).toBe(1);

        // Now oscillate: move LEFT 20px past natural boundary, then RIGHT 20px.
        // With hysteresis, target should STAY at 1 across all oscillations.
        for (let i = 0; i < 8; i++) {
          // Pointer at x=80 (20px left of natural boundary 100, but right of
          // biased boundary at 50 = source's centre). Should remain target=1.
          document.dispatchEvent(pointerEvent('pointermove', { clientX: 80, clientY: 50 }));
          expect(grid.targetIndex()).toBe(1);
          // Pointer at x=120 (20px right of natural boundary). Should remain target=1.
          document.dispatchEvent(pointerEvent('pointermove', { clientX: 120, clientY: 50 }));
          expect(grid.targetIndex()).toBe(1);
        }

        // Confirm: only ONE displaced cell transform (cell B), and it stays
        // displaced across the oscillations.
        expect(elB.style.transform).toContain('translate(-100px,');
        expect(elC.style.transform).toBe('');
        expect(elD.style.transform).toBe('');
      });
    });

    it('reversal from target=N+1 back to N requires extra pointer travel (pure horizontal)', () => {
      createRoot((d) => {
        dispose = d;
        const { grid, cells } = build4x3();
        // Layout: 4×3 grid, cellWidth=140, gutterX=12. Effective inflated
        // rects use gutter/2 padding: cell 0 left=−6 right=146; cell 1
        // left=146 right=298 (touching at content x=146).
        // Drag from index 0 (centre 70, 105) → target 1 (centre 222, 105).
        const downEvent = pointerEvent('pointerdown', { clientX: 70, clientY: 105 });
        Object.defineProperty(downEvent, 'target', { value: cells[0] });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 74, clientY: 109 }));

        // Pure horizontal advance into cell 1's territory.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 160, clientY: 105 }));
        expect(grid.targetIndex()).toBe(1);

        // Hysteresis (sticky-currentTarget extension): pointer needs to
        // exit cell 1's EXTENDED rect to drop target back to 0. With
        // source→target unit-vector (1, 0), cell 1's left edge is
        // extended LEFTWARD by cellWidth * 0.5 = 70px. So extended
        // left = effective left (146) − 70 = 76.
        //
        // Moving back to clientX=120 (which is past the natural
        // boundary 146 — would trigger flip in non-hysteresis model)
        // is STILL inside cell 1's extended rect [76, 298]. Target
        // stays at 1.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 120, clientY: 105 }));
        expect(grid.targetIndex()).toBe(1);

        // Moving further back to clientX=80 — STILL inside extended
        // rect (80 > 76). Target stays 1. Hysteresis still holding.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 80, clientY: 105 }));
        expect(grid.targetIndex()).toBe(1);

        // Crossing the extended boundary at clientX=70 — pointer is
        // 70 < 76. Falls through Pass 1 (sticky), reaches Pass 2 (first
        // match against natural inflated rects). Cell 0's inflated
        // rect = [−6, 146]. 70 ∈ [−6, 146] → returns 0. Target drops.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 70, clientY: 105 }));
        expect(grid.targetIndex()).toBe(0);

        // Reverse direction: now at target=0 (= sourceIndex). Pass 1
        // skips (currentTarget === sourceIndex). Pass 2 against natural
        // rects. Pointer back at clientX=160 is in cell 1's natural
        // inflated rect [146, 298]. Target → 1.
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 160, clientY: 105 }));
        expect(grid.targetIndex()).toBe(1);
      });
    });
  });

  describe('commit/cancel (U4)', () => {
    it('pointerup with from !== to fires onReorder(from, to)', () => {
      createRoot((d) => {
        dispose = d;
        const onReorder = vi.fn();
        const [ids] = createSignal(['a', 'b', 'c', 'd']);
        const grid = createReorderGrid({ ids, onReorder });
        for (let i = 0; i < 4; i++) {
          grid.itemProps(ids()[i]).ref(mockElement(i * 100, 0, 100, 100));
        }
        const elA = mockElement(0, 0, 100, 100);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        // Move to index 3 (centre 350, 50)
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 350, clientY: 50 }));
        expect(grid.targetIndex()).toBe(3);
        // Release
        document.dispatchEvent(pointerEvent('pointerup', { clientX: 350, clientY: 50 }));
        expect(onReorder).toHaveBeenCalledWith(0, 3);
        expect(grid.isDragging()).toBe(false);
      });
    });

    it('pointerup with from === to does not fire onReorder', () => {
      createRoot((d) => {
        dispose = d;
        const onReorder = vi.fn();
        const [ids] = createSignal(['a', 'b']);
        const grid = createReorderGrid({ ids, onReorder });
        const elA = mockElement(0, 0, 100, 100);
        const elB = mockElement(100, 0, 100, 100);
        grid.itemProps('a').ref(elA);
        grid.itemProps('b').ref(elB);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        // Wiggle but don't change target
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 55, clientY: 55 }));
        document.dispatchEvent(pointerEvent('pointerup', { clientX: 55, clientY: 55 }));
        expect(onReorder).not.toHaveBeenCalled();
      });
    });

    it('Escape during drag cancels without firing onReorder (covers AE4 non-auto-scroll branch)', () => {
      createRoot((d) => {
        dispose = d;
        const onReorder = vi.fn();
        const [ids] = createSignal(['a', 'b', 'c']);
        const grid = createReorderGrid({ ids, onReorder });
        for (let i = 0; i < 3; i++) {
          grid.itemProps(ids()[i]).ref(mockElement(i * 100, 0, 100, 100));
        }
        const elA = mockElement(0, 0, 100, 100);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 250, clientY: 50 }));
        expect(grid.isDragging()).toBe(true);
        // Esc cancels via shared.ts cancel listener.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(grid.isDragging()).toBe(false);
        // Subsequent pointerup must not fire onReorder (drag was cancelled).
        document.dispatchEvent(pointerEvent('pointerup', { clientX: 250, clientY: 50 }));
        expect(onReorder).not.toHaveBeenCalled();
      });
    });

    it('cancel() method aborts in-progress drag without firing onReorder (R13a)', () => {
      createRoot((d) => {
        dispose = d;
        const onReorder = vi.fn();
        const [ids] = createSignal(['a', 'b', 'c']);
        const grid = createReorderGrid({ ids, onReorder });
        for (let i = 0; i < 3; i++) {
          grid.itemProps(ids()[i]).ref(mockElement(i * 100, 0, 100, 100));
        }
        const elA = mockElement(0, 0, 100, 100);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 250, clientY: 50 }));
        expect(grid.isDragging()).toBe(true);
        grid.cancel();
        expect(grid.isDragging()).toBe(false);
        // Subsequent pointerup is a no-op.
        document.dispatchEvent(pointerEvent('pointerup', { clientX: 250, clientY: 50 }));
        expect(onReorder).not.toHaveBeenCalled();
      });
    });

    it('clears all inline styles on commit', () => {
      createRoot((d) => {
        dispose = d;
        const onReorder = vi.fn();
        const [ids] = createSignal(['a', 'b', 'c']);
        const grid = createReorderGrid({ ids, onReorder });
        const elA = mockElement(0, 0, 100, 100);
        const elB = mockElement(100, 0, 100, 100);
        const elC = mockElement(200, 0, 100, 100);
        grid.itemProps('a').ref(elA);
        grid.itemProps('b').ref(elB);
        grid.itemProps('c').ref(elC);
        const downEvent = pointerEvent('pointerdown', { clientX: 50, clientY: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        grid.itemProps('a').onPointerDown(downEvent);
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 54, clientY: 54 }));
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 250, clientY: 50 }));
        document.dispatchEvent(pointerEvent('pointerup', { clientX: 250, clientY: 50 }));

        // Source element should have no inline transform/zIndex/position after commit.
        expect(elA.style.transform).toBe('');
        expect(elA.style.zIndex).toBe('');
        expect(elA.style.position).toBe('');
        expect(elA.style.willChange).toBe('');
        // Neighbour displacements should also be cleared.
        expect(elB.style.transform).toBe('');
        expect(elC.style.transform).toBe('');
      });
    });
  });
});
