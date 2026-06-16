# v2-subscription-publisher

独立的节点订阅发布项目。它不会修改本机原始项目 `E:\Github project\v2finder-master`，而是单独抓取公开订阅源，清洗、测试、按国家分类，并生成可由网页读取的静态订阅文件。

## 输出

运行后生成：

```text
dist/
├─ manifest.json
└─ subscribe/
   ├─ us.txt
   ├─ us.yaml
   └─ ...
```

`manifest.json` 给 Lovable 网站读取，`subscribe/*.txt` 和 `subscribe/*.yaml` 是客户端订阅文件。

## 本地运行

```powershell
npm install
npm run update
npm run check
```

如果需要生成完整公网链接：

```powershell
$env:BASE_URL="https://你的用户名.github.io/v2-subscription-publisher"
npm run update
```

## GitHub Pages

`.github/workflows/update.yml` 会在北京时间每天 08:00 运行，也支持手动触发。工作流会生成 `dist` 并发布到 GitHub Pages。

发布后固定链接类似：

```text
https://你的用户名.github.io/v2-subscription-publisher/manifest.json
https://你的用户名.github.io/v2-subscription-publisher/subscribe/us.txt
https://你的用户名.github.io/v2-subscription-publisher/subscribe/us.yaml
```

## Lovable 对接

Lovable 网站只读取 `manifest.json`，不要读取本机 E 盘路径，也不要在前端运行爬虫。

## 免责声明

节点来自公开互联网来源，仅供学习和研究使用。节点稳定性、安全性和可用性不作承诺，使用者需自行遵守当地法律法规。
