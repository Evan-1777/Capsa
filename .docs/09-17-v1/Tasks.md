# Tasks：Web 管理台全权限单管理员面板与分类管理改造

**关联 Plan**：`Plan.md` —— Web 管理台全权限单管理员面板与分类管理改造 v1.1  
**总计 Task**：13 个

---

## Phase 1：权限核心抽象与全协议通配读写支持

### TASK-001：定义统一权限判定函数并在 DAL 实现通配数据访问

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/auth.py` 中定义统一权限计算函数 `permission_for`，并在 `capsa/dal.py` 中接入通配作用域支持，打通全库数据访问。
- **Details**：
  - 在 `capsa/auth.py` 中实现并导出纯函数：
    ```python
    def permission_for(grants: dict[str, str], group: str) -> str | None:
        if grants.get("*") == "rw":
            return "rw"
        return grants.get(group) or (grants.get("*") if grants.get("*") == "r" else None)
    ```
  - 在 `capsa/dal.py` 中重构各查询与判定：
    - `list_groups_with_counts(conn, scopes)`：当 `scopes.get("*") == "rw"` 时，全量查询 `groups` 表并统计活跃条目数，各分组权限统一赋予 `"rw"`。
    - `list_active_memories_for_search(conn, scopes, group=None)`：当具备通配权限时，移除 `group_slug IN (...)` 占位符；未提供 `group` 时检索全库活跃记忆，提供 `group` 时检索指定分组。
    - `get_memories_batch_for_access(conn, ids, scopes)`：对每条记录调用 `permission_for(scopes, row["group_slug"])`，有权限即判定为 `status: "authorized"`。
    - `list_memories_for_web(conn, scopes, status="active", group=None, offset=0, limit=20)`：当具备通配权限时，免除分组占位符过滤，直接按状态及可选 `group` 筛选全库活跃/过期/回收站记忆。
- **Acceptance Criteria**：
  - 传入 `scopes={"*": "rw"}` 时，`list_groups_with_counts` 返回全部现存分组且 permission 均为 `"rw"`。
  - 传入 `scopes={"*": "rw"}` 时，记忆检索与分页列表能跨所有分组读取。
  - 普通分组 Key 的作用域隔离与只读测试断言依然保持通过。

### TASK-002：接入管理级 Token 环境变量与明确生命周期契约

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/auth.py` 与 `capsa/dal.py` 中接入 `CAPSA_ADMIN_TOKEN` 环境变量，确立无状态即时生效的生命周期。
- **Details**：
  - 在 `capsa/auth.py` 的 `CapsaTokenVerifier.verify_token(token)` 中：
    - 读取 `admin_token = os.environ.get("CAPSA_ADMIN_TOKEN", "").strip()`。
    - 仅当 `admin_token` 非空且与传入的 `token` 完全匹配时，直接返回固定管理员凭据：
      `AccessToken(token=token, client_id="admin", scopes=["capsa"], claims={"key_id": "admin", "name": "Admin", "grants": {"*": "rw"}})`。
    - 未配置环境变量或环境变量仅含空白符时静默跳过此路径，走既有数据库哈希校验。
  - 在 `capsa/dal.py` 的 `get_key(conn, key_id)` 中：
    - 当 `key_id == "admin"` 且 `os.environ.get("CAPSA_ADMIN_TOKEN", "").strip()` 存在时，返回虚拟凭据字典 `{"id": "admin", "name": "Admin", "scopes": {"*": "rw"}}`。
  - 数据库中通过 CLI（`capsa key create admin --scopes "*:rw"`）创建的通配 Key 正常走数据库哈希校验并返回相同的 `{"*": "rw"}` 授权。
- **Acceptance Criteria**：
  - `CAPSA_ADMIN_TOKEN` 未设置或为空字符串时，不会绕过数据库认证。
  - `CAPSA_ADMIN_TOKEN` 设为有效密钥时，携带该令牌可成功通过校验且获得完全管理员声明。

