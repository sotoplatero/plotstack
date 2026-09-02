# Auditoría del dashboard — 19 ago 2026

> **Documento histórico.** Describe problemas y decisiones de la primera
> arquitectura; varias secciones ya no representan la interfaz actual. El
> contrato vigente y sus referencias están en
> [`dashboard-references.md`](dashboard-references.md). La implementación actual
> usa un Resumen con interacciones, Audiencia separada de Seguidores, una sola
> tabla de Notes y el historial completo de Publicaciones.

## Decisión de producto — 21 ago 2026

La segunda revisión cambia el objetivo de “mostrar toda cifra disponible” por
“responder una pregunta por vista”. La guía oficial actual de Substack separa el
estado de alto nivel (suscriptores, apertura y rendimiento reciente) del
diagnóstico en Growth y Posts; Growth conecta picos con publicaciones y compara
fuentes, mientras Posts conserva el detalle ordenable por pieza:

- https://support.substack.com/hc/en-us/articles/5320347155860-A-guide-to-Substack-metrics
- https://on.substack.com/p/dashboard

### Contrato final

- **Resumen:** tamaño de la audiencia, apertura, CTR y evolución. Se eliminan el
  `health-score` sin base empírica y el inventario de tipos de contenido.
- **Audiencia:** formación de la lista, altas diarias y composición.
- **Crecimiento:** fuentes, movimientos y publicaciones que explican picos.
- **Notas:** resultados, cadencia, ranking y detalle solo cuando existe dato.
- **Publicaciones:** rendimiento ordenable por envío y cortes editoriales.
- **Cobertura:** salud de las fuentes, no rendimiento de la newsletter.

Pago e ingreso mensual no desaparecen del producto: son opciones explícitas,
apagadas por defecto. Esto mantiene el dashboard útil para publicaciones pagas
sin convertir datos financieros en parte inevitable de una captura compartida.
El botón de cámara genera una composición limpia de la vista activa y siempre
oculta ambas categorías sensibles.

La documentación de Substack también permite ocultar estadísticas en su propio
Home desde Privacy. PlotStack adopta el mismo principio, pero con granularidad:
el escritor decide por separado si ve pago e ingresos.

Revisión de `dashboard/index.html`, `dashboard/app.js` y las fuentes de datos que
los alimentan. Los 43 tests pasan: nada de lo que sigue es un fallo de lógica
pura, son huecos de producto y de captura.

## 1. Veredicto

El dashboard tiene **6 vistas y 2 gráficos**. Todo lo demás son tablas, listas y
rejillas de cifras. La sensación de "desorganizado" no viene del CSS: viene de
que las vistas no comparten un contrato (ni rango temporal, ni delta, ni
jerarquía) y de que tres de ellas tienen un solo panel mientras Resumen carga
cinco.

Peor: hay datos que **ya se descargan, se normalizan y se guardan en
`chrome.storage`, y nunca se pintan**.

## 2. Datos capturados que nadie ve

| Fuente | Se guarda en | Se renderiza |
|---|---|---|
| `emails/timeseries` | `analytics.email.timeseries` | **No.** Cero referencias en `app.js` |
| `publication_export` | `analytics.exports` | **No.** Solo cuenta en Cobertura |
| `trend[].opens` | snapshot | **No.** Y nunca se rellena: los anchors solo escriben `subscribers`/`paidSubscribers` |
| `audience.history[].paidSubscribers` | `analytics.audience` | Solo como número suelto, no como serie |
| 27 campos de `campaigns` | snapshot | 14 en tabla, 27 en el CSV. El CSV tiene más datos que la UI |

`emails/timeseries` es exactamente la serie diaria que falta y ya está en disco.

## 3. Por qué "faltan datos"

### 3.1 La serie de suscriptores tiene 4 puntos, no 90

`getPublicationSnapshot` construye `trend` con **cuatro anchors** derivados de
`summary-v2?range=7|30|90`: hace 90 días, hace 30, hace 7 y hoy. El histórico
solo crece un punto por día en que el usuario sincroniza.

Consecuencia directa: los botones 7D/30D/90D filtran esos 4 puntos y devuelven
2, 3 y 4 puntos respectivamente. El "filtro por tiempo" es decorativo — cambia
el número de vértices de una polilínea, no la resolución del dato.

