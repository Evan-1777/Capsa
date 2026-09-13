# Tasks：Capsa Phase 1 —— 数据基座、三态授权防线与三级只读协议

**状态**：DONE
**完成日期**：2026-09-13
**关联 Plan**：`Plan.md` —— Capsa Phase 1 v1.0
**总计 Task**：21 个（TASK-000 ~ TASK-020，全部 DONE）
**回归测试结论**：`.venv/bin/python -m pytest -v` 退出码 0，64 passed、0 skipped、0 failed。另有真实 uvicorn 进程上的端到端复验：`/healthz` 200、无认证 `/mcp` 401、1.1MB 请求体 413、4 个只读工具列出、L1→L2→L3 链路贯通、`memory_read` 传 6 个 id 报中文 ToolError、撤销 Key 后 401、重启后分组 4 行与 Key 1 行不变。

> **执行前置**：本机 Python 环境与规划文档假设存在偏差，动手前先读 Plan.md §2。所有命令基于仓库根目录，虚拟环境解释器为 `.venv/bin/python`。

---

## Phase 1.1：工程骨架与依赖锁定

### TASK-000：创建基线 .docs/Project.md

- **Status**：DONE
- **Priority**：P0
- **Depends on**：无
- **Description**：按 `.docs/Project.example.md` 模板创建基线 `.docs/Project.md`，供后续所有阶段读取。AGENTS.md 要求进入阶段前先读 SCOPE 与 Project，交付段不得在缺失基线的状态下开工。
- **Details**：
  - 本任务只落定代码库尚不存在时也成立的内容：概述、环境与运行、约束与已知坑、决策记录
  - 环境一节写明本机需用 uv 落位的 CPython 3.12 解释器（`.venv/bin/python`）
  - 约束一节写明两类已实测的坑：FastMCP 4 挂载必须传 `path="/"` 并把 lifespan 交给根应用；内存传输取不到鉴权上下文，端到端测试须走 HTTP
  - 决策记录写明 starlette 与 pydantic 的版本下限由 FastMCP 4 决定
  - 目录结构一节此时按 Plan 预期填写，由 TASK-020 在代码落地后校正
  - 模板中无内容的可选章节整节删除，不保留空节与占位注释
- **Acceptance Criteria**：
  - `.docs/Project.md` 存在且不含 `<!-- 待填 -->` 残留
  - 文件中记录的两条 FastMCP 约束与 Plan.md §2.2 一致
  - 环境一节给出的解释器路径在实际执行后存在

### TASK-001：添加版本控制排除规则

- **Status**：DONE
- **Priority**：P0
- **Depends on**：无
- **Description**：在仓库根目录新增 `.gitignore`，排除本机开发工具链与运行期产物。
- **Details**：
  - 排除 `.venv/`、`.devtools/`（合计约 270 MB 本机工具链，不得入库）
  - 排除 `__pycache__/`、`*.py[cod]`、`.pytest_cache/`
  - 排除数据库运行产物 `*.db`、`*.db-wal`、`*.db-shm`
  - 排除 `.env`
- **Acceptance Criteria**：
  - `git status --porcelain` 输出中不出现 `.venv/` 与 `.devtools/`
  - `git check-ignore -v .venv/pyvenv.cfg` 返回命中行

### TASK-002：创建 pyproject.toml 与包骨架

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-001
- **Description**：新增 `pyproject.toml` 与 `capsa/__init__.py`，锁定依赖版本并提供 `capsa` 命令入口。
- **Details**：
  - `requires-python = ">=3.12"`
  - `dependencies`：`fastmcp==4.0.0`、`starlette==1.6.0`、`uvicorn[standard]==0.52.4`、`pydantic==2.13.5`
  - `[project.optional-dependencies] test`：`pytest==9.1.1`、`httpx2==2.12.0`
  - `[project.scripts] capsa = "capsa.cli:main"`
  - 构建后端用 hatchling，`[tool.hatch.build.targets.wheel] packages = ["capsa"]`
  - 在依赖列表上方加注释，说明 `starlette` 与 `pydantic` 的版本由 FastMCP 4 的下限决定（`starlette>=1.0.1`、`pydantic>=2.12.0`），不可向下钉死；本组版本与 `Capsa_落地交付分期规划.md` §2.2 一致
  - 测试依赖声明 `httpx2` 而非 `httpx`：starlette 1.6 的 `TestClient` 优先导入 `httpx2`，仅在缺失时回退 `httpx` 并告警（`starlette/testclient.py:34-51`）；FastMCP 4 已传递引入 `httpx2`，回退路径不会被触发，声明 `httpx` 属于未被使用的依赖
