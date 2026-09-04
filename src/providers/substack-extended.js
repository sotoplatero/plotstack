import { requestJson } from "./substack-api.js";

const asNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const rowsFrom = (payload, keys = []) => {
  if (Array.isArray(payload)) return payload;
  for (const key of [...keys, "rows", "items", "data", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
};

const text = (...values) => String(values.find((value) => typeof value === "string" && value.trim()) || "");

// Observado: Array de pares ["2026/07/21", 31]. Se pasa a ISO con guiones para
// que el dashboard lo trate como fecha civil y no desplace el día.
const isoDay = (value) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return raw;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};


// Forma real: `{pubEvents: [{id, date, title, slug, type}]}`. La clave `pubEvents`
// no estaba en la lista de `rowsFrom`, asi que la vista Crecimiento salia vacia.
// Los eventos NO traen conteos de suscriptores: son solo hitos de publicación.
export function normalizeGrowthEvents(payload) {
  return rowsFrom(payload, ["pubEvents", "events"]).map((event, index) => ({
    id: String(event.id ?? index),
    date: text(event.date, event.created_at, event.timestamp, event.event_date),
    label: text(event.title, event.label, event.name, event.type, "Evento"),
    slug: text(event.slug),
    type: text(event.type, event.event_type),
  })).filter((event) => event.date || event.label).slice(0, 250);
}

// Forma real: `{sourceMetrics: [...], totals: [{name, total}]}`. Cada fuente trae
// `metrics: [{name:"Traffic"|"Subscribers"|"Revenue", timeseries, total}]` y
// `children` con el desglose (ahí viven las recomendaciones y las notas).
// `normalizeAcquisitionRows` buscaba `rows`/`items`/`data`/`sources`: ninguna
// existe, así que devolvía `[]` y los cuatro paneles quedaban en blanco.
const metricTotal = (metrics, name) => {
  const row = (Array.isArray(metrics) ? metrics : []).find((metric) => String(metric?.name || "").toLowerCase() === name);
  return asNumber(row?.total);
};

const metricSeries = (metrics, name) => {
  const row = (Array.isArray(metrics) ? metrics : []).find((metric) => String(metric?.name || "").toLowerCase() === name);
  return (Array.isArray(row?.timeseries) ? row.timeseries : [])
    .map((point) => ({ date: isoDay(point?.date), value: asNumber(point?.value) }))
    .filter((point) => point.date);
};

const mapSource = (row, index) => ({
  id: String(row?.source ?? index),
  label: text(row?.sourceName, row?.source, "Sin identificar"),
  category: text(row?.category),
  visitors: metricTotal(row?.metrics, "traffic"),
  subscribers: metricTotal(row?.metrics, "subscribers"),
  revenue: metricTotal(row?.metrics, "revenue"),
  series: metricSeries(row?.metrics, "subscribers"),
});

export function normalizeGrowthSources(payload = {}) {
  const rows = Array.isArray(payload.sourceMetrics) ? payload.sourceMetrics : [];
  const totals = Array.isArray(payload.totals) ? payload.totals : [];
  const totalOf = (name) => asNumber(totals.find((row) => String(row?.name || "").toLowerCase() === name)?.total);
  return {
    totals: { visitors: totalOf("traffic"), subscribers: totalOf("subscribers"), revenue: totalOf("revenue") },
    sources: rows.map((row, index) => ({
      ...mapSource(row, index),
      children: (Array.isArray(row?.children) ? row.children : []).map(mapSource),
    })),
  };
}

export function normalizeTimeseries(payload) {
  return rowsFrom(payload).map((point) => {
    if (Array.isArray(point)) return { date: isoDay(point[0]), value: asNumber(point[1]) };
    return { date: isoDay(text(point.date, point.day, point.timestamp)), value: asNumber(point.value, point.count, point.emails, point.sent) };
  }).filter((point) => point.date).sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeAudienceLocation(payload) {
  return rowsFrom(payload).map((row) => ({
    code: text(row?.location, row?.code).toUpperCase(),
    value: asNumber(row?.value, row?.count),
  })).filter((row) => row.code && row.value > 0).sort((a, b) => b.value - a.value);
}

// Suma las claves PRESENTES, en vez de quedarse con la primera finita. Con
// `asNumber(new_free, new_paid)` una fila `{new_free: 0, new_paid: 3}` devolvía
// 0: el 0 medido de gratuitos tapaba las tres altas de pago. Los alias solo se
// consultan si ninguna clave principal viene en la fila (ausencia ≠ cero).
const sumPresent = (row, keys, fallbackKeys = []) => {
  const present = keys.filter((key) => row?.[key] !== undefined && row?.[key] !== null);
  const chosen = present.length ? present : fallbackKeys.filter((key) => row?.[key] !== undefined && row?.[key] !== null);
  let total = 0;
  for (const key of chosen) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) total += value;
  }
  return total;
};

