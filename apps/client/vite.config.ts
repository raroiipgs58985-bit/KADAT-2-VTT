import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The character generator (apps/generator) is a static app. It is served under /generator/ on
// the same address as the VTT, so its «В KADAT VTT» button reaches the VTT library through the
// browser storage they share. Only its runtime files are published.
const GENERATOR = resolve(source('../generator'));
const GENERATOR_FILES = ['index.html', 'src', 'styles', 'assets'];
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
function characterGenerator(): Plugin {
  let outDir = 'dist';
  return {
    name: 'kadat-character-generator',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!;
        if (!url.startsWith('/generator')) return next();
        const rel = decodeURIComponent(url.slice('/generator'.length)).replace(/^\/?/, '');
        const file = normalize(join(GENERATOR, rel || 'index.html'));
        const top = rel.split('/')[0] || 'index.html';
        if (
          !file.startsWith(GENERATOR) ||
          !GENERATOR_FILES.includes(top) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        )
          return next();
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      for (const f of GENERATOR_FILES)
        if (existsSync(join(GENERATOR, f)))
          cpSync(join(GENERATOR, f), join(outDir, 'generator', f), { recursive: true });
    },
  };
}

// The client bundles the framework-independent Rules Engine from its TypeScript source,
// so development and tests never depend on a stale `dist/` build of a workspace package.
export default defineConfig({
  plugins: [react(), characterGenerator()],
  resolve: {
    alias: {
      '@kadat/rules-engine': source('../../packages/rules-engine/src/index.ts'),
      '@kadat/contracts': source('../../packages/contracts/src/index.ts'),
    },
  },
  server: { host: '127.0.0.1' },
  // UI Kit graphics (WebP, ≤ 81 KiB each) go inline into the stylesheet, so panels and keys are
  // drawn on the first paint instead of flashing the plain fallback look while images load.
  build: { assetsInlineLimit: 96 * 1024 },
});
