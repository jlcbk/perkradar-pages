# PerkRadar — GitHub Actions + GitHub Pages 零服务器部署指南

本目录已在原版 [luobinger/PerkRadar](https://github.com/luobinger/PerkRadar) 基础上完成了 **GitHub Pages 纯静态看板改造**，保留 100% 原版 UI（搜索、来源筛选、分类过滤、只看新增、浏览器本地收藏与标记已领），无需任何自备服务器或常驻机器。

---

## 一、核心改动文件清单

- [`scripts/pages-fetch.ts`](./scripts/pages-fetch.ts)：在 GitHub Actions 中运行一轮 7 源并发抓取，更新 SQLite（保留近 7 天历史与「本轮新增」状态），导出完整前端状态至 `public/board.json`，并刷盘关闭 WAL。
- [`scripts/pages-build.mjs`](./scripts/pages-build.mjs)：自动识别仓库子路径（`basePath`），在隔离临时目录执行 Next.js `output: "export"` 静态构建，产出带 `.nojekyll` 的纯静态站点 `./out`。
- [`src/lib/board-client.ts`](./src/lib/board-client.ts) & [`src/components/deal-board.tsx`](./src/components/deal-board.tsx)：静态模式下改为直接拉取同源 `./board.json`，页面右上角「同步快照」按钮支持随时拉取最新已发布的快照。
- [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)：每小时定时运行（并支持手动一键触发），利用 `actions/cache` 跨轮次持久化 `deals.db`，抓取构建后自动发布到 GitHub Pages。

---

## 二、推送到你自己的 GitHub 仓库并上线（仅需 4 步）

### 第 1 步：在 GitHub 新建一个空仓库
登录 GitHub 新建仓库（例如命名为 `perkradar-pages`；注意免费账号启用 GitHub Pages 需设为 Public 公开仓库）。

### 第 2 步：在本目录提交并推送到你的仓库
```bash
git add .
git commit -m "feat: support static export and GitHub Pages auto-deploy"

# 将远程地址改为你自己的仓库地址后推送到 main 分支
git remote set-url origin https://github.com/jlcbk/perkradar-pages.git
git push -u origin main
```

### 第 3 步：开启 GitHub Pages（选 GitHub Actions 模式）
1. 打开你的 GitHub 仓库页面 → 点击顶部 **Settings** → 左侧栏找到 **Pages**。
2. 在 **Build and deployment -> Source** 下拉框中，将默认的 `Deploy from a branch` 改为 **`GitHub Actions`**（改完自动生效，无需再选分支）。

### 第 4 步：（可选但推荐）配置免费 `JINA_API_KEY`
为避免 GitHub 海外机房共享 IP 匿名请求 `r.jina.ai`（用于抓 LINUX DO 福利羊毛板块）偶发限流：
1. 在 [jina.ai/reader](https://jina.ai/reader/) 免费获取一个 API Key。
2. 在你的 GitHub 仓库 **Settings -> Secrets and variables -> Actions** 中，点击 **New repository secret**：
   - Name：`JINA_API_KEY`
   - Secret：粘贴你的 Key

---

## 三、查看与日常使用

1. **首次触发**：在第 3 步开启 `GitHub Actions` 作为 Pages 来源后，进入仓库顶部的 **Actions** 页面 → 左侧点击 **Fetch & Deploy GitHub Pages** → 右侧点击 **Run workflow** 手动触发第一次运行（约 1～2 分钟完成）。
2. **打开看板**：运行变绿后，直接打开：
   `https://jlcbk.github.io/perkradar-pages/`
3. **自动更新**：之后每隔 **1 小时** GitHub 会自动抓取最新消息并更新页面；收藏和已领记录保存在你当前浏览器的 `localStorage` 中，跨轮次刷新不会丢失。
4. **本地预览测试命令**（如需在本机测试构建）：
   ```bash
   # 离线生成空快照并验证静态打包
   SKIP_LIVE_FETCH=1 npm run pages:fetch && npm run pages:build

   # 或者在本机真实抓一轮并打包静态网页到 ./out
   npm run pages
   ```

---

## 四、架构说明

1. 原项目内置 7 个公开信息源（LINUX DO 经 Jina Reader、V2EX、Epic、NodeSeek、小众软件、果核剥壳、异次元），由运行环境并发直连抓取。
2. 为实现「零自备服务器 + 保留原版看板 UI（搜索/筛选/收藏/已领）」，本分支改为 **GitHub Actions 定时抓取（`actions/cache` 持久化 SQLite 7 天状态）+ Next.js 静态导出发布至 GitHub Pages**。
