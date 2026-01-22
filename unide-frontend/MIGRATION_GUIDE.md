# 前后端分离迁移指南

## 🎯 目标

将前端代码从直接访问Supabase改为通过后端API访问，提升安全性。

## 📝 迁移步骤

### 步骤1: 更新前端API调用（App.jsx）

**原来的代码：**
```javascript
const fetchData = async () => {
  const [pRes, cRes, sRes, rRes] = await Promise.all([
    supabase.from('products').select('*'),
    supabase.from('categories').select('*'),
    // ...
  ]);
};
```

**更新为：**
```javascript
import { apiClient } from './api/client';

const fetchData = async () => {
  try {
    const [products, categories, subCategories, repairs] = await Promise.all([
      apiClient.getProducts(),
      apiClient.getCategories(),
      apiClient.getSubCategories(),
      apiClient.getRepairServices()
    ]);
    // 处理数据...
  } catch (error) {
    console.error("Data load error:", error);
  }
};
```

### 步骤2: 更新订单创建（App.jsx）

**原来的代码：**
```javascript
const { data: orderData, error } = await supabase
  .from('orders')
  .insert([{...}])
  .select()
  .single();
```

**更新为：**
```javascript
try {
  const orderData = await apiClient.createOrder({
    user_id: user?.id || null,
    address: checkoutForm.address,
    phone: checkoutForm.phone,
    note: checkoutForm.note,
    total: total,
    status: selectedPayment === 'contra_reembolso' ? "Pendiente de Pago" : "Procesando",
    payment_method: paymentMethodName,
    items: cart
  });
  // 处理成功...
} catch (error) {
  toast.error(error.message);
}
```

### 步骤3: 更新管理界面（Admin.jsx）

**原来的代码：**
```javascript
await supabase.from('products').insert([dbPayload]);
```

**更新为：**
```javascript
import { apiClient } from './api/client';

await apiClient.createProduct(dbPayload);
```

**所有管理操作都需要更新：**
- `supabase.from('products').insert()` → `apiClient.createProduct()`
- `supabase.from('products').update()` → `apiClient.updateProduct()`
- `supabase.from('products').delete()` → `apiClient.deleteProduct()`
- 类似地更新 categories, sub_categories, repair_services 的操作

### 步骤4: 保留Supabase Auth

**重要：** 用户认证仍然使用Supabase Auth（这是安全的），只需要：

```javascript
// 继续使用Supabase进行认证
import { supabase } from './supabaseClient';

// 登录/注册保持不变
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});

// 获取token用于API调用
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;
```

API客户端会自动从localStorage获取token。

## 🔄 快速迁移脚本

由于代码量较大，建议分阶段迁移：

### 阶段1: 后端准备 ✅
- [x] 创建后端API服务器
- [x] 实现所有API端点
- [x] 添加认证中间件

### 阶段2: 前端API客户端 ✅
- [x] 创建API客户端
- [x] 实现所有API方法

### 阶段3: 前端代码迁移（需要手动完成）

#### 优先级1: 关键功能
1. 订单创建（App.jsx中的handleConfirmPayment）
2. 管理界面的所有CRUD操作（Admin.jsx）

#### 优先级2: 数据获取
1. 产品列表获取
2. 分类获取
3. 维修服务获取

#### 优先级3: 用户订单
1. 用户订单列表

## 🛠️ 工具函数

创建一个工具函数来简化迁移：

```javascript
// src/utils/supabaseToApi.js
import { apiClient } from '../api/client';

// 将Supabase查询转换为API调用
export const migrateQuery = {
  products: () => apiClient.getProducts(),
  categories: () => apiClient.getCategories(),
  sub_categories: () => apiClient.getSubCategories(),
  repair_services: () => apiClient.getRepairServices(),
  orders: (userId) => apiClient.getUserOrders(userId),
};
```

## ⚠️ 注意事项

1. **保留Supabase Auth**: 用户登录/注册仍然使用Supabase
2. **Token管理**: API客户端会自动处理token
3. **错误处理**: API调用需要添加try-catch
4. **加载状态**: 保持现有的loading状态管理
5. **测试**: 每个功能迁移后都要测试

## 📊 迁移检查清单

- [ ] 后端服务器运行正常
- [ ] 环境变量配置正确
- [ ] 前端API客户端导入成功
- [ ] 产品列表通过API获取
- [ ] 订单创建通过API
- [ ] 管理界面所有操作通过API
- [ ] 用户认证仍然工作
- [ ] 错误处理正确
- [ ] 生产环境配置完成

## 🚀 完成迁移后

1. 从Supabase Dashboard禁用前端直接数据库访问（RLS策略）
2. 移除前端代码中不必要的Supabase导入（保留Auth相关）
3. 更新文档说明新的架构
4. 监控API使用情况
