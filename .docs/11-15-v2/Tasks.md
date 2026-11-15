# Tasks：顶层双模工作区分区与文档工作区全栈子系统

**关联 Plan**：`Plan.md` —— 顶层双模工作区分区与文档工作区全栈子系统 v1.1  
**总计 Task**：10 个  
**状态**：DONE  
**完成日期**：2026-11-15  
**回归测试结论**：`go test ./...` 全量通过；`cd web && npm run build` 与 `go build -o bin/capsa ./cmd/capsa` 零错误；`npm run test:e2e` 15 条用例 100% PASSED；两项源码门禁（旧样式令牌、工作流中立）匹配数均为 0  

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:16px;margin:14px 0;background:#fafafa;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.5">
  <div style="font-weight:600;color:#52525b;margin-bottom:10px">原子任务执行拓扑与模块落点矩阵</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
    <div style="border:1px solid #6750A4;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#6750A4;margin-bottom:4px">Phase 1 · 存储与访问层</div>
      <div><strong>TASK-001</strong> (P0 · 无依赖)<br><span style="color:#71717a;font-size:11px">标识符生成、双模表结构与存量无损迁移</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-002</strong> (P0 · 依赖 001)<br><span style="color:#71717a;font-size:11px">工作区 CRUD 与记忆工作区隔离查询</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-003</strong> (P0 · 依赖 002)<br><span style="color:#71717a;font-size:11px">文档分类、访问 ID 轮换与两级文档原子读写</span></div>
    </div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46;margin-bottom:4px">Phase 2 · 协议与接口层</div>
      <div><strong>TASK-004</strong> (P0 · 依赖 003)<br><span style="color:#71717a;font-size:11px">分类访问 ID 校验与独立文档 MCP 7 工具</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-005</strong> (P0 · 依赖 003)<br><span style="color:#71717a;font-size:11px">工作区与文档子系统 Web REST 接口扩展</span></div>
    </div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46;margin-bottom:4px">Phase 3 · MD3 前端层</div>
      <div><strong>TASK-006</strong> (P0 · 依赖 005)<br><span style="color:#71717a;font-size:11px">客户端类型、共享 Markdown 与顶栏切换器</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-007</strong> (P0 · 依赖 006)<br><span style="color:#71717a;font-size:11px">全局工作区设置页与记忆工作区收敛</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-008</strong> (P0 · 依赖 007)<br><span style="color:#71717a;font-size:11px">全新 MD3 文档工作区界面与在线编辑</span></div>
    </div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46;margin-bottom:4px">Phase 4 · 全栈验收层</div>
      <div><strong>TASK-009</strong> (P0 · 依赖 004, 005)<br><span style="color:#71717a;font-size:11px">Go 存储迁移、权限边界与双模集成测试</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-010</strong> (P0 · 依赖 008, 009)<br><span style="color:#71717a;font-size:11px">前端构建重编、Playwright E2E 与文档维护</span></div>
    </div>
  </div>
</div>

---

## Phase 1：双模工作区存储模型、存量平滑迁移与数据访问层

### TASK-001：扩展 `internal/ids` 与 `internal/db` 实现双模表结构及存量数据库无损迁移

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：无
- **Executor**：主线
- **Description**：在 `internal/ids/ids.go` 中新增工作区、文档分类、文档主键及高熵分类访问 ID 生成函数；在 `internal/db/db.go` 中扩展 `workspaces`、`groups.workspace_id`、`doc_categories`、`documents` 表结构与部分唯一索引，并实现针对既有存量数据库的幂等平滑迁移与默认记忆工作区预置。
- **Details**：
  - 在 `internal/ids/ids.go` 中新增确定性前缀 CSPRNG 生成函数（复用 `idAlphabet` 与 `secretAlphabet`）：
    - `NewWorkspaceID() string`：返回 `"ws_" + randomFrom(idAlphabet, 8)`（总长 11）。
    - `NewDocCategoryID() string`：返回 `"cat_" + randomFrom(idAlphabet, 8)`（总长 12）。
    - `NewDocumentID() string`：返回 `"doc_" + randomFrom(idAlphabet, 8)`（总长 12）。
    - `NewDocAccessID() string`：返回 `"capsa_doc_" + randomFrom(secretAlphabet, 32)`（总长 42，全可打印 ASCII，192 bit 熵，与 `capsa_<8位keyID>_<32位secret>` 前缀空间严格不交叠）。
  - 在 `internal/db/db.go` 中定义默认工作区常量：
    - `DefaultWorkspaceID = "default"`、`DefaultWorkspaceName = "默认记忆工作区"`、`DefaultWorkspaceDesc = "系统默认记忆工作区"`。
  - 在 `internal/db/db.go` 的 `Schema` 中定义完整表与索引（不触碰 `memories` 与 `keys` 既有列定义和约束，严禁预置任何工作流文件名）：
    - `workspaces` 表：`id TEXT PRIMARY KEY`、`name TEXT NOT NULL`、`description TEXT NOT NULL DEFAULT ''`、`mode TEXT NOT NULL CHECK(mode IN ('memory', 'docs'))`、`created_at TEXT NOT NULL`、`updated_at TEXT NOT NULL`。
    - `groups` 表：新增列 `workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id)`，保留 `slug TEXT PRIMARY KEY`，并建索引 `idx_groups_workspace ON groups(workspace_id)`。
    - `doc_categories` 表：`id TEXT PRIMARY KEY`、`workspace_id TEXT NOT NULL REFERENCES workspaces(id)`、`name TEXT NOT NULL`、`description TEXT NOT NULL DEFAULT ''`、`access_id TEXT UNIQUE NOT NULL`、`created_at TEXT NOT NULL`、`updated_at TEXT NOT NULL`，建唯一索引 `idx_doc_categories_ws_name ON doc_categories(workspace_id, name)`。
    - `documents` 表：`id TEXT PRIMARY KEY`、`workspace_id TEXT NOT NULL REFERENCES workspaces(id)`、`scope TEXT NOT NULL CHECK(scope IN ('public', 'category'))`、`category_id TEXT REFERENCES doc_categories(id)`、`path TEXT NOT NULL`、`content TEXT NOT NULL DEFAULT ''`、`created_at TEXT NOT NULL`、`updated_at TEXT NOT NULL`，包含表级检查 `CHECK((scope = 'public' AND category_id IS NULL) OR (scope = 'category' AND category_id IS NOT NULL))`，并建两条部分唯一索引：
      - `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_public_path ON documents(workspace_id, path) WHERE category_id IS NULL;`
      - `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_category_path ON documents(workspace_id, category_id, path) WHERE category_id IS NOT NULL;`
  - 实现幂等迁移逻辑：
    - `InitSchema(handle *sql.DB) error`：先执行 `workspaces`、`doc_categories`、`documents` 与其它表的 `CREATE TABLE IF NOT EXISTS`；通过 `PRAGMA table_info(groups)` 检查 `groups` 表是否已含 `workspace_id` 列，若缺失（存量旧库升级场景）则执行 `ALTER TABLE groups ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default'`（不带 `REFERENCES` 子句以兼容 SQLite `foreign_keys=1` 下的非空默认值加列规则），随后建齐 `idx_groups_workspace` 等全部索引，最后执行 `INSERT OR IGNORE INTO workspaces (id, name, description, mode, created_at, updated_at) VALUES ('default', '默认记忆工作区', '系统默认记忆工作区', 'memory', now, now)`。
    - 新增 `MigrateIfInitialized(handle *sql.DB) error`：查询 `sqlite_master` 判断 `groups` 表是否已存在；若不存在（全新未初始化空库）直接返回 `nil`（确保 `CheckDBHealth()` 在 `capsa init` 前仍返回 `false` / 503）；若 `groups` 已存在则调用 `InitSchema(handle)` 完成存量旧库自动无损升级。
