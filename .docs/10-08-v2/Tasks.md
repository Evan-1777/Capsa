# Tasks：吸收 Review 报告修复 Go 重构残留问题

**关联 Plan**：无（Quick 通道，跳过 Plan）
**总计 Task**：9 个
**状态**：DONE
**完成日期**：2026-10-08
**回归测试结论**：`go test -count=1 ./...` 全量通过（含新增 formatters 越界 offset、retrieval 银行家舍入、db 跨格式字典序、tests 集成 null 语义与字段序共 5 组用例）；`go vet ./...` 无告警；`gofmt -l` 无差异；前端 Playwright E2E **12/12 通过**（真实 Go 二进制驱动）。

---

## 审阅意见吸收结论（批判性）

**采纳**（有实测/逐字比对证据，修法结构归位）：

- ① `memory_read` 越界 `offset` panic —— 复现属实（`formatters.go:171-186` 钳 `available` 未钳 `offset`，Go 切片不像 Python 吞越界）。
- ② JSON `null` 被当清空 —— 与旧 `is not None` 分叉，`{"description":null}` 静默清空属破坏性写入。
- ⑤ MCP `memory_update` 字段回显被字母序排序（旧为插入序），差异由一行 `sortStrings` 包装引入。
- ⑤ 相似度舍入 `math.Round` 与 Python `round()` 银行家舍入分叉，`0.625` 可达。
- ⑤ MCP `limit`/`offset` 应为 `integer`、`clear_review_at` 应带 `default:false`（旧 Python 注解如斯）。
- ⑥ 越界 offset 与 null 语义两条破坏性路径无回归断言，补上。
- ③ README / Project.md 的「约 2MB / ≈2.2MB」实测不可复现（本机 go1.27 实测空载 ≈13MB）。
- ⑦ `minInt` 重造内建 `min`、`sortStrings` 一行包装、`AccessToken.Token` 死字段。
- ⑧ AGENTS.md / CLAUDE.md 指向已删除的 `.pi/agents/`。

**驳回/不改**（附理由）：

- ④ 归档 Plan/Tasks 的 SSE 口径 —— `Project.md:147` 已诚实记录传输栈差异；`.docs/10-08-v1/` 是带日期的历史快照，按项目约定不重写。「未用真实 MCP 客户端验证」属本轮无法完成的验证项，记录不改代码。
- ③ `mem_limit` 容器内存上限 —— 现编排无该字段，新增属未经请求的扩张（YAGNI），驳回。
- ⑤ `WWW-Authenticate` 文案 —— 归档 Plan 明确指定了裸 `Bearer` 形态，属有意选择。
- ⑤ 413 纯文本、`pinned` 新错误串、DAL scopes 静默失败 —— 均非文档化的外部契约，且失败均向安全侧或不可见，改动无实测收益。
- ⑦ `toInt`/`pinnedOf`/`tagsOf`/`tagsLiteral`/`normalizeTags` 的 `any` 分型分支 —— 确为不可达，但它们是 `map[string]any` 契约（`Project.md:114`）的宽容解码，删除收益微小而触及 4 文件，Quick 约束下不做，记录待后续。

**Subagent 协同评估**：本轮 9 个 Task 均小、强依赖本会话已验证的上下文（复现结论与逐字比对），委托需重载上下文且无法形成实质并行 —— 三维权衡为负，全部保留主线（`Executor: 主线`）。

---

## Phase 1：正确性修复（破坏性路径）

### TASK-001：钳制 memory_read 的 offset 到正文长度

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `internal/formatters/formatters.go` 的 `FormatRead` 中，切片前将 `offset` 钳到 `len(body)`，消除越界 panic；同时用内建 `min` 替换 `minInt`。
- **Details**：
  - `body := []rune(...)` 之后加 `if offset > len(body) { offset = len(body) }`
  - 删除随之不可达的 `if available < 0` 分支
  - `minInt(a,b,c)` → 内建 `min(a,b,c)`，删除 `minInt` 函数
- **Acceptance Criteria**：
  - `FormatRead` 传 `offset=999`、正文 32 字符不 panic，输出占位符「（正文已到结尾，无更多内容）」
  - `formatters_test.go` 补该回归用例并通过

### TASK-002：Web 分类更新改用 null 值判定

- **Status**：DONE
- **Executor**：主线
- **Description**：`internal/server/web_api.go` 的 `groupUpdate` 用 `payload["name"] / payload["description"]` 的 **nil 值** 判定替代键存在性，对齐旧 `is not None`。
- **Details**：
  - `name == nil && description == nil` → 422「至少提供一个待更新字段」
  - `name != nil` / `description != nil` 才更新对应字段
  - 顺带对齐 `memoriesList` 的 `?status=` 空值语义：仅当 `query.Has("status")` 时取该值，空串落入 422 而非默认 `active`
