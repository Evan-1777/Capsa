# Plan：Capsa Phase 3 —— 可视化管理台、生产容器化与在线热备交付

**状态**：DONE
**日期**：2026-09-13
**完成日期**：2026-09-13
**版本**：v1.0
**关联基线**：`Capsa_落地交付分期规划.md` §四（Phase 3 交付契约）、`Capsa_可视化前端管理计划.md`、上游设计 `AgentSpace 记忆服务设计方案.md` §七
**前置阶段**：Phase 2 已交付并归档于 `.docs/09-13-v2/`
**回归基线（规划时实测）**：`.venv/bin/python -m pytest -q` → 101 passed，0 failed，0 skipped
**回归结论（交付时实测）**：`.venv/bin/python -m pytest -q` → 161 passed，0 failed，0 skipped；`cd web && npm run test:e2e` → 9 passed，0 failed（Playwright channel: chrome）

---

## 1. 背景与目标

### 1.1 背景

Phase 1 交付只读基座与三态授权防线，Phase 2 补齐写入生命周期与回收站闭环。当前仓库状态：

- `capsa/server.py` 只装配 `/healthz` 与 `/mcp` 两条路由，不存在 `/api` 与静态托管；
- `capsa/dal.py` 有两个读入口（三态批量查询、授权范围检索列表）与五个写入口，但没有面向列表页的三态分页查询；
- `capsa/cli.py` 有四组子命令（init / group / key / memory），没有 `review` 与 `backup`；
- 仓库不存在 `web/`、`Dockerfile`、`docker-compose.yml`、`Caddyfile`。

Phase 3 补齐 Web 管理台、REST API、运维命令与容器编排，使系统达到可部署到个人 VPS 的完整形态。

### 1.2 目标

| # | 目标 | 判定方式 |
|---|------|---------|
| 1 | 8 个 Web API 端点可用，统一 JSON 信封 | 每个端点各有一条 pytest 用例，成功与失败信封结构逐字段断言 |
| 2 | 权限与 MCP 完全对称，无超管通道 | 只读 Key 的写操作被拒；越权响应不含未授权分组的任何信息 |
| 3 | Capsa Studio 三视图可用 | Playwright 覆盖登录/退出、新建、检索、Markdown 渲染、软删除与回收站恢复 |
| 4 | Markdown XSS 净化 | 注入脚本与伪协议后页面无执行、无残留事件属性 |
| 5 | CLI 运维闭环 | `capsa review` 与 MCP `memory_search` 的排序逐条一致；`capsa backup` 生成可独立打开的快照并清理 14 天前文件 |
| 6 | 容器编排与热备可交付 | 多阶段 Dockerfile、compose、Caddyfile 与 Cron 一行配置齐备并通过本机静态校验 |
| 7 | 双轨自动化测试全绿 | `pytest -q` 与 `npm run test:e2e` 均退出码 0 |

### 1.3 非目标

| 不在本阶段 | 归属 |
|-----------|------|
| Key 签发/撤销与分组维护的 Web 化 | `Capsa_可视化前端管理计划.md` §1：低频运维保留在 CLI |
| 备份文件的对象存储异地同步 | 无凭据来源；上游设计 §7.2 仅作建议 |
| 镜像构建与 `docker compose up` 的本机执行 | 本机无 Docker（实测 `docker` 命令不存在），由云端 CI 验收 |
| 向量检索、自动抽取写入、多租户、待审状态机 | 设计方案 §九已定不做 |
| 回收站条目的物理清理 | 无触发条件 |
| 前端组件级单测框架 | Playwright 端到端已覆盖全部交付断言，另立单测框架无收益 |
| 构建期之外的 Node 运行时 | 前端计划 §2：静态 SPA，产物在构建期注入 Python 容器 |

---

## 2. 契约收敛

规划文档给的是设计意图。Phase 1 与 Phase 2 各有三到四处文档与实现的漂移在执行期才落定。本节先把 Phase 3 中最容易走偏的边界钉死，作为 Tasks 的唯一基准。

### 2.1 本机可验证边界与云端验收的分工

本机没有 Docker（`docker` 与 `docker-compose` 命令均不存在），且 SCOPE §5 要求不保留一次性构建产物。验证按两层切分：

