const API_ROOT = "https://substack.com/api/v1";

export class SubstackApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "SubstackApiError";
    this.status = status;
  }
}

// Limitador ÚNICO para todas las peticiones del proveedor. El snapshot y las
// fuentes ampliadas se lanzan en paralelo, así que sin un tope global salían
// ~15 peticiones a la vez (5 detalles + 3 note_stats + 9 fuentes + paginación)
// y Substack respondía 429, que es lo que cortaba la cola de notas. El 429
// sigue propagándose: la política de reintento y corte no cambia.
const limiter = { concurrency: 4, gapMs: 60, active: 0, lastStart: 0, queue: [] };

export function configureRequestLimiter({ concurrency, gapMs } = {}) {
  if (Number.isFinite(concurrency) && concurrency > 0) limiter.concurrency = Math.floor(concurrency);
  if (Number.isFinite(gapMs) && gapMs >= 0) limiter.gapMs = gapMs;
}

const drainLimiter = () => {
  while (limiter.queue.length && limiter.active < limiter.concurrency) {
    const release = limiter.queue.shift();
    limiter.active += 1;
    release();
  }
};

async function withLimit(task) {
  if (limiter.active >= limiter.concurrency) {
    await new Promise((resolve) => limiter.queue.push(resolve));
  } else {
    limiter.active += 1;
  }
  // Hueco mínimo entre salidas: la concurrencia sola permite ráfagas de 4
  // simultáneas cada milisegundo, que Substack también penaliza.
  const wait = limiter.gapMs - (Date.now() - limiter.lastStart);
  if (wait > 0) await pause(wait);
  limiter.lastStart = Date.now();
  try {
    return await task();
  } finally {
    limiter.active -= 1;
    drainLimiter();
  }
}

export async function requestJson(url, options = {}) {
  return withLimit(() => performRequest(url, options));
}

async function performRequest(url, options = {}) {
  const hasJson = options.json !== undefined;
  const response = await fetch(url, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(hasJson ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...(hasJson ? { body: JSON.stringify(options.json) } : {}),
    cache: "no-store",
  });
  if (response.status === 401) throw new SubstackApiError("Tu sesión de Substack no está activa.", 401);
  if (response.status === 403) throw new SubstackApiError("La cuenta conectada no tiene acceso a esta publicación.", 403);
  if (response.status === 429) throw new SubstackApiError("Substack limitó temporalmente las solicitudes. Espera un momento y sincroniza de nuevo.", 429);
  if (!response.ok) throw new SubstackApiError(`Substack respondió con un error (${response.status}).`, response.status);
  if (response.status === 204) return {};
  return response.json();
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Parada incremental: el feed viene de más reciente a más antiguo, así que en
// cuanto una página entera son notas que ya están en el snapshot, lo que queda
// detrás también lo está. Sin esto se releían hasta 60 páginas en cada sync.
// `fullRefresh` fuerza el recorrido completo para refrescar likes y respuestas
// de notas antiguas; el orquestador lo pide una vez por semana.
export async function getAllProfileFeedItems(userId, options = 60) {
  const { maxPages = 60, knownIds = null, fullRefresh = false } = typeof options === "number" ? { maxPages: options } : options || {};
  if (!userId) return [];
  const items = [];
  let cursor = "";
  const isKnown = (item) => {
    const key = String(item?.entity_key || "");
    return knownIds?.has(key) || knownIds?.has(key.replace(/^c-/, ""));
  };
  for (let page = 0; page < maxPages; page += 1) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    let payload;
    try {
      payload = await requestJson(`${API_ROOT}/reader/feed/profile/${userId}${suffix}`);
    } catch (error) {
      if (!items.length) throw error;
      break;
    }
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    items.push(...pageItems);
    const nextCursor = payload?.nextCursor || payload?.next_cursor || "";
    if (!nextCursor || !pageItems.length || nextCursor === cursor) break;
    if (!fullRefresh && knownIds?.size && pageItems.every(isKnown)) break;
    cursor = nextCursor;
    await pause(80);
  }
  return items;
}

const asNumber = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

