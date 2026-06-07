# HIPERA 后台运营 SOP

版本：2026-06-07

这份文档是 Hipera 后台的“活流程”。先记录我目前已经看过、能理解、但不会乱点的后台模块；后面每做完一次真实运营动作，再把确认过的细节继续补进去。

当前阶段目标：

- 上线前：把商品基础数据做成可信状态，重点是库存、价格、图片、可见状态、IVA。
- 上线后：不要每天全站重查，用“订单触发 + 异常触发 + 每周分类复核”维持数据质量。
- 税务合规：当前后台凭证只作为订单 justificante，正式发票能力以后接入合规开票系统；商品 IVA 先在商品级别人工确认并留痕。

## 0. 总原则

1. 只读检查可以直接做：打开页面、切换后台模块、搜索、筛选、看订单详情、看商品详情、截图记录。
2. 会改数据的动作要谨慎：改商品、改库存、改分类、改维修服务、导入 CSV、批量 AI 修图，都需要先说明要改什么。
3. 高风险动作必须每次单独确认：`Cobrar`、`Reembolsar`、删除商品、删除分类、删除子分类、删除维修服务、批量改大量商品、退出账号。
4. 后台和数据库都按“生产环境”对待。没有明确目的时，不做测试新增、测试删除、测试付款。
5. 如果 Cursor、Codex、你本人同时操作，先确认谁负责哪一块，避免同一个商品或同一个页面被同时改。

## 1. 后台入口和模块

后台地址：

`https://www.hipera.es/admin`

左侧主模块：

- `Dashboard`：收入、订单、低库存、缺货、今日订单、热卖商品。
- `Productos`：商品新增、编辑、分类筛选、图片 AI、CSV 导入、批量 AI。
- `Categorías`：分类和子分类管理、排序。
- `Reparaciones`：手机维修服务管理。
- `Pedidos`：订单搜索、状态、收款、退款、订单 justificante、小票/打印、CSV 导出。

顶部/侧边工具：

- `Probar sonido`：测试新订单提醒声音，也可以帮助浏览器解锁音频权限。
- `Activar avisos del navegador`：开启浏览器通知。
- `Salir`：退出后台。不要随便点。

## 2. 每日检查流程

1. 打开后台，先看 `Dashboard`。
2. 检查 `PENDIENTES`、`INGRESOS HOY`、`PEDIDOS HOY`。
3. 看 `Stock bajo (≤ 5 uds.)`，记录需要补货或调库存的商品。
4. 看缺货商品列表，如果有实际已经补货的商品，再回到商品或低库存区域更新库存。
5. 打开 `Pedidos`，优先处理：
   - `Autorizado` 且显示 `Cobrar · quedan Xd` 的订单。
   - `Esperando pago` 或 `Pendiente de Pago` 的异常订单。
   - 今日新订单。
6. 如果需要听新订单提醒，点一次 `Probar sonido`，再确认浏览器通知权限是否已开启。

## 2A. 上线前一次性商品复核 SOP

目的：上线前建立第一版可信商品库。这个阶段可以辛苦一点，因为它会决定上线后每天是不是轻松。

每个商品必须确认：

- 商品名称：品牌、规格、口味没有错。
- 价格：和店内当前销售价一致。
- 库存：按保守库存填写，不追求把仓库全部填满。
- 图片：至少主图能看清、居中、不严重歪斜。
- 分类/子分类：客户能按分类找到。
- 是否显示：不确定、缺货、图片太差的商品先关闭 `Mostrar en tienda`。
- IVA：必须选 `4%`、`10%`、`21%` 之一；不确定就标 `Preguntar gestor`，不要硬猜成确认。

推荐操作：

1. 进入 `Productos`。
2. 选择一个分类，例如酒水、零食、清洁。
3. 打开 `Modo revisión`。
4. 点 `Abrir siguiente`。
5. 对照店内系统/实物，确认价格、库存、图片、可见状态、IVA。
6. 正常商品只需要选 IVA，然后点 `Guardar y siguiente`。
7. 不确定商品：
   - `Estado` 选 `Preguntar gestor` 或 `Revisar`。
   - `Nota fiscal` 写清楚原因，例如 `UPOS muestra 10%`、`preguntar gestor`、`precio pendiente`。
   - 必要时关闭 `Mostrar en tienda`。
