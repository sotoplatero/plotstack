# Rigor estadístico y representación — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los errores de honestidad estadística del dashboard (eje X no temporal, deltas fabricados, medias sin ponderar, ceros que son ausencias) y consumir los datos ya sincronizados que hoy se tiran (atribución de notas, cohortes, composición, churn de pago, series por fuente).

**Architecture:** Todo ocurre en las tres capas existentes: `src/shared/analytics.js` (cálculo puro + tests unitarios), `src/shared/content-analytics.js` (tramos de cadencia), y `dashboard/app.js` + `index.html` + `styles.css` (render). Sin red nueva, sin endpoints nuevos, sin campos nuevos en el snapshot persistido — solo derivados en memoria.

**Tech Stack:** ES modules nativos, SVG manual, `node --test`. Sin dependencias.

**Spec:** el análisis crítico acordado en la conversación (2026-08-31). Puntos: eje X temporal, deltas honestos, cortes ponderados, ausencia≠0 en notas, sparkline honesto, ventanas por fecha, retención sin heurística por fila, apertura/CTR por envío, CTOR, ratio por nota, heatmap por tramos, atribución de notas, composición y actividad de audiencia, fuentes con rango declarado + sparkline, churn de pago, tasa de bajas, anotaciones de publicaciones, export de notas, eliminar doble cómputo.

## Global Constraints

- Todo texto de interfaz en español; locale `es-ES`.
- Fechas `YYYY-MM-DD` siempre por `parseDay()`, nunca `new Date(valor)` directo.
- `null` nunca es `0`; ningún cociente emite `Infinity`/`NaN` (helper `ratio()`).
- Muestra escasa se atenúa, nunca se oculta.
- Modelo mostrar/ocultar; `bindEvents()` corre una vez; ids estáticos en `index.html`.
- Ningún dato de pago/ingresos visible sin `data-sensitive`.
- No se añaden endpoints ni campos al snapshot persistido.
- Tras cada tarea: `npm test` en verde y commit no aplica (no es repo git): se valida con `npm test` + `npm run validate`.

---

### Task 1: Infraestructura de gráficos — eje X temporal, huecos y bajas visibles

**Files:** Modify `dashboard/app.js` (`drawLineChart`, `drawBarChart`, `appendAxisLabels`, `visibleTrend`, `renderChart`, `renderChurn`).

**Produces:** `drawLineChart(svg, points, gradientId, { baselineZero, secondary, events })` con x proporcional al tiempo cuando todos los puntos tienen fecha válida (fallback a índice); `drawBarChart` sin capar el segmento secundario y con `max` que incluye `secondary`; helper `fillDailyGaps(rows, makeZero)` que rellena días ausentes en series de eventos diarios (cero medido, documentado); `parseDay` en `visibleTrend`/`renderChart`.

- [x] x temporal: `const times = points.map(p => parseDay(p.date).getTime())`; si todos finitos y `span > 0`, `x(i) = left + (times[i]-t0)/span * innerWidth`; si no, índice.
- [x] `appendAxisLabels` recibe la función `x` en vez de recalcular por ratio.
- [x] `drawBarChart`: `max = Math.max(1, ...points.map(p => Math.max(p.value, p.secondary||0)))`; overlay sin `Math.min(secondary, value)`.
- [x] `fillDailyGaps(rows)` (solo días entre el primero y el último; usado por churn y por la serie de altas): inserta `{date, ...ceros}`.
- [x] "Mejor día" de Resumen: pico de `signups` de la serie diaria en ventana; si no hay serie diaria, "—" (nunca diffs entre puntos separados por semanas).
- [x] `npm test` verde.

### Task 2: Deltas honestos en Resumen

**Files:** Modify `src/shared/analytics.js` (`getDerivedMetrics`), `dashboard/app.js` (`setDelta`, `deltaMarkup`, `renderMetrics`), `tests/analytics.test.js`.

**Produces:** `change(current, prior)` devuelve `null` si `prior <= 0` (nunca fabrica +100%); `setDelta(selector, value, {suffix, versus})` acepta `null` → "Sin sincronización anterior para comparar"; los deltas de snapshot dicen "vs. sincronización anterior"; apertura sin fallback silencioso a `metrics.openRate` (si la ventana no tiene envíos → "Sin dato"); sparkline de suscriptores = altas diarias de la ventana escaladas desde 0 (se oculta sin serie).

