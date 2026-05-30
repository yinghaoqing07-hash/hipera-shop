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

# Cloudflare Turnstile（反机器人，强烈推荐生产配置）
# 1. 进 https://dash.cloudflare.com → Turnstile → Add site
# 2. Widget Mode: Invisible（前端组件 TurnstileGate 用 invisible）
# 3. Domain: hipera.es（开发可加 localhost）
# 4. 复制 Secret Key 填这里
# 没设置时 POST /api/orders 不校验 token（仅适合本地开发；生产留空 = 反机器人失效）
# 测试 secret（永远通过，仅 dev/CI 使用）：1x0000000000000000000000000000000AA
TURNSTILE_SECRET_KEY=0x4AAAAAAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Stripe（信用卡 / Bizum / Apple Pay / Google Pay）
# 私钥只放这里（Railway），绝不进代码 / GitHub / 聊天记录。
# 测试阶段用 test key（sk_test_...），跑通后再换 live key（sk_live_...）。
# 1. https://dashboard.stripe.com → 右上角切到「测试模式」
# 2. Developers → API keys → 复制 Secret key（sk_test_...）
STRIPE_SECRET_KEY=<填你的-stripe-test-secret-key>
# Webhook 签名密钥（Developers → Webhooks → 你的端点 → Signing secret）
# 没配 = webhook 全部 503，付款无法确认。
STRIPE_WEBHOOK_SECRET=<填你的-stripe-webhook-signing-secret>
# 付款成功 / 取消后跳转回的前端地址（默认 https://hipera.es）
FRONTEND_URL=https://hipera.es

# 自动打印代理令牌（店里电脑的打印小程序用它鉴权）
# 自己生成一个长随机串（如 openssl rand -hex 24 或随便敲一长串）。
# 没配 = 打印接口 /api/print/* 全部返回 503（打印功能关闭，其它不受影响）。
# 这个令牌要同时填到：Railway（这里）+ 店里电脑的打印代理 .env。
PRINT_AGENT_TOKEN=pon_aqui_un_secreto_largo_y_aleatorio
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
- `TURNSTILE_SECRET_KEY`：
  - 没设置 → 后端**跳过** Turnstile 校验（POST /api/orders 不拒绝缺少 token 的请求）
  - 设置后 → 没带 token / token 无效都会返回 403 `TURNSTILE_FAILED`
  - 前端对应变量：`VITE_TURNSTILE_SITE_KEY`（编译时注入，部署到 Vercel 也要配）
  - **必须同时配前后端**：只配前端会发 token 但后端不校验；只配后端会拒绝所有请求
  - Domain 限制要包含 `hipera.es`，本地开发可加 `localhost`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`：
  - 都没设置 → 后端启动正常，但「信用卡」入口返回 503 `STRIPE_DISABLED`，
    webhook 返回 503；其他付款方式（现金 / 货到付款 / 手动 Bizum）不受影响
  - **两条都要配**：只配 `STRIPE_SECRET_KEY` 能创建付款页，但 webhook 收不到
    签名密钥 → 付款无法确认（订单卡在「Esperando pago」）
  - 测试用 `sk_test_...` + 对应测试模式的 `whsec_...`；上线换 `sk_live_...` +
    live 模式的 `whsec_...`（test / live 的 webhook secret 不通用）
  - 私钥**只**放 Railway 环境变量，绝不进代码 / GitHub
- Stripe Webhook 设置（Stripe Dashboard → Developers → Webhooks → Add endpoint）：
  - Endpoint URL：`https://hipera-shop-production.up.railway.app/api/stripe/webhook`
    （直接指向 Railway，不要走 hipera.es，避免 Vercel 代理改动请求体导致验签失败）
  - 监听事件：`checkout.session.completed`、`checkout.session.expired` 和 `charge.refunded`
    - `charge.refunded`：在 Stripe 后台对一笔订单**全额退款**时触发 → 后端自动把订单状态改成 `Cancelado` 并把库存加回（幂等，重复事件不会重复加库存）。**部分退款不自动处理**（系统无法判断退了哪些商品），需手动。
    - ⚠️ 如果你的 webhook 端点是在加这个功能之前建的，记得去 Stripe → Developers → Webhooks → 你的端点 → 编辑事件，**补勾 `charge.refunded`**，否则退款不会自动善后。
  - 创建后复制「Signing secret」（`whsec_...`）填到 `STRIPE_WEBHOOK_SECRET`
  - 结账页实际显示的付款方式由代码写死 `payment_method_types: ['card', 'bizum']`（`card` 自动含 Apple/Google Pay）；Stripe 后台 Payment methods 里多开的其他方式不会显示
- `FRONTEND_URL`：付款成功 / 取消后跳回的前端地址；没配默认 `https://hipera.es`

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
supabase_migration_orders_delivery_method.sql      ← 到店自取
supabase_migration_orders_stripe.sql               ← Stripe 付款
supabase_migration_orders_printed.sql              ← 新增（自动打印小票）
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

`orders_stripe` 添加 Stripe 付款相关列：
- `stripe_session_id`：Checkout 会话 ID（创建付款页时写入，用于对账 / 去重）
- `stripe_payment_intent`：实际扣款的 PaymentIntent（webhook 确认时写入，是
  「Stripe 付款」区别于「手动 Bizum」的凭据）
