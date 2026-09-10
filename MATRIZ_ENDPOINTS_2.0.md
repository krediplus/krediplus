# Contrato funcional Kredi+ 2.0

## Móvil
- `GET /mobile/home`
- `GET /mobile/navigation`
- `GET /credit-lines` y `GET /credit-lines/:id`
- `GET /catalog/home`, `/products`, `/combos`, `/fairs`
- `GET /stores`, `/stores/nearby`, `/stores/categories`, `/stores/:id`
- `POST /checkout/quote`, `POST /checkout/confirm`
- `GET /purchases?status=pending|paid|cancelled`, `GET /purchases/:id`
- `GET /payments/pending`, `/payments/history`, `POST /payments/report`
- `GET /loyalty/profile`, `/loyalty/levels`, `/loyalty/rewards`, `/loyalty/points/history`
- `GET /referrals/me`, `/referrals/history`
- `GET/PATCH /me`, CRUD `/me/addresses`
- `GET /notifications`, lectura individual y masiva
- `GET /capture/config/:type`, `POST /verification/:kind`

## Selectores automáticos
- Estados → Municipios → Parroquias → Comunidades
- Bancos activos
- Taxonomía de productos
- Menús automáticos por rol/permisos vía `/mobile/navigation`

## Administrador obligatorio
- Cola unificada `/admin/work-queue`
- Usuarios y expediente `/admin/users/:id/dossier`
- Verificaciones y revisión
- Solicitudes de crédito y revisión
- Pagos reportados y revisión
- Inventario/productos
- Jornadas
- Banners
- Promociones
- Comunidades
- Reportes resumen

## Contador obligatorio
- Dashboard y presupuesto
- Movimientos presupuestarios
- Asignaciones
- Negocios asociados y datos de cobro
- Conciliación
- Cierre mensual
- Doble autorización
- Personal: suspensión/reactivación
- Descuentos
- Análisis predictivo informativo

## Compatibilidad temporal Flutter 1.0.0
La API 2.0 también expone alias de transición para los paths ya utilizados por la rama Flutter actual (`/me/credit`, `/me/purchases`, `/admin/usuarios`, `/accountant/wallet`, etc.). Esto permite conectar la app al Railway nuevo sin volver a depender del backend legacy mientras se migra pantalla por pantalla al contrato 2.0.