- **Acceptance Criteria**：
  - `pyproject.toml` 可被 `tomllib` 解析
  - 声明的四个运行依赖版本与 Plan.md §4 决策表逐条一致

### TASK-003：安装依赖并验证包可导入

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-002
- **Description**：以可编辑模式安装项目及其测试依赖，确认导入与命令入口可用。
- **Details**：
  - 执行 `.venv/bin/python -m pip install -e ".[test]"`
  - 目录布局：源码置于 `capsa/`，测试置于 `tests/`
- **Acceptance Criteria**：
  - 安装命令退出码为 0
  - `.venv/bin/python -c "import capsa, fastmcp, starlette, pydantic"` 无异常
  - `.venv/bin/python -c "from importlib.metadata import version; print(version('capsa'))"` 输出 `0.1.0`

---

## Phase 1.2：存储基座与三态授权数据层

### TASK-004：实现数据库路径解析、建表与健康检查

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-003
- **Description**：新增 `capsa/db.py`，提供连接辅助、幂等建表与健康检查。
- **Details**：
  - `db_path()` 每次调用读取环境变量 `CAPSA_DB_PATH`，缺省 `/data/capsa.db`；解析推迟到调用期，不在导入期求值
  - `connect()` 返回 `sqlite3.Connection`，`row_factory = sqlite3.Row`；连接建立后执行 `PRAGMA journal_mode = WAL` 与 `PRAGMA foreign_keys = ON`；库文件父目录不存在时先创建
  - `init_schema(conn)` 执行三张表的 `CREATE TABLE IF NOT EXISTS` 与一条 `CREATE INDEX IF NOT EXISTS`：
    - `groups(slug PK, name, description, created_at)`
    - `keys(id PK, name, token_hash UNIQUE, scopes, created_at, last_used_at, revoked_at)`
    - `memories(id PK, group_slug REFERENCES groups(slug), title, summary, body, tags DEFAULT '[]', review_at, pinned DEFAULT 0, created_at, updated_at, deleted_at, deleted_reason)`
    - `idx_memories_group_order ON memories(group_slug, pinned DESC, updated_at DESC)`
  - 为 `title` / `summary` / `body` 加 `CHECK(length(...) <= 60/200/64000)` 约束
  - `check_db_health()` 执行一次轻量查询，返回布尔值，不抛异常
- **Acceptance Criteria**：
  - 连续调用 `init_schema` 两次不报错，第二次仍返回成功
  - `PRAGMA journal_mode` 返回 `wal`；插入 `group_slug` 不存在的记忆触发 `sqlite3.IntegrityError`
  - `deleted_reason` 列存在于 `memories` 表
  - `db_path()` 在设置 `CAPSA_DB_PATH` 后返回新值

### TASK-005：实现记忆条目的三态批量查询

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-004
- **Description**：新增 `capsa/dal.py`，实现越权防线的唯一入口函数。
- **Details**：
  - 签名：`get_memories_batch_for_access(conn, ids: list[str], scopes: dict[str, str]) -> list[dict]`
  - SQL 使用参数化占位符：`SELECT id, group_slug, title, summary, body, tags, review_at, pinned, created_at, updated_at FROM memories WHERE id IN (?, ...) AND deleted_at IS NULL`；`ids` 为空时直接返回空列表，不拼 `IN ()`
  - 返回列表顺序与传入 `ids` 一致
  - 逐条判定：记录缺失或已软删除 → `{"status": "not_found", "id": id}`；`row["group_slug"] in scopes` → `{"status": "authorized", ...全部字段}`；否则 → `{"status": "forbidden", "id": id}`
  - `forbidden` 分支只允许写入 `status` 与 `id` 两个键，不得携带 `group_slug`、`title`、`summary`、`body`、`tags`
