# Plan：Capsa 部署形态收敛 —— 单服务编排、宿主 TLS 与 CI 镜像交付

**状态**：PENDING
**日期**：2026-09-16
**版本**：v1.0
**关联基线**：`.docs/09-13-v3/Plan.md`（Phase 3 容器编排与交付）、`.docs/SCOPE.md` §项目备注 2、`.docs/Project.md` §2 / §3 / §4
**前置阶段**：Phase 3 已交付并归档于 `.docs/09-13-v3/`
**回归基线（规划时实测）**：`.venv/bin/python -m pytest -q` → 161 passed，0 failed，0 skipped

---

## 1. 背景与目标

### 1.1 背景

Phase 3 交付的部署形态自带两个容器：`capsa` 应用容器与 `caddy` 边缘容器，compose 以 `build: .` 在本机构建镜像，Caddy 在容器内终止 TLS 并申请证书，`Caddyfile` 由仓库提供。

这套结构在个人 VPS 场景下引入了三项成本：

- **镜像构建落在部署机**：compose 用 `build` 而非 `image`，VPS 必须具备完整构建链（Node 20 + Python 3.12 + 构建缓存），每次部署都要重跑前端构建；
- **TLS 与应用耦合在同一个 compose 项目内**：证书申请、续期、域名配置被绑进仓库，宿主机已有的反向代理（或后续要接入的面板）无法复用；
- **仓库内维护一份 Caddyfile**：它只服务于这一种反代选型，换成宿主 Nginx / Nginx Proxy Manager / Traefik 时这份配置即成为死代码。

仓库当前状态（规划时实测）：

| 项 | 现状 |
|---|---|
| `docker-compose.yml` | 两个服务（`capsa` / `caddy`）、四个卷、`build: .`、`caddy` 依赖 `capsa` 的 `service_healthy` |
| `Caddyfile` | 仓库根，含 `max_size 1MB` 与 `flush_interval -1` |
| `Dockerfile` | 两阶段，自包含，不依赖仓库外的构建步骤 |
| `.github/` | 不存在 |
| `README.md` | 不存在 |
| git remote | 无，仓库仅有本地 `master` 分支 |
| 本机 Docker | 不存在（`docker` 命令 not found），与 Phase 3 判定一致 |

### 1.2 目标

| # | 目标 | 判定方式 |
|---|------|---------|
| 1 | compose 收敛为单服务，且不再在本机构建镜像 | compose 解析后服务集合为单元素、服务内无 `build` 字段、存在 `image` 字段 |
| 2 | 移除仓库自带的 TLS 终止与反代组件 | 仓库根不存在 `Caddyfile`；compose 不含 `caddy` 服务与 `caddy-*` 卷 |
| 3 | 容器端口按最小暴露面发布，由宿主反代接入 | compose 的端口映射默认绑定回环地址，可用环境变量覆盖绑定地址 |
| 4 | README 说清定位、架构、部署与运维 | README 含架构可视化、部署步骤、宿主 TLS 接入、备份与 CLI 速查；文中每条命令可直接执行 |
| 5 | 建立 GitHub 私有仓库并推送全部历史 | `gh repo view` 可读且 `visibility == PRIVATE`；远端 `master` 与本地一致；推送内容不含被忽略产物 |
| 6 | CI 手动触发构建并推送镜像到 GHCR | 工作流触发器仅 `workflow_dispatch`；`gh workflow run` 后运行结论为 success；GHCR 包版本含本次标签 |
| 7 | compose 改为拉取镜像部署 | compose 的 `image` 指向 GHCR 镜像地址，标签可由环境变量覆盖；VPS 侧只需 `docker compose pull && up -d` |
| 8 | 既有回归不破 | `.venv/bin/python -m pytest -q` 全绿且用例数不少于 161 |

### 1.3 非目标

| 不在本阶段 | 归属 |
|-----------|------|
| 在 VPS 上实际执行 `docker compose up` 与宿主反代接入 | 本机无 Docker，由用户在个人 VPS 验收 |
| 容器镜像的漏洞扫描、多架构（arm64）构建、镜像签名 | 无需求来源，个人单架构场景无收益 |
| push 到 tag 或 main 分支时自动构建 | 用户要求手动触发，自动触发会消耗 Actions 配额 |
| 在 CI 中运行 pytest 与 Playwright | 用户只要求构建镜像；补齐需在 runner 安装 Node 与 Chrome，超出本次请求 |
| 重写已归档的 Phase 3 设计文档中的 Caddy 陈述 | 归档目录是历史快照，事实变更记录在 `.docs/Project.md` §8 与本次归档中 |
| 仓库内置 `.dockerignore` | CI 检出目录干净，compose 不再本地构建，无构建上下文膨胀问题 |

