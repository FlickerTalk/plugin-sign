// Where a tap lands on the PDF. A tap is a fraction of the page as it is shown (`u` across, `v`
// down, 0 to 1), so the zoom and the scroll never change it; a fraction becomes a point of the
// PDF through the page's box (`view`, [x0, y0, x1, y1], as pdf.js gives it) and its `/Rotate`,
// the same way pdf.js turns the page to paint it. The signature's box lives in fractions too.

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The smallest a signature's box may be, and how wide and tall it starts, in points. */
const MIN_WIDTH = 40;
const MIN_HEIGHT = 20;
const START_SHARE = 0.42;
const START_MIN = 100;
const START_MAX = 200;
const ASPECT = 2.4;

/** A page's `/Rotate` as pdf.js reads it: a quarter turn clockwise, 0 for anything else. */
export function normalizeRotation(rotate) {
  const turn = Number(rotate);
  if (!Number.isFinite(turn) || turn % 90 !== 0) return 0;
  return ((turn % 360) + 360) % 360;
}

/** The size of the page as it is shown, in points: turned a quarter, width and height swap. */
export function displayedSize(view, rotate) {
  const width = Math.abs(view[2] - view[0]);
  const height = Math.abs(view[3] - view[1]);
  const turned = normalizeRotation(rotate) % 180 !== 0;
  return turned ? { width: height, height: width } : { width, height };
}

/** Where a tap at `clientX`, `clientY` falls on a page drawn in `rect`, as fractions. */
export function fractionAt(clientX, clientY, rect) {
  const u = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const v = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return { u: clamp(u, 0, 1), v: clamp(v, 0, 1) };
}

/** The PDF point under the fraction `u`, `v` of the page as shown. */
export function toPdfPoint(u, v, view, rotate) {
  const [x0, y0, x1, y1] = [Math.min(view[0], view[2]), Math.min(view[1], view[3]), Math.max(view[0], view[2]), Math.max(view[1], view[3])];
  const width = x1 - x0;
  const height = y1 - y0;
  switch (normalizeRotation(rotate)) {
    case 90:
      return [x0 + v * width, y0 + u * height];
    case 180:
      return [x1 - u * width, y0 + v * height];
    case 270:
      return [x1 - v * width, y1 - u * height];
    default:
      return [x0 + u * width, y1 - v * height];
  }
}

/** The box a signature starts in: centred on the tap, wide enough to sign, inside the page.
 *  `size` is the page as shown, in points. */
export function placeBox(u, v, size) {
  const width = Math.min(size.width, clamp(size.width * START_SHARE, START_MIN, START_MAX));
  const height = Math.min(size.height, width / ASPECT);
  const w = width / size.width;
  const h = height / size.height;
  return { u: clamp(u - w / 2, 0, 1 - w), v: clamp(v - h / 2, 0, 1 - h), w, h };
}

/** The box moved by a fraction of the page, never off it. */
export function moveBox(box, du, dv) {
  return { u: clamp(box.u + du, 0, 1 - box.w), v: clamp(box.v + dv, 0, 1 - box.h), w: box.w, h: box.h };
}

/** The box grown or shrunk from its far corner: no smaller than a signature, no further than
 *  the page. */
export function resizeBox(box, du, dv, size) {
  const w = clamp(box.w + du, Math.min(MIN_WIDTH / size.width, 1 - box.u), 1 - box.u);
  const h = clamp(box.h + dv, Math.min(MIN_HEIGHT / size.height, 1 - box.v), 1 - box.v);
  return { u: box.u, v: box.v, w, h };
}

/**
 * How a box of `width` × `height` points is filled: the signature on top, then `count` lines of
 * text (the name, the date). From the box's top left, downwards; `lines` are the baselines.
 */
export function stampLayout(width, height, count) {
  const size = clamp(height * 0.12, 5, 10);
  const line = size * 1.25;
  const image = { x: 0, y: 0, width, height: Math.max(0, height - line * count) };
  const lines = [];
  for (let at = 0; at < count; at += 1) lines.push(image.height + at * line + size);
  return { size, image, lines };
}

/** The PDF point of a point of the box, given from the box's top left in points of the page as
 *  shown. */
export function pointInBox(box, x, y, view, rotate) {
  const size = displayedSize(view, rotate);
  return toPdfPoint(box.u + x / size.width, box.v + y / size.height, view, rotate);
}

/** The part of the pad that holds ink: the strokes' points (signature_pad's `toData()`), a
 *  `margin` around them for the pen's width, in whole pixels, inside `limits`; or nothing. */
export function strokeBounds(strokes, margin, limits) {
  const points = strokes.flatMap((stroke) => stroke.points ?? []);
  if (points.length === 0) return null;
  const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - margin));
  const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - margin));
  const right = Math.min(limits.width, Math.ceil(Math.max(...points.map((point) => point.x)) + margin));
  const bottom = Math.min(limits.height, Math.ceil(Math.max(...points.map((point) => point.y)) + margin));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
