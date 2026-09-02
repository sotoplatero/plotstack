import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDom } from "./fixtures/dom.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
installDom(join(root, "dashboard", "index.html"));
const {
  captureFilename,
  copyPngToClipboard,
  createPrivateCaptureClone,
} = await import("../dashboard/capture.js");

test("el clon de captura oculta sensibles sin tocar el DOM vivo", () => {
  const original = document.querySelector("#overview");
  const sensitive = document.querySelector("[data-sensitive]");
  sensitive.hidden = false;
  const clone = createPrivateCaptureClone(original);
  assert.equal(clone.querySelector("[data-sensitive]").hidden, true);
  assert.equal(sensitive.hidden, false);
  assert.equal(document.documentElement.classList.contains("is-capturing"), false);
});

test("el clon oculta el propio objetivo cuando la card raíz es sensible", () => {
  const original = document.createElement("article");
  original.dataset.sensitive = "paid";
  original.hidden = false;

  const clone = createPrivateCaptureClone(original);

  assert.equal(clone.hidden, true);
  assert.equal(original.hidden, false);
});

test("copiar PNG escribe exactamente un ClipboardItem de imagen", async () => {
  const blob = new Blob(["png"], { type: "image/png" });
  const writes = [];
  class FakeClipboardItem { constructor(value) { this.value = value; } }
  await copyPngToClipboard(blob, {
    clipboard: { write: async (items) => writes.push(items) },
    ClipboardItemClass: FakeClipboardItem,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].value["image/png"], blob);
});

test("el nombre distingue página y card", () => {
  assert.equal(captureFilename("objeto", "resumen", "2026-08-23"), "plotstack-objeto-resumen-2026-08-23.png");
  assert.equal(captureFilename("objeto", "resumen", "2026-08-23", "Apertura media"), "plotstack-objeto-resumen-apertura-media-2026-08-23.png");
});