### TASK-003：在 MCP 工具层全面应用 permission_for 支持通配写操作

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/mcp_service.py` 中将硬编码的分组写权限校验全部替换为 `permission_for`，使 MCP 读写工具全面支持管理员凭据。
- **Details**：
  - 在 `capsa/mcp_service.py` 中导入 `from capsa.auth import permission_for`。
  - 在 `_locate_writable(conn, memory_id)` 中：
    - 将 `if _grants().get(item["group_slug"]) != "rw":`
    - 替换为 `if permission_for(_grants(), item["group_slug"]) != "rw":`。
  - 在 `memory_save` 工具函数中：
    - 将 `if grants.get(group) != "rw":`
    - 替换为 `if permission_for(grants, group) != "rw":`。
  - 在 `memory_update` 与 `memory_forget` 工具函数中同样确保通过重构后的 `_locate_writable` 进行授权核验。
- **Acceptance Criteria**：
  - 携带 `*:rw` 凭据的 MCP 会话调用 `memory_save` 在任意现有分组下均可成功写入，不再抛出“没有写权限”异常。
  - 携带 `*:rw` 凭据的 MCP 会话可正常调用 `memory_update` 与 `memory_forget`。

---

## Phase 2：后端分类生命周期 API 与外键安全防护

### TASK-004：改造分类存储层以消除竞态并新增更新函数

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/dal.py` 中重构 `add_group` 返回插入结果，并新增 `update_group` 函数保证外键安全。
- **Details**：
  - 重构 `add_group(conn: sqlite3.Connection, slug: str, name: str, description: str) -> bool`：
    - 执行 `cursor = conn.execute("INSERT OR IGNORE INTO groups (slug, name, description, created_at) VALUES (?, ?, ?, ?)", ...)`。
    - 调用 `conn.commit()` 并返回 `cursor.rowcount > 0`，通过影响行数原子化表达是否成功插入新记录，彻底杜绝并发冲突下的 TOCTOU 静默误判。
  - 新增 `update_group(conn: sqlite3.Connection, slug: str, name: str, description: str) -> bool`：
    - 执行参数化 SQL：`UPDATE groups SET name = ?, description = ? WHERE slug = ?` 并提交。
    - 严格保持 `slug` 字段不可更改，从源头维护 SQLite `memories(group_slug) REFERENCES groups(slug)` 的外键完整性。
    - 若更新行数大于 0 返回 True，否则返回 False。
- **Acceptance Criteria**：
  - 并发或重复调用 `add_group` 时，第二次调用返回 False。
  - `update_group` 成功修改已有分组名称与描述，不存在的 slug 返回 False。

