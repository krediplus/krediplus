# Kredi+ Backend Mobile 2.0.1 - Hotfix Prisma/Railway

Se corrige `prisma/schema.prisma` del paquete 2.0.0.

## Causa
El esquema inicial usó bloques `generator`, `datasource`, `enum` y varios `model` compactados en una sola línea. Prisma 6.19.3 no los interpretó correctamente y produjo P1012 con errores en cascada (93 errores).

## Corrección
- `generator` y `datasource` en sintaxis multilínea.
- Todos los `enum` en bloques Prisma válidos.
- Todos los `model` reformateados preservando nombres de modelos, campos, relaciones, índices y tipos.
- Versión npm actualizada a 2.0.1.

## Validación recomendada antes del push
Ejecutar `VALIDAR_BACKEND_2.0.bat` o:

```bat
npm install
npx prisma format
npx prisma validate
npx prisma generate
npm run build
```

La advertencia `package.json#prisma is deprecated` en Prisma 6.19.x es una advertencia de compatibilidad futura con Prisma 7 y no es la causa del fallo de compilación.
