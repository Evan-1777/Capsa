# Project

> 项目的单一事实来源，供 Agent 动手前建立全局认知。定位与设计原则见 `SCOPE.md`，工作流规则见 `AGENTS.md`，本文件只引用，不复述。

## 概述

- **定位**：Capsa 是部署在个人 VPS 上的私人记忆服务，以 MCP 协议向 Agent 提供分组隔离、分级披露的长期记忆读写，并附带一套全权限单管理员 Web 管理台。
- **阶段**：Go 语言后端重构交付完成；服务为单一静态二进制，外部契约（SQLite 结构、MCP 工具名与纯文本、Web 端点与统一信封）与 Python 版逐字保真。
- **非目标**：不引入向量检索与自动抽取写入，不做多租户，不引入独立用户表、多角色 RBAC 与 Cookie/Session；回收站 CLI 仍为管理员通道。完整边界见 `SCOPE.md`。
- **归档**：Phase 3 设计与交付归档于 `.docs/09-13-v3/docs/`；Phase 4 部署形态收敛归档于 `.docs/09-16-v1/`；Phase 6 检索扩展归档于 `.docs/09-17-v2/`；本次 Go 重构归档于 `.docs/10-08-v1/`。归档是带日期的历史快照，其中容器编排形态以本文件与 `README.md` 为准。

## 环境与运行

- **平台**：Linux x86_64；本机开发，生产为 `docker compose` 部署到个人 VPS（1Panel 实战部署指南见 `docs/1panel-deployment-guide.md`）
  - 镜像由 GitHub Actions 手动触发构建并推送到 GHCR，`docker-compose.yml` 只拉取不构建；TLS 由宿主机反向代理终止，容器只发布回环端口
- **Shell**：bash
- **版本管理**：git，主干分支 `master`
- **语言 / 运行时**：Go 1.27，模块名 `capsa`；无 CGO，交叉编译与静态链接均为默认
- **依赖管理**：`go.mod`。关键依赖：`modernc.org/sqlite`（纯 Go SQLite）、`github.com/mark3labs/mcp-go`（MCP Streamable HTTP）、`golang.org/x/text`（NFC 归一化）
- **如何构建**：
  ```bash
  # 先产出前端产物（embed 目录缺失时编译期直接失败）
  cd web && npm ci && npm run build      # 产物落 internal/server/static/
  cd .. && go build -o bin/capsa ./cmd/capsa
  # 发布用裁剪符号表
  go build -ldflags="-s -w" -o bin/capsa ./cmd/capsa
  ```
  - ★ 静态产物不入版本库（`.gitignore` 忽略 `internal/server/static/`）；未先构建前端时 `go build` 因 embed 目录缺失而失败，属预期
  - ★ npm 必须走 `web/.npmrc` 指定的 `.devtools/npm-cache`；本机默认缓存目录不可写，不设会直接失败
- **如何运行**：
  ```bash
  # 初始化数据库与标准分组（服务启动不建任何业务数据，未建表时 /healthz 返回 503）
  CAPSA_DB_PATH=/data/capsa.db ./bin/capsa init
  # 回收站维护与检索同源审阅（管理员通道，不做 Key 作用域校验）
  CAPSA_DB_PATH=/data/capsa.db ./bin/capsa memory list-deleted [--group proj]
  CAPSA_DB_PATH=/data/capsa.db ./bin/capsa memory restore <memory_id>
  CAPSA_DB_PATH=/data/capsa.db ./bin/capsa review [--group proj] [--query 关键词] [--limit 20]
  # 在线热备与回灌（backup 的位置参数优先于 CAPSA_BACKUP_DIR，默认 /backup）
  CAPSA_DB_PATH=/data/capsa.db ./bin/capsa backup /backup [--keep-days 14]
  CAPSA_DB_PATH=/data/capsa.db ./bin/capsa restore /backup/capsa-YYYY-MM-DD.db
  # 启动服务
  ./bin/capsa serve [--host 0.0.0.0] [--port 8000]
  ```
  - 可选：设置 `CAPSA_ADMIN_TOKEN` 后，该字符串本身即管理台管理员令牌，无需落库；未配置或仅含空白时不启用
  - ★ 管理台（`/api`）只接受通配 `*:rw` 凭据，普通分组 Key 一律被网关拒绝为 403；Agent 侧的 `/mcp` 不受此限
  - ★ 默认数据库路径 `/data/capsa.db` 在本机不存在，本地运行须先设置 `CAPSA_DB_PATH` 指向可写目录；未执行 `capsa init` 时 `/healthz` 返回 503 而非 200