- **Acceptance Criteria**：
  - 越权条目返回字典的键集合恰为 `{"status", "id"}`
  - 越权条目序列化为 JSON 后，不含该条所属分组 slug 字符串，也不含其标题与摘要
  - 已软删除条目判定为 `not_found`；传入 `[]` 返回 `[]` 且不抛异常

### TASK-006：实现授权范围内的有效条目检索列表

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-004
- **Description**：在 `capsa/dal.py` 增加专供检索引擎使用的列表查询。
- **Details**：
  - 签名：`list_active_memories_for_search(conn, scopes: dict[str, str], group: str | None = None) -> list[dict]`
  - SQL：`WHERE group_slug IN (?, ...) AND deleted_at IS NULL`，`group` 非空时追加 `AND group_slug = ?`
  - `scopes` 为空时直接返回空列表，不拼 `IN ()`
  - 返回字段：`id`、`group_slug`、`title`、`summary`、`tags`、`review_at`、`pinned`、`updated_at`；不返回 `body`
  - 查询条件全部经参数化占位符传入，禁止字符串拼接
- **Acceptance Criteria**：
  - 只返回 `scopes` 覆盖的分组内的条目，其他分组条目不可见
  - 已软删除条目不出现
  - 返回的字段集合恰为上述八项，不含 `body`
  - `scopes` 为空字典时返回 `[]`

### TASK-007：实现分组数据访问入口

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-004
- **Description**：在 `capsa/dal.py` 增加分组的写入与读取入口。
- **Details**：
  - **事务边界统一约定**：`dal.py` 中所有写函数（`add_group`、`create_key`、`revoke_key`、`touch_last_used_at`）在自身返回前调用 `conn.commit()`；调用方不承担提交责任。Python `sqlite3` 默认隐式开启事务，不提交则连接关闭时回滚，实测未提交的 INSERT 在重连后查询为 0 行
  - `add_group(conn, slug, name, description) -> None`：`INSERT OR IGNORE`，重复调用不报错也不覆盖既有描述
  - `get_group(conn, slug) -> dict | None`
  - `list_groups(conn) -> list[dict]`：返回全部 `slug`、`name`、`description`
  - `list_groups_with_counts(conn, scopes: dict[str, str]) -> list[dict]`：只返回 `scopes` 覆盖的分组，每条含 `slug`、`name`、`description`、`permission`（取自 `scopes` 的值）、`count`（该分组下 `deleted_at IS NULL` 的条目数）；条目数统计用聚合子查询完成，不在 Python 侧循环计数
- **Acceptance Criteria**：
  - `add_group` 重复调用后分组描述保持首次写入值
  - 写入后关闭连接并重新打开，数据仍存在（验证提交边界）
  - `list_groups_with_counts` 的结果不含未授权分组
  - `count` 不计入已软删除条目
  - `permission` 取值与 `scopes` 中该分组的取值一致

---

## Phase 1.3：鉴权防线与请求体防护

### TASK-008：实现 Key 数据访问入口

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-007
- **Description**：在 `capsa/dal.py` 增加 Key 的写入、撤销与查验入口。
- **Details**：
  - `create_key(conn, key_id, name, token_hash, scopes: dict[str, str]) -> None`：`scopes` 以 JSON 字符串落库
  - `find_active_key_by_hash(conn, token_hash) -> dict | None`：`WHERE token_hash = ? AND revoked_at IS NULL`，返回 `id`、`name`、`scopes`
  - `revoke_key(conn, key_id) -> bool`：置 `revoked_at` 为当前 UTC 时间；返回是否命中一行
  - `list_keys(conn) -> list[dict]`：返回 `id`、`name`、`scopes`、`created_at`、`last_used_at`、`revoked_at`
  - `touch_last_used_at(conn, key_id) -> None`
