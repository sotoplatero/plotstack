import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { installDom, settle } from "./fixtures/dom.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(raiz, "dashboard", "index.html");

// Un solo arranque para toda la suite: `app.js` llama a `initialize()` al
// importarse y engancha los listeners una única vez, igual que en el navegador.
let dom;
let arrancado = false;

const arrancar = async () => {
  if (arrancado) return;
  dom = installDom(HTML);
  await import("./fixtures/dashboard-browser-mock.js");
  await import("../dashboard/app.js");
  await settle();
  arrancado = true;
};

// `Intl` en formato compacto usa espacio duro (U+00A0). Sin normalizarlo, las
// aserciones de texto fallan por un byte invisible.
const txt = (valor) => String(valor).replace(/[  ]/g, " ");
// `hidden` en un ancestro esconde el subárbol entero.
const esVisible = (nodo) => {
  for (let cursor = nodo; cursor; cursor = cursor.parentNode) if (cursor.hidden) return false;
  return true;
};
const vistaDe = (nodo) => {
  for (let cursor = nodo; cursor; cursor = cursor.parentNode) {
    if (cursor.attributes?.["data-view"]) return cursor.attributes["data-view"];
  }
  return null;
};

const $ = (selector) => dom.document.querySelector(selector);
const $$ = (selector) => dom.document.querySelectorAll(selector);
const verVista = async (nombre) => {
  $(`.nav-item[data-view="${nombre}"]`).click();
  await settle(4);
};
const rango = async (dias) => {
  $(`[data-days="${dias}"]`).click();
  await settle(4);
};

const VISTAS = ["resumen", "audiencia", "crecimiento", "notas", "publicaciones", "cobertura"];
// Las que dependen de `state.days` y por tanto muestran el selector.
const CON_RANGO = new Set(["resumen", "audiencia", "crecimiento", "notas"]);

test("el dashboard arranca con el snapshot guardado", async () => {
  await arrancar();
  assert.equal($("#onboarding").hidden, true, "el onboarding se esconde si hay snapshot");
  assert.equal($("#dashboard-shell").hidden, false);
  assert.equal($("#source-name").textContent, "Carta de muestra");
});

test("el menú de captura ofrece página y tarjeta para guardar o copiar", async () => {
  await arrancar();
  const actions = $$('[data-capture-action]').map((node) => node.attributes["data-capture-action"]);
  assert.deepEqual(actions.sort(), ["copy-card", "copy-page", "download-card", "download-page"]);
  assert.equal($("#capture-menu").hidden, true);
  $("#capture-button").click();
  assert.equal($("#capture-menu").hidden, false);
  assert.equal($("#capture-button").attributes["aria-expanded"], "true");
});

test("la selección de tarjeta se cancela con Escape o al hacer click fuera", async () => {
  await arrancar();
  $("#capture-menu").hidden = false;
  $('[data-capture-action="download-card"]').click();
  assert.equal(dom.document.documentElement.classList.contains("is-selecting-capture-card"), true);

  dom.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(dom.document.documentElement.classList.contains("is-selecting-capture-card"), false);

  $("#capture-button").click();
  $('[data-capture-action="copy-card"]').click();
  assert.equal(dom.document.documentElement.classList.contains("is-selecting-capture-card"), true);
  $("#overview").click();
  assert.equal(dom.document.documentElement.classList.contains("is-selecting-capture-card"), false);
});

test("elegir una tarjeta navegable no cambia de vista ni activa is-capturing", async () => {
  await arrancar();
  await verVista("resumen");
  $("#capture-button").click();
  $('[data-capture-action="copy-card"]').click();
  const card = $('.metric-card[data-goto="audiencia"]');
  const dispatched = card.click();
  await settle(4);

  assert.equal(dispatched, false, "el click de selección debe quedar cancelado");
  assert.equal($$('.view').find((node) => !node.hidden).attributes["data-view"], "resumen");
  assert.equal(dom.document.documentElement.classList.contains("is-selecting-capture-card"), false);
  assert.equal(dom.document.documentElement.classList.contains("is-capturing"), false);
});

