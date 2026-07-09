# Unide 当前顾问总手册

更新日期：2026-07-03

用途：这是当前最应该信的一份总资料。以后问 UnideGes、叫货、FEL、商品、Telegram bot、店里电脑操作时，优先按这份回答；旧笔记只当来源材料，不直接当最终结论。

## 一句话总原则

- 不确定时，先查系统，不凭记忆乱点。
- 能只查询就先只查询；涉及保存、确认、发送订单、打印、改价，都要人工确认。
- UnideGes 桌面程序和网页后台里的实时状态，比 Excel 导出表更可靠。
- 自动化先做重复、低风险、可截图确认的步骤；高风险按钮如 `Enviar Pedido`、`Confirmar`、打印、价格写入，默认不自动点。

## 系统和入口

常用系统：

- 网页后台：`UnideGesV3` / `PedidosSocios`
- 桌面程序：UnideGes / MadisaNet / Backoffice 一类窗口
- 店号：`74667`
- 店名常见显示：`QIANG GUO, SLU`

网页后台主要入口：

- `Gestión Tiendas > Pedidos`：订单、新建订单、复制订单、查看 PDA 自动订单。
- `Gestión Tiendas > Consultas > Artículos Unide`：查询 Unide 商品。
- `Gestión Tiendas > Incidencias`：订单问题。
- `Gestión Tiendas > Seguimiento > Resúmen Pedidos (REGATTE)`：跟进 REGATTE / PDA 类订单。
- `Mensajería Operativa`：下载 FEL / albarán / central 发来的操作文件。
- `Conciertos > Ofertas`：促销/报价相关。
- `Mensajería Informativa`：信息通知。

桌面程序常用入口：

- `Artículos`：商品资料、价格、EAN、bloqueo、库存、供应商信息。
- `Albarán electrónico`：处理 `.FEL`。
- `Etiquetas`：打印标签。

### Artículos 键盘快捷键（2026-07-08 从 Archivo 菜单实测抄录）

| 功能 | 快捷键 |
| --- | --- |
| Buscar（搜索） | `F3` |
| Guardar（保存） | `Ctrl+S` |
| Nuevo（新建/清空界面，≈工具栏 Vaciar pantalla） | `Ctrl+N` |
| Imprimir（打印） | `Ctrl+P` |
| Cerrar（关闭窗口） | `Alt+F4` |

- 表单字段之间用 `Tab` 跳、勾选框用空格、确认用 `Enter`，基本全键盘可走。
- `P. defecto` 字段旁标着 `F2`（用途待确认，改价自动化接键盘流程前先弄清）。
- 实测补充（2026-07-08 店主确认）：搜索的用法是**先把 código 输进
  Código 框，再按 `F3` 执行**；`Ctrl+N` 在 Artículos 里按了没反应，弃用。
  载入新商品会直接覆盖当前显示，所以不需要"清空"这一步。
- 关键实测（2026-07-08）：这台机器上 UnideGes 以管理员运行，注入的
  **鼠标点击它不处理**（光标能到位但无效），**键盘击键正常接收**。
  所以桌面自动化全部走键盘：不点任何坐标。bot 必须以管理员启动
  （start-bot.cmd 已自动请求 UAC）。
- 焦点锚点：把 Artículos 窗口**最小化再还原**（或 Alt+F4 关掉搜索后偶发
  的无用弹窗）之后，**按一次 Tab 焦点就落在 Código**。

### Artículos 的 Tab 顺序地图（2026-07-08 店主逐格实测）

从 Código 起按 Tab 依次经过（Código=0）：

| # | 字段 | # | 字段 |
| --- | --- | --- | --- |
| 1 | Texto largo | 18 | **PC Medio** |
| 2 | Texto TPV | 19 | **PC Último** |
| 3 | Sec. | 20 | **P.defecto** |
| 4 | Cat. | 21 | P.TPV |
| 5 | Sub. | 22 | Tipo precio（下拉，默认 variable，↓箭头切换） |
| 6 | Seg. | 23 | Proveedor |
| 7 | IVA | 24 | Ref. |
| 8 | Mar | 25 | Bloq.pedido（勾选） |
| 9 | T.Ar | 26 | T.Campaña（下拉） |
| 10 | Balanza TPV（勾选） | 27 | De |
| 11 | Nº Etiqueta | 28 | A |
| 12 | Tipo etiqueta | 29 | Per.Repos |
| 13 | Con etiq | 30 | Modulación |
| 14 | Und/Caja | 31 | Plataforma |
| 15 | Und/Frac | 32 | Mínimo |
| 16 | **Bloq.Venta（勾选，空格切换）** | 33 | Máximo |
| 17 | PLU | 34 | Inventariable（下拉，默认 sí，↓箭头一次=no） |