> **Corregido el 19 ago tras el volcado real.** Supuse que la serie diaria estaba
> escondida en el payload de `summary-v2`. **No lo está**: ese endpoint devuelve
> diez escalares y ninguna serie. Ver
> [`substack-payloads-observados.md`](substack-payloads-observados.md).
>
> La serie diaria sí existe, pero en otro sitio: cada fila de `subscriber-stats`
> trae `subscription_created_at`, así que agregando por día se reconstruye el
> histórico completo de altas desde el primer suscriptor. Eso es lo que
> `getSubscriberTimeline` hace ahora.
>
> Y `chartCounts` estaba peor de lo que decía este documento: no faltaban datos,
> se estaban **fabricando** 8 puntos falsos en cero. Detalle en el volcado.

### 3.2 Seguidores por día: bloqueado, con un sustituto real

`CLAUDE.md` ya documenta que la serie de seguidores está pendiente por falta de
endpoint observado. Eso sigue siendo cierto y no lo salto inventando una ruta.

Pero hay un dato equivalente **ya capturado**: `note_stats` devuelve
`results.followers` por nota, con fecha. Agregado por día da una serie de
*seguidores atribuidos a notas*, que es la palanca sobre la que el usuario puede
actuar. Es una serie honesta si se etiqueta como atribuida, no como total.

### 3.3 Las notas sin estadísticas: es rate limiting

Esta es la causa más probable del síntoma que reportas.

```js
const notesToRefresh = notes.filter((note, index) => index < 12 || !previousNotes.get(...)?.stats?.available);
const refreshedStats = await mapWithConcurrency(notesToRefresh, 5, (note) => requestJson(`${API_ROOT}/note_stats/${note.id}`));
```

Tres problemas encadenados:

1. **La condición nunca converge.** Una nota sin detalle se vuelve a pedir en
   *cada* sincronización, para siempre. Con un historial de cientos de notas,
   cada sync dispara cientos de peticiones.
2. **`mapWithConcurrency` no pausa.** Los paginadores hacen `pause(80)`; este no.
   Concurrencia 5 a saco contra `note_stats`.
3. **`requestJson` no reintenta el 429.** Lanza, `mapWithConcurrency` captura el
   rechazo, y el fallback es `normalizeNoteStats()` → `available: false`.

Resultado: se agota el límite, todo cae al fallback silencioso, y la tarjeta
muestra *"Estadísticas en proceso · Substack suele publicarlas dentro de las
primeras 24 horas"* — literalmente para una nota de hace dos años. El mensaje
miente y esconde el fallo real.

Además, `getNotesAnalytics` suma en el mismo total notas con detalle y notas sin
detalle (que aportan 0 en `profileVisits`, `saves`, `shares`, `linkClicks`,
`impressions`). "Interacciones acumuladas" mezcla dos poblaciones distintas sin
avisar — el mismo error que `content-analytics.js` evita deliberadamente.

### 3.4 Deltas que siempre mienten — **corregido**

- `previous.openRate = summary.openRate` — el mismo valor que `metrics.openRate`.
  El delta de apertura es **siempre 0,0%**.
- `previous.clickRate = 0` — el delta de clics es **siempre +100%**.
- `metrics.clickRate` es la media aritmética no ponderada del CTR de *todas* las
  publicaciones históricas. No es una métrica de periodo, y un envío a 30
  personas pesa igual que uno a 30.000.
- El benchmark "42%" está hardcodeado en el HTML, sin fuente.
- `health-score` usa constantes mágicas (`/60*65 + /8*20 + /10*15`) sin
  justificación documentada.

**Cómo quedó, tras confirmar los payloads:**

- **Apertura y CTR se calculan sobre la ventana activa** con `getRateWindows()`,
  ponderando por destinatarios entregados, y el delta compara con la ventana
  inmediatamente anterior del mismo tamaño. Si no hay ventana anterior o no hay
  envíos con destinatarios, dice *"Sin periodo anterior para comparar"* en lugar
  de fabricar un `+100%`.
