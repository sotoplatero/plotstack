---
name: PlotStack
description: Un resumen de salud personal del crecimiento de una newsletter, con un color fijo por métrica.
colors:
  grouped-gray: "#f2f2f7"
  grouped-gray-deep: "#e9e9ef"
  surface: "#ffffff"
  ink: "#1c1c1e"
  muted-ink: "#6c6c70"
  separator: "rgba(60, 60, 67, 0.12)"
  track-fill: "rgba(118, 118, 128, 0.12)"
  subs-indigo: "#5856d6"
  subs-indigo-text: "#4a48c4"
  open-orange: "#ff9500"
  open-orange-text: "#b35900"
  click-blue: "#007aff"
  click-blue-text: "#0062cc"
  notes-green: "#34c759"
  notes-green-text: "#1f7a36"
  views-purple: "#af52de"
  views-purple-text: "#8a3cb3"
  followers-pink: "#ff2d55"
  followers-pink-text: "#c9143a"
  loss-red: "#ff3b30"
  danger-text: "#d70015"
  positive-text: "#248a3d"
  neutral-gray: "#aeaeb2"
  level-1: "#1c1c1e"
  level-2: "#8e8e93"
  level-3: "#d1d1d6"
  channel-notes: "#34c759"
  channel-recs: "oklch(0.68 0.11 185)"
  channel-substack: "oklch(0.76 0.14 90)"
  channel-email: "oklch(0.58 0.09 220)"
  channel-social: "oklch(0.44 0.12 355)"
  channel-search: "oklch(0.52 0.02 260)"
  channel-direct: "oklch(0.50 0.05 55)"
  channel-other: "oklch(0.74 0 0)"
typography:
  display:
    fontFamily: "Geist, Segoe UI Variable Display, SF Pro Display, system-ui, sans-serif"
    fontSize: "clamp(32px, 3.4vw, 44px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geist, Segoe UI Variable Display, SF Pro Display, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, Segoe UI Variable Display, SF Pro Display, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  data:
    fontFamily: "Geist, Segoe UI Variable Display, SF Pro Display, system-ui, sans-serif"
    fontSize: "clamp(34px, 3.2vw, 46px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "\"lnum\" 1, \"tnum\" 1"
  dek:
    fontFamily: "Geist, Segoe UI Variable Text, SF Pro Text, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Segoe UI Variable Text, SF Pro Text, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
  meta:
    fontFamily: "Geist, Segoe UI Variable Text, SF Pro Text, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
rounded:
  card: "16px"
  overlay: "14px"
  inset: "12px"
  control: "10px"
  capsule: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  pad: "24px"
  pad-mobile: "16px"
  group: "16px"
  section: "32px"
components:
  button-sync:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.capsule}"
    typography: "{typography.label}"
  button-action:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.capsule}"
    padding: "9px 16px"
  button-icon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.capsule}"
  button-icon-hover:
    backgroundColor: "{colors.grouped-gray-deep}"
  range-control:
    backgroundColor: "{colors.track-fill}"
    rounded: "{rounded.capsule}"
    padding: "3px"
  range-option:
    textColor: "{colors.ink}"
    rounded: "{rounded.capsule}"
    padding: "7px 14px"
  range-option-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  nav-item:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
  nav-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  badge:
    backgroundColor: "{colors.grouped-gray}"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.capsule}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "24px"
  metric-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px 22px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.overlay}"
---

# Design System: PlotStack

## Overview

**Creative North Star: "El resumen de salud"**

PlotStack se lee como el resumen de salud personal de una newsletter, no como un periódico ni como un SaaS azul. Cada métrica tiene un color propio y lo conserva en toda la app: quien ve los suscriptores en índigo en el Resumen los encuentra en índigo en Audiencia, en la leyenda de un gráfico y en el punto de una lista. El color no decora; es la dirección de cada cifra.

El mundo es plano y agrupado. Superficies blancas de radio 16 descansan sobre un gris agrupado, sin borde ni sombra: el cambio de tono es lo único que separa. La tinta es casi negra, las cifras y los títulos van en Geist en negrita, y todas las etiquetas están en caja de frase. Los estados se invierten (el elemento activo es un bloque lleno de tinta con texto blanco), las acciones también van en tinta, y los controles son cápsulas.

