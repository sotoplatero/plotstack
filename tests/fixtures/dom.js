// DOM mínimo para ejecutar dashboard/app.js en node sin dependencias.
//
// No es un navegador: cubre exactamente la superficie que usa el dashboard
// (textContent, createElement, append, setAttribute, hidden, classList, dataset)
// y cinco selectores de colección. Lo que sí hace bien, y es su razón de ser:
// **los nodos con id se construyen leyendo `index.html` de verdad**, así que si
// un renderer pide un `#id` que no existe en el HTML, `$()` devuelve null y el
// test revienta. Los tres bugs de referencias colgantes que se colaron en esta
// base de código habrían muerto aquí.
import { readFileSync } from "node:fs";

const VOID_TAGS = new Set(["br", "hr", "img", "input", "link", "meta", "use", "path", "circle", "ellipse"]);

const parseAttrs = (raw) => {
  const attrs = {};
  for (const match of raw.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) attrs[match[1]] = match[2];
  for (const match of raw.matchAll(/(?:^|\s)(hidden|disabled)(?=\s|$|\/)/g)) attrs[match[1]] = "";
  return attrs;
};

class ClassList {
  constructor(node) { this.node = node; }
  get set() {
    return new Set(String(this.node.attributes.class || "").split(/\s+/).filter(Boolean));
  }
  write(set) { this.node.attributes.class = [...set].join(" "); }
  add(...names) { const s = this.set; names.forEach((n) => s.add(n)); this.write(s); }
  remove(...names) { const s = this.set; names.forEach((n) => s.delete(n)); this.write(s); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

class Node {
  constructor(tag = "div") {
    this.tagName = String(tag).toUpperCase();
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.handlers = new Map();
    this.style = {};
    this.ownText = "";
    this.classList = new ClassList(this);
    this.dataset = new Proxy({}, {
      get: (_t, key) => this.attributes[`data-${camelToDash(key)}`],
      set: (_t, key, value) => { this.attributes[`data-${camelToDash(key)}`] = String(value); return true; },
      has: (_t, key) => `data-${camelToDash(key)}` in this.attributes,
      ownKeys: () => Object.keys(this.attributes).filter((k) => k.startsWith("data-")).map((k) => dashToCamel(k.slice(5))),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
  }

  // --- contenido ---
  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value) { this.ownText = value === null || value === undefined ? "" : String(value); this.children = []; }

  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      if (typeof node === "string" || typeof node === "number") { this.ownText += String(node); continue; }
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.ownText = ""; this.append(...nodes); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  cloneNode(deep = false) {
    const copy = new Node(this.tagName.toLowerCase());
    copy.attributes = { ...this.attributes };
    copy.style = { ...this.style };
    copy.ownText = this.ownText;
    if (deep) copy.append(...this.children.map((child) => child.cloneNode(true)));
    return copy;
  }

  // --- atributos ---
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  get hidden() { return "hidden" in this.attributes; }
  set hidden(value) { if (value) this.attributes.hidden = ""; else delete this.attributes.hidden; }
  get disabled() { return "disabled" in this.attributes; }
  set disabled(value) { if (value) this.attributes.disabled = ""; else delete this.attributes.disabled; }
  get className() { return this.attributes.class || ""; }
  set className(value) { this.attributes.class = String(value); }
  get colSpan() { return Number(this.attributes.colspan || 0); }
  set colSpan(value) { this.attributes.colspan = String(value); }

  // --- eventos ---
  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }
  dispatchEvent(event) {
    const dispatched = makeEvent(event, this);
    documentDispatch?.(dispatched, true);
    if (!dispatched.propagationStopped) {
      for (let cursor = this; cursor && !dispatched.propagationStopped; cursor = cursor.parentNode) {
        dispatched.currentTarget = cursor;
        for (const handler of cursor.handlers.get(dispatched.type) || []) handler(dispatched);
      }
    }
    if (!dispatched.propagationStopped) documentDispatch?.(dispatched, false);
    return !dispatched.defaultPrevented;
  }
  click() { return this.dispatchEvent({ type: "click" }); }

  // --- consultas ---
  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelector(selector) { return this.descendants().find((node) => matches(node, selector)) || null; }
  querySelectorAll(selector) { return this.descendants().filter((node) => matches(node, selector)); }
  matches(selector) { return matches(this, selector); }
  closest(selector) {
    let cursor = this;
    while (cursor) {
      if (matches(cursor, selector)) return cursor;
      cursor = cursor.parentNode;
    }
    return null;
  }
}

let documentDispatch = null;

function makeEvent(source, target) {
  const event = { ...source, target: source.target || target, currentTarget: null };
  event.defaultPrevented = false;
  event.propagationStopped = false;
  event.preventDefault = () => { event.defaultPrevented = true; };
  event.stopPropagation = () => { event.propagationStopped = true; };
  return event;
}

const camelToDash = (key) => String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const dashToCamel = (key) => String(key).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());

// Compuesto simple: #id, .clase, tag, [attr] y sus combinaciones sin espacios.
function matchesCompound(node, selector) {
  for (const part of String(selector).trim().split(/(?=[.#[])/)) {
    if (!part) continue;
    if (part.startsWith("#")) { if (node.attributes.id !== part.slice(1)) return false; }
    else if (part.startsWith(".")) { if (!node.classList.contains(part.slice(1))) return false; }
    else if (part.startsWith("[")) {
      const inner = part.slice(1, part.indexOf("]"));
      const [name, value] = inner.split("=");
      if (!(name in node.attributes)) return false;
      if (value !== undefined && node.attributes[name] !== value.replace(/["']/g, "")) return false;
    } else if (node.tagName !== part.toUpperCase()) return false;
  }
  return true;
}

// Selector completo, con combinador de descendencia por espacios
// ("#campaigns-head th"). Sin esto, cualquier consulta con espacio devolvía
// vacío y los tests daban falsos verdes.
function matches(node, selector) {
  const partes = String(selector).trim().split(/\s+/);
  if (partes.length === 1) return matchesCompound(node, partes[0]);
  if (!matchesCompound(node, partes.at(-1))) return false;
  let cursor = node.parentNode;
  const restantes = partes.slice(0, -1).reverse();
  for (const parte of restantes) {
    while (cursor && !matchesCompound(cursor, parte)) cursor = cursor.parentNode;
    if (!cursor) return false;
    cursor = cursor.parentNode;
  }
  return true;
}

export function installDom(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const root = new Node("body");
  const byId = new Map();
  const all = [];

  // Escaneo de etiquetas: basta para reconstruir ids, clases y data-* reales.
  const stack = [root];
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, rawAttrs, selfClose] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = new Node(tag);
    node.attributes = parseAttrs(rawAttrs);
    stack.at(-1).append(node);
    all.push(node);
    if (node.attributes.id) byId.set(node.attributes.id, node);
    if (!selfClose && !VOID_TAGS.has(tag.toLowerCase())) stack.push(node);
  }

  const documentElement = new Node("html");
  const documentHandlers = { capture: new Map(), bubble: new Map() };
  const dispatchDocumentHandlers = (event, capture) => {
    const handlers = documentHandlers[capture ? "capture" : "bubble"].get(event.type) || [];
    event.currentTarget = document;
    for (const handler of handlers) {
      handler(event);
      if (event.propagationStopped) break;
    }
  };
  const document = {
    documentElement,
    body: root,
    createElement: (tag) => new Node(tag),
    createElementNS: (_ns, tag) => new Node(tag),
    // Recorre el árbol VIVO, no solo los nodos del HTML estático: si no, los
    // nodos que crean los renderers serían invisibles para las consultas y el
    // test daría un falso verde.
    querySelector: (selector) => {
      if (selector.startsWith("#") && !/[ .[]/.test(selector.slice(1))) return byId.get(selector.slice(1)) || null;
      return root.descendants().find((node) => matches(node, selector)) || null;
    },
    querySelectorAll: (selector) => root.descendants().filter((node) => matches(node, selector)),
    addEventListener: (type, handler, options = false) => {
      const phase = options === true || options?.capture ? "capture" : "bubble";
      if (!documentHandlers[phase].has(type)) documentHandlers[phase].set(type, []);
      documentHandlers[phase].get(type).push(handler);
    },
    dispatchEvent: (source) => {
      const event = makeEvent(source, source.target || document);
      dispatchDocumentHandlers(event, true);
      if (!event.propagationStopped) dispatchDocumentHandlers(event, false);
      return !event.defaultPrevented;
    },
  };
  documentDispatch = dispatchDocumentHandlers;

  const storage = new Map();
  globalThis.document = document;
  globalThis.window = { addEventListener: () => {}, scrollTo: () => {} };
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.confirm = () => true;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

  return { document, byId, all, localStorage: globalThis.localStorage };
}

// `initialize()` corre al importar app.js y es async: hay que esperarla.
export const settle = async (veces = 12) => {
  for (let i = 0; i < veces; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
