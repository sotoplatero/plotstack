# Auditoría de PlotStack — 24 de octubre de 2026

Estado posterior: los ajustes se aplicaron en el mismo día. El texto siguiente conserva los hallazgos originales. La implementación conserva artículos por ID, separa el refresco completo, rota detalles antiguos, invalida escrituras de operaciones anteriores, distingue cobertura por ventana y métricas ausentes, declara periodos efectivos y resultados acumulados, corrige los textos de atribución e ingresos y permite explorar curvas con teclado. Notas prioriza altas y alcance típico, adelanta la tabla y usa barras para superficies. Validación: 219 pruebas correctas, paquete válido y revisión de la vista previa en Chrome en escritorio y a 390 px, sin desbordamiento global ni errores de consola. No se contrastaron peticiones contra una cuenta real. Los resultados a igual edad siguen siendo una posibilidad futura: la interfaz declara la diferencia de antigüedad y no afirma haberla corregido estadísticamente.

Auditoría del código actual, primero datos y después presentación. No se ha cambiado la implementación. Se ejecutaron las 212 pruebas (todas pasan), el validador del paquete (correcto) y el detector de Impeccable. Las observaciones visuales se apoyan en las capturas locales de `dist/store`, contrastadas con el HTML y renderizadores actuales; no constituyen una validación visual del navegador en vivo, móvil o zoom. No se consultó una cuenta real ni se verificaron los endpoints contra Substack. Los errores descritos son rutas verificadas en código; las condiciones de carrera no se reprodujeron en una sesión real.

## Datos: correcciones prioritarias

### 1. P1 — La sincronización incremental puede perder artículos guardados

`src/providers/substack-api.js:274–288, 541–548, 598–651`.

El paginador termina cuando encuentra una página completamente conocida. `buildCampaigns` devuelve únicamente las filas de esa pasada; el mapa anterior se usa para recuperar detalle, pero no para conservar artículos ausentes. Con más de 50 artículos, una sincronización sin novedades puede reducir el histórico a la primera página. Si falla la lista, también se puede sustituir por un conjunto vacío o por la alternativa de email.

**Mejora:** fusionar por ID con el snapshot anterior antes de guardar. Una consulta incremental incompleta no demuestra que un artículo haya sido eliminado. Separar reconciliación completa de actualización incremental.

**Verificación pendiente:** primera pasada con 120 artículos, segunda con 50 conocidos: deben seguir existiendo 120; fallo de lista: conservar histórico y marcarlo como antiguo.

### 2. P1 — El refresco semanal no se activa con uso frecuente

`src/providers/substack-api.js:528–533, 719, 755–759`.

`needsFullRefresh` mide siete días desde `capturedAt`, que cambia en cada sincronización. Con uso diario nunca se cumple. Además, incluso una pasada completa del feed no vuelve a pedir detalle disponible de Notas antiguas: solo las doce recientes y las que no tienen datos. Los artículos antiguos con detalle tampoco se refrescan fuera de los doce primeros.

**Mejora:** persistir `lastFullRefreshAt` por publicación, separado de `lastSyncAt`. Refrescar métricas antiguas mediante una cola rotatoria con antigüedad máxima explícita. Mostrar su fecha de medición.

### 3. P1 — La fase de detalle puede escribir después de desconectar o de otro sync

`src/background.js:166–205, 208–259, 281–284`.

`syncInFlight` se libera al devolver la fase rápida, mientras `runDetailPhase` continúa. Desconectar elimina storage pero no cancela ni invalida la escritura pendiente. Una segunda operación puede solaparse y una fase antigua volver a guardar su snapshot.

**Mejora:** identificador de generación y publicación, comprobado antes de cada escritura; invalidarlo al desconectar/cambiar publicación y cancelar peticiones. Mantener exclusión durante ambas fases y distinguir la respuesta rápida de la finalización completa.

### 4. P1 — Cobertura confunde ventana fallida con respuesta disponible

`src/providers/substack-extended.js:483–490, 517–525, 561–569`.