- **如何测试**：Go 侧 `go test ./...`（含 `tests/` 集成测试与各 `internal/` 单元测试）；前端侧 `cd web && npm run test:e2e`（Playwright 驱动系统 Chrome，经 `web/tests/serve.sh` 起真实 Go 二进制）。两侧全程使用临时数据库，不触碰 `/data`
  - ★ 本机若配置了 `http_proxy`/`https_proxy`，Playwright 的 webServer 探活会被代理拦截而误报「端口已占用」；运行 E2E 前须清空代理变量，例如 `env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY npm run test:e2e`
- **如何构建镜像**：仅手动触发。网页在仓库 Actions 页签选 `build-image`，命令行 `gh workflow run build-image.yml -f tag=v0.1.0`；本地等价命令 `docker build -t ghcr.io/evan-1777/capsa:dev .`。私有 GHCR 包需先 `docker login ghcr.io`（PAT 需 `read:packages`）
- **实测基线**（本机 Linux x86_64）：`go build -ldflags="-s -w"` 产物 13.1 MiB；`capsa serve` 空载常驻 RSS ≈ 13 MB，遇请求后升至约 16–20 MB 且不回落至空载值（重构前 Python 版约 81 MB）。容器镜像为 Alpine + curl + 该静态二进制，构建由 CI 完成（本机无 Docker，镜像体积以 CI 构建为准）
- **定时热备（宿主机 Cron）**：`0 3 * * * docker compose -f /opt/capsa/docker-compose.yml exec -T capsa capsa backup /backup`

## 结构

```
cmd/capsa/main.go        # 单入口：13 项叶子命令（init / group / key / memory / review / backup / restore / serve）
internal/
├── db/db.go             # SQLite 连接、幂等建表、健康检查、固定微秒时间戳
├── dal/dal.go           # 三态授权数据访问层与记忆写读入口，唯一 SQL 出口
├── ids/ids.go           # CSPRNG 标识符与 SHA-256 令牌哈希
├── permissions/         # 权限判定单一事实来源：PermissionFor 与管理级令牌常量
├── auth/                # 令牌校验器（verifier.go）与 URL 查询参数鉴权中间件（middleware.go）
├── retrieval/           # 归一化、二字组分词、打分排序（含正文低权重兜底）与标题近似查重
├── formatters/          # 三级披露与分组列表的纯文本契约
└── server/
    ├── server.go        # 根路由装配：/healthz → /mcp → /api → 静态根 + 1MB 请求体限制
    ├── mcp.go           # MCP 服务、7 个工具、Bearer 守卫与流式响应头
    ├── web_api.go       # REST API：统一信封、管理员网关、防自锁守卫与真实端点
    └── static.go        # go:embed 内嵌静态产物与 SPA 回退
web/                     # Capsa Studio：Fluent 2 + React 18 + TypeScript + Tailwind
├── vite.config.ts       # build.outDir 固定 ../internal/server/static
├── playwright.config.ts # channel: "chrome"，webServer 指向 web/tests/serve.sh
└── tests/e2e.spec.ts    # 浏览器端到端套件（12 条用例）
README.md                # 定位、架构、部署、宿主反代接入与运维速查
Dockerfile               # 三阶段构建：Node 产物 → Go 静态二进制 → Alpine
docker-compose.yml       # 单服务编排，只拉取 GHCR 镜像
.github/workflows/       # build-image.yml：手动触发的镜像构建
tests/integration_test.go # Go 集成测试：端点状态码、统一信封、MCP 握手与流式响应头
```

- **数据流**：
  - 凭据接入：根应用中间件 `QueryTokenAuth` 在 HTTP 边界统一处理访问凭据：无 `Authorization` 头且 URL 查询参数含非空可打印 ASCII `token`（或兼容 RFC 6750 的 `access_token`）时，代客合成 `Authorization: Bearer <token>` 注入请求头；下游 MCP 守卫、Web 网关、DAL 与鉴权链路完全复用，契约对称且零侵入。
  - 读：Agent → Bearer 令牌 → MCP Bearer 守卫（`auth.VerifyToken`）→ 工具层从 context 读取 `key_id` 与 `grants` → `dal` 三态判定 → `retrieval` 打分排序 → `formatters` 渲染纯文本。
  - 写：适配层经 `permissions.PermissionFor(grants, group)` 判定 `rw` 与字段长度 → `retrieval` 规范化复核时间并计算标题近似度 → `dal` 写入（单语句自动提交）。
  - Web：浏览器 → `/api` 的 `AdminGuard`（复用 `auth.VerifyToken`）：未认证回 401 信封，凭据不含 `*:rw` 回 403 信封 → 处理器从 context 读 `grants` → `dal` 三态判定 → JSON 统一信封（`{success, data, error}`）。
