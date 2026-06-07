# HIPERA Case Log

这里记录复杂/高风险 case。简单问题不必写入。

## Case 模板

```text
Case ID:
日期:
来源:
客户/订单:
对象 ID:
涉及金额:
类型:
状态:
风险等级:
需要锁:

事实:

涉及资料:
- Hipera 条款:
- 外部法律/官方资料:
- 后台截图/订单:

参与 agent:
- special-cases-compliance:
- refunds-payments:
- products-inventory-images:
- oferta-campaigns:
- google-ops:
- verifier:

各 agent 结论:

主控汇总:

用户确认:
- 确认原文:
- 确认时间:

实际执行:
- 执行者:
- 执行时间:
- 执行前状态:
- 执行后状态:
- 截图/证据:
- 失败或回滚方案:

客户话术:

后续跟进:

复盘:
```

## 记录

### CASE-20260606-B5FC8159

日期: 2026-06-06
来源: 用户在 Codex 线程提出
客户/订单: #b5fc8159
对象 ID: order b5fc8159..., product #465
涉及金额: €28.91 total / €23.92 artículos
类型: 食品疑似过期、客户要求全额退款
状态: WAITING_USER
风险等级: 高
需要锁: pedidos, products, refunds

事实:
- 订单时间: 04/06/2026 00:38
- 付款: Tarjeta (Stripe)
- 当前后台状态: Procesando
- 配送: Envío a domicilio, calle del clavel 22
- 商品: 8x FILETES DE MERLUZA EMPANADA PESCANOVA 340g #465
- 后台动作: Reembolsar / Factura / Ticket / Imprimir
- 商品 #465 当前库存显示 889，OFERTA，价格 €2.99
- 缺失: 客户照片、fecha de caducidad/consumo preferente、lote、是否 8 包同批次、店内库存实物检查

涉及资料:
- Hipera 条款: T&C §3.3 食品应有合理消费期限；T&C §9.6 过期/不合格食品可即时投诉；Devoluciones §8 产品不符合合同时适用保证，不是普通无理由退货。
- 外部法律/官方资料: BOE RDL 1/2007 消费者法；AESAN 关于 fecha de caducidad 与 consumo preferente 的区别。
- 后台截图/订单: 已通过后台只读查看订单列表和订单详情。

参与 agent:
- special-cases-compliance: 已完成
- refunds-payments: 已完成
- products-inventory-images: 已完成
- oferta-campaigns: 未参与
- google-ops: 未参与
- pedidos-fulfillment: 已完成
- verifier: 已完成

各 agent 结论:
- compliance: 这是质量/不符合合同问题，不应按普通食品不可退处理；先要证据，确认后退款/换货。
- refunds: 若证据可信且客户坚持，食品安全问题可接受全额退款；Stripe 总额退款会原路退/释放并取消订单。
- products: 订单全是同一冷冻鱼 SKU，若过期成立需检查 #465 同批次库存，必要时下架或改库存。
- fulfillment: 保持 Procesando，不先改 Entregado；确认证据和退款范围后再执行。
- verifier: 主控建议安全；执行前必须明确确认“通过 Stripe 全额退款 €28.91 并停止/取消后续履约”。未核实前不建议直接下架整个 SKU；证据成立后立即隔离/下架同批次。

主控汇总:
- 推荐先向客户索要商品正面、有效期/消费期限、批号/lote、8 包是否同批次的照片。
- 若证据清楚显示过期，建议全额退款 €28.91，包含配送费，作为食品安全/口碑优先处理。
- 执行全额退款后，后台会把订单改为 Cancelado 并补回库存；必须人工检查 #465 同批次，避免过期库存继续销售。

用户确认:
- 确认原文: 待确认
- 确认时间: 待确认

实际执行:
- 执行者: 待执行
- 执行时间: 待执行
- 执行前状态: Procesando
- 执行后状态: 待执行
- 截图/证据: 待客户/店内提供
- 失败或回滚方案: 若退款失败，查看 Stripe 状态；若库存自动补回，立即手动调整 #465 可售库存。

客户话术:
- 待用户确认后发送。

后续跟进:
- 检查 #465 实物库存的日期、批号、冷冻状态。
- 若同批次有问题，临时下架 #465 或把可售库存调低/归零。
- 记录客户证据与退款结果。

复盘:
- 待处理完成后补充。

### CASE-0001

状态：占位

备注：第一个真实复杂 case 处理后替换本占位。
