import test from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_MIN_N,
  extractNoteFeatures,
  getCadenceCalendar,
  getCadenceHeatmap,
  getContentAnalytics,
  getContentFindings,
  getFeatureInsights,
  getNoteAttributionTimeline,
  getNotesTimeline,
} from "../src/shared/content-analytics.js";

// `note_stats` no devuelve seguidores ni ingresos: los resultados observados son
// "New free subs"/"New paid subs" y las impresiones. Ver substack-payloads-observados.md
const stats = (interactions, extra = {}) => ({
  available: true,
  interactions: { total: interactions, profileVisits: extra.profileVisits || 0 },
  results: { freeSubscribers: extra.freeSubscribers || 0, paidSubscribers: 0 },
  reach: { impressions: extra.impressions ?? interactions * 10 },
});

const note = (id, body, date = "2026-08-17T10:00:00Z", noteStats = null) => ({
  id: String(id),
  body,
  date,
  reactions: 12,
  replies: 3,
  restacks: 1,
  url: "",
  stats: noteStats || { available: false },
});

const corpus = (count, build) => Array.from({ length: count }, (_, index) => build(index));

test("extractNoteFeatures detects Spanish question hooks", () => {
  const opening = extractNoteFeatures(note(1, "¿Por qué nadie lee tus notas? Te cuento la razón."));
  assert.equal(opening.flags.hookIsQuestion, true);

  const plain = extractNoteFeatures(note(2, "Nadie lee tus notas."));
  assert.equal(plain.flags.hookIsQuestion, false);

  const closing = extractNoteFeatures(note(3, "Escribe mejor. ¿Te atreves?"));
  assert.equal(closing.flags.hookIsQuestion, false);
  assert.equal(closing.flags.endsWithQuestion, true);
});

test("extractNoteFeatures recognizes emoji without matching digits", () => {
  assert.equal(extractNoteFeatures(note(1, "Publiqué 3 notas hoy")).flags.hasEmoji, false);
  assert.equal(extractNoteFeatures(note(1, "Publiqué 3 notas hoy")).flags.hasNumber, true);
  assert.equal(extractNoteFeatures(note(2, "Publiqué 3 notas 🚀")).flags.hasEmoji, true);
  assert.equal(extractNoteFeatures(note(3, "Cifras: 100%")).flags.hasEmoji, false);
});

test("extractNoteFeatures ignores digits inside links", () => {
  const features = extractNoteFeatures(note(1, "Mira https://carta.substack.com/p/edicion-12"));
  assert.equal(features.flags.hasLink, true);
  assert.equal(features.flags.hasNumber, false);
  assert.equal(features.flags.hasMention, false);
});

test("extractNoteFeatures separates mentions from email addresses", () => {
  assert.equal(extractNoteFeatures(note(1, "Gracias @ada por la idea")).flags.hasMention, true);
  assert.equal(extractNoteFeatures(note(2, "Escríbeme a ada@carta.com")).flags.hasMention, false);
});

test("extractNoteFeatures treats the placeholder body as empty", () => {
  const features = extractNoteFeatures(note(1, "Nota sin texto"));
  assert.equal(features.empty, true);
  assert.equal(features.flags.hookIsQuestion, null);
  assert.equal(features.bands.lengthBand, null);
  assert.equal(features.weekStart, "2026-08-17");
});

test("extractNoteFeatures buckets day and hour with the caller timezone", () => {
  const shifted = extractNoteFeatures(note(1, "Una nota propia", "2026-08-17T23:30:00Z"), {
    timeZoneOffsetMinutes: 120,
  });
  assert.equal(shifted.bands.dayOfWeek, "tue");
  assert.equal(shifted.bands.hourBucket, "night");

  const utc = extractNoteFeatures(note(1, "Una nota propia", "2026-08-17T23:30:00Z"));
  assert.equal(utc.bands.dayOfWeek, "mon");
  assert.equal(utc.bands.hourBucket, "evening");
});

test("extractNoteFeatures leaves outcomes null when stats are unavailable", () => {
  const features = extractNoteFeatures(note(1, "Idea & contexto"));
  assert.equal(features.scorable, false);
  assert.deepEqual(features.outcomes, {
    interactions: null,
    profileVisits: null,
    impressions: null,
    freeSubscribers: null,
  });
});

