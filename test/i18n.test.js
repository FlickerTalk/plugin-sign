// What the plugin says, in the 21 languages of the app (Plan §84; plugin plan §13): the same keys
// in each, English as the source and the fallback, Arabic right to left, and the date drawn under
// a signature written by `Intl` in the signer's language, honest about where it comes from.
import { describe, expect, it } from "vitest";
import { LANGUAGES, catalogueOf, directionOf, formatWhen, t } from "../src/i18n.js";

const APP_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "ro", "pl", "ru", "uk", "tr", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];
const NOON = new Date(Date.UTC(2026, 9, 2, 12, 3));

describe("the catalogue", () => {
  it("speaks the 21 languages of the app, with the same keys in each and no empty text", () => {
    expect([...LANGUAGES].sort()).toEqual([...APP_LANGUAGES].sort());
    const keys = Object.keys(catalogueOf("en")).sort();
    expect(keys.length).toBeGreaterThan(20);
    for (const lang of LANGUAGES) {
      expect(Object.keys(catalogueOf(lang)).sort(), lang).toEqual(keys);
      for (const key of keys) expect(catalogueOf(lang)[key].trim(), `${lang}.${key}`).not.toBe("");
    }
  });

  it("keeps every placeholder in every language", () => {
    const holes = (text) => (text.match(/\{[a-z]+\}/g) ?? []).sort();
    for (const lang of LANGUAGES) {
      for (const [key, text] of Object.entries(catalogueOf("en"))) {
        expect(holes(catalogueOf(lang)[key]), `${lang}.${key}`).toEqual(holes(text));
      }
    }
  });

  it("finds a text by the exact tag, then its base, then in English, and fills the holes", () => {
    expect(t("es", "tap")).toBe("Toca donde va tu firma");
    expect(t("pt-BR", "save")).toBe(t("pt", "save"));
    expect(t("xx", "send")).toBe("Send");
    expect(t("zh-TW", "close")).not.toBe(t("zh-CN", "close"));
    expect(t("en", "clock", { date: "Oct 2" })).toBe("Oct 2 (phone clock)");
    expect(t("es", "clock", { date: "2 oct" })).toBe("2 oct (reloj del teléfono)");
  });

  it("carries no emoji: the view paints the icons beside the text", () => {
    for (const lang of LANGUAGES) {
      for (const [key, text] of Object.entries(catalogueOf(lang))) expect(text, `${lang}.${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("never promises a legal or a certified signature", () => {
    expect(t("en", "drawn")).toBe("A drawn signature, not a digital signature with a certificate.");
    for (const lang of LANGUAGES) expect(catalogueOf(lang).drawn.toLowerCase(), lang).not.toMatch(/legal/);
  });

  it("writes Arabic right to left and the rest left to right", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("ar-EG")).toBe("rtl");
    for (const lang of LANGUAGES.filter((one) => one !== "ar")) expect(directionOf(lang), lang).toBe("ltr");
    expect(directionOf(undefined)).toBe("ltr");
  });
});

describe("the date under a signature", () => {
  it("is the phone's date and time in the signer's language, with the time zone", () => {
    const english = formatWhen(NOON, "en", "UTC");
    expect(english).toContain("2026");
    expect(english).toContain("12:03");
    expect(english).toContain("UTC");
    expect(formatWhen(NOON, "es", "UTC")).toContain("oct");
    expect(formatWhen(NOON, "de", "Europe/Madrid")).toContain("14:03");
    // Thai dates count the Buddhist era, as the phone shows them.
    expect(formatWhen(NOON, "th", "UTC")).toContain("2569");
  });

  it("uses plain spaces, so a Latin date can be written with the PDF's own font", () => {
    for (const lang of LANGUAGES) {
      const date = formatWhen(NOON, lang, "UTC");
      expect(date.length, lang).toBeGreaterThan(6);
      expect(date, lang).not.toMatch(/[   ]/);
    }
  });

  it("falls back to English for a language Intl does not know", () => {
    expect(formatWhen(NOON, "not a language", "UTC")).toBe(formatWhen(NOON, "en", "UTC"));
  });
});
