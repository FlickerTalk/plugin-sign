# plugin-sign

**Sign** for [FlickerTalk](https://flickertalk.com): both people sign the same PDF with a finger,
in turns, through the chat. One opens the PDF, signs it and sends `<name>-signed.pdf`; the other
opens that file, signs it too and sends it back. The result is one PDF with both signatures.

> You both sign the same PDF with a finger, on your phones; the document only travels through
> the conversation. It is a drawn signature, not a digital signature with a certificate.

## What it does

- **Open a PDF**: "Open with" → **Sign** on a PDF in a chat, or 🧰 → **Sign** → 📄 (the system
  picker). Tapping a PDF still opens the viewer: Sign is not the viewer of PDFs (no `views`).
- **Tap where the signature goes.** A pad opens; sign with one finger. ✅ stays off while the pad
  is empty; 🗑️ clears it; ✕ cancels.
- **Move** the signature with a finger, **resize** it from its corner, or tap elsewhere (also on
  another page) to put it there. ✍️ signs again, 🗑️ takes it away.
- **Name** (optional), written under the signature, and the **phone's date and time**, written by
  `Intl` in the phone's language and labelled as the phone's clock: it is not a timestamp.
- 📤 puts `<name>-signed.pdf` in the message box (the app closes the plugin; the user sends it).
  💾 saves it on the phone. A file already called `…-signed.pdf` keeps its name.
- Pinch or ➕/➖ to zoom. A swipe scrolls; it is never taken for a tap. Arabic runs right to left;
  dark mode follows the app. Every icon is an Ionicon, as in the app: the ones the app lends
  (`./icon/<name>.svg`), and two of its own (`src/icons.js`); no emoji in the interface.

What it says before signing:

- ⚠️ the PDF carries a **digital signature** (a signature field with a value, or `/Perms`):
  signing here rewrites the file, so that signature will no longer be valid. Signing is allowed.
- 🔒 the PDF is **encrypted** (any `/Encrypt`): it cannot be signed.
- a file that is not a PDF cannot be opened.

## What it sees and keeps

It sees the PDF it is handed and the signature drawn on its pad. It never sees the contact, the
conversation or anything else, and it has no network. **It keeps nothing**: no `store`, no
`records`; the signature exists only while the plugin is open. Its only permission is
`send: propose`: what it makes goes to the message box, and the user sends it.

The signed PDF is rewritten by pdf-lib without touching its information dictionary (no
"pdf-lib" producer, no new dates). The signature is a picture in the page's content, with the
name and the date as text in Helvetica; a line Helvetica cannot spell (Cyrillic, Arabic, CJK…)
goes in as a picture the phone draws with its own fonts. Because it is page content, the first
signature stays when the second person signs.

## Inside the plugins' policy

The frame's policy (no workers, no `eval`, no `fetch`, no wasm) is not relaxed. pdf.js runs with
the configuration of `plugin-pdf-viewer`: its worker's code bundled and run on the main thread,
`isEvalSupported: false`, `useWasm: false`, the bytes from `onOpen`, the standard fonts from the
package (`dist/fonts/*.js`, loaded by `import()` only when a document needs one), and the legacy
build for older WebViews. pdf.js gets a copy of the bytes (it detaches what it is given); the
original stays for pdf-lib.

- **Fonts**: only the PDFium (Foxit) standard fonts are packaged. pdf.js's Liberation Sans is
  GPL-2.0 with a font exception, so it stays out; pdf.js then draws Helvetica text with the
  phone's sans-serif.
- **Addresses**: a test fails if any file of `dist/` contains `https://`. The build rewrites the
  ones the libraries carry as strings (core-js's own metadata and URL self-test, a pdf.js
  placeholder base, pdf-lib's producer line); `build.js` says why each one changes nothing, and
  stops if one is no longer found. The `http://` left are XML namespaces, two pdf.js templates
  for links (never followed here), and the Apache License header in the notices; each is listed
  in `test/build.test.js`.

Accepted limits: no CMaps (CJK text in old PDFs may not show), no wasm (JPEG 2000 and JBIG2
images may not show), no forms, no signature fields, no digital (certificate) signatures, no
password prompt.

## Development

```sh
npm install
npm test                 # Vitest + happy-dom, on src/, dist/ and the PDFs in test/fixtures
npm run build            # esbuild: src/ → dist/index.js + dist/fonts/*.js + notices
npm run fixtures         # remakes the test PDFs
```

`dist/` is generated and **committed**: what the catalogue signs is `module.json` + `dist/`, and
CI checks that it comes out of `src/`. A test keeps `dist/` under 5 MB (it is about 2.5 MB, about
0.95 MB zipped). It needs FlickerTalk **1.1.0** (`minCoreVersion`): "Open with" and `lang`.

## Licences

MIT. What is inside, with each licence in full: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
(pdf.js, Apache-2.0; core-js, MIT; PDFium fonts, BSD-3-Clause; pdf-lib, @pdf-lib/standard-fonts,
@pdf-lib/upng, signature_pad, MIT; two Ionicons the app does not lend, MIT; pako, MIT and Zlib; tslib, 0BSD).
