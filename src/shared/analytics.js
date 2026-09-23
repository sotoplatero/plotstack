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
  // Pueden ser negativos: son variaciones, no contadores.
  openRateDiff: safeNumber(metrics.openRateDiff),
  viewsDelta: safeNumber(metrics.viewsDelta),
});

// Rangos con base de comparación propia. Solo estos tres: son los que
// `summary-v2?range=N` sabe responder. Un rango ausente significa que Substack
// no dio ese arranque, no que valga cero.
export const COMPARABLE_RANGES = ["7", "30", "90"];

const cleanPreviousByRange = (input = {}) => {
  const clean = {};
  for (const days of COMPARABLE_RANGES) {
    const row = input?.[days];
    if (!row) continue;
    const subscribers = Math.max(0, Math.round(safeNumber(row.subscribers)));
    if (subscribers <= 0) continue;
    clean[days] = {
      subscribers,
      paidSubscribers: Math.max(0, Math.round(safeNumber(row.paidSubscribers))),
    };
  }
  return clean;
};

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
        section: String(campaign?.section || ""),
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
    previousByRange: cleanPreviousByRange(input.previousByRange),
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

// Etiquetas de fuente y de red tal como las devuelve Substack, en inglés y a
// veces en minúsculas ("direct to app", "Substack existing accounts"). Se
// traducen AL PINTAR, no al guardar: el snapshot conserva el valor original y
// una etiqueta nueva que Substack añada sigue viéndose, capitalizada, en lugar
// de desaparecer. La clave se compara sin mayúsculas ni espacios extra.
const SOURCE_LABELS = new Map(Object.entries({
  // network_attribution
  "substack app": "App de Substack",
  "substack existing accounts": "Cuentas que ya usaban Substack",
  "other substack network": "Resto de la red de Substack",
  "imported accounts": "Suscriptores importados",
  // visitor_sources: fuente
  "direct to app": "Directo a la app",
  "direct": "Directo",
  "email opens": "Aperturas de email",
  "email": "Email",
  "google": "Google",
  "bing": "Bing",
  "duckduckgo": "DuckDuckGo",
  "twitter": "X (Twitter)",
  "x": "X (Twitter)",
  "facebook": "Facebook",
  "linkedin": "LinkedIn",
  "reddit": "Reddit",
  "instagram": "Instagram",
  "threads": "Threads",
  "bluesky": "Bluesky",
  // visitor_sources: categoría
  "search": "Buscadores",
  "social": "Redes sociales",
  "other": "Otros",
  "substack": "Substack",
  // growth/sources: hijos de la fuente `substack`
  "notes": "Notas",
  "recommendations": "Recomendaciones",
  "onboarding": "Registro en Substack",
  "trackbacks": "Menciones en otras publicaciones",
}));