- **Acceptance Criteria**：
  - 撤销后的 Key 经 `find_active_key_by_hash` 查询返回 `None`
  - `revoke_key` 对不存在的 id 返回 `False`
  - `scopes` 落库后再读出可还原为等价字典
  - 写入与撤销后关闭连接并重新打开，状态保持（验证提交边界）

### TASK-009：实现标识符生成与令牌校验器

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-008
- **Description**：新增 `capsa/ids.py` 与 `capsa/auth.py`，实现 ID 生成、令牌哈希与 FastMCP 令牌校验器。
- **Details**：
  - `capsa/ids.py`：
    - `new_key_id() -> str`：8 位小写字母与数字随机串
    - `new_secret() -> str`：32 位字符随机串
    - `new_memory_id() -> str`：`mem_` 前缀加 6 位小写字母与数字随机串，总长度 10
    - `hash_token(plain: str) -> str`：SHA256 十六进制摘要，不加盐
    - 随机源统一用 `secrets` 模块
  - `capsa/auth.py`：
    - `issue_key() -> tuple[str, str]`：纯生成函数，不接触数据库；返回 `(key_id, 明文令牌)`，明文格式 `capsa_{key_id}_{secret}`。落库由 CLI 负责：先经 `dal.create_key` 写入 `token_hash` 与 `scopes` 并提交，成功后才打印明文令牌
    - `CapsaTokenVerifier(TokenVerifier)`：`verify_token` 内先算哈希查库，未命中或已撤销返回 `None`；命中则异步刷新 `last_used_at`，并返回 `AccessToken(token=token, client_id=key_id, scopes=["capsa"], claims={"key_id": ..., "grants": {...}})`
    - `AccessToken` 的 `token` 字段是必填的（`mcp.server.auth.provider.AccessToken`），省略会触发 pydantic 校验错误，鉴权主链路直接失败
- **Acceptance Criteria**：
  - 生成的明文令牌总长度恰为 47，且匹配 `^capsa_[a-z0-9]{8}_[A-Za-z0-9_-]{32}$`
  - `new_memory_id()` 长度恒为 10 且以 `mem_` 开头
  - 同一明文两次 `hash_token` 结果一致
  - 令牌未入库时 `verify_token` 返回 `None`；Key 撤销后返回 `None`

### TASK-010：实现请求体大小拦截中间件

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-003
- **Description**：在 ASGI 层拦截超限请求体。原计划自建 `capsa/middleware.py`，执行期改用 starlette 1.6 内置的 `RequestBodyLimitMiddleware`（已是既有依赖）：自建版本在分块分支抛出的异常会逃出 FastMCP 子应用，被上层渲染成 500，与验收标准冲突。
- **Details**：
  - `from starlette.middleware.body_limit import RequestBodyLimitMiddleware`，在 `server.py` 以 `app.add_middleware(RequestBodyLimitMiddleware, max_body_size=MAX_REQUEST_BYTES)` 挂载
  - 声明式（`content-length`）与分块式（累计实际字节）两条路径都由内置中间件覆盖
  - 413 响应体为纯文本 `Content Too Large`，与其余 HTTP 层错误一致
  - 边界取严格大于：恰好等于上限的请求体放行，继续进入鉴权层
- **Acceptance Criteria**：
  - 带 `content-length` 的 1100000 字节请求返回 413
  - 无 `content-length` 的分块传输累计超限返回 413；该用例经真实 app 发送（携带有效会话，否则请求体不会被读取）
  - 恰好 1048576 字节的请求**不被拦截**（断言未返回 413）；该请求带的是非法令牌，因此最终响应为 401 而非 200，只断言“未被 413 拦截”
  - 上限内的正常请求不受影响

---

## Phase 1.4：检索引擎与三级披露格式

