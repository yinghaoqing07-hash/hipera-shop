# 店里电脑 Codex 交接说明

这是 UnideGes 商品 Telegram 查询助手第一版。

## 当前目标

做一个稳一点的半自动工具：

- Telegram 收到商品模板。
- 优先去 UnideGes 桌面程序 `Artículos` 页面用望远镜查询商品。
- 把查询截图发回 Telegram。
- 同时查本地供应商商品表，给 PVP/PVD 参考。

## 第一版安全边界

第一版只查询，不自动修改。

不要让程序执行这些动作：

- 不改 PVP。
- 不取消 `bloqueo para la venta`。
- 不点 `Guardar`。
- 不点 `Confirmar`。
- 不点 `Enviar cambios`。
- 不打印 etiqueta。

等桌面查询稳定后，下一版才考虑“用户 Telegram 确认后再改价/解除 bloqueo”。

## 业务判断

`UNIDE LISTADO.xls` 不够准，只能当缓存。

最终 source of truth 是：

- UnideGes 桌面程序
- `Artículos`
- 望远镜查询结果

供应商表 `data/supplier_products_clean.csv` 只作为参考：

- 查供应商有没有这个商品。
- 查 EAN。
- 查 PVP1/PVP2/PVD。

如果桌面 `Artículos` 查得到，就以桌面系统为准。
如果桌面查不到，再看供应商表。

## 店里电脑安装

1. 解压 `unide-product-bot-store-pc.zip`。
2. 进入 `unide-product-bot` 文件夹。
3. 运行：

```powershell
powershell -ExecutionPolicy Bypass -File setup-store-pc.ps1
```

4. 在 `.env` 填 `TELEGRAM_BOT_TOKEN`。
5. 双击 `start-bot.cmd`。
6. Telegram 发 `/whoami`，把 chat id 填进 `config.local.json` 的 `allowedChatIds`。
7. 打开 UnideGes 桌面程序并进入 `Artículos`。
8. 双击 `calibrate-screen.cmd`，记录坐标。
9. 把望远镜按钮和查询输入框坐标填进 `config.local.json`。
10. 把 `desktop.enabled` 改成 `true`。
11. 再双击 `start-bot.cmd`。

## Telegram 模板

```text
/articulo
codigo: 620475
precio: 3,49
desbloquear: si
etiqueta: si
nota: FEL 92695469
```

批量：

```text
/articulos
620475 3,49 desbloquear etiqueta
620207 auto desbloquear etiqueta
619866 4,99 desbloquear
```

## 常见问题

如果报找不到窗口：

- 确认 UnideGes 桌面程序打开了。
- 确认已经进入 `Artículos` 页面。
- 必要时把 `config.local.json` 的 `windowTitleRegex` 改得更精确。

如果点错位置：

- 重新运行 `calibrate-screen.cmd`。
- 重新填坐标。
- 确认屏幕分辨率没有变。

如果 Telegram 没反应：

- 确认 `start-bot.cmd` 还在运行。
- 确认 `.env` 里的 token 正确。
- 确认 `allowedChatIds` 填的是 `/whoami` 返回的 chat id。

## GitHub 一键更新

新版包含 `update-bot.cmd`。

店里电脑以后可以双击 `update-bot.cmd`，从 `update-url.txt` 里的 GitHub Release 下载最新版 zip，并调用 `apply-update.ps1` 更新程序。

注意：

- 更新前先关掉 `start-bot.cmd`。
- `.env` 和 `config.local.json` 会保留。
- 更新完成后重新启动 `start-bot.cmd`。
- GitHub Release 必须已有 `unide-product-bot-store-pc.zip` 这个资产。
