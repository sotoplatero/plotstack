import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCompactNumber,
  formatPercent,
  getCampaignCuts,
  getCampaignDiagnosis,
  getChannelAttribution,
  getDerivedMetrics,
  getNotesEngagement,
  getNotesAnalytics,
  getOwnOpenRateMedian,
  getPublicationEngagement,
  getRateWindows,
  getTrendSeries,
  normalizeSnapshot,
} from "../src/shared/analytics.js";
import { weightedRate } from "../src/providers/substack-api.js";

test("getNotesAnalytics aggregates detailed note statistics and ranks them", () => {
  const result = getNotesAnalytics(normalizeSnapshot({
    notes: [
      { id: "1", body: "Primera", stats: { available: true, interactions: { total: 20, likes: 12, restacks: 3, profileVisits: 2, replies: 1, saves: 1, shares: 1 }, results: { freeSubscribers: 4 }, reach: { impressions: 200 } } },
      { id: "2", body: "Segunda", reactions: 5, replies: 2, restacks: 1 },
    ],
  }));
  assert.equal(result.total.interactions, 28);
  assert.equal(result.total.freeSubscribers, 4);
  assert.equal(result.total.impressions, 200);
  assert.equal(result.detailedCount, 1);
  assert.equal(result.ranked[0].id, "1");
});

test("normalizeSnapshot sanitizes values and orders trends", () => {
  const snapshot = normalizeSnapshot({
    publication: "Carta Norte",
    metrics: { subscribers: "1200", openRate: "48.2", clickRate: "bad" },
    trend: [
      { date: "2026-08-02", subscribers: 12, followers: 41 },
      { date: "2026-08-01", subscribers: 10 },
    ],
  });

  assert.equal(snapshot.publication, "Carta Norte");
  assert.equal(snapshot.metrics.subscribers, 1200);
  assert.equal(snapshot.metrics.clickRate, 0);
  assert.equal(snapshot.trend.at(-1).followers, 41);
  assert.deepEqual(snapshot.trend.map((point) => point.date), ["2026-08-01", "2026-08-02"]);
});

test("formatters produce compact Spanish labels", () => {
  assert.match(formatCompactNumber(12500), /12,5.?mil/i);
  assert.equal(formatPercent(42.56), "42,6%");
});

test("getTrendSeries returns the requested tail and metric", () => {
  const trend = Array.from({ length: 5 }, (_, index) => ({
    date: `2026-08-0${index + 1}`,
    subscribers: 100 + index,
    paidSubscribers: 20 + index,
  }));
  assert.deepEqual(getTrendSeries({ trend }, "paidSubscribers", 2).map((item) => item.value), [23, 24]);
  assert.equal("opens" in normalizeSnapshot({ trend }).trend[0], false, "trend.opens nunca se rellenaba: campo muerto");
});

test("getDerivedMetrics calculates growth and conversion", () => {
  const derived = getDerivedMetrics({
    metrics: { subscribers: 1100, paidSubscribers: 110, openRate: 50 },
    previous: { subscribers: 1000, paidSubscribers: 100, openRate: 47 },
  });
  assert.equal(derived.subscriberGrowth, 10);
  assert.equal(derived.openRateDelta, 3);
  assert.equal(derived.paidConversion, 10);
});

test("getDerivedMetrics devuelve null, no un +100% inventado, sin valor anterior", () => {
  const derived = getDerivedMetrics({
    metrics: { subscribers: 500, paidSubscribers: 10, monthlyRevenue: 40 },
    previous: { subscribers: 0, paidSubscribers: 0, monthlyRevenue: 0 },
  });
  assert.equal(derived.subscriberGrowth, null, "sin base previa no hay porcentaje");
  assert.equal(derived.paidGrowth, null);
  assert.equal(derived.revenueGrowth, null);
});

test("getPublicationEngagement agrega interacciones de publicaciones en la ventana", () => {
  const now = new Date("2026-08-21T12:00:00Z").getTime();
  const result = getPublicationEngagement({ campaigns: [
    { date: "2026-08-20", views: 200, reactions: 8, comments: 3, shares: 2 },
    { date: "2026-08-01", views: 100, reactions: 4, comments: 1, shares: 1 },
    { date: "2026-06-01", views: 999, reactions: 99, comments: 99, shares: 99 },
  ] }, 30, now);
  assert.deepEqual(result, { posts: 2, views: 300, reactions: 12, comments: 4, shares: 3, interactions: 19 });
});

