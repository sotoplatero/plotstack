import {
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  getCampaignCuts,
  getCampaignDiagnosis,
  getChannelAttribution,
  getDerivedMetrics,
  getNotesEngagement,
  getNotesAnalytics,
  getOwnOpenRateMedian,
  getPublicationEngagement,
  getConcentration,
  getDiscoveryMix,
  getCampaignSections,
  getPublishingRhythm,
  getRateWindows,
  getReachBeyondBubble,
  getSurfaceYield,
  isFractionScale,
  ratio,
  viewsPerDelivery,
  normalizeSnapshot,
  parseDay,
} from "../src/shared/analytics.js";
import { getContentAnalytics } from "../src/shared/content-analytics.js";
import {
  captureElementPng,
  captureFilename,
  copyPngToClipboard,
  downloadPng,
} from "./capture.js";
import {
  applySensitiveVisibility,
  readSensitivePreferences,
  writeSensitivePreference,
} from "./privacy.js";

const SNAPSHOT_KEY = "plotstack.snapshot";
const CONNECTION_KEY = "plotstack.connection";
const ANALYTICS_KEY = "plotstack.analytics";
const PROGRESS_KEY = "plotstack.progress";
const VIEW_KEY = "plotstack.view";
const VIEWS = ["resumen", "audiencia", "crecimiento", "notas", "publicaciones", "cobertura"];
const RANGE_KEY = "plotstack.days";
// `Infinity` = "Todo". Nunca llega a chrome.storage: vive solo en localStorage
// como cadena, porque un no finito se corrompe al serializarse.
const ALL_TIME = Infinity;
// Cobertura es estado de sincronizacion, no una serie: es la unica sin rango.
const RANGE_AWARE_VIEWS = new Set(["resumen", "audiencia", "crecimiento", "notas"]);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  snapshot: null,
  connection: null,
  analytics: null,
  progress: null,
  days: 30,
  rangeExcluded: { notes: 0, campaigns: 0 },
  view: "resumen",
  notesSearch: "",
  notesSort: "interactions",
  postsSearch: "",
  postsSort: { key: "date", direction: "desc" },
  sensitive: { paid: false, revenue: false },
  capturing: false,
  captureCardDestination: null,
};

const sendMessage = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const decimal = (value, digits = 1) => Number(value || 0).toLocaleString("es-ES", { maximumFractionDigits: digits });
// `parseDay` vive en analytics.js para que el criterio de fecha civil sea el
// mismo en render y en cálculo.
const shortDate = (value) => (value ? parseDay(value).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "Sin fecha");
const timezoneOffset = () => -new Date().getTimezoneOffset();
const rangeLabel = () => (state.days === ALL_TIME ? "todo el histórico" : `los últimos ${state.days} días`);

