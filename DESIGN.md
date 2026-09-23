---
name: PlotStack
description: Un informe editorial que traduce el crecimiento de una newsletter.
colors:
  warm-lime: "#92ad28"
  paper-ground: "#f2ede1"
  paper-surface: "#faf6ec"
  ink: "#24231f"
  muted-ink: "#6f6a5f"
  positive: "#627b0f"
typography:
  display:
    fontFamily: "Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "clamp(42px, 5vw, 72px)"
    fontWeight: 400
  body:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
rounded:
  control: "2px"
  mark: "3px"
spacing:
  compact: "9px"
  control: "18px"
  section: "42px"
---

# Design System: PlotStack

## Overview

**Creative North Star: "La edición comentada"**

PlotStack se comporta como una lectura editorial de los datos del autor: una hoja sobria, reglas finas y anotaciones puntuales que explican qué merece atención. La interfaz debe sentirse escrita y editada, no ensamblada como un centro de mando.

La jerarquía antepone una conclusión humana a la evidencia. Los gráficos justifican la lectura; las tablas y métricas de diagnóstico permanecen en vistas secundarias.

**Key Characteristics:**

- Fondo de papel y tinta de alto contraste.
- Verde lima cálido y vivo reservado para marcas, acciones y crecimiento positivo.
- Tipografía serif para conclusiones; sans serif para controles y datos.
- Bordes rectos, reglas de un píxel y ausencia de decoración volumétrica.

## Colors

La paleta usa tres valores materiales: papel, tinta y un verde lima cálido con suficiente energía para destacar sin volver al neón ácido.

**The Rubric Rule.** El verde lima cálido señala dónde mirar o actuar; no colorea grandes superficies informativas.

**The Meaning Rule.** El verde comunica marca y avance; el rojo queda reservado para retrocesos y errores.

## Typography

**Display Font:** Iowan Old Style, con Palatino o Georgia como respaldo.

**Body Font:** Aptos, con Segoe UI como respaldo.

**Character:** La serif da voz a conclusiones y títulos; la sans mantiene controles, etiquetas y cifras funcionales sin teatralidad.

### Hierarchy

- **Display** (400, `clamp(42px, 5vw, 72px)`, 0.98): una sola conclusión principal por pantalla.
- **Headline** (400, 27px, 1.1): títulos de gráficos y secciones.
- **Body** (400, 14–19px, 1.5): explicación en lenguaje natural.
- **Label** (700, 11px, espaciado corto): nombres breves de métricas y controles.

## Layout

El escritorio usa navegación lateral fija y una hoja central de hasta 1320px. La portada avanza en este orden: lectura, tres cifras, evidencia temporal, impulsores y detalle plegado. Bajo 960px las anotaciones y gráficos secundarios forman una sola columna; bajo 760px las métricas también se apilan.

## Elevation & Depth

El sistema es plano. Las reglas, el contraste tonal y el espacio expresan jerarquía; las sombras se reservan para menús flotantes y acciones que realmente se elevan.

## Shapes

Los contenedores son rectangulares y las reglas son de un píxel. Los radios de 2–3px pertenecen solo a controles y a la marca.

## Components

### Buttons

- **Primary:** fondo verde lima cálido, texto oscuro, borde recto y verbo explícito.
- **Focus:** contorno de dos píxeles separado tres píxeles.

### Cards / Containers

- **Corner Style:** recto.
- **Background:** papel superficial sobre el fondo de papel.
- **Shadow Strategy:** ninguna en contenido persistente.
- **Border:** regla de un píxel.

### Navigation

La sección activa se reconoce por texto oscuro y una regla inferior verde. Los nombres usan lenguaje cotidiano: Tus lectores, Cómo creces, Envíos y Estado de datos.

### Informe de crecimiento

Combina una conclusión, una recomendación y evidencia visual. No muestra una afirmación cuando falta una base de comparación suficiente.

## Do's and Don'ts

### Do:

- **Do** comenzar cada vista principal con la pregunta que responde.
- **Do** traducir tasas y fuentes a frases accionables.
- **Do** plegar el detalle que no cambie una decisión inmediata.

### Don't:

- **Don't** llenar la primera pantalla con métricas de cobertura o diagnóstico.
- **Don't** usar color sin significado.
- **Don't** presentar una correlación como recomendación cuando la muestra es insuficiente.
