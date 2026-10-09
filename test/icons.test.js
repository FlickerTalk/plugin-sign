// Every icon goes through one function (`icon` in src/icons.js): the app's Ionicons when the app
// lends them (`./icon/<name>.svg`), and the few it does not, from the `ionicons` package, inside
// the bundle as inline SVG. Never an emoji.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ICONS, OWN_ICONS, icon } from "../src/icons.js";

const ROOT = join(import.meta.dirname, "..");

// The icons the app lends its plugins in core 1.6.0, the `minCoreVersion` this plugin declares
// (it lends Ionic to the frame, 2026-10-09): `src-tauri/resources/icons/` (the files behind `ICONS`
// in `src-tauri/src/plugins.rs`), the ones of 1.3.0 (app 8fbc3cf) and `camera-outline`, which Sign
// does not use.
const LENT_BY_CORE = "1.6.0";
const LENT = [
  "add-outline", "alarm-outline", "arrow-back-outline", "arrow-redo-outline", "arrow-undo-outline", "arrow-up-outline", "brush-outline",
  "calculator-outline", "chatbubble-outline", "checkmark-outline", "close-outline", "cloud-done-outline", "cloud-outline",
  "cloud-upload-outline", "color-palette-outline", "crop-outline", "document-text-outline", "download-outline",
  "ellipsis-horizontal-outline", "expand-outline", "eye-outline", "folder-open-outline", "folder-outline", "grid-outline",
  "hand-left-outline", "image-outline", "key-outline", "link-outline", "location-outline", "lock-closed-outline", "move-outline",
  "options-outline", "pause-outline", "pencil-outline", "play-outline", "refresh-outline", "remove-outline", "resize-outline",
  "save-outline", "search-outline", "send-outline", "square-outline", "text-outline", "time-outline", "trash-outline",
];

describe("the icons", () => {
  it("are checked against the icons of the core the manifest asks for", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
    expect(manifest.minCoreVersion).toBe(LENT_BY_CORE);
  });

  it("asks the app only for icons it lends", () => {
    for (const name of APP_ICONS) expect(LENT, name).toContain(name);
    const asked = [...readFileSync(join(ROOT, "src", "index.js"), "utf8").matchAll(/icon\("([a-z-]+)"/g)].map((match) => match[1]);
    expect(asked.length).toBeGreaterThan(5);
    for (const name of asked) expect([...APP_ICONS, ...Object.keys(OWN_ICONS)], name).toContain(name);
  });

  it("carries its own only where the app has none, as Ionicons ships them, with nothing to fetch or run", () => {
    expect(Object.keys(OWN_ICONS).sort()).toEqual(["person-outline", "warning-outline"]);
    for (const [name, svg] of Object.entries(OWN_ICONS)) {
      expect(LENT, name).not.toContain(name);
      expect(svg).toBe(readFileSync(join(ROOT, "node_modules", "ionicons", "dist", "svg", `${name}.svg`), "utf8").trim());
      expect(svg).not.toMatch(/https:|<script|href=/i);
      expect(svg).toContain('stroke="currentColor"');
    }
  });

  it("paints one way for both, hidden beside a text and named when alone", () => {
    expect(icon("save-outline")).toBe('<i class="i" data-icon="save-outline" aria-hidden="true" style="--i:url(./icon/save-outline.svg)"></i>');
    const own = icon("warning-outline");
    expect(own).toMatch(/^<i class="i own" data-icon="warning-outline" aria-hidden="true"><svg /);
    expect(icon("lock-closed-outline", { label: "Locked <x>" })).toContain('role="img" aria-label="Locked &lt;x&gt;"');
    expect(() => icon("no-such-icon")).toThrow(/no-such-icon/);
  });
});
