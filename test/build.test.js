// What the catalogue signs (`module.json` + `dist/`), as `npm run build` leaves it: the bundle,
// the standard fonts it may carry, the notices of everything inside; under 5 MB (plugin plan
// §6); with no address in it that could be asked for; and no copyleft font.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixture } from "./helpers.js";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = () => walk(DIST);
const text = (path) => readFileSync(path, "latin1");

/**
 * The `http://` that may stay, each with why it is never asked for. Nothing else may, and no
 * `https://` at all: the build rewrites those (see `build.js`).
 */
const ALLOWED_HTTP = [
  // XML namespaces pdf.js names when it reads XFA forms and XMP: names, not places.
  /^http:\/\/www\.w3\.org\//,
  /^http:\/\/ns\.adobe\.com\//,
  /^http:\/\/www\.xfa\.org\//,
  // pdf.js makes "http://www.example.org" of a link written "www.example.org" inside a PDF
  // (`http://${…}`). This plugin draws no links and follows none; the frame has no network.
  /^http:\/\/\$\{/,
  // pdf.js checks that a link is a URL against a base it never asks for (`createValidAbsoluteUrl`).
  /^http:\/\/example\.com$/,
];

/** In the notices only: the Apache License's own header, reproduced as the licence asks. A text
 *  file the plugin never loads. */
const NOTICES_HTTP = [/^http:\/\/www\.apache\.org\/licenses\/$/];

describe("the package", () => {
  it("holds the bundle, the permissive standard fonts and the notices", () => {
    const names = files().map((path) => relative(DIST, path));
    expect(names).toContain("index.js");
    expect(names).toContain("THIRD_PARTY_NOTICES.md");
    const fonts = names.filter((name) => name.startsWith("fonts/"));
    expect(fonts.length).toBe(10);
    for (const font of fonts) expect(font).toMatch(/^fonts\/Foxit[A-Za-z]+pfb\.js$/);
  });

  it("carries no font under a copyleft licence", () => {
    expect(files().filter((path) => /Liberation/i.test(relative(DIST, path)))).toEqual([]);
  });

  it("stays under 5 MB", () => {
    const total = files().reduce((sum, path) => sum + statSync(path).size, 0);
    expect(total).toBeGreaterThan(1_000_000);
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });

  it("has no https:// address, and no http:// but the namespaces and templates listed", () => {
    for (const path of files()) {
      const content = text(path);
      expect(content.match(/https:\/\/[^\s"'`)]*/g) ?? [], relative(DIST, path)).toEqual([]);
      const plain = content.match(/http:\/\/[^\s"'`)]*/g) ?? [];
      const allowed = relative(DIST, path) === "THIRD_PARTY_NOTICES.md" ? [...ALLOWED_HTTP, ...NOTICES_HTTP] : ALLOWED_HTTP;
      const strange = plain.filter((address) => !allowed.some((one) => one.test(address)));
      expect(strange, relative(DIST, path)).toEqual([]);
    }
  });

  it("ships the notices of everything inside, the same as the repository's", () => {
    const notices = readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(readFileSync(join(DIST, "THIRD_PARTY_NOTICES.md"), "utf8")).toBe(notices);
    for (const part of ["pdf.js", "Apache License", "pdf-lib", "@pdf-lib/standard-fonts", "@pdf-lib/upng", "pako", "tslib", "signature_pad", "core-js", "PDFium"]) {
      expect(notices, part).toContain(part);
    }
  });
});

describe("the URL checks the build rewrites", () => {
  // core-js asks the WebView's URL these questions to decide whether to replace it; the build
  // asks them with wss:// instead of https://. Both are special schemes with a host, parsed by
  // the same rules, so the answers do not change.
  const answers = (scheme) => {
    const url = new URL("b?a=1&b=2&c=3", `${scheme}://a`);
    url.pathname = "c%20d";
    return [
      url.href.replace(`${scheme}:`, ""),
      new URL(`${scheme}://a@b`).username,
      new URL(`${scheme}://тест`).host,
      new URL(`${scheme}://a#б`).hash,
      new URL(`${scheme}://x`, undefined).host,
      new URL("x/y.pdf", `${scheme}://foo.bar`).pathname,
    ];
  };

  it("get the same answers with wss:// as with https://", () => {
    expect(answers("wss")).toEqual(answers("https"));
  });
});

describe("the built bundle", () => {
  it("defines ft-sign and opens a PDF, rewrites and all", async () => {
    const handlers = [];
    globalThis.ft = { onOpen: (handler) => handlers.push(handler), close: vi.fn(), send: vi.fn(), save: vi.fn(), pickFile: vi.fn() };
    await import("../dist/index.js");
    expect(customElements.get("ft-sign")).toBeDefined();
    const element = document.createElement("ft-sign");
    document.body.append(element);
    const file = { name: "a.pdf", mime: "application/pdf", data: Buffer.from(fixture("two-pages.pdf")).toString("base64") };
    await Promise.all(handlers.map((handler) => handler({ lang: "en", dark: false, file })));
    for (let at = 0; at < 40; at += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.shadowRoot.querySelectorAll(".sheet")).toHaveLength(2);
  });
});