test("capturar una página no recrea el DOM visible ni usa is-capturing", async () => {
  await arrancar();
  await verVista("notas");
  await rango("all");
  const firstRow = $("#notes-table-body").children[0];

  $("#capture-button").click();
  $('[data-capture-action="download-page"]').click();
  assert.equal(dom.document.documentElement.classList.contains("is-capturing"), false);
  await settle(4);

  assert.equal($("#notes-table-body").children[0], firstRow, "la captura no debe llamar renderDashboard");
  assert.equal(dom.document.documentElement.classList.contains("is-capturing"), false);
});

// El test que faltaba. Los renderers se ejecutan de verdad, así que una
// referencia a una función borrada o a un `#id` inexistente lanza y falla aquí:
// es exactamente el fallo que se colaba tres veces sin que los tests lo vieran.
test("las seis vistas se renderizan sin lanzar", async () => {
  await arrancar();
  for (const vista of VISTAS) {
    await verVista(vista);
    const visibles = $$(".view").filter((node) => !node.hidden);
    assert.equal(visibles.length, 1, `${vista}: debe haber exactamente una vista visible`);
    assert.equal(visibles[0].attributes["data-view"], vista);
  }
});

test("cada vista con rango aguanta los cuatro periodos", async () => {
  await arrancar();
  for (const vista of VISTAS) {
    await verVista(vista);
    assert.equal($("#range-control").hidden, !CON_RANGO.has(vista), `selector de rango en ${vista}`);
    if (!CON_RANGO.has(vista)) continue;
    for (const dias of ["7", "30", "90", "all"]) {
      await rango(dias);
      const activos = $$("[data-days]").filter((boton) => boton.classList.contains("is-active"));
      assert.equal(activos.length, 1, `${vista}/${dias}: un solo rango activo`);
      assert.equal(activos[0].attributes["data-days"], dias);
    }
  }
});

test("Resumen pinta las métricas del snapshot", async () => {
  await arrancar();
  await verVista("resumen");
  await rango("all");
  assert.equal(txt($("#metric-subscribers").textContent), "2,8 mil");
  assert.match(txt($("#metric-open-rate").textContent), /^\d+,\d%$/);
  assert.match($("#delta-subscribers").textContent, /%/);
  // La apertura se calcula sobre los envíos de la ventana, no se copia de
  // `metrics.openRate` (47,3 en el fixture).
  assert.notEqual(txt($("#metric-open-rate").textContent), "47,3%");
});

test("Resumen y Audiencia usan el mismo histórico de suscriptores", async () => {
  await arrancar();
  await rango("all");
  await verVista("resumen");
  const resumen = $$("#growth-chart .chart-label").map((node) => node.textContent);
  await verVista("audiencia");
  const audiencia = $$("#audience-chart .chart-label").map((node) => node.textContent);
  assert.deepEqual(resumen, audiencia, "las dos vistas deben compartir serie, rango y etiquetas");
});

test("Audiencia muestra el total y el histórico real de seguidores", async () => {
  await arrancar();
  await verVista("audiencia");
  await rango("all");
  const tarjetas = $$("#audience-totals div").map((node) => txt(node.textContent));
  const seguidores = tarjetas.find((texto) => texto.startsWith("Seguidores"));
  assert.ok(seguidores, "falta el total actual de seguidores");
  assert.match(seguidores, /3,9 mil/, `total de seguidores incorrecto: ${seguidores}`);
  assert.ok($("#followers-panel"));
  assert.equal(vistaDe($("#followers-panel")), "audiencia");
  assert.equal(vistaDe($("#retention-panel")), "audiencia");
  assert.ok($$("#followers-chart .chart-line").length > 0, "sin línea del histórico de seguidores");
  assert.match($("#audience-location-list").textContent, /España/);
  assert.match($("#retention-list").textContent, /82,0%/);
  assert.equal($("#audience-daily"), null, "las altas pertenecen a Crecimiento, no a Audiencia");
});