- **Acceptance Criteria**：
  - 全新空库未调用 `InitSchema` 前 `CheckDBHealth()` 返回 `false`；调用 `InitSchema` 两次均无报错，且 `workspaces` 表中存在 `id = 'default', mode = 'memory'`。
  - 构造仅含旧版 `groups`（无 `workspace_id` 列）、`keys`、`memories` 及存量数据的 SQLite 库，调用 `MigrateIfInitialized` 后 `groups.workspace_id` 自动填充为 `'default'`，存量记忆数据零丢失。
  - 执行 `go test ./internal/ids/... ./internal/db/...` 全部通过。

---

### TASK-002：在 `internal/dal` 中实现工作区生命周期管理与传统记忆工作区隔离查询

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-001
- **Executor**：主线
- **Description**：在 `internal/dal/dal.go`（或同包拆分文件 `internal/dal/workspaces.go`）中实现工作区增删改查接口，并为传统 `groups` 与 `memories` 增加按 `workspace_id` 收敛的隔离查询与写入函数，同时保持既有无 `workspace_id` 入参函数的向后兼容委托。
- **Details**：
  - 工作区数据访问函数：
    - `ListWorkspaces(handle *sql.DB) ([]map[string]any, error)`：按 `CASE WHEN w.id = 'default' THEN 0 ELSE 1 END, w.created_at ASC, w.id ASC` 返回全部工作区，附带统计字段 `group_count`（`groups` 计数）、`category_count`（`doc_categories` 计数）与 `public_doc_count`（`documents WHERE scope = 'public'` 计数）。
    - `GetWorkspace(handle *sql.DB, workspaceID string) (map[string]any, error)`：按 `id` 查询单工作区（含上述统计字段），不存在返回 `nil, nil`。
    - `CreateWorkspace(handle *sql.DB, name, description, mode string) (map[string]any, error)`：生成 `ids.NewWorkspaceID()`（主键冲突最多重试 3 次），写入 `workspaces` 并返回完整工作区记录。
    - `UpdateWorkspace(handle *sql.DB, workspaceID, name, description string) (bool, error)`：仅更新 `name`、`description` 与 `updated_at`（`mode` 固定不可修改）。
    - `DeleteEmptyWorkspace(handle *sql.DB, workspaceID string) (string, error)`：若 `workspaceID == db.DefaultWorkspaceID` 直接返回 `"is_default", nil`；否则在 `BEGIN IMMEDIATE` 排他事务内校验存在性（缺失返回 `"not_found"`）：
      - 当 `mode == "memory"` 时检查 `SELECT COUNT(*) FROM groups WHERE workspace_id = ?`，大于 0 返回 `"not_empty"`；
      - 当 `mode == "docs"` 时检查 `doc_categories` 与 `documents` 中 `workspace_id = ?` 的总行数，大于 0 返回 `"not_empty"`；
      - 为 0 时执行 `DELETE FROM workspaces WHERE id = ?` 并提交，返回 `"deleted"`。
  - 传统记忆分组与条目的工作区隔离扩展（保持既有函数签名零破坏，`groups.slug` 维持全局唯一主键，跨记忆工作区重名返回 `"duplicate"`）：
    - 新增 `AddGroupInWorkspace(handle *sql.DB, workspaceID, slug, name, description string) (string, error)`：校验目标工作区存在且 `mode == "memory"`（不存在返回 `"workspace_not_found"`，模式非 `memory` 返回 `"wrong_mode"`），执行 `INSERT OR IGNORE INTO groups (slug, workspace_id, name, description, created_at) ...`，成功返回 `"inserted"`，全局 `slug` 冲突返回 `"duplicate"`。原 `AddGroup(handle, slug, name, description) (bool, error)` 委托调用 `AddGroupInWorkspace(handle, db.DefaultWorkspaceID, slug, name, description)`，将 `status == "inserted"` 映射为 `true, nil`、`status == "duplicate"` 映射为 `false, nil`（其余异常返回 `false, fmt.Errorf(...)`）。
    - `GetGroup`、`ListGroups`、`ListGroupsWithCounts` 的 SELECT 列统一补充 `g.workspace_id`（`formatters.FormatGroups` 仅读取 `slug/name/description/memory_count`，不影响 `/mcp` 输出，同时保证 `GET /api/groups` 与 `POST /api/groups` 返回完整的 `GroupInfo.workspace_id`）；新增 `ListGroupsInWorkspace(handle *sql.DB, workspaceID string) ([]map[string]any, error)` 与 `ListGroupsWithCountsInWorkspace(handle *sql.DB, scopes map[string]string, workspaceID string) ([]map[string]any, error)`（当 `workspaceID != ""` 时追加 `g.workspace_id = ?` 过滤条件；原 `ListGroups` 与 `ListGroupsWithCounts` 委托传 `""`，保持 `/mcp` 与 CLI 100% 兼容）。
    - 新增 `ListActiveMemoriesForSearchInWorkspace(handle *sql.DB, scopes map[string]string, workspaceID, group string, includeBody bool) ([]map[string]any, error)` 与 `ListMemoriesForWebInWorkspace(handle *sql.DB, scopes map[string]string, workspaceID, status, group string, offset, limit int) ([]map[string]any, int, error)`（完整保留 `rows, total, err` 三返回值）：当 `workspaceID != ""` 时追加 `group_slug IN (SELECT slug FROM groups WHERE workspace_id = ?)` 条件，使管理台在指定记忆工作区下的工作台列表、关键词检索、时效复核、回收站数据严格收敛至该记忆工作区；原 `ListActiveMemoriesForSearch` 与 `ListMemoriesForWeb` 委托传 `workspaceID = ""`。
