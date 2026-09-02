# Mapa del export completo de Substack

Fuente de descubrimiento: `EXPORTA SUBSTACK JONES.html`, inspeccionado como referencia técnica local. No se copiaron datos personales ni instrucciones del documento.

## Estructura confirmada

- `posts.csv`: identificador, título, fecha, audiencia y tipo de publicación.
- `posts/{id}.html`: contenido completo, útil para palabras y análisis editorial.
- `posts/{id}.delivers.csv`: destinatarios únicos por publicación.
- `posts/{id}.opens.csv`: aperturas únicas por publicación.
- `email_list.csv` o `subscribers.csv`: contiene PII y no debe persistirse en PlotStack.
- `*_growth_sources_*.csv`: fuentes, conversiones y revenue.
- `*_free_subscriber_retention_*.csv`: retención gratuita.
- `*_paid_subscriber_retention_*.csv`: retención de pago.

## Equivalencias API implementadas

- `posts.csv` → `GET /api/v1/post_management/published`, con paginación completa.
- `delivers.csv` y `opens.csv` → `GET /api/v1/post_management/detail/{post_id}?offset=0&limit=1`.
- fuentes de crecimiento → `GET /api/v1/publication/stats/growth/sources`.
- inventario agregado → `GET /api/v1/post_management/counts`.

## Métricas normalizadas por publicación

Enviados, entregados, aperturas totales, aperturas únicas, tasa de apertura, clics totales, clickers únicos, CTR, vistas, shares, altas, suscripciones, altas y suscripciones dentro de un día, bajas y desactivaciones dentro de un día, descargas, vistas de vídeo, minutos reproducidos y valor estimado.

## Pendiente de captura segura

Las rutas exactas que generan los CSV de retención gratuita y de pago no aparecen en el HTML. No se inventarán endpoints: deben capturarse desde la pestaña Network del panel autenticado de retención o desde los bundles actuales de Substack.

## Campos editoriales mapeados (2026-08-19)

`mapCampaign()` captura ahora, con alias defensivos, los campos que permiten
juzgar el contenido y no solo su rendimiento:

- `subtitle` ← `subtitle`, `social_title`, `search_engine_description`
- `slug` ← `slug`
- `audience` ← `audience` (`everyone` / `only_paid` / `founding`)
- `type` ← `type` (`newsletter` / `podcast` / `thread`)
- `wordcount` ← `wordcount`, `word_count`, `stats.wordcount`

Ninguno procede de una ruta nueva: todos salen de las respuestas que ya devuelven
`post_management/published` y `post_management/detail/{id}`. Si Substack no los
incluye, quedan vacíos y la interfaz lo muestra como "—".

El cuerpo de los posts (`posts/{id}.html` en el export) sigue **sin mapear**: se
decidió no persistir texto de publicaciones. El análisis editorial se hace sobre
el texto de las Notas, que sí se guarda.

## Retención: sigue pendiente

Las rutas de retención gratuita y de pago continúan sin capturar. Se mantiene la
regla: **no se inventarán endpoints**. Mientras no se observen en la pestaña
Network del panel autenticado, retención y serie histórica de seguidores quedan
fuera del alcance.