34 之后再按 4 次 Tab 回到 Código（中间 4 站未识别）。
勾选框用**空格**切换；下拉用**上下箭头**选（↑=sí/第一项，↓=下一项）。
bot 的 codeSearchSteps/priceReadSteps/priceApplySteps 全部基于这张图
（focus reactivate → Tab×1 到 Código → Tab×N 到目标字段）。

## 叫货规律

当前最稳规律：

| 星期 | 重点 | 目的 |
| --- | --- | --- |
| 周日 | PDA / 自动导入订单检查 | 11:00 前确认是否生成、是否异常 |
| 周一 | 第一轮肉类 + 果蔬检查 | 通常准备周三到货 |
| 周三 | 第二轮肉类 + 果蔬检查 | 通常准备周五到货，覆盖周末前需求 |
| 周四 | 可选补货 | 检查周末到周一缺口，不是固定必须订 |

肉类：

- 历史上最规律，一般周一和周三各一次。
- 周一量偏小，历史常见约 `20-30 kg`。
- 周三量偏大，历史常见约 `37-48 kg`。
- 订单名可用：`CARNE ddmm` 或 `PEDIDO CARNE ddmm`。
- 判断时先看肉柜库存、上一张同星期订单、周末/节假日/促销影响。

果蔬：

- 比肉类灵活，通常跟库存和损耗走。
- 历史明确果蔬单大约 `56-65 kg / 154-171 EUR`，但不能机械照抄。
- 周一/周三必须检查，周四只补明显缺口。
- 订单名可用：`FRUTA Y VERDURA ddmm` 或 `FRUTA ddmm`。

PDA：

- 周日重点，目标是 11:00 前确认。
- `Pedidos` 列表里通常看 `Pedido importado desde PDA Nro. xxx`。
- 常见一次出现两张，一张大、一张小，不要漏。
- 检查状态、重量、金额是否明显异常。
- 如果没有生成，不要急着手工补整单，先确认 PDA/导入流程。

PDA 扫货后的完整操作流程（2026-07 店主口述确认）：

1. 在 PDA 上扫完所有要叫的商品。
2. 在 PDA 上点 `Generar fichero`（生成文件）。
3. 把 PDA 和电脑连接（放回底座/接线）。
4. 在电脑上打开 `COMPC` 程序（负责把 PDA 里的文件传到电脑）。
5. 打开网页 `Gestión Tiendas > Pedidos`，点工具栏的 `Cargar Pedido`（加载订单）。
6. 订单加载进来后照常核对：状态、重量、金额、行数。
7. 确认无误后人工点 `Enviar Pedido` 发出。

注意：顺序不能乱——没点 `Generar fichero` 就连电脑，或者没开 `COMPC`
就去点 `Cargar Pedido`，都会加载不到东西。

EXTRA / HUEVOS：

- `EXTRA` 多半是临时补单，不当作规律。
- 鸡蛋历史样本少，不能当固定节奏。

## 新建 Pedido 手工流程

入口：网页后台 `Gestión Tiendas > Pedidos`

基本流程：

1. 点 `Nuevo`。
2. 填 `Nombre del Pedido`，例如 `CARNE 0307`。
3. 到 `Líneas del Pedido` 第一行输入商品 código。
4. 输入代码后按 `Enter`。
5. 再按 `Tab` 跳到 `Cajas` 数量位置。
6. 输入数量。
7. 按两次 `Enter` 进入下一商品。
8. 所有行检查无误后，人工决定是否 `Guardar`。
9. 保存后如果确定要下单，再人工点 `Enviar Pedido`。

已知店里电脑坐标：

- `Nuevo`：`327,177`
- `Nombre del Pedido`：`486,267`
- 第一个商品输入位置：`694,615`
- `Guardar`：`1859,178`，暂时不用自动点。

重要安全规则：

- 程序不要自动点 `Guardar`。
- 程序不要自动点 `Enviar Pedido`。
- 如果某个商品代码变了、查不到、卡在某一行，第一版最稳处理是截图给用户，人工处理。