- **Acceptance Criteria**：
  - 既有 `cmd/capsa`、`internal/server` 与全部存量单测无需改动即可编译通过。
  - 执行 `go test ./...` 全量通过。

---

### TASK-003：在 `internal/dal` 中实现文档工作区分类管理、访问 ID 轮换与两级文档原子读写接口

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-002
- **Executor**：主线
- **Description**：新增 `internal/dal/docs.go`，实现文档路径规范化校验、文档分类增删改查、分类访问 ID 重置轮换、基于访问 ID 的上下文反查，以及两级文档容器的检索、行读取、防覆盖创建、覆写、排他事务局部替换与物理删除。
- **Details**：
  - 文档路径规范化纯函数 `NormalizeDocPath(raw string) (string, string)`：
    - 去除首尾空白；为空返回错误消息 `"文档路径不能为空"`；字符数超过 `255` 返回 `"文档路径超长（上限 255 字符）"`。
    - 拒绝含反斜杠 `\`、控制字符（`r < 0x20 || r == 0x7f`）、首尾 `/`、连续空段 `//`、以及段名为 `.` 或 `..` 的输入，返回明确的中文校验错误消息；允许普通文件名（如 `overview.md`）与多级逻辑路径（如 `guides/setup.md`）。
  - 文档分类数据访问函数（操作前均核验 `workspaceID` 属于 `mode == "docs"` 的工作区）：
    - `ListDocCategories(handle *sql.DB, workspaceID string) ([]map[string]any, error)`：返回分类列表（含 `id, workspace_id, name, description, access_id, created_at, updated_at` 及 `doc_count`），按 `created_at ASC, id ASC` 排序。
    - `GetDocCategory(handle *sql.DB, workspaceID, categoryID string) (map[string]any, error)`：查询单分类（含 `doc_count`）。
    - `CreateDocCategory(handle *sql.DB, workspaceID, name, description string) (map[string]any, error)`：生成 `ids.NewDocCategoryID()` 与 `ids.NewDocAccessID()`，同名冲突返回明确状态供上层转 422。
    - `UpdateDocCategory(handle *sql.DB, workspaceID, categoryID, name, description string) (string, error)`：更新名称与描述，区分 `"not_found"`、`"duplicate_name"` 与 `"updated"`。
    - `RotateDocCategoryAccessID(handle *sql.DB, workspaceID, categoryID string) (map[string]any, error)`：生成新 `ids.NewDocAccessID()` 更新 `access_id` 与 `updated_at`，返回更新后的分类记录（不存在返回 `nil, nil`）。
    - `DeleteEmptyDocCategory(handle *sql.DB, workspaceID, categoryID string) (string, error)`：在 `BEGIN IMMEDIATE` 事务内检查存在性及 `SELECT COUNT(*) FROM documents WHERE workspace_id = ? AND category_id = ?`，含文档返回 `"has_documents"`，为空则删除并返回 `"deleted"`。
    - `FindDocCategoryByAccessID(handle *sql.DB, accessID string) (map[string]any, error)`：联表 `doc_categories c JOIN workspaces w ON w.id = c.workspace_id WHERE c.access_id = ? AND w.mode = 'docs'`，返回 `category_id, category_name, workspace_id, workspace_name`（供 `/mcp/docs` 鉴权使用）。
  - 两级文档数据访问函数：
    - 收敛为单一参数化查询构造器 `QueryDocuments(handle *sql.DB, q DocQuery) ([]map[string]any, error)`（其中 `DocQuery{WorkspaceID, ScopeFilter, CategoryID, PathSubstring, ExactPath string; IncludeContent bool}`）：
      - `ScopeFilter` 支持 `"public"`（`scope = 'public'`）、`"category"`（`scope = 'category' AND category_id = ?`）、`"all"`（`scope = 'public' OR (scope = 'category' AND category_id = ?)`）；
      - `IncludeContent == false`（Web 列表与 `doc_glob` 场景）仅投影 `id, workspace_id, scope, category_id, path, length(content) AS char_count, created_at, updated_at`，不加载大文本正文；`IncludeContent == true`（`doc_grep` 场景）额外投影 `content`；
      - 支持可选 `PathSubstring`（大小写不敏感路径子串过滤）与 `ExactPath`（精确单文档过滤），结果按 `CASE WHEN scope = 'public' THEN 0 ELSE 1 END, path ASC` 稳定排序。
    - 单文档读取：
      - `GetDocumentByID(handle *sql.DB, workspaceID, docID string) (map[string]any, error)`（Web 管理台按主键读取完整正文）。
      - `GetDocumentByPath(handle *sql.DB, workspaceID, scope, categoryID, path string) (map[string]any, error)`（MCP 工具按作用域与路径寻址读取完整正文）。
    - 文档写入、局部替换与删除：
      - `CreateDocument(handle *sql.DB, workspaceID, scope, categoryID, path, content string) (map[string]any, string, error)`：同名已存在时返回 `"duplicate"` 拒绝覆盖，成功返回完整文档与 `"created"`。
      - `OverwriteDocumentByPath(handle *sql.DB, workspaceID, categoryID, path, content string) (map[string]any, string, error)`：仅更新当前分类（`scope = 'category' AND category_id = ? AND path = ?`）下已存在的文档；不存在返回 `"not_found"`（绝不触碰公共文档或自动静默新建）。
      - `EditDocumentByPath(handle *sql.DB, workspaceID, categoryID, path, oldString, newString string, replaceAll bool) (int, string, error)`：在 `BEGIN IMMEDIATE` 排他写事务内读取当前分类下指定文档 `content`，不存在返回 `0, "not_found"`；计算 `count := strings.Count(content, oldString)`：`count == 0` 返回 `0, "no_match"`；`count > 1 && !replaceAll` 返回 `count, "ambiguous"`；否则执行单次或全量替换并写回 `content` 与 `updated_at`，提交事务后返回替换次数与 `"edited"`。
      - `DeleteDocumentByPath(handle *sql.DB, workspaceID, categoryID, path string) (bool, error)`：仅删除当前分类下指定路径文档。
      - `UpdateDocumentByID(handle *sql.DB, workspaceID, docID string, newPath *string, newContent *string) (map[string]any, string, error)` 与 `DeleteDocumentByID(handle *sql.DB, workspaceID, docID string) (bool, error)`：供 Web 管理台对公共区或分类区文档执行在线保存、重命名（唯一冲突返回 `"duplicate"`）与删除。
- **Acceptance Criteria**：
  - 严禁在 `internal/dal/docs.go` 中出现任何特定工作流文件名或模板硬编码。
  - 执行 `go build ./...` 与 `go test ./...` 全部通过。