test("getFeatureInsights compares medians instead of means", () => {
  const notes = [
    ...corpus(5, (index) => note(`e${index}`, `Nota con emoji 🚀 número ${index}`, "2026-08-17T10:00:00Z", stats(index === 0 ? 10000 : 100))),
    ...corpus(5, (index) => note(`p${index}`, `Nota sin nada especial ${index}`, "2026-08-17T10:00:00Z", stats(50))),
  ];
  const insights = getFeatureInsights({ notes });
  const emoji = insights.features.find((feature) => feature.id === "hasEmoji");
  assert.equal(emoji.state, "evidence");
  assert.equal(emoji.outcomes.interactions.medianWith, 100);
  assert.equal(emoji.outcomes.interactions.medianWithout, 50);
  assert.equal(emoji.outcomes.interactions.lift, 2);
});

test("getFeatureInsights reports evidence only above the sample threshold", () => {
  const enough = [
    ...corpus(EVIDENCE_MIN_N, (index) => note(`a${index}`, `Nota con emoji 🚀 ${index}`, "2026-08-17T10:00:00Z", stats(80))),
    ...corpus(EVIDENCE_MIN_N, (index) => note(`b${index}`, `Nota simple ${index}`, "2026-08-17T10:00:00Z", stats(40))),
  ];
  assert.equal(getFeatureInsights({ notes: enough }).features.find((f) => f.id === "hasEmoji").state, "evidence");

  const scarce = [
    ...corpus(EVIDENCE_MIN_N - 1, (index) => note(`a${index}`, `Nota con emoji 🚀 ${index}`, "2026-08-17T10:00:00Z", stats(80))),
    ...corpus(EVIDENCE_MIN_N, (index) => note(`b${index}`, `Nota simple ${index}`, "2026-08-17T10:00:00Z", stats(40))),
  ];
  const scarceFeature = getFeatureInsights({ notes: scarce }).features.find((f) => f.id === "hasEmoji");
  assert.equal(scarceFeature.state, "insufficient");
  assert.equal(scarceFeature.reason, "small-sample");
});

test("getFeatureInsights marks features as nodata when notes lack statistics", () => {
  const notes = corpus(20, (index) => note(index, index % 2 ? `Nota con emoji 🚀 ${index}` : `Nota simple ${index}`));
  const insights = getFeatureInsights({ notes });
  const emoji = insights.features.find((feature) => feature.id === "hasEmoji");
  assert.equal(emoji.state, "nodata");
  assert.equal(emoji.reason, "stats-missing");
  assert.equal(insights.coverage.statsCoverage, 0);
  assert.deepEqual(getContentFindings(insights), []);
});

test("getFeatureInsights marks constant features as insufficient, not nodata", () => {
  const notes = corpus(10, (index) => note(index, `Mira https://carta.substack.com/p/nota-${index}`, "2026-08-17T10:00:00Z", stats(60)));
  const link = getFeatureInsights({ notes }).features.find((feature) => feature.id === "hasLink");
  assert.equal(link.state, "insufficient");
  assert.equal(link.reason, "no-variation");
});

test("getFeatureInsights returns null lift instead of Infinity on a zero baseline", () => {
  const notes = [
    ...corpus(5, (index) => note(`a${index}`, `Nota con emoji 🚀 ${index}`, "2026-08-17T10:00:00Z", stats(10, { impressions: 4 }))),
    ...corpus(5, (index) => note(`b${index}`, `Nota simple ${index}`, "2026-08-17T10:00:00Z", stats(10, { impressions: 0 }))),
  ];
  const emoji = getFeatureInsights({ notes }).features.find((feature) => feature.id === "hasEmoji");
  assert.equal(emoji.outcomes.impressions.lift, null);
  assert.equal(emoji.outcomes.impressions.liftBasis, "none");
  assert.equal(Number.isFinite(emoji.outcomes.impressions.delta), true);
});

