const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
(async () => {
  const runtime = path.resolve(__dirname, '../runtime');
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json')));
  for (const [name, expected] of [
    [process.platform === 'win32' ? 'tectonic.exe' : 'tectonic', manifest.binarySha256],
    ['texlive.zip', manifest.bundleSha256],
  ]) {
    if ((await digest(path.join(runtime, name))) !== expected)
      throw new Error(`Runtime checksum mismatch: ${name}`);
  }
  console.log('Verified complete offline compiler and TeX resource bundle.');
})().catch((error) => {
  console.error('Run pnpm runtime:prepare before packaging.', error.message);
  process.exitCode = 1;
});