- **Acceptance Criteria**：
  - `PUT /api/groups/{slug}` 传 `{"description":null}` → 422，且库中描述不变
  - `?status=`（空值）→ 422

### TASK-003：修复 MCP 标签 null 语义、字段序与参数 schema

- **Status**：DONE
- **Executor**：主线
- **Description**：`internal/server/mcp.go` 的 `handleUpdate` 用 `value != nil` 判定 `tags`；字段回显按插入序；`limit`/`offset` 改 `WithInteger`；`clear_review_at` 补默认值；删除 `sortStrings` 包装。
- **Details**：
  - `if value, ok := arguments["tags"]; ok && value != nil`
  - 用有序 `names []string` 按 title→summary→body→tags→pinned→review_at 记录，替代 map 遍历 + 排序
  - `mcp.WithNumber(...)` → `mcp.WithInteger(..., mcp.DefaultNumber(...))`（limit、offset）
  - `clear_review_at` 加 `mcp.DefaultBool(false)`
  - 删除 `sortStrings` 与不再使用的 `sort` 导入
- **Acceptance Criteria**：
  - `"tags": null` 为 no-op，`"tags": []` 清空
  - 更新多字段时回显序与旧版一致（如 `title, summary`）
  - `go build` 通过，工具 schema 中 limit/offset 为 integer

### TASK-004：相似度舍入对齐银行家舍入

- **Status**：DONE
- **Executor**：主线
- **Description**：`internal/retrieval/retrieval.go` 的 `round2` 改用 `math.RoundToEven`，对齐 Python `round()`。
- **Details**：`math.Round(value*100)/100` → `math.RoundToEven(value*100)/100`
- **Acceptance Criteria**：
  - `0.625` → `0.62`（旧 Python 一致）
  - `retrieval_test.go` 补该断言并通过

### TASK-005：删除 AccessToken.Token 死字段

- **Status**：DONE
- **Executor**：主线
- **Description**：`internal/auth/verifier.go` 删除 `AccessToken.Token` 字段及两处赋值（全库无读取）。
- **Details**：删除结构体字段与 `&AccessToken{Token: token, ...}` 两处初始化中的 `Token: token,`
- **Acceptance Criteria**：`go build ./...` 与 `go test ./...` 通过

---

## Phase 2：回归测试补强

### TASK-006：补 Web / MCP null 语义与字段序集成测试

- **Status**：DONE
- **Executor**：主线
- **Description**：在 `tests/integration_test.go` 补三类回归断言。
- **Details**：
  - 建分类→`PUT` 传 `{"description":null}` → 422，`GET` 校验描述未变
  - MCP `memory_update` 传 `"tags": null` → 标签不变
  - MCP `memory_update` 同时更新 title+summary → 回显 `字段: title, summary`（插入序）
- **Acceptance Criteria**：新增用例通过且能捕获 TASK-001~003 的回归

### TASK-007：强化时间戳字典序测试

- **Status**：DONE
- **Executor**：主线
- **Description**：`internal/db/db_test.go` 的字典序测试改为对显式字面量（含旧 25 字符无微秒 `isoformat` 形态与定宽形态）断言排序等价，替代 Go 对 Go 的自我循环。
- **Details**：构造 `["2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00.000001+00:00", ...]`，断言字符串升序与时间升序一致
- **Acceptance Criteria**：用例通过，且能暴露跨格式字典序错位

---

## Phase 3：文档一致性

### TASK-008：按实测更正内存指标 SSOT

- **Status**：DONE
- **Executor**：主线
- **Description**：更正 `README.md` 与 `.docs/Project.md` 中失实的常驻内存数字为实测值。
- **Details**：
  - 实测：空载 RSS ≈ 13 MB，健康检查后 ≈ 16 MB，轻度请求后 ≈ 20 MB 且不回落；重构前 Python 版 81 MB
  - `README.md:3`、`.docs/Project.md:50`、`.docs/Project.md:107`
  - 不改归档 `.docs/10-08-v1/`（历史快照）
- **Acceptance Criteria**：三处数字与实测一致，不再出现「约 2MB / 2.2MB」

### TASK-009：修正失效的 .pi/agents 引用

- **Status**：DONE
- **Executor**：主线
- **Description**：`AGENTS.md` 与 `CLAUDE.md` 中指向已删除 `.pi/agents/` 的引用改指 `.agents/agents/`。
- **Details**：第 120、124、125 行；`.pi/agents/explore.md` → `.agents/agents/explore.md`，同理 executor
- **Acceptance Criteria**：两文件无 `.pi/` 残留，引用路径存在
