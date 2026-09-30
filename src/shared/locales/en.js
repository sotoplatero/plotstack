// Diccionario inglés, repartido por zona del código para que cada archivo
// tenga cerca sus cadenas. La clave es la cadena española exacta que recibe
// `t()` (o el texto del HTML estático, sin espacios de borde).
import html from "./en/html.js";
import app from "./en/app.js";
import insights from "./en/insights.js";
import analytics from "./en/analytics.js";
import runtime from "./en/runtime.js";

export default Object.freeze({ ...html, ...app, ...insights, ...analytics, ...runtime });
