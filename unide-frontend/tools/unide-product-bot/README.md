# Unide 商品 Telegram 查询助手

当前目标：**先查询，确认后才允许写入价格/解锁；不会自动确认或打印**。

Telegram 收到商品模板后，程序会：

1. 解析商品编码、条码、价格、是否要 desbloquear / etiqueta。
2. 优先调用店里电脑上的 UnideGes 桌面 `Artículos` 查询脚本。
3. 把查询后的截图发回 Telegram。
4. 顺手查一下供应商商品表，给出建议价和 PVD 成本参考。
5. 点 `确认处理` 后用供应商 PVD 作为成本并计算要填的 `P.defecto%`；点 `确认写入` 后才会操作桌面程序。

## 准备

进入目录：

```powershell
cd C:\Users\yingh\OneDrive\桌面\unide-frontend\unide-frontend\tools\unide-product-bot
```

如果是在店里电脑第一次安装，最简单是把 `unide-product-bot-store-pc.zip` 解压到桌面，然后进入解压出来的 `unide-product-bot` 文件夹。

店里电脑先运行：

```powershell
powershell -ExecutionPolicy Bypass -File setup-store-pc.ps1
```

它会帮你生成 `.env` 和 `config.local.json`。

复制配置：

```powershell
Copy-Item .env.example .env
Copy-Item config.example.json config.local.json
```

在 `.env` 里填 BotFather 给你的 token：

```text
TELEGRAM_BOT_TOKEN=你的token
```

先启动一次：

```powershell
node src\bot.js --config config.local.json
```

或者直接双击：

```text
start-bot.cmd
```

在 Telegram 给 bot 发：

```text
/whoami
```

bot 会回你的 `chat id`。把这个数字填进 `config.local.json` 的：

```json
"allowedChatIds": [123456789]
```

## 校准店里电脑坐标

在店里电脑打开 UnideGes 桌面程序，并进入 `Artículos` 页面。

运行鼠标坐标工具：

```powershell
powershell -ExecutionPolicy Bypass -File desktop\calibrate-screen.ps1 -WatchSeconds 30
```

或者直接双击：

```text
calibrate-screen.cmd
```

把鼠标分别移动到：

- `望远镜查询按钮`
- 查询弹窗里的 `输入框`

记下屏幕上显示的 `x` / `y`，填到 `config.local.json` 的 `desktop.steps` 里对应两个 `click` 步骤。

同时把当前屏幕尺寸填到：

```json
"expectedScreen": {
  "width": 1920,
  "height": 1080
}
```

确认坐标填好后，把：

```json
"enabled": false
```

改成：

```json
"enabled": true
```

如果脚本找错窗口，把 `windowTitleRegex` 改得更精确一点。默认会排除 `chrome`、`msedge`、`firefox`，避免误切到 UnideGes 网页标签页。

## Telegram 模板

单个商品：

```text
/articulo
codigo: 620475
precio: 3,49
desbloquear: si
etiqueta: si
nota: FEL 92695469
```

没写价格，使用供应商建议价：

```text
/articulo
codigo: 620475
precio: auto
desbloquear: si
etiqueta: si
```

批量查询：

```text
/articulos
620475 3,49 desbloquear etiqueta
620207 auto desbloquear etiqueta
619866 4,99 desbloquear
```

第一版批量默认最多处理 5 个，避免桌面查询卡住。

## 回复怎么理解

如果桌面查询开启，bot 会发截图。你看截图确认：

- 是不是查到了商品。
- 商品名是不是对的。
- 当前价格和你想改的价格是否一致。
- 有没有 bloqueo。

供应商表里的 PVP 只是参考，最终还是以桌面 UnideGes `Artículos` 页面为准。

## 安全规则

- `allowedChatIds` 不为空时，只接受这些 Telegram 聊天。
- 查询后不会自动写入；必须先点 `确认处理`，再点 `确认写入`。
- 不会点击 `Confirmar`、`Enviar cambios`。
- 不会自动打印 etiqueta。
- 每次桌面查询都会保留截图和日志。

## 本地测试解析

不用 Telegram，也可以先测试模板解析：

```powershell
@"
/articulo
codigo: 620475
precio: 3,49
desbloquear: si
etiqueta: si
"@ | node src\test-message.js --config config.local.json
```

## 生成给店里电脑的 zip

在当前电脑运行：

```powershell
powershell -ExecutionPolicy Bypass -File make-store-pc-package.ps1
```

会生成：

```text
..\unide-product-bot-store-pc.zip
```

把这个 zip 发到店里电脑并解压即可。

## Telegram 按钮

查询结果下面会显示按钮：

- `再查一次`：用同一个商品码/条码重新查。
- `确认处理`：用供应商 PVD 作为 `PC Medio/PC Último`，读取 `Bloq.Venta`，计算要填的 `P.defecto%`。
- `标签`：未来入口，现在只提示，不执行。


## Telegram 发 zip 更新

装上这个版本以后，后续更新可以直接把新版 `unide-product-bot-store-pc.zip` 发给 bot。

规则：

- 只接受 `allowedChatIds` 里的用户。
- 文件名必须是 `unide-product-bot-store-pc.zip`。
- 更新时会保留 `.env` 和 `config.local.json`。
- 更新完成后，需要关掉黑窗口并重新双击 `start-bot.cmd`，新版代码才会生效。

这让店里电脑以后不用再走微信、U盘或手动解压覆盖。

## GitHub 一键更新

店里电脑装上这个版本后，以后可以直接双击：

```text
update-bot.cmd
```

它会从 `update-url.txt` 里的 GitHub 地址下载最新版：

```text
https://raw.githubusercontent.com/yinghaoqing07-hash/hipera-shop/main/unide-frontend/tools/unide-product-bot-store-pc.zip
```

更新规则：

- 更新前先关掉正在运行的 `start-bot.cmd` 黑窗口。
- 更新会保留 `.env` 和 `config.local.json`。
- 更新完重新双击 `start-bot.cmd`。
- 如果 GitHub 还没有推送新版 zip，下载会失败，这是正常的，需要先发布 zip。

也可以测试更新脚本但不下载：

```powershell
powershell -ExecutionPolicy Bypass -File update-bot.ps1 -DryRun
```

## 改价处理

改价使用两步确认：

1. 查询商品后点 `确认处理`。
2. bot 用供应商 PVD 作为 `PC Medio/PC Último`，读取 `Bloq.Venta` 状态并计算 `P.defecto%`。
3. Telegram 显示计划，点 `确认写入` 后才会真正写桌面程序。

需要在 `config.local.json` 里校准：

- `desktop.priceReadSteps`：只需要 `Bloq.Venta` 勾选框中心坐标；旧配置里保留 `PC Medio/PC Último` 也不会再用于计算。
- `desktop.priceApplySteps`：`Bloq.Venta` 勾选框中心坐标，`P.defecto%` 输入框坐标，保存按钮坐标。

成本选择顺序：

1. 供应商表 `pvd_promocion`
2. 供应商表 `pvd`
3. 店内缓存 `coste_ultimo/coste_medio`

模板可以写最终售价：

```text
/articulo
codigo: 620475
precio: 3,49
```

也可以写 margen：

```text
/articulo
codigo: 620475
margen: 30
```

如果写 `margen`，程序会直接把这个百分比填入 `P.defecto`。如果只写 `precio` 或 `precio: auto`，程序会按 UnideGes 公式 `(目标 P.TPV / (1 + IVA%) - 成本) / 目标 P.TPV * 100` 计算要填的 `P.defecto%`。
