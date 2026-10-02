// What the tests share: the fixtures, a real PNG like the pad makes, and what a page shows once
// pdf.js paints it, read back as fractions of the page as shown.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { openDocument } from "../src/render.js";

export const fixture = (name) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

/** A real PNG of `width` × `height`, dark blue ink on nothing, as the signature pad makes. */
export function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rows.set([20, 40, 140, 255], y * (width * 4 + 1) + 1 + x * 4);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array(Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}

const multiply = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = ([x, y], m) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** What a page shows, read back by pdf.js: the pictures and the text, in fractions of the page as
 *  shown (`u` across, `v` down), and whether each one stands upright. */
export async function shown(bytes, number) {
  const page = await (await openDocument(bytes)).getPage(number);
  const viewport = page.getViewport({ scale: 1 });
  const at = (point) => {
    const [x, y] = viewport.convertToViewportPoint(...point);
    return [x / viewport.width, y / viewport.height];
  };
  const list = await page.getOperatorList();
  const images = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  list.fnArray.forEach((fn, index) => {
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === pdfjs.OPS.transform) ctm = multiply([...list.argsArray[index]], ctm);
    else if (fn === pdfjs.OPS.paintImageXObject) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map((corner) => at(apply(corner, ctm)));
      const [origin, right, up] = corners;
      images.push({
        u0: Math.min(...corners.map((c) => c[0])),
        u1: Math.max(...corners.map((c) => c[0])),
        v0: Math.min(...corners.map((c) => c[1])),
        v1: Math.max(...corners.map((c) => c[1])),
        // Upright: the picture's x runs right on the screen and its y runs up.
        upright: right[0] - origin[0] > 0 && Math.abs(right[1] - origin[1]) < 1e-6 && up[1] - origin[1] < 0 && Math.abs(up[0] - origin[0]) < 1e-6,
      });
    }
  });
  const text = (await page.getTextContent()).items
    .filter((item) => item.str.trim())
    .map((item) => {
      const [a, b, , , e, f] = item.transform;
      const [u, v] = at([e, f]);
      const [u2, v2] = at([e + a, f + b]);
      return { str: item.str, u, v, upright: u2 - u > 0 && Math.abs(v2 - v) < 1e-6 };
    });
  return { images, text, operators: list.fnArray.length };
}

export const inside = (thing, box) =>
  (thing.u0 ?? thing.u) >= box.u - 1e-6 &&
  (thing.u1 ?? thing.u) <= box.u + box.w + 1e-6 &&
  (thing.v0 ?? thing.v) >= box.v - 1e-6 &&
  (thing.v1 ?? thing.v) <= box.v + box.h + 1e-6;