8. 一个分类做完后，再换下一个分类。

上线前不要做：

- 不要一边审核一边大批量改 oferta。
- 不要把不确定 IVA 的商品标成 `Confirmado`。
- 不要为了凑数量把无图/坏图/库存不确定的商品强行显示。
- 不要一次导入大 CSV 覆盖很多商品，除非先备份并小批量测试。

上线前完成标准：

- 所有准备上线显示的商品都有价格、库存、分类、图片、IVA。
- `Sin IVA` 尽量为 0；如果不是 0，这些商品必须先隐藏或标明原因。
- `Sin categoría` 只保留临时待整理商品。
- 酒瓶、饮料瓶、盒装商品至少抽查前台详情页显示效果。
- 店内能实际履约的商品优先上线，其他商品可以以后慢慢补。

## 2B. 上线后每日运营 SOP

核心原则：上线后不每天全站重查。每天只处理“会影响今天订单”的商品和订单。

### 2B.1 开店前或上午第一轮

1. 打开后台，点 `r` 刷新数据。
2. 看 `Dashboard`：
   - 今日订单数。
   - 待处理订单。
   - 授权待收款订单。
   - 低库存/缺货提醒。
3. 打开 `Pedidos`：
   - 优先看 `Autorizado`。
   - 再看 `Procesando`。
   - 再看 `Esperando pago` / `Pendiente de Pago`。
4. 检查浏览器通知和声音：
   - 必要时点一次 `Probar sonido`。
   - 确认新订单提醒可用。

### 2B.2 新订单处理

1. 打开订单详情。
2. 核对订单号、客户电话、配送/自取、付款方式。
3. 按订单明细去拣货。
4. 拣货时只修正本订单相关商品：
   - 发现缺货：马上把该商品库存改低或隐藏。
   - 发现价格错：先确认是否影响当前订单，再改商品价格。
   - 发现图片/名称明显错：记录并尽快修。
5. 所有商品可履约后，再处理收款/状态。
6. 缺货或异常时，不要直接收款；先联系客户或走退款/替换流程。

### 2B.3 营业中循环

建议每隔一段时间做一次轻检查，忙的时候优先订单：

1. 刷新 `Pedidos`。
2. 看是否有新订单、授权快过期订单、客户留言/电话。
3. 处理低库存里真正会影响订单的商品。
4. 当天发现的问题商品，在 `Nota fiscal` 或内部备注里写清楚，避免第二天忘记。

### 2B.4 打烊前

1. 确认今日订单没有卡在错误状态：
   - 已交付的不要还停在 `Procesando`。
   - 已取消/退款的不要还显示待处理。
   - 授权订单不要忘记处理。
2. 核对当天异常：
   - 缺货商品。
   - 退款订单。
   - 客户投诉。
   - 价格错误。
3. 对当天被订单触发修过的商品做小复查。
4. 明天要处理的商品/订单写入备注或任务板。

每日完成标准：

- 今日新订单都有明确状态。
- 已发现缺货不会继续让客户下单。
- 已收款订单能履约。
- 退款/取消有原因记录。
- 没有为了省事把不确定商品继续暴露给客户。

## 2C. 上线后每周分类复核 SOP

目的：不用每天全站重查，但每周滚动检查一个或几个分类，让商品库长期保持健康。

推荐频率：

- 上线后前 2 周：每天顺手多看一点，每 2-3 天复核一个小分类。
- 稳定后：每周复核 1 个大分类或 2-3 个小分类。
- 每月：做一次全站异常检查。

每周复核流程：

1. 选择本周分类，例如 `Bebidas alcohólicas`。
2. 进入 `Productos`，筛选该分类。
3. 打开 `Modo revisión`。
4. 点 `Abrir siguiente`。
5. 按分类内顺序逐个确认：
   - 库存是否仍然合理。
   - 价格是否需要更新。
   - 图片是否需要修。
   - 是否应该继续显示。
   - IVA 是否已经确认。
6. 正常商品点 `Guardar y siguiente`。
7. 有问题商品写备注，必要时隐藏。
8. 分类做完后记录：日期、分类、发现的问题、下次要处理的点。

