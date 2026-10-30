const crypto = require('node:crypto');
// Preserve JSON.stringify byte-for-byte, including property order and surrogate pairs.
function* jsonChunks(value) {
  if (typeof value === 'string') {
    yield '"';
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + 65536, value.length);
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      yield JSON.stringify(value.slice(start, end)).slice(1, -1);
      start = end;
    }
    yield '"';
  } else if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i++) {
      if (i) yield ',';
      yield* jsonChunks(value[i]);
    }
    yield ']';
  } else if (value && typeof value === 'object') {
    yield '{';
    let first = true;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      if (!first) yield ',';
      first = false;
      yield JSON.stringify(key) + ':';
      yield* jsonChunks(item);
    }
    yield '}';
  } else yield JSON.stringify(value) ?? 'null';
}
function jsonHash(value) {
  const digest = crypto.createHash('sha256');
  for (const chunk of jsonChunks(value)) digest.update(chunk);
  return digest.digest('hex');
}
function jsonBytes(value, max = Infinity) {
  let bytes = 0;
  for (const chunk of jsonChunks(value)) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > max) throw new Error('项目同步数据超过 384 MB，请减少项目内容或 AI 历史记录。');
  }
  return bytes;
}
module.exports = { jsonChunks, jsonHash, jsonBytes };
