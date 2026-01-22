import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { Blob } from 'buffer';
import sharp from 'sharp';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy (needed for Railway/reverse proxy setups)
app.set('trust proxy', true);

// Initialize Supabase with service role key (server-side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS: 允许本地开发 + Vercel 生产前端
const allowedOrigins = [
  'http://localhost:5173',
  'https://hipera-shop.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

// 处理 OPTIONS 预检请求
app.options('*', cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 添加响应头防止CORB
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  // 禁用 trust proxy 警告（在 Railway 等反向代理环境中，trust proxy 是必要的）
  validate: {
    trustProxy: false
  }
});
app.use('/api/', limiter);

// Authentication middleware
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if user is admin (you can add role check here)
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// ========== PUBLIC ROUTES (Frontend) ==========

// Get products (public)
app.get('/api/products', async (req, res) => {
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

    // Deduct stock for products
    for (const item of items) {
      if (item.isService) continue;
      
      const { data: product } = await supabase
        .from('products')
        .select('stock')
        .eq('id', item.id)
        .single();
      
      if (product && product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${item.name}` });
      }
      
      if (product) {
        await supabase
          .from('products')
          .update({ stock: product.stock - item.quantity })
          .eq('id', item.id);
      }
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
    const { data, error } = await supabase
      .from('products')
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

// Repair service management (admin only)
app.post('/api/admin/repair-services', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repair_services')
      .insert([req.body])
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

// AI: remove.bg 去背 → 上传 Supabase，返回新图 URL
app.post('/api/admin/remove-bg', authenticateAdmin, async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url || typeof image_url !== 'string') {
      return res.status(400).json({ error: 'image_url required' });
    }
    const key = process.env.REMOVEBG_API_KEY;
    if (!key) return res.status(503).json({ error: 'REMOVEBG_API_KEY not configured' });

    // 先尝试直接使用 image_url（Supabase 公开 URL 应该可以直接访问）
    let formData = new FormData();
    formData.append('image_url', image_url);
    formData.append('size', 'auto');
    formData.append('format', 'png');

    let rb = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': key },
      body: formData
    });

    // 如果 URL 方式失败，尝试下载后上传文件
    if (!rb.ok) {
      const errText = await rb.text();
      let err;
      try {
        err = JSON.parse(errText);
      } catch {
        err = { errors: [{ detail: errText }] };
      }
      
      // 如果是 URL 访问问题，尝试下载后上传文件
      if (err?.errors?.[0]?.detail?.includes('image_url') || err?.errors?.[0]?.detail?.includes('Please provide') || rb.status === 400) {
        console.log('Trying file upload method instead of URL...');
        
        const imgResponse = await fetch(image_url);
        if (!imgResponse.ok) {
          return res.status(400).json({ error: 'Failed to download image from URL: ' + image_url });
        }
        const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
        
        // 使用原生 FormData 和 Blob（Node.js 18+ 支持）
        const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
        const blob = new Blob([imageBuffer], { type: contentType });
        
        formData = new FormData();
        formData.append('image_file', blob, 'image.jpg');
        formData.append('size', 'auto');
        formData.append('format', 'png');

        rb = await fetch('https://api.remove.bg/v1.0/removebg', {
          method: 'POST',
          headers: { 'X-Api-Key': key },
          body: formData
        });
      }
    }

    if (!rb.ok) {
      const errText = await rb.text();
      let err;
      try {
        err = JSON.parse(errText);
      } catch {
        err = { errors: [{ detail: errText || rb.statusText }] };
      }
      const msg = err?.errors?.[0]?.detail || err?.errors?.[0]?.title || err?.error || rb.statusText;
      console.error('remove.bg error:', { 
        status: rb.status, 
        error: err, 
        errorDetails: JSON.stringify(err, null, 2),
        imageUrl: image_url 
      });
      return res.status(rb.status >= 400 && rb.status < 500 ? 400 : 502).json({ 
        error: msg || 'remove.bg failed',
        details: err?.errors?.[0] 
      });
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
  "weight": "peso en g o ml (ej: '500g', '250ml', '1kg') o null si no se ve en ninguna imagen",
  "quantity": "cantidad de unidades/piezas (ej: '2 unidades', '10 piezas', '1 unidad') o null si no se ve",
  "ingredients": "lista completa de ingredientes o composición si es visible en alguna etiqueta, o null",
  "description": "descripción breve del producto en español (1-2 frases)",
  "specifications": "otras especificaciones visibles (tamaño, capacidad, etc.) o null"
}

REGLAS IMPORTANTES:
- Analiza TODAS las imágenes proporcionadas y combina la información
- Si una imagen muestra el frente y otra el dorso/etiqueta, extrae información de ambas
- Solo extrae información que REALMENTE puedas ver en las imágenes/etiquetas
- Si no ves peso, cantidad o ingredientes en ninguna imagen, usa null (no inventes)
- description siempre debe tener un valor (breve descripción del producto)
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
      
      // 格式化信息为易读的文本描述
      let formattedDesc = productInfo.description || '';
      const parts = [];
      
      if (productInfo.weight) parts.push(`Peso: ${productInfo.weight}`);
      if (productInfo.quantity) parts.push(`Cantidad: ${productInfo.quantity}`);
      if (productInfo.specifications) parts.push(productInfo.specifications);
      if (productInfo.ingredients) parts.push(`Ingredientes: ${productInfo.ingredients}`);
      
      if (parts.length > 0) {
        formattedDesc += '\n\n' + parts.join('\n');
      }
      
      res.json({ 
        description: formattedDesc,
        productInfo: {
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