La densidad es moderada: pocas cifras grandes arriba, detalle en paneles debajo. La primera pantalla del Resumen es un veredicto en negrita, tres tarjetas de métrica con su tono y su tendencia, y el gráfico de suscriptores en índigo; la acción vive en la tarjeta de recomendación.

**Key Characteristics:**
- Un solo tema claro; no hay conmutador de tema.
- Un color fijo por métrica, con variante `-text` para texto sobre blanco.
- Tarjetas blancas de radio 16 sin borde ni sombra sobre gris agrupado.
- Estados activos invertidos y acciones en tinta: bloque de tinta, texto blanco.
- Controles en cápsula: rango, sincronizar, acción, insignias.
- Geist autoalojada en negrita para cifras y títulos; numerales tabulares.
- Caja de frase en todas partes; ningún texto por debajo de 10px.

## Colors

Neutros fríos, una escala neutra de niveles, y una paleta de tonos plenos, uno por métrica, que nunca cambian de significado. Las acciones no tienen color propio: van en tinta.

### Primary
- **Tinta de acción** (ink, como `--accent`): el color de lo que se pulsa y de lo activo. Botón Sincronizar, botón de acción, botón de conexión, anillo de foco, marca de la barra lateral y enlaces de detalle, además de la navegación y el rango invertidos. Acción y estado hablan el mismo idioma.

### Secondary
Tonos de métrica.
- **Índigo de suscriptores** (subs-indigo / subs-indigo-text): solo la métrica Suscriptores: su tarjeta, su gráfico de audiencia, la serie principal de altas y bajas, la ubicación de la audiencia. Ya no es acento ni marca.

Cada tono tiene una variante plena para marcas (líneas, barras, puntos, segmentos) y una variante `-text` que alcanza 4,5:1 sobre blanco para rótulos y cifras coloreadas.
- **Naranja de apertura** (open-orange / open-orange-text): lectores que abren, tasa de apertura, cortes de publicaciones por día, sección y longitud.
- **Azul de clics** (click-blue / click-blue-text): lectores que hacen clic, CTR; serie secundaria del gráfico de tasas por publicación.
- **Verde de notas** (notes-green / notes-green-text): todo lo que viene de Notas: atribución, mapa de cadencia, tabla de notas, total de interacciones.
- **Morado de visitas** (views-purple / views-purple-text): vistas, tráfico, descubrimiento.
- **Rosa de seguidores** (followers-pink / followers-pink-text): seguidores y audiencias solapadas.
- **Rojo de bajas** (loss-red): bajas, siempre como serie secundaria junto al índigo en los paneles de altas y bajas. Sin variante de texto: el texto de error usa danger-text.

### Tertiary
- **Paleta de canales de adquisición** (channel-*): una sola regla OKLCH. Cada canal ocupa un tono libre de métricas (90, 185, 220) o, cuando comparte zona con una métrica, se separa por luminosidad y croma: vino oscuro (social, 355) frente al rosa y el morado; pizarra casi gris (búsqueda, 260) frente al azul; marrón (directo, 55) frente al naranja; amarillo ocre (red de Substack, 90); verde azulado (recomendaciones, 185); azul acero apagado (email, 220); gris neutro (otros). **Notas conserva a propósito el verde de la métrica Notas** (channel-notes = notes-green): es el mismo concepto. `app.js` asigna el color por nombre de fuente (`channelColor()` sobre `CHANNEL_COLORS`), así que un canal tiene el mismo color en Resumen, Crecimiento y en cualquier donut o lista.

