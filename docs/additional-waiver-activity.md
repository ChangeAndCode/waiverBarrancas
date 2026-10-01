# Actividades adicionales

La carta conserva sus datos firmados, folio, identidad y campos originales. Las solicitudes nuevas se guardan en `additionalActivities`, con identidad, estado, revisión, validación y horario independientes. Las escrituras usan filtros condicionales y `$push`/actualización posicional; no sobrescriben el documento firmado ni otras actividades.

## Recorrido

El visitante abre “Ya tengo una carta: agregar actividad”, solicita un código por correo, verifica el código y selecciona una de sus cartas elegibles. Elige una atracción activa que no esté ya en la carta. La solicitud nace pendiente. Staff consulta el mismo QR, revisa la carta y la adicional, asigna fecha/hora/grupo y valida o rechaza. La impresión de la adicional exige aprobación y validación propias, horario dentro de la vigencia y carta disponible. El cobro ocurre físicamente fuera del sistema.

## API

- `POST /api/public/recovery/request`: email; respuesta genérica, sin consultar si hay cartas.
- `POST /api/public/recovery/verify`: código; consumo único, entrega sesión temporal.
- `GET /api/public/recovery/waivers`: Bearer de recuperación; lista limitada de cartas elegibles del correo verificado.
- `POST /api/public/recovery/waivers/:id/activities`: atracción; exige la sesión de recuperación. Histórico sin QR almacenado requiere token/enlace original.
- `POST /api/reports/waivers/:id/activities/:activityId/review`: sesión Staff, QR de la carta, decisión y comentario; aprobación exige fecha/hora/grupo.
- `POST /api/reports/waivers/:id/activities/:activityId/ticket`: sesión Staff y QR; devuelve ticket de esa actividad.
- Las consultas pública y Staff del QR incluyen `originalAccessAuthorized` y `additionalActivities[].accessAuthorized`. Con adicionales, el booleano global `accessAuthorized` es falso; consumidores deben seleccionar la actividad y comprobar su autorización específica.
- El ticket original reutiliza el QR almacenado y rechaza visitas vencidas.

## QR y compatibilidad

Las nuevas cartas persisten el token y URL emitidos. Las solicitudes e impresiones reutilizan esos valores, sin volver a firmar el JWT. Para cartas históricas programadas, se exige el enlace original cuando no fue almacenado; se verifica la firma y correspondencia del token, después de verificar el correo. Una URL aportada debe coincidir con el origen público configurado (o el host actual), sin credenciales, query ni fragmento. No se puede demostrar ni reconstruir la URL histórica si se perdió o pertenecía a otro origen; no existe una migración inventada. El token sigue siendo compatible para consulta.

Los legacy sin `visitDate` conservan las 72 horas y consumo único, y no se ofrecen para adicionales. Las cartas programadas pendientes sin horario solo son elegibles hasta finalizar su día de visita. La adicional no cambia `createdAt`, `visitDate` ni `assignedAt` del original y no extiende su expiración. No aplica la anticipación de 24 horas a solicitudes adicionales. Sus horarios no pueden preceder el día de visita, estar en el pasado al validar ni alcanzar el vencimiento original.

La aprobación/rechazo global desde Admin no cambia estados de adicionales. Revocación, rechazo global o eliminación bloquean su autorización. Admin muestra adicionales separadas; los conteos, filtros de estado y CSV existentes siguen describiendo cartas originales.

## Recuperación y operación

Códigos aleatorios de 192 bits, guardados como SHA-256, duran 15 minutos y se consumen atómicamente. La colección `WaiverRecovery` tiene índice TTL, pero el endpoint también comprueba expiración: no depende de la frecuencia de limpieza de MongoDB. La sesión JWT de recuperación dura 15 minutos y tiene propósito propio, separado del QR; permanece solo en memoria del frontend.

La respuesta de solicitud y ruta de envío son iguales para correos con o sin cartas. Los datos médicos y firmas no se retornan al recuperador. La búsqueda es exacta, insensible a mayúsculas y espacios externos, y permite elegir entre varias cartas.

Límites por proceso de 5 solicitudes por correo y 150 operaciones por IP cada 15 minutos; mapa acotado a 10.000 entradas. Reiniciar el proceso reinicia estos límites. En despliegues con varias instancias se requiere un limitador compartido; detrás de proxy hay que verificar la dirección observada (`req.ip`) antes de configurar `trust proxy`. No se confía ciegamente en `X-Forwarded-For`.

Se requiere la configuración existente de Resend y un `PUBLIC_BASE_URL` correcto. Un fallo de correo no revela existencia de cartas ni devuelve códigos al cliente; registra un mensaje sin secretos. Sin envío funcional no se puede completar recuperación. No se agrega integración de pago, checkout, estado de pago ni rol de Taquilla.

## Verificación

`npm test`, `npm run build` y `git diff --check`. Las rutas se prueban con Express y validación Mongoose, persistencia en memoria y correo simulado. Las pruebas cubren selección entre cartas, verificación, replay y expiración de código, permisos, datos firmados intactos, duplicados, concurrencia simulada, aprobación/rechazo, horario, QR/ticket, revocación, vencimiento y legacy. No sustituyen pruebas contra MongoDB real, entrega de Resend o impresora física.