## Telegram bot 当前能力

项目位置：

- 源码：`unide-frontend/tools/unide-product-bot`
- 发布给店里电脑的包：`unide-frontend/tools/unide-product-bot-store-pc.zip`
- 店里电脑更新方式：关掉 `start-bot` 黑窗口，双击 `update-bot`，更新完重新双击 `start-bot`。

当前最新版功能：

### 1. 商品查询

模板：

```text
/articulo
codigo: 620475
precio: auto
desbloquear: si
etiqueta: si
nota: FEL 92695469
```

它会：

- 解析 código / EAN / 价格 / 解锁 / 标签要求。
- 去桌面 `Artículos` 页面查询并截图。
- 查店内缓存和供应商表作为参考。
- 默认不会自动写入。

按钮：

- `再查一次`
- `确认处理`
- `标签`，目前只是预留入口。

### 2. 改价 / 解锁

状态：暂时先放一边，不作为当前重点。

原因：

- `SDC` 和 `TIENDA` 两行关系已理清（2026-07-08 店主确认）：Artículos 底部
  列表有两条记录，**SDC = 总部数据，不允许改；TIENDA = 店内数据，要改的
  是它**（列表最后一行）。窗口右上角的 SDC/TIENDA 字样显示当前载入的是
  哪条。bot 载入商品后自动选中 TIENDA 行，写入前还会读右上角指示牌验证，
  不是 TIENDA 就中止。
- `sin precio en la lista`、前台刷新、桌面显示之间有同步问题。
- `Bloq.Venta`、PC Medio、PC Último、P.defecto 的读写坐标和字段行为还不够稳。

已知方向：

- 成本优先用供应商表 `PVD`。
- 若写最终售价，按 UnideGes 公式计算 `P.defecto%`：
  `(目标 P.TPV / (1 + IVA%) - 成本) / 目标 P.TPV * 100`
- 若写 `margen`，直接填 `P.defecto%`。

当前建议：

- 改价格相关自动化暂停。
- 真要改价，先让 bot 查询和截图，再人工操作。

### 2b. 促销省钱策略（/ahorro）

- 命令：`/ahorro`（别名 `/estrategia`）。
- 数据源：最近一次 `/promociones` 生成的 CSV（不重新抓网页；数据超过
  2 天会提示先刷新）。
- 逻辑：每个促销商品都带"平时进价 PVD"和"促销进价"，直接算出省几个
  点；再和店里真正买的东西对上（在售商品表 🏪、carne 模板 🥩、水果
  código 表 🍎）打标。
- 输出：中文摘要（快结束的末班车 / 常购促销 / 全场力度榜 / 行动建议）
  + 完整明细 txt 附件。

### 2c. 单子对照促销（/ahorro_pedido）

- 命令：`/ahorro_pedido`（默认找最新的 PDA 大单）、`/ahorro_pedido 153`（按单号，
  精确匹配 Nro.）或 `/ahorro_pedido 名字片段`。
- 做什么：打开网页 Pedidos，读出这张单的**全部商品行和箱数**（多页会翻页读全），
  逐行对照促销 CSV：哪些行已享促销价、哪些行的促销马上结束（考虑在这单加量）、
  哪些正常价的行有**类似商品在促销**（可换着叫）、哪些相关大促不在单里。
  逐行明细 txt 附件。
- 类似商品匹配：配置了 `ANTHROPIC_API_KEY`（写在 .env 里，和 TELEGRAM_BOT_TOKEN
  一样）就用 Claude AI 判断"顾客真的可以换着买"的替代品，明细里带理由；
  没配就退回关键词匹配（第一个词=商品类型，两边都要一致）。config 里
  `llm.model` 可换模型，`llm.enabled: false` 可关。
- 定位：PDA 大单才值得优化；fruta/carne 小单量少，不必看。
- 只读：不改单子、不点 Guardar/Enviar。

### 3. 叫货提醒

命令：

```text
/pedido
/pedido carne
/pedido fruta
/pedido pda
```

它会按当天星期提醒：

- 周日：PDA 检查。
- 周一：第一轮肉类 + 果蔬检查。
- 周三：第二轮肉类 + 果蔬检查。
- 周四：可选补货。

### 4. 自动填 Pedido 草稿

命令：

```text
/pedido_nuevo
nombre: CARNE 0307
620002 1
620006 2
609950 1
```

