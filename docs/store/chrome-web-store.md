# Ficha para la Chrome Web Store

Todo lo que hay que pegar en el Developer Dashboard, ya redactado. Los textos
están en el límite de caracteres que impone cada campo.

## Antes de subir

```powershell
npm test          # 160 pruebas
npm run icons     # regenera assets/icons/*.png desde assets/icon.svg
npm run package   # valida y escribe dist/plotstack-<versión>.zip
npm run screenshot -- capturas\resumen.png   # capturas a 1280x800 en dist/store/
```

`npm run package` no empaqueta si la validación falla. El ZIP es una lista
blanca (`scripts/extension-files.mjs`): no viajan tests, docs, planes ni los
propios scripts.

Requisitos de cuenta, una sola vez:

- Cuenta de desarrollador de Chrome Web Store (tarifa de alta de 5 USD).
- Correo de contacto **verificado** en la cuenta. Sin verificar, la ficha no se
  puede publicar.
- ✅ GitHub Pages ya activado (`main` / carpeta `/docs`). La política está en
  vivo en `https://sotoplatero.github.io/plotstack/privacy/`, que es la URL que
  pide el formulario. El repo tuvo que pasar a público: Pages no funciona en
  repos privados con plan gratuito.

## Producto

**Nombre** (45 máx.)

```
PlotStack — Newsletter Analytics
```

**Descripción breve** (132 máx.)

```
Tus métricas de newsletter, ordenadas en un solo dashboard local.
```

**Categoría:** Workflow & Planning
**Idioma:** Español

**Descripción detallada**

```
PlotStack reúne en un único dashboard las métricas que Substack reparte entre
la pantalla de estadísticas, la de crecimiento, el panel de publicaciones y la
pestaña de Notes.

Funciona sobre la sesión que ya tienes abierta en Chrome: no hay cuenta que
crear, ni claves de API que pegar, ni servidor intermedio. La extensión consulta
las estadísticas de tu propia publicación y las guarda en tu equipo.

SEIS VISTAS

• Resumen — suscriptores, vistas, tasa de apertura, CTR y crecimiento neto.
• Audiencia — suscriptores acumulados, altas por día, seguidores superpuestos
  para ver la divergencia, países, retención y qué publicaciones comparten
  lectores contigo.
• Crecimiento — visitas por día y por fuente con su conversión, qué parte de tu
  audiencia llega por la red de Substack, fuentes de adquisición, y altas y
  bajas comparando días con envío y sin él.
• Notas — impresiones, interacciones, visitas al perfil, clics y altas
  atribuidas; dónde se ven y quién las ve en gráficos de pastel; mapa de
  cadencia por día y hora, y el listado completo paginado.
• Publicaciones — tabla ordenable y buscable con las métricas por post, cortes
  por día de envío, longitud y sección, y cuáles se leen más allá del correo.
• Cobertura — qué fuentes de datos respondieron y cuándo fue la última
  sincronización.

RIGOR EN LAS CIFRAS

• Las tasas agregadas se ponderan por envíos, nunca se promedian tasas.
• Un corte con pocos envíos se marca como muestra escasa en vez de presentarse
  como un hallazgo.
• Un dato ausente se muestra como ausente, no como un cero.
• Un crecimiento sin base previa no se convierte en «+100 %».
• Si una fuente de Substack falla, se conserva el dato anterior y el panel de
  Cobertura lo dice; nunca se rellena con ceros.
• Lo estimado se llama estimado: el reparto de altas por superficie de una nota
  es una proporción, y la interfaz lo declara en vez de presentarlo como medido.

PRIVACIDAD

• No hay servidor de PlotStack. No hay telemetría ni analítica de uso.
• El valor de tus cookies nunca se lee ni se guarda: solo se comprueba que
  exista una sesión de Substack.
• Los correos y perfiles individuales de suscriptores se descartan antes de
  guardar nada. Solo se conservan métricas agregadas.
• Las cifras de suscriptores de pago e ingresos están ocultas por defecto y toda
  captura PNG las vuelve a ocultar, aunque las tengas visibles en pantalla.
• «Desconectar» borra las métricas guardadas. No cierra tu sesión de Substack.

EXPORTAR

Captura en PNG cualquier vista o tarjeta concreta —al portapapeles o a un
archivo— y descarga las tablas de publicaciones y notas en CSV. Todo se genera
en tu navegador.

LIMITACIONES

Esta versión admite publicaciones bajo *.substack.com; los dominios
personalizados quedan fuera. PlotStack usa los endpoints internos de solo
lectura del propio panel de Substack, que no están documentados públicamente y
pueden cambiar.

PlotStack es software de código abierto y no está afiliado a Substack Inc.
```