export async function getProfile() {
  const profile = await requestJson(`${API_ROOT}/user/profile/self`);
  const publications = (profile.publicationUsers || [])
    .filter((entry) => entry?.publication?.subdomain)
    .map((entry) => ({
      id: entry.publication.id,
      name: entry.publication.name || entry.publication.subdomain,
      subdomain: entry.publication.subdomain,
      logoUrl: entry.publication.logo_url || "",
      role: entry.role || "",
      primary: Boolean(entry.is_primary),
      userId: profile.id,
      userHandle: profile.handle || "",
      followerCount: asNumber(profile.followerCount, profile.follower_count),
    }));
  return {
    user: {
      id: profile.id,
      name: profile.name || profile.handle || "Creador",
      handle: profile.handle || "",
      followerCount: asNumber(profile.followerCount, profile.follower_count),
    },
    publications,
  };
}

const dateBefore = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

const text = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const unwrapRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  for (const key of ["posts", "rows", "data", "email_stats", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
};

// Primer valor finito entre los alias, o `null` si ninguno viene en la fila.
// `null` importa: un numerador ausente no es un cero medido, y tratarlo así
// hacía que el cociente diera 0% en payloads que sí traen su propia tasa.
const firstFinite = (row, keys) => {
  for (const key of keys) {
    const value = Number(row?.[key] ?? row?.stats?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const rateFrom = (row, rateKeys, numeratorKeys, denominatorKeys) => {
  const numerator = firstFinite(row, numeratorKeys);
  const denominator = firstFinite(row, denominatorKeys);
  // Con numerador y denominador reales manda el cociente: no hay ambigüedad de
  // unidad y usa el mismo denominador que `weightedRate` y `getRateWindows`.
  if (numerator !== null && denominator !== null && denominator > 0) return (numerator / denominator) * 100;
  // Si no, la tasa de la API TAL CUAL: viene en porcentaje (`open_rate: 33.01`
  // observado), así que la heurística "≤1 ⇒ ×100" convertía un 0,8% en 80%.
  return firstFinite(row, rateKeys) ?? 0;
};

export const mapCampaign = (row, index) => ({
  id: String(row.id ?? row.post_id ?? index),
  title: row.title || row.subject || row.post?.title || row.draft_title || "Sin título",
  subtitle: text(row.subtitle, row.social_title, row.search_engine_description, row.post?.subtitle),
  slug: text(row.slug, row.post?.slug),
  audience: text(row.audience, row.post?.audience),
  type: text(row.type, row.post?.type),
  wordcount: asNumber(row.wordcount, row.word_count, row.stats?.wordcount, row.post?.wordcount),
  date: row.post_date || row.published_at || row.sent_at || row.date || "",
  status: "Enviado",
  recipients: asNumber(row.recipients, row.emails_delivered, row.delivered, row.total_email, row.stats?.emails_delivered),
  // Aperturas y clics ÚNICOS primero (`emails_opened`, `opened`); los totales
  // (`opens`, `clicks`) solo como último recurso: inflan la tasa porque cuentan
  // repeticiones del mismo lector. `opened` y `clicked` faltaban en esta lista,
  // así que un payload que solo trae esas claves caía a la tasa de la API.
  openRate: rateFrom(row, ["open_rate", "openRate"], ["emails_opened", "opened", "opens"], ["emails_delivered", "delivered"]),
  clickRate: rateFrom(row, ["click_through_rate", "click_rate", "clickRate"], ["emails_clicked", "clicked", "clicks"], ["emails_delivered", "delivered"]),
  sent: asNumber(row.sent, row.stats?.sent),
  delivered: asNumber(row.delivered, row.emails_delivered, row.stats?.delivered),
  opens: asNumber(row.opens, row.stats?.opens),
  opened: asNumber(row.opened, row.emails_opened, row.stats?.opened),
  clicks: asNumber(row.clicks, row.stats?.clicks),
  clicked: asNumber(row.clicked, row.emails_clicked, row.stats?.clicked),
  views: asNumber(row.views, row.stats?.views),
  shares: asNumber(row.shares, row.stats?.shares),
  signups: asNumber(row.signups, row.stats?.signups),
  subscribes: asNumber(row.subscribes, row.stats?.subscribes),
  signupsWithin1Day: asNumber(row.signups_within_1_day, row.stats?.signups_within_1_day),
  subscriptionsWithin1Day: asNumber(row.subscriptions_within_1_day, row.stats?.subscriptions_within_1_day),
  unsubscribesWithin1Day: asNumber(row.unsubscribes_within_1_day, row.stats?.unsubscribes_within_1_day),
  disablesWithin1Day: asNumber(row.disables_within_1_day, row.stats?.disables_within_1_day),
  downloads: asNumber(row.downloads, row.stats?.downloads),
  videoViews: asNumber(row.video_views, row.stats?.video_views),
  videoMinutesWatched: asNumber(row.video_minutes_watched, row.stats?.video_minutes_watched),
  estimatedValue: asNumber(row.estimated_value, row.stats?.estimated_value),
  reactions: asNumber(row.reaction_count, row.stats?.reaction_count),
  comments: asNumber(row.comment_count, row.stats?.comment_count),
  engagementRate: rateFrom(row, ["engagement_rate", "engagementRate"], [], []),
  detailAvailable: Boolean(row.stats),
});

// Mismo criterio incremental que el feed de notas: la lista viene en orden
// descendente por fecha y solo aporta id, título y fecha; las métricas salen de
// `post_management/detail`, que ya se reutiliza del snapshot anterior.
export async function getAllPublishedPosts(base, options = 40) {
  const { maxPages = 40, knownIds = null, fullRefresh = false } = typeof options === "number" ? { maxPages: options } : options || {};
  const posts = [];
  const limit = 50;
  const isKnown = (row) => knownIds?.has(String(row?.id ?? row?.post_id));
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit;
    const payload = await requestJson(`${base}/post_management/published?offset=${offset}&limit=${limit}&order_by=post_date&order_direction=desc`);
    const rows = unwrapRows(payload);
    posts.push(...rows);
    const total = asNumber(payload?.total);
    if (!rows.length || rows.length < limit || (total && posts.length >= total)) break;
    if (!fullRefresh && knownIds?.size && rows.every(isKnown)) break;
    await pause(80);
  }
  return posts;
}

const stripMarkup = (value = "") => String(value)
  .replace(/<\s*br\s*\/?>/gi, "\n")
  .replace(/<\/\s*(?:p|div|li|h[1-6]|blockquote)\s*>/gi, "\n")
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/[^\S\n]+/g, " ")
  .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

export const mapNote = (item, index = 0) => {
  const note = item?.comment || item?.context?.comment || {};
  const entityKey = String(item?.entity_key || `c-${note.id || index}`);
  return {
    id: String(note.id || entityKey.replace(/^c-/, "") || index),
    entityKey,
    body: stripMarkup(note.body || note.body_html || note.body_text || "Nota sin texto"),
    date: note.date || note.created_at || item?.context?.timestamp || item?.timestamp || "",
    reactions: asNumber(note.reaction_count, note.reactions_count, note.likes),
    replies: asNumber(note.children_count, note.reply_count, note.replies_count),
    restacks: asNumber(note.restacks, note.restack_count),
    url: note.canonical_url || note.url || "",
  };
};

const labelKey = (value = "") => String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const NOTE_SURFACES = ["Feed", "Notifications", "Profile page", "Permalinks", "Notes", "Search", "Other"];
const NOTE_AUDIENCES = ["Subscribers", "Followers", "Unconnected"];

const cardsById = (payload) => {
  const map = new Map();
  for (const card of Array.isArray(payload?.cards) ? payload.cards : []) {
    if (card?.cardId) map.set(String(card.cardId), card);
  }
  return map;
};

// Suma dentro de UNA tarjeta, por titulo exacto. Nunca cruza tarjetas.
const cardValue = (card, ...titles) => {
  const wanted = titles.map((title) => title.toLowerCase());
  const pools = [...(card?.headers || []), ...(card?.items || [])];
  for (const entry of pools) {
    const title = String(entry?.title || "").toLowerCase();
    if (!wanted.includes(title)) continue;
    let value = Number(entry.value);
    if (!Number.isFinite(value)) continue;
    if (entry.valueType === "usd" && entry.currencyIsMinorUnits) value /= 100;
    return value;
  }
  return 0;
};

const breakdown = (card, labels) => Object.fromEntries(labels.map((label) => [label, cardValue(card, label)]));

export const normalizeNoteStats = (payload = {}) => {
  const cards = cardsById(payload);
  const interactionsCard = cards.get("interactions");
  const impressionsCard = cards.get("impressions");
  const subscribersCard = cards.get("new_subscribers");

  const interactions = {
    total: cardValue(interactionsCard, "Interactions"),
    likes: cardValue(interactionsCard, "Like", "Likes"),
    restacks: cardValue(interactionsCard, "Restack", "Restacks"),
    profileVisits: cardValue(interactionsCard, "Profile visit", "Profile visits"),
    replies: cardValue(interactionsCard, "Reply", "Replies"),
    saves: cardValue(interactionsCard, "Save", "Saves"),
    shares: cardValue(interactionsCard, "Share", "Shares"),
    linkClicks: cardValue(interactionsCard, "Link click", "Link clicks"),
  };
  if (!interactions.total) {
    interactions.total = interactions.likes + interactions.restacks + interactions.profileVisits
      + interactions.replies + interactions.saves + interactions.shares + interactions.linkClicks;
  }

  return {
    // `cards` con solo la tarjeta `note` no es detalle: es una nota sin datos.
    available: [...cards.keys()].some((id) => id !== "note"),
    updatedAt: payload.lastUpdatedAt || "",
    interactions,
    results: {
      freeSubscribers: cardValue(subscribersCard, "New free subs"),
      paidSubscribers: cardValue(subscribersCard, "New paid subs"),
    },
    reach: { impressions: cardValue(impressionsCard, "Impressions") },
    // Desgloses reales que hasta ahora se tiraban enteros.
    surfaces: breakdown(cards.get("surfaces"), NOTE_SURFACES),
    audience: breakdown(cards.get("audience"), NOTE_AUDIENCES),
  };
};

// Un historial largo de notas puede superar el limite de peticiones de Substack.
// Estas constantes reparten las llamadas y hacen que la cola converja: una nota
// que Substack se niega a responder deja de reintentarse tras MAX_ATTEMPTS.
export const NOTE_STATS_MAX_ATTEMPTS = 3;
const NOTE_STATS_CONCURRENCY = 3;
const NOTE_STATS_PAUSE_MS = 120;
const NOTE_STATS_RETRIES = 2;
const NOTE_STATS_BACKOFF_MS = 600;
const NOTE_PENDING_WINDOW_MS = 24 * 3600 * 1000;

const isRateLimit = (error) => error?.status === 429;

// `note_stats` exige el identificador con prefijo `c-`. Con el id numerico pelado
// responde 400, que era la razon real de que ninguna nota tuviera estadisticas.
export const noteStatsKey = (note) => {
  const raw = String(note?.entityKey || note?.id || "");
  return raw.startsWith("c-") ? raw : `c-${raw}`;
};

async function requestWithBackoff(url, retries = NOTE_STATS_RETRIES) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJson(url);
    } catch (error) {
      if (!isRateLimit(error) || attempt >= retries) throw error;
      await pause(NOTE_STATS_BACKOFF_MS * 2 ** attempt);
    }
  }
}

