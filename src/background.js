import { normalizeSnapshot } from "./shared/analytics.js";
import { getProfile, getPublicationSnapshot, SubstackApiError } from "./providers/substack-api.js";
import { getExtendedAnalytics } from "./providers/substack-extended.js";

const DASHBOARD_URL = chrome.runtime.getURL("dashboard/index.html");
const SNAPSHOT_KEY = "plotstack.snapshot";
const CONNECTION_KEY = "plotstack.connection";
const ANALYTICS_KEY = "plotstack.analytics";

async function openDashboard() {
  const existing = await chrome.tabs.query({ url: `${DASHBOARD_URL}*` });
  if (existing[0]?.id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASHBOARD_URL });
  }
}

chrome.action.onClicked.addListener(openDashboard);
chrome.runtime.onInstalled.addListener(({ reason }) => reason === "install" && openDashboard());

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

async function syncPublication(publication) {
  const stored = await chrome.storage.local.get([SNAPSHOT_KEY]);
  const [snapshotResult, analytics] = await Promise.all([
    getPublicationSnapshot(publication, stored[SNAPSHOT_KEY]),
    getExtendedAnalytics(publication),
  ]);
  const snapshot = normalizeSnapshot(snapshotResult);
  const connection = { provider: "substack", publication, connectedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot, [CONNECTION_KEY]: connection, [ANALYTICS_KEY]: analytics });
  return { snapshot, connection, analytics };
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
  await chrome.storage.local.remove([SNAPSHOT_KEY, CONNECTION_KEY, ANALYTICS_KEY]);
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
    .then((result) => sendResponse({ ok: !result?.needsLogin, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "No se pudo completar la operación." }));
  return true;
});