### TASK-011：实现归一化、二字组分词与打分函数

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-004
- **Description**：新增 `capsa/retrieval.py`，实现确定性打分所需的纯函数。
- **Details**：
  - `normalize(text) -> str`：Unicode NFC 转换后转小写
  - `tokenize(query) -> set[str]`：按非字母数字字符切分；含中文的词元拆成连续二字组（长度不足 2 的中文词元按原样保留）；非中文词元保留整体；结果去重
  - `is_expired(review_at, now) -> bool`：`review_at` 为空返回 `False`，否则按 UTC 与当前时间比较
  - `score(memory, terms) -> int`：`4 × 标题命中数 + 1 × 摘要命中数 + 2 × 标签命中数 + (置顶 ? 3 : 0) − (复核已过期 ? 2 : 0)`；标签按数组元素逐个匹配，不按 JSON 原文匹配；命中判定为大小写无关的子串包含
- **Acceptance Criteria**：
  - `tokenize("记忆分组授权")` 结果为 `{"记忆", "忆分", "分组", "组授", "授权"}`
  - `tokenize("!!!  ")` 与 `tokenize("")` 均返回空集合
  - 同一词元重复出现只计一次分
  - 置顶条目比同等内容非置顶条目恰高 3 分；`review_at` 已过期的条目恰低 2 分

### TASK-012：实现稳定排序与浏览模式

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-006、TASK-011
- **Description**：在 `capsa/retrieval.py` 增加排序入口。
- **Details**：
  - `rank_memories(memories, query, now) -> list[dict]`
  - 查询串为空、全空白或全标点时跳过打分，直接按置顶降序、更新时间降序排列
  - 有关键词时排序键为分值降序、置顶降序、更新时间降序、id 降序；末位 id 保证 `updated_at` 相同时顺序稳定
  - 排序键中的 `updated_at` 是 ISO 8601 UTC 字符串，**必须先解析为 epoch 秒再取负**；直接对字符串取负抛 `TypeError`，按字符串比较则无法正确处理带偏移的时间
  - 实现方式为两趟稳定排序：先按 id 降序排一次，再按 `(-score, -pinned, -updated_at_epoch)` 排一次
  - `fromisoformat` 解析后统一 `.astimezone(timezone.utc).timestamp()`；同一时刻的不同偏移写法（`+00:00` 与 `+08:00`）必须得到相同 epoch
  - 不修改传入列表
- **Acceptance Criteria**：
  - 空查询下置顶条目排在最前，其余按更新时间倒序
  - 两个 `updated_at` 完全相同的条目，id 较大者稳定排在前面
  - 表示同一时刻的 `+00:00` 与 `+08:00` 两种写法排序结果一致
  - 相同输入重复调用返回完全相同的顺序
  - 传入列表在调用后保持原顺序

### TASK-013：实现三级披露与分组列表的纯文本格式

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-012
- **Description**：新增 `capsa/formatters.py`，实现四种固定输出格式与体积截断契约。
- **Details**：
  - `format_groups(groups) -> str`：逐行输出分组 slug、名称、权限、条目数与描述
  - `format_search(query, ranked, scopes) -> str`（L1）：
    - 首行 `# 记忆检索: "{query}" | 命中 N 条 | 范围: proj,study`
    - 每条第一行 `[{i}] {id} | {group} | {updated_at 日期} | 标签: a,b`，无标签输出 `标签: -`
    - 每条第二行以四个空格缩进输出标题；复核已过期的条目在标题末尾追加 `（复核已过期）`
    - 末尾输出 `> 下一步: memory_peek(ids=[...])`，列出本次结果中的授权条目 id
  - `format_peek(items) -> str`（L2）：`[{i}] {id} | {group} | 更新 {日期}`，随后缩进输出 `标题:` 与 `摘要:`；末尾输出 `> 下一步: memory_read(ids=[...])`
  - `format_read(items, offset) -> str`（L3）：`===== {id} | {group} | 更新 {日期} =====`，随后输出标题与正文；无 `> 下一步:` 行
  - 越权条目在 L1、L2、L3 中一律只输出 `[{i}] {id} | [无权访问]`，不输出分组名、标题、摘要与正文
  - 截断契约：单条正文切片 4000 字符，被截断时在元信息行末尾追加 `[截断: 本条剩余 N 字符未返回]`；单次响应正文总量上限 20000 字符，按 id 顺序累加，到达额度即停止；存在未返回内容时末尾输出 `> 续读: memory_read(ids=[...], offset=N)`
