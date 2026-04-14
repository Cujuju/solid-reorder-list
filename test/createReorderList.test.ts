import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { createReorderList } from '../src/index';

// ── PointerEvent polyfill for jsdom ──────────────────────────────────────
// jsdom doesn't implement PointerEvent. Extend MouseEvent with pointerId.
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

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a PointerEvent with clientX/clientY */
function pointerEvent(type: string, opts: { clientX?: number; clientY?: number; button?: number } = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
}

/** Create mock elements with controllable getBoundingClientRect */
function mockElement(top: number, height: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({
    top, left: 0, bottom: top + height, right: 100,
    height, width: 100, x: 0, y: top, toJSON: () => {},
  });
  return el;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('createReorderList', () => {
  let dispose: () => void;

  afterEach(() => {
    dispose?.();
    // Clean up any lingering document listeners
    document.body.style.cursor = '';
  });

  describe('API shape', () => {
    it('returns the expected public API', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const reorder = createReorderList({ ids, onReorder: () => {} });

        // Public API surface
        expect(reorder).toHaveProperty('itemProps');
        expect(reorder).toHaveProperty('isActive');
        expect(reorder).toHaveProperty('isDragging');
        expect(reorder).toHaveProperty('activeId');
        expect(reorder).toHaveProperty('targetIndex');
        expect(reorder).toHaveProperty('dispose');

        expect(typeof reorder.itemProps).toBe('function');
        expect(typeof reorder.isActive).toBe('function');
        expect(typeof reorder.isDragging).toBe('function');
        expect(typeof reorder.activeId).toBe('function');
        expect(typeof reorder.targetIndex).toBe('function');
        expect(typeof reorder.dispose).toBe('function');
      });
    });

    it('itemProps returns ref, onPointerDown, classList, and data attribute', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const reorder = createReorderList({ ids, onReorder: () => {} });

        const props = reorder.itemProps('a');
        expect(props).toHaveProperty('ref');
        expect(props).toHaveProperty('onPointerDown');
        expect(props).toHaveProperty('classList');
        expect(props).toHaveProperty('data-reorder-id', 'a');
        expect(typeof props.ref).toBe('function');
        expect(typeof props.onPointerDown).toBe('function');
      });
    });
  });

  describe('reactive signals', () => {
    it('starts with isDragging false and activeId null', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const reorder = createReorderList({ ids, onReorder: () => {} });

        expect(reorder.isDragging()).toBe(false);
        expect(reorder.activeId()).toBeNull();
        expect(reorder.targetIndex()).toBe(-1);
      });
    });

    it('isActive returns false for all items when not dragging', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const reorder = createReorderList({ ids, onReorder: () => {} });

        expect(reorder.isActive('a')).toBe(false);
        expect(reorder.isActive('b')).toBe(false);
        expect(reorder.isActive('c')).toBe(false);
      });
    });
  });

  describe('options', () => {
    it('respects custom activeClass', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a']);
        const reorder = createReorderList({
          ids,
          onReorder: () => {},
          activeClass: 'my-dragging',
        });

        const props = reorder.itemProps('a');
        // classList should use the custom class name
        expect(props.classList).toHaveProperty('my-dragging');
      });
    });

    it('defaults activeClass to reorder-active', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a']);
        const reorder = createReorderList({ ids, onReorder: () => {} });

        const props = reorder.itemProps('a');
        expect(props.classList).toHaveProperty('reorder-active');
      });
    });
  });

  describe('dispose', () => {
    it('can be called outside a SolidJS owner scope', () => {
      // No createRoot wrapper — tests the getOwner() guard
      const [ids] = createSignal(['a', 'b']);
      const reorder = createReorderList({ ids, onReorder: () => {} });

      // Should not throw
      expect(() => reorder.dispose()).not.toThrow();
    });
  });

  describe('drag simulation', () => {
    it('fires onReorder after a complete drag sequence', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const onReorder = vi.fn();
        const reorder = createReorderList({
          ids,
          onReorder,
          activateDistance: 5,
        });

        // Register mock elements — 3 items, each 50px tall, stacked vertically
        const elA = mockElement(0, 50);
        const elB = mockElement(50, 50);
        const elC = mockElement(100, 50);

        reorder.itemProps('a').ref(elA);
        reorder.itemProps('b').ref(elB);
        reorder.itemProps('c').ref(elC);

        // Simulate pointerdown on item 'a'
        const downEvent = pointerEvent('pointerdown', { clientY: 25 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        reorder.itemProps('a').onPointerDown(downEvent);

        // Move past activation threshold (5px)
        document.dispatchEvent(pointerEvent('pointermove', { clientY: 31 }));

        // Drag should now be active
        expect(reorder.isDragging()).toBe(true);
        expect(reorder.activeId()).toBe('a');

        // Move far enough to swap past item 'b' (past 40% of 50px = 20px overlap)
        document.dispatchEvent(pointerEvent('pointermove', { clientY: 100 }));

        // Release
        document.dispatchEvent(pointerEvent('pointerup', { clientY: 100 }));

        // Should have called onReorder — item 'a' moved past at least one item
        expect(onReorder).toHaveBeenCalled();
        expect(reorder.isDragging()).toBe(false);
        expect(reorder.activeId()).toBeNull();
      });
    });

    it('does not fire onReorder when cancelled with Escape', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        const onReorder = vi.fn();
        const reorder = createReorderList({
          ids,
          onReorder,
          activateDistance: 5,
        });

        const elA = mockElement(0, 50);
        const elB = mockElement(50, 50);
        const elC = mockElement(100, 50);

        reorder.itemProps('a').ref(elA);
        reorder.itemProps('b').ref(elB);
        reorder.itemProps('c').ref(elC);

        // Start drag on 'a'
        const downEvent = pointerEvent('pointerdown', { clientY: 25 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        reorder.itemProps('a').onPointerDown(downEvent);

        // Activate
        document.dispatchEvent(pointerEvent('pointermove', { clientY: 31 }));
        expect(reorder.isDragging()).toBe(true);

        // Cancel with Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(reorder.isDragging()).toBe(false);
        expect(onReorder).not.toHaveBeenCalled();
      });
    });

    it('does not activate drag on interactive children', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const onReorder = vi.fn();
        const reorder = createReorderList({ ids, onReorder, activateDistance: 5 });

        const elA = mockElement(0, 50);
        reorder.itemProps('a').ref(elA);

        // Create a button inside the element
        const button = document.createElement('button');
        elA.appendChild(button);

        // Pointerdown targeting the button
        const downEvent = pointerEvent('pointerdown', { clientY: 25 });
        Object.defineProperty(downEvent, 'target', { value: button });
        reorder.itemProps('a').onPointerDown(downEvent);

        // Move past threshold
        document.dispatchEvent(pointerEvent('pointermove', { clientY: 31 }));

        // Should NOT have activated
        expect(reorder.isDragging()).toBe(false);
      });
    });

    it('does not activate on right-click', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const reorder = createReorderList({ ids, onReorder: () => {}, activateDistance: 5 });

        const elA = mockElement(0, 50);
        reorder.itemProps('a').ref(elA);

        // Right-click (button = 2)
        const downEvent = pointerEvent('pointerdown', { clientY: 25, button: 2 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        reorder.itemProps('a').onPointerDown(downEvent);

        document.dispatchEvent(pointerEvent('pointermove', { clientY: 31 }));
        expect(reorder.isDragging()).toBe(false);
      });
    });

    it('supports horizontal axis', () => {
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b']);
        const onReorder = vi.fn();
        const reorder = createReorderList({
          ids,
          onReorder,
          axis: 'x',
          activateDistance: 5,
        });

        // Horizontal layout: two 100px-wide items side by side
        const elA = document.createElement('div');
        elA.getBoundingClientRect = () => ({
          top: 0, left: 0, bottom: 50, right: 100,
          height: 50, width: 100, x: 0, y: 0, toJSON: () => {},
        });
        const elB = document.createElement('div');
        elB.getBoundingClientRect = () => ({
          top: 0, left: 100, bottom: 50, right: 200,
          height: 50, width: 100, x: 100, y: 0, toJSON: () => {},
        });

        reorder.itemProps('a').ref(elA);
        reorder.itemProps('b').ref(elB);

        // Drag horizontally
        const downEvent = pointerEvent('pointerdown', { clientX: 50 });
        Object.defineProperty(downEvent, 'target', { value: elA });
        reorder.itemProps('a').onPointerDown(downEvent);

        // Activate
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 56 }));
        expect(reorder.isDragging()).toBe(true);

        // Move past item B (past 40% of 100px = 40px overlap from start of B)
        document.dispatchEvent(pointerEvent('pointermove', { clientX: 200 }));

        // Release
        document.dispatchEvent(pointerEvent('pointerup', { clientX: 200 }));

        expect(onReorder).toHaveBeenCalledWith(0, 1);
      });
    });
  });
});