test("Crecimiento pinta altas y bajas del histórico real", async () => {
  await arrancar();
  await verVista("crecimiento");
  await rango("all");
  assert.notEqual($("#churn-net").textContent.trim(), "—");
  assert.match($("#churn-basis").textContent, /histórico de crecimiento/, "hay que declarar de dónde salen las bajas");
  assert.match($("#acquisition-conversion").textContent, /%|Sin dato/);
  assert.equal($("#growth-events-panel"), null, "no debe duplicarse la lista de publicaciones y notas");
});

test("Notas usa el detalle real y no inventa lo que no existe", async () => {
  await arrancar();
  await verVista("notas");
  await rango("all");
  assert.equal($("#notes-total").textContent, "3");
  assert.equal($("#notes-table-body").children.length, 3);
  // Impresiones sí existen en note_stats; seguidores e ingresos por nota no.
  assert.equal(txt($("#notes-impressions").textContent), "11,7 mil");
  assert.ok($("#cadence-table-body").children.length > 0);
  const vista = $$(".view").find((node) => !node.hidden);
  assert.equal(/Seguidores atribuidos/.test(vista.textContent), false,
    "note_stats no devuelve seguidores ganados por nota");
});

test("Publicaciones ordena y busca sin perder la tabla", async () => {
  await arrancar();
  await verVista("publicaciones");
  assert.equal($$("#campaigns-head th").length, 12);
  assert.equal($$("#campaigns-body tr").length, 2);

  $$("#campaigns-head th")[3].click();
  await settle(4);
  assert.equal($$("#campaigns-body tr").length, 2, "ordenar no debe perder filas");

  const buscador = $("#posts-search");
  buscador.value = "borde";
  buscador.dispatchEvent({ type: "input", target: { value: "borde" } });
  await settle(4);
  assert.equal($$("#campaigns-body tr").length, 1, "la búsqueda debe filtrar");

  buscador.value = "";
  buscador.dispatchEvent({ type: "input", target: { value: "" } });
  await settle(4);
  assert.equal($$("#campaigns-body tr").length, 2);
});

test("las columnas de Publicaciones no incluyen las que la API deja siempre en cero", async () => {
  await arrancar();
  await verVista("publicaciones");
  const cabeceras = $$("#campaigns-head th").map((th) => th.textContent.replace(/[↑↓\s]+$/, ""));
  for (const muerta of ["Subtítulo", "Palabras", "Audiencia", "Valor", "Suscripciones", "Bajas D1"]) {
    assert.equal(cabeceras.includes(muerta), false, `${muerta} no debería estar: ${cabeceras.join(", ")}`);
  }
  for (const viva of ["Publicación", "Apertura", "CTR", "Reacciones", "Comentarios"]) {
    assert.equal(cabeceras.includes(viva), true, `falta ${viva}: ${cabeceras.join(", ")}`);
  }
});

test("Cobertura informa aunque no haya fuentes", async () => {
  await arrancar();
  await verVista("cobertura");
  // El fixture trae `coverage: []`: tiene que decirlo, no romperse ni mentir.
  assert.ok($("#coverage-list").textContent.trim().length > 0);
});

test("ningún contador visible se queda en el marcador inicial", async () => {
  await arrancar();
  let inspeccionados = 0;
  const pendientes = [];
  for (const vista of VISTAS) {
    await verVista(vista);
    if (CON_RANGO.has(vista)) await rango("all");
    const visible = $$(".view").find((node) => !node.hidden);
    for (const nodo of visible.descendants()) {
      if (nodo.tagName !== "STRONG" || !nodo.attributes.id || !esVisible(nodo)) continue;
      inspeccionados += 1;
      if (nodo.textContent.trim() === "—") pendientes.push(`${vista}:#${nodo.attributes.id}`);
    }
  }
  assert.ok(inspeccionados > 10, `el test no inspeccionó nada (${inspeccionados})`);
  assert.deepEqual(pendientes, [], "quedan contadores sin rellenar");
});

