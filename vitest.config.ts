import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Use SolidJS browser build, not server build — server build stubs
    // createSignal/createRoot as no-ops which breaks reactive tests.
    alias: {
      'solid-js': 'solid-js/dist/solid.js',
    },
  },
});