| 分层 | 本机验证 | 云端 CI 验收 |
|------|---------|-------------|
| Python | `pytest -q` 全绿（含真实 HTTP 链路） | 同 |
| 前端 | `npm run build` 退出码 0；Playwright 对真实 uvicorn 进程的浏览器烟测全绿 | 同 |
| 编排 | compose 经 `yaml.safe_load` 解析并断言关键字段；Dockerfile 关键指令静态断言 | 镜像构建、容器健康检查、Caddy 反代与 TLS |

规划文档 §4.3 的七条断言按此表逐条标注验证位置，见 §6.1。任何本机未验证项必须在交付文档中显式列出，不得默认通过。

### 2.2 路由装配顺序

沿用 Phase 1 已证伪 `Mount("/mcp", ...)` 的结论（裸 `POST /mcp` 会先 307 再 404），路由保持：

```
/healthz（Route） → /mcp（Route） → /api（Mount） → /（Mount StaticFiles）
```

- 先具体前缀、后根路径，静态托管不得劫持 `/api`；
- `capsa/static/` 是构建产物，不入版本库；目录不存在时不挂载根路由，本机未构建时 `GET /` 返回 404，而不是启动失败或 500；
- 静态目录挂载后 `GET /api/memories` 必须仍然可达，这是一条可执行断言。

### 2.3 权限判定与错误码映射

Web API 与 MCP 工具镜像同一套判定，差异只落在传输分层：

- 授权判定复用 `dal.get_memories_batch_for_access`，不新增逻辑；
- 错误分层沿用 Phase 2 的口径：`forbidden`（分组对调用方不可见）与 `not_found` 共用同一条「不存在或无权访问」文案，理由是该文案不得成为探测未授权分组存在性的侧信道；而 `authorized` 意味着调用方本就能读该分组，此时对只读权限报 403 不构成新的泄露，与 MCP 的 `_locate_writable` 逐条一致；
- `POST /api/memories` 的分组拒绝只有一条文案「对分组 {group} 没有写权限，拒绝写入」，「分组不可见」与「分组只读」共用，`{group}` 由调用方自己传入，不泄露新信息；
- `POST /api/memories/{id}/restore` 的目标是回收站条目，三态批量查询会把它判为 `not_found`，因此该端点改经 `dal.get_memory_for_web` 定位（不过滤 `deleted_at`），再按 `group_slug` 判权限；
- 未携带或令牌无效由 `web_api.py` 的 Bearer 守卫中间件返回 401 `UNAUTHORIZED` 统一信封：守卫内部调用 `BearerAuthBackend(CapsaTokenVerifier()).authenticate()`，未通过即回信封，通过则写入 `scope["user"]` 后放行，不进入处理器。不用 starlette 的 `AuthenticationMiddleware`——其未认证分支把判定推给处理器，且解析失败默认返回 400 纯文本。

| 端点 | 失败码 | 触发条件 |
|------|-------|---------|
| 全部 | `UNAUTHORIZED` 401 | 缺少或无效 Bearer 令牌 |
| `POST /api/memories` | `FORBIDDEN` 403 | `group` 不在 scopes 内，或权限为 `r`（同一条文案） |
| `POST /api/memories` | `VALIDATION_ERROR` 422 | 字段为空或超限、`review_at` 非法、目标分组不存在 |
| `GET /api/memories/{id}` | `NOT_FOUND` 404 | 条目不存在、已软删除，或所属分组不在 scopes 内 |
| `PUT` / `DELETE` / `restore` | `NOT_FOUND` 404 | 条目不存在、已软删除，或所属分组不在 scopes 内 |
| `PUT` / `DELETE` / `restore` | `FORBIDDEN` 403 | 条目所属分组在 scopes 内但权限为 `r` |
| `PUT` / `DELETE` | `VALIDATION_ERROR` 422 | 未提供任何待更新字段、`clear_review_at` 与 `review_at` 同时给出、`reason` 为空 |
| `GET /api/memories`、`GET /api/groups`、`GET /api/auth/me` | `VALIDATION_ERROR` 422 | `status` 非法、`limit` 越界 |

> 两类拒绝在响应体上不提供额外的区分信息：`POST` 对「分组不可见」与「分组只读」共用一条文案；写操作对「条目不可见」与「条目不存在」共用 404。

