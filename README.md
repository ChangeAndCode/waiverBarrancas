# Waiver MVP (Svelte + Node + MongoDB)

Sistema simple para:
- Captura de waiver digital
- Firma digital por nombre
- Generacion de QR
- Validacion por staff
- Admin para gestionar atracciones

## Stack

- Frontend: Svelte + Vite
- Backend: Node.js + Express
- DB: MongoDB Atlas (recomendado para Render)

## Desarrollo local

1) Instalar todo:

```bash
npm run install:all
```

2) Variables de entorno:

Crear `server/.env` desde `server/.env.example`:

```env
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/waiver-app
JWT_SECRET=cambia-esto-ahora
SUPERADMIN_EMAIL=admin@waiver.local
SUPERADMIN_PASSWORD=Admin12345
CORS_ORIGINS=http://localhost:4000,http://localhost:5173
```

3) Correr backend y frontend:

```bash
npm run dev:server
npm run dev:client
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Produccion (un solo servicio)

El backend sirve archivos estaticos de `client/dist`, por lo tanto Render solo necesita un Web Service.

### Render - configuracion recomendada

- **Build Command**
  - `npm run install:all && npm run build`
- **Start Command**
  - `npm start`
- **Variables de entorno**
  - `MONGO_URI` (MongoDB Atlas)
  - `JWT_SECRET`
  - `SUPERADMIN_EMAIL`
  - `SUPERADMIN_PASSWORD`
  - `CORS_ORIGINS` (lista separada por comas)
  - `NODE_ENV=production`

## Rutas principales

- Registro waiver: `/`
- Validacion QR: `/check/:token`
- Panel staff (reportes): `/staff`
- Admin atracciones: `/admin`
- API health: `/api/health`

## Notas legales

El texto del waiver incluido es generico para Mexico y debe ser revisado por asesoria legal antes de produccion.

## Visitas y validación de carta responsiva

El visitante puede registrarse el mismo día, el día anterior o con mayor anticipación
(en `America/Chihuahua`). La carta nace en **Pendiente de validación**. Staff valida y
asigna una hora general; la primera asignación real activa el QR hasta las 00:00 del día
siguiente a esa asignación, independientemente del horario programado. `scheduleAssignedAt`
y `qrExpiresAt` no cambian al editar horarios ni agregar actividades. No se usa cron ni TTL.
Las cartas anteriores conservan sus reglas originales.

Para pruebas locales, iniciar Vite con
`VITE_DEV_API_PROXY=http://localhost:4000 npm run dev:client`
(el proxy predeterminado apunta a producción). Ejecutar `npm test` y `npm run build`.

El correo requiere `RESEND_API_KEY`, `RESEND_FROM_EMAIL` y `PUBLIC_BASE_URL`.
Ver [reporte técnico y guía de pruebas](docs/waiver-visitas.md) para el flujo completo,
archivos, decisiones, configuración y criterios de aceptación.
