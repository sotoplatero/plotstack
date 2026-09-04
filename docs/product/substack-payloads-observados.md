# Payloads observados — 19 ago 2026

Capturado del panel autenticado de `sotoplatero.substack.com` (Objeto Brillante,
97 suscriptores) con la pestaña Network. Todo lo de aquí está **observado**, no
inferido. Ninguna ruta de este documento se ha adivinado.

## `GET /api/v1/publish-dashboard/summary-v2?range=30`

**No contiene ninguna serie.** Diez escalares y nada más:

```
arrEnd, arrStart, paidSubscribersEnd, paidSubscribersStart,
pledgedArrEnd, pledgedArrStart, totalSubscribersEnd, totalSubscribersStart,
totalViewsEnd, totalViewsStart
```

Corrige la hipótesis de `auditoria-dashboard.md` §3.1: la serie diaria **no está
escondida dentro de este payload**. El gráfico de 4 anchors es todo lo que este
endpoint puede dar.

`totalViewsStart` / `totalViewsEnd` no se mapean hoy. Son nuevos.

## `POST /api/v1/subscriber-stats`

Cuerpo: `{ filters: { order_by_desc_nulls_last: "subscription_created_at" }, limit, offset }`

- `limit` **máximo 100**. Con `limit: 200` responde **400**.
- `count` trae el total real de suscripciones (97).
- Orden descendente: la página 0 son las altas **más recientes**.

### `chartCounts` es un único punto, no una serie

```json
{
  "created_at": "2026-06-10T01:57:08.139Z",
  "subscribers": 0,
  "lifetime_subscribers": 0,
  "comp_subscribers": 0,
  "gift_subscribers": 0,
  "free_trial_subscribers": 0,
  "founding_subscribers": 0,
  "totalEmail": 97
}
```

`normalizeAudience` asume hoy que si `chartCounts` es un objeto entonces sus
**claves son fechas** (`Object.entries(...).map(([date, value]) => ...)`).
Aplicado a este payload produce 8 puntos falsos con fechas `"created_at"`,
`"subscribers"`, `"comp_subscribers"`… todos con valor 0. Como son 8 puntos ≥ 2,
`drawLineChart` los dibuja y `#audience-empty` queda oculto: **la vista Audiencia
muestra una línea plana en cero y "8 puntos de histórico"**. No es que falten
datos, es que se están fabricando.

Lo que sí hay aquí es **composición**: founding, gift, comp, free trial y
`lifetime_subscribers`. Eso no se muestra en ninguna parte.

### `subscribers[]` — la serie diaria sí es reconstruible

Cada fila trae `subscription_created_at`. Agregando por día sobre las 97 filas:
29 días distintos, rango `2026-06-10` → `2026-08-18`, cero filas sin fecha.

**Esta es la fuente de "suscriptores por día"**, y es un histórico completo desde
el día uno, no cuatro anchors.

Banderas por fila: `is_subscribed`, `is_founding`, `is_gift`, `is_comp`,
`is_free_trial`, `is_bitcoin`. `is_subscribed` permite separar altas de bajas.

**PII a descartar en memoria, nunca persistir:** `user_email_address`,
`user_name`, `user_photo_url`, `user_id`. Solo se guardan los conteos diarios.

## `GET /api/v1/publication/stats/arr/timeseries?from=<ISO>`

Endpoint de serie temporal real, observado en el `/publish/home`. Devuelve un
**array desnudo**. Vacío (`[]`) en esta publicación porque no tiene ingresos, así
que la forma de cada elemento **queda sin confirmar**. Hay que volver a
capturarlo en una publicación con suscriptores de pago antes de mapear campos.

## `GET /api/v1/publication/stats/subscriber_notes?limit=8`

Observado en `/publish/home`. Notas que atrajeron suscriptores. Sin capturar
todavía.

## `GET /api/v1/pledges/plans/summary`

```json
{
  "plans": [
    { "name": "Yearly",   "amount": 8000,  "interval": "year",  "currency": "usd" },
    { "name": "Monthly",  "amount": 800,   "interval": "month", "currency": "usd" },
    { "name": "Founding", "amount": 15000, "interval": "year",  "currency": "usd", "is_founding": true }
  ],
  "pledgeSummary": {},
  "pledgeCount": 0
}
```

