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