### TASK-005：新增分类生命周期端点 POST /api/groups 与 PUT /api/groups/{slug}

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/web_api.py` 中实现分类的创建与更新端点，校验字段格式、唯一性约束并装配路由。
- **Details**：
  - 创建端点 `POST /api/groups`：
    - 参数校验：请求体须为合法 JSON；`slug` 校验正则 `^[a-zA-Z0-9_-]{1,32}$`；`name` 通过 `require_text` 校验非空且 <= 60 字符；`description` 校验长度 <= 200 字符。
    - 原子写入：调用 `dal.add_group(conn, slug, name, description)`。若返回 False，抛出 `ToolError(f"分组 {slug} 已存在")`（被全局映射为 422 `VALIDATION_ERROR`）。
    - 响应返回：通过 `_ok` 返回新建分类对象 `{"slug": slug, "name": name, "description": description, "count": 0, "permission": "rw"}`。
  - 更新端点 `PUT /api/groups/{slug}`：
    - 存在性校验：调用 `dal.get_group(conn, slug)`，若不存在返回 404 `NOT_FOUND`（文案 `f"分组 {slug} 不存在"`）。
    - 字段合并与校验：若未提供 `name` 与 `description` 中任何一项，抛出 `ToolError("至少提供一个待更新字段")`；若提供了对应字段则分别校验长度。
    - 执行更新：调用 `dal.update_group` 并查询最新条目计数后返回 200 统一信封。
  - 路由注册：在 `routes` 中追加 `Route("/groups", endpoint=group_create, methods=["POST"])` 和 `Route("/groups/{slug}", endpoint=group_update, methods=["PUT"])`。
- **Acceptance Criteria**：
  - 成功创建新分类返回 200 与统一成功信封。
  - 传入重复 slug、非法 slug 字符时均返回 422 错误信封。
  - 成功更新已有分类名称与描述，更新不存在的 slug 返回 404。

---

## Phase 3：Web API 单管理员网关守卫与前端接口契约

### TASK-006：在 BearerAuthGuard 确立后端单管理员强拦截防线

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/web_api.py` 中重构 `BearerAuthGuard`，统一在网关入口处强制核验管理员权限（方案 A），拒绝所有非管理员凭据。
- **Details**：
  - 在 `capsa/web_api.py` 的 `BearerAuthGuard.__call__` 中：
    - 现有逻辑完成 Bearer 令牌解析后，从 `scope["user"].access_token.claims.get("grants", {})` 提取 grants。
    - 增加校验：`if grants.get("*") != "rw":`
    - 校验未通过时，立即返回统一失败信封：`_fail(FORBIDDEN, "Web 管理台仅支持管理员凭据访问", 403)`。
  - 在 `capsa/web_api.py` 业务处理器中：
    - 引入 `from capsa.auth import permission_for`。
    - 在 `memory_create`、`_locate_writable`、`memory_restore` 中统一使用 `permission_for` 判定读写权限，使通配管理员在各处理器中拥有全通权限。
    - 在 `_list_item` 与 `_detail_item` 中条目的 `permission` 统一由 `permission_for(grants, item["group_slug"])` 计算并输出 `"rw"`。
- **Acceptance Criteria**：
  - 持有普通分组 Key（如 `proj:rw`）的直接 HTTP 请求被网关统一拦截并返回 403 `FORBIDDEN`，无法访问任何 `/api` 端点。
  - 持有 `*:rw` 或匹配 `CAPSA_ADMIN_TOKEN` 的请求通过网关，并享有全端点管理权限。

### TASK-007：在前端 API 层与类型定义中扩充分类生命周期方法

- **Status**：DONE（2026-09-17）
- **Description**：在 `web/src/types.ts` 与 `web/src/api.ts` 中新增分类相关的参数类型与请求方法。
- **Details**：
  - 在 `web/src/types.ts` 中定义 `GroupInput` 接口：
    ```ts
    export interface GroupInput {
      slug?: string;
      name: string;
      description?: string;
    }
    ```
  - 在 `web/src/api.ts` 中扩展 `api` 对象：
    - `createGroup: (payload: { slug: string; name: string; description?: string }) => request<GroupInfo>("/api/groups", { method: "POST", body: JSON.stringify(payload) })`
    - `updateGroup: (slug: string, payload: { name?: string; description?: string }) => request<GroupInfo>(`/api/groups/${slug}`, { method: "PUT", body: JSON.stringify(payload) })`
- **Acceptance Criteria**：
  - 运行 `cd web && npx tsc --noEmit`，TypeScript 编译通过且无类型报错。

---

## Phase 4：前端分类管理界面与工作台实时联动

### TASK-008：创建轻量前端分类管理界面 GroupManager.tsx

- **Status**：DONE（2026-09-17）
- **Description**：新建 `web/src/components/GroupManager.tsx`，提供符合 Tailwind + Zinc 风格的分类浏览、快速新建与就地编辑界面。
- **Details**：
  - 组件结构：
    - 头部展示“分类管理”标题、外键安全简短说明（“标识 slug 创建后不可变更以保证外键安全”），以及“新建分类”按钮。
    - 分类列表：网格卡片或条目列表，展示分类名称、等宽字体的 slug 标识、描述信息、该分组下活跃记忆数量徽标，以及“编辑”操作按钮。
  - 新建分类弹层：
    - 输入项：分类标识（slug）、分类名称、分类描述。
    - 标识符格式提示：英文字母、数字与连字符，且明确标注不可更改。
    - 交互：前端非空与格式预校验，提交期间呈现加载状态，错误时浮现服务端错误信息。
  - 编辑分类弹层：
    - 输入项：分类标识（slug）以禁用只读框呈现并提示“标识不可修改”；分类名称与描述可编辑。
  - 变更通知：新建或编辑成功后调用父级传入的 `onGroupsChange: () => Promise<void>` 刷新数据。
