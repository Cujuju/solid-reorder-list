# @cujuju/solid-reorder-list

Drag-to-reorder primitive for [SolidJS](https://www.solidjs.com/). Handles variable-height items, single-axis movement, and smooth CSS transition reflow. Zero dependencies beyond `solid-js`.

## Features

- Vertical or horizontal reordering
- Variable-height/width items (no fixed-size assumption)
- Smooth animated displacement of non-dragged items
- Distance-based activation (won't trigger on accidental clicks)
- Automatic interactive-element exclusion (buttons, inputs, links)
- Post-drag click blocking (prevents click events from firing after drop)
- Cancel via Escape, right-click, or window blur
- Multiple independent instances on the same page
- Works inside or outside SolidJS component trees
- TypeScript with full type exports

## Install

```sh
# From GitHub
npm install github:Cujuju/solid-reorder-list
```

## Quick Start

```tsx
import { createSignal, For } from 'solid-js';
import { createReorderList } from '@cujuju/solid-reorder-list';
import '@cujuju/solid-reorder-list/css';

function SortableList() {
  const [items, setItems] = createSignal(['Apple', 'Banana', 'Cherry']);

  const reorder = createReorderList({
    ids: items,
    onReorder(from, to) {
      const next = [...items()];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setItems(next);
    },
  });

  return (
    <div>
      <For each={items()}>
        {(item) => <div {...reorder.itemProps(item)}>{item}</div>}
      </For>
    </div>
  );
}
```

### What's happening here

1. `ids` is a reactive accessor returning the current order of string IDs. The primitive reads it on every pointerdown to get the latest list.
2. `onReorder(from, to)` fires on drop with the **original indices** (the positions in the array at drag start, not the visual positions). You splice your own array — the primitive never mutates your data.
3. `itemProps(id)` returns an object you spread onto each item element. It wires up the ref, pointer handlers, active class, and data attribute. Every item in the `<For>` must spread this.

## Options

```ts
interface ReorderListOptions {
  ids: () => string[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  axis?: 'x' | 'y';
  activateDistance?: number;
  transitionMs?: number;
  activeClass?: string;
  dragScale?: number;
  stopPropagation?: boolean;
  skipSelector?: string;
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `ids` | `() => string[]` | **required** | Reactive accessor returning the current list of IDs in order. Called on each pointerdown to snapshot the list. Each ID must be unique and must match what you pass to `itemProps(id)`. |
| `onReorder` | `(from: number, to: number) => void` | **required** | Called on successful drop when the item moved to a different position. `from` is the original index, `to` is the target index. Not called if the item is dropped back in its original position. |
| `axis` | `'x' \| 'y'` | `'y'` | Drag axis. `'y'` for vertical lists, `'x'` for horizontal lists. Controls which pointer coordinate is tracked and which CSS transform is applied (`translateY` vs `translateX`). |
| `activateDistance` | `number` | `5` | Pixels the pointer must move before drag activates. Prevents accidental drags from normal click jitter (typically 1-3px). Set higher for touch interfaces, lower for precision use. |
| `transitionMs` | `number` | `200` | Duration in milliseconds for the CSS transition on displaced (non-dragged) items. Controls how fast neighbors "pop" into their new positions when the dragged item passes them. |
| `activeClass` | `string` | `'reorder-active'` | CSS class added to the dragged item's element via `classList`. Use this for visual feedback (box-shadow, outline, background, etc.). The default CSS file styles this class. |
| `dragScale` | `number` | `0.97` | Scale factor applied to the dragged item via CSS `scale()` transform. Creates a subtle "lift" effect. Set to `1.0` to disable the scale effect entirely. |
| `stopPropagation` | `boolean` | `true` | Whether to call `e.stopPropagation()` on the pointerdown event. Set to `false` when you have nested reorder lists or need pointer events to bubble to a parent handler. |
| `skipSelector` | `string` | `'button, input, a, [role="button"]'` | CSS selector matched via `closest()` from the pointerdown target. When matched, drag activation is skipped — guards interactive children from accidental drags. Override when the draggable item itself has interactive semantics (e.g. a `<div role="button">` that IS the draggable). Set to an empty string to disable the skip entirely. The default is also exported as `DEFAULT_SKIP_SELECTOR` for composition: `skipSelector: DEFAULT_SKIP_SELECTOR + ', [data-no-drag]'`. |

## API

`createReorderList(options)` returns an object with the following properties:

### `itemProps(id: string)`

Returns an object to spread onto each reorderable element:

```ts
{
  ref: (el: HTMLElement) => void,       // Registers the DOM element
  onPointerDown: (e: PointerEvent) => void, // Starts the drag sequence
  classList: { [activeClass]: boolean },     // Reactive — true when this item is being dragged
  'data-reorder-id': string,                // The item's ID as a data attribute
}
```

Spread it directly onto the element:

```tsx
<div {...reorder.itemProps(item.id)}>...</div>
```

**Important:** The `ref` callback registers the element so the primitive can measure its position and apply transforms. If you also need your own ref, chain them:

```tsx
<div
  {...reorder.itemProps(item.id)}
  ref={(el) => {
    reorder.itemProps(item.id).ref(el); // Register with reorder
    myRef = el;                          // Your own ref
  }}
>
```

### `isActive(id: string): boolean`

Returns `true` if the given item is the one currently being dragged. Reactive — re-evaluates when drag starts/ends.

```tsx
<div
  {...reorder.itemProps(item.id)}
  style={{ opacity: reorder.isActive(item.id) ? 0.5 : 1 }}
>
```

### `isDragging(): boolean`

Returns `true` if any item is currently being dragged. Useful for hiding tooltips, disabling hover effects, or showing a drop zone overlay.

```tsx
<Show when={reorder.isDragging()}>
  <div class="drop-zone-overlay" />
</Show>
```

### `activeId(): string | null`

The ID of the item currently being dragged, or `null`. This is the reactive signal behind `isActive()` — use it when you need the raw value rather than a per-item check.

### `targetIndex(): number`

The index where the dragged item would be inserted if dropped right now. Returns `-1` when not dragging. Use this to render a drop indicator line:

```tsx
<For each={items()}>
  {(item, i) => (
    <>
      <Show when={reorder.targetIndex() === i() && !reorder.isActive(item)}>
        <div class="drop-indicator" />
      </Show>
      <div {...reorder.itemProps(item)}>{item}</div>
    </>
  )}
</For>
```

### `dispose(): void`

Manually tears down the primitive's internal reactive root and clears all registered elements. **You only need this if you create the primitive outside a SolidJS reactive owner** (outside a component, in a test, in imperative setup code). Inside a component, cleanup is automatic via SolidJS `onCleanup`.

```ts
// Outside a component
const reorder = createReorderList({ ids, onReorder });
// ... use it ...
reorder.dispose(); // Clean up when done
```

## CSS

### Default styles (opt-in)

```ts
import '@cujuju/solid-reorder-list/css';
```

This imports two rules:

```css
/* Box shadow and grab cursor on the dragged item */
.reorder-active {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  cursor: grabbing;
}

/* Disable text selection on all reorderable items */
[data-reorder-id] {
  user-select: none;
}
```

### Custom styles

Skip the CSS import and style the `activeClass` yourself:

```ts
const reorder = createReorderList({
  ids,
  onReorder,
  activeClass: 'my-dragging',
});
```

```css
.my-dragging {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  outline: 2px solid blue;
}

/* REQUIRED when skipping the default CSS — see "Browser defaults"
   section below. Without this, mousedown over text inside an item
   starts a text selection that competes with the drag. */
[data-reorder-id] {
  user-select: none;
  -webkit-user-select: none;
}
```

### Inline styles managed by the primitive

During a drag, the primitive sets these inline styles directly on elements. **Do not override these properties** on reorderable items with `!important` or inline styles, as the primitive needs to control them:

| Property | On dragged item | On displaced items | Cleared on drop |
|---|---|---|---|
| `transform` | `translateY/X(delta) scale(dragScale)` | `translateY/X(shift)` or `''` | Yes |
| `transition` | `none` | `transform {transitionMs}ms ease` | Yes |
| `z-index` | `50` | unchanged | Yes |
| `position` | `relative` | unchanged | Yes |
| `will-change` | `transform` | `transform` | Yes |
| `pointer-events` | unchanged | `none` | Yes |

The primitive also sets `document.body.style.cursor = 'grabbing'` during drag and clears it on drop.

### The `data-reorder-id` attribute

Every item gets `data-reorder-id="{id}"` via `itemProps`. This is useful for:

- The `[data-reorder-id] { user-select: none }` CSS rule (included in default CSS)
- Debugging (inspect which element maps to which ID)
- Custom CSS selectors targeting all reorderable items

## Browser defaults to suppress

This library uses Pointer Events, which (unlike HTML5 `draggable=true`) leave native browser behaviors intact. Two defaults can interfere with smooth reorder UX. Both are fixable consumer-side, and forgetting either produces visible bugs.

### Text selection during pointerdown

Without `user-select: none`, mousedown over text inside a reorderable item starts a text selection that competes with the drag — visible as the drag failing to activate cleanly while the text gets highlighted under the cursor.

The default CSS (`import '@cujuju/solid-reorder-list/css'`) handles this with a `[data-reorder-id] { user-select: none }` rule. **If you skip the default CSS** and roll your own visual style, replicate the rule yourself — see the snippet in [Custom styles](#custom-styles).

### Natively-draggable inner elements

`<img>` and `<a href>` elements default to `draggable=true` in browsers. When the user mousedowns on one inside a reorderable item, the browser starts its own HTML5 drag-image operation simultaneously with this library's pointer-event drag. Visible symptoms:

- "No-drop" cursor (⊘) appears immediately on mousedown
- The dragged item ends up offset from the cursor once the library's own drag activates at `activateDistance`
- A ghost image of the inner element follows the cursor independently

This bites hardest when the inner element occupies most of the reorderable item's surface (e.g., a tab whose entire visible area is a cover image).

Disable native drag on those elements:

```tsx
<img src={...} alt="" draggable={false} />
<a href={...} draggable={false}>{label}</a>
```

This applies whether you use the default CSS or roll your own — the default CSS doesn't help here because there's no CSS-only way to disable the `draggable` attribute on every nested element. The fix has to be on the elements themselves.

## Patterns and Recipes

### Horizontal list

```tsx
const reorder = createReorderList({
  ids: columns,
  onReorder: handleReorder,
  axis: 'x',
});

return (
  <div style={{ display: 'flex' }}>
    <For each={columns()}>
      {(col) => <div {...reorder.itemProps(col)}>{col}</div>}
    </For>
  </div>
);
```

### Conditional reorder (enable/disable)

Guard the spread so items are only draggable when reorder is enabled:

```tsx
const reorder = props.canReorder
  ? createReorderList({ ids, onReorder })
  : undefined;

// In JSX:
<div {...(reorder?.itemProps(item.id) ?? { 'data-reorder-id': item.id })}>
```

### Items with buttons, inputs, or links

The primitive automatically skips drag activation when the pointer target is (or is inside) a `button`, `input`, `a`, or `[role="button"]` element. Clicks on these elements work normally without triggering a drag. No configuration needed.

### Hiding tooltips during drag

Use `isDragging()` to suppress tooltips or hover popups that would interfere with the drag:

```tsx
<Show when={!reorder.isDragging()}>
  <Tooltip target={el}>{tooltipContent}</Tooltip>
</Show>
```

### Multiple reorder lists on one page

Each `createReorderList` instance is fully independent. You can have several on the same page (e.g., a sidebar list and a column config flyout). They don't interfere with each other as long as each item's ID is unique within its own list.

### Nested reorder lists

If you have a reorder list inside another reorder list (e.g., groups containing cards), set `stopPropagation: false` on the inner list so pointer events can reach the outer list when needed:

```tsx
const innerReorder = createReorderList({
  ids: cardIds,
  onReorder: handleCardReorder,
  stopPropagation: false, // Let events bubble to outer list
});
```

### Draggable items with interactive root semantics

The default skip selector matches `[role="button"]` so accidental drags on focusable children are avoided. If your draggable item's *root* element itself uses `role="button"` (or `<button>`, `<a>`, `<input>`), the default selector causes drag to never activate at all. Override `skipSelector` to allow drag on the root while still guarding child controls:

```tsx
import { createReorderList, DEFAULT_SKIP_SELECTOR } from '@cujuju/solid-reorder-list';

const reorder = createReorderList({
  ids,
  onReorder,
  // Allow drag on the [role="button"] root, but still skip on children
  // marked with data-no-drag (e.g. a close-X span inside the tab).
  skipSelector: 'input, a, [data-no-drag]',
});

<div role="button" {...reorder.itemProps(id)}>
  <span>{label}</span>
  <span data-no-drag onClick={onClose}>×</span>
</div>
```

Pass an empty string to disable the skip entirely (use with care — accidental drags on form controls become possible).

### Persisting order to a server

`onReorder` gives you indices. After splicing, persist the new order:

```tsx
onReorder(from, to) {
  const next = [...items()];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  setItems(next);

  // Persist — fire and forget, or queue a retry
  fetch('/api/reorder', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  }).catch(console.error);
},
```

### Using with SolidJS `<For>`

The `<For>` component is the natural fit since it keys on reference identity and won't re-create DOM nodes when the array order changes. **Don't use `<Index>`** — it keys on position, which means every item re-renders on reorder.

```tsx
// Good — keyed by item identity
<For each={items()}>
  {(item) => <div {...reorder.itemProps(item.id)}>...</div>}
</For>

// Bad — keyed by index, causes unnecessary re-renders
<Index each={items()}>
  {(item, i) => <div {...reorder.itemProps(item().id)}>...</div>}
</Index>
```

## How It Works

### Drag lifecycle

1. **Pointerdown** — Registers `pointermove` and `pointerup` listeners on `document`. Does not activate the drag yet.
2. **Activation** — When pointer movement exceeds `activateDistance` pixels, the drag activates: all item rects are measured and cached, the dragged item gets a scale transform, non-dragged items get displacement transitions enabled.
3. **Dragging** — On each `pointermove`, the dragged item follows the pointer via `requestAnimationFrame`-batched transforms. The edge-overlap algorithm determines the current target position and displaces neighbors.
4. **Drop** — On `pointerup`, the final position is committed. If `from !== to`, `onReorder` fires. All inline styles are cleared. A one-shot click blocker prevents the pointerup from triggering a click on the dropped element.
5. **Cancel** — Escape key, right-click, or window blur cancel the drag without firing `onReorder`. All styles revert.

### Edge-overlap collision model

Unlike center-based collision (where a swap triggers when the dragged item's center passes a neighbor's center), this primitive uses **edge overlap with split thresholds**:

- **Forward movement** (dragging down/right): swap triggers when the dragged item's leading edge overlaps 40% of the next item. This feels responsive — you don't have to drag far.
- **Reverse movement** (dragging back up/left): swap triggers at 70% overlap. This makes it easy to undo an accidental swap without re-triggering it.

After each swap, effective positions shift by half the dragged item's size, creating a dead zone that prevents jittery rapid swapping at threshold boundaries.

### SolidJS reactivity isolation

The primitive's internal signals (`activeId`, `targetIndex`) live in an isolated `createRoot` scope. This prevents a known issue where SolidJS's reactive graph cleanup can dispose signals owned by a parent scope during drag, killing the drag mid-flight. The isolated root is disposed automatically via `onCleanup` (inside a component) or manually via `dispose()` (outside a component).

## Grid mode (`createReorderGrid`)

For 2-D auto-flow grids — responsive `repeat(auto-fill, minmax(N, 1fr))` layouts where displacement crosses row-wrap diagonals — use the sibling primitive `createReorderGrid`. Same spread-`itemProps` shape as `createReorderList`, with snapshot-based hit-test instead of edge-overlap collision.

```tsx
import { createSignal, For } from 'solid-js';
import { createReorderGrid } from '@cujuju/solid-reorder-list';
import '@cujuju/solid-reorder-list/css';

function PinnedGrid() {
  const [items, setItems] = createSignal(['a', 'b', 'c', 'd', 'e', 'f']);
  let panelRef: HTMLDivElement | undefined;

  const grid = createReorderGrid({
    ids: items,
    onReorder(from, to) {
      const next = [...items()];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setItems(next);
    },
    scrollContainer: () => panelRef ?? null,
  });

  return (
    <div ref={panelRef} style={{ 'overflow-y': 'auto', 'max-height': '80vh' }}>
      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
        <For each={items()}>
          {(item) => <div {...grid.itemProps(item)}>{item}</div>}
        </For>
      </div>
    </div>
  );
}
```

### Options (`ReorderGridOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `ids` | `() => string[]` | **required** | Reactive accessor returning the current flat (row-major) order of IDs. |
| `onReorder` | `(from: number, to: number) => void` | **required** | Called on drop with original and target indices. Not called when `from === to`. |
| `activateDistance` | `number` | `5` | Pixels of pointer movement (Euclidean `Math.hypot(dx, dy)`) before drag activates. |
| `transitionMs` | `number` | `200` | CSS transition duration on displaced items. |
| `activeClass` | `string` | `'reorder-active'` | CSS class added to the dragged item. |
| `dragScale` | `number` | `0.97` | Scale factor for the dragged item's lift. |
| `stopPropagation` | `boolean` | `true` | Whether to call `e.stopPropagation()` on pointerdown. |
| `skipSelector` | `string` | `DEFAULT_SKIP_SELECTOR` | CSS selector matched via `closest()` from the pointerdown target. When matched, drag activation is skipped. |
| `scrollContainer` | `() => HTMLElement \| Window \| null` | — | Reactive accessor returning the scroll container. Snapshot rects are stored in container-content coords (`clientX + container.scrollLeft`); manual scrolls during drag are compensated on each `pointermove`. |

### Public return shape

Mirrors `createReorderList` plus `cancel()`:

```ts
{
  itemProps(id: string): { ref, onPointerDown, classList, 'data-reorder-id' };
  isActive(id: string): boolean;
  isDragging(): boolean;
  activeId(): string | null;
  targetIndex(): number;        // -1 when not dragging
  cancel(): void;               // abort in-progress drag without firing onReorder; idempotent
  dispose(): void;
}
```

### Coordinate frame

`createReorderGrid` operates in **container-content coords** = `clientX + scrollContainer.scrollLeft` (mirror y). When `scrollContainer` is omitted (or returns `null`), it falls back to `window.scrollX/Y` and the frame becomes true page coords.

This is **not** `pageX/pageY` directly. For Portal'd panels with `position: fixed`, window scroll does not compose into the frame — the container's scroll offset is the only meaningful frame.

### Scope assumptions (read before adopting)

- **Uniform cell width and height.** Auto-fill grids with `minmax(140px, 1fr)` qualify; masonry, mixed-size cards, or stretchy items don't. Dev-mode emits `console.warn` when cells differ in size beyond `cellHeight × 0.05`.
- **Non-dense flow.** `grid-auto-flow: dense` is out of scope.
- **LTR direction.** RTL grids are not handled.
- **Cell-height-relative tolerance.** Same-row tolerance is `cellHeight × 0.1`. If your `gutterY < cellHeight × 0.1` (very compact layouts), column-count inference may misfire — dev-mode cross-validation invariant emits `console.warn` when violated.
- **No `cols` option.** Column count is inferred from the snapshot.
- **No mid-drag layout-change tracking.** If the window resizes, the panel resizes, the theme switches, or the scroll container's `clientWidth` otherwise changes during a drag, the snapshot becomes stale. Consumers can wire a `ResizeObserver` on the container that calls `gridReorder.cancel()` to invalidate the snapshot when this matters.
- **No cross-instance concurrent drag protection.** Each `createReorderList` / `createReorderGrid` instance guards its own drag state; nothing prevents two instances activating simultaneously on multi-touch devices. Pre-existing in 1-D, inherited.
- **No virtualised lists.** All registered items must be present in the DOM at activate.
- **`touch-action` is the consumer's responsibility.** Apply `touch-action: none` to registered grid cells (matched via `[data-reorder-id]`) so Pointer Events drive the drag instead of the browser scrolling.

### Auto-scroll deferred to v0.3.1

v0.3.0 ships scroll-aware hit-test (R7 — manual scrolls during drag compensate correctly) but **no auto-scroll** when the pointer enters the container's edge zone. Auto-scroll is tracked as `R8`/`R9` and lands in v0.3.1 once a consumer demonstrates the panel routinely overflows AND users routinely drag to off-screen targets.

### How it differs from `createReorderList`

| Aspect | 1-D | 2-D grid |
|---|---|---|
| Collision model | Edge-overlap (40% forward, 70% reverse) | Inflated-rect tessellation, point-in-rect |
| Activation threshold | `Math.abs(dx)` on the chosen axis | `Math.hypot(dx, dy)` Euclidean |
| Anti-jitter | Per-displaced-cell halfShift on `effectiveStarts` | Per-target-pair half-cell on `effectiveRects[prev/next]` |
| Hit-test | Walk forward/backward overlap counts | Tessellation lookup with nearest-cell fallback |
| Coordinate frame | Viewport (no scroll compensation) | Container-content (R7 manual scroll compensation) |
| Public surface | Standard | Standard + `cancel()` (R13a) |

## Compatibility

- **SolidJS** >= 1.8.0
- **Browser** — any browser with Pointer Events (all modern browsers, IE 11+ with polyfill)
- **Touch** — works on touch devices (Pointer Events abstract over mouse/touch/pen)
- **SSR** — safe to import server-side (no DOM access at module level), but the primitive itself requires a DOM to function

## TypeScript

The package exports full type declarations. Key exports:

```ts
import { createReorderList, createReorderGrid } from '@cujuju/solid-reorder-list';
import type { ReorderListOptions, ReorderGridOptions } from '@cujuju/solid-reorder-list';
```

For typing a prop that receives the return value:

```ts
import { createReorderList, createReorderGrid } from '@cujuju/solid-reorder-list';

interface MyProps {
  reorder: ReturnType<typeof createReorderList>;
  grid: ReturnType<typeof createReorderGrid>;
}
```

## License

MIT
