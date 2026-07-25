import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The embeddable bundle.
 *
 * Builds `src/embed.jsx` into a single self-contained `dist/widget.js` that any
 * site can load with one <script> tag. IIFE rather than ESM on purpose: a plain
 * classic script keeps `document.currentScript` available, which is how the
 * data-* attributes are read, and it works on pages with no build step at all.
 *
 * React is bundled in, so a client installs nothing. `emptyOutDir: false` lets
 * this run *after* the site build without wiping it.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/embed.jsx',
      name: 'SupportWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
});