### 2.4 字段校验与错误文案的单一来源

- 上限常量（60 / 200 / 64000）与中文报错文案已存在于 `capsa/mcp_service.py`，Web API 复用，不得复制第二份；
- 具体做法：把 `mcp_service._require_text` 提升为公开的 `require_text`（消除跨模块引用私有名），`web_api.py` 直接导入该函数与三个上限常量；
- 同一契约、两种传输分层：MCP 工具把校验失败渲染为工具级 `isError: true`（HTTP 200），Web API 映射为 HTTP 422 `VALIDATION_ERROR`，`error.message` 与前者逐字相同；
- 替代方案（新建 `capsa/validation.py` 并让两侧各自适配）否决：为一个函数与三个常量引入新模块和一层胶水，收益为零。

### 2.5 记录形状与时间契约

- 全系统时间已是 ISO 8601 UTC（`db.utcnow()` 与 `retrieval.normalize_review_at`）；Web API 原样透传，不新增格式转换。前端计划示例里的 `Z` 后缀按 `isoformat()` 的实际输出写作 `+00:00`；
- 记忆详情与列表项返回完整正文，不套用 MCP L3 的 4000 字符截断。截断是 MCP 的上下文预算契约，Web 渲染的是文档本身；
- 分页：`offset` 默认 0、`limit` 默认 20、上限 100；`total` 是过滤后的总数，与分页无关；
- 列表项始终带 `deleted_at` 与 `deleted_reason`（活跃条目为空值），回收站视图据此渲染；详情项另带完整 `body`；
- 列表与详情都带 `permission`（该条目所属分组对当前 Key 的权限）与 `is_overdue`（按 `retrieval.is_expired` 判定）。

### 2.6 检索同源

- 关键词检索在三条链路上是同一条：授权范围内取轻量候选（无 `body`）→ `retrieval.rank_memories` 完成命中过滤与排序 → 切片。`GET /api/memories?query=...` 与 `capsa review` 复用 `dal.list_active_memories_for_search` 与 `retrieval.rank_memories`，不在 SQL 里另建关键词过滤；
- 同源可断言：同一分组、同一 query、同一 limit 下，Web 列表、`capsa review` 与 MCP `memory_search` 的 id 序列三者逐条相等。

### 2.7 备份实现的取舍

- 上游设计 §7.2 给出的是宿主机 `sqlite3 .backup`；规划文档 §4.2.5 要求落在 CLI。本阶段落 CLI，因为生产容器内没有 `sqlite3` 命令行，且 Cron 需要经 `docker compose exec` 触发；
- 必须使用连接级 `sqlite3.Connection.backup()`，禁止在 WAL 模式下直接复制 `.db` 文件；
- 保留策略按文件名的日期（`capsa-YYYY-MM-DD.db`）计算 14 天，不依赖 mtime，便于确定性断言；
- `capsa restore <snapshot>` 覆盖 `CAPSA_DB_PATH` 指向的库并提示重启服务；操作对象是显式传入的路径，不做隐式发现。

### 2.8 前端依赖与浏览器运行时

- 依赖采用前端计划 §5.2 的锁定清单，另补 `@types/react` 与 `@types/react-dom`：`npm run build` 先跑 `tsc`，缺声明文件必然失败；
- 构建输出只认一个路径：Vite 的 `build.outDir` 由 `CAPSA_STATIC_DIR` 环境变量决定，本机默认 `../capsa/static`，必须在构建前创建该目录（Vite 只在 `outDir` 位于项目根目录内时才代为创建）；Dockerfile 显式传入容器内路径并从这里拷贝，两条链路不再各自假设一个目录；
- 本机已有 Chrome 151（`/usr/bin/google-chrome`）。Playwright 以 `channel: "chrome"` 驱动系统浏览器，不下载自带 chromium（约 300 MB 一次性产物，与 SCOPE §5 冲突）；
- npm 包缓存固定到 `.devtools/npm-cache`（该目录已被 `.gitignore` 忽略），避免写入工作区外。本机 `~/.npm/_logs` 不可写，不设这条 `npm` 会直接报错退出。

---

## 3. 阶段划分

