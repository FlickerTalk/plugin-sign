// Where a tap lands on the PDF (plugin plan §6, "toque → coordenadas PDF con zoom y con
// /Rotate 90"): a tap is a fraction of the page as it is shown, whatever the zoom; the fraction
// becomes a point of the PDF through the page's box and its rotation, exactly as pdf.js draws it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDocument } from "../src/render.js";
import { displayedSize, fractionAt, moveBox, normalizeRotation, placeBox, pointInBox, resizeBox, stampLayout, toPdfPoint } from "../src/geometry.js";

const VIEW = [50, 100, 350, 500];

describe("the page as shown", () => {
  it("turns any /Rotate into a quarter the way pdf.js does", () => {
    expect([0, 90, 180, 270, 360, 450, -90, -180, 45, undefined, "x"].map(normalizeRotation)).toEqual([0, 90, 180, 270, 0, 90, 270, 180, 0, 0, 0]);
  });

  it("is as wide as the box, or as tall when turned a quarter", () => {
    expect(displayedSize(VIEW, 0)).toEqual({ width: 300, height: 400 });
    expect(displayedSize(VIEW, 90)).toEqual({ width: 400, height: 300 });
    expect(displayedSize(VIEW, 180)).toEqual({ width: 300, height: 400 });
    expect(displayedSize(VIEW, 270)).toEqual({ width: 400, height: 300 });
  });
});

describe("a tap", () => {
  it("is the same fraction of the page at any zoom and scroll", () => {
    // The same spot of a page: at fit (360 px wide) and at 2× (720 px wide, scrolled).
    const fit = fractionAt(100 + 90, 50 + 120, { left: 100, top: 50, width: 360, height: 480 });
    const zoomed = fractionAt(-300 + 180, -400 + 240, { left: -300, top: -400, width: 720, height: 960 });
    expect(fit.u).toBeCloseTo(0.25);
    expect(fit.v).toBeCloseTo(0.25);
    expect(zoomed.u).toBeCloseTo(fit.u);
    expect(zoomed.v).toBeCloseTo(fit.v);
  });

  it("stays on the page when it lands on its edge", () => {
    expect(fractionAt(0, 1000, { left: 10, top: 10, width: 100, height: 100 })).toEqual({ u: 0, v: 1 });
    expect(fractionAt(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ u: 0, v: 0 });
  });

  it("lands on the PDF point pdf.js shows there, for every rotation and zoom", async () => {
    // rotated.pdf has the box VIEW; pdf.js turns it as asked.
    const page = await (await openDocument(new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "rotated.pdf"))))).getPage(1);
    expect(page.view).toEqual(VIEW);
    for (const rotation of [0, 90, 180, 270]) {
      for (const scale of [1, 2.5]) {
        const viewport = page.getViewport({ scale, rotation });
        for (const [u, v] of [[0, 0], [1, 1], [0.25, 0.75], [0.9, 0.1]]) {
          const [x, y] = viewport.convertToPdfPoint(u * viewport.width, v * viewport.height);
          const [px, py] = toPdfPoint(u, v, VIEW, rotation);
          expect(px, `rotation ${rotation} scale ${scale} at ${u},${v}`).toBeCloseTo(x, 6);
          expect(py, `rotation ${rotation} scale ${scale} at ${u},${v}`).toBeCloseTo(y, 6);
        }
      }
    }
  });

  it("on a page turned a quarter, the top left of the screen is the box's bottom left", () => {
    expect(toPdfPoint(0, 0, VIEW, 90)).toEqual([50, 100]);
    expect(toPdfPoint(1, 0, VIEW, 90)).toEqual([50, 500]);
    expect(toPdfPoint(0, 1, VIEW, 90)).toEqual([350, 100]);
  });
});

describe("the signature's box", () => {
  const A4 = { width: 595, height: 842 };

  it("is centred on the tap, wide enough to sign, and inside the page", () => {
    const box = placeBox(0.5, 0.5, A4);
    expect(box.w * A4.width).toBeCloseTo(200);
    expect((box.w * A4.width) / (box.h * A4.height)).toBeCloseTo(2.4);
    expect(box.u + box.w / 2).toBeCloseTo(0.5);
    expect(box.v + box.h / 2).toBeCloseTo(0.5);
    const corner = placeBox(1, 1, A4);
    expect(corner.u + corner.w).toBeCloseTo(1);
    expect(corner.v + corner.h).toBeCloseTo(1);
    const small = placeBox(0.5, 0.5, { width: 120, height: 80 });
    expect(small.w).toBeLessThanOrEqual(1);
    expect(small.h).toBeLessThanOrEqual(1);
  });

  it("moves with the finger and never leaves the page", () => {
    const box = { u: 0.2, v: 0.2, w: 0.3, h: 0.1 };
    expect(moveBox(box, 0.1, 0.05)).toEqual({ u: 0.30000000000000004, v: 0.25, w: 0.3, h: 0.1 });
    expect(moveBox(box, 5, 5)).toEqual({ u: 0.7, v: 0.9, w: 0.3, h: 0.1 });
    expect(moveBox(box, -5, -5)).toEqual({ u: 0, v: 0, w: 0.3, h: 0.1 });
  });

  it("grows from its corner, no smaller than a signature and no further than the page", () => {
    const box = { u: 0.5, v: 0.5, w: 0.3, h: 0.1 };
    expect(resizeBox(box, 0.1, 0.05, A4)).toMatchObject({ u: 0.5, v: 0.5 });
    expect(resizeBox(box, 0.1, 0.05, A4).w).toBeCloseTo(0.4);
    expect(resizeBox(box, 1, 1, A4)).toEqual({ u: 0.5, v: 0.5, w: 0.5, h: 0.5 });
    const shrunk = resizeBox(box, -1, -1, A4);
    expect(shrunk.w * A4.width).toBeCloseTo(40);
    expect(shrunk.h * A4.height).toBeCloseTo(20);
  });

  it("holds the signature on top and a line of text below for the name and the date", () => {
    const one = stampLayout(200, 84, 1);
    const two = stampLayout(200, 84, 2);
    expect(two.lines).toHaveLength(2);
    expect(one.lines).toHaveLength(1);
    expect(two.size).toBeGreaterThanOrEqual(5);
    expect(two.size).toBeLessThanOrEqual(10);
    // The picture sits above the first line, inside the box.
    expect(two.image.y).toBeGreaterThanOrEqual(0);
    expect(two.image.y + two.image.height).toBeLessThanOrEqual(two.lines[0] - two.size + 0.001);
    expect(two.lines[1]).toBeGreaterThan(two.lines[0]);
    expect(two.lines[1]).toBeLessThanOrEqual(84);
    expect(one.image.height).toBeGreaterThan(two.image.height);
    expect(two.image.width).toBe(200);
  });

  it("puts a point of the box on the PDF through the page's box and rotation", () => {
    const box = { u: 0.25, v: 0.5, w: 0.5, h: 0.25 };
    const size = displayedSize(VIEW, 90); // 400 × 300 as shown
    expect(pointInBox(box, 0, 0, VIEW, 90)).toEqual(toPdfPoint(0.25, 0.5, VIEW, 90));
    const [x, y] = pointInBox(box, size.width * 0.5, size.height * 0.25, VIEW, 90);
    expect([x, y]).toEqual(toPdfPoint(0.75, 0.75, VIEW, 90));
  });
});
