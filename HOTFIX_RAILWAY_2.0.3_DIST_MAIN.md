# Kredi+ Backend Mobile 2.0.3 — Hotfix Railway

Corrige el arranque `Cannot find module /app/dist/main.js`.

## Causa
El build TypeScript estaba incluyendo `prisma/seed.ts` fuera de `src`, por lo que el `rootDir` inferido pasaba a ser la raíz del proyecto y el archivo principal terminaba en `dist/src/main.js`. Railway intentaba ejecutar `dist/main.js`.

## Corrección
- `tsconfig.build.json` limita el build a `src/**/*.ts`.
- `rootDir` queda fijado en `src`.
- `npm run build` usa `tsc -p tsconfig.build.json`.
- Docker verifica `test -f /app/dist/main.js` durante la imagen.
- Prisma CLI se instala como dependencia de runtime para que `prisma db push` no dependa de descargas de `npx`.

La advertencia sobre `package.json#prisma` y Prisma 7/8 no bloquea el despliegue de Prisma 6.19.x.
