// Builds `dist/` from `src/`: one bundle with pdf.js (its worker inside: it runs in the main
// thread, the frame may start no Worker), pdf-lib and signature_pad; the standard fonts as small
// modules beside it, loaded only when a document needs one; and the notices of all of it. The
// package the catalogue signs is `module.json` + `dist/`.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/fonts", { recursive: true });

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022"],
  outfile: "dist/index.js",
  legalComments: "none",
  logLevel: "info",
  // The fonts are imported by name at runtime, not bundled.
  external: ["./fonts/*"],
});

/**
 * The `https://` the libraries carry as strings, rewritten so none is left in the package (a
 * test fails on any). Each one is never asked for; each rewrite says why it changes nothing, and
 * the build stops if one no longer finds what it expects, so an upgrade is looked at again.
 */
const REWRITES = [
  {
    why: "core-js (inside pdf.js's legacy build) records where its licence and source live: read by nobody",
    find: /license:"https:\/\/github\.com\/zloirock\/core-js\/blob\/[^"]*",source:"https:\/\/github\.com\/zloirock\/core-js"/g,
    to: 'license:"MIT",source:"core-js"',
    at: 2,
  },
  {
    why: "core-js asks the WebView's URL parser sample questions to decide whether to replace it; wss:// is parsed by the same rules as https:// (special scheme, with a host), so the answers are the same (tested)",
    find: /"https:\/\/(a|a\/c%20d\?a=1&c=3|a@b|\\u0442\\u0435\\u0441\\u0442|a#\\u0431|x)"/g,
    to: '"wss://$1"',
    at: 12,
  },
  {
    why: "pdf.js resolves a relative address against a placeholder base to read a file name from it; the same with wss://",
    find: /"https:\/\/foo\.bar"/g,
    to: '"wss://foo.bar"',
    at: 2,
  },
  {
    why: "pdf-lib's producer line, written only when it updates a document's information, which this plugin turns off",
    find: /"pdf-lib \(https:\/\/github\.com\/Hopding\/pdf-lib\)"/g,
    to: '"pdf-lib"',
    at: 1,
  },
];

let bundle = readFileSync("dist/index.js", "utf8");
for (const rewrite of REWRITES) {
  const found = bundle.match(rewrite.find)?.length ?? 0;
  if (found !== rewrite.at) throw new Error(`expected ${rewrite.at} of ${rewrite.find}, found ${found}: ${rewrite.why}`);
  bundle = bundle.replace(rewrite.find, rewrite.to);
}
writeFileSync("dist/index.js", bundle);

// The Foxit fonts (PDFium's licence, BSD style). Liberation Sans is GPL with a font exception:
// it stays out, and pdf.js writes Helvetica with the phone's sans-serif.
for (const file of readdirSync("node_modules/pdfjs-dist/standard_fonts")) {
  if (!file.startsWith("Foxit") || !file.endsWith(".pfb")) continue;
  const base64 = readFileSync(`node_modules/pdfjs-dist/standard_fonts/${file}`).toString("base64");
  writeFileSync(`dist/fonts/${file.replace(/[^A-Za-z0-9_-]/g, "")}.js`, `export default ${JSON.stringify(base64)};\n`);
}

copyFileSync("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
