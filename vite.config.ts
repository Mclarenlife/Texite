import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// PDF.js needs local CMaps to decode embedded Chinese fonts while offline.
const require = createRequire(import.meta.url);
const pdfjs = path.dirname(require.resolve('pdfjs-dist/package.json'));
function pdfResources() {
  const assets = new Map<string, Buffer>();
  for (const folder of ['cmaps', 'standard_fonts']) {
    for (const name of fs.readdirSync(path.join(pdfjs, folder))) {
      assets.set(`pdfjs/${folder}/${name}`, fs.readFileSync(path.join(pdfjs, folder, name)));
    }
  }
  return {
    name: 'local-pdf-resources',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const resource = assets.get((request.url || '').split('?')[0].replace(/^\//, ''));
        if (!resource) return next();
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(resource);
      });
    },
    generateBundle(this: {
      emitFile: (file: { type: 'asset'; fileName: string; source: Buffer }) => void;
    }) {
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    pdfResources(),
    ...(['android', 'ios'].includes(mode)
      ? [
          {
            name: 'android-offline-assets',
            configureServer(server: import('vite').ViteDevServer) {
              server.middlewares.use((request, response, next) => {
                const name = (request.url || '').split('?')[0];
                if (!name.startsWith('/android-tex/')) return next();
                const root = path.resolve('.tools/android-runtime');
                const target = path.resolve(root, name.slice('/android-tex/'.length));
                if (
                  !target.startsWith(root + path.sep) ||
                  !fs.existsSync(target) ||
                  !fs.statSync(target).isFile()
                ) {
                  response.statusCode = 404;
                  response.end();
                  return;
                }
                response.setHeader(
                  'Content-Type',
                  target.endsWith('.wasm')
                    ? 'application/wasm'
                    : target.endsWith('.js')
                      ? 'text/javascript'
                      : target.endsWith('.json')
                        ? 'application/json'
                        : 'application/octet-stream',
                );
                fs.createReadStream(target).pipe(response);
              });
            },
            closeBundle() {
              if (!fs.existsSync('.tools/android-runtime/busytex.wasm'))
                throw new Error('Run android:runtime first.');
              const destination = mode === 'ios' ? 'dist-ios' : 'dist-mobile';
              fs.cpSync('.tools/android-runtime', destination + '/android-tex', { recursive: true });
              fs.copyFileSync(destination + '/android.html', destination + '/index.html');
            },
          },
        ]
      : []),
  ],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/.qa/**', '**/.tools/**', '**/runtime/**', '**/release/**'] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
    ...(['android', 'ios'].includes(mode)
      ? { outDir: mode === 'ios' ? 'dist-ios' : 'dist-mobile', rollupOptions: { input: 'android.html' } }
      : {}),
  },
}));