`amount` está en **centavos**: 8000 = 80 US$/año. `numericSummary` solo conservaba
las claves numéricas de primer nivel, así que guardaba `pledgeCount: 0` y **tiraba
el array de planes entero** — el único dato real de monetización. Ahora lo mapea
`normalizePlans`.

## `GET /api/v1/publication/stats/payment_pledges` — **responde 400**

Sin parámetros devuelve `400`. Esta fuente **nunca ha funcionado**: siempre cayó
en el `catch` de `Promise.allSettled` y aparecía como `unavailable` en Cobertura.
Se deja declarada, con el 400 en la etiqueta, porque no sé qué parámetros espera y
probar combinaciones sería adivinar rutas. Hay que capturarla desde el panel en
una publicación con pagos activos.

## `GET /api/v1/post_management/counts`

```json
{ "published": 11, "publishedIsCapped": false, "drafts": 8,
  "draftsIsCapped": false, "scheduled": 0, "scheduledIsCapped": false }
```

Dos problemas que esto destapó en `STAT_LABELS`:

1. La clave es **`drafts`** en plural; el mapa tenía `draft` en singular, así que
   se pintaba la palabra inglesa cruda.
2. Los tres `*IsCapped` son booleanos de control, no métricas, y se renderizaban
   como tarjetas con el texto `false`.

Arreglado convirtiendo `renderStatGrid` en **lista blanca**: una clave sin
etiqueta en español no se pinta. Antes cualquier campo nuevo de la API aparecía
crudo en la interfaz.

## `GET /api/v1/user/profile/self` — `followerCount`

Este endpoint **ya se llamaba** en `getProfile()` y el campo se ignoraba:

```json
{ "id": 43892226, "handle": "sotoplatero", "followerCount": 150 }
```

Son seguidores de la **cuenta** en Substack, no suscriptores del boletín. El
histórico diario existe en la ruta descrita más abajo; el perfil sigue siendo el
respaldo para el total cuando esa serie no está disponible.

**Es un número vivo, así que hay que refrescarlo en cada sync.** `syncConnected`
solo pedía el perfil cuando faltaba `userId`, de modo que en una conexión ya
existente `followerCount` nunca llegaba y la tarjeta de Audiencia mostraba **0**
aunque la API devolviera 150.

## `GET /api/v1/publish-dashboard/summary`

```json
{ "appSubscribers": 66, "appSubscribersLast30Days": 59,
  "subscribers": 0, "subscribersLast30Days": 0,
  "totalEmail": 97, "totalEmailLast30Days": 66,
  "views": 2560, "viewsDelta": 2094,
  "openRate": 33.0188679245283, "openRateDiff": -45.55256064690027,
  "pledgesAmount": 0, "numPledges": 0, "pledgeCurrency": "usd", "isBestseller": false }
```

Dos cosas importantes:

- **`summary.subscribers` NO es el total de suscriptores**: vale `0` en una cuenta
  con 97. `getPublicationSnapshot` lo usaba como fallback de
  `range30.totalSubscribersEnd`, así que si `summary-v2` fallaba el dashboard
  mostraba 0 suscriptores. El total real está en `totalEmail`.
- **`openRateDiff` existe.** Resuelve el delta que la auditoría marcó como
  siempre-cero: ya no hace falta derivarlo de `previous.openRate`, que era una
  copia de `metrics.openRate`. Se muestra tal cual lo da Substack, sin intentar
  reconstruir el valor anterior (no está claro si el campo son puntos o
  porcentaje de variación, y no se adivina).

`appSubscribers` son lectores en la app de Substack. Sin mapear hasta ahora.

## `GET /api/v1/publication/stats/growth/sources`

**Esta es la razón de que la vista Crecimiento estuviera vacía.**

```json
{ "totals": [{ "name": "traffic", "total": 927 }, { "name": "subscribers", "total": 99 },
             { "name": "revenue", "total": 0 }],
  "sourceMetrics": [{
    "source": "substack", "sourceName": "Substack", "category": "Substack", "logoUrl": "…",
    "metrics": [{ "name": "Traffic",     "total": 226, "timeseries": [{ "date": "2026/08/19", "value": 226 }] },
                { "name": "Subscribers", "total": 75,  "timeseries": [ … ] },
                { "name": "Revenue",     "total": 0,   "timeseries": [ … ] }],
    "children": [ … "Other", "Onboarding", "Trackbacks", "Recommendations", "Notes" ]
  }]
}
```