每月异常检查：

- `Sin IVA`。
- `Sin categoría`。
- `Stock bajo`。
- `Sin imagen`。
- 长期 0 库存但仍显示。
- 长期没卖但占首页/热门位置。
- oferta 已过期但还开着。
- 赠品商品是否仍有库存。

## 2D. 商品库存运营原则

上线后库存策略不是“永远准确到每一件”，而是“尽量不让客户买到你无法履约的东西”。

建议规则：

- 保守库存：后台库存低于实际可用库存，尤其是热卖、易缺货商品。
- 订单触发修正：哪个商品被买到、拣货时发现不对，就立刻修哪个。
- 低库存优先：每天看低库存，不每天全站查。
- 不确定就隐藏：比起客户买了拿不到，先隐藏更安全。
- 店内系统库存不可信时，不把它当唯一来源；实物拣货结果优先。

常见处理：

- 实物有货，后台 0：更新库存，必要时重新显示。
- 实物没货，后台有货：立刻改 0 或关闭显示。
- 只剩 1-2 件：如果店里线下也卖得快，线上库存可以设 0 或 1。
- 贵重/酒类/易争议商品：库存更保守，订单前后多确认一次。

## 2E. 税务和凭证日常原则

当前阶段：

- 网站生成的下载文件/打印件是 `JUSTIFICANTE DE PEDIDO`。
- 不把当前凭证称作正式 factura fiscal。
- 客户要求正式发票时，先收集客户 fiscal data，等合规开票通道处理。
- 商品 IVA 在商品表里人工确认，作为未来正式开票的基础数据。

以后接入合规开票系统后：

- 每个订单应保存税率快照。
- 每张票据有独立编号。
- 退款走 rectificativa。
- PDF、QR、AEAT 状态、会计导出都由发票模块或供应商 API 支持。

正式发票请求临时 SOP：

1. 记录订单号。
2. 向客户收集：
   - Nombre/Razón social。
   - NIF/CIF/NIE。
   - Dirección fiscal。
   - Email。
3. 不在当前后台随便生成“Factura”。
4. 标记该订单 `Factura solicitada` 或在备注中记录。
5. 等正式开票方案上线，或由 gestor/合规渠道处理。

## 3. 订单处理 SOP

订单页可用功能：

- 搜索：电话、订单号、邮箱等。
- 状态筛选：`Todos`、`Esperando pago`、`Autorizado`、`Procesando`、`Pendiente de Pago`、`Enviado`、`Entregado`、`Cancelado`。
- 日期筛选：`Desde`、`Hasta`。
- `CSV (数量)`：导出订单表。
- 点订单行：打开右侧订单详情。

订单详情需要核对：

- 订单号，例如 `#457a359a`。
- 状态。
- 付款方式，例如 `Tarjeta (Stripe)`。
- 电话、邮箱、地址。
- 商品明细、数量、价格。
- 小计和总计。

推荐状态流程：

1. 新的 Stripe 授权订单通常是 `Autorizado`。
2. 店里确认商品和库存都能完成后，再考虑收款。
3. 收款后或开始准备商品时，状态改为 `Procesando`。
4. 配送中可改 `Enviado`。
5. 完成后改 `Entregado`。
6. 无法完成、客户取消、退款后改 `Cancelado`。

高风险按钮：

- `Cobrar`：捕获 Stripe 授权金额，客户会看到正式扣款。必须先确认订单能履约，再点。
- `Reembolsar`：退款或释放授权，同时后端会处理库存、订单取消、邮件通知等。必须先确认原因和退款范围。
- `Justificante`、`Ticket`、`Imprimir`：生成或打印订单凭证，一般风险低，但也应先确认是正确订单。

Stripe 授权注意：

- 后台显示授权大约 7 天过期。
- 如果显示 `Cobrar · quedan 2d` 或更少，应优先人工确认。
- 过期后可能无法再捕获这笔授权。

当前 `Pedidos` 页面观察：

- 顶部会显示授权待收款提醒，例如 `1 pedido autorizado pendiente de cobro`。
- `Ver solo autorizados` 可以快速只看待收款/待处理授权订单。
- 第一条授权待收款订单会被淡黄色高亮。
- 订单行里会直接显示配送或自取：
  - `🚚 地址`：配送到家。
  - `🏬 Recogida en tienda`：到店自取。
