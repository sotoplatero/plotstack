import test from "node:test";
import assert from "node:assert/strict";

import {
  readSensitivePreferences,
  sensitiveVisibility,
  writeSensitivePreference,
} from "../dashboard/privacy.js";

const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test("las cifras de pago e ingresos se ocultan por defecto", () => {
  assert.deepEqual(readSensitivePreferences(memoryStorage()), { paid: false, revenue: false });
});

test("las preferencias sensibles se persisten por separado", () => {
  const storage = memoryStorage();
  writeSensitivePreference(storage, "paid", true);
  assert.deepEqual(readSensitivePreferences(storage), { paid: true, revenue: false });
});

test("una captura siempre oculta datos sensibles", () => {
  const preferences = { paid: true, revenue: true };
  assert.equal(sensitiveVisibility("paid", preferences), true);
  assert.equal(sensitiveVisibility("revenue", preferences), true);
  assert.equal(sensitiveVisibility("paid", preferences, true), false);
  assert.equal(sensitiveVisibility("revenue", preferences, true), false);
});

test("rechaza claves que no forman parte del contrato", () => {
  assert.throws(() => writeSensitivePreference(memoryStorage(), "subscribers", true), /desconocida/);
});
