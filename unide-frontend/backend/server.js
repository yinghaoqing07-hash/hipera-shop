import express from 'express';
import dotenv from 'dotenv';
import FormData from 'form-data';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { Blob } from 'buffer';
import sharp from 'sharp';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import printer from 'pdf-to-printer';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { platform } from 'os';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 生成 80mm 热敏小票 PDF（用于自动打印）
const generateTicketPDF = async (order) => {
  const isService = order.items?.some(i => i.isService);
  const companyData = {
    name: "QIANG GUO SL",
    address: "Paseo del Sol 1, 28880 Meco",
    nif: "B86126638",
    phone: "+34 918 782 602"
  };

  // 生成二维码 - 包含可访问的URL链接
  // 构建订单查询URL（前端地址 + 订单ID）
  const frontendUrl = process.env.FRONTEND_URL || 'https://hipera-shop.vercel.app';
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
  doc.text(isService ? "RESGUARDO REPARACION" : "TICKET DE CAJA", centerX, y, { align: 'center' });
  y += 5;
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Núm: ${order.id.slice(0, 8).toUpperCase()}`, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`Fecha: ${new Date(order.created_at).toLocaleDateString('es-ES')}`, centerX, y, { align: 'center' });
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
  doc.text(`(IVA Incluido)`, centerX, y, { align: 'center' });
  y += 5;

  // Payment Method
  doc.setFontSize(8);
  doc.text(`Pago: ${order.payment_method?.toUpperCase() || 'Efectivo/Bizum'}`, centerX, y, { align: 'center' });
  y += 6;

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
const autoPrintTicket = async (order) => {
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

// Trust proxy (needed for Railway/reverse proxy setups)
app.set('trust proxy', true);

// CORS: valid header values only (Chrome rejects invalid tokens in Allow-Headers)
const CORS_ALLOW_ORIGIN = 'https://hipera-shop.vercel.app';
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, Accept';

app.use((req, res, next) => {
  const raw = (req.headers.origin || '').trim();
  const validOrigin = raw && raw !== 'null' && /^https?:\/\//.test(raw) ? raw : CORS_ALLOW_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', validOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  next();
});

// Initialize Supabase with service role key (server-side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 添加响应头防止CORB
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json());

// Rate limiting: skip OPTIONS + /api/health (keep-alive). Límite alto: proxy/Vercel agrupa IPs.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health',
  validate: { trustProxy: false }
});
app.use('/api/', limiter);

// Authentication middleware
const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Token no enviado. Cierra sesión y vuelve a iniciar sesión en /login' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) {
      console.warn('[Auth] getUser error:', error.message);
      return res.status(401).json({ error: 'Token inválido o expirado. Cierra sesión y vuelve a iniciar sesión' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.warn('[Auth] Exception:', err?.message);
    res.status(401).json({ error: 'Error de autenticación. Intenta cerrar sesión y volver a entrar' });
  }
};

// ========== PUBLIC ROUTES (Frontend) ==========

// Get products (public) - solo productos visibles en tienda
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or('visible.is.null,visible.eq.true')
      .order('id', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get categories (public)
app.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sub categories (public)
app.get('/api/sub-categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sub_categories')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get repair services (public)
app.get('/api/repair-services', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repair_services')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create order (public - but should validate)
app.post('/api/orders', async (req, res) => {
  try {
    const { user_id, address, phone, note, total, status, payment_method, items } = req.body;
    
    // Validate required fields
    if (!address || !phone || !total || !items) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Deduct stock for products (skip services and gift items)
    for (const item of items) {
      if (item.isService) continue;
      if (item.isGift) continue; // 礼品不扣库存，由后台单独管理
      
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;

      const { data: product, error: fetchErr } = await supabase
        .from('products')
        .select('stock')
        .eq('id', item.id)
        .single();
      
      if (fetchErr || !product) {
        console.warn(`[Orders] Product not found: id=${item.id}, name=${item.name}`);
        continue; // 找不到商品时跳过，不阻塞下单
      }
      
      const stock = Number(product.stock);
      if (stock < qty) {
        console.warn(`[Orders] Insufficient stock: id=${item.id}, name=${item.name}, stock=${stock}, requested=${qty}`);
        return res.status(400).json({ error: `Stock insuficiente para "${item.name}". Disponible: ${stock}, solicitado: ${qty}.` });
      }
      const newStock = stock - qty;
      const updatePayload = { stock: newStock };
      if (newStock === 0) updatePayload.visible = false;
      await supabase
        .from('products')
        .update(updatePayload)
        .eq('id', item.id);
    }

    // Create order
    const { data, error } = await supabase
      .from('orders')
      .insert([{
        user_id: user_id || null,
        address,
        phone,
        note,
        total,
        status: status || 'Procesando',
        payment_method: payment_method || 'Pendiente',
        items,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    // 自动打印 ticket（异步执行，不阻塞响应）
    if (process.env.AUTO_PRINT_ENABLED !== 'false') {
      autoPrintTicket(data).catch(err => {
        console.error('Error en auto-impresión:', err);
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get order by ID (public - for QR code lookup)
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      throw error;
    }
    
    if (!data) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user orders (requires auth)
app.get('/api/orders/user/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== ADMIN ROUTES (Protected) ==========

// Get all orders (admin only)
app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update order status (admin only)
app.patch('/api/admin/orders/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all products (admin only) - incluye los no visibles
app.get('/api/admin/products', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product management (admin only)
app.post('/api/admin/products', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    if (payload.stock === 0) payload.visible = false;
    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Category management (admin only)
app.post('/api/admin/categories', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/categories/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sub-category management (admin only)
app.post('/api/admin/sub-categories', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sub_categories')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/sub-categories/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('sub_categories')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Repair service management (admin only). Solo marca, modelo, descripción; el resto se rellena por defecto.
app.post('/api/admin/repair-services', authenticateAdmin, async (req, res) => {
  try {
    const { brand, model, description } = req.body;
    const fallbackTitle = `${brand || ''} ${model || ''}`.trim() || 'Modelo';
    const payload = {
      brand: brand || '',
      model: model || '',
      description: description || 'Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.',
      title: req.body.title != null ? req.body.title : fallbackTitle,
      repair_type: req.body.repair_type != null ? req.body.repair_type : '',
      price: req.body.price != null ? Number(req.body.price) : 0
    };
    const { data, error } = await supabase
      .from('repair_services')
      .insert([payload])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/repair-services/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('repair_services')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/repair-services/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('repair_services')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI: 去背 → 支持 REMOVEBGAPI_KEY (removebgapi.com) 或 REMOVEBG_API_KEY (remove.bg)
app.post('/api/admin/remove-bg', authenticateAdmin, async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url || typeof image_url !== 'string') {
      return res.status(400).json({ error: 'image_url required' });
    }
    const removeBgApiKey = process.env.REMOVEBGAPI_KEY;
    const removeBgKey = process.env.REMOVEBG_API_KEY;
    if (!removeBgApiKey && !removeBgKey) {
      return res.status(503).json({ error: 'REMOVEBGAPI_KEY 或 REMOVEBG_API_KEY 需在 backend/.env 中配置' });
    }

    let imageBuffer;
    try {
      const imgResponse = await fetch(image_url);
      if (!imgResponse.ok) throw new Error('Failed to download image');
      imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
    } catch (e) {
      return res.status(400).json({ error: '无法下载图片: ' + (e.message || image_url) });
    }

    let rb;
    if (removeBgApiKey) {
      const form = new FormData();
      form.append('image_file', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
      form.append('format', 'png');
      form.append('size', 'full');
      rb = await fetch('https://removebgapi.com/api/v1/remove', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${removeBgApiKey}`, ...form.getHeaders() },
        body: form
      });
    } else {
      // remove.bg: usar FormData nativo (Node 18+) con Blob - form-data pkg no funciona bien con fetch
      const NodeFormData = globalThis.FormData;
      const fd = new NodeFormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      fd.append('image_file', blob, 'image.jpg');
      fd.append('size', 'auto');
      fd.append('format', 'png');
      rb = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': removeBgKey },
        body: fd
      });
    }

    if (!rb.ok) {
      const errText = await rb.text();
      let err;
      try { err = JSON.parse(errText); } catch { err = { errors: [{ detail: errText }] }; }
      let msg = err?.errors?.[0]?.detail || err?.errors?.[0]?.title || err?.message || rb.statusText;
      if (typeof msg !== 'string') {
        const e = err?.error;
        msg = (typeof e === 'string' ? e : e?.message) || errText || '去背失败';
      }
      msg = (msg && typeof msg === 'string' ? msg : errText) || '去背失败';
      return res.status(rb.status >= 400 && rb.status < 500 ? 400 : 502).json({ error: msg });
    }

    const buf = Buffer.from(await rb.arrayBuffer());
    const fileName = `removebg-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage.from('products').upload(fileName, buf, { contentType: 'image/png', upsert: false });
    if (upErr) return res.status(500).json({ error: 'Upload failed: ' + upErr.message });

    const { data } = supabase.storage.from('products').getPublicUrl(fileName);
    res.json({ image_url: data.publicUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || 'remove-bg error' });
  }
});

// AI: OpenAI Vision 提取商品信息（重量、数量、配料等）- 支持多张图片
app.post('/api/admin/generate-description', authenticateAdmin, async (req, res) => {
  try {
    const { image_urls, image_url } = req.body; // 支持新格式 image_urls 或旧格式 image_url
    const urls = image_urls || (image_url ? [image_url] : []);
    
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'image_urls (array) required' });
    }
    
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });

    // 构建 content 数组：包含所有图片 + 文本提示
    const content = [
      ...urls.map(url => ({ type: 'image_url', image_url: { url } })),
      {
        type: 'text',
        text: `Analiza ${urls.length > 1 ? 'estas imágenes' : 'esta imagen'} de producto y extrae la siguiente información en formato JSON. Si hay múltiples imágenes, combina la información de todas ellas:

