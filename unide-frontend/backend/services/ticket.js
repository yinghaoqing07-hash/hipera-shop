// =====================================================================
// Ticket 80mm — generación de PDF e impresión automática
// =====================================================================
import { jsPDF } from 'jspdf'; // named import: el default es un objeto, no el constructor (rompe `new jsPDF`)
import QRCode from 'qrcode';
import printer from 'pdf-to-printer';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { platform } from 'os';
import { randomInt } from 'crypto';
import { pickupCode } from './email.js';

// Código de recogida ALEATORIO de 6 dígitos (independiente del id del
// pedido). Se almacena en orders.pickup_code para pedidos de recogida en
// tienda. Es el comprobante que el cliente presenta en el mostrador.
// Para pedidos antiguos sin este valor, el código cae al cálculo
// determinista pickupCode(id) como fallback (ver email.js).
export const generatePickupCode = () => String(randomInt(0, 1000000)).padStart(6, '0');

// Devuelve el código de recogida efectivo de un pedido: el aleatorio
// almacenado si existe, o el determinista a partir del id como fallback
// (compatibilidad con pedidos previos a la columna pickup_code).
export const resolvePickupCode = (order) => order?.pickup_code || pickupCode(order?.id);

export const hasFiscalInvoice = (order) => Boolean(order?.invoice_full_number && order?.invoice_issued_at);

export const taxRowsForOrder = (order) => {
  const rows = order?.tax_breakdown?.rates;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      rate: Number(r.rate),
      base: Number(r.base) || 0,
      cuota: Number(r.cuota) || 0,
      total: Number(r.total) || 0,
    }))
    .filter((r) => [4, 10, 21].includes(r.rate) && r.total > 0)
    .sort((a, b) => a.rate - b.rate);
};

export const formatFiscalDate = (value) => {
  try {
    return new Date(value).toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value || '');
  }
};

