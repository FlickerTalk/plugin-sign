// Painting the pages with pdf.js, configured as the PDF viewer plugin does it
// (`plugin-pdf-viewer`, `src/index.js`): the frame's policy stays as it is, so no worker (pdf.js
// works on the main thread), no eval, no fetch (the bytes come from the chat, the standard fonts
// from the package), no wasm.

// The legacy build carries the polyfills pdf.js needs on a WebView a year old (`Map.prototype.getOrInsertComputed`…).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as worker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// The "fake worker": pdf.js finds the worker's code here and runs it in this thread, since the
// frame may not start a Worker (`child-src 'none'`).
globalThis.pdfjsWorker = worker;

/** How far ahead of the screen a page is painted, in screens. */
const NEAR = 1.5;
/** The most pixels one page canvas may hold: a phone's memory is not a laptop's. */
export const CANVAS_PIXELS = 16 * 1024 * 1024;

/**
 * What a document needs from the package, without the network: the standard fonts. It is what
 * pdf.js calls a binary data factory (`fetch({kind, filename})`), served from the modules the
 * build put beside the bundle instead of from a URL.
 */
export class PackagedData {
  constructor() {
    this.standardFontDataUrl = "packaged://fonts/";
  }

  async fetch({ kind, filename }) {
    if (kind !== "standardFontDataUrl") throw new Error(`${kind} is not packaged`);
    const name = String(filename).replace(/[^A-Za-z0-9_-]/g, "");
    // The path is built at run time on purpose: the bundler must leave the import alone.
    const path = `./fonts/${name}.js`;
    const font = await import(path);
    return fromBase64(font.default);
  }
}

export function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

/** The scale at which a page of `width` points fills `available` CSS pixels. */
export function fitScale(width, available) {
  return width > 0 ? Math.max(0.1, available / width) : 1;
}

/** The device pixel ratio a page may be painted at without passing the canvas budget. */
export function ratioFor(width, height, wanted = 1, budget = CANVAS_PIXELS) {
  const area = Math.max(1, width * height);
  return Math.min(wanted, Math.sqrt(budget / area));
}

/** Which pages are near enough the screen to be painted: `top` and `height` of the viewport,
 *  `tops` and `heights` of the pages, in the same pixels. */
export function nearPages(top, height, tops, heights) {
  const from = top - height * NEAR;
  const to = top + height * (1 + NEAR);
  const near = [];
  for (let at = 0; at < tops.length; at += 1) {
    if (tops[at] + heights[at] >= from && tops[at] <= to) near.push(at);
  }
  return near;
}

/** Why a document could not be opened, as a state the view knows. */
export function failureOf(error) {
  if (error instanceof pdfjs.PasswordException || error?.name === "PasswordException") return "locked";
  return "broken";
}

/**
 * Opens the bytes of a PDF with what the frame allows: no worker, no eval, no fetch, no wasm.
 * pdf.js gets a copy: the original stays whole for pdf-lib, which writes the signed file.
 */
export function openDocument(bytes) {
  return pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: false,
    BinaryDataFactory: PackagedData,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
}
