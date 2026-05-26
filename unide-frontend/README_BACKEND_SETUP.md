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

# 管理员白名单（必填，否则 /admin 对所有人返回 403）
# 逗号分隔的邮箱列表；大小写不敏感；空格会自动 trim
ADMIN_EMAILS=tu_email@gmail.com,otro_admin@gmail.com

# Resend 邮件服务（生产环境必填，否则下单时不会发确认邮件）
# 1. 在 https://resend.com 注册并完成域名验证（见下方 DNS 配置）
# 2. https://resend.com/api-keys 创建 API Key
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
# 发件人地址（必须使用已验证域名）
RESEND_FROM_EMAIL=HIPERA <pedidos@hipera.es>
# 回复地址（可选；默认与 RESEND_FROM_EMAIL 相同）
RESEND_REPLY_TO=info@hipera.es
```

**重要提示：**
- `SUPABASE_SERVICE_KEY` 需要从 Supabase Dashboard → Settings → API 获取
- 使用 **service_role** 密钥（不是 anon 密钥）
- 这个密钥有完整数据库访问权限，**绝对不能**暴露在前端代码中
- `ADMIN_EMAILS` 是 **强制变量**：
  - 没设置 → 任何账号访问 `/api/admin/*` 或 `/admin` 都会被拒绝（403），
    后端启动时会打印警告
  - 仅这些邮箱对应的 Supabase 用户可以进入后台
  - 普通客户注册账号后**不会**获得 admin 权限
  - 修改后必须重启后端服务器才能生效
- `RESEND_API_KEY` + `RESEND_FROM_EMAIL`：
  - 没设置 → 下单不会失败，但**不会发**确认邮件，后端启动时会打印警告
  - 发件域名必须先在 Resend 控制台验证（见下方"Resend 域名验证"）
  - 仅适用于**事务性邮件**（订单确认），不用于营销推送

### 1.3 数据库迁移

下面的 SQL 迁移文件需要**手动**在 Supabase → SQL Editor 中执行
（按文件名升序执行；已执行过的可跳过）：

```text
supabase_migration_visible.sql
supabase_migration_sort_order.sql
supabase_migration_user_terms_acceptances.sql
supabase_migration_user_consents.sql
supabase_migration_user_consents_view_security.sql
supabase_migration_orders_customer_email.sql       ← 订单邮件确认
supabase_migration_orders_delivery_method.sql      ← 新增（到店自取）
```

`orders_customer_email` 添加 `customer_email` 列（nullable）用于：
- 后端把客户邮箱保存到订单
- 之后从 admin 重新触发邮件
- 售后支持时按邮箱查订单

`orders_delivery_method` 添加 `delivery_method` 列：
- 取值：`home_delivery`（默认，宅配）/ `store_pickup`（到店自取）
- CHECK 约束保证不会写入未知值
- 历史订单自动获得 `home_delivery`，不影响读取
- 后端 `POST /api/orders` 已接受该字段；前端 checkout 已有 UI 选择器
- 邮件模板会按值切换"送货地址"vs"到店自取地址"

### 1.4 Resend 域名验证（生产环境必做）

要让 `pedidos@hipera.es` 这种地址能发邮件，必须在 Cloudflare DNS 上
为 `hipera.es` 配置 SPF + DKIM + MX，并在 Resend 控制台验证通过。

**步骤：**

1. 进 https://resend.com → 注册免费账号（每月 3000 封）
2. 左侧 **Domains** → **Add Domain** → 输入 `hipera.es`
3. Resend 给出一组 DNS 记录（一般 4 条：1× MX、1× SPF TXT、1× DKIM TXT、1× DMARC TXT）
4. 进 Cloudflare → 选 `hipera.es` 域 → **DNS → Records** → 逐条 **Add record**：
   - Type: `MX` / `TXT` 按 Resend 提示填
   - Name: 严格按 Resend 给的（注意是 `send` 子域还是根域）
   - Content / Priority: 复制粘贴
   - **Proxy status: DNS only**（**不要打开** Cloudflare 橙云，否则 SPF/DKIM 失效）
   - TTL: Auto
5. 全部加完后回 Resend → **Verify**（通常几分钟内完成；最长 24h）
6. 状态变 ✅ 后，去 **API Keys** → **Create API Key**（权限选 *Sending access* 即可）
7. 把 key 填到 Railway 的 `RESEND_API_KEY`，把 `pedidos@hipera.es`
   填到 `RESEND_FROM_EMAIL`，**重启**后端服务

**常见坑：**
- Cloudflare 默认会代理（橙云） → 必须切到 **DNS only**（灰云）
- `hipera.es` 如果已经在 Cloudflare 注册商处买的，DNS 区可能要等域名状态从 Pending → Active
- Resend free plan 限制每月 3000 封 + 单收件人 100 封/天，够你们这种小店用
- 测试期可以先用 Resend 提供的 `onboarding@resend.dev` 作为 from（仅能发到注册时的邮箱），但生产必须用自己域名

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

前端部署在 **https://hipera.es**（或 alias 技术域名 `https://hipera-shop.vercel.app`）时，**不要** 使用 `http://localhost:3001` 作为 API 地址。浏览器会拦截公网页面对本机地址的请求（Private Network Access / loopback 限制），导致：

- `Access to fetch at 'http://localhost:3001/api/...' has been blocked by CORS policy: Permission was denied for this request to access the loopback address space`
- `Failed to load resource: net::ERR_FAILED`

**正确做法**：先把后端部署到公网，再让 Vercel 前端请求该公网 API。

### 1. 先部署后端

推荐使用 **Railway** 或 **Render**（Vercel 适合前端，Node 后端更推荐上述平台）：

**Railway**
1. [railway.app](https://railway.app) 注册并连接 GitHub
2. New Project → Deploy from GitHub → 选本仓库，**Root Directory** 设为 `backend`
3. 在 Project → Variables 添加（**所有变量缺一不可**）：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `FRONTEND_URL=https://hipera.es`（生产域名；构建链接的 URL 都基于这个）
   - `ADMIN_EMAILS=tu_email@gmail.com`（逗号分隔多个；**没配置就没人能登 /admin**）
   - `RESEND_API_KEY=re_xxxxxxxxxxxx`（域名验证完后从 Resend 控制台拿）
   - `RESEND_FROM_EMAIL=HIPERA <pedidos@hipera.es>`（必须是已在 Resend 验证的域）
   - `RESEND_REPLY_TO=info@hipera.es`（可选，默认与 FROM 相同）
4. 部署完成后记下 **公网 URL**，如 `https://xxx.up.railway.app`
5. API 基地址为：`https://xxx.up.railway.app`（若未挂子路径）或 `https://xxx.up.railway.app/api`（若挂在 `/api`，依你配置为准）

**Render**
1. [render.com](https://render.com) 创建 Web Service，连接 GitHub，选择 **backend** 目录
2. Build: `npm install`，Start: `npm start`
3. 环境变量同上；记下生成的 **HTTPS 地址**

后端已配置 CORS，允许 `https://hipera.es`（canonical）、`https://hipera-shop.vercel.app`（alias 技术域名）和 `http://localhost:5173`。

### 2. 再部署前端（Vercel）

1. 在 Vercel 项目 **Settings → Environment Variables** 添加：
   - `VITE_API_URL` = **后端公网 API 地址**，例如 `https://xxx.up.railway.app/api`（与 `client.js` 中使用的路径一致，通常为 `/api`）
2. **重新构建并部署**（环境变量修改后需触发新部署）
3. 确保前端构建时能读到 `VITE_API_URL`，否则会回退到 `http://localhost:3001/api`，线上会报错

### 3. 小结

| 环境 | 前端地址 | VITE_API_URL | 后端 CORS |
|------|----------|--------------|-----------|
| 本地开发 | http://localhost:5173 | http://localhost:3001/api | ✅ 已允许 |
| 生产 (canonical) | https://hipera.es | **必须是** 已部署后端的 HTTPS 地址，如 `https://xxx.up.railway.app/api` | ✅ 已允许 |
| 生产 (alias Vercel) | https://hipera-shop.vercel.app | 同上 | ✅ 已允许 |

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

### `/admin` 提示 "Acceso restringido" 或 API 返回 403
- 后端的 `ADMIN_EMAILS` 是否包含你登录用的邮箱？（区分逗号分隔，大小写不敏感）
- 修改 Railway/服务器的环境变量后**必须重启服务**（Railway: Deployments → Restart）
- 检查后端启动日志是否有 `[Auth] ⚠️ ADMIN_EMAILS no está configurada` 警告
- `GET /api/me` 可以快速验证：用浏览器开发者工具 Network 面板查看返回的 `isAdmin` 字段

### 下单后客户没收到确认邮件
- 后端启动日志有没有 `[Email] ⚠️ RESEND_API_KEY no configurada` 警告？
  - 有 → Railway 没配 `RESEND_API_KEY`
- 后端日志里有 `[Email] Resend error: ...` 吗？
  - `domain not verified` → 去 Resend 控制台 **Domains** 看 `hipera.es` 状态
  - `from address must use verified domain` → `RESEND_FROM_EMAIL` 的域名不在已验证列表里
  - `rate limit` → 单收件人每天上限 100 封（免费层）
- 域名验证状态确认：
  - Resend Dashboard → Domains → `hipera.es` 应显示 ✅
  - 检查 Cloudflare DNS 里 SPF/DKIM 记录的 **Proxy status** 必须是 **DNS only**（灰云），
    不能是橙云
- 测试期想跳过域名验证 → 临时用 `RESEND_FROM_EMAIL=onboarding@resend.dev`，
  但只能发给 Resend 注册时的邮箱（生产必须换回 `pedidos@hipera.es`）
- 客户邮箱写错了？查 Supabase `orders.customer_email` 字段确认
