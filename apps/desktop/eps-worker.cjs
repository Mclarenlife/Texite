// Only the pinned Ghostscript WASM module sees PostScript. Its MEMFS has no host
// filesystem, shell, or network bindings; the parent supplies one input image.
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const LIMITS = require('./project-limits.json');
(async () => {
  const wasmPath = require.resolve('@wasm-zoo/ghostscript/gs-core.wasm');
  const source = await fs.readFile(path.join(path.dirname(wasmPath), 'gs-core.js'), 'utf8');
  const context = vm.createContext({
    console: { log() {}, error() {} },
    TextDecoder,
    TextEncoder,
    URL,
    setTimeout,
    clearTimeout,
    performance,
  });
  vm.runInContext(source, context);
  let log = '';
  const print = (s) => {
    if (log.length < 32000) log += String(s) + '\n';
  };
  const gs = await context.createGhostscriptCore({
    wasmBinary: await fs.readFile(wasmPath),
    print,
    printErr: print,
  });
  gs.FS.writeFile('/input.eps', new Uint8Array(workerData));
  const code = gs.callMain([
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-dEPSCrop',
    '-dAutoRotatePages=/None',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-sOutputFile=/output.pdf',
    '/input.eps',
  ]);
  if (code !== 0) throw new Error(log || `Ghostscript 退出码 ${code}`);
  const bytes = gs.FS.readFile('/output.pdf');
  if (bytes.length > LIMITS.pdfBytes || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-')
    throw new Error('EPS 转换结果不是有效 PDF，或超过 128 MB。');
  parentPort.postMessage({ pdf: bytes, log });
})().catch((error) => parentPort.postMessage({ error: error.message }));