## Privacidad — pestaña «Practices»

**Propósito único** (single purpose)

```
Mostrar al autor de una newsletter de Substack las estadísticas de su propia
publicación, reunidas en un dashboard local dentro del navegador.
```

**URL de la política de privacidad**

```
https://sotoplatero.github.io/plotstack/privacy/
```

### Justificación de cada permiso

Se pega tal cual en el campo correspondiente. La revisión rechaza las
justificaciones genéricas: cada una nombra la función concreta.

| Permiso | Justificación |
| --- | --- |
| `cookies` | Comprobar si existe una cookie de sesión de Substack (`substack.sid` o `connect.sid`) para saber si el usuario ha iniciado sesión y mostrar el estado de conexión. La extensión solo consulta la **existencia** de la cookie; su valor nunca se lee, transmite ni almacena. |
| `storage` | Guardar en `chrome.storage.local` las métricas ya agregadas de la publicación, junto con el nombre y subdominio de la cuenta conectada, para que el dashboard se abra sin volver a descargarlas en cada uso. |
| `tabs` | Abrir el dashboard de la extensión en una pestaña al pulsar el icono, reutilizar la pestaña ya abierta si existe, y abrir la página de acceso de Substack cuando no hay sesión activa. |
| `downloads` | Guardar en el equipo del usuario los archivos PNG y CSV que él mismo genera desde el dashboard con el botón de captura y el de exportar. |
| `clipboardWrite` | Copiar al portapapeles la imagen PNG de la vista o tarjeta cuando el usuario elige la opción «Copiar» del menú de captura. |
| `alarms` | Programar una única comprobación diaria (`chrome.alarms` con periodo de 24 h) que actualiza en segundo plano las estadísticas de la publicación del propio usuario. Sin ella, el histórico local solo crece los días en que el usuario abre el dashboard, y series como la de seguidores quedan con huecos. No se envían notificaciones ni se ejecuta ninguna otra tarea. |
| **Host** `https://substack.com/*`, `https://*.substack.com/*` | Leer los endpoints de estadísticas de solo lectura de la publicación del propio usuario (perfil, resumen, estadísticas de email, publicaciones y notas). Es el único origen con el que la extensión se comunica y sin él no hay datos que mostrar. |

**Código remoto:** No. Todo el JavaScript va dentro del paquete; no se carga ni
se evalúa código externo.

### Declaración de uso de datos

Marcar **solo** esta casilla:

- ☑ *Website content* — las estadísticas de la publicación del propio usuario,
  que se procesan y se quedan en su equipo.

Y las tres certificaciones del final:

- ☑ No vendo ni transfiero datos de usuario a terceros fuera de los casos de uso aprobados.
- ☑ No uso ni transfiero datos de usuario con propósitos ajenos a la funcionalidad principal.
- ☑ No uso ni transfiero datos de usuario para determinar solvencia ni para préstamos.

> No marcar *Personally identifiable information*, *Authentication information*
> ni *Financial and payment information*: la extensión descarta correos y
> perfiles individuales antes de guardar, nunca lee el valor de las cookies y no
> maneja medios de pago. Las cifras de ingresos que muestra son agregados de la
> propia publicación del usuario, no datos de pago de terceros.

## Recursos gráficos

Lo que la tienda exige y lo que ya está resuelto:

| Recurso | Tamaño | Estado |
| --- | --- | --- |
| Icono de la tienda | 128×128 PNG | ✅ `assets/icons/icon-128.png` |
| Capturas de pantalla | 1280×800 PNG | ✅ 5 en `dist/store/`, regeneradas para 1.1.0 |
| Mosaico pequeño | 440×280 PNG | ⏳ opcional |
| Imagen destacada | 1400×560 PNG | ⏳ opcional |

Se suben cinco, en este orden: `plotstack-resumen`, `plotstack-publicaciones`,
`plotstack-notas`, `plotstack-crecimiento`, `plotstack-audiencia`. `dist/` está
en `.gitignore`, así que las capturas no viven en el repo: hay que regenerarlas
antes de cada subida en la que la interfaz haya cambiado, y en 1.1.0 cambió.

### Cómo se regeneran

```powershell
npm run preview     # http://localhost:4173/dashboard/
```

Con el servidor en marcha, se captura **con el viewport del navegador puesto a
1280×800 exactos**: así el PNG ya sale del tamaño que pide la tienda y no hay que
escalarlo ni rellenarlo. Se navega a `http://localhost:4173/dashboard/`, se
recorre cada vista de la barra lateral y se guarda una captura del viewport por
vista, con el scroll arriba.