- **Acceptance Criteria**：
  - 界面呈现美观规范，交互完整，支持创建新分类及更新已有分类。

### TASK-009：在 App.tsx 与记忆工作台中建立分类实时联动机制

- **Status**：DONE（2026-09-17）
- **Description**：在 `web/src/App.tsx` 中新增“分类管理”导航项，并与工作台筛选胶囊及抽屉下拉建立即时响应联动。
- **Details**：
  - 在 `web/src/App.tsx` 中：
    - `VIEWS` 扩展为 4 项：`记忆工作台`、`分类管理`、`时效复核`、`回收站`。
    - 封装 `refreshGroups` 函数集中拉取 `api.groups()` 并更新 `groups` 根状态。
    - 当 `view === "groups"` 时渲染 `<GroupManager groups={groups} onGroupsChange={refreshGroups} />`。
  - 在 `web/src/components/MemoryList.tsx` 中：
    - 在分组筛选胶囊区域增加轻量操作入口（如带有加号的小按钮），点击可快速切换至分类管理或唤起新建。
    - 确保工作台 GroupPill 列表与 EditDrawer 抽屉的分组下拉选项实时根据 `groups` 属性派发更新，无需刷新网页。
- **Acceptance Criteria**：
  - 用户可在导航栏自由切换分类管理视图。
  - 新增或编辑分类后切换回工作台，分类筛选胶囊与新建抽屉中的选项即时体现最新状态。

### TASK-010：收敛前端界面为全权限单管理员呈现

- **Status**：DONE（2026-09-17）
- **Description**：改造 `web/src/components/Header.tsx` 与 `Login.tsx`，明确单管理员身份，移除多余只读标识。
- **Details**：
  - 在 `web/src/components/Header.tsx` 中：右侧不再打印冗长的作用域映射，而是显式呈现“管理员”身份徽标。
  - 在 `web/src/components/Login.tsx` 中：
    - 说明文案更新为“输入管理员 API Key 以继续”。
    - 登录后校验凭据是否包含 `me.scopes["*"] === "rw"`。若为非管理员凭据，清除本地凭据并显示错误：“管理台仅支持管理员凭据登录（需 *:rw 权限）”。
  - 在各视图组件中：
    - 移除所有记忆条目与分类胶囊上无意义的“只读”灰色标签。
    - 确认工作台新建、编辑、删除、延期复核、软删除与回收站恢复按钮在全权限模式下常态可用。
- **Acceptance Criteria**：
  - 管理员登录后界面清晰呈现管理员身份，无任何功能被误置为只读。
  - 普通非管理员凭据在登录界面被拦截并给出针对性提示。

---

## Phase 5：单元测试、端到端测试与文档维护

### TASK-011：补充 Python 全链路关键测试与边界测试