// Al primer 429 que sobrevive al backoff dejamos de pedir: seguir insistiendo
// solo profundiza el bloqueo y vacia las estadisticas que si teniamos.
export async function collectNoteStats(notes, { concurrency = NOTE_STATS_CONCURRENCY, pauseMs = NOTE_STATS_PAUSE_MS, onProgress = null } = {}) {
  const results = new Map();
  let throttled = false;
  let nextIndex = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, notes.length) }, async () => {
    while (nextIndex < notes.length && !throttled) {
      const note = notes[nextIndex++];
      try {
        results.set(String(note.id), { status: "fulfilled", value: await requestWithBackoff(`${API_ROOT}/note_stats/${noteStatsKey(note)}`) });
      } catch (error) {
        if (isRateLimit(error)) {
          throttled = true;
          break;
        }
        results.set(String(note.id), { status: "rejected", reason: error });
      }
      done += 1;
      // Un aviso cada cinco notas: la cola puede tener cientos y escribir en
      // `chrome.storage` por cada una es más caro que la propia petición.
      if (onProgress && (done % 5 === 0 || done === notes.length)) onProgress(done);
      if (pauseMs) await pause(pauseMs);
    }
  });
  await Promise.all(workers);
  return { results, throttled };
}

const isWithinPendingWindow = (date) => {
  const timestamp = new Date(date).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < NOTE_PENDING_WINDOW_MS;
};