---

## Phase 2：分类访问 ID 鉴权、独立文档 MCP 服务与管理台接口扩展

### TASK-004：实现分类访问 ID 校验及 `/mcp/docs` 独立端点 7 个类文件 MCP 工具

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-003
- **Executor**：主线
- **Description**：在 `internal/auth/verifier.go` 中新增 `VerifyDocAccessID`，新增 `internal/server/mcp_docs.go` 实现独立文档 MCP 服务实例与全部 7 个类文件工具，在 `internal/server/server.go` 中挂载 `/mcp/docs` 路由，并在 `cmd/capsa/main.go` 的 `cmdServe` 启动前置阶段接入存量库迁移快退检查。
- **Details**：
  - 在 `internal/auth/verifier.go` 中新增结构 `DocAccessIdentity{WorkspaceID, WorkspaceName, CategoryID, CategoryName string}` 与 `VerifyDocAccessID(token string) (*DocAccessIdentity, error)`：与 `VerifyToken` 采用完全一致的句柄生命周期——空串直接返回 `nil, nil`，非空时内部执行 `handle, err := db.Connect()` + `defer handle.Close()` 并调用 `dal.FindDocCategoryByAccessID(handle, token)`；仅接受有效 `doc_categories.access_id`，不接受 `CAPSA_ADMIN_TOKEN` 或传统 `keys` 令牌（物理隔离两套鉴权空间）。
  - 启动迁移快退与路由挂载（保持 `server.NewHandler() http.Handler` 纯路由签名不变，避免破坏 `tests/integration_test.go` 调用约定）：
    - 在 `cmd/capsa/main.go` 的 `cmdServe` 中，于打印启动日志及调用 `http.ListenAndServe` **之前**执行 `db.Connect()` + `db.MigrateIfInitialized(handle)` + `handle.Close()`；一旦连接或存量迁移报错，立即调用 `fail("数据库迁移失败：%v", err)` 以退出码 `1` 快速失败退出（未建表空库 `MigrateIfInitialized` 返回 `nil`，服务正常启动且 `/healthz` 保持返回 503）。
    - 在 `internal/server/server.go` 的 `NewHandler()` 中注册 `GET /mcp/docs`、`POST /mcp/docs`、`DELETE /mcp/docs` 到 `NewDocsMCPHandler(NewDocsMCPServer())`（置于静态根 `/` 之前，外层自动继承 `auth.QueryTokenAuth` 与 `bodyLimit`）。
  - 在 `internal/server/mcp_docs.go` 中实现 `docsBearerGuard`（未携带或校验失败返回 `401` + `WWW-Authenticate: Bearer` 空响应体，数据库异常返回 `500`；成功注入 `DocAccessIdentity` 到请求 `context` 并套用 `streamResponseWriter` 禁用下游缓冲）及 `NewDocsMCPServer()`（`mcpserver.NewStreamableHTTPServer` 配置 `WithEndpointPath("/mcp/docs")` 与 `WithDisableLocalhostProtection(true)`），挂载以下 **7 个类文件工具**：
    1. `doc_glob`（只读注解）：参数 `pattern`（可选）与 `scope`（可选 `"all" | "category" | "public"`，默认 `"all"`）。匹配规则收敛使用标准库 `path.Match` 与 `path.Base`（不引入自研 `**` 解析器）：① `pattern == ""` 匹配全部；② 不含 `*?[ ` 元字符时按大小写不敏感子串 `strings.Contains` 匹配路径；③ 含 `*?[ ` 时先转为小写并用 `path.Match` 校验语法（非法模式如 `"[a-"` 返回工具级错误），若 `pattern` 含 `/` 则仅用 `path.Match(lp, lpath)` 匹配全路径（`*` 不跨 `/`），若 `pattern` 不含 `/` 则 `path.Match(lp, lpath) || path.Match(lp, path.Base(lpath))` 命中即匹配。真值样例：`"" -> 全部命中`；`"setup" -> 命中 "guides/setup.md"`；`"*.md" -> 命中 "notes.md" 与 "guides/setup.md"`；`"guides/*.md" -> 命中 "guides/setup.md"、不命中 "guides/sub/a.md"`；`"[bad" -> 返回语法错误`。输出标明 `[public]` 或 `[category]`、路径、字符数与更新日期。
    2. `doc_grep`（只读注解）：参数 `pattern`（必填检索词或正则表达式）、`is_regex`（可选布尔，默认 `false`；为 `true` 时经 Go `regexp.Compile` 编译，非法正则返回工具级错误）、`scope`（可选 `"all" | "category" | "public"`，默认 `"all"`）、`path`（可选单文档路径过滤）、`limit`（可选返回匹配行上限，默认 `100`，范围 `1~500`）。调用 `dal.QueryDocuments(..., IncludeContent: true)` 按行扫描匹配并输出 `[scope] path:lineNumber: lineText` 及截断统计。
    3. `doc_read`（只读注解）：参数 `path`（必填文档路径）、`scope`（可选 `"category" | "public"`，默认 `"category"`）、`offset`（可选起始行号，1-based）、`limit`（可选最大读取行数）。未命中时直接按当前 `scope` 返回工具级错误（不额外发起跨作用域探测查询）；未传 `offset` 与 `limit` 时完整返回全文正文（**无 4,000 字符截断限制**）及总行数元信息；传入 `offset` 或 `limit` 时按行号区间分段截取，每行附带 `<行号>: <内容>` 前缀并标注当前行区间与总行数。
    4. `doc_create`（非破坏性写注解）：参数 `path`（必填）、`content`（必填字符串，允许空串 `""`）。若请求参数显式携带 `scope="public"` 立即返回工具级错误 `"公共文档区为只读，禁止修改"`；仅在当前分类下新建文档，同名已存在时返回 `isError: true` 拒绝覆盖。
    5. `doc_write`（幂等写注解）：参数 `path`（必填）、`content`（必填字符串，允许空串 `""`）。若传入 `scope="public"` 拒绝修改；对当前分类下已存在的指定文档执行全量内容覆盖更新，不存在时返回 `isError: true` 提示先调用 `doc_create`。
    6. `doc_edit`（写注解）：参数 `path`（必填）、`old_string`（必填非空字符串；为空返回 `isError: true`）、`new_string`（必填字符串，允许空串以删除片段；与 `old_string` 完全相同时返回错误提示）、`replace_all`（可选布尔，默认 `false`）。若传入 `scope="public"` 拒绝修改；调用 `dal.EditDocumentByPath` 执行排他事务原子替换，无匹配或多重匹配（未开 `replace_all`）均返回 `isError: true`。
    7. `doc_delete`（破坏性写注解）：参数 `path`（必填）。若传入 `scope="public"` 拒绝修改；删除当前分类下指定文档，不存在返回 `isError: true`。
