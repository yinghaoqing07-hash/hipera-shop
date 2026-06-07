# HIPERA Agent 调度规则

## 默认规则

默认不启用子 agent。只有当问题复杂、风险较高，或者用户明确要求多 agent，才启用。

## 简单任务：主控直接处理

例子：

- 今天有没有 Google 新评价。
- 某个订单多少钱。
- 某个商品库存多少。
- 写一条普通回复。
- 看一个页面按钮是什么意思。

## 单 agent 任务

| 场景 | Agent |
|---|---|
| 退货规则、投诉边界、消费者权利 | `special-cases-compliance` |
| 订单履约、配送、自取、状态建议 | `pedidos-fulfillment` |
| 退款金额、Stripe 授权、配送费退不退 | `refunds-payments` |
| 商品是否缺货、错货、图片、分类 | `products-inventory-images` |
| Oferta、满赠、促销、banner 活动 | `oferta-campaigns` |
| Google 评论、帖子、照片、商家资料 | `google-ops` |

## 多 agent 任务

| 场景 | Agent 组合 |
|---|---|
| 食品/冷冻品投诉退款 | `special-cases-compliance` + `refunds-payments` + `products-inventory-images` + `verifier` |
| Stripe 已授权但缺货 | `refunds-payments` + `products-inventory-images` + `verifier` |
| 配送失败或自取争议 | `pedidos-fulfillment` + `special-cases-compliance` + `verifier` |
| 客户差评涉及服务态度或投诉 | `google-ops` + `special-cases-compliance` + `verifier` |
| 维修服务争议 | `special-cases-compliance` + `refunds-payments` + `verifier` |
| 大批量活动/改价 | `oferta-campaigns` + `products-inventory-images` + `verifier` |
| 隐私、删除账号、数据请求 | `special-cases-compliance` + `verifier` |

## 风险等级

低风险：

- 只读查询。
- 普通好评回复。
- 草稿文案。

中风险：

- 单个商品编辑。
- 单个订单状态建议。
- 普通退款建议。
- 轻微投诉。

高风险：

- 真实退款/拒绝退款。
- 收款。
- 删除。
- 批量导入/批量 AI/批量改价。
- 食品安全、维修纠纷、隐私请求。
- 客户威胁投诉/denuncia/reclamación。
- Google 对外发布、评价回复、照片删除/举报、商家资料修改。
- Supabase 任何写入或直接数据修改。
- Legal/条款/隐私/退货/配送页面修改。
- 分类删除、子分类删除、维修服务删除。

## Verifier 必须介入

- 风险为高。
- 要对外承诺赔偿、退款、免费服务。
- 要拒绝客户请求。
- 涉及法律/条款解释。
- 涉及批量后台操作。

## 主控执行前检查

```text
是否需要锁:
是否已有用户确认:
是否有 agent 冲突:
是否有 verifier 审核:
是否需要截图/记录:
是否需要更新 SOP:
```
