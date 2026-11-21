import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The client bundles the framework-independent Rules Engine from its TypeScript source,
// so development and tests never depend on a stale `dist/` build of a workspace package.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kadat/rules-engine': source('../../packages/rules-engine/src/index.ts'),
      '@kadat/contracts': source('../../packages/contracts/src/index.ts'),
    },
  },
  server: { host: '127.0.0.1' },
});