test("ninguna cifra monetaria es visible por defecto", async () => {
  await arrancar();
  for (const vista of VISTAS) {
    await verVista(vista);
    const visible = $$(".view").find((node) => !node.hidden);
    const texto = visible.descendants()
      .filter((nodo) => esVisible(nodo))
      .map((nodo) => txt(nodo.ownText))
      .join(" ");
    assert.equal(/US\$|€|\bARR\b|\bMRR\b/.test(texto), false, `${vista} muestra dinero: ${texto.slice(0, 160)}`);
  }
});

test("los KPI sensibles existen pero nacen ocultos", async () => {
  await arrancar();
  await verVista("resumen");
  const sensibles = $$("[data-sensitive]");
  assert.ok(sensibles.length >= 2, "deberían existir los KPI de pago e ingreso");
  for (const nodo of sensibles) {
    assert.equal(nodo.hidden, true, `${nodo.attributes["data-sensitive"]} visible sin permiso`);
  }
  // El de ingresos sigue en el DOM: se oculta, no se ha borrado.
  assert.ok($("#metric-revenue"), "metric-revenue debería seguir existiendo, oculto");
});

test("los deltas de snapshot declaran contra qué comparan", async () => {
  await arrancar();
  await verVista("resumen");
  assert.match($("#delta-subscribers").textContent, /vs\. sincronización anterior/,
    "el delta de suscriptores no depende del rango y el copy tiene que decirlo");
});

test("Publicaciones dibuja apertura y CTR por envío y marca la mediana propia", async () => {
  await arrancar();
  await verVista("publicaciones");
  assert.ok($$("#posts-rate-chart .chart-line").length > 0, "falta la línea de apertura");
  assert.ok($$("#posts-rate-chart .chart-line-secondary").length > 0, "falta la línea de CTR");
  const cabeceras = $$("#campaigns-head th").map((th) => th.textContent.replace(/[↑↓\s]+$/, ""));
  assert.ok(cabeceras.includes("CTOR"), `falta CTOR: ${cabeceras.join(", ")}`);
  const marcadas = $$("#campaigns-body td").filter((td) =>
    td.classList.contains("is-above-median") || td.classList.contains("is-below-median"));
  assert.equal(marcadas.length, 2, "cada envío con entregas marca su apertura contra la mediana");
});

test("Notas no pinta ceros donde no hubo medición y muestra la atribución", async () => {
  await arrancar();
  await verVista("notas");
  await rango("all");
  const sinDetalle = $$("#notes-table-body tr").find((tr) => tr.textContent.includes("Tres aprendizajes"));
  assert.ok(sinDetalle, "falta la nota sin detalle del fixture");
  const celdas = sinDetalle.querySelectorAll("td").map((td) => td.textContent);
  assert.equal(celdas.at(-3), "—", "impresiones sin detalle es ausencia, no cero");
  assert.equal(celdas.at(-2), "—", "ratio sin detalle es ausencia");
  assert.equal(celdas.at(-1), "—", "altas sin detalle es ausencia");
  assert.ok($$("#attribution-chart .chart-bar").length > 0, "faltan las barras de altas atribuidas a notas");
  assert.match($("#attribution-coverage").textContent, /2 de 3/, "la cobertura declara sobre qué se sostiene la serie");
  assert.ok($$("#cadence-heatmap .heatmap-row.is-buckets").length >= 7, "la cadencia se agrega por tramos, no por 24 horas");
});

