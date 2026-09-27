// Capturas de la ficha de la Chrome Web Store, sin pasos a mano.
//
//   npm run preview        # en otra terminal: http://localhost:4173/dashboard/
//   npm run store-shots    # escribe dist/store/plotstack-*.png a 1280x800
//
// Abre Chrome en modo headless y lo maneja por el DevTools Protocol con el
// WebSocket nativo de Node: sin dependencias, como el resto de scripts. El
// viewport es 1280x800 exactos a 1x, que es lo que acepta la tienda, así que
// no hace falta escalar ni rellenar (para eso sigue `npm run screenshot`).
// Solo se captura la vista previa con la publicación ficticia «Carta de
// muestra»: nunca métricas de una cuenta real.
//
// No forma parte de la extensión: no está en EXTENSION_FILES.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const OUT = path.join(process.cwd(), "dist", "store");
const URL = process.env.PLOTSTACK_PREVIEW_URL || "http://localhost:4173/dashboard/";
const PORT = 9333;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

// Orden de subida. El Resumen va a 30 días porque la vista previa trae base de
// comparación para ese rango; el resto a 90, que es donde salen más hallazgos.
const SHOTS = [
  { file: "plotstack-resumen.png", view: "resumen", days: "30" },
  { file: "plotstack-hallazgos.png", view: "resumen", days: "90", scrollTo: "#insights-panel" },
  { file: "plotstack-crecimiento.png", view: "crecimiento", days: "90" },
  { file: "plotstack-notas.png", view: "notas", days: "90" },
  { file: "plotstack-postal.png", view: "postal", days: "90" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) throw new Error("No encuentro Chrome. Indica su ruta en CHROME_PATH.");
try {
  await fetch(URL);
} catch {
  throw new Error(`La vista previa no responde en ${URL}. Arráncala con \`npm run preview\`.`);
}

const profile = path.join(os.tmpdir(), `plotstack-store-${Date.now()}`);
const chrome = spawn(chromePath, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1280,800", "about:blank",
], { stdio: "ignore" });

try {
  let page;
  for (let attempt = 0; attempt < 50 && !page; attempt += 1) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = targets.find((target) => target.type === "page");
    } catch {}
  }
  if (!page) throw new Error("Chrome no abrió el puerto de depuración.");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL });
  await sleep(2500);

  await mkdir(OUT, { recursive: true });
  // Las capturas de otras versiones con nombres que ya no se usan no deben
  // colarse en la subida.
  const keep = new Set(SHOTS.map((shot) => shot.file));
  for (const file of await readdir(OUT)) {
    if (/^plotstack-.*\.png$/.test(file) && !keep.has(file)) await rm(path.join(OUT, file));
  }

  for (const shot of SHOTS) {
    await evaluate(`(async () => {
      document.documentElement.style.scrollBehavior = "auto";
      document.querySelector('[data-days="${shot.days}"]').click();
      document.querySelector('.nav-item[data-view="${shot.view}"]').click();
      await new Promise((resolve) => setTimeout(resolve, 700));
      const target = ${shot.scrollTo ? `document.querySelector("${shot.scrollTo}")` : "null"};
      window.scrollTo(0, target ? target.getBoundingClientRect().top + window.scrollY - 76 : 0);
      // Sin animaciones de entrada a medias en la imagen.
      document.querySelectorAll(".reveal").forEach((node) => { node.style.animation = "none"; });
      await new Promise((resolve) => setTimeout(resolve, 400));
      return true;
    })()`);
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(OUT, shot.file), Buffer.from(data, "base64"));
    console.log(`✓ dist/store/${shot.file}`);
  }
  socket.close();
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