### Phase 3.1：后端 REST API 与 DAL Web 查询入口

| 项目 | 内容 |
|------|------|
| **输入** | Phase 2 的三态判定、字段上限常量与校验文案、`CapsaTokenVerifier` |
| **输出** | `capsa/dal.py` 的 Web 三态分页查询、单条读取与 Key 读取入口；`capsa/web_api.py`（统一信封、Bearer 守卫中间件、8 个端点） |
| **验收标准** | 8 个端点各有一条 pytest 用例；只读 Key 的写操作按 §2.3 映射为 403 或 404，响应不含未授权分组信息；字段超限返回 422 且文案与 MCP 工具逐字一致；列表项键集合与 DAL 的字段常量逐字相等 |

### Phase 3.2：Starlette 路由装配与 CLI 运维命令

| 项目 | 内容 |
|------|------|
| **输入** | Phase 3.1 的 `web_api_app`；现有 `server.py`、`dal.py`、`retrieval.py` |
| **输出** | `capsa/server.py` 完整路由装配（含静态根路径的条件挂载）；`capsa review` / `capsa backup` / `capsa restore` 三个子命令 |
| **验收标准** | `GET /healthz` 200、`POST /mcp` 握手不变、`GET /api/memories` 返回 JSON 信封、`GET /` 在静态目录存在时返回 HTML；`capsa review` 的 id 序列与 MCP `memory_search` 逐条相等；`capsa backup` 的快照可被独立打开且条目数一致、14 天前文件被清理；`capsa restore` 覆盖后库可读 |

### Phase 3.3：Capsa Studio SPA 与前端工程

| 项目 | 内容 |
|------|------|
| **输入** | Phase 3.1 的 API 契约与 JSON 信封 |
| **输出** | `web/` 工程（Vite + React 18 + TypeScript + Tailwind）、三个视图、Markdown 安全渲染管道、构建产出落到 `capsa/static/`；`.gitignore` 补齐前端与构建产物 |
| **验收标准** | `npm run build` 退出码 0，gzip 后 JS+CSS 小于 150 KB；构建产物不出现在 `git status`；XSS 管道对 `<script>`、`onerror` 事件属性与 `javascript:` 伪协议全部拦截；三个视图各具备加载、空、错误、未授权四类状态 |

### Phase 3.4：容器编排、Playwright 套件与交付

| 项目 | 内容 |
|------|------|
| **输入** | Phase 3.2、3.3 的全部产出 |
| **输出** | `Dockerfile`、`docker-compose.yml`、`Caddyfile` 与 Cron 一行配置；`web/tests/e2e.spec.ts` 与本地起服装配；文档回填；归档与提交 |
| **验收标准** | `npm run test:e2e` 全绿；`pytest -q` 全绿且无回归；compose 可被 `yaml.safe_load` 解析且 Caddy 的健康依赖指向 `capsa`；测试结束后不遗留临时数据库与构建中间产物 |

---

## 4. 架构决策