- 行内会显示 `Cobrar · quedan Xd`，提醒授权剩余天数。
- 行内有绿色快捷 `Cobrar` 按钮，方便但容易误触。长期运营建议优先打开详情再收款。
- 右侧箭头可打开订单详情；如果点击订单左侧信息没有反应，就点最右侧箭头。

后台可优化建议：

1. 快捷 `Cobrar` 按钮建议保留二次确认，并在确认框里显示订单号和金额。
2. 行内 `Cobrar` 可以只在鼠标悬停或打开详情后显示，降低误触风险。
3. 订单行最好加一个更明显的 `Ver detalle` 或让整行可点击，因为现在从左侧点订单不一定打开详情。
4. 订单状态下拉会直接改状态，建议未来也加确认，至少对 `Cancelado`、`Entregado` 这类最终状态加确认。
5. 可以加一个 `Preparar pedido` 清单视图：商品名、数量、货架/分类、是否缺货，方便店里拣货。
6. `Autorizado` 但不显示 `Cobrar · quedan Xd` 的订单，需要后续确认是不是旧测试单、已处理单、或付款状态字段不一致。

## 3A. 真实订单处理 SOP

这个流程用于真正处理客户订单。没有得到明确授权时，不点 `Cobrar`、`Reembolsar`，不随意改最终状态。

### 3A.1 发现新订单

1. 打开 `Pedidos`。
2. 看顶部是否有授权待收款提醒。
3. 优先点 `Ver solo autorizados`，检查是否有需要处理的 Stripe 授权订单。
4. 再把状态筛选切回 `Todos`，看有没有 `Esperando pago`、`Pendiente de Pago`、`Procesando` 的订单。
5. 用日期筛选看今天订单，避免旧测试订单混在一起。

### 3A.2 先判断订单类型

按配送方式分：

- `🚚 地址`：配送订单，需要核对地址和电话。
- `🏬 Recogida en tienda`：自取订单，需要确认客户到店取货方式。

按付款方式分：

- `Tarjeta (Stripe)`：可能是 Stripe 授权，需要确认是否要 `Cobrar`。
- `Bizum (Stripe)`：同样看详情里是否有授权/收款提示。
- `Contra Reembolso`：货到付款，通常不点 `Cobrar`。
- `Bizum` 或 `No especificado`：要看详情和实际收款记录，不能只看列表判断。

按状态分：

- `Autorizado`：优先核对，可能需要备货后收款。
- `Procesando`：正在处理，检查是否已备货或已通知客户。
- `Pendiente de Pago` / `Esperando pago`：确认客户是否未付款、付款失败、或只是状态未同步。
- `Enviado`：配送中。
- `Entregado`：已完成。
- `Cancelado`：不再处理，除非要查原因或补退款。

### 3A.3 打开详情并核对

1. 点订单最右侧箭头打开详情。
2. 核对订单号，例如 `#457a359a`。
3. 核对付款提示：
   - 如果显示 `Pago autorizado, pendiente de cobro`，说明还没正式收款。
   - 如果显示剩余天数，记录 `quedan X día(s)`。
4. 核对客户信息：
   - 电话。
   - 邮箱。
   - 配送地址或自取。
5. 核对商品：
   - 商品名和 ID。
   - 数量，例如 `8x 商品名#465`。
   - 商品小计。
6. 核对金额：
   - `Subtotal artículos`。
   - `Total`。
   - 是否有折扣、配送费、赠品。

### 3A.4 备货检查

1. 根据详情里的商品清单去店里或库存表确认是否都有货。
2. 如果商品都有货：
   - 标记为可履约。
   - 对 Stripe 授权订单，准备收款。
3. 如果部分缺货：
   - 不要直接收款。
   - 先决定是替换商品、部分退款、整单取消，还是联系客户。
4. 如果地址明显异常，例如测试地址、乱码地址、超出配送范围：
   - 不要收款。
   - 先联系客户确认。

### 3A.5 收款流程

仅适用于详情里确认 `Pago autorizado, pendiente de cobro` 的 Stripe 授权订单。

执行前必须确认：