// `previous` solo se conserva cuando ya traia detalle: un fallo nunca degrada a
// cero lo que una sincronizacion anterior si consiguio.
export function resolveNoteStats(note, outcome, previous, throttled) {
  const priorAttempts = Math.max(0, Math.round(Number(previous?.attempts) || 0));

  if (outcome?.status === "fulfilled") {
    const fresh = normalizeNoteStats(outcome.value);
    if (fresh.available) return { ...fresh, fetchState: "ready", attempts: 0 };
    const attempts = priorAttempts + 1;
    if (previous?.available) return { ...previous, attempts };
    return {
      ...normalizeNoteStats(),
      attempts,
      fetchState: isWithinPendingWindow(note.date)
        ? "pending"
        : attempts >= NOTE_STATS_MAX_ATTEMPTS ? "unavailable" : "pending",
    };
  }

  if (previous?.available) {
    return { ...previous, attempts: outcome ? priorAttempts + 1 : priorAttempts };
  }

  // Sin `outcome` la nota nunca se pidio en este sync: o no tocaba, o el limite
  // de peticiones corto la cola antes de llegar a ella. Los intentos no suben.
  if (!outcome) {
    return {
      ...normalizeNoteStats(),
      attempts: priorAttempts,
      fetchState: throttled
        ? "throttled"
        : priorAttempts >= NOTE_STATS_MAX_ATTEMPTS ? "unavailable" : isWithinPendingWindow(note.date) ? "pending" : "unavailable",
    };
  }

  const attempts = priorAttempts + 1;
  return {
    ...normalizeNoteStats(),
    attempts,
    fetchState: isWithinPendingWindow(note.date)
      ? "pending"
      : attempts >= NOTE_STATS_MAX_ATTEMPTS ? "unavailable" : "pending",
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// Ponderado por destinatarios entregados. Un cociente sin denominador devuelve 0,
// nunca NaN ni Infinity.
export function weightedRate(campaigns, numeratorKey) {
  let numerator = 0;
  let denominator = 0;
  for (const campaign of campaigns) {
    const delivered = asNumber(campaign?.delivered);
    if (delivered <= 0) continue;
    numerator += asNumber(campaign?.[numeratorKey]);
    denominator += delivered;
  }
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

// Refresco completo del historial cuando el snapshot guardado tiene más de una
// semana: la parada incremental de los paginadores ahorra peticiones, pero sin
// una pasada completa periódica los likes y respuestas de notas antiguas se
// quedarían congelados en el valor del día que se capturaron.
const FULL_REFRESH_AFTER_MS = 7 * 86400000;

const needsFullRefresh = (existingSnapshot) => {
  const captured = new Date(existingSnapshot?.capturedAt || 0).getTime();
  if (!Number.isFinite(captured) || captured <= 0) return true;
  return Date.now() - captured > FULL_REFRESH_AFTER_MS;
};

const campaignId = (row, index) => String(row?.id ?? row?.post_id ?? index);

// Fusiona la fila de lista con el detalle recién pedido; si el detalle no llegó,
// conserva el de la sincronización anterior. Un fallo nunca degrada a cero lo
// que ya se había medido.
function buildCampaigns(rawRows, detailById, previousById) {
  return rawRows.map((row, index) => {
    const id = campaignId(row, index);
    const detailResult = detailById.get(id);
    const detailedRow = detailResult?.status === "fulfilled" ? unwrapRows(detailResult.value)[0] : null;
    if (detailedRow) return mapCampaign({ ...row, ...detailedRow, stats: detailedRow.stats }, index);
    const previous = previousById.get(id);
    return previous?.detailAvailable ? previous : mapCampaign(row, index);
  });
}

// Notas PROPIAS del feed de perfil: el feed incluye restacks ajenos, que se
// filtran comparando `comment.user_id`, nunca por la URL del perfil.
function buildNotes(items, publication) {
  return items
    .filter((item) => item?.type === "comment" && String(item?.entity_key || "").startsWith("c-"))
    .filter((item) => Number(item?.comment?.user_id ?? item?.context?.comment?.user_id) === Number(publication.userId))
    .map((item, index) => {
      const note = mapNote(item, index);
      if (!note.url && publication.userHandle) note.url = `https://substack.com/@${publication.userHandle}/note/c-${note.id}`;
      return note;
    });
}

export function summarizeNotes(notes, throttled = false) {
  const summary = notes.reduce((total, note) => ({
    total: total.total + 1,
    reactions: total.reactions + asNumber(note.reactions),
    replies: total.replies + asNumber(note.replies),
    restacks: total.restacks + asNumber(note.restacks),
    interactions: total.interactions + asNumber(note.reactions) + asNumber(note.replies) + asNumber(note.restacks),
    notesWithRestacks: total.notesWithRestacks + (asNumber(note.restacks) > 0 ? 1 : 0),
  }), { total: 0, reactions: 0, replies: 0, restacks: 0, interactions: 0, notesWithRestacks: 0 });
  const noteTimestamps = notes.map((note) => new Date(note.date).getTime()).filter(Number.isFinite);
  const firstTimestamp = noteTimestamps.length ? Math.min(...noteTimestamps) : 0;
  const lastTimestamp = noteTimestamps.length ? Math.max(...noteTimestamps) : 0;
  summary.activeDays = firstTimestamp && lastTimestamp ? Math.max(1, Math.floor((lastTimestamp - firstTimestamp) / 86400000) + 1) : 0;
  summary.notesPerDay = summary.activeDays ? summary.total / summary.activeDays : 0;
  summary.interactionsPerNote = summary.total ? summary.interactions / summary.total : 0;
  summary.restackRate = summary.total ? (summary.notesWithRestacks / summary.total) * 100 : 0;
  summary.detailAvailable = notes.filter((note) => note.stats?.available).length;
  summary.detailPending = notes.filter((note) => note.stats?.fetchState === "pending").length;
  summary.detailUnavailable = notes.filter((note) => note.stats?.fetchState === "unavailable").length;
  summary.statsThrottled = Boolean(throttled);
  summary.firstPublishedAt = firstTimestamp ? new Date(firstTimestamp).toISOString() : "";
  summary.lastPublishedAt = lastTimestamp ? new Date(lastTimestamp).toISOString() : "";
  return summary;
}

// FASE RÁPIDA. Solo escalares y listas: nada de detalle por pieza. Devuelve un
// snapshot completo y válido para pintar, más el `context` que la fase de
// detalle necesita (filas crudas y mapas del snapshot anterior). El contexto se
// pasa en memoria y NUNCA se persiste: `normalizeSnapshot` lo descartaría, y
// las filas crudas no tienen sitio en `chrome.storage`.
export async function getCoreSnapshot(publication, existingSnapshot) {
  const base = `https://${publication.subdomain}.substack.com/api/v1`;
  const fullRefresh = needsFullRefresh(existingSnapshot);
  const previousCampaigns = new Map((existingSnapshot?.campaigns || []).map((campaign) => [String(campaign.id), campaign]));
  const previousNotes = new Map((existingSnapshot?.notes || []).map((note) => [String(note.id), note]));

  const [summaryResult, range30Result, range7Result, range90Result, emailResult, postsResult] = await Promise.allSettled([
    requestJson(`${base}/publish-dashboard/summary`),
    requestJson(`${base}/publish-dashboard/summary-v2?range=30`),
    requestJson(`${base}/publish-dashboard/summary-v2?range=7`),
    requestJson(`${base}/publish-dashboard/summary-v2?range=90`),
    requestJson(`${base}/publication/stats/email_stats`),
    getAllPublishedPosts(base, { knownIds: new Set(previousCampaigns.keys()), fullRefresh }),
  ]);
  if (summaryResult.status === "rejected" && range30Result.status === "rejected") throw summaryResult.reason;

  const summary = summaryResult.value || {};
  const range30 = range30Result.value || {};
  const range7 = range7Result.value || {};
  const range90 = range90Result.value || {};
  // Base de comparación POR RANGO. `previous` a secas siempre era la de 30
  // días, así que el delta del Resumen decía "vs. sincronización anterior"
  // mientras comparaba contra hace un mes con el selector en 7D o 90D. Un
  // rango cuya petición falló no entra en el mapa: ausencia, no cero.
  const previousByRange = {};
  for (const [days, result] of [["7", range7Result], ["30", range30Result], ["90", range90Result]]) {
    if (result.status !== "fulfilled") continue;
    const payload = result.value || {};
    const subscribers = asNumber(payload.totalSubscribersStart);
    if (subscribers <= 0) continue;
    previousByRange[days] = { subscribers, paidSubscribers: asNumber(payload.paidSubscribersStart) };
  }
  // `summary.subscribers` NO es el total: en la captura real vale 0 con 97
  // suscriptores. El total esta en `totalEmail`. Ver docs/product/substack-payloads-observados.md
  const currentSubscribers = asNumber(range30.totalSubscribersEnd, summary.totalEmail);
  const currentPaid = asNumber(range30.paidSubscribersEnd, summary.paidSubscribers, summary.numPledges);
  const currentFollowers = asNumber(publication.followerCount, existingSnapshot?.metrics?.followers);
  const currentArr = asNumber(range30.arrEnd, range30.pledgedArrEnd, summary.arr, summary.pledgesAmount);
  const now = new Date().toISOString();
  const anchors = [
    { date: dateBefore(90), subscribers: asNumber(range90.totalSubscribersStart, range30.totalSubscribersStart), paidSubscribers: asNumber(range90.paidSubscribersStart, range30.paidSubscribersStart) },
    { date: dateBefore(30), subscribers: asNumber(range30.totalSubscribersStart), paidSubscribers: asNumber(range30.paidSubscribersStart) },
    { date: dateBefore(7), subscribers: asNumber(range7.totalSubscribersStart), paidSubscribers: asNumber(range7.paidSubscribersStart) },
    { date: now.slice(0, 10), subscribers: currentSubscribers, paidSubscribers: currentPaid, followers: currentFollowers },
  ].filter((point) => point.subscribers > 0);
  const history = Array.isArray(existingSnapshot?.trend) ? existingSnapshot.trend : [];
  const uniqueTrend = new Map([...anchors, ...history, anchors.at(-1)].filter(Boolean).map((point) => [point.date, point]));

  const postRows = postsResult.status === "fulfilled" ? unwrapRows(postsResult.value) : [];
  const emailRows = emailResult.status === "fulfilled" ? unwrapRows(emailResult.value) : [];
  const rawCampaigns = postRows.length ? postRows : emailRows;
  // Sin pedir un solo detalle: cada fila se queda con el que ya tenía.
  const campaigns = buildCampaigns(rawCampaigns, new Map(), previousCampaigns);
  // Las notas de la fase rápida son las del snapshot anterior, tal cual. La
  // fase de detalle las refresca; hasta entonces se muestran las guardadas en
  // lugar de una tabla vacía.
  const notes = [...previousNotes.values()];

  const snapshot = {
    version: 1,
    provider: "substack",
    publication: publication.name,
    capturedAt: now,
    sourceUrl: `https://${publication.subdomain}.substack.com/publish`,
    metrics: {
      subscribers: currentSubscribers,
      paidSubscribers: currentPaid,
      openRate: asNumber(summary.openRate, summary.open_rate),
      clickRate: weightedRate(campaigns, "clicked"),
      monthlyRevenue: currentArr / 12,
      totalViews: asNumber(summary.views, range30.totalViewsEnd),
      // Variación de vistas que ya publica Substack para su ventana de 30 días.
      // Puede ser negativa: es una variación, no un contador.
      viewsDelta: asNumber(summary.viewsDelta),
      // `followerCount` viene del perfil, no de la publicación: son seguidores
      // de la cuenta en Substack, no suscriptores del newsletter. Si el perfil no
      // llegó, se conserva el valor anterior: un fallo parcial nunca es cero.
      followers: currentFollowers,
      // Lectores en la app de Substack. `summary.subscribers` NO es el total de
      // suscriptores: en la captura real vale 0 con 97 suscriptores.
      appSubscribers: asNumber(summary.appSubscribers),
      appSubscribersLast30Days: asNumber(summary.appSubscribersLast30Days),
      // Substack ya da la variación de apertura. Antes `previous.openRate` era
      // idéntico a `metrics.openRate`, así que el delta salía siempre 0,0%.
      openRateDiff: asNumber(summary.openRateDiff),
    },
    previous: {
      subscribers: asNumber(range30.totalSubscribersStart),
      paidSubscribers: asNumber(range30.paidSubscribersStart),
      openRate: asNumber(summary.openRate, summary.open_rate),
      // No hay CTR de periodo anterior en la API. El delta se calcula en el
      // dashboard comparando ventanas de publicaciones, no con este campo.
      clickRate: 0,
      monthlyRevenue: asNumber(range30.arrStart, range30.pledgedArrStart) / 12,
      totalViews: asNumber(range30.totalViewsStart),
    },
    previousByRange,
    trend: [...uniqueTrend.values()],
    campaigns,
    notesSummary: summarizeNotes(notes, existingSnapshot?.notesSummary?.statsThrottled),
    notes,
  };

  return { snapshot, context: { base, rawCampaigns, previousCampaigns, previousNotes, fullRefresh } };
}

// FASE DE DETALLE. Lo caro: detalle por publicación, feed completo de notas y
// la cola de `note_stats`. Se ejecuta después de haber persistido y pintado la
// fase rápida, e informa por `onProgress` para que la interfaz diga en qué va.
export async function enrichSnapshot(core, publication, { onProgress = () => {} } = {}) {
  const { snapshot, context } = core;
  const { base, rawCampaigns, previousCampaigns, previousNotes, fullRefresh } = context;

  // Detalle de publicaciones: los 12 más recientes más los que aún no lo tienen.
  const postsToRefresh = rawCampaigns.filter((row, index) => index < 12 || !previousCampaigns.get(campaignId(row, index))?.detailAvailable);
  onProgress({ step: "Detalle de publicaciones", done: 0, total: postsToRefresh.length });
  let detailsDone = 0;
  const postDetailResults = await mapWithConcurrency(postsToRefresh, 3, async (row, index) => {
    try {
      return await requestJson(`${base}/post_management/detail/${campaignId(row, index)}?offset=0&limit=1`);
    } finally {
      detailsDone += 1;
      if (detailsDone % 4 === 0 || detailsDone === postsToRefresh.length) {
        onProgress({ step: "Detalle de publicaciones", done: detailsDone, total: postsToRefresh.length });
      }
    }
  });
  const detailById = new Map(postsToRefresh.map((row, index) => [campaignId(row, index), postDetailResults[index]]));
  const campaigns = buildCampaigns(rawCampaigns, detailById, previousCampaigns);

  // Feed de notas: se para en cuanto una página entera ya es conocida, salvo en
  // el refresco completo semanal.
  onProgress({ step: "Historial de notas", done: 0, total: 0 });
  let feedItems = [];
  try {
    feedItems = await getAllProfileFeedItems(publication.userId, {
      knownIds: new Set(previousNotes.keys()),
      fullRefresh,
    });
  } catch {
    // El feed es una fuente más: si falla, se conservan las notas guardadas.
  }
  // Unión: las notas de esta pasada traen contadores públicos frescos; las que
  // no volvieron a aparecer (porque paramos antes) se conservan intactas.
  const merged = new Map(previousNotes);
  for (const note of buildNotes(feedItems, publication)) {
    merged.set(String(note.id), { ...merged.get(String(note.id)), ...note });
  }
  let notes = [...merged.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const notesToRefresh = notes.filter((note, index) => {
    if (index < 12) return true;
    const previous = previousNotes.get(String(note.id))?.stats;
    if (previous?.available) return false;
    return Math.max(0, Number(previous?.attempts) || 0) < NOTE_STATS_MAX_ATTEMPTS;
  });
  onProgress({ step: "Estadísticas de notas", done: 0, total: notesToRefresh.length });
  const { results: refreshedById, throttled } = await collectNoteStats(notesToRefresh, {
    onProgress: (done) => onProgress({ step: "Estadísticas de notas", done, total: notesToRefresh.length }),
  });
  notes = notes.map((note) => ({
    ...note,
    stats: resolveNoteStats(note, refreshedById.get(String(note.id)), previousNotes.get(String(note.id))?.stats, throttled),
  }));

  return {
    ...snapshot,
    metrics: { ...snapshot.metrics, clickRate: weightedRate(campaigns, "clicked") },
    campaigns,
    notesSummary: summarizeNotes(notes, throttled),
    notes,
  };
}

export async function getPublicationSnapshot(publication, existingSnapshot) {
  const core = await getCoreSnapshot(publication, existingSnapshot);
  return enrichSnapshot(core, publication);
}
