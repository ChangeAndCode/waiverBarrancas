# Dashboard: backend y periodos (Etapa 1)

Rama: `feature/dashboard-metrics`, mismo HEAD inicial que `feature/user-access-management` (`287870e`). Frontend pendiente. No cambia el formulario, pagos ni QR.

## Contrato

`GET /api/admin/reports/metrics?granularity=month&anchor=2026-10-09`

Requiere JWT del Administrador vigente, activo y no eliminado, con `admin.panel`. Sin sesión: 401. Staff/Taquilla: 403. Entradas inválidas: 400.

- `granularity`: `day`, `week`, `month`, `year`; por defecto `month`.
- `anchor`: día YYYY-MM-DD dentro del periodo; por defecto hoy en Chihuahua.
- Filtros opcionales comunes: `status`, `attractionId`, `attraction=none`, `provenance`, `q`, `period`.
- `period` conserva su significado previo: relación con `visitDate` (`previous`, `active`, `upcoming`). No es la granularidad de generación.
- Métricas rechaza `from`, `to`, `until`: el rango se deriva de granularidad/ancla.

Respuesta:

- `timeZone`, `generatedAt`, `period` (`from`, `to`, `start`, `end`, granularidad/ancla).
- `historicalTotal`: todas las cartas disponibles, excluidas eliminadas, independiente de selección y filtros.
- `current.day/week/month/year`: rangos actuales y sus totales, independientes de selección y filtros.
- `total`: cartas del periodo seleccionado que coinciden con filtros.
- `series`: intervalos completos con `key`, `start`, `end`, `count`; incluye ceros reales para intervalos sin cartas.
- `states`, `attractions`, `provenance`: conteos y porcentajes calculados respecto a `total`; cero cuando no hay cartas.
- `filters`: filtros recibidos y fechas locales del periodo seleccionado para navegación.

Las categorías de estados son `pending` (incluye legacy `signed`), `approved`, `rejected`, `revoked`, más `other` para históricos desconocidos. `other` evita omitir cartas; el frontend puede ocultarlo cuando sea cero. No se interpreta el vencimiento de QR como un estado.

## Periodos y listado

Generación = `Waiver.createdAt`; una carta = un registro. Semana lunes–domingo, meses y años naturales, zona `America/Chihuahua`. Rangos `[start, end)`.

Día: horas; semana/mes: días; año: meses. Las horas se identifican por instante UTC para distinguir horas locales repetidas durante cambios históricos de horario. El frontend debe formatearlas en Chihuahua.

Listado y CSV comparten `waiverAdminReportFilter`. Fechas locales `from=YYYY-MM-DD&to=YYYY-MM-DD` incluyen ambos días completos de Chihuahua. Los timestamps explícitos conservan semántica de `from` incluido y `to` incluido; para límites exclusivos exactos (por ejemplo, hora de una gráfica), usar `from=<start ISO>&until=<end ISO>` sin `to`.

Atracción: unión deduplicada de `attractionIds`; fallback a `attractionId` cuando el arreglo falta/está vacío. Se omiten elementos null. No se incluyen actividades adicionales. Sin asociación: categoría null y filtro `attraction=none`. El nombre se consulta del catálogo; un ID ausente se muestra como “Atracción fuera del catálogo”, conservando el ID. La suma por atracción puede superar el total de cartas; porcentaje = cartas asociadas / cartas del periodo.

Procedencia: país y texto recortados; México solo se clasifica si hay una ciudad no vacía, una única coma y un sufijo exacto del catálogo de estados. País extranjero conocido y procedencia presente: “Extranjero”. Sin texto: “Sin procedencia”. Otros casos: “Procedencia no clasificable”. No se infieren estados ni se migra información. El catálogo backend refleja las opciones actuales del formulario; cambios futuros deben mantenerlos alineados.

Filtros `status=other` y `provenance=<categoría exacta>` permiten navegar a cada desglose. El listado mantiene su paginación y acciones; CSV conserva límite de 50 mil filas.