- **依赖方向**：`server → dal/retrieval/formatters/auth → permissions/db`；`dal` 是唯一执行 SQL 的模块，`retrieval`、`formatters`、`permissions` 为纯函数模块。
  - ★ `permissions` 独立成包（而非置于 `auth` 内）——原因：`dal` 依赖权限判定，`auth` 的校验器依赖 `dal`，若权限与校验器同包会形成 `auth → dal → auth` 的循环导入；`permissions` 下沉为最低层即满足「单一事实来源」又消除环。
  - ★ `dal` 与 `db` 禁止反向依赖工具层；授权范围由调用方从请求令牌注入，DAL 不接受全局状态。
- **核心模块**：`server.NewHandler()` 是唯一根装配点，按 `/healthz → /mcp → /api/ → /` 顺序注册；`mcp.go` 与 `web_api.go` 是并列的两个传输适配层，内部都不出现 SQL，全部经 `dal` 访问数据。
- **权限判定单一来源**：`permissions.PermissionFor` 是唯一的有效权限计算函数，DAL、MCP 工具层与 `/api` 处理器共用；任一 `*` 通配都覆盖全库（可见性与读写级别正交）。
- **检索范围与打分**：`memory_search` 默认只匹配标题（4 分）、摘要（1 分）与标签（2 分）；`include_body=True` 且 `query` 非空时追加投影 `body` 列并并入命中判定，正文命中每词元 0.2 分、封顶 0.8 分，低于摘要单次命中的 1 分。空 `query` 是浏览而非检索，工具层以非空 query 收敛正文投影。
- **部署形态**：公网 → 宿主机反向代理（TLS 终止、响应不缓冲）→ 容器 `127.0.0.1:8000` → `capsa-data` 数据卷。应用层是唯一职责边界：容器自带 `/healthz` 健康检查与 1MB 请求体上限。

## 约定

- **命名**：Go 导出标识符 PascalCase，包内标识符 camelCase；记忆 ID 为 `mem_` + 6 位随机串（总长 10），Key ID 为 8 位随机串，明文令牌为 `capsa_{key_id}_{32位随机串}`（总长 47）
- **凭据传递**：支持标准 HTTP `Authorization: Bearer <token>` 与 URL 查询参数（`token` 与兼容 RFC 6750 的 `access_token`）。两者同时出现时严格以 HTTP 请求头为单一权威来源（不降级、不回退）。空参数、纯空白、含非 ASCII 或不可打印控制字符（如 CRLF）的查询参数均不予注入，交由下游自然返回 401。
- **注释 / 文档语言**：代码注释与标识符用英文，用户可见的工具描述、错误消息与 CLI 输出用中文
- **错误处理**：协议层问题走 HTTP 状态码（401 / 413），工具自身可给出可操作反馈的问题走 MCP 工具级 `isError: true`；同一契约在 Web 侧映射为 HTTP 状态码与 `error.code`（401 `UNAUTHORIZED` / 403 `FORBIDDEN` / 404 `NOT_FOUND` / 422 `VALIDATION_ERROR` / 500 `INTERNAL_ERROR`），`error.message` 与 MCP 工具文本逐字相同。
- **MCP 工具契约**：工具描述与参数注解只陈述可观察事实，不写调用顺序训诫或负向告诫；三级披露边界由各工具描述中立陈述。
- **管理级令牌**：`CAPSA_ADMIN_TOKEN` 每次请求读取环境变量，非空即启用，身份固定为 `id="admin"`、`grants={"*": "rw"}`；轮换方式为更新环境变量并重启服务
- **时间**：所有时间以 ISO 8601 UTC 字符串存储与比较，固定布局 `2006-01-02T15:04:05.000000+00:00`（定宽 6 位微秒）
- **前端**：凭据只存 `sessionStorage`（键名 `capsa_key`），401 即刻清空并回登录态，403 提示仅支持管理员凭据并同样清空；Fluent 2 体系以 CSS 变量承载语义令牌并通过根节点 `data-theme` 切换；弹层走原生 `<dialog>` 与 `showModal()`；正文 Markdown 经 `react-markdown` + `rehype-sanitize` 渲染，`skipHtml` 置真