`normalizeAcquisitionRows` buscaba `sources`/`rows`/`items`/`data`/`results`.
**Ninguna existe**, así que devolvía `[]` y los cuatro paneles salían en blanco.
11 fuentes en total, cada una con serie propia. Las recomendaciones y las notas
viven como `children` de la fuente `substack` — ahí está el dato que el endpoint
roto de recomendaciones no da.

## `GET /api/v1/publication/stats/growth/events`

```json
{ "pubEvents": [{ "id": 211298012, "date": "2026-08-15T14:08:46.592Z",
                  "title": "La forma más inteligente de aprender a escribir",
                  "slug": "la-forma-mas-inteligente-de-aprender", "type": "text" }] }
```

111 eventos. La clave es **`pubEvents`**, que tampoco estaba en `rowsFrom`, así que
también salía `[]`. Y **no traen ningún conteo**: son hitos de publicación. La UI
pintaba `+0` en cada fila por un campo `subscribers` que no existe.

## `GET /api/v1/note_stats/{entity_key}` — el prefijo `c-` es obligatorio

**Esta era la causa real de que ninguna nota tuviera estadísticas.**

```
/api/v1/note_stats/318488307     -> 400  {"error":""}
/api/v1/note_stats/c-318488307   -> 200  {cards, lastUpdatedAt}
```

`mapNote` guardaba el id **sin** el prefijo (`entityKey.replace(/^c-/, "")`) y
`collectNoteStats` pedía con ese número pelado. Resultado: **400 en todas las
notas, siempre**, desde el primer día. El diagnóstico anterior de esta auditoría
(rate limiting) era incorrecto: los arreglos de backoff y convergencia son
válidos como refuerzo, pero no tocaban el problema.

### Las tarjetas van por `cardId`, no por título

`cardId` observados: `note`, `impressions`, `surfaces`, `audience`,
`interactions`, `new_subscribers`.

| cardId | Contenido |
|---|---|
| `impressions` | header `Impressions` + `graphData` |
| `surfaces` | Feed, Notifications, Profile page, Permalinks, Notes, Search, Other |
| `audience` | Subscribers, Followers, Unconnected |
| `interactions` | header `Interactions` + items Like, Profile visit, Reply, Restack, Link click, Save |
| `new_subscribers` | headers `New free subs`, `New paid subs` |

**No existe tarjeta de seguidores ganados ni de ingresos.** El normalizador
anterior emparejaba por título recorriendo *todas* las tarjetas, así que
`find("followers")` cazaba el item **`Followers` del desglose de AUDIENCIA** —
impresiones vistas por seguidores — y lo reportaba como `results.followers`, o
sea seguidores ganados. Un número real, con el significado equivocado.

Igual con `results.revenue`: no existe, siempre valía 0.

Corregido emparejando **dentro de una sola tarjeta, por título exacto**.
`results` queda con `freeSubscribers` y `paidSubscribers`; se añaden `surfaces` y
`audience`, que se tiraban enteros. `OUTCOME_KEYS` de `content-analytics`
sustituye `followers` por `impressions`.

Ojo con `available`: un payload con solo la tarjeta `note` **no es** detalle
disponible; es una nota sin datos.

## Endpoints que fallan

| Ruta | Código | Nota |
|---|---|---|
| `publication/stats/payment_pledges` | **400** | Sin parámetros conocidos |
| `publication/stats/network_attribution` | ~~500~~ | **Corregido el 4 sep 2026: responde 200 con `time_window` e `is_subscribed`.** Ver el barrido del panel más abajo |
| `recommendations/stats/to` | **400** | El dato equivalente está en `growth/sources` → `children` |
| `note_stats/{id}` sin `c-` | **400** | Exige el prefijo; ver sección arriba |

**Las tres fuentes se retiraron de `getExtendedAnalytics`.** Un rojo permanente en
Cobertura no es información, y eran tres peticiones tiradas en cada sync. Si
alguna vez se documenta cómo llamarlas, están descritas aquí para reconstruirlas.

También se retiraron tres fuentes que **sí funcionan** pero cuyo consumidor
desapareció: `pledges/plans/summary` y `publication/stats/payment_pledges` (al
quitar toda métrica de ingresos), `post_management/counts` (al retirar el panel de
inventario) y `publication_export` (solo se contaba en Cobertura).

