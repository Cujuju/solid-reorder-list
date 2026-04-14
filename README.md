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

## Compatibility

- **SolidJS** >= 1.8.0
- **Browser** — any browser with Pointer Events (all modern browsers, IE 11+ with polyfill)
- **Touch** — works on touch devices (Pointer Events abstract over mouse/touch/pen)
- **SSR** — safe to import server-side (no DOM access at module level), but the primitive itself requires a DOM to function

## TypeScript

The package exports full type declarations. Key exports:

```ts
import { createReorderList } from '@cujuju/solid-reorder-list';
import type { ReorderListOptions } from '@cujuju/solid-reorder-list';
```

For typing a prop that receives the return value:

```ts
import { createReorderList } from '@cujuju/solid-reorder-list';

interface MyProps {
  reorder: ReturnType<typeof createReorderList>;
}
```

## License

MIT