- [x] Test unitario: `getDerivedMetrics` con `previous.subscribers = 0` → `subscriberGrowth === null`.
- [x] Implementación + render; barra de progreso de apertura con `openNow` null → ancho 0.
- [x] `npm test` verde.

### Task 3: Cortes de Publicaciones ponderados y con umbral de muestra

**Files:** Modify `src/shared/analytics.js` (nuevo `getCampaignCuts`, export `parseDay`, `MIN_CUT_N = 3`), `dashboard/app.js` (`renderPostCuts`, `renderRankedList` con `muted`), `dashboard/styles.css` (`.source-row.is-muted`), `tests/analytics.test.js`.

**Produces:** `getCampaignCuts(campaigns) => { byDay: [{day, posts, delivered, openRate, scarce}], byLength: [{band, posts, delivered, openRate, scarce}] }` — solo `delivered > 0`, tasa ponderada `Σopened/Σdelivered*100`, `scarce = posts < MIN_CUT_N`, día de la semana vía `parseDay`. `renderRankedList` acepta `entry.muted` → fila atenuada con "· muestra escasa".

- [x] Tests: ponderación (2 envíos 100/10000 entregados), exclusión `delivered=0`, `scarce`, día civil correcto para `"2026-06-10"` (martes, no lunes).
- [x] Implementación + render (etiquetas en español en el renderer).
- [x] `npm test` verde.

### Task 4: Publicaciones — apertura/CTR por envío, CTOR, mediana marcada

**Files:** Modify `dashboard/index.html` (panel `#posts-rate-panel` con `#posts-rate-chart`, `#posts-rate-empty`), `dashboard/app.js` (`POST_COLUMNS` + `ctor`, `renderCampaigns`, nuevo `renderPostRates`), `dashboard/styles.css` (`.chart-line-secondary`, `.is-above-median`, `.is-below-median`), `tests/dashboard-render.test.js` (th 11→12, nuevo panel).

**Produces:** gráfico temporal con dos líneas (apertura sólida, CTR discontinua, leyenda, baseline 0) sobre envíos con `delivered > 0`; columna CTOR = `clicked/opened*100` (null si `opened = 0` → "—"), derivada en memoria en `renderCampaigns` (no se persiste); celda de apertura marcada respecto a `getOwnOpenRateMedian`; CSV con CTOR.

- [x] `npm test` verde.

### Task 5: Notas — ausencia ≠ 0, ratio de interacción, export

**Files:** Modify `dashboard/index.html` (th "Ratio" en tabla de notas), `dashboard/app.js` (`renderNotesTable`, `exportCsv` por vista), `tests/dashboard-render.test.js`.

**Produces:** en notas sin `stats.available`, Impresiones/Ratio/Nuevos subs. muestran "—" con `title` según `fetchState` (pending "Estadísticas en proceso", throttled "Aplazado por límite de peticiones", unavailable "Substack no ofrece estadísticas de esta nota"); columna Ratio = interacciones/impresiones (%) vía `ratio()`; `exportCsv` exporta notas cuando `state.view === "notas"` y publicaciones en el resto.

- [x] `npm test` verde (colSpan 8→9).

### Task 6: Cadencia por tramos y atribución de notas

**Files:** Modify `src/shared/content-analytics.js` (`getCadenceHeatmap` añade `buckets` 7×4 y `busiestBucket`), `dashboard/app.js` (`renderCadenceHeatmap` sobre tramos, nuevo `renderAttribution`), `dashboard/index.html` (`#attribution-panel`, `#attribution-chart`, `#attribution-empty`, `#attribution-note`), `tests/content-analytics.test.js`, `tests/dashboard-render.test.js`.

**Produces:** `buckets: [{day, bucket: "night"|"morning"|"afternoon"|"evening", notes, scoredNotes, medianInteractions}]` calculados desde las horas crudas (las medianas no se re-derivan de medianas); heatmap 7×4 con etiquetas Madrugada/Mañana/Tarde/Noche; panel "Altas atribuidas a notas" con barras diarias de `freeSubscribers` desde `getNoteAttributionTimeline` (que por fin tiene consumidor) y nota de cobertura "sobre X de Y notas con estadísticas".