`getExtendedAnalytics` conserva solo fuentes con consumidor en la interfaz:
audiencia, altas, adquisición, eventos, seguidores, ubicación, crecimiento y
retención. Regla que conviene mantener: **una fuente que no alimenta ningún
renderer no se sincroniza.**

## Endpoints verificados en `/publish/stats/audience` — 22 ago 2026

- `GET publication/stats/followers/timeseries?from=<ISO>` devuelve pares
  `[fecha, total]`: es la evolución real de seguidores.
- `GET publication/stats/audience_insights/location?metric=free%20signups&granularity=global`
  devuelve `{location, value}`; `/location/total` aporta cobertura.
- `GET publication/stats/paid_subscriber_growth?start=<ISO>&end=<ISO>&period=day&is_subscribed=false`
  devuelve `subscriberGrowth`. `new_free`, `num_unsubs` y `num_expirations`
  permiten calcular altas, bajas y neto sin limitarse a las 24 horas posteriores
  a un envío. `is_subscribed=true` es la variante de pago.
- `GET publication/stats/subscriber_retention?...` devuelve `cohortStats`; su
  ruta `/summary` devuelve `rates` con `months_since_subscription`, `rate` y
  `comparison`. Cohortes vacías se presentan como no disponibles, no como 0%.

Semántica corregida: `emails/timeseries` representa el total de suscriptores,
`subscribers/timeseries` los suscriptores de pago y `followers/timeseries` los
seguidores. Se retiró “Volumen de email”, que interpretaba el primero como
correos enviados.

## Cobertura real de campos por publicación

Muestreadas 6 publicaciones vía `post_management/detail/{id}`. **Siempre cero**:

```
downloads, downloads_day7/30/90, podcast_preview_downloads,
podcast_preview_downloads_day30, video_views, video_minutes_watched,
disables_within_1_day, subscriptions_within_1_day, unsubscribes_within_1_day,
subscribes, estimated_value, new_subscription_invoice_value
```

**Con dato** (n/6): `views 6`, `opens 6`, `opened 6`, `open_rate 6`, `clicked 6`,
`clicks 6`, `sent 6`, `delivered 6`, `click_through_rate 6`, `engagement_rate 6`,
`reaction_count 5`, `shares 5`, `comment_count 4`, `child_comment_count 4`,
`signups_within_1_day 3`, `signups 1`.

`reaction_count`, `comment_count` y `engagement_rate` **no se mapeaban** y sí
traen dato. Las columnas de la tabla se eligieron con esta tabla, no a ojo.

## Sigue sin existir

- La serie diaria de seguidores sí existe en `followers/timeseries`.
- La serie de pago existe en `subscribers/timeseries`; permanece oculta por
  defecto en PlotStack por tratarse de información sensible.
- `/publish/stats` redirige a `/publish/stats/network` en esta cuenta; no expone
  un endpoint de serie de suscriptores.
- **Forma de `payment_pledges`**: bloqueada por el 400 descrito arriba.

## Barrido del panel `/publish/stats` — 4 sep 2026

Capturado pestaña por pestaña con la pestaña Network sobre la sesión real. El
panel tiene **once** pestañas (Red, Audiencia, Retención, Compartir,
Referencias, Notes, Tráfico, Publicaciones, Cancelaciones, Surveys, Ingresos);
PlotStack solo cubría lo que alimentan tres de ellas.

### `network_attribution` NO responde 500: faltaban los parámetros

```
GET publication/stats/network_attribution            -> 500
GET .../network_attribution?time_window=90+days&is_subscribed=false -> 200
```

```json
{ "rows": [{ "label": "Substack App", "subs_count": 80,
             "pct_time_window_total": 0.70, "criteria": 1,
             "time_window": "90 days", "is_subscribed": false,
             "data_updated_at": "2026-09-04T01:30:20.196Z" }],
  "total": 114 }
```

Es el donut "Efecto de red": qué parte de la audiencia llega por la red de
Substack (App, otras publicaciones, cuentas existentes) y qué parte es propia.
La tabla de "endpoints que fallan" de este documento estaba equivocada: el 500
lo provocaba llamarlo sin `time_window`.

### Tráfico: la serie diaria de vistas que faltaba