- **Acceptance Criteria**：
  - `/mcp/docs` 未认证返回 `401` + `WWW-Authenticate: Bearer`，支持 `Authorization: Bearer <access_id>` 及 `?token=<access_id>` / `?access_token=<access_id>`。
  - `/mcp` 仍保持原有 7 个 `memory_*` 工具不变，`/mcp/docs` 返回 7 个 `doc_*` 工具，两端点凭据互不混通。
  - 执行 `go build ./...` 与 `go test ./...` 全部通过。

---

### TASK-005：在 `internal/server` 中扩展工作区、记忆工作区过滤及文档工作区管理 REST 接口

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-003
- **Executor**：主线
- **Description**：扩展 `internal/server/web_api.go`（及同包拆分文件 `internal/server/web_docs_api.go`），接入工作区 CRUD 接口、传统分组与记忆列表的 `workspace_id` 过滤支持，以及文档工作区分类管理、分类访问 ID 轮换与两级文档管理全套 REST 端点。
- **Details**：
  - 全部端点统一挂载于 `AdminGuard` 守卫下的 `NewWebHandler()`，复用 `envelope{Success, Data, Error}` 与标准错误码（`401/403/404/422/500`）：
  - 传统记忆接口向后兼容扩展：
    - `GET /api/groups`：读取可选查询参数 `workspace_id`；若非空则先核验工作区存在且 `mode == "memory"`（否则回 404/422），再调用 `dal.ListGroupsWithCountsInWorkspace`；省略 `workspace_id` 时保持返回全部可见分组。
    - `POST /api/groups`：支持可选字段 `workspace_id`（省略或空串时默认 `"default"`），调用 `dal.AddGroupInWorkspace`，校验目标工作区存在且为 `memory` 模式。
    - `GET /api/memories`：读取可选查询参数 `workspace_id`；若非空则调用 `ListActiveMemoriesForSearchInWorkspace` / `ListMemoriesForWebInWorkspace` 将结果收敛至该记忆工作区；省略时保持既有全库授权范围行为。
  - 顶层工作区管理接口：
    - `GET /api/workspaces`：返回 `{items, total, offset: 0, limit}`。
    - `POST /api/workspaces`：校验 `name`（必填，1~60 字符）、`description`（可选字符串，≤200 字符，非字符串如 `null` 返回 422）、`mode`（必填 `"memory"` 或 `"docs"`，其它值返回 422），成功返回 `201`。
    - `PUT /api/workspaces/{id}`：支持更新 `name`、`description`（至少提供一项）；只要请求 JSON 对象中包含 `"mode"` 键（无论值是否与原模式相同），一律返回 `422` `"工作区模式创建后不可修改"`；工作区不存在返回 `404`。
    - `DELETE /api/workspaces/{id}`：调用 `dal.DeleteEmptyWorkspace`，对 `"is_default"` 返回 `422` `"默认工作区不可删除"`，对 `"not_empty"` 返回 `422` `"工作区下仍有分类或文档，禁止删除"`，对 `"not_found"` 返回 `404`，成功返回 `200` `{id, action: "deleted"}`。
  - 文档工作区分类与文档接口（前置统一核验 `ws_id` 存在且 `mode == "docs"`，不存在回 `404`，模式不符回 `422`）：
    - `GET /api/workspaces/{ws_id}/categories`：返回分类列表（含 `access_id` 与 `doc_count`）。
    - `POST /api/workspaces/{ws_id}/categories`：校验 `name`（1~60 字符）、`description`（≤200 字符），重名返回 `422`，成功返回 `201`。
    - `PUT /api/workspaces/{ws_id}/categories/{cat_id}`：更新分类 `name` 与 `description`，重名回 `422`，缺失回 `404`。
    - `DELETE /api/workspaces/{ws_id}/categories/{cat_id}`：调用 `dal.DeleteEmptyDocCategory`，非空回 `422` `"分类下仍有文档，禁止删除"`，缺失回 `404`。
    - `POST /api/workspaces/{ws_id}/categories/{cat_id}/rotate-token`：调用 `dal.RotateDocCategoryAccessID` 重置分类访问 ID 并返回更新后的分类对象。
    - `GET /api/workspaces/{ws_id}/docs`：校验查询参数 `scope`（`"public"` 或 `"category"`；当 `scope == "category"` 时要求非空 `category_id` 且属于该工作区），可选 `query` 路径过滤，返回文档元数据列表。
    - `POST /api/workspaces/{ws_id}/docs`：校验 `scope`、`category_id`、`dal.NormalizeDocPath(path)` 与 `content`（必须为字符串，允许 `""`），同名冲突回 `422`，成功返回 `201` 完整文档详情。
    - `GET /api/workspaces/{ws_id}/docs/{doc_id}`：返回单文档完整详情（含 `content`），缺失回 `404`。
    - `PUT /api/workspaces/{ws_id}/docs/{doc_id}`：支持更新 `path`（重命名）和/或 `content`（在线编辑保存），至少提供一项；重命名路径冲突回 `422`，成功返回更新后的完整文档详情。
    - `DELETE /api/workspaces/{ws_id}/docs/{doc_id}`：物理删除指定文档，缺失回 `404`。
- **Acceptance Criteria**：
  - 既有 `tests/integration_test.go` 全部存量用例无需改动直接通过。
  - 执行 `go build ./...` 与 `go test ./...` 全部通过。

---

## Phase 3：顶栏工作区切换器、全局设置视图与 MD3 文档工作区界面