`npm run screenshot -- <captura.png>` sigue estando para el otro caso: una
captura hecha a mano, o desde la cuenta real con el botón de cámara, que llega
con un tamaño cualquiera y hay que encajar en 1280×800 sobre el fondo de marca.
Nunca amplía una captura pequeña, así que si sale con márgenes anchos hay que
volver a capturar más grande en vez de forzar el escalado.

`preview-dashboard.mjs` sirve el dashboard real —el mismo `index.html`, el mismo
`app.js`— con la publicación ficticia **«Carta de muestra»**, y pasa los datos
por el `normalizeSnapshot` de producción para que el esquema no se adivine.

Se capturan con datos ficticios a propósito. Con datos reales, la ficha —que es
pública— expondría las métricas de negocio del autor, y además las capturas
quedarían atadas a lo que esa cuenta tuviera el día de la captura. La interfaz
que se ve es exactamente la que instala el usuario.

Si prefieres capturar tu cuenta real, el botón de cámara del dashboard
(*Página → Guardar PNG*) ya oculta pago e ingresos; pasa el PNG por
`npm run screenshot` para darle el tamaño exacto. El script nunca amplía una
captura pequeña: si sale con márgenes anchos, vuelve a capturar con la ventana
más grande en vez de forzar el escalado.

## Qué esperar de la revisión

- Los permisos `cookies` y de host amplios sitúan la extensión en revisión
  manual: cuenta con días, no horas, en la primera publicación.
- **1.1.0 añade el permiso `alarms`.** Una actualización que pide un permiso
  nuevo vuelve a pasar por revisión, así que hay que rellenar su justificación
  en el formulario (está en la tabla de arriba) antes de enviar. `alarms` no
  genera aviso de permisos al usuario, de modo que la actualización se instala
  sin pedirle que la acepte de nuevo.
- El revisor necesita poder ver la extensión funcionando. En *Notes for
  reviewer* conviene explicar que hace falta una sesión de Substack con una
  publicación propia, y ofrecer credenciales de prueba si es posible.

**Notas para el revisor** (borrador):

```
PlotStack requiere una sesión iniciada de Substack (substack.com) con una
publicación propia bajo *.substack.com. Al pulsar el icono se abre el dashboard;
el botón "Conectar con Substack" valida la sesión contra
GET /api/v1/user/profile/self y, si no hay sesión, abre substack.com/sign-in.

La extensión es de solo lectura: no publica, no modifica ni borra nada en
Substack. No tiene backend propio; el único origen con el que se comunica es
substack.com. El valor de las cookies nunca se lee: solo se comprueba con
chrome.cookies que exista substack.sid o connect.sid.

Código fuente completo: https://github.com/sotoplatero/plotstack
```

## Novedades de esta versión

La tienda no tiene un campo de «What's new» propio: el cambio se cuenta en la
descripción detallada y, si se quiere, en el primer párrafo. Texto listo para
usar en el anuncio o en el repositorio:

```
1.1.0

• El dashboard aparece sin esperar: la sincronización responde en cuanto tiene
  las cifras y sigue trayendo el detalle por publicación y por nota en segundo
  plano, informando de en qué va.
• Refresco diario automático, para que el histórico crezca aunque no abras el
  dashboard.
• Vista de tráfico: visitas por día y por fuente, con su conversión a alta.
• Efecto de red: qué parte de tu audiencia llega por la red de Substack.
• Notas: gráficos de pastel para saber dónde se ven y quién las ve, altas
  atribuidas en la cabecera y listado paginado.
• Publicaciones: cortes por sección y cuáles se leen más allá del correo.
• Audiencia: seguidores y suscriptores en el mismo gráfico, retención por
  cohorte y publicaciones que comparten lectores contigo.
• El selector de rango ya aplica a las fuentes de adquisición, que antes eran
  siempre de doce meses.
• Correcciones: el delta de suscriptores compara contra la ventana elegida y no
  contra treinta días fijos; las altas de pago ya no se perdían cuando las
  gratuitas eran cero; y una tasa por publicación del 0,8 % ya no se mostraba
  como 80 %.
```

## Después de publicar

- La versión no puede bajar nunca. La siguiente subida debe incrementar
  `manifest.json` **y** `package.json` a la vez (`npm run validate` falla si
  divergen).
- Si cambia qué datos maneja la extensión, actualizar
  `docs/privacy/index.html` **antes** de subir esa versión.