test("getFeatureInsights falls back to positive rates when both medians are zero", () => {
  const notes = [
    ...corpus(6, (index) => note(`a${index}`, `Nota con emoji 🚀 ${index}`, "2026-08-17T10:00:00Z", stats(10, { impressions: index < 2 ? 5 : 0 }))),
    ...corpus(6, (index) => note(`b${index}`, `Nota simple ${index}`, "2026-08-17T10:00:00Z", stats(10, { impressions: index < 1 ? 5 : 0 }))),
  ];
  const emoji = getFeatureInsights({ notes }).features.find((feature) => feature.id === "hasEmoji");
  assert.equal(emoji.outcomes.impressions.medianWith, 0);
  assert.equal(emoji.outcomes.impressions.liftBasis, "positive-rate");
  assert.equal(emoji.outcomes.impressions.lift, 2);
});

test("getFeatureInsights averages the two middle values on even samples", () => {
  const notes = [
    ...corpus(4, (index) => note(`a${index}`, `Nota con emoji 🚀 ${index}`, "2026-08-17T10:00:00Z", stats(index + 1))),
    ...corpus(4, (index) => note(`b${index}`, `Nota simple ${index}`, "2026-08-17T10:00:00Z", stats(1))),
  ];
  const emoji = getFeatureInsights({ notes }).features.find((feature) => feature.id === "hasEmoji");
  assert.equal(emoji.outcomes.interactions.medianWith, 2.5);
});

test("getFeatureInsights disables list detection when bodies have no line breaks", () => {
  const flat = corpus(10, (index) => note(index, `Nota plana ${index}`, "2026-08-17T10:00:00Z", stats(30)));
  const flatFeature = getFeatureInsights({ notes: flat }).features.find((feature) => feature.id === "hasList");
  assert.equal(flatFeature.state, "nodata");
  assert.equal(flatFeature.reason, "not-computable");

  const structured = getFeatureInsights({ notes: [note(1, "1. Uno\n2. Dos", "2026-08-17T10:00:00Z", stats(30))] });
  assert.equal(structured.coverage.structureAvailable, true);
});

test("getFeatureInsights excludes undated notes from time features only", () => {
  const notes = [
    note(1, "Nota con emoji 🚀", "", stats(30)),
    ...corpus(5, (index) => note(`a${index}`, `Nota con emoji 🚀 ${index}`, "2026-08-17T10:00:00Z", stats(30))),
    ...corpus(5, (index) => note(`b${index}`, `Nota simple ${index}`, "2026-08-18T10:00:00Z", stats(10))),
  ];
  const insights = getFeatureInsights({ notes });
  assert.equal(insights.coverage.undatedNotes, 1);
  const emoji = insights.features.find((feature) => feature.id === "hasEmoji");
  assert.equal(emoji.counts.withTotal, 6);
  const monday = insights.features.find((feature) => feature.id === "dayOfWeek" && feature.level === "mon");
  assert.equal(monday.counts.withTotal, 5);
  assert.equal(JSON.stringify(insights).includes("NaN"), false);
});

test("getFeatureInsights deduplicates repeated note ids", () => {
  const duplicated = [note(1, "Una nota propia", "2026-08-17T10:00:00Z", stats(30)), note(1, "Una nota propia", "2026-08-17T10:00:00Z", stats(30))];
  assert.equal(getFeatureInsights({ notes: duplicated }).coverage.totalNotes, 1);
});

test("getFeatureInsights survives an empty snapshot", () => {
  const insights = getFeatureInsights({});
  assert.equal(insights.coverage.totalNotes, 0);
  assert.equal(insights.coverage.statsCoverage, 0);
  assert.deepEqual(getContentFindings(insights), []);
});

test("getNotesTimeline groups notes into dense weekly buckets", () => {
  const notes = [
    note(1, "Primera semana", "2026-08-03T10:00:00Z", stats(10, { impressions: 2 })),
    note(2, "Tercera semana", "2026-08-17T10:00:00Z", stats(20, { impressions: 4 })),
  ];
  const timeline = getNotesTimeline({ notes });
  assert.deepEqual(timeline.weeks.map((week) => week.weekStart), ["2026-08-03", "2026-08-10", "2026-08-17"]);
  assert.equal(timeline.weeks[1].notes, 0);
  assert.equal(timeline.weeks[2].impressions, 4);
});

