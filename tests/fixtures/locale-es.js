// Las aserciones de la suite están en español, el idioma fuente. Node 22 trae
// su propio `navigator` con el idioma del sistema, así que se fija antes de que
// cualquier módulo importe `src/shared/i18n.js`. Se carga con `--import`.
Object.defineProperty(globalThis, "navigator", {
  value: { language: "es-ES", languages: ["es-ES", "es"] },
  configurable: true,
  writable: true,
});
