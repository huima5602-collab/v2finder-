# Proxy Node Hub Web

这是 `v2finder-` 仓库的 Vercel 前端页面，位于 `web/` 目录，避免影响根目录的 GitHub Actions 节点抓取脚本。

## Vercel 设置

在 Vercel 导入仓库 `huima5602-collab/v2finder-` 时，请设置：

- Framework Preset: Other
- Root Directory: `web`
- Build Command: 留空
- Output Directory: 留空

该页面是纯静态 HTML，运行时会读取：

```txt
https://raw.githubusercontent.com/huima5602-collab/v2finder-/main/dist/manifest.json
```

只要 GitHub Actions 更新并提交 `dist/manifest.json` 和 `dist/subscribe/*`，页面刷新后会读取最新数据。