---

## 2. 契约收敛

### 2.1 职责边界：应用归容器，TLS 归宿主

单服务编排后，职责只有一条分界：

| 层 | 归属 | 内容 |
|---|------|------|
| 应用层 | 本仓库 + 镜像 | HTTP 服务的完整实现：MCP 端点、Web API、静态 SPA、健康检查、请求体上限 |
| 边缘层 | 宿主机 | TLS 证书申请与续期、域名路由、公网监听、反代到容器发布的回环端口、响应不缓冲（流式下发） |

这条分界决定了三件事：仓库不再提供边缘配置；容器不再申请证书；端口发布默认只绑回环，公网入口一律由宿主反代承担。

### 2.2 请求体上限的唯一归属

Phase 3 的 1MB 上限在两层各有一份实现：Caddy 的 `request_body max_size` 与 Starlette 的 `RequestBodyLimitMiddleware`。移除 Caddy 后，应用层的 `RequestBodyLimitMiddleware` 是唯一执行点，宿主反代无需重复配置上限。

依赖的行为不变：超限请求返回 413，响应体为中间件的纯文本而非 `/api` 统一信封。该契约由既有用例覆盖，本阶段不得改动。

### 2.3 镜像地址与标签

- 镜像地址在 CI 与 compose 两处出现，必须指向同一个包：`ghcr.io/<owner>/<repo>`（全小写）。CI 从 `GITHUB_REPOSITORY` 派生并转小写，避免仓库改名后两处漂移；
- 标签由触发时的手动输入决定，默认 `latest`；compose 侧标签用环境变量覆盖，生产可用具体版本号回滚，不把 `latest` 写死为唯一可能；
- 私有仓库对应私有的 GHCR 包，VPS 拉取前必须 `docker login ghcr.io`，凭据用具备 `read:packages` 的 PAT。README 必须写出这一步，否则首次部署必定 401。

### 2.4 CI 触发方式与权限

- 触发器仅 `workflow_dispatch`，不做 push 与 tag 自动触发；
- 输入只有一个：镜像标签，默认 `latest`；
- 权限最小化：`contents: read` 与 `packages: write`，不使用 PAT 密钥，登录 GHCR 用工作流内置的 `GITHUB_TOKEN`；
- 构建走 `docker/build-push-action`，启用 GitHub Actions 缓存减少前端依赖与 pip 层的重复下载；
- 工作流不运行测试套件，不产出除镜像外的任何工件。

### 2.5 compose 的单服务契约

- 服务集合恰为 `{capsa}`，四个卷收敛为两个（`capsa-data` / `capsa-backup`），`caddy-data` 与 `caddy-config` 随反代移除；
- 服务内不出现 `build`；`image` 指向 GHCR；`restart: unless-stopped` 不变；
- 健康检查不在 compose 内重复声明。镜像的 `Dockerfile` 已含 `HEALTHCHECK` 且指向 `/healthz`，compose 再写一份即产生第二处间隔与超时定义；
- 数据卷挂载与 `CAPSA_DB_PATH` 环境变量保持不变，既有备份 Cron 行继续可用。

### 2.6 README 的范围

README 面向「把这个服务装到 VPS 上的人」，只写可执行事实：定位、架构、部署命令、宿主 TLS 接入要点、宿主反代的流式要求、备份运维、CLI 与 MCP 接入速查、镜像构建方式、文档索引。不写开发过程、不写未实现能力、不复制 `.docs/` 的设计推演。

### 2.7 归档文档的处理

`.docs/09-13-v3/docs/` 内的设计报告与分期规划描述了含 Caddy 的旧形态。这些文件是 Phase 3 的历史快照，本阶段不回溯改写；事实变更按 SSOT 原则记录在 `.docs/Project.md` §3 / §4 / §8 与本次归档文档中，README 描述的是当前形态。

---

## 3. 阶段划分

### Phase 4.1：compose 收敛为单服务

| 项目 | 内容 |
|------|------|
| **输入** | 现网 `docker-compose.yml`、`Caddyfile`、`tests/test_phase3_deploy.py` |
| **输出** | 单服务 compose、删除 `Caddyfile`、按新契约改写的编排静态校验用例 |
| **验收标准** | compose 可被 `yaml.safe_load` 解析；服务集合为 `{capsa}`；无 `build` 字段；卷集合为 `{capsa-data, capsa-backup}`；仓库根无 `Caddyfile`；`pytest tests/test_deploy.py -v` 退出码 0 |

