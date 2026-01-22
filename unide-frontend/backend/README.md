# HIPERA Backend API

Backend API server for HIPERA e-commerce platform.

## 🚀 Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the `backend` directory:

```env
# Supabase Configuration
SUPABASE_URL=https://yscoewxnmsfpebfwwios.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here

# Server Configuration
PORT=3001
NODE_ENV=production

# CORS Configuration
FRONTEND_URL=http://localhost:5173

# AI features (optional)
REMOVEBG_API_KEY=your_remove_bg_api_key
OPENAI_API_KEY=your_openai_api_key
```

**Important:** 
- Get your `SUPABASE_SERVICE_KEY` from Supabase Dashboard → Settings → API
- Use the **service_role** key (not the anon key) for server-side operations
- Never commit the `.env` file to git

### 3. Run the Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will run on `http://localhost:3001`

## 📡 API Endpoints

### Public Endpoints

- `GET /api/products` - Get all products
- `GET /api/categories` - Get all categories
- `GET /api/sub-categories` - Get all sub-categories
- `GET /api/repair-services` - Get all repair services
- `POST /api/orders` - Create a new order
- `GET /api/orders/user/:userId` - Get user orders (requires auth)

### Admin Endpoints (Require Authentication)

- `GET /api/admin/orders` - Get all orders
- `PATCH /api/admin/orders/:id` - Update order status
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `DELETE /api/admin/products/:id` - Delete product
- `POST /api/admin/categories` - Create category
- `DELETE /api/admin/categories/:id` - Delete category
- `POST /api/admin/sub-categories` - Create sub-category
- `DELETE /api/admin/sub-categories/:id` - Delete sub-category
- `POST /api/admin/repair-services` - Create repair service
- `PUT /api/admin/repair-services/:id` - Update repair service
- `DELETE /api/admin/repair-services/:id` - Delete repair service
- `POST /api/admin/remove-bg` - Remove image background (remove.bg), body: `{ image_url }`
- `POST /api/admin/generate-description` - Extract product information (weight, quantity, ingredients, etc.) from images (OpenAI), body: `{ image_urls: [url1, url2, ...] }` or `{ image_url: url }` (legacy), returns: `{ description, productInfo: { weight, quantity, ingredients, specifications } }`

## 🤖 AI Features

When `REMOVEBG_API_KEY` and `OPENAI_API_KEY` are set, the admin panel can:
- **Quitar fondo (AI)**: Remove background from product image via remove.bg, then upload result to Supabase.
- **Extraer información (AI)**: Extract structured product information (weight, quantity, ingredients, specifications) from images using OpenAI GPT-4o. **Supports multiple images** - upload front, back, and label photos to extract complete information.

### OpenAI Vision 能力说明

**✅ 可以提取的信息：**
- **Peso (重量)**: 如 "500g"、"250ml"、"1kg" 等（从标签识别）
- **Cantidad (数量)**: 如 "2 unidades"、"10 piezas" 等（从标签识别）
- **Ingredientes (配料表)**: 如果标签上有显示配料/成分列表
- **Especificaciones (规格)**: 尺寸、容量等其他可见的规格信息
- **Descripción (描述)**: 商品的基本描述

**智能填充：**
- 提取的信息会格式化后填入 "Descripción" 字段
- 如果识别到数量信息，会自动尝试更新 "Stock" 字段（仅当stock为空或默认值时）

**❌ 无法做到：**
- **精确测量物理尺寸或重量**（只能识别标签上的数字，不能测量实物）
- 如果图片中没有显示重量/数量标签，模型**不会编造**这些信息（返回 null）
- 无法识别商品的实际重量（只能看包装上的标注）

**💡 最佳实践：**
- **多图上传**：可以上传多张图片（正面、背面、标签等），AI 会综合分析所有图片提取完整信息
- 上传**包含产品标签/包装**的图片，这样 AI 更容易提取规格信息
- 如果图片质量差或标签不清晰，AI 可能无法识别
- 提取信息后，建议人工检查并补充缺失的规格信息
- 如果识别到数量，检查 Stock 字段是否正确更新

**多图功能：**
- 支持一次选择多张图片上传（按住 Ctrl/Cmd 选择多张）
- 第一张图片作为主图（显示 "Principal" 标签）
- 可以删除单张图片（hover 显示删除按钮）
- AI 提取信息时会分析所有上传的图片，合并信息

## 🔐 Authentication

Admin endpoints require authentication. Include the Supabase JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## 🛡️ Security Features

- Rate limiting (100 requests per 15 minutes per IP)
- CORS protection
- Authentication middleware for admin routes
- Environment variable protection
- Service role key only on server-side

## 📦 Deployment

### Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Deploy: `vercel`
3. Set environment variables in Vercel dashboard

### Other Platforms

The server is a standard Express.js application and can be deployed to:
- Railway
- Render
- Heroku
- DigitalOcean
- AWS
- Any Node.js hosting platform
