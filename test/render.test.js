// Painting the pages with pdf.js as the PDF viewer plugin does (plugin-pdf-viewer, same
// configuration): from the bytes, in this thread, without worker, eval, fetch or wasm, the
// standard fonts from the package; and the arithmetic that keeps a long PDF within a phone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANVAS_PIXELS, PackagedData, failureOf, fitScale, fromBase64, nearPages, openDocument, ratioFor } from "../src/render.js";

const fixture = (name) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

describe("the document", () => {
  it("opens from its bytes, in this thread, with its pages and their text", async () => {
    const document = await openDocument(fixture("two-pages.pdf"));
    expect(document.numPages).toBe(2);
    const page = await document.getPage(2);
    expect(page.getViewport({ scale: 1 })).toMatchObject({ width: 300, height: 400 });
    const text = await page.getTextContent();
    expect(text.items.map((item) => item.str).join("")).toContain("Page two");
  });

  it("knows a page turned a quarter, and its box", async () => {
    const page = await (await openDocument(fixture("rotated.pdf"))).getPage(1);
    expect(page.rotate).toBe(90);
    expect(page.view).toEqual([50, 100, 350, 500]);
    expect(page.getViewport({ scale: 1 })).toMatchObject({ width: 400, height: 300 });
  });

  it("says a document is locked or broken", async () => {
    await expect(openDocument(fixture("locked.pdf"))).rejects.toMatchObject({ name: "PasswordException" });
    await expect(openDocument(fixture("broken.pdf"))).rejects.toMatchObject({ name: "InvalidPDFException" });
    expect(failureOf({ name: "PasswordException" })).toBe("locked");
    expect(failureOf(new Error("Invalid PDF structure"))).toBe("broken");
    expect(failureOf(null)).toBe("broken");
  });

  it("does not keep the caller's bytes: they are still whole after opening", async () => {
    const bytes = fixture("two-pages.pdf");
    await openDocument(bytes);
    expect(bytes.byteLength).toBe(readFileSync(join(import.meta.dirname, "fixtures", "two-pages.pdf")).byteLength);
  });

  it("serves the standard fonts from the package, never from a URL", async () => {
    const data = new PackagedData();
    await expect(data.fetch({ kind: "cMapUrl", filename: "x" })).rejects.toThrow(/not packaged/);
    // Liberation Sans is GPL (with a font exception): it is not in the package, and pdf.js is not
    // even sent to look for it; Helvetica falls back to the phone's sans-serif.
    await expect(data.fetch({ kind: "standardFontDataUrl", filename: "LiberationSans-Regular.ttf" })).rejects.toThrow(/not packaged/);
    expect(fromBase64("AQID")).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("the arithmetic of the pages", () => {
  it("fits a page to the width and keeps a canvas within its budget", () => {
    expect(fitScale(300, 360)).toBeCloseTo(1.2);
    expect(fitScale(0, 360)).toBe(1);
    expect(ratioFor(300, 400, 3)).toBe(3);
    expect(ratioFor(4000, 4000, 3)).toBeCloseTo(Math.sqrt(CANVAS_PIXELS / 16_000_000));
  });

  it("paints only the pages near the screen", () => {
    const tops = [0, 1000, 2000, 3000, 4000];
    const heights = [1000, 1000, 1000, 1000, 1000];
    expect(nearPages(0, 800, tops, heights)).toEqual([0, 1, 2]);
    expect(nearPages(4200, 800, tops, heights)).toEqual([2, 3, 4]);
  });
});
