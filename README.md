# @cujuju/solid-reorder-list

Drag-to-reorder primitive for [SolidJS](https://www.solidjs.com/). Handles variable-height items, single-axis movement, and smooth CSS transition reflow. Zero dependencies beyond `solid-js`.

## Install

```sh
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

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `ids` | `() => string[]` | *required* | Reactive list of IDs in current order |
| `onReorder` | `(from: number, to: number) => void` | *required* | Called on drop with original and target indices |
| `axis` | `'x' \| 'y'` | `'y'` | Drag axis |
| `activateDistance` | `number` | `5` | Pixels of movement before drag activates |
| `transitionMs` | `number` | `200` | Duration of displacement transition in ms |
| `activeClass` | `string` | `'reorder-active'` | CSS class applied to the dragged item |
| `dragScale` | `number` | `0.97` | Scale factor for the dragged item (1.0 = no scale) |
| `stopPropagation` | `boolean` | `true` | Whether to call `stopPropagation` on pointerdown |

## API

`createReorderList(options)` returns:

| Property | Type | Description |
|---|---|---|
| `itemProps(id)` | `(id: string) => object` | Spread onto each reorderable element |
| `isActive(id)` | `(id: string) => boolean` | Whether the given item is being dragged |
| `isDragging()` | `() => boolean` | Whether any item is being dragged |
| `activeId()` | `() => string \| null` | ID of the item being dragged |
| `targetIndex()` | `() => number` | Current drop target index (-1 if not dragging) |
| `dispose()` | `() => void` | Manually clean up (only needed outside a SolidJS owner) |

## CSS

Import the default styles:

```ts
import '@cujuju/solid-reorder-list/css';
```

This adds a box-shadow and grab cursor to the active item, and disables text selection on reorderable items. You can skip this import and provide your own styles via the `activeClass` option.

The primitive sets inline `transform`, `transition`, `z-index`, `position`, `will-change`, and `pointer-events` during drag — don't override these on reorderable items.

## How It Works

Uses an edge-overlap collision model with split thresholds (40% forward, 70% reverse) for stable movement with easy reversal. Positions are cached at drag start. Displaced items animate via CSS transitions. The dragged item follows the pointer via `requestAnimationFrame`-batched transforms.

Interactive children (`button`, `input`, `a`, `[role="button"]`) are excluded from drag activation. Drag cancels on Escape, blur, or right-click.

## License

MIT