test("getNotesTimeline sums only the results of notes with statistics", () => {
  const notes = [
    note(1, "Con datos", "2026-08-17T10:00:00Z", stats(10, { impressions: 3 })),
    note(2, "Con datos", "2026-08-18T10:00:00Z", stats(10, { impressions: 3 })),
    note(3, "Sin datos", "2026-08-19T10:00:00Z"),
    note(4, "Sin datos", "2026-08-20T10:00:00Z"),
  ];
  const week = getNotesTimeline({ notes }).weeks[0];
  assert.equal(week.notes, 4);
  assert.equal(week.scoredNotes, 2);
  assert.equal(week.impressions, 6);
  assert.equal(week.statsCoverage, 0.5);
  assert.equal(week.impressionsPerNote, 3);
});

test("getContentFindings ranks strong negative effects alongside positive ones", () => {
  const insights = {
    features: [
      {
        id: "hasEmoji", kind: "flag", level: true, state: "evidence", reason: "",
        counts: { withTotal: 10, withoutTotal: 10, withScored: 10, withoutScored: 10 },
        outcomes: { interactions: { medianWith: 200, medianWithout: 100, lift: 2, liftBasis: "median", delta: 100 } },
        sampleIds: [],
      },
      {
        id: "hasLink", kind: "flag", level: true, state: "evidence", reason: "",
        counts: { withTotal: 10, withoutTotal: 10, withScored: 10, withoutScored: 10 },
        outcomes: { interactions: { medianWith: 50, medianWithout: 100, lift: 0.5, liftBasis: "median", delta: -50 } },
        sampleIds: [],
      },
    ],
  };
  const findings = getContentFindings(insights);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].score, findings[1].score);
  assert.deepEqual(findings.map((finding) => finding.direction).sort(), ["negative", "positive"]);
});

test("getContentFindings drops weak, unevidenced, and null-lift features", () => {
  const insights = {
    features: [
      {
        id: "hasEmoji", kind: "flag", level: true, state: "evidence", reason: "",
        counts: { withTotal: 10, withoutTotal: 10, withScored: 10, withoutScored: 10 },
        outcomes: { interactions: { medianWith: 105, medianWithout: 100, lift: 1.05, liftBasis: "median", delta: 5 } },
        sampleIds: [],
      },
      {
        id: "hasLink", kind: "flag", level: true, state: "insufficient", reason: "small-sample",
        counts: { withTotal: 4, withoutTotal: 10, withScored: 4, withoutScored: 10 },
        outcomes: { interactions: { medianWith: 400, medianWithout: 100, lift: 4, liftBasis: "median", delta: 300 } },
        sampleIds: [],
      },
      {
        id: "hasQuote", kind: "flag", level: true, state: "evidence", reason: "",
        counts: { withTotal: 10, withoutTotal: 10, withScored: 10, withoutScored: 10 },
        outcomes: { interactions: { medianWith: 0, medianWithout: 0, lift: null, liftBasis: "none", delta: 0 } },
        sampleIds: [],
      },
    ],
  };
  assert.deepEqual(getContentFindings(insights), []);
});