### Phase 4.2：CI 镜像构建工作流

| 项目 | 内容 |
|------|------|
| **输入** | Phase 3 的 `Dockerfile`（自包含两阶段构建） |
| **输出** | `.github/workflows/build-image.yml`，手动触发、构建并推送 GHCR；对应的静态校验用例 |
| **验收标准** | 工作流 YAML 可解析；触发器仅 `workflow_dispatch` 且带默认标签输入；权限含 `packages: write`；登录使用 `GITHUB_TOKEN`；构建上下文为仓库根并推送 `Dockerfile` 产出的镜像 |

### Phase 4.3：README 与文档同步

| 项目 | 内容 |
|------|------|
| **输入** | Phase 4.1 与 4.2 的最终形态 |
| **输出** | `README.md`；`.docs/Project.md` 的编排、目录结构、运行方式与决策记录同步 |
| **验收标准** | README 中每条命令与路径在仓库中实际存在或可直接执行；Project.md 不再存在含 Caddy 的当前形态陈述；§8 新增本阶段决策 |

### Phase 4.4：建仓、推送与镜像验收

| 项目 | 内容 |
|------|------|
| **输入** | 前三阶段的全部产出 |
| **输出** | GitHub 私有仓库、远端 `master`、一次成功的 CI 构建、GHCR 上的镜像版本 |
| **验收标准** | `gh repo view` 显示 PRIVATE；远端与本地提交一致；`gh run watch` 结论 success；GHCR 包版本列表含本次标签；推送后 `git status --porcelain` 为空 |

---

## 4. 架构决策

| 决策项 | 选择 | 理由 | 替代方案（为何不选） |
|--------|------|------|---------------------|
| TLS 终止位置 | 宿主机反向代理 | 证书生命周期与应用发布解耦；宿主已有面板/反代可直接复用 | 仓库自带 Caddy 容器（绑定一种反代选型，证书状态混入应用 compose 项目） |
| 镜像来源 | compose 只写 `image`，构建全部交给 CI | VPS 无需构建链，部署退化为 pull + up；镜像成为可回滚的版本化产物 | 保留 `build: .`（VPS 需 Node 与 pip 构建能力，每次部署重跑前端构建） |
| 端口发布 | 默认绑定回环，环境变量可覆盖绑定地址 | 默认不向公网暴露明文端口；容器化反代场景可用网关地址覆盖 | 固定 `0.0.0.0:8000`（防火墙未配好即等于明文公网暴露）；固定回环（容器化反代无法接入） |
| 宿主反代的流式要求 | README 要求关闭响应缓冲 | MCP Streamable HTTP 依赖逐块下发；原 `Caddyfile` 的 `flush_interval -1` 正是承担该职责，移除后要求随之转移到宿主 | 不作说明（Nginx 默认 `proxy_buffering on`，表现为连接成功但工具结果迟迟不返回） |
| 健康检查归属 | 只保留 `Dockerfile` 的 `HEALTHCHECK` | 一处定义一处维护；单服务后不再需要 `depends_on` 的健康门控 | compose 内重复声明（两份间隔与超时参数，漂移无人发现） |
| 镜像标签策略 | 手动输入标签，默认 `latest`，compose 侧可覆盖 | 生产可用具体版本号部署与回滚，不必依赖可变标签 | 只用 `latest`（无法回滚）；用 git commit sha 自动派生（用户要求手动触发，sha 不可读） |
| CI 触发 | 仅 `workflow_dispatch` | 用户明确要求手动点击；避免每次推送消耗 Actions 配额与构建时间 | push 到 main 自动构建（非用户请求）；push tag 构建（同上） |
| GHCR 凭据 | 工作流内置 `GITHUB_TOKEN` | 无长期密钥入库，权限按 `packages: write` 最小授予 | 自定义 PAT 存入 Secrets（长期凭据，轮换成本） |
| 镜像地址派生 | CI 从 `GITHUB_REPOSITORY` 转小写派生 | 仓库改名后 CI 自动跟随，无需改文件 | 在 CI 内硬编码 owner/repo（改名即断） |
| 归档文档 | 不回溯改写，变更记入 SSOT 与新归档 | 归档是带日期的历史快照，改写会让历史与当时决策不符 | 回写旧报告（历史失真，且每次演进都要翻旧文档） |
| 测试策略 | 沿用既有约定：编排与 CI 文件做静态断言，不在 CI 内跑测试 | 与 Phase 3 的 `test_phase3_deploy.py` 同构，零新增依赖；镜像真实行为由一次手动运行验收 | 在 CI 内跑 pytest（需 runner 装 Python 与依赖，超出本次请求） |

