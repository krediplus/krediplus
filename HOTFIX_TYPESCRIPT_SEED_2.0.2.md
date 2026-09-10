# Kredi+ Backend Mobile 2.0.2 - Hotfix TypeScript Seed

Corrige el error TS2322 de `prisma/seed.ts` durante `nest build`.

## Causa
TypeScript infería la matriz de niveles como `(string | number)[][]`; al desestructurar, `code` y `name` quedaban tipados como `string | number`, pero Prisma exige `string`.

## Corrección
Los niveles K1-K4 ahora se definen como objetos `as const`, preservando los tipos correctos de cada propiedad.

## Despliegue
Reemplazar el backend por esta versión, ejecutar `git add .`, `git commit -m "Fix seed TypeScript - Backend 2.0.2"` y `git push origin main`.
