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
  const policyPath = path.resolve(__dirname, 'runtime-profile.json');
  const policy = JSON.parse(fs.readFileSync(policyPath));
  if (manifest.profile !== policy.profile || manifest.policySha256 !== (await digest(policyPath)))
    throw new Error('Runtime profile is stale; rebuild the slim offline bundle.');
  const size = fs.statSync(path.join(runtime, 'texlive.zip')).size;
  if (size > policy.resourceBudgetBytes || size !== manifest.resourceBytes)
    throw new Error('Runtime exceeds size budget or does not match its manifest.');
  if (manifest.offline !== true) throw new Error('Runtime must support offline compilation.');
  for (const [name, expected] of [
    [process.platform === 'win32' ? 'tectonic.exe' : 'tectonic', manifest.binarySha256],
    ['texlive.zip', manifest.bundleSha256],
    ['inventory.json', manifest.inventorySha256],
  ]) {
    if ((await digest(path.join(runtime, name))) !== expected)
      throw new Error(`Runtime checksum mismatch: ${name}`);
  }
  const inventory = JSON.parse(fs.readFileSync(path.join(runtime, 'inventory.json')));
  if (Object.keys(inventory).length !== manifest.resourceCount)
    throw new Error('Runtime inventory count does not match its manifest.');
  for (const name of [...policy.requiredFiles, 'ctexopts.cfg', 'SHA256SUM']) {
    if (!inventory[name]) throw new Error(`Required offline resource missing: ${name}`);
  }
  console.log(
    `Verified ${manifest.profile}: ${(size / 1e6).toFixed(1)} MB, ${manifest.resourceCount} offline resources.`,
  );
})().catch((error) => {
  console.error('Run pnpm runtime:prepare before packaging.', error.message);
  process.exitCode = 1;
});