- **`clickRate` del snapshot pasa a estar ponderado** (`weightedRate`). La media
  aritmética daba a un envío de 30 destinatarios el mismo peso que a uno de 3.000.
- **El benchmark del 42% ya no existe.** La barra se escala contra la **mediana de
  apertura de las propias publicaciones** (`getOwnOpenRateMedian`), que sí tiene
  fuente. Una referencia inventada es peor que ninguna.
- **`health-score`** mantiene los mismos pesos, pero como constantes nombradas y
  documentadas (`HEALTH_TARGETS`, `HEALTH_WEIGHTS`) y con cada tramo acotado. Ojo:
  sigue midiendo salud de por vida, no de la ventana activa.
- **`summary.subscribers` era un fallback envenenado.** Vale `0` en una cuenta de
  97 suscriptores; si `summary-v2` fallaba, el dashboard mostraba 0. Ahora cae a
  `summary.totalEmail`.
- **`trend[].opens` eliminado.** Campo del esquema que nada rellenaba nunca.
- **Los totales de Notas declaran que mezclan poblaciones.** Visitas al perfil,
  guardados, compartidos, clics e impresiones solo existen en las notas con
  estadísticas, y la UI ahora dice sobre cuántas de cuántas está sumando.
- **El CSV pasa de 27 a 19 columnas**: fuera las ocho que la API devuelve siempre
  en cero, dentro reacciones, comentarios y engagement, que sí traen dato.

## 4. Organización

- **El rango temporal solo existe en Resumen.** `setView()` hace
  `$("#range-control").hidden = state.view !== "resumen"`. Audiencia,
  Crecimiento, Notas y Publicaciones no tienen ningún filtro temporal.
- **La numeración `01 /`, `02 /` se reinicia por vista** y en Audiencia y
  Cobertura hay un único "01 /" que no ordena nada. En Resumen va de 01 a 05
  sobre paneles sin relación entre sí.
- **Vistas descompensadas:** Resumen 5 secciones, Notas 3, Crecimiento 3,
  Publicaciones 2, Audiencia 1, Cobertura 1.
- **Falta la vista Ingresos** que `full-analytics-scope.md` especifica como una de
  las 7. Hoy la monetización es una rejilla de `renderStatGrid`, que para
  cualquier clave no mapeada imprime `key.replace(/_/g, " ")`: **nombres de campo
  crudos de la API, en inglés, en una interfaz en español**.
- **Los gráficos no tienen eje X.** `drawLineChart` pinta 4 etiquetas en Y y cero
  en X. Un gráfico temporal sin fechas visibles. Tampoco hay hover ni tooltip.
- **La cadencia semanal es una lista** (`cadence-list`) cuando es el caso de uso
  canónico de un heatmap o de barras.

## 5. Referencias: cómo lo resuelven las plataformas sociales

**X / Twitter Analytics** organiza en pestañas Overview / Audience / Content /
Video / Live / Spaces sobre una ventana móvil de 28 días. Lo transferible:

1. **Un solo selector de rango, global, que aplica a todas las vistas.** No un
   control que aparece y desaparece según la pestaña.
2. **Cada KPI lleva su delta contra el periodo anterior comparable.** No contra
   una constante ni contra sí mismo.
3. **Cada tile es un punto de entrada:** clic en el KPI → serie temporal de esa
   métrica. Overview no es un muro de cifras, es un índice.
4. **Audience = crecimiento a lo largo del tiempo**, no un total. Es literalmente
   lo que pides: series diarias, no un contador.
5. **Content = tabla ordenable** con métricas por pieza. Esto ya lo tienes bien
   en Publicaciones; es la parte más sólida del dashboard actual.

Las guías de Hootsuite y Sprout Social coinciden en el conjunto núcleo:
impresiones, tasa de engagement, visitas al perfil, crecimiento de seguidores,
clics — **todo como serie, y todo con comparativa de periodo**. PlotStack tiene
casi todos esos números; los tiene como escalares.

## 6. Propuesta

### Fase 1 — Desbloquear el dato (sin esto, lo demás es maquillaje)

1. Volcar el payload completo de `summary-v2` y `subscriber-stats` desde la
   pestaña Network del panel autenticado y mapear la serie diaria real. Es la
   única vía compatible con la regla de no inventar endpoints.
