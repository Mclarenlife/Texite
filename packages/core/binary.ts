// Chunk sizes are multiples of three so Base64 chunks can be joined directly.
export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 12288)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 12288))));
  return chunks.join('');
}
export function base64ToBytes(content: string): Uint8Array<ArrayBuffer> {
  const size =
    Math.floor((content.length * 3) / 4) -
    (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < content.length; i += 16384) {
    const chunk = atob(content.slice(i, i + 16384));
    for (let j = 0; j < chunk.length; j++) bytes[offset++] = chunk.charCodeAt(j);
  }
  return bytes;
}