{
  "name": "nombre del producto tal como aparece (ej: Ramen Sabor Pollo, Fideos Instantáneos)",
  "brand": "marca del producto (ej: JML, Nissin) o null si no se ve",
  "weight": "peso en g o ml exactamente como en etiqueta (ej: '109g', '500g', '250ml') o null si no se ve",
  "quantity": "cantidad de unidades/piezas (ej: '2 unidades', '10 piezas') o null si no se ve",
  "ingredients": "lista completa de ingredientes si es visible, o null",
  "description": "descripción breve del producto en español (1-2 frases)",
  "specifications": "otras especificaciones visibles o null"
}

REGLAS:
- Analiza TODAS las imágenes y combina la información
- Solo extrae lo que REALMENTE ves; si no ves algo, usa null
- description siempre debe tener un valor
- name y brand deben ser el nombre y marca exactos del producto
- NO incluyas fecha de caducidad (expiration date / best before) en description, specifications ni en ningún otro campo. Omítela siempre aunque aparezca en la etiqueta.
- Responde SOLO con el JSON, sin texto adicional`
      }
    ];

    const payload = {
      model: 'gpt-4o',
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente que extrae información de productos desde imágenes. Responde SOLO en formato JSON válido.'
        },
        {
          role: 'user',
          content
        }
      ]
    };

    const oa = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!oa.ok) {
      const err = await oa.json().catch(() => ({}));
      const msg = err?.error?.message || oa.statusText;
      return res.status(oa.status >= 400 && oa.status < 500 ? 400 : 502).json({ error: msg || 'OpenAI failed' });
    }

    const data = await oa.json();
    const responseContent = data?.choices?.[0]?.message?.content?.trim() || '{}';
    
    try {
      const productInfo = JSON.parse(responseContent);
      
      // Producto nombre: NAME BRAND 109g (todo mayúsculas salvo peso)
      const namePart = (productInfo.name || '').trim().toUpperCase();
      const brandPart = (productInfo.brand || '').trim().toUpperCase();
      const weightPart = (productInfo.weight || '').trim();
      const productNameParts = [namePart, brandPart].filter(Boolean);
      if (weightPart) productNameParts.push(weightPart);
      const productName = productNameParts.join(' ') || null;

      let formattedDesc = productInfo.description || '';
      const parts = [];
      if (productInfo.weight) parts.push(`Peso: ${productInfo.weight}`);
      if (productInfo.quantity) parts.push(`Cantidad: ${productInfo.quantity}`);
      if (productInfo.specifications) parts.push(productInfo.specifications);
      if (productInfo.ingredients) parts.push(`Ingredientes: ${productInfo.ingredients}`);
      if (parts.length > 0) formattedDesc += '\n\n' + parts.join('\n');
      
      res.json({ 
        description: formattedDesc,
        productInfo: {
          productName,
          weight: productInfo.weight || null,
          quantity: productInfo.quantity || null,
          ingredients: productInfo.ingredients || null,
          specifications: productInfo.specifications || null
        }
      });
    } catch (parseErr) {
      // 如果JSON解析失败，返回原始内容作为description
      res.json({ description: responseContent, productInfo: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message || 'generate-description error' });
  }
});

// AI: 将商品居中到图片中心
app.post('/api/admin/center-product', authenticateAdmin, async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url || typeof image_url !== 'string') {
      return res.status(400).json({ error: 'image_url required' });
    }

    // 下载图片
    const imgResponse = await fetch(image_url);
    if (!imgResponse.ok) {
      return res.status(400).json({ error: 'Failed to download image from URL: ' + image_url });
    }
    const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());

    // 使用 sharp 处理图片，先验证格式
    let image;
    try {
      // 先尝试直接创建 sharp 实例
      image = sharp(imageBuffer);
      // 验证图片格式 - 尝试获取 metadata
      const testMetadata = await image.metadata();
      if (!testMetadata.width || !testMetadata.height) {
        throw new Error('Invalid image dimensions');
      }
    } catch (formatError) {
      console.error('Image format error:', formatError.message, 'Image URL:', image_url);
      // 尝试强制转换为 PNG
      try {
        console.log('Attempting to convert image to PNG format...');
        image = sharp(imageBuffer, { failOnError: false }).png();
        const testMetadata = await image.metadata();
        if (!testMetadata.width || !testMetadata.height) {
          throw new Error('Conversion failed - invalid dimensions');
        }
        console.log('Successfully converted to PNG');
      } catch (convertError) {
        console.error('Conversion also failed:', convertError.message);
        return res.status(400).json({ 
          error: 'Unsupported image format or corrupted image. Please use JPEG, PNG, WebP, or GIF.',
          details: formatError.message,
          conversionError: convertError.message
        });
      }
    }

    const metadata = await image.metadata();
    const { width, height } = metadata;
    
    if (!width || !height) {
      return res.status(400).json({ error: 'Invalid image dimensions' });
    }

    // 确保图片有 alpha 通道并转换为 RGBA 格式
    const processedImage = image.ensureAlpha();
    
    // 获取图片的原始像素数据（RGBA）
    const { data, info } = await processedImage
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // 确保 channels 是正确的（应该是 4 for RGBA）
    const actualChannels = info.channels || 4;
    
    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'Failed to extract image pixel data' });
    }

    // 检测非透明区域的边界框
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasContent = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * actualChannels;
        const alpha = actualChannels >= 4 ? data[idx + 3] : 255; // Alpha 通道（如果存在）
        
        // 如果像素不透明（alpha > 10），认为是内容
        if (alpha > 10) {
          hasContent = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // 如果没有检测到内容，返回原图
    if (!hasContent || minX >= maxX || minY >= maxY) {
      // 如果检测失败，返回原图（转换为 PNG 以确保兼容性）
      const pngBuffer = await image.png().toBuffer();
      const fileName = `centered-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage.from('products').upload(fileName, pngBuffer, { 
        contentType: 'image/png', 
        upsert: false 
      });
      if (upErr) return res.status(500).json({ error: 'Upload failed: ' + upErr.message });
      const { data: urlData } = supabase.storage.from('products').getPublicUrl(fileName);
      return res.json({ image_url: urlData.publicUrl, message: 'No content detected, original image returned' });
    }

    // 计算商品区域
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    
    // 添加一些边距（10%）
    const padding = Math.max(contentWidth, contentHeight) * 0.1;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropWidth = Math.min(width - cropX, maxX - cropX + padding * 2);
    const cropHeight = Math.min(height - cropY, maxY - cropY + padding * 2);

    // 裁剪商品区域（确保使用处理过的图片）
    const cropped = await processedImage
      .extract({ left: Math.floor(cropX), top: Math.floor(cropY), width: Math.floor(cropWidth), height: Math.floor(cropHeight) })
      .png()
      .toBuffer();

    // 创建新画布，将商品居中
    const canvasWidth = width; // 保持原图宽度
    const canvasHeight = height; // 保持原图高度
    
    const centered = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 } // 透明背景
      }
    })
      .composite([{
        input: cropped,
        left: Math.floor((canvasWidth - Math.floor(cropWidth)) / 2),
        top: Math.floor((canvasHeight - Math.floor(cropHeight)) / 2)
      }])
      .png()
      .toBuffer();

    // 上传到 Supabase
    const fileName = `centered-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage.from('products').upload(fileName, centered, { 
      contentType: 'image/png', 
      upsert: false 
    });
    
    if (upErr) return res.status(500).json({ error: 'Upload failed: ' + upErr.message });

    const { data: urlData } = supabase.storage.from('products').getPublicUrl(fileName);
    res.json({ image_url: urlData.publicUrl });
  } catch (e) {
    console.error('center-product error:', e);
    res.status(500).json({ error: e.message || 'center-product error' });
  }
});

// Root route - API information
app.get('/', (req, res) => {
  res.json({
    message: 'HIPERA Backend API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      public: {
        products: 'GET /api/products',
        categories: 'GET /api/categories',
        subCategories: 'GET /api/sub-categories',
        repairServices: 'GET /api/repair-services',
        createOrder: 'POST /api/orders'
      },
      admin: {
        orders: 'GET /api/admin/orders',
        getOrderById: 'GET /api/orders/:orderId (public)',
        updateOrder: 'PATCH /api/admin/orders/:id',
        products: 'POST /api/admin/products, PUT /api/admin/products/:id, DELETE /api/admin/products/:id',
        categories: 'POST /api/admin/categories, DELETE /api/admin/categories/:id',
        repairServices: 'POST /api/admin/repair-services, PUT /api/admin/repair-services/:id, DELETE /api/admin/repair-services/:id',
        removeBg: 'POST /api/admin/remove-bg',
        generateDescription: 'POST /api/admin/generate-description',
        centerProduct: 'POST /api/admin/center-product'
      }
    },
    note: 'All admin endpoints require authentication (Bearer token)'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`📖 API info at http://localhost:${PORT}/`);
});
