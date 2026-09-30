// Hallazgos: la capa que elige qué merece leerse del snapshot y lo escribe en
// una frase. Módulo puro: sin DOM, sin red y sin persistencia. Todo sale del
// snapshot y del análisis ya sincronizados, recortado al rango activo.
//
// Reglas que comparten todos los detectores:
// - Cada pieza se compara contra TI MISMO: sus 30 anteriores (base móvil). Con
//   una base global, las notas antiguas saldrían "por debajo" solo porque la
//   cuenta era más pequeña.
// - Estadística robusta (mediana y MAD sobre log1p): una nota viral no mueve la
//   base. El umbral es de producto, no una prueba de significación.
// - Un hallazgo que no supera su umbral NO se muestra atenuado: calla. Si el
//   detector aplica pero le falta muestra, deja una línea en `silent`.
// - Ningún detector toca pago ni ingresos: la captura PNG es segura sin trucos.
// - `null` nunca es `0`, y todo cociente pasa por `ratio()`.

import {
  formatCompactNumber,
  formatPercent,
  getCampaignCuts,
  getCampaignSections,
  getConcentration,
  getLoyalCore,
  getMilestoneProjection,
  getReachBeyondBubble,
  getRecords,
  MIN_CUT_N,
  NO_SECTION,
  normalizeSnapshot,
  parseDay,
  ratio,
  safeNumber,
  sourceLabel,
} from "./analytics.js";
import { getFeatureInsights } from "./content-analytics.js";
import { LOCALE, t, tn } from "./i18n.js";

export const BASELINE_WINDOW = 30;
export const BASELINE_MIN = 10;
export const OUTLIER_Z = 2;
// Umbrales de producto heredados del Resumen anterior: por debajo, no se nombra
// una fuente principal.
export const LEADER_MIN_SIGNUPS = 10;
export const LEADER_MIN_SHARE = 0.3;
// Un rasgo de nota solo se enuncia con muestra holgada en los dos lados y un
// efecto grande. El análisis por medianas se retiró precisamente por pintar
// diferencias pequeñas con pocas notas.
export const TRAIT_MIN_N = 8;
export const TRAIT_MIN_LIFT = 1.5;
// Un corte de envíos se enuncia desde 3 puntos de apertura de diferencia.
export const CUT_MIN_POINTS = 3;
export const GROUPS = ["audiencia", "crecimiento", "notas", "publicaciones"];

const MAD_SCALE = 1.4826;
const DAY_MS = 86400000;
const DAY_NAMES = [t("domingo"), t("lunes"), t("martes"), t("miércoles"), t("jueves"), t("viernes"), t("sábado")];
// Relleno de una nota sin cuerpo, guardado en el idioma del navegador al
// sincronizar: se reconocen los dos.
const PLACEHOLDER_BODIES = new Set(["Nota sin texto", t("Nota sin texto")]);

// ── Núcleo estadístico ─────────────────────────────────────────────────────

const logOf = (value) => Math.log1p(Math.max(0, value));

const medianOf = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const quantile = (sorted, q) => {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};

// Base robusta de una serie: mediana y MAD en escala log1p. `null` con menos de
// BASELINE_MIN valores: comparar contra tres notas no es "lo habitual".
export function robustBaseline(values = []) {
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (finite.length < BASELINE_MIN) return null;
  const logs = finite.map(logOf);
  const logMedian = medianOf(logs);
  const mad = medianOf(logs.map((value) => Math.abs(value - logMedian)));
  return { n: finite.length, median: Math.expm1(logMedian), logMedian, mad };
}

// Cuántas "desviaciones robustas" se aleja un valor de su base. `null` sin base
// o con MAD = 0 (todas las piezas iguales): ahí no hay escala para clasificar.
export function robustZ(value, baseline) {
  if (!baseline || !(baseline.mad > 0) || !Number.isFinite(value)) return null;
  const z = (logOf(value) - baseline.logMedian) / (MAD_SCALE * baseline.mad);
  return Number.isFinite(z) ? z : null;
}

