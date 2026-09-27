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
  normalizeSnapshot,
  parseDay,
  ratio,
  safeNumber,
  sourceLabel,
} from "./analytics.js";
import { getFeatureInsights } from "./content-analytics.js";

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
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const PLACEHOLDER_BODY = "Nota sin texto";

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
  if (!Number.isFinite(date.getTime())) return "sin fecha";
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("es-ES", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};

const times = (value) => `${value.toLocaleString("es-ES", { maximumFractionDigits: value < 10 ? 1 : 0 })}×`;

const pieces = (count, singular, plural) => `${formatCompactNumber(count)} ${count === 1 ? singular : plural}`;

const excerptOf = (body, length = 90) => {
  const raw = String(body || "").trim();
  if (!raw || raw === PLACEHOLDER_BODY) return "(nota sin texto)";
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
    return { silent: [{ group: "notas", text: `Notas fuera de lo habitual: hacen falta al menos ${BASELINE_MIN + 1} notas para tener con qué comparar.` }] };
  }
  const winners = evaluated
    .filter((row) => row.z >= OUTLIER_Z && row.multiple >= 2 && row.value >= 3)
    .sort((a, b) => b.multiple - a.multiple);
  if (!winners.length) return {};
  const ids = new Set(winners.map((row) => row.piece.id));
  const recent = measured.slice(-BASELINE_WINDOW).map((row) => row.value);
  const top = winners[0];
  const text = winners.length === 1
    ? `Tu nota del ${shortDay(top.piece.date)} tuvo ${times(top.multiple)} más interacciones que tu nota típica.`
    : `${winners.length} notas tuvieron bastantes más interacciones que tu nota típica; la mejor, ${times(top.multiple)}.`;
  return {
    insights: [{
      id: "note-outlier",
      group: "notas",
      text,
      sample: `Me gusta, respuestas y restacks · cada nota frente a sus ${BASELINE_WINDOW} anteriores`,
      score: scoreOf(top.multiple, evaluated.length) + 0.2,
      strip: stripFor(evaluated, ids, "interacciones", recent),
      examples: winners.slice(0, 3).map((row) => ({ id: row.piece.id, excerpt: excerptOf(row.piece.body), date: row.piece.date })),
      action: null,
      target: { view: "notas", panel: "notes", noteIds: [...ids], label: winners.length === 1 ? "la nota del hallazgo" : `${winners.length} notas del hallazgo` },
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
    return { silent: [{ group: "notas", text: `Conversión de tus notas: hacen falta al menos ${BASELINE_MIN + 1} notas con estadísticas de Substack.` }] };
  }
  const winners = evaluated
    .filter((row) => row.z >= OUTLIER_Z && row.multiple >= 2 && row.piece.stats.results.freeSubscribers >= 3)
    .sort((a, b) => b.multiple - a.multiple);
  if (!winners.length) return {};
  const ids = new Set(winners.map((row) => row.piece.id));
  const top = winners[0];
  const rate = top.value.toLocaleString("es-ES", { maximumFractionDigits: 1 });
  const text = winners.length === 1
    ? `Tu nota del ${shortDay(top.piece.date)} convirtió ${times(top.multiple)} más que tu nota típica: ${rate} altas por cada 1.000 impresiones.`
    : `${winners.length} notas convirtieron bastante más que tu nota típica; la mejor, ${times(top.multiple)} (${rate} altas por cada 1.000 impresiones).`;
  return {
    insights: [{
      id: "note-converter",
      group: "notas",
      text,
      sample: `Altas por cada 1.000 impresiones · solo notas con estadísticas de Substack`,
      score: scoreOf(top.multiple, evaluated.length) + 0.4,
      strip: stripFor(evaluated, ids, "altas por 1.000 impresiones", measured.slice(-BASELINE_WINDOW).map((row) => row.value)),
      examples: winners.slice(0, 3).map((row) => ({ id: row.piece.id, excerpt: excerptOf(row.piece.body), date: row.piece.date })),
      action: "Prueba: reutiliza el enfoque de esa nota en tus próximas notas y compara su conversión.",
      target: { view: "notas", panel: "notes", noteIds: [...ids], label: winners.length === 1 ? "la nota del hallazgo" : `${winners.length} notas del hallazgo` },
    }],
  };
}

// Rasgos que dependen de la escritura, no del calendario (el calendario ya lo
// cuenta el mapa de Cuándo publicas). Frases escritas a mano: ninguna clave
// cruda llega a la interfaz.
const TRAIT_COPY = {
  hookIsQuestion: { with: "que abren con una pregunta", action: "abre con pregunta" },
  endsWithQuestion: { with: "que terminan en pregunta", action: "cierra con pregunta" },
  hasLink: { with: "con un enlace", action: "incluye un enlace en" },
  hasMention: { with: "que mencionan a alguien", action: "menciona a alguien en" },
  hasNumber: { with: "con alguna cifra", action: "incluye una cifra en" },
  hasList: { with: "con una lista", action: "usa una lista en" },
  hasQuote: { with: "con una cita", action: "incluye una cita en" },
  hasEmoji: { with: "con emojis", action: "usa emojis en" },
  isSelfRestack: { with: "que enlazan a tu propia publicación", action: "enlaza a tu publicación en" },
};

const LENGTH_COPY = { short: "cortas", medium: "de longitud media", long: "largas" };

function detectNoteTraits(ctx) {
  const inRange = ctx.notes.filter((note) => ctx.inRange(note.date));
  if (!inRange.length) return {};
  const insights = getFeatureInsights({ ...ctx.snapshot, notes: inRange }, { timeZoneOffsetMinutes: ctx.timeZoneOffsetMinutes });
  if (insights.coverage.scoredNotes < TRAIT_MIN_N * 2) {
    return { silent: [{ group: "notas", text: `Qué rasgos de tus notas rinden más: hacen falta al menos ${TRAIT_MIN_N * 2} notas con estadísticas de Substack en ${ctx.rangeLabel}.` }] };
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
      const label = feature.kind === "flag"
        ? `Tus notas ${TRAIT_COPY[feature.id].with}`
        : `Tus notas ${LENGTH_COPY[feature.level]}`;
      const action = feature.kind === "flag"
        ? `Prueba: ${TRAIT_COPY[feature.id].action} tus próximas 5 notas. PlotStack te dirá si se mantiene.`
        : null;
      return {
        id: `note-trait:${feature.id}:${feature.level}`,
        group: "notas",
        text: `${label} reciben ${times(cell.lift)} más interacciones que el resto.`,
        sample: `${pieces(feature.counts.withScored, "nota", "notas")} con el rasgo · ${pieces(feature.counts.withoutScored, "nota", "notas")} sin él · mediana de cada grupo`,
        score: scoreOf(cell.lift, Math.min(feature.counts.withScored, feature.counts.withoutScored), TRAIT_MIN_N * 2),
        strip: null,
        examples: feature.sampleIds.map((id) => byId.get(id)).filter(Boolean)
          .map((note) => ({ id: note.id, excerpt: excerptOf(note.body), date: note.date })),
        action,
        target: { view: "notas", panel: "notes", noteIds: feature.sampleIds, label: "notas de ejemplo del hallazgo" },
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
      text: `3 notas trajeron el ${formatPercent(concentration.share, 0)} de las altas que Substack atribuye a tus notas.`,
      sample: `${formatCompactNumber(concentration.total)} altas repartidas en ${pieces(concentration.counted, "nota", "notas")}`,
      score: 0.5,
      strip: null,
      examples: top.map((note) => ({ id: note.id, excerpt: excerptOf(note.body), date: note.date })),
      action: null,
      target: { view: "notas", panel: "notes", noteIds: top.map((note) => note.id), label: "las 3 notas del hallazgo" },
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
      text: `El ${formatPercent(reach.share, 0)} de las impresiones de tus notas llega a gente que aún no te sigue ni te lee.`,
      sample: `${pieces(reach.scoredNotes, "nota", "notas")} con estadísticas`,
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
    return { silent: [{ group: "publicaciones", text: `Artículos fuera de lo habitual: hacen falta al menos ${BASELINE_MIN + 1} artículos enviados para tener con qué comparar.` }] };
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
      text: `«${top.piece.title}» trajo ${times(top.multiple)} más altas en su primer día que tu artículo típico (${formatCompactNumber(top.value)} altas).`,
      sample: `Altas en las 24 h tras cada envío · cada envío frente a sus ${BASELINE_WINDOW} anteriores`,
      score: scoreOf(top.multiple, evaluated.length) + 0.3,
      strip: stripFor(evaluated, ids, "altas en el primer día", measured.slice(-BASELINE_WINDOW).map((row) => row.value)),
      examples: winners.slice(0, 3).map((row) => ({ id: row.piece.id, excerpt: row.piece.title, date: row.piece.date })),
      action: "Prueba: vuelve sobre el tema o la promesa de ese envío en uno de los próximos.",
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
        text: `Tus envíos del ${DAY_NAMES[best.day]} se abren más: ${formatPercent(best.openRate, 0)} frente al ${formatPercent(rest, 0)} del resto.`,
        sample: `${pieces(best.posts, "envío", "envíos")} ese día · apertura ponderada por entregas`,
        score: 0.45,
        strip: null,
        examples: [],
        action: null,
        target: { view: "publicaciones", panel: "posts-by-day" },
      });
    }
  } else if (ranged.length >= 2) {
    silent.push({ group: "publicaciones", text: `Mejor día de envío: hacen falta al menos ${MIN_CUT_N} envíos en dos días distintos.` });
  }
  const sections = getCampaignSections(ranged).filter((cut) => !cut.scarce && cut.openRate !== null && cut.section !== "Sin sección");
  if (sections.length >= 2) {
    const best = sections[0];
    const rest = weighted(ranged.filter((campaign) => (String(campaign.section || "").trim() || "Sin sección") !== best.section));
    if (rest !== null && best.openRate - rest >= CUT_MIN_POINTS) {
      insights.push({
        id: `post-section:${best.section}`,
        group: "publicaciones",
        text: `La sección «${best.section}» se abre más: ${formatPercent(best.openRate, 0)} frente al ${formatPercent(rest, 0)} del resto.`,
        sample: `${pieces(best.posts, "envío", "envíos")} en la sección · apertura ponderada por entregas`,
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
    return { silent: [{ group: "crecimiento", text: "Fuente principal de altas: tus altas llegan repartidas o todavía son pocas para señalar una." }] };
  }
  return {
    insights: [{
      id: "source-leader",
      group: "crecimiento",
      text: `${sourceLabel(leader.label)} es tu principal puerta de entrada: aporta el ${formatPercent(share * 100, 0)} de las altas atribuidas.`,
      sample: `${formatCompactNumber(total)} altas con fuente atribuida`,
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
      text: `Tu mejor semana fue la del ${shortDay(records.bestWeek.weekStart)}, con ${pieces(records.bestWeek.signups, "alta", "altas")}.`,
      sample: `Semanas de ${ctx.rangeLabel}`,
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
    ? `entre el ${shortDay(dates[0], ctx.now)} y el ${shortDay(dates.at(-1), ctx.now)}`
    : `hacia el ${shortDay(dates[0], ctx.now)}`;
  return {
    insights: [{
      id: "milestone",
      group: "crecimiento",
      text: `A este ritmo llegarás a ${formatCompactNumber(projection.target)} suscriptores ${when}.`,
      sample: "Altas menos bajas de los últimos 30 y 90 días · una estimación, no una promesa",
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
  const change = loyal.change ? ` (${loyal.change > 0 ? "+" : "−"}${formatCompactNumber(Math.abs(loyal.change))} desde el ${shortDay(loyal.changeSince)})` : "";
  return {
    insights: [{
      id: "loyal-core",
      group: "audiencia",
      text: `Tu núcleo fiel son ${pieces(loyal.core, "lector", "lectores")}, el ${formatPercent(loyal.coreShare, 0)} de tu lista${change}.`,
      sample: "Máxima puntuación de actividad de Substack: 5 de 5",
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
    rangeLabel: Number.isFinite(days) ? `los últimos ${days} días` : "todo el histórico",
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
