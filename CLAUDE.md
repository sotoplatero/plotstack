# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```powershell
npm test                                  # node --test sobre tests/*.test.js
node --test tests/substack-api.test.js    # un solo archivo de test
node --test --test-name-pattern "notas"   # un solo test por nombre
npm run validate                          # comprueba manifest + archivos referenciados
npm run icons                             # regenera assets/icons/*.png desde assets/icon.svg
npm run package                           # valida y escribe dist/plotstack-<versión>.zip
```

Los PNG de `assets/icons/` **se generan**, no se editan: `assets/icon.svg` es la
fuente de verdad y `scripts/generate-icons.mjs` la rasteriza a mano (sin
dependencias). Si cambia el logotipo, hay que actualizar `SHAPES` en ese script
y volver a ejecutar `npm run icons`.

No hay build, bundler ni dependencias de runtime: el código se carga tal cual como extensión descomprimida. Tras editar, hay que pulsar **Actualizar** en `chrome://extensions`.

## Arquitectura

Extensión Chrome MV3 sin backend. Todo el trabajo de red ocurre en el service worker con `credentials: "include"`, de modo que Chrome adjunta la cookie de sesión de Substack desde su propio almacén; los valores de cookie nunca se leen ni se guardan (solo se comprueba la *existencia* de `substack.sid`/`connect.sid` vía `chrome.cookies`).

Flujo de datos:

```
dashboard/app.js  --chrome.runtime.sendMessage-->  src/background.js
        ^                                               |
        |                    FASE 1 (rápida, responde el mensaje):
        |                      getCoreSnapshot()      · substack-api.js
        |                      getExtendedAnalytics() · substack-extended.js
        |                                               |
        |                    FASE 2 (detalle, en segundo plano):
        |                      enrichSnapshot()       · substack-api.js
        |                                               |
        |                          src/shared/analytics.js (normalizeSnapshot)
        |                                               |
        +---- chrome.storage.onChanged ---------  chrome.storage.local
```

- **`src/background.js`** — único punto que toca la red y el almacenamiento. Gestiona conexión, sincronización y desconexión. Persiste **cuatro** claves: `plotstack.snapshot`, `plotstack.connection`, `plotstack.analytics` y `plotstack.progress`. Orquesta las dos fases (responde tras la rápida, sigue con la de detalle sin bloquear), garantiza **un solo sync en vuelo** (`syncInFlight`) y registra la alarma diaria `plotstack-daily` (permiso `alarms`).
- **`src/providers/substack-api.js`** — partido en dos: `getCoreSnapshot()` trae escalares y listas (summary/summary-v2/email_stats/posts) y devuelve un snapshot ya pintable más un `context` en memoria con las filas crudas; `enrichSnapshot()` resuelve lo caro (detalle por post, feed de notas, cola de `note_stats`) e informa por `onProgress`. `getPublicationSnapshot()` sigue existiendo como composición de las dos. **Todas** las peticiones pasan por un limitador único de 4 simultáneas con 60 ms de hueco (`configureRequestLimiter` lo desactiva en tests).
- **`src/providers/substack-extended.js`** — **nueve** claves de datos con **ocho** peticiones: `subscriberTimeline`, `growthSources`, `followerTimeseries`, `audienceLocation`, `freeSubscriberGrowth`, `paidSubscriberGrowth`, `freeRetention`, `paidRetention`, y `audience`, que **no tiene petición propia**: sus conteos salen de `audienceCounts`, la copia sin PII (`count` + `chartCounts`) que devuelve la primera página de la timeline. Pedirlo aparte con `limit: 1` era un duplicado exacto en cada sync. Se retiraron seis (red 500, recomendaciones 400, payment_pledges 400, planes, inventario y exportaciones) porque no alimentaban ningún renderer. **Una fuente sin consumidor no se sincroniza.** Cada una tiene `request` + `normalize`; se ejecutan con `Promise.allSettled` y producen un array `coverage` que el dashboard muestra en el panel **Cobertura**.
- **`src/shared/analytics.js`** — capa de saneado y formato, compartida entre service worker y dashboard (importada por ruta relativa `../src/shared/`). `normalizeSnapshot()` define el esquema persistido; los formatters usan locale `es-ES`.
- **`src/shared/content-analytics.js`** — módulo puro, sin red y sin persistencia. **`getContentFindings()` y la tabla de rasgos se retiraron de la interfaz** (el análisis por medianas no era útil con pocas notas; se sustituirá por IA). Siguen exportadas y con tests, pero **ningún renderer las consume**. Lo que el dashboard sí usa, a través de la fachada `getContentAnalytics()`: `getCadenceHeatmap` (que además de las 168 celdas horarias expone `buckets`, la rejilla 7×4 por tramos que es la que se pinta; las medianas de tramo salen de los valores crudos, nunca de re-derivar medianas) y `getNoteAttributionTimeline` (panel "Altas atribuidas a notas" de la vista Notas).
- **`dashboard/`** — página completa (no popup), DOM manual sin framework. `app.js` mantiene `state` en memoria y despacha **una sola vista** por render.

