import test from "node:test";
import assert from "node:assert/strict";
import { collectNoteStats, noteStatsKey, getAllProfileFeedItems, getAllPublishedPosts, getProfile, getPublicationSnapshot, mapCampaign, mapNote, normalizeNoteStats, NOTE_STATS_MAX_ATTEMPTS, resolveNoteStats } from "../src/providers/substack-api.js";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test("getProfile uses browser credentials and returns administered publications", async () => {
  const originalFetch = globalThis.fetch;
  let requestOptions;
  globalThis.fetch = async (_url, options) => {
    requestOptions = options;
    return jsonResponse({
      id: 7,
      name: "Ada",
      publicationUsers: [{ role: "admin", is_primary: true, publication: { id: 4, name: "Carta", subdomain: "carta" } }],
    });
  };
  try {
    const result = await getProfile();
    assert.equal(requestOptions.credentials, "include");
    assert.equal(result.publications[0].subdomain, "carta");
    assert.equal(result.publications[0].userId, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getPublicationSnapshot maps summary, range, and campaign statistics", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(url);
    if (url.endsWith("/publish-dashboard/summary")) return jsonResponse({ subscribers: 1200, openRate: 46 });
    if (url.includes("summary-v2?range=30")) return jsonResponse({ totalSubscribersStart: 1100, totalSubscribersEnd: 1200, paidSubscribersStart: 50, paidSubscribersEnd: 60, arrStart: 6000, arrEnd: 7200 });
    if (url.includes("summary-v2?range=7")) return jsonResponse({ totalSubscribersStart: 1170, totalSubscribersEnd: 1200 });
    if (url.includes("summary-v2?range=90")) return jsonResponse({ totalSubscribersStart: 900, totalSubscribersEnd: 1200 });
    if (url.endsWith("/publication/stats/email_stats")) return jsonResponse([{ id: 1, title: "Edición 12", emails_delivered: 1000, emails_opened: 500, emails_clicked: 50 }]);
    if (url.includes("/reader/feed/profile/7")) return jsonResponse({ items: [
      { type: "comment", entity_key: "c-19", comment: { id: 19, user_id: 7, body: "Una nota propia", reaction_count: 8, children_count: 3, restacks: 2 } },
      { type: "comment", entity_key: "c-317130414", comment: { id: 317130414, user_id: 99, body: "Una nota restackeada", reaction_count: 31, children_count: 13, restacks: 5 } },
    ] });
    if (url.includes("/note_stats/c-19")) return jsonResponse({ lastUpdatedAt: "2026-08-18", cards: [
      { cardId: "note", type: "note" },
      { cardId: "impressions", type: "graphCard", headers: [{ title: "Impressions", value: 8904 }] },
      { cardId: "interactions", type: "listCard", headers: [{ title: "Interactions", value: 742 }], items: [{ title: "Like", value: 583 }, { title: "Profile visit", value: 53 }] },
      { cardId: "new_subscribers", type: "listCard", headers: [{ title: "New free subs", value: 13 }, { title: "New paid subs", value: 0 }] },
      { cardId: "audience", type: "barList", items: [{ title: "Subscribers", value: 400 }, { title: "Followers", value: 300 }, { title: "Unconnected", value: 8204 }] },
      { cardId: "surfaces", type: "barList", items: [{ title: "Feed", value: 8000 }, { title: "Profile page", value: 904 }] },
    ] });
    return jsonResponse({ posts: [] });
  };
  try {
    const snapshot = await getPublicationSnapshot({ name: "Carta", subdomain: "carta", userId: 7, userHandle: "ada", followerCount: 321 });
    assert.equal(snapshot.metrics.subscribers, 1200);
    assert.equal(snapshot.metrics.paidSubscribers, 60);
    assert.equal(snapshot.metrics.monthlyRevenue, 600);
    assert.equal(snapshot.campaigns[0].openRate, 50);
    assert.equal(snapshot.campaigns[0].clickRate, 5);
    assert.equal(snapshot.notesSummary.reactions, 8);
    assert.equal(snapshot.notesSummary.interactions, 13);
    assert.equal(snapshot.notesSummary.interactionsPerNote, 13);
    assert.equal(snapshot.notesSummary.restackRate, 100);
    assert.equal(snapshot.notes.length, 1);
    assert.equal(snapshot.notes[0].body, "Una nota propia");
    assert.equal(requestedUrls.some((url) => url.includes("note_stats/317130414")), false);
    assert.equal(snapshot.notes[0].url, "https://substack.com/@ada/note/c-19");
    assert.equal(snapshot.notes[0].stats.interactions.total, 742);
    assert.equal(snapshot.notes[0].stats.interactions.profileVisits, 53);
    assert.equal(snapshot.notes[0].stats.results.freeSubscribers, 13);
    assert.ok(snapshot.trend.length >= 3);
    assert.equal(snapshot.trend.at(-1).followers, 321);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAllProfileFeedItems follows cursors until the full history is loaded", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (url.includes("cursor=page-2")) return jsonResponse({ items: [{ entity_key: "c-2" }], nextCursor: null });
    return jsonResponse({ items: [{ entity_key: "c-1" }], nextCursor: "page-2" });
  };
  try {
    const items = await getAllProfileFeedItems(7);
    assert.deepEqual(items.map((item) => item.entity_key), ["c-1", "c-2"]);
    assert.equal(urls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAllPublishedPosts paginates the complete publication history", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (url.includes("offset=50")) return jsonResponse({ posts: [{ id: 51 }], total: 51 });
    return jsonResponse({ posts: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })), total: 51 });
  };
  try {
    const posts = await getAllPublishedPosts("https://carta.substack.com/api/v1");
    assert.equal(posts.length, 51);
    assert.equal(urls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mapCampaign preserves the full per-post analytics shape", () => {
  const campaign = mapCampaign({ id: 12, title: "Edición", stats: { delivered: 100, opened: 40, open_rate: 0.4, clicked: 5, click_through_rate: 0.125, views: 130, shares: 3, signups: 2, unsubscribes_within_1_day: 1 } }, 0);
  assert.equal(campaign.delivered, 100);
  assert.equal(campaign.openRate, 40);
  assert.equal(campaign.clickRate, 12.5);
  assert.equal(campaign.views, 130);
  assert.equal(campaign.signups, 2);
  assert.equal(campaign.unsubscribesWithin1Day, 1);
  assert.equal(campaign.detailAvailable, true);
});

test("mapNote reads the public Notes engagement shape", () => {
  const note = mapNote({
    entity_key: "c-44",
    comment: { body: "<p>Idea &amp; contexto</p>", date: "2026-08-18", reaction_count: 10, children_count: 4, restacks: 3, canonical_url: "https://substack.com/@ada/note/c-44" },
  });
  assert.equal(note.body, "Idea & contexto");
  assert.equal(note.reactions, 10);
  assert.equal(note.replies, 4);
  assert.equal(note.restacks, 3);
});

test("normalizeNoteStats mapea las tarjetas por cardId", () => {
  const stats = normalizeNoteStats({
    lastUpdatedAt: "2026-08-20T09:53:06.056Z",
    cards: [
      { cardId: "note", type: "note" },
      { cardId: "impressions", type: "graphCard", headers: [{ title: "Impressions", value: 22 }] },
      { cardId: "surfaces", type: "barList", items: [{ title: "Profile page", value: 10 }, { title: "Feed", value: 10 }, { title: "Other", value: 2 }] },
      { cardId: "audience", type: "barList", items: [{ title: "Subscribers", value: 12 }, { title: "Followers", value: 7 }, { title: "Unconnected", value: 3 }] },
      { cardId: "interactions", type: "listCard", headers: [{ title: "Interactions", value: 5 }], items: [{ title: "Like", value: 2 }, { title: "Restack", value: 1 }, { title: "Save", value: 1 }, { title: "Link click", value: 1 }] },
      { cardId: "new_subscribers", type: "listCard", headers: [{ title: "New free subs", value: 3 }, { title: "New paid subs", value: 1 }] },
    ],
  });
  assert.equal(stats.available, true);
  assert.equal(stats.reach.impressions, 22);
  assert.equal(stats.interactions.total, 5);
  assert.equal(stats.interactions.likes, 2);
  assert.equal(stats.interactions.saves, 1);
  assert.equal(stats.interactions.linkClicks, 1);
  assert.equal(stats.results.freeSubscribers, 3);
  assert.equal(stats.results.paidSubscribers, 1);
  assert.equal(stats.surfaces["Profile page"], 10);
  assert.equal(stats.audience.Subscribers, 12);
  // El item "Followers" del desglose de AUDIENCIA son impresiones vistas por
  // seguidores. Antes se colaba como `results.followers` = seguidores ganados.
  assert.equal(stats.audience.Followers, 7);
  assert.equal("followers" in stats.results, false, "note_stats no devuelve seguidores ganados");
  assert.equal("revenue" in stats.results, false, "note_stats no devuelve ingresos");
});

test("normalizeNoteStats no confunde una nota sin datos con detalle disponible", () => {
  assert.equal(normalizeNoteStats({ cards: [{ cardId: "note", type: "note" }] }).available, false);
  assert.equal(normalizeNoteStats({}).available, false);
});

test("noteStatsKey anade el prefijo c- que exige el endpoint", () => {
  assert.equal(noteStatsKey({ id: "318488307" }), "c-318488307");
  assert.equal(noteStatsKey({ entityKey: "c-318488307", id: "318488307" }), "c-318488307");
});

test("mapCampaign captures the editorial fields Substack returns", () => {
  const campaign = mapCampaign({ id: 12, title: "Edición 12", subtitle: "Idea & contexto", slug: "edicion-12", audience: "everyone", type: "newsletter", wordcount: 1240 }, 0);
  assert.equal(campaign.subtitle, "Idea & contexto");
  assert.equal(campaign.slug, "edicion-12");
  assert.equal(campaign.audience, "everyone");
  assert.equal(campaign.type, "newsletter");
  assert.equal(campaign.wordcount, 1240);
});

test("mapCampaign leaves editorial fields empty when Substack omits them", () => {
  const campaign = mapCampaign({ id: 13, title: "Sin extras" }, 0);
  assert.equal(campaign.subtitle, "");
  assert.equal(campaign.slug, "");
  assert.equal(campaign.wordcount, 0);
});

test("mapNote keeps paragraph breaks so the text can be analysed", () => {
  const note = mapNote({ entity_key: "c-31", comment: { id: 31, body: "<p>¿Escribes cada día?</p><p>Yo llevo un año.</p>", date: "2026-08-17T10:00:00Z" } }, 0);
  assert.equal(note.body, "¿Escribes cada día?\nYo llevo un año.");
});

const oldNote = { id: "44", date: "2024-01-05T10:00:00Z" };
const freshNote = { id: "45", date: new Date().toISOString() };
const cardsPayload = { cards: [{ cardId: "note", type: "note" }, { cardId: "interactions", type: "listCard", headers: [{ title: "Interactions", value: 12 }] }] };

test("collectNoteStats stops requesting after a rate limit survives the backoff", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    return jsonResponse({ error: "slow down" }, 429);
  };
  try {
    const notes = Array.from({ length: 30 }, (_, index) => ({ id: String(index) }));
    const { results, throttled } = await collectNoteStats(notes, { concurrency: 1, pauseMs: 0 });
    assert.equal(throttled, true);
    assert.equal(results.size, 0);
    // Un intento mas dos reintentos del backoff, y se corta la cola.
    assert.equal(requested.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collectNoteStats retries a 429 and keeps the note when Substack finally answers", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? jsonResponse({}, 429) : jsonResponse(cardsPayload);
  };
  try {
    const { results, throttled } = await collectNoteStats([{ id: "9" }], { concurrency: 1, pauseMs: 0 });
    assert.equal(throttled, false);
    assert.equal(results.get("9").status, "fulfilled");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveNoteStats marks a note pending only inside the first 24 hours", () => {
  const empty = { status: "fulfilled", value: {} };
  assert.equal(resolveNoteStats(freshNote, empty, undefined, false).fetchState, "pending");
  const first = resolveNoteStats(oldNote, empty, undefined, false);
  assert.equal(first.attempts, 1);
  assert.equal(first.fetchState, "pending");
});

test("resolveNoteStats gives up after NOTE_STATS_MAX_ATTEMPTS so the queue converges", () => {
  const empty = { status: "fulfilled", value: {} };
  const stats = resolveNoteStats(oldNote, empty, { attempts: NOTE_STATS_MAX_ATTEMPTS - 1 }, false);
  assert.equal(stats.attempts, NOTE_STATS_MAX_ATTEMPTS);
  assert.equal(stats.fetchState, "unavailable");
  assert.equal(stats.available, false);
});

test("resolveNoteStats reports throttled for notes the rate limit never reached", () => {
  const stats = resolveNoteStats(oldNote, undefined, { attempts: 1 }, true);
  assert.equal(stats.fetchState, "throttled");
  assert.equal(stats.attempts, 1, "un corte por limite no gasta intentos");
});

test("resolveNoteStats never downgrades stats a previous sync already captured", () => {
  const previous = { ...normalizeNoteStats(cardsPayload), attempts: 0, fetchState: "ready" };
  const failed = { status: "rejected", reason: new Error("500") };
  const stats = resolveNoteStats(oldNote, failed, previous, false);
  assert.equal(stats.available, true);
  assert.equal(stats.interactions.total, 12);
});

test("resolveNoteStats resets attempts once Substack answers with cards", () => {
  const stats = resolveNoteStats(oldNote, { status: "fulfilled", value: cardsPayload }, { attempts: 2 }, false);
  assert.equal(stats.fetchState, "ready");
  assert.equal(stats.attempts, 0);
  assert.equal(stats.available, true);
});

test("getPublicationSnapshot conserva los seguidores si el perfil no los trae", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes("summary-v2")) return jsonResponse({ totalSubscribersEnd: 97, totalSubscribersStart: 80 });
    if (url.endsWith("/publish-dashboard/summary")) return jsonResponse({ totalEmail: 97, openRate: 33, openRateDiff: -4 });
    if (url.includes("post_management/published")) return jsonResponse({ posts: [] });
    if (url.includes("reader/feed/profile")) return jsonResponse({ items: [] });
    return jsonResponse({});
  };
  try {
    // La publicacion guardada no trae followerCount (conexion antigua).
    const conServed = await getPublicationSnapshot(
      { name: "Carta", subdomain: "carta", userId: 7 },
      { metrics: { followers: 150 } },
    );
    assert.equal(conServed.metrics.followers, 150, "no se pisa con 0 lo que ya habia");

    const conFresco = await getPublicationSnapshot(
      { name: "Carta", subdomain: "carta", userId: 7, followerCount: 162 },
      { metrics: { followers: 150 } },
    );
    assert.equal(conFresco.metrics.followers, 162, "el valor fresco manda");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
