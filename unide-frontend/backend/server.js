import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import FormData from 'form-data';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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
  res.header('Content-Type', 'application/json');
  res.header('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
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

    const form = new FormData();
    form.append('image_url', image_url);
    form.append('size', 'auto');
    form.append('format', 'png');

    const rb = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': key, ...form.getHeaders() },
      body: form
    });

    if (!rb.ok) {
      const err = await rb.json().catch(() => ({}));
      const msg = err?.errors?.[0]?.detail || err?.errors?.[0]?.title || rb.statusText;
      return res.status(rb.status >= 400 && rb.status < 500 ? 400 : 502).json({ error: msg || 'remove.bg failed' });
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
        generateDescription: 'POST /api/admin/generate-description'
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
