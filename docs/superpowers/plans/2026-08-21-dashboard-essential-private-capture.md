# Dashboard esencial, privado y compartible — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir PlotStack en un dashboard de Substack completo pero enfocado, con métricas financieras optativas y capturas PNG privadas de la vista activa.

**Architecture:** Mantener la extensión MV3 sin dependencias ni backend. La interfaz guarda preferencias no sensibles en `localStorage`, aplica visibilidad mediante atributos `data-sensitive`, y solicita al service worker capturas de la pestaña visible para componer un PNG de página completa en el dashboard. El resumen conserva solo señales que ayudan a decidir: tamaño/tendencia de audiencia, apertura, clics, crecimiento y pulso editorial; pago e ingresos aparecen únicamente por elección explícita.

**Tech Stack:** Chrome Extension MV3, JavaScript ES modules, HTML/CSS nativos, `chrome.tabs.captureVisibleTab`, Node.js test runner.

## Global Constraints

- Todo el texto de interfaz, mensajes de error y documentación permanece en español.
- No se añade backend, bundler ni dependencia de runtime.
- Pago e ingresos están ocultos por defecto y toda captura los oculta aunque estén visibles en pantalla.
- Un fallo de captura no cambia el estado del dashboard ni expone datos sensibles.
- Las preferencias viven en `localStorage`; las métricas agregadas siguen en `chrome.storage.local`.

---

### Task 1: Contrato de privacidad y preferencias

**Files:**
- Create: `dashboard/privacy.js`
- Create: `tests/dashboard-privacy.test.js`
- Modify: `dashboard/app.js`

**Interfaces:**
- Consumes: claves opcionales `plotstack.showPaid` y `plotstack.showRevenue` de `localStorage`.
- Produces: `readSensitivePreferences(storage)`, `writeSensitivePreference(storage, key, value)` y `applySensitiveVisibility(root, preferences, { capture })`.

- [ ] **Step 1: Escribir pruebas fallidas para valores por defecto, persistencia y modo captura**

```js
assert.deepEqual(readSensitivePreferences(storage), { paid: false, revenue: false });
writeSensitivePreference(storage, "paid", true);
assert.equal(storage.getItem("plotstack.showPaid"), "true");
assert.equal(sensitiveVisibility("paid", { paid: true, revenue: true }, true), false);
```

- [ ] **Step 2: Ejecutar la prueba y verificar que falla por módulo inexistente**

Run: `node --test tests/dashboard-privacy.test.js`
Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar el módulo puro y conectarlo al estado del dashboard**

```js
export const DEFAULT_SENSITIVE_PREFERENCES = Object.freeze({ paid: false, revenue: false });
export const sensitiveVisibility = (kind, preferences, capture = false) => !capture && Boolean(preferences[kind]);
```

- [ ] **Step 4: Ejecutar la prueba y verificar que pasa**

Run: `node --test tests/dashboard-privacy.test.js`
Expected: PASS.

### Task 2: Controles privados y resumen necesario

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/styles.css`
- Modify: `dashboard/app.js`

**Interfaces:**
- Consumes: `state.sensitive` y `applySensitiveVisibility` de Task 1.
- Produces: popover `#privacy-menu`, interruptores `#show-paid`/`#show-revenue`, KPI optativo `#metric-revenue` y atributos `data-sensitive="paid|revenue"`.

- [ ] **Step 1: Añadir un menú compacto de privacidad a la barra superior**

```html
<button id="privacy-button" aria-expanded="false" aria-controls="privacy-menu">Privacidad</button>
<div id="privacy-menu" hidden>…interruptores de pago e ingresos…</div>
```

- [ ] **Step 2: Marcar todas las cifras explícitas de pago y crear el KPI mensual optativo**

```html
<article class="metric-card" data-sensitive="revenue">
  <p class="metric-value" id="metric-revenue">—</p>
</article>
```

- [ ] **Step 3: Renderizar ingresos y hacer que el pulso no dependa de conversión cuando pago está oculto**

```js
$("#metric-revenue").textContent = formatCurrency(metrics.monthlyRevenue);
document.documentElement.dataset.sensitivePaid = String(state.sensitive.paid);
```

- [ ] **Step 4: Añadir estilos responsivos y estados accesibles de los interruptores**

```css
.privacy-menu { position: absolute; inset: calc(100% + 8px) 0 auto auto; }
[data-sensitive][hidden] { display: none !important; }
```

### Task 3: Captura PNG privada de la vista activa

**Files:**
- Modify: `manifest.json`
- Modify: `src/background.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/styles.css`
- Modify: `dashboard/app.js`
- Modify: `tests/background.test.js`

**Interfaces:**
- Consumes: mensaje `PLOTSTACK_CAPTURE_VISIBLE`, `sender.tab.windowId`, viewport y altura de la vista activa.
- Produces: `{ dataUrl }` por segmento y descarga `plotstack-<publicacion>-<vista>-YYYY-MM-DD.png`.

- [ ] **Step 1: Añadir prueba del mensaje de captura en el service worker**

```js
const result = await send({ type: "PLOTSTACK_CAPTURE_VISIBLE" }, { tab: { windowId: 3 } });
assert.equal(result.ok, true);
assert.match(result.dataUrl, /^data:image\/png/);
```

- [ ] **Step 2: Declarar `activeTab` y capturar únicamente la ventana que envía el mensaje**

```js
PLOTSTACK_CAPTURE_VISIBLE: () => chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "png" }).then((dataUrl) => ({ dataUrl })),
```

- [ ] **Step 3: Añadir el botón Capturar y un modo de composición sin navegación ni controles**

```css
html.is-capturing .sidebar, html.is-capturing .topbar { display: none; }
html.is-capturing .shell { display: block; }
```

- [ ] **Step 4: Recorrer la vista, capturar segmentos, coserlos en canvas y descargar el PNG**

```js
for (const top of capturePositions(scrollHeight, innerHeight)) {
  scrollTo(0, top);
  const { dataUrl } = await sendMessage("PLOTSTACK_CAPTURE_VISIBLE");
  // dibujar el segmento a escala de dispositivo en el canvas final
}
```

- [ ] **Step 5: Restaurar scroll, visibilidad y controles en `finally`**

```js
finally {
  document.documentElement.classList.remove("is-capturing");
  applyPrivacy();
  scrollTo(0, previousScrollY);
}
```

### Task 4: Auditoría, documentación y verificación visual

**Files:**
- Modify: `docs/product/auditoria-dashboard.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: resultado funcional de Tasks 1-3 y fuentes oficiales de Substack.
- Produces: criterio de producto actualizado, comandos de verificación y evidencia visual local.

- [ ] **Step 1: Documentar la jerarquía final y las razones para excluir métricas decorativas**

```markdown
Resumen responde cuatro preguntas: cuánto crece, si se abre, si genera acción y qué contenido lo explica.
```

- [ ] **Step 2: Ejecutar la suite y el validador**

Run: `npm test && npm run validate`
Expected: todos los tests PASS y `Manifest V3 válido`.

- [ ] **Step 3: Cargar la extensión y verificar Resumen, preferencias y captura con datos de muestra/estado disponible**

Run: `agent-browser open chrome-extension://<id>/dashboard/index.html`
Expected: pago e ingresos ocultos inicialmente, controles operables y PNG descargado sin datos sensibles.

- [ ] **Step 4: Revisar el PNG y corregir cualquier corte, solapamiento o control visible**

Run: `agent-browser screenshot --full <ruta-evidencia>`
Expected: composición editorial limpia, sin sidebar/topbar ni tarjetas sensibles.

