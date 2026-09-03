# PlotStack

Extensión de Chrome para reunir en un dashboard las métricas, publicaciones y Notas de una cuenta de Substack autenticada en el navegador.

## Instalar en Chrome

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige esta carpeta (`PlotStack`).
4. Fija PlotStack en la barra de Chrome y abre la extensión.

## Conectar Substack

1. Pulsa **Conectar con Substack** en el onboarding.
2. Si no hay una sesión activa, PlotStack abre `substack.com/sign-in` en otra pestaña.
3. Inicia sesión, regresa a PlotStack y vuelve a pulsar el botón.
4. Si administras más de una publicación, elige cuál quieres analizar.

PlotStack valida la sesión mediante `GET /api/v1/user/profile/self` y consulta endpoints de estadísticas de solo lectura en el subdominio de la publicación. Las solicitudes usan `credentials: include`, por lo que Chrome adjunta la cookie de Substack desde su propio almacén.

El historial de Notas se consulta mediante `GET /api/v1/reader/feed/profile/{user_id}` siguiendo todos sus cursores. PlotStack consulta además `GET /api/v1/note_stats/{comment_id}` para cada nota propia; limita la concurrencia, conserva resultados anteriores y refresca primero las doce más recientes. Presenta por nota:

- Interacciones totales, likes, restacks, visitas al perfil, respuestas, guardados y compartidos.
- Impresiones, clics y clics en enlaces cuando Substack los devuelve.
- Nuevos suscriptores gratuitos y de pago cuando el endpoint los devuelve.
- Texto, fecha y enlace a la nota original.

Substack actualiza estas estadísticas aproximadamente cada hora y puede tardar hasta 24 horas en habilitarlas para una nota nueva.

El feed del perfil también contiene restacks de contenido ajeno. PlotStack los excluye comparando el `comment.user_id` de cada elemento con el usuario autenticado, en lugar de confiar en la URL del perfil.

La sincronización ampliada también reúne, cuando la cuenta y el plan de Substack los exponen, audiencia, fuentes y eventos de crecimiento, atribución de red, recomendaciones, histórico de email, inventario de contenido, resúmenes de monetización y estado de exportaciones. El panel **Cobertura** muestra qué fuentes respondieron: una ruta no disponible no se transforma en un cero ni interrumpe las demás.

De cada publicación se guardan además titular, subtítulo, slug, audiencia, tipo y
conteo de palabras cuando Substack los devuelve; si no vienen, la columna queda
en blanco en lugar de mostrar un cero inventado.

Para publicaciones, PlotStack pagina todo `post_management/published` y consulta `post_management/detail/{post_id}` con concurrencia limitada. Guarda las métricas agregadas equivalentes a los archivos `posts.csv`, `delivers.csv` y `opens.csv` del export completo: enviados, entregados, aperturas totales y únicas, clics, CTR, vistas, shares, altas, conversiones y bajas dentro del primer día, descargas, vídeo y valor estimado. El CSV generado por PlotStack incluye estas columnas ampliadas.

## El dashboard

PlotStack reúne en seis vistas lo que Substack reparte entre `publish/stats`,
`publish/growth/revenue`, el panel de posts y la pestaña de Notes:

- **Resumen** — suscriptores, apertura, CTR, curva de crecimiento e
  interacciones de publicaciones y Notas. Pago e ingreso mensual son tarjetas
  optativas, ocultas por defecto.
- **Audiencia** — suscriptores acumulados, altas por día y total actual de
  seguidores. No se grafica la evolución de seguidores hasta observar su fuente histórica real.
- **Crecimiento** — fuentes de adquisición con visitantes y altas;
  atribución de red, recomendaciones recibidas y eventos de crecimiento.
- **Notas** — KPIs de interacción, mapa de cadencia, volumen semanal y una
  tabla única con todas las notas del periodo.
- **Publicaciones** — tabla ordenable y buscable con las métricas por post, más
  cortes por día de envío y por longitud.
- **Cobertura** — qué fuentes respondieron, cuántos registros trajo cada una y
  cuándo fue la última sincronización.

## Privacidad

- Los valores de las cookies nunca se copian ni se guardan en `chrome.storage`.
- Solo se conservan el nombre de la publicación y métricas agregadas y normalizadas en `chrome.storage.local`.
- Suscriptores de pago e ingresos se activan por separado desde el botón de
  privacidad; una captura PNG siempre los vuelve a ocultar.
- El botón de cámara ofrece cuatro flujos de captura local:
  - **Página → Guardar PNG:** descarga la vista activa completa.
  - **Página → Copiar:** deja el PNG en el portapapeles para pegarlo en un mensaje o documento.
  - **Tarjeta → Guardar PNG:** activa el selector y descarga únicamente la card elegida.
  - **Tarjeta → Copiar:** activa el selector y copia únicamente la card elegida.
- La captura se genera desde una copia aislada de la interfaz: la página visible
  no se desplaza ni cambia de tamaño. Pago e ingresos se eliminan siempre de esa copia.
- Los emails, perfiles individuales de suscriptores y URLs firmadas de descarga se descartan antes de guardar.
- No hay backend, telemetría ni servidor intermedio.
- **Desconectar** elimina la conexión y las métricas guardadas por PlotStack; no cierra la sesión de Substack.

## Limitaciones actuales

Substack no documenta públicamente sus endpoints internos de estadísticas. PlotStack usa rutas de solo lectura que consume el propio dashboard web; pueden cambiar y requerir una actualización de la extensión. La primera versión admite publicaciones bajo `*.substack.com`; los dominios personalizados quedan fuera de alcance.

## Desarrollo

```powershell
npm test            # 116 pruebas con node --test
npm run validate    # manifest, archivos, iconos y permisos declarados
npm run icons       # regenera assets/icons/*.png desde assets/icon.svg
npm run package     # valida y escribe dist/plotstack-<versión>.zip
npm run screenshot -- <captura.png>   # capturas a 1280x800 para la ficha
```

No hay build ni dependencias de runtime. Después de editar, pulsa **Actualizar** en `chrome://extensions`.

`scripts/extension-files.mjs` es la lista canónica de lo que *es* la extensión:
la usan a la vez el validador y el empaquetador, así que un archivo nuevo hay
que añadirlo ahí o no viajará en el ZIP publicado.

Los iconos PNG se generan desde `assets/icon.svg`; no se editan a mano.

## Publicar en la Chrome Web Store

`docs/store/chrome-web-store.md` contiene la ficha completa: textos, la
justificación de cada permiso que pide el formulario de revisión, las casillas
de uso de datos que hay que marcar y las notas para el revisor.

La política de privacidad vive en `docs/privacy/index.html` y se publica con
GitHub Pages (*Settings → Pages → `main` / carpeta `/docs`*) en
`https://sotoplatero.github.io/plotstack/privacy/`, que es la URL que exige la
tienda.

`npm run package` genera el ZIP que se sube. Es un paquete de lista blanca: no
incluye tests, documentación ni los propios scripts.
