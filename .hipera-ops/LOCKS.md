# HIPERA 执行锁

锁用于防止多个执行者同时改同一块后台。只读分析不需要锁，准备执行真实操作时必须看这里。

## 当前锁

| 锁 | 当前持有者 | 开始时间 | 目的 | 状态 |
|---|---|---|---|---|
| google | - | - | - | FREE |
| pedidos | - | - | - | FREE |
| refunds | - | - | - | FREE |
| productos | - | - | - | FREE |
| categorias | - | - | - | FREE |
| reparaciones | - | - | - | FREE |
| oferta | - | - | - | FREE |
| supabase | - | - | - | FREE |
| legal | - | - | - | FREE |

## 锁规则

1. `Cobrar`、`Reembolsar`、订单状态修改：需要 `pedidos`，退款还需要 `refunds`。
2. 商品新增/编辑/批量 AI/CSV 导入：需要 `productos`。
3. 分类新增/排序：需要 `categorias`；分类/子分类删除需要 `categorias` + 用户确认。
4. 维修服务新增/编辑：需要 `reparaciones`；删除需要 `reparaciones` + 用户确认。
5. Oferta、满赠、活动改价：需要 `oferta`，通常也需要 `productos`。
6. Google 回复、帖子、照片、商家资料：需要 `google`。
7. Supabase 直接查改数据：写入需要 `supabase`；只读查询一般不需要锁，但要避免暴露敏感数据。
8. 修改条款、隐私、退货、配送页面：需要 `legal`。

## 申请锁模板

```text
申请锁:
持有者:
预计动作:
涉及对象:
预计释放:
用户是否已确认:
```

## 释放锁模板

```text
释放锁:
持有者:
完成动作:
结果:
记录位置:
```