- 订单号正确。
- 金额正确。
- 商品都能备齐。
- 地址/自取方式没问题。
- 用户明确说可以收款，或店内规则已经允许收款。

推荐操作：

1. 打开订单详情。
2. 再次读订单号和总金额。
3. 点详情里的 `Cobrar`，不要优先用列表快捷按钮。
4. 如果系统弹确认框，确认订单号/金额后再确认。
5. 收款成功后，看订单状态和提示是否刷新。
6. 把状态改为 `Procesando`，除非系统已经自动更新到合适状态。
7. 打开 `Justificante`、`Ticket` 或 `Imprimir` 准备订单凭证。

### 3A.6 退款/取消流程

适用于缺货、客户取消、地址问题、无法按时配送、重复测试订单等。

执行前必须确认：

- 订单号。
- 退款原因。
- 是整单退款还是部分退款。
- 是否需要先联系客户。
- Stripe 授权订单是“释放授权”还是已扣款后的退款。

推荐操作：

1. 打开订单详情。
2. 点 `Reembolsar` 前先记录订单号和金额。
3. 选择退款原因。
4. 如果是部分退款，确认每个商品数量。
5. 完成后确认订单状态是否变为 `Cancelado` 或合适状态。
6. 必要时通过 WhatsApp/电话通知客户。

常用西语说明模板：

`Hola, somos HIPER SHOP / UNIDE. Tu pedido #订单号 no se puede preparar completo porque falta 商品名. Podemos cambiarlo por otro producto, hacer un reembolso parcial o cancelar el pedido. ¿Qué prefieres?`

整单取消模板：

`Hola, somos HIPER SHOP / UNIDE. Sentimos las molestias, no podemos preparar tu pedido #订单号 correctamente. Vamos a cancelar el pedido y liberar/reembolsar el pago.`

### 3A.7 配送订单完成流程

1. 收款或确认付款方式后，状态改 `Procesando`。
2. 拣货并打包。
3. 打印订单凭证，贴或放入订单袋。
4. 配送出发时改 `Enviado`。
5. 送达后改 `Entregado`。
6. 如果客户未接电话或地址有问题，先不要改 `Entregado`，记录并联系客户。

### 3A.8 自取订单完成流程

1. 确认订单显示 `🏬 Recogida en tienda`。
2. 拣货并放到自取区。
3. 如果已线上付款，按收款状态处理。
4. 如果是到店付款，客户到店付款后再交货。
5. 客户取走后改 `Entregado`。

### 3A.9 真实处理汇报格式

每处理一个订单，汇报格式：

- 订单：`#订单号`
- 类型：配送/自取
- 付款：Stripe 授权/已付款/货到付款/其他
- 商品：几件、是否齐全
- 动作：已收款/未收款/已退款/已改状态/只检查
- 状态：处理前 -> 处理后
- 风险：缺货、地址异常、电话异常、测试单、重复单

## 4. 商品新增 SOP

进入 `Productos`，使用 `Añadir producto nuevo`。

必填/常用字段：

- `Nombre`：商品完整名称，建议包含品牌、规格、口味。
- `Precio €`：销售价格。
- `Stock`：库存，默认 10。
- `Categoría`：主分类。
- `Subcategoría`：选择主分类后才能选。
- `Descripción`：可手写，也可用 AI 从图片提取。
- `Oferta`：是否作为优惠商品。
- `Regalo (€65+)`：是否作为满 65 欧可选赠品。
- `Mostrar en tienda`：是否对客户可见，默认开启。
- `Imagen`：上传商品图。

保存前检查：

1. 名称没有测试文字、乱码、错别字。
2. 价格和库存不是 0 或异常值。
3. 分类和子分类正确。
4. 主图清晰、居中、没有明显斜歪或大面积留白。
5. 如果还没准备好上架，关闭 `Mostrar en tienda`。

## 5. 商品编辑 SOP

商品编辑入口在 `Productos` 的商品列表中。

编辑弹窗里目前可见/已确认的功能：

