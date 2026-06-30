# Pendientes jueves

- [x] Dropdowns en cascada para nacionalidad, estado y ciudad
- [x] No permitir que las referencias familiares se envíen solo con espacios; deben tener longitud mínima
- [x] Marcar los campos que faltan de llenar si se intenta grabar el waiver incompleto
- [x] Si se indica que no se toman medicamentos, no pedir médico tratante (hoy no deja avanzar si ese campo queda vacío)

## Caja y pago

- Al crear la atracción, poder definir **precio** por atracción
- El QR debe servir no solo como waiver, sino para **escanear en caja** con un lector y mostrar directo lo capturado en el waiver para cobrarlo
- **Preguntar al cliente:** ¿el pago es aparte por persona o va ligado a cada atracción?
- Al guardar el waiver, registrar un nuevo campo **`pagado`** (inicialmente `false`); al escanearlo en caja, pasar a `true`


- Codigo de iso justo a registro de waiver
- boton ingles y español 
- codigo iso diferente entre waiver en ingles y español
- solo una referencia obligatoria
- Leyenda (Que no esté contigo en )
- nombre completo del cliente, actividad, residente del estado, y le pide la identificacion
- folio (mas corto porque ahorita trae el foliotote)
- con el ticket de caja se revisa que la carta responsiva sea de la persona y el ticket
- folio de 6 digitos PB1234 
- ver si se va a conectar con la base de datos
- toma medicamentos solo se activa si si toma medicamentos
