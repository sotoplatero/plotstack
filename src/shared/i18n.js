// Idioma de la interfaz: español o inglés, según el navegador.
//
// El español es el idioma fuente: las cadenas se escriben en español dentro
// del código y `t()` las usa como clave del diccionario inglés. Así el código
// se sigue leyendo igual y una cadena sin traducir cae al español en vez de
// mostrar una clave vacía. Módulo compartido entre service worker y dashboard:
// ambos tienen `navigator`, y los dos resuelven el mismo idioma.
import EN from "./locales/en.js";

const SUPPORTED = ["es", "en"];

// Recorre las preferencias del navegador en orden y se queda con la primera
// que sabemos pintar. Cualquier otro idioma (francés, alemán…) cae al inglés.
export function detectLanguage(nav = globalThis.navigator) {
  const preferred = [...(nav?.languages || []), nav?.language].filter(Boolean);
  for (const tag of preferred) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return "en";
}

export const LANG = detectLanguage();

// Etiqueta BCP 47 para `Intl`: con inglés se respeta la variante del
// navegador (en-GB escribe «4 Mar»), con español se mantiene es-ES.
const englishTag = () => {
  const nav = globalThis.navigator;
  const tag = [...(nav?.languages || []), nav?.language].find((value) => /^en\b/i.test(String(value || "")));
  return tag || "en-US";
};
export const LOCALE = LANG === "es" ? "es-ES" : englishTag();

const interpolate = (text, vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : text;

// `t("Hace {n} días", { n: 3 })`. La clave es la cadena española literal.
export function t(source, vars) {
  const text = LANG === "en" ? (EN[source] ?? source) : source;
  return interpolate(text, vars);
}

// Singular/plural: español e inglés comparten la regla (1 frente al resto).
export function tn(count, singular, plural, vars) {
  return t(count === 1 ? singular : plural, { n: count, ...vars });
}

// Traduce el HTML estático del dashboard: nodos de texto y los atributos que
// lee una persona. Se compara el texto sin espacios de borde y con los
// interiores colapsados; los bordes se conservan para no pegar palabras.
const ATTRIBUTES = ["title", "aria-label", "placeholder", "alt", "data-hint"];
const normalize = (value) => value.replace(/\s+/g, " ").trim();

export function translateDocument(doc = globalThis.document) {
  if (!doc?.documentElement) return;
  doc.documentElement.lang = LANG;
  if (LANG === "es" || typeof doc.createTreeWalker !== "function") return;
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("script, style")) continue;
    const key = normalize(node.nodeValue);
    if (!key || !(key in EN)) continue;
    const [lead] = node.nodeValue.match(/^\s*/);
    const [trail] = node.nodeValue.match(/\s*$/);
    node.nodeValue = `${lead}${EN[key]}${trail}`;
  }
  doc.querySelectorAll(ATTRIBUTES.map((name) => `[${name}]`).join(",")).forEach((element) => {
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      const key = normalize(value);
      if (key in EN) element.setAttribute(name, EN[key]);
    }
  });
  const title = normalize(doc.title || "");
  if (title in EN) doc.title = EN[title];
}
