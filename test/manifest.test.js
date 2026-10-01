// The manifest (plugin plan §6, plugin-sdk `module.schema.json`, checked here by hand since no
// plugin pulls the schema in): the id and name, core 1.1.0, only `send: propose`, opens PDFs and
// is not their viewer (a tap on a PDF still opens the viewer).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "module.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));

it("says what the plan asks and nothing more", () => {
  expect(manifest).toEqual({
    id: "com.flickertalk.sign",
    name: "Sign",
    version: pkg.version,
    minCoreVersion: "1.1.0",
    components: ["ft-sign"],
    permissions: { send: "propose" },
    opens: ["application/pdf"],
    summary: expect.any(String),
  });
  expect(manifest.views).toBeUndefined();
});

it("keeps to the schema of plugin-sdk", () => {
  expect(manifest.id).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/);
  expect(manifest.name.length).toBeGreaterThan(0);
  expect(manifest.name.length).toBeLessThanOrEqual(64);
  expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(manifest.minCoreVersion).toMatch(/^\d+\.\d+\.\d+$/);
  for (const component of manifest.components) expect(component).toMatch(/^ft-[a-z0-9-]+$/);
  for (const kind of manifest.opens) expect(kind).toMatch(/^(\*\/\*|[a-z0-9][a-z0-9.+_-]*\/(\*|[a-z0-9][a-z0-9.+_-]*))$/);
  expect(manifest.summary.length).toBeLessThanOrEqual(200);
  // In English, and honest: a drawn signature, never a promise of legal validity.
  expect(manifest.summary).toMatch(/drawn/i);
  expect(manifest.summary).not.toMatch(/legal|certif/i);
});

it("pins every dependency to one version", () => {
  for (const version of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)]) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pkg.dependencies).toEqual({ "pdf-lib": "1.17.1", "pdfjs-dist": "6.3.289", signature_pad: "5.1.4" });
});
