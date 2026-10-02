// Writing the signature into the PDF with pdf-lib. The signature is a picture in the page's
// content, with the name and the phone's date and time under it: a drawn signature, not a
// digital one. So a second person signs the file the first one sent, and both signatures stay.
// A PDF that carries a digital signature is told apart first: rewriting it breaks that signature.
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";
import { displayedSize, normalizeRotation, pointInBox, stampLayout } from "./geometry.js";

/** The colour of the name and the date: the ink of a pen, not pure black. */
const TEXT = rgb(0.13, 0.13, 0.13);

/** Loads a PDF as it is: no "pdf-lib" as producer, no new dates in its information. */
const load = (bytes) => PDFDocument.load(bytes, { updateMetadata: false });

const name = (text) => PDFName.of(text);

/** Whether a document carries a digital signature: a signature field with a value, found from
 *  the form's fields or from the pages' widgets, or the permissions only a signature grants. */
function sealed(document) {
  const { context, catalog } = document;
  const lookup = (value) => (value === undefined ? undefined : context.lookup(value));
  const seen = new Set();
  const signedField = (node, inherited) => {
    if (!(node instanceof PDFDict) || seen.has(node)) return false;
    seen.add(node);
    const type = node.get(name("FT")) ?? inherited;
    if (type === name("Sig") && lookup(node.get(name("V"))) instanceof PDFDict) return true;
    const kids = lookup(node.get(name("Kids")));
    if (kids instanceof PDFArray) {
      for (let at = 0; at < kids.size(); at += 1) if (signedField(lookup(kids.get(at)), type)) return true;
    }
    return false;
  };
  const perms = lookup(catalog.get(name("Perms")));
  if (perms instanceof PDFDict && perms.keys().length > 0) return true;
  const form = lookup(catalog.get(name("AcroForm")));
  const fields = form instanceof PDFDict ? lookup(form.get(name("Fields"))) : undefined;
  if (fields instanceof PDFArray) {
    for (let at = 0; at < fields.size(); at += 1) if (signedField(lookup(fields.get(at)))) return true;
  }
  for (const page of document.getPages()) {
    const annots = lookup(page.node.get(name("Annots")));
    if (!(annots instanceof PDFArray)) continue;
    for (let at = 0; at < annots.size(); at += 1) if (signedField(lookup(annots.get(at)))) return true;
  }
  return false;
}

/** Whether the bytes are a PDF behind a password. pdf-lib's own error is an ES5 subclass of
 *  `Error` that `instanceof` does not recognise, so the question is asked again, plainly. */
async function encrypted(bytes) {
  try {
    return (await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })).isEncrypted;
  } catch {
    return false;
  }
}

/** What can be done with these bytes: sign them (`ready`), nothing because of a password
 *  (`locked`), or nothing because they are not a PDF (`broken`). */
export async function inspect(bytes) {
  let document;
  try {
    document = await load(bytes);
  } catch {
    return { state: (await encrypted(bytes)) ? "locked" : "broken", pages: 0, sealed: false };
  }
  const pages = document.getPageCount();
  if (pages < 1) return { state: "broken", pages: 0, sealed: false };
  return { state: "ready", pages, sealed: sealed(document) };
}

/** The page's box as pdf.js shows it: the crop box inside the media box. */
function viewOf(page) {
  const box = (rect) => [Math.min(rect.x, rect.x + rect.width), Math.min(rect.y, rect.y + rect.height), Math.max(rect.x, rect.x + rect.width), Math.max(rect.y, rect.y + rect.height)];
  const media = box(page.getMediaBox());
  const crop = box(page.getCropBox());
  const view = [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])];
  return view[2] > view[0] && view[3] > view[1] ? view : media;
}

/**
 * The PDF with a signature on page `page` (from 0), in `box` (fractions of the page as shown):
 * the `signature` picture (PNG bytes) on top, then one line per entry of `lines`, written with
 * the PDF's Helvetica when it can spell the text, or as the line's `png` (the phone drew it) when
 * it cannot. `align: "end"` puts the lines on the right, for a language written right to left.
 */
export async function stamp(bytes, { page, box, signature, lines = [], align = "start" }) {
  const document = await load(bytes);
  const target = document.getPages()[page];
  if (!target) throw new Error(`page ${page} is not in this PDF`);
  const view = viewOf(target);
  const rotate = normalizeRotation(target.getRotation().angle);
  const turn = degrees(rotate);
  const size = displayedSize(view, rotate);
  const width = box.w * size.width;
  const height = box.h * size.height;
  const layout = stampLayout(width, height, lines.length);
  const at = (x, y) => pointInBox(box, x, y, view, rotate);

  // The signature, as large as its room allows without changing its shape, standing on the
  // first line.
  const picture = await document.embedPng(signature);
  const room = layout.image;
  const scale = Math.min(room.width / picture.width, room.height / picture.height);
  const drawn = { width: picture.width * scale, height: picture.height * scale };
  const [x, y] = at(room.x + (room.width - drawn.width) / 2, room.y + room.height);
  target.drawImage(picture, { x, y, width: drawn.width, height: drawn.height, rotate: turn });

  let font;
  for (const [index, line] of lines.entries()) {
    const baseline = layout.lines[index];
    font ??= await document.embedFont(StandardFonts.Helvetica);
    let textWidth = null;
    try {
      textWidth = font.widthOfTextAtSize(line.text, layout.size);
    } catch {
      // Helvetica cannot spell it (Cyrillic, Arabic, CJK…): the phone's picture of it goes.
    }
    if (textWidth !== null) {
      const fontSize = textWidth > width ? (layout.size * width) / textWidth : layout.size;
      const lineWidth = Math.min(textWidth, width);
      const [tx, ty] = at(align === "end" ? width - lineWidth : 0, baseline);
      target.drawText(line.text, { x: tx, y: ty, size: fontSize, font, color: TEXT, rotate: turn });
    } else if (line.png) {
      const image = await document.embedPng(line.png);
      let lineHeight = layout.size * 1.2;
      let lineWidth = (image.width / image.height) * lineHeight;
      if (lineWidth > width) {
        lineHeight *= width / lineWidth;
        lineWidth = width;
      }
      const [ix, iy] = at(align === "end" ? width - lineWidth : 0, baseline + layout.size * 0.2);
      target.drawImage(image, { x: ix, y: iy, width: lineWidth, height: lineHeight, rotate: turn });
    } else {
      throw new Error("a line the PDF's font cannot write came without its picture");
    }
  }
  // A classic cross-reference table: any reader, whatever version the file says it is.
  return document.save({ useObjectStreams: false });
}

/** The name of the signed file: the original's, without its path, with `-signed` once. */
export function signedName(original) {
  const last = String(original ?? "").split(/[\\/]/).pop() ?? "";
  const stem = last
    .replace(/\.pdf$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!stem) return "document-signed.pdf";
  return /-signed$/i.test(stem) ? `${stem}.pdf` : `${stem}-signed.pdf`;
}

/** Bytes as base64, in pieces a multiple of three long, so a big PDF never builds one huge
 *  argument list. */
export function toBase64(bytes) {
  const piece = 3 * 8192;
  let out = "";
  for (let at = 0; at < bytes.length; at += piece) out += btoa(String.fromCharCode.apply(null, bytes.subarray(at, at + piece)));
  return out;
}
