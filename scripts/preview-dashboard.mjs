// Sirve el dashboard real con datos ficticios, para sacar las capturas de la
// ficha de la Chrome Web Store.
//
//   node scripts/preview-dashboard.mjs        → http://localhost:4173/dashboard/
//
// Es el mismo index.html, el mismo app.js y los mismos módulos de src/ que se
// publican: lo único que cambia es que `chrome.storage.local` devuelve la
// publicación inventada «Carta de muestra» en vez de la cuenta real de nadie.
// Capturar con datos reales significaría publicar las métricas de negocio del
// autor en una ficha pública, y además dejaría las capturas atadas a lo que
// esa cuenta tuviera ese día.
//
// No forma parte de la extensión: no está en EXTENSION_FILES y no viaja en el
// ZIP.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
// Los datos de muestra pasan por el normalizador REAL, el mismo que usa el
// service worker antes de guardar. Así el esquema no se adivina campo a campo:
// si normalizeSnapshot cambia, la vista previa cambia con él.
import { normalizeSnapshot } from "../src/shared/analytics.js";

const root = process.cwd();
const port = Number(process.argv[2] ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// --- Datos de muestra ------------------------------------------------------
// Mismo esquema que produce normalizeSnapshot; ampliado respecto al fixture de
// tests para que las vistas de Publicaciones y Crecimiento tengan suficientes
// filas que enseñar. Todas las cifras son inventadas.

const day = (index) => {
  const date = new Date(Date.UTC(2026, 7, 21) - index * 86400000);
  return date.toISOString().slice(0, 10);
};

// Los envíos llegan hasta 200 días atrás a propósito: con solo 90 días de
// historia, la ventana anterior queda vacía y las tarjetas de apertura y CTR
// muestran «Sin periodo anterior para comparar», que es correcto pero no
// enseña lo que hace el producto.
const CAMPAIGNS = [
  ["La semana que cambió el producto", 1, 2814, 1396, 182, 2100, 91, 18, 27, 36, 1180],
  ["Notas desde el borde", 9, 2769, 1268, 201, 1890, 78, 12, 19, 24, 1640],
  ["Cómo leer una métrica sin engañarte", 16, 2731, 1301, 165, 2040, 84, 21, 22, 31, 2210],
  ["El coste de publicar todos los días", 23, 2698, 1174, 139, 1620, 62, 9, 14, 18, 980],
  ["Tres gráficos que sí decidí borrar", 30, 2655, 1249, 188, 1980, 97, 16, 25, 29, 1520],
  ["Lo que no cuenta el panel de Substack", 44, 2601, 1105, 122, 1450, 55, 7, 11, 15, 2680],
  ["Una carta corta sobre editar", 58, 2544, 1183, 151, 1710, 71, 13, 17, 22, 760],
  ["Empezar de nuevo, con datos", 72, 2489, 1042, 118, 1390, 48, 6, 9, 12, 1340],
  ["El archivo que nadie abre", 86, 2431, 1067, 131, 1520, 58, 11, 13, 17, 1120],
  ["Contra el gráfico bonito", 100, 2377, 998, 109, 1310, 44, 8, 10, 14, 1890],
  ["Qué preguntar antes de medir", 115, 2318, 1041, 143, 1470, 66, 14, 16, 20, 1450],
  ["Cien números y una decisión", 132, 2254, 947, 116, 1280, 51, 9, 12, 15, 2040],
  ["La métrica que abandoné", 149, 2186, 984, 128, 1350, 59, 12, 14, 19, 890],
  ["Escribir menos, revisar más", 168, 2119, 890, 101, 1190, 41, 7, 9, 11, 1670],
  ["Un año de cartas", 186, 2043, 939, 122, 1300, 54, 15, 13, 18, 2310],
  ["Cómo empecé esta lista", 200, 1978, 831, 94, 1080, 37, 6, 8, 10, 1240],
];

const campaigns = CAMPAIGNS.map(
  ([title, ago, delivered, opened, clicked, views, reactions, comments, shares, signups, words], index) => ({
    id: String(index + 1),
    title,
    date: day(ago),
    sent: delivered + 12,
    delivered,
    opened,
    uniqueOpens: opened,
    clicks: clicked,
    clicked,
    opens: opened,
    openRate: Number(((opened / delivered) * 100).toFixed(1)),
    clickRate: Number(((clicked / delivered) * 100).toFixed(1)),
    views,
    reactions,
    comments,
    shares,
    // `signups` es lo que lee la tabla; `signupsWithin1Day` alimenta la
    // atribución por canal. Son campos distintos en el esquema, no alias.
    signups,
    signupsWithin1Day: signups,
    unsubscribesWithin1Day: Math.round(signups / 6),
    engagementRate: Number((((reactions + comments + shares) / delivered) * 100).toFixed(2)),
    detailAvailable: true,
    wordCount: words,
    audience: "everyone",
    type: "newsletter",
  }),
);

const NOTES = [
  ["Una buena métrica elimina una duda, no añade otra pantalla.", 1, 94, 18, 12, 6800, 7, 1],
  ["¿Qué mirarías primero para entender si una publicación funcionó?", 7, 71, 26, 8, 4900, 4, 0],
  ["Publicar cada semana durante un año enseña más sobre editar que sobre escribir.", 12, 56, 9, 16, 5400, 5, 1],
  ["El gráfico que más miro no es el de suscriptores.", 18, 88, 14, 21, 7300, 9, 2],
  ["Una tasa de apertura sin el denominador delante no significa nada.", 25, 63, 11, 7, 3800, 3, 0],
  ["Escribir para mil personas se parece poco a escribir para cien.", 33, 45, 22, 5, 3100, 2, 0],
];

const notes = NOTES.map(([body, ago, likes, replies, restacks, impressions, free, paid], index) => ({
  id: `n${index + 1}`,
  body,
  date: `${day(ago)}T15:00:00Z`,
  url: `https://substack.com/@muestra/note/c-n${index + 1}`,
  reactions: likes,
  replies,
  restacks,
  stats: {
    available: true,
    fetchState: "ready",
    attempts: 1,
    interactions: {
      total: likes + replies + restacks,
      likes,
      replies,
      restacks,
      profileVisits: Math.round(likes / 9),
      saves: Math.round(likes / 22),
      shares: Math.round(likes / 30),
      linkClicks: Math.round(likes / 26),
    },
    results: { freeSubscribers: free, paidSubscribers: paid },
    reach: { impressions, clicks: Math.round(impressions / 92) },
    // Reparto por superficie y por audiencia, como lo devuelve note_stats.
    surfaces: {
      Feed: Math.round(impressions * 0.58),
      Notifications: Math.round(impressions * 0.14),
      "Profile page": Math.round(impressions * 0.11),
      Permalinks: Math.round(impressions * 0.08),
      Notes: Math.round(impressions * 0.05),
      Search: Math.round(impressions * 0.03),
      Other: Math.round(impressions * 0.01),
    },
    audience: {
      Subscribers: Math.round(impressions * 0.22),
      Followers: Math.round(impressions * 0.31),
      Unconnected: Math.round(impressions * 0.47),
    },
  },
}));

// Congruencial lineal con semilla fija: hace falta variación para que la
// curva acumulada no salga como una recta de tiralíneas, pero tiene que ser
// la MISMA variación en cada ejecución o dos capturas de la misma vista no
// coincidirían.
let seed = 20260821;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

// 210 días de altas y bajas diarias: onda semanal (los fines de semana caen),
// un pico de campaña y ruido diario.
const daily = Array.from({ length: 210 }, (_, index) => {
  const date = day(209 - index);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const growth = 6 + (index / 210) * 7;          // la lista acelera con el tiempo
  const spike = index === 150 || index === 151 ? 34 : 0;  // una nota que funcionó
  const signups = Math.max(1, Math.round((weekend ? growth * 0.55 : growth) + random() * 9 + spike));
  const losses = Math.round(random() * 3);
  return { date, signups, paidSignups: random() < 0.09 ? 1 : 0, losses, new: signups };
});
let running = 2840 - daily.reduce((total, row) => total + row.signups, 0);
for (const row of daily) {
  running += row.signups;
  row.cumulative = running;
  row.net = row.signups - row.losses;
}

const trend = [0, 60, 120, 170, 209].map((index) => ({
  date: daily[index].date,
  subscribers: daily[index].cumulative,
  paidSubscribers: Math.round(daily[index].cumulative * 0.065),
  followers: 3200 + index * 6,
}));

const SNAPSHOT = {
  publication: "Carta de muestra",
  capturedAt: "2026-08-21T14:30:00Z",
  metrics: {
    subscribers: 2840,
    paidSubscribers: 184,
    openRate: 47.3,
    clickRate: 6.8,
    monthlyRevenue: 1425,
    followers: 3900,
    appSubscribers: 720,
  },
  previous: { subscribers: 2710, paidSubscribers: 173, openRate: 45.9, clickRate: 6.1, monthlyRevenue: 1330 },
  trend,
  campaigns,
  notes,
};

const ANALYTICS = {
  period: { from: day(365), to: day(0) },
  audience: {
    total: 2840,
    emailable: 2710,
    followers: { total: 3900, history: trend.map((row) => ({ date: row.date, value: row.followers })) },
    location: {
      rows: [
        { code: "ES", value: 1223 },
        { code: "MX", value: 454 },
        { code: "AR", value: 312 },
        { code: "CO", value: 228 },
        { code: "CL", value: 165 },
        { code: "US", value: 141 },
      ],
      totals: { global: { locations: 34 } },
    },
    timeline: {
      total: 2840,
      counted: 2840,
      daily,
      composition: { paid: 184, founding: 12, gift: 4, comp: 3, freeTrial: 8 },
      engagement: { alta: 1240, baja: 980, inactiva: 620 },
      byInterval: [
        { interval: "free", count: 2656 },
        { interval: "month", count: 142 },
        { interval: "year", count: 42 },
      ],
    },
  },
  growth: {
    // Las tres fuentes agregadas en servidor van por ventana del selector.
    visitors: Object.fromEntries(["7", "30", "90", "all"].map((key, index) => {
      const factor = [0.06, 0.25, 0.62, 1][index];
      const rows = [
        ["direct to app", "Direct", 8920, 2720, 84],
        ["substack app", "Substack", 7010, 2020, 31],
        ["direct", "Direct", 3670, 1720, 22],
        ["email opens", "Email", 1220, 900, null],
        ["google", "Search", 640, 410, 9],
        ["twitter", "Social", 210, 160, 2],
      ].map(([source, category, views, users, free]) => ({
        source, category,
        views: Math.round(views * factor), users: Math.round(users * factor),
        freeSignups: free === null ? null : Math.round(free * factor), paidSignups: free === null ? null : 0,
        conversion: free === null ? null : (free / users) * 100,
      }));
      const totals = rows.reduce((sum, row) => ({ views: sum.views + row.views, users: sum.users + row.users, freeSignups: sum.freeSignups + (row.freeSignups || 0) }), { views: 0, users: 0, freeSignups: 0 });
      return [key, { rows, totals }];
    })),
    network: Object.fromEntries(["7", "30", "90", "all"].map((key, index) => {
      const factor = [0.05, 0.22, 0.6, 1][index];
      const rows = [["Substack App", 1610], ["Substack existing accounts", 640], ["Other Substack Network", 310], ["Imported accounts", 280]]
        .map(([label, subscribers]) => ({ label, subscribers: Math.round(subscribers * factor), share: 0 }));
      const total = rows.reduce((sum, row) => sum + row.subscribers, 0);
      rows.forEach((row) => { row.share = row.subscribers / total; });
      return [key, { rows, total, updatedAt: "2026-08-21T01:30:00.000Z" }];
    })),
    benchmark: { growthRate: 12.4, periodDays: 30, newSubscribers: 341, expirations: 27, outcome: "above_average", outcomeCopy: "Por encima de la media de Substack" },
    sources: {
      totals: { visitors: 21400, subscribers: 1310, revenue: 0 },
      // La clave es `label`, la que produce mapSource() en
      // substack-extended.js. Con `source` la tabla sale vacía y el resumen
      // dice «undefined lidera».
      sources: [
        { id: "notes", label: "Notas de Substack", category: "substack", visitors: 8200, subscribers: 540, revenue: 0, series: [], children: [] },
        { id: "recommendations", label: "Recomendaciones", category: "substack", visitors: 5100, subscribers: 386, revenue: 0, series: [], children: [] },
        { id: "direct", label: "Búsqueda directa", category: "direct", visitors: 3600, subscribers: 172, revenue: 0, series: [], children: [] },
        { id: "network", label: "Red de Substack", category: "substack", visitors: 2700, subscribers: 141, revenue: 0, series: [], children: [] },
        { id: "external", label: "Enlaces externos", category: "external", visitors: 1800, subscribers: 71, revenue: 0, series: [], children: [] },
      ],
    },
    events: [],
    subscribers: {
      free: {
        daily,
        totals: {
          new: daily.reduce((total, row) => total + row.signups, 0),
          losses: daily.reduce((total, row) => total + row.losses, 0),
          net: daily.reduce((total, row) => total + row.net, 0),
        },
      },
      paid: { daily: [], totals: { new: 0, losses: 0, net: 0 } },
    },
  },
  retention: {
    free: { cohorts: [], rates: [{ month: 1, rate: 0.82, comparison: 0.04 }, { month: 3, rate: 0.71, comparison: 0.02 }] },
    paid: { cohorts: [], rates: [] },
  },
  content: { counts: {} },
  coverage: [
    { source: "audience", label: "Audiencia", status: "ok", rows: 2840 },
    { source: "subscriberTimeline", label: "Altas por día", status: "ok", rows: 210 },
    { source: "growthSources", label: "Fuentes de adquisición", status: "ok", rows: 5 },
    { source: "followerTimeseries", label: "Seguidores", status: "ok", rows: 5 },
    { source: "audienceLocation", label: "Ubicación", status: "ok", rows: 34 },
    { source: "freeSubscriberGrowth", label: "Crecimiento gratuito", status: "ok", rows: 210 },
    { source: "paidSubscriberGrowth", label: "Crecimiento de pago", status: "unavailable", rows: 0 },
    { source: "freeRetention", label: "Retención gratuita", status: "ok", rows: 2 },
    { source: "paidRetention", label: "Retención de pago", status: "unavailable", rows: 0 },
  ],
};

// `growth.sources` se pide una vez por ventana: la muestra escala la de 12 meses.
{
  const all = ANALYTICS.growth.sources;
  const scaled = (factor) => ({
    totals: { visitors: Math.round(all.totals.visitors * factor), subscribers: Math.round(all.totals.subscribers * factor), revenue: 0 },
    sources: all.sources.map((row) => ({ ...row, visitors: Math.round(row.visitors * factor), subscribers: Math.round(row.subscribers * factor) })),
  });
  ANALYTICS.growth.sources = { 7: scaled(0.06), 30: scaled(0.24), 90: scaled(0.6), all };
}
ANALYTICS.traffic = { daily: daily.map((row) => ({ date: row.date, value: Math.round(60 + row.signups * 11 + random() * 40) })) };
ANALYTICS.audience.overlap = [
  { name: "Mafia IA", subdomain: "aimafia", share: 0.39 },
  { name: "Para todo IA", subdomain: "iaparatodo", share: 0.3 },
  { name: "Cosas de Freelance", subdomain: "cosasdefreelance", share: 0.21 },
  { name: "How to AI", subdomain: "ruben", share: 0.19 },
];

const STUB = `
<script>
  const DATA = ${JSON.stringify({
    "plotstack.connection": {
      provider: "substack",
      publication: { name: "Carta de muestra", subdomain: "muestra" },
      connectedAt: "2026-08-21T14:30:00Z",
    },
    "plotstack.snapshot": normalizeSnapshot(SNAPSHOT),
    "plotstack.analytics": ANALYTICS,
  })};
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ ok: true }), getURL: (p) => p },
    downloads: { download: async () => 1 },
    storage: { onChanged: { addListener: () => {} }, local: {
      get: async (keys) => {
        if (!keys) return DATA;
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in DATA).map((k) => [k, DATA[k]]));
      },
      set: async () => {},
      remove: async () => {},
    } },
  };
</script>
`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  let file = decodeURIComponent(url.pathname);
  if (file === "/" || file === "/dashboard/") file = "/dashboard/index.html";

  const resolved = path.join(root, file);
  if (!resolved.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    let body = await readFile(resolved);
    if (file.endsWith("index.html")) {
      // El stub tiene que existir ANTES de que se evalúe el módulo: app.js
      // llama a chrome.storage en cuanto se importa.
      body = body.toString("utf8").replace("</head>", `${STUB}</head>`);
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("No encontrado");
  }
});

server.listen(port, () => {
  console.log(`Dashboard de muestra en http://localhost:${port}/dashboard/`);
  console.log("Publicación ficticia «Carta de muestra». Ctrl+C para parar.");
});