// Corta por fecha con la ventana activa. Las filas sin fecha se conservan
// siempre: excluirlas seria tratar "no se sabe cuando" como "fuera de rango".
function withinRange(rows, getDate) {
  if (state.days === ALL_TIME) return { kept: rows, excluded: 0 };
  const cutoff = Date.now() - state.days * 86400000;
  const kept = rows.filter((row) => {
    const time = parseDay(getDate(row)).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  });
  return { kept, excluded: rows.length - kept.length };
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function setConnectionStatus(message = "", error = false) {
  const status = $("#connect-status");
  status.textContent = message;
  status.style.color = error ? "var(--danger)" : "var(--muted)";
}

function setConnecting(active, label = "Conectando…") {
  const button = $("#connect-button");
  button.disabled = active;
  button.querySelector("span").textContent = active ? label : "Conectar con Substack";
}

function showOnboarding() {
  $("#onboarding").hidden = false;
  $("#dashboard-shell").hidden = true;
  $("#connect-content").hidden = false;
  $("#publication-picker").hidden = true;
  $("#login-button").hidden = true;
  setConnectionStatus();
}

function showDashboard() {
  $("#onboarding").hidden = true;
  $("#dashboard-shell").hidden = false;
  renderDashboard();
}

function createPublicationOption(publication) {
  const button = document.createElement("button");
  button.className = "publication-option";
  button.type = "button";
  if (publication.logoUrl) {
    const img = document.createElement("img");
    img.src = publication.logoUrl;
    img.alt = "";
    button.append(img);
  } else {
    const avatar = document.createElement("span");
    avatar.className = "publication-avatar";
    avatar.textContent = publication.name.slice(0, 1).toUpperCase();
    button.append(avatar);
  }
  const text = document.createElement("span");
  const name = document.createElement("span");
  name.textContent = publication.name;
  const domain = document.createElement("small");
  domain.textContent = `${publication.subdomain}.substack.com`;
  text.append(name, domain);
  const arrow = document.createElement("b");
  arrow.textContent = "→";
  button.append(text, arrow);
  button.addEventListener("click", () => selectPublication(publication, button));
  return button;
}

function showPublicationPicker(publications) {
  $("#connect-content").hidden = true;
  $("#publication-picker").hidden = false;
  const list = $("#publication-list");
  list.replaceChildren(...publications.map(createPublicationOption));
}

async function connect() {
  setConnecting(true);
  setConnectionStatus("Comprobando tu sesión de Substack…");
  try {
    const response = await sendMessage("PLOTSTACK_CONNECT");
    if (response?.needsLogin) {
      $("#login-button").hidden = false;
      setConnectionStatus("No hay una sesión activa de Substack en este navegador.", true);
      return;
    }
    if (!response?.ok) throw new Error(response?.error || "No se pudo conectar.");
    const publications = response.publications || [];
    if (!publications.length) {
      setConnectionStatus("Esta cuenta no administra ninguna publicación.", true);
      return;
    }
    if (publications.length === 1) {
      await selectPublication(publications[0]);
      return;
    }
    setConnectionStatus("");
    showPublicationPicker(publications);
  } catch (error) {
    setConnectionStatus(error.message || "No se pudo conectar.", true);
  } finally {
    setConnecting(false);
  }
}

async function selectPublication(publication, button) {
  if (button) button.disabled = true;
  setConnectionStatus(`Sincronizando ${publication.name}…`);
  try {
    const response = await sendMessage("PLOTSTACK_SELECT_PUBLICATION", { publication });
    if (!response?.ok) throw new Error(response?.error || "No se pudo sincronizar.");
    state.snapshot = normalizeSnapshot(response.snapshot);
    state.connection = response.connection;
    state.analytics = response.analytics || null;
    showDashboard();
    renderProgress();
  } catch (error) {
    setConnectionStatus(error.message || "No se pudo sincronizar.", true);
    $("#connect-content").hidden = false;
    $("#publication-picker").hidden = true;
  } finally {
    if (button) button.disabled = false;
  }
}

// Los deltas de snapshot comparan contra la sincronización anterior, no contra
// "el periodo anterior": esa magnitud depende de cuándo sincronizaste, no del
// rango elegido, y el copy tiene que decirlo. `null` = no hay con qué comparar.
function deltaMarkup(value, suffix, versus, format) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${format(value)}${suffix} ${versus}`.trim();
}

function setDelta(selector, value, { suffix = "%", versus = "vs. periodo anterior", missing = "Sin valor anterior para comparar", format = decimal } = {}) {
  const element = $(selector);
  if (value === null || value === undefined) {
    element.className = "delta";
    element.style.color = "";
    element.textContent = missing;
    return;
  }
  element.textContent = deltaMarkup(value, suffix, versus, format);
  element.classList.toggle("is-positive", value > 0);
  element.style.color = value < 0 ? "var(--danger)" : "";
}

function emptyMessage(container, message, className = "source-empty") {
  const empty = document.createElement("p");
  empty.className = className;
  empty.textContent = message;
  container.replaceChildren(empty);
}

// Delta entre dos ventanas de envios. `null` en cualquiera de las dos no es 0:
// hay que decir que no se puede comparar, no inventar un +100%.
function setRateDelta(selector, windows, key = "openRate") {
  const now = windows.current[key];
  const before = windows.previous[key];
  if (now === null || before === null) {
    const node = $(selector);
    node.className = "delta";
    node.textContent = windows.previous.posts
      ? "Sin envíos con destinatarios para comparar"
      : "Sin periodo anterior para comparar";
    return;
  }
  setDelta(selector, now - before, { suffix: " pts" });
}

// Copy del delta de audiencia según de dónde salió la base. Nombrar la base es
// parte del dato: "+3,2% vs. hace 7 días" y "+3,2% vs. hace 90 días" son
// afirmaciones distintas, y con "Todo" la referencia es la primera captura
// local, no un arranque que dé Substack.
function comparisonCopy(comparison) {
  if (comparison?.basis === "range") {
    return {
      versus: `vs. hace ${comparison.days} días`,
      missing: `Sin base de hace ${comparison.days} días para comparar`,
    };
  }
  if (comparison?.basis === "history") {
    return {
      versus: `desde ${shortDate(comparison.sinceDate)}`,
      missing: "Sin histórico anterior para comparar",
    };
  }
  return { versus: "", missing: "Substack no dio base para comparar este rango" };
}

function renderMetrics(snapshot, analytics) {
  const { metrics } = snapshot;
  const derived = getDerivedMetrics(snapshot, state.days);
  // El delta de audiencia compara contra el arranque de la MISMA ventana que
  // marca el selector, y el copy lo dice. Antes decía "vs. sincronización
  // anterior" mientras la base era siempre la de 30 días.
  const versusRange = comparisonCopy(derived.comparison);
  const versusSync = { versus: "vs. sincronización anterior", missing: "Sin sincronización anterior para comparar" };
  $("#metric-subscribers").textContent = formatCompactNumber(metrics.subscribers);
  // La apertura se calcula sobre la ventana activa, igual que el CTR. Sin
  // fallback silencioso a `metrics.openRate`: esa cifra es histórica de la API
  // y mostrarla bajo la etiqueta del rango elegido sería mentir.
  const windows = getRateWindows(snapshot, state.days);
  const openNow = windows.current.openRate;
  $("#metric-open-rate").textContent = openNow === null ? "Sin dato" : formatPercent(openNow);
  // Vistas: la única métrica de tráfico que publica Substack. Su ventana es la
  // fija de 30 días del endpoint, así que la tarjeta lo declara en vez de
  // fingir que obedece al selector, y el delta va en unidades, no en puntos.
  $("#metric-views").textContent = formatCompactNumber(metrics.totalViews);
  setDelta("#delta-views", metrics.viewsDelta || null, {
    suffix: "",
    versus: "vs. los 30 días anteriores",
    missing: "Sin variación de vistas publicada",
    format: formatCompactNumber,
  });
  $("#metric-paid").textContent = formatCompactNumber(metrics.paidSubscribers);
  $("#paid-conversion").textContent = formatPercent(derived.paidConversion);
  $("#metric-revenue").textContent = formatCurrency(metrics.monthlyRevenue);
  setDelta("#delta-subscribers", derived.subscriberGrowth, versusRange);
  setRateDelta("#delta-open-rate", windows);
  setDelta("#delta-paid", derived.paidGrowth, versusRange);
  setDelta("#delta-revenue", derived.revenueGrowth, versusSync);

  // La barra se escala contra la mediana propia, no contra un 42% inventado.
  const ownMedian = getOwnOpenRateMedian(snapshot);
  const ceiling = Math.max(openNow ?? 0, ownMedian ?? 0, 1);
  $("#open-progress").style.width = openNow === null ? "0%" : `${clamp((openNow / ceiling) * 100, 0, 100)}%`;
  $("#open-reference").textContent = ownMedian === null
    ? "Sin publicaciones con envío para comparar"
    : `Tu mediana por publicación · ${formatPercent(ownMedian)}`;

  const clickNow = windows.current.clickRate;
  $("#metric-click-rate").textContent = clickNow === null ? "Sin dato" : formatPercent(clickNow);
  setRateDelta("#delta-click-rate", windows, "clickRate");
  $("#click-basis").textContent = `${windows.current.posts} ${windows.current.posts === 1 ? "envío" : "envíos"} en ${rangeLabel()}`;

  // El sparkline muestra altas diarias del periodo escaladas desde cero. El
  // anterior normalizaba min-max el total acumulado con suelo al 20%: una
  // variación de ±2 suscriptores se pintaba como una montaña rusa.
  const bars = $("#subscriber-bars");
  const daily = fillDailyGaps(windowedSubscriberDaily(analytics), (date) => ({ date, signups: 0 })).slice(-60);
  if (daily.length >= 2) {
    const top = Math.max(1, ...daily.map((point) => point.signups));
    bars.hidden = false;
    bars.replaceChildren(...daily.map((point) => {
      const bar = document.createElement("i");
      bar.style.height = `${(point.signups / top) * 100}%`;
      bar.title = `${shortDate(point.date)}: ${point.signups} ${point.signups === 1 ? "alta" : "altas"}`;
      return bar;
    }));
  } else {
    bars.hidden = true;
    bars.replaceChildren();
  }
}

// Tooltip de cursor. El `<title>` nativo de cada punto tarda un segundo en
// aparecer y no existe en táctil, así que la lectura de un gráfico dependía de
// acertarle a un círculo de 3 px. Aquí basta acercarse en el eje X.
//
// El estado vive en un WeakMap por SVG y los listeners se enganchan UNA vez:
// los SVG son nodos estáticos del HTML y `replaceChildren` no los sustituye, así
// que volver a engancharlos en cada render acumularía manejadores.
const chartHovers = new WeakMap();

function attachChartTooltip(svg, points, xOf, { primaryLabel, secondaryLabel, formatValue }) {
  const wrap = svg.parentNode;
  if (!wrap) return;
  let tooltip = wrap.querySelector?.(".chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    wrap.append(tooltip);
  }
  const previous = chartHovers.get(svg);
  chartHovers.set(svg, { points, xOf, primaryLabel, secondaryLabel, formatValue, tooltip });
  if (previous) return;

  const geometryWidth = () => svg.getBoundingClientRect?.()?.width || 0;
  svg.addEventListener("pointermove", (event) => {
    const hover = chartHovers.get(svg);
    if (!hover?.points?.length) return;
    const bounds = svg.getBoundingClientRect?.();
    if (!bounds?.width) return;
    // El SVG se dibuja en su propio viewBox: hay que pasar el píxel del ratón a
    // esas coordenadas antes de comparar con las posiciones de los puntos.
    const scale = (Number(svg.getAttribute("viewBox")?.split(" ")[2]) || bounds.width) / bounds.width;
    const target = (event.clientX - bounds.left) * scale;
    let closest = 0;
    for (let index = 1; index < hover.points.length; index += 1) {
      if (Math.abs(hover.xOf(index) - target) < Math.abs(hover.xOf(closest) - target)) closest = index;
    }
    const point = hover.points[closest];
    const lines = [axisDate(point.date), `${hover.primaryLabel}: ${hover.formatValue(point.value)}`];
    if (Number.isFinite(point.secondary)) lines.push(`${hover.secondaryLabel}: ${hover.formatValue(point.secondary)}`);
    hover.tooltip.textContent = lines.join(" · ");
    hover.tooltip.hidden = false;
    const ratio = geometryWidth() ? (hover.xOf(closest) / scale) / geometryWidth() : 0;
    hover.tooltip.style.left = `${Math.round(ratio * 100)}%`;
    // Cerca del borde derecho el tooltip se ancla al final para no desbordar.
    hover.tooltip.style.transform = ratio > 0.7 ? "translateX(-100%)" : "translateX(-50%)";
  });
  svg.addEventListener("pointerleave", () => {
    const hover = chartHovers.get(svg);
    if (hover) hover.tooltip.hidden = true;
  });
}

function chartGeometry(svg, { fallbackHeight, minHeight }) {
  const bounds = svg.getBoundingClientRect?.() || {};
  const width = Math.max(320, Math.round(bounds.width || 820));
  const height = Math.max(minHeight, Math.round(bounds.height || fallbackHeight));
  const left = 48, right = 18, top = 14, bottom = 34;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { width, height, left, right, top, bottom };
}

function drawLineChart(svg, points, gradientId, options = {}) {
  const { baselineZero = false, secondaryLabel = "", primaryLabel = "Valor", events = [], formatValue = formatCompactNumber } = options;
  svg.replaceChildren();
  if (points.length < 2) return false;
  const { width, height, left, right, top, bottom } = chartGeometry(svg, { fallbackHeight: 270, minHeight: 180 });
  const values = points.map((point) => point.value);
  const secondaryValues = points.map((point) => point.secondary).filter((value) => Number.isFinite(value));
  const allValues = values.concat(secondaryValues);
  const min = baselineZero ? 0 : Math.min(...allValues);
  const max = Math.max(...allValues);
  const spread = (max - min) || 1;
  // Eje X proporcional al tiempo: un hueco de tres meses ocupa tres meses de
  // ancho, no un slot. Sin fechas válidas se cae al reparto por índice.
  const times = points.map((point) => parseDay(point.date).getTime());
  const timed = times.every(Number.isFinite) && times.at(-1) > times[0];
  const atTime = (time) => left + ((time - times[0]) / (times.at(-1) - times[0])) * (width - left - right);
  const x = timed
    ? (index) => atTime(times[index])
    : (index) => left + (index / (points.length - 1)) * (width - left - right);
  const y = (value) => top + (1 - (value - min) / spread) * (height - top - bottom);
  const coords = points.map((point, index) => [x(index), y(point.value)]);
  const linePath = coords.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords.at(-1)[0]},${height - bottom} L${coords[0][0]},${height - bottom} Z`;
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  const gradient = document.createElementNS(ns, "linearGradient");
  gradient.id = gradientId;
  gradient.setAttribute("x1", "0"); gradient.setAttribute("x2", "0"); gradient.setAttribute("y2", "1");
  [["0%", ".22"], ["100%", "0"]].forEach(([offset, opacity]) => {
    const stop = document.createElementNS(ns, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", "var(--accent)");
    stop.setAttribute("stop-opacity", opacity);
    gradient.append(stop);
  });
  defs.append(gradient); svg.append(defs);
  for (let index = 0; index < 4; index += 1) {
    const gy = top + (index / 3) * (height - top - bottom);
    const grid = document.createElementNS(ns, "line");
    grid.setAttribute("x1", left); grid.setAttribute("x2", width - right);
    grid.setAttribute("y1", gy); grid.setAttribute("y2", gy);
    grid.setAttribute("class", "chart-grid"); svg.append(grid);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", 0); label.setAttribute("y", gy + 3);
    label.setAttribute("class", "chart-label");
    label.textContent = formatValue(max - (index / 3) * spread);
    svg.append(label);
  }
  const area = document.createElementNS(ns, "path");
  area.setAttribute("d", areaPath); area.setAttribute("class", "chart-area");
  area.style.fill = `url(#${gradientId})`; svg.append(area);
  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", linePath); line.setAttribute("class", "chart-line"); svg.append(line);
  coords.forEach(([px, py], index) => {
    const point = document.createElementNS(ns, "circle");
    point.setAttribute("cx", px); point.setAttribute("cy", py);
    point.setAttribute("r", index === coords.length - 1 ? 5 : 3);
    point.setAttribute("class", "chart-point");
    const title = document.createElementNS(ns, "title");
    title.textContent = `${axisDate(points[index].date)}: ${formatValue(points[index].value)}`;
    point.append(title);
    svg.append(point);
  });
  if (secondaryValues.length) {
    const secondaryCoords = points
      .map((point, index) => (Number.isFinite(point.secondary) ? [x(index), y(point.secondary), index] : null))
      .filter(Boolean);
    if (secondaryCoords.length > 1) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", secondaryCoords.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" "));
      path.setAttribute("class", "chart-line-secondary");
      svg.append(path);
    }
    secondaryCoords.forEach(([px, py, index]) => {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("r", 2.5);
      dot.setAttribute("class", "chart-point-secondary");
      const title = document.createElementNS(ns, "title");
      title.textContent = `${axisDate(points[index].date)}: ${formatValue(points[index].secondary)}${secondaryLabel}`;
      dot.append(title);
      svg.append(dot);
    });
  }
  // Marcas de eventos (publicaciones) sobre el eje: solo con eje temporal, y
  // solo dentro del dominio dibujado; fuera de rango no se inventa posición.
  if (timed) {
    for (const event of events) {
      const time = parseDay(event.date).getTime();
      if (!Number.isFinite(time) || time < times[0] || time > times.at(-1)) continue;
      const mark = document.createElementNS(ns, "line");
      const ex = atTime(time);
      mark.setAttribute("x1", ex); mark.setAttribute("x2", ex);
      mark.setAttribute("y1", height - bottom); mark.setAttribute("y2", height - bottom - 10);
      mark.setAttribute("class", "chart-event");
      const title = document.createElementNS(ns, "title");
      title.textContent = `${axisDate(event.date)} · ${event.label}`;
      mark.append(title);
      svg.append(mark);
    }
  }
  appendAxisLabels(svg, points, { height, bottom }, x);
  attachChartTooltip(svg, points, x, { primaryLabel, secondaryLabel: secondaryLabel || "Secundario", formatValue });
  return true;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const axisDate = (value) => parseDay(value).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

// Etiquetas de eje X: hasta 5, repartidas. Sin esto un grafico temporal no dice
// cuando paso nada, que era el caso de los dos graficos anteriores. Reciben la
// misma función `x` que usó el gráfico: con eje temporal la etiqueta cae donde
// cae el punto, no donde caería su índice.
function appendAxisLabels(svg, points, geometry, x) {
  const { height, bottom } = geometry;
  const step = Math.max(1, Math.ceil(points.length / 5));
  points.forEach((point, index) => {
    if (index % step && index !== points.length - 1) return;
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", x(index));
    label.setAttribute("y", height - bottom + 18);
    label.setAttribute("text-anchor", index === 0 ? "start" : index === points.length - 1 ? "end" : "middle");
    label.setAttribute("class", "chart-label");
    label.textContent = axisDate(point.date);
    svg.append(label);
  });
}

function drawBarChart(svg, points, { secondaryLabel = "", primaryLabel = "Valor", formatValue = formatCompactNumber } = {}) {
  if (!svg) return false;
  svg.replaceChildren();
  if (!points.length) return false;
  const { width, height, left, right, top, bottom } = chartGeometry(svg, { fallbackHeight: 200, minHeight: 160 });
  // El máximo incluye el segmento secundario: un día con más bajas que altas
  // tiene que caber en la escala y verse, no quedar capado bajo la barra.
  const max = Math.max(1, ...points.map((point) => Math.max(point.value, point.secondary || 0)));
  const slot = (width - left - right) / points.length;
  const barWidth = Math.max(2, Math.min(22, slot * 0.68));
  const scale = (value) => (value / max) * (height - top - bottom);
  points.forEach((point, index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    const barHeight = scale(point.value);
    const bar = document.createElementNS(SVG_NS, "rect");
    bar.setAttribute("x", x);
    bar.setAttribute("y", height - bottom - barHeight);
    bar.setAttribute("width", barWidth);
    bar.setAttribute("height", Math.max(point.value ? 1 : 0, barHeight));
    bar.setAttribute("class", "chart-bar");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = secondaryLabel
      ? `${axisDate(point.date)}: ${point.value} · ${point.secondary || 0} ${secondaryLabel}`
      : `${axisDate(point.date)}: ${point.value}`;
    bar.append(title);
    svg.append(bar);
    // Solo se dibuja el segmento secundario si existe: un cero no pinta nada.
    if (point.secondary > 0) {
      const overlay = document.createElementNS(SVG_NS, "rect");
      const overlayHeight = scale(point.secondary);
      overlay.setAttribute("x", x);
      overlay.setAttribute("y", height - bottom - overlayHeight);
      overlay.setAttribute("width", barWidth);
      overlay.setAttribute("height", Math.max(1, overlayHeight));
      overlay.setAttribute("class", "chart-bar-secondary");
      svg.append(overlay);
    }
  });
  const baseline = document.createElementNS(SVG_NS, "line");
  baseline.setAttribute("x1", left); baseline.setAttribute("x2", width - right);
  baseline.setAttribute("y1", height - bottom); baseline.setAttribute("y2", height - bottom);
  baseline.setAttribute("class", "chart-grid");
  svg.append(baseline);
  const peak = document.createElementNS(SVG_NS, "text");
  peak.setAttribute("x", 0); peak.setAttribute("y", top + 3);
  peak.setAttribute("class", "chart-label");
  peak.textContent = formatCompactNumber(max);
  svg.append(peak);
  const xOf = (index) => left + index * slot + slot / 2;
  appendAxisLabels(svg, points, { height, bottom }, xOf);
  attachChartTooltip(svg, points, xOf, { primaryLabel, secondaryLabel: secondaryLabel || "Secundario", formatValue });
  return true;
}

// Rellena los días ausentes de una serie diaria de EVENTOS con ceros. Solo vale
// para series donde "no hay fila" significa "0 eventos medidos" (altas y bajas
// derivadas de enumerar suscriptores o del histórico diario de crecimiento),
// nunca para métricas donde la ausencia es desconocimiento. Sin esto, las
// barras comprimen los huecos y la densidad temporal miente.
function fillDailyGaps(rows, makeZero = (date) => ({ date })) {
  if (rows.length < 2) return rows;
  const last = parseDay(rows.at(-1).date).getTime();
  if (!Number.isFinite(last)) return rows;
  const byDate = new Map(rows.map((row) => [String(row.date).slice(0, 10), row]));
  const cursor = parseDay(rows[0].date);
  const filled = [];
  while (cursor.getTime() <= last && filled.length < 4000) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    filled.push(byDate.get(key) || makeZero(key));
    cursor.setDate(cursor.getDate() + 1);
  }
  return filled;
}

