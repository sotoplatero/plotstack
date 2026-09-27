import test from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_MIN,
  getInsights,
  robustBaseline,
  robustZ,
  rollingOutliers,
  typicalBand,
} from "../src/shared/insights.js";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const DAY = 86400000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const civil = (daysAgo) => iso(daysAgo).slice(0, 10);

// Interacciones públicas con algo de ruido para que el MAD no sea cero.
const wobble = (index) => [4, 6, 5, 7, 3, 6, 5, 4, 8, 5][index % 10];

const note = (id, daysAgo, score, extra = {}) => ({
  id: String(id),
  body: extra.body || `Nota ${id}`,
  date: iso(daysAgo),
  reactions: score,
  replies: 0,
  restacks: 0,
  url: "",
  stats: extra.stats || { available: false },
});

const detailed = (freeSubscribers, impressions, interactions = 10) => ({
  available: true,
  interactions: { total: interactions },
  results: { freeSubscribers, paidSubscribers: 0 },
  reach: { impressions },
  audience: { Subscribers: 50, Followers: 20, Unconnected: 130 },
});

// 40 notas, una cada 2 días; la más reciente (índice 0) es la protagonista.
const notesWith = (hero) => Array.from({ length: 40 }, (_, index) => note(index, index * 2, index === 0 ? hero : wobble(index)));

const byId = (result, id) => Object.values(result.groups).flat().find((insight) => insight.id === id);

test("robustBaseline exige muestra minima y resiste una nota viral", () => {
  assert.equal(robustBaseline([1, 2, 3]), null);
  const base = robustBaseline([5, 5, 6, 4, 5, 6, 4, 5, 5, 6, 900]);
  assert.ok(base.median > 4 && base.median < 7, "la viral no mueve la mediana");
  assert.ok(robustZ(900, base) > 2);
});

test("robustZ devuelve null con MAD cero en vez de Infinity", () => {
  const base = robustBaseline(Array(BASELINE_MIN).fill(5));
  assert.equal(base.mad, 0);
  assert.equal(robustZ(50, base), null);
});

test("typicalBand da la mitad central y null con pocos valores", () => {
  assert.equal(typicalBand([1, 2, 3]), null);
  assert.deepEqual(typicalBand([1, 2, 3, 4, 5]), [2, 4]);
});

test("rollingOutliers compara cada pieza solo con sus anteriores", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: index, value: index < 11 ? wobble(index) : 60 }));
  const { rows: evaluated } = rollingOutliers(rows, (row) => row.value, (row) => row.id >= 10);
  assert.equal(evaluated.length, 2);
  assert.equal(evaluated[0].baseline.n, 10);
  assert.ok(evaluated[1].z > 2, "la ultima destaca frente a las 11 anteriores");
});

test("rollingOutliers deja fuera las piezas sin medicion", () => {
  const rows = [{ id: 1, value: null }, { id: 2, value: 3 }];
  const { measured } = rollingOutliers(rows, (row) => row.value, () => true);
  assert.equal(measured.length, 1);
});

test("una nota muy por encima de su base se destaca con tira y ejemplo", () => {
  const result = getInsights({ snapshot: { notes: notesWith(60) }, days: 30, now: NOW });
  const insight = byId(result, "note-outlier");
  assert.ok(insight, "detecta la nota");
  assert.match(insight.text, /más interacciones que tu nota típica/);
  assert.equal(insight.examples[0].id, "0");
  assert.ok(insight.strip.points.some((point) => point.highlight && point.id === "0"));
  assert.deepEqual(insight.target.noteIds, ["0"]);
  assert.equal(result.groups.notas[0].id, "note-outlier", "la nota con prueba encabeza su vista por relevancia");
});

test("sin nota atipica no hay hallazgo ni silencio", () => {
  const result = getInsights({ snapshot: { notes: notesWith(6) }, days: 30, now: NOW });
  assert.equal(byId(result, "note-outlier"), undefined);
  assert.ok(!result.silent.some((row) => /Notas fuera de lo habitual/.test(row.text)));
});

test("con pocas notas el detector calla y lo declara", () => {
  const notes = Array.from({ length: 5 }, (_, index) => note(index, index, index === 0 ? 90 : 4));
  const result = getInsights({ snapshot: { notes }, days: 30, now: NOW });
  assert.equal(byId(result, "note-outlier"), undefined);
  assert.ok(result.silent.some((row) => row.group === "notas" && /Notas fuera de lo habitual/.test(row.text)));
});

test("sin notas en el rango el detector no aplica ni deja silencio", () => {
  const result = getInsights({ snapshot: { notes: notesWith(60).map((row) => ({ ...row, date: iso(400) })) }, days: 30, now: NOW });
  assert.ok(!result.silent.some((row) => /Notas fuera/.test(row.text)));
});

test("la conversion solo cuenta notas con detalle: null no es cero", () => {
  const notes = Array.from({ length: 30 }, (_, index) => note(index, index * 2, 5, {
    stats: index === 0 ? detailed(20, 1000) : index % 2 ? { available: false } : detailed(1 + (index % 3), 1000 + index * 40),
  }));
  const result = getInsights({ snapshot: { notes }, days: 30, now: NOW });
  const insight = byId(result, "note-converter");
  assert.ok(insight, "la nota 0 convierte muy por encima");
  assert.ok(insight.strip.points.every((point) => Number(point.id) % 2 === 0), "las notas sin detalle no entran como cero");
});

