// Lista canónica de lo que ES la extensión.
//
// Fuente única para los dos scripts que la necesitan: `validate-extension.mjs`
// comprueba que todo esté presente y `package-extension.mjs` construye el ZIP
// de la tienda con exactamente esto. Mantener dos listas paralelas significaba,
// tarde o temprano, subir un paquete al que le falta un módulo.
//
// Es una lista blanca: tests, docs, planes y los propios scripts no viajan.
// Si añades un archivo de ejecución a la extensión, añádelo AQUÍ.
export const EXTENSION_FILES = [
  "manifest.json",
  "dashboard/index.html",
  "dashboard/styles.css",
  "dashboard/app.js",
  "dashboard/capture.js",
  "dashboard/privacy.js",
  "src/background.js",
  "src/shared/analytics.js",
  "src/shared/content-analytics.js",
  "src/providers/substack-api.js",
  "src/providers/substack-extended.js",
  "assets/icon.svg",
];

// Directorios que entran completos. `assets/icons` lo genera
// `npm run icons` a partir de assets/icon.svg.
export const EXTENSION_DIRECTORIES = ["assets/icons"];

// Tamaños que la Chrome Web Store espera en `icons` y `action.default_icon`.
// El de 128 es obligatorio: es el que se muestra en la ficha y en la
// instalación.
export const ICON_SIZES = [16, 32, 48, 128];

export const iconPath = (size) => `assets/icons/icon-${size}.png`;
