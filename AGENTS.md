# AGENTS.md

## 项目目标

将公开代理节点自动抓取、清洗、测试、按国家分类，并生成 GitHub Pages 可发布的静态订阅文件，供 Lovable 网站读取和展示。

## 技术栈

- Node.js
- GitHub Actions
- GitHub Pages
- JavaScript ESM

## 目录结构

```text
config/
  countries.json      # 展示的 10 个国家/地区及别名
  sources.json        # 公开订阅源
scripts/
  update.js           # 抓取、清洗、测试、分类、生成订阅
  check-output.js     # 校验 dist 输出
dist/
  manifest.json       # 网站读取入口，运行时生成
  subscribe/          # txt/yaml 订阅文件，运行时生成
.github/workflows/
  update.yml          # 每日定时生成并发布 GitHub Pages
```

## 启动命令

```powershell
npm install
npm run update
```

## 测试/验证命令

```powershell
npm run check
```

## Git 规则

- 不要自动推送远程仓库，除非用户明确要求。
- 提交前检查不要包含 Token、Cookie、密码、私有订阅地址。
- `dist/` 默认不纳入 Git，GitHub Actions 会即时生成并发布。

## 注意事项

- 禁止修改 `E:\Github project\v2finder-master`。
- 前端网站不要读取本地 E 盘文件，必须读取公网 `manifest.json`。
- 单个订阅源失败不能导致整个任务失败。
- 完全没有生成可用节点时，脚本返回失败，方便 GitHub Actions 暴露问题。

## 已知问题

- YAML 转换优先覆盖常见 vmess/vless/trojan/ss，复杂插件参数可能被跳过。
- GitHub Actions 网络环境和本地不同，节点源可访问性可能不同。