## Las seis vistas del dashboard

`dashboard/index.html` contiene seis `div.view[data-view]` dentro de `.content`;
la barra lateral son `button.nav-item[data-view]` y `setView()` alterna el
atributo `hidden`. `VIEW_RENDERERS` en `app.js` asocia cada vista con sus
funciones de render, y `renderDashboard()` ejecuta solo las de la vista activa.

Vistas: `resumen`, `audiencia`, `crecimiento`, `notas`, `publicaciones`,
`cobertura`. `bindEvents()` engancha además `chrome.storage.onChanged`: la fase
de detalle escribe el snapshot desde el service worker y el dashboard se repinta
solo, sin recrear los nodos con listeners. **Sin vista de ingresos: se retiró por decisión de producto, junto a
toda métrica monetaria.** La activa se persiste en `localStorage` bajo
`plotstack.view`, y el rango temporal bajo `plotstack.days` (`"all"` = `Infinity`,
que nunca llega a `chrome.storage` porque un no finito se corrompe al guardarse).
El selector de rango lo aplican todas las vistas menos Cobertura, con una
excepción declarada: el panel de fuentes de adquisición usa el periodo fijo de
12 meses del endpoint y su badge lo dice (`· fijo`) en vez de fingir que
obedece al selector.

Resumen es deliberadamente corto: suscriptores, apertura, CTR, vistas y
crecimiento.
`health-score` e inventario se retiraron porque duplicaban señales o usaban un
índice arbitrario. Los KPI de pago e ingreso mensual existen, pero están ocultos
por defecto con `data-sensitive`; sus preferencias viven en `localStorage` bajo
`plotstack.showPaid` y `plotstack.showRevenue`.

El botón de cámara renderiza localmente un PNG de la vista activa desde el DOM
y lo guarda mediante `chrome.downloads.download`. Durante la captura,
`html.is-capturing` elimina navegación/controles y fuerza el ocultamiento
de todo `[data-sensitive]`, aunque el usuario lo tenga visible en pantalla.

**Modelo mostrar/ocultar, nunca destruir/recrear.** `bindEvents()` corre una sola
vez al arrancar y engancha por id estático; si un render recreara los nodos, esos
listeners quedarían colgando.

## Invariantes al modificar

- **El eje X de los gráficos es proporcional al tiempo.** `drawLineChart` reparte
  por fecha (`parseDay`) cuando todos los puntos la tienen; las series de barras
  diarias pasan por `fillDailyGaps`, que solo rellena con cero series de
  *eventos* (altas/bajas), donde "sin fila" significa "0 medido". Repartir por
  índice comprime los huecos y la pendiente miente.
- **Tasas agregadas siempre ponderadas** (`Σnumerador / Σentregados`), nunca
  media de tasas: `getCampaignCuts` es el ejemplo canónico. Un corte con menos
  de `MIN_CUT_N` envíos se marca `scarce` y se pinta atenuado, nunca oculto.
  `getCampaignDiagnosis` (cuadrante asunto/contenido) exige `MIN_DIAGNOSIS_N`
  envíos o devuelve `insufficient`: con dos posts la mediana no clasifica nada.
- **Las atribuciones por canal no se fuerzan a sumar el total.**
  `getChannelAttribution` compara altas de emails (24 h por envío) y de notas
  (acumulado por nota con detalle): ventanas distintas de Substack. Sus celdas
  viven en el stat-grid del panel "Altas y bajas" (una sección, una cabecera,
  un formato; nada de paneles con layout propio) y la nota del panel declara
  las ventanas. La eficiencia por pieza se calcula sobre las piezas *medidas*, y la
  conversión de una nota (`altas/1000 impresiones`) es `null` sin detalle — en
  los órdenes de la tabla, los nulos van al final, no compiten como ceros.
- **Un delta sin base previa es `null`, no +100%.** `getDerivedMetrics.change()`
  devuelve `null` con `prior <= 0`; `setDelta` lo traduce a "sin comparación".
  Los deltas de snapshot dicen "vs. sincronización anterior" porque no dependen
  del rango; solo apertura/CTR comparan ventanas del rango elegido.
- **La curva acumulada de suscriptores tiene sesgo de superviviente**: enumera
  solo a los suscriptores actuales, así que nunca baja. El "crecimiento neto"
  del Resumen sale de altas − bajas del histórico de crecimiento; si esa fuente
  falta, la cifra se etiqueta "Variación del histórico".
