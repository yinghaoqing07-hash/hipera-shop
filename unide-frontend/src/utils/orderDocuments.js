// =====================================================================
// orderDocuments — Generación de justificante A4 + ticket 80 mm en PDF
// =====================================================================
// Aislado en un módulo aparte para que jsPDF + jspdf-autotable + qrcode
// se carguen únicamente cuando un cliente descarga su justificante/ticket.
// Antes vivía dentro de src/App.jsx con `import jsPDF from 'jspdf'`
// (estático), lo que metía ~700 KB de dependencias en el bundle
// principal de la home y bloqueaba el primer paint para todos los
// visitantes, aunque la inmensa mayoría no descarga nunca un PDF.
//
// Patrón de uso desde la UI:
//
//   const { generateDocuments } = await import('../utils/orderDocuments');
//   await generateDocuments(order, 'both');
//
// El bundle resultante crea un chunk asíncrono propio (vendor + admin
// comparten partes; Rollup lo deduplica solo).
// =====================================================================

import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  fiscalDocumentTitle,
  fiscalFooterText,
  formatFiscalDate,
  formatEuro,
  hasFiscalInvoice,
  itemTaxRate,
  normalizeTaxBreakdown,
} from './fiscalDocuments';

export const generateDocuments = async (order, type = 'both') => {
  const isService = order.items.some(i => i.isService);
  // Descuento de cupón (opcional). order.total ya viene con el descuento
  // restado; aquí solo lo mostramos como línea informativa para que el
  // cliente vea reflejado el cupón aplicado.
  const discount = Number(order.discount) || 0;
  const couponCode = order.couponCode || order.coupon_code || null;
  const companyData = {
    name: 'QIANG GUO SL',
    address: 'Paseo del Sol 1, 28880 Meco',
    nif: 'B86126638',
    phone: '+34 918 782 602',
    web: 'hipera.es',
  };
  const isFiscal = hasFiscalInvoice(order);
  const taxRows = normalizeTaxBreakdown(order);

  // QR con URL de seguimiento del pedido (mismo formato que los
  // enlaces del email transaccional; ?order= no ?orderId=).
  const orderQueryUrl = `${window.location.origin}/?order=${order.id}`;
  const qrCodeUrl = await QRCode.toDataURL(orderQueryUrl, {
    errorCorrectionLevel: 'H',
    width: 300,
    margin: 2,
  });

  // --- Plantilla A: justificante A4 (no fiscal) ---
  const createA4Justificante = () => {
    const doc = new jsPDF();

    // 1. Header
    doc.setFillColor(220, 38, 38); // Red brand color
    doc.rect(0, 0, 210, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(companyData.name, 14, 20);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Mercado & Reparaciones', 14, 26);

    doc.setFontSize(10);
    doc.text(companyData.address, 196, 15, { align: 'right' });
    doc.text(`NIF: ${companyData.nif}`, 196, 20, { align: 'right' });
    doc.text(`Tel: ${companyData.phone}`, 196, 25, { align: 'right' });

    // 2. Cliente & Pedido
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text('CLIENTE:', 14, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(order.address || 'Cliente General', 14, 62);
    doc.text(order.phone || '', 14, 67);

    doc.setFont('helvetica', 'bold');
    doc.text(fiscalDocumentTitle(order), 140, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(`Pedido: ${order.id.slice(0, 8).toUpperCase()}`, 140, 62);
    doc.text(`${isFiscal ? 'Factura' : 'Fecha'}: ${isFiscal ? order.invoice_full_number : new Date(order.created_at).toLocaleDateString()}`, 140, 67);
    doc.text(`Fecha: ${isFiscal ? formatFiscalDate(order.invoice_issued_at) : new Date(order.created_at).toLocaleDateString()}`, 140, 72);
    doc.text(`Pago: ${order.payment_method?.toUpperCase() || 'CONTADO'}`, 140, 77);
    doc.setFontSize(8);
    doc.setTextColor(120);
    fiscalFooterText(order).forEach((line, i) => doc.text(line, 140, 82 + i * 4));
    doc.setTextColor(0, 0, 0);

    // 3. Tablas: productos y regalos por separado
    const regularItems = order.items.filter(item => !(item.isGift || item.price === 0));
    const giftItems = order.items.filter(item => item.isGift || item.price === 0);

    let startY = 80;

    if (regularItems.length > 0) {
      const tableRows = regularItems.map(item => [
        item.name,
        item.quantity,
        formatEuro(item.price),
        itemTaxRate(item) ? `${itemTaxRate(item)}%` : 'Pend.',
        formatEuro(item.price * item.quantity),
      ]);
      autoTable(doc, {
        startY,
        head: [['Descripción', 'Cant.', 'Precio', 'IVA', 'TOTAL']],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [31, 41, 55] },
        styles: { fontSize: 9 },
      });
      startY = doc.lastAutoTable.finalY + 8;
    }

    if (giftItems.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(180, 80, 120);
      doc.text('Regalo(s) — GRATIS', 14, startY);
      startY += 6;
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      const giftRows = giftItems.map(item => [
        `${item.name} [REGALO]`,
        item.quantity,
        '0.00',
        '€0.00',
      ]);
      autoTable(doc, {
        startY,
        head: [['Descripción', 'Cant.', 'Precio', 'TOTAL']],
        body: giftRows,
        theme: 'grid',
        headStyles: { fillColor: [180, 80, 120] },
        styles: { fontSize: 9 },
      });
      startY = doc.lastAutoTable.finalY + 8;
    }

    // 4. Totales
    let finalY = startY + 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    // El envío no se almacena como línea aparte; lo derivamos para que el
    // desglose cuadre: total = subtotal(items) - descuento + envío.
    const itemsGross = regularItems.reduce((s, it) => s + (it.price * it.quantity), 0);
    const shipping = Math.max(0, Math.round((order.total - (itemsGross - discount)) * 100) / 100);

    if (discount > 0 || shipping > 0) {
      doc.text('Subtotal:', 160, finalY, { align: 'right' });
      doc.text(`€${itemsGross.toFixed(2)}`, 190, finalY, { align: 'right' });
      finalY += 5;
      if (discount > 0) {
        doc.setTextColor(22, 130, 60);
        doc.text(`Descuento (${couponCode || 'CUPÓN'}):`, 160, finalY, { align: 'right' });
        doc.text(`-€${discount.toFixed(2)}`, 190, finalY, { align: 'right' });
        doc.setTextColor(0, 0, 0);
        finalY += 5;
      }
      if (shipping > 0) {
        doc.text('Envío:', 160, finalY, { align: 'right' });
        doc.text(`€${shipping.toFixed(2)}`, 190, finalY, { align: 'right' });
        finalY += 5;
      }
    }

    if (isFiscal && taxRows.length > 0) {
      autoTable(doc, {
        startY: finalY + 1,
        head: [['IVA', 'Base imponible', 'Cuota IVA', 'Total']],
        body: taxRows.map((r) => [`${r.rate}%`, formatEuro(r.base), formatEuro(r.cuota), formatEuro(r.total)]),
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { textColor: [31, 41, 55], fontStyle: 'bold' },
        columnStyles: {
          1: { halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
        },
        margin: { left: 118, right: 14 },
      });
      finalY = doc.lastAutoTable.finalY + 4;
    }

    doc.setTextColor(120);
    doc.text(isFiscal ? 'Precios con IVA incluido.' : 'Precios con impuestos incluidos cuando corresponda.', 190, finalY, { align: 'right' });
    finalY += 9;
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL A PAGAR:', 160, finalY, { align: 'right' });
    doc.text(`€${order.total.toFixed(2)}`, 190, finalY, { align: 'right' });

    // 5. Caja de garantía (sólo reparaciones)
    if (isService) {
      const boxY = finalY + 11;
      doc.setDrawColor(200);
      doc.setFillColor(248, 248, 248);
      doc.rect(14, boxY, 182, 50, 'FD');

      doc.setFontSize(10);
      doc.setTextColor(220, 38, 38);
      doc.text('GARANTÍA Y CONDICIONES', 18, boxY + 8);

      doc.setFontSize(8);
      doc.setTextColor(80);
      const terms = [
        '1. Validez: 180 días de garantía sobre la reparación efectuada.',
        '2. Exclusiones: No cubre daños por humedad, golpes posteriores o manipulación externa.',
        '3. Recogida: Dispone de 3 meses para recoger su dispositivo. Pasado este tiempo,',
        '   será enviado a reciclaje según normativa vigente.',
        '4. Datos: La empresa no se hace responsable de la pérdida de software o datos.',
      ];
      terms.forEach((line, i) => doc.text(line, 18, boxY + 16 + (i * 5)));
    }

    // 6. Footer QR
    doc.addImage(qrCodeUrl, 'PNG', 14, 250, 25, 25);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Escanea para ver tu pedido online', 42, 260);
    doc.text('Gracias por su visita.', 42, 265);

    doc.save(`Justificante_${order.id.slice(0, 8)}.pdf`);
  };

  // --- Plantilla B: Ticket térmico 80 mm ---
  const createThermalTicket = () => {
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: [80, 260],
    });

    let y = 10;
    const centerX = 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(companyData.name, centerX, y, { align: 'center' });
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Mercado & Servicios', centerX, y, { align: 'center' });
    y += 5;
    doc.text(companyData.address, centerX, y, { align: 'center' });
    y += 5;
    doc.text(`NIF: ${companyData.nif}`, centerX, y, { align: 'center' });
    y += 5;
    doc.text(new Date().toLocaleString(), centerX, y, { align: 'center' });
    y += 8;

    doc.setFontSize(9);
    doc.text('--------------------------------', centerX, y, { align: 'center' });
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(isService && !isFiscal ? 'RESGUARDO REPARACION' : fiscalDocumentTitle(order), centerX, y, { align: 'center' });
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Ref: ${order.id.slice(0, 8)}`, centerX, y, { align: 'center' });
    y += 5;
    if (isFiscal) {
      doc.text(`Factura: ${order.invoice_full_number}`, centerX, y, { align: 'center' });
      y += 5;
      doc.text(formatFiscalDate(order.invoice_issued_at), centerX, y, { align: 'center' });
      y += 5;
    }
    doc.text('--------------------------------', centerX, y, { align: 'center' });
    y += 6;

    doc.setFontSize(10);
    const regularForTicket = order.items.filter(item => !(item.isGift || item.price === 0));
    const giftsForTicket = order.items.filter(item => item.isGift || item.price === 0);

    regularForTicket.forEach(item => {
      doc.text(item.name.substring(0, 25), 5, y);
      y += 5;
      const line = `${item.quantity} x ${item.price.toFixed(2)}`.padEnd(20) + `€${(item.price * item.quantity).toFixed(2)}`;
      doc.text(line, 5, y);
      y += 6;
    });

    if (giftsForTicket.length > 0) {
      y += 3;
      doc.text('--------------------------------', centerX, y, { align: 'center' });
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.text('REGALO(S) — GRATIS', centerX, y, { align: 'center' });
      y += 6;
      doc.setFont('helvetica', 'normal');
      giftsForTicket.forEach(item => {
        doc.text(`${item.name.substring(0, 22)} [REGALO]`, 5, y);
        y += 5;
        doc.text(`${item.quantity} x 0.00`.padEnd(20) + 'GRATIS', 5, y);
        y += 6;
      });
    }

    y += 3;
    doc.text('--------------------------------', centerX, y, { align: 'center' });
    y += 6;

    const itemsGrossT = regularForTicket.reduce((s, it) => s + (it.price * it.quantity), 0);
    const shippingT = Math.max(0, Math.round((order.total - (itemsGrossT - discount)) * 100) / 100);
    if (discount > 0 || shippingT > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Subtotal:'.padEnd(18) + `EUR ${itemsGrossT.toFixed(2)}`, 5, y);
      y += 5;
      if (discount > 0) {
        doc.text(`Dto (${couponCode || 'CUPON'}):`.padEnd(16) + `-EUR ${discount.toFixed(2)}`, 5, y);
        y += 5;
      }
      if (shippingT > 0) {
        doc.text('Envio:'.padEnd(18) + `EUR ${shippingT.toFixed(2)}`, 5, y);
        y += 5;
      }
      y += 1;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`TOTAL:     EUR ${order.total.toFixed(2)}`, 5, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(isFiscal ? 'Precios con IVA incluido.' : 'Precios con impuestos incluidos si corresponde.', 5, y);
    y += 6;
    if (isFiscal) {
      // Pedido ya facturado: NUNCA imprimir "no válido" (contradiría el
      // número de factura impreso arriba). El desglose se muestra si está.
      if (taxRows.length > 0) {
        doc.text('Desglose IVA:', 5, y);
        y += 5;
        taxRows.forEach((r) => {
          doc.text(`${r.rate}% Base ${r.base.toFixed(2)} IVA ${r.cuota.toFixed(2)}`, 5, y);
          y += 5;
        });
      }
    } else {
      doc.text('No valido como factura fiscal.', 5, y);
      y += 6;
    }
    doc.setFontSize(10);
    doc.text(`Pago: ${order.payment_method?.toUpperCase() || 'Efectivo/Bizum'}`, 5, y);
    y += 10;

    if (isService) {
      doc.setFontSize(9);
      doc.text('GARANTIA DE REPARACION: 6 MESES', centerX, y, { align: 'center' });
      y += 5;
      doc.text('Imprescindible presentar este ticket', centerX, y, { align: 'center' });
      y += 6;
    }

    doc.addImage(qrCodeUrl, 'PNG', 20, y, 40, 40);
    y += 45;

    doc.setFontSize(10);
    doc.text('¡Gracias por su visita!', centerX, y, { align: 'center' });

    doc.save(`Ticket_${order.id.slice(0, 8)}.pdf`);
  };

  // Ejecutar descarga(s)
  if (type === 'invoice' || type === 'both') createA4Justificante();
  if (type === 'ticket' || type === 'both') {
    // Pequeño delay para evitar que el navegador bloquee el segundo
    // diálogo de descarga (algunos popup blockers lo cuentan como
    // segunda acción no iniciada por el usuario).
    setTimeout(() => createThermalTicket(), 500);
  }
};
