export type WindowRect = { left: number; top: number; width: number; height: number };
export function resizeAI(
  r: WindowRect,
  edge: string,
  dx: number,
  dy: number,
  vw: number,
  vh: number,
) {
  const minW = Math.min(360, vw - 16),
    minH = Math.min(420, vh - 16);
  let left = r.left,
    top = r.top,
    right = r.left + r.width,
    bottom = r.top + r.height;
  if (edge.includes('w')) left = Math.max(8, Math.min(right - minW, left + dx));
  if (edge.includes('e')) right = Math.min(vw - 8, Math.max(left + minW, right + dx));
  if (edge.includes('n')) top = Math.max(8, Math.min(bottom - minH, top + dy));
  if (edge.includes('s')) bottom = Math.min(vh - 8, Math.max(top + minH, bottom + dy));
  return { left, top, width: right - left, height: bottom - top };
}