export function normalizeSubscriberGrowth(payload = {}) {
  const daily = rowsFrom(payload, ["subscriberGrowth"]).map((row) => {
    const gained = sumPresent(row, ["new_free", "new_paid"], ["new_subscribers", "new"]);
    const losses = sumPresent(row, ["num_unsubs", "num_expirations"], ["unsubscribes", "cancellations_finalized"]);
    return { date: isoDay(text(row?.dt, row?.date)), new: gained, losses, net: gained - losses };
  }).filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date));
  const totals = daily.reduce((sum, row) => ({
    new: sum.new + row.new,
    losses: sum.losses + row.losses,
    net: sum.net + row.net,
  }), { new: 0, losses: 0, net: 0 });
  return { daily, totals };
}

// Un punto de una cohorte: mes desde el alta y tasa. Se aceptan las dos formas
// observables (fila con `months_since_subscription`/`rate`, o número suelto cuya
// posición es el mes) y **nada más**: una forma desconocida devuelve `[]`, que
// es más honesto que interpretar mal la matriz.
const cohortPoints = (values) => {
  if (!Array.isArray(values)) return [];
  return values.map((value, index) => {
    if (value && typeof value === "object") {
      const month = asNumber(value.months_since_subscription, value.month, index);
      const rate = Number(value.rate ?? value.value);
      return Number.isFinite(rate) ? { month, rate } : null;
    }
    const rate = Number(value);
    return Number.isFinite(rate) ? { month: index, rate } : null;
  }).filter(Boolean).sort((a, b) => a.month - b.month);
};

export function normalizeRetention(payload = {}) {
  const rates = rowsFrom(payload.summary || payload, ["rates"]).map((row) => ({
    month: asNumber(row?.months_since_subscription, row?.month),
    rate: Number(row?.rate),
    comparison: Number(row?.comparison),
  })).filter((row) => row.month >= 0 && Number.isFinite(row.rate));
  const raw = payload.cohorts ?? payload.cohortStats ?? {};
  const entries = Array.isArray(raw)
    ? raw.map((row, index) => [text(row?.cohort, row?.name, row?.month) || String(index), row?.values ?? row?.rates ?? row])
    : Object.entries(raw);
  const cohorts = entries
    .map(([cohort, values]) => ({ cohort: String(cohort), points: cohortPoints(values) }))
    .filter((row) => row.points.length);
  return { cohorts, rates };
}

// `chartCounts` es un ÚNICO punto agregado, no una serie ni un mapa de fechas.
// Verificado en docs/product/substack-payloads-observados.md. Tratar sus claves
// como fechas fabrica puntos falsos en cero, que es lo que hacía antes.
export function normalizeAudience(payload = {}) {
  const counts = payload.chartCounts && !Array.isArray(payload.chartCounts) && typeof payload.chartCounts === "object"
    ? payload.chartCounts
    : {};
  return {
    total: asNumber(payload.count, payload.total),
    lastSync: text(payload.lastSync, payload.last_sync),
    emailable: asNumber(counts.totalEmail, counts.total_email),
    composition: {
      paidSubscribers: asNumber(counts.subscribers, counts.paid_subscribers),
      lifetimeSubscribers: asNumber(counts.lifetime_subscribers, counts.lifetimeSubscribers),
      compSubscribers: asNumber(counts.comp_subscribers, counts.compSubscribers),
      giftSubscribers: asNumber(counts.gift_subscribers, counts.giftSubscribers),
      freeTrialSubscribers: asNumber(counts.free_trial_subscribers, counts.freeTrialSubscribers),
      foundingSubscribers: asNumber(counts.founding_subscribers, counts.foundingSubscribers),
    },
    // Se rellena aparte con getSubscriberTimeline: este endpoint no da serie.
    history: [],
  };
}

// El único histórico diario real que devuelve Substack sale de agregar la fecha
// de alta de cada suscripción. La respuesta trae email, nombre y foto: se
// agregan en memoria y se descartan aquí, nunca salen de esta función.
export const normalizeSubscriberTimeline = (value = {}) => ({
  total: asNumber(value.total),
  counted: asNumber(value.counted),
  partial: Boolean(value.partial),
  composition: {
    paid: asNumber(value.composition?.paid),
    founding: asNumber(value.composition?.founding),
    gift: asNumber(value.composition?.gift),
    comp: asNumber(value.composition?.comp),
    freeTrial: asNumber(value.composition?.freeTrial),
  },
  engagement: {
    alta: asNumber(value.engagement?.alta),
    baja: asNumber(value.engagement?.baja),
    inactiva: asNumber(value.engagement?.inactiva),
  },
  byInterval: (Array.isArray(value.byInterval) ? value.byInterval : [])
    .map((row) => ({ interval: text(row?.interval), count: asNumber(row?.count) }))
    .filter((row) => row.interval),
  daily: (Array.isArray(value.daily) ? value.daily : []).map((point) => ({
    date: text(point?.date),
    signups: asNumber(point?.signups),
    paidSignups: asNumber(point?.paidSignups),
    cumulative: asNumber(point?.cumulative),
  })).filter((point) => point.date),
});

