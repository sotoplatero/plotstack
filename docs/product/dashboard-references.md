# Referencias para el dashboard de PlotStack

Revisión: 21 de agosto de 2026.

## Productos de referencia

- [Substack: guía de métricas](https://support.substack.com/hc/en-us/articles/5320347155860-A-guide-to-Substack-metrics): la tabla Posts presenta todas las publicaciones y permite ordenar entregas, aperturas, altas, likes, comentarios y shares. Growth conecta picos con publicaciones y fuentes.
- [Substack: estadísticas de Notes](https://support.substack.com/hc/en-us/articles/14564821756308-Getting-started-on-Substack-Notes): distingue interacción pública (likes, replies y restacks) de resultados detallados como clics, shares y nuevas suscripciones.
- [Substack: subscriber dashboard](https://support.substack.com/hc/en-us/articles/360058529871-How-do-I-use-the-subscriber-dashboard-on-Substack): separa suscriptores y seguidores, y usa series de crecimiento de audiencia.
- [beehiiv: Posts Report](https://www.beehiiv.com/support/article/12404046405015-understanding-your-posts-report): combina resumen, embudo y tabla completa/ordenable de publicaciones; ofrece exportación PDF por módulo.
- [beehiiv: Account Dashboard](https://www.beehiiv.com/support/article/18794008882839-overview-of-your-account-dashboard): el periodo global actualiza los gráficos y superpone actividad editorial con crecimiento.
- [Mailchimp: campaign reports](https://mailchimp.com/help/about-email-campaign-reports/): prioriza destinatarios, aperturas y clics en el resumen y deja el detalle para el informe de cada campaña.
- [Ghost: growth analytics](https://ghost.org/help/topic/growth-analytics/): trata adquisición, conversión y crecimiento de miembros como preguntas separadas.

## Criterios adoptados

1. El Resumen responde solo a tres preguntas: tamaño/crecimiento de audiencia, rendimiento de email e interacción con publicaciones y Notes.
2. Publicaciones muestra siempre el historial completo; la búsqueda y el orden reemplazan el recorte por periodo.
3. Notes reúne KPIs, cadencia semanal y detalle en una sola jerarquía. No hay un ranking separado que duplique la tabla.
4. Suscriptores y seguidores son métricas distintas. Se muestra el total actual
   de seguidores, pero no una curva hasta observar la serie histórica real.
5. Los títulos nombran el dato directamente; no intentan convertir cada bloque en una conclusión editorial.
6. Pago e ingresos permanecen ocultos por defecto y también durante cualquier captura.

## Límite conocido de la fuente

La documentación de Substack enumera más resultados de Notes que los observados en el endpoint usado por PlotStack. La interfaz solo muestra campos presentes en la respuesta real y no fabrica seguidores o ingresos atribuidos a Notes.
