# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El usuario principal es un autor independiente de newsletter que quiere crecer y no tiene conocimientos técnicos ni formación analítica.

## Product Purpose

PlotStack reúne localmente las métricas de una publicación de Substack y las convierte en una lectura sencilla del crecimiento: qué está pasando, qué lo impulsa y dónde conviene actuar. El éxito consiste en que el autor entienda el estado de su publicación en pocos segundos sin interpretar un panel técnico.

## Positioning

PlotStack usa la sesión de Substack ya autenticada en Chrome, normaliza sus métricas y las presenta localmente sin backend, telemetría ni servidor intermedio.

## Operating Context

El autor abre la extensión para revisar el desempeño de su newsletter, sincroniza los datos de Substack y consulta tendencias de audiencia, publicaciones y Notas. La interfaz debe servir revisiones breves y periódicas, no exploración técnica de bases de datos.

## Capabilities and Constraints

- Extensión Chrome Manifest V3, local-first y sin dependencias de runtime.
- Consulta endpoints de solo lectura de Substack con la sesión existente del navegador.
- Conserva únicamente información agregada y normalizada; descarta PII antes de persistir.
- Las métricas de pago e ingresos permanecen ocultas por defecto.
- El rediseño debe priorizar pocos gráficos importantes para crecimiento y relegar datos diagnósticos o de cobertura.
- La selección definitiva de recomendaciones y jerarquía secundaria queda abierta a validación posterior con usuarios.

## Brand Commitments

Se conserva el nombre PlotStack y el español como idioma principal de la experiencia.

## Evidence on Hand

El repositorio contiene el dashboard funcional, datos de prueba realistas, documentación de las fuentes de Substack y una suite automatizada de 165 pruebas. No hay testimonios, benchmarks comerciales ni investigación formal de usuarios que deban presentarse como evidencia.

## Product Principles

- Explicar el crecimiento antes de exponer cifras.
- Mostrar primero la información que puede cambiar una decisión del autor.
- Traducir términos analíticos a lenguaje cotidiano y contextualizar cada número.
- Mantener el detalle disponible sin obligar a verlo.
- No inventar conclusiones cuando la muestra o la fuente no bastan.

## Accessibility & Inclusion

La interfaz debe ser comprensible sin conocimientos técnicos, operable con teclado y legible con ampliación y tecnologías de asistencia.
