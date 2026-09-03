// Empaqueta el ZIP que se sube a la Chrome Web Store.
//
// La tienda rechaza (o marca en revisión) todo lo que no sea código de
// ejecución: tests, documentación, planes y los propios scripts de build no
// tienen por qué viajar. Por eso el paquete es una LISTA BLANCA explícita
// (scripts/extension-files.mjs), no un "todo menos node_modules": un archivo
// nuevo entra al ZIP solo si alguien lo añade a esa lista a conciencia.
//
// Sin dependencias: se escribe el ZIP a mano (deflate crudo vía `zlib` +
// CRC-32), que es exactamente lo que hace `store` + `deflate` del formato.
import { deflateRawSync } from "node:zlib";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { EXTENSION_FILES, EXTENSION_DIRECTORIES } from "./extension-files.mjs";

const root = process.cwd();

const FILES = EXTENSION_FILES;
const DIRECTORIES = EXTENSION_DIRECTORIES;

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await walk(relative));
    else found.push(relative);
  }
  return found;
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

// Fecha fija en el ZIP para que dos ejecuciones sobre el mismo código
// produzcan bytes idénticos: así se puede verificar qué se subió.
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01

function localHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);          // versión necesaria
  header.writeUInt16LE(0x0800, 6);      // nombres en UTF-8
  header.writeUInt16LE(8, 8);           // método deflate
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  return Buffer.concat([header, entry.name, entry.compressed]);
}

function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);          // versión de creación
  header.writeUInt16LE(20, 6);          // versión necesaria
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(0o644 << 16, 38); // permisos POSIX
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function endRecord(count, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

const members = [...FILES];
for (const directory of DIRECTORIES) members.push(...await walk(directory));
members.sort();

const missing = [];
for (const member of members) {
  try {
    await stat(path.join(root, member));
  } catch {
    missing.push(member);
  }
}
if (missing.length) {
  console.error(`✗ Faltan archivos declarados en el paquete:\n${missing.map((file) => `  - ${file}`).join("\n")}`);
  process.exit(1);
}

const entries = [];
const chunks = [];
let offset = 0;
for (const member of members) {
  const contents = await readFile(path.join(root, member));
  const compressed = deflateRawSync(contents, { level: 9 });
  const entry = {
    name: Buffer.from(member, "utf8"),
    size: contents.length,
    crc: crc32(contents),
    compressed,
    offset,
  };
  const local = localHeader(entry);
  chunks.push(local);
  offset += local.length;
  entries.push(entry);
}

const central = entries.map(centralHeader);
const centralSize = central.reduce((total, buffer) => total + buffer.length, 0);
const zip = Buffer.concat([...chunks, ...central, endRecord(entries.length, centralSize, offset)]);

await mkdir(path.join(root, "dist"), { recursive: true });
const output = path.join(root, "dist", `plotstack-${manifest.version}.zip`);
await writeFile(output, zip);

const kilobytes = (zip.length / 1024).toFixed(1);
console.log(`✓ ${path.relative(root, output)} — ${entries.length} archivos, ${kilobytes} kB`);
console.log(entries.map((entry) => `  ${entry.name}`).join("\n"));
