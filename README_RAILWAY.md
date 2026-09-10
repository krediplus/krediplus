# Kredi+ Backend Mobile 2.2.0 — Railway

Backend independiente para la app Flutter Kredi+.

## Producción
`https://krediplus-production.up.railway.app/api/v2`

## Health
`GET /api/v2/health`

## Railway
1. Conecta este directorio/repositorio a un proyecto Railway separado.
2. Añade PostgreSQL y configura `DATABASE_URL`.
3. Define `JWT_SECRET` con un valor largo y aleatorio.
4. Redis es opcional para las colas preparadas; configura `REDIS_URL` si se usa.
5. No uses la base de datos del backend Kotlin 1.1.29.

El `Dockerfile` genera Prisma, compila TypeScript y verifica `dist/main.js`.
El comando de arranque sincroniza el esquema y ejecuta `node dist/main.js`.
