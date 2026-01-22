# 前后端分离设置指南

## 📋 概述

为了提升网站安全性，我们已经将前后端代码分离：

- **前端**: React应用，只负责UI展示和用户交互
- **后端**: Node.js/Express API服务器，处理所有数据库操作和业务逻辑

## 🔧 设置步骤

### 1. 后端设置

#### 1.1 安装后端依赖

```bash
cd backend
npm install
```

#### 1.2 配置环境变量

在 `backend` 目录创建 `.env` 文件：

```env
# Supabase配置
SUPABASE_URL=https://yscoewxnmsfpebfwwios.supabase.co
SUPABASE_SERVICE_KEY=你的service_role密钥

# 服务器配置
PORT=3001
NODE_ENV=production

# CORS配置
FRONTEND_URL=http://localhost:5173
```

**重要提示：**
- `SUPABASE_SERVICE_KEY` 需要从 Supabase Dashboard → Settings → API 获取
- 使用 **service_role** 密钥（不是 anon 密钥）
- 这个密钥有完整数据库访问权限，**绝对不能**暴露在前端代码中

#### 1.3 启动后端服务器

```bash
cd backend
npm run dev  # 开发模式
# 或
npm start    # 生产模式
```

后端服务器将在 `http://localhost:3001` 运行

### 2. 前端设置

#### 2.1 配置API地址

在项目根目录创建 `.env` 文件（如果还没有）：

```env
VITE_API_URL=http://localhost:3001/api
```

生产环境时，改为你的后端服务器地址：
```env
VITE_API_URL=https://your-backend-domain.com/api
```

#### 2.2 更新前端代码

前端代码已经更新为使用API客户端，但需要确保：

1. 前端仍然使用 Supabase Auth 进行用户认证（这是安全的，因为只使用 anon key）
2. 所有数据库操作都通过后端API进行
3. 前端不再直接访问 Supabase 数据库

### 3. 安全改进

#### ✅ 已实现的安全措施：

1. **密钥保护**: Supabase service_role 密钥只在后端使用
2. **认证中间件**: 所有管理操作都需要JWT token验证
3. **速率限制**: 防止API滥用（15分钟内100次请求）
4. **CORS保护**: 只允许指定域名访问
5. **输入验证**: 后端验证所有输入数据

#### ⚠️ 需要手动完成：

1. **更新 Supabase RLS 策略**: 
   - 前端用户只能读取公开数据（products, categories等）
   - 所有写操作必须通过后端API

2. **环境变量保护**:
   - 确保 `.env` 文件在 `.gitignore` 中
   - 生产环境使用平台的环境变量配置

3. **HTTPS**: 
   - 生产环境必须使用HTTPS
   - Vercel等平台自动提供

## 📁 项目结构

```
项目根目录/
├── backend/              # 后端API服务器
│   ├── server.js        # Express服务器
│   ├── package.json     # 后端依赖
│   ├── .env            # 环境变量（不提交到git）
│   └── README.md       # 后端文档
├── src/                 # 前端React应用
│   ├── api/
│   │   └── client.js   # API客户端
│   ├── App.jsx         # 前端主应用
│   ├── Admin.jsx       # 管理界面（使用API）
│   └── ...
└── package.json         # 前端依赖
```

## 🚀 部署

### ⚠️ 重要：Vercel 前端不能请求 localhost

前端部署在 **https://hipera-shop.vercel.app** 时，**不要** 使用 `http://localhost:3001` 作为 API 地址。浏览器会拦截公网页面对本机地址的请求（Private Network Access / loopback 限制），导致：

- `Access to fetch at 'http://localhost:3001/api/...' has been blocked by CORS policy: Permission was denied for this request to access the loopback address space`
- `Failed to load resource: net::ERR_FAILED`

**正确做法**：先把后端部署到公网，再让 Vercel 前端请求该公网 API。

### 1. 先部署后端

推荐使用 **Railway** 或 **Render**（Vercel 适合前端，Node 后端更推荐上述平台）：

**Railway**
1. [railway.app](https://railway.app) 注册并连接 GitHub
2. New Project → Deploy from GitHub → 选本仓库，**Root Directory** 设为 `backend`
3. 在 Project → Variables 添加：`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`FRONTEND_URL=https://hipera-shop.vercel.app`
4. 部署完成后记下 **公网 URL**，如 `https://xxx.up.railway.app`
5. API 基地址为：`https://xxx.up.railway.app`（若未挂子路径）或 `https://xxx.up.railway.app/api`（若挂在 `/api`，依你配置为准）

**Render**
1. [render.com](https://render.com) 创建 Web Service，连接 GitHub，选择 **backend** 目录
2. Build: `npm install`，Start: `npm start`
3. 环境变量同上；记下生成的 **HTTPS 地址**

后端已配置 CORS，允许 `https://hipera-shop.vercel.app` 和 `http://localhost:5173`。

### 2. 再部署前端（Vercel）

1. 在 Vercel 项目 **Settings → Environment Variables** 添加：
   - `VITE_API_URL` = **后端公网 API 地址**，例如 `https://xxx.up.railway.app/api`（与 `client.js` 中使用的路径一致，通常为 `/api`）
2. **重新构建并部署**（环境变量修改后需触发新部署）
3. 确保前端构建时能读到 `VITE_API_URL`，否则会回退到 `http://localhost:3001/api`，线上会报错

### 3. 小结

| 环境 | 前端地址 | VITE_API_URL | 后端 CORS |
|------|----------|--------------|-----------|
| 本地开发 | http://localhost:5173 | http://localhost:3001/api | ✅ 已允许 |
| 生产 (Vercel) | https://hipera-shop.vercel.app | **必须是** 已部署后端的 HTTPS 地址，如 `https://xxx.up.railway.app/api` | ✅ 已允许 |

## 🔍 测试

### 测试后端API

```bash
# 健康检查
curl http://localhost:3001/api/health

# 获取产品（公开）
curl http://localhost:3001/api/products

# 创建订单（需要数据）
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{"address":"test","phone":"123","total":10,"items":[]}'
```

### 测试前端

1. 启动后端：`cd backend && npm run dev`
2. 启动前端：`npm run dev`
3. 访问 `http://localhost:5173`

## ⚠️ 注意事项

1. **不要在前端代码中暴露 service_role 密钥**
2. **确保后端API地址正确配置**
3. **生产环境使用HTTPS**
4. **定期更新依赖包**
5. **监控API使用情况**

## 🆘 故障排除

### 后端无法启动
- 检查 `.env` 文件是否存在且配置正确
- 确认端口3001未被占用
- 检查依赖是否安装完整

### 前端无法连接后端
- 检查 `VITE_API_URL` 环境变量（**生产环境必须是后端公网地址**，不能用 localhost）
- 确认后端服务器正在运行
- 检查CORS配置

### Vercel 上出现 "blocked by CORS / loopback address space"
- 前端在请求 `localhost` → 必须改为已部署后端的 HTTPS 地址
- 在 Vercel 配置 `VITE_API_URL` 后需 **重新部署** 前端，否则构建仍用旧值

### 认证失败
- 确认JWT token有效
- 检查token是否在请求头中正确传递
- 验证Supabase用户认证状态
