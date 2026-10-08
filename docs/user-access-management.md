# Gestión de usuarios y accesos del personal

Implementada sobre `feature/user-access-management`, base `2895cbb`.

## Endpoints

Todos los endpoints de usuarios requieren JWT vigente y perfil **Administrador actual en MongoDB**.

| Método | Endpoint | Comportamiento |
| --- | --- | --- |
| GET | `/api/admin/users` | Lista cuentas activas, suspendidas y eliminadas; estas últimas son visibles sin acciones. No devuelve hash ni authVersion. |
| POST | `/api/admin/users` | Crea nombre, email, contraseña y rol. Cuenta inicialmente activa. |
| PATCH | `/api/admin/users/:id` | Edita nombre/email/rol/contraseña y `active`; acepta actualizaciones parciales. |
| DELETE | `/api/admin/users/:id` | Retira acceso mediante `deletedAt`, desactiva e incrementa authVersion. Conserva documento e identidad histórica. |
| POST | `/api/auth/login` | Login de personal activo, no eliminado. |
| GET | `/api/auth/me` | Identidad y rol vigentes del usuario autenticado. |
| GET | `/api/reports/validate/:token` | Reutilizado para consultar QR; Taquilla solo lee, también para QR legacy. |

Ejemplo de creación: `{ "name": "Personal", "email": "personal@example.test", "password": "Access123", "role": "taquilla" }`.
Suspender: PATCH `{ "active": false }`. Reactivar: PATCH `{ "active": true }`.
Contraseña omitida en PATCH conserva la anterior; una contraseña enviada vacía es inválida. La interfaz omite el campo si se deja vacío al editar.

## Validaciones

- Payload objeto con campos permitidos; no acepta campos internos ni actualización vacía.
- Nombre no vacío tras trim, máximo 150 caracteres.
- Email con formato válido, máximo 254 caracteres; normalizado a minúsculas y trim.
- Email único incluso entre eliminados. Consulta previa y captura de E11000 (409) tanto al crear como al editar; editar conserva el propio email.
- Contraseña: mínimo 6 caracteres, máximo 72 bytes UTF-8, no solo espacios. Conserva el mínimo previamente existente en edición y lo aplica también a creación. Bcrypt costo 10; no recorta la contraseña.
- Roles permitidos: `admin`, `staff`, `taquilla`. `active` estrictamente booleano.
- IDs de 24 caracteres hexadecimales (400); no encontrado/eliminado en mutaciones (404).
- Errores de JSON inválido devuelven 400. Conflictos de unicidad/protección administrativa devuelven 409.
- Contraseñas y hashes no se incluyen en respuestas ni en historial.

## Permisos

| Operación | Administrador | Staff | Taquilla |
| --- | --- | --- | --- |
| Login y sesión propia | Sí | Sí | Sí |
| Consultar QR, carta y datos del visitante | Sí | Sí | Sí |
| Lista de pendientes | Sí | Sí | No |
| Peso, revisión/aprobación/rechazo | Sí | Sí | No |
| Validación/asignación de horario | Sí | Sí | No |
| Revisión/programación de actividades adicionales | Sí | Sí | No |
| Impresión/generación de ticket | Sí | Sí | No |
| Usuarios, atracciones, reportes, historial/expediente administrativo, exportación | Sí | No | No |

Taquilla usa `/taquilla` y reutiliza el escáner y la consulta del panel Staff. No incorpora listado ni buscador. Las mutaciones y tickets se bloquean en backend, además de ocultarse sus controles.

**Procedencia:** `participant.cityState`, capturado por el formulario público; combina ciudad/municipio y estado. No se infiere ni se separa automáticamente.
**Costo:** no hay un campo persistido de costo en Attraction o Waiver. Por decisión explícita, Taquilla muestra **Costo no disponible**. Queda pendiente definir la fuente; no se agregan precios, ventas ni cobros.

La consulta de Taquilla no consume QR legacy, no cambia horarios/estados y no escribe eventos. `valid` indica carta consultable, no autorización de acceso: se muestra separadamente el estado/autorización/vencimiento. Admin y Staff conservan el flujo previo de QR legacy.

## Sesiones e historial

JWT conserva duración de 7 días. Cada petición consulta `active`, `deletedAt`, rol y `authVersion` en MongoDB. Suspensión y eliminación incrementan authVersion; cambiar contraseña también la incrementa. Reactivación no devuelve validez a tokens anteriores: exige login nuevo.

Compatibilidad: usuarios y tokens anteriores sin authVersion se consideran versión 0. No requiere backfill ni invalidación global de todas las sesiones. Los cambios de perfil se aplican con el rol actual, no con el claim antiguo del JWT.