// 生成 80mm 热敏小票 PDF（用于自动打印）
export const generateTicketPDF = async (order) => {
  const isService = order.items?.some(i => i.isService);
  const isFiscal = hasFiscalInvoice(order);
  const taxRows = taxRowsForOrder(order);
  const companyData = {
    name: "QIANG GUO SL",
    address: "Paseo del Sol 1, 28880 Meco",
    nif: "B86126638",
    phone: "+34 918 782 602"
  };

  // 生成二维码 - 包含可访问的URL链接
  // 构建订单查询URL（前端地址 + 订单ID）
  const frontendUrl = process.env.FRONTEND_URL || 'https://hipera.es';
  const orderQueryUrl = `${frontendUrl}/?order=${order.id}`;
  const qrCodeUrl = await QRCode.toDataURL(orderQueryUrl, {
    errorCorrectionLevel: 'H', // 高纠错级别，确保打印后仍可扫描
    type: 'image/png',
    quality: 1.0,
    margin: 2,
    width: 300, // 增加分辨率，确保打印清晰
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });

  // 创建 80mm 宽度的小票（约 226px = 80mm at 72 DPI）
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 200] // 80mm 宽度，高度自动调整
  });

  const centerX = 40; // 80mm / 2
  let y = 5;

  // Header
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(companyData.name, centerX, y, { align: 'center' });
  y += 5;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(companyData.address, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`NIF: ${companyData.nif}`, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`Tel: ${companyData.phone}`, centerX, y, { align: 'center' });
  y += 6;

  // Divider
  doc.setLineWidth(0.5);
  doc.line(5, y, 75, y);
  y += 5;

  // Order Info
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(isService && !isFiscal ? "RESGUARDO REPARACION" : (isFiscal ? "FACTURA SIMPLIFICADA" : "JUSTIFICANTE DE PEDIDO"), centerX, y, { align: 'center' });
  y += 5;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Pedido: ${order.id.slice(0, 8).toUpperCase()}`, centerX, y, { align: 'center' });
  y += 4;
  if (isFiscal) {
    doc.text(`Factura: ${order.invoice_full_number}`, centerX, y, { align: 'center' });
    y += 4;
  }
  doc.text(`Fecha: ${isFiscal ? formatFiscalDate(order.invoice_issued_at) : new Date(order.created_at).toLocaleDateString('es-ES')}`, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`Hora: ${new Date(order.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`, centerX, y, { align: 'center' });
  y += 6;

  // Client Info
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE:", 5, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text(order.address || "Cliente General", 5, y, { maxWidth: 70 });
  y += 4;
  doc.text(order.phone || "", 5, y);
  y += 6;

  // Divider
  doc.line(5, y, 75, y);
  y += 5;

  // Items Table
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("ARTICULO", 5, y);
  doc.text("CANT", 50, y);
  doc.text("TOTAL", 65, y);
  y += 4;
  doc.line(5, y, 75, y);
  y += 3;

  doc.setFont("helvetica", "normal");
  order.items?.forEach(item => {
    const itemTotal = (item.price * item.quantity).toFixed(2);
    const itemName = item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name;
    doc.text(itemName, 5, y, { maxWidth: 43 });
    const nameHeight = doc.getTextDimensions(itemName, { maxWidth: 43 }).h;
    doc.text(`${item.quantity}x`, 50, y);
    doc.text(`€${itemTotal}`, 65, y);
    y += Math.max(nameHeight + 1, 4);
  });

  y += 3;
  doc.line(5, y, 75, y);
  y += 4;

  // Total
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(`TOTAL: €${order.total?.toFixed(2) || '0.00'}`, centerX, y, { align: 'center' });
  y += 5;
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(isFiscal ? `Precios con IVA incluido.` : `Precios con impuestos incluidos si corresponde.`, centerX, y, { align: 'center' });
  y += 4;
  if (isFiscal && taxRows.length > 0) {
    doc.text('Desglose IVA:', centerX, y, { align: 'center' });
    y += 4;
    taxRows.forEach((r) => {
      doc.text(`${r.rate}% Base ${r.base.toFixed(2)} IVA ${r.cuota.toFixed(2)}`, centerX, y, { align: 'center' });
      y += 4;
    });
  } else {
    doc.text(`No valido como factura fiscal.`, centerX, y, { align: 'center' });
    y += 5;
  }

  // Payment Method
  doc.setFontSize(8);
  doc.text(`Pago: ${order.payment_method?.toUpperCase() || 'Efectivo/Bizum'}`, centerX, y, { align: 'center' });
  y += 6;

  // Aviso de COBRO PENDIENTE: los pedidos de pago en tienda / contra
  // reembolso aún NO están pagados (status "Pendiente de Pago"). Se
  // destaca para que el personal cobre antes de entregar la mercancía.
  const isUnpaidCounter = order.status === 'Pendiente de Pago'
    || /contra\s*reembolso/i.test(order.payment_method || '');
  if (isUnpaidCounter) {
    doc.setLineWidth(0.8);
    doc.rect(5, y - 1, 70, 13);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("PENDIENTE DE COBRO", centerX, y + 3, { align: 'center' });
    doc.setFontSize(11);
    doc.text(`COBRAR: €${order.total?.toFixed(2) || '0.00'}`, centerX, y + 9, { align: 'center' });
    doc.setLineWidth(0.5);
    y += 16;
    doc.setFont("helvetica", "normal");
  }

  // Código de recogida (solo pedidos de recogida en tienda). Destacado
  // para que el personal de mostrador lo compare con el que enseña el
  // cliente (mismo número que recibe por email/WhatsApp).
  if (order.delivery_method === 'store_pickup') {
    doc.line(5, y, 75, y);
    y += 5;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("RECOGIDA EN TIENDA", centerX, y, { align: 'center' });
    y += 4;
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text("Codigo de recogida:", centerX, y, { align: 'center' });
    y += 6;
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(resolvePickupCode(order), centerX, y, { align: 'center' });
    y += 6;
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text("Verificar: pedir tel./nombre del cliente", centerX, y, { align: 'center' });
    y += 5;
    doc.line(5, y, 75, y);
    y += 5;
  }

  // Warranty Note (for services)
  if (isService) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text("GARANTIA DE REPARACION: 6 MESES", centerX, y, { align: 'center' });
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.text("Imprescindible presentar este ticket", centerX, y, { align: 'center' });
    y += 6;
  }

  // QR Code - 确保足够大且清晰
  // 在80mm宽度的小票上，二维码应该至少30mm x 30mm才能清晰扫描
  const qrSize = 30; // 30mm x 30mm
  const qrX = (80 - qrSize) / 2; // 居中
  doc.addImage(qrCodeUrl, 'PNG', qrX, y, qrSize, qrSize);
  y += qrSize + 5;

  // Footer
  doc.setFontSize(8);
  doc.text("¡Gracias por su visita!", centerX, y, { align: 'center' });

  return doc;
};

// 自动打印 ticket
export const autoPrintTicket = async (order) => {
  try {
    // 生成 PDF
    const doc = await generateTicketPDF(order);
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    // 保存到临时文件
    const tempPath = join(tmpdir(), `ticket_${order.id.slice(0, 8)}_${Date.now()}.pdf`);
    await writeFile(tempPath, pdfBuffer);

    // pdf-to-printer 主要支持 Windows，其他平台可能需要不同方案
    const isWindows = platform() === 'win32';

    if (isWindows) {
      // Windows: 尝试自动打印
      const printerName = process.env.PRINTER_NAME || undefined;
      try {
        await printer.print(tempPath, {
          printer: printerName,
          pages: '1',
        });
        console.log(`✅ Ticket impreso automáticamente para pedido ${order.id.slice(0, 8)}`);
        // 打印成功后，可以选择删除临时文件
        // await unlink(tempPath);
      } catch (printError) {
        console.warn(`⚠️ No se pudo imprimir automáticamente: ${printError.message}`);
        console.log(`📄 PDF guardado en: ${tempPath} (puede imprimirse manualmente)`);
      }
    } else {
      // Linux/Mac: 保存PDF，可以手动打印或配置CUPS
      console.log(`📄 Ticket PDF generado para pedido ${order.id.slice(0, 8)}`);
      console.log(`📁 Ubicación: ${tempPath}`);
      console.log(`💡 En Linux/Mac, puede usar: lp ${tempPath} o configurar CUPS`);
    }

    return { success: true, pdfPath: tempPath };
  } catch (error) {
    console.error('Error al generar/imprimir ticket:', error);
    return { success: false, error: error.message };
  }
};