### Neutral
- **Gris agrupado** (grouped-gray): fondo de la app, de la barra lateral y de la topbar translúcida; también el hueco entre celdas de las rejillas de cifras, el carril de las barras de progreso y el fondo de las insignias.
- **Gris agrupado hondo** (grouped-gray-deep): hover de los botones de icono.
- **Superficie** (surface): tarjetas, paneles, menús, celdas KPI.
- **Tinta** (ink): texto principal, cifras y bloque de los estados activos invertidos y del toast.
- **Tinta atenuada** (muted-ink): dek, etiquetas, meta, ejes, celdas de tabla no principales.
- **Separador** (separator): filas de tabla y el pie de gráfico. Es el único trazo lineal del sistema.
- **Relleno de carril** (track-fill): fondo de la cápsula del selector de rango.
- **Gris neutro** (neutral-gray): serie sin métrica propia y barra de scroll.
- **Escala de niveles** (level-1 / level-2 / level-3): tinta, gris medio y gris claro para niveles y estados que no son una métrica. Actividad de la lista: alta (level-1), baja (level-2), inactivos (level-3). Estado de datos: listo es un punto lleno de tinta, pendiente un punto gris medio, no disponible un anillo hueco de 1,5px en gris medio. El punto de conexión de la barra lateral también es level-1.
- **Positivo y peligro** (positive-text, danger-text): deltas al alza, cuadrante ganador, cuadrante débil y errores. Son estados, no métricas.

### Named Rules
**The Un Color, Un Significado Rule.** Un tono de métrica solo significa esa métrica. Antes el email era el azul de los clics y la red de Substack el naranja de la apertura; se corrigió porque un mismo color decía dos cosas. Un color nuevo necesita un hueco de tono o una separación clara de luminosidad y croma.

**The Panel Declara Su Serie Rule.** El color de un gráfico no se escribe en el gráfico. Cada panel declara `--series` (y `--series-2` para la serie secundaria, `--series-text` para texto); líneas, puntos, barras, degradados, leyendas y pistas de lista lo leen de ahí, con el acento como respaldo.

**The Niveles en Neutro Rule.** Un nivel o un estado que no es una métrica (actividad alta/baja/inactiva, listo/pendiente/no disponible) se pinta con la escala neutra level-1/2/3, nunca con un tono de métrica. La palabra dice el estado; el punto lo repite.

**The Variante de Texto Rule.** Un tono pleno nunca escribe texto sobre blanco; para eso existe su variante `-text` (4,5:1).

## Typography

**Display Font:** Geist, variable 100–900 (con "Segoe UI Variable Display", "SF Pro Display", system-ui, sans-serif)
**Body Font:** Geist (con "Segoe UI Variable Text", "SF Pro Text", system-ui, sans-serif)

**Character:** una sola familia, Geist, en dos papeles: en negrita y con tracking negativo para cifras y títulos; en 400–600 para explicar. Sustituye a la sans del sistema, que en Windows era Segoe UI: el cromo del sistema, no el carácter del mundo.

**Origen:** Geist (OFL, Vercel) se distribuye con la extensión en `assets/fonts/Geist-Variable.woff2`, con su licencia al lado, y se declara con `@font-face` (`font-display: swap`). No se carga desde ninguna red. La captura PNG incrusta las URL de `@font-face` como data URL, así que la imagen conserva la fuente.

### Hierarchy
- **Display** (700, clamp(32px, 3.4vw, 44px), 1.08, −0.03em; 32px en móvil): el veredicto del Resumen, una sola vez por pantalla. También los titulares del onboarding.
- **Headline** (700, 30px, 1.1, −0.02em; 26px en móvil): el título del primer panel de cada vista secundaria, que encabeza la vista.
- **Title** (700, 21px, 1.2, −0.015em): los demás títulos de panel.
- **Data** (700, −0.02em, numerales tabulares): cifra de las tarjetas de métrica a clamp(34px, 3.2vw, 46px), y cuatro tamaños de cifra para el resto: 36px (totales grandes, 28px en móvil), 24px (rejillas KPI, 20px en móvil), 18px (pies de gráfico, listas, leyendas).
- **Dek** (400, 14px, 1.5, máx. 64ch, tinta atenuada): la explicación en lenguaje llano bajo cada título. La frase del veredicto sube a 18px/1.5 en tinta (16px en móvil).
- **Label** (600, 12px, 1.3, sin tracking): nombres de campo y columna. En las tarjetas de métrica sube a 700 14px y se escribe en el `--series-text` de su métrica, precedido de un punto de 9px en el tono pleno. Las cabeceras de las tablas densas van a 11px.
- **Meta** (400–500, 11–12px): fechas, leyendas, insignias, pies. Las etiquetas de eje de los gráficos son el mínimo del sistema: 10px.

