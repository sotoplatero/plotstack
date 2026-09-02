const NUMBER_FORMAT = new Intl.NumberFormat("es-ES", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const safeNumber = (value, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanMetricSet = (metrics = {}) => ({
  subscribers: Math.max(0, Math.round(safeNumber(metrics.subscribers))),
  paidSubscribers: Math.max(0, Math.round(safeNumber(metrics.paidSubscribers))),
  openRate: Math.max(0, safeNumber(metrics.openRate)),
  clickRate: Math.max(0, safeNumber(metrics.clickRate)),
  monthlyRevenue: Math.max(0, safeNumber(metrics.monthlyRevenue)),
  totalViews: Math.max(0, Math.round(safeNumber(metrics.totalViews))),
  followers: Math.max(0, Math.round(safeNumber(metrics.followers))),
  appSubscribers: Math.max(0, Math.round(safeNumber(metrics.appSubscribers))),
  appSubscribersLast30Days: Math.max(0, Math.round(safeNumber(metrics.appSubscribersLast30Days))),
  // Puede ser negativo: es una variación, no un contador.
  openRateDiff: safeNumber(metrics.openRateDiff),
});

const cleanNotesSummary = (summary = {}) => ({
  total: Math.max(0, Math.round(safeNumber(summary.total))),
  reactions: Math.max(0, Math.round(safeNumber(summary.reactions))),
  replies: Math.max(0, Math.round(safeNumber(summary.replies))),
  restacks: Math.max(0, Math.round(safeNumber(summary.restacks))),
  interactions: Math.max(0, Math.round(safeNumber(summary.interactions))),
  interactionsPerNote: Math.max(0, safeNumber(summary.interactionsPerNote)),
  notesWithRestacks: Math.max(0, Math.round(safeNumber(summary.notesWithRestacks))),
  detailAvailable: Math.max(0, Math.round(safeNumber(summary.detailAvailable))),
  detailPending: Math.max(0, Math.round(safeNumber(summary.detailPending))),
  detailUnavailable: Math.max(0, Math.round(safeNumber(summary.detailUnavailable))),
  statsThrottled: Boolean(summary.statsThrottled),
  restackRate: Math.max(0, safeNumber(summary.restackRate)),
  activeDays: Math.max(0, Math.round(safeNumber(summary.activeDays))),
  notesPerDay: Math.max(0, safeNumber(summary.notesPerDay)),
  firstPublishedAt: String(summary.firstPublishedAt || ""),
  lastPublishedAt: String(summary.lastPublishedAt || ""),
});

export const NOTE_FETCH_STATES = ["ready", "pending", "throttled", "unavailable"];

// Etiquetas tal como las devuelve Substack en los barList de note_stats.
export const NOTE_SURFACE_KEYS = ["Feed", "Notifications", "Profile page", "Permalinks", "Notes", "Search", "Other"];
export const NOTE_AUDIENCE_KEYS = ["Subscribers", "Followers", "Unconnected"];

const cleanBuckets = (source, keys) => Object.fromEntries(
  keys.map((key) => [key, Math.max(0, Math.round(safeNumber(source?.[key])))]),
);

const cleanFetchState = (stats = {}) => {
  if (NOTE_FETCH_STATES.includes(stats.fetchState)) return stats.fetchState;
  return stats.available ? "ready" : "pending";
};

const cleanNoteStats = (stats = {}) => ({
  available: Boolean(stats.available),
  fetchState: cleanFetchState(stats),
  attempts: Math.max(0, Math.round(safeNumber(stats.attempts))),
  updatedAt: String(stats.updatedAt || ""),
  interactions: {
    total: Math.max(0, Math.round(safeNumber(stats.interactions?.total))),
    likes: Math.max(0, Math.round(safeNumber(stats.interactions?.likes))),
    restacks: Math.max(0, Math.round(safeNumber(stats.interactions?.restacks))),
    profileVisits: Math.max(0, Math.round(safeNumber(stats.interactions?.profileVisits))),
    replies: Math.max(0, Math.round(safeNumber(stats.interactions?.replies))),
    saves: Math.max(0, Math.round(safeNumber(stats.interactions?.saves))),
    shares: Math.max(0, Math.round(safeNumber(stats.interactions?.shares))),
    linkClicks: Math.max(0, Math.round(safeNumber(stats.interactions?.linkClicks))),
  },
  // `note_stats` NO trae seguidores ni ingresos por nota. El codigo anterior
  // emparejaba por titulo entre todas las tarjetas y colaba el item "Followers"
  // del desglose de AUDIENCIA (impresiones vistas por seguidores) como si fueran
  // seguidores ganados. Ver docs/product/substack-payloads-observados.md
  results: {
    freeSubscribers: Math.max(0, Math.round(safeNumber(stats.results?.freeSubscribers))),
    paidSubscribers: Math.max(0, Math.round(safeNumber(stats.results?.paidSubscribers))),
  },
  reach: {
    impressions: Math.max(0, Math.round(safeNumber(stats.reach?.impressions))),
  },
  surfaces: cleanBuckets(stats.surfaces, NOTE_SURFACE_KEYS),
  audience: cleanBuckets(stats.audience, NOTE_AUDIENCE_KEYS),
});

export function normalizeSnapshot(input = {}) {
  const trend = Array.isArray(input.trend)
    ? input.trend
        .filter((point) => point && point.date)
        .map((point) => ({
          date: String(point.date),
          subscribers: Math.max(0, Math.round(safeNumber(point.subscribers))),
          paidSubscribers: Math.max(0, Math.round(safeNumber(point.paidSubscribers))),
          followers: Math.max(0, Math.round(safeNumber(point.followers))),
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const campaigns = Array.isArray(input.campaigns)
    ? input.campaigns.map((campaign, index) => ({
        id: String(campaign?.id ?? index),
        title: String(campaign?.title || "Sin título"),
        subtitle: String(campaign?.subtitle || ""),
        slug: String(campaign?.slug || ""),
        audience: String(campaign?.audience || ""),
        type: String(campaign?.type || ""),
        wordcount: Math.max(0, Math.round(safeNumber(campaign?.wordcount))),
        date: String(campaign?.date || ""),
        status: String(campaign?.status || "Enviado"),
        recipients: Math.max(0, Math.round(safeNumber(campaign?.recipients))),
        openRate: Math.max(0, safeNumber(campaign?.openRate)),
        clickRate: Math.max(0, safeNumber(campaign?.clickRate)),
        sent: Math.max(0, Math.round(safeNumber(campaign?.sent))),
        delivered: Math.max(0, Math.round(safeNumber(campaign?.delivered))),
        opens: Math.max(0, Math.round(safeNumber(campaign?.opens))),
        opened: Math.max(0, Math.round(safeNumber(campaign?.opened))),
        clicks: Math.max(0, Math.round(safeNumber(campaign?.clicks))),
        clicked: Math.max(0, Math.round(safeNumber(campaign?.clicked))),
        views: Math.max(0, Math.round(safeNumber(campaign?.views))),
        shares: Math.max(0, Math.round(safeNumber(campaign?.shares))),
        signups: Math.max(0, Math.round(safeNumber(campaign?.signups))),
        subscribes: Math.max(0, Math.round(safeNumber(campaign?.subscribes))),
        signupsWithin1Day: Math.max(0, Math.round(safeNumber(campaign?.signupsWithin1Day))),
        subscriptionsWithin1Day: Math.max(0, Math.round(safeNumber(campaign?.subscriptionsWithin1Day))),
        unsubscribesWithin1Day: Math.max(0, Math.round(safeNumber(campaign?.unsubscribesWithin1Day))),
        disablesWithin1Day: Math.max(0, Math.round(safeNumber(campaign?.disablesWithin1Day))),
        downloads: Math.max(0, Math.round(safeNumber(campaign?.downloads))),
        videoViews: Math.max(0, Math.round(safeNumber(campaign?.videoViews))),
        videoMinutesWatched: Math.max(0, safeNumber(campaign?.videoMinutesWatched)),
        estimatedValue: Math.max(0, safeNumber(campaign?.estimatedValue)),
        reactions: Math.max(0, Math.round(safeNumber(campaign?.reactions))),
        comments: Math.max(0, Math.round(safeNumber(campaign?.comments))),
        engagementRate: Math.max(0, safeNumber(campaign?.engagementRate)),
        detailAvailable: Boolean(campaign?.detailAvailable),
      }))
    : [];

  const notes = Array.isArray(input.notes)
    ? input.notes.map((note, index) => ({
        id: String(note?.id ?? index),
        body: String(note?.body || "Nota sin texto"),
        date: String(note?.date || ""),
        reactions: Math.max(0, Math.round(safeNumber(note?.reactions))),
        replies: Math.max(0, Math.round(safeNumber(note?.replies))),
        restacks: Math.max(0, Math.round(safeNumber(note?.restacks))),
        url: String(note?.url || ""),
        stats: cleanNoteStats(note?.stats),
      }))
    : [];

  return {
    version: 1,
    provider: String(input.provider || "unconnected"),
    publication: String(input.publication || "Mi newsletter"),
    capturedAt: String(input.capturedAt || new Date().toISOString()),
    sourceUrl: String(input.sourceUrl || ""),
    metrics: cleanMetricSet(input.metrics),
    previous: cleanMetricSet(input.previous),
    trend,
    campaigns,
    notesSummary: cleanNotesSummary(input.notesSummary),
    notes,
  };
}

export function getNotesAnalytics(snapshot = {}) {
  const notes = Array.isArray(snapshot.notes) ? snapshot.notes : [];
  const total = {
    interactions: 0, likes: 0, restacks: 0, profileVisits: 0, replies: 0,
    saves: 0, shares: 0, linkClicks: 0, freeSubscribers: 0,
    paidSubscribers: 0, impressions: 0,
  };
  const surfaces = Object.fromEntries(NOTE_SURFACE_KEYS.map((key) => [key, 0]));
  const audience = Object.fromEntries(NOTE_AUDIENCE_KEYS.map((key) => [key, 0]));
  const ranked = notes.map((note) => {
    const detailed = Boolean(note.stats?.available);
    const interactions = detailed ? note.stats.interactions : {
      total: safeNumber(note.reactions) + safeNumber(note.replies) + safeNumber(note.restacks),
      likes: safeNumber(note.reactions), restacks: safeNumber(note.restacks), replies: safeNumber(note.replies),
      profileVisits: 0, saves: 0, shares: 0, linkClicks: 0,
    };
    const results = detailed ? note.stats.results : {};
    const reach = detailed ? note.stats.reach : {};
    total.interactions += safeNumber(interactions.total);
    for (const key of ["likes", "restacks", "profileVisits", "replies", "saves", "shares", "linkClicks"]) total[key] += safeNumber(interactions[key]);
    for (const key of ["freeSubscribers", "paidSubscribers"]) total[key] += safeNumber(results[key]);
    total.impressions += safeNumber(reach.impressions);
    if (detailed) {
      for (const key of NOTE_SURFACE_KEYS) surfaces[key] += safeNumber(note.stats.surfaces?.[key]);
      for (const key of NOTE_AUDIENCE_KEYS) audience[key] += safeNumber(note.stats.audience?.[key]);
    }
    return { ...note, score: safeNumber(interactions.total), analytics: { interactions, results, reach }, detailed };
  }).sort((a, b) => b.score - a.score);

  return {
    total,
    surfaces,
    audience,
    ranked,
    detailedCount: ranked.filter((note) => note.detailed).length,
    averageInteractions: ranked.length ? total.interactions / ranked.length : 0,
  };
}

const rowsInPeriod = (rows, getDate, days, now = Date.now()) => {
  if (!Number.isFinite(days)) return rows;
  const cutoff = now - days * 86400000;
  return rows.filter((row) => {
    const raw = getDate(row);
    if (!raw) return true;
    const time = new Date(raw).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  });
};

export function getPublicationEngagement(snapshot = {}, days = 30, now = Date.now()) {
  const campaigns = rowsInPeriod(normalizeSnapshot(snapshot).campaigns, (row) => row.date, days, now);
  return campaigns.reduce((total, campaign) => {
    total.posts += 1;
    total.views += safeNumber(campaign.views);
    total.reactions += safeNumber(campaign.reactions);
    total.comments += safeNumber(campaign.comments);
    total.shares += safeNumber(campaign.shares);
    total.interactions += safeNumber(campaign.reactions) + safeNumber(campaign.comments) + safeNumber(campaign.shares);
    return total;
  }, { posts: 0, views: 0, reactions: 0, comments: 0, shares: 0, interactions: 0 });
}

export function getNotesEngagement(snapshot = {}, days = 30, now = Date.now()) {
  const notes = rowsInPeriod(normalizeSnapshot(snapshot).notes, (row) => row.date, days, now);
  const analytics = getNotesAnalytics({ notes });
  return {
    notes: analytics.ranked.length,
    interactions: analytics.total.interactions,
    likes: analytics.total.likes,
    comments: analytics.total.replies,
    restacks: analytics.total.restacks,
    impressions: analytics.total.impressions,
  };
}

export function formatCompactNumber(value) {
  return NUMBER_FORMAT.format(safeNumber(value));
}

export function formatPercent(value, digits = 1) {
  return `${safeNumber(value).toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatCurrency(value) {
  return safeNumber(value).toLocaleString("es-ES", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// Tasas ponderadas por entregados en una ventana y en la ventana inmediatamente
// anterior del mismo tamano. Es la unica forma honesta de dar un delta de CTR:
// la API no publica el CTR del periodo anterior.
export function getRateWindows(snapshot, days = 30, now = Date.now()) {
  const campaigns = normalizeSnapshot(snapshot).campaigns.filter((campaign) => campaign.date);
  const span = Number.isFinite(days) ? days * 86400000 : Infinity;
  const inWindow = (campaign, from, to) => {
    const time = new Date(campaign.date).getTime();
    if (!Number.isFinite(time)) return false;
    return time >= from && time < to;
  };
  const rate = (rows, key) => {
    let numerator = 0;
    let denominator = 0;
    for (const row of rows) {
      if (row.delivered <= 0) continue;
      numerator += safeNumber(row[key]);
      denominator += row.delivered;
    }
    // `null` cuando no hay envios con destinatarios: ausencia, no cero.
    return denominator > 0 ? (numerator / denominator) * 100 : null;
  };

  const current = Number.isFinite(span)
    ? campaigns.filter((campaign) => inWindow(campaign, now - span, Infinity))
    : campaigns;
  const previous = Number.isFinite(span)
    ? campaigns.filter((campaign) => inWindow(campaign, now - 2 * span, now - span))
    : [];

  return {
    current: { posts: current.length, openRate: rate(current, "opened"), clickRate: rate(current, "clicked") },
    previous: { posts: previous.length, openRate: rate(previous, "opened"), clickRate: rate(previous, "clicked") },
  };
}

// Fecha civil compartida: "2026-06-10" es un día, no la medianoche UTC. Con
// `new Date("2026-06-10")` directo, en zonas negativas el día retrocede uno.
export const parseDay = (value) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value);

// Sin denominador no hay cociente: `null`, nunca Infinity/NaN (se corrompen en
// chrome.storage y se renderizarían como "∞").
export const ratio = (numerator, denominator) => {
  if (!(denominator > 0)) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
};

const medianOf = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Umbral de producto para atenuar cortes con pocos envíos. No es una prueba de
// significación: por debajo de esto la cifra se muestra atenuada, nunca oculta.
export const MIN_CUT_N = 3;

export const LENGTH_BANDS = [
  { key: "short", min: 0, max: 700 },
  { key: "medium", min: 700, max: 1500 },
  { key: "long", min: 1500, max: Infinity },
];

// Cortes de rendimiento por día de la semana y por longitud. Tasa ponderada
// (Σabrieron / Σentregados), nunca media de tasas: un envío a 30 personas no
// puede pesar lo mismo que uno a 3000. Los posts sin entregas quedan fuera:
// su 0% es ausencia de envío, no una medición de apertura.
export function getCampaignCuts(campaigns = []) {
  const sent = campaigns.filter((campaign) => safeNumber(campaign.delivered) > 0);
  const cutOf = (rows) => {
    const delivered = rows.reduce((sum, row) => sum + safeNumber(row.delivered), 0);
    const opened = rows.reduce((sum, row) => sum + safeNumber(row.opened), 0);
    return {
      posts: rows.length,
      delivered,
      openRate: delivered > 0 ? (opened / delivered) * 100 : null,
      scarce: rows.length < MIN_CUT_N,
    };
  };

  const byDay = new Map();
  for (const campaign of sent) {
    if (!campaign.date) continue;
    const day = parseDay(campaign.date).getDay();
    if (!Number.isFinite(day)) continue;
    const bucket = byDay.get(day) || [];
    bucket.push(campaign);
    byDay.set(day, bucket);
  }

  const withWords = sent.filter((campaign) => safeNumber(campaign.wordcount) > 0);
  return {
    byDay: [...byDay.entries()]
      .map(([day, rows]) => ({ day, ...cutOf(rows) }))
      .sort((a, b) => b.openRate - a.openRate),
    byLength: LENGTH_BANDS
      .map((band) => ({ band: band.key, ...cutOf(withWords.filter((campaign) => campaign.wordcount > band.min && campaign.wordcount <= band.max)) }))
      .filter((row) => row.posts > 0),
  };
}

// Mediana de apertura de las propias publicaciones. Sustituye al "42% de
// referencia de la industria" que estaba escrito a mano en el HTML sin fuente.
export function getOwnOpenRateMedian(snapshot) {
  return medianOf(normalizeSnapshot(snapshot).campaigns
    .filter((campaign) => campaign.delivered > 0 && campaign.openRate > 0)
    .map((campaign) => campaign.openRate));
}

export const MIN_DIAGNOSIS_N = 4;

// Cuadrante asunto/contenido: la apertura mide el asunto y el CTOR mide el
// cuerpo, cada uno contra tu propia mediana. Cuatro diagnósticos accionables en
// vez de dos columnas de porcentajes. Con menos de MIN_DIAGNOSIS_N envíos la
// mediana es una moneda al aire: estado `insufficient`, nunca clasificar igual.
export function getCampaignDiagnosis(campaigns = []) {
  const sent = campaigns
    .filter((campaign) => safeNumber(campaign.delivered) > 0 && safeNumber(campaign.opened) > 0)
    .map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      date: campaign.date,
      openRate: safeNumber(campaign.openRate),
      ctor: (safeNumber(campaign.clicked) / campaign.opened) * 100,
    }));
  if (sent.length < MIN_DIAGNOSIS_N) {
    return {
      state: "insufficient",
      sample: sent.length,
      medianOpenRate: null,
      medianCtor: null,
      quadrants: { winner: [], subject: [], content: [], weak: [] },
    };
  }
  const medianOpenRate = medianOf(sent.map((post) => post.openRate));
  const medianCtor = medianOf(sent.map((post) => post.ctor));
  const quadrants = { winner: [], subject: [], content: [], weak: [] };
  for (const post of sent) {
    const opensWell = post.openRate >= medianOpenRate;
    const clicksWell = post.ctor >= medianCtor;
    const key = opensWell && clicksWell ? "winner"
      : !opensWell && clicksWell ? "subject"
      : opensWell ? "content"
      : "weak";
    quadrants[key].push(post);
  }
  for (const key of Object.keys(quadrants)) {
    quadrants[key].sort((a, b) => (b.openRate + b.ctor) - (a.openRate + a.ctor));
  }
  return { state: "evidence", sample: sent.length, medianOpenRate, medianCtor, quadrants };
}

// Altas atribuidas por canal en la ventana, con la pieza de conocimiento al
// lado: eficiencia por unidad de esfuerzo (altas por envío / por nota medida).
// Las ventanas de atribución de Substack son distintas (24 h por envío,
// acumulado por nota): no tienen por qué sumar el total y no se fuerza a que
// lo hagan. Las notas sin detalle no aportan cero: quedan fuera del numerador
// y del denominador de eficiencia, y `scoredPieces` declara la cobertura.
export function getChannelAttribution(snapshot = {}, days = 30, now = Date.now()) {
  const normalized = normalizeSnapshot(snapshot);
  const campaigns = rowsInPeriod(normalized.campaigns, (row) => row.date, days, now)
    .filter((campaign) => campaign.delivered > 0);
  const notes = rowsInPeriod(normalized.notes, (row) => row.date, days, now);
  const scoredNotes = notes.filter((note) => note.stats?.available);
  const emailSignups = campaigns.reduce((sum, campaign) => sum + campaign.signupsWithin1Day, 0);
  const noteSignups = scoredNotes.reduce((sum, note) => sum + note.stats.results.freeSubscribers, 0);
  return {
    email: {
      signups: emailSignups,
      pieces: campaigns.length,
      perPiece: ratio(emailSignups, campaigns.length),
    },
    notes: {
      signups: noteSignups,
      pieces: notes.length,
      scoredPieces: scoredNotes.length,
      perPiece: ratio(noteSignups, scoredNotes.length),
    },
  };
}

export function getTrendSeries(snapshot, metric = "subscribers", days = 30) {
  const points = normalizeSnapshot(snapshot).trend;
  return points.slice(Math.max(0, points.length - days)).map((point) => ({
    date: point.date,
    value: safeNumber(point[metric]),
  }));
}

export function getDerivedMetrics(snapshot) {
  const { metrics, previous } = normalizeSnapshot(snapshot);
  // `null` cuando no hay valor anterior: fabricar un +100% sobre un cero previo
  // es inventarse el dato. El renderer dice "sin comparación", no un número.
  const change = (current, prior) => (prior > 0 ? ((current - prior) / prior) * 100 : null);

  return {
    subscriberGrowth: change(metrics.subscribers, previous.subscribers),
    paidGrowth: change(metrics.paidSubscribers, previous.paidSubscribers),
    // Substack ya publica la variación en `summary.openRateDiff`. Derivarla de
    // `previous.openRate` daba siempre 0, porque ese campo era una copia de
    // `metrics.openRate`. Si el diff no llega, se cae a la resta.
    openRateDelta: metrics.openRateDiff || (metrics.openRate - previous.openRate),
    clickRateDelta: metrics.clickRate - previous.clickRate,
    revenueGrowth: change(metrics.monthlyRevenue, previous.monthlyRevenue),
    paidConversion:
      metrics.subscribers > 0
        ? (metrics.paidSubscribers / metrics.subscribers) * 100
        : 0,
  };
}
