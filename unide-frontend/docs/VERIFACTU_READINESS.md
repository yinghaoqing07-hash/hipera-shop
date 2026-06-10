# VeriFactu / fiskaly — checklist de preparación

Estado: **groundwork de datos hecho; integración del proveedor pendiente.**

Marco legal: RD 1007/2023 + Orden HAC/1177/2024 (sistemas de facturación
verificables "VeriFactu"). El proveedor previsto es **fiskaly (SIGN ES /
VeriFactu)**, que actúa como sistema certificado y envía las facturas a la
AEAT, devolviendo la **huella encadenada** y el **QR** que hay que imprimir.

---

## 1. Qué ya está preparado (en el repo)

- **`supabase_migration_orders_invoicing.sql`** — columnas nuevas (NULLABLE,
  no rompen nada) en `orders`:
  - `invoice_series`, `invoice_number`, `invoice_full_number`, `invoice_issued_at`
  - `tax_breakdown` (jsonb, desglose de IVA)
  - `billing_name`, `billing_nif`, `billing_address` (datos fiscales del cliente
    para factura completa)
  - `verifactu_status` ('none'|'pending'|'issued'|'error'), `verifactu_id`,
    `verifactu_hash`, `verifactu_qr`
  - Tabla `invoice_counters` + función `next_invoice_number(series, year)`
    (numeración correlativa y **sin saltos**, atómica).
- **`backend/services/invoicing.js`**:
  - `computeTaxBreakdown(order)` — desglose de IVA desde precios CON IVA
    incluido (base + cuota por tipo 4/10/21). Función pura.
  - `nextInvoiceNumber(supabase, {series, year})` — wrapper de la función SQL.
  - `formatInvoiceNumber()` — p. ej. `A-2026-000123`.
  - `buildVerifactuPayload(order)` — payload normalizado + lista de campos
    que faltan para emitir.
  - `issueInvoiceWithProvider()` — **STUB**: aquí irá la llamada a fiskaly.

> Ejecutar la migración en Supabase → SQL Editor cuando se quiera activar.
> No es urgente: las columnas son opcionales y no afectan al flujo actual.

---

## 2. Qué falta para emitir facturas reales

### 2.1 Operativo (con la gestoría) — bloqueante
- [ ] **Clasificar el IVA de todos los productos**: hoy la mayoría tiene
      `tax_review_status = 'pending'`. Cada producto necesita `tax_rate`
      (4/10/21) confirmado. Mientras haya productos sin clasificar,
      `computeTaxBreakdown` marca `hasUnclassified = true`.
- [ ] Confirmar **política de facturación**: ¿se emite *factura simplificada*
      (ticket) en toda venta B2C y *factura completa* solo a petición / B2B?
- [ ] Confirmar **serie(s)** de numeración y punto de partida.

### 2.2 Técnico (cuando fiskaly esté contratado)
- [ ] Alta en fiskaly + credenciales (API key) en variables de Railway
      (`FISKALY_API_KEY`, etc.), nunca en el repo.
- [ ] Implementar `issueInvoiceWithProvider()` (llamada HTTP a SIGN ES).
- [ ] En el flujo de pedido confirmado: calcular `tax_breakdown`, asignar
      número con `nextInvoiceNumber`, llamar a fiskaly, guardar
      `verifactu_hash` / `verifactu_qr` / `verifactu_id` y `verifactu_status`.
- [ ] **Actualizar el ticket** (`print-agent/lib/escpos.js` y/o el PDF de
      `server.js`): añadir **desglose de IVA**, **QR de VeriFactu** y la
      mención **"VERI*FACTU"**. Quitar "No válido como factura fiscal" cuando
      el documento pase a ser factura simplificada.
- [ ] (Opcional, §2.1) Captura de **NIF + nombre fiscal** en el checkout para
      factura completa.
- [ ] Manejo de errores/reintentos y registro de auditoría.

---

## 3. Preguntas concretas para la gestoría

1. ¿La actividad está **dentro del ámbito VeriFactu** o sujeta a **SII**?
   (El SII excluye de VeriFactu; condiciona toda la integración.)
2. **Tipo de IVA por categoría**: alimentación (¿4 % básicos / 10 % resto?),
   bazar y accesorios (¿21 %?), servicios de reparación (¿21 %?). Lista
   producto a producto si es posible.
3. **IVA de los gastos de envío** (4,99 €): ¿21 % siempre, o el tipo del
   producto principal? (Hoy el código asume 21 % por defecto.)
4. **Recargo de equivalencia**: ¿aplica al negocio? ¿Afecta a lo que se
   imprime en la factura?
5. **Factura simplificada vs completa**: límites de importe y casos en que es
   obligatoria la completa con NIF del cliente.
6. **Serie y numeración**: ¿una sola serie anual? ¿formato deseado?
7. **Reparaciones**: ¿se factura igual que los productos? ¿la señal genera
   factura/anticipo o se factura todo al final?

---

## 4. Notas de diseño

- Precios = **PVP con IVA incluido** (retail). `computeTaxBreakdown` calcula
  `base = incl × 100 / (100 + tipo)` y `cuota = incl − base`.
- El **descuento de cupón** se prorratea proporcionalmente entre tipos para
  que el desglose cuadre con el total cobrado.
- La numeración es **sin saltos** (requisito VeriFactu): un hueco solo debe
  existir por factura anulada, nunca por error técnico.
- Todo lo específico de fiskaly queda aislado en `issueInvoiceWithProvider`
  para poder cambiar de proveedor sin tocar el resto del backend.
