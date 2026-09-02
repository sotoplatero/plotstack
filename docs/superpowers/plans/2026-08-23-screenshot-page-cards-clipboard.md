# Screenshot de página, cards y portapapeles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir guardar o copiar al portapapeles una captura PNG de la vista activa o de una card individual, sin que el dashboard visible cambie de tamaño o posición durante la captura.

**Architecture:** La preparación de privacidad y composición ocurrirá exclusivamente sobre un clon del elemento objetivo dentro de `dashboard/capture.js`; el DOM visible no recibirá la clase `is-capturing` ni se volverá a renderizar. `dashboard/app.js` coordinará un menú de cuatro acciones (guardar/copiar página y guardar/copiar card), y el modo card seleccionará un panel mediante delegación de eventos sin recrear nodos.

**Tech Stack:** Chrome Extension MV3, JavaScript ES modules, DOM/Canvas/SVG nativos, Clipboard API, `chrome.downloads`, Node.js test runner.

## Global Constraints

- “Capturar en memoria” significa copiar un PNG al portapapeles del sistema mediante `navigator.clipboard.write()` y `ClipboardItem`.
- Toda captura oculta `data-sensitive="paid"` y `data-sensitive="revenue"`, aunque esas métricas estén visibles en pantalla.
- Iniciar, completar o fallar una captura no cambia el scroll, el layout, la vista activa ni la visibilidad del DOM vivo.
- Se mantienen ES modules nativos, sin dependencias, build, bundler ni TypeScript.
- Los textos de interfaz y error permanecen en español.
- Las cards elegibles son `.metric-card`, `.panel` y `.note-card`; navegación, tablas sueltas, formularios y overlays no son objetivos.
- El repositorio actual no contiene `.git`; por ello cada tarea termina en un checkpoint verificable en vez de un commit imposible.

---

## File Structure

- `dashboard/capture.js`: crear el clon privado, rasterizarlo a PNG, copiar el blob al portapapeles y descargarlo.
- `dashboard/app.js`: controlar el menú, el modo de selección de card y los mensajes de éxito/error sin mutar el layout.
- `dashboard/index.html`: alojar el menú accesible de las cuatro acciones de captura.
- `dashboard/styles.css`: presentar el menú y resaltar cards seleccionables únicamente con `outline`, sin alterar dimensiones.
- `manifest.json`: declarar `clipboardWrite` para que la extensión pueda escribir el PNG.
- `tests/capture.test.js`: probar clon privado, selección de objetivos, portapapeles y nombres de archivo como unidades puras.
- `tests/dashboard-render.test.js`: comprobar que el menú real existe y que sus acciones se enlazan sin romper las seis vistas.
- `tests/fixtures/dom.js`: ampliar solo la superficie mínima requerida por las nuevas pruebas (`cloneNode`, `matches` y eventos de documento).
- `README.md`: documentar los cuatro flujos y la garantía de captura sin salto.

### Task 1: Motor de captura aislado y destinos PNG

**Files:**
- Modify: `dashboard/capture.js`
- Create: `tests/capture.test.js`
- Modify: `tests/fixtures/dom.js`

**Interfaces:**
- Consumes: un `Element` conectado y las APIs nativas `Canvas`, `ClipboardItem`, `navigator.clipboard` y `URL`.
- Produces: `createPrivateCaptureClone(element)`, `captureElementPng(element, options)`, `copyPngToClipboard(blob, options)`, `downloadPng(blob, filename, options)` y `captureFilename(publication, view, day, cardLabel)`.

- [ ] **Step 1: Extender el DOM de pruebas para clonar y reconocer una card**

Añadir a `Node` en `tests/fixtures/dom.js`:

```js
cloneNode(deep = false) {
  const copy = new Node(this.tagName.toLowerCase());
  copy.attributes = { ...this.attributes };
  copy.style = { ...this.style };
  copy.ownText = this.ownText;
  if (deep) copy.append(...this.children.map((child) => child.cloneNode(true)));
  return copy;
}
matches(selector) { return matches(this, selector); }
```

- [ ] **Step 2: Escribir pruebas fallidas del clon privado y las salidas**

Crear `tests/capture.test.js` con casos que demuestren que el clon se sanea y el original queda intacto:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDom } from "./fixtures/dom.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
installDom(join(root, "dashboard", "index.html"));
const {
  captureFilename,
  copyPngToClipboard,
  createPrivateCaptureClone,
} = await import("../dashboard/capture.js");

