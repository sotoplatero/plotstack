# Changelog

Las versiones que se han subido a la Chrome Web Store. La tienda **no permite
bajar** un número de versión, así que cada entrada aquí corresponde a un
`manifest.json` que ya se publicó o está listo para publicarse.

## 1.1.0 — 4 de septiembre de 2026

### La espera ciega desaparece

- **Sincronización en dos fases.** La primera trae escalares y listas y deja el
  dashboard pintado; la segunda resuelve lo caro (detalle por publicación, feed
  de notas y la cola de `note_stats`) en segundo plano e informa de su progreso.
  Un fallo en la segunda deja intacto lo que la primera ya guardó.
- **Limitador único de cuatro peticiones simultáneas.** El snapshot y las
  fuentes ampliadas se lanzaban en paralelo sin tope global, y la ráfaga
  provocaba los 429 que vaciaban las estadísticas de las notas.
- **Paginadores incrementales.** El feed de notas y la lista de publicaciones
  paran cuando una página entera ya está en el snapshot, con recorrido completo
  si los datos tienen más de una semana.
- **Refresco diario** con `chrome.alarms` (permiso nuevo), para que el histórico
  crezca aunque no se abra el dashboard.

### Datos nuevos

- **Tráfico:** visitas por día, y por fuente con su conversión a alta.
- **Efecto de red:** qué parte de la audiencia llega por la red de Substack.
  La ruta no estaba rota: respondía 500 porque se llamaba sin `time_window`.
- **Comparación con Substack:** el veredicto de crecimiento que la propia
  plataforma publica, y que no se puede derivar de datos propios.
- **Solapamiento de audiencia:** qué publicaciones comparten lectores contigo.
- **Retención por cohorte**, además de las tasas medias.
- **Secciones** por publicación, que ya viajaban en la fila del post.

### Ángulos nuevos sin una petición más

- Vistas por entrega, y el reparto entre lo que depende del correo y lo que se
  descubre fuera.
- Altas en días con envío frente a días en silencio, con su múltiplo.
- Concentración de las visitas en las tres fuentes principales.
- Qué superficie de Notes convierte. Es una **estimación** declarada: Substack
  atribuye altas a la nota entera, no a cada superficie.
- Alcance fuera de la burbuja, desde el desglose de audiencia por nota.

### Presentación

- **Notas** pasa a seis cifras grandes, dos gráficos de pastel («dónde se ven» y
  «quién las ve»), mapa de calor día × hora y listado paginado de 25 en 25.
- **Seguidores y suscriptores** en el mismo gráfico, dentro del panel de
  seguidores: superponerlos en la curva de Audiencia le cambiaba la escala al
  gráfico que comparte con el Resumen.
- Tooltip de cursor en los gráficos y leyenda para la serie secundaria.
- El selector de rango ya no tiene excepciones: el panel de adquisición llevaba
  un badge «· fijo» que reflejaba una limitación nuestra, no de la API.

### Correcciones

- El **delta de suscriptores** compara contra la ventana del selector. Decía
  «vs. sincronización anterior» mientras comparaba siempre contra 30 días.
- Las **altas de pago** se perdían cuando las gratuitas eran cero: se tomaba el
  primer valor finito en vez de sumar las claves presentes.
- Una **tasa por publicación** del 0,8 % se mostraba como 80 %, por aplicar la
  heurística «≤ 1 ⇒ ×100» a un campo que ya venía en porcentaje.
- Un `analytics` guardado por la versión anterior ya no vacía el panel de
  adquisición: muestra lo que tiene y avisa de que hay que sincronizar.
- El eje Y de los gráficos ya no repite la misma etiqueta cuando el recorrido es
  estrecho: con la curva entre 2.710 y 2.840, las cuatro marcas salían todas
  como «2,8 mil».
- Los segmentos de los gráficos de pastel se distinguen: rampa de luminancia con
  pasos separados y un hueco entre porciones, en vez de dos grises casi iguales.
- El panel de visitas daba dos cifras distintas de «visitas», del gráfico y de la
  tabla, que son endpoints distintos. Ahora hay una sola y la nota lo explica.

## 1.0.0 — 2 de septiembre de 2026

Primera versión pública: seis vistas, sincronización manual, captura PNG por
página y por tarjeta, exportación CSV, y el panel de Cobertura.
