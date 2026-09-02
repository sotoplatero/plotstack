const XHTML_NS = "http://www.w3.org/1999/xhtml";

function pageStyles(document) {
  return [...document.styleSheets].map((sheet) => {
    try {
      return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    } catch {
      return "";
    }
  }).join("\n");
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

export async function captureElementPng(element, { theme = "ink" } = {}) {
  if (!element) throw new Error("No se encontró la vista para capturar.");
  await document.fonts?.ready;
  const width = Math.ceil(element.getBoundingClientRect().width);
  const height = Math.ceil(element.scrollHeight);
  if (!width || !height) throw new Error("La vista no tiene contenido visible.");

  const scale = Math.min(window.devicePixelRatio || 1, 2, 32767 / width, 32767 / height);
  if (scale < 0.35) throw new Error("Esta vista es demasiado larga para un solo PNG.");

  const clone = createPrivateCaptureClone(element);
  clone.style.width = `${width}px`;
  clone.style.margin = "0";
  const styles = pageStyles(document).replaceAll("</style", "<\\/style");
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">
        <html xmlns="${XHTML_NS}" lang="es" class="is-capturing" data-theme="${theme}">
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
