// The plugin against a fake core (plugin plan §6): open a PDF from "Open with" or the picker,
// tap where the signature goes (at any zoom), sign on the pad (✅ stays off while it is empty),
// move and resize the signature without moving the page, add a name, and hand
// `<name>-signed.pdf` to the chat (📤) or to the phone (💾). The other person signs the file that
// arrives and both signatures stay. Nothing is kept: no store, no records.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { placeBox, stampLayout } from "../src/geometry.js";
import { fromBase64 } from "../src/render.js";
import { fixture, inside, png, shown } from "./helpers.js";
import "../src/index.js";

const PNG_URL = `data:image/png;base64,${Buffer.from(png(40, 16)).toString("base64")}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let at = 0; at < 40; at += 1) await tick();
};

// happy-dom has no 2D context. The pad and the pictures of text get one that draws nothing and
// hands back a real PNG; the pages' canvases get none, as in happy-dom (pdf.js paints them, and
// that is tested in render.test.js).
beforeAll(() => {
  const context = new Proxy({}, { get: (_, key) => (key === "measureText" ? () => ({ width: 60 }) : () => {}), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext() {
    return this.closest(".sheet") ? null : context;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => PNG_URL);
});

/** A fake core: it opens the plugin with a file or none, answers the picker and the save, and
 *  hears what is sent. `store` and `records` are there to prove they are never used. */
function fakeCore({ picked = null, saved = true } = {}) {
  const handlers = [];
  const ft = {
    onOpen: (handler) => handlers.push(handler),
    pickFile: vi.fn(async () => picked),
    send: vi.fn(),
    save: vi.fn(async () => saved),
    say: vi.fn(),
    close: vi.fn(),
    store: { get: vi.fn(), set: vi.fn(), forget: vi.fn() },
    records: { get: vi.fn(), set: vi.fn(), forget: vi.fn(), keys: vi.fn(), usage: vi.fn() },
  };
  const open = (opening) =>
    Promise.all(handlers.map((handler) => handler({ text: "", dark: false, lang: "en", file: null, ref: null, reminder: null, live: false, ...opening })));
  return { ft, open };
}

const pdfFile = (name, bytes) => ({ name, mime: "application/pdf", data: Buffer.from(bytes).toString("base64") });

let core;
let element;
// In the page, not in a shadow root: Ionic's global styles do not cross a shadow boundary.
const $ = (selector) => element.querySelector(selector);
const $$ = (selector) => [...element.querySelectorAll(selector)];
// Ionic moves a button's label to the native button inside it once it has drawn.
const label = (one) => one?.getAttribute("aria-label") ?? one?.shadowRoot?.querySelector("button")?.getAttribute("aria-label") ?? null;
const act = (name) => $(`[data-act="${name}"]`);
/** The icons an element shows, by name: the app's (`./icon/<name>.svg`) and the plugin's own. */
const iconsIn = (node) => [...node.querySelectorAll("[data-icon]")].map((one) => one.dataset.icon);

async function mount(opening, options) {
  core = fakeCore(options);
  globalThis.ft = core.ft;
  document.body.innerHTML = "";
  element = document.createElement("ft-sign");
  document.body.append(element);
  await core.open(opening);
  await settle();
}

const finger = (target, type, { id = 1, x = 0, y = 0, primary = true } = {}) =>
  target.dispatchEvent(
    new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, isPrimary: primary, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1, bubbles: true, composed: true, cancelable: true }),
  );
const tap = (target, x, y) => {
  finger(target, "pointerdown", { x, y });
  finger(target, "pointerup", { x, y });
};
const at = (left, top, width, height) => () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });

/** A signature drawn on the pad with one finger. */
function draw() {
  const pad = $("[data-pad] canvas");
  pad.getBoundingClientRect = at(0, 0, 320, 140);
  finger(pad, "pointerdown", { id: 7, x: 40, y: 30 });
  finger(pad, "pointermove", { id: 7, x: 80, y: 50 });
  finger(pad, "pointermove", { id: 7, x: 120, y: 60 });
  finger(pad, "pointerup", { id: 7, x: 120, y: 60 });
}

/** Taps page `index` at the fraction `u`, `v` of a sheet drawn in a 600 × 800 rectangle scrolled
 *  200 px up, signs, and comes back with the signature on the page. */
async function signAt(index, u, v) {
  const sheet = $$(".sheet")[index];
  sheet.getBoundingClientRect = at(0, -200, 600, 800);
  tap(sheet, u * 600, -200 + v * 800);
  draw();
  act("done").click();
  await settle();
}

describe("creating the element", () => {
  // A custom element's constructor may not leave attributes or children: a real browser throws
  // NotSupportedError on document.createElement otherwise. `lang` is a reflected attribute.
  it("leaves no attribute and no child when created", () => {
    const created = document.createElement("ft-sign");
    expect([...created.attributes].map((one) => one.name)).toEqual([]);
    expect(created.childNodes).toHaveLength(0);
  });
});

describe("opening", () => {
  it("shows the pages of the PDF it was opened with and says where to tap, in the app's language", async () => {
    await mount({ lang: "es", file: pdfFile("contrato.pdf", fixture("two-pages.pdf")) });
    expect($$(".sheet")).toHaveLength(2);
    expect($("[data-hint]").textContent).toContain("Toca donde va tu firma");
    // The app's tool window has the way out.
    expect(act("close")).toBeNull();
    expect($("[role=alert]")).toBeNull();
  });

  it("asks for a PDF when opened from 🧰 with nothing, and opens what the user picks", async () => {
    await mount({ file: null }, { picked: pdfFile("lease.pdf", fixture("two-pages.pdf")) });
    expect($$(".sheet")).toHaveLength(0);
    act("pick").click();
    await settle();
    expect(core.ft.pickFile).toHaveBeenCalledWith("application/pdf");
    expect($$(".sheet")).toHaveLength(2);
  });

  it("stays put when the user picks nothing", async () => {
    await mount({ file: null }, { picked: null });
    act("pick").click();
    await settle();
    expect(act("pick")).not.toBeNull();
  });

  it("warns that a digital signature will stop being valid, and still lets you sign", async () => {
    await mount({ file: pdfFile("agreement.pdf", fixture("signed.pdf")) });
    const warning = $("[role=alert]");
    expect(iconsIn(warning)).toEqual(["warning-outline"]);
    expect(warning.textContent).toContain("no longer be valid");
    expect($$(".sheet")).toHaveLength(1);
  });

  it("says a PDF is locked or broken, and offers another", async () => {
    await mount({ file: pdfFile("secret.pdf", fixture("locked.pdf")) });
    expect(iconsIn($("[role=alert]"))).toEqual(["lock-closed-outline"]);
    expect($("[role=alert]").textContent).toContain("password protected");
    expect(act("pick")).not.toBeNull();
    expect($$(".sheet")).toHaveLength(0);

    await mount({ file: pdfFile("x.pdf", fixture("broken.pdf")) });
    expect($("[role=alert]").textContent).toContain("can't be opened");
    expect(act("pick")).not.toBeNull();
  });

  it("writes Arabic right to left", async () => {
    await mount({ lang: "ar", file: pdfFile("a.pdf", fixture("two-pages.pdf")) });
    expect($(".view").getAttribute("dir")).toBe("rtl");
    expect($("[data-hint]").textContent).toContain("المس");
  });
});

describe("signing", () => {
  it("opens the pad on a tap, and keeps ✅ off while the pad is empty", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    const sheet = $$(".sheet")[0];
    sheet.getBoundingClientRect = at(0, 0, 300, 400);
    tap(sheet, 150, 200);
    expect($("[data-pad]")).not.toBeNull();
    expect($("[data-pad]").textContent).toContain("not a digital signature");
    expect(act("done").disabled).toBe(true);
    draw();
    expect(act("done").disabled).toBe(false);
    act("clear").click();
    expect(act("done").disabled).toBe(true);
    act("cancel").click();
    expect($("[data-pad]")).toBeNull();
    expect($(".box")).toBeNull();
  });

  it("puts the signature where the tap was, at any zoom, and hands <name>-signed.pdf to the chat", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    const fit = $$(".sheet")[1].style.width;
    act("zoom-in").click();
    expect($$(".sheet")[1].style.width).not.toBe(fit);
    await signAt(1, 0.25, 0.75);
    expect($("[data-pad]")).toBeNull();
    expect($$(".sheet")[1].querySelector(".box")).not.toBeNull();
    const name = $("[data-name]");
    name.value = "Ana";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    act("send").click();
    await settle();

    expect(core.ft.send).toHaveBeenCalledTimes(1);
    const [fileName, mime, data] = core.ft.send.mock.calls[0];
    expect(fileName).toBe("two-pages-signed.pdf");
    expect(mime).toBe("application/pdf");
    const box = placeBox(0.25, 0.75, { width: 300, height: 400 });
    const page = await shown(fromBase64(data), 2);
    expect(page.images).toHaveLength(1);
    expect(inside(page.images[0], box)).toBe(true);
    const written = page.text.filter((item) => inside(item, box)).map((item) => item.str);
    expect(written[0]).toBe("Ana");
    expect(written[1]).toMatch(/2\d{3}.*\(phone clock\)$/);
    expect((await shown(fromBase64(data), 1)).images).toHaveLength(0);
    // The signature is not kept anywhere.
    expect(core.ft.store.set).not.toHaveBeenCalled();
    expect(core.ft.records.set).not.toHaveBeenCalled();
  });

  it("leaves the name out when none is given", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    await signAt(0, 0.5, 0.5);
    act("send").click();
    await settle();
    const box = placeBox(0.5, 0.5, { width: 300, height: 400 });
    const page = await shown(fromBase64(core.ft.send.mock.calls[0][2]), 1);
    const written = page.text.filter((item) => inside(item, box)).map((item) => item.str);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/\(phone clock\)$/);
  });

  it("signs the file the other person sent, and both signatures stay", async () => {
    await mount({ file: pdfFile("deal.pdf", fixture("two-pages.pdf")) });
    await signAt(1, 0.25, 0.75);
    $("[data-name]").value = "Ana";
    $("[data-name]").dispatchEvent(new Event("input", { bubbles: true }));
    act("send").click();
    await settle();
    const [first, , once] = core.ft.send.mock.calls[0];

    await mount({ file: pdfFile(first, fromBase64(once)) });
    await signAt(1, 0.7, 0.2);
    $("[data-name]").value = "Luis";
    $("[data-name]").dispatchEvent(new Event("input", { bubbles: true }));
    act("send").click();
    await settle();
    const [second, , twice] = core.ft.send.mock.calls[0];
    expect(second).toBe("deal-signed.pdf");
    const page = await shown(fromBase64(twice), 2);
    expect(page.images).toHaveLength(2);
    const words = page.text.map((item) => item.str);
    expect(words).toContain("Ana");
    expect(words).toContain("Luis");
  });

  it("saves the signed PDF on the phone with 💾 and says whether it worked", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    await signAt(0, 0.5, 0.5);
    act("save").click();
    await settle();
    expect(core.ft.save).toHaveBeenCalledWith("two-pages-signed.pdf", "application/pdf", expect.any(String));
    expect($("[role=status]").textContent).toContain("Saved");
    expect(core.ft.send).not.toHaveBeenCalled();

    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) }, { saved: false });
    await signAt(0, 0.5, 0.5);
    act("save").click();
    await settle();
    expect($("[role=status]").textContent).toContain("Couldn't save");
  });

  it("takes the signature away with 🗑️, and asks for a new one with ✍️", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    await signAt(0, 0.5, 0.5);
    act("again").click();
    expect($("[data-pad]")).not.toBeNull();
    expect(act("done").disabled).toBe(true);
    act("cancel").click();
    expect($(".box")).not.toBeNull();
    act("remove").click();
    expect($(".box")).toBeNull();
    expect(act("send")).toBeNull();
    expect($("[data-hint]")).not.toBeNull();
  });
});

describe("the signature as shown", () => {
  it("shrinks a line of text that does not fit the box, as the PDF will", async () => {
    // happy-dom lays nothing out: the lines say they are twice as wide as the box.
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get() { return this.classList?.contains("line") ? 200 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.classList?.contains("line") ? 100 : 0; } });
    try {
      await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
      await signAt(0, 0.5, 0.5);
      const line = $(".box .line");
      const sheet = $$(".sheet")[0];
      const size = parseFloat(line.style.fontSize);
      const box = placeBox(0.5, 0.5, { width: 300, height: 400 });
      const full = (parseFloat(sheet.style.width) / 300) * stampLayout(box.w * 300, box.h * 400, 1).size;
      expect(size).toBeCloseTo(full / 2, 5);
    } finally {
      // happy-dom keeps them further up the prototype chain: put back what was here, if anything.
      for (const [key, was] of [["scrollWidth", scroll], ["clientWidth", client]]) {
        if (was) Object.defineProperty(HTMLElement.prototype, key, was);
        else delete HTMLElement.prototype[key];
      }
    }
  });
});

describe("fingers", () => {
  it("moves the signature with one finger and resizes it from its corner, without opening the pad", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    await signAt(0, 0.5, 0.5);
    const sheet = $$(".sheet")[0];
    sheet.getBoundingClientRect = at(0, 0, 600, 800);
    const box = $(".box");
    const left = parseFloat(box.style.left);
    const width = parseFloat(box.style.width);
    finger(box, "pointerdown", { id: 3, x: 300, y: 400 });
    finger(box, "pointermove", { id: 3, x: 330, y: 400 });
    finger(box, "pointerup", { id: 3, x: 330, y: 400 });
    expect(parseFloat($(".box").style.left)).toBeCloseTo(left + 5, 5);
    const handle = $(".box [data-act=resize]");
    finger(handle, "pointerdown", { id: 4, x: 400, y: 450 });
    finger(handle, "pointermove", { id: 4, x: 460, y: 450 });
    finger(handle, "pointerup", { id: 4, x: 460, y: 450 });
    expect(parseFloat($(".box").style.width)).toBeCloseTo(width + 10, 5);
    expect($("[data-pad]")).toBeNull();
    expect($$(".box")).toHaveLength(1);
  });

  it("does not take a scroll, a cancelled touch or two fingers for a tap", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    const sheet = $$(".sheet")[0];
    sheet.getBoundingClientRect = at(0, 0, 300, 400);
    finger(sheet, "pointerdown", { x: 100, y: 100 });
    finger(sheet, "pointermove", { x: 100, y: 160 });
    finger(sheet, "pointerup", { x: 100, y: 160 });
    finger(sheet, "pointerdown", { x: 100, y: 100 });
    finger(sheet, "pointercancel", { x: 100, y: 100 });
    finger(sheet, "pointerdown", { id: 1, x: 100, y: 100 });
    finger(sheet, "pointerdown", { id: 2, x: 200, y: 200, primary: false });
    finger(sheet, "pointerup", { id: 2, x: 200, y: 200, primary: false });
    finger(sheet, "pointerup", { id: 1, x: 100, y: 100 });
    expect($("[data-pad]")).toBeNull();
  });

  it("moves the signature to another spot with a tap once it is signed", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    await signAt(0, 0.5, 0.5);
    const sheet = $$(".sheet")[1];
    sheet.getBoundingClientRect = at(0, 0, 300, 400);
    tap(sheet, 150, 100);
    expect($("[data-pad]")).toBeNull();
    expect($$(".sheet")[1].querySelector(".box")).not.toBeNull();
    expect($$(".sheet")[0].querySelector(".box")).toBeNull();
  });
});

describe("icons, not emoji (Ionicons, as in the app)", () => {
  const PICTOGRAPH = /\p{Extended_Pictographic}/u;
  /** Everything a screen paints, text and attributes, without its style sheet. */
  const painted = () => element.innerHTML.replace(/<style>[\s\S]*?<\/style>/, "");
  const screens = [];
  const look = (name) => {
    screens.push(name);
    expect(painted(), name).not.toMatch(PICTOGRAPH);
    for (const button of $$("button, ion-button")) expect(label(button), `${name}: a button`).toBeTruthy();
    for (const one of $$("[data-icon]")) {
      // An icon beside a text is hidden from a screen reader; the button carries the name.
      expect(one.getAttribute("aria-hidden"), `${name}: ${one.dataset.icon}`).toBe("true");
    }
  };

  it("paints no emoji on any screen, in any language", async () => {
    for (const lang of ["en", "es", "ar", "ja"]) {
      await mount({ lang, file: null });
      look(`${lang} start`);
      await mount({ lang, file: pdfFile("x.pdf", fixture("locked.pdf")) });
      look(`${lang} locked`);
      await mount({ lang, file: pdfFile("x.pdf", fixture("broken.pdf")) });
      look(`${lang} broken`);
      await mount({ lang, file: pdfFile("a.pdf", fixture("signed.pdf")) });
      look(`${lang} sealed, ready`);
      const sheet = $$(".sheet")[0];
      sheet.getBoundingClientRect = at(0, 0, 300, 400);
      tap(sheet, 150, 200);
      look(`${lang} pad`);
      draw();
      act("done").click();
      await settle();
      look(`${lang} signed`);
      act("save").click();
      await settle();
      look(`${lang} saved`);
    }
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) }, { saved: false });
    await signAt(0, 0.5, 0.5);
    act("save").click();
    await settle();
    look("save failed");
    expect(screens.length).toBeGreaterThan(20);
  });

  it("shows the state, the warnings and the hint with an icon beside the text", async () => {
    await mount({ file: null });
    expect(iconsIn($(".state"))).toEqual(["pencil-outline", "document-text-outline"]);
    await mount({ file: pdfFile("x.pdf", fixture("broken.pdf")) });
    expect(iconsIn($("[role=alert]"))).toEqual(["warning-outline"]);
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    expect(iconsIn($("[data-hint]"))).toEqual(["hand-left-outline"]);
    const sheet = $$(".sheet")[0];
    sheet.getBoundingClientRect = at(0, 0, 300, 400);
    tap(sheet, 150, 200);
    expect(iconsIn($("[data-pad] .title"))).toEqual(["pencil-outline"]);
    draw();
    act("done").click();
    await settle();
    expect(iconsIn($("[data-name]").parentElement)).toContain("person-outline");
    expect($("[data-name]").getAttribute("placeholder")).toBe("Name (optional)");
    act("save").click();
    await settle();
    expect(iconsIn($("[role=status]"))).toEqual(["checkmark-outline"]);
    expect($("[role=status]").textContent.trim()).toBe("Saved");
  });

  it("goes dark by the attribute the app's colours set, never by :host-context (WebKit has none)", async () => {
    await mount({ dark: true, file: null });
    expect(element.hasAttribute("dark")).toBe(true);
    expect(element.querySelector("style").textContent).not.toContain(":host-context");
    expect(element.querySelector("style").textContent).toContain("ft-sign[dark]");
    await mount({ dark: false, file: null });
    expect(element.hasAttribute("dark")).toBe(false);
  });
});

describe("with the Ionic the app lends", () => {
  it("asks for an app that lends Ionic", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(JSON.parse(readFileSync(join(import.meta.dirname, "..", "module.json"), "utf8")).minCoreVersion).toBe("1.6.0");
  });

  it("asks for a PDF in Ionic's content, with an Ionic button and no bar of its own", async () => {
    await mount({ file: null });
    expect(element.shadowRoot).toBe(null);
    expect($(":scope > ion-header")).toBeNull();
    expect($(':scope > ion-content ion-button[data-act="pick"]').textContent).toContain("Choose a PDF");
  });

  it("puts the zoom in Ionic's header, the pages in a content that does not scroll, and the signed bar in its footer", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    for (const name of ["zoom-out", "zoom-in"]) expect(label($(`:scope > ion-header > ion-toolbar ion-button[data-act="${name}"]`)), name).toBeTruthy();
    const content = $(":scope > ion-content");
    expect(content.getAttribute("scroll-y")).toBe("false");
    expect(content.querySelector("[data-pages] .sheet")).not.toBeNull();
    expect($(":scope > ion-footer")).toBeNull();
    await signAt(0, 0.5, 0.5);
    const footer = $(":scope > ion-footer > ion-toolbar");
    expect(footer.querySelector("[data-name]")).not.toBeNull();
    for (const name of ["again", "remove", "save", "send"]) expect(label(footer.querySelector(`ion-button[data-act="${name}"]`)), name).toBeTruthy();
    expect(footer.querySelector('ion-button[data-act="send"]').getAttribute("fill")).toBe("solid");
    act("remove").click();
    await settle();
    expect($(":scope > ion-footer")).toBeNull();
  });

  it("opens the pad over the header and the footer, its buttons Ionic's", async () => {
    await mount({ file: pdfFile("two-pages.pdf", fixture("two-pages.pdf")) });
    const sheet = $$(".sheet")[0];
    sheet.getBoundingClientRect = at(0, 0, 300, 400);
    tap(sheet, 150, 200);
    // A child of the element itself, so it covers the bars too.
    expect($(":scope > [data-padhost] [data-pad]")).not.toBeNull();
    for (const name of ["clear", "cancel", "done"]) expect(act(name).tagName, name).toBe("ION-BUTTON");
  });
});
