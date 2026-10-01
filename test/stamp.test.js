// Writing the signature into the PDF with pdf-lib (plugin plan §6): the picture and the text go
// on the page and in the place asked for, upright as the page is shown (also turned a quarter);
// the other pages do not change; a second signature goes on the result of the first and both
// stay; a locked, broken or digitally signed PDF is told apart before anything is written.
// What lands where is read back with pdf.js, the way the viewer will paint it.
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { openDocument } from "../src/render.js";
import { inspect, signedName, stamp, toBase64 } from "../src/stamp.js";
import { fixture, inside, png, shown } from "./helpers.js";

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