### Named Rules
**The Caja de Frase Rule.** Todo texto va en caja de frase, sin mayúsculas espaciadas. Las abreviaturas siguen siendo siglas.

**The Suelo de 10px Rule.** Ningún texto de la interfaz baja de 10px; 10px está reservado a etiquetas de eje.

**The Cifra Tabular Rule.** Toda cifra en tarjeta, rejilla, tabla, eje o pie usa `lining-nums tabular-nums`, incluso cuando un atajo `font` la reiniciaría.

## Layout

Barra lateral fija de 232px (64px de iconos en móvil) y una hoja de contenido centrada de hasta 1320px. La escala de espaciado parte de 4px (4, 8, 12, 16). Dos distancias ordenan la pantalla: `--space-group` (16px) entre piezas que responden a la misma pregunta y entre la cabecera de un panel y su contenido, y `--space-section` (32px) entre grupos distintos de una vista.

El relleno de panel es `--pad`: 24px en escritorio, 16px por debajo de 760px. `--pad` también gobierna los sangrados negativos: tablas, listas de notas y rejillas KPI se extienden hasta el borde de la tarjeta con `calc(-1 * var(--pad))`, así que al cambiar el relleno los sangrados siguen alineados.

Las rejillas de paneles usan `auto-fit` con mínimo de 300px, de modo que tres paneles equivalentes quedan como iguales y se apilan solos. Puntos de corte observados: 1180px, 1050px, 960px, 850px, 760px (compacto: `--pad` 16px, barra de iconos, titulares reducidos) y 560px.

En el Resumen las tarjetas de métrica se separan por `--space-group` y comparten una misma ranura de pie: minigráfico de barras de 32px en el color de la métrica y, debajo, una leyenda de 600 12px en tinta atenuada, empujados al fondo de la tarjeta.

## Elevation & Depth

El sistema es plano. Las tarjetas y paneles no tienen sombra ni borde; la profundidad la da el tono: blanco sobre gris agrupado, y en las rejillas de cifras celdas blancas separadas por huecos de 2px del gris de fondo. La topbar es gris agrupado translúcido al 88% con desenfoque de 14px.

### Shadow Vocabulary
- **Superposición flotante** (`box-shadow: 0 12px 40px rgba(0, 0, 0, .14)`): solo menús que flotan sobre el contenido (captura, privacidad). Nunca en una tarjeta.
- **Halo de estado** (`box-shadow: 0 0 0 4px rgba(28, 28, 30, .08)`): el punto de conexión activa de la barra lateral.
- **Anillo hueco** (`box-shadow: inset 0 0 0 1.5px var(--level-2)`): el punto de "no disponible" en Cobertura.

### Named Rules
**The Tono Separa Rule.** Una superficie se distingue por su tono, no por un borde ni una sombra. Si dos zonas necesitan separarse, cambia el fondo o abre un hueco del gris.

## Shapes

Esquinas generosas y consistentes. Tarjetas y paneles a 16px (la tarjeta de conexión, 20px); menús y toast a 14px; contenedores interiores (cuadrantes, insignia de privacidad) a 12px; elementos de navegación a 10px. Todo lo que es control o recorrido es cápsula (999px): selector de rango y sus opciones, botones Sincronizar, de acción y de icono, insignias, carriles y rellenos de barras. Los puntos de leyenda, de canal y de métrica son círculos. Las barras verticales redondean solo la parte superior (3px); las celdas del mapa de calor, 4px.

## Components

### Buttons
Cápsulas llenas y directas.
- **Shape:** cápsula (999px).
- **Primario (Sincronizar, acción de la recomendación, conectar):** tinta llena, texto blanco, 600 13px; la acción lleva 9px 16px de relleno. Hover: la tinta mezclada con un 12% de negro. Nunca índigo: el índigo es solo suscriptores.
- **Icono (cámara, privacidad):** cápsula blanca con tinta; hover al gris agrupado hondo.
- **Sincronizando:** solo gira el icono (`is-loading`) con `aria-busy`; el botón no cambia de texto ni de ancho.
- **Foco:** anillo de 2px en tinta con 3px de separación, en toda la app.