## Verificación

`npm test`: 25 pruebas pasan, sin omisiones en esta máquina. Incluye prueba de agregación y rutas contra MongoDB real temporal, más suites previas. Datos de prueba aislados, sin conexión a producción.

`dashboardMetrics.test.js` inicia mongod en un puerto local y directorio temporal, y los cierra/elimina al terminar. Busca `/opt/homebrew/bin/mongod` o `/usr/bin/mongod`; en otros entornos definir `TEST_MONGOD_BINARY`. Sin binario la prueba se omite explícitamente; CI debe instalarlo para verificar agregaciones. No agrega paquetes.

Cubre más de 300 cartas, estados legacy/desconocidos, eliminadas, múltiples atracciones repetidas, actividades adicionales excluidas, procedencia ambigua/ausente/extranjera, periodo vacío, tarjetas actuales independientes, coherencia de filtros con listado/CSV/hora, permisos, suspensión, fechas inválidas, semanas entre años, año bisiesto y día histórico de 25 horas.

## Límites antes del frontend

La consulta obtiene todo desde MongoDB mediante facet, sin traer cartas completas al cliente. El total histórico implica recorrer cartas disponibles; no se ha medido latencia con volumen de producción ni aplicado caché o índices nuevos. Validar rendimiento antes de definir ajustes para polling cada 30 segundos. Por seguridad, el endpoint no devuelve firmas ni datos personales individuales.

Los conteos y la consulta posterior del listado se ejecutan en momentos diferentes: nuevos registros entre ambas pueden modificar el total. No se implementa una instantánea compartida persistente.

Actualización automática/manual, gráficas, URLs, responsive y pruebas de interacción pertenecen a las siguientes etapas.


## Etapa 2: interfaz Svelte

`DashboardMetrics.svelte` se monta como pestaña inicial del panel Admin, únicamente con sesión lista y permiso `admin.panel`. Reutiliza `api()` de App para verificar sesión y gestionar 401/403; se reinicia al cambiar `sessionEpoch`. Descarta respuestas de consultas anteriores y de componentes desmontados.

Incluye tarjetas actuales, total histórico, selector día/semana/mes/año, fecha de referencia y navegación anterior/siguiente/actual. Todas las gráficas usan la selección de periodo y datos del endpoint. Tendencia SVG, dona de estados, barras por atracción y procedencia; estados vacíos/carga/error con reintento. No hay comparaciones de crecimiento ni identificación verificada.

Gráficas con descripciones, conteos/porcentajes textuales y tabla desplegable de la tendencia; controles con foco visible y selección anunciada. Diseño en cuatro/dos/una columnas y paneles apilados según ancho. En móvil la tendencia permite desplazamiento interno para conservar etiquetas legibles.

Verificación: `npm test` 25/25, build Vite/Svelte y `git diff --check`. Navegador Chrome con API real y MongoDB temporal vacío a 1440, 768 y 390 px: sin overflow de página, cuatro tarjetas, dos SVG, serie diaria de 24 horas, controles de navegación, validación de fecha y sin errores de JavaScript. No demuestra todavía la interacción visual con cartas de producción; los conteos poblados están cubiertos por las pruebas backend. Se conserva el aviso de bundle mayor a 500 kB.

Plan al cierre de Etapa 2 (completado abajo): navegación desde métricas/categorías/intervalos al listado con filtros y URL, conservación del periodo al regresar, actualización automática cada 30 segundos mientras esté visible, actualización manual, foco/visibilidad y cambio de fecha operativa. En Etapa 2 no se inicia polling ni se convierten métricas en enlaces.


## Etapa 3: navegación y actualización (completada)

