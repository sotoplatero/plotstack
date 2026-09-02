# Dashboard orientado a contenido — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar PlotStack alrededor del rendimiento de publicaciones, Notas y audiencia, eliminando paneles ambiguos, vacíos y duplicados.

**Architecture:** El Resumen combina tres bloques: audiencia, interacciones de publicaciones e interacciones de Notas. Audiencia separa suscriptores y seguidores sin inventar históricos; Notas usa una sola tabla ordenable en lugar de ranking más tarjetas; Publicaciones siempre muestra el histórico completo. Los cálculos de periodo viven en helpers puros de `src/shared/analytics.js`.

**Tech Stack:** JavaScript ES modules, DOM/CSS nativos, Chrome Extension MV3, Node.js test runner.

## Global Constraints

- No fabricar series ni atribuciones que Substack no devuelva.
- Todo texto visible debe ser descriptivo y directo, sin títulos metafóricos.
- Publicaciones debe mostrar todas las filas sincronizadas, independientemente del rango global.
- Pago e ingresos continúan optativos y ocultos en capturas.
- Ningún cambio añade dependencias de runtime.

---

### Task 1: Resúmenes de contenido por periodo

**Files:**
- Modify: `src/shared/analytics.js`
- Modify: `tests/analytics.test.js`
- Modify: `dashboard/app.js`

**Interfaces:**
- Produces: `getPublicationEngagement(snapshot, days, now)` con publicaciones, vistas, reacciones, comentarios, compartidos e interacciones.
- Produces: `getNotesEngagement(snapshot, days, now)` con notas, likes, comentarios, restacks, impresiones e interacciones.

- [x] **Step 1: Probar agregación y ventana temporal**

```js
assert.deepEqual(getPublicationEngagement(snapshot, 30, now), {
  posts: 2, views: 300, reactions: 12, comments: 4, shares: 3, interactions: 19,
});
```

- [x] **Step 2: Implementar filtros de periodo que conserven filas sin fecha**

```js
const inPeriod = (date, days, now) => !Number.isFinite(days) || !date || new Date(date).getTime() >= now - days * 86400000;
```

- [x] **Step 3: Ejecutar `node --test tests/analytics.test.js`**

Expected: PASS.

### Task 2: Resumen con publicaciones y Notas

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/app.js`
- Modify: `dashboard/styles.css`

**Interfaces:**
- Consumes: helpers de Task 1.
- Produces: `#summary-posts` y `#summary-notes`, cada uno con métricas explícitas y acceso a su vista detallada.

- [x] **Step 1: Añadir dos paneles compactos después de crecimiento**

```html
<section class="content-summary-grid">
  <article id="summary-posts">…Interacciones, reacciones, comentarios, compartidos…</article>
  <article id="summary-notes">…Notas, likes, comentarios, restacks…</article>
</section>
```

- [x] **Step 2: Renderizar ambos paneles con la ventana activa**

```js
renderSummaryContent(snapshot);
```

- [x] **Step 3: Verificar que cada tarjeta navega a Publicaciones o Notas**

Expected: click y teclado cambian a la vista correspondiente.

### Task 3: Audiencia honesta y sin paneles vacíos

**Files:**
- Modify: `src/providers/substack-api.js`
- Modify: `src/shared/analytics.js`
- Modify: `tests/analytics.test.js`
- Modify: `tests/substack-api.test.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/app.js`

**Interfaces:**
- Produces: `trend[].followers` capturado únicamente en sincronizaciones reales.
- Elimina: panel de atribución de Notas y composición ambigua.
- Añade: gráfico `#followers-chart` con estado vacío honesto hasta tener dos capturas.

- [x] **Step 1: Probar persistencia de seguidores en el histórico**

```js
assert.equal(snapshot.trend.at(-1).followers, 162);
```

- [x] **Step 2: Guardar seguidores solo en el punto del día actual**

```js
{ date: today, subscribers: currentSubscribers, paidSubscribers: currentPaid, followers: currentFollowers }
```

- [x] **Step 3: Sustituir los paneles ambiguos por Suscriptores, Altas por día y Seguidores**

Expected: nunca se muestra un gráfico de seguidores con ceros inventados.

### Task 4: Notas sin duplicar ranking y detalle

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/app.js`
- Modify: `dashboard/styles.css`

**Interfaces:**
- Elimina: `#top-notes-panel`, `#notes-intelligence-grid`, filtro por rasgos y tarjetas de detalle.
- Produce: tabla `#notes-table-body`, búsqueda `#notes-search` y orden `#notes-sort`.
- Produce: tabla semanal `#cadence-table-body` con semana, notas, interacciones y promedio.

- [x] **Step 1: Convertir el encabezado de Notas en una tira de métricas**

```html
<h2>Notas</h2>
<div>Notas · Interacciones · Likes · Comentarios · Restacks · Impresiones</div>
```

- [x] **Step 2: Reemplazar Ranking y Detalle por una sola tabla ordenable**

```html
<select id="notes-sort"><option value="interactions">Más interacciones</option><option value="date">Más recientes</option></select>
```

- [x] **Step 3: Convertir volumen semanal en una tabla con barras dentro de celda**

Expected: las últimas 12 semanas se comparan sin depender de longitud visual libre.

### Task 5: Publicaciones completas y lenguaje directo

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/app.js`
- Modify: `dashboard/styles.css`
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Publicaciones consume siempre `snapshot.campaigns` completo.
- `RANGE_AWARE_VIEWS` deja fuera `publicaciones`.

- [x] **Step 1: Eliminar el filtro temporal de la tabla de publicaciones**

```js
const all = snapshot.campaigns;
```

- [x] **Step 2: Reescribir encabezados como sustantivos descriptivos**

Expected: “Audiencia”, “Seguidores”, “Cadencia”, “Publicaciones”, sin frases interpretativas.

- [x] **Step 3: Ejecutar suite, validación y revisión visual**

Run: `npm test; npm run validate`
Expected: todos los tests PASS, manifest válido y cero selectores estáticos ausentes.
