# Factura simplificada local - V1

Estado: primera version operativa previa a VeriFactu/fiskaly.

## Que hace

- Emite una factura simplificada local por pedido cobrado.
- Asigna numeracion correlativa con `invoice_counters`:
  - serie por defecto: `WEB`
  - formato visible: `WEB-2026-000001`
- Guarda en `orders`:
  - `invoice_series`
  - `invoice_number`
  - `invoice_full_number`
  - `invoice_issued_at`
  - `tax_breakdown`
- Actualiza los PDF A4, ticket 80 mm, panel admin, CSV y print-agent para mostrar numero de factura e IVA.

## Cuando se emite

- Stripe con cobro real: al webhook de pago confirmado.
- Tarjeta autorizada: al capturar el pago desde admin.
- Pago en tienda / contra reembolso: al marcar `Entregado`.
- Manual: boton `Emitir factura` en el detalle del pedido.

No se emite si el pedido esta cancelado, esperando pago, autorizado sin capturar o pendiente de cobro.

## Requisitos

Ejecutar antes en Supabase:

```sql
supabase_migration_orders_invoicing.sql
```

Los productos deben tener `tax_rate` congelado en las lineas del pedido. La emision local es estricta: si una linea de producto no tiene IVA valido, se rechaza para evitar tickets fiscales incorrectos.

## Variables

- `LOCAL_INVOICING_ENABLED=false` desactiva esta facturacion local.
- `LOCAL_INVOICE_SERIES_PREFIX=WEB` cambia la serie local.

Si `FISKALY_*` esta configurado, el backend prioriza fiskaly y usa la misma numeracion/payload.
