import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { createReorderGrid, createReorderList } from '../src/index';

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

function pointer(type: string, clientY: number, pointerType = 'touch') {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY, button: 0, pointerId: 1, pointerType });
}

function mockElement(top: number, height: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({
    top, left: 0, bottom: top + height, right: 100,
    height, width: 100, x: 0, y: top, toJSON: () => {},
  });
  return el;
}

const engines = {
  list: createReorderList,
  grid: createReorderGrid,
} as const;

for (const [name, create] of Object.entries(engines)) {
  describe(`${name}: touchHoldMs`, () => {
    let dispose: () => void;
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
      dispose?.();
      vi.useRealTimers();
      document.body.style.cursor = '';
    });

    /** Three stacked 50px items; presses item 'a' with the given pointer type. */
    function setup(options: { touchHoldMs?: number; touchHoldTolerance?: number } = { touchHoldMs: 1000 }) {
      const onReorder = vi.fn();
      let reorder!: ReturnType<typeof createReorderList>;
      createRoot((d) => {
        dispose = d;
        const [ids] = createSignal(['a', 'b', 'c']);
        reorder = create({ ids, onReorder, ...options });
      });
      const el = mockElement(0, 50);
      reorder.itemProps('a').ref(el);
      reorder.itemProps('b').ref(mockElement(50, 50));
      reorder.itemProps('c').ref(mockElement(100, 50));
      const press = (pointerType = 'touch') => {
        const down = pointer('pointerdown', 25, pointerType);
        Object.defineProperty(down, 'target', { value: el });
        reorder.itemProps('a').onPointerDown(down);
      };
      return { reorder, onReorder, press };
    }
    const move = (y: number, type = 'touch') => document.dispatchEvent(pointer('pointermove', y, type));
    const up = (y: number, type = 'touch') => document.dispatchEvent(pointer('pointerup', y, type));

    it('a touch that moves before the hold is up never drags', () => {
      const { reorder, onReorder, press } = setup();
      press();
      move(60);
      vi.advanceTimersByTime(1500);
      expect(reorder.armedId()).toBeNull();
      move(110);
      expect(reorder.isDragging()).toBe(false);
      up(110);
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('a touch held still arms the item, then drags and reorders', () => {
      const { reorder, onReorder, press } = setup();
      press();
      move(28); // within the tolerance
      vi.advanceTimersByTime(999);
      expect(reorder.armedId()).toBeNull();
      move(31);
      expect(reorder.isDragging()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(reorder.armedId()).toBe('a');
      expect(reorder.itemProps('a').classList['reorder-armed']).toBe(true);
      move(31);
      expect(reorder.isDragging()).toBe(true);
      expect(reorder.armedId()).toBeNull();
      move(110);
      up(110);
      expect(onReorder).toHaveBeenCalledWith(0, expect.any(Number));
      expect(onReorder.mock.calls[0][1]).toBeGreaterThan(0);
    });

    it('lifting during the hold gives the press up', () => {
      const { reorder, press } = setup();
      press();
      up(25);
      vi.advanceTimersByTime(1500);
      expect(reorder.armedId()).toBeNull();
      move(110);
      expect(reorder.isDragging()).toBe(false);
    });

    it('lifting after the hold clears the armed item', () => {
      const { reorder, press } = setup();
      press();
      vi.advanceTimersByTime(1000);
      expect(reorder.armedId()).toBe('a');
      up(25);
      expect(reorder.armedId()).toBeNull();
    });

    it('pointercancel during a drag cancels it without reordering', () => {
      const { reorder, onReorder, press } = setup();
      press();
      vi.advanceTimersByTime(1000);
      move(31);
      move(110);
      expect(reorder.isDragging()).toBe(true);
      document.dispatchEvent(pointer('pointercancel', 110));
      expect(reorder.isDragging()).toBe(false);
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('swallows the long-press menu while a touch is down', () => {
      const { press } = setup();
      press();
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(true);
      up(25);
      const later = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(later);
      expect(later.defaultPrevented).toBe(false);
    });

    it('a mouse drags at once', () => {
      const { reorder, press } = setup();
      press('mouse');
      move(31, 'mouse');
      expect(reorder.isDragging()).toBe(true);
      up(31, 'mouse');
    });

    it('holds a touch for 200ms by default', () => {
      const { reorder, press } = setup({});
      press();
      vi.advanceTimersByTime(199);
      move(31);
      expect(reorder.isDragging()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(reorder.armedId()).toBe('a');
      move(31);
      expect(reorder.isDragging()).toBe(true);
      up(31);
    });

    it('touch drags at once when touchHoldMs is 0', () => {
      const { reorder, press } = setup({ touchHoldMs: 0 });
      press();
      move(31);
      expect(reorder.isDragging()).toBe(true);
      up(31);
    });

    it('respects a custom touchHoldTolerance', () => {
      const { reorder, press } = setup({ touchHoldMs: 1000, touchHoldTolerance: 2 });
      press();
      move(28);
      vi.advanceTimersByTime(1000);
      expect(reorder.armedId()).toBeNull();
    });

    it('dispose during a hold stops the timer', () => {
      const { reorder, press } = setup();
      press();
      reorder.dispose();
      vi.advanceTimersByTime(1500);
      expect(reorder.armedId()).toBeNull();
    });
  });
}