| 决策项 | 选择 | 理由 | 替代方案（为何不选） |
|--------|------|------|---------------------|
| Web 鉴权实现 | `web_api.py` 内的单层 Bearer 守卫中间件，内部复用 `BearerAuthBackend(CapsaTokenVerifier())` 完成解析 | 与 MCP 共用同一个令牌校验器与解析实现，撤销即时生效；未认证直接 401 统一信封；单层中间件无注册顺序依赖 | starlette `AuthenticationMiddleware`（未认证判定推给处理器，解析失败回 400 纯文本）；`RequireAuthMiddleware`（401 体为 `{"error":...}`，不符统一信封）；自建令牌解析（重复哈希查询逻辑）；处理器逐个判登录（每端点各写一遍） |
| 授权范围来源 | 处理器从 `request.user.access_token.claims["grants"]` 读取 | 与 MCP 的 `_grants()` 同源于 `CapsaTokenVerifier` 写入的 claims，不需要引入 `AuthContextMiddleware` 与 contextvar | 经 MCP 的 `get_access_token()`（多一层 contextvar 中间件，收益为零） |
| Web 与 MCP 的结构共享点 | DAL 三态判定 + 字段校验函数 | 授权是与传输无关的领域逻辑；差异只在渲染层 | Web 直接调用 MCP 工具函数再解析中文文本（脆弱且丢失结构化字段） |
| 字段校验归属 | 复用 `mcp_service.require_text` 与三个上限常量 | 一处契约一处文案，两侧只在 HTTP 分层上不同 | 新建 `validation.py` 并两层适配（多一个模块与一层胶水） |
| 列表查询实现 | 单一 `dal.list_memories_for_web` 承担 active / overdue / deleted 三态 | 消除 Web 侧自行拼 SQL 的隐患，符合 DAL 是唯一 SQL 出口的约定 | Web 层内联 SQL（越权过滤出现第二份实现） |
| 关键词检索的分页 | 授权范围内取轻量候选（字段集不含 `body`），`retrieval.rank_memories` 过滤排序后直接切片；`total` 取排序后的长度 | 排序与命中判据与 MCP 逐字同源；候选本来就无 `body`，无需回表 | SQL `LIKE` 预过滤（与二字组命中判据不等价：标签检索全盲、跨词命中丢失、`total` 失真）；按 id 二次回表（多一条 SQL，且回表字段会带出列表不该有的 `body`） |
| 静态托管 | `capsa/static/` 由构建注入，`Mount("/", StaticFiles(html=True))` 条件挂载 | 与规划文档片段一致；目录缺失时本机不挂载而非启动失败 | 直接托管 `web/dist`（与容器内路径不一致，多一套路径约定） |
| 备份实现位置 | `capsa backup` CLI 加宿主机 Cron 一行 | 生产容器内无 `sqlite3` 命令，Cron 需要进程内入口 | 应用内常驻定时循环（规划文档 §零.9 已否决） |
| 备份保留策略 | 按文件名日期计算 14 天 | 确定性、可测，不依赖文件系统 mtime | 按 mtime（用例需伪造时间，跨文件系统复制会改写 mtime） |
| 浏览器运行时 | Playwright `channel: "chrome"` 驱动系统 Chrome | 本机已有 Chrome 151，省约 300 MB 一次性下载，符合 SCOPE §5 | 下载 Playwright 自带 chromium（体积与磁盘占用无收益） |
| npm 缓存位置 | `web/.npmrc` 指定 `.devtools/npm-cache` | 该目录已在 `.gitignore` 内；本机默认缓存目录不可写 | 默认 `~/.npm`（本机不可写，npm 直接失败） |

---

## 5. 风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 本机无 Docker，镜像与编排可能带着字段错误进入云端 | 🔴 高 | Phase 3.4 用 `yaml.safe_load` 解析 compose 并断言服务名、健康依赖与卷；Dockerfile 断言多阶段与 `USER capsa`；交付文档显式列出本机未验证、由云端 CI 验收的清单 |
| Web API 若自行拼 SQL 或另建授权判定，会绕过三态防线 | 🔴 高 | §2.3 收敛为复用 `get_memories_batch_for_access`；用例断言越权 id 的响应体不含分组名、标题与正文 |
| 404 / 403 语义漂移会让 Web 成为分组枚举器 | 🔴 高 | §2.3 固定映射矩阵；用例断言「未授权分组的真实 id」与「不存在的 id」两种输入返回同一响应体 |
| 字段上限或报错文案出现第二份实现，两侧随迭代漂移 | 🟡 中 | §2.4 复用同一函数与常量；用例断言 Web 422 的 `error.message` 与 MCP `isError` 文本逐字相等 |
| 根路径静态托管若注册在 `/api` 之前，会劫持整个 API | 🔴 高 | §2.2 固定注册顺序；用例先断言 `GET /api/memories` 返回 JSON 信封而非 HTML |
| 静态目录不存在时 `StaticFiles` 抛错导致服务无法启动 | 🟡 中 | 条件挂载；用例覆盖目录不存在时 `/healthz` 与 `/api` 仍可用 |
| 分块请求体的 413 在 Web 侧可能因响应已开始而逃逸 | 🟡 中 | starlette 内置中间件已在 Phase 1 覆盖两条路径；Phase 3.4 追加一条经 `/api` 的 413 用例 |
| WAL 模式下直接复制数据库文件会产生损坏快照 | 🟡 中 | §2.7 强制 `Connection.backup()`；用例断言快照可独立打开且 `COUNT(*)` 与源库一致 |
| 构建产物混入版本库（`capsa/static/`、`node_modules/`、Playwright 临时库） | 🟡 中 | Phase 3.4 在 `.gitignore` 显式列出；提交前以 `git status --porcelain` 断言不含这些路径 |
| Markdown 净化管道若被削弱，`javascript:` 链接或事件属性可能可执行 | 🟡 中 | 净化交给 `skipHtml` 与 `rehype-sanitize` 两层既有能力，不手写协议黑名单；验收覆盖标签、事件属性与伪协议三类注入，Playwright 断言 window 上的探针标志未被写入 |
| E2E 起服依赖固定端口，可能与本机其他进程冲突 | 🟢 低 | 使用高位端口，Playwright `webServer` 声明 `reuseExistingServer: false`，端口被占用时用例失败而非静默连到别处 |
| Playwright 与系统 Chrome 151 的兼容性 | 🟢 低 | 规划期已用锁定版本 `@playwright/test@1.45.0` 加 `channel: "chrome"` 对真实构建产物跑通最小用例 |

