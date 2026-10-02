// Sign, for FlickerTalk (plugin plan §6): both people sign the same PDF with a finger, in turns,
// through the chat. Open a PDF ("Open with", or the toolbox and the document button), tap where the signature goes, sign on
// the pad, move or resize it, add a name if you like, and hand `<name>-signed.pdf` to the chat
// (send) or to the phone (save). The other person does the same on the file that arrives, and both
// signatures stay. It is a drawn signature with the phone's date and time, not a digital one.
// Nothing is kept: no store, no records; the signature lives only while the plugin is open.
import SignaturePad from "signature_pad";
import { fractionAt, moveBox, placeBox, resizeBox, stampLayout, strokeBounds } from "./geometry.js";
import { directionOf, formatWhen, t } from "./i18n.js";
import { icon } from "./icons.js";
import { failureOf, fitScale, fromBase64, nearPages, openDocument, ratioFor } from "./render.js";
import { inspect, signedName, stamp, toBase64 } from "./stamp.js";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
/** How far a finger may slide, in CSS pixels, and how long it may stay, and still be a tap. */
const TAP_SLOP = 10;
const TAP_TIME = 600;
/** The pen: dark blue ink, as on paper. */
const INK = "#1b2f7a";
const PDF = "application/pdf";

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[one]);

const LIGHT = "--paper: #e9e9e9; --bar: rgba(255,255,255,.94); --text: #111; --soft: #666; --card: #fff; --line: #d0d0d0; --warn: #fff4d6;";
const DARK = "--paper: #1c1c1e; --bar: rgba(28,28,30,.94); --text: #f4f4f4; --soft: #aaa; --card: #2c2c2e; --line: #444; --warn: #4a3b12;";

const STYLE = `
:host { display: flex; flex-direction: column; font: 14px system-ui, sans-serif; ${LIGHT} --accent: #3478f6; color: var(--text); }
@media (prefers-color-scheme: dark) { :host { ${DARK} } }
:host([dark]) { ${DARK} }
* { box-sizing: border-box; }
.view { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.bar { display: flex; gap: 4px; align-items: center; padding: 4px 6px; background: var(--bar); }
.grow { flex: 1; }
button { appearance: none; border: 0; background: transparent; color: inherit; min-width: 44px; height: 44px; border-radius: 10px; cursor: pointer; font: inherit; }
button:disabled { opacity: .35; cursor: default; }
button.primary { background: var(--accent); color: #fff; }
button.wide { display: inline-flex; gap: 8px; align-items: center; padding: 0 16px; background: var(--accent); color: #fff; }
.i { display: block; width: 22px; height: 22px; margin: auto; background: currentColor; -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat; }
button.wide .i { margin: 0; }
.i.own { background: none; -webkit-mask: none; mask: none; }
.i.own svg { display: block; width: 100%; height: 100%; }
input { flex: 1; min-width: 0; height: 40px; border: 1px solid var(--line); border-radius: 10px; padding: 0 10px; background: var(--card); color: inherit; font: inherit; }
.note { display: flex; gap: 8px; align-items: center; margin: 0; padding: 6px 12px; font-size: 13px; }
.note .i { flex: none; width: 18px; height: 18px; margin: 0; }
.note:empty { display: none; }
.warn { background: var(--warn); }
.hint { color: var(--soft); justify-content: center; }
.pages { flex: 1; overflow: auto; background: var(--paper); touch-action: pan-x pan-y; }
.sheet { position: relative; margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.sheet canvas { display: block; width: 100%; height: 100%; }
.box { position: absolute; outline: 2px dashed var(--accent); outline-offset: 1px; touch-action: none; cursor: move; color: #222; }
.box img { position: absolute; left: 0; width: 100%; object-fit: contain; object-position: center bottom; pointer-events: none; }
.box .line { position: absolute; left: 0; right: 0; white-space: nowrap; overflow: hidden; line-height: 1; font-family: Helvetica, Arial, sans-serif; text-align: start; pointer-events: none; }
.handle { position: absolute; right: -14px; bottom: -14px; width: 28px; height: 28px; border-radius: 14px; background: var(--accent); touch-action: none; cursor: nwse-resize; }
.state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; flex: 1; padding: 40px 16px; text-align: center; }
.big .i { width: 56px; height: 56px; }
.pad { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 12px; background: rgba(0,0,0,.45); touch-action: none; }
.card { width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 16px; background: var(--card); }
.card .title { display: flex; gap: 8px; align-items: center; margin: 0; font-weight: 600; }
.card .title .i { margin: 0; }
.card canvas { display: block; width: 100%; aspect-ratio: 2.4 / 1; background: #fff; border: 1px solid var(--line); border-radius: 10px; touch-action: none; }
.small { margin: 0; font-size: 12px; color: var(--soft); }
.row { display: flex; gap: 4px; align-items: center; }
`;