- `confirmed_at`：订单「变为可处理」的时刻（**新订单提醒按它响铃**）
  - 现金 / 货到付款 / 手动 Bizum：= `created_at`（下单即响，行为不变）
  - Stripe：下单时为 NULL（不响），webhook 确认扣款后置为当前时间（才响）
  - 没有这一列的话，按 `created_at` 过滤会导致：被遗弃的 Stripe 结账误响铃，
    或真实付款的提醒丢失（webhook 晚 1-2 分钟到，`created_at` 已超出轮询窗口）
- 引入的新状态 `Esperando pago`：Stripe 会话已建、尚未确认付款；webhook
  `expired` 会把它转成 `Cancelado`；不计入按手机号的反恶意下单限制

`orders_printed` 添加 `printed_at` 列（自动打印小票用）：
- 店里打印代理只打 `confirmed_at` 非空**且** `printed_at` 为空的订单
- **迁移里会把所有历史订单回填为已打印**（`printed_at = now()`），否则代理
  首次启动会把整个历史订单全打出来；上线后只打新确认的单
- 防重复：打印成功后通过 `POST /api/print/mark` 标记，之后不再出现在队列里

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
3. **速率限制**: 防止API滥用（全局 15 分钟 500 次；下单 1h/5 + 24h/12）
4. **CORS保护**: 只允许指定域名访问
5. **输入验证**: 后端验证所有输入数据
6. **反恶意下单**（2026-05-27）：四层防御，见下节

#### 🛡 反恶意下单（POST /api/orders）

为应对"恶意刷单 + 不来取/不付款"场景（contra_reembolso / store_pickup
没有预付保障），后端按这个顺序拒绝可疑请求：

| 顺序 | 机制 | 触发条件 | 返回码 | error.code |
|---|---|---|---|---|
| 0 | **Cloudflare Turnstile** | token 缺失 / 无效 / 域名不匹配 | 403 | `TURNSTILE_FAILED` |
| 1 | **IP 限流（小时）** | 同 IP 1h 内 > 5 次下单 | 429 | `RATE_LIMIT_HOURLY` |
| 2 | **IP 限流（日）** | 同 IP 24h 内 > 12 次下单 | 429 | `RATE_LIMIT_DAILY` |
| 3 | **强制登录** | 选 `contra_reembolso` 或 `store_pickup` 但没带 `Authorization: Bearer <jwt>` | 401 | `AUTH_REQUIRED` |
| 4 | **强制登录（token 过期）** | 同上但 Supabase 拒绝 token | 401 | `AUTH_INVALID` |
| 5 | **同手机限流** | 同 `phone` 在 24h 内已有 ≥2 个 `Procesando`/`Pendiente de Pago` 订单 | 429 | `PHONE_PENDING_LIMIT` |

设计取舍：

- **Bizum 始终允许匿名下单**：Bizum 需要客户主动转账才算下单完成，
  恶意刷单者拿不到任何价值 → 自动过滤大部分滥用。
- **Turnstile 是可选的**：没配 `TURNSTILE_SECRET_KEY` 时这一层会跳过
  （后端启动日志会有 `[anti-abuse] turnstile disabled`，找不到的话
  搜 `verifyTurnstileToken`）。本地开发可以不配；生产强烈建议配。
- **限流单位是 IP**：`app.set('trust proxy', true)` 已经打开，所以
  `req.ip` 是真实客户端 IP（不是 Railway proxy）。
- **手机号限流容错**：Supabase 查询失败时**不阻止**下单（避免 DB 抖动
  导致拒绝合法订单），但会打 warning 留痕。
- **未实现的下一层**：人脸识别 / 银行卡预授权 / 电子身份证。这些都需要
  额外服务集成（成本 / 复杂度过高，不适合现阶段）。

前端如何反馈：

- `src/App.jsx`（checkout）：
  - 未登录时 `store_pickup` 卡片显示 `Requiere cuenta` 徽章
  - 点 "Continuar al Pago" 如果选 `store_pickup` 且未登录 → toast + 跳 `/login`
- `src/App.jsx`（PaymentModal）：
  - 未登录时 `contra_reembolso` 按钮变灰 + 显示 `Iniciar sesión` 提示
  - 点击未登录的 `contra_reembolso` → 跳 `/login`
- `src/api/client.js`：
  - 把后端的 `error.code` / `response.status` 挂在 Error 对象上
- `handleConfirmPayment`（App.jsx）：
  - 401 → toast + 跳 `/login`
  - 429 → toast（6 秒可见）+ 关闭支付弹窗
  - 其他 → 普通 toast.error

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
   - `TURNSTILE_SECRET_KEY=0x4AAAAAAAxxxx`（Cloudflare Turnstile Secret；不配 = 反机器人失效）
   - `RESEND_FROM_EMAIL=HIPERA <pedidos@hipera.es>`（必须是已在 Resend 验证的域）
   - `RESEND_REPLY_TO=info@hipera.es`（可选，默认与 FROM 相同）
   - `STRIPE_SECRET_KEY`（测试阶段填 test secret key；上线换 live key）
   - `STRIPE_WEBHOOK_SECRET`（Webhook 端点的 Signing secret；test/live 各一套）
   - `PRINT_AGENT_TOKEN`（自动打印代理令牌；与店里电脑 .env 里的一致）
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