Los errores de adquisición, tráfico y red se capturan dentro de cada ventana y se convierten en objetos normalizados vacíos. La promesa exterior se resuelve y Cobertura marca la fuente `ready`, incluso si fallan todas las ventanas. La fase rápida también puede convertir campos de fuentes fallidas en cero mediante los normalizadores.

**Mejora:** guardar por fuente y rango `status`, `error`, `fetchedAt`, intervalo y último resultado válido. Diferenciar cero medido, vacío válido, dato ausente, parcial y antiguo; conservar los anteriores cuando falle el refresco.

### 5. P1 — «Todo» mezcla horizontes diferentes

`src/providers/substack-extended.js:475–478, 529–536`; `dashboard/app.js:2150`.

Adquisición y fuentes de tráfico usan `all: 365`; el efecto de red usa `all time`; otras series se solicitan para doce meses. La postal puede decir «Desde el principio». Las publicaciones anteriores a un año quedan fuera de algunas cifras sin una indicación equivalente.

**Mejora:** consultar desde el inicio real cuando sea posible; en caso contrario, mostrar el intervalo efectivo de cada fuente y evitar «Desde el principio». El rango común debe declarar cuándo una fuente solo cubre parte.

### 6. P1 — El selector filtra piezas por fecha, pero suma sus resultados acumulados

`dashboard/app.js:144–153, 2751–2771`; `src/shared/analytics.js:330–364`.

Al elegir 30 días, las Notas se seleccionan por fecha de publicación y después se suman sus contadores actuales. Lo mismo sucede con aperturas y clics de los envíos seleccionados: no son necesariamente eventos ocurridos dentro de esos 30 días. Las notas nuevas también han tenido menos tiempo para acumular resultados que las antiguas.

**Mejora inmediata:** «Resultados acumulados de las notas publicadas en este periodo» y «Apertura acumulada de los envíos del periodo». Para comparar rendimiento, usar resultados a igual edad (24 h/7 días) cuando existan snapshots suficientes. Para actividad ocurrida en un periodo, usar series de eventos o diferencias entre capturas con cobertura declarada.

### 7. P2 — El detalle ausente puede parecer cero medido

`src/shared/analytics.js:13–21, 94–120, 130–161, 226–254`; `dashboard/app.js:2751–2771`.

La normalización numérica reduce ausencia a cero en muchos campos. El resumen de Notas suma impresiones y altas únicamente de las que tienen detalle, pero presenta cifras normales incluso si ninguna está medida. A la vez, las interacciones mezclan el total del detalle con el respaldo público de likes, respuestas y restacks.

**Mejora:** disponibilidad por métrica, no solo por pieza. Sin mediciones, mostrar «Sin datos»; con cobertura parcial, «al menos X · 4/10 notas». Mantener una definición uniforme de interacciones al comparar piezas.

### 8. P2 — Algunos hallazgos hacen afirmaciones que el cociente no demuestra

`src/shared/insights.js:683–684, 731–739, 779`.

Interacciones/impresiones no identifica el porcentaje de personas que interactuó: una persona puede realizar varias acciones y generar varias impresiones. Más impresiones tampoco prueba más personas únicas. «La apertura mide el asunto» atribuye una causa única que el cálculo no establece.

**Mejora:** «X interacciones por cada 100 impresiones», «X % más impresiones por nota» y «Revisa el asunto y las condiciones del envío». Los cortes por horario deben presentarse como asociación, con muestra y antigüedad comparables.

### 9. P2 — El delta de ingreso tiene una referencia incorrecta

`src/providers/substack-api.js:636, 698`; `dashboard/app.js:341, 363`; `src/shared/analytics.js:681`.

El valor anterior procede del inicio de la ventana de 30 días, pero la tarjeta dice «vs. sincronización anterior». Además, `formatCurrency` fija USD (`analytics.js:323–329`), sin moneda persistida.

