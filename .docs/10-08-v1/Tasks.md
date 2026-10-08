# Tasks：Go 语言重构后端以降低内存与性能开销

**关联 Plan**：`Plan.md` —— Go 语言重构后端以降低内存与性能开销 v1.5  
**总计 Task**：18 个  
**状态**：DONE  
**完成日期**：2026-10-08  
**回归测试结论**：`go test ./...` 全量通过（db / ids / permissions / dal / retrieval / formatters / auth 单元测试与 `tests/` 集成测试）；前端 Playwright E2E 12 条用例全绿；`go vet ./...` 无告警；`gofmt -l` 无差异。实测裁剪后二进制 13.1 MiB，`capsa serve` 空载常驻 RSS ≈ 2.2 MB（目标 < 15MB 达成）。容器镜像构建由 CI 完成（本机无 Docker）。

---

## Phase 1：基准文档规范化、Go 基础骨架与存储数据访问层

### TASK-001：补全 SCOPE.md 项目定义并按新规范重构 Project.md

- **Status**：DONE
- **Executor**：主线
- **Description**：补齐 [.docs/SCOPE.md](file:///home/dev/projects/MiniProject/Capsa/.docs/SCOPE.md) 中的项目名称与定位填空并中性化开发环境描述，对照 [.docs/Project.example.md](file:///home/dev/projects/MiniProject/Capsa/.docs/Project.example.md) 模板规范对 [.docs/Project.md](file:///home/dev/projects/MiniProject/Capsa/.docs/Project.md) 进行全量无编号结构化重构，确保关键事实零遗漏。
- **Details**：
  - 补齐 SCOPE.md 填空：项目名称填充为 Capsa，定位填充为“部署在个人 VPS 上的私人记忆服务，以 MCP 协议向 Agent 提供分组隔离、分级披露的长期记忆读写，并附带一套全权限单管理员 Web 管理台”；更新第 4/5 条环境陈述为“开发环境（Linux x86_64）：Go 编译与测试，本机禁止全量构建 Windows 产物”。
  - 依据章节映射对照表执行无编号重构：
    1. 原 `0. 维护速查` → 文末 `## 维护` 章节（映射关系更新为语义化章节名）。
    2. 原 `1. 概述` → `## 概述`（保留定位、阶段、非目标三要素）。
    3. 原 `2. 环境与运行` → `## 环境与运行`（环境类坑以 ★ 标记保留，如 SQLite 路径、npm 缓存、Playwright chrome 驱动）。
    4. 原 `3. 目录结构` 与 `4. 架构与数据流` → `## 结构`（记录模块职责树、Agent 读写数据流、Web 数据流与依赖单向流动）。
    5. 原 `5. 关键约定` → `## 约定`（命名、语言、时间格式、错误处理、前端规范）。
    6. 原 `6. 约束与已知坑` 与 `8. 决策记录` 深度合并 → `## 约束与决策`（统一为「规则——原因」格式，选型附带日期；融合去重 CRLF 过滤、404 防侧信道、正文低权重打分等关键决策）。
    7. 原 `9. 术语表` → `## 术语`。
    8. 原 `10. 部署后联调指导` 与 GHCR 分发契约 → `## 外部集成`（规范记录 GHCR 镜像分发与 Claude Web 连接器接入及凭据隔离规范）。
- **Acceptance Criteria**：
  - SCOPE.md 无任何占位符下划线，环境陈述与 Go 对齐。
  - Project.md 无数字章节编号残留，结构与 `Project.example.md` 100% 对齐，映射对照表内 8 个章节条目完整落位。

### TASK-002：初始化 Go 模块、目录骨架与编译桩

- **Status**：DONE
- **Executor**：主线
- **Description**：创建 Go 模块配置 `go.mod`、完整核心目录骨架、`cmd/capsa/main.go` 编译桩，并将现有前端产物移动归位。
- **Details**：
  - 模块路径命名为 `capsa`。
  - 创建完整目录骨架：`cmd/capsa/`、`internal/db/`、`internal/dal/`、`internal/ids/`、`internal/auth/`、`internal/retrieval/`、`internal/formatters/`、`internal/server/static/`。
  - 在 `cmd/capsa/main.go` 中创建最小可编译入口桩，支持 `go build -o bin/capsa ./cmd/capsa`。
  - 静态资源唯一归位：将既有前端构建产物（352K）从 `capsa/static/` 移动并固化至 `internal/server/static/`（避免两份产物并存与空壳目录），同时更新 `web/vite.config.ts` 中的默认 `outDir` 为 `../internal/server/static`，确保编译期内嵌目录非空且唯一。
  - 产物入库策略：构建产物不入版本库，延续 SCOPE §5 与既有约定——将 `.gitignore` 中的 `capsa/static/` 更新为 `internal/server/static/`；本机与 CI 执行 `go build ./cmd/capsa` 前须先 `cd web && npm run build` 产出产物，Docker 构建阶段由 `web-builder` 自动满足该前置。
  - 执行 `go mod tidy` 引入并锁定 `modernc.org/sqlite` 与 `github.com/mark3labs/mcp-go` 依赖。
- **Acceptance Criteria**：
  - `go.mod` 与 `go.sum` 生成完整。
  - 先构建前端后执行 `go build -o bin/capsa ./cmd/capsa` 成功生成二进制，无报错；未产出前端时编译因 embed 目录缺失而失败（符合预期）。
  - `internal/server/static/` 包含完整前端构建产物，且该目录被 `.gitignore` 忽略、`git status` 中不出现。

### TASK-003：实现 SQLite 存储基座、Schema 幂等建表与微秒级时间戳

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/db/db.go` 中实现 SQLite 路径解析、WAL 模式短连接辅助函数、固定布局微秒级时间戳、DDL 幂等建表与健康检查函数。
- **Details**：
  - 默认数据库路径为 `/data/capsa.db`，支持环境变量 `CAPSA_DB_PATH` 覆盖。
  - 连接配置开启 `PRAGMA journal_mode = WAL` 与 `PRAGMA foreign_keys = ON`。
  - 时间戳函数 `UtcNow()` 严格固定为 `2006-01-02T15:04:05.000000+00:00` 格式串，确保同秒内 6 位微秒对齐与时区固定，保证 SQL 字符串字典序比较（`review_at < ?`、`ORDER BY updated_at DESC`）严格等价于时间顺序。该定宽布局相对 Python `isoformat()`（微秒为 0 时省略小数部分）属有意增强，非逐字对齐。
  - 定义建表 SQL 语句，包含 `groups`、`keys`、`memories` 表及索引 `idx_memories_group_order`，字段长度 CHECK 约束（title <= 60, summary <= 200, body <= 64000）严格对齐。
  - 实现 `CheckDBHealth() bool` 函数，通过简单查询验证数据库可用性。
- **Acceptance Criteria**：
  - 连接与建表具备幂等性，重复调用不报错。
  - 时间戳输出严格符合带 6 位微秒与 `+00:00` 的字符串格式，通过字符串字典序与时间先后一致性测试。
  - 健康检查在数据库可用时返回 true，目录不可写或未建表时返回 false。

### TASK-004：实现 CSPRNG 随机标识符与令牌哈希算法

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/ids/ids.go` 中使用安全随机源 `crypto/rand` 实现锁定字符表的记忆 ID、Key ID、明文令牌生成及 SHA-256 哈希计算函数。
- **Details**：
  - 字符表锁定（对齐 `capsa/ids.py:9-10`）：
    - ID 字符表：`abcdefghijklmnopqrstuvwxyz0123456789`（36 字符小写加数字）。
    - Secret 字符表：`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-`（64 字符 base64url 集合）。
  - 随机源：严格使用标准库 `crypto/rand`。
  - 记忆 ID：`mem_` 前缀 + 6 位 ID 字符（总长 10 位）。
  - Key ID：8 位 ID 字符。
  - 明文令牌：`capsa_{key_id}_{secret}`，其中 secret 为 32 位 Secret 字符（总长 47 位）。
  - 令牌哈希：使用标准库 `crypto/sha256` 生成 64 字符小写十六进制字符串。
- **Acceptance Criteria**：
  - 生成的 ID 与令牌长度、前缀及字符集严格匹配既有契约。
  - 哈希函数输出标准 64 字符十六进制字符串。

### TASK-005：实现数据访问层 (DAL) 核心模型与三态状态机

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/dal/dal.go` 中实现分组、Key、记忆的三态访问数据接口与虚拟管理员凭据解析，作为唯一 SQL 执行出口。
- **Details**：
  - 核心三态判定载体：实现 `GetMemoriesBatchForAccess`，对传入的 ID 列表执行三态判定，当状态为 `forbidden` 时严格只返回 `status` 和 `id` 两个键，不泄露 `group_slug`。
  - 虚拟管理员凭据：在 `GetKey` 中实现环境变量管理员判定，当配置 `CAPSA_ADMIN_TOKEN` 且查询 ID 为 `admin` 时，直接返回虚拟管理员凭据对象，支持 `/api/auth/me` 端点。
  - 分组管理：`AddGroup`（`INSERT OR IGNORE` 逻辑）、`ListGroupsWithCounts`、`UpdateGroup`、`DeleteGroup`（在 IMMEDIATE 排他事务内原子校验无记忆关联，含回收站记忆，防止 TOCTOU；存在关联时返回 `has_memories` 错误状态）。
  - Key 凭据管理：`CreateKey`、`FindActiveKeyByHash`、`ListKeys`、`RevokeKey`、`DeleteRevokedKey`（原子校验仅已吊销可删，防误删活跃 Key）、`TouchLastUsedAt`（顺序执行更新）。
  - 记忆管理与列表排序：
    - `CreateMemory`、`UpdateMemory`、`SoftDeleteMemory`、`RestoreMemory`。
    - `GetMemoryByID(id, includeDeleted bool)`：明确删除态语义，普通读取路径过滤 `deleted_at IS NULL`，Web 详情与回收站恢复不过滤（`includeDeleted=true`）。
    - `ListMemoriesForWeb(scopes, status, group, offset, limit)`：统一支持分页与 `status` 过滤，**三态（`active` / `overdue` / `deleted`）排序统一为 `(pinned DESC, updated_at DESC, id DESC)`**（对齐 `capsa/dal.py` `list_memories_for_web`）；不接受 `query` / `order` 参数——关键词检索在 Web 传输层于 `RankMemories` 前分流，排序概念在 DAL 不存在。
    - `ListDeletedMemories(group)`：回收站条目列出，按 `(deleted_at DESC, id DESC)` 排序（对齐 `capsa/dal.py` `list_deleted_memories`，供 CLI `memory list-deleted` 使用；Web 不调用）。
    - `ListActiveMemoriesForSearch(includeBody bool)`：支持 `include_body` 按需投影。
  - 状态机约束：`UpdateMemory`、`SoftDeleteMemory` 仅对未删除条目生效，软删除条目仅允许经 `RestoreMemory` 恢复。
- **Acceptance Criteria**：
  - 所有 SQL 操作隔离在 `internal/dal` 内部，写操作在连接级事务内执行。
  - `GetMemoriesBatchForAccess` 在越权时绝不返回分组名字段。
  - `ListMemoriesForWeb` 三态排序统一，且签名不含 `query` / `order`；`ListDeletedMemories` 按 `(deleted_at DESC, id DESC)` 排序；软删除与恢复状态机符合既有约束。

### TASK-006：编写存储与 DAL 单元测试及 Phase 1 内存基线度量

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/dal/dal_test.go` 中编写 DAL 核心业务契约单元测试，并建立重构初期的内存与产物体积基线。
- **Details**：
  - 使用临时 SQLite 文件执行测试。
  - 覆盖测试用例：
    1. 分组创建幂等性、空分类原子删除及非空分类删除时返回 `has_memories` 错误。
    2. Key 签发、哈希匹配、吊销、未吊销删除被拒及已吊销删除成功。
    3. 记忆增删改查、软删除与恢复状态机；`ListMemoriesForWeb` 三态统一排序（三态均按 `pinned DESC, updated_at DESC, id DESC`）与 `ListDeletedMemories` 回收站排序（`deleted_at DESC, id DESC`）。
    4. 三态访问脱敏判定（`forbidden` 仅包含 `status` 与 `id`）。
    5. 正文字段按需投影与非空投影验证。
  - 编译 `bin/capsa` 桩并记录 Phase 1 空载二进制体积。
- **Acceptance Criteria**：
  - `go test -v ./internal/dal` 全部通过。
  - 测试用例执行完毕后自动清理临时文件。
  - 输出 Phase 1 阶段性体积数据。

---

## Phase 2：核心算法、纯文本契约与鉴权中间件

### TASK-007：实现分词打分引擎、标题查重与全量排序快照

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/retrieval/retrieval.go` 中实现文本 NFC 归一化、CJK 二字组/拉丁分词、多维打分、Bigram Jaccard 标题查重以及 `RankMemories` 稳定排序快照函数。
- **Details**：
  - 文本归一化与分词：NFC 规范化、小写转换，CJK 连续序列拆解为相连二字组（Bigram）；长度为 1 的 CJK run 按原字符入词元（不减为 bigram），拉丁字母单词按边界提取。
  - 检索打分逻辑：标题命中每词元 4 分、标签命中每词元 2 分、摘要命中每词元 1 分、置顶条目加 3 分、过期条目扣 2 分；开启正文兜底时正文命中每词元 0.2 分，正文得分上限 0.8 分；总分采用 `round(total, 2)` 处理精度。
  - 标题查重：计算输入标题与活跃记忆标题之间的 Bigram Jaccard 相似度，阈值大于等于 0.6 时纳入预警列表，按相似度降序排列。
  - `RankMemories` 全量快照排序：
    - 词元命中过滤：仅当查询词元命中标题、标签、摘要或（兜底时）正文之一时才予召回（置顶与过期仅为权重，不可作为命中判定）。
    - 空 query 浏览分支：不进行打分，严格按 `(pinned DESC, updated_at DESC, id DESC)` 排序。
    - 并列打破（Tie-breaker）：打分召回列表中严格按 `(score DESC, pinned DESC, updated_at DESC, id DESC)` 稳定排序。
- **Acceptance Criteria**：
  - 分词打分算法与 Python 版本测试用例逐分对齐。
  - `RankMemories` 在空 query 与非空 query 下的召回过滤和稳定排序逻辑完全对齐。
  - 查重函数在相似度大于等于 0.6 时正确命中。

### TASK-008：实现 formatters 三级披露纯文本契约

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/formatters/formatters.go` 中实现 MCP 工具三级披露纯文本格式化输出契约，以 `capsa/formatters.py` 为单一事实来源（SSOT）逐函数 1:1 对齐。
- **Details**：
  - 字符截断常量：`MAX_BODY_CHARS = 4000`、`MAX_RESPONSE_CHARS = 20000`。
  - 函数契约（以整份 `capsa/formatters.py` 为 SSOT，逐函数对齐其实现）：
    - `FormatGroups`：输出分组标题与行级信息。
    - `FormatSearchResults`：输出检索统计头、每条两行结构体、过期标注及下一步提示。
    - `FormatPeekResults`：输出三态脱敏分支（`[无权访问]`、`[不存在]`）、每条详情及下一步提示。
    - `FormatReadResults`：输出三态脱敏分支、正文超限截断提示、末尾无更多内容提示及续读引导。
- **Acceptance Criteria**：
  - 对输入相同的数据集，输出字符串与 Python `capsa/formatters.py` 原始函数逐字节完全一致。
  - 单测覆盖全部三态分支（正常、无权访问、不存在）、过期标记、截断标注与续读提示。

### TASK-009：实现权限判定单一来源纯函数与令牌校验器

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/auth/permissions.go` 与 `internal/auth/verifier.go` 中实现 `PermissionFor` 纯函数与令牌校验逻辑。
- **Details**：
  - 常量定义：`AdminKeyID = "admin"`，`AdminGrants = map[string]string{"*": "rw"}`。
  - 环境变量管理员：`CAPSA_ADMIN_TOKEN` 每次按需读取，非空且去除两端空白字符后生效。
  - `PermissionFor(grants map[string]string, group string) string`：
    - 若 `grants["*"] == "rw"`，返回 `"rw"`；
    - 否则若 `group` 在 `grants` 中存在，返回其对应权限；
    - 否则若 `grants["*"] == "r"`，返回 `"r"`；
    - 否则返回空字符串（无权限）。
  - 令牌校验器：
    - 优先比对管理员环境变量令牌，命中则返回包含 `admin` ID 与 `*:rw` grants 的 AccessToken。
    - 若未命中，哈希匹配数据库有效 Key，并顺序调用 `TouchLastUsedAt` 刷新访问时间。
- **Acceptance Criteria**：
  - 通配权限覆盖优先级与具体分组优先级的判定完全符合契约规范。
  - 令牌校验器对吊销 Key 或无效 Token 稳定返回未授权错误。

### TASK-010：实现 URL 查询参数鉴权中间件

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/auth/middleware.go` 中实现 URL 查询参数代客合成 Bearer 中间件。
- **Details**：
  - 优先级守卫：若 HTTP 请求头已存在 `Authorization`，直接放行，不检查或覆盖 URL 参数。
  - 若无 `Authorization` 头，解析 URL 查询参数中的 `token` 与 `access_token`。
  - 参数值合法性过滤：参数值必须非空、必须为纯 ASCII 字符且必须为可打印字符（`unicode.IsPrint`，过滤 CRLF 等控制字符），不合法则忽略并交由下游自然返回 401。
  - 合法参数值合成为 `Authorization: Bearer <token>` 注入请求 Header。
- **Acceptance Criteria**：
  - 包含非法控制字符或非 ASCII 字符的查询参数不会引发 500，稳定交由下游鉴权返回 401。
  - 现有 HTTP 请求头具有最高权威性，不受查询参数干扰。

### TASK-011：编写算法、文本契约与鉴权单元测试

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/retrieval/retrieval_test.go`、`internal/formatters/formatters_test.go` 与 `internal/auth/auth_test.go` 中编写对应单元测试。
- **Details**：
  - 针对分词断字、同义/近似标题查重打分、空 query 浏览及 tie-breaker 排序设计覆盖断言。
  - 针对 formatters 导入固定测试用例，断言与 Python 函数相同输出。
  - 针对通配与分组权限交叉情况进行组合断言。
  - 针对中间件的合法 URL Token、换行符注入进行 HTTP 请求级验证。
- **Acceptance Criteria**：
  - `go test -v ./internal/retrieval ./internal/formatters ./internal/auth` 全部通过。

---

## Phase 3：双通道传输适配层与管理 CLI

### TASK-012：实现 MCP Streamable HTTP 协议服务与 7 个工具

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/server/mcp.go` 中基于 `mcp-go` 注册 7 个记忆工具并集成 Streamable HTTP 传输端点，严格锁定原生工具名并实现逐请求 Claims 透传与传输层协议头。
- **Details**：
  - 工具名称严格锁定原生契约（对齐 `capsa/mcp_service.py`）：
    1. `memory_groups`：列出可访问分组、统计数与权限。
    2. `memory_search`：关键词检索（含 `include_body` 兜底），上限 20 条。
    3. `memory_peek`：获取摘要，上限 10 条。
    4. `memory_read`：获取完整正文，上限 5 条。
    5. `memory_save`：创建记忆，返回 ID 与标题近似预警。
    6. `memory_update`：更新记忆内容或复核时间。
    7. `memory_forget`：软删除记忆。
  - 传输层与鉴权协议头契约：
    - 缺失或无效令牌：返回 `HTTP/1.1 401 Unauthorized`，Header 包含 `WWW-Authenticate: Bearer`，Body 为空。
    - 有效令牌握手：`initialize` 请求返回 `200` + `Content-Type: text/event-stream` + `Mcp-Session-Id` 响应头 + `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform`。
    - SSE 帧格式：按 `event: message` 与 `data: {jsonrpc...}` 分帧下发，`protocolVersion` 协商为 `2024-11-05`。
  - 上下文透传：中间件层将解析后的 `claims`（`key_id` 与 `grants`）注入 `context.Context`，工具处理器从 context 提取权限。
  - 错误模型：业务参数校验错误（如超长、必填项缺失）或已认证会话内的越权访问返回工具级 `isError: true`，错误文本与 Python 侧逐字对齐。
- **Acceptance Criteria**：
  - 标准 MCP 客户端通过 initialize 握手并能执行全部 7 个工具读写。
  - 协议头（`Mcp-Session-Id`, `WWW-Authenticate` 等）与错误文本完全对齐。

### TASK-013：实现 Web RESTful API 统一信封与管理员守卫网关

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/server/web_api.go` 中实现统一响应信封、全局管理员守卫与 1:1 映射的真实 RESTful 管理端点。
- **Details**：
  - 统一信封格式：`{"success": bool, "data": any, "error": {"code": string, "message": string}}`。
  - 错误码定义：`UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (422), `INTERNAL_ERROR` (500)。
  - 管理员网关：`/api` 路由前置守卫，要求令牌必须具备 `*:rw` 权限，未认证回 401 信封（文案“缺少或无效的 Bearer 令牌”），非通配权限回 403 信封（文案“Web 管理台仅支持管理员凭据访问”）。
  - 防自锁守卫：实现 `_check_key_guard`，禁止吊销或物理删除当前请求正在使用的 Key，禁止对环境变量管理员虚拟 Key 执行操作。
  - 防侧信道 404：条目不存在、已删除或无权访问时，固定返回“记忆不存在或无权访问”，不回显 ID。
  - 字段级校验：
    - 分类 slug 严格匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$`，名称最大 60，描述最大 200；冲突返回 422。
    - Key 名称最大 60，scopes 校验分组存在性与 `r|rw` 权限合法性；`POST /api/keys` 成功返回 HTTP 201 与明文令牌。
    - 列表项追加 `permission` 与 `is_overdue` 字段。
  - 端点真实清单（严格 1:1 对齐代码库）：
    - `GET /api/auth/me`
    - `GET /api/groups`、`POST /api/groups`、`PUT /api/groups/{slug}`、`DELETE /api/groups/{slug}`
    - `GET /api/keys`、`POST /api/keys`、`POST /api/keys/{id}/revoke`、`DELETE /api/keys/{id}`
    - `GET /api/memories`（统一接收 `status` 参数：`active`、`overdue`、`deleted`；`limit` 范围 1~100 默认 20；`offset` >= 0；`query` 仅在 `status=active` 时支持）
    - `POST /api/memories`、`GET /api/memories/{id}`、`PUT /api/memories/{id}`、`DELETE /api/memories/{id}`（支持可选 JSON body `{"reason": string}`）、`POST /api/memories/{id}/restore`
- **Acceptance Criteria**：
  - 所有端点路径与参数校验完全对齐前端调用。
  - 统一信封与错误消息与 Python 侧逐字对齐。
  - 非管理员凭据请求 `/api` 稳定返回 403 信封。

### TASK-014：实现前端 SPA 静态产物无条件内嵌与根路由装配

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/server/static.go` 与 `internal/server/server.go` 中利用 `go:embed` 无条件内嵌静态构建产物，实现单服务路由与 1MB 请求体限制中间件。
- **Details**：
  - 静态内嵌契约：使用 `//go:embed all:static` 无条件打包 `internal/server/static/` 目录；静态目录缺失在编译期直接报错。构建产物不入库（`.gitignore` 忽略该目录），编译前须先产出前端（本机 `cd web && npm run build`，Docker 构建阶段由 `web-builder` 自动完成）。
  - SPA 路由回退：非静态文件路径请求回退至 `index.html`。
  - 根应用装配路由：`/healthz` → `/mcp` → `/api` → `/`。
  - 增加请求体体积限制中间件：最大允许 1MB (1048576 字节)，超限立即截断并返回 413 纯文本。
- **Acceptance Criteria**：
  - 浏览器访问根路径能完整加载管理台 SPA 并正常进行页面跳转。
  - 大于 1MB 的 POST 请求被正确拦截为 HTTP 413。

### TASK-015：实现 capsa 管理员 CLI 命令集合与中期基线度量

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `cmd/capsa/main.go` 中实现 CLI 工具，提供数据库维护、离线管理与服务运行命令，覆盖全部 13 个叶子命令，并建立包含完整依赖的中期基线。
- **Details**：
  - 命令清单（13 个叶子命令 = 12 项既有指令 + 新增 `capsa serve`，层级与参数对齐代码库）：
    - `capsa init`：初始化数据库并写入默认分组。
    - `capsa group add` / `list` / `delete`：分组增查删。
    - `capsa key create` / `list` / `revoke`：离线签发与管理 Key；`key create` 输出格式严格保持 `Key ID: <id>` 与 `令牌: <token>` 两行，供自动化脚本解析。
    - `capsa memory list-deleted` / `restore`：回收站条目查看与恢复；`list-deleted` 经 `ListDeletedMemories` 按 `(deleted_at DESC, id DESC)` 输出。
    - `capsa review`：顶层命令，离线审阅记忆条目（支持 `--group`, `--query`, `--limit`）。
    - `capsa backup <dir> [--keep-days 14]`：利用 SQLite 在线备份 API 生成日期快照并清理过期备份。
    - `capsa restore <file>`：从指定备份文件恢复数据库。
    - `capsa serve [--host 0.0.0.0] [--port 8000]`：启动 HTTP 服务，默认监听 `0.0.0.0`（新增子命令，Python 侧由 `uvicorn` 提供，非既有 CLI）。
  - 编译最终二进制 `bin/capsa`，记录包含完整依赖与 embed 静态产物的空载产物体积与常驻 RSS 内存。
- **Acceptance Criteria**：
  - 完整实现 13 项叶子指令（12 项既有 CLI 指令 + 新增 `serve`），既有指令层级与参数完全对齐现有 CLI。
  - `capsa key create` 输出两行格式可通过 `sed -n 's/^令牌: //p'` 正确解析。
  - 记录 Phase 3 完整二进制体积与常驻内存基线。

---

## Phase 4：全套回归验证、容器化与工程清理

### TASK-016：编写集成测试与适配前端 E2E 起动链路

- **Status**：DONE
- **Executor**：Subagent: executor
- **Description**：适配 `web/tests/serve.sh` 脚本切换至 Go 服务二进制，执行 Playwright E2E 套件与 Go 内部集成测试。
- **Details**：
  - 适配 `web/tests/serve.sh`：将 Python 执行入口替换为编译出的 Go 二进制（`bin/capsa init`、`bin/capsa key create`、`exec bin/capsa serve --host 127.0.0.1 --port "$PORT"`）。
  - 执行前端 Playwright E2E 测试套件：`cd web && npm run test:e2e`，验证全部 12 条浏览器用例全绿通过。
  - 编写 `tests/integration_test.go`：覆盖端点 401/403/404/413/422 状态码与信封消息逐字断言，验证 MCP initialize 响应头与 SSE 帧格式。
- **Acceptance Criteria**：
  - 前端 E2E 套件 100% 通过（12 条用例）。
  - Go 原生集成测试全量通过。

### TASK-017：重构 Dockerfile 与容器编排为 Alpine 极简镜像

- **Status**：DONE
- **Executor**：Subagent: executor
- **Description**：更新 `Dockerfile` 与 `docker-compose.yml`，将镜像构建体系切换为 Go 静态编译与 Alpine 极简运行时，闭合 PATH、CMD 与阶段间搬运契约。
- **Details**：
  - 阶段一：`node:20-alpine AS web-builder` 构建前端静态产物输出至 `/build/static`。
  - 阶段二：`golang:1.27-alpine` 镜像，显式执行 `COPY --from=web-builder /build/static/ internal/server/static/`，执行 `CGO_ENABLED=0 go build -ldflags="-s -w" -o /capsa ./cmd/capsa`。
  - 阶段三：Alpine 运行环境（`alpine:latest`），安装 `curl` 满足 `HEALTHCHECK` 探活依赖；执行 `COPY --from=builder /capsa /usr/local/bin/capsa` 将可执行文件安装至系统 PATH，保证 README 既有运维命令直接可用；声明 `CMD ["capsa", "serve", "--host", "0.0.0.0", "--port", "8000"]` 默认监听通配地址。
  - 调整 `docker-compose.yml` 保持挂载卷 `/data` 与 `/backup` 兼容。
- **Acceptance Criteria**：
  - Docker 镜像体积缩减至 30MB 以内（可执行文件约 15~18MB）。
  - 容器自带 HEALTHCHECK curl 正确探活 `/healthz`。
  - `docker compose run --rm capsa capsa init` 等既有运维命令正常执行。

### TASK-018：清理 Python 遗留代码与测试并更新基线文档

- **Status**：DONE
- **Executor**：Subagent: executor
- **Description**：彻底清理 Python 遗留代码栈、旧静态目录与测试，同步更新 `.docs/Project.md` 与 `README.md`。
- **Details**：
  - 移除 `capsa/` 下全部 Python 文件（`*.py`）、旧静态目录及 `capsa/` 空壳、`pyproject.toml` 及 `tests/` 下旧 Python 测试套件。
  - 更新 `.docs/Project.md` 与 `README.md`：
    - 更新「环境与运行」：语言记录为 Go 1.27+，构建指令更新为 `go build`，移除 Python 与 pip 描述。
    - 更新「结构」与「约束与决策」：记录 Go 重构选型（`modernc.org/sqlite` 无 CGO、标准库 HTTP 路由、`embed` 静态打包、固定微秒时间戳格式串）。
    - 记录实测最终常驻内存（RSS < 15MB）与镜像体积。
- **Acceptance Criteria**：
  - 仓库内无过期 Python 源码与空壳目录残留，`git status` 干净自洽。
  - `.docs/Project.md` 真实反映代码库现状。
  - 容器启动后常驻内存实测低于 15MB。
