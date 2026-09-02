# PlotStack: alcance analítico real

Este documento describe **lo que el dashboard hace hoy**, no lo que se aspiraba a
hacer. La versión anterior listaba una vista de Ingresos, indicadores de ARR/MRR y
retención por cohortes que nunca existieron o se retiraron; quien la leyera
reconstruiría cosas ya descartadas.

Para la forma exacta de cada payload, ver
[`substack-payloads-observados.md`](substack-payloads-observados.md), que es la
única fuente de verdad sobre los endpoints.

## Las seis vistas

1. **Resumen** — suscriptores, apertura, CTR y crecimiento. Corto a propósito.
   Los KPI de pago e ingreso mensual existen en el DOM pero **nacen ocultos**
   (`data-sensitive`); el usuario los enciende y la preferencia vive en
   `localStorage`. Durante la captura de PNG se fuerzan a oculto.
2. **Audiencia** — total, seguidores de la cuenta, lectores en la app, altas
   diarias reconstruidas, composición por intervalo y actividad.
3. **Crecimiento** — fuentes de adquisición con su desglose anidado, altas y
   bajas, y las publicaciones del periodo.
4. **Notas** — cabecera agregada, cadencia día×hora y tabla por nota con el
   detalle de `note_stats`.
5. **Publicaciones** — tabla ordenable y buscable, volumen de envío y cortes por
   día y longitud. **No filtra por rango**: es histórico completo.
6. **Cobertura** — estado de cada fuente, registros y errores parciales.

**Sin vista de Ingresos.** Se retiró junto a toda métrica monetaria por decisión
de producto. Lo único que queda es el KPI oculto de Resumen.

## Fuentes que se sincronizan

`getPublicationSnapshot` (snapshot central):

| Fuente | Uso |
|---|---|
| `/api/v1/user/profile/self` | Usuario, publicaciones y `followerCount`. **Se refresca en cada sync** |
| `/api/v1/publish-dashboard/summary` | `totalEmail`, apertura, `openRateDiff`, `appSubscribers`, vistas |
| `/api/v1/publish-dashboard/summary-v2?range=N` | Anclas de la serie de suscriptores (7/30/90 días) |
| `/api/v1/publication/stats/email_stats` | Respaldo de envíos si `post_management` falla |
| `/api/v1/post_management/published` | Inventario paginado de publicaciones |
| `/api/v1/post_management/detail/{id}` | Métricas por publicación |
| `/api/v1/reader/feed/profile/{user_id}` | Historial de notas propias, paginado |
| `/api/v1/note_stats/c-{comment_id}` | Detalle por nota. **El prefijo `c-` es obligatorio** |

`getExtendedAnalytics` (cinco fuentes, todas con consumidor en la interfaz):

| Clave | Fuente | Uso |
|---|---|---|
| `audience` | `POST /api/v1/subscriber-stats` | Conteos agregados de `chartCounts` |
| `subscriberTimeline` | `POST /api/v1/subscriber-stats` paginado | Serie diaria de altas desde `subscription_created_at`. `limit` máx. 100 |
| `growthSources` | `/api/v1/publication/stats/growth/sources` | Fuentes con desglose en `children` |
| `growthEvents` | `/api/v1/publication/stats/growth/events` | Hitos de publicación (clave `pubEvents`) |
| `emailTimeseries` | `/api/v1/publication/stats/emails/timeseries` | Volumen diario de envío |

**Regla:** una fuente que no alimenta ningún renderer no se sincroniza. Se
retiraron seis por incumplirla.

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

## Lo que NO se puede hacer, y por qué

Ninguno de estos puntos está pendiente de trabajo: están **bloqueados por la
API**. No se implementan a medias ni se rellenan con estimaciones.

| Falta | Motivo |
|---|---|
| Serie histórica de seguidores | Solo existe el total (`followerCount`). Ninguna ruta observada da la evolución; la serie se construye un punto por sync |
| Total de bajas | Solo hay `unsubscribes_within_1_day` y `disables_within_1_day` por publicación: la ventana de 24 h tras cada envío |
| Retención y cohortes | Ningún endpoint observado |
| Seguidores o ingresos por nota | `note_stats` no trae esas tarjetas. Intentarlo por título de item colaba el desglose de audiencia como si fueran seguidores ganados |
| Atribución de red | `network_attribution` responde **500** |
| Recomendaciones | `recommendations/stats/to` responde **400**. El dato equivalente está dentro de `growth/sources` → `children` |
| Actividad de pagos | `payment_pledges` responde **400** sin parámetros conocidos |
| Serie de ARR | `arr/timeseries` existe y responde 200, pero devuelve `[]` sin ingresos: la forma de cada elemento sigue sin confirmar. Irrelevante mientras no haya vista de ingresos |
| Curva de apertura y país | Solo en el ZIP del export oficial, no en la API. Ver `substack-payloads-observados.md` |

## Estrategia de sincronización

- Cada fuente falla por separado: `Promise.allSettled` y `coverage` con el estado.
- **Fallo parcial nunca es cero:** se conserva el valor anterior del snapshot.
- Posts y notas son incrementales: los 12 más recientes más los que aún no tienen
  detalle, con tope de intentos para que la cola converja.
- Nada de PII en `chrome.storage`: emails, nombres y fotos se agregan en memoria y
  se descartan.