## 约束与决策

- 后端从 Python + Starlette + FastMCP 重构为 Go 单一静态二进制——原因：常驻内存从实测 81MB 压降至空载约 13MB，消除容器内 Python 与 Node 运行时依赖，镜像收敛到 Alpine 极简形态
- 2026-10-08 选 `modernc.org/sqlite`（纯 Go）而非 `mattn/go-sqlite3`——理由：无 CGO，支持静态交叉编译与原生备份接口，避免容器内引入 gcc/musl 工具链
- 2026-10-08 时间戳固定 `2006-01-02T15:04:05.000000+00:00` 定宽布局——理由：字符串字典序与时间先后严格等价，同秒内 6 位微秒对齐；相对 Python `isoformat()`（微秒为 0 时省略小数）属有意增强的定宽布局
- 2026-10-08 HTTP 路由用 Go 标准库 `net/http`（1.22+ 方法与路径参数匹配），不引入 `chi`/`gin`——理由：标准库已完全覆盖，新增框架属冗余抽象
- 2026-10-08 MCP 协议栈用 `github.com/mark3labs/mcp-go`——理由：社区成熟 Go MCP SDK，原生支持 Streamable HTTP、SSE 与工具注解
- 2026-10-08 静态资源用 `//go:embed all:static` 强内嵌，源目录固定 `internal/server/static/`，产物不入库——理由：编译期将前端产物打进可执行文件；目录缺失编译期直接失败，暴露「未构建前端」而非运行期静默 404
- 2026-10-08 容器安装至 `/usr/local/bin/capsa` 并监听 `0.0.0.0`——理由：保持容器内 PATH 直接可执行，与 README 既有运维命令严格兼容；监听通配地址保证宿主反代接入
- 2026-10-08 DAL 以 `map[string]any` 承载行数据而非强类型结构体——理由：字段投影随场景异构（三态脱敏、列表、详情、检索带/不带正文），字典形态与 Python 契约同构，避免为每种形态引入映射类型
- 数据库路径在调用期解析而非导入期——原因：导入期求值会让测试无法通过 `CAPSA_DB_PATH` 替换路径
- 连接以 DSN 参数施加 `journal_mode(WAL)`、`foreign_keys(1)`、`busy_timeout(5000)`，每个句柄 `SetMaxOpenConns(1)`——原因：让每条池化连接自动继承 PRAGMA，单请求内串行执行消除句柄内锁竞争
- `delete_empty_group` 在 `BEGIN IMMEDIATE` 写锁事务内原子执行「存在性检查 + 记忆关联（含回收站）检查 + 删除」——原因：消除先查后删的 TOCTOU 竞态
- 服务启动路径不得创建分组或 Key——原因：容器重启会产生隐式业务数据并污染测试；初始化走显式 `capsa init`
- `forbidden` 判定只允许返回 `status` 与 `id` 两个键——原因：携带 `group_slug` 会泄露未授权分组名
- Web 端 `PUT` / `DELETE` / `restore` 的 404 文案固定为「记忆不存在或无权访问」，不回显调用方传入的 id——原因：条目不存在、已软删除、分组不可见三种情形若可区分，响应体就成了探测未授权分组的侧信道
- `memory_update` / `memory_forget` 只对 `deleted_at IS NULL` 的条目生效，回收站条目仅经 `restore` 回到活跃态——原因：写工具不应绕过软删除状态机
- 标题近似查重只提示不拦截，条目照常落库——原因：误拦截的代价高于误提示
- 正文字段按需投影，默认查询不选 `body` 列；含正文的命中判据与打分只在 MCP 兜底检索路径开启——原因：正文是库内体积最大的列，避免全库浏览的峰值占用
- 空 `query` 的浏览请求即使传入 `include_body=True` 也不投影正文——原因：没有关键词可供打分，加载正文只留下全库扫描开销
- 关键词检索不在 SQL 里过滤，`ListMemoriesForWeb` 不接受 `query`——原因：命中判据与排序统一由 `retrieval.RankMemories` 承担，SQL `LIKE` 与二字组判据不等价
- MCP 每个请求经 Bearer 守卫校验并注入 context，工具处理器从 context 提取 `grants`——原因：`mcp-go` 的 `HTTPContextFunc`/请求 context 透传使逐请求凭据无需全局状态
- 关闭 `mcp-go` 的 localhost DNS-rebinding 保护——原因：Capsa 的 MCP 一律要求 Bearer 令牌、不使用 cookie 环境凭据，rebinding 攻击面不存在；保留默认会误拒宿主反代转发（Host 非 localhost）的合法流量
- 备份用 SQLite `VACUUM INTO` 生成一致性快照，保留策略按文件名日期计算 14 天——原因：`VACUUM INTO` 在 WAL 下产出单文件一致快照，文件名日期确定性可测
- `restore` 以文件覆盖方式回灌并清理 `-wal`/`-shm`——原因：离线管理动作，快照为 `VACUUM INTO` 产物无 WAL，回灌后须重启服务
- 环境变量管理员虚拟凭据不落库、不进 Key 列表、不可作为管理接口操作目标——原因：单人场景无需用户表，防自锁统一在网关拦截
- URL 查询参数凭据的固有安全代价与缓解——原因：URL 查询参数易被反向代理、宿主日志记录；建议对含 `token`/`access_token` 的访问日志脱敏，并为仅支持 URL 配置的客户端签发专用低权限分组 Key，严禁复用全局通配管理员凭据