- **Acceptance Criteria**：
  - 5000 字符正文输出 4000 字符正文，并出现 `> 续读: memory_read(ids=["mem_xxxxxx"], offset=4000)`
  - 越权条目输出行恰为 `[1] mem_xxxxxx | [无权访问]`，渲染结果不含其分组 slug、标题与摘要
  - 多条正文累计超过 20000 字符时按 id 顺序在额度处停止，其余条目与剩余内容不出现在本次输出
  - 无标签条目的标签字段输出为 `-`

---

## Phase 1.5：服务装配、CLI 与自动化验收

### TASK-014：注册 4 个只读 MCP 工具

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-005、TASK-006、TASK-007、TASK-009、TASK-013
- **Description**：新增 `capsa/mcp_service.py`，创建 `FastMCP("capsa")` 实例并注册只读工具。
- **Details**：
  - 模块导出 `mcp` 实例，通过 `auth=CapsaTokenVerifier()` 装配令牌校验
  - 工具签名：`memory_groups()`、`memory_search(query=None, group=None, limit=10)`、`memory_peek(ids)`、`memory_read(ids, offset=0)`
  - 四个工具均带 `readOnlyHint` 注解；`limit` 上限 20
  - `memory_peek` 的 `ids` 上限 10，`memory_read` 的 `ids` 上限 5；超限时抛 `ToolError`，消息为中文并给出上限值与本次实际条数
  - **错误分层决策**：`ids` 超限落在工具级 `isError: true`，改造为 JSON-RPC `invalid params` 需要在 FastMCP 调度之前接管参数校验，与框架正向冲突且收益为零。`AgentSpace 记忆服务设计方案.md` §6.4 该行已同步改为工具级报错；实测 FastMCP 自身的 `max_length` 校验同样渲染为 `isError: true`，分层一致
  - 不依赖 FastMCP 的 `max_length` 注解做上限校验：其报错文本为英文 pydantic 原文，不符合面向 Agent 的中文可操作反馈要求
  - 工具内通过 `get_access_token()` 读取本次请求的 `key_id` 与 `grants`，不得使用模块级全局变量传递授权信息
  - 工具内不出现 SQL，全部经 `capsa/dal.py` 入口访问数据
  - 工具描述写明"不要一次性读取正文"的三级使用约定
- **Acceptance Criteria**：
  - 经 HTTP 调用 `tools/list` 返回恰为四个工具，且四个工具注解均含 `readOnlyHint: true`
  - 越权条目经 `memory_peek` 与 `memory_read` 均返回 `[无权访问]`，响应文本不含其分组 slug、标题、摘要与正文
  - `memory_read` 传 6 个 id 时返回 `isError: true`，消息含上限 5 与本次条数 6
  - 撤销 Key 后调用任一工具返回 HTTP 401

### TASK-015：装配 Starlette 根应用与健康探测

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-010、TASK-014
- **Description**：新增 `capsa/server.py`，装配根 ASGI 应用并挂载 `/healthz` 与 `/mcp`。
- **Details**：
  - 路由顺序固定为 `/healthz` 在前、`/mcp` 在后；Phase 3 将在其后追加 `/api` 与静态根路径，本阶段不预留空挂载
  - MCP 子应用构造为 `mcp.http_app(path="/mcp")`，并把其 lifespan 传给根应用 `Starlette(lifespan=mcp_app.lifespan)`；不传 lifespan 会抛 task group 未初始化错误（FastMCP 4 的 `http_app()` 默认路径已是 `/mcp`）
  - `/healthz` 为 GET，无认证；数据库可用返回 200 与 `{"status": "ok"}`，不可用返回 503 与 `{"status": "error", "message": "database unavailable"}`
  - 通过 `app.add_middleware(RequestBodyLimitMiddleware, max_body_size=1048576)` 挂载 1MB 拦截
  - 模块级导出 `app`，保证 `uvicorn capsa.server:app` 可直接启动