- **Status**：DONE（2026-09-17）
- **Description**：在 `tests/test_web_api.py`、`tests/test_write.py` 等文件中编写覆盖 MCP 通配写、Web API 网关拦截、并发唯一性及环境变量生命周期的全套测试。
- **Details**：
  - 在 `tests/conftest.py` 中：为 `seeded` 夹具增加 `seeded["admin"]`（持有 `{"*": "rw"}` 的通配管理员 Key），并将既有 Web API 测试请求切换至该管理员 Key（以适配方案 A 的网关拦截）。
  - 在 `tests/test_web_api.py` 中编写：
    - `test_non_admin_token_rejected_at_web_api_guard`：使用普通分组 Key（如 `seeded["proj"]["token"]`）直接请求 `/api/auth/me`、`/api/memories`，断言直接返回 403 `FORBIDDEN`（文案为 `"Web 管理台仅支持管理员凭据访问"`），覆盖绕过前端的直接攻击场景。
    - `test_create_group_atomic_and_reflected_in_list`：验证管理员通过 `POST /api/groups` 创建分类及在列表中读取。
    - `test_create_group_rejects_duplicate_or_invalid_slug`：验证并发/重复 slug 与非法 slug 格式返回 422。
    - `test_update_group_name_and_description`：验证通过 `PUT /api/groups/{slug}` 更新成功及 404 不存在场景。
    - `test_foreign_key_safety_when_group_updated`：验证更新分组后已有记忆关联不受影响。
    - `test_admin_token_lifecycle_and_blank_handling`：验证 `CAPSA_ADMIN_TOKEN` 为有效值时放行、为空字符串或空格时安全降级、修改后生效。
  - 在 `tests/test_write.py` 中补充 MCP 通配写测试：
    - `test_mcp_memory_save_with_wildcard_admin_key`：验证持有 `*:rw` 的 Key 通过 MCP 会话在任意分组下写入成功。
    - `test_mcp_memory_update_and_forget_with_wildcard_admin_key`：验证通配 Key 更新与删除记忆成功。
- **Acceptance Criteria**：
  - 运行 `.venv/bin/python -m pytest -v`，包含新增测试在内的全量测试用例 100% 通过。

### TASK-012：更新 Playwright E2E 回归测试套件

- **Status**：DONE（2026-09-17）
- **Description**：在 `web/tests/serve.sh` 中生成通配管理员 Key，并在 `web/tests/e2e.spec.ts` 中覆盖管理员与分类管理完整链路。
- **Details**：
  - 在 `web/tests/serve.sh` 中：使用 `--scopes "*:rw"` 生成管理员 Key，写入 `web/tests/keys.json` 的 `admin` 字段。
  - 在 `web/tests/e2e.spec.ts` 中：
    - 新增“非管理员凭据登录拦截”用例：使用受限 Key 尝试登录，断言停留在登录页并显示拦截提示。
    - 新增“分类管理与工作台实时联动”用例：管理员登录，进入“分类管理”视图，创建新分类并就地编辑；切回“记忆工作台”，验证工作台筛选胶囊与“新建记忆”抽屉分组下拉列表已实时出现该分类；创建一条该分类下的记忆并成功查阅。
    - 现有 Markdown 净化、长度超限与全流程用例以管理员 Key 运行并确保通过。
- **Acceptance Criteria**：
  - 运行 `cd web && npm run test:e2e`，所有浏览器端到端测试用例绿灯通过。

### TASK-013：同步维护 .docs/Project.md 与 README.md 事实来源

- **Status**：DONE（2026-09-17）
- **Description**：对照代码库最终实现，同步更新 `.docs/Project.md` 与根目录 `README.md`，彻底消除陈旧契约描述。
- **Details**：
  - 更新 `.docs/Project.md`：
    - §1 概述：更新 Web 管理台定位为“全权限单管理员面板（无独立用户系统）”，分类管理已进入 Web 端。
    - §3 目录结构：添加 `GroupManager.tsx` 及新路由说明。
    - §4 架构与数据流：更新 Web 数据流为管理员专属网关校验、分类 CRUD 接口契约与外键不可变安全设计。
    - §5 关键约定与 §8 决策记录：记录单管理员模式（方案 A）、统一 `permission_for` 契约、原子 `add_group` 以及 `CAPSA_ADMIN_TOKEN` 规范。
  - 更新 `README.md`：
    - 修正第 12-13 行关于“分组维护保留在 CLI”的陈旧描述，更新为支持 Web 端分类管理。
    - 修正第 156 行关于“Web 与 MCP 权限完全对称”的旧说明，清晰阐述 Web 端为单管理员全权限面板、MCP 端支持分组隔离与通配凭据。
    - 更新 Web 视图介绍（由三视图升级为包含分类管理的四视图）。
- **Acceptance Criteria**：
  - `.docs/Project.md` 与 `README.md` 不存在相互矛盾的陈述，均准确反映最新架构与功能。