2. Arreglar `note_stats`: `pause(80)` en `mapWithConcurrency`, reintento con
   backoff en el 429, y marcar una nota como *"sin estadísticas disponibles"*
   tras N intentos para que deje de reintentarse en cada sync.
3. Distinguir en la UI "estadísticas en proceso" (nota de <24 h) de "Substack no
   las devolvió" (todo lo demás) de "límite de peticiones alcanzado".
4. Corregir `previous.openRate` y `previous.clickRate`, y ponderar el CTR
   agregado por destinatarios.

### Fase 2 — Series y gráficos — **completada**

5. ~~Renderizar `email.timeseries`~~ → panel **02 / VOLUMEN DE ENVÍO** en
   Publicaciones. Payload confirmado: pares `["2026/07/21", 31]`, 30 días. El
   normalizador ahora pasa la fecha a ISO para que no la desplace un día.
6. ~~Audiencia: suscriptores/día + de pago/día + seguidores atribuidos~~ →
   acumulado, barras diarias con las altas de pago como tramo oscuro, y panel
   **03 / ATRIBUIDO A NOTAS** con `getNoteAttributionTimeline`. Solo suman las
   notas con `stats.available`, y la nota al pie declara la cobertura.
7. ~~Eje X, hover y tooltip~~ → `appendAxisLabels` compartido por línea y barras;
   `<title>` en cada punto y cada barra.
8. ~~Cadencia como heatmap día × hora~~ → `getCadenceHeatmap`, rejilla 7×24.
   `medianInteractions` es `null`, no `0`, cuando ninguna nota de la celda tiene
   estadísticas; el tooltip dice "sin estadísticas".

Extra que salió por el camino: las fechas `YYYY-MM-DD` se renderizaban un día
antes en zonas negativas (`new Date("2026-06-10")` es medianoche UTC). Corregido
con `parseDay()`; afectaba a Audiencia, notas y publicaciones.

### Fase 3 — Reorganizar — **completada**

9. ~~Selector de rango global~~ → vive en la topbar con una cuarta opción **Todo**,
   se persiste en `localStorage` y lo aplican Resumen, Audiencia, Crecimiento,
   Notas, Publicaciones e Ingresos. Solo Cobertura queda fuera: es estado de
   sincronización, no una serie. Notas y Publicaciones filtran de verdad su
   contenido, y **declaran cuántas filas quedaron fuera** — filtrar en silencio es
   peor que no filtrar.
10. ~~Séptima vista Ingresos + claves crudas~~ → vista con KPIs, conversión, tabla
    de planes reales e ingresos atribuidos a notas. `renderStatGrid` pasó a **lista
    blanca**: una clave sin etiqueta en español no se pinta, así que la API no
    puede volver a filtrar inglés crudo a la interfaz.
11. ~~Numeración en vistas de un solo panel~~ → fuera de Cobertura. Audiencia ya
    tiene cuatro paneles, así que ahí la numeración sí ordena.
12. ~~KPIs navegables~~ → los cuatro de Resumen entran en su vista (`data-goto`),
    con teclado además de ratón.

Lo que la captura de payloads destapó por el camino, en
[`substack-payloads-observados.md`](substack-payloads-observados.md):
`pledges/plans/summary` devolvía un array de planes que se tiraba entero,
`post_management/counts` usa `drafts` en plural y trae tres booleanos que se
pintaban como métricas, y **`payment_pledges` responde 400: nunca ha funcionado**.

## 7. Lo que no toco

- La serie total de seguidores y la retención por cohorte siguen bloqueadas por
  falta de endpoint observado. Documentado ya en `CLAUDE.md`; el sustituto
  atribuido de 3.2 no lo reemplaza, lo rodea.
- Los dominios personalizados siguen fuera del alcance v1.

Fuentes consultadas para la sección 5:
[Neal Schaffer](https://nealschaffer.com/twitter-analytics/) ·
[Hootsuite](https://blog.hootsuite.com/twitter-analytics-guide/) ·
[Sprout Social](https://sproutsocial.com/insights/twitter-analytics/) ·
[Dash Social](https://www.dashsocial.com/blog/x-analytics)
