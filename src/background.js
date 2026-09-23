import { normalizeSnapshot, withLoyaltyHistory } from "./shared/analytics.js";
import { enrichSnapshot, getCoreSnapshot, getProfile, SubstackApiError } from "./providers/substack-api.js";
import { getExtendedAnalytics } from "./providers/substack-extended.js";

const DASHBOARD_URL = chrome.runtime.getURL("dashboard/index.html");
const SNAPSHOT_KEY = "plotstack.snapshot";
const CONNECTION_KEY = "plotstack.connection";
const ANALYTICS_KEY = "plotstack.analytics";
const PROGRESS_KEY = "plotstack.progress";
const DAILY_ALARM = "plotstack-daily";

// Una sola sincronización en vuelo. Dos pulsaciones seguidas del botón (o el
// botón mientras corre la alarma) compartían la ráfaga de peticiones y se
// pisaban al escribir el snapshot.
let syncInFlight = null;

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
  void recoverOrphanProgress();
  if (reason === "install") openDashboard();
});
chrome.runtime.onStartup?.addListener(() => {
  scheduleDailySync();
  void recoverOrphanProgress();
});
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

// `updatedAt` es el latido del progreso, y sin el la interfaz no puede
// distinguir "sigue trabajando" de "el service worker murio a mitad": un
// `phase: "detail"` guardado se quedaba para siempre y dejaba el boton de
// sincronizar deshabilitado incluso tras recargar el dashboard.
let lastProgress = null;
const writeProgress = (progress) => {
  lastProgress = { ...progress, updatedAt: new Date().toISOString() };
  return chrome.storage.local.set({ [PROGRESS_KEY]: lastProgress });
};

// Chrome termina el service worker a los 30 s sin eventos. La fase de detalle
// corre como promesa suelta, asi que sin este latido el propio navegador la
// mataba a mitad y nadie escribia nunca `done` ni `error`. Cada llamada a la
// API de extensiones reinicia ese contador; además refresca `updatedAt` para
// que el dashboard sepa que hay alguien vivo al otro lado.
const HEARTBEAT_MS = 20000;

// Plazo absoluto por fase. El latido prueba que el service worker esta vivo,
// NO que la fase avance: sin un tope, un `await` que no resuelve mantiene el
// latido puntual y "Sincronizando" para siempre. Con estos dos topes el sync
// termina por construccion, sin depender de que cada rama este acotada.
const deadlines = { coreMs: 120000, detailMs: 600000 };

// Los tests no pueden esperar diez minutos para comprobar que el plazo corta.
export function configureSyncDeadlines({ coreMs, detailMs } = {}) {
  if (Number.isFinite(coreMs) && coreMs > 0) deadlines.coreMs = coreMs;
  if (Number.isFinite(detailMs) && detailMs > 0) deadlines.detailMs = detailMs;
}

async function withDeadline(trabajo, ms, mensaje) {
  // El perdedor de la carrera sigue corriendo: hay que manejar su rechazo o
  // queda como unhandled rejection y tira el service worker.
  trabajo.catch(() => {});
  let temporizador;
  try {
    return await Promise.race([
      trabajo,
      new Promise((_, reject) => { temporizador = setTimeout(() => reject(new Error(mensaje)), ms); }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

function startHeartbeat() {
  const timer = setInterval(() => {
    void chrome.runtime.getPlatformInfo?.();
    if (lastProgress) void chrome.storage.local.set({ [PROGRESS_KEY]: { ...lastProgress, updatedAt: new Date().toISOString() } });
  }, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

// Un service worker recien arrancado no tiene ninguna sincronizacion en vuelo
// por definicion: si el progreso guardado dice lo contrario, es de una sesion
// que murio a medias y hay que declararlo interrumpido para que el usuario
// pueda volver a sincronizar.
const ACTIVE_PHASES = new Set(["core", "detail"]);

async function recoverOrphanProgress() {
  const stored = await chrome.storage.local.get([PROGRESS_KEY]);
  const progress = stored[PROGRESS_KEY];
  if (!ACTIVE_PHASES.has(progress?.phase) || syncInFlight) return;
  await writeProgress({
    ...progress,
    phase: "error",
    finishedAt: new Date().toISOString(),
    error: "La sincronización se interrumpió antes de terminar. Vuelve a sincronizar.",
  });
}

// Fase de detalle: lo caro. Corre DESPUÉS de haber persistido la fase rápida,
// así que un fallo aquí deja el snapshot recién guardado intacto.
async function runDetailPhase(publication, core, startedAt) {
  const stopHeartbeat = startHeartbeat();
  // El paso alcanzado se recuerda para que un plazo agotado diga DONDE se
  // quedó. Sin eso, "no terminó" no permite arreglar nada.
  let ultimoPaso = "";
  try {
    const trabajo = enrichSnapshot(core, publication, {
      onProgress: ({ step, done, total }) => {
        ultimoPaso = step;
        void writeProgress({ phase: "detail", step, detail: { done, total }, startedAt, finishedAt: "", error: "" });
      },
    });
    const enriched = await withDeadline(trabajo, deadlines.detailMs, "El detalle tardó demasiado y se detuvo.");
    await chrome.storage.local.set({ [SNAPSHOT_KEY]: normalizeSnapshot(enriched) });
    await writeProgress({ phase: "done", step: "", detail: { done: 0, total: 0 }, startedAt, finishedAt: new Date().toISOString(), error: "" });
  } catch (error) {
    const donde = ultimoPaso ? ` Se quedó en: ${ultimoPaso}.` : "";
    await writeProgress({
      phase: "error",
      step: ultimoPaso || "Detalle por publicación y por nota",
      detail: { done: 0, total: 0 },
      startedAt,
      finishedAt: new Date().toISOString(),
      error: `${error.message || "No se pudo completar el detalle."}${donde}`,
    });
  } finally {
    stopHeartbeat();
  }
}

async function syncPublication(publication) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const startedAt = new Date().toISOString();
    try {
      await writeProgress({ phase: "core", step: "Resumen, publicaciones y audiencia", detail: { done: 0, total: 0 }, startedAt, finishedAt: "", error: "" });
      const stored = await chrome.storage.local.get([SNAPSHOT_KEY, ANALYTICS_KEY]);
      // Fase rápida: escalares y listas. Devuelve un snapshot completo y válido
      // para pintar sin esperar a una sola petición de detalle.
      // La fase rápida lanza ~50 peticiones (13 fuentes ampliadas, varias por
      // ventana, más la paginación de suscriptores). Con un plazo por petición
      // pero ninguno para el conjunto, una racha de cortes suma minutos y el
      // usuario no distingue eso de un cuelgue.
      const [core, freshAnalytics] = await withDeadline(
        Promise.all([
          getCoreSnapshot(publication, stored[SNAPSHOT_KEY]),
          getExtendedAnalytics(publication),
        ]),
        deadlines.coreMs,
        "La fase rápida tardó demasiado y se detuvo.",
      );
      const snapshot = normalizeSnapshot(core.snapshot);
      // El núcleo fiel solo tiene evolución si PlotStack la guarda: Substack da
      // la foto de hoy. Una captura por día, heredada de la anterior.
      const analytics = withLoyaltyHistory(freshAnalytics, stored[ANALYTICS_KEY]);
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
