# PlotStack: alcance analítico real

Este documento describe **lo que el dashboard hace hoy**, no lo que se aspiraba a
hacer. La versión anterior listaba una vista de Ingresos, indicadores de ARR/MRR y
retención por cohortes que nunca existieron o se retiraron; quien la leyera
reconstruiría cosas ya descartadas.

Para la forma exacta de cada payload, ver
[`substack-payloads-observados.md`](substack-payloads-observados.md), que es la
única fuente de verdad sobre los endpoints.

## Las seis vistas

1. **Resumen** — suscriptores, apertura, CTR, vistas y crecimiento. Corto a
   propósito. El delta de audiencia compara contra el arranque de la **misma
   ventana** que marca el selector (7/30/90) y el copy lo nombra; con "Todo" la
   base es la primera captura del histórico local. Vistas usa la ventana fija de
   30 días del endpoint y la tarjeta lo declara.
   Los KPI de pago e ingreso mensual existen en el DOM pero **nacen ocultos**
   (`data-sensitive`); el usuario los enciende y la preferencia vive en
   `localStorage`. Durante la captura de PNG se fuerzan a oculto.
2. **Audiencia** — total, seguidores de la cuenta, lectores en la app, altas
   diarias reconstruidas, composición por intervalo, actividad, países y
   retención (tasas medias más la matriz cohorte × mes).
3. **Crecimiento** — fuentes de adquisición con su desglose anidado, altas y
   bajas, y las publicaciones del periodo.
4. **Notas** — cabecera agregada (con visitas al perfil y clics a enlaces),
   desglose de alcance por superficie y por audiencia, cadencia por tramos,
   altas atribuidas y tabla por nota con el detalle de `note_stats`.
5. **Publicaciones** — tabla ordenable y buscable, volumen de envío y cortes por
   día y longitud. **No filtra por rango**: es histórico completo.
6. **Cobertura** — estado del snapshot principal (detalle por publicación y los
   cuatro estados de la cola de notas), progreso de la sincronización en curso, y
   estado de cada fuente ampliada con sus registros y errores parciales.

**Sin vista de Ingresos.** Se retiró junto a toda métrica monetaria por decisión
de producto. Lo único que queda es el KPI oculto de Resumen.

## Fuentes que se sincronizan

La sincronización va en **dos fases**. La rápida devuelve un snapshot completo y
válido para pintar; la de detalle sigue en el service worker y actualiza
`chrome.storage`, que el dashboard escucha con `storage.onChanged`.

`getCoreSnapshot` (fase rápida, sin una sola petición de detalle):

| Fuente | Uso |
|---|---|
| `/api/v1/user/profile/self` | Usuario, publicaciones y `followerCount`. **Se refresca en cada sync** |
| `/api/v1/publish-dashboard/summary` | `totalEmail`, apertura, `openRateDiff`, `appSubscribers`, `views`, `viewsDelta` |
| `/api/v1/publish-dashboard/summary-v2?range=N` | Anclas de la serie y **base de comparación por rango** (7/30/90 días) |
| `/api/v1/publication/stats/email_stats` | Respaldo de envíos si `post_management` falla |
| `/api/v1/post_management/published` | Inventario paginado, con **parada incremental** por ids conocidos |

`enrichSnapshot` (fase de detalle, informa por `onProgress`):

| Fuente | Uso |
|---|---|
| `/api/v1/post_management/detail/{id}` | Métricas por publicación. 12 más recientes + las que no tienen detalle |
| `/api/v1/reader/feed/profile/{user_id}` | Historial de notas propias, con parada incremental |
| `/api/v1/note_stats/c-{comment_id}` | Detalle por nota. **El prefijo `c-` es obligatorio** |

`getExtendedAnalytics` (fase rápida, ocho peticiones y nueve claves, todas con
consumidor en la interfaz):

| Clave | Fuente | Uso |
|---|---|---|
| `subscriberTimeline` | `POST /api/v1/subscriber-stats` paginado | Serie diaria de altas desde `subscription_created_at`. `limit` máx. 100 |
| `audience` | *(sin petición propia)* | Conteos de `chartCounts` de la primera página de la timeline |
| `growthSources` | `/api/v1/publication/stats/growth/sources` | Fuentes con desglose en `children`. Periodo fijo de 12 meses |
| `followerTimeseries` | `/api/v1/publication/stats/followers/timeseries` | Evolución real de seguidores |
| `audienceLocation` | `/api/v1/publication/stats/audience_insights/location` (+ `/total`) | Países de las altas gratuitas |
| `freeSubscriberGrowth` | `/api/v1/publication/stats/paid_subscriber_growth?is_subscribed=false` | Altas, bajas y neto diarios |
| `paidSubscriberGrowth` | la misma con `is_subscribed=true` | Igual, para pago. Tras `data-sensitive` |
| `freeRetention` | `/api/v1/publication/stats/subscriber_retention` (+ `/summary`) | Tasas medias y matriz por cohorte |
| `paidRetention` | la misma con `is_subscribed=true` | Igual, para pago |

