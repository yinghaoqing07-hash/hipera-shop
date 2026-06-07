# HIPERA 多 Agent 工作流 第二版 A

版本：2026-06-06

第二版 A 是 Codex 内部多 agent 并行分析工作流。它不要求修改 Hipera 后台代码，也不要求现在接 OpenAI API 到后台。后台真实操作仍由主控执行。

## 1. 核心原则

1. 默认不开子 agent，简单问题主控直接处理。
2. 子 agent 负责分析、核对、写建议，不直接操作 Hipera 后台、Google 后台、Stripe 或 Supabase。
3. 真实执行只允许主控完成：保存、退款、收款、删除、CSV 导入、批量 AI、改订单状态都必须经过主控。
4. 高风险动作必须先向用户确认。
5. 同一个后台区域必须加锁，避免多方同时操作。
6. 每个复杂 case 都要写入 case log，方便以后复盘。

## 2. Agent 角色

主控：

- `Coordinator`：当前 Codex 主线程。负责分配任务、汇总结论、执行后台动作。

子 agent：

- `special-cases-compliance`：特殊情况 / 合规。
- `pedidos-fulfillment`：订单履约 / 配送自取 / 状态。
- `refunds-payments`：退款 / 支付。
- `products-inventory-images`：商品 / 库存 / 图片。
- `oferta-campaigns`：优惠 / 活动。
- `google-ops`：Google 商家资料 / 运营。
- `verifier`：审核 / 质检。

角色卡位置：

`.hipera-ops/AGENTS/`

## 3. 什么时候启用多 agent

不启用：

- 简单问答。
- 只看库存、订单金额、评价内容。
- 写一条普通 Google 回复。
- 单个商品小修。

启用 1 个 agent：

- 单一领域问题，例如“这张图要不要修”“这个退款怎么算”“这个评论怎么回”。

启用 2-4 个 agent：

- 涉及退款、投诉、食品、维修、隐私、支付、配送失败、缺货、批量操作。

启用 `verifier`：

- 只要涉及真实退款、拒绝退款、客户投诉、批量修改、对外承诺或法律/条款解释，就要最后审核。

## 4. 标准流程

```text
用户提出任务
↓
Coordinator 判断复杂度和风险
↓
必要时在 TASK_BOARD.md 建任务
↓
必要时在 LOCKS.md 标记锁
↓
派发对应 agent
↓
agent 输出结构化建议
↓
Coordinator 汇总、消除冲突
↓
Verifier 审核高风险结论
↓
需要执行时先问用户确认
↓
Coordinator 执行后台动作
↓
写入 CASE_LOG.md 和必要 SOP
```

## 5. 执行锁

锁文件：

`.hipera-ops/LOCKS.md`

常用锁：

- `google`
- `pedidos`
- `refunds`
- `productos`
- `categorias`
- `reparaciones`
- `oferta`
- `supabase`
- `legal`

规则：

- 只读分析一般不需要锁。
- 打开后台准备改数据前必须看锁。
- 同一锁同一时间只允许一个执行者持有。
- 如果 Cursor、用户、Codex 同时工作，以用户最新指令为准。

## 6. 输出格式

每个 agent 必须输出：

```text
结论：
依据：
建议动作：
需要主控确认：
风险等级：
还缺什么信息：
```

涉及真实执行时必须额外输出：

```text
对象 ID：
金额：
执行前状态：
执行后目标状态：
需要锁：
需要用户确认原文：
需要截图/证据：
失败或回滚方案：
```

复杂 case 的主控汇总格式：

```text
Case：
参与 agent：
事实：
各 agent 结论：
冲突点：
主控建议：
需要用户确认：
执行计划：
记录位置：
```

## 7. 法律与条款资料

内部资料优先：

- `unide-frontend/src/pages/legal/TerminosCondiciones.jsx`
- `unide-frontend/src/pages/legal/PoliticaDevoluciones.jsx`
- `unide-frontend/src/pages/legal/PoliticaEnvios.jsx`
- `unide-frontend/src/pages/legal/PoliticaPrivacidad.jsx`
- `HIPERA_OPERATIONS.md`

外部官方参考：

- BOE 消费者法 RDL 1/2007: https://boe.es/buscar/act.php?id=BOE-A-2007-20555
- CEC España 消费者信息: https://portal-cec.consumo.gob.es/es/preguntas-frecuentes
- AEPD: https://www.aepd.es/

注意：

- 这些 agent 给运营建议，不替代律师、gestor 或监管机构意见。
- 高风险纠纷、金额较大、正式投诉、隐私请求、劳动/税务问题，应标记为高风险并建议人工专业确认。

## 8. 当前落地状态

已建立：

- 任务板：`.hipera-ops/TASK_BOARD.md`
- Case 记录：`.hipera-ops/CASE_LOG.md`
- 锁表：`.hipera-ops/LOCKS.md`
- 调度规则：`.hipera-ops/DISPATCH_RULES.md`
- 角色卡：`.hipera-ops/AGENTS/`

下一步：

- 用一个真实特殊情况跑一次第二版 A。
- 跑完后把流程补回 `HIPERA_OPERATIONS.md`。
