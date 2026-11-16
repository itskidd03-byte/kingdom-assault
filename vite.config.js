import { defineConfig } from 'vite';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Emits dist/sw.js listing every built file, so the installed app can start
 * offline (including all 3D models). The cache name changes with each build.
 */
function offlineServiceWorker() {
  return {
    name: 'kingdom-assault-offline',
    apply: 'build',
    closeBundle() {
      const outDir = 'dist';
      if (!existsSync(outDir)) return;
      const files = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (name !== 'sw.js') files.push('./' + relative(outDir, path).split('\\').join('/'));
        }
      };
      walk(outDir);

      const version = Date.now().toString(36);
      const source = `/* generated at build time */
const CACHE = 'kingdom-assault-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const fallback = await cache.match('./index.html', { ignoreSearch: true });
      if (fallback && request.mode === 'navigate') return fallback;
      throw error;
    }
  })());
});
`;
      writeFileSync(join(outDir, 'sw.js'), source);
      console.log(`  offline cache: ${files.length} files`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineServiceWorker()],
  // The preview hostname is provided per-run by the environment, never hard-coded.
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: false,
    allowedHosts: process.env.KA_ALLOWED_HOST ? [process.env.KA_ALLOWED_HOST] : undefined,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