- 改名称、价格、库存、描述。
- 改 `Mostrar en tienda`。
- 改 `Producto de Regalo (订单满€65可选)`。
- 开关 `¿Activar Oferta?`。
- 上传多张图片。
- `Quitar fondo (AI)`：去背景。
- `Centrar producto (AI)`：居中商品。
- `Extraer información (AI)`：从商品图提取描述信息。
- 改分类、子分类。
- `Guardar Producto` 保存。

编辑原则：

- 单个商品小改，可以直接按商品名搜索后编辑。
- 价格、库存、上下架，保存前再读一遍。
- 图片类修改建议保存前先看主图预览。
- 如果商品图片本身拍摄透视严重，例如瓶身上窄下宽、标签扭曲，单纯 `Centrar producto (AI)` 不一定够，需要进入“图片质量审核”流程。

## 6. 商品图片质量 SOP

需要修的情况：

- 商品明显倾斜，网站详情页看起来歪。
- 拍摄角度导致上细下宽、瓶身或盒身变形。
- 商品太小、太靠边、留白比例不舒服。
- 背景没有去干净，边缘灰、脏、阴影重。
- 商品被裁切，顶部或底部缺失。
- 清晰度明显低于同类商品。

可以优先用后台 AI 的情况：

- 只是背景脏：用 `Quitar fondo (AI)`。
- 只是位置不居中：用 `Centrar producto (AI)`。
- 去背景后画面留白不一致：先 `Quitar fondo (AI)`，再 `Centrar producto (AI)`。

可能需要 GPT Image 或重拍的情况：

- 透视严重，瓶子/盒子形状已经变形。
- 商品标签被反光挡住，文字看不清。
- 原图分辨率太低。
- 商品本身角度太偏，AI 拉正会让包装失真。

批量处理建议：

1. 不要一次选 1000 个。
2. 每批先 20-50 个，看成功率和效果。
3. 酒瓶、饮料瓶、盒装商品单独一批，因为它们对“直不直”更敏感。
4. 生鲜、软包装、袋装零食可以另一批，因为形状本来不完全规则。
5. 批量 AI 失败的商品先记录 ID，再单独重试。

后台批量 AI：

- 选中商品后，底部会出现批量栏。
- 可选 `Quitar fondo + Centrar (AI)`、`Solo Quitar fondo`、`Solo Centrar`。
- 后台显示大约每个商品间隔 5 秒处理。
- 大批量处理前要先确认商品范围。

## 7. 分类和子分类 SOP

进入 `Categorías`。

可做事项：

- 新增主分类：填写 `Nombre`，选择 `Icono`，点 `Crear`。
- 调整主分类排序：拖动分类卡片，顺序会影响店铺显示。
- 新增子分类：在分类卡片里点 `+ Añadir Sub`。
- 删除分类/子分类：必须单独确认。

已看到的主分类包括：

- `Carne y pescado`
- `Lácteos y huevos`
- `Panadería y repostería`
- `Comida preparada y conservas`
- `Cereales y básicos`
- `Aceites y condimentos`
- `Snacks y dulces`
- `Bebidas`
- `Café y té`
- `Bebidas alcohólicas`
- `Alimentación infantil`
- `Comida internacional`
- `Comida para mascotas`
- `Congelados`
- `Higiene personal`
- `Limpieza del hogar`
- `Sin categoría`

注意：

- 删除分类可能影响很多商品归类，不要为了整理界面直接删。
- 调整分类顺序前，最好先确认首页/分类页想要的展示顺序。
- `Sin categoría` 应作为待整理区，不应长期堆商品。

## 8. 维修服务 SOP

进入 `Reparaciones`。

已看到页面用于管理手机维修服务，卡片示例包括：

- `APPLE IPHONE X`
- `APPLE IPHONE XR`
- `APPLE IPHONE XS`
- `APPLE IPHONE XS MAX`
- `APPLE IPHONE 11`
- `APPLE IPHONE 11PRO`
- `APPLE IPHONE 11PRO MAX`
- `APPLE IPHONE 12MINI`

可做事项：

- 新增品牌和型号。
- 编辑维修说明，按钮为 `Editar Descripción`。
- 删除维修服务，必须单独确认。

默认维修说明中目前包含类似：

`Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.`

建议后续补充：

- 每个机型的可维修项目。
- 是否需要预约。
- 是否有大概价格区间。
- 配件缺货时怎么下架或隐藏。