test("Audiencia pinta la actividad de la lista y la composición nace oculta", async () => {
  await arrancar();
  await verVista("audiencia");
  assert.equal($$("#engagement-bar i").length, 3, "tres tramos de actividad");
  assert.match(txt($("#engagement-legend").textContent), /Actividad alta/);
  assert.equal($("#composition-panel").hidden, true, "la composición describe la base de pago: sensible");
});

test("Crecimiento declara el periodo fijo de fuentes y añade la tasa de bajas", async () => {
  await arrancar();
  await verVista("crecimiento");
  await rango("all");
  assert.match($("#acquisition-period").textContent, /fijo/,
    "el panel de fuentes es de periodo fijo y tiene que declararlo");
  assert.equal($("#paid-churn-panel").hidden, true, "el churn de pago nace oculto");
  assert.match($("#churn-kpis").textContent, /Tasa de bajas/);
});

test("las altas por canal viven en la tira de KPI del panel de altas y bajas", async () => {
  await arrancar();
  await verVista("crecimiento");
  await rango("all");
  assert.equal($("#channels-panel"), null, "sin panel propio: una sección, una cabecera, un formato");
  const texto = txt($("#churn-kpis").textContent);
  assert.match(texto, /Altas vía email \(D1\)60/, "36 + 24 altas D1 de los dos envíos");
  assert.match(texto, /Altas por envío30/, "la eficiencia por pieza es el conocimiento");
  assert.match(texto, /Altas vía notas11/, "7 + 4 altas atribuidas a notas con detalle");
  assert.match(texto, /Altas por nota medida5,5/, "eficiencia sobre las notas medidas, no sobre todas");
  assert.match($("#channels-note").textContent, /no suman el total/);
  assert.match($("#channels-note").textContent, /2 de 3/, "la cobertura se declara");
});

test("el diagnóstico asunto/contenido no clasifica con muestra escasa", async () => {
  await arrancar();
  await verVista("publicaciones");
  assert.equal($("#diagnosis-medians").textContent, "Muestra escasa");
  assert.match($("#diagnosis-grid").textContent, /al menos 4 envíos.*hay 2/,
    "con 2 envíos la mediana no clasifica nada");
});

test("las notas se ordenan por conversión con los sin-detalle al final", async () => {
  await arrancar();
  await verVista("notas");
  await rango("all");
  const sorter = $("#notes-sort");
  sorter.value = "conversion";
  sorter.dispatchEvent({ type: "change", target: { value: "conversion" } });
  await settle(4);

  const filas = $$("#notes-table-body tr");
  assert.equal(filas.length, 3);
  assert.match(filas[0].textContent, /Una buena métrica/, "1,0 altas/1000 impr. supera a 0,8");
  assert.match(filas.at(-1).textContent, /Tres aprendizajes/, "sin detalle no compite como si tuviera un 0");
  const celdas = filas[0].querySelectorAll("td").map((td) => txt(td.textContent));
  assert.equal(celdas.at(-2), "1", "7 altas / 6800 impresiones ≈ 1,0 por mil");
  assert.equal($("#notes-insight").hidden, true, "con 2 notas medidas no hay hallazgo que declarar");

  sorter.value = "interactions";
  sorter.dispatchEvent({ type: "change", target: { value: "interactions" } });
  await settle(4);
});

test("las altas de pago de notas viven en un nodo sensible independiente", async () => {
  await arrancar();
  await verVista("notas");
  await rango("all");
  const toggle = $("#show-paid");
  toggle.checked = true;
  toggle.dispatchEvent({ type: "change" });
  await settle(4);

  const paid = $("#notes-table-body").querySelectorAll('[data-sensitive="paid"]');
  assert.equal(paid.length, 1, "solo la nota con una alta de pago necesita incremento");
  assert.match(paid[0].textContent, /^ \+ /);
  assert.ok(paid[0].parentNode.textContent.startsWith("7"), "el total gratuito permanece fuera del nodo sensible");
});
