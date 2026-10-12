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

export default defineConfig({
  plugins: [react(), pdfResources()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