test("el clon de captura oculta sensibles sin tocar el DOM vivo", () => {
  const original = document.querySelector("#overview");
  const sensitive = document.querySelector("[data-sensitive]");
  sensitive.hidden = false;
  const clone = createPrivateCaptureClone(original);
  assert.equal(clone.querySelector("[data-sensitive]").hidden, true);
  assert.equal(sensitive.hidden, false);
  assert.equal(document.documentElement.classList.contains("is-capturing"), false);
});

test("copiar PNG escribe exactamente un ClipboardItem de imagen", async () => {
  const blob = new Blob(["png"], { type: "image/png" });
  const writes = [];
  class FakeClipboardItem { constructor(value) { this.value = value; } }
  await copyPngToClipboard(blob, {
    clipboard: { write: async (items) => writes.push(items) },
    ClipboardItemClass: FakeClipboardItem,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].value["image/png"], blob);
});

test("el nombre distingue página y card", () => {
  assert.equal(captureFilename("objeto", "resumen", "2026-08-23"), "plotstack-objeto-resumen-2026-08-23.png");
  assert.equal(captureFilename("objeto", "resumen", "2026-08-23", "Apertura media"), "plotstack-objeto-resumen-apertura-media-2026-08-23.png");
});
```

- [ ] **Step 3: Ejecutar las pruebas para verificar que fallan**

Run: `node --test tests/capture.test.js`

Expected: FAIL porque `createPrivateCaptureClone`, `copyPngToClipboard` y `captureFilename` todavía no se exportan.

- [ ] **Step 4: Separar clon, rasterización, portapapeles y descarga**

Implementar en `dashboard/capture.js` estas fronteras:

```js
export function createPrivateCaptureClone(element) {
  if (!element) throw new Error("No se encontró el contenido para capturar.");
  const clone = element.cloneNode(true);
  clone.querySelectorAll("[data-sensitive]").forEach((node) => { node.hidden = true; });
  clone.querySelectorAll("[aria-expanded]").forEach((node) => node.setAttribute("aria-expanded", "false"));
  clone.querySelectorAll(".capture-menu, .toast").forEach((node) => { node.hidden = true; });
  clone.classList.remove("is-capture-target");
  clone.setAttribute("xmlns", XHTML_NS);
  return clone;
}

export async function copyPngToClipboard(blob, {
  clipboard = navigator.clipboard,
  ClipboardItemClass = ClipboardItem,
} = {}) {
  if (!clipboard?.write || !ClipboardItemClass) {
    throw new Error("El portapapeles de imágenes no está disponible en este navegador.");
  }
  await clipboard.write([new ClipboardItemClass({ "image/png": blob })]);
}

export async function downloadPng(blob, filename, {
  downloads = chrome.downloads,
  urlApi = URL,
  documentRoot = document,
} = {}) {
  const url = urlApi.createObjectURL(blob);
  try {
    if (downloads?.download) {
      await downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
    } else {
      const link = documentRoot.createElement("a");
      link.href = url;
      link.download = filename;
      documentRoot.body.append(link);
      link.click();
      link.remove();
    }
  } finally {
    setTimeout(() => urlApi.revokeObjectURL(url), 60000);
  }
}

const slug = (value) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const captureFilename = (publication, view, day, cardLabel = "") =>
  ["plotstack", publication || "dashboard", view, cardLabel, day]
    .filter(Boolean).map(slug).join("-") + ".png";
```

Modificar `captureElementPng()` para medir el elemento vivo una sola vez, llamar `createPrivateCaptureClone(element)` y serializar solo ese clon. No añadir clases al `document.documentElement`, no modificar `hidden` en el original y no llamar ningún renderer.

- [ ] **Step 5: Ejecutar las pruebas unitarias y la suite completa**

Run: `node --test tests/capture.test.js`

Expected: PASS con 3 tests.

Run: `npm test`

Expected: PASS sin regresiones.

### Task 2: Menú de página/card y selección sin salto

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/styles.css`
- Modify: `dashboard/app.js`
- Modify: `tests/dashboard-render.test.js`

**Interfaces:**
- Consumes: `captureElementPng`, `copyPngToClipboard`, `downloadPng` y `captureFilename` de Task 1.
- Produces: `findCaptureCard(element)`, `runCapture({ target, destination, label })`, `beginCardCapture(destination)` y cuatro botones estáticos `data-capture-action`.

