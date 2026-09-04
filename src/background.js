import { normalizeSnapshot } from "./shared/analytics.js";
import { enrichSnapshot, getCoreSnapshot, getProfile, SubstackApiError } from "./providers/substack-api.js";
import { getExtendedAnalytics } from "./providers/substack-extended.js";

const DASHBOARD_URL = chrome.runtime.getURL("dashboard/index.html");
const SNAPSHOT_KEY = "plotstack.snapshot";
const CONNECTION_KEY = "plotstack.connection";
const ANALYTICS_KEY = "plotstack.analytics";
const PROGRESS_KEY = "plotstack.progress";
const DAILY_ALARM = "plotstack-daily";

async function openDashboard() {
  const existing = await chrome.tabs.query({ url: `${DASHBOARD_URL}*` });
  if (existing[0]?.id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASHBOARD_URL });
  }
}

// Refresco diario en segundo plano. Sin él, `trend` y el total de seguidores
// solo acumulan un punto los días que el usuario abre el dashboard, y ese
// histórico local es la única base de comparación del rango "Todo".
function scheduleDailySync() {
  chrome.alarms?.create(DAILY_ALARM, { periodInMinutes: 1440 });
}

chrome.action.onClicked.addListener(openDashboard);
chrome.runtime.onInstalled.addListener(({ reason }) => {
  scheduleDailySync();
  if (reason === "install") openDashboard();
});
chrome.runtime.onStartup?.addListener(scheduleDailySync);
chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm?.name !== DAILY_ALARM) return;
  const stored = await chrome.storage.local.get([CONNECTION_KEY]);
  if (!stored[CONNECTION_KEY]?.publication) return;
  // Un fallo del refresco automático no puede tirar el service worker: queda
  // registrado en `plotstack.progress` y el dashboard lo muestra al abrirse.
  try {
    await syncConnected();
  } catch {
    /* el estado ya quedó escrito en PROGRESS_KEY */
  }
});

async function hasSubstackCookie() {
  const cookies = await chrome.cookies.getAll({ domain: ".substack.com" });
  return cookies.some((cookie) => ["substack.sid", "connect.sid"].includes(cookie.name));
}

async function connect() {
  const cookieDetected = await hasSubstackCookie();
  try {
    const profile = await getProfile();
    return { cookieDetected, ...profile };
  } catch (error) {
    if (error instanceof SubstackApiError && error.status === 401) {
      return { needsLogin: true, cookieDetected, error: error.message };
    }
    throw error;
  }
}

const writeProgress = (progress) => chrome.storage.local.set({ [PROGRESS_KEY]: progress });

// Una sola sincronización en vuelo. Dos pulsaciones seguidas del botón (o el
// botón mientras corre la alarma) compartían la ráfaga de peticiones y se
// pisaban al escribir el snapshot.
let syncInFlight = null;

// Fase de detalle: lo caro. Corre DESPUÉS de haber persistido la fase rápida,
// así que un fallo aquí deja el snapshot recién guardado intacto.
async function runDetailPhase(publication, core, startedAt) {
  try {
    const enriched = await enrichSnapshot(core, publication, {
      onProgress: ({ step, done, total }) => {
        void writeProgress({ phase: "detail", step, detail: { done, total }, startedAt, finishedAt: "", error: "" });
      },
    });
    await chrome.storage.local.set({ [SNAPSHOT_KEY]: normalizeSnapshot(enriched) });
    await writeProgress({ phase: "done", step: "", detail: { done: 0, total: 0 }, startedAt, finishedAt: new Date().toISOString(), error: "" });
  } catch (error) {
    await writeProgress({
      phase: "error",
      step: "Detalle por publicación y por nota",
      detail: { done: 0, total: 0 },
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message || "No se pudo completar el detalle.",
    });
  }
}

async function syncPublication(publication) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const startedAt = new Date().toISOString();
    try {
      await writeProgress({ phase: "core", step: "Resumen, publicaciones y audiencia", detail: { done: 0, total: 0 }, startedAt, finishedAt: "", error: "" });
      const stored = await chrome.storage.local.get([SNAPSHOT_KEY]);
      // Fase rápida: escalares y listas. Devuelve un snapshot completo y válido
      // para pintar sin esperar a una sola petición de detalle.
      const [core, analytics] = await Promise.all([
        getCoreSnapshot(publication, stored[SNAPSHOT_KEY]),
        getExtendedAnalytics(publication),
      ]);
      const snapshot = normalizeSnapshot(core.snapshot);
      const connection = { provider: "substack", publication, connectedAt: new Date().toISOString() };
      await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot, [CONNECTION_KEY]: connection, [ANALYTICS_KEY]: analytics });
      // La fase de detalle sigue sin bloquear la respuesta: el dashboard pinta
      // ya y se actualiza por `chrome.storage.onChanged` cuando termine.
      const detailPhase = runDetailPhase(publication, core, startedAt);
      return { snapshot, connection, analytics, detailPending: true, detailPhase };
    } catch (error) {
      await writeProgress({
        phase: "error",
        step: "Resumen, publicaciones y audiencia",
        detail: { done: 0, total: 0 },
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error.message || "No se pudo sincronizar.",
      });
      throw error;
    }
  })();
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

async function syncConnected() {
  const stored = await chrome.storage.local.get([CONNECTION_KEY]);
  const publication = stored[CONNECTION_KEY]?.publication;
  if (!publication) throw new Error("Conecta una publicación primero.");
  // El perfil se refresca en CADA sync, no solo cuando falta `userId`. Ahí vive
  // `followerCount`, que es un número vivo: cachearlo desde el momento de la
  // conexión lo dejaba a 0 en cualquier conexión creada antes de mapearlo.
  let fresh = publication;
  try {
    const profile = await getProfile();
    fresh = profile.publications.find((candidate) => candidate.subdomain === publication.subdomain) || publication;
  } catch {
    // Un fallo aquí no invalida el sync: se sigue con lo que ya había.
  }
  return syncPublication({ ...publication, ...fresh });
}

async function disconnect() {
  await chrome.storage.local.remove([SNAPSHOT_KEY, CONNECTION_KEY, ANALYTICS_KEY, PROGRESS_KEY]);
  return { disconnected: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const actions = {
    PLOTSTACK_CONNECT: connect,
    PLOTSTACK_SELECT_PUBLICATION: () => syncPublication(message.publication),
    PLOTSTACK_SYNC: syncConnected,
    PLOTSTACK_DISCONNECT: disconnect,
    PLOTSTACK_OPEN_LOGIN: async () => {
      await chrome.tabs.create({ url: "https://substack.com/sign-in" });
      return { loginOpened: true };
    },
  };
  const action = actions[message?.type];
  if (!action) return false;

  action()
    // `detailPhase` es una promesa: no puede viajar por sendMessage.
    .then(({ detailPhase, ...result } = {}) => sendResponse({ ok: !result?.needsLogin, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "No se pudo completar la operación." }));
  return true;
});