## 9. CSV 导入商品 SOP

入口：`Productos` -> `Importar CSV`。

后台模板字段：

`name, price, stock, image, category, sub_category_id, description, oferta, oferta_type, oferta_value, gift_product, visible`

至少必须有：

- `name` 或 `nombre`
- `price` 或 `precio`

后台可识别的常见列名：

- 商品名：`name`、`nombre`、`nombre del producto`、`producto`
- 价格：`price`、`precio`、`precio €`
- 库存：`stock`、`cantidad`、`cant`
- 图片：`image`、`imagen`、`img`、`url`、`foto`
- 分类：`category`、`categoria`、`categoría`、`categoria_id`
- 子分类：`sub_category_id`、`subcategory_id`、`subcategoria`、`sub_category`、`subcategoría`
- 描述：`description`、`descripcion`、`descripción`、`desc`
- 优惠：`oferta`、`offer`、`promo`、`en_oferta`
- 优惠类型：`oferta_type`、`tipo oferta`、`tipo_oferta`
- 优惠值：`oferta_value`、`valor`、`valor_oferta`
- 赠品：`gift_product`、`regalo`、`gift`、`producto regalo`
- 可见：`visible`、`mostrar`、`show`、`en_tienda`、`visible_en_tienda`

导入前流程：

1. 先导出或保存当前商品数据备份。
2. 小批量整理 CSV，建议每批 20-100 行。
3. 确认名称、价格、分类、图片链接没错。
4. 如果是新增商品，确认不会和已有商品重复。
5. 如果只是改库存或图片，优先不要用“新增商品导入”，避免重复创建。

导入后检查：

1. 看导入成功数量。
2. 看失败行和失败原因。
3. 搜索 3-5 个刚导入商品抽查。
4. 打开前台确认显示效果。

## 10. Dashboard 库存 SOP

低库存区：

- 显示 `Stock bajo (≤ 5 uds.)`。
- 每行有库存输入和 `Actualizar`。
- 适合快速补库存或修正库存。

建议规则：

- 真实补货后再加库存。
- 不确定库存时先不要改大数。
- 酒、饮料、常温食品如果有箱装库存，要确认后台单位是“单瓶/单包/单件”还是“整箱”。
- 改完库存后抽查商品详情页是否同步。

## 11. Google 商家资料 SOP

这部分不在 Hipera 后台，但属于运营。

已做过的事情：

- 回复近期评论。
- 优化商家简介。
- 添加手机维修业务到简介/分类。
- 发布网站即将上线的预热动态。
- 举报两个明显无关或低质量图片。

以后可继续做：

- 每周检查新评论，只回复近期评论。
- 发布新品、维修服务、活动动态。
- 检查照片质量，删除或举报无关图片。
- 网站上线前后更新官网链接和动态。

## 12. 目前发现的待处理事项

1. `Dashboard` 热卖商品里出现过疑似测试商品名，例如 `DDWQD`、`emo femboy...`，后续需要商品数据清理。
2. `Pedidos` 里有授权待收款订单，需要你确认是否已备货、是否要收款。
3. 酒瓶类商品在网站详情页容易显得歪，后续要单独做一轮“酒类图片审核”。
4. 商品图片批量修复前，需要先定标准：哪些只用后台 AI，哪些用 GPT Image，哪些必须重拍。
5. `Sin categoría` 应定期检查，避免新商品漏分类。

## 13. 我后续接手后台时的固定汇报格式

每次做后台运营，我会按这个格式汇报：

- 看了哪里。
- 发现了什么。
- 改了什么。
- 哪些地方我没有动，因为需要你确认。
- 下一步建议。

高风险操作汇报必须写清：

- 订单号或商品 ID。
- 操作前状态。
- 准备执行的动作。
- 为什么要做。
- 等你确认后再执行。

## 14. 后台快捷键 SOP

版本记录：2026-06-05 已实测安全快捷键。

设计原则：

- 快捷键用于加速导航、搜索、查看、刷新。
- 快捷键不直接执行高风险动作。
- 输入框、文本框、下拉框、中文输入法正在输入时，字母/数字快捷键不应触发。
- `Esc` 永远优先处理最上层弹窗，或先取消当前输入框焦点。

