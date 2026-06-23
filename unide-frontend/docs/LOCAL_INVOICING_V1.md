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

## Cumplimiento y migracion a VeriFactu

- La factura simplificada local es LEGAL como solucion previa: para una S.L.
  (sujeta a Impuesto de Sociedades) la obligacion VeriFactu empieza el
  **1 de enero de 2027** (aplazada en diciembre de 2025). Hay que activar
  fiskaly/VeriFactu ANTES de esa fecha.

- **Continuidad de serie al activar fiskaly.** El contador es por
  `(serie, año)`. Local y fiskaly comparten por defecto la serie `WEB`:
  - Si se conmuta en el cambio de año (local todo 2026 -> fiskaly desde el
    1-1-2027), fiskaly arranca un contador nuevo `WEB-2027` desde 1 y no
    colisiona con los numeros locales de `WEB-2026`. Limpio.
  - Si se activa fiskaly A MITAD del mismo año, seguiria el contador
    `WEB-2026` y la serie mezclaria numeros locales (NO registrados en
    AEAT) con numeros VeriFactu (registrados), rompiendo la continuidad
    ante AEAT. En ese caso, darle a fiskaly un prefijo distinto:
    `FISKALY_SERIES_PREFIX=WF` (u otro) para que la serie VeriFactu sea
    limpia desde el numero 1.
  - No re-facturar con fiskaly pedidos que ya tengan numero local: fiskaly
    reutilizaria ese numero y lo registraria tarde en AEAT.