// "Lo típico" para la tira de puntos: la mitad central (p25-p75). `null` con
// menos de cuatro valores.
export function typicalBand(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length < 4) return null;
  return [quantile(sorted, 0.25), quantile(sorted, 0.75)];
}

// Evalúa cada pieza del rango contra sus BASELINE_WINDOW anteriores con valor.
// `pieces` ya viene ordenado por fecha ascendente; `valueOf` devuelve `null`
// cuando la pieza no tiene medición (no entra ni como evaluada ni como base).
export function rollingOutliers(pieces, valueOf, isEvaluated) {
  const measured = pieces
    .map((piece) => ({ piece, value: valueOf(piece) }))
    .filter((row) => row.value !== null && Number.isFinite(row.value));
  const rows = [];
  measured.forEach((row, index) => {
    if (!isEvaluated(row.piece)) return;
    const window = measured.slice(Math.max(0, index - BASELINE_WINDOW), index).map((prior) => prior.value);
    const baseline = robustBaseline(window);
    rows.push({
      ...row,
      baseline,
      z: robustZ(row.value, baseline),
      multiple: baseline ? ratio(row.value, baseline.median) : null,
    });
  });
  return { rows, measured };
}

// ── Formato ────────────────────────────────────────────────────────────────

// Día y mes; el año solo si no es el actual ("4 mar 2027").
const shortDay = (value, now = Date.now()) => {
  const date = parseDay(value);
  if (!Number.isFinite(date.getTime())) return t("sin fecha");
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(LOCALE, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};

const times = (value) => `${value.toLocaleString(LOCALE, { maximumFractionDigits: value < 10 ? 1 : 0 })}×`;

// Marcador `{count}` ya formateado para `tn()`: el `{n}` de tn es el número crudo.
const counted = (count) => ({ count: formatCompactNumber(count) });

const excerptOf = (body, length = 90) => {
  const raw = String(body || "").trim();
  if (!raw || PLACEHOLDER_BODIES.has(raw)) return t("(nota sin texto)");
  const line = raw.replace(/https?:\/\/\S+/gi, "").split(/\n+/).map((part) => part.trim()).find(Boolean) || raw;
  return line.length > length ? `${line.slice(0, length - 1).trimEnd()}…` : line;
};

const noteScore = (note) => safeNumber(note.reactions) + safeNumber(note.replies) + safeNumber(note.restacks);

// Relevancia para ordenar: tamaño del efecto (log del múltiplo) por soporte.
// Criterio de producto, como EVIDENCE_MIN_N; solo decide el orden.
const scoreOf = (multiple, n, full = BASELINE_WINDOW) => {
  const effect = multiple > 0 ? Math.abs(Math.log(multiple)) : 0;
  return effect * Math.min(1, n / full);
};

// ── Detectores ─────────────────────────────────────────────────────────────
// Cada uno recibe el contexto y devuelve `{ insights, silent }`.

function stripFor(rows, highlightIds, unit, bandValues) {
  return {
    unit,
    band: typicalBand(bandValues),
    points: rows.map((row) => ({ id: row.piece.id, value: row.value, highlight: highlightIds.has(row.piece.id) })),
  };
}

// Notas fuera de lo habitual por interacciones públicas (me gusta, respuestas y
// restacks): existen para todas las notas, así que la cobertura es total. No se
// mezclan con las interacciones de detalle, que cuentan también visitas y clics.
function detectNoteOutliers(ctx) {
  const inRange = ctx.notes.filter((note) => ctx.inRange(note.date));
  if (!inRange.length) return {};
  const { rows, measured } = rollingOutliers(ctx.notes, noteScore, (note) => ctx.inRange(note.date));
  const evaluated = rows.filter((row) => row.z !== null);
  if (!evaluated.length) {
    return { silent: [{ group: "notas", text: t("Notas fuera de lo habitual: hacen falta al menos {n} notas para tener con qué comparar.", { n: BASELINE_MIN + 1 }) }] };
  }
  const winners = evaluated
    .filter((row) => row.z >= OUTLIER_Z && row.multiple >= 2 && row.value >= 3)
    .sort((a, b) => b.multiple - a.multiple);
  if (!winners.length) return {};
  const ids = new Set(winners.map((row) => row.piece.id));
  const recent = measured.slice(-BASELINE_WINDOW).map((row) => row.value);
  const top = winners[0];
  const text = winners.length === 1
    ? t("Tu nota del {date} tuvo {times} más interacciones que tu nota típica.", { date: shortDay(top.piece.date), times: times(top.multiple) })
    : t("{count} notas tuvieron bastantes más interacciones que tu nota típica; la mejor, {times}.", { count: winners.length, times: times(top.multiple) });
  return {
    insights: [{
      id: "note-outlier",
      group: "notas",
      text,
      sample: t("Me gusta, respuestas y restacks · cada nota frente a sus {n} anteriores", { n: BASELINE_WINDOW }),
      score: scoreOf(top.multiple, evaluated.length) + 0.2,
      strip: stripFor(evaluated, ids, t("interacciones"), recent),
      examples: winners.slice(0, 3).map((row) => ({ id: row.piece.id, excerpt: excerptOf(row.piece.body), date: row.piece.date })),
      action: null,
      target: { view: "notas", panel: "notes", noteIds: [...ids], label: tn(winners.length, "la nota del hallazgo", "{n} notas del hallazgo") },
    }],
  };
}

// Notas que convierten: altas por cada 1.000 impresiones. Solo notas con
// detalle; se exigen 3 altas para no coronar 1 alta sobre 40 impresiones.
function detectNoteConverters(ctx) {
  const detailed = ctx.notes.filter((note) => note.stats.available && note.stats.reach.impressions > 0);
  const inRange = detailed.filter((note) => ctx.inRange(note.date));
  if (!inRange.length) return {};
  const per1000 = (note) => {
    const value = ratio(note.stats.results.freeSubscribers, note.stats.reach.impressions);
    return value === null ? null : value * 1000;
  };
  const { rows, measured } = rollingOutliers(detailed, per1000, (note) => ctx.inRange(note.date));
  const evaluated = rows.filter((row) => row.z !== null);
  if (!evaluated.length) {
    return { silent: [{ group: "notas", text: t("Conversión de tus notas: hacen falta al menos {n} notas con estadísticas de Substack.", { n: BASELINE_MIN + 1 }) }] };
  }
  const winners = evaluated
    .filter((row) => row.z >= OUTLIER_Z && row.multiple >= 2 && row.piece.stats.results.freeSubscribers >= 3)
    .sort((a, b) => b.multiple - a.multiple);
  if (!winners.length) return {};
  const ids = new Set(winners.map((row) => row.piece.id));
  const top = winners[0];
  const rate = top.value.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
  const text = winners.length === 1
    ? t("Tu nota del {date} convirtió {times} más que tu nota típica: {rate} altas por cada 1.000 impresiones.", { date: shortDay(top.piece.date), times: times(top.multiple), rate })
    : t("{count} notas convirtieron bastante más que tu nota típica; la mejor, {times} ({rate} altas por cada 1.000 impresiones).", { count: winners.length, times: times(top.multiple), rate });
  return {
    insights: [{
      id: "note-converter",
      group: "notas",
      text,
      sample: t("Altas por cada 1.000 impresiones · solo notas con estadísticas de Substack"),
      score: scoreOf(top.multiple, evaluated.length) + 0.4,
      strip: stripFor(evaluated, ids, t("altas por 1.000 impresiones"), measured.slice(-BASELINE_WINDOW).map((row) => row.value)),
      examples: winners.slice(0, 3).map((row) => ({ id: row.piece.id, excerpt: excerptOf(row.piece.body), date: row.piece.date })),
      action: t("Prueba: reutiliza el enfoque de esa nota en tus próximas notas y compara su conversión."),
      target: { view: "notas", panel: "notes", noteIds: [...ids], label: tn(winners.length, "la nota del hallazgo", "{n} notas del hallazgo") },
    }],
  };
}

// Rasgos que dependen de la escritura, no del calendario (el calendario ya lo
// cuenta el mapa de Cuándo publicas). Frases escritas a mano: ninguna clave
// cruda llega a la interfaz.
// Frases completas por rasgo: el orden de palabras cambia entre idiomas.
const TRAIT_COPY = {
  hookIsQuestion: {
    text: (vars) => t("Tus notas que abren con una pregunta reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: abre con pregunta tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  endsWithQuestion: {
    text: (vars) => t("Tus notas que terminan en pregunta reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: cierra con pregunta tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  hasLink: {
    text: (vars) => t("Tus notas con un enlace reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: incluye un enlace en tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  hasMention: {
    text: (vars) => t("Tus notas que mencionan a alguien reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: menciona a alguien en tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  hasNumber: {
    text: (vars) => t("Tus notas con alguna cifra reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: incluye una cifra en tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  hasList: {
    text: (vars) => t("Tus notas con una lista reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: usa una lista en tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  hasQuote: {
    text: (vars) => t("Tus notas con una cita reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: incluye una cita en tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  hasEmoji: {
    text: (vars) => t("Tus notas con emojis reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: usa emojis en tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
  isSelfRestack: {
    text: (vars) => t("Tus notas que enlazan a tu propia publicación reciben {times} más interacciones que el resto.", vars),
    action: t("Prueba: enlaza a tu publicación en tus próximas 5 notas. PlotStack te dirá si se mantiene."),
  },
};

const LENGTH_COPY = {
  short: (vars) => t("Tus notas cortas reciben {times} más interacciones que el resto.", vars),
  medium: (vars) => t("Tus notas de longitud media reciben {times} más interacciones que el resto.", vars),
  long: (vars) => t("Tus notas largas reciben {times} más interacciones que el resto.", vars),
};

function detectNoteTraits(ctx) {
  const inRange = ctx.notes.filter((note) => ctx.inRange(note.date));
  if (!inRange.length) return {};
  const insights = getFeatureInsights({ ...ctx.snapshot, notes: inRange }, { timeZoneOffsetMinutes: ctx.timeZoneOffsetMinutes });
  if (insights.coverage.scoredNotes < TRAIT_MIN_N * 2) {
    return { silent: [{ group: "notas", text: t("Qué rasgos de tus notas rinden más: hacen falta al menos {n} notas con estadísticas de Substack en {range}.", { n: TRAIT_MIN_N * 2, range: ctx.rangeLabel }) }] };
  }
  const candidates = insights.features
    .filter((feature) => (feature.kind === "flag" ? TRAIT_COPY[feature.id] : feature.id === "lengthBand"))
    .filter((feature) => feature.counts.withScored >= TRAIT_MIN_N && feature.counts.withoutScored >= TRAIT_MIN_N)
    .map((feature) => ({ feature, cell: feature.outcomes.interactions }))
    .filter(({ cell }) => cell.liftBasis === "median" && cell.lift >= TRAIT_MIN_LIFT)
    .sort((a, b) => b.cell.lift - a.cell.lift)
    .slice(0, 2);
  const byId = new Map(inRange.map((note) => [note.id, note]));
  return {
    insights: candidates.map(({ feature, cell }) => {
      const vars = { times: times(cell.lift) };
      const text = feature.kind === "flag" ? TRAIT_COPY[feature.id].text(vars) : LENGTH_COPY[feature.level](vars);
      const action = feature.kind === "flag" ? TRAIT_COPY[feature.id].action : null;
      return {
        id: `note-trait:${feature.id}:${feature.level}`,
        group: "notas",
        text,
        sample: t("{with} con el rasgo · {without} sin él · mediana de cada grupo", {
          with: tn(feature.counts.withScored, "{count} nota", "{count} notas", counted(feature.counts.withScored)),
          without: tn(feature.counts.withoutScored, "{count} nota", "{count} notas", counted(feature.counts.withoutScored)),
        }),
        score: scoreOf(cell.lift, Math.min(feature.counts.withScored, feature.counts.withoutScored), TRAIT_MIN_N * 2),
        strip: null,
        examples: feature.sampleIds.map((id) => byId.get(id)).filter(Boolean)
          .map((note) => ({ id: note.id, excerpt: excerptOf(note.body), date: note.date })),
        action,
        target: { view: "notas", panel: "notes", noteIds: feature.sampleIds, label: t("notas de ejemplo del hallazgo") },
      };
    }),
  };
}

function detectNoteConcentration(ctx) {
  const detailed = ctx.notes.filter((note) => note.stats.available && ctx.inRange(note.date));
  const withSignups = detailed.filter((note) => note.stats.results.freeSubscribers > 0);
  if (withSignups.length < 6) return {};
  const concentration = getConcentration(withSignups, (note) => note.stats.results.freeSubscribers, 3);
  if (concentration.share === null || concentration.share < 50) return {};
  const top = [...withSignups].sort((a, b) => b.stats.results.freeSubscribers - a.stats.results.freeSubscribers).slice(0, 3);
  return {
    insights: [{
      id: "note-concentration",
      group: "notas",
      text: t("3 notas trajeron el {share} de las altas que Substack atribuye a tus notas.", { share: formatPercent(concentration.share, 0) }),
      sample: t("{signups} altas repartidas en {notes}", {
        signups: formatCompactNumber(concentration.total),
        notes: tn(concentration.counted, "{count} nota", "{count} notas", counted(concentration.counted)),
      }),
      score: 0.5,
      strip: null,
      examples: top.map((note) => ({ id: note.id, excerpt: excerptOf(note.body), date: note.date })),
      action: null,
      target: { view: "notas", panel: "notes", noteIds: top.map((note) => note.id), label: t("las 3 notas del hallazgo") },
    }],
  };
}

function detectReachBeyondBubble(ctx) {
  const reach = getReachBeyondBubble(ctx.notes.filter((note) => ctx.inRange(note.date)));
  if (reach.share === null || reach.scoredNotes < 5) return {};
  return {
    insights: [{
      id: "note-reach",
      group: "notas",
      text: t("El {share} de las impresiones de tus notas llega a gente que aún no te sigue ni te lee.", { share: formatPercent(reach.share, 0) }),
      sample: tn(reach.scoredNotes, "{count} nota con estadísticas", "{count} notas con estadísticas", counted(reach.scoredNotes)),
      score: 0.2,
      strip: null,
      examples: [],
      action: null,
      target: { view: "notas", panel: "notes-audience-panel" },
    }],
  };
}

// Posts fuera de lo habitual por altas del primer día (la atribución de 24 h de
// Substack). Solo envíos: un post sin entregas no tiene esa ventana.
function detectPostOutliers(ctx) {
  const sent = ctx.campaigns.filter((campaign) => campaign.delivered > 0);
  const inRange = sent.filter((campaign) => ctx.inRange(campaign.date));
  if (!inRange.length) return {};
  const { rows, measured } = rollingOutliers(sent, (campaign) => campaign.signupsWithin1Day, (campaign) => ctx.inRange(campaign.date));
  const evaluated = rows.filter((row) => row.z !== null);
  if (!evaluated.length) {
    return { silent: [{ group: "publicaciones", text: t("Artículos fuera de lo habitual: hacen falta al menos {n} artículos enviados para tener con qué comparar.", { n: BASELINE_MIN + 1 }) }] };
  }
  const winners = evaluated
    .filter((row) => row.z >= OUTLIER_Z && row.multiple >= 2 && row.value >= 3)
    .sort((a, b) => b.multiple - a.multiple);
  if (!winners.length) return {};
  const top = winners[0];
  const ids = new Set(winners.map((row) => row.piece.id));
  return {
    insights: [{
      id: "post-outlier",
      group: "publicaciones",
      text: t("«{title}» trajo {times} más altas en su primer día que tu artículo típico ({signups} altas).", { title: top.piece.title, times: times(top.multiple), signups: formatCompactNumber(top.value) }),
      sample: t("Altas en las 24 h tras cada envío · cada envío frente a sus {n} anteriores", { n: BASELINE_WINDOW }),
      score: scoreOf(top.multiple, evaluated.length) + 0.3,
      strip: stripFor(evaluated, ids, t("altas en el primer día"), measured.slice(-BASELINE_WINDOW).map((row) => row.value)),
      examples: winners.slice(0, 3).map((row) => ({ id: row.piece.id, excerpt: row.piece.title, date: row.piece.date })),
      action: t("Prueba: vuelve sobre el tema o la promesa de ese envío en uno de los próximos."),
      target: { view: "publicaciones", panel: "campaigns" },
    }],
  };
}

// Día de la semana y sección que se abren más. Tasa ponderada contra el resto
// de envíos del rango, nunca media de tasas; los cortes `scarce` no compiten.
function detectPostCuts(ctx) {
  const ranged = ctx.campaigns.filter((campaign) => campaign.delivered > 0 && ctx.inRange(campaign.date));
  if (!ranged.length) return {};
  const weighted = (rows) => {
    const delivered = rows.reduce((sum, row) => sum + row.delivered, 0);
    const value = ratio(rows.reduce((sum, row) => sum + row.opened, 0), delivered);
    return value === null ? null : value * 100;
  };
  const insights = [];
  const silent = [];
  const days = getCampaignCuts(ranged).byDay.filter((cut) => !cut.scarce && cut.openRate !== null);
  if (days.length >= 2) {
    const best = days[0];
    const rest = weighted(ranged.filter((campaign) => parseDay(campaign.date).getDay() !== best.day));
    if (rest !== null && best.openRate - rest >= CUT_MIN_POINTS) {
      insights.push({
        id: `post-day:${best.day}`,
        group: "publicaciones",
        text: t("Tus envíos del {day} se abren más: {rate} frente al {rest} del resto.", { day: DAY_NAMES[best.day], rate: formatPercent(best.openRate, 0), rest: formatPercent(rest, 0) }),
        sample: tn(best.posts, "{count} envío ese día · apertura ponderada por entregas", "{count} envíos ese día · apertura ponderada por entregas", counted(best.posts)),
        score: 0.45,
        strip: null,
        examples: [],
        action: null,
        target: { view: "publicaciones", panel: "posts-by-day" },
      });
    }
  } else if (ranged.length >= 2) {
    silent.push({ group: "publicaciones", text: t("Mejor día de envío: hacen falta al menos {n} envíos en dos días distintos.", { n: MIN_CUT_N }) });
  }
  const sections = getCampaignSections(ranged).filter((cut) => !cut.scarce && cut.openRate !== null && cut.section !== NO_SECTION);
  if (sections.length >= 2) {
    const best = sections[0];
    const rest = weighted(ranged.filter((campaign) => (String(campaign.section || "").trim() || NO_SECTION) !== best.section));
    if (rest !== null && best.openRate - rest >= CUT_MIN_POINTS) {
      insights.push({
        id: `post-section:${best.section}`,
        group: "publicaciones",
        text: t("La sección «{section}» se abre más: {rate} frente al {rest} del resto.", { section: best.section, rate: formatPercent(best.openRate, 0), rest: formatPercent(rest, 0) }),
        sample: tn(best.posts, "{count} envío en la sección · apertura ponderada por entregas", "{count} envíos en la sección · apertura ponderada por entregas", counted(best.posts)),
        score: 0.4,
        strip: null,
        examples: [],
        action: null,
        target: { view: "publicaciones", panel: "posts-by-section" },
      });
    }
  }
  return { insights, silent };
}

// La fuente que lidera las altas del rango. Mismos umbrales que tenía el
// Resumen: con 2 altas, o con un reparto casi a partes iguales, señalarla sería
// inventarse una conclusión.
function detectSourceLeader(ctx) {
  const data = ctx.sourcesForRange;
  const sources = [...(data?.sources || [])]
    .filter((source) => safeNumber(source.subscribers) > 0)
    .sort((a, b) => safeNumber(b.subscribers) - safeNumber(a.subscribers));
  if (!sources.length) return {};
  const total = safeNumber(data?.totals?.subscribers);
  const leader = sources[0];
  const share = ratio(safeNumber(leader.subscribers), total);
  if (safeNumber(leader.subscribers) < LEADER_MIN_SIGNUPS || share === null || share < LEADER_MIN_SHARE) {
    return { silent: [{ group: "crecimiento", text: t("Fuente principal de altas: tus altas llegan repartidas o todavía son pocas para señalar una.") }] };
  }
  return {
    insights: [{
      id: "source-leader",
      group: "crecimiento",
      text: t("{source} es tu principal puerta de entrada: aporta el {share} de las altas atribuidas.", { source: sourceLabel(leader.label), share: formatPercent(share * 100, 0) }),
      sample: t("{count} altas con fuente atribuida", { count: formatCompactNumber(total) }),
      score: 0.7,
      strip: null,
      examples: [],
      action: null,
      target: { view: "crecimiento", panel: "growth-sources" },
    }],
  };
}

function detectBestWeek(ctx) {
  const records = getRecords({ snapshot: ctx.snapshot, subscriberDaily: ctx.subscriberDaily, days: ctx.days, now: ctx.now });
  if (!records.bestWeek || records.bestWeek.signups < 3) return {};
  return {
    insights: [{
      id: "best-week",
      group: "crecimiento",
      text: tn(records.bestWeek.signups, "Tu mejor semana fue la del {date}, con {count} alta.", "Tu mejor semana fue la del {date}, con {count} altas.", {
        date: shortDay(records.bestWeek.weekStart),
        ...counted(records.bestWeek.signups),
      }),
      sample: t("Semanas de {range}", { range: ctx.rangeLabel }),
      score: 0.3,
      strip: null,
      examples: [],
      action: null,
      target: { view: "crecimiento", panel: "records-panel" },
    }],
  };
}

// El hito no depende del rango: es una proyección y declara que es un rango.
function detectMilestone(ctx) {
  const projection = getMilestoneProjection({ current: ctx.snapshot.metrics.subscribers, growthDaily: ctx.growthDaily, now: ctx.now });
  if (projection.state !== "projected") return {};
  const dates = projection.estimates.map((row) => row.date).filter(Boolean).sort();
  // Dos estimaciones a menos de una semana son la misma fecha a efectos de
  // lectura: "entre el 4 y el 5 mar" es precisión fingida.
  const spread = (parseDay(dates.at(-1)).getTime() - parseDay(dates[0]).getTime()) / DAY_MS;
  const when = spread >= 7
    ? t("entre el {from} y el {to}", { from: shortDay(dates[0], ctx.now), to: shortDay(dates.at(-1), ctx.now) })
    : t("hacia el {date}", { date: shortDay(dates[0], ctx.now) });
  return {
    insights: [{
      id: "milestone",
      group: "crecimiento",
      text: t("A este ritmo llegarás a {target} suscriptores {when}.", { target: formatCompactNumber(projection.target), when }),
      sample: t("Altas menos bajas de los últimos 30 y 90 días · una estimación, no una promesa"),
      score: 0.25,
      strip: null,
      examples: [],
      action: null,
      target: { view: "crecimiento", panel: "records-panel" },
    }],
  };
}

function detectLoyalCore(ctx) {
  const loyal = getLoyalCore(ctx.analytics?.audience?.timeline, ctx.analytics?.audience?.loyaltyHistory || [], ctx.days, ctx.now);
  if (loyal.state !== "ready" || !loyal.core) return {};
  const readers = tn(loyal.core, "{count} lector", "{count} lectores", counted(loyal.core));
  const share = formatPercent(loyal.coreShare, 0);
  const text = loyal.change
    ? t("Tu núcleo fiel son {readers}, el {share} de tu lista ({change} desde el {date}).", {
        readers,
        share,
        change: `${loyal.change > 0 ? "+" : "−"}${formatCompactNumber(Math.abs(loyal.change))}`,
        date: shortDay(loyal.changeSince),
      })
    : t("Tu núcleo fiel son {readers}, el {share} de tu lista.", { readers, share });
  return {
    insights: [{
      id: "loyal-core",
      group: "audiencia",
      text,
      sample: t("Máxima puntuación de actividad de Substack: 5 de 5"),
      score: loyal.change ? 0.45 : 0.3,
      strip: null,
      examples: [],
      action: null,
      target: { view: "audiencia", panel: "loyal-panel" },
    }],
  };
}

const DETECTORS = [
  detectSourceLeader,
  detectBestWeek,
  detectMilestone,
  detectLoyalCore,
  detectNoteOutliers,
  detectNoteConverters,
  detectNoteTraits,
  detectNoteConcentration,
  detectReachBeyondBubble,
  detectPostOutliers,
  detectPostCuts,
];

// ── Selección ──────────────────────────────────────────────────────────────

const byDate = (a, b) => parseDay(a.date).getTime() - parseDay(b.date).getTime();
const isDated = (row) => Number.isFinite(parseDay(row.date).getTime());

// Clave de ventana para las fuentes que Substack agrega en servidor. Un
// `analytics` guardado antes de indexarse por ventana trae la forma plana.
const RANGE_KEYS = ["7", "30", "90", "all"];
const sourcesForRange = (source, days) => {
  if (!source || Array.isArray(source)) return null;
  const ranged = RANGE_KEYS.some((key) => key in source);
  if (!ranged) return source;
  return source[Number.isFinite(days) ? String(days) : "all"] || null;
};

export function getInsights({ snapshot = {}, analytics = null, days = 30, now = Date.now(), timeZoneOffsetMinutes = 0 } = {}) {
  const normalized = normalizeSnapshot(snapshot);
  const cutoff = Number.isFinite(days) ? now - days * DAY_MS : -Infinity;
  const growthDaily = analytics?.growth?.subscribers?.free?.daily || [];
  const ctx = {
    snapshot: normalized,
    analytics,
    days,
    now,
    timeZoneOffsetMinutes,
    rangeLabel: Number.isFinite(days) ? t("los últimos {days} días", { days }) : t("todo el histórico"),
    inRange: (date) => {
      const time = parseDay(date).getTime();
      return Number.isFinite(time) && time >= cutoff && time <= now;
    },
    notes: normalized.notes.filter(isDated).sort(byDate),
    campaigns: normalized.campaigns.filter(isDated).sort(byDate),
    growthDaily,
    subscriberDaily: growthDaily.length ? growthDaily : analytics?.audience?.timeline?.daily || [],
    sourcesForRange: sourcesForRange(analytics?.growth?.sources, days),
  };

  const found = [];
  const silent = [];
  for (const detector of DETECTORS) {
    const result = detector(ctx) || {};
    found.push(...(result.insights || []));
    silent.push(...(result.silent || []));
  }

  // Un solo nivel: dentro de cada vista, por relevancia. Lo que trae su prueba
  // (tira o piezas) no se promociona aparte; el orden ya lo sube.
  const seen = new Set();
  const unique = found
    .filter((insight) => (seen.has(insight.id) ? false : seen.add(insight.id)))
    .sort((a, b) => b.score - a.score);
  const groups = Object.fromEntries(GROUPS.map((group) => [group, unique.filter((insight) => insight.group === group)]));

  return { groups, silent, total: unique.length };
}