const DAY_NAMES = { sun: "Dom", mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb" };
const WEEK_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Copy por estado de captura: "en proceso" aplicado a una nota de hace dos años
// sería mentira, por eso cada estado tiene el suyo.
const NOTE_STATE_COPY = {
  pending: "Estadísticas en proceso",
  throttled: "Aplazado por el límite de peticiones de Substack",
  unavailable: "Substack no ofrece estadísticas de esta nota",
  ready: "",
};

const HOUR_BUCKET_ORDER = ["night", "morning", "afternoon", "evening"];
const HOUR_BUCKET_LABELS = { night: "Madrugada (0-6)", morning: "Mañana (6-12)", afternoon: "Tarde (12-18)", evening: "Noche (18-24)" };

// La cadencia es un recuento, asi que la intensidad codifica notas publicadas.
// Las interacciones van en el tooltip, y "sin estadisticas" no es "cero".
// Rejilla 7x4 por tramos: 168 celdas horarias con decenas de notas eran un
// tablero casi vacío en el que la señal no se veía.
function renderCadenceHeatmap(container, cadence) {
  if (!container) return;
  container.replaceChildren();
  const buckets = cadence?.buckets || [];
  if (!buckets.length || !cadence.datedNotes) {
    return emptyMessage(container, "No hay notas con fecha para construir la cadencia.", "coverage-empty");
  }
  const byKey = new Map(buckets.map((cell) => [`${cell.day}:${cell.bucket}`, cell]));
  const max = Math.max(1, cadence.maxBucketNotes);

  const header = document.createElement("div");
  header.className = "heatmap-row is-header is-buckets";
  header.append(document.createElement("span"));
  for (const bucket of HOUR_BUCKET_ORDER) {
    const label = document.createElement("small");
    label.textContent = HOUR_BUCKET_LABELS[bucket];
    header.append(label);
  }
  container.append(header);

  for (const day of WEEK_ORDER) {
    const row = document.createElement("div");
    row.className = "heatmap-row is-buckets";
    const name = document.createElement("span");
    name.textContent = DAY_NAMES[day];
    row.append(name);
    for (const bucket of HOUR_BUCKET_ORDER) {
      const cell = byKey.get(`${day}:${bucket}`) || { notes: 0, scoredNotes: 0, medianInteractions: null };
      const box = document.createElement("i");
      box.className = "heatmap-cell";
      if (cell.notes) {
        box.style.opacity = String(0.22 + (cell.notes / max) * 0.78);
        box.classList.add("is-filled");
        const detail = cell.medianInteractions === null
          ? "sin estadísticas"
          : `mediana ${decimal(cell.medianInteractions)} interacciones (${cell.scoredNotes}/${cell.notes} con detalle)`;
        box.title = `${DAY_NAMES[day]} · ${HOUR_BUCKET_LABELS[bucket]} · ${cell.notes} ${cell.notes === 1 ? "nota" : "notas"} · ${detail}`;
      } else box.title = `${DAY_NAMES[day]} · ${HOUR_BUCKET_LABELS[bucket]} · sin notas`;
      row.append(box);
    }
    container.append(row);
  }
}

// Sin fallback fuera de rango: si el periodo no tiene ≥2 puntos, el gráfico
// muestra su estado vacío en vez de pintar datos de otro periodo con la
// etiqueta del actual.
function visibleTrend(snapshot) {
  if (state.days === ALL_TIME) return snapshot.trend;
  const cutoff = Date.now() - state.days * 86400000;
  return snapshot.trend.filter((point) => parseDay(point.date).getTime() >= cutoff);
}

// Corte por FECHA, no por número de puntos: la serie solo trae días con altas,
// así que "los últimos 30 elementos" podían abarcar seis meses.
function windowedSubscriberDaily(analytics) {
  const daily = analytics?.audience?.timeline?.daily || [];
  if (state.days === ALL_TIME) return daily;
  const cutoff = Date.now() - state.days * 86400000;
  return daily.filter((point) => parseDay(point.date).getTime() >= cutoff);
}

function subscriberSeries(snapshot, analytics) {
  const daily = windowedSubscriberDaily(analytics);
  if (daily.length >= 2) return daily.map((point) => ({ date: point.date, subscribers: point.cumulative }));
  return visibleTrend(snapshot);
}

function renderChart(snapshot, analytics) {
  const points = subscriberSeries(snapshot, analytics);
  // Las publicaciones del periodo se marcan sobre la curva: "¿qué causó este
  // pico?" se responde con datos que ya están en el snapshot, sin red nueva.
  const eventos = withinRange(snapshot.campaigns.filter((campaign) => campaign.date), (campaign) => campaign.date).kept
    .map((campaign) => ({ date: String(campaign.date).slice(0, 10), label: campaign.title }));
  const drawn = drawLineChart(
    $("#growth-chart"),
    points.map((point) => ({ date: point.date, value: point.subscribers })),
    "area-gradient",
    { events: eventos, primaryLabel: "Suscriptores" },
  );
  $("#chart-empty").hidden = drawn;
  if (!drawn) return;
  // El neto honesto sale de altas − bajas del histórico de crecimiento. La
  // curva acumulada solo enumera a los suscriptores ACTUALES (quien se fue no
  // deja rastro), así que su primera-menos-última es variación, no neto.
  const growthDaily = withinRange(analytics?.growth?.subscribers?.free?.daily || [], (point) => point.date).kept;
  const first = points[0], last = points.at(-1);
  const elapsed = Math.max(1, (parseDay(last.date).getTime() - parseDay(first.date).getTime()) / 86400000);
  let net, netLabel;
  if (growthDaily.length) {
    net = growthDaily.reduce((sum, point) => sum + (Number.isFinite(point.net) ? point.net : point.new - point.losses), 0);
    netLabel = "Crecimiento neto";
  } else {
    net = last.subscribers - first.subscribers;
    netLabel = "Variación del histórico";
  }
  $("#net-growth-label").textContent = netLabel;
  $("#net-growth").textContent = `${net >= 0 ? "+" : ""}${formatCompactNumber(net)}`;
  $("#daily-growth").textContent = `${net >= 0 ? "+" : ""}${decimal(net / elapsed)}`;
  // "Mejor día" = día con más altas medidas. Nunca la diferencia entre dos
  // puntos consecutivos de la curva, que pueden distar semanas.
  const altasDiarias = growthDaily.length
    ? growthDaily.map((point) => ({ date: point.date, value: point.new }))
    : windowedSubscriberDaily(analytics).map((point) => ({ date: point.date, value: point.signups }));
  const best = [...altasDiarias].sort((a, b) => b.value - a.value)[0];
  $("#best-day").textContent = best && best.value > 0
    ? parseDay(best.date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
    : "—";
}

// Las etiquetas de Audiencia y de la composición ya vienen en español desde el
// renderer; no se imprimen claves crudas de la API.
function renderLabelledGrid(container, rows, emptyCopy) {
  const entries = rows.filter(([, value]) => Number.isFinite(value) && value > 0);
  if (!entries.length) return emptyMessage(container, emptyCopy, "coverage-empty");
  container.replaceChildren(...entries.map(([label, value, format]) => {
    const item = document.createElement("div");
    const name = document.createElement("span"); name.textContent = label;
    const number = document.createElement("strong");
    // Una cifra de dinero sin moneda no dice nada: "7" no es "7 US$".
    number.textContent = format === "currency" ? formatCurrency(value)
      : format === "percent" ? formatPercent(value)
      : formatCompactNumber(value);
    item.append(name, number);
    return item;
  }));
}

function renderAudience(snapshot, analytics) {
  const audience = analytics?.audience;
  const timeline = audience?.timeline;
  const daily = timeline?.daily || [];
  const composition = timeline?.composition || {};
  const engagement = timeline?.engagement || {};
  const metrics = snapshot.metrics || {};
  const cards = [
    ["Suscriptores", audience?.total || timeline?.total || 0, ""],
    ["Seguidores", audience?.followers?.total || metrics.followers || 0, ""],
    ["Lectores en la app", metrics.appSubscribers || 0, ""],
    ["Con email", audience?.emailable || 0, ""],
    ["De pago", composition.paid || audience?.composition?.paidSubscribers || 0, "paid"],
    ["Actividad alta", engagement.alta || 0, ""],
  ];
  $("#audience-totals").replaceChildren(...cards.map(([label, value, sensitive]) => {
    const item = document.createElement("div");
    if (sensitive) item.dataset.sensitive = sensitive;
    const name = document.createElement("span"); name.textContent = label;
    const number = document.createElement("strong"); number.textContent = formatCompactNumber(value);
    item.append(name, number);
    return item;
  }));

  const windowed = windowedSubscriberDaily(analytics);
  const cumulative = drawLineChart($("#audience-chart"), windowed.map((point) => ({ date: point.date, value: point.cumulative })), "audience-gradient", { primaryLabel: "Suscriptores acumulados" });
  $("#audience-empty").hidden = cumulative;

  const note = $("#audience-note");
  if (timeline?.partial) {
    note.textContent = `Serie parcial: ${formatCompactNumber(timeline.counted)} de ${formatCompactNumber(timeline.total)} altas. Substack pagina de más reciente a más antigua, así que faltan las más viejas.`;
    note.hidden = false;
  } else if (windowed.length) {
    const peak = [...windowed].sort((a, b) => b.signups - a.signups)[0];
    const inWindow = windowed.reduce((sum, point) => sum + point.signups, 0);
    const scope = windowed.length < daily.length ? `${formatCompactNumber(inWindow)} altas` : `${formatCompactNumber(timeline.counted)} altas`;
    note.textContent = `${scope} entre ${shortDate(windowed[0].date)} y ${shortDate(windowed.at(-1).date)} · mejor día ${shortDate(peak.date)} con ${peak.signups}.`;
    note.hidden = false;
  } else note.hidden = true;

  const followerHistory = audience?.followers?.history || [];
  const followers = withinRange(followerHistory, (point) => point.date).kept;
  // Suscriptores como segunda linea AQUI, no sobre la curva de Audiencia: esa
  // la comparte el Resumen y meterle una serie mayor le cambiaba la escala. La
  // divergencia entre seguir y suscribirse (atencion que no convierte) es
  // justo lo que este panel tiene que responder.
  const acumuladoPorFecha = new Map(windowed.map((point) => [point.date, point.cumulative]));
  const fechasAcumulado = [...acumuladoPorFecha.keys()].sort();
  // Ultimo valor conocido a esa fecha, nunca uno interpolado: las dos series
  // tienen densidades distintas y rellenar inventaria puntos.
  const suscriptoresA = (date) => {
    let value;
    for (const key of fechasAcumulado) {
      if (key <= date) value = acumuladoPorFecha.get(key);
      else break;
    }
    return value;
  };
  const followersDrawn = drawLineChart(
    $("#followers-chart"),
    followers.map((point) => ({ ...point, secondary: fechasAcumulado.length ? suscriptoresA(point.date) : undefined })),
    "audience-gradient",
    { primaryLabel: "Seguidores", secondaryLabel: "Suscriptores" },
  );
  $("#followers-empty").hidden = followersDrawn;
  const followerDelta = followers.length > 1 ? followers.at(-1).value - followers[0].value : null;
  $("#followers-change").textContent = followerDelta === null
    ? ""
    : `${followerDelta >= 0 ? "+" : ""}${formatCompactNumber(followerDelta)} en ${rangeLabel()}`;

  const displayNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["es"], { type: "region" }) : null;
  const locations = (audience?.location?.rows || []).map((row) => {
    let label = row.code;
    try { label = displayNames?.of(row.code) || row.code; } catch { /* conserva el código desconocido */ }
    return { label, value: row.value };
  });
  const locationCount = audience?.location?.totals?.global?.locations || locations.length;
  $("#audience-location-count").textContent = locationCount
    ? `${formatCompactNumber(locationCount)} ${locationCount === 1 ? "país" : "países"}`
    : "";
  renderRankedList($("#audience-location-list"), locations, "Substack no devolvió ubicaciones de la audiencia.");

  // Solapamiento: `percentOverlap` viene en fraccion 0-1.
  renderRankedList(
    $("#overlap-list"),
    (audience?.overlap || []).map((row) => ({
      label: row.name,
      value: row.share * 100,
      display: formatPercent(row.share * 100),
    })),
    "Substack no devolvió publicaciones con audiencia en común.",
  );

  renderRetention($("#retention-list"), analytics?.retention?.free, "Suscriptores gratuitos");
  renderRetention($("#paid-retention-list"), analytics?.retention?.paid, "Suscriptores de pago");
  renderComposition(analytics);
  renderEngagement(analytics);
}

// Composición de la suscripción: se calculaba por suscriptor en cada sync y no
// se pintaba. El panel entero es sensible porque describe la base de pago.
function renderComposition(analytics) {
  const timeline = analytics?.audience?.timeline;
  const composition = timeline?.composition || {};
  const intervals = new Map((timeline?.byInterval || []).map((row) => [String(row.interval).toLowerCase(), row.count]));
  renderLabelledGrid($("#composition-grid"), [
    ["De pago", composition.paid],
    ["Fundadores", composition.founding],
    ["Regalo", composition.gift],
    ["Cortesía", composition.comp],
    ["Prueba gratuita", composition.freeTrial],
    ["Plan mensual", intervals.get("month") ?? intervals.get("monthly")],
    ["Plan anual", intervals.get("year") ?? intervals.get("yearly") ?? intervals.get("annual")],
  ], "Substack no devolvió la composición de la suscripción.");
}

// Barra apilada + leyenda. Un cero SÍ se pinta en la leyenda (es una medición),
// pero no ocupa ancho en la barra. Sin ningún valor el bloque entero desaparece
// en vez de dibujar una barra vacía que parecería un reparto medido.
// `segments`: [claveDeColor, etiqueta en español, valor].
function renderStackedBar(bar, legend, segments, emptyCopy) {
  const total = segments.reduce((sum, [, , value]) => sum + safeValue(value), 0);
  if (!total) {
    bar.hidden = true;
    bar.replaceChildren();
    emptyMessage(legend, emptyCopy, "coverage-empty");
    return false;
  }
  bar.hidden = false;
  bar.replaceChildren(...segments.filter(([, , value]) => safeValue(value) > 0).map(([key, label, value]) => {
    const segment = document.createElement("i");
    segment.className = `is-${key}`;
    segment.style.width = `${(safeValue(value) / total) * 100}%`;
    segment.title = `${label}: ${formatCompactNumber(value)} (${formatPercent((safeValue(value) / total) * 100)})`;
    return segment;
  }));
  legend.replaceChildren(...segments.map(([, label, value]) => {
    const item = document.createElement("div");
    const name = document.createElement("span"); name.textContent = label;
    const number = document.createElement("strong"); number.textContent = formatCompactNumber(value);
    item.append(name, number);
    return item;
  }));
  return true;
}

const safeValue = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Distribución de actividad (rating 0-5 de Substack agregado en tres tramos):
// mejor señal de salud de la lista que el total a secas.
function renderEngagement(analytics) {
  const timeline = analytics?.audience?.timeline;
  const engagement = timeline?.engagement || {};
  const note = $("#engagement-note");
  const drawn = renderStackedBar($("#engagement-bar"), $("#engagement-legend"), [
    ["alta", "Actividad alta", engagement.alta || 0],
    ["baja", "Actividad baja", engagement.baja || 0],
    ["inactiva", "Inactivos", engagement.inactiva || 0],
  ], "Substack no devolvió la puntuación de actividad.");
  if (drawn && timeline?.partial) {
    note.textContent = `Calculado sobre ${formatCompactNumber(timeline.counted)} de ${formatCompactNumber(timeline.total)} suscriptores: Substack pagina de más reciente a más antiguo.`;
    note.hidden = false;
  } else note.hidden = true;
}

// La unidad (fracción 0-1 o porcentaje 0-100) se decide sobre la serie entera:
// si TODAS las tasas finitas son ≤ 1, es una fracción. Con la heurística por
// fila, un 1% real (rate = 1 en escala porcentual) se pintaba como 100%.
// Se listan todos los meses disponibles: la curva completa, no cuatro puntos.
function renderRetention(container, retention, label) {
  container.replaceChildren();
  const rates = (retention?.rates || [])
    .filter((row) => Number.isFinite(row.rate) && row.month > 0)
    .sort((a, b) => a.month - b.month);
  if (!rates.length) return emptyMessage(container, "Todavía no hay cohortes suficientes para calcular la retención.", "coverage-empty");
  const heading = document.createElement("p");
  heading.className = "retention-label";
  heading.textContent = label;
  container.append(heading);
  const isFraction = isFractionScale(rates.map((row) => row.rate));
  for (const rate of rates) {
    const row = document.createElement("div");
    const month = document.createElement("span"); month.textContent = `${rate.month} ${rate.month === 1 ? "mes" : "meses"}`;
    const value = document.createElement("strong"); value.textContent = formatPercent(isFraction ? rate.rate * 100 : rate.rate);
    row.append(month, value);
    container.append(row);
  }
  renderCohorts(container, retention?.cohorts || []);
}

// Matriz cohorte × mes. `normalizeRetention` la guardaba desde el principio y
// nadie la pintaba: solo se veían las tasas medias. Con una sola cohorte no hay
// comparación que hacer, así que no se dibuja. La unidad se decide sobre TODAS
// las celdas juntas, igual que las tasas medias.
function renderCohorts(container, cohorts) {
  const withPoints = cohorts.filter((cohort) => cohort.points?.length);
  if (withPoints.length < 2) return;
  const allRates = withPoints.flatMap((cohort) => cohort.points.map((point) => point.rate));
  const isFraction = isFractionScale(allRates);
  const asPercent = (rate) => (isFraction ? rate * 100 : rate);
  const months = [...new Set(withPoints.flatMap((cohort) => cohort.points.map((point) => point.month)))]
    .sort((a, b) => a - b)
    .slice(0, 12);

  const heading = document.createElement("p");
  heading.className = "retention-label";
  heading.textContent = "Por cohorte de alta";
  const grid = document.createElement("div");
  grid.className = "cohort-grid";
  grid.style.gridTemplateColumns = `auto repeat(${months.length}, 1fr)`;

  const corner = document.createElement("small");
  corner.textContent = "Alta";
  grid.append(corner);
  for (const month of months) {
    const label = document.createElement("small");
    label.textContent = `M${month}`;
    grid.append(label);
  }
  for (const cohort of withPoints.slice(-12)) {
    const name = document.createElement("small");
    name.className = "cohort-name";
    name.textContent = cohort.cohort;
    grid.append(name);
    const byMonth = new Map(cohort.points.map((point) => [point.month, point.rate]));
    for (const month of months) {
      const cell = document.createElement("i");
      cell.className = "cohort-cell";
      const rate = byMonth.get(month);
      // Un mes sin medición no es un 0%: queda vacío y lo dice el tooltip.
      if (rate === undefined) {
        cell.classList.add("is-empty");
        cell.title = `${cohort.cohort} · mes ${month} · sin dato`;
      } else {
        cell.style.opacity = String(0.2 + Math.min(1, asPercent(rate) / 100) * 0.8);
        cell.title = `${cohort.cohort} · mes ${month} · ${formatPercent(asPercent(rate))}`;
      }
      grid.append(cell);
    }
  }
  container.append(heading, grid);
}

// Clave de ventana para las fuentes que Substack agrega en servidor. Se piden
// las cuatro en cada sync porque sus totales NO son recortables en cliente: el
// endpoint devuelve un unico punto agregado por fuente, no una serie diaria.
const rangeKey = () => (state.days === ALL_TIME ? "all" : String(state.days));
const byRange = (source) => (source && !Array.isArray(source) ? source[rangeKey()] : null) || null;

function renderSourcesTable(analytics) {
  const growth = byRange(analytics?.growth?.sources);
  const sources = growth?.sources || [];
  const totals = growth?.totals || { visitors: 0, subscribers: 0, revenue: 0 };
  $("#acquisition-total").textContent = formatCompactNumber(totals.subscribers);
  $("#acquisition-visitors").textContent = formatCompactNumber(totals.visitors);
  $("#acquisition-conversion").textContent = totals.visitors
    ? formatPercent((totals.subscribers / totals.visitors) * 100)
    : "Sin dato";
  const leader = [...sources].sort((a, b) => b.subscribers - a.subscribers || b.visitors - a.visitors)[0];
  $("#acquisition-leader").textContent = leader
    ? `${leader.label} lidera con ${formatCompactNumber(leader.subscribers)} altas de ${formatCompactNumber(totals.subscribers)} y ${formatCompactNumber(leader.visitors)} visitas.`
    : "Substack no devolvió atribución para este periodo.";
  // Ya NO es de periodo fijo: el endpoint acepta `from_date`/`to_date` y la
  // sincronizacion pide una ventana por cada opcion del selector. El badge decia
  // "· fijo" por una limitacion nuestra, no de la API.
  $("#acquisition-period").textContent = rangeLabel();

  const body = $("#sources-body");
  body.replaceChildren();
  if (!sources.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "source-empty";
    cell.textContent = "Substack no devolvió fuentes de adquisición para este periodo.";
    row.append(cell);
    body.append(row);
    return;
  }
  // `children` trae el desglose dentro de cada fuente: ahí viven Notes y
  // Recommendations, que es lo que el endpoint de recomendaciones ya no da.
  for (const source of sources) {
    body.append(sourceRow(source, false));
    for (const child of source.children || []) {
      if (!child.visitors && !child.subscribers) continue;
      body.append(sourceRow(child, true));
    }
  }
}

function sourceRow(source, isChild) {
  const row = document.createElement("tr");
  if (isChild) row.className = "is-child";
  [
    isChild ? `↳ ${source.label}` : source.label,
    formatCompactNumber(source.visitors),
    formatCompactNumber(source.subscribers),
    source.visitors ? formatPercent((source.subscribers / source.visitors) * 100) : "—",
  ].forEach((value) => {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  });
  // Sparkline de altas por fuente: la serie ya venía normalizada y se tiraba.
  const trend = document.createElement("td");
  const series = (source.series || []).filter((point) => Number.isFinite(point.value));
  if (series.length > 1) {
    const spark = document.createElement("div");
    spark.className = "source-spark";
    const points = series.slice(-24);
    const max = Math.max(1, ...points.map((point) => point.value));
    spark.append(...points.map((point) => {
      const bar = document.createElement("i");
      bar.style.height = `${Math.max(6, (point.value / max) * 100)}%`;
      bar.title = `${shortDate(point.date)}: ${point.value} altas`;
      return bar;
    }));
    trend.append(spark);
  } else trend.textContent = "—";
  row.append(trend);
  return row;
}

function renderRankedList(container, rows, emptyCopy) {
  container.replaceChildren();
  if (!rows.length) return emptyMessage(container, emptyCopy);
  const max = Math.max(1, ...rows.map((row) => row.value));
  rows.slice(0, 8).forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "source-row";
    if (entry.muted) row.classList.add("is-muted");
    const rank = document.createElement("span");
    rank.className = "source-rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    const detail = document.createElement("div");
    detail.className = "source-detail";
    const header = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = entry.muted ? `${entry.label} · muestra escasa` : entry.label;
    const number = document.createElement("strong"); number.textContent = entry.display ?? formatCompactNumber(entry.value);
    header.append(label, number);
    const track = document.createElement("div"); track.className = "source-track";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(3, (entry.value / max) * 100)}%`;
    track.append(fill);
    detail.append(header, track);
    row.append(rank, detail);
    container.append(row);
  });
}

// Altas: serie diaria real reconstruida de subscriber-stats. Bajas: lo unico que
// Substack expone son `unsubscribes_within_1_day` y `disables_within_1_day` por
// publicacion, o sea solo las 24 h posteriores a cada envio. No hay total de
// bajas en ninguna ruta observada, y eso hay que decirlo, no disimularlo.
function renderChurn(snapshot, analytics) {
  const growthDaily = analytics?.growth?.subscribers?.free?.daily || [];
  const daily = analytics?.audience?.timeline?.daily || [];
  const altasPorDia = new Map((growthDaily.length ? growthDaily : daily).map((point) => [point.date, point.new ?? point.signups]));

  const bajasPorDia = new Map();
  if (growthDaily.length) {
    for (const point of growthDaily) if (point.losses) bajasPorDia.set(point.date, point.losses);
  } else {
    for (const campaign of snapshot.campaigns) {
      const day = String(campaign.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const bajas = campaign.unsubscribesWithin1Day + campaign.disablesWithin1Day;
      if (!bajas) continue;
      bajasPorDia.set(day, (bajasPorDia.get(day) || 0) + bajas);
    }
  }

  const dias = [...new Set([...altasPorDia.keys(), ...bajasPorDia.keys()])].sort();
  const serie = dias.map((date) => ({
    date,
    altas: altasPorDia.get(date) || 0,
    bajas: bajasPorDia.get(date) || 0,
  }));
  const ventana = withinRange(serie, (point) => point.date).kept;
  const totalAltas = ventana.reduce((sum, point) => sum + point.altas, 0);
  const totalBajas = ventana.reduce((sum, point) => sum + point.bajas, 0);
  const neto = totalAltas - totalBajas;

  // Tasa relativa: bajas sobre la base actual. `null` sin denominador o sin
  // bajas medidas (renderLabelledGrid descarta los no finitos).
  const tasaBajas = snapshot.metrics.subscribers > 0 && totalBajas > 0
    ? (totalBajas / snapshot.metrics.subscribers) * 100
    : null;
  // Las altas por canal van como celdas más de la misma tira de KPI: una sección,
  // una cabecera, un formato. La eficiencia por pieza es la cifra que decide
  // dónde invertir esfuerzo; sus ventanas de atribución las declara la nota.
  const channels = getChannelAttribution(snapshot, state.days);
  // Altas medias de un dia con publicacion frente a uno en silencio.
  const ritmo = getPublishingRhythm(snapshot, growthDaily.length ? growthDaily : daily, state.days);
  renderLabelledGrid($("#churn-kpis"), [
    ["Altas", totalAltas],
    ["Bajas", totalBajas],
    ["Neto", neto],
    ["Tasa de bajas", tasaBajas, "percent"],
    ["Días con altas", ventana.filter((point) => point.altas).length],
    ["Altas vía email (D1)", channels.email.signups],
    ["Altas por envío", channels.email.perPiece],
    ["Altas vía notas", channels.notes.signups],
    ["Altas por nota medida", channels.notes.perPiece],
    // Las dos series ya existian por separado; la comparacion es lo nuevo.
    ["Altas en día de envío", ritmo.state === "nodata" ? null : ritmo.onPublish],
    ["Altas en día sin envío", ritmo.state === "nodata" ? null : ritmo.onQuiet],
  ], "Sin movimientos de audiencia en este periodo.");
  const channelsNote = $("#channels-note");
  const partes = [];
  if (channels.email.pieces || channels.notes.pieces) {
    partes.push(`Atribuciones de Substack con ventanas distintas (24 h tras cada envío; acumulado por nota): no suman el total. Notas medidas: ${channels.notes.scoredPieces} de ${channels.notes.pieces}; las notas sin detalle no cuentan como cero.`);
  }
  // Con pocos dias medidos la media es anecdota: se dice, no se esconde.
  if (ritmo.state === "evidence" && ritmo.lift !== null) {
    partes.push(`Un día de envío trae ${decimal(ritmo.lift)}× las altas de un día en silencio (${ritmo.publishDays} días con envío frente a ${ritmo.quietDays} sin él).`);
  } else if (ritmo.state === "insufficient") {
    partes.push(`Muestra escasa para comparar días con y sin envío: ${ritmo.publishDays} con envío y ${ritmo.quietDays} sin él.`);
  }
  // El unico dato de este panel que no sale de la propia publicacion.
  const marca = analytics?.growth?.benchmark;
  if (marca?.outcomeCopy && marca.growthRate !== null) {
    // Sin `toLowerCase`: degradaba el nombre propio a "substack".
    partes.push(`${marca.outcomeCopy}: un ${formatPercent(marca.growthRate)} de crecimiento en ${marca.periodDays} días, según su propia comparación.`);
  }
  channelsNote.textContent = partes.join(" ");
  channelsNote.hidden = !partes.length;
  // `renderLabelledGrid` esconde los ceros, y un neto de 0 o unas bajas de 0 son
  // informacion. Se pintan aparte cuando toque.
  $("#churn-net").textContent = ventana.length
    ? `${neto >= 0 ? "+" : ""}${formatCompactNumber(neto)} neto · ${formatCompactNumber(totalAltas)} altas − ${formatCompactNumber(totalBajas)} bajas en ${rangeLabel()}`
    : "Sin datos de audiencia en este periodo.";

  const serieContinua = fillDailyGaps(ventana, (date) => ({ date, altas: 0, bajas: 0 }));
  const dibujado = drawBarChart(
    $("#churn-chart"),
    serieContinua.map((point) => ({ date: point.date, value: point.altas, secondary: point.bajas })),
    { primaryLabel: "Altas", secondaryLabel: "Bajas" },
  );
  $("#churn-empty").hidden = dibujado;
  $("#churn-basis").textContent = growthDaily.length
    ? `Altas y bajas obtenidas del histórico de crecimiento de suscriptores de Substack.`
    : bajasPorDia.size
    ? `Las bajas solo cubren las 24 h siguientes a cada envío porque el histórico general no estuvo disponible.`
    : `Substack no ha devuelto ninguna baja. Solo expone las bajas de las 24 h siguientes a cada envío, así que un cero aquí no prueba que nadie se haya ido.`;
}

// Visitas: la serie diaria SI es diaria, asi que se recorta por fecha como las
// demas. Las fuentes de trafico se agregan en servidor y llegan por ventana.
function renderTraffic(analytics) {
  const daily = withinRange(analytics?.traffic?.daily || [], (point) => point.date).kept;
  const drawn = drawLineChart($("#traffic-chart"), daily, "rates-gradient", { primaryLabel: "Visitas", baselineZero: true });
  $("#traffic-empty").hidden = drawn;
  const totalVisitas = daily.reduce((sum, point) => sum + safeValue(point.value), 0);
  $("#traffic-total").textContent = daily.length ? `${formatCompactNumber(totalVisitas)} visitas` : "Sin visitas";

  const fuentes = byRange(analytics?.growth?.visitors);
  const filas = fuentes?.rows || [];
  const totales = fuentes?.totals || { views: 0, users: 0, freeSignups: 0 };
  // La conversion global usa VISITANTES, no visitas: una misma persona que
  // vuelve tres veces no puede contar como tres oportunidades de alta.
  const conversion = ratio(totales.freeSignups, totales.users);
  renderLabelledGrid($("#traffic-kpis"), [
    ["Visitas", totales.views],
    ["Visitantes", totales.users],
    ["Altas atribuidas", totales.freeSignups],
    ["Conversión", conversion === null ? null : conversion * 100, "percent"],
    ["Vistas por visitante", ratio(totales.views, totales.users)],
  ], "Substack no devolvió tráfico para este periodo.");

  const body = $("#visitor-sources-body");
  body.replaceChildren();
  if (!filas.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "source-empty";
    cell.textContent = "Substack no devolvió fuentes de tráfico para este periodo.";
    row.append(cell);
    body.append(row);
  } else {
    for (const fila of filas.slice(0, 12)) {
      const row = document.createElement("tr");
      [
        fila.source,
        fila.category,
        formatCompactNumber(fila.views),
        formatCompactNumber(fila.users),
        // `null` no es cero: Substack no midio altas en esa fuente.
        fila.freeSignups === null ? "—" : formatCompactNumber(fila.freeSignups),
        fila.conversion === null ? "—" : formatPercent(fila.conversion),
      ].forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (value === "—" && index >= 4) cell.title = "Substack no atribuye altas a esta fuente";
        row.append(cell);
      });
      body.append(row);
    }
  }
  // Concentracion: la cifra que dice si dependes de un solo canal.
  const concentracion = getConcentration(filas, (fila) => fila.views);
  $("#traffic-note").textContent = concentracion.share === null
    ? "Sin visitas medidas por fuente en este periodo."
    : `Las ${concentracion.top} fuentes principales concentran el ${formatPercent(concentracion.share)} de las visitas, sobre ${concentracion.counted} fuentes medidas.`;
}

// Efecto de red: `network_attribution` respondia 500 solo porque se llamaba sin
// `time_window`. Dice que parte de la audiencia la trae Substack y cual es tuya.
const NETWORK_SEGMENTS = ["alta", "baja", "inactiva", "s4", "s5", "s6", "s7"];

function renderNetwork(analytics) {
  const red = byRange(analytics?.growth?.network);
  const filas = red?.rows || [];
  const drawn = renderStackedBar(
    $("#network-bar"),
    $("#network-legend"),
    filas.map((fila, index) => [NETWORK_SEGMENTS[index] || "s7", fila.label, fila.subscribers]),
    "Substack no devolvió atribución de red para este periodo.",
  );
  $("#network-total").textContent = red?.total ? `${formatCompactNumber(red.total)} suscriptores` : "Sin dato";
  const note = $("#network-note");
  if (drawn && red?.updatedAt) {
    note.textContent = `Substack actualizó este reparto el ${shortDate(String(red.updatedAt).slice(0, 10))}.`;
    note.hidden = false;
  } else note.hidden = true;
}

function renderGrowth(snapshot, analytics) {
  renderTraffic(analytics);
  renderNetwork(analytics);
  renderSourcesTable(analytics);
  renderChurn(snapshot, analytics);
  renderPaidChurn(analytics);
}

// Churn de pago: la fuente `paidSubscriberGrowth` se sincronizaba y no tenía
// consumidor. Vive tras data-sensitive, como todo lo de pago.
function renderPaidChurn(analytics) {
  const daily = withinRange(analytics?.growth?.subscribers?.paid?.daily || [], (point) => point.date).kept;
  const totalAltas = daily.reduce((sum, point) => sum + point.new, 0);
  const totalBajas = daily.reduce((sum, point) => sum + point.losses, 0);
  const neto = totalAltas - totalBajas;
  $("#paid-churn-net").textContent = daily.length
    ? `${neto >= 0 ? "+" : ""}${formatCompactNumber(neto)} neto · ${formatCompactNumber(totalAltas)} altas − ${formatCompactNumber(totalBajas)} bajas en ${rangeLabel()}`
    : "Sin movimientos de pago en este periodo.";
  const serie = fillDailyGaps(daily, (date) => ({ date, new: 0, losses: 0 }));
  const drawn = drawBarChart(
    $("#paid-churn-chart"),
    serie.map((point) => ({ date: point.date, value: point.new, secondary: point.losses })),
    { primaryLabel: "Altas de pago", secondaryLabel: "Bajas de pago" },
  );
  $("#paid-churn-empty").hidden = drawn;
}

// Una fila de Cobertura. `records` solo se pinta cuando hay algo que contar.
function coverageRow({ label, meta = "", status, statusCopy, title = "" }) {
  const row = document.createElement("div");
  row.className = `coverage-item is-${status}`;
  const name = document.createElement("span");
  name.textContent = label;
  const detail = document.createElement("span");
  detail.className = "coverage-records";
  detail.textContent = meta;
  const state = document.createElement("strong");
  state.textContent = statusCopy;
  state.title = title;
  row.append(name, detail, state);
  return row;
}

function renderCoverage(analytics, snapshot) {
  const coverage = analytics?.coverage || [];
  const ready = coverage.filter((source) => source.status === "ready").length;
  $("#coverage-ready").textContent = formatCompactNumber(ready);
  $("#coverage-total").textContent = `/ ${coverage.length || "—"}`;
  $("#coverage-synced").textContent = analytics?.syncedAt
    ? `Última sincronización de fuentes ampliadas: ${new Date(analytics.syncedAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`
    : "Sin sincronizar";

  const list = $("#coverage-list");
  list.replaceChildren();

  // Cobertura del SNAPSHOT CENTRAL, que hasta ahora no aparecía: el detalle por
  // publicación y los cuatro estados de la cola de `note_stats` ya se calculan
  // en cada sync y solo se veían nota a nota en la tabla.
  const summary = snapshot?.notesSummary;
  const campaigns = snapshot?.campaigns || [];
  if (campaigns.length || summary?.total) {
    const heading = document.createElement("p");
    heading.className = "retention-label";
    heading.textContent = "Snapshot principal";
    list.append(heading);
    if (campaigns.length) {
      const conDetalle = campaigns.filter((campaign) => campaign.detailAvailable).length;
      list.append(coverageRow({
        label: "Detalle por publicación",
        meta: `${conDetalle}/${campaigns.length} publicaciones`,
        status: conDetalle === campaigns.length ? "ready" : "pending",
        statusCopy: conDetalle === campaigns.length ? "Completo" : "Parcial",
        title: "Se refrescan las 12 más recientes y las que aún no tienen métricas.",
      }));
    }
    if (summary?.total) {
      // Los cuatro estados tienen copy distinto porque significan cosas
      // distintas: "aplazada por el límite" no es "Substack no las da".
      const partes = [
        `${summary.detailAvailable} con datos`,
        summary.detailPending ? `${summary.detailPending} en proceso` : "",
        summary.detailUnavailable ? `${summary.detailUnavailable} sin datos` : "",
      ].filter(Boolean);
      list.append(coverageRow({
        label: "Estadísticas por nota",
        meta: `${partes.join(" · ")} de ${summary.total}`,
        status: summary.statsThrottled || summary.detailUnavailable ? "pending" : summary.detailAvailable ? "ready" : "unavailable",
        statusCopy: summary.statsThrottled ? "Aplazado" : summary.detailAvailable === summary.total ? "Completo" : "Parcial",
        title: summary.statsThrottled ? NOTE_STATE_COPY.throttled : "",
      }));
    }
  }

  // Progreso en curso: si el service worker sigue en la fase de detalle, esta
  // vista es el sitio donde mirarlo.
  if (state.progress && state.progress.phase !== "done") {
    const { done = 0, total = 0 } = state.progress.detail || {};
    list.append(coverageRow({
      label: "Sincronización en curso",
      meta: total > 0 ? `${state.progress.step} ${done}/${total}` : state.progress.step,
      status: state.progress.phase === "error" ? "unavailable" : "pending",
      statusCopy: state.progress.phase === "error" ? "Interrumpida" : "En marcha",
      title: state.progress.error || "",
    }));
  }

  if (!coverage.length) {
    const empty = document.createElement("p");
    empty.className = "coverage-empty";
    empty.textContent = "Sincroniza de nuevo para comprobar las fuentes ampliadas.";
    list.append(empty);
    return;
  }
  const heading = document.createElement("p");
  heading.className = "retention-label";
  heading.textContent = "Fuentes ampliadas";
  list.append(heading);
  coverage.forEach((source) => {
    list.append(coverageRow({
      label: source.label,
      meta: source.status === "ready" ? `${formatCompactNumber(source.records || 0)} registros` : "",
      status: source.status,
      statusCopy: source.status === "ready" ? "Disponible" : "No disponible",
      title: source.error || "",
    }));
  });
}

// muestreadas, ver docs/product/substack-payloads-observados.md). Ocultas por
// venir siempre en cero: subscribes, subscriptionsWithin1Day,
// Columnas elegidas contra la cobertura real de la API. Se omiten los campos
// que Substack devuelve siempre en cero: subscribes, subscriptionsWithin1Day,
// unsubscribesWithin1Day, disablesWithin1Day, downloads, videoViews,
// videoMinutesWatched, estimatedValue. Fuera tambien subtitle/wordcount/audience.
const POST_COLUMNS = [
  { key: "title", label: "Publicación", type: "text" },
  { key: "date", label: "Fecha", type: "date" },
  { key: "delivered", label: "Entregados", type: "number" },
  { key: "openRate", label: "Apertura", type: "percent" },
  { key: "clickRate", label: "CTR", type: "percent" },
  // CTOR = clics únicos / aperturas únicas: separa "asunto flojo" (apertura
  // baja) de "contenido flojo" (CTOR bajo). Derivado en memoria, no se persiste.
  { key: "ctor", label: "CTOR", type: "percent" },
  { key: "engagementRate", label: "Engagement", type: "percent" },
  { key: "views", label: "Vistas", type: "number" },
  { key: "reactions", label: "Reacciones", type: "number" },
  { key: "comments", label: "Comentarios", type: "number" },
  { key: "shares", label: "Shares", type: "number" },
  { key: "signupsWithin1Day", label: "Altas D1", type: "number" },
];

const formatCell = (campaign, column) => {
  const value = campaign[column.key];
  if (column.type === "date") return value ? shortDate(value) : "—";
  if (column.type === "percent") return value ? formatPercent(value) : "—";
  if (column.type === "currency") return value ? formatCurrency(value) : "—";
  if (column.type === "number") return value ? formatCompactNumber(value) : "—";
  return value || "—";
};

function renderCampaignsHead() {
  const head = $("#campaigns-head");
  head.replaceChildren(...POST_COLUMNS.map((column) => {
    const cell = document.createElement("th");
    cell.dataset.sort = column.key;
    cell.textContent = column.label;
    if (state.postsSort.key === column.key) {
      cell.classList.add("is-sorted");
      cell.textContent = `${column.label} ${state.postsSort.direction === "asc" ? "↑" : "↓"}`;
    }
    cell.addEventListener("click", () => {
      const same = state.postsSort.key === column.key;
      state.postsSort = { key: column.key, direction: same && state.postsSort.direction === "desc" ? "asc" : "desc" };
      renderCampaigns(state.snapshot);
    });
    return cell;
  }));
}

function sortedCampaigns(campaigns) {
  const column = POST_COLUMNS.find((item) => item.key === state.postsSort.key) || POST_COLUMNS[2];
  const direction = state.postsSort.direction === "asc" ? 1 : -1;
  return [...campaigns].sort((a, b) => {
    const left = a[column.key], right = b[column.key];
    if (column.type === "text") return String(left || "").localeCompare(String(right || "")) * direction;
    if (column.type === "date") return (new Date(left || 0) - new Date(right || 0)) * direction;
    return (Number(left || 0) - Number(right || 0)) * direction;
  });
}

// Apertura ponderada por entregados y umbral de muestra: un corte con menos de
// MIN_CUT_N envíos se atenúa (nunca se oculta) y lo dice en su etiqueta.
function renderPostCuts(campaigns) {
  const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const cuts = getCampaignCuts(campaigns);
  const cutEntry = (label, row) => ({
    label: `${label} · ${row.posts} ${row.posts === 1 ? "envío" : "envíos"}`,
    value: row.openRate ?? 0,
    display: row.openRate === null ? "—" : formatPercent(row.openRate),
    muted: row.scarce,
  });
  renderRankedList(
    $("#posts-day-list"),
    cuts.byDay.map((row) => cutEntry(dayNames[row.day], row)),
    "Sin envíos con entregas para cruzar.",
  );

  const bandLabels = { short: "Corto (≤700)", medium: "Medio (701-1500)", long: "Largo (>1500)" };
  renderRankedList(
    $("#posts-length-list"),
    cuts.byLength.map((row) => cutEntry(bandLabels[row.band], row)),
    "Substack no devolvió el conteo de palabras de tus posts.",
  );
}

// CTOR solo cuando hay aperturas: sin denominador es ausencia ("—"), no 0%.
const withCtor = (campaigns) => campaigns.map((campaign) => ({
  ...campaign,
  ctor: campaign.opened > 0 ? (campaign.clicked / campaign.opened) * 100 : null,
}));

function renderCampaigns(snapshot) {
  const all = withCtor(snapshot.campaigns);
  state.rangeExcluded.campaigns = 0;
  const search = state.postsSearch.trim().toLowerCase();
  const campaigns = search
    ? all.filter((campaign) => `${campaign.title} ${campaign.subtitle}`.toLowerCase().includes(search))
    : all;

  const totals = all.reduce((sum, item) => ({
    delivered: sum.delivered + item.delivered,
    opened: sum.opened + item.opened,
    clicked: sum.clicked + item.clicked,
    signups: sum.signups + item.signups,
    detailed: sum.detailed + (item.detailAvailable ? 1 : 0),
  }), { delivered: 0, opened: 0, clicked: 0, signups: 0, detailed: 0 });
  $("#posts-total").textContent = formatCompactNumber(all.length);
  $("#posts-delivered").textContent = formatCompactNumber(totals.delivered);
  $("#posts-opened").textContent = formatCompactNumber(totals.opened);
  $("#posts-clicked").textContent = formatCompactNumber(totals.clicked);
  $("#posts-signups").textContent = formatCompactNumber(totals.signups);
  $("#posts-detail").textContent = `${totals.detailed}/${all.length}`;

  renderCampaignsHead();
  const body = $("#campaigns-body");
  body.replaceChildren();
  if (!campaigns.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = POST_COLUMNS.length;
    cell.textContent = search ? "Ninguna publicación coincide con la búsqueda." : "Todavía no hay publicaciones sincronizadas.";
    row.append(cell); body.append(row);
  } else {
    // La apertura de cada envío se marca respecto a la mediana propia: la
    // referencia es tu histórico, no un benchmark inventado.
    const ownMedian = getOwnOpenRateMedian(snapshot);
    sortedCampaigns(campaigns).forEach((campaign) => {
      const row = document.createElement("tr");
      POST_COLUMNS.forEach((column) => {
        const cell = document.createElement("td");
        cell.textContent = formatCell(campaign, column);
        if (column.key === "openRate" && ownMedian !== null && campaign.delivered > 0) {
          cell.classList.add(campaign.openRate >= ownMedian ? "is-above-median" : "is-below-median");
          cell.title = `Tu mediana: ${formatPercent(ownMedian)}`;
        }
        row.append(cell);
      });
      body.append(row);
    });
  }
  renderPostCuts(all);
  renderSections(all);
  renderDiscovery(all);
  renderPostRates(all, getOwnOpenRateMedian(snapshot));
  renderDiagnosis(snapshot.campaigns);
}

// Rendimiento por seccion. Las secciones viajan en la propia fila del post
// (`section_name`), asi que este corte no necesita ninguna peticion nueva.
function renderSections(campaigns) {
  const cortes = getCampaignSections(campaigns);
  renderRankedList(
    $("#posts-section-list"),
    cortes.filter((row) => row.openRate !== null).map((row) => ({
      label: `${row.section} · ${row.posts} ${row.posts === 1 ? "envío" : "envíos"}`,
      value: row.openRate,
      display: formatPercent(row.openRate),
      muted: row.scarce,
    })),
    "Ninguna publicación con envío tiene sección asignada.",
  );
}

// Correo frente a descubrimiento. Vistas y entregados se guardaban desde el
// principio; lo que faltaba era dividirlos. Por encima de 1, cada entrega
// genero mas de una lectura, asi que la pieza vive fuera de la bandeja.
function renderDiscovery(campaigns) {
  const mezcla = getDiscoveryMix(campaigns);
  $("#discovery-median").textContent = mezcla.median === null
    ? "Sin envíos medidos"
    : `Mediana · ${decimal(mezcla.median, 2)} vistas por entrega`;
  renderLabelledGrid($("#discovery-kpis"), [
    ["Envíos medidos", mezcla.posts],
    ["Se leen fuera del correo", mezcla.beyondEmail],
    ["Dependen del correo", mezcla.emailBound],
  ], "Ninguna publicación tiene vistas y entregas a la vez.");
  renderRankedList(
    $("#discovery-list"),
    mezcla.top.map((row) => ({
      label: row.title,
      value: row.ratio,
      display: `${decimal(row.ratio, 2)}×`,
    })),
    "Sin envíos con vistas medidas.",
  );
}

const QUADRANT_COPY = {
  winner: { label: "Ganadores", copy: "Asunto y contenido por encima de tu mediana: repite la fórmula." },
  subject: { label: "Asunto flojo", copy: "Quien abre hace clic, pero pocos abren: el titular no vende lo que el cuerpo cumple." },
  content: { label: "Contenido flojo", copy: "Se abre bien pero no genera clics: el cuerpo no cumple lo que el asunto promete." },
  weak: { label: "Flojos", copy: "Por debajo de tu mediana en apertura y en CTOR." },
};

// Cuatro diagnósticos accionables en vez de dos columnas de porcentajes: qué
// arreglar en cada post (el asunto, el cuerpo, o nada).
function renderDiagnosis(campaigns) {
  const diagnosis = getCampaignDiagnosis(campaigns);
  const grid = $("#diagnosis-grid");
  const badge = $("#diagnosis-medians");
  if (diagnosis.state !== "evidence") {
    badge.textContent = "Muestra escasa";
    return emptyMessage(grid, `Hacen falta al menos 4 envíos con aperturas para diagnosticar; hay ${diagnosis.sample}.`, "coverage-empty");
  }
  badge.textContent = `Medianas · ${formatPercent(diagnosis.medianOpenRate)} apertura / ${formatPercent(diagnosis.medianCtor)} CTOR`;
  grid.replaceChildren(...["winner", "subject", "content", "weak"].map((key) => {
    const posts = diagnosis.quadrants[key];
    const cell = document.createElement("div");
    cell.className = `quadrant is-${key}`;
    const head = document.createElement("strong");
    head.textContent = `${QUADRANT_COPY[key].label} · ${posts.length}`;
    const copy = document.createElement("p");
    copy.textContent = QUADRANT_COPY[key].copy;
    cell.append(head, copy);
    posts.slice(0, 3).forEach((post) => {
      const item = document.createElement("small");
      item.textContent = `${post.title} · ${formatPercent(post.openRate)} apertura / ${formatPercent(post.ctor)} CTOR`;
      cell.append(item);
    });
    return cell;
  }));
}

// Serie temporal de tasas por envío: la vista más básica de cualquier
// herramienta de email. Base cero para no exagerar variaciones pequeñas.
function renderPostRates(campaigns, ownMedian) {
  const points = campaigns
    .filter((campaign) => campaign.delivered > 0 && campaign.date)
    .map((campaign) => ({
      date: String(campaign.date).slice(0, 10),
      value: campaign.openRate,
      secondary: Number.isFinite(campaign.clickRate) ? campaign.clickRate : undefined,
      label: campaign.title,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const drawn = drawLineChart($("#posts-rate-chart"), points, "rates-gradient", {
    baselineZero: true,
    primaryLabel: "Apertura",
    secondaryLabel: "CTR",
    formatValue: (value) => formatPercent(value),
  });
  $("#posts-rate-empty").hidden = drawn;
  $("#posts-rate-median").textContent = ownMedian === null
    ? "Sin mediana propia"
    : `Mediana propia · ${formatPercent(ownMedian)}`;
}

// Altas por cada mil impresiones: conversión de alcance a suscriptor, la
// métrica anti-vanidad de las notas. `null` sin detalle o sin impresiones.
const noteConversion = (note) => (note.detailed && note.analytics.reach.impressions > 0
  ? (note.analytics.results.freeSubscribers / note.analytics.reach.impressions) * 1000
  : null);

function renderNotesOverview(snapshot) {
  const ranged = withinRange(snapshot.notes, (note) => note.date).kept;
  const analytics = getNotesAnalytics({ notes: ranged });
  $("#notes-detail-coverage").textContent = `${analytics.detailedCount} / ${analytics.ranked.length}`;

  // El hallazgo incómodo y útil: si la nota más aplaudida no es la que más
  // convierte, los likes no son la brújula. Solo con muestra suficiente.
  const insight = $("#notes-insight");
  const convertibles = analytics.ranked.filter((note) => noteConversion(note) !== null);
  if (convertibles.length >= 3) {
    const topConversion = [...convertibles].sort((a, b) => noteConversion(b) - noteConversion(a))[0];
    const topInteractions = analytics.ranked[0];
    insight.hidden = false;
    insight.textContent = topConversion.id === topInteractions.id
      ? "Tu nota con más interacciones es también la que más convierte por impresión: aplausos y altas van juntos."
      : `Los aplausos y las altas no van juntos aquí: la nota que más convierte es «${String(topConversion.body).slice(0, 80)}» (${decimal(noteConversion(topConversion))} altas/1000 impresiones), no la más interactuada.`;
  } else insight.hidden = true;
  [
    ["#notes-total", analytics.ranked.length],
    ["#notes-interactions", analytics.total.interactions],
    ["#notes-likes", analytics.total.likes],
    ["#notes-comments", analytics.total.replies],
    ["#notes-restacks", analytics.total.restacks],
    ["#notes-impressions", analytics.total.impressions],
    // Dos señales de intención que Substack ya devolvía y se sumaban solo al
    // total: un clic a enlace o una visita al perfil valen más que un like.
    ["#notes-profile-visits", analytics.total.profileVisits],
    ["#notes-link-clicks", analytics.total.linkClicks],
  ].forEach(([selector, value]) => { $(selector).textContent = formatCompactNumber(value); });
  renderNotesReach(analytics);
}

// Etiquetas en español escritas AQUÍ. Las claves de `note_stats` son las de la
// API ("Profile page", "Unconnected"): iterarlas colaría inglés crudo en una
// interfaz en español, que es el fallo que la lista blanca de rejillas evitó.
const NOTE_SURFACE_LABELS = [
  ["s1", "Feed", "Feed"],
  ["s2", "Notifications", "Notificaciones"],
  ["s3", "Profile page", "Perfil"],
  ["s4", "Permalinks", "Enlaces directos"],
  ["s5", "Notes", "Pestaña Notas"],
  ["s6", "Search", "Búsqueda"],
  ["s7", "Other", "Otros"],
];
const NOTE_AUDIENCE_LABELS = [
  ["alta", "Subscribers", "Suscriptores"],
  ["baja", "Followers", "Seguidores"],
  ["inactiva", "Unconnected", "Sin conexión"],
];

// Desgloses que `note_stats` sí devuelve y nadie pintaba: por dónde llega el
// alcance y a quién. "Sin conexión" es el dato que dice si sales de tu burbuja.
function renderNotesReach(analytics) {
  const surfaces = renderStackedBar(
    $("#notes-surfaces-bar"),
    $("#notes-surfaces-legend"),
    NOTE_SURFACE_LABELS.map(([key, apiKey, label]) => [key, label, analytics.surfaces?.[apiKey] || 0]),
    "Ninguna nota del periodo tiene desglose de superficies.",
  );
  const audience = renderStackedBar(
    $("#notes-audience-bar"),
    $("#notes-audience-legend"),
    NOTE_AUDIENCE_LABELS.map(([key, apiKey, label]) => [key, label, analytics.audience?.[apiKey] || 0]),
    "Ninguna nota del periodo tiene desglose de audiencia.",
  );
  // Qué superficie convierte, no cuál da más alcance. El reparto de altas es
  // PROPORCIONAL a las impresiones de cada superficie, porque Substack solo da
  // las altas de la nota entera: por eso el copy dice "estimadas".
  const rendimiento = getSurfaceYield(analytics.ranked);
  const etiqueta = new Map(NOTE_SURFACE_LABELS.map(([, apiKey, label]) => [apiKey, label]));
  renderRankedList(
    $("#notes-surface-yield"),
    rendimiento.rows.filter((row) => row.per1000 !== null).map((row) => ({
      label: etiqueta.get(row.surface) || row.surface,
      value: row.per1000,
      display: `${decimal(row.per1000, 2)} / 1.000`,
      muted: row.impressions < 500,
    })),
    "Ninguna nota del periodo tiene impresiones por superficie.",
  );

  const burbuja = getReachBeyondBubble(analytics.ranked);
  const note = $("#notes-reach-note");
  // Estos desgloses solo existen en las notas con detalle: hay que decir sobre
  // cuántas de cuántas se está sumando, no dar el total como si fuera de todas.
  const partes = [];
  if ((surfaces || audience) && analytics.ranked.length) {
    partes.push(`Sumado sobre ${analytics.detailedCount} de ${analytics.ranked.length} notas: las que no tienen estadísticas quedan fuera, no cuentan como cero.`);
  }
  if (burbuja.share !== null) {
    partes.push(`El ${formatPercent(burbuja.share)} de tus impresiones llega a gente que no te sigue ni te lee.`);
  }
  if (rendimiento.rows.length) {
    partes.push("Las altas por superficie se reparten en proporción a sus impresiones: Substack solo atribuye altas a la nota entera, así que son estimadas.");
  }
  note.textContent = partes.join(" ");
  note.hidden = !partes.length;
}

function renderCadenceTable(content) {
  renderCadenceHeatmap($("#cadence-heatmap"), content?.cadence);
  const busiest = content?.cadence?.busiestBucket;
  $("#cadence-summary").textContent = busiest
    ? `${DAY_NAMES[busiest.day]} · ${HOUR_BUCKET_LABELS[busiest.bucket]}`
    : "Sin notas fechadas";
  const body = $("#cadence-table-body");
  body.replaceChildren();
  const weeks = (content?.timeline?.weeks || []).slice(-12).reverse();
  if (!weeks.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5; cell.textContent = "Sin semanas con notas fechadas.";
    row.append(cell); body.append(row); return;
  }
  const max = Math.max(1, ...weeks.map((week) => week.notes));
  weeks.forEach((week) => {
    const row = document.createElement("tr");
    const average = week.scoredNotes ? week.interactions / week.scoredNotes : 0;
    const values = [shortDate(week.weekStart), week.notes, `${week.scoredNotes}/${week.notes}`, week.interactions, average];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 1) {
        const number = document.createElement("strong"); number.textContent = formatCompactNumber(value);
        const bar = document.createElement("i"); bar.className = "weekly-volume-bar"; bar.style.width = `${(value / max) * 100}%`;
        cell.append(number, bar);
      } else if (index >= 3) cell.textContent = index === 4 ? decimal(value) : formatCompactNumber(value);
      else cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
}

// El puente entre el esfuerzo en Notes y el crecimiento: altas que Substack
// atribuye a cada nota, por día. Solo suman las notas con detalle; las demás
// quedan fuera de la serie (no aportan cero) y la cobertura lo declara.
function renderAttribution(content) {
  const attribution = content?.attribution;
  const daily = attribution?.daily || [];
  const serie = fillDailyGaps(daily, (date) => ({ date, freeSubscribers: 0, impressions: 0, interactions: 0, notes: 0 }));
  const drawn = drawBarChart(
    $("#attribution-chart"),
    serie.map((point) => ({ date: point.date, value: point.freeSubscribers })),
    { primaryLabel: "Altas atribuidas" },
  );
  $("#attribution-empty").hidden = drawn;
  $("#attribution-coverage").textContent = attribution && attribution.totalNotes
    ? `${attribution.scoredNotes} de ${attribution.totalNotes} notas con detalle`
    : "Sin notas";
  $("#attribution-note").textContent = drawn
    ? `${formatCompactNumber(attribution.totals.freeSubscribers)} altas y ${formatCompactNumber(attribution.totals.impressions)} impresiones atribuidas a notas en ${rangeLabel()}. Las notas sin detalle no cuentan como cero: quedan fuera de la serie.`
    : "Substack solo atribuye altas a las notas con estadísticas de detalle.";
}

function renderNotesTable(snapshot) {
  const ranged = withinRange(snapshot.notes, (note) => note.date);
  state.rangeExcluded.notes = ranged.excluded;
  const analytics = getNotesAnalytics({ notes: ranged.kept });
  const search = state.notesSearch.trim().toLocaleLowerCase("es");
  const notes = analytics.ranked.filter((note) => !search || String(note.body || "").toLocaleLowerCase("es").includes(search));
  // Órdenes con valores nulos al final: una nota sin detalle no puede competir
  // en conversión ni en altas como si tuviera un 0 medido.
  const dateDesc = (a, b) => parseDay(b.date || 0) - parseDay(a.date || 0);
  const nullsLast = (getter) => (a, b) => {
    const left = getter(a), right = getter(b);
    if (left === null && right === null) return dateDesc(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || dateDesc(a, b);
  };
  const comparators = {
    date: dateDesc,
    interactions: (a, b) => b.analytics.interactions.total - a.analytics.interactions.total || dateDesc(a, b),
    conversion: nullsLast(noteConversion),
    subscribers: nullsLast((note) => (note.detailed ? note.analytics.results.freeSubscribers : null)),
  };
  notes.sort(comparators[state.notesSort] || comparators.interactions);
  const body = $("#notes-table-body");
  body.replaceChildren();
  if (!notes.length) {
    const row = document.createElement("tr"); const cell = document.createElement("td");
    cell.colSpan = 10; cell.textContent = search ? "Ninguna nota coincide con la búsqueda." : `No hay notas en ${rangeLabel()}.`;
    row.append(cell); body.append(row); return;
  }
  notes.forEach((note) => {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    const titleNode = note.url ? document.createElement("a") : document.createElement("span");
    titleNode.textContent = note.body || "Nota sin texto";
    if (note.url) { titleNode.href = note.url; titleNode.target = "_blank"; titleNode.rel = "noreferrer"; }
    title.append(titleNode); row.append(title);
    const interactions = note.analytics.interactions;
    const results = note.analytics.results;
    // Sin detalle no hay medición: impresiones, ratio y altas van en "—" con el
    // estado real de la captura, no en un 0 que parecería una nota sin alcance.
    const detailed = note.detailed;
    const stateCopy = NOTE_STATE_COPY[note.stats?.fetchState] || NOTE_STATE_COPY.pending;
    const impressions = detailed ? note.analytics.reach.impressions : null;
    const engagementRatio = detailed && impressions > 0 ? (interactions.total / impressions) * 100 : null;
    const conversion = noteConversion(note);
    [
      shortDate(note.date),
      formatCompactNumber(interactions.likes),
      formatCompactNumber(interactions.replies),
      formatCompactNumber(interactions.restacks),
      formatCompactNumber(interactions.total),
      impressions === null ? "—" : formatCompactNumber(impressions),
      engagementRatio === null ? "—" : formatPercent(engagementRatio),
      conversion === null ? "—" : decimal(conversion),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === "—" && !detailed) cell.title = stateCopy;
      row.append(cell);
    });
    const subscribers = document.createElement("td");
    if (!detailed) {
      subscribers.textContent = "—";
      subscribers.title = stateCopy;
    } else {
      const free = document.createElement("span");
      free.textContent = formatCompactNumber(results.freeSubscribers);
      subscribers.append(free);
      if (state.sensitive.paid && results.paidSubscribers) {
        const paid = document.createElement("span");
        paid.dataset.sensitive = "paid";
        paid.textContent = ` + ${formatCompactNumber(results.paidSubscribers)}`;
        subscribers.append(paid);
      }
    }
    row.append(subscribers);
    body.append(row);
  });
}

const VIEW_RENDERERS = {
  resumen: (snapshot) => { renderMetrics(snapshot, state.analytics); renderChart(snapshot, state.analytics); renderSummaryContent(snapshot); },
  audiencia: (snapshot) => renderAudience(snapshot, state.analytics),
  crecimiento: (snapshot) => renderGrowth(snapshot, state.analytics),
  notas: (snapshot) => {
    const rangedNotes = withinRange(snapshot.notes, (note) => note.date).kept;
    const rangedContent = getContentAnalytics({ ...snapshot, notes: rangedNotes }, { timeZoneOffsetMinutes: timezoneOffset(), primaryOutcome: "interactions" });
    renderNotesOverview(snapshot); renderCadenceTable(rangedContent); renderAttribution(rangedContent); renderNotesTable(snapshot);
  },
  publicaciones: (snapshot) => { renderCampaigns(snapshot); },
  cobertura: (snapshot) => renderCoverage(state.analytics, snapshot),
};

function syncRangeButtons() {
  const active = state.days === ALL_TIME ? "all" : String(state.days);
  $$("[data-days]").forEach((button) => button.classList.toggle("is-active", button.dataset.days === active));
}

function setView(view) {
  state.view = VIEWS.includes(view) ? view : "resumen";
  localStorage.setItem(VIEW_KEY, state.view);
  $$(".view").forEach((section) => { section.hidden = section.dataset.view !== state.view; });
  $$(".nav-item[data-view]").forEach((item) => {
    const active = item.dataset.view === state.view;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $("#range-control").hidden = !RANGE_AWARE_VIEWS.has(state.view);
  renderDashboard();
}

function renderDashboard() {
  if (!state.snapshot) return;
  // `state.snapshot` ya se guarda normalizado en cada punto de entrada (arranque,
  // sync y `storage.onChanged`). Volver a normalizarlo aquí recorría campañas y
  // notas otra vez en cada clic de rango, y los seis helpers de abajo lo
  // repetían por su cuenta.
  const snapshot = state.snapshot;
  // El análisis de contenido lo calcula solo la vista Notas, con su rango.
  // Calcularlo aquí para todas las vistas era trabajo doble sin consumidor.
  $("#source-name").textContent = snapshot.publication;
  const version = chrome.runtime.getManifest?.().version;
  $("#last-updated").textContent = `${version ? `PlotStack v${version} · ` : ""}Sincronizado ${new Date(snapshot.capturedAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`;
  (VIEW_RENDERERS[state.view] || VIEW_RENDERERS.resumen)(snapshot);
  applyPrivacy();
}

function renderSummaryContent(snapshot) {
  const posts = getPublicationEngagement(snapshot, state.days);
  const notes = getNotesEngagement(snapshot, state.days);
  $$(".summary-period-label").forEach((node) => { node.textContent = rangeLabel(); });
  [
    ["#summary-posts-count", posts.posts],
    ["#summary-posts-interactions", posts.interactions],
    ["#summary-posts-reactions", posts.reactions],
    ["#summary-posts-comments", posts.comments],
    ["#summary-posts-shares", posts.shares],
    ["#summary-posts-views", posts.views],
    ["#summary-notes-count", notes.notes],
    ["#summary-notes-interactions", notes.interactions],
    ["#summary-notes-likes", notes.likes],
    ["#summary-notes-comments", notes.comments],
    ["#summary-notes-restacks", notes.restacks],
    ["#summary-notes-impressions", notes.impressions],
  ].forEach(([selector, value]) => { $(selector).textContent = formatCompactNumber(value); });
}

function applyPrivacy() {
  applySensitiveVisibility(document, state.sensitive);
  $("#show-paid").checked = state.sensitive.paid;
  $("#show-revenue").checked = state.sensitive.revenue;
  document.documentElement.dataset.hasSensitiveMetrics = String(
    state.sensitive.paid || state.sensitive.revenue,
  );
}

const CAPTURE_CARD_CLASSES = ["metric-card", "panel", "note-card"];

export function findCaptureCard(element) {
  for (let node = element; node && node !== document.body; node = node.parentNode) {
    if (CAPTURE_CARD_CLASSES.some((name) => node.classList?.contains(name))) return node;
  }
  return null;
}

const captureLabel = (element) => {
  for (const selector of ["h2", ".card-label", ".note-body"]) {
    const text = element.querySelector(selector)?.textContent?.trim();
    if (text) return text.slice(0, 60);
  }
  return "tarjeta";
};

const closeCaptureMenu = () => {
  $("#capture-menu").hidden = true;
  $("#capture-button").setAttribute("aria-expanded", "false");
};

function cancelCardCapture(announce = false) {
  if (!state.captureCardDestination) return;
  state.captureCardDestination = null;
  document.documentElement.classList.remove("is-selecting-capture-card");
  if (announce) showToast("Selección de tarjeta cancelada.");
}

export function beginCardCapture(destination) {
  state.captureCardDestination = destination;
  closeCaptureMenu();
  document.documentElement.classList.add("is-selecting-capture-card");
  showToast("Elige una tarjeta. Pulsa Escape para cancelar.");
}

export async function runCapture({ target, destination, label = "" }) {
  if (state.capturing) return;
  const button = $("#capture-button");
  button.disabled = true;
  closeCaptureMenu();
  $("#privacy-menu").hidden = true;
  $("#privacy-button").setAttribute("aria-expanded", "false");
  state.capturing = true;
  try {
    const blob = await captureElementPng(target, { theme: document.documentElement.dataset.theme || "ink" });
    const day = new Date().toISOString().slice(0, 10);
    const publication = state.connection?.publication?.subdomain || "dashboard";
    const filename = captureFilename(publication, state.view, day, label);
    if (destination === "copy") await copyPngToClipboard(blob);
    else await downloadPng(blob, filename);
    showToast(destination === "copy"
      ? "Captura copiada al portapapeles sin datos sensibles."
      : "Captura guardada sin datos sensibles.");
  } catch (error) {
    showToast(error.message || "No se pudo completar la captura.");
  } finally {
    state.capturing = false;
    button.disabled = false;
  }
}

// La sincronización responde al terminar la fase rápida: el dashboard pinta ya
// y el detalle por publicación y por nota sigue en el service worker. El
// resultado de esa segunda fase llega por `chrome.storage.onChanged`, no
// esperando aquí, porque puede tardar minutos con un historial largo.
async function sync() {
  const button = $("#sync-button");
  button.disabled = true;
  button.classList.add("is-loading");
  try {
    const response = await sendMessage("PLOTSTACK_SYNC");
    if (!response.ok) throw new Error(response.error);
    state.snapshot = normalizeSnapshot(response.snapshot);
    state.connection = response.connection;
    state.analytics = response.analytics || null;
    renderDashboard();
    if (!response.detailPending) showToast("Datos actualizados desde Substack.");
  } catch (error) {
    showToast(error.message || "No se pudo sincronizar.");
    button.disabled = false;
    button.classList.remove("is-loading");
    return;
  }
  // Con detalle pendiente, el botón lo reactiva `renderProgress` al ver la fase
  // final: reactivarlo aquí invitaría a lanzar otra sincronización encima.
  if (!state.progress || state.progress.phase === "done" || state.progress.phase === "error") {
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

const PROGRESS_ACTIVE = new Set(["core", "detail"]);

// Estado visible de la sincronización. Sin esto, una primera carga con cientos
// de notas dejaba el icono girando sin decir en qué iba ni cuánto quedaba.
function renderProgress() {
  const progress = state.progress;
  const label = $("#sync-progress");
  const button = $("#sync-button");
  const active = PROGRESS_ACTIVE.has(progress?.phase);
  button.disabled = active;
  button.classList.toggle("is-loading", active);
  $("#sync-label").textContent = active ? "Sincronizando" : "Sincronizar";
  if (!progress || progress.phase === "done") {
    label.hidden = true;
    label.textContent = "";
    label.classList.remove("is-error");
    return;
  }
  label.hidden = false;
  label.classList.toggle("is-error", progress.phase === "error");
  if (progress.phase === "error") {
    label.textContent = progress.error || "La sincronización no terminó.";
    return;
  }
  const { done = 0, total = 0 } = progress.detail || {};
  // El contador solo aparece cuando hay un total real: "0/0" no informa de nada.
  label.textContent = total > 0 ? `${progress.step} ${done}/${total}` : progress.step;
}

// Actualización en vivo: la fase de detalle escribe el snapshot desde el service
// worker, así que el dashboard tiene que repintarse sin que el usuario toque
// nada. Se re-renderiza la vista activa; los nodos con listeners no se recrean.
function onStorageChanged(changes, area) {
  if (area && area !== "local") return;
  let repintar = false;
  if (changes?.[SNAPSHOT_KEY]?.newValue) {
    state.snapshot = normalizeSnapshot(changes[SNAPSHOT_KEY].newValue);
    repintar = true;
  }
  if (changes?.[ANALYTICS_KEY]?.newValue) {
    state.analytics = changes[ANALYTICS_KEY].newValue;
    repintar = true;
  }
  if (changes?.[PROGRESS_KEY]) {
    const anterior = state.progress?.phase;
    state.progress = changes[PROGRESS_KEY].newValue || null;
    renderProgress();
    if (anterior === "detail" && state.progress?.phase === "done") showToast("Datos actualizados desde Substack.");
    if (state.progress?.phase === "error" && anterior) showToast(state.progress.error || "La sincronización no terminó.");
  }
  if (repintar && state.snapshot) renderDashboard();
}

function downloadCsv(rows, filename) {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const blob = new Blob(["﻿" + rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// El botón exporta lo que la vista activa está mostrando: notas en Notas,
// publicaciones en el resto.
function exportCsv() {
  if (state.view === "notas") return exportNotesCsv();
  if (!state.snapshot?.campaigns.length) return showToast("No hay publicaciones para exportar.");
  // Mismas columnas que la tabla mas las que tienen dato aunque no se muestren.
  // Fuera downloads/video/estimatedValue/subscribes: siempre cero en la API.
  const CSV_COLUMNS = [
    ["Publicación", "title"], ["Slug", "slug"], ["Fecha", "date"], ["Tipo", "type"],
    ["Enviados", "sent"], ["Entregados", "delivered"], ["Aperturas", "opens"],
    ["Abrieron", "opened"], ["Open rate", "openRate"], ["Clics", "clicks"],
    ["Clickers", "clicked"], ["CTR", "clickRate"], ["CTOR", "ctor"],
    ["Engagement", "engagementRate"],
    ["Vistas", "views"], ["Reacciones", "reactions"], ["Comentarios", "comments"],
    ["Shares", "shares"], ["Altas", "signups"], ["Altas D1", "signupsWithin1Day"],
  ];
  const campaigns = withCtor(state.snapshot.campaigns);
  const rows = [CSV_COLUMNS.map(([label]) => label), ...campaigns.map((item) => CSV_COLUMNS.map(([, key]) => item[key]))];
  downloadCsv(rows, `plotstack-${state.connection?.publication?.subdomain || "metricas"}.csv`);
}

// Ausencia = celda vacía, nunca un 0: una nota sin detalle no midió nada.
function exportNotesCsv() {
  const notes = state.snapshot.notes;
  if (!notes.length) return showToast("No hay notas para exportar.");
  const header = ["Nota", "Fecha", "Likes", "Comentarios", "Restacks", "Interacciones", "Impresiones", "Ratio interacción (%)", "Altas gratuitas", "Estado detalle"];
  const rows = [header, ...notes.map((note) => {
    const detailed = Boolean(note.stats?.available);
    const interactions = detailed
      ? note.stats.interactions.total
      : note.reactions + note.replies + note.restacks;
    const impressions = detailed ? note.stats.reach.impressions : "";
    const engagementRatio = detailed && note.stats.reach.impressions > 0
      ? Math.round((note.stats.interactions.total / note.stats.reach.impressions) * 10000) / 100
      : "";
    return [
      note.body,
      note.date ? String(note.date).slice(0, 10) : "",
      detailed ? note.stats.interactions.likes : note.reactions,
      detailed ? note.stats.interactions.replies : note.replies,
      detailed ? note.stats.interactions.restacks : note.restacks,
      interactions,
      impressions,
      engagementRatio,
      detailed ? note.stats.results.freeSubscribers : "",
      note.stats?.fetchState || "pending",
    ];
  })];
  downloadCsv(rows, `plotstack-notas-${state.connection?.publication?.subdomain || "metricas"}.csv`);
}

async function disconnect() {
  if (!confirm("¿Desconectar esta publicación y borrar sus métricas guardadas en Chrome?")) return;
  await sendMessage("PLOTSTACK_DISCONNECT");
  state.snapshot = null;
  state.connection = null;
  state.analytics = null;
  showOnboarding();
}

function bindEvents() {
  $("#connect-button").addEventListener("click", connect);
  $("#login-button").addEventListener("click", async () => {
    await sendMessage("PLOTSTACK_OPEN_LOGIN");
    setConnectionStatus("Inicia sesión en la pestaña nueva y vuelve aquí para conectar.");
  });
  $("#sync-button").addEventListener("click", sync);
  $("#disconnect-button").addEventListener("click", disconnect);
  $("#export-button").addEventListener("click", exportCsv);
  $("#capture-button").addEventListener("click", () => {
    const menu = $("#capture-menu");
    menu.hidden = !menu.hidden;
    $("#capture-button").setAttribute("aria-expanded", String(!menu.hidden));
    $("#privacy-menu").hidden = true;
    $("#privacy-button").setAttribute("aria-expanded", "false");
  });
  $$('[data-capture-action]').forEach((button) => button.addEventListener("click", () => {
    const [destination, targetKind] = button.dataset.captureAction.split("-");
    if (targetKind === "card") beginCardCapture(destination);
    else {
      closeCaptureMenu();
      void runCapture({ target: $("#overview"), destination });
    }
  }));
  $("#privacy-button").addEventListener("click", () => {
    const menu = $("#privacy-menu");
    menu.hidden = !menu.hidden;
    $("#privacy-button").setAttribute("aria-expanded", String(!menu.hidden));
  });
  [["#show-paid", "paid"], ["#show-revenue", "revenue"]].forEach(([selector, kind]) => {
    $(selector).addEventListener("change", (event) => {
      state.sensitive[kind] = event.target.checked;
      writeSensitivePreference(localStorage, kind, event.target.checked);
      renderDashboard();
    });
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".privacy-control")) return;
    $("#privacy-menu").hidden = true;
    $("#privacy-button").setAttribute("aria-expanded", "false");
  });
  document.addEventListener("click", (event) => {
    if (!state.captureCardDestination) return;
    const card = findCaptureCard(event.target);
    if (!card) {
      cancelCardCapture(true);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const destination = state.captureCardDestination;
    cancelCardCapture();
    void runCapture({ target: card, destination, label: captureLabel(card) });
  }, true);
  document.addEventListener("click", (event) => {
    if (event.target.closest(".capture-control")) return;
    closeCaptureMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cancelCardCapture(true);
  });
  $("#theme-button").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "ink" ? "paper" : "ink";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("plotstack.theme", theme);
  });
  $("#notes-search").addEventListener("input", (event) => {
    state.notesSearch = event.target.value;
    renderNotesTable(state.snapshot);
  });
  $("#notes-sort").addEventListener("change", (event) => {
    state.notesSort = event.target.value;
    renderNotesTable(state.snapshot);
  });
  $("#posts-search").addEventListener("input", (event) => {
    state.postsSearch = event.target.value;
    renderCampaigns(state.snapshot);
  });
  $$("[data-days]").forEach((button) => button.addEventListener("click", () => {
    state.days = button.dataset.days === "all" ? ALL_TIME : Number(button.dataset.days);
    localStorage.setItem(RANGE_KEY, button.dataset.days);
    syncRangeButtons();
    renderDashboard();
  }));
  $$(".nav-item[data-view]").forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
  // Resumen deja de ser un muro de cifras: cada KPI entra en su vista.
  $$("[data-goto]").forEach((card) => {
    card.addEventListener("click", () => setView(card.dataset.goto));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setView(card.dataset.goto);
    });
  });
}

async function initialize() {
  const manifestVersion = chrome.runtime.getManifest?.().version;
  if (manifestVersion) $("#app-version").textContent = `v${manifestVersion}`;
  document.documentElement.dataset.theme = localStorage.getItem("plotstack.theme") || "ink";
  state.sensitive = readSensitivePreferences(localStorage);
  state.view = VIEWS.includes(localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : "resumen";
  const storedRange = localStorage.getItem(RANGE_KEY);
  if (storedRange === "all") state.days = ALL_TIME;
  else if (storedRange && Number.isFinite(Number(storedRange))) state.days = Number(storedRange);
  bindEvents();
  syncRangeButtons();
  // El service worker sigue sincronizando aunque el dashboard estuviera
  // cerrado, así que hay que engancharse a sus cambios antes de leer nada.
  chrome.storage.onChanged?.addListener(onStorageChanged);
  const stored = await chrome.storage.local.get([SNAPSHOT_KEY, CONNECTION_KEY, ANALYTICS_KEY, PROGRESS_KEY]);
  if (stored[SNAPSHOT_KEY] && stored[CONNECTION_KEY]) {
    state.snapshot = normalizeSnapshot(stored[SNAPSHOT_KEY]);
    state.connection = stored[CONNECTION_KEY];
    state.analytics = stored[ANALYTICS_KEY] || null;
    state.progress = stored[PROGRESS_KEY] || null;
    $("#onboarding").hidden = true;
    $("#dashboard-shell").hidden = false;
    setView(state.view);
    renderProgress();
  } else showOnboarding();
}

initialize();