### TASK-006：扩展前端类型与 `api.ts` 客户端，抽离共享 `Markdown` 组件并升级 `TopBar` / `AppShell`

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-005
- **Executor**：主线
- **Description**：在 `web/src/types.ts` 与 `web/src/api.ts` 中补齐工作区与文档子系统接口定义，将安全净化 `Markdown` 组件上移至 `web/src/components/ui/Markdown.tsx` 供双模共用，并在 `TopBar.tsx` 与 `AppShell.tsx` 中以纯单向受控属性接入工作区切换器与全局设置入口。
- **Details**：
  - 在 `web/src/types.ts` 中新增类型：
    - `WorkspaceMode = "memory" | "docs"`、`WorkspaceInfo`（`id, name, description, mode, group_count, category_count, public_doc_count, created_at, updated_at`）、`WorkspaceInput`。
    - `DocScope = "public" | "category"`、`DocCategory`（`id, workspace_id, name, description, access_id, doc_count, created_at, updated_at`）、`DocCategoryInput`、`DocumentSummary`（`id, workspace_id, scope, category_id, path, char_count, created_at, updated_at`）、`DocumentDetail`（继承 `DocumentSummary` 并含 `content: string`）；同时为 `GroupInfo` 与 `GroupInput` 补充可选 `workspace_id`。
  - 在 `web/src/api.ts` 中扩展 `groups(workspaceId?: string)`、`memories({ ..., workspace_id?: string })`，并新增 `workspaces`、`createWorkspace`、`updateWorkspace`、`deleteWorkspace`、`docCategories`、`createDocCategory`、`updateDocCategory`、`deleteDocCategory`、`rotateDocCategoryToken`、`docs`、`doc`、`createDoc`、`updateDoc`、`deleteDoc` 方法。
  - 将 `web/src/memory/Markdown.tsx` 移至 `web/src/components/ui/Markdown.tsx` 并在 `web/src/components/ui/index.ts` 导出（保留 `ReactMarkdown` + `skipHtml` + `rehypeSanitize` + 外链 `target="_blank" rel="noopener noreferrer"` 一字不改；`web/src/memory/MemoryDetailPane.tsx` 改为从 `../components/ui` 导入，删除冗余原文件）。
  - 扩展 `web/src/shell/TopBar.tsx` 与 `web/src/shell/AppShell.tsx`（严格只用现有 MD3 令牌与 `components/ui` 原语）：
    - 新增可选单向属性：`workspaces?: WorkspaceInfo[]`、`activeWorkspaceId?: string`、`onSelectWorkspace?: (id: string) => void`、`settingsActive?: boolean`、`onOpenSettings?: () => void`。
    - 在 `TopBar` 左侧区域：窄屏菜单按钮之后、视图标题之前渲染紧凑型 MD3 工作区切换器（当 `workspaces` 已就绪时渲染 `<Select aria-label="切换工作区">`，选项文案标注模式前缀或后缀如 `{ws.name}（{ws.mode === "docs" ? "文档" : "记忆"}）`，窄屏下限制最大宽度并折叠次要 `Capsa Studio` 文本避免 375px 横向溢出）。
    - 在 `TopBar` 右侧区域：主题切换按钮旁新增全局工作区设置 `IconButton`（`aria-label="工作区设置"`、`title="工作区设置"`、`selected={settingsActive}`）。
- **Acceptance Criteria**：
  - `web/src/components/ui/` 保持领域中立，零旧 Fluent 类名与零新增脱离主题体系的 CSS 变量。
  - 执行 `cd web && npm run build` 零错误通过。

---

### TASK-007：构建 MD3 全局工作区设置视图，改造 `App.tsx` 与 `MemoryApp` 实现工作区切换与数据收敛

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-006
- **Executor**：主线
- **Description**：新增 `web/src/shell/WorkspaceSettings.tsx` 实现全局工作区增删改管理界面；更新 `web/src/memory/MemoryApp.tsx` 及子视图按当前记忆工作区收敛分类与记忆；升级 `web/src/App.tsx` 协调工作区列表加载、当前工作区状态持久化、全局设置页切换及记忆/文档双子应用分发。
- **Details**：
  - 新增 `web/src/shell/WorkspaceSettings.tsx`（复用 `Card`、`Badge`、`Button`、`Dialog`、`FormField`、`Input`、`Textarea`、`Select`、`ErrorBanner`）：
    - 顶部展示 `<h1>工作区设置</h1>`、返回当前工作区按钮与“新建工作区”主按钮。
    - 卡片列表展示全部工作区：显示名称、模式徽章（`记忆模式` / `文档模式`）、`默认` 徽章（当 `id === "default"`）、描述、容器内分类/公共文档统计数量，以及“切换至此工作区”“编辑”“删除”（默认工作区隐藏或禁用删除并说明默认区常驻）。
    - 新建/编辑弹窗（MD3 `Dialog`）：新建时支持填写“工作区名称”（≤60）、“工作区描述”（≤200）并选定“工作区模式”（记忆模式 / 文档模式）；编辑时锁死模式展示（注明模式创建后不可修改），仅编辑名称与描述。
    - 删除确认弹窗（MD3 `Dialog`）：非空工作区删除失败时以 `role="alert"` 呈现后端阻断原因；删除当前激活工作区成功后自动回退选中 `default` 工作区。
  - 更新 `web/src/memory/`（`MemoryApp.tsx`、`MemoryWorkspace.tsx`、`GroupManager.tsx`、`ReviewCenter.tsx`、`RecycleBin.tsx`）：
    - `MemoryApp` 接收 `workspace: WorkspaceInfo` 及外壳透传的工作区切换/设置回调，当 `workspace.id` 变化时重置当前选中的记忆状态并调用 `api.groups(workspace.id)` 加载该工作区专属分类。
    - `GroupManager` 创建分类时传入 `workspace_id: workspace.id`。
    - `MemoryWorkspace`、`ReviewCenter`、`RecycleBin` 查询 `api.memories` 时统一附带 `workspace_id: workspace.id`，确保切换不同记忆工作区时 5 个传统视图的数据严格收敛于当前记忆工作区，同时对默认记忆工作区保持既有 13 条 E2E 用例的全部按钮名称与表单标签零变更。
  - 更新 `web/src/App.tsx`：
    - 凭据核验通过后加载 `api.workspaces()`，优先恢复 `localStorage.getItem("capsa_workspace_id")` 命中的有效工作区，否则选中 `default`（或列表首项），支持加载失败重试与顶栏登出。
    - 当 `settingsOpen === true` 时使用 `AppShell` 承载 `WorkspaceSettings`；否则按 `activeWorkspace.mode` 分发渲染 `MemoryApp`（`mode === "memory"`）或文档工作区入口组件（`mode === "docs"`，本 Task 先放置带类型签名的轻量连接桩并在 `TASK-008` 替换为完整实现）。
- **Acceptance Criteria**：
  - 登录前不发起 `/api/workspaces` 请求（保持未登录零业务请求约束）。
  - 切换不同记忆工作区时，分类、工作台、复核与回收站数据彼此隔离且互不串扰。
  - 执行 `cd web && npm run build` 零错误通过。

---

