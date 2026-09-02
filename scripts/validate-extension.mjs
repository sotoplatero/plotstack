import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const required = [
  manifest.background?.service_worker,
  "dashboard/index.html",
  "dashboard/styles.css",
  "dashboard/app.js",
  "dashboard/privacy.js",
  "dashboard/capture.js",
  "src/shared/analytics.js",
  "src/shared/content-analytics.js",
  "src/providers/substack-api.js",
  "src/providers/substack-extended.js",
].filter(Boolean);

const failures = [];
if (manifest.manifest_version !== 3) failures.push("manifest_version must be 3");
for (const permission of ["storage", "tabs", "cookies", "downloads"]) {
  if (!manifest.permissions?.includes(permission)) failures.push(`missing permission: ${permission}`);
}
for (const file of required) {
  try {
    await access(path.join(root, file), constants.R_OK);
  } catch {
    failures.push(`missing file: ${file}`);
  }
}

const dashboard = await readFile(path.join(root, "dashboard/index.html"), "utf8");
for (const reference of ["./styles.css", "./app.js", "../assets/icon.svg"]) {
  if (!dashboard.includes(reference)) failures.push(`dashboard reference missing: ${reference}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`✓ Manifest V3 válido\n✓ ${required.length} archivos requeridos presentes\n✓ Permisos de sesión y almacenamiento declarados`);
}