test("getNotesEngagement agrega senales publicas y detalle sin duplicarlas", () => {
  const now = new Date("2026-08-21T12:00:00Z").getTime();
  const result = getNotesEngagement({ notes: [
    { date: "2026-08-20", reactions: 7, replies: 2, restacks: 1, stats: { available: false } },
    { date: "2026-08-19", reactions: 0, replies: 0, restacks: 0, stats: { available: true, interactions: { total: 20, likes: 12, replies: 5, restacks: 3 }, reach: { impressions: 400 } } },
    { date: "2026-06-01", reactions: 99, replies: 99, restacks: 99 },
  ] }, 30, now);
  assert.deepEqual(result, { notes: 2, interactions: 30, likes: 19, comments: 7, restacks: 4, impressions: 400 });
});

test("los resúmenes conservan filas sin fecha porque ausencia no significa fuera de rango", () => {
  assert.equal(getPublicationEngagement({ campaigns: [{ reactions: 1 }] }, 7, Date.now()).posts, 1);
  assert.equal(getNotesEngagement({ notes: [{ reactions: 1 }] }, 7, Date.now()).notes, 1);
});

test("normalizeSnapshot preserves normalized Notes engagement", () => {
  const snapshot = normalizeSnapshot({
    notesSummary: { total: "3", reactions: 42, replies: 7, restacks: 5, interactions: 54, interactionsPerNote: 18, restackRate: 66.7, notesPerDay: 1.5 },
    notes: [{ id: 9, body: "Una idea breve", reactions: "12", replies: 2, stats: { available: true, interactions: { profileVisits: 53, saves: 13 }, results: { freeSubscribers: 13 } } }],
  });
  assert.equal(snapshot.notesSummary.total, 3);
  assert.equal(snapshot.notesSummary.interactionsPerNote, 18);
  assert.equal(snapshot.notesSummary.restackRate, 66.7);
  assert.equal(snapshot.notes[0].body, "Una idea breve");
  assert.equal(snapshot.notes[0].reactions, 12);
  assert.equal(snapshot.notes[0].restacks, 0);
  assert.equal(snapshot.notes[0].stats.interactions.profileVisits, 53);
  assert.equal(snapshot.notes[0].stats.results.freeSubscribers, 13);
});

test("normalizeSnapshot persiste el estado de captura de cada nota", () => {
  const snapshot = normalizeSnapshot({
    notes: [
      { id: 1, body: "Limitada", stats: { fetchState: "throttled", attempts: 2 } },
      { id: 2, body: "Perdida", stats: { fetchState: "inventado", attempts: -5 } },
      { id: 3, body: "Antigua", stats: { available: true } },
    ],
    notesSummary: { total: 3, detailAvailable: 1, detailPending: 0, detailUnavailable: 1, statsThrottled: true },
  });
  assert.equal(snapshot.notes[0].stats.fetchState, "throttled");
  assert.equal(snapshot.notes[0].stats.attempts, 2);
  assert.equal(snapshot.notes[1].stats.fetchState, "pending", "un estado desconocido no se guarda");
  assert.equal(snapshot.notes[1].stats.attempts, 0);
  assert.equal(snapshot.notes[2].stats.fetchState, "ready", "snapshots antiguos sin fetchState siguen siendo validos");
  assert.equal(snapshot.notesSummary.statsThrottled, true);
  assert.equal(snapshot.notesSummary.detailUnavailable, 1);
});

test("weightedRate pondera por entregados y no divide por cero", () => {
  const campaigns = [
    { delivered: 30, clicked: 15 },   // 50% pero solo 30 destinatarios
    { delivered: 3000, clicked: 60 }, // 2% con 3000 destinatarios
  ];
  // La media aritmetica daria 26%; la ponderada es la real.
  assert.equal(Math.round(weightedRate(campaigns, "clicked") * 100) / 100, 2.48);
  assert.equal(weightedRate([], "clicked"), 0);
  assert.equal(weightedRate([{ delivered: 0, clicked: 5 }], "clicked"), 0, "sin denominador no hay Infinity");
});

test("getRateWindows compara la ventana con la anterior del mismo tamano", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  const day = 86400000;
  const snapshot = { campaigns: [
    { id: "a", date: new Date(now - 5 * day).toISOString(), delivered: 100, opened: 50, clicked: 10 },
    { id: "b", date: new Date(now - 20 * day).toISOString(), delivered: 100, opened: 30, clicked: 4 },
    { id: "c", date: new Date(now - 200 * day).toISOString(), delivered: 100, opened: 90, clicked: 90 },
  ]};
  const windows = getRateWindows(snapshot, 10, now);
  assert.equal(windows.current.posts, 1);
  assert.equal(windows.current.clickRate, 10);
  assert.equal(windows.previous.posts, 1, "la ventana anterior son los 10 dias previos");
  assert.equal(windows.previous.clickRate, 4);
  assert.equal(getRateWindows(snapshot, 10, now).current.openRate, 50);
});

test("getRateWindows devuelve null, no cero, cuando no hay envios", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  const windows = getRateWindows({ campaigns: [] }, 30, now);
  assert.equal(windows.current.clickRate, null, "ausencia de envios no es un CTR del 0%");
  assert.equal(windows.previous.openRate, null);
});

