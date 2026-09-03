// Rasteriza assets/icon.svg a los PNG que exige la Chrome Web Store.
//
// No hay dependencias de runtime en el proyecto y no vamos a añadir una
// cadena de build solo para esto: el logotipo son cuatro primitivas
// (rectángulo redondeado, tres barras y una línea con extremos redondos),
// así que se dibujan a mano con supermuestreo 4x y se codifican con `zlib`.
// El SVG sigue siendo la fuente de verdad; si cambia, hay que actualizar
// SHAPES y volver a ejecutar `npm run icons`.
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VIEWBOX = 64;
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

const BACKGROUND = "#141612";
const BAR = "#d7ff3f";
const RULE = "#f0eee6";

// Coordenadas en el sistema del viewBox 0 0 64 64 de assets/icon.svg.
const SHAPES = [
  { kind: "roundedRect", x: 0, y: 0, width: 64, height: 64, radius: 15, fill: BACKGROUND },
  { kind: "rect", x: 15, y: 28, width: 8, height: 15, fill: BAR },
  { kind: "rect", x: 28, y: 19, width: 8, height: 24, fill: BAR },
  { kind: "rect", x: 41, y: 11, width: 8, height: 32, fill: BAR },
  // <path d="M12 48h40" stroke-width="3" stroke-linecap="round"/>
  { kind: "capsule", x1: 12, y1: 48, x2: 52, y2: 48, radius: 1.5, fill: RULE },
];

function parseHex(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

const inRect = (px, py, { x, y, width, height }) =>
  px >= x && px <= x + width && py >= y && py <= y + height;

function inRoundedRect(px, py, { x, y, width, height, radius }) {
  if (!inRect(px, py, { x, y, width, height })) return false;
  const dx = Math.max(x + radius - px, 0, px - (x + width - radius));
  const dy = Math.max(y + radius - py, 0, py - (y + height - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function inCapsule(px, py, { x1, y1, x2, y2, radius }) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - x1) * vx + (py - y1) * vy) / lengthSquared));
  const dx = px - (x1 + t * vx);
  const dy = py - (y1 + t * vy);
  return dx * dx + dy * dy <= radius * radius;
}

function hits(px, py, shape) {
  if (shape.kind === "roundedRect") return inRoundedRect(px, py, shape);
  if (shape.kind === "capsule") return inCapsule(px, py, shape);
  return inRect(px, py, shape);
}

// RGBA no premultiplicado, compuesto en orden de pintura. El supermuestreo
// promedia SUPERSAMPLE² muestras por píxel: sin él, el radio de 15 y los
// extremos redondos quedan dentados a 16 px.
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = VIEWBOX / (size * SUPERSAMPLE);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const colors = SHAPES.map((shape) => parseHex(shape.fill));

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step;
          const y = (py * SUPERSAMPLE + sy + 0.5) * step;
          let hit = -1;
          for (let index = 0; index < SHAPES.length; index += 1) {
            if (hits(x, y, SHAPES[index])) hit = index;
          }
          if (hit >= 0) {
            r += colors[hit][0];
            g += colors[hit][1];
            b += colors[hit][2];
            a += 255;
          }
        }
      }
      const offset = (py * size + px) * 4;
      // Los canales se promedian sobre las muestras cubiertas, no sobre el
      // total: promediar sobre el total oscurecería el borde hacia el negro.
      const covered = a / 255;
      pixels[offset] = covered ? Math.round(r / covered) : 0;
      pixels[offset + 1] = covered ? Math.round(g / covered) : 0;
      pixels[offset + 2] = covered ? Math.round(b / covered) : 0;
      pixels[offset + 3] = Math.round(a / samples);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // profundidad de bits
  header[9] = 6;   // color RGBA
  const stride = size * 4;
  // Filtro 0 (None) por scanline: el PNG ya comprime bien con deflate y así
  // el codificador se mantiene auditable de un vistazo.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outputDir = path.join(process.cwd(), "assets", "icons");
await mkdir(outputDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outputDir, `icon-${size}.png`);
  await writeFile(file, encodePng(render(size), size));
  console.log(`✓ assets/icons/icon-${size}.png`);
}
