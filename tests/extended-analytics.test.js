import test from "node:test";
import assert from "node:assert/strict";
import {
  getExtendedAnalytics,
  normalizeAudience,
  normalizeTimeseries,
  normalizeAudienceLocation,
  normalizeSubscriberGrowth,
  normalizeRetention,
  getSubscriberTimeline,
  normalizeGrowthSources,
  normalizeGrowthEvents,
  normalizeNetworkAttribution,
  normalizeVisitorSources,
  normalizeGrowthBenchmark,
  normalizeAudienceOverlap,
} from "../src/providers/substack-extended.js";

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("extended normalizers accept the known Substack variants", () => {
  // El payload real usa barras; se normaliza a ISO para que parseDay lo trate
  // como fecha civil y no desplace el dia.
  assert.deepEqual(normalizeTimeseries([["2026/08/17", 120]])[0], { date: "2026-08-17", value: 120 });
  assert.deepEqual(
    normalizeTimeseries([["2026/08/17", 120], ["2026/08/2", 4]]).map((p) => p.date),
    ["2026-08-02", "2026-08-17"],
    "ordenado y con dia de un digito rellenado",
  );
});

test("normaliza ubicación, crecimiento y retención sin fabricar datos", () => {
  assert.deepEqual(normalizeAudienceLocation([{ location: "ES", value: 43 }]), [{ code: "ES", value: 43 }]);
  const growth = normalizeSubscriberGrowth({ subscriberGrowth: [
    { dt: "2026-08-20", new_free: 3, num_unsubs: 1 },
    { dt: "2026-08-21", new_free: 2, num_expirations: 1 },
  ] });
  assert.deepEqual(growth.totals, { new: 5, losses: 2, net: 3 });
  assert.equal(growth.daily[0].date, "2026-08-20");
  // Las claves presentes se SUMAN. Con "primer finito", un `new_free: 0`
  // tapaba las altas de pago de la misma fila y la vista de pago salía a cero.
  const pago = normalizeSubscriberGrowth({ subscriberGrowth: [
    { dt: "2026-08-22", new_free: 0, new_paid: 3, num_unsubs: 0, num_expirations: 1 },
  ] });
  assert.deepEqual(pago.totals, { new: 3, losses: 1, net: 2 });
  // Los alias solo entran si ninguna clave principal viene en la fila.
  const alias = normalizeSubscriberGrowth({ subscriberGrowth: [
    { dt: "2026-08-23", new_subscribers: 4, unsubscribes: 2 },
  ] });
  assert.deepEqual(alias.totals, { new: 4, losses: 2, net: 2 });
  assert.deepEqual(normalizeRetention({ cohortStats: {} }).cohorts, []);
  assert.deepEqual(normalizeRetention({ rates: [{ months_since_subscription: 1, rate: 0.82, comparison: 0.04 }] }).rates,
    [{ month: 1, rate: 0.82, comparison: 0.04 }]);
});

// Payload real capturado en docs/product/substack-payloads-observados.md:
// chartCounts es UN punto agregado, no un mapa de fechas ni una serie.
test("normalizeAudience lee chartCounts como el agregado que es", () => {
  const audience = normalizeAudience({
    count: 97,
    lastSync: "2026-08-19T00:00:00Z",
    chartCounts: {
      created_at: "2026-06-10T01:57:08.139Z",
      subscribers: 0,
      lifetime_subscribers: 4,
      comp_subscribers: 1,
      gift_subscribers: 2,
      free_trial_subscribers: 0,
      founding_subscribers: 3,
      totalEmail: 97,
    },
  });
  assert.equal(audience.total, 97);
  assert.equal(audience.emailable, 97);
  assert.equal(audience.composition.foundingSubscribers, 3);
  assert.equal(audience.composition.lifetimeSubscribers, 4);
  assert.deepEqual(audience.history, [], "este endpoint no devuelve serie: no se inventa una");
});

test("normalizeAudience ya no fabrica puntos con las claves como fechas", () => {
  const audience = normalizeAudience({ count: 97, chartCounts: { created_at: "2026-06-10", subscribers: 0, totalEmail: 97 } });
  assert.equal(audience.history.length, 0, "antes salian 3 puntos falsos en cero y el grafico los dibujaba");
});