- [ ] **Step 1: Añadir pruebas fallidas del menú real**

Añadir a `tests/dashboard-render.test.js`:

```js
test("el menú de captura ofrece página y card para guardar o copiar", async () => {
  await arrancar();
  const actions = $$("[data-capture-action]").map((node) => node.attributes["data-capture-action"]);
  assert.deepEqual(actions.sort(), ["copy-card", "copy-page", "download-card", "download-page"]);
  assert.equal($("#capture-menu").hidden, true);
  $("#capture-button").click();
  assert.equal($("#capture-menu").hidden, false);
  assert.equal($("#capture-button").attributes["aria-expanded"], "true");
});
```

- [ ] **Step 2: Ejecutar la prueba y verificar que falla**

Run: `node --test tests/dashboard-render.test.js --test-name-pattern "menú de captura"`

Expected: FAIL porque no existe `#capture-menu` ni `data-capture-action`.

- [ ] **Step 3: Crear el menú accesible con cuatro acciones**

En `dashboard/index.html`, envolver el botón actual en `.capture-control`, añadir `aria-expanded="false"` y este menú hermano:

```html
<div class="capture-menu" id="capture-menu" hidden>
  <strong>Capturar</strong>
  <button type="button" data-capture-action="download-page"><span>Página completa</span><small>Guardar PNG</small></button>
  <button type="button" data-capture-action="copy-page"><span>Página completa</span><small>Copiar al portapapeles</small></button>
  <button type="button" data-capture-action="download-card"><span>Una tarjeta</span><small>Elegir y guardar PNG</small></button>
  <button type="button" data-capture-action="copy-card"><span>Una tarjeta</span><small>Elegir y copiar</small></button>
</div>
```

- [ ] **Step 4: Estilizar menú y selección sin modificar la geometría**

Añadir a `dashboard/styles.css`:

```css
.capture-control { position: relative; }
.capture-menu { position: absolute; z-index: 30; top: calc(100% + 10px); right: 0; width: 250px; padding: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: 12px 12px 0 rgba(0,0,0,.18); }
.capture-menu > strong { display: block; padding: 6px 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; }
.capture-menu button { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 10px 8px; color: var(--paper); background: transparent; border: 0; text-align: left; }
.capture-menu button:hover, .capture-menu button:focus-visible { color: var(--accent); outline: 1px solid var(--accent); }
.capture-menu small { color: var(--muted); }
html.is-selecting-capture-card .metric-card,
html.is-selecting-capture-card .panel,
html.is-selecting-capture-card .note-card { cursor: crosshair; outline: 1px dashed var(--accent); outline-offset: -5px; }
html.is-selecting-capture-card .metric-card:hover,
html.is-selecting-capture-card .panel:hover,
html.is-selecting-capture-card .note-card:hover { outline: 3px solid var(--accent); }
```

Usar `outline`, no `border`, padding ni cambio de `display`, para que activar el modo de selección no produzca salto.

- [ ] **Step 5: Implementar selección de card y una única tubería de salida**

En `dashboard/app.js`, importar las cuatro funciones de Task 1 y sustituir `captureDashboard()` por una coordinación que nunca llame `renderDashboard()`:

```js
const CAPTURE_CARD_CLASSES = ["metric-card", "panel", "note-card"];

export function findCaptureCard(element) {
  for (let node = element; node && node !== document.body; node = node.parentNode) {
    if (CAPTURE_CARD_CLASSES.some((name) => node.classList?.contains(name))) return node;
  }
  return null;
}

const captureLabel = (element) =>
  element.querySelector("h2, .card-label, .note-body")?.textContent?.trim().slice(0, 60) || "tarjeta";

async function runCapture({ target, destination, label = "" }) {
  if (state.capturing) return;
  state.capturing = true;
  $("#capture-button").disabled = true;
  try {
    const blob = await captureElementPng(target, { theme: document.documentElement.dataset.theme || "ink" });
    const day = new Date().toISOString().slice(0, 10);
    const publication = state.connection?.publication?.subdomain || "dashboard";
    const filename = captureFilename(publication, state.view, day, label);
    if (destination === "copy") await copyPngToClipboard(blob);
    else await downloadPng(blob, filename);
    showToast(destination === "copy"
      ? "Captura copiada al portapapeles sin datos sensibles."
      : "Captura guardada sin datos sensibles.");
  } catch (error) {
    showToast(error.message || "No se pudo completar la captura.");
  } finally {
    state.capturing = false;
    $("#capture-button").disabled = false;
  }
}
```