test("getCampaignCuts pondera por entregados, excluye sin entrega y marca muestra escasa", () => {
  const { campaigns } = normalizeSnapshot({ campaigns: [
    { date: "2026-06-09", delivered: 30, opened: 30, wordcount: 100 },   // martes, 100%
    { date: "2026-06-16", delivered: 3000, opened: 30, wordcount: 100 }, // martes, 1%
    { date: "2026-06-10", delivered: 0, opened: 0, openRate: 99 },       // sin entrega: fuera
  ] });
  const cuts = getCampaignCuts(campaigns);
  const martes = cuts.byDay.find((row) => row.day === 2);
  assert.ok(martes, "2026-06-09 es martes en fecha civil, no lunes en zonas UTC negativas");
  assert.equal(martes.posts, 2);
  // La media simple daría 50,5%; la ponderada por entregados es la real.
  assert.equal(Math.round(martes.openRate * 100) / 100, 1.98);
  assert.equal(martes.scarce, true, "menos de MIN_CUT_N envíos se marca como muestra escasa");
  assert.equal(cuts.byDay.some((row) => row.day === 3), false, "un post sin entregas no crea corte");
  assert.deepEqual(cuts.byLength.map((row) => row.band), ["short"]);
  assert.equal(cuts.byLength[0].posts, 2);
});

test("getCampaignDiagnosis clasifica contra la mediana propia y exige muestra", () => {
  const post = (id, openRate, clicked) => ({ id, title: `Post ${id}`, date: "2026-08-01", delivered: 200, opened: 100, clicked, openRate });
  const pocos = getCampaignDiagnosis(normalizeSnapshot({ campaigns: [post("a", 50, 10), post("b", 40, 5)] }).campaigns);
  assert.equal(pocos.state, "insufficient", "con 2 envíos la mediana es una moneda al aire");
  assert.equal(pocos.sample, 2);

  const { campaigns } = normalizeSnapshot({ campaigns: [
    post("a", 60, 20), // abre y clica: ganador
    post("b", 50, 15), // abre pero no clica: contenido flojo
    post("c", 30, 18), // no abre pero clica: asunto flojo
    post("d", 20, 5),  // flojo total
  ] });
  const diagnosis = getCampaignDiagnosis(campaigns);
  assert.equal(diagnosis.state, "evidence");
  assert.equal(diagnosis.medianOpenRate, 40);
  assert.equal(diagnosis.medianCtor, 16.5);
  assert.deepEqual(diagnosis.quadrants.winner.map((p) => p.id), ["a"]);
  assert.deepEqual(diagnosis.quadrants.content.map((p) => p.id), ["b"]);
  assert.deepEqual(diagnosis.quadrants.subject.map((p) => p.id), ["c"]);
  assert.deepEqual(diagnosis.quadrants.weak.map((p) => p.id), ["d"]);
});

test("getChannelAttribution compara la eficiencia de emails y notas sin fabricar ceros", () => {
  const now = Date.parse("2026-08-21T12:00:00Z");
  const day = 86400000;
  const iso = (offset) => new Date(now - offset * day).toISOString();
  const attribution = getChannelAttribution({
    campaigns: [
      { date: iso(5), delivered: 100, signupsWithin1Day: 6 },
      { date: iso(40), delivered: 100, signupsWithin1Day: 99 }, // fuera de ventana
      { date: iso(3), delivered: 0, signupsWithin1Day: 99 },    // sin entrega: fuera
    ],
    notes: [
      { id: "n1", date: iso(2), stats: { available: true, results: { freeSubscribers: 3 }, interactions: {}, reach: {} } },
      { id: "n2", date: iso(3) }, // sin detalle: no cuenta como cero
    ],
  }, 30, now);
  assert.equal(attribution.email.signups, 6);
  assert.equal(attribution.email.pieces, 1);
  assert.equal(attribution.email.perPiece, 6);
  assert.equal(attribution.notes.signups, 3);
  assert.equal(attribution.notes.pieces, 2);
  assert.equal(attribution.notes.scoredPieces, 1);
  assert.equal(attribution.notes.perPiece, 3, "la eficiencia se calcula sobre las notas medidas");
});

test("getOwnOpenRateMedian sustituye al benchmark inventado del 42%", () => {
  const snapshot = { campaigns: [
    { delivered: 100, openRate: 30 },
    { delivered: 100, openRate: 50 },
    { delivered: 100, openRate: 40 },
    { delivered: 0, openRate: 99 },   // sin envio: fuera
  ]};
  assert.equal(getOwnOpenRateMedian(snapshot), 40);
  assert.equal(getOwnOpenRateMedian({ campaigns: [] }), null, "sin publicaciones no hay referencia");
});