- **La unidad de las tasas de retención se decide sobre la serie entera** (todas
  ≤ 1 ⇒ fracción ⇒ ×100), nunca por fila: la heurística por fila convertía un
  1% real en 100%.
- **Recorte de ventanas por fecha, no por número de puntos**: las series diarias
  solo traen días con actividad, así que `slice(-30)` podía abarcar meses.

- **Fallo parcial nunca es cero.** Toda fuente nueva va dentro de `Promise.allSettled` (o del array `sources` de `substack-extended.js`) y, si falla, conserva el valor anterior o queda marcada `unavailable` en `coverage`. `getPublicationSnapshot` solo lanza si fallan a la vez `summary` y `summary-v2?range=30`.
- **Sincronización incremental por dos vías.** (1) Los paginadores paran cuando una página entera ya está en `knownIds`: la lista y el feed vienen en orden descendente, así que lo de detrás también es conocido. (2) Solo se piden detalles de los 12 más recientes más los que aún no lo tienen (`detailAvailable` / `stats.available`). `fullRefresh` (snapshot de más de 7 días) fuerza el recorrido completo para que los contadores públicos de notas antiguas no se congelen. Las notas conocidas que no vuelven a aparecer **se conservan**, no desaparecen por haber parado antes. No conviertas esto en un refresco total.

- **Fase rápida y fase de detalle no son intercambiables.** La rápida no pide ni un detalle: si le añades una petición por pieza, vuelves a la espera ciega de varios minutos que este diseño elimina. Un fallo en la de detalle deja intacto el snapshot que la primera ya persistió.

- **El delta de audiencia compara contra la ventana del selector.** `previousByRange` guarda los arranques de 7/30/90 que da `summary-v2`; `getComparisonBase` elige el del rango activo, cae al histórico local con "Todo" y devuelve `basis: "none"` si no hay ninguno. El copy **nombra** la base ("vs. hace 7 días", "desde 5 ene"): antes decía "vs. sincronización anterior" mientras comparaba siempre contra hace 30 días.

- **Las tasas por pieza salen del cociente, no de la clave de tasa.** `rateFrom` usa numerador/denominador cuando **ambos** están presentes, con las claves únicas antes que las totales (`emails_opened`, `opened`, y solo después `opens`). La clave de tasa de la API es respaldo y se usa TAL CUAL: la heurística "≤1 ⇒ ×100" convertía un 0,8% en 80%, y `click_through_rate` a veces es CTOR (clics/aperturas), que discrepaba del CTR agregado.
- **La cola de `note_stats` tiene que converger.** Una nota sin detalle acumula `stats.attempts` y deja de reintentarse en `NOTE_STATS_MAX_ATTEMPTS`; el primer 429 que sobrevive al backoff corta la cola completa (`collectNoteStats` devuelve `throttled`) en lugar de seguir insistiendo. Un corte por límite **no** gasta intentos: no es culpa de la nota. Los cuatro estados de `stats.fetchState` (`ready`, `pending`, `throttled`, `unavailable`) tienen copy distinto en la UI, porque "en proceso" aplicado a una nota de hace dos años es mentira.
- **`note_stats` exige el id con prefijo `c-`** (`noteStatsKey()`). Con el número pelado responde 400 en todas las notas. Sus tarjetas se leen por **`cardId`**, y el emparejamiento por título es **dentro de una sola tarjeta**: recorrer todas hacía que `followers` cazara el item `Followers` del desglose de audiencia (impresiones vistas por seguidores) y lo reportara como seguidores ganados. **`note_stats` no devuelve seguidores ni ingresos por nota.**
- **Suma las claves presentes, no la primera finita.** `normalizeSubscriberGrowth` usa `sumPresent`: con `asNumber(new_free, new_paid)` una fila `{new_free: 0, new_paid: 3}` devolvía 0, porque el cero medido de gratuitos tapaba las altas de pago. Los alias solo se consultan si ninguna clave principal viene en la fila.