---

## 5. 风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 本机无 Docker，编排与工作流的字段错误只能在 CI 或 VPS 上暴露 | 🔴 高 | §2.5 与 §2.4 固定字段契约，静态用例逐字段断言；CI 工作流由一次真实手动运行验收，VPS 部署列入用户验收项 |
| 移除 Caddy 后请求体上限出现空档 | 🟡 中 | §2.2 明确应用层中间件是唯一执行点；既有 413 用例必须保持全绿 |
| 宿主反代默认缓冲响应体，MCP 流式输出挂起 | 🔴 高 | §2.1 与 TASK-055 要求 README 写明宿主反代须关闭响应缓冲，并给出 Nginx 的 `proxy_buffering off`、`proxy_http_version 1.1`、`proxy_read_timeout 300s` 三条指令 |
| 端口默认绑定被改宽或反代接入方式未说明，导致要么公网明文暴露要么连不上 | 🟡 中 | §2.5 默认回环 + 环境变量覆盖；README 写明宿主进程与容器化反代两种形态各自的接入方式 |
| 私有 GHCR 包未登录即拉取，首次部署 401 | 🟡 中 | §2.3 与 README 显式给出 `docker login ghcr.io` 与 PAT 权限要求 |
| 推送时把忽略产物或本机工具链带入远端 | 🟡 中 | 推送前后各跑一次 `git status --porcelain` 与 `git ls-files` 抽查；`.gitignore` 已覆盖 `.venv/`、`.devtools/`、`node_modules/`、`capsa/static/`、`*.db` |
| 首次推送内容含历史密钥 | 🟡 中 | 推送前对全量 tracked 文件与历史做一次密钥模式扫描（令牌前缀、`.env`、`keys.json`） |
| CI 构建时间过长导致前端依赖层每次重装 | 🟢 低 | 启用 `type=gha` 构建缓存；工作流顶部注释说明缓存来源 |
| 已归档文档仍描述 Caddy 形态，读者误以为当前仓库含该文件 | 🟢 低 | §2.7 明确归档为历史快照；Project.md 与 README 描述当前形态并在 §8 记录变更 |

---

## 6. Phase 依赖关系

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 24px 1fr;gap:0;align-items:stretch">

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 4.1</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">compose 收敛为单服务</div>
  <div style="font-size:11px;color:#52525b">删 Caddyfile · 单服务 compose · 端口回环 · 静态用例改写</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 4.2</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">CI 手动构建镜像</div>
  <div style="font-size:11px;color:#52525b">workflow_dispatch · GITHUB_TOKEN · 推送 GHCR · 静态用例</div>
</div>

</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold;padding:12px 0 0 0">↓</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-top:12px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 4.3</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">README 与文档同步</div>
  <div style="font-size:11px;color:#52525b">架构可视化 · 部署与宿主 TLS 接入 · 运维速查 · Project.md 回填</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold;padding:12px 0 0 0">↓</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px;margin-top:12px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 4.4</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">建私有仓库、推送与镜像验收</div>
  <div style="font-size:11px;color:#52525b">gh repo create --private · 密钥扫描 · 手动触发构建 · GHCR 版本确认</div>
</div>

<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#71717a">
4.1 与 4.2 之间无代码依赖，可并行；4.3 依赖两者的最终形态；4.4 依赖前三者全部产出。VPS 实际部署与宿主 TLS 由用户验收，不在本阶段链路内。
</div>

</div>

</figure>

---

> ### Task 拆解预览
>
> 完整 Task 见 `Tasks.md`。Plan 在此止步，不展开具体字段与命令。
>
> | Phase | 预估 Task 数 | 示例 Task |
> |-------|-------------|-----------|
> | Phase 4.1 | 2 | 改写 compose 并删除 Caddyfile、按新契约更新编排静态校验 |
> | Phase 4.2 | 2 | 编写手动触发的工作流、追加工作流静态校验 |
> | Phase 4.3 | 2 | 撰写 README、同步 Project.md |
> | Phase 4.4 | 2 | 创建私有仓库并推送、手动触发构建并确认镜像版本 |
>
> **总计预估**：8 个 Task（TASK-051 ~ TASK-058）。全部完成后再跑一次全量回归与归档提交。