当前逻辑：

1. 用户在 Telegram 发 `/pedido_nuevo` 模板。
2. bot 回显订单名和商品行，让用户点 `确认填入`。
3. bot 操作网页后台：
   - 点 `Nuevo`
   - 填订单名
   - 点第一行商品
   - 每行执行：`codigo -> Enter -> Tab -> cantidad -> Enter -> Enter`
4. 最后截图发 Telegram。

不会做：

- 不会点 `Guardar`。
- 不会点 `Enviar Pedido`。
- 不会确认发送。

截图规则：

- 新版如果截图发不出去，会直接说明失败原因。
- 如果只说“已执行”但没图，要查截图目录和 Telegram 发图错误。

## FEL / Albarán electrónico

网页下载入口：

1. 打开网页后台 `Mensajería Operativa`。
2. 搜索 `FEL` 或找当天 albarán / factura electrónica。
3. 勾选 `.FEL` 文件。
4. 点击下载。

桌面处理入口：

1. 打开桌面程序的 `Albarán electrónico`。
2. 看到 `.FEL` 列表。
3. 勾选待处理文件。
4. 点 `Procesar`。
5. 进入 albarán 明细。
6. 核对供应商、编号、金额、商品行。
7. 根据情况 `Guardar` / `Confirmar`。

关于 `Descartar todos Cambio` / `Actualizar Fecha Cambio`：

- 不是无脑一定点。
- 如果只是普通 FEL、商品和价格没问题，历史教学里常见流程是保存后处理变化，再确认。
- 如果有新商品、价格变化、PVP/成本异常，先检查，不确定就别确认。

标签：

- FEL 处理后如果弹出 `Etiquetas`，说明系统认为有商品需要标签。
- 如果货架价格已经一致，可以不一定打印。
- 如果已生成但不想打印，可人工确认是否删除/跳过，不要让程序自动打印。

## Oferta / 标签

开机弹出 `OFERTAS QUE SE VAN A ACTIVAR EN EL DÍA DE HOY`：

- 这是当天将生效的 oferta 列表。
- 不一定需要导入，通常表示系统已有促销信息或需要你注意/打印标签。
- 如果价格标签纸放反，可以重新进入 `Etiquetas` 或相关 oferta 标签列表再打印。
- 如果检查货架价和系统价已经一致，没必要为了打印而打印。

标签打印原则：

- 要看货架是否已有正确价格。
- 价格没变或货架已正确，可以不打。
- 真的要换价签时再打印。

### 水果/蔬菜换价格完整流程（2026-07 店主口述确认）

1. 在桌面打开 `Diseño Pantalla Unide`。
2. 进 `Frutas` 或 `Verduras` 面板。
3. 右键要换价格的水果/蔬菜，点 `Editar`。
4. 进 `Acción` 页，抄下它的 `código`。
5. 拿着 código 去 UnideGes 的 `Artículos` 搜这个 código，改价格。
6. 改完点关闭，会自动弹出跳转 `Etiquetas` 页面打印新价签。
7. 在标签页面点 `Etiq. Especiales`。
8. 勾选 `Imprimir`；`Tipo Etiqueta` 全部改成 `Tipo Display 8 A4 vertical`。
9. 最后点 `Imprimir` 打印。

注意：水果/蔬菜的价格入口在 Diseño Pantalla（触摸屏面板），不能只在
Artículos 里搜名字——先从面板拿准确的 código 再去改，避免改错品种。

半自动化（2026-07 起，bot 命令 /precio_fruta）：

- `/precio_fruta melocotón 2,99`：bot 查 código（本地表搜索 + 你点选确认，
  选过一次就记住存进 data/frutas-codigos.json），然后走桌面 Artículos 的
  坐标流水线把价格填好，截图给你，「确认写入」才真正写。
- 第 6-9 步（Etiquetas 打印）保持手动，写入成功后 bot 会把打印步骤发给你。
- `/fruta_add 名字 código`：手动登记一个面板 código（本地表搜不到时用）。
- 水果/蔬菜可以走这个自动化；当初"改价自动化暂停"针对的是资料不一致的
  普通商品，不适用于果蔬。
- 保存的必填校验（2026-07-08 实测）：Proveedor 和 Inventariable 为空时
  UnideGes 拒绝保存。规则（前任顾问教的）：不知道进货来源的水果就填一个
  小众 proveedor。店里自建了 **4214 = don fruta** 专门当"无主水果默认
  供应商"；bot 只在字段为空时自动补（代码框填 4214），已有值绝不覆盖。
  Inventariable 为空时补 si。