**Mejora:** nombrar la ventana real y persistir la moneda. Distinguir ingreso mensual estimado a partir de ARR de dinero cobrado en el periodo.

## Presentación: oportunidades en orden

### 10. P2 — Poner la fiabilidad junto al número

La cobertura vive principalmente en Estado de datos y en contadores de Notas. Una cifra puede parecer actual aunque su detalle sea antiguo o su fuente haya fallado. Añadir al KPI afectado una frase breve: «Parcial: 4/10 notas», «Medido ayer» o «No se pudo actualizar». El detalle técnico puede seguir en Estado de datos.

### 11. P2 — El resumen debe explicar el movimiento neto

La captura muestra «Tu audiencia crece y sumó 463 altas» junto a un cambio del total de suscriptores. Las altas brutas no explican por sí solas la variación neta. Dar prioridad a «+X netos: Y altas y Z bajas», siempre que las fuentes, definiciones y ventanas sean conciliables. Cuando no lo sean, mostrar las cifras por separado y explicar la diferencia.

Conservar las tres tarjetas principales y el color constante por métrica. Añadir el número exacto al dato compacto mediante un acceso de teclado y lector de pantalla.

### 12. P2 — Reordenar Notas por la decisión del autor

La primera pantalla dedica mucho espacio a seis totales y dos donuts; «Superficies» exige vocabulario técnico. Propuesta: primero alcance típico y altas atribuidas con cobertura; después notas destacadas comparables; luego «Dónde se ven tus notas» y audiencia. Para siete superficies, barras horizontales ordenadas permiten comparar mejor categorías pequeñas. El donut de audiencia puede conservarse como composición, con la etiqueta «impresiones», sin presentarlo como personas únicas.

### 13. P2 — Afinar accesibilidad sin un rediseño general

`dashboard/app.js:434–459` permite explorar puntos de curvas con puntero; no ofrece un recorrido equivalente punto por punto con teclado. Existen resúmenes accesibles de gráficos, ayudas con foco y navegación de teclado en el mapa de cadencia: conservarlos. Añadir una tabla de datos o navegación por flechas para la exploración exacta de curvas.

El detector emitió avisos de tipografía pequeña y desviaciones de tokens. No se contabilizan automáticamente como fallos: los radios en `cqi` de postales y las imágenes cuyo `src` se asigna al conectar necesitan contexto. Revisar tamaños efectivos de textos funcionales y zoom al 200 % en navegador antes de afirmar incumplimientos. No hay evidencia suficiente para certificar WCAG, contraste completo ni comportamiento móvil.

## Lo que funciona

- Tasas ponderadas por entregados y comparación con ventanas anteriores del mismo tamaño.
- Bases de audiencia por rango, con ausencia de comparación expresada explícitamente.
- Separación de suscriptores y seguidores; filtrado de restacks ajenos.
- Umbrales mínimos y muestras visibles en varios hallazgos.
- PII descartada antes de persistir, sin backend y métricas sensibles ocultas por defecto.
- Interfaz coherente, jerarquía clara en Resumen y colores estables.
- 212 pruebas y validación de empaquetado correctas. La suite no evita los defectos de composición entre paginación, caché y persistencia señalados aquí.

## Orden de trabajo propuesto

1. Conservar el histórico, corregir refresco periódico y proteger escrituras frente a operaciones antiguas.
2. Establecer un contrato de métricas: unidad, fuente, intervalo, denominador, fecha y cobertura.
3. Corregir fallos parciales y «Todo»; añadir pruebas de integración para esos escenarios.
4. Ajustar textos sobre acumulación, personas, atribución e ingresos.
5. Hacer visibles calidad y movimiento neto; después reordenar Notas y verificar teclado/zoom.

Para la parte de interfaz, las pasadas adecuadas son `$impeccable clarify`, `$impeccable harden` y, tras comprobar datos y comportamiento, `$impeccable polish`. La evaluación visual debe repetirse con capturas actuales y escenarios de datos parciales. No se asigna una puntuación global de accesibilidad o diseño sin esa verificación.
