// Convierte una captura del dashboard en una captura válida para la ficha
// de la Chrome Web Store.
//
// La tienda solo acepta 1280x800 o 640x400 EXACTOS y rechaza la subida con
// cualquier otro tamaño; el botón de cámara de PlotStack, en cambio, produce
// el alto que tenga la vista. Este script escala la imagen para que quepa sin
// deformarla y la centra sobre el fondo de la marca.
//
//   node scripts/store-screenshot.mjs capturas/resumen.png
//   node scripts/store-screenshot.mjs capturas/*.png --size 640x400
//
// Escribe en dist/store/. Sin dependencias: se decodifica y se recodifica el
// PNG con `zlib`, igual que en generate-icons.mjs.
import { deflateSync, inflateSync } from "node:zlib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BACKGROUND = [0x14, 0x16, 0x12]; // --ink de la interfaz

// --- Decodificación PNG ----------------------------------------------------

function readChunks(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("No es un PNG.");
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  return chunks;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

// Deshace los cinco filtros por scanline del formato y devuelve RGBA plano.
function decodePng(buffer) {
  const chunks = readChunks(buffer);
  const header = chunks.find((chunk) => chunk.type === "IHDR").data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colorType = header[9];
  if (depth !== 8) throw new Error(`Profundidad ${depth} no soportada (solo 8 bits).`);
  if (![2, 6].includes(colorType)) throw new Error(`Tipo de color ${colorType} no soportado (solo RGB y RGBA).`);
  if (header[12] !== 0) throw new Error("PNG entrelazado no soportado.");

  const channels = colorType === 6 ? 4 : 3;
  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  const raw = inflateSync(idat);
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let row = 0; row < height; row += 1) {
    const start = row * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? line[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      if (filter === 1) line[index] = (line[index] + left) & 0xff;
      else if (filter === 2) line[index] = (line[index] + up) & 0xff;
      else if (filter === 3) line[index] = (line[index] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) line[index] = (line[index] + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Filtro PNG desconocido: ${filter}`);
    }
    for (let column = 0; column < width; column += 1) {
      const source = column * channels;
      const target = (row * width + column) * 4;
      pixels[target] = line[source];
      pixels[target + 1] = line[source + 1];
      pixels[target + 2] = line[source + 2];
      pixels[target + 3] = channels === 4 ? line[source + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

// --- Codificación PNG ------------------------------------------------------

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

// La tienda no admite transparencia en las capturas, así que se emite RGB.
function encodePng(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (stride + 1) + 1;
    for (let column = 0; column < width; column += 1) {
      const source = (row * width + column) * 4;
      raw[target + column * 3] = pixels[source];
      raw[target + column * 3 + 1] = pixels[source + 1];
      raw[target + column * 3 + 2] = pixels[source + 2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Escalado --------------------------------------------------------------

// Muestreo de área: al reducir una captura llena de texto pequeño, el vecino
// más próximo deja el texto ilegible y el bilineal simple lo emborrona. La
// media del área de origen es lo que hace un navegador al reescalar.
function resample(source, sourceWidth, sourceHeight, width, height) {
  const output = Buffer.alloc(width * height * 4);
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  for (let row = 0; row < height; row += 1) {
    const top = Math.floor(row * scaleY);
    const bottom = Math.max(top + 1, Math.min(sourceHeight, Math.ceil((row + 1) * scaleY)));
    for (let column = 0; column < width; column += 1) {
      const left = Math.floor(column * scaleX);
      const right = Math.max(left + 1, Math.min(sourceWidth, Math.ceil((column + 1) * scaleX)));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * sourceWidth + x) * 4;
          r += source[offset];
          g += source[offset + 1];
          b += source[offset + 2];
          count += 1;
        }
      }
      const target = (row * width + column) * 4;
      output[target] = Math.round(r / count);
      output[target + 1] = Math.round(g / count);
      output[target + 2] = Math.round(b / count);
      output[target + 3] = 255;
    }
  }
  return output;
}

function fitOnCanvas(image, width, height) {
  const canvas = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    canvas[index * 4] = BACKGROUND[0];
    canvas[index * 4 + 1] = BACKGROUND[1];
    canvas[index * 4 + 2] = BACKGROUND[2];
    canvas[index * 4 + 3] = 255;
  }
  // `min(…, 1)` evita ampliar una captura pequeña: escalar hacia arriba solo
  // añade desenfoque, y una imagen borrosa es peor ficha que una con márgenes.
  const scale = Math.min(width / image.width, height / image.height, 1);
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const scaled = resample(image.pixels, image.width, image.height, targetWidth, targetHeight);
  const offsetX = Math.floor((width - targetWidth) / 2);
  const offsetY = Math.floor((height - targetHeight) / 2);
  for (let row = 0; row < targetHeight; row += 1) {
    for (let column = 0; column < targetWidth; column += 1) {
      const source = (row * targetWidth + column) * 4;
      const target = ((row + offsetY) * width + column + offsetX) * 4;
      canvas[target] = scaled[source];
      canvas[target + 1] = scaled[source + 1];
      canvas[target + 2] = scaled[source + 2];
      canvas[target + 3] = 255;
    }
  }
  return { canvas, scale, targetWidth, targetHeight };
}

// --- CLI -------------------------------------------------------------------

const args = process.argv.slice(2);
const sizeIndex = args.indexOf("--size");
const sizeArg = sizeIndex >= 0 ? args[sizeIndex + 1] : "1280x800";
// Sin `--size`, sizeIndex es -1: hay que comprobarlo antes de excluir
// posiciones, o `sizeIndex + 1` descartaría el primer archivo.
const consumed = sizeIndex >= 0 ? [sizeIndex, sizeIndex + 1] : [];
const inputs = args.filter((value, index) => !consumed.includes(index) && !value.startsWith("--"));

if (!inputs.length) {
  console.error([
    "Uso: node scripts/store-screenshot.mjs <captura.png> [más.png…] [--size 1280x800|640x400]",
    "",
    "Genera en dist/store/ las capturas con el tamaño exacto que exige la",
    "Chrome Web Store, centradas sobre el fondo de la marca.",
  ].join("\n"));
  process.exit(1);
}

const ALLOWED = ["1280x800", "640x400"];
if (!ALLOWED.includes(sizeArg)) {
  console.error(`✗ La tienda solo acepta ${ALLOWED.join(" o ")}; pediste ${sizeArg}.`);
  process.exit(1);
}
const [width, height] = sizeArg.split("x").map(Number);

const outputDir = path.join(process.cwd(), "dist", "store");
await mkdir(outputDir, { recursive: true });

for (const input of inputs) {
  const image = decodePng(await readFile(input));
  const { canvas, scale, targetWidth, targetHeight } = fitOnCanvas(image, width, height);
  const name = `${path.basename(input, path.extname(input))}-${sizeArg}.png`;
  await writeFile(path.join(outputDir, name), encodePng(canvas, width, height));
  const note = scale === 1
    ? "sin escalar, centrada"
    : `escalada a ${targetWidth}x${targetHeight} (${(scale * 100).toFixed(0)} %)`;
  console.log(`✓ dist/store/${name} — origen ${image.width}x${image.height}, ${note}`);
}
