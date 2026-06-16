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
$env:BASE_URL="https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist"
npm run update
```

## GitHub Actions publishing

`.github/workflows/update.yml` runs every day at Beijing 08:00 and can also be triggered manually. The workflow fetches all configured sources, tests all parsed nodes with up to 400 concurrent TCP checks, generates `dist`, and commits it back to the repository.

Public links use jsDelivr CDN:

```text
https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist/manifest.json
https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist/subscribe/us.txt
https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/dist/subscribe/us.yaml
```

For this repository:

```text
https://cdn.jsdelivr.net/gh/huima5602-collab/v2finder-@main/dist/manifest.json
```

## Lovable 对接

Lovable 网站只读取 `manifest.json`，不要读取本机 E 盘路径，也不要在前端运行爬虫。

`UNKNOWN` is generated for nodes whose country cannot be recognized or whose country is outside the 10 configured countries/regions.

## 免责声明

节点来自公开互联网来源，仅供学习和研究使用。节点稳定性、安全性和可用性不作承诺，使用者需自行遵守当地法律法规。