## 外部集成

- **GHCR 镜像分发**：镜像由 GitHub Actions 手动触发（`build-image.yml`）构建并推送至 `ghcr.io/evan-1777/capsa`，`docker-compose.yml` 只拉取不构建。私有包在 VPS 拉取前必须 `docker login ghcr.io`（PAT 需 `read:packages`）。
- **Claude Web 自定义连接器接入**：生产环境经 `docker compose` 部署或重启后，按以下步骤接入——
  1. **签发专用连接器凭据**：在 Web 管理台或通过 VPS CLI 签发仅授权目标分组的专用 Key：
     ```bash
     docker compose exec capsa capsa key create claude-connector --scopes proj:rw
     ```
  2. **配置连接器端点**：在 Claude Web 端「Custom Connectors」填入服务地址并携带查询参数：
     ```
     https://<your-vps-domain>/mcp?token=capsa_<key_id>_<secret>
     ```
  3. **验证连通性**：点击连接测试，Claude 完成 initialize 握手并拉取工具列表后即可在对话中读写指定分组记忆。
- **凭据隔离规范**：仅支持 URL 配置的客户端必须使用专用低权限分组 Key，严禁复用全局通配管理员凭据（`*:rw`）；反代须对含 `token` / `access_token` 的访问日志脱敏。凭据本身不写入文档或代码。
- **MCP 传输形态差异**：`mcp-go` 对 `POST /mcp` 默认返回单条 `application/json` 响应（MCP Streamable HTTP 允许的响应模式），客户端打开 `GET /mcp` 独立 SSE 流时使用 `text/event-stream` 分帧。Python 版曾对 POST 一律 SSE 分帧，此为传输栈差异，标准 MCP 客户端两者均兼容。

## 术语

- `scope` = Key 的分组到权限映射，形如 `{"proj": "rw", "study": "r"}`，是授权边界的唯一来源
- **通配权限** = 含 `*` 键即覆盖全库，具体级别由 `PermissionFor` 决定：`{"*": "rw"}` 全库可写，`{"*": "r"}` 全库只读；显式分组键优先于通配。管理台登录条件即 `grants["*"] == "rw"`
- `group_slug` = 分组标识（`proj` / `study` / `life` / `track`），既是分类也是授权边界，不对未授权方披露
- **三态** = 单条记忆相对当前 Key 的三种判定：`authorized` / `forbidden` / `not_found`
- **三级披露** = 检索（`memory_search`）返回标题与元数据、peek（`memory_peek`）返回摘要、read（`memory_read`）返回正文；边界由工具描述陈述，不作为调用顺序约束
- **正文兜底检索** = `memory_search` 的 `include_body=True` 可选能力：把正文并入命中判定与打分，权重低于全部元数据字段

## 维护

| 变更 | 同步章节 |
|---|---|
| 运行、构建、测试方式或环境前提变化 | 环境与运行 |
| 依赖增删或升级 | 环境与运行；属关键选型时同步「约束与决策」 |
| 模块增删、重构，依赖方向变化 | 结构 |
| 命名、语言、日志规范调整 | 约定 |
| 新坑、新约束、选型定型 | 约束与决策 |
| 调整检索匹配范围或打分权重 | 结构、术语 |
| 外部服务接入或下线 | 外部集成 |
| 新增项目特有名词 | 术语 |