### Chips
- **Insignia de periodo:** cápsula gris agrupado, tinta atenuada, 500 12px, 6px 12px. En un panel navegable se tiñe de tinta al 10% con texto en tinta.
- **Etiqueta de la recomendación:** cápsula de tinta al 10%, 600 12px, texto en tinta.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** superficie blanca sobre gris agrupado.
- **Shadow Strategy:** ninguna (ver Elevation & Depth).
- **Border:** ninguno.
- **Internal Padding:** `--pad` (24px / 16px); tarjetas de métrica 20px 22px (18px en móvil).
- **Rejillas KPI:** fondo gris agrupado con huecos de 2px y celdas blancas, sin reglas.

### Navigation
- **Barra lateral:** fondo gris agrupado sin borde; elementos 500 en tinta atenuada, radio 10px; hover con un velo gris del 6%. **Activo invertido:** bloque de tinta lleno con texto blanco. En móvil se reduce a iconos de 44px.
- **Selector de rango:** cápsula de relleno gris con opciones 600 12px en tinta; **la opción activa es una cápsula llena de tinta con texto blanco.**

### Tarjeta de métrica (firma)
Nombre de la métrica en su `--series-text` a 700 14px con un punto de 9px en el tono pleno; cifra Data en tinta; delta en 500 13px atenuado (verde positivo si sube; "sin comparación" si no hay base); pie compartido con barras en el color de la métrica al 26% y la última barra plena, y leyenda de 12px. Las tres tarjetas del Resumen son idénticas en estructura: suscriptores (índigo), apertura (naranja), clics (azul).

### Gráficos
Línea de 2.5px en `--series`, puntos blancos con contorno de la serie, serie secundaria sólida (no discontinua) en `--series-2`, rejilla en el separador, ejes 10px atenuados, leyenda 500 12px con puntos circulares. El eje X es proporcional al tiempo.

### Barras apiladas y sus leyendas
Cada elemento de la leyenda lleva la clase de su segmento (`is-<clave>`) y un punto circular de 8px coloreado como ese segmento, de modo que la leyenda se lee sin adivinar. Actividad de la lista usa la escala de niveles; la barra de la red de Substack usa la paleta de canales.

### Toast
Bloque de tinta con texto blanco, radio 14px: el mismo lenguaje invertido que los estados activos.

## Do's and Don'ts

### Do:
- **Do** mantener el significado único de cada color: suscriptores índigo, apertura naranja, clics azul, notas verde, visitas morado, seguidores rosa, bajas rojo.
- **Do** declarar el color en el panel (`--series`, `--series-2`, `--series-text`) y dejar que gráficos, barras, puntos y leyendas lo lean.
- **Do** pintar acciones y estados activos en tinta, y niveles o estados que no son métricas con la escala level-1/2/3.
- **Do** dar a cada elemento de una leyenda de barra apilada el punto del color de su segmento.
- **Do** usar la variante `-text` de un tono para cualquier texto coloreado sobre blanco.
- **Do** añadir un canal nuevo dentro de la regla OKLCH de canales: tono libre, o separación por luminosidad y croma si comparte zona con una métrica.
- **Do** separar superficies por tono: tarjeta blanca de 16px sobre gris agrupado, rejillas KPI con huecos de 2px.
- **Do** invertir el estado activo (bloque de tinta, texto blanco) y dar forma de cápsula a todo control.
- **Do** escribir cifras en Geist negrita con numerales tabulares, y todo texto en caja de frase.
- **Do** derivar sangrados de `--pad` (24px / 16px), y usar 16px dentro de un grupo y 32px entre grupos.

### Don't:
- **Don't** reintroducir el papel crema, la serif display, las reglas editoriales finas entre secciones ni el grano del mundo anterior.
- **Don't** usar etiquetas en mayúsculas con tracking.
- **Don't** poner a la vez borde y sombra en una tarjeta; las tarjetas no llevan ninguno de los dos.
- **Don't** reutilizar un tono de métrica para un estado, una acción o una categoría que no sea esa métrica; en particular, no vuelvas a usar el índigo como acento.
- **Don't** cargar fuentes desde una red: la fuente viaja en `assets/fonts`.
- **Don't** pintar texto con un tono pleno sobre blanco.
- **Don't** bajar ningún texto de 10px.
- **Don't** cambiar la geometría de la topbar para comunicar sincronización.