test("getExtendedAnalytics aisla fallos y descarta la PII de suscriptores", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/subscriber-stats")) {
      return response({ count: 713, subscribers: [{ user_email_address: "private@example.com", user_name: "Ada", subscription_created_at: "2026-08-01T10:00:00Z", subscription_interval: "free" }], chartCounts: { totalEmail: 713 } });
    }
    if (url.includes("growth/sources")) return response({
      totals: [{ name: "traffic", total: 100 }, { name: "subscribers", total: 27 }],
      sourceMetrics: [{ source: "substack", sourceName: "Substack", metrics: [{ name: "Subscribers", total: 27, timeseries: [] }] }],
    });
    if (url.includes("followers/timeseries")) return response([["2026/08/01", 700]]);
    if (url.includes("audience_insights/location/total")) return response({ global: { locations: 19 }, usa: { locations: 4 } });
    if (url.includes("audience_insights/location")) return response([{ location: "ES", value: 43 }]);
    if (url.includes("paid_subscriber_growth")) return response({ subscriberGrowth: [{ dt: "2026-08-01", new_free: 3, num_unsubs: 1 }] });
    if (url.includes("subscriber_retention/summary")) return response({ rates: [{ months_since_subscription: 1, rate: 0.8 }] });
    if (url.includes("subscriber_retention")) return response({ cohortStats: {} });
    return response({}, 404);
  };

  try {
    const analytics = await getExtendedAnalytics({ subdomain: "carta" });
    assert.equal(analytics.audience.total, 713);
    // Las fuentes van por ventana: el selector del dashboard elige cual.
    assert.equal(analytics.growth.sources["30"].totals.subscribers, 27);
    assert.deepEqual(Object.keys(analytics.growth.sources).sort(), ["30", "7", "90", "all"]);
    assert.equal(analytics.audience.followers.history[0].value, 700);
    assert.equal(analytics.audience.location.rows[0].code, "ES");
    assert.equal(analytics.growth.subscribers.free.totals.net, 2);
    assert.equal(analytics.retention.free.rates[0].rate, 0.8);
    assert.equal(JSON.stringify(analytics).includes("private@example.com"), false, "ni un email se persiste");
    assert.equal(JSON.stringify(analytics).includes("Ada"), false);

    // Solo quedan fuentes que alimentan algo. Las rutas retiradas
    // (network_attribution 500, recommendations 400, payment_pledges 400,
    // pledges/plans, post_management/counts y publication_export) ya no se piden.
    assert.deepEqual(analytics.coverage.map((row) => row.key),
      ["audience", "subscriberTimeline", "growthSources", "visitorSources", "networkAttribution", "trafficTimeseries", "growthBenchmark", "audienceOverlap", "followerTimeseries", "audienceLocation", "freeSubscriberGrowth", "paidSubscriberGrowth", "freeRetention", "paidRetention"]);
    assert.equal(requests.some((item) => item.url.includes("growth/events")), false, "la lista editorial duplicada ya no se pide");
    // `network_attribution` vuelve, pero SIEMPRE con `time_window`: sin el
    // responde 500, que es lo que hizo creer que la ruta estaba rota.
    const red = requests.filter((item) => item.url.includes("network_attribution"));
    assert.equal(red.length, 4, "una peticion por ventana del selector");
    assert.equal(red.every((item) => item.url.includes("time_window=")), true);
    for (const ruta of ["recommendations/stats", "payment_pledges", "pledges/plans", "post_management/counts", "publication_export"]) {
      assert.equal(requests.some((item) => item.url.includes(ruta)), false, `${ruta} ya no se pide`);
    }
    assert.deepEqual(Object.keys(analytics).sort(),
      ["audience", "coverage", "growth", "period", "retention", "syncedAt", "traffic", "version"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getSubscriberTimeline reconstruye la serie diaria y descarta la PII", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  // Formas reales: subscription_type viene null, is_subscribed es false para los
  // gratuitos, y subscription_interval es el corte que de verdad separa.
  const rows = [
    { subscription_created_at: "2026-08-18T10:00:00Z", user_email_address: "a@example.com", user_name: "Ada", is_subscribed: false, subscription_interval: "free", subscription_type: null, activity_rating: 5, total_revenue_generated: 0 },
    { subscription_created_at: "2026-08-18T22:00:00Z", user_email_address: "b@example.com", is_subscribed: false, subscription_interval: "month", subscription_type: null, activity_rating: 1, total_revenue_generated: 40 },
    { subscription_created_at: "2026-06-10T01:00:00Z", user_email_address: "c@example.com", is_subscribed: true, subscription_interval: "lifetime", subscription_type: null, activity_rating: 0, is_founding: true },
    { subscription_created_at: "", user_email_address: "d@example.com", is_subscribed: false, subscription_interval: "free", activity_rating: 0 },
  ];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response({ count: 4, subscribers: rows });
  };
  try {
    const timeline = await getSubscriberTimeline("https://carta.substack.com/api/v1");
    assert.equal(bodies.length, 1, "una pagina incompleta corta la paginacion");
    assert.equal(bodies[0].limit, 100, "limit 200 responde 400 en la API real");
    assert.equal(timeline.total, 4);
    assert.equal(timeline.counted, 4);
    assert.equal(timeline.partial, false);
    assert.deepEqual(timeline.daily.map((point) => point.date), ["2026-06-10", "2026-08-18"], "ordenado ascendente y sin la fila sin fecha");
    assert.equal(timeline.daily[1].signups, 2);
    assert.equal(timeline.daily[1].paidSignups, 1);
    assert.equal(timeline.daily[0].cumulative, 1);
    assert.equal(timeline.daily[1].cumulative, 3, "el acumulado suma en orden cronologico");
    assert.equal(timeline.composition.paid, 2, "revenue>0 y is_founding cuentan como pago; is_subscribed no");
    assert.equal(timeline.composition.founding, 1);
    assert.deepEqual(timeline.engagement, { alta: 1, baja: 1, inactiva: 2 });
    assert.deepEqual(
      timeline.byInterval.map((row) => row.interval).sort(),
      ["free", "lifetime", "month"],
    );
    assert.equal(JSON.stringify(timeline).includes("example.com"), false, "ni un email sale de la funcion");
    assert.equal(JSON.stringify(timeline).includes("Ada"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getSubscriberTimeline marca la serie como parcial cuando trunca", async () => {
  const originalFetch = globalThis.fetch;
  const page = Array.from({ length: 100 }, (_, index) => ({
    subscription_created_at: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T10:00:00Z`,
    is_subscribed: true,
  }));
  globalThis.fetch = async () => response({ count: 5000, subscribers: page });
  try {
    const timeline = await getSubscriberTimeline("https://carta.substack.com/api/v1", { maxPages: 2 });
    assert.equal(timeline.counted, 200);
    assert.equal(timeline.total, 5000);
    assert.equal(timeline.partial, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regresion: is_subscribed es false para casi toda la lista gratuita. Contarlo
// como baja mostraba "96 bajas" sobre 97 suscriptores.
test("getSubscriberTimeline no confunde is_subscribed con una baja", async () => {
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 96 }, () => ({
    subscription_created_at: "2026-08-18T10:00:00Z",
    subscription_interval: "free",
    is_subscribed: false,
    activity_rating: 5,
    total_revenue_generated: 0,
  }));
  globalThis.fetch = async () => response({ count: 96, subscribers: rows });
  try {
    const timeline = await getSubscriberTimeline("https://carta.substack.com/api/v1");
    assert.equal(timeline.composition.paid, 0, "ninguno paga: intervalo free y sin ingresos");
    assert.equal(timeline.engagement.alta, 96);
    assert.equal(Object.keys(timeline.composition).includes("unsubscribed"), false, "no existe un campo de bajas observado");
    assert.deepEqual(timeline.byInterval, [{ interval: "free", count: 96 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Forma real capturada: {sourceMetrics, totals}. `normalizeAcquisitionRows`
// buscaba rows/items/data/sources y devolvia [], asi que Crecimiento salia vacia.
test("normalizeGrowthSources lee sourceMetrics con sus hijos y totales", () => {
  const growth = normalizeGrowthSources({
    totals: [{ name: "traffic", total: 927 }, { name: "subscribers", total: 99 }, { name: "revenue", total: 0 }],
    sourceMetrics: [{
      source: "substack", sourceName: "Substack", category: "Substack",
      metrics: [
        { name: "Traffic", total: 226, timeseries: [{ date: "2026/08/19", value: 226 }] },
        { name: "Subscribers", total: 75, timeseries: [{ date: "2026/08/19", value: 75 }] },
        { name: "Revenue", total: 0, timeseries: [] },
      ],
      children: [{ source: "substack notes", sourceName: "Notes", metrics: [{ name: "Subscribers", total: 40, timeseries: [] }] }],
    }],
  });
  assert.deepEqual(growth.totals, { visitors: 927, subscribers: 99, revenue: 0 });
  assert.equal(growth.sources.length, 1);
  assert.equal(growth.sources[0].label, "Substack");
  assert.equal(growth.sources[0].visitors, 226);
  assert.equal(growth.sources[0].subscribers, 75);
  assert.deepEqual(growth.sources[0].series, [{ date: "2026-08-19", value: 75 }], "series es la de altas, y la fecha pasa a ISO");
  assert.equal(growth.sources[0].children[0].label, "Notes", "las recomendaciones y notas viven aqui");
  assert.equal(growth.sources[0].children[0].subscribers, 40);
});

test("normalizeGrowthSources devuelve estructura vacia sin sourceMetrics", () => {
  const growth = normalizeGrowthSources({});
  assert.deepEqual(growth.sources, []);
  assert.deepEqual(growth.totals, { visitors: 0, subscribers: 0, revenue: 0 });
});

test("normalizeGrowthEvents acepta pubEvents y no inventa conteos", () => {
  const events = normalizeGrowthEvents({ pubEvents: [{ id: 211298012, date: "2026-08-15T14:08:46.592Z", title: "La forma mas inteligente", slug: "la-forma", type: "text" }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].label, "La forma mas inteligente");
  assert.equal(events[0].type, "text");
  assert.equal("subscribers" in events[0], false, "el payload real no trae conteos: no se fabrican");
});

test("normalizeRetention acepta las formas conocidas de cohorte y descarta las demas", () => {
  // Forma A: filas con mes y tasa explicitos.
  const filas = normalizeRetention({
    cohortStats: {
      "2026-05": [{ months_since_subscription: 0, rate: 1 }, { months_since_subscription: 1, rate: 0.86 }],
    },
  });
  assert.deepEqual(filas.cohorts, [{ cohort: "2026-05", points: [{ month: 0, rate: 1 }, { month: 1, rate: 0.86 }] }]);

  // Forma B: numeros sueltos, donde la posicion ES el mes.
  const numeros = normalizeRetention({ cohortStats: { "2026-06": [1, 0.8, 0.7] } });
  assert.deepEqual(numeros.cohorts[0].points, [{ month: 0, rate: 1 }, { month: 1, rate: 0.8 }, { month: 2, rate: 0.7 }]);

  // Forma desconocida: se descarta en vez de interpretarla mal.
  assert.deepEqual(normalizeRetention({ cohortStats: { "2026-07": { raro: true } } }).cohorts, []);
  assert.deepEqual(normalizeRetention({ cohortStats: {} }).cohorts, []);
  assert.deepEqual(normalizeRetention({}).cohorts, []);
});

test("la fuente audience no repite la peticion que ya hizo la timeline", async () => {
  const originalFetch = globalThis.fetch;
  const cuerpos = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes("subscriber-stats")) {
      cuerpos.push(JSON.parse(options.body));
      return response({
        count: 97,
        chartCounts: { totalEmail: 97, lifetime_subscribers: 1 },
        subscribers: [{ subscription_created_at: "2026-08-01T00:00:00Z", subscription_interval: "free", activity_rating: 4 }],
      });
    }
    return response({});
  };
  try {
    const analytics = await getExtendedAnalytics({ subdomain: "carta" });
    // Antes eran dos llamadas: una con limit 1 solo para leer chartCounts.
    assert.equal(cuerpos.length, 1, `subscriber-stats se pide una sola vez, se pidio ${cuerpos.length}`);
    assert.equal(cuerpos[0].limit, 100, "la unica llamada es la de la serie, no la de limit 1");
    assert.equal(analytics.audience.total, 97);
    assert.equal(analytics.audience.emailable, 97);
    // La fila de Cobertura sigue existiendo para que el usuario vea su estado.
    const fila = analytics.coverage.find((row) => row.key === "audience");
    assert.equal(fila.label, "Audiencia");
    assert.equal(fila.status, "ready");
    // Y de aqui no sale PII, aunque el payload la traiga.
    assert.equal(JSON.stringify(analytics).includes("subscription_created_at"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizeNetworkAttribution suma los suscriptores, porque `total` es el numero de filas", () => {
  // Payload real: total = 4 filas, pero el donut del panel dice 114.
  const red = normalizeNetworkAttribution({
    total: 4,
    rows: [
      { label: "Substack App", subs_count: 80, pct_time_window_total: 0.7017, data_updated_at: "2026-09-04T01:30:20.196Z" },
      { label: "Other Substack Network", subs_count: 6, pct_time_window_total: 0.0526 },
      { label: "Substack existing accounts", subs_count: 24, pct_time_window_total: 0.2105 },
      { label: "Imported accounts", subs_count: 4, pct_time_window_total: 0.035 },
    ],
  });
  assert.equal(red.total, 114, "tomar `total` del payload daria 4 suscriptores");
  assert.equal(red.rows[0].label, "Substack App");
  assert.equal(red.rows[0].subscribers, 80);
  assert.equal(red.updatedAt, "2026-09-04T01:30:20.196Z");
  assert.deepEqual(normalizeNetworkAttribution({}), { rows: [], total: 0, updatedAt: "" });
});

test("normalizeVisitorSources no confunde un null de altas con cero altas", () => {
  const fuentes = normalizeVisitorSources({
    total: 23,
    rows: [
      { source: "direct to app", source_category: "Direct", views: 892, users: 272, free_signup: 8, subscribed: 0 },
      // Las filas de email vienen con null: no se midieron altas ahi.
      { source: "email opens", source_category: "Email", views: 122, users: 90, free_signup: null, subscribed: null },
    ],
  });
  assert.equal(fuentes.rows[0].views, 892);
  assert.equal(fuentes.rows[0].users, 272);
  assert.equal(Math.round(fuentes.rows[0].conversion * 100) / 100, 2.94);
  assert.equal(fuentes.rows[1].freeSignups, null, "null no es 0: no se midio");
  assert.equal(fuentes.rows[1].conversion, null, "sin altas medidas no hay conversion");
  assert.equal(fuentes.totals.views, 1014);
  assert.equal(fuentes.totals.freeSignups, 8, "el null no suma como cero");
});

test("normalizeGrowthBenchmark pasa la tasa a porcentaje y traduce el veredicto", () => {
  const marca = normalizeGrowthBenchmark({
    growth_rate: 0.407407,
    period_length: 30,
    total_new_subs: 36,
    num_expirations: -3,
    comparison_outcome: "above_average",
    period: "last 30 days",
  });
  assert.equal(Math.round(marca.growthRate * 10) / 10, 40.7);
  assert.equal(marca.periodDays, 30);
  assert.equal(marca.newSubscribers, 36);
  assert.equal(marca.expirations, 3, "el payload lo da en negativo");
  assert.match(marca.outcomeCopy, /media de Substack/);
  // Sin veredicto no se inventa uno.
  assert.equal(normalizeGrowthBenchmark({}).outcomeCopy, "");
  assert.equal(normalizeGrowthBenchmark({}).growthRate, null);
});

test("normalizeAudienceOverlap se queda con el nombre y tira la configuracion ajena", () => {
  const solape = normalizeAudienceOverlap([
    { percentOverlap: "0.39", pub: { name: "Mafia IA", subdomain: "aimafia", copyright: "Ai Mafia Club", author_id: 1, stripe_user_id: "acct_x" } },
    { percentOverlap: "0.19", pub: { name: "How to AI", subdomain: "ruben" } },
    { percentOverlap: "0", pub: { name: "Sin solape", subdomain: "nada" } },
  ]);
  assert.deepEqual(solape, [
    { name: "Mafia IA", subdomain: "aimafia", share: 0.39 },
    { name: "How to AI", subdomain: "ruben", share: 0.19 },
  ]);
  assert.equal(JSON.stringify(solape).includes("stripe"), false, "no viaja la configuracion de la otra publicacion");
});