test("getContentFindings returns one finding per feature id", () => {
  const level = (name, lift) => ({
    id: "dayOfWeek", kind: "band", level: name, state: "evidence", reason: "",
    counts: { withTotal: 10, withoutTotal: 10, withScored: 10, withoutScored: 10 },
    outcomes: { interactions: { medianWith: 100 * lift, medianWithout: 100, lift, liftBasis: "median", delta: 0 } },
    sampleIds: [],
  });
  const findings = getContentFindings({ features: [level("mon", 1.4), level("tue", 2.2), level("wed", 1.6)] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "tue");
});

test("getContentFindings returns structured data without display strings", () => {
  const insights = {
    features: [{
      id: "hasEmoji", kind: "flag", level: true, state: "evidence", reason: "",
      counts: { withTotal: 10, withoutTotal: 10, withScored: 10, withoutScored: 10 },
      outcomes: { interactions: { medianWith: 200, medianWithout: 100, lift: 2, liftBasis: "median", delta: 100 } },
      sampleIds: [],
    }],
  };
  const [finding] = getContentFindings(insights);
  assert.equal(finding.label, undefined);
  assert.equal(typeof finding.lift, "number");
  assert.equal(typeof finding.featureId, "string");
});

test("getContentAnalytics assembles coverage, features, timeline, and findings", () => {
  const notes = [
    ...corpus(6, (index) => note(`a${index}`, `¿Escribes notas cada día? Cuenta ${index}`, "2026-08-17T10:00:00Z", stats(200, { impressions: 5000 }))),
    ...corpus(6, (index) => note(`b${index}`, `Apunte breve ${index}`, "2026-08-18T10:00:00Z", stats(50, { impressions: 500 }))),
  ];
  const analytics = getContentAnalytics({ notes });
  assert.deepEqual(Object.keys(analytics).sort(), ["attribution", "cadence", "coverage", "features", "findings", "primaryOutcome", "timeline"]);
  assert.equal(analytics.primaryOutcome, "interactions");
  assert.equal(analytics.coverage.scoredNotes, 12);
  assert.ok(analytics.timeline.weeks.length >= 1);
  assert.ok(analytics.findings.length >= 1);

  const byFollowers = getContentAnalytics({ notes }, { primaryOutcome: "impressions" });
  assert.equal(byFollowers.primaryOutcome, "impressions");
  assert.equal(byFollowers.features.length, analytics.features.length);
});

test("getCadenceHeatmap cuenta notas por dia y hora sin inventar interacciones", () => {
  const notes = [
    note("a1", "Primera", "2026-08-17T10:00:00Z", stats(100)),
    note("a2", "Segunda", "2026-08-17T10:30:00Z", stats(300)),
    note("a3", "Sin detalle", "2026-08-19T23:00:00Z"),
    note("a4", "Sin fecha", "", stats(50)),
  ];
  const cadence = getCadenceHeatmap({ notes });
  assert.equal(cadence.cells.length, 7 * 24, "la rejilla siempre esta completa");
  assert.equal(cadence.datedNotes, 3);
  assert.equal(cadence.undatedNotes, 1);

  const lunes10 = cadence.cells.find((cell) => cell.day === "mon" && cell.hour === 10);
  assert.equal(lunes10.notes, 2);
  assert.equal(lunes10.scoredNotes, 2);
  assert.equal(lunes10.medianInteractions, 200);

  const miercoles23 = cadence.cells.find((cell) => cell.day === "wed" && cell.hour === 23);
  assert.equal(miercoles23.notes, 1);
  assert.equal(miercoles23.medianInteractions, null, "una nota sin stats no aporta un cero");

  const vacia = cadence.cells.find((cell) => cell.day === "sat" && cell.hour === 3);
  assert.equal(vacia.notes, 0);
  assert.equal(vacia.medianInteractions, null);
  assert.equal(cadence.maxNotes, 2);
  assert.equal(cadence.busiest.day, "mon");
});

test("getCadenceHeatmap agrega tramos 7x4 desde las horas crudas", () => {
  const notes = [
    note("a1", "Mañana", "2026-08-17T10:00:00Z", stats(100)),
    note("a2", "Mañana tarde", "2026-08-17T11:30:00Z", stats(300)),
    note("a3", "Madrugada", "2026-08-19T03:00:00Z"),
  ];
  const cadence = getCadenceHeatmap({ notes });
  assert.equal(cadence.buckets.length, 7 * 4, "la rejilla de tramos siempre esta completa");

  const lunesManana = cadence.buckets.find((cell) => cell.day === "mon" && cell.bucket === "morning");
  assert.equal(lunesManana.notes, 2);
  assert.equal(lunesManana.medianInteractions, 200, "la mediana del tramo sale de los valores crudos");

  const miercolesNoche = cadence.buckets.find((cell) => cell.day === "wed" && cell.bucket === "night");
  assert.equal(miercolesNoche.notes, 1, "las 3:00 caen en el tramo de madrugada");
  assert.equal(miercolesNoche.medianInteractions, null, "sin stats no hay mediana, no un cero");

  assert.equal(cadence.maxBucketNotes, 2);
  assert.equal(cadence.busiestBucket.day, "mon");
  assert.equal(cadence.busiestBucket.bucket, "morning");
});

test("getNoteAttributionTimeline solo agrega notas con estadisticas", () => {
  const notes = [
    note("a1", "Con detalle", "2026-08-17T10:00:00Z", stats(100, { impressions: 700, freeSubscribers: 2 })),
    note("a2", "Mismo dia", "2026-08-17T18:00:00Z", stats(100, { impressions: 300, freeSubscribers: 1 })),
    note("a3", "Sin detalle", "2026-08-18T10:00:00Z"),
  ];
  const attribution = getNoteAttributionTimeline({ notes });
  assert.deepEqual(attribution.daily.map((point) => point.date), ["2026-08-17"], "el dia sin stats no aparece");
  assert.equal(attribution.daily[0].impressions, 1000, "impresiones sumadas de las dos notas del dia");
  assert.equal(attribution.daily[0].freeSubscribers, 3);
  assert.equal(attribution.daily[0].notes, 2);
  assert.equal(attribution.totals.impressions, 1000);
  assert.equal(attribution.scoredNotes, 2);
  assert.equal(attribution.totalNotes, 3);
  assert.equal(attribution.coverage, 2 / 3, "la cobertura dice sobre que se sostiene la serie");
});

test("getNoteAttributionTimeline devuelve cobertura null sin notas", () => {
  const attribution = getNoteAttributionTimeline({ notes: [] });
  assert.deepEqual(attribution.daily, []);
  assert.equal(attribution.coverage, null, "cero notas no es cobertura cero");
});

test("getCadenceCalendar alinea las semanas al lunes y cuenta una celda por dia", () => {
  const notes = [
    // Miercoles 12 de agosto de 2026, dos notas: una con detalle, otra sin el.
    note("c1", "Primera", "2026-08-12T10:00:00Z", stats(40, { impressions: 900 })),
    { id: "c2", body: "Segunda", date: "2026-08-12T15:00:00Z", stats: { available: false } },
    // Lunes 24 de agosto, una nota sin detalle.
    { id: "c3", body: "Tercera", date: "2026-08-24T09:00:00Z", stats: { available: false } },
    // Sin fecha: no entra en el calendario, pero se cuenta como no fechada.
    { id: "c4", body: "Sin fecha", date: "" },
  ];
  const calendar = getCadenceCalendar({ notes });
  assert.equal(calendar.start, "2026-08-10", "empieza el lunes de la primera semana con notas");
  assert.equal(calendar.end, "2026-08-30", "termina el domingo de la ultima");
  assert.equal(calendar.weeks.length, 3);
  assert.ok(calendar.weeks.every((week) => week.length === 7), "cada columna son siete dias");
  assert.equal(calendar.datedNotes, 3);
  assert.equal(calendar.undatedNotes, 1);
  assert.equal(calendar.maxNotes, 2);

  const dia = calendar.days.find((cell) => cell.date === "2026-08-12");
  assert.equal(dia.weekday, 2, "miercoles es la fila 2 (lunes = 0)");
  assert.equal(dia.notes, 2);
  assert.equal(dia.scoredNotes, 1, "solo una de las dos tiene estadisticas");
  assert.equal(dia.medianInteractions, 40, "la mediana sale de las notas con detalle, no de un cero por la otra");
  const lunes = calendar.days.find((cell) => cell.date === "2026-08-24");
  assert.equal(lunes.medianInteractions, null, "sin detalle no es cero: es ausencia");
  const vacio = calendar.days.find((cell) => cell.date === "2026-08-13");
  assert.equal(vacio.notes, 0);
  assert.equal(vacio.medianInteractions, null);

  // Una etiqueta de mes por columna donde el mes cambia.
  assert.deepEqual(calendar.months.map((entry) => entry.month), ["2026-08"]);
  assert.deepEqual(getCadenceCalendar({ notes: [] }).weeks, []);
});

test("getCadenceCalendar recorta las semanas mas antiguas y lo declara", () => {
  const notes = [
    { id: "v", body: "Vieja", date: "2024-01-03T10:00:00Z" },
    { id: "n", body: "Nueva", date: "2026-08-12T10:00:00Z" },
  ];
  const calendar = getCadenceCalendar({ notes }, { maxWeeks: 10 });
  assert.equal(calendar.weeks.length, 10);
  assert.ok(calendar.truncatedWeeks > 100, "las semanas descartadas se cuentan, no se esconden");
  assert.equal(calendar.days.some((cell) => cell.date === "2024-01-03"), false);
  assert.equal(calendar.days.some((cell) => cell.date === "2026-08-12"), true, "las recientes siempre se conservan");
});
