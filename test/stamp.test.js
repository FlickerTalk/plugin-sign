// Writing the signature into the PDF with pdf-lib (plugin plan §6): the picture and the text go
// on the page and in the place asked for, upright as the page is shown (also turned a quarter);
// the other pages do not change; a second signature goes on the result of the first and both
// stay; a locked, broken or digitally signed PDF is told apart before anything is written.
// What lands where is read back with pdf.js, the way the viewer will paint it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { openDocument } from "../src/render.js";
import { inspect, signedName, stamp, toBase64 } from "../src/stamp.js";

const fixture = (name) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

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
async function shown(bytes, number) {
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

const inside = (thing, box) =>
  (thing.u0 ?? thing.u) >= box.u - 1e-6 &&
  (thing.u1 ?? thing.u) <= box.u + box.w + 1e-6 &&
  (thing.v0 ?? thing.v) >= box.v - 1e-6 &&
  (thing.v1 ?? thing.v) <= box.v + box.h + 1e-6;

const NAME = "Ana Pérez";
const DATE = "Oct 2, 2026, 12:03 PM UTC (phone clock)";

describe("before signing", () => {
  it("tells a PDF that can be signed, how many pages it has and whether it carries a digital signature", async () => {
    expect(await inspect(fixture("two-pages.pdf"))).toEqual({ state: "ready", pages: 2, sealed: false });
    expect(await inspect(fixture("signed.pdf"))).toEqual({ state: "ready", pages: 1, sealed: true });
    // An empty signature field is not a signature.
    expect(await inspect(fixture("field.pdf"))).toEqual({ state: "ready", pages: 1, sealed: false });
  });

  it("says a password-protected PDF is locked and a file that is not one is broken", async () => {
    expect(await inspect(fixture("locked.pdf"))).toMatchObject({ state: "locked" });
    expect(await inspect(fixture("broken.pdf"))).toMatchObject({ state: "broken" });
    expect(await inspect(new Uint8Array())).toMatchObject({ state: "broken" });
  });
});

describe("a signature", () => {
  const box = { u: 0.1, v: 0.55, w: 0.6, h: 0.25 };

  it("puts the picture and the text on the page and in the place asked for, upright", async () => {
    const signed = await stamp(fixture("two-pages.pdf"), { page: 1, box, signature: png(60, 20), lines: [{ text: NAME }, { text: DATE }] });
    const page = await shown(signed, 2);
    expect(page.images).toHaveLength(1);
    expect(inside(page.images[0], box)).toBe(true);
    expect(page.images[0].upright).toBe(true);
    // The picture keeps its shape: 60 × 20 px, three times as wide as tall on a page of 300 × 400.
    const { u0, u1, v0, v1 } = page.images[0];
    expect(((u1 - u0) * 300) / ((v1 - v0) * 400)).toBeCloseTo(3, 1);
    const written = page.text.filter((item) => inside(item, box));
    expect(written.map((item) => item.str)).toEqual([NAME, DATE]);
    for (const item of written) expect(item.upright).toBe(true);
    expect(written[0].v).toBeLessThan(written[1].v);
    // Below the picture.
    expect(written[0].v).toBeGreaterThan(v1);
    expect(page.text.map((item) => item.str)).toContain("Page two");
  });

  it("leaves the other pages as they were", async () => {
    const original = fixture("two-pages.pdf");
    const signed = await stamp(original, { page: 1, box, signature: png(60, 20), lines: [{ text: DATE }] });
    const before = await (await (await openDocument(original)).getPage(1)).getOperatorList();
    const after = await (await (await openDocument(signed)).getPage(1)).getOperatorList();
    expect(after.fnArray).toEqual(before.fnArray);
    // pdf.js names a loaded font after the document it opened (`g_d1_f1`, `g_d2_f1`): not a change.
    const same = (list) => JSON.stringify(list.argsArray).replace(/g_d\d+_/g, "g_d_");
    expect(same(after)).toBe(same(before));
    expect((await shown(signed, 1)).images).toHaveLength(0);
  });

  it("stands upright on a page turned a quarter, where the tap was", async () => {
    // Away from the page's own "Turned", which pdf.js shows near the top right.
    const turned = { u: 0.05, v: 0.55, w: 0.4, h: 0.3 };
    const signed = await stamp(fixture("rotated.pdf"), { page: 0, box: turned, signature: png(60, 20), lines: [{ text: NAME }, { text: DATE }] });
    const page = await shown(signed, 1);
    expect(page.images).toHaveLength(1);
    expect(inside(page.images[0], turned)).toBe(true);
    expect(page.images[0].upright).toBe(true);
    const written = page.text.filter((item) => inside(item, turned));
    expect(written.map((item) => item.str)).toEqual([NAME, DATE]);
    for (const item of written) expect(item.upright).toBe(true);
  });

  it("writes a line the PDF's font cannot spell as the picture the phone drew of it", async () => {
    const signed = await stamp(fixture("two-pages.pdf"), {
      page: 0,
      box,
      signature: png(60, 20),
      lines: [{ text: "Анна Петрова", png: png(80, 12) }, { text: DATE }],
    });
    const page = await shown(signed, 1);
    expect(page.images).toHaveLength(2);
    for (const image of page.images) expect(inside(image, box)).toBe(true);
    expect(page.text.filter((item) => inside(item, box)).map((item) => item.str)).toEqual([DATE]);
    await expect(stamp(fixture("two-pages.pdf"), { page: 0, box, signature: png(60, 20), lines: [{ text: "Анна" }] })).rejects.toThrow();
  });

  it("goes on the PDF someone else already signed here, and both signatures stay", async () => {
    const first = await stamp(fixture("two-pages.pdf"), { page: 1, box, signature: png(60, 20), lines: [{ text: "Ana" }, { text: DATE }] });
    const other = { u: 0.3, v: 0.05, w: 0.5, h: 0.2 };
    const second = await stamp(first, { page: 1, box: other, signature: png(50, 25), lines: [{ text: "Luis" }, { text: DATE }] });
    const page = await shown(second, 2);
    expect(page.images).toHaveLength(2);
    expect(page.images.filter((image) => inside(image, box))).toHaveLength(1);
    expect(page.images.filter((image) => inside(image, other))).toHaveLength(1);
    expect(page.text.filter((item) => inside(item, box)).map((item) => item.str)).toEqual(["Ana", DATE]);
    expect(page.text.filter((item) => inside(item, other)).map((item) => item.str)).toEqual(["Luis", DATE]);
    expect(await inspect(second)).toEqual({ state: "ready", pages: 2, sealed: false });
  });

  it("does not sign itself as pdf-lib in the document's information", async () => {
    const signed = await stamp(fixture("two-pages.pdf"), { page: 0, box, signature: png(60, 20), lines: [{ text: DATE }] });
    const document = await PDFDocument.load(signed, { updateMetadata: false });
    expect(document.getProducer() ?? "").not.toMatch(/pdf-lib/i);
    expect(document.getCreator() ?? "").not.toMatch(/pdf-lib/i);
  });

  it("refuses a locked PDF, a broken one and a page that is not there", async () => {
    const asked = { page: 0, box, signature: png(60, 20), lines: [{ text: DATE }] };
    await expect(stamp(fixture("locked.pdf"), asked)).rejects.toThrow();
    await expect(stamp(fixture("broken.pdf"), asked)).rejects.toThrow();
    await expect(stamp(fixture("two-pages.pdf"), { ...asked, page: 5 })).rejects.toThrow();
  });
});

describe("the signed file", () => {
  it("is called after the original, once, without any path", () => {
    expect(signedName("contract.pdf")).toBe("contract-signed.pdf");
    expect(signedName("Contract.PDF")).toBe("Contract-signed.pdf");
    expect(signedName("contract-signed.pdf")).toBe("contract-signed.pdf");
    expect(signedName("../../etc/lease.pdf")).toBe("lease-signed.pdf");
    expect(signedName("C:\\Users\\me\\lease.pdf")).toBe("lease-signed.pdf");
    expect(signedName("notes")).toBe("notes-signed.pdf");
    expect(signedName("")).toBe("document-signed.pdf");
    expect(signedName(null)).toBe("document-signed.pdf");
    expect(signedName(".pdf")).toBe("document-signed.pdf");
  });

  it("travels as base64, in pieces small enough for a big PDF", () => {
    const bytes = new Uint8Array(300_001).map((_, at) => (at * 31) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(toBase64(new Uint8Array())).toBe("");
  });
});
