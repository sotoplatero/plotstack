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

test("el delta de suscriptores nombra la ventana contra la que compara", async () => {
  await arrancar();
  await verVista("resumen");
  for (const dias of ["7", "30", "90"]) {
    await rango(dias);
    const texto = $("#delta-subscribers").textContent;
    assert.ok(
      texto.includes(`vs. hace ${dias} días`) || /para comparar/.test(texto),
      `con ${dias}D el delta debe nombrar su ventana o decir que no hay base: ${texto}`,
    );
  }
  await rango("all");
  assert.match($("#delta-subscribers").textContent, /desde |para comparar/,
    "con Todo la base es la primera captura del histórico local");
  await rango("30");
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

test("Crecimiento aplica el rango a las fuentes y añade la tasa de bajas", async () => {
  await arrancar();
  await verVista("crecimiento");
  await rango("all");
  // `growth/sources` acepta from_date/to_date: el badge "· fijo" reflejaba una
  // limitación nuestra, no de la API, y la sincronización pide una ventana por
  // cada opción del selector.
  assert.equal(/fijo/.test($("#acquisition-period").textContent), false);
  assert.match($("#acquisition-period").textContent, /histórico|días/);
  await rango("7");
  assert.match($("#acquisition-period").textContent, /7 días/);
  await rango("all");
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

test("el progreso de sincronizacion nombra la fase y su avance", async () => {
  await arrancar();
  const listener = globalThis.__plotstackStorageListener;
  assert.ok(listener, "el dashboard tiene que engancharse a storage.onChanged");

  listener({ "plotstack.progress": { newValue: { phase: "core", step: "Resumen, publicaciones y audiencia", detail: { done: 0, total: 0 } } } }, "local");
  await settle(2);
  assert.equal($("#sync-progress").hidden, false);
  assert.equal($("#sync-progress").textContent, "Resumen, publicaciones y audiencia",
    "sin total real no se pinta un 0/0 que no informa");
  assert.equal($("#sync-button").disabled, true, "no se puede lanzar otra sincronizacion encima");
  assert.equal($("#sync-label").textContent, "Sincronizando");

  listener({ "plotstack.progress": { newValue: { phase: "detail", step: "Estadísticas de notas", detail: { done: 40, total: 120 } } } }, "local");
  await settle(2);
  assert.equal($("#sync-progress").textContent, "Estadísticas de notas 40/120");

  listener({ "plotstack.progress": { newValue: { phase: "done", step: "", detail: { done: 0, total: 0 } } } }, "local");
  await settle(2);
  assert.equal($("#sync-progress").hidden, true);
  assert.equal($("#sync-button").disabled, false);
  assert.equal($("#sync-label").textContent, "Sincronizar");

  listener({ "plotstack.progress": { newValue: { phase: "error", step: "Detalle", detail: {}, error: "Substack limitó las solicitudes." } } }, "local");
  await settle(2);
  assert.match($("#sync-progress").textContent, /limitó las solicitudes/);
  assert.equal($("#sync-progress").classList.contains("is-error"), true);

  listener({ "plotstack.progress": { newValue: null } }, "local");
  await settle(2);
});

test("un snapshot escrito por la fase de detalle repinta sin recrear los nodos con listeners", async () => {
  await arrancar();
  await verVista("notas");
  const cuerpoNotas = $("#notes-table-body");
  const buscador = $("#notes-search");
  await verVista("resumen");
  const antes = $("#metric-subscribers").textContent;

  const listener = globalThis.__plotstackStorageListener;
  // La suite comparte una sola instancia del dashboard, así que este caso
  // devuelve el snapshot del fixture al terminar: si no, los siguientes tests
  // leerían el snapshot mínimo que escribe aquí.
  const original = (await globalThis.chrome.storage.local.get())["plotstack.snapshot"];
  listener({
    "plotstack.snapshot": {
      newValue: {
        publication: "Carta de muestra",
        capturedAt: "2026-08-21T15:00:00Z",
        metrics: { subscribers: 5000 },
        previousByRange: { 30: { subscribers: 4000 } },
        campaigns: [],
        notes: [],
      },
    },
  }, "local");
  await settle(4);

  assert.notEqual(txt($("#metric-subscribers").textContent), txt(antes), "el KPI tiene que reflejar el snapshot nuevo");
  assert.equal(txt($("#metric-subscribers").textContent), "5 mil");
  // Mostrar/ocultar, nunca destruir: los nodos enganchados en bindEvents siguen
  // siendo los mismos despues de repintar.
  assert.equal($("#notes-table-body"), cuerpoNotas);
  assert.equal($("#notes-search"), buscador);

  listener({ "plotstack.snapshot": { newValue: original } }, "local");
  await settle(4);
  assert.equal(txt($("#metric-subscribers").textContent), txt(antes), "el fixture queda restaurado para los demás casos");
});

test("Resumen pinta las vistas con su ventana fija declarada", async () => {
  await arrancar();
  await verVista("resumen");
  assert.equal(txt($("#metric-views").textContent), "41,2 mil", "las vistas ya se capturaban y no se pintaban");
  // El delta de vistas va en unidades y puede ser negativo.
  assert.match(txt($("#delta-views").textContent), /^-3,1 mil vs\. los 30 días anteriores$/);
  const tarjeta = $("#metric-views").parentNode;
  assert.equal(tarjeta.querySelectorAll(".period-badge").length, 1,
    "la ventana de vistas es fija y la tarjeta tiene que declararlo");
});

test("Notas muestra el desglose de alcance con etiquetas en español", async () => {
  await arrancar();
  await verVista("notas");
  await rango("all");
  assert.notEqual($("#notes-profile-visits").textContent, "—");
  assert.notEqual($("#notes-link-clicks").textContent, "—");

  const superficies = $("#notes-surfaces-legend").textContent;
  const audiencia = $("#notes-audience-legend").textContent;
  // Ninguna clave cruda de la API llega a la interfaz.
  for (const crudo of ["Profile page", "Unconnected", "Permalinks", "Subscribers"]) {
    assert.equal(superficies.includes(crudo), false, `clave cruda en superficies: ${crudo}`);
    assert.equal(audiencia.includes(crudo), false, `clave cruda en audiencia: ${crudo}`);
  }
  assert.match(audiencia, /Suscriptores/);
  assert.match(audiencia, /Sin conexión/);
  assert.match(superficies, /Feed/);
  assert.match(superficies, /Notificaciones/);
  assert.equal($("#notes-surfaces-bar").hidden, false);
  // Siete superficies, pero solo se pintan los segmentos con valor.
  assert.equal($$("#notes-surfaces-bar i").length, 7);
  assert.match($("#notes-reach-note").textContent, /2 de 3 notas/, "hay que declarar la cobertura del desglose");
});

test("Cobertura declara el estado del snapshot, no solo de las fuentes ampliadas", async () => {
  await arrancar();
  await verVista("cobertura");
  const texto = $("#coverage-list").textContent;
  assert.match(texto, /Snapshot principal/);
  assert.match(texto, /Detalle por publicación/);
  assert.match(texto, /Estadísticas por nota/);
  // El fixture tiene 3 notas, 2 con detalle y 1 marcada como sin datos.
  assert.match(texto, /2 con datos/);
  assert.match(texto, /de 3/);
});

test("todo grafico tiene etiqueta accesible y tooltip de cursor", async () => {
  await arrancar();
  for (const vista of VISTAS) {
    await verVista(vista);
    for (const svg of $$(".chart-wrap svg")) {
      const etiqueta = svg.attributes["aria-label"];
      assert.ok(etiqueta && etiqueta.trim(), `${vista}: un lector de pantalla no sabe que hay en ${svg.attributes.id}`);
      assert.equal(svg.attributes.role, "img");
    }
  }
  // Con la serie dibujada, el contenedor tiene su tooltip creado y oculto: se
  // crea una sola vez y se muestra al pasar el cursor, no en cada render.
  await verVista("resumen");
  await rango("all");
  const wrap = $("#growth-chart").parentNode;
  const tooltips = wrap.querySelectorAll(".chart-tooltip");
  assert.equal(tooltips.length, 1, "un solo tooltip por grafico, no uno por render");
  assert.equal(tooltips[0].hidden, true, "arranca oculto");
});

test("los graficos con serie secundaria la declaran en su leyenda", async () => {
  await arrancar();
  await verVista("crecimiento");
  assert.equal($$("#churn-panel .chart-legend .is-secondary").length, 1,
    "el segmento de bajas necesita leyenda junto al dibujo");
  await verVista("publicaciones");
  assert.equal($$("#posts-rate-panel .chart-legend .is-secondary").length, 1,
    "la linea discontinua de CTR necesita leyenda junto al dibujo");
});

test("Audiencia pinta la matriz de retencion por cohorte", async () => {
  await arrancar();
  await verVista("audiencia");
  const celdas = $$("#retention-list .cohort-cell");
  assert.ok(celdas.length > 0, "las cohortes se guardaban y no se pintaban");
  // Un mes sin medicion queda vacio, no como 0%.
  assert.ok(celdas.some((celda) => celda.classList.contains("is-empty")),
    "un mes sin dato no puede pintarse como una retencion medida");
  assert.match($("#retention-list").textContent, /Por cohorte de alta/);
});

test("Crecimiento pinta visitas, sus fuentes y la concentracion", async () => {
  await arrancar();
  await verVista("crecimiento");
  await rango("all");
  assert.ok($$("#traffic-chart .chart-line").length > 0, "falta la serie diaria de visitas");
  assert.match($("#traffic-total").textContent, /visitas/);
  const filas = $$("#visitor-sources-body tr");
  assert.equal(filas.length, 2);
  // `free_signup` null no es cero altas: la celda va en guion, no en 0.
  assert.match(filas[1].textContent, /—/);
  assert.match($("#traffic-kpis").textContent, /Visitantes/);
  assert.match($("#traffic-note").textContent, /concentran/);
});

test("Crecimiento reparte la audiencia entre la red de Substack y la propia", async () => {
  await arrancar();
  await verVista("crecimiento");
  await rango("all");
  assert.equal($("#network-bar").hidden, false);
  assert.equal($$("#network-bar i").length, 3);
  assert.match($("#network-legend").textContent, /Substack App/);
  assert.match($("#network-total").textContent, /114/);
});

test("el panel de altas y bajas compara dias con envio y cita el veredicto de Substack", async () => {
  await arrancar();
  await verVista("crecimiento");
  await rango("all");
  assert.match($("#churn-kpis").textContent, /Altas en día de envío/);
  const nota = $("#channels-note").textContent;
  assert.match(nota, /media de Substack/, "el veredicto comparativo no se puede derivar de datos propios");
  assert.match(nota, /40,7%/);
});

test("Audiencia lista las publicaciones que comparten lectores", async () => {
  await arrancar();
  await verVista("audiencia");
  assert.match($("#overlap-list").textContent, /Mafia IA/);
  assert.match($("#overlap-list").textContent, /39,0%/);
});

test("el panel de Seguidores superpone los suscriptores para ver la divergencia", async () => {
  await arrancar();
  await verVista("audiencia");
  await rango("all");
  assert.ok($$("#followers-chart .chart-line").length > 0);
  assert.ok($$("#followers-chart .chart-line-secondary").length > 0, "falta la segunda serie");
  // La curva de Audiencia NO cambia: la comparte el Resumen y meterle una
  // serie mayor le cambiaba la escala.
  assert.equal($$("#audience-chart .chart-line-secondary").length, 0);
});

test("Publicaciones separa lo que se lee fuera del correo y corta por seccion", async () => {
  await arrancar();
  await verVista("publicaciones");
  assert.match($("#discovery-kpis").textContent, /Se leen fuera del correo/);
  assert.match($("#discovery-median").textContent, /vistas por entrega/);
  assert.match($("#discovery-list").textContent, /×/);
  assert.match($("#posts-section-list").textContent, /Carpetas|Sin sección/);
});

test("Notas dice que superficie convierte y cuanto sales de tu burbuja", async () => {
  await arrancar();
  await verVista("notas");
  await rango("all");
  assert.match($("#notes-surface-yield").textContent, /Feed/);
  assert.match($("#notes-surface-yield").textContent, /1\.000/);
  const nota = $("#notes-reach-note").textContent;
  assert.match(nota, /no te sigue ni te lee/);
  assert.match(nota, /estimadas/, "el reparto por superficie es proporcional y hay que declararlo");
});