- **Acceptance Criteria**：
  - 无认证 `GET /healthz` 返回 200 且响应体为 `{"status": "ok"}`
  - 以空库启动应用并完成一次 `/healthz` 与一次 `/mcp` 握手后，`groups` 与 `keys` 两表仍为空（服务启动不得产生隐式业务数据）
  - 无认证向 `/mcp` 发 `initialize` 返回 401
  - 带有效 Key 完成 `initialize` 返回 200 并给出 `mcp-session-id` 响应头，后续 `tools/call` 返回 200
  - `POST /mcp` 发送 1100000 字节请求体返回 413

### TASK-016：实现基础 CLI 子命令

- **Status**：DONE
- **Priority**：P1
- **Depends on**：TASK-015
- **Description**：新增 `capsa/cli.py`，提供 `init`、`group`、`key` 三组子命令。
- **Details**：
  - 使用标准库 `argparse` 组织子命令，`main()` 为入口，返回进程退出码
  - `capsa init`：预置 `proj`、`study`、`life`、`track` 四个标准分组，重复执行不报错、不覆盖既有描述
  - `capsa group add <slug> <name> --desc "<description>"`、`capsa group list`
  - `capsa key create <name> --scopes "proj:rw,study:r"`：签发后仅本次打印明文令牌，并提示明文不再可找回
  - `capsa key revoke <key_id>`、`capsa key list`
  - 服务启动路径不得自动创建任何分组或 Key
  - 本机不存在 `/data`，CLI 验收必须先把 `CAPSA_DB_PATH` 指向临时目录下的库文件，并从空库开始；部署环境仍使用 `/data/capsa.db`
- **Acceptance Criteria**：
  - 在 `CAPSA_DB_PATH=<临时目录>/capsa.db` 下连续执行两次 `capsa init` 均退出码 0，分组表恰有四行
  - `capsa key create` 输出的明文令牌长度为 47
  - 用该明文令牌完成一次 `/mcp` 鉴权后执行 `capsa key revoke`，再次调用返回 401
  - 重启服务后分组与 Key 数量不变

### TASK-017：搭建测试基座

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-015
- **Description**：新增 `tests/conftest.py`，提供隔离的数据库、种子数据与 HTTP 客户端夹具。
- **Details**：
  - 每个测试用例使用独立的临时数据库文件，经 `CAPSA_DB_PATH` 注入，用例结束后清理；测试全程不触碰 `/data`
  - 提供夹具：初始化好表结构的连接、预置分组与两把不同作用域 Key 的种子数据、挂载好 lifespan 的 `TestClient`
  - 提供辅助函数完成 MCP 握手与 `tools/call`：发起 `initialize`、发送 `notifications/initialized`、携带 `mcp-session-id` 调用工具，并把 `text/event-stream` 响应解析为 JSON
  - 端到端用例必须走 HTTP 链路；`fastmcp.Client(mcp)` 的内存传输在此版本下取不到鉴权上下文，不得用于鉴权与越权断言
  - 提供直接插入记忆条目的辅助函数，避免依赖尚未实现的写入工具
- **Acceptance Criteria**：
  - 基座夹具可被至少一个用例使用并通过
  - 用例执行前后均不存在指向 `/data` 的读写
  - 辅助函数返回的工具结果可通过 `isError` 与文本内容断言

### TASK-018：编写覆盖六条交付验收断言的用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-017
- **Description**：在 `tests/` 下按验收断言逐条编写用例。
- **Details**：
  - 用例一：依赖安装与启动 —— `GET /healthz` 返回 200 与 `{"status": "ok"}`；另以 monkeypatch 将 `capsa.server.check_db_health` 置为返回 `False`，断言返回 503 与 `{"status": "error", "message": "database unavailable"}`（用测试侧替换而非在生产代码里加“强制失败”开关）
  - 用例二：1MB 拦截 —— 向 `POST /mcp` 发送 1100000 字节请求体返回 413；无 `content-length` 的分块传输累计超限返回 413；恰好 1048576 字节放行
  - 用例三：鉴权与撤销 —— 非法令牌返回 401；`revoke_key` 后同一令牌立即返回 401
  - 用例四：三态防线隔离 —— 越权条目在 L1 `memory_search`、L2 `memory_peek`、L3 `memory_read` 三级均输出 `[无权访问]`，且每一级响应全文不含其分组 slug、标题、摘要与正文
    - L3 用另一把 Key 的条目 id 直接调用 `memory_read`，断言输出恰为 `[无权访问]` 行且正文不可见；只测 L2 会漏掉 L3 泄露正文的路径
  - 用例五：打分与排序确定性 —— 中文二字组查询命中预期条目；空查询按置顶与更新时间倒序输出
  - 用例六：体积截断与续读 —— 5000 字符正文输出 4000 字符正文并附带 `> 续读:` 行，`offset` 续读可取回剩余内容
  - 每个用例的断言指向具体字符串或状态码，不使用"包含任意内容"式的弱断言
