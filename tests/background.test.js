import test from "node:test";
import assert from "node:assert/strict";

// `background.js` engancha listeners de chrome.* al importarse, así que el stub
// tiene que existir antes del import. Se captura el listener de mensajes para
// poder invocar los flujos reales sin service worker.
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

async function loadBackground({ storage = {}, profileFails = false, followerCount = 162 } = {}) {
  const store = { ...storage };
  const captured = {};
  const perfilPedido = { veces: 0 };

  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: { addListener: (fn) => { captured.onMessage = fn; } },
      onInstalled: { addListener: () => {} },
    },
    action: { onClicked: { addListener: () => {} } },
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, store[key]]));
        },
        async set(values) { Object.assign(store, values); },
        async remove(keys) { for (const key of [].concat(keys)) delete store[key]; },
      },
    },
    tabs: {
      query: async () => [],
      create: async () => {},
      update: async () => {},
    },
    windows: { update: async () => {} },
    cookies: { getAll: async () => [{ name: "substack.sid" }] },
  };

  globalThis.fetch = async (url) => {
    if (url.includes("/user/profile/self")) {
      perfilPedido.veces += 1;
      if (profileFails) return jsonResponse({}, 500);
      return jsonResponse({
        id: 7,
        handle: "ada",
        followerCount,
        publicationUsers: [{ role: "admin", is_primary: true, publication: { id: 4, name: "Carta", subdomain: "carta" } }],
      });
    }
    if (url.includes("summary-v2")) return jsonResponse({ totalSubscribersEnd: 97, totalSubscribersStart: 80 });
    if (url.endsWith("/publish-dashboard/summary")) return jsonResponse({ totalEmail: 97, openRate: 33, openRateDiff: -4 });
    if (url.includes("post_management/published")) return jsonResponse({ posts: [] });
    if (url.includes("reader/feed/profile")) return jsonResponse({ items: [] });
    if (url.includes("subscriber-stats")) return jsonResponse({ count: 0, subscribers: [] });
    return jsonResponse({});
  };

  // Import fresco en cada caso: el módulo guarda estado en sus listeners.
  await import(`../src/background.js?case=${Math.random()}`);

  const send = (message, sender = null) => new Promise((resolve) => {
    captured.onMessage(message, sender, resolve);
  });
  return { send, store, perfilPedido, captured };
}

const conexionAntigua = {
  "plotstack.connection": {
    provider: "substack",
    // Conexión creada antes de que `followerCount` se mapeara: no lo tiene.
    publication: { id: 4, name: "Carta", subdomain: "carta", userId: 7 },
  },
  "plotstack.snapshot": { metrics: { followers: 0, subscribers: 80 } },
};

test("PLOTSTACK_SYNC refresca el perfil aunque la conexión ya tenga userId", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  try {
    const { send, perfilPedido } = await loadBackground({ storage: conexionAntigua });
    const result = await send({ type: "PLOTSTACK_SYNC" });
    assert.equal(result.ok, true, result.error);
    // La regresión: antes solo se pedía el perfil si faltaba `userId`, así que
    // `followerCount` nunca llegaba y los seguidores se quedaban en 0.
    assert.equal(perfilPedido.veces, 1, "el perfil se pide en cada sync");
    assert.equal(result.snapshot.metrics.followers, 162);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("PLOTSTACK_SYNC conserva los seguidores si el perfil falla", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  try {
    const { send } = await loadBackground({
      storage: {
        ...conexionAntigua,
        "plotstack.snapshot": { metrics: { followers: 150, subscribers: 80 } },
      },
      profileFails: true,
    });
    const result = await send({ type: "PLOTSTACK_SYNC" });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.snapshot.metrics.followers, 150, "un perfil caído no pone los seguidores a cero");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("PLOTSTACK_SYNC exige una publicación conectada", async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  try {
    const { send } = await loadBackground({ storage: {} });
    const result = await send({ type: "PLOTSTACK_SYNC" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Conecta una publicación/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});