**Regla:** una fuente que no alimenta ningún renderer no se sincroniza. Se
retiraron seis por incumplirla, y `audience` dejó de tener petición propia
porque su payload ya llegaba con la timeline.

## Estado de la sincronización

`chrome.storage.local` guarda **cuatro** claves: `plotstack.snapshot`,
`plotstack.connection`, `plotstack.analytics` y `plotstack.progress`.

`plotstack.progress` es `{ phase, step, detail: {done, total}, startedAt,
finishedAt, error }` con `phase` en `core` | `detail` | `done` | `error`. El
dashboard lo pinta junto al botón de sincronizar y en la vista Cobertura.

Todas las peticiones del proveedor pasan por un **limitador único** (4
simultáneas, 60 ms entre salidas): snapshot y fuentes ampliadas se lanzan a la
vez, y sin tope global la ráfaga provocaba los 429 que cortaban la cola de notas.

Una **alarma diaria** (`chrome.alarms`, permiso `alarms`) sincroniza en segundo
plano si hay publicación conectada. Sin ella, el histórico local de `trend` y de
seguidores solo crecía los días que el usuario abría el dashboard, y ese
histórico es la única base de comparación del rango "Todo".

## Indicadores derivados que existen

- Serie diaria de altas y acumulado, reconstruidos por agregación.
- Altas menos bajas, con el neto del periodo.
- Apertura y CTR **ponderados por destinatarios entregados**, sobre la ventana
  activa, con delta contra la ventana anterior del mismo tamaño.
- Mediana de apertura propia como referencia (no un benchmark inventado).
- Cadencia de notas en rejilla día×hora.
- Interacciones por nota, porcentaje con restack, impresiones agregadas.
- Composición de audiencia por `subscription_interval` y por `activity_rating`.
- Cortes de publicaciones por día de envío y por longitud.
- Desglose agregado de alcance de notas por superficie (Feed, Notificaciones,
  Perfil…) y por audiencia (suscriptores, seguidores, sin conexión), solo sobre
  las notas con detalle y declarando la cobertura.
- Retención por cohorte de alta, con la unidad decidida sobre todas las celdas.

## Lo que NO se puede hacer, y por qué

Ninguno de estos puntos está pendiente de trabajo: están **bloqueados por la
API**. No se implementan a medias ni se rellenan con estimaciones.

| Falta | Motivo |
|---|---|
| Serie diaria de suscriptores totales | `emails/timeseries` podría serla, pero su semántica no está confirmada y no se mapea hasta capturar el payload. La curva actual enumera solo a los suscriptores **actuales**: tiene sesgo de superviviente y nunca baja |
| Total de bajas por publicación | Solo hay `unsubscribes_within_1_day` y `disables_within_1_day`: la ventana de 24 h tras cada envío. El total diario sí llega por `paid_subscriber_growth` |
| Seguidores o ingresos por nota | `note_stats` no trae esas tarjetas. Intentarlo por título de item colaba el desglose de audiencia como si fueran seguidores ganados |
| Recomendaciones | `recommendations/stats/to` responde **400**. El dato equivalente está dentro de `growth/sources` → `children` |
| Serie de bajas por día | `unsubscribes/timeseries` existe y responde 200, pero devuelve `{rows: []}` incluso a un año en esta publicación: la forma de cada fila sigue sin confirmar. El total diario ya llega por `paid_subscriber_growth` |
| Actividad de pagos | `payment_pledges` responde **400** sin parámetros conocidos |
| Serie de ARR | `arr/timeseries` existe y responde 200, pero devuelve `[]` sin ingresos: la forma de cada elemento sigue sin confirmar. Irrelevante mientras no haya vista de ingresos |
| Curva de apertura y país | Solo en el ZIP del export oficial, no en la API. Ver `substack-payloads-observados.md` |

## Estrategia de sincronización

- Cada fuente falla por separado: `Promise.allSettled` y `coverage` con el estado.
- **Fallo parcial nunca es cero:** se conserva el valor anterior del snapshot.
- **Dos fases:** la rápida persiste y responde; la de detalle sigue aparte y su
  fallo deja intacto lo que la primera ya guardó.
- Posts y notas son incrementales por dos vías: los paginadores paran cuando una
  página entera ya está en el snapshot, y solo se piden detalles de los 12 más
  recientes más los que no lo tienen, con tope de intentos para que la cola
  converja. Un `fullRefresh` semanal recorre todo el historial para que los
  contadores públicos de notas antiguas no se queden congelados.
- Nada de PII en `chrome.storage`: emails, nombres y fotos se agregan en memoria y
  se descartan. `getSubscriberTimeline` solo devuelve conteos, y un test lo
  verifica sobre su valor de retorno.