### 14.1 通用快捷键

- `?`：打开/关闭快捷键帮助。
- `Esc`：关闭最上层弹窗；如果当前正在输入，则先取消输入框焦点。
- `r`：刷新后台数据。

实测结果：

- `?` 可以打开帮助弹窗。
- `Esc` 可以关闭帮助弹窗。
- `r` 可以刷新数据，不会改后台数据。

### 14.2 页面导航

- `1`：Dashboard。
- `2`：Productos。
- `3`：Categorías。
- `4`：Reparaciones。
- `5`：Pedidos。

实测结果：

- `1-5` 都可以正确切换左侧模块。
- 测试后页面已留回 `Pedidos`。

### 14.3 每个页面常用快捷键

`/`：

- 在 `Productos` 页面聚焦商品搜索框。
- 在 `Pedidos` 页面聚焦订单搜索框。

`n`：

- 在 `Productos` 页面聚焦新商品名称输入框。
- 在 `Categorías` 页面聚焦新分类名称输入框。
- 在 `Reparaciones` 页面聚焦维修品牌输入框。

`c`：

- 在 `Pedidos` 页面清空搜索、状态、日期筛选。
- 在 `Productos` 页面清空商品搜索和分类筛选。

实测结果：

- `Productos` 页面 `/` 聚焦 `search-products`。
- `Productos` 页面 `n` 聚焦 `new-product-name`。
- `Categorías` 页面 `n` 聚焦 `category-name`。
- `Reparaciones` 页面 `n` 聚焦 `repair-brand`。
- `Pedidos` 页面 `/` 聚焦 `search-orders`。
- `Pedidos` 页面 `c` 可以清空订单搜索。

### 14.4 订单详情快捷键

仅在订单详情侧栏打开时生效：

- `f`：打开订单 justificante。
- `t`：打开小票。
- `p`：打印小票。

使用规则：

- 这三个属于查看/输出类动作，不会改订单状态或付款状态。
- 但 `p` 会触发打印流程，操作前要确认当前订单正确。
- 如果只是检查快捷键，不要随便按 `p`，避免打开系统打印窗口。

测试状态：

- 这三个本次没有实测，因为会打开票据或打印流程。
- 真实处理订单时，确认订单号后再使用。

### 14.5 商品弹窗快捷键

- `Ctrl + Enter` / `⌘ + Enter`：保存当前商品。

使用规则：

- 只在商品编辑弹窗里使用。
- 保存前确认名称、价格、库存、分类、图片、上下架状态。
- 保存失败时弹窗不应关闭，应看 toast 或错误提示。

测试状态：

- 本次没有实测，因为会真实保存商品。

### 14.6 明确没有快捷键的高风险动作

以下动作不得设置“直接执行”快捷键：

- `Cobrar`
- `Reembolsar`
- 删除商品
- 删除分类
- 删除子分类
- 删除维修服务
- 批量 AI 修图
- `Importar CSV`
- 批量状态修改

可以接受的方式：

- 快捷键最多只能打开对应弹窗或把焦点移动到相关区域。
- 最终执行必须鼠标点击确认，或弹出二次确认。
- 收款、退款、删除类最好在确认框里显示订单号/商品 ID/金额。

## 15. 多 Agent 工作流

第二版 A 多 agent 工作流已建立，入口见：

`HIPERA_MULTI_AGENT_WORKFLOW.md`

运营控制台文件夹：

`.hipera-ops/`

使用规则：

- 简单问题不启用子 agent，主控直接处理。
- 复杂/高风险问题按需启用 1 个或多个 agent。
- 子 agent 只分析和输出建议，不直接操作后台。
- 主控负责汇总、确认、加锁和执行。
- 高风险动作仍然必须先获得用户确认。

第一批 agent：

- `special-cases-compliance`
- `pedidos-fulfillment`
- `refunds-payments`
- `products-inventory-images`
- `oferta-campaigns`
- `google-ops`
- `verifier`

默认触发场景：

- 退款/拒绝退款。
- 食品、冷冻品、卫生用品、维修争议。
- 客户投诉、差评、正式 reclamación。
- Stripe 授权/扣款异常。
- 批量商品、批量 oferta、批量修图。
- 隐私或数据请求。
