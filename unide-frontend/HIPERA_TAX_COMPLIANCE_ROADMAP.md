# HIPERA Web 独立税务合规路线图

> 目标：让 HIPERA 网站订单、付款、退款、发票、会计导出形成独立闭环。实体店销售继续由 UPOS 管，网站销售由 HIPERA Web 管。

## 阶段 1：安全上线版

目标：网站不再把当前临时 PDF 称作正式发票，避免错误开票风险。

- 前台下载按钮显示为 `Justificante de pedido`。
- A4 PDF 显示为 `JUSTIFICANTE DE PEDIDO`，并注明不是正式 fiscal factura。
- Ticket PDF / 打印凭证注明不是正式 fiscal factura。
- 法律页不再承诺网站自动生成正式电子发票。
- 客户需要正式发票时，先人工收集 fiscal data，并通过正式开票渠道处理。

状态：核心已完成，待上线前人工点检。

## 阶段 2：IVA 商品税率地基

目标：每个商品都能被系统准确计算 IVA。

- `products.tax_rate`：4 / 10 / 21。
- `products.tax_category`：例如 alcohol, food_general, food_basic, sugary_drink, repair_service。
- `products.tax_review_status`：pending / reviewed / needs_gestor。
- `products.tax_note`：记录为什么这样分类。
- CSV 导入/后台编辑必须支持 IVA。
- 批量生成 IVA 审核表，先自动预判，再人工确认模糊商品。

当前状态：字段、后台编辑、CSV 导入/导出已开始落地；尚未批量判定真实商品税率。

补充：后台已加入“Modo revisión”商品验收工作流，用于上线前逐个核对价格、库存、图片、分类、显示状态和 IVA，并支持“Guardar y siguiente”。

预计时间：1-3 天，取决于商品数据质量和人工确认速度。

## 阶段 3：订单税务快照

目标：订单创建时固定保存当时的税务计算结果，历史订单不会因为商品后续改价/改税率而变化。

- 保存每行商品的 gross price、tax rate、base imponible、cuota IVA。
- 保存折扣分摊结果。
- 保存配送费税务处理。
- 保存支付方式、收款状态、Stripe reference。
- 后台展示订单税务明细。

预计时间：2-4 天。

## 阶段 4：独立发票模块

目标：网站有自己的发票数据层，但是否立即接 VERI*FACTU API 可分开做。

- `invoices` 表：type, series, number, order_id, issued_at, status。
- `invoice_lines` 表：description, qty, gross, tax_rate, tax_base, tax_amount。
- 支持 `factura simplificada`。
- 支持 `factura completa`。
- 支持 `factura rectificativa`。
- 后端生成 PDF 并存档。
- 后台可查看发票、下载 PDF、关联订单。

预计时间：4-7 天。

## 阶段 5：退款与 rectificativa

目标：退款不只是 Stripe refund，还要有税务冲回记录。

- 全额退款生成 rectificativa。
- 部分退款按商品/税率生成 rectificativa。
- 退款原因、退款金额、原发票关联必须保存。
- 会计导出中体现 rectificativa。

预计时间：2-4 天。

## 阶段 6：会计导出与对账

目标：月底能给 gestor 一份清楚的数据。

- 导出销售发票。
- 导出 rectificativa。
- 按 IVA 税率汇总 tax base / cuota IVA / total。
- Stripe / 现金 / 到店付款对账。
- UPOS 实体店销售和 HIPERA Web 网站销售分开汇总。

预计时间：2-4 天。

## 阶段 7：VERI*FACTU / SIF 对接

目标：网站正式开票系统满足未来 SIF / VERI*FACTU 要求。

建议优先找支持 API 的西班牙开票服务，而不是完全从零实现。

需要确认：

- 是否支持 API 创建 factura simplificada。
- 是否支持 API 创建 factura completa。
- 是否支持 factura rectificativa。
- 是否支持独立发票系列。
- 是否支持 PDF、QR、hash、event log。
- 是否能导出给 gestor。

预计时间：取决于供应商；通常 1-2 周起。

## 运营原则

- 实体店销售：UPOS 是税务来源。
- 网站销售：HIPERA Web / 独立开票系统是税务来源。
- 不能同一笔销售在 UPOS 和网站重复开票。
- 客户要正式发票时，必须收集完整 fiscal data。
- 已开票订单退款必须走 rectificativa。