- **Acceptance Criteria**：
  - `pytest -v` 退出码为 0，六条断言各有对应用例且全部通过
  - 用例四中越权响应的断言为正向检查（全文不含分组名）而非仅检查 `[无权访问]` 出现
  - 报告中不存在被跳过的用例

### TASK-019：编写端到端只读链路用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-018
- **Description**：在 `tests/` 下编写覆盖 4 个工具完整链路的用例。
- **Details**：
  - 链路：`memory_groups` → `memory_search` → `memory_peek` → `memory_read`
  - 用两把作用域不同的 Key 分别执行该链路，断言各自可见分组互不可见
  - 断言 `memory_search` 的下一级提示中给出的 id 与 `memory_peek` 可直接消费的 id 一致
  - 断言 `memory_read` 的输出可经返回的 `offset` 续读至正文结束
- **Acceptance Criteria**：
  - 两把 Key 的分组可见范围互不相交，各自链路的输出中不出现对方分组 slug
  - 四个工具的返回值均为纯文本且非空
  - 工具链路的排序结果与直接调用 `rank_memories` 的结果一致

### TASK-020：按实际代码校正 .docs/Project.md

- **Status**：DONE
- **Priority**：P1
- **Depends on**：TASK-019
- **Description**：TASK-000 已创建基线 `.docs/Project.md`，本任务在代码落地后按实际状态校正，使文档与代码库一致。
- **Details**：
  - 校正目录结构与模块职责一节：按 TASK-000 的 Plan 预期填入的路径，逐条与实际文件核对
  - 校正架构与数据流一节：补齐新增模块的职责与依赖方向
  - 补充依赖版本的实测结论；若实现期发生偏差，同步更新决策记录
  - 模板中无内容的可选章节整节删除，不保留空节与占位注释
- **Acceptance Criteria**：
  - 文件中不存在 `<!-- 待填 -->` 残留
  - 目录结构一节列出的每个文件路径在仓库中实际存在
  - 运行与测试命令在干净 shell 中可直接执行成功

---

## 交付链附加约定

以下为 Execute 之后各阶段的执行口径，不属于 Task 清单。

| 阶段 | 约定 |
|------|------|
| Test | 以 `.venv/bin/python -m pytest -v` 为准；全部用例通过后方可进入归档 |
| Document Maintenance | 完成 TASK-020；清理 `.pytest_cache/`、`__pycache__/` 等一次性产物 |
| Archive | 归档目录 `.docs/09-13-v1/`；须先确认 Plan.md 与 Tasks.md 已标注 `状态：DONE` 并含完成日期与回归测试结论；若用户随即下达"继续 Phase 2"指令，可保留根目录文件作为新阶段起点 |
| Git Commit | 仓库尚无提交身份，首次提交前需配置仓库级 `user.name` 与 `user.email`，不改动全局配置；提交信息以 Conventional Commits 类型前缀开头，正文用中文；本阶段为仓库首次提交，提交信息需说明这是 Phase 1 交付 |
| 提交前置 | TASK-001 未完成前，仓库内不存在 `.gitignore`，此时执行 `git add -A` 会把 `.venv/` 与 `.devtools/`（约 270 MB）一并纳入暂存区。任何提交动作必须在 TASK-001 之后进行，暂存前先用 `git status --porcelain` 确认这两个目录未被列入 |
