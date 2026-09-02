const STORAGE_KEYS = Object.freeze({
  paid: "plotstack.showPaid",
  revenue: "plotstack.showRevenue",
});

export const DEFAULT_SENSITIVE_PREFERENCES = Object.freeze({ paid: false, revenue: false });

export function readSensitivePreferences(storage) {
  return Object.fromEntries(Object.entries(STORAGE_KEYS).map(([kind, key]) => [kind, storage.getItem(key) === "true"]));
}

export function writeSensitivePreference(storage, kind, value) {
  const key = STORAGE_KEYS[kind];
  if (!key) throw new Error(`Preferencia sensible desconocida: ${kind}`);
  storage.setItem(key, String(Boolean(value)));
}

export const sensitiveVisibility = (kind, preferences, capture = false) =>
  !capture && Boolean(preferences?.[kind]);

export function applySensitiveVisibility(root, preferences, { capture = false } = {}) {
  root.querySelectorAll("[data-sensitive]").forEach((element) => {
    element.hidden = !sensitiveVisibility(element.dataset.sensitive, preferences, capture);
  });
}