### TASK-008：构建 `web/src/docs/` 全套 MD3 文档工作区界面（公共区/分类导航、访问 ID 管理与在线编辑）

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-007
- **Executor**：主线
- **Description**：在 `web/src/docs/` 下新增 `DocsApp.tsx`、`CategoryAccessBar.tsx`、`DocumentPane.tsx` 与 `DocsDialogs.tsx`，交付完整复用 MD3 令牌与基础原语的文档工作区前端界面，并在 `App.tsx` 中完成接入。
- **Details**：
  - 界面整体隐藏传统记忆工作台、时效复核、凭据签发与回收站视图，复用 `AppShell` 外壳：
  - **公共区与分类导航**：
    - 左侧容器导航栏（桌面常驻列 + 窄屏通过 `AppShell` 菜单抽屉或响应式视图切换访问）清晰分为上下两组：
      1. **工作区公共文档**：固定置顶入口（显示公共文档数量徽章，标注跨分类只读共享说明）。
      2. **分类列表**：带“新建分类”按钮，列出当前工作区全部文档分类及各自文档数；支持通过 MD3 `Dialog` 新建分类（名称 ≤60、描述 ≤200）、重命名/编辑分类、以及删除空分类（含文档时在确认弹窗内显示 `role="alert"` 阻断提示）。
  - **分类访问 ID 内联管理（`CategoryAccessBar.tsx`）**：
    - 当激活容器为某个分类时，在分类视图顶部渲染 MD3 `Card`（`variant="filled"`），直接展示当前分类名称、分类描述、“重命名分类”与“删除分类”操作，以及内联展示：
      - **分类访问 ID**（等宽字体 `access_id`）与“复制访问 ID”按钮（带已复制状态反馈）；
      - **MCP 接入地址**（动态拼接 `${window.location.origin}/mcp/docs` 及便捷查询参数地址 `${window.location.origin}/mcp/docs?token=${category.access_id}`）与“复制接入地址”按钮；
      - **重置轮换**按钮：点击弹出 MD3 确认 `Dialog`，说明轮换后旧分类访问 ID 将立即失效，确认后调用 `api.rotateDocCategoryToken` 并即时刷新界面展示的新访问 ID。
  - **类文件浏览与在线编辑（`DocumentPane.tsx` + `DocsDialogs.tsx`）**：
    - 文档列表栏：提供按文档名/路径实时筛选 `Input`（`aria-label="筛选文档"`）、“新建文档”按钮，按字典序展示当前作用域（公共区或当前分类）下的文档列表（显示逻辑路径与更新日期）；移动端窄屏支持“文档列表 ↔ 文档阅读/编辑”单栏无溢出切换与“返回文档列表”按钮。
    - 新建文档弹窗（MD3 `Dialog`）：输入文档路径（使用工作流中立占位符如 `notes.md` 或 `guides/overview.md`，**严禁出现任何特定工作流文件名或模板**）与初始正文，创建成功后自动打开该文档。
    - 文档详情与在线编辑面板：
      - 阅读态：顶部工具栏展示完整文档路径、所属作用域徽章（`公共文档` 或分类名）、字符数与更新时间，提供“编辑”“重命名”“删除”按钮；正文区直接复用 `components/ui` 的安全 `Markdown` 组件渲染（空文档显示空正文提示）。
      - 在线编辑态：切换为等宽长文本 `Textarea`（`aria-label="文档正文"`，支持大篇幅长文本编辑），顶部工具栏切换为“保存”与“取消”按钮；存在未保存修改时切换文档、退出编辑或刷新页面均执行脏状态确认保护。
      - 重命名与删除：分别通过 MD3 `Dialog` 修改文档 `path`（校验重名冲突）或确认物理删除文档。
- **Acceptance Criteria**：
  - 在 `cmd/`、`internal/`、`web/src/` 中执行工作流中立正则检索 `Project\.md|SCOPE\.md|Plan\.md|Tasks\.md|\.example`，匹配数严格为 **0**。
  - 在 `web/src/` 与 `web/tailwind.config.js` 中执行旧令牌正则检索 `acrylic|backdrop-blur|shadow-card|shadow-dialog|ease-fluent|Segoe UI|0078D4|--color-|bg-background|text-foreground|fill-foreground|text-muted|text-subtle|border-stroke|divide-stroke|bg-stroke|(bg|text|border|ring|accent)-brand|(bg|text|border|ring)-danger|\btext-(body|caption)(?![-a-z])`，匹配数严格为 **0**。
  - 执行 `cd web && npm run build` 零错误通过。

---

## Phase 4：全栈单元/集成/E2E 验证与项目文档同步

### TASK-009：编写 Go 单元与集成测试（覆盖存量迁移、工作区隔离、访问 ID 边界与 `/mcp/docs` 7 工具）

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-004, TASK-005
- **Executor**：主线
- **Description**：在 `internal/db/db_test.go`、`internal/dal/dal_test.go` 与 `tests/integration_test.go`（或新增 `tests/docs_workspace_test.go`）中补齐针对存量迁移、多工作区隔离、分类访问 ID 权限边界、`/mcp/docs` 全部 7 个工具及新增 Web REST API 的自动化测试。
- **Details**：
  - 存储与迁移单测（`internal/db/`、`internal/dal/`）：
    - 存量旧库平滑迁移测试：手工建出不含 `workspaces` 表且 `groups` 无 `workspace_id` 列的旧版三表，写入 `proj` 等分组与记忆条目，验证执行 `MigrateIfInitialized` / `InitSchema` 后默认记忆工作区就绪、既有分组挂入 `default`、既有记忆完整可读且未初始化空库 `CheckDBHealth()` 仍为 `false`。
    - 双记忆工作区数据隔离测试：验证两个记忆工作区各自创建的分组与记忆在列表、检索、复核与回收站查询中互不可见；验证默认工作区与非空工作区删除被原子阻断、空非默认工作区可成功删除。
    - 两级文档唯一性与原子替换单测：验证公共区同名冲突拦截、分类区同名冲突拦截、公共区与分类区同名共存、以及 `EditDocumentByPath` 的唯一匹配替换、多重匹配拒绝、`replace_all=true` 全量替换与空串拒绝。
  - HTTP / MCP 全链路集成测试（`tests/docs_workspace_test.go`）：
    - Web REST API：覆盖 `/api/workspaces` 创建（记忆/文档双模式）、名称描述编辑、模式不可修改（422）、非空与默认工作区删除阻断（422）、空工作区删除（200）；覆盖文档工作区分类创建、重命名、非空删除阻断、空分类删除、访问 ID 轮换，以及公共文档与分类文档的创建、读取、重命名、内容覆盖与删除。
    - 分类访问 ID 鉴权边界：验证 `Authorization: Bearer <access_id>` 与 `?token=<access_id>` / `?access_token=<access_id>` 均可接入 `/mcp/docs`；验证传统管理员令牌与分组 Key 访问 `/mcp/docs` 返回 401，分类访问 ID 访问 `/mcp` 或 `/api/*` 返回 401；验证分类 A 的访问 ID 无法读取或修改分类 B 或其他文档工作区的任何文档；验证轮换访问 ID 后旧 ID 立即返回 401、新 ID 立即生效。
    - `/mcp/docs` 全部 **7 个工具**契约验证：
      1. `doc_glob`：逐项验证 `TASK-004` 定义的 5 条匹配样例（空串、`"setup"` 子串、`"*.md"` 无斜杠基名通配、`"guides/*.md"` 单层路径通配不跨子目录、`"[bad"` 非法语法报错）及 `scope` 过滤。
      2. `doc_grep`：关键词与正则表达式跨公共区/当前分类检索行号与行文本，验证单文档限定与非法正则报错。
      3. `doc_read`：验证超过 4,000 字符（如 10,000 字符）长文档全量无截断读取、`offset`/`limit` 行号区间分段带行号读取、以及 `scope="public"` 读取公共文档。
      4. `doc_create`：在当前分类新建文档成功、同名重复创建拒绝报错、尝试写公共区拒绝报错。
      5. `doc_write`：对已存在分类文档全量覆写成功、对不存在文档或公共文档拒绝报错。
      6. `doc_edit`：唯一匹配局部替换成功、多处匹配默认拒绝、`replace_all=true` 全部替换成功、尝试改公共文档拒绝报错。
      7. `doc_delete`：删除当前分类文档成功、尝试删除公共文档或不存在文档拒绝报错。
