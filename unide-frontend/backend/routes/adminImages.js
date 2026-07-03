// =====================================================================
// Herramientas de imagen del panel (admin): quitar fondo, generar
// descripción con IA y centrar el producto en el lienzo.
// =====================================================================
import { Router } from 'express';
import FormData from 'form-data';
import { Blob } from 'buffer';
import sharp from 'sharp';
import { supabase } from '../lib/supabase.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = Router();

// AI: 去背 → 支持 REMOVEBGAPI_KEY (removebgapi.com) 或 REMOVEBG_API_KEY (remove.bg)
router.post('/api/admin/remove-bg', authenticateAdmin, async (req, res) => {
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
router.post('/api/admin/generate-description', authenticateAdmin, async (req, res) => {
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
    } catch (_parseErr) {
      // 如果JSON解析失败，返回原始内容作为description
      res.json({ description: responseContent, productInfo: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message || 'generate-description error' });
  }
});

// AI: 将商品居中到图片中心
router.post('/api/admin/center-product', authenticateAdmin, async (req, res) => {
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

export default router;