Frontend consulta `/auth/me` al abrir panel, volver a la ventana y antes de peticiones protegidas. Cambios de perfil limpian información privada y redirigen al panel adecuado. Un 401 limpia sesión, datos privados y cámara; un 403 limpia datos y resincroniza perfil. También cubre la exportación CSV, que usa fetch separado. Respuestas pendientes de una sesión ya limpiada se descartan.

No hay WebSocket, polling de suspensión ni revocación por dispositivo: una ventana inactiva puede conservar lo ya mostrado hasta volver a enfocarse o realizar una petición. No se puede retirar información ya descargada, ni cancelar retroactivamente una operación que ya atravesó autenticación.

Soft delete conserva `_id` y referencias en Waiver y WaiverAuditEvent; no permite edición/reactivación normal, ni reutilizar el email. No elimina ni modifica documentos firmados o eventos históricos. El historial preexistente sigue mostrando identidad poblada; no incorpora nuevos snapshots de nombre/email ni auditoría específica de gestión de usuarios.

## Protección administrativa y concurrencia

Backend impide suspender, eliminar o degradar la propia cuenta. Para reducir acceso de otro Administrador activo, comprueba que exista otro Administrador activo y no eliminado.

**Esta comprobación NO garantiza el resultado ante operaciones concurrentes.** No usa transacciones MongoDB, documentos compartidos de control ni bloqueos distribuidos, por decisión explícita del alcance. El conteo y la actualización son operaciones separadas. Dos peticiones pueden observar el mismo estado previo. Los tests demuestran operaciones normales, no una garantía concurrente.

## Verificación automatizada

`npm test` ejecuta tests existentes y `server/test/userAccess.test.js`: CRUD, validaciones, E11000, login, suspensión/reactivación, versionado, cambios de rol, aislamiento, guardas administrativas, soft delete y consulta sin consumo de Taquilla. `fixture.js` respeta estado de acceso al simular User.findOne.

Las pruebas usan Express y modelos/validación Mongoose con persistencia simulada en memoria, sin conexión ni mutaciones de producción. E11000 se simula; no demuestra índices o carreras en un MongoDB real. La conservación histórica se verifica con referencias de documentos locales, no con populate contra MongoDB.

Resultado de esta ejecución: **22/22 tests pasan**. Verificación en navegador con datos ficticios: edición sin cambiar contraseña, cancelar/confirmar suspensión, reactivación, consulta de Taquilla sin acciones restringidas, limpieza de carta tras suspensión y redirección al cambiar perfil. Usuarios y Taquilla se revisaron a 390 px sin overflow horizontal. No se probó cámara física ni impresora.

`npm run build` verifica compilación Svelte/Vite. `git diff --check` comprueba whitespace. Se mantiene el aviso preexistente de bundle >500 kB.

## Pruebas manuales

1. Admin → Usuarios: crear cada perfil; repetir email con mayúsculas/espacios; comprobar errores sin perder formulario.
2. Editar nombre/email/perfil; contraseña vacía conserva acceso. Contraseña nueva invalida sesión previa.
3. Suspender: abrir confirmación, cancelar y comprobar que sigue activo; confirmar, comprobar estado Suspendido.
4. Con otra sesión de esa cuenta abierta, intentar consultar QR: sesión termina y limpia carta. Login suspendido falla.
5. Reactivar y probar token anterior: falla; login nuevo funciona.
6. Eliminar: cancelar primero; confirmar después. Cuenta visible como Eliminado sin acciones, login/edición/reactivación fallan. Email sigue reservado. Historial conserva identidad/referencias.
7. Intentar suspender/eliminar/degradar cuenta propia mediante API: 409. Repetir protección del último Administrador en operaciones normales.
8. Cambiar Staff → Taquilla con sesión abierta; siguiente acción/foco actualiza perfil y limpia datos anteriores.
9. Taquilla: pegar/escanear QR, consultar carta, datos, atracción y procedencia; costo no disponible. No hay controles de revisión, peso, horarios, impresión o administración.
10. Intentar por HTTP las mutaciones/tickets/reportes con JWT Taquilla: 403. Escanear QR legacy repetidamente no lo consume.
11. Repetir flujos de Staff/Admin y revisar reportes por periodo, tabla de expediente, paginación 10, tickets 58/80 mm y beneficio Chihuahua.
12. Revisar pestaña Usuarios y Taquilla en escritorio y móvil; cámara requiere navegador/permisos apropiados. Impresión física y producción requieren validación en su entorno real.