## 商品资料判断

数据源优先级：

1. 桌面 UnideGes `Artículos` 实时查询。
2. 店内缓存 / `UNIDE LISTADO`，只作辅助。
3. 供应商 Excel / 清洗 CSV，作参考。

原因：

- `UNIDE LISTADO.xls` 可能不完整或不准。
- 有些收银台扫不出，但桌面系统里可能存在。
- 有些供应商表里有，但店里未生效。
- 有些商品店里已生效，但供应商表未必能查到。

商品查询最佳流程：

1. 先用桌面 `Artículos` 望远镜查 código / EAN。
2. 查到就以桌面结果为准。
3. 桌面查不到，再看供应商表。
4. 供应商表也没有，就回复“没有找到”，不要硬创建。

## 店里电脑常见问题

bot 不反应：

- 看 `start-bot` 黑窗口是否还开着。
- 看 `.env` 里 `TELEGRAM_BOT_TOKEN` 是否正确。
- 看 `allowedChatIds` 是否有你的 chat id。

更新：

- 先关掉 `start-bot`。
- 双击 `update-bot`。
- 看到更新完成后重新双击 `start-bot`。

截图不发：

- 新版会回失败原因。
- 可能是截图文件没生成、路径不可读、Telegram 发送失败。

找不到窗口：

- 确认 UnideGes 页面/桌面程序开着。
- 确认当前窗口标题能被 `windowTitleRegex` 匹配。
- 网页后台和桌面程序可能标题不同。

点错位置：

- 重新用 `calibrate-screen.cmd` 校准。
- 屏幕分辨率、缩放、窗口最大化状态改变都会影响坐标。

## 当前不要自动化的动作

这些先不要让程序自动做：

- 点击 `Enviar Pedido`
- 点击 `Guardar` 发送最终订单前的保存
- 点击 `Confirmar`
- 打印标签
- 批量改价
- 自动处理 `SDC` / `TIENDA` 价格关系
- 自动处理 FEL 中的价格变化

## 当前最有价值的下一步

优先继续完善自动叫货：

1. 让 `/pedido_nuevo` 在某个商品卡住时自动停止并截图。
2. 支持一键生成肉类/果蔬模板。→ 已做（2026-07）：/carne 点货单。
   肉类纸质点货表（打印的 CODIGO+NOMBRE 那张）替换为 Telegram 点选：
   发 /carne，28 个肉类商品变成按钮，点名字数量 +1（点到 5 归零），
   「清零」重来，「✔ 生成订单」直接变成 /pedido_nuevo 的确认草稿
   （订单名自动 CARNE ddmm），后面就是老流程：确认填入 → 人工 Guardar。
   商品清单可在店里电脑 data/plantilla-carne.json 修改（不改就用内置
   的 28 个）。果蔬模板同机制，以后加 data/plantilla-fruta.json 即可。
3. 从上一张同星期订单提取商品清单，用户只改数量。
4. 最终形成“准备草稿 -> 截图确认 -> 人工保存 -> 人工发送”的稳定流程。

改价/新增商品自动化先不推进，等 `SDC/TIENDA`、前台同步、价格字段逻辑都理清后再继续。

## 当前文件可信度

最可信：

- `unide-frontend/tools/unide-product-bot/README.md`
- `unide-frontend/tools/unide-product-bot/src/orderAssistant.js`
- `unide-frontend/tools/unide-product-bot/src/config.js`
- `unide-frontend/tools/unide-product-bot/desktop/unideges-search.ps1`
- `unide-frontend/tools/unide-product-bot-store-pc.zip`
- 本文件：`video-study/Unide当前顾问总手册.md`

旧资料但有参考价值：

- `video-study/后台系统顾问手册.md`
- `video-study/叫货规律与提醒计划.md`
- `video-study/顾问记忆卡片-叫货.md`
- `video-study/FEL处理-超级简化版.md`
- `video-study/wechat-training/微信教学视频学习笔记-中文.md`
- `video-study/顾问记忆卡片-商品自动化.md`

不要优先信：

- 旧的解压副本 `unide-frontend/tools/unide-product-bot-store-pc/`
- 未同步的新旧配置混合文件
- 单独的历史 Excel 导出表

