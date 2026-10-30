const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
function* contentChunks(file) {
  if (!file.binary) {
    yield Buffer.from(file.content, 'utf8');
    return;
  }
  for (let i = 0; i < file.content.length; i += 262144)
    yield Buffer.from(file.content.slice(i, i + 262144), 'base64');
}
function contentDigest(file) {
  const hash = createHash('sha256');
  for (const chunk of contentChunks(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function diskDigest(file) {
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return hash.digest('hex');
}
async function writeContent(file, source) {
  await fs.writeFile(file, contentChunks(source), { flag: 'wx' });
}
module.exports = { contentChunks, contentDigest, diskDigest, writeContent };