- **Acceptance Criteria**：
  - 执行 `go test -v ./...` 100% 通过，测试全程使用 `t.TempDir()` 临时库，不产生任何残留文件。
  - 执行 `go vet ./...` 零告警。

---

### TASK-010：构建嵌入静态产物、扩展并跑通 Playwright E2E 测试套件，同步更新 `.docs/Project.md`

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-008, TASK-009
- **Executor**：主线
- **Description**：在 `web/tests/e2e.spec.ts` 中保留既有 13 条用例并新增双模工作区管理与文档工作区全链路浏览器端到端用例，构建前端产物与 Go 静态二进制，跑通全部 Go 与 Playwright 测试，执行源码门禁扫描，并同步更新 `.docs/Project.md`。
- **Details**：
  - 在 `web/tests/e2e.spec.ts` 中保留原有 1~13 号测试不变，新增端到端用例：
    - `14. 全局工作区设置：创建记忆与文档工作区、编辑信息、非空删除阻断、空工作区删除与窄屏/焦点校验`：从顶栏打开“工作区设置”，验证新建弹窗焦点落入弹窗内且支持 `Escape` 关闭；创建一个新记忆工作区与一个新文档工作区，验证切换至新记忆工作区后分类列表为空（与默认记忆工作区的 `proj` 等隔离），编辑工作区名称生效，创建分类后验证删除工作区被阻断，新建空工作区验证成功删除；切换视口至 `375×667` 断言 `document.documentElement.scrollWidth <= document.documentElement.clientWidth` 无横向溢出。
    - `15. 文档工作区全流程：公共文档与分类导航、分类访问 ID 复制与轮换、文档在线编辑与 375px 窄屏无溢出`：切换至文档工作区，验证传统“记忆工作台 / 凭据管理 / 时效复核 / 回收站”导航已隐藏；在“工作区公共文档”新建一篇含安全链接与脚本探针的 Markdown 文档并验证安全渲染与在线编辑保存；新建一个分类，验证分类视图内联展示分类访问 ID 与 `/mcp/docs` 接入地址，执行“重置轮换”（验证确认弹窗焦点与关闭恢复）确认访问 ID 即刻更新且通过真实 `fetch("/mcp/docs", ...)` 握手验证新访问 ID 可用、旧访问 ID 返回 401；在分类下完成文档新建、筛选、在线长文本编辑保存、重命名与删除；切换视口至 `375×667` 校验文档列表与阅读视图切换无横向溢出（`scrollWidth <= clientWidth`），最后切回宽屏删除空分类。
  - 按严格顺序执行构建与全栈验证（遵守 `SCOPE.md` 最小占用原则，不缓存多余产物）：
    1. `cd web && npm run build`（更新 `internal/server/static/`）
    2. `go build -o bin/capsa ./cmd/capsa`（重新内嵌前端产物编译二进制供 `serve.sh` 使用）
    3. `go test ./...`
    4. `cd web && env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY npm run test:e2e`
  - 执行两项源码机械门禁检索：
    1. 旧 Fluent 样式令牌门禁：在 `web/src/` 与 `web/tailwind.config.js` 中检索正则 `acrylic|backdrop-blur|shadow-card|shadow-dialog|ease-fluent|Segoe UI|0078D4|--color-|bg-background|text-foreground|fill-foreground|text-muted|text-subtle|border-stroke|divide-stroke|bg-stroke|(bg|text|border|ring|accent)-brand|(bg|text|border|ring)-danger|\btext-(body|caption)(?![-a-z])`，匹配数严格为 **0**。
    2. 工作流中立门禁：在 `cmd/`、`internal/`、`web/src/` 中检索正则 `Project\.md|SCOPE\.md|Plan\.md|Tasks\.md|\.example`，匹配数严格为 **0**。
  - 同步更新 `.docs/Project.md` 与 `README.md`（保持结构清晰，不打碎片补丁）：
    - `.docs/Project.md`：更新 `## 概述`、`## 结构`（补全 `workspaces` / `doc_categories` / `documents` 表，`internal/dal/docs.go`、`internal/server/mcp_docs.go`、`internal/server/web_docs_api.go`、`/mcp/docs` 路由、`web/src/components/ui/Markdown.tsx`、`web/src/shell/WorkspaceSettings.tsx` 与 `web/src/docs/`）、`## 数据流`（双模平行数据流与分类访问 ID 鉴权链路）、`## 约定`（补充当前工作区偏好 `localStorage` 键 `capsa_workspace_id` 及文档路径校验约定）、`## 约束与决策`（记录双模平行架构、存量无损迁移、部分唯一索引、分类访问 ID 与 `/mcp/docs` 物理隔离决策）及 `## 术语`。
    - `README.md`：在 `## 能力与边界`、`## 架构`（容器内五条路由补充 `/mcp/docs`）、`## 接入 MCP`（补充文档工作区 `/mcp/docs` 与分类访问 ID 接入方式及 7 个 `doc_*` 工具）与 `## Web 管理台`（补充顶栏工作区切换器、全局工作区设置与文档工作区界面）中同步双模现态。
- **Acceptance Criteria**：
  - `cd web && npm run build` 与 `go build -o bin/capsa ./cmd/capsa` 零错误完成。
  - `go test ./...` 全量通过。
  - `npm run test:e2e` 全部 15 条端到端用例（13 条存量 + 2 条新增双模/文档工作区全链路）100% PASSED。
  - 旧样式门禁与工作流中立门禁正则检索结果均为 **0**；`.docs/Project.md` 与实际代码库完全一致。