test("la concentracion de altas se enuncia con sus tres notas", () => {
  const notes = Array.from({ length: 8 }, (_, index) => note(index, index, 5, { stats: detailed(index < 3 ? 30 : 2, 1000) }));
  const result = getInsights({ snapshot: { notes }, days: 30, now: NOW });
  const insight = byId(result, "note-concentration");
  assert.ok(insight);
  assert.equal(insight.examples.length, 3);
  assert.match(insight.text, /^3 notas trajeron el \d+%/);
});

test("un rasgo solo se enuncia con muestra holgada y efecto grande", () => {
  const notes = Array.from({ length: 24 }, (_, index) => {
    const question = index % 2 === 0;
    return note(index, index, 5, {
      body: question ? `Algo pasó hoy ${index}. ¿Y tú qué harías?` : `Algo pasó hoy ${index}. Lo cuento mañana.`,
      stats: detailed(0, 500, question ? 40 + (index % 5) : 10 + (index % 5)),
    });
  });
  const result = getInsights({ snapshot: { notes }, days: 30, now: NOW });
  const insight = byId(result, "note-trait:endsWithQuestion:true");
  assert.ok(insight, "detecta el cierre con pregunta");
  assert.match(insight.text, /^Tus notas que terminan en pregunta reciben/);
  assert.match(insight.action, /^Prueba: cierra con pregunta/);

  const pocas = getInsights({ snapshot: { notes: notes.slice(0, 10) }, days: 30, now: NOW });
  assert.equal(byId(pocas, "note-trait:endsWithQuestion:true"), undefined);
  assert.ok(pocas.silent.some((row) => /Qué rasgos/.test(row.text)));
});

const campaign = (id, daysAgo, extra = {}) => ({
  id: String(id),
  title: extra.title || `Post ${id}`,
  date: civil(daysAgo),
  delivered: 1000,
  opened: extra.opened ?? 450,
  clicked: extra.clicked ?? 40,
  signupsWithin1Day: extra.signups ?? wobble(id),
  section: extra.section || "",
});

test("un envio que trae muchas mas altas que su base se destaca", () => {
  const campaigns = Array.from({ length: 20 }, (_, index) => campaign(index, index * 7, index === 0 ? { signups: 50, title: "Cómo cobro" } : {}));
  const result = getInsights({ snapshot: { campaigns }, days: 30, now: NOW });
  const insight = byId(result, "post-outlier");
  assert.ok(insight);
  assert.match(insight.text, /^«Cómo cobro» trajo/);
  assert.equal(insight.target.view, "publicaciones");
});

test("apertura y CTR no se repiten como hallazgo: ya los dan sus tarjetas", () => {
  const campaigns = [
    campaign(1, 3, { opened: 400 }), campaign(2, 10, { opened: 420 }),
    campaign(3, 35, { opened: 500 }), campaign(4, 45, { opened: 490 }),
  ];
  const result = getInsights({ snapshot: { campaigns }, days: 30, now: NOW });
  assert.equal(byId(result, "rate-open"), undefined);
  assert.equal(byId(result, "rate-click"), undefined);
});

test("la fuente lider respeta los umbrales y usa la ventana del rango", () => {
  const analytics = { growth: { sources: {
    30: { sources: [{ label: "Substack App", subscribers: 40 }, { label: "direct", subscribers: 10 }], totals: { subscribers: 50 } },
    7: { sources: [{ label: "Substack App", subscribers: 2 }], totals: { subscribers: 2 } },
  } } };
  const mes = getInsights({ snapshot: {}, analytics, days: 30, now: NOW });
  assert.match(byId(mes, "source-leader").text, /aporta el 80%/);
  const semana = getInsights({ snapshot: {}, analytics, days: 7, now: NOW });
  assert.equal(byId(semana, "source-leader"), undefined);
  assert.ok(semana.silent.some((row) => row.group === "crecimiento"));
});

test("cada hallazgo aparece una sola vez, en su vista y por relevancia", () => {
  const notes = notesWith(60).map((row, index) => ({ ...row, stats: index === 0 ? detailed(40, 1000) : detailed(1 + (index % 3), 1000 + index * 30) }));
  const campaigns = Array.from({ length: 20 }, (_, index) => campaign(index, index * 7, index === 0 ? { signups: 50 } : {}));
  const result = getInsights({ snapshot: { notes, campaigns }, days: 30, now: NOW });
  const all = Object.values(result.groups).flat();
  assert.equal(new Set(all.map((row) => row.id)).size, all.length, "ningún hallazgo se repite");
  assert.equal(all.length, result.total);
  for (const [group, rows] of Object.entries(result.groups)) {
    assert.ok(rows.every((row) => row.group === group), `${group} solo contiene los suyos`);
    assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].score >= row.score), `${group} va por relevancia`);
  }
});

test("ningun hallazgo emite Infinity, NaN ni cifras de pago", () => {
  const notes = notesWith(60).map((row) => ({ ...row, stats: detailed(0, 0) }));
  const result = getInsights({ snapshot: { notes, metrics: { paidSubscribers: 99, monthlyRevenue: 5000 } }, days: Infinity, now: NOW });
  const text = JSON.stringify(result);
  assert.ok(!/Infinity|NaN|∞/.test(text));
  assert.ok(!/pago|ingreso|€|\$/.test(text));
});

test("un snapshot vacio no rompe y no inventa nada", () => {
  const result = getInsights({});
  assert.equal(result.total, 0);
});
