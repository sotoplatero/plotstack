import { normalizeSnapshot, safeNumber } from "./analytics.js";

export const EVIDENCE_MIN_N = 5;
export const MIN_EFFECT = 0.15;
export const OUTCOME_KEYS = ["interactions", "profileVisits", "impressions", "freeSubscribers"];

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const PLACEHOLDER_BODY = "Nota sin texto";

export const FEATURE_DEFS = Object.freeze([
  { id: "hookIsQuestion", kind: "flag" },
  { id: "endsWithQuestion", kind: "flag" },
  { id: "hasLink", kind: "flag" },
  { id: "hasMention", kind: "flag" },
  { id: "hasNumber", kind: "flag" },
  { id: "hasList", kind: "flag", structureDependent: true },
  { id: "hasQuote", kind: "flag" },
  { id: "hasEmoji", kind: "flag" },
  { id: "isSelfRestack", kind: "flag", needsHost: true },
  { id: "lengthBand", kind: "band", levels: ["short", "medium", "long"] },
  { id: "hookLengthBand", kind: "band", levels: ["short", "medium", "long"] },
  { id: "dayOfWeek", kind: "band", levels: DAY_KEYS },
  { id: "hourBucket", kind: "band", levels: ["night", "morning", "afternoon", "evening"] },
]);

const FLAG_IDS = FEATURE_DEFS.filter((def) => def.kind === "flag").map((def) => def.id);
const BAND_IDS = FEATURE_DEFS.filter((def) => def.kind === "band").map((def) => def.id);

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const ratio = (numerator, denominator) => {
  if (!(denominator > 0)) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
};

const cleanBody = (body) => {
  const value = String(body || "").trim();
  return value === PLACEHOLDER_BODY ? "" : value;
};

const stripUrls = (text) => text.replace(/https?:\/\/\S+/gi, " ").replace(/(^|\s)www\.\S+/gi, " ");

const splitSentences = (text) => text
  .split(/\n+/)
  .flatMap((line) => line.split(/(?<=[.!?…？])\s+/))
  .map((part) => part.trim())
  .filter(Boolean);

const firstSentence = (text) => splitSentences(text)[0] || "";

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/u).length : 0);

const toLocalDate = (iso, offsetMinutes) => {
  const time = new Date(String(iso || "")).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + offsetMinutes * 60000);
};

const weekStartOf = (date) => {
  const shifted = new Date(date.getTime());
  const weekday = (shifted.getUTCDay() + 6) % 7;
  shifted.setUTCDate(shifted.getUTCDate() - weekday);
  return shifted.toISOString().slice(0, 10);
};

const bandOf = (value, [low, high]) => (value <= low ? "short" : value <= high ? "medium" : "long");

const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return "";
  }
};