- [x] Test: nota a las 3:00 cae en `night`; mediana por tramo desde valores crudos; `busiestBucket`.
- [x] `npm test` verde.

### Task 7: Audiencia — composición y actividad de la lista

**Files:** Modify `dashboard/index.html` (`#composition-panel` con `data-sensitive="paid"`, `#engagement-panel` con `#engagement-bar` y `#engagement-legend`), `dashboard/app.js` (`renderAudience`), `dashboard/styles.css` (barra apilada), `tests/dashboard-render.test.js`.

**Produces:** composición (De pago, Fundadores, Regalo, Cortesía, Prueba gratuita, Mensuales, Anuales) vía `renderLabelledGrid`, panel entero sensible; barra apilada de actividad Alta/Baja/Inactiva con conteos (proporciones vía `ratio()`); si `timeline.partial`, la actividad declara sobre cuántos suscriptores se calcula.

- [x] `npm test` verde (panel sensible nace oculto — el test de sensibles lo cubre).

### Task 8: Crecimiento — periodo declarado, sparklines por fuente, churn de pago, tasa de bajas

**Files:** Modify `dashboard/index.html` (columna Tendencia; panel `#paid-churn-panel` `data-sensitive="paid"` con `#paid-churn-chart`, `#paid-churn-empty`, `#paid-churn-net`), `dashboard/app.js` (`renderSourcesTable`, `sourceRow`, extraer `buildChurnSeries`, nuevo `renderPaidChurn`, `renderChurn` añade tasa de bajas, `renderChart` añade marcas de publicación), `dashboard/styles.css`, `tests/dashboard-render.test.js`.

**Produces:** el badge del panel de fuentes declara "Últimos 12 meses (fijo)" — el selector de rango no lo gobierna y deja de fingir que sí; celda de sparkline por fuente desde `source.series`; churn de pago tras `data-sensitive` reutilizando la misma serie/gráfico que el gratuito; KPI "Tasa de bajas" = `ratio(bajas, suscriptores)*100`; marcas verticales de publicaciones (fechas de `snapshot.campaigns`) sobre el gráfico de crecimiento del Resumen con `title` = titular.

- [x] `npm test` verde.

### Task 9: Retención — unidad decidida a nivel de serie y curva completa

**Files:** Modify `dashboard/app.js` (`renderRetention`), `tests/dashboard-render.test.js`.

**Produces:** la decisión fracción/porcentaje se toma sobre la serie entera (si todas las tasas finitas ≤ 1 → fracción → ×100; si alguna > 1 → ya es porcentaje), nunca por fila — un 1% real deja de renderizarse como 100%; se listan todos los meses disponibles, no solo {1,3,6,12}.

- [x] `npm test` verde (fixture 0.82 → sigue mostrando 82,0%).

### Task 10: Ventanas por fecha y fin del doble cómputo

**Files:** Modify `dashboard/app.js` (`windowedSubscriberDaily`, `visibleTrend`, `renderDashboard`), `dashboard/index.html` (copy de `#chart-empty`).

**Produces:** `windowedSubscriberDaily` corta por fecha (`parseDay >= cutoff`), no por número de puntos; `visibleTrend` sin fallback `slice(-4)` — si el rango no tiene ≥2 puntos, estado vacío honesto ("Sin datos suficientes en el periodo seleccionado"); `renderDashboard` deja de calcular `getContentAnalytics` para todas las vistas (solo la vista Notas lo calcula, una vez, con rango); `state.content` eliminado.

- [x] `npm test` verde.

### Task 11: Cierre — suite completa, validate y documentación

**Files:** Modify `CLAUDE.md` (secciones de vistas/invariantes afectadas), run `npm test` y `npm run validate`.

- [x] Suite completa en verde; validate en verde.
- [x] CLAUDE.md actualizado: eje X temporal, cortes ponderados con `MIN_CUT_N`, panel de fuentes con periodo fijo declarado, atribución de notas con consumidor, retención con decisión de unidad por serie.