export const SUBSCRIBER_PAGE_SIZE = 100; // limit: 200 responde 400.
export const SUBSCRIBER_MAX_PAGES = 25;

// Semántica verificada sobre el payload real, no asumida:
// - `subscription_interval` es el discriminador free/paid ("free", "lifetime", …).
// - `subscription_type` viene null en toda la lista: inservible.
// - `is_subscribed` NO significa "suscrito": es false para los 96 gratuitos y
//   true solo para el único lifetime. No se usa como baja.
// - `activity_rating` es el 0-5 que Substack pinta como puntos de actividad.
const PAID_INTERVALS = new Set(["month", "monthly", "year", "yearly", "annual", "quarter"]);

const isPaidRow = (row) => asNumber(row?.total_revenue_generated) > 0
  || row?.is_founding === true
  || PAID_INTERVALS.has(String(row?.subscription_interval || "").toLowerCase());

export async function getSubscriberTimeline(base, { maxPages = SUBSCRIBER_MAX_PAGES } = {}) {
  // Conteos agregados de la primera página, para que la fuente `audience` no
  // repita la misma petición con `limit: 1`. Se copian SOLO `count` y
  // `chartCounts`: el payload crudo trae emails y nombres, y de esta función no
  // sale PII (lo guarda un test).
  let audienceCounts = null;
  const byDay = new Map();
  const composition = { paid: 0, founding: 0, gift: 0, comp: 0, freeTrial: 0 };
  const byInterval = new Map();
  const engagement = { alta: 0, baja: 0, inactiva: 0 };
  let total = 0;
  let counted = 0;
  let pages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await requestJson(`${base}/subscriber-stats`, {
      method: "POST",
      json: {
        filters: { order_by_desc_nulls_last: "subscription_created_at" },
        limit: SUBSCRIBER_PAGE_SIZE,
        offset: page * SUBSCRIBER_PAGE_SIZE,
      },
    });
    if (page === 0) audienceCounts = { count: asNumber(payload?.count), chartCounts: payload?.chartCounts };
    total = asNumber(payload?.count, total);
    const rows = Array.isArray(payload?.subscribers) ? payload.subscribers : [];
    pages += 1;
    for (const row of rows) {
      counted += 1;
      const paid = isPaidRow(row);
      if (paid) composition.paid += 1;
      if (row?.is_founding) composition.founding += 1;
      if (row?.is_gift) composition.gift += 1;
      if (row?.is_comp) composition.comp += 1;
      if (row?.is_free_trial) composition.freeTrial += 1;
      const interval = text(row?.subscription_interval) || "sin definir";
      byInterval.set(interval, (byInterval.get(interval) || 0) + 1);
      const rating = asNumber(row?.activity_rating);
      if (rating >= 4) engagement.alta += 1;
      else if (rating >= 1) engagement.baja += 1;
      else engagement.inactiva += 1;
      const date = String(row?.subscription_created_at || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const bucket = byDay.get(date) || { date, signups: 0, paidSignups: 0 };
      bucket.signups += 1;
      if (paid) bucket.paidSignups += 1;
      byDay.set(date, bucket);
    }
    if (rows.length < SUBSCRIBER_PAGE_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  // Orden ascendente para acumular: la API pagina de más reciente a más antiguo.
  const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  for (const point of daily) {
    running += point.signups;
    point.cumulative = running;
  }

  return {
    total,
    counted,
    pages,
    audienceCounts,
    // Truncar pierde las altas más antiguas, no las recientes: la API ordena desc.
    partial: Boolean(total) && counted < total,
    daily,
    composition,
    byInterval: [...byInterval.entries()].map(([interval, count]) => ({ interval, count })).sort((a, b) => b.count - a.count),
    engagement,
  };
}

const recordCount = (value) => {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.rows)) return value.rows.length;
  if (Array.isArray(value?.items)) return value.items.length;
  if (Array.isArray(value?.sources)) return value.sources.length;
  if (Array.isArray(value?.daily)) return value.daily.length;
  if (Array.isArray(value?.history)) return value.history.length;
  if (Array.isArray(value?.rates)) return value.rates.length;
  if (typeof value?.total === "number") return value.total;
  return value && typeof value === "object" ? 1 : 0;
};

