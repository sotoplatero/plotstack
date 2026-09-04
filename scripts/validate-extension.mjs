import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { EXTENSION_FILES, ICON_SIZES, iconPath } from "./extension-files.mjs";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

// La lista de archivos vive en scripts/extension-files.mjs, compartida con el
// empaquetador: lo que se valida es exactamente lo que se sube.
const required = [
  manifest.background?.service_worker,
  ...EXTENSION_FILES.filter((file) => file !== "manifest.json"),
  ...ICON_SIZES.map(iconPath),
].filter((file, index, all) => file && all.indexOf(file) === index);

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

// --- Requisitos de la Chrome Web Store -------------------------------------

// La tienda exige el icono de 128 y rechaza la subida si `icons` no lo
// declara; los otros tres evitan que Chrome reescale para la barra y el
// gestor de extensiones.
for (const size of ICON_SIZES) {
  if (manifest.icons?.[String(size)] !== iconPath(size)) {
    failures.push(`manifest.icons["${size}"] debe apuntar a ${iconPath(size)}`);
  }
  if (manifest.action?.default_icon?.[String(size)] !== iconPath(size)) {
    failures.push(`manifest.action.default_icon["${size}"] debe apuntar a ${iconPath(size)}`);
  }
}

// La tienda solo acepta versiones de 1 a 4 enteros sin ceros a la izquierda,
// y no deja volver a un número anterior: un formato inválido se descubre al
// subir, cuando ya es tarde.
if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(manifest.version ?? "")) {
  failures.push(`version inválida para la tienda: ${manifest.version}`);
}

// package.json y manifest.json describen el mismo artefacto; si divergen,
// el ZIP se nombra con una versión que no es la que Chrome instala.
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (pkg.version !== manifest.version) {
  failures.push(`package.json (${pkg.version}) y manifest.json (${manifest.version}) no coinciden`);
}

// `default_locale` sin _locales/ impide que Chrome cargue la extensión.
if (manifest.default_locale) {
  try {
    await access(path.join(root, "_locales", manifest.default_locale, "messages.json"), constants.R_OK);
  } catch {
    failures.push(`default_locale "${manifest.default_locale}" sin _locales/${manifest.default_locale}/messages.json`);
  }
}

// `<all_urls>` en web_accessible_resources expone recursos a cualquier web y
// es una de las causas habituales de revisión manual prolongada.
for (const entry of manifest.web_accessible_resources ?? []) {
  if (entry.matches?.includes("<all_urls>")) {
    failures.push("web_accessible_resources con <all_urls>: restringe `matches` o elimina la clave");
  }
}

// El paquete es una lista blanca, así que un módulo puede importar algo que
// existe en el repo pero NO viaja en el ZIP: funciona al cargar la carpeta
// descomprimida y revienta en la extensión publicada. Se comprueba que todo
// import relativo apunte a un archivo de la lista.
const scripts = EXTENSION_FILES.filter((file) => file.endsWith(".js"));
const sources = await Promise.all(scripts.map((file) => readFile(path.join(root, file), "utf8")));
for (const [index, source] of sources.entries()) {
  const from = scripts[index];
  const imports = source.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+["'](\.[^"']+)["']/g);
  for (const [, specifier] of imports) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    if (!EXTENSION_FILES.includes(target)) {
      failures.push(`${from} importa ${specifier} (${target}), que no está en EXTENSION_FILES`);
    }
  }
}

// Un permiso que el código no usa es motivo de rechazo ("permisos no
// justificados"). Se comprueba sobre el código que realmente se empaqueta.
const code = sources.join("\n");
const permissionUsage = {
  storage: /chrome\.storage\b/,
  tabs: /chrome\.tabs\b/,
  cookies: /chrome\.cookies\b/,
  downloads: /chrome\.downloads\b|globalThis\.chrome\?\.downloads/,
  clipboardWrite: /navigator\?\.clipboard|ClipboardItem/,
  // Refresco diario en segundo plano: sin él el histórico local solo crece los
  // días que el usuario abre el dashboard.
  alarms: /chrome\.alarms\b|chrome\.alarms\?/,
};
for (const permission of manifest.permissions ?? []) {
  const pattern = permissionUsage[permission];
  if (!pattern) failures.push(`permiso sin comprobación de uso: ${permission}`);
  else if (!pattern.test(code)) failures.push(`permiso declarado y no usado: ${permission}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log([
    "✓ Manifest V3 válido",
    `✓ ${required.length} archivos requeridos presentes`,
    "✓ Permisos de sesión y almacenamiento declarados",
    `✓ Iconos ${ICON_SIZES.join("/")} declarados y presentes`,
    `✓ Versión ${manifest.version} coherente entre manifest y package.json`,
    "✓ Sin permisos declarados que el código no use",
    "✓ Todo import relativo resuelve dentro del paquete",
  ].join("\n"));
}
