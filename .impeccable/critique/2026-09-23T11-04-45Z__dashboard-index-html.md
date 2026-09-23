---
target: dashboard
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-09-23T11-04-45Z
slug: dashboard-index-html
---
# Crítica · dashboard/index.html

## Puntuación (Nielsen) — 20/40, Aceptable
| # | Heurística | Nota | Problema clave |
|---|---|---|---|
| 1 | Estado del sistema | 2 | Estado de los datos dice "Sin sincronizar" y 0/9 mientras el pie dice "Sincronizado" |
| 2 | Lenguaje del usuario | 2 | CTOR, ENG, A/D1, "Detalle API", claves en inglés en Efecto de red |
| 3 | Control y libertad | 3 | Cambiar de vista conserva el scroll y aterrizas a media página |
| 4 | Consistencia | 1 | Selector de rango oculto en Envíos (RANGE_AWARE_VIEWS); "altas" con cifras distintas en paneles vecinos |
| 5 | Prevención de errores | 2 | La recomendación "Refuerza X" no exige muestra mínima |
| 6 | Reconocer, no recordar | 2 | Abreviaturas explicadas solo en title; valores del heatmap solo en tooltip |
| 7 | Flexibilidad | 2 | Cabeceras ordenables inaccesibles por teclado |
| 8 | Estética y minimalismo | 3 | Hero excelente; resto denso, etiquetas de 7–9 px |
| 9 | Recuperación de errores | 1 | Vacíos que culpan a Substack sin siguiente paso |
| 10 | Ayuda | 2 | Buenos explicadores puntuales, sin glosario |

## Especificidad
Resumen es propio del producto (edición comentada). Las otras cinco vistas son una plantilla de analítica genérica con piel de papel: panel + KPI + tabla. Ninguna abre con su pregunta, como pide DESIGN.md.

Detector: 1 hallazgo CLI (em-dash, falso positivo: son marcadores "—"). En página: contraste 2,4:1 del botón de rango activo (#92ad28 sobre #faf6ec), texto de 7–10 px generalizado, transición de width en barras, sombra rojiza residual en #sync-button, líneas de ~100 caracteres en .panel-copy. Sin desbordamiento horizontal a 1290 px; a 390 px la página mide ~490 px.

## Problemas prioritarios
1. [P0] El dashboard se contradice: veredicto de crecimiento sobre un gráfico vacío; Notas como fuente principal en Resumen y 0 en Notas; 38 vs 314 altas en Crecimiento; "Sin sincronizar" junto a "Sincronizado". → clarify/harden
2. [P0] Móvil a 390 px roto: página ~490 px, botón Sincronizar fuera de pantalla, tabla de Envíos ilegible. → adapt
3. [P1] Recomendaciones sin umbral y porcentajes inhumanos ("creció 2798,0%"). → clarify
4. [P1] Jerga y claves crudas en la interfaz (Efecto de red en inglés, "direct to app", "Detalle API", CTOR/ENG). → clarify
5. [P2] Las vistas secundarias no abren con su pregunta; muchas abren con gráficos vacíos. → layout/distill

## Personas
- Alex: sin rango en Envíos, ordenar solo con ratón, scroll heredado entre vistas.
- Sam: 168 paradas de tabulación en el heatmap; rango sin aria-pressed; th sin aria-sort; texto de 7–9 px; contraste 2,4:1 del rango activo.
- Autora no técnica: "Refuerza Notas" y luego Notas en cero; "2798,0%"; apertura normal pintada en rojo de retroceso; Estado de datos 0/9 parece avería.

## Observaciones menores
"1 notas" (app.js:2092); centro del donut no corresponde al arco destacado; leyenda con rojo de peligro para "Suscriptores"; columna Tendencia vacía; scroll anidado en .coverage-list; <title> en inglés.

## Preguntas
1. ¿Deben existir cinco vistas de navegación, o ser "¿por qué?" que se abren desde el Resumen?
2. ¿Echaría de menos la autora la tabla de Envíos si fuera "tus 3 mejores y 3 peores envíos y qué comparten"?
3. ¿La cobertura debería vivir en línea ("basado en 6 de 6 notas") y no como destino propio?
