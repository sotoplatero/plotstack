const XHTML_NS = "http://www.w3.org/1999/xhtml";

// Una imagen SVG no carga recursos externos: sin incrustarla, la fuente propia
// no llegaba a la captura y el PNG salía con la del sistema. Cada url() de un
// @font-face se resuelve contra su hoja y se sustituye por una data URL.
const fontCache = new Map();

function inlineAsset(url) {
  if (!fontCache.has(url)) {
    fontCache.set(url, fetch(url)
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(response.statusText))))
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }))
      // Si la fuente no se puede leer, la captura sigue con la del sistema.
      .catch(() => url));
  }
  return fontCache.get(url);
}

async function ruleText(rule, base) {
  if (typeof CSSFontFaceRule === "undefined" || !(rule instanceof CSSFontFaceRule)) return rule.cssText;
  let text = rule.cssText;
  for (const [match, raw] of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (raw.startsWith("data:")) continue;
    text = text.replace(match, `url("${await inlineAsset(new URL(raw, base).href)}")`);
  }
  return text;
}

async function pageStyles(document) {
  const sheets = await Promise.all([...document.styleSheets].map(async (sheet) => {
    try {
      const base = sheet.href || document.baseURI;
      return (await Promise.all([...sheet.cssRules].map((rule) => ruleText(rule, base)))).join("\n");
    } catch {
      return "";
    }
  }));
  return sheets.join("\n");
}

// Lo mismo con las <img> del clon (logo y avatar de la postal). Una imagen que
// no se puede leer se quita: debajo queda la inicial, nunca un icono roto.
async function inlineImages(clone) {
  await Promise.all([...clone.querySelectorAll("img")].map(async (img) => {
    const src = img.getAttribute("src") || "";
    if (img.hidden || !/^https?:/.test(src)) {
      if (!src.startsWith("data:")) img.remove();
      return;
    }
    const inlined = await inlineAsset(src);
    if (inlined.startsWith("data:")) img.setAttribute("src", inlined);
    else img.remove();
  }));
}

function loadSvg(svg) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Un blob: con <foreignObject> marca el canvas como no exportable en
    // Chrome. Una data URL autocontenida conserva el origen limpio.
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Chrome no pudo dibujar la vista para la captura."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

const canvasBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob(
  (blob) => blob ? resolve(blob) : reject(new Error("No se pudo generar el archivo PNG.")),
  "image/png",
));

export function createPrivateCaptureClone(element) {
  if (!element) throw new Error("No se encontró el contenido para capturar.");
  const clone = element.cloneNode(true);
  if (clone.matches("[data-sensitive]")) clone.hidden = true;
  clone.querySelectorAll("[data-sensitive]").forEach((node) => { node.hidden = true; });
  clone.querySelectorAll("[aria-expanded]").forEach((node) => node.setAttribute("aria-expanded", "false"));
  clone.querySelectorAll(".capture-menu, .toast").forEach((node) => { node.hidden = true; });
  clone.classList.remove("is-capture-target");
  clone.setAttribute("xmlns", XHTML_NS);
  return clone;
}

export async function copyPngToClipboard(blob, {
  clipboard = globalThis.navigator?.clipboard,
  ClipboardItemClass = globalThis.ClipboardItem,
} = {}) {
  if (!clipboard?.write || !ClipboardItemClass) {
    throw new Error("El portapapeles de imágenes no está disponible en este navegador.");
  }
  await clipboard.write([new ClipboardItemClass({ "image/png": blob })]);
}

export async function downloadPng(blob, filename, {
  downloads = globalThis.chrome?.downloads,
  urlApi = URL,
  documentRoot = document,
} = {}) {
  const url = urlApi.createObjectURL(blob);
  try {
    if (downloads?.download) {
      await downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
    } else {
      const link = documentRoot.createElement("a");
      link.href = url;
      link.download = filename;
      documentRoot.body.append(link);
      link.click();
      link.remove();
    }
  } finally {
    setTimeout(() => urlApi.revokeObjectURL(url), 60000);
  }
}

const slug = (value) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const captureFilename = (publication, view, day, cardLabel = "") =>
  ["plotstack", publication || "dashboard", view, cardLabel, day]
    .filter(Boolean).map(slug).join("-") + ".png";

// `outputWidth` fija el ancho del PNG en píxeles: la postal sale siempre a
// 1080 px, se vea en la pantalla que se vea. Sin él, la escala es la del
// dispositivo, con tope en 2.
// `layoutWidth` compone el clon a ese ancho CSS antes de escalar: un formato
// cerrado sale idéntico desde un móvil o desde un escritorio.
export async function captureElementPng(element, { outputWidth, layoutWidth } = {}) {
  if (!element) throw new Error("No se encontró la vista para capturar.");
  await document.fonts?.ready;
  const box = element.getBoundingClientRect();
  const width = Math.ceil(layoutWidth || box.width);
  // Un formato cerrado (la postal, 4:5) se captura por su caja: `scrollHeight`
  // cuenta el desbordamiento recortado y añadía una franja al pie del PNG.
  const height = outputWidth
    ? Math.round((box.height / box.width) * width)
    : Math.ceil(element.scrollHeight);
  if (!width || !height) throw new Error("La vista no tiene contenido visible.");

  const preferred = outputWidth ? outputWidth / width : Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(preferred, 32767 / width, 32767 / height);
  if (scale < 0.35) throw new Error("Esta vista es demasiado larga para un solo PNG.");

  const clone = createPrivateCaptureClone(element);
  clone.style.width = `${width}px`;
  clone.style.margin = "0";
  await inlineImages(clone);
  const styles = (await pageStyles(document)).replaceAll("</style", "<\\/style");
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">
        <html xmlns="${XHTML_NS}" lang="es" class="is-capturing">
          <head><meta charset="UTF-8"/><style>${styles}</style></head>
          <body>${markup}</body>
        </html>
      </foreignObject>
    </svg>`;
  const image = await loadSvg(svg);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = getComputedStyle(document.body).backgroundColor;
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvasBlob(canvas);
}