export function sourceLabel(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "Sin identificar";
  const known = SOURCE_LABELS.get(value.toLowerCase().replace(/\s+/g, " "));
  return known || value.charAt(0).toLocaleUpperCase("es-ES") + value.slice(1);
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

// La unidad de una serie de tasas se decide sobre TODAS sus tasas juntas, nunca
// por fila: con la heurística por fila, un 1% real (rate = 1 en escala
// porcentual) se pintaba como 100%. Si todas las finitas son ≤ 1, es fracción.
// Vive aquí, en la capa compartida, para que el dashboard no tenga que importar
// un proveedor de red solo por una decisión de formato.
export const isFractionScale = (values) => {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 && finite.every((value) => value <= 1);
};

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

// Corte de publicaciones por SECCION. Mismo criterio ponderado que los demas
// cortes: Sigma abrieron / Sigma entregados, nunca media de tasas. Los posts sin
// seccion se agrupan aparte en vez de descartarse: "sin seccion" es un grupo
// real, y en muchas publicaciones es el unico.
export function getCampaignSections(campaigns = []) {
  const sent = campaigns.filter((campaign) => safeNumber(campaign.delivered) > 0);
  const groups = new Map();
  for (const campaign of sent) {
    const key = String(campaign.section || "").trim() || "Sin sección";
    const bucket = groups.get(key) || [];
    bucket.push(campaign);
    groups.set(key, bucket);
  }
  return [...groups.entries()].map(([section, rows]) => {
    const delivered = rows.reduce((sum, row) => sum + safeNumber(row.delivered), 0);
    const opened = rows.reduce((sum, row) => sum + safeNumber(row.opened), 0);
    return {
      section,
      posts: rows.length,
      delivered,
      openRate: ratio(opened, delivered) === null ? null : ratio(opened, delivered) * 100,
      scarce: rows.length < MIN_CUT_N,
    };
  }).sort((a, b) => (b.openRate ?? -1) - (a.openRate ?? -1));
}

// Vistas por entrega. Mayor que 1 significa que la pieza vive FUERA del correo:
// web, app, recomendaciones. Es la pregunta que los dos numeros ya guardados
// respondian por separado y nadie cruzaba. `null` sin envio: no hay denominador.
export const viewsPerDelivery = (campaign) => ratio(safeNumber(campaign?.views), safeNumber(campaign?.delivered));

// Reparto de las publicaciones entre las que dependen del correo y las que se
// descubren fuera. El umbral es 1 vista por entrega, no un percentil inventado:
// por debajo, cada entrega genero menos de una lectura.
export function getDiscoveryMix(campaigns = []) {
  const measured = campaigns
    .map((campaign) => ({ campaign, ratio: viewsPerDelivery(campaign) }))
    .filter((row) => row.ratio !== null);
  if (!measured.length) return { state: "nodata", posts: 0, beyondEmail: 0, emailBound: 0, median: null, top: [] };
  const values = measured.map((row) => row.ratio).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return {
    state: "evidence",
    posts: measured.length,
    beyondEmail: measured.filter((row) => row.ratio > 1).length,
    emailBound: measured.filter((row) => row.ratio <= 1).length,
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    top: [...measured].sort((a, b) => b.ratio - a.ratio).slice(0, 3)
      .map((row) => ({ title: row.campaign.title, date: row.campaign.date, ratio: row.ratio })),
  };
}

// Altas medias en dias CON publicacion frente a dias sin ella. Las dos series
// ya existian: fechas de envio y altas por dia. La comparacion es lo que faltaba.
// Solo cuenta dias dentro del rango de la serie de altas: fuera de el no hay
// medicion, y un dia sin fila de altas dentro del rango es un cero medido.
export function getPublishingRhythm(snapshot = {}, dailySignups = [], days = 30, now = Date.now()) {
  const serie = dailySignups.filter((point) => point && point.date);
  if (!serie.length) return { state: "nodata", publishDays: 0, quietDays: 0, onPublish: null, onQuiet: null, lift: null };
  const desde = Number.isFinite(days) ? now - days * 86400000 : -Infinity;
  const enRango = serie.filter((point) => parseDay(point.date).getTime() >= desde);
  if (!enRango.length) return { state: "nodata", publishDays: 0, quietDays: 0, onPublish: null, onQuiet: null, lift: null };

  const fechas = new Set();
  for (const campaign of normalizeSnapshot(snapshot).campaigns) {
    const day = String(campaign.date || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) fechas.add(day);
  }
  const conPublicacion = [];
  const sinPublicacion = [];
  for (const point of enRango) {
    const altas = safeNumber(point.new ?? point.signups);
    (fechas.has(String(point.date).slice(0, 10)) ? conPublicacion : sinPublicacion).push(altas);
  }
  const media = (rows) => (rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null);
  const onPublish = media(conPublicacion);
  const onQuiet = media(sinPublicacion);
  return {
    // Con un solo dia de publicacion la media es ese dia: se declara escaso.
    state: conPublicacion.length >= MIN_CUT_N && sinPublicacion.length >= MIN_CUT_N ? "evidence" : "insufficient",
    publishDays: conPublicacion.length,
    quietDays: sinPublicacion.length,
    onPublish,
    onQuiet,
    // Cuantas veces mas altas trae un dia de publicacion. `null` si no hay base.
    lift: onPublish === null || onQuiet === null ? null : ratio(onPublish, onQuiet),
  };
}

// Concentracion: que parte del total viene de las `top` primeras filas. Dice si
// el crecimiento depende de un solo canal. `null` sin total medido.
export function getConcentration(rows = [], valueOf = (row) => row.value, top = 3) {
  const values = rows.map((row) => safeNumber(valueOf(row))).filter((value) => value > 0).sort((a, b) => b - a);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return { share: null, total: 0, counted: 0, top: 0 };
  const head = values.slice(0, top).reduce((sum, value) => sum + value, 0);
  return { share: (head / total) * 100, total, counted: values.length, top: Math.min(top, values.length) };
}

// Que superficie CONVIERTE, no cual da mas alcance. Substack reparte las
// impresiones de cada nota entre Feed, Notificaciones, Perfil, etc., pero solo
// da las altas de la nota entera, no por superficie. Asi que la conversion por
// superficie no se puede medir: lo que si se puede es repartir las altas de
// cada nota en proporcion a sus impresiones por superficie, y decirlo.
//
// Solo entran notas con detalle Y con impresiones: sin denominador no hay
// reparto, y una nota sin estadisticas no aporta ceros.
export function getSurfaceYield(notes = [], surfaceKeys = NOTE_SURFACE_KEYS) {
  const totals = Object.fromEntries(surfaceKeys.map((key) => [key, { impressions: 0, signups: 0 }]));
  let scoredNotes = 0;
  for (const note of notes) {
    const stats = note?.stats;
    if (!stats?.available) continue;
    const impressions = safeNumber(stats.reach?.impressions);
    const surfaceTotal = surfaceKeys.reduce((sum, key) => sum + safeNumber(stats.surfaces?.[key]), 0);
    if (impressions <= 0 || surfaceTotal <= 0) continue;
    scoredNotes += 1;
    const signups = safeNumber(stats.results?.freeSubscribers);
    for (const key of surfaceKeys) {
      const share = safeNumber(stats.surfaces?.[key]) / surfaceTotal;
      totals[key].impressions += safeNumber(stats.surfaces?.[key]);
      totals[key].signups += signups * share;
    }
  }
  const rows = surfaceKeys.map((key) => {
    const bucket = totals[key];
    const per1000 = ratio(bucket.signups, bucket.impressions);
    return {
      surface: key,
      impressions: Math.round(bucket.impressions),
      signups: bucket.signups,
      // Altas por cada mil impresiones. `null` sin impresiones medidas.
      per1000: per1000 === null ? null : per1000 * 1000,
    };
  }).filter((row) => row.impressions > 0);
  return {
    rows: rows.sort((a, b) => (b.per1000 ?? -1) - (a.per1000 ?? -1)),
    scoredNotes,
    // El reparto es proporcional, no medido: la interfaz TIENE que decirlo.
    estimated: true,
  };
}

// Cuanto sales de tu burbuja. `Unconnected` son impresiones de gente que no te
// sigue ni te lee: la unica senal de alcance nuevo que da `note_stats`.
export function getReachBeyondBubble(notes = []) {
  let unconnected = 0;
  let known = 0;
  let scoredNotes = 0;
  for (const note of notes) {
    const audience = note?.stats?.available ? note.stats.audience : null;
    if (!audience) continue;
    const fuera = safeNumber(audience.Unconnected);
    const dentro = safeNumber(audience.Subscribers) + safeNumber(audience.Followers);
    if (fuera + dentro <= 0) continue;
    scoredNotes += 1;
    unconnected += fuera;
    known += dentro;
  }
  const share = ratio(unconnected, unconnected + known);
  return {
    unconnected,
    known,
    scoredNotes,
    // `null` sin ninguna nota medida: no es un 0% de alcance nuevo.
    share: share === null ? null : share * 100,
  };
}

export function getTrendSeries(snapshot, metric = "subscribers", days = 30) {
  const points = normalizeSnapshot(snapshot).trend;
  return points.slice(Math.max(0, points.length - days)).map((point) => ({
    date: point.date,
    value: safeNumber(point[metric]),
  }));
}

// Base de comparación para el rango activo. `range` = arranque que Substack da
// para esa ventana; `history` = el punto más antiguo del histórico local (única
// base posible con "Todo"); `none` = no hay con qué comparar, y entonces los
// deltas son `null` en vez de un porcentaje inventado.
export function getComparisonBase(snapshot, days = 30) {
  const { previousByRange, previous, trend } = normalizeSnapshot(snapshot);
  if (Number.isFinite(days)) {
    // `previous` ES el arranque de 30 días, así que sirve de base para ese
    // rango: mantiene el delta vivo en snapshots guardados antes de que
    // existiera `previousByRange`, sin extenderlo a 7D ni 90D, donde sería la
    // ventana equivocada con la etiqueta correcta.
    const row = previousByRange[String(days)]
      || (days === 30 && previous.subscribers > 0 ? { subscribers: previous.subscribers, paidSubscribers: previous.paidSubscribers } : null);
    return row
      ? { basis: "range", days, sinceDate: "", subscribers: row.subscribers, paidSubscribers: row.paidSubscribers }
      : { basis: "none", days, sinceDate: "", subscribers: 0, paidSubscribers: 0 };
  }
  // `trend` viene ordenado ascendente. El último punto es la captura de hoy: no
  // sirve como base de sí mismo.
  const oldest = trend.length > 1 ? trend[0] : null;
  return oldest
    ? { basis: "history", days, sinceDate: oldest.date, subscribers: oldest.subscribers, paidSubscribers: oldest.paidSubscribers }
    : { basis: "none", days, sinceDate: "", subscribers: 0, paidSubscribers: 0 };
}

export function getDerivedMetrics(snapshot, days = 30) {
  const { metrics, previous } = normalizeSnapshot(snapshot);
  // `null` cuando no hay valor anterior: fabricar un +100% sobre un cero previo
  // es inventarse el dato. El renderer dice "sin comparación", no un número.
  const change = (current, prior) => (prior > 0 ? ((current - prior) / prior) * 100 : null);
  const base = getComparisonBase(snapshot, days);

  return {
    comparison: base,
    subscriberGrowth: change(metrics.subscribers, base.subscribers),
    paidGrowth: change(metrics.paidSubscribers, base.paidSubscribers),
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

// ── Récords, hitos y fidelidad ─────────────────────────────────────────────
// Todo lo de este bloque son conteos agregados: ninguna función recibe ni
// devuelve datos de una persona.

// Fecha civil local "YYYY-MM-DD". No `toISOString()`: en zonas negativas la
// medianoche UTC cae en el día anterior.
export const civilDay = (value = Date.now()) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

// Lunes de la semana de una fecha civil, como "YYYY-MM-DD".
const weekStartOf = (day) => {
  const date = parseDay(day);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return civilDay(date);
};

const inWindow = (day, days, now) => !Number.isFinite(days) || parseDay(day).getTime() >= now - days * 86400000;
const signupsOf = (point) => safeNumber(point?.new ?? point?.signups);

// Semanas consecutivas con al menos un envío o una nota. La racha actual cuenta
// hacia atrás desde la semana en curso; si esta semana aún no hay nada, la
// racha sigue viva si la semana anterior sí tuvo (la semana no ha terminado).
function getStreaks(days = []) {
  const weeks = [...new Set(days.map(weekStartOf))].sort();
  if (!weeks.length) return { current: 0, longest: 0 };
  const next = (week) => { const date = parseDay(week); date.setDate(date.getDate() + 7); return civilDay(date); };
  let longest = 1;
  let run = 1;
  for (let index = 1; index < weeks.length; index += 1) {
    run = weeks[index] === next(weeks[index - 1]) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current: run, longest, lastWeek: weeks.at(-1) };
}

// Récords dentro del rango elegido. `null` en cada récord que no tenga base:
// un récord de cero no es un récord.
export function getRecords({ snapshot = {}, subscriberDaily = [], days = 30, now = Date.now() } = {}) {
  const { campaigns, notes } = normalizeSnapshot(snapshot);

  const weekly = new Map();
  for (const point of subscriberDaily) {
    if (!point?.date || !inWindow(point.date, days, now)) continue;
    const week = weekStartOf(String(point.date).slice(0, 10));
    weekly.set(week, (weekly.get(week) || 0) + signupsOf(point));
  }
  const bestWeekEntry = [...weekly.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
  const bestWeek = bestWeekEntry && bestWeekEntry[1] > 0 ? { weekStart: bestWeekEntry[0], signups: bestWeekEntry[1] } : null;

  const ranged = campaigns.filter((campaign) => campaign.date && inWindow(String(campaign.date).slice(0, 10), days, now));
  // Un envío a 5 personas con un 80% de apertura no es un récord: se exige una
  // entrega de al menos la mitad de la mediana de entregas del rango.
  const delivered = ranged.map((campaign) => campaign.delivered).filter((value) => value > 0).sort((a, b) => a - b);
  const medianDelivered = delivered.length ? delivered[Math.floor((delivered.length - 1) / 2)] : 0;
  const bestOf = (rows, valueOf) => {
    const best = [...rows].filter((row) => valueOf(row) > 0).sort((a, b) => valueOf(b) - valueOf(a))[0];
    return best ? { title: best.title, date: String(best.date).slice(0, 10), value: valueOf(best) } : null;
  };
  const bestOpen = bestOf(ranged.filter((campaign) => campaign.delivered > 0 && campaign.delivered >= medianDelivered / 2), (campaign) => campaign.openRate);
  const bestSignups = bestOf(ranged, (campaign) => campaign.signupsWithin1Day);

  const rangedNotes = notes.filter((note) => note.date && inWindow(String(note.date).slice(0, 10), days, now));
  const noteScore = (note) => safeNumber(note.reactions) + safeNumber(note.replies) + safeNumber(note.restacks);
  const topNote = [...rangedNotes].filter((note) => noteScore(note) > 0).sort((a, b) => noteScore(b) - noteScore(a))[0];
  const bestNote = topNote ? { body: topNote.body, date: String(topNote.date).slice(0, 10), value: noteScore(topNote) } : null;

  // La racha actual no depende del rango (es "hoy"); la más larga sí.
  const allDays = [...campaigns, ...notes].map((row) => String(row.date || "").slice(0, 10)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  const all = getStreaks(allDays);
  const thisWeek = weekStartOf(civilDay(now));
  const lastWeekDate = parseDay(thisWeek); lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const alive = all.lastWeek === thisWeek || all.lastWeek === civilDay(lastWeekDate);
  const inRange = getStreaks(allDays.filter((day) => inWindow(day, days, now)));

  return {
    bestWeek,
    bestOpen,
    bestSignups,
    bestNote,
    streak: { current: alive ? all.current : 0, longest: inRange.longest },
  };
}

// Hitos redondos que una autora celebra. Pasado el último, cada 50.000.
const MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
export const nextMilestone = (current) => MILESTONES.find((value) => value > current)
  ?? (Math.floor(current / 50000) + 1) * 50000;

// Proyección al próximo hito con el ritmo NETO (altas − bajas) de dos ventanas
// fijas, 30 y 90 días. Dos ventanas dan un rango, nunca una promesa. Sin ritmo
// positivo no se proyecta: "a este ritmo, nunca" no es una fecha.
export function getMilestoneProjection({ current = 0, growthDaily = [], now = Date.now() } = {}) {
  const target = nextMilestone(current);
  const previous = [...MILESTONES].reverse().find((value) => value <= current) ?? 0;
  const remaining = target - current;
  const rateOver = (windowDays) => {
    const rows = growthDaily.filter((row) => row?.date && inWindow(row.date, windowDays, now));
    if (!rows.length) return null;
    const oldest = Math.min(...rows.map((row) => parseDay(row.date).getTime()));
    // Una serie que solo cubre 10 de los 90 días no mide el ritmo de 90 días.
    if (now - oldest < windowDays * 0.6 * 86400000) return null;
    const net = rows.reduce((sum, row) => sum + safeNumber(row.net ?? (signupsOf(row) - safeNumber(row.losses))), 0);
    return net / windowDays;
  };
  const estimates = [30, 90].map((windowDays) => {
    const rate = rateOver(windowDays);
    if (rate === null) return { windowDays, rate: null, date: null };
    if (rate <= 0) return { windowDays, rate, date: null };
    return { windowDays, rate, date: civilDay(now + Math.ceil(remaining / rate) * 86400000) };
  });
  const dated = estimates.filter((row) => row.date);
  return {
    current,
    target,
    previous,
    remaining,
    progress: ratio(current - previous, target - previous),
    estimates,
    state: dated.length ? "projected" : estimates.some((row) => row.rate !== null) ? "flat" : "nodata",
  };
}

// Núcleo fiel: puntuación 5 de Substack; muy activos: 4 o 5. La evolución sale
// del histórico que guarda PlotStack en cada sincronización, recortado al rango.
export function getLoyalCore(timeline = {}, history = [], days = 30, now = Date.now()) {
  const ratings = Array.isArray(timeline?.ratings) && timeline.ratings.length === 6 ? timeline.ratings.map(safeNumber) : [];
  const total = ratings.reduce((sum, count) => sum + count, 0);
  if (!total) return { state: "nodata", total: 0, core: 0, active: 0, coreShare: null, activeShare: null, ratings: [], history: [], change: null, partial: Boolean(timeline?.partial) };
  const core = ratings[5];
  const active = ratings[4] + ratings[5];
  const ranged = history.filter((point) => point?.date && inWindow(point.date, days, now));
  const base = ranged.length > 1 ? ranged[0] : null;
  return {
    state: "ready",
    total,
    core,
    active,
    coreShare: ratio(core, total) === null ? null : ratio(core, total) * 100,
    activeShare: ratio(active, total) === null ? null : ratio(active, total) * 100,
    ratings,
    history: ranged,
    // `null` sin una captura anterior en el rango: un delta sin base no es +0.
    change: base ? core - safeNumber(base.core) : null,
    changeSince: base ? base.date : "",
    partial: Boolean(timeline?.partial),
  };
}

// Mínimo de suscriptores actuales de un mes para leer su actividad sin que un
// par de personas mueva el porcentaje. Umbral de producto, como MIN_CUT_N.
export const MIN_COHORT_N = 10;

// ¿Siguen leyendo los que llegaron cada mes? De los suscriptores ACTUALES que
// se dieron de alta ese mes, qué parte tiene actividad alta. `subscriber-stats`
// solo lista a quienes siguen suscritos: para saber cuántos se fueron se cruza
// con las altas del histórico de crecimiento de ese mes, y si las dos fuentes no
// cuadran (más actuales que altas) el dato de permanencia queda en `null`.
export function getCohortActivity(timeline = {}, growthDaily = [], days = 30, now = Date.now()) {
  const cohorts = Array.isArray(timeline?.cohorts) ? timeline.cohorts : [];
  // Serie truncada: el mes más antiguo contado está a medias.
  const complete = timeline?.partial ? cohorts.slice(1) : cohorts;
  const joinedByMonth = new Map();
  let growthFrom = "";
  for (const row of growthDaily) {
    if (!row?.date) continue;
    const month = String(row.date).slice(0, 7);
    joinedByMonth.set(month, (joinedByMonth.get(month) || 0) + signupsOf(row));
    if (!growthFrom || row.date < growthFrom) growthFrom = String(row.date);
  }
  const cutoffMonth = Number.isFinite(days) ? civilDay(now - days * 86400000).slice(0, 7) : "";
  const rows = complete
    .filter((cohort) => !cutoffMonth || cohort.month >= cutoffMonth)
    .map((cohort) => {
      const current = safeNumber(cohort.current);
      // El primer mes del histórico de crecimiento puede empezar a mitad: sus
      // altas estarían infracontadas y la permanencia saldría inflada.
      const growthCovers = growthFrom && cohort.month > growthFrom.slice(0, 7);
      const joined = growthCovers ? joinedByMonth.get(cohort.month) ?? null : null;
      const stayed = joined && current <= joined ? ratio(current, joined) : null;
      return {
        month: cohort.month,
        current,
        alta: safeNumber(cohort.alta),
        baja: safeNumber(cohort.baja),
        inactiva: safeNumber(cohort.inactiva),
        activeShare: ratio(safeNumber(cohort.alta), current) === null ? null : ratio(safeNumber(cohort.alta), current) * 100,
        joined,
        stayedShare: stayed === null ? null : stayed * 100,
        scarce: current < MIN_COHORT_N,
      };
    })
    .filter((row) => row.current > 0);
  return { rows, partial: Boolean(timeline?.partial) };
}

// Una captura del núcleo por día civil, heredada de la sincronización anterior.
// Si esta sincronización no trajo puntuaciones, se conserva el histórico tal
// cual: un fallo parcial nunca borra lo que ya había.
export function withLoyaltyHistory(fresh = {}, previous = {}, now = Date.now()) {
  const prior = (Array.isArray(previous?.audience?.loyaltyHistory) ? previous.audience.loyaltyHistory : [])
    .filter((point) => point && /^\d{4}-\d{2}-\d{2}$/.test(String(point.date)))
    .map((point) => ({ date: String(point.date), core: safeNumber(point.core), active: safeNumber(point.active), total: safeNumber(point.total) }));
  const ratings = fresh?.audience?.timeline?.ratings;
  const total = Array.isArray(ratings) ? ratings.reduce((sum, count) => sum + safeNumber(count), 0) : 0;
  const today = civilDay(now);
  const history = total > 0
    ? [...prior.filter((point) => point.date !== today), { date: today, core: safeNumber(ratings[5]), active: safeNumber(ratings[4]) + safeNumber(ratings[5]), total }]
    : prior;
  history.sort((a, b) => a.date.localeCompare(b.date));
  return { ...fresh, audience: { ...(fresh?.audience || {}), loyaltyHistory: history.slice(-400) } };
}
