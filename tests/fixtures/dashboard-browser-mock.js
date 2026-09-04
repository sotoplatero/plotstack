globalThis.chrome = {
  runtime: {
    sendMessage: async () => ({ ok: true }),
  },
  downloads: {
    download: async (options) => { globalThis.__plotstackDownload = options; return 1; },
  },
  storage: {
    // El dashboard escucha los cambios de storage para pintar el progreso de la
    // sincronizacion y el snapshot que escribe la fase de detalle. El listener
    // se captura aqui para poder dispararlo desde los tests.
    onChanged: {
      addListener: (fn) => { globalThis.__plotstackStorageListener = fn; },
    },
    local: {
      get: async () => ({
        "plotstack.connection": { publication: { name: "Carta de muestra", subdomain: "muestra" } },
        "plotstack.snapshot": {
          publication: "Carta de muestra",
          capturedAt: "2026-08-21T14:30:00Z",
          metrics: { subscribers: 2840, paidSubscribers: 184, openRate: 47.3, clickRate: 6.8, monthlyRevenue: 1425, followers: 3900, appSubscribers: 720, totalViews: 41200, viewsDelta: -3100 },
          previousByRange: { 7: { subscribers: 2801, paidSubscribers: 180 }, 30: { subscribers: 2710, paidSubscribers: 173 }, 90: { subscribers: 2410, paidSubscribers: 150 } },
          notesSummary: { total: 3, reactions: 221, replies: 53, restacks: 36, interactions: 310, detailAvailable: 2, detailPending: 0, detailUnavailable: 1, statsThrottled: false },
          previous: { subscribers: 2710, paidSubscribers: 173, openRate: 45.9, clickRate: 6.1, monthlyRevenue: 1330 },
          trend: [
            { date: "2026-07-23", subscribers: 2710, paidSubscribers: 173, followers: 3660 },
            { date: "2026-08-01", subscribers: 2764, paidSubscribers: 177, followers: 3740 },
            { date: "2026-08-10", subscribers: 2801, paidSubscribers: 180, followers: 3825 },
            { date: "2026-08-21", subscribers: 2840, paidSubscribers: 184, followers: 3900 },
          ],
          campaigns: [
            { id: "1", title: "La semana que cambió el producto", date: "2026-08-20", delivered: 2800, opened: 1390, clicked: 182, openRate: 49.6, clickRate: 6.5, views: 2100, reactions: 91, comments: 18, shares: 27, signupsWithin1Day: 36 },
            { id: "2", title: "Notas desde el borde", date: "2026-08-12", delivered: 2760, opened: 1264, clicked: 201, openRate: 45.8, clickRate: 7.3, views: 1890, reactions: 78, comments: 12, shares: 19, signupsWithin1Day: 24 },
          ],
          notes: [
            { id: "n1", body: "Una buena métrica elimina una duda, no añade otra pantalla.", date: "2026-08-20T15:00:00Z", url: "https://substack.com/@muestra/note/c-n1", reactions: 94, replies: 18, restacks: 12, stats: { available: true, interactions: { total: 142, likes: 94, replies: 18, restacks: 12, profileVisits: 8, saves: 4, shares: 3, linkClicks: 3 }, results: { freeSubscribers: 7, paidSubscribers: 1 }, reach: { impressions: 6800 }, surfaces: { Feed: 4200, Notifications: 900, "Profile page": 700, Permalinks: 500, Notes: 300, Search: 120, Other: 80 }, audience: { Subscribers: 2100, Followers: 3300, Unconnected: 1400 } } },
            { id: "n2", body: "¿Qué mirarías primero para entender si una publicación funcionó?", date: "2026-08-14T18:00:00Z", url: "https://substack.com/@muestra/note/c-n2", reactions: 71, replies: 26, restacks: 8, stats: { available: true, interactions: { total: 117, likes: 71, replies: 26, restacks: 8, profileVisits: 5, saves: 2, shares: 2, linkClicks: 3 }, results: { freeSubscribers: 4, paidSubscribers: 0 }, reach: { impressions: 4900 }, surfaces: { Feed: 3000, Notifications: 700, "Profile page": 500, Permalinks: 400, Notes: 200, Search: 60, Other: 40 }, audience: { Subscribers: 1500, Followers: 2400, Unconnected: 1000 } } },
            { id: "n3", body: "Tres aprendizajes después de publicar cada semana durante un año.", date: "2026-08-06T13:00:00Z", url: "https://substack.com/@muestra/note/c-n3", reactions: 56, replies: 9, restacks: 16, stats: { available: false, fetchState: "unavailable", interactions: {}, results: {}, reach: {} } },
          ],
        },
        "plotstack.analytics": {
          period: { from: "2025-08-21", to: "2026-08-21" },
          audience: {
            total: 2840,
            emailable: 2710,
            followers: { total: 3900, history: [
              { date: "2026-07-23", value: 3660 },
              { date: "2026-08-10", value: 3825 },
              { date: "2026-08-21", value: 3900 },
            ] },
            location: { rows: [{ code: "ES", value: 43 }, { code: "MX", value: 16 }, { code: "CO", value: 8 }], totals: { global: { locations: 19 } } },
            timeline: {
              total: 2840,
              counted: 2840,
              daily: [
                { date: "2026-08-18", signups: 11, paidSignups: 1, cumulative: 2807 },
                { date: "2026-08-19", signups: 8, paidSignups: 0, cumulative: 2815 },
                { date: "2026-08-20", signups: 16, paidSignups: 2, cumulative: 2831 },
                { date: "2026-08-21", signups: 9, paidSignups: 1, cumulative: 2840 },
              ],
              composition: { paid: 184, founding: 12, gift: 4, comp: 3, freeTrial: 8 },
              engagement: { alta: 1240, baja: 980, inactiva: 620 },
              byInterval: [{ interval: "free", count: 2656 }, { interval: "month", count: 142 }, { interval: "year", count: 42 }],
            },
          },
          growth: {
            sources: { totals: { visitors: 9200, subscribers: 130, revenue: 0 }, sources: [] },
            events: [],
            subscribers: { free: { daily: [
              { date: "2026-08-19", new: 8, losses: 1, net: 7 },
              { date: "2026-08-20", new: 16, losses: 2, net: 14 },
              { date: "2026-08-21", new: 9, losses: 0, net: 9 },
            ], totals: { new: 33, losses: 3, net: 30 } }, paid: { daily: [], totals: { new: 0, losses: 0, net: 0 } } },
          },
          retention: { free: { cohorts: [{ cohort: '2026-05', points: [{ month: 0, rate: 1 }, { month: 1, rate: 0.86 }, { month: 3, rate: 0.74 }] }, { cohort: '2026-06', points: [{ month: 0, rate: 1 }, { month: 1, rate: 0.79 }] }], rates: [{ month: 1, rate: 0.82, comparison: 0.04 }, { month: 3, rate: 0.71, comparison: 0.02 }] }, paid: { cohorts: [], rates: [] } },
          content: { counts: {} },
          coverage: [],
        },
      }),
    },
  },
};