---

## 6. Phase 依赖关系

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 24px 1fr;gap:0;align-items:stretch">

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 3.1</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">后端 REST API 与 DAL 入口</div>
  <div style="font-size:11px;color:#52525b">统一信封 · Bearer 鉴权 · 8 个端点 · list_memories_for_web</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="display:grid;grid-template-columns:1fr;gap:10px">
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 3.2</div>
    <div style="font-size:13px;font-weight:600;margin:4px 0 6px 0">路由装配与 CLI 运维</div>
    <div style="font-size:11px;color:#52525b">/healthz → /mcp → /api → / · review · backup · restore</div>
  </div>
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 3.3</div>
    <div style="font-size:13px;font-weight:600;margin:4px 0 6px 0">Capsa Studio SPA</div>
    <div style="font-size:11px;color:#52525b">三视图 · Markdown 安全管道 · 构建产物注入 capsa/static</div>
  </div>
</div>

</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold;padding:12px 0 0 0">↓</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px;margin-top:12px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 3.4</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">容器编排、Playwright 套件与交付</div>
  <div style="font-size:11px;color:#52525b">Dockerfile · Compose · Caddyfile · Cron 一行 · 浏览器烟测全绿 · 文档回填与归档</div>
</div>

<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#71717a">
3.1 是共同前置；3.2 与 3.3 之间无代码依赖，可并行；3.4 依赖两者全部产出。
</div>

</div>

</figure>

### 6.1 规划文档 §4.3 断言的落地位置

| 规划文档 §4.3 断言 | 本机验证 | 云端验收 |
|---|---|---|
| 完整路由装配 | pytest：`GET /healthz` 200、`POST /mcp` 握手、`GET /api/memories` 返回 JSON、`GET /` 返回 HTML | 同 |
| Web 界面与 XSS 防护 | Playwright XSS 用例 | — |
| Playwright 浏览器测试全绿 | `npm run test:e2e` | 同 |
| 全流程 CRUD 与回收站 | Playwright CRUD 用例加 pytest API 用例 | — |
| 宿主机热备 | pytest：快照可独立打开、14 天清理；Cron 一行配置在文档中给出 | Crontab 实际调度产出具名快照 |
| 人机排序同源 | pytest：CLI review 序列、MCP search 序列与 Web 列表序列三者相等 | 同 |
| 自动化 E2E 全通 | pytest 全绿加 Playwright 全绿 | 5 步 Agent 烟测与 7 步生命周期测试在真实镜像上全通 |

---

## 7. 遗留待办（交由后续阶段）

| 事项 | 说明 |
|------|------|
| 检索规模上限 | 全量内存打分的上限约 3000 条；升级路径为按授权分组 hash 分片惰性扫描，接口不变 |
| 回收站物理清理 | 仅软删除，无清理入口；触发条件出现前不实现 |
| 备份异地同步 | 需要对象存储凭据；触发条件为出现主机故障的实际风险敞口 |
| 多副本与高可用 | SQLite 与多副本冲突；单机无法承载时先换存储 |
| 审计日志 | 当前无写入审计；触发条件为出现 Agent 写入的错误记忆造成实际损失的案例 |
