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
});