- **`chartCounts` de `subscriber-stats` es UN punto agregado, no una serie.** Sus claves son nombres de campo, no fechas. La serie diaria de altas se reconstruye agregando `subscription_created_at` de cada fila con `getSubscriberTimeline`, que descarta email, nombre y foto en memoria y solo devuelve conteos por día. Ver `docs/product/substack-payloads-observados.md`.
- **Ninguna clave cruda de la API llega a la interfaz.** No hay volcados genéricos de objetos: las rejillas de cifras se construyen con `renderLabelledGrid`, que recibe pares `[etiqueta en español, valor]` escritos en el renderer. El volcado anterior (`renderStatGrid` + `STAT_LABELS`) pintaba `drafts` en inglés y booleanos de control como `publishedIsCapped: false`. Si añades una rejilla, escribe las etiquetas; no itereres el payload.
- **El perfil se refresca en cada sync.** `syncConnected` llama a `getProfile()` siempre, no solo cuando falta `userId`: ahí vive `followerCount`, que es un número vivo. Cachearlo desde el momento de la conexión lo dejaba a **0** en cualquier conexión creada antes de mapearlo. Si el perfil falla, se conserva la publicación guardada y `getPublicationSnapshot` cae al `followers` del snapshot anterior. Cubierto en `tests/background.test.js`.
- **Nada de PII en `chrome.storage`.** Solo métricas agregadas y normalizadas; se descartan emails, perfiles individuales de suscriptores y URLs firmadas de exportación.
- **Notas propias.** El feed del perfil incluye restacks ajenos; se filtran comparando `comment.user_id` con `publication.userId`, no por la URL del perfil.
- **Campos de la API son inestables.** Los normalizadores usan helpers variádicos (`asNumber(a, b, c)`, `text(...)`, `rowsFrom(payload, keys)`) porque Substack no documenta estos endpoints internos. Al añadir un campo, añade también sus alias plausibles en lugar de asumir un solo nombre.
- **Todo campo nuevo del snapshot debe pasar por `normalizeSnapshot`**, o desaparecerá al guardar.
- **No se inventan endpoints.** Regla heredada de `docs/product/substack-export-map.md`: una ruta que no se haya observado en la pestaña Network del panel autenticado no se añade. Retención sigue pendiente por esto; el histórico total de seguidores se construye únicamente con capturas locales sucesivas, nunca con puntos retroactivos inventados.
- **En el análisis de contenido, `null` nunca es `0`.** `0` es una medición; `null` es ausencia. Una nota sin `note_stats` queda fuera de la mediana en lugar de entrar como cero. Por eso `content-analytics.js` **no** reutiliza `getNotesAnalytics()`, que sí sintetiza ceros para su ranking.
- **Ningún cociente puede emitir `Infinity` ni `NaN`**: todos pasan por el helper `ratio()`, que devuelve `null` si el denominador es cero. Los no finitos se corrompen al pasar por `chrome.storage` y se renderizarían como "∞×".
- **Un rasgo con muestra escasa se muestra atenuado, nunca oculto.** Los tres estados (`evidence`, `insufficient`, `nodata`) tienen tratamiento visual distinto; `EVIDENCE_MIN_N` es un umbral de producto, no una prueba de significación.
- Si añades un archivo de primer nivel al código de la extensión, agrégalo a `EXTENSION_FILES` en `scripts/extension-files.mjs`. Es la lista canónica: `validate-extension.mjs` comprueba que exista y `package-extension.mjs` construye con ella el ZIP de la tienda. Un archivo que no esté ahí **no viaja en el paquete publicado**, aunque funcione al cargar la carpeta descomprimida.

## Tests

`tests/fixtures/dom.js` es un DOM mínimo sin dependencias que **lee los ids reales
de `index.html`**. `tests/dashboard-render.test.js` importa `dashboard/app.js` (lo
que dispara `initialize()`) y recorre las seis vistas por los cuatro rangos, así
que **una referencia colgante o un `#id` inexistente hace fallar la suite** — es el
único guardián contra ese fallo, que se colaba tres veces porque `node --check`
solo valida sintaxis. Si añades un renderer, añade su aserción ahí.

`tests/background.test.js` stubea `chrome.*` (incluido `chrome.alarms`) antes de
importar el service worker y captura los listeners de mensajes, instalación y
alarma para ejercitar los flujos reales. Su helper `esperarDetalle()` espera a que
`plotstack.progress` llegue a `done`/`error`: la sincronización responde tras la
fase rápida, así que sin esa espera la fase de detalle seguiría corriendo después
de que el caso restaure los stubs.

Los tests llaman `configureRequestLimiter({ gapMs: 0 })`: el hueco real de 60 ms
entre peticiones multiplicaba por diez la duración de la suite.

## Convenciones

- ES modules nativos en todas partes (`"type": "module"`); sin transpilación ni TypeScript.
- Los tests parchean `globalThis.fetch` y lo restauran en `finally`; no hay librería de mocks.
- Todo el texto de interfaz, mensajes de error y documentación está en español.
- **Las fechas `YYYY-MM-DD` van por `parseDay()`, nunca por `new Date(valor)` directo.** `new Date("2026-06-10")` es medianoche **UTC**, así que en zonas negativas se renderiza como 9 jun. Son fechas civiles, no instantes.
- El alcance de la v1 son publicaciones bajo `*.substack.com`; los dominios personalizados quedan fuera.

## Documentación de producto

- `docs/product/full-analytics-scope.md` — mapa de vistas, tabla de endpoints autenticados e indicadores derivados. Consúltalo antes de añadir una fuente.
- `docs/product/substack-export-map.md` — correspondencia entre las métricas capturadas y los CSV del export oficial de Substack.