```
GET publication/stats/publication_traffic/30d_views      -> {views30d, viewsDelta30d}
GET publication/stats/publication_traffic/timeseries?from=&to=&category
    -> Array de pares ["2026/06/11", n]  (83 puntos en el rango de 3 meses)
GET publication/stats/visitor_sources?from_date=&to_date=&offset=&limit=&order_by=views&order_direction=desc
    -> { rows: [{ source, source_category, views, users, free_signup, subscribed }], total }
```

`visitor_sources` **no** es `growth/sources`: trae `views` y `users` además de
altas, acepta rango de fechas (frente al periodo fijo de 12 meses del otro) y
permite calcular conversión visita → alta por fuente.

### Veredicto comparativo que Substack publica

```
GET publication/stats/paid_subscriber_growth/summary?is_subscribed=false
{ "growth_rate": 0.407407, "period_length": 30, "total_new_subs": 36,
  "num_expirations": -3, "comparison_outcome": "above_average",
  "period": "last 30 days" }
```

`comparison_outcome` es una comparación **contra otras publicaciones** que no se
puede derivar de datos propios. `num_expirations` viene negativo aquí.

### Solapamiento de audiencia

```
GET publication/stats/audience_insights/overlap?limit=6
-> [{ percentOverlap: "0.39", pub: { …objeto de publicación completo… }}]
```

Qué porcentaje de tu audiencia comparte cada otra publicación. Del objeto `pub`
solo hacen falta `name` y `subdomain`: el resto es configuración ajena.

### Otros endpoints observados

| Ruta | Forma | Nota |
|---|---|---|
| `publication/stats/unsubscribes/timeseries?from=&to=&granularity=day` | `{rows: []}` | Existe y responde 200, pero **vacío** en esta publicación incluso a un año. La forma de cada fila queda sin confirmar: no se mapea |
| `publication/stats/unsubscribes?offset=&limit=&from=&to=` | lista | Trae PII de cada baja. **No se captura** |
| `publication/stats/email_stats/30d_open_rate` | `{openRate, openRateDiff}` | La apertura de 30 días con su variación, ya calculada por Substack |
| `publication/stats/subscriber_notes?limit=20` | `{noteAndUserData: [], summary: {count, hasMore}}` | Vacío aquí; el dato equivalente ya está en `note_stats` |
| `publication/stats/referrals/summary` | `{gifts_sent, gifts_accepted, gifts_converted}` | Solo programa de regalos |
| `publication/stats/referrals/leaderboard?order_by=num_gifts_accepted` | lista | Idem |
| `publication/post-tag` | `[{id, publication_id, name, slug, hidden}]` | **Secciones/etiquetas de la publicación.** Permite cortar el rendimiento por sección |
| `publication/stats/reader-referrals?to=&offset=&limit=&order_by=visitors` | lista | Pestaña Compartir |

## `/publish/growth` — "Growth sources", 4 sep 2026

Página aparte de `/publish/stats`, con su propio enlace en la barra lateral
(`/publish/growth`; `/publish/grow` es 404). Tres métricas en pestañas: Unique
visitors, New subscribers, New revenue.

### `growth/sources` SÍ acepta rango de fechas

```
GET publication/stats/growth/sources?order_by=users&order_direction=desc&from_date=&to_date=
```

Comprobado con tres ventanas sobre la misma publicación:

| Ventana | Visitas | Altas | Fuentes distintas |
|---|---|---|---|
| 7 días | 87 | 6 | 7 |
| 30 días | 508 | 37 | 8 |
| 365 días | 1196 | 118 | 13 |

El badge "· fijo" del panel de adquisición de PlotStack **no refleja un límite
de la API**: es una limitación autoimpuesta por llamar siempre con una ventana
de 12 meses. El selector de rango puede aplicarse también a esa vista.

`growth/events?from_date=&to_date=` acepta el mismo rango (96 eventos en 30
días).

### `growth/partial-timeseries` — cuerpo sin confirmar

```
POST publication/stats/growth/partial-timeseries  -> 200
```

Alimenta el área apilada por fuente a lo largo del tiempo. **Es un POST y no se
consiguió capturar su cuerpo**: la página no pasa por `window.fetch` ni por
`XMLHttpRequest` interceptables desde la consola. Mientras el cuerpo no se
observe, no se implementa: adivinar el esquema de una petición POST es
exactamente lo que la regla de "no se inventan endpoints" prohíbe.
