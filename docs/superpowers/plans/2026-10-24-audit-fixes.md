# Audit fixes Implementation Plan

**Goal:** Aplicar la auditoría de datos y presentación del 24 de octubre.
**Architecture:** Mantener los módulos existentes, conservar snapshots compatibles y añadir metadatos de procedencia. Proteger la persistencia con una generación de sincronización y una cola de escrituras.
**Tech Stack:** JavaScript ESM, Chrome MV3, node:test, HTML/CSS sin dependencias de runtime.
**Spec:** `docs/product/auditoria-2026-10-24.md`.

## Constraints

- Sin backend, IA ni nuevas dependencias de runtime.
- Conservar el diseño existente y privacidad por defecto.
- Español e inglés; no presentar datos ausentes como mediciones.

## Execution

- [x] En `tests/substack-api.test.js`, cubrir 120 artículos guardados frente a una página incremental de 50 y fallo de lista. En `src/providers/substack-api.js`, fusionar artículos por ID y conservarlos ante fallos; separar `lastFullRefreshAt` de `capturedAt`, refrescar detalles antiguos por lotes con `detailUpdatedAt`.
- [x] En `tests/background.test.js`, bloquear una petición de detalle, desconectar y liberarla: storage debe permanecer vacío. En `src/background.js`, mantener la exclusión durante detalle y serializar escrituras con generación invalidable.
- [x] En `tests/extended-analytics.test.js`, fallar una ventana y todas las ventanas; comprobar cobertura parcial/no disponible y conservación de datos anteriores. En `src/providers/substack-extended.js`, persistir estado, fecha e intervalo por ventana, conservar fuentes antiguas y declarar 365 días de cobertura en Todo.
- [x] En `src/shared/analytics.js` y proveedores, conservar moneda, metadatos y disponibilidad de métricas. En `src/shared/insights.js`, eliminar equivalencias de impresiones a personas y causalidad del asunto.
- [x] En `dashboard/app.js`, `dashboard/index.html`, `dashboard/styles.css` y diccionarios ingleses, mostrar periodo efectivo, datos parciales/antiguos, acumulación y movimiento neto; priorizar altas y alcance típico en Notas, usar barras para superficies y permitir explorar curvas con teclado.
- [x] Ejecutar `node --import ./tests/fixtures/locale-es.js --test tests/*.test.js` y `node scripts/validate-extension.mjs`; inspeccionar la vista previa en escritorio y ancho reducido, corregir fallos de la pasada y documentar límites.

La ejecución continúa en esta sesión por autorización expresa del usuario; no requiere una nueva elección de flujo ni commits automáticos.
