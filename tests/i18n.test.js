import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { detectLanguage, t, tn } from "../src/shared/i18n.js";
import EN from "../src/shared/locales/en.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta) => readFileSync(join(raiz, ruta), "utf8");

const CODIGO = [
  "dashboard/app.js",
  "dashboard/capture.js",
  "dashboard/privacy.js",
  "src/background.js",
  "src/shared/analytics.js",
  "src/shared/content-analytics.js",
  "src/shared/insights.js",
  "src/providers/substack-api.js",
  "src/providers/substack-extended.js",
];

const cadena = (cruda) => JSON.parse(`"${cruda}"`);
const LITERAL = String.raw`"((?:[^"\\]|\\.)*)"`;

// Todas las claves que el código pasa a `t()` y `tn()` como literal.
const clavesDelCodigo = () => {
  const claves = new Map();
  for (const ruta of CODIGO) {
    const fuente = leer(ruta);
    for (const m of fuente.matchAll(new RegExp(String.raw`(?<![\w.$])t\(\s*${LITERAL}`, "g"))) claves.set(cadena(m[1]), ruta);
    for (const m of fuente.matchAll(new RegExp(String.raw`(?<![\w.$])tn\([^,()]*(?:\([^()]*\))?[^,()]*,\s*${LITERAL}\s*,\s*${LITERAL}`, "g"))) {
      claves.set(cadena(m[1]), ruta);
      claves.set(cadena(m[2]), ruta);
    }
  }
  return claves;
};

// Texto visible del HTML estático: nodos de texto y atributos legibles.
const textosDelHtml = () => {
  const html = leer("dashboard/index.html")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "");
  const textos = new Set();
  const añadir = (valor) => {
    const limpio = valor.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (/\p{L}/u.test(limpio)) textos.add(limpio);
  };
  for (const m of html.matchAll(/>([^<>]+)</g)) añadir(m[1]);
  for (const m of html.matchAll(/\s(?:title|aria-label|placeholder|alt|data-hint)="([^"]*)"/g)) añadir(m[1]);
  const titulo = html.match(/<title>([^<]*)<\/title>/);
  if (titulo) añadir(titulo[1]);
  return textos;
};

test("el idioma sale de las preferencias del navegador", () => {
  assert.equal(detectLanguage({ languages: ["es-MX"], language: "es-MX" }), "es");
  assert.equal(detectLanguage({ languages: ["en-GB"], language: "en-GB" }), "en");
  assert.equal(detectLanguage({ languages: ["fr-FR", "es-ES"], language: "fr-FR" }), "es", "el primero que sabemos pintar");
  assert.equal(detectLanguage({ languages: ["de-DE"], language: "de-DE" }), "en", "un idioma sin traducción cae al inglés");
  assert.equal(detectLanguage({}), "en");
});

test("en español t() devuelve la fuente e interpola", () => {
  assert.equal(t("Hace {n} días", { n: 3 }), "Hace 3 días");
  assert.equal(tn(1, "{n} nota", "{n} notas"), "1 nota");
  assert.equal(tn(4, "{n} nota", "{n} notas"), "4 notas");
});

test("toda cadena de t() y tn() tiene traducción inglesa", () => {
  const faltan = [...clavesDelCodigo()].filter(([clave]) => !(clave in EN)).map(([clave, ruta]) => `${ruta}: ${clave}`);
  assert.deepEqual(faltan, []);
});

test("todo el texto visible del HTML estático tiene traducción inglesa", () => {
  const faltan = [...textosDelHtml()].filter((texto) => !(texto in EN));
  assert.deepEqual(faltan, []);
});

test("las traducciones conservan sus marcadores y no están vacías", () => {
  const marcas = (texto) => [...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const [clave, valor] of Object.entries(EN)) {
    assert.equal(typeof valor, "string", clave);
    assert.ok(valor.trim(), `traducción vacía: ${clave}`);
    assert.equal(marcas(valor), marcas(clave), `marcadores distintos: ${clave}`);
  }
});

test("ningún formato de fecha o número fija el locale español", () => {
  for (const ruta of CODIGO) {
    assert.doesNotMatch(leer(ruta), /["']es(-ES)?["']/, `${ruta} debe usar LOCALE de i18n.js`);
  }
});