/** The bytes of a `data:` URL. */
const bytesOf = (url) => fromBase64(String(url).slice(String(url).indexOf(",") + 1));

/** A line of text drawn by the phone, in its own fonts: what goes on the PDF when its Helvetica
 *  cannot spell the line (a Cyrillic name, an Arabic date…). Nothing when there is no canvas. */
function lineImage(text, dir) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const font = "48px system-ui, sans-serif";
  context.font = font;
  canvas.width = Math.max(8, Math.ceil(context.measureText(text).width) + 8);
  canvas.height = 64;
  context.font = font;
  context.direction = dir;
  context.textAlign = dir === "rtl" ? "right" : "left";
  context.fillStyle = "#222";
  context.fillText(text, dir === "rtl" ? canvas.width - 4 : 4, 48);
  const url = canvas.toDataURL("image/png");
  return url.length > 30 ? bytesOf(url) : undefined;
}

class Sign extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.lang = "en";
    this.state = "start";
    this.bytes = null;
    this.fileName = "";
    this.sealed = false;
    this.document = null;
    this.pages = [];
    this.zoom = 1;
    this.painted = new Map();
    this.pointers = new Map();
    this.pinch = null;
    this.press = null;
    this.drag = null;
    this.box = null;
    this.signature = null;
    this.name = "";
    this.padOpen = false;
    this.pad = null;
    this.busy = false;
    this.message = null;
  }

  connectedCallback() {
    this.style.height = `${Math.max(480, (globalThis.screen?.availHeight ?? 800) - 150)}px`;
    this.root.innerHTML = `<style>${STYLE}</style><div class="view"></div>`;
    this.view = this.root.querySelector(".view");
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.addEventListener("input", (event) => this.onInput(event));
    globalThis.ft?.onOpen?.((opening) => this.onOpen(opening));
    this.paint();
  }

  get dir() {
    return directionOf(this.lang);
  }

  T(key, values) {
    return t(this.lang, key, values);
  }

  async onOpen(opening) {
    this.lang = opening.lang || "en";
    if (opening.dark) this.setAttribute("dark", "");
    if (opening.file?.data) await this.load(opening.file);
    else this.paint();
  }

  /** Opens a file handed by the chat or picked: checks it with pdf-lib, then paints it. */
  async load(file) {
    this.state = "loading";
    this.signature = null;
    this.box = null;
    this.message = null;
    this.paint();
    this.fileName = file.name || "";
    this.bytes = fromBase64(file.data || "");
    const checked = await inspect(this.bytes);
    this.sealed = checked.sealed;
    if (checked.state !== "ready") {
      this.state = checked.state;
      return this.paint();
    }
    try {
      await this.document?.destroy?.();
      this.document = await openDocument(this.bytes);
      this.pages = [];
      for (let number = 1; number <= this.document.numPages; number += 1) {
        const page = await this.document.getPage(number);
        const { width, height } = page.getViewport({ scale: 1 });
        this.pages.push({ page, width, height, size: { width, height } });
      }
      this.state = "ready";
    } catch (error) {
      this.state = failureOf(error);
    }
    this.paint();
    if (this.state === "ready") this.layout();
  }

  async pick() {
    const file = await globalThis.ft.pickFile(PDF);
    if (file?.data) await this.load(file);
  }

  onClick(event) {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled) return;
    switch (button.dataset.act) {
      case "close":
        return globalThis.ft.close();
      case "pick":
        return this.pick();
      case "zoom-in":
        return this.setZoom(this.zoom * ZOOM_STEP);
      case "zoom-out":
        return this.setZoom(this.zoom / ZOOM_STEP);
      case "clear":
        this.pad?.clear();
        return this.padChanged();
      case "cancel":
        return this.closePad(false);
      case "done":
        return this.closePad(true);
      case "again":
        return this.openPad();
      case "remove":
        this.signature = null;
        this.box = null;
        this.paintChrome();
        return this.paintBox();
      case "save":
        return this.output("save");
      case "send":
        return this.output("send");
      default:
    }
  }

  onInput(event) {
    if (!event.target.matches?.("[data-name]")) return;
    this.name = event.target.value;
    this.paintBox();
  }

  /** A word in the status line, with the icon that goes beside it, if any. */
  say(text, name) {
    this.message = { text, icon: name };
    const status = this.view.querySelector("[data-status]");
    if (status) status.innerHTML = this.statusMarkup();
  }

  statusMarkup() {
    const { text = "", icon: name } = this.message || {};
    if (!text) return "";
    return `${name ? icon(name) : ""}<span>${escape(text)}</span>`;
  }

  // ---- What the plugin shows ----

  paint() {
    const close = `<button data-act="close" aria-label="${escape(this.T("close"))}">${icon("close-outline")}</button>`;
    const pick = `<button class="wide" data-act="pick" aria-label="${escape(this.T("pick"))}">${icon("document-text-outline")}<span>${escape(this.T("pick"))}</span></button>`;
    this.view.setAttribute("dir", this.dir);
    this.painted.clear();
    if (this.state !== "ready") {
      const states = {
        start: `<div class="state"><span class="big">${icon("pencil-outline")}</span><p>${escape(this.T("intro"))}</p>${pick}</div>`,
        loading: `<div class="state" role="status"><span class="big">${icon("document-text-outline")}</span><p>${escape(this.T("loading"))}</p></div>`,
        locked: `<div class="state"><div role="alert"><span class="big">${icon("lock-closed-outline")}</span><p>${escape(this.T("locked"))}</p></div>${pick}</div>`,
        broken: `<div class="state"><div role="alert"><span class="big">${icon("warning-outline")}</span><p>${escape(this.T("broken"))}</p></div>${pick}</div>`,
      };
      this.view.innerHTML = `<div class="bar"><span class="grow"></span>${close}</div>${states[this.state] ?? states.start}`;
      return;
    }
    const number = new Intl.NumberFormat(this.lang);
    this.view.innerHTML = `
      <div class="bar">
        <button data-act="zoom-out" aria-label="${escape(this.T("zoomOut"))}">${icon("remove-outline")}</button>
        <button data-act="zoom-in" aria-label="${escape(this.T("zoomIn"))}">${icon("add-outline")}</button>
        <span class="grow"></span>
        ${close}
      </div>
      <div data-notes></div>
      <div class="pages" data-pages>${this.pages
        .map((_, at) => `<div class="sheet" data-page="${at}" aria-label="${escape(this.T("page", { number: number.format(at + 1) }))}"></div>`)
        .join("")}</div>
      <div data-bottom></div>
      <div data-padhost></div>`;
    const pages = this.view.querySelector("[data-pages]");
    pages.addEventListener("scroll", () => this.onScroll());
    pages.addEventListener("pointerdown", (event) => this.onPagesDown(event));
    pages.addEventListener("pointermove", (event) => this.onPagesMove(event));
    pages.addEventListener("pointerup", (event) => this.onPagesUp(event));
    pages.addEventListener("pointercancel", (event) => this.onPagesUp(event));
    this.sheets = [...pages.querySelectorAll(".sheet")];
    this.paintChrome();
  }

  /** The notes, the bar at the bottom and the pad: what changes as the user signs. */
  paintChrome() {
    const notes = this.view.querySelector("[data-notes]");
    if (!notes) return;
    notes.innerHTML = `
      ${this.sealed ? `<p class="note warn" role="alert">${icon("warning-outline")}<span>${escape(this.T("sealed"))}</span></p>` : ""}
      ${this.signature ? "" : `<p class="note hint" data-hint>${icon("hand-left-outline")}<span>${escape(this.T("tap"))}</span></p>`}
      <p class="note" role="status" data-status>${this.statusMarkup()}</p>`;
    const bottom = this.view.querySelector("[data-bottom]");
    bottom.innerHTML = this.signature
      ? `<div class="bar">
          ${icon("person-outline")}
          <input data-name type="text" maxlength="80" autocomplete="off" placeholder="${escape(this.T("name"))}" aria-label="${escape(this.T("name"))}" value="${escape(this.name)}">
          <button data-act="again" aria-label="${escape(this.T("again"))}">${icon("pencil-outline")}</button>
          <button data-act="remove" aria-label="${escape(this.T("remove"))}">${icon("trash-outline")}</button>
          <button data-act="save" aria-label="${escape(this.T("save"))}">${icon("save-outline")}</button>
          <button class="primary" data-act="send" aria-label="${escape(this.T("send"))}">${icon("send-outline")}</button>
        </div>`
      : "";
  }

  // ---- The pages: sized for the zoom, painted as they come near (as the PDF viewer does) ----

  layout() {
    const pages = this.view.querySelector("[data-pages]");
    if (!pages) return;
    const available = Math.max(200, (pages.clientWidth || 360) - 16);
    for (const [at, sheet] of this.sheets.entries()) {
      const { width, height } = this.pages[at];
      const scale = fitScale(width, available) * this.zoom;
      sheet.style.width = `${Math.round(width * scale)}px`;
      sheet.style.height = `${Math.round(height * scale)}px`;
    }
    for (const canvas of this.painted.values()) canvas.remove();
    this.painted.clear();
    this.onScroll();
    this.paintBox();
  }

  onScroll() {
    const pages = this.view.querySelector("[data-pages]");
    if (!pages || !this.sheets) return;
    const tops = this.sheets.map((sheet) => sheet.offsetTop);
    const heights = this.sheets.map((sheet) => sheet.offsetHeight);
    const near = new Set(nearPages(pages.scrollTop, pages.clientHeight || 480, tops, heights));
    for (const [at, canvas] of this.painted) {
      if (!near.has(at)) {
        canvas.remove();
        this.painted.delete(at);
      }
    }
    for (const at of near) if (!this.painted.has(at)) this.paintPage(at);
  }

  async paintPage(at) {
    const sheet = this.sheets?.[at];
    const entry = this.pages[at];
    if (!sheet || !entry) return;
    const canvas = document.createElement("canvas");
    this.painted.set(at, canvas);
    const cssWidth = sheet.clientWidth || parseFloat(sheet.style.width) || 360;
    const scale = cssWidth / entry.width;
    const ratio = ratioFor(cssWidth, entry.height * scale, globalThis.devicePixelRatio || 1);
    const viewport = entry.page.getViewport({ scale: scale * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    sheet.prepend(canvas);
    const context = canvas.getContext("2d");
    if (!context) return;
    try {
      await entry.page.render({ canvasContext: context, viewport }).promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") {
        // A page that will not paint stays white rather than half drawn; the reason is logged.
        console.warn("page did not paint", error);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }

  setZoom(zoom) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.layout();
  }

  /** While two fingers move, the sheets scale as CSS; the pixels come once they lift. */
  previewZoom(zoom) {
    this.previewed = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const pages = this.view.querySelector("[data-pages]");
    const available = Math.max(200, (pages?.clientWidth || 360) - 16);
    for (const [at, sheet] of (this.sheets ?? []).entries()) {
      const { width, height } = this.pages[at];
      const scale = fitScale(width, available) * this.previewed;
      sheet.style.width = `${Math.round(width * scale)}px`;
      sheet.style.height = `${Math.round(height * scale)}px`;
    }
  }

  // ---- Fingers on the pages: one taps, two zoom; a slide scrolls and is no tap ----

  onPagesDown(event) {
    // A primary pointer is the first finger down, so none is left: a lift that never arrived (its
    // canvas repainted away under the finger) must not turn the next tap into a pinch.
    if (event.isPrimary) this.pointers.clear();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      this.press = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      return;
    }
    const sheet = event.target.closest?.(".sheet");
    this.press = sheet && !this.padOpen ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now(), page: Number(sheet.dataset.page) } : null;
  }

  onPagesMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const press = this.press;
    if (press && press.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP) this.press = null;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      this.previewZoom(this.pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / (this.pinch.distance || 1)));
    }
  }

  onPagesUp(event) {
    const press = this.press;
    this.pointers.delete(event.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) {
        const zoom = this.previewed ?? this.zoom;
        this.pinch = null;
        this.previewed = null;
        this.setZoom(zoom);
      }
      this.press = null;
      return;
    }
    this.press = null;
    if (event.type !== "pointerup" || !press || press.id !== event.pointerId) return;
    if (Date.now() - press.time > TAP_TIME || Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP) return;
    this.onTap(press.page, event.clientX, event.clientY);
  }

  /** A tap on a page: the first one opens the pad there; once signed, it moves the signature. */
  onTap(page, clientX, clientY) {
    const sheet = this.sheets?.[page];
    if (!sheet || this.padOpen) return;
    const { u, v } = fractionAt(clientX, clientY, sheet.getBoundingClientRect());
    const size = this.pages[page].size;
    if (!this.signature) {
      this.box = { page, ...placeBox(u, v, size) };
      return this.openPad();
    }
    const old = this.pages[this.box.page].size;
    const w = Math.min(1, (this.box.w * old.width) / size.width);
    const h = Math.min(1, (this.box.h * old.height) / size.height);
    this.box = { page, ...moveBox({ u: u - w / 2, v: v - h / 2, w, h }, 0, 0) };
    this.paintBox();
  }

  // ---- The signature on the page ----

  paintBox() {
    for (const old of this.root.querySelectorAll(".box")) old.remove();
    if (!this.box || !this.signature) return;
    const sheet = this.sheets?.[this.box.page];
    if (!sheet) return;
    const element = document.createElement("div");
    element.className = "box";
    element.dataset.act = "move";
    element.setAttribute("aria-label", this.T("move"));
    sheet.append(element);
    this.boxElement = element;
    this.placeBoxElement();
    const size = this.pages[this.box.page].size;
    const width = this.box.w * size.width;
    const height = this.box.h * size.height;
    const lines = this.lineTexts(new Date());
    const layout = stampLayout(width, height, lines.length);
    const perPoint = (parseFloat(sheet.style.width) || size.width) / size.width;
    element.innerHTML = `
      <img alt="" src="${escape(this.signature.url)}" style="top:0;height:${(layout.image.height / height) * 100}%">
      ${lines
        .map((line, at) => `<div class="line" style="top:${((layout.lines[at] - layout.size) / height) * 100}%;font-size:${layout.size * perPoint}px">${escape(line)}</div>`)
        .join("")}
      <span class="handle" data-act="resize" aria-label="${escape(this.T("resize"))}"></span>`;
    // A line wider than the box is written smaller in the PDF (`stamp`); the preview does the same.
    for (const line of element.querySelectorAll(".line")) {
      const { scrollWidth, clientWidth } = line;
      if (clientWidth > 0 && scrollWidth > clientWidth) line.style.fontSize = `${(parseFloat(line.style.fontSize) * clientWidth) / scrollWidth}px`;
    }
    element.addEventListener("pointerdown", (event) => this.onBoxDown(event));
    element.addEventListener("pointermove", (event) => this.onBoxMove(event));
    element.addEventListener("pointerup", (event) => this.onBoxUp(event));
    element.addEventListener("pointercancel", (event) => this.onBoxUp(event));
  }

  placeBoxElement() {
    const element = this.boxElement;
    if (!element || !this.box) return;
    element.style.left = `${this.box.u * 100}%`;
    element.style.top = `${this.box.v * 100}%`;
    element.style.width = `${this.box.w * 100}%`;
    element.style.height = `${this.box.h * 100}%`;
  }

  /** The text under the signature: the name if there is one, then the phone's date and time. */
  lineTexts(when) {
    const date = this.T("clock", { date: formatWhen(when, this.lang) });
    return [this.name.trim(), date].filter(Boolean);
  }

  onBoxDown(event) {
    event.stopPropagation();
    if (this.drag) return;
    const kind = event.target.closest?.("[data-act]")?.dataset.act === "resize" ? "resize" : "move";
    const sheet = this.sheets[this.box.page];
    this.drag = { id: event.pointerId, kind, x: event.clientX, y: event.clientY, start: { ...this.box }, rect: sheet.getBoundingClientRect() };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Without capture the finger still drives the box while it stays on it.
    }
  }

  onBoxMove(event) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    event.stopPropagation();
    event.preventDefault?.();
    const du = drag.rect.width ? (event.clientX - drag.x) / drag.rect.width : 0;
    const dv = drag.rect.height ? (event.clientY - drag.y) / drag.rect.height : 0;
    const size = this.pages[drag.start.page].size;
    const moved = drag.kind === "move" ? moveBox(drag.start, du, dv) : resizeBox(drag.start, du, dv, size);
    this.box = { page: drag.start.page, ...moved };
    this.placeBoxElement();
  }

  onBoxUp(event) {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    event.stopPropagation();
    const resized = this.drag.kind === "resize";
    this.drag = null;
    if (resized) this.paintBox();
  }

  // ---- The pad: one finger signs; nothing under it moves ----

  openPad() {
    const host = this.view.querySelector("[data-padhost]");
    if (!host) return;
    this.padOpen = true;
    this.press = null;
    host.innerHTML = `
      <div class="pad" data-pad role="dialog" aria-label="${escape(this.T("padTitle"))}">
        <div class="card">
          <p class="title">${icon("pencil-outline")}<span>${escape(this.T("padTitle"))}</span></p>
          <canvas aria-label="${escape(this.T("padTitle"))}"></canvas>
          <p class="small">${escape(this.T("drawn"))}</p>
          <div class="row">
            <button data-act="clear" aria-label="${escape(this.T("clear"))}">${icon("trash-outline")}</button>
            <span class="grow"></span>
            <button data-act="cancel" aria-label="${escape(this.T("cancel"))}">${icon("close-outline")}</button>
            <button class="primary" data-act="done" aria-label="${escape(this.T("done"))}" disabled>${icon("checkmark-outline")}</button>
          </div>
        </div>
      </div>`;
    const canvas = host.querySelector("canvas");
    const cssWidth = canvas.clientWidth || 320;
    const cssHeight = canvas.clientHeight || Math.round(cssWidth / 2.4);
    const ratio = Math.max(globalThis.devicePixelRatio || 1, 1);
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    this.padSize = { width: cssWidth, height: cssHeight, ratio };
    const context = canvas.getContext("2d");
    this.pad = null;
    if (context) {
      context.scale(ratio, ratio);
      this.pad = new SignaturePad(canvas, { penColor: INK, minWidth: 0.8, maxWidth: 2.6, backgroundColor: "rgba(0,0,0,0)" });
      this.pad.addEventListener("endStroke", () => this.padChanged());
    }
  }

  /** Done only once there is something on the pad. */
  padChanged() {
    const done = this.view.querySelector('[data-act="done"]');
    if (done) done.disabled = !this.pad || this.pad.isEmpty();
  }

  closePad(keep) {
    const host = this.view.querySelector("[data-padhost]");
    if (keep && this.pad && !this.pad.isEmpty()) {
      const signature = this.exportPad(host.querySelector("canvas"));
      if (signature) this.signature = signature;
    }
    this.pad?.off();
    this.pad = null;
    this.padOpen = false;
    if (host) host.innerHTML = "";
    if (!this.signature) this.box = null;
    this.paintChrome();
    this.paintBox();
  }

  /** Only the ink of the pad, as a PNG: the box then holds the signature, not the empty pad. */
  exportPad(canvas) {
    const { width, height, ratio } = this.padSize;
    const bounds = strokeBounds(this.pad.toData(), 6, { width, height });
    if (!bounds) return null;
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(bounds.width * ratio));
    crop.height = Math.max(1, Math.round(bounds.height * ratio));
    const context = crop.getContext("2d");
    if (!context) return null;
    context.drawImage(canvas, bounds.x * ratio, bounds.y * ratio, bounds.width * ratio, bounds.height * ratio, 0, 0, crop.width, crop.height);
    const url = crop.toDataURL("image/png");
    if (!url.startsWith("data:image/png")) return null;
    return { url, png: bytesOf(url) };
  }

  // ---- The signed PDF, to the chat or to the phone ----

  async output(kind) {
    if (this.busy || !this.signature || !this.box || !this.bytes) return;
    this.busy = true;
    this.say(this.T("working"));
    try {
      const lines = this.lineTexts(new Date()).map((text) => ({ text, png: lineImage(text, this.dir) }));
      const signed = await stamp(this.bytes, {
        page: this.box.page,
        box: this.box,
        signature: this.signature.png,
        lines,
        align: this.dir === "rtl" ? "end" : "start",
      });
      const name = signedName(this.fileName);
      const data = toBase64(signed);
      if (kind === "send") {
        this.say("");
        // The app puts the file in the composer and closes the plugin.
        globalThis.ft.send(name, PDF, data);
      } else {
        const saved = await globalThis.ft.save(name, PDF, data);
        this.say(saved ? this.T("saved") : this.T("saveFailed"), saved ? "checkmark-outline" : "warning-outline");
      }
    } catch (error) {
      console.warn("signing failed", error);
      this.say(this.T("failed"), "warning-outline");
    } finally {
      this.busy = false;
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-sign")) customElements.define("ft-sign", Sign);