- Tarjetas actuales, total histórico, estados (incluido `other`), atracciones (incluida categoría sin asociación), procedencia y puntos/filas de tendencia abren el listado administrativo existente. Se limpian filtros previos y se reinicia a página 1.
- Se usan `from` y `until` ISO exclusivos para reproducir exactamente cada intervalo, incluidas horas repetidas históricas. El listado muestra el intervalo exacto, permite limpiarlo y refleja atracción/procedencia/estado. Listado y CSV usan los mismos parámetros.
- Al abrir desde una métrica se compara el total recibido con el total mostrado. Si cambió, se limpia la tabla y se informa que es necesario volver/actualizar; no se muestra silenciosamente un listado con otro total. Cambiar explícitamente filtros libera esta comprobación. No se implementó una instantánea transaccional entre ambas peticiones: la comprobación detecta diferencias de conteo, no cambios de composición que conserven el mismo total.
- El periodo del dashboard se conserva en App y en la URL. Recarga y navegación atrás restauran pestaña, periodo, filtros y página. Las selecciones de periodo actual siguen la fecha de Chihuahua al actualizar; los periodos históricos explícitos permanecen fijos.
- `dashboardInteractions.js` centraliza la construcción de filtros y el controlador de actualización. Consulta al montar, manualmente, al recuperar visibilidad/foco y 30 segundos después de concluir la consulta anterior. No superpone solicitudes: los cambios de selección cancelan la anterior y esperan su finalización antes de consultar la última selección.
- Se detiene al ocultar la página, salir de la pestaña, cerrar sesión o perder permiso Admin. AbortController cancela consultas pendientes y App comprueba cancelación después de verificar sesión, antes de pedir métricas. Una operación que ya recibió el servidor puede terminar allí; su respuesta no se aplica tras cancelación.
- Los errores temporales conservan los datos y la hora de la última consulta correcta, identificando explícitamente el periodo mostrado. Actualizar/Reintentar permiten recuperación. No se oculta el último resultado durante actualizaciones.
- Botones con foco visible para categorías/tarjetas y enlaces SVG con nombre accesible/área de selección ampliada para puntos; la tabla ofrece acceso alternativo a los intervalos.

### Pruebas de Etapa 3

`npm test`: 29/29, ninguna omitida en esta máquina. Cuatro pruebas nuevas cubren filtros de navegación, serialización/cancelación/respuestas obsoletas, visibilidad/errores y medianoche Chihuahua. La integración MongoDB comprueba cada estado, atracción, procedencia, intervalo, tarjeta actual y total histórico contra los filtros reales del listado.

Prueba de navegador reutilizable: `server/test/dashboardBrowser.mjs`. No se incluye automáticamente en `npm test`: requiere Playwright y un navegador disponibles en el entorno, además de mongod. Configurar `PLAYWRIGHT_MODULE_PATH` al directorio que contiene `node_modules/playwright` si no es resoluble desde server; `TEST_BROWSER_EXECUTABLE` al ejecutable del navegador; `TEST_MONGOD_BINARY` al mongod. Ejecutar `node server/test/dashboardBrowser.mjs`. No agrega dependencias al proyecto.

El script usa API/rutas reales, MongoDB temporal aislado, fixtures exclusivos de pruebas y reloj del navegador acelerado. Verifica navegación desde todas las métricas, conservación histórica, recarga/atrás, paginación inicial, rechazo de conteos desactualizados, manual/error/reintento, incorporación de nuevos registros a los 30 segundos, pausa fuera del dashboard y con visibilidad oculta, recuperación, cambio Admin→Staff y cierre de sesión. Revisa 1440/768/390 px sin overflow de página ni errores JavaScript. La visibilidad oculta se simula con el evento DOM; no prueba físicamente minimizar ventanas en todos los navegadores. Directorio temporal y procesos se limpian al terminar. `DASHBOARD_SCREENSHOT_DIR` permite guardar capturas opcionales de estos fixtures.

Build Svelte/Vite y `git diff --check` pasan. Persiste el aviso de bundle >500 kB. Aún falta medir latencia/consumo con el volumen de producción y validar el flujo en el entorno de despliegue; no se conectó a producción. No quedan categorías sin enlace por falta de filtros.
