import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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