const hourBucketOf = (hour) => (hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");

export function extractNoteFeatures(note = {}, options = {}) {
  const { timeZoneOffsetMinutes = 0, publicationHost = "" } = options;
  const raw = cleanBody(note.body);
  const empty = !raw;
  const withoutUrls = stripUrls(raw);
  const hook = firstSentence(withoutUrls) || firstSentence(raw);
  const localDate = toLocalDate(note.date, timeZoneOffsetMinutes);
  const hasLineBreaks = raw.includes("\n");

  const urls = raw.match(/https?:\/\/\S+/gi) || [];
  const selfRestack = publicationHost
    ? urls.some((url) => {
        const host = hostOf(url);
        return host === publicationHost || (host === "substack.com" && /\/p\//.test(url));
      })
    : null;

  const listByLine = hasLineBreaks ? /^\s*(?:[-*•·–—]\s+|\d{1,2}[.)]\s+)/mu.test(raw) : false;
  const listInline = (raw.match(/\s[•·▪▶→✅]\s/gu) || []).length >= 2;

  const flags = empty
    ? Object.fromEntries(FLAG_IDS.map((id) => [id, null]))
    : {
        hookIsQuestion: hook.startsWith("¿") || /[?？]\s*$/.test(hook),
        endsWithQuestion: /[?？]["'”»)\]]*\s*$/.test(raw) || (splitSentences(raw).at(-1) || "").startsWith("¿"),
        hasLink: /https?:\/\/\S+/i.test(raw) || /(^|\s)www\.\S+\.\S+/i.test(raw),
        hasMention: /(?:^|[\s(¡¿"'])@[\p{L}\p{N}_.-]{2,}/u.test(withoutUrls),
        hasNumber: /\d/.test(withoutUrls),
        hasList: hasLineBreaks || listInline ? listByLine || listInline : null,
        hasQuote: (raw.match(/["“”«»]/gu) || []).length >= 2,
        hasEmoji: /\p{Extended_Pictographic}/u.test(raw),
        isSelfRestack: selfRestack,
      };

  const wordCount = countWords(raw);
  const scorable = Boolean(note.stats?.available);

  return {
    id: String(note.id ?? ""),
    scorable,
    empty,
    wordCount,
    charCount: raw.length,
    sentenceCount: splitSentences(raw).length,
    paragraphCount: hasLineBreaks ? raw.split(/\n{2,}|\n/).filter(Boolean).length : raw ? 1 : 0,
    hookLength: hook.length,
    hasLineBreaks,
    flags,
    bands: {
      lengthBand: empty ? null : bandOf(wordCount, [40, 100]),
      hookLengthBand: empty ? null : bandOf(hook.length, [60, 120]),
      dayOfWeek: localDate ? DAY_KEYS[localDate.getUTCDay()] : null,
      hourBucket: localDate ? hourBucketOf(localDate.getUTCHours()) : null,
    },
    outcomes: scorable
      ? {
          interactions: safeNumber(note.stats.interactions?.total),
          profileVisits: safeNumber(note.stats.interactions?.profileVisits),
          impressions: safeNumber(note.stats.reach?.impressions),
          freeSubscribers: safeNumber(note.stats.results?.freeSubscribers),
        }
      : { interactions: null, profileVisits: null, impressions: null, freeSubscribers: null },
    weekStart: localDate ? weekStartOf(localDate) : "",
    localDay: localDate ? localDate.toISOString().slice(0, 10) : "",
    // Índice 0-6 (domingo = 0) y hora 0-23 ya en la zona del usuario. El heatmap
    // necesita la hora exacta, no el cubo de cuatro tramos de `hourBucket`.
    dayIndex: localDate ? localDate.getUTCDay() : null,
    hour: localDate ? localDate.getUTCHours() : null,
  };
}

const dedupeNotes = (notes) => {
  const seen = new Set();
  return notes.filter((note) => {
    const key = String(note?.id ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const valueFor = (features, def, level) => {
  const value = def.kind === "flag" ? features.flags[def.id] : features.bands[def.id];
  if (value === null || value === undefined) return null;
  return def.kind === "flag" ? value === level : value === level;
};

const aggregateCell = (withRows, withoutRows, key) => {
  const withValues = withRows.map((row) => row.outcomes[key]).filter((value) => value !== null);
  const withoutValues = withoutRows.map((row) => row.outcomes[key]).filter((value) => value !== null);
  const medianWith = median(withValues);
  const medianWithout = median(withoutValues);
  const positiveRateWith = ratio(withValues.filter((value) => value > 0).length, withValues.length);
  const positiveRateWithout = ratio(withoutValues.filter((value) => value > 0).length, withoutValues.length);

  let lift = ratio(medianWith ?? 0, medianWithout ?? 0);
  let liftBasis = lift === null ? "none" : "median";
  if (lift === null && medianWith === 0 && medianWithout === 0) {
    lift = ratio(positiveRateWith ?? 0, positiveRateWithout ?? 0);
    liftBasis = lift === null ? "none" : "positive-rate";
  }

  return {
    medianWith,
    medianWithout,
    lift,
    liftBasis,
    delta: medianWith === null || medianWithout === null ? null : medianWith - medianWithout,
    positiveRateWith,
    positiveRateWithout,
  };
};

const resolveState = (counts, computable) => {
  if (!computable) return { state: "nodata", reason: "not-computable" };
  if (!counts.withTotal || !counts.withoutTotal) return { state: "insufficient", reason: "no-variation" };
  if (!counts.withScored || !counts.withoutScored) return { state: "nodata", reason: "stats-missing" };
  if (counts.withScored < EVIDENCE_MIN_N || counts.withoutScored < EVIDENCE_MIN_N) {
    return { state: "insufficient", reason: "small-sample" };
  }
  return { state: "evidence", reason: "" };
};

export function getFeatureInsights(snapshot, options = {}) {
  const { timeZoneOffsetMinutes = 0, primaryOutcome = "interactions" } = options;
  const normalized = normalizeSnapshot(snapshot || {});
  const publicationHost = options.publicationHost ?? hostOf(normalized.sourceUrl);
  const notes = dedupeNotes(Array.isArray(normalized.notes) ? normalized.notes : []);
  const rows = notes.map((note) => extractNoteFeatures(note, { timeZoneOffsetMinutes, publicationHost }));

  const coverage = {
    totalNotes: rows.length,
    scoredNotes: rows.filter((row) => row.scorable).length,
    emptyNotes: rows.filter((row) => row.empty).length,
    undatedNotes: rows.filter((row) => !row.weekStart).length,
    statsCoverage: ratio(rows.filter((row) => row.scorable).length, rows.length) ?? 0,
    structureAvailable: rows.some((row) => row.hasLineBreaks),
  };

  const features = [];
  for (const def of FEATURE_DEFS) {
    const levels = def.kind === "flag" ? [true] : def.levels;
    const computable = rows.some((row) => (def.kind === "flag" ? row.flags[def.id] : row.bands[def.id]) !== null);
    for (const level of levels) {
      const withRows = rows.filter((row) => valueFor(row, def, level) === true);
      const withoutRows = rows.filter((row) => valueFor(row, def, level) === false);
      const counts = {
        withTotal: withRows.length,
        withoutTotal: withoutRows.length,
        withScored: withRows.filter((row) => row.scorable).length,
        withoutScored: withoutRows.filter((row) => row.scorable).length,
      };
      const { state, reason } = resolveState(counts, computable);
      const outcomes = {};
      for (const key of OUTCOME_KEYS) {
        outcomes[key] = aggregateCell(
          withRows.filter((row) => row.scorable),
          withoutRows.filter((row) => row.scorable),
          key,
        );
      }
      const sampleIds = withRows
        .filter((row) => row.scorable)
        .sort((a, b) => safeNumber(b.outcomes[primaryOutcome]) - safeNumber(a.outcomes[primaryOutcome]))
        .slice(0, 3)
        .map((row) => row.id);
      features.push({ id: def.id, kind: def.kind, level, state, reason, counts, outcomes, sampleIds });
    }
  }

  return { coverage, features };
}

export function getNotesTimeline(snapshot, options = {}) {
  const { timeZoneOffsetMinutes = 0 } = options;
  const normalized = normalizeSnapshot(snapshot || {});
  const notes = dedupeNotes(Array.isArray(normalized.notes) ? normalized.notes : []);
  const rows = notes.map((note) => extractNoteFeatures(note, { timeZoneOffsetMinutes }));
  const dated = rows.filter((row) => row.weekStart);
  const buckets = new Map();

  for (const row of dated) {
    const bucket = buckets.get(row.weekStart) || {
      weekStart: row.weekStart,
      notes: 0,
      scoredNotes: 0,
      interactions: 0,
      profileVisits: 0,
      impressions: 0,
      freeSubscribers: 0,
    };
    bucket.notes += 1;
    if (row.scorable) {
      bucket.scoredNotes += 1;
      bucket.interactions += safeNumber(row.outcomes.interactions);
      bucket.profileVisits += safeNumber(row.outcomes.profileVisits);
      bucket.impressions += safeNumber(row.outcomes.impressions);
      bucket.freeSubscribers += safeNumber(row.outcomes.freeSubscribers);
    }
    buckets.set(row.weekStart, bucket);
  }

  const keys = [...buckets.keys()].sort();
  const weeks = [];
  if (keys.length) {
    const cursor = new Date(`${keys[0]}T00:00:00Z`);
    const last = new Date(`${keys.at(-1)}T00:00:00Z`);
    while (cursor.getTime() <= last.getTime()) {
      const key = cursor.toISOString().slice(0, 10);
      const bucket = buckets.get(key) || {
        weekStart: key,
        notes: 0,
        scoredNotes: 0,
        interactions: 0,
        profileVisits: 0,
        impressions: 0,
        freeSubscribers: 0,
      };
      weeks.push({
        ...bucket,
        statsCoverage: ratio(bucket.scoredNotes, bucket.notes) ?? 0,
        impressionsPerNote: ratio(bucket.impressions, bucket.scoredNotes) ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }

  return {
    weeks,
    undatedNotes: rows.length - dated.length,
    firstWeek: keys[0] || "",
    lastWeek: keys.at(-1) || "",
  };
}

// Rejilla 7x24 de cuándo publicas. La cadencia es un recuento: la métrica
// principal es `notes`. `medianInteractions` queda `null` —no 0— cuando ninguna
// nota de la celda tiene estadísticas, porque ausencia no es medición.
export function getCadenceHeatmap(snapshot, options = {}) {
  const { timeZoneOffsetMinutes = 0 } = options;
  const normalized = normalizeSnapshot(snapshot || {});
  const notes = dedupeNotes(Array.isArray(normalized.notes) ? normalized.notes : []);
  const rows = notes.map((note) => extractNoteFeatures(note, { timeZoneOffsetMinutes }));
  const scored = new Map();
  const counts = new Map();
  const bucketScored = new Map();
  const bucketCounts = new Map();

  let undated = 0;
  for (const row of rows) {
    if (row.dayIndex === null || row.hour === null) {
      undated += 1;
      continue;
    }
    const key = `${row.dayIndex}:${row.hour}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    // Los tramos se agregan desde las horas crudas: la mediana de un tramo
    // sale de sus valores, nunca de re-derivar medianas de medianas.
    const bucketKey = `${row.dayIndex}:${hourBucketOf(row.hour)}`;
    bucketCounts.set(bucketKey, (bucketCounts.get(bucketKey) || 0) + 1);
    if (row.scorable) {
      const bucket = scored.get(key) || [];
      bucket.push(safeNumber(row.outcomes.interactions));
      scored.set(key, bucket);
      const tramo = bucketScored.get(bucketKey) || [];
      tramo.push(safeNumber(row.outcomes.interactions));
      bucketScored.set(bucketKey, tramo);
    }
  }

  const cells = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const key = `${dayIndex}:${hour}`;
      const interactions = scored.get(key) || [];
      cells.push({
        dayIndex,
        day: DAY_KEYS[dayIndex],
        hour,
        notes: counts.get(key) || 0,
        scoredNotes: interactions.length,
        medianInteractions: median(interactions),
      });
    }
  }

  // Rejilla 7x4 por tramos: con decenas de notas, 168 celdas quedan casi todas
  // vacías y la señal se pierde; cuatro tramos por día la concentran.
  const HOUR_BUCKET_ORDER = ["night", "morning", "afternoon", "evening"];
  const buckets = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    for (const bucket of HOUR_BUCKET_ORDER) {
      const key = `${dayIndex}:${bucket}`;
      const interactions = bucketScored.get(key) || [];
      buckets.push({
        dayIndex,
        day: DAY_KEYS[dayIndex],
        bucket,
        notes: bucketCounts.get(key) || 0,
        scoredNotes: interactions.length,
        medianInteractions: median(interactions),
      });
    }
  }

  const busiest = [...cells].sort((a, b) => b.notes - a.notes || b.scoredNotes - a.scoredNotes)[0];
  const busiestBucket = [...buckets].sort((a, b) => b.notes - a.notes || b.scoredNotes - a.scoredNotes)[0];
  return {
    cells,
    buckets,
    maxNotes: Math.max(0, ...cells.map((cell) => cell.notes)),
    maxBucketNotes: Math.max(0, ...buckets.map((cell) => cell.notes)),
    datedNotes: rows.length - undated,
    undatedNotes: undated,
    busiest: busiest?.notes ? busiest : null,
    busiestBucket: busiestBucket?.notes ? busiestBucket : null,
  };
}

// Seguidores y altas que Substack atribuye a cada nota, agregados por día.
// Solo suman las notas con `stats.available`: una nota sin detalle no aporta
// cero, queda fuera. `coverage` dice sobre cuántas notas se sostiene la serie.
// Calendario de cadencia estilo GitHub: una celda por DIA, columnas por semana
// (lunes arriba), intensidad por notas publicadas. Sustituye a la rejilla por
// tramos horarios, que con decenas de notas quedaba casi vacia. Se limita a las
// ultimas `maxWeeks` semanas con notas: mas alla no cabe en pantalla y GitHub
// hace lo mismo. La mediana de interacciones del dia sale de los valores crudos
// de sus notas con detalle; un dia sin detalle es `null`, no cero.
export const CALENDAR_MAX_WEEKS = 53;

export function getCadenceCalendar(snapshot, options = {}) {
  const { timeZoneOffsetMinutes = 0, maxWeeks = CALENDAR_MAX_WEEKS } = options;
  const normalized = normalizeSnapshot(snapshot || {});
  const notes = dedupeNotes(Array.isArray(normalized.notes) ? normalized.notes : []);
  const rows = notes.map((note) => extractNoteFeatures(note, { timeZoneOffsetMinutes }));
  const dated = rows.filter((row) => row.localDay);
  if (!dated.length) {
    return { days: [], weeks: [], months: [], maxNotes: 0, start: "", end: "", datedNotes: 0, undatedNotes: rows.length, truncatedWeeks: 0 };
  }

  const byDay = new Map();
  for (const row of dated) {
    const bucket = byDay.get(row.localDay) || { notes: 0, interactions: [] };
    bucket.notes += 1;
    if (row.scorable) bucket.interactions.push(safeNumber(row.outcomes.interactions));
    byDay.set(row.localDay, bucket);
  }

  const keys = [...byDay.keys()].sort();
  // Desde el lunes de la primera semana con notas hasta el domingo de la ultima.
  let start = new Date(`${weekStartOf(new Date(`${keys[0]}T00:00:00Z`))}T00:00:00Z`);
  const end = new Date(`${weekStartOf(new Date(`${keys.at(-1)}T00:00:00Z`))}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const totalWeeks = Math.round((end.getTime() - start.getTime() + 86400000) / (7 * 86400000));
  const truncatedWeeks = Math.max(0, totalWeeks - maxWeeks);
  if (truncatedWeeks) start = new Date(start.getTime() + truncatedWeeks * 7 * 86400000);

  const days = [];
  const weeks = [];
  const months = [];
  let lastMonth = "";
  for (let cursor = new Date(start.getTime()), column = 0; cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    const cell = {
      date: key,
      // 0 = lunes … 6 = domingo, la fila del calendario.
      weekday: (cursor.getUTCDay() + 6) % 7,
      column,
      notes: bucket?.notes || 0,
      scoredNotes: bucket?.interactions.length || 0,
      medianInteractions: bucket ? median(bucket.interactions) : null,
    };
    days.push(cell);
    if (cell.weekday === 0) {
      weeks.push([]);
      // Etiqueta de mes en la primera columna donde cambia.
      const month = key.slice(0, 7);
      if (month !== lastMonth) {
        months.push({ month, column });
        lastMonth = month;
      }
    }
    weeks[weeks.length - 1].push(cell);
    if (cell.weekday === 6) column += 1;
  }

  return {
    days,
    weeks,
    months,
    maxNotes: Math.max(0, ...days.map((cell) => cell.notes)),
    start: days[0]?.date || "",
    end: days.at(-1)?.date || "",
    datedNotes: dated.length,
    undatedNotes: rows.length - dated.length,
    truncatedWeeks,
  };
}

export function getNoteAttributionTimeline(snapshot, options = {}) {
  const { timeZoneOffsetMinutes = 0 } = options;
  const normalized = normalizeSnapshot(snapshot || {});
  const notes = dedupeNotes(Array.isArray(normalized.notes) ? normalized.notes : []);
  const rows = notes.map((note) => extractNoteFeatures(note, { timeZoneOffsetMinutes }));
  const usable = rows.filter((row) => row.scorable && row.localDay);
  const byDay = new Map();

  for (const row of usable) {
    const bucket = byDay.get(row.localDay) || { date: row.localDay, impressions: 0, freeSubscribers: 0, interactions: 0, notes: 0 };
    bucket.notes += 1;
    bucket.impressions += safeNumber(row.outcomes.impressions);
    bucket.freeSubscribers += safeNumber(row.outcomes.freeSubscribers);
    bucket.interactions += safeNumber(row.outcomes.interactions);
    byDay.set(row.localDay, bucket);
  }

  const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totals = daily.reduce((sum, point) => ({
    impressions: sum.impressions + point.impressions,
    freeSubscribers: sum.freeSubscribers + point.freeSubscribers,
    interactions: sum.interactions + point.interactions,
  }), { impressions: 0, freeSubscribers: 0, interactions: 0 });

  return {
    daily,
    totals,
    scoredNotes: usable.length,
    totalNotes: rows.length,
    coverage: ratio(usable.length, rows.length),
  };
}

export function getContentFindings(insights, options = {}) {
  const { primaryOutcome = "interactions", limit = 5, minEffect = MIN_EFFECT } = options;
  const best = new Map();

  for (const feature of insights?.features || []) {
    if (feature.state !== "evidence") continue;
    const cell = feature.outcomes?.[primaryOutcome];
    if (!cell || cell.lift === null || !Number.isFinite(cell.lift) || cell.lift <= 0) continue;
    if (Math.abs(cell.lift - 1) < minEffect) continue;

    const n = Math.min(feature.counts.withScored, feature.counts.withoutScored);
    const score = Math.abs(Math.log2(cell.lift)) * Math.min(1, n / (2 * EVIDENCE_MIN_N));
    const finding = {
      featureId: feature.id,
      kind: feature.kind,
      level: feature.level,
      outcome: primaryOutcome,
      direction: cell.lift >= 1 ? "positive" : "negative",
      lift: cell.lift,
      liftBasis: cell.liftBasis,
      medianWith: cell.medianWith,
      medianWithout: cell.medianWithout,
      delta: cell.delta,
      n,
      score,
      sampleIds: feature.sampleIds,
    };
    const current = best.get(feature.id);
    if (!current || finding.score > current.score) best.set(feature.id, finding);
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || b.n - a.n || a.featureId.localeCompare(b.featureId))
    .slice(0, limit);
}

export function getContentAnalytics(snapshot, options = {}) {
  const primaryOutcome = options.primaryOutcome || "interactions";
  const insights = getFeatureInsights(snapshot, { ...options, primaryOutcome });
  return {
    coverage: insights.coverage,
    features: insights.features,
    timeline: getNotesTimeline(snapshot, options),
    cadence: getCadenceHeatmap(snapshot, options),
    calendar: getCadenceCalendar(snapshot, options),
    attribution: getNoteAttributionTimeline(snapshot, options),
    findings: getContentFindings(insights, { ...options, primaryOutcome }),
    primaryOutcome,
  };
}