El botón principal alterna `#capture-menu`. `download-page` y `copy-page` pasan `#overview` a `runCapture`. `download-card` y `copy-card` activan `html.is-selecting-capture-card`, muestran “Elige una tarjeta” y esperan el siguiente click delegado; Escape y un click fuera de una card cancelan limpiamente. El click que elige una card debe llamar `preventDefault()` y `stopPropagation()` para no navegar mediante `data-goto`.

- [ ] **Step 6: Proteger la privacidad del total de altas de notas**

En `renderNotesTable()`, no sumar pago dentro de un string indistinguible. Renderizar el total gratuito como texto y el incremento de pago en un `span data-sensitive="paid"`; `createPrivateCaptureClone()` lo ocultará aunque esté visible en el dashboard:

```js
const free = document.createElement("span");
free.textContent = formatCompactNumber(results.freeSubscribers);
cell.append(free);
if (state.sensitive.paid && results.paidSubscribers) {
  const paid = document.createElement("span");
  paid.dataset.sensitive = "paid";
  paid.textContent = ` + ${formatCompactNumber(results.paidSubscribers)}`;
  cell.append(paid);
}
```

Eliminar la dependencia `!state.capturing` de este renderer: capturar ya no modifica el estado visual.

- [ ] **Step 7: Ejecutar pruebas de interfaz y suite completa**

Run: `node --test tests/dashboard-render.test.js`

Expected: PASS, incluido el menú con cuatro acciones.

Run: `npm test`

Expected: PASS en todos los archivos.

### Task 3: Permiso, documentación y verificación visual

**Files:**
- Modify: `manifest.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: los cuatro flujos terminados de Task 2.
- Produces: permiso MV3 funcional, instrucciones para el usuario y evidencia manual de ausencia de salto.

- [ ] **Step 1: Declarar acceso de escritura al portapapeles**

Cambiar la lista de permisos en `manifest.json` a:

```json
"permissions": ["storage", "tabs", "cookies", "downloads", "clipboardWrite"]
```

- [ ] **Step 2: Documentar los cuatro flujos**

Actualizar la sección de privacidad/captura de `README.md` con:

```markdown
- **Página → Guardar PNG:** descarga la vista activa completa.
- **Página → Copiar:** deja el PNG en el portapapeles para pegarlo en un mensaje o documento.
- **Tarjeta → Guardar PNG:** activa el selector y descarga únicamente la card elegida.
- **Tarjeta → Copiar:** activa el selector y copia únicamente la card elegida.

La captura se genera desde una copia aislada de la interfaz: la página visible no se desplaza ni cambia de tamaño. Pago e ingresos se eliminan siempre de esa copia.
```

- [ ] **Step 3: Validar archivos y manifest**

Run: `npm run validate`

Expected: `Extension validation passed.`

Run: `npm test`

Expected: PASS en toda la suite.

- [ ] **Step 4: Verificar manualmente en Chrome**

Recargar la extensión desde `chrome://extensions`, abrir PlotStack y comprobar:

1. Con scroll intermedio en cada una de las seis vistas, abrir el menú y guardar la página; el scroll y la barra lateral no se mueven.
2. Copiar la página y pegarla en un editor compatible; el PNG aparece completo.
3. Elegir “Una tarjeta → Guardar PNG”, pasar el puntero por varias cards y capturar una; el archivo contiene solo esa card.
4. Elegir “Una tarjeta → Copiar”, capturar una card y pegarla; el portapapeles contiene solo esa card.
5. Activar pago e ingresos, repetir página y card en ambos destinos y confirmar visualmente que ninguna cifra sensible aparece.
6. Pulsar Escape durante la selección y confirmar que desaparecen los contornos sin iniciar una captura.

## Self-Review

- Cobertura: portapapeles está en Tasks 1–3; salto en Tasks 1–2; página y cards en Task 2; privacidad en Tasks 1–2.
- No se añade backend, dependencia ni endpoint.
- Las firmas usadas en `app.js` coinciden con las exportadas por `capture.js`.
- El flujo conserva listeners sobre ids estáticos y no destruye/recrea controles.
