// the legacy build has the polyfills pdf.js needs on older WebViews (Map.prototype.getOrInsertComputed…)
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as worker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// pdf.js finds the worker here and runs it on this thread, the frame has child-src 'none'
globalThis.pdfjsWorker = worker;

// screens
const NEAR = 1.5;
export const CANVAS_PIXELS = 16 * 1024 * 1024;

export class PackagedData {
  constructor() {
    this.standardFontDataUrl = "packaged://fonts/";
  }

  async fetch({ kind, filename }) {
    if (kind !== "standardFontDataUrl") throw new Error(`${kind} is not packaged`);
    const name = String(filename).replace(/[^A-Za-z0-9_-]/g, "");
    // Liberation Sans is GPL with a font exception, so it stays out of this MIT package
    if (name.startsWith("Liberation")) throw new Error(`${filename} is not packaged`);
    // built at run time so esbuild leaves this import alone
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

export function fitScale(width, available) {
  return width > 0 ? Math.max(0.1, available / width) : 1;
}

export function ratioFor(width, height, wanted = 1, budget = CANVAS_PIXELS) {
  const area = Math.max(1, width * height);
  return Math.min(wanted, Math.sqrt(budget / area));
}

export function nearPages(top, height, tops, heights) {
  const from = top - height * NEAR;
  const to = top + height * (1 + NEAR);
  const near = [];
  for (let at = 0; at < tops.length; at += 1) {
    if (tops[at] + heights[at] >= from && tops[at] <= to) near.push(at);
  }
  return near;
}

export function failureOf(error) {
  if (error instanceof pdfjs.PasswordException || error?.name === "PasswordException") return "locked";
  return "broken";
}

// pdf.js gets a copy, the original bytes must stay whole for pdf-lib
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
