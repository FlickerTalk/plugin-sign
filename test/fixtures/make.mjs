// Makes the PDFs the tests use, by hand and small: `npm run fixtures`. Text in a standard font
// (Helvetica: pdf.js must find it in the package), with:
// - two-pages.pdf: two pages of 300 × 400 points;
// - rotated.pdf: one page shown turned a quarter (`/Rotate 90`) whose box does not start at 0 0;
// - signed.pdf: a signature field carrying a digital signature (`/FT /Sig` with a `/V` that is a
//   `/Type /Sig` dictionary);
// - field.pdf: an empty signature field, nobody signed it yet;
// - locked.pdf: an `/Encrypt` dictionary whose keys match no password;
// - broken.pdf: not a PDF at all.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A PDF from its objects, with a correct xref table. */
function pdf(objects, trailerExtra = "") {
  let out = "%PDF-1.7\n%âãÏÓ\n";
  const offsets = [];
  objects.forEach((body, at) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${at + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function contents(text, x = 40, y = 340) {
  const stream = `BT /F1 24 Tf ${x} ${y} Td (${text}) Tj ET\n0 0 1 rg ${x} ${y - 300} 220 200 re f\n`;
  return `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
}

const FONT = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

// 1 catalog, 2 pages, 3 page one, 4 page two, 5 font, 6 content one, 7 content two
const page = (contentsRef, extra = "") =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents ${contentsRef} 0 R ${extra}>>`;

writeFileSync(
  join(here, "two-pages.pdf"),
  pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    page(6),
    page(7),
    FONT,
    contents("Page one"),
    contents("Page two"),
  ]),
);

// The box starts at 50 100 on purpose: a tap has to land relative to the box, not to 0 0.
writeFileSync(
  join(here, "rotated.pdf"),
  pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [50 100 350 500] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    FONT,
    contents("Turned", 90, 440),
  ]),
);

// 1 catalog with the form, 2 pages, 3 page, 4 font, 5 content, 6 field + widget, 7 signature
const withField = (value) =>
  pdf([
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /SigFlags 3 >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
    FONT,
    contents("Agreement"),
    `<< /FT /Sig /T (Signature1) ${value ? "/V 7 0 R " : ""}/Type /Annot /Subtype /Widget /Rect [0 0 0 0] /F 132 /P 3 0 R >>`,
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 100 200 100] /Contents <${"00".repeat(64)}> /M (D:20261002120000Z) >>`,
  ]);
writeFileSync(join(here, "signed.pdf"), withField(true));
writeFileSync(join(here, "field.pdf"), withField(false));

// Standard security handler, revision 2, with owner and user entries that no password matches.
writeFileSync(
  join(here, "locked.pdf"),
  pdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      contents("Secret"),
      FONT,
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> >>`,
    ],
    "/Encrypt 6 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] ",
  ),
);

writeFileSync(join(here, "broken.pdf"), Buffer.from("this is not a pdf at all, just some text that pretends to be one\n"));

console.log("fixtures written");