export async function getExtendedAnalytics(publication) {
  const base = `https://${publication.subdomain}.substack.com/api/v1`;
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  const from = startDate.toISOString().slice(0, 10);
  const to = endDate.toISOString().slice(0, 10);
  const fromIso = startDate.toISOString();
  const toIso = endDate.toISOString();
  const growthQuery = `start=${encodeURIComponent(fromIso)}&end=${encodeURIComponent(toIso)}&period=day`;
  const retentionQuery = `start=${encodeURIComponent(fromIso)}&end=${encodeURIComponent(toIso)}&months=12&subscription_interval_cohort=all`;
  const locationRequest = async () => {
    const [rows, totals] = await Promise.all([
      requestJson(`${base}/publication/stats/audience_insights/location?metric=free%20signups&granularity=global`),
      requestJson(`${base}/publication/stats/audience_insights/location/total`),
    ]);
    return { rows, totals };
  };
  const retentionRequest = async (paid) => {
    const subscribed = paid ? "true" : "false";
    const [cohorts, summary] = await Promise.all([
      requestJson(`${base}/publication/stats/subscriber_retention?${retentionQuery}&is_subscribed=${subscribed}`),
      requestJson(`${base}/publication/stats/subscriber_retention/summary?is_subscribed=${subscribed}&subscription_interval_cohort=all`),
    ]);
    return { ...(cohorts || {}), summary };
  };

  // `audience` NO es una fuente propia: sus conteos (`chartCounts`) vienen en la
  // primera página de `subscriber-stats`, que `subscriberTimeline` ya pide. La
  // petición con `limit: 1` era un duplicado exacto en cada sincronización.
  const sources = [
    { key: "subscriberTimeline", label: "Altas por día", request: () => getSubscriberTimeline(base), normalize: normalizeSubscriberTimeline },
    { key: "growthSources", label: "Fuentes de crecimiento", request: () => requestJson(`${base}/publication/stats/growth/sources?from_date=${from}&to_date=${to}&order_by=users&order_direction=desc`), normalize: normalizeGrowthSources },
    { key: "followerTimeseries", label: "Histórico de seguidores", request: () => requestJson(`${base}/publication/stats/followers/timeseries?from=${encodeURIComponent(fromIso)}`), normalize: normalizeTimeseries },
    { key: "audienceLocation", label: "Ubicación de la audiencia", request: locationRequest, normalize: (payload) => ({ rows: normalizeAudienceLocation(payload.rows), totals: payload.totals || {} }) },
    { key: "freeSubscriberGrowth", label: "Altas y bajas gratuitas", request: () => requestJson(`${base}/publication/stats/paid_subscriber_growth?${growthQuery}&is_subscribed=false`), normalize: normalizeSubscriberGrowth },
    { key: "paidSubscriberGrowth", label: "Altas y bajas de pago", request: () => requestJson(`${base}/publication/stats/paid_subscriber_growth?${growthQuery}&is_subscribed=true`), normalize: normalizeSubscriberGrowth },
    { key: "freeRetention", label: "Retención gratuita", request: () => retentionRequest(false), normalize: normalizeRetention },
    { key: "paidRetention", label: "Retención de pago", request: () => retentionRequest(true), normalize: normalizeRetention },
  ];

  const settled = await Promise.allSettled(sources.map((source) => source.request()));
  const data = {};
  const raw = {};
  const coverage = settled.map((result, index) => {
    const source = sources[index];
    if (result.status === "rejected") {
      data[source.key] = source.normalize({});
      return { key: source.key, label: source.label, status: "unavailable", records: 0, error: result.reason?.message || "No disponible" };
    }
    raw[source.key] = result.value;
    data[source.key] = source.normalize(result.value);
    return { key: source.key, label: source.label, status: "ready", records: recordCount(data[source.key]), error: "" };
  });

  // Los conteos agregados salen de la primera página que ya trajo la timeline:
  // `audienceCounts` es la copia PII-free de `count` y `chartCounts`.
  data.audience = normalizeAudience(raw.subscriberTimeline?.audienceCounts || {});
  const timelineCoverage = coverage.find((row) => row.key === "subscriberTimeline");
  coverage.unshift({
    key: "audience",
    label: "Audiencia",
    status: timelineCoverage?.status === "ready" ? "ready" : "unavailable",
    records: recordCount(data.audience),
    error: timelineCoverage?.status === "ready" ? "" : timelineCoverage?.error || "No disponible",
  });

  return {
    version: 1,
    syncedAt: new Date().toISOString(),
    period: { from, to },
    coverage,
    audience: {
      ...data.audience,
      timeline: data.subscriberTimeline,
      followers: { history: data.followerTimeseries, total: data.followerTimeseries.at(-1)?.value || 0 },
      location: data.audienceLocation,
    },
    growth: { sources: data.growthSources, subscribers: { free: data.freeSubscriberGrowth, paid: data.paidSubscriberGrowth } },
    retention: { free: data.freeRetention, paid: data.paidRetention },
  };
}
