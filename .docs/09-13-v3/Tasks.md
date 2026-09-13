# Tasks：Capsa Phase 3 —— 可视化管理台、生产容器化与在线热备交付

**状态**：DONE
**完成日期**：2026-09-13
**关联 Plan**：`Plan.md` —— Capsa Phase 3 v1.0
**总计 Task**：18 个（TASK-033 ~ TASK-050，全部 DONE）
**回归结论**：`.venv/bin/python -m pytest -q` 161 passed / 0 failed；`cd web && npm run test:e2e` 9 passed / 0 failed

> **执行前置**：先读 Plan.md §2「契约收敛」，其中八条边界是本阶段所有实现的唯一基准。所有命令基于仓库根目录，Python 解释器为 `.venv/bin/python`，前端命令的工作目录为 `web/`。前端相关 Task 动手前先设 `npm_config_cache` 或用 `web/.npmrc`（本机 `~/.npm/_logs` 不可写，npm 会直接失败）。

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 22px 1fr;gap:0;align-items:stretch">

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 3.1</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">后端 REST API 与 DAL 入口</div>
  <div style="font-size:11px;color:#52525b">TASK-033 · 034 · 035 · 036 · 037</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="display:grid;grid-template-columns:1fr;gap:10px">
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 3.2</div>
    <div style="font-size:13px;font-weight:600;margin:4px 0 6px 0">路由装配与 CLI 运维</div>
    <div style="font-size:11px;color:#52525b">TASK-038 · 039 · 040 · 041</div>
  </div>
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 3.3</div>
    <div style="font-size:13px;font-weight:600;margin:4px 0 6px 0">Capsa Studio SPA</div>
    <div style="font-size:11px;color:#52525b">TASK-042 · 043 · 044 · 045 · 046</div>
  </div>
</div>

</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold;padding:10px 0 0 0">↓</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px;margin-top:12px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 3.4</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">容器编排、Playwright 套件与交付</div>
  <div style="font-size:11px;color:#52525b">TASK-047 · 048 · 049 · 050</div>
</div>

<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#71717a">
3.1 是共同前置；3.2 与 3.3 之间无代码依赖，可并行；3.4 依赖两者全部产出。
</div>

</div>

</figure>

---

## Phase 3.1：后端 REST API 与 DAL Web 查询入口

### TASK-033：实现 Web 列表与单条读取的数据访问入口

- **Status**：DONE
- **Priority**：P0
- **Depends on**：无（`dal.py`、`db.py`、`retrieval.py` 已存在）
- **Description**：在 `capsa/dal.py` 增加面向 Web 的三态查询与单条读取入口，并导出字段常量供路由层组装列表与详情。
- **Details**：
  - 新增模块级常量 `WEB_LIST_FIELDS`，列出列表项返回的字段：`id, group_slug, title, summary, tags, review_at, pinned, updated_at, deleted_at, deleted_reason`；新增 `WEB_ITEM_FIELDS`，在列表字段基础上追加 `created_at, body`。回收站视图要展示删除原因，因此 `deleted_at` 与 `deleted_reason` 在列表项上始终返回，活跃条目上为空值
  - `list_memories_for_web(conn, scopes, status="active", group=None, offset=0, limit=20) -> tuple[list[dict], int]`：
    - `group_slug IN (?, ...)` 参数化过滤 scopes；`scopes` 为空时返回 `([], 0)`
    - `group` 非空时追加参数化过滤
    - `status == "active"`：`deleted_at IS NULL`；`status == "overdue"`：`deleted_at IS NULL AND review_at IS NOT NULL AND review_at < ?`，阈值取 `db.utcnow()`，与 `retrieval.is_expired` 判定一致；`status == "deleted"`：`deleted_at IS NOT NULL`
    - 排序 `pinned DESC, updated_at DESC, id DESC`；`total` 由同条件的 `COUNT(*)` 取得，与 `items` 无关
    - 返回 `(items, total)`，`items` 已按 `limit` 与 `offset` 切片；返回行内 `tags` 保持数据库原始 JSON 字符串，由路由层反序列化
    - 不接受 `query` 参数：关键词的命中判据与排序统一由 `retrieval.rank_memories` 承担，SQL 不做关键词过滤
  - `get_memory_for_web(conn, memory_id: str) -> dict | None`：取 `WEB_ITEM_FIELDS`，**不过滤** `deleted_at`，供详情页与回收站恢复定位；查不到返回 `None`
  - `get_key(conn, key_id: str) -> dict | None`：返回 `id, name, scopes`（`scopes` 经 `json.loads`），供 `GET /api/auth/me`
  - 全部经参数化占位符，禁止字符串拼接用户输入；读函数不提交
- **Acceptance Criteria**：
  - `status="active"` 只返回未删除条目；`status="deleted"` 只返回已删除条目；`status="overdue"` 只返回 `review_at` 早于当前 UTC 的条目，边界上等于当前时刻的条目不入选
  - 传入 `{"proj": "rw"}` 与 `{"study": "rw"}` 两个 scope，各只能取到自己分组的条目
  - `list_memories_for_web` 返回的每一行键集合等于 `WEB_LIST_FIELDS`，且不含 `body`
  - `offset=1, limit=1` 返回的 `items[0]` 等于同一条件下 `limit=20` 结果里的第 2 条；两次调用的 `total` 相同且等于该状态下的实际条目数
  - `list_memories_for_web` 的签名不含 `query`，DAL 中不存在 `LIKE` 关键字
  - `get_memory_for_web` 对已软删除条目返回非空且 `deleted_at` 有值；`get_memories_batch_for_access` 对同一条目返回 `not_found`

### TASK-034：实现统一信封、Bearer 守卫与身份端点

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-033
- **Description**：新建 `capsa/web_api.py`，建立错误码、统一信封、Bearer 守卫中间件与异常处理，并交付 `GET /api/auth/me` 与 `GET /api/groups`。
- **Details**：
  - 模块级定义 `web_api_app = Starlette(routes=[...], exception_handlers={ToolError: tool_error_handler, Exception: internal_error_handler})`；异常处理只在中间件之外兜底，处理器内部一律显式返回
  - 错误码常量 `UNAUTHORIZED / FORBIDDEN / NOT_FOUND / PAYLOAD_TOO_LARGE / VALIDATION_ERROR / INTERNAL_ERROR` 与对应 HTTP 状态：401 / 403 / 404 / 413 / 422 / 500
  - 信封构造：`ok(data, status=200)` → `{"success": true, "data": data, "error": None}`；`fail(code, message, status)` → `{"success": false, "data": None, "error": {"code": code, "message": message}}`；两个函数是模块内私有
  - `BearerAuthGuard` 中间件：内部构造单例 `BearerAuthBackend(CapsaTokenVerifier())`（导入自 `mcp.server.auth.middleware.bearer_auth`，不是 `mcp.server.auth.provider`），对每个请求调用 `authenticate(HTTPConnection(scope))`；返回 `None` 时直接回 `UNAUTHORIZED` 401 信封并结束；否则写 `scope["user"]`、`scope["auth"]` 后放行。该中间件只作用于 `web_api_app`，不触碰 `/mcp` 与 `/healthz`
  - 模块级辅助 `_grants(request) -> dict[str, str]`：读 `request.user.access_token.claims["grants"]`；读不到时返回 `{}`，不抛异常
  - `tool_error_handler(request, exc)`：`ToolError` 一律映射 422 `VALIDATION_ERROR`，`message` 取 `str(exc)`
  - `internal_error_handler`：记录日志后返回 500 `INTERNAL_ERROR`，响应体不含堆栈
  - `GET /api/auth/me`：经 `dal.get_key` 取 `{key_id, name, scopes}` 包进单条成功信封；Key 记录缺失时回 401 `UNAUTHORIZED`
  - `GET /api/groups`：调用 `dal.list_groups_with_counts(conn, _grants())`，返回 `{items: [...], total: N, offset: 0, limit: N}` 列表信封
  - 前端计划的错误码枚举含 `PERMISSION_DENIED`，本阶段统一按 §2.3 使用 `FORBIDDEN`，不保留别名
- **Acceptance Criteria**：
  - 无 `Authorization` 头访问 `/api/auth/me` 返回 401，响应体为 `{"success": false, "data": null, "error": {"code": "UNAUTHORIZED", "message": ...}}`
  - 无效令牌同样返回 401 且响应体形状一致；撤销后的令牌下一次请求即 401
  - `GET /api/auth/me` 返回的 `scopes` 与签发时传入的字典逐键相等
  - `GET /api/groups` 只返回 scopes 内分组，每项含 `slug / name / description / permission / count`
  - 处理器内抛出未预期异常时返回 500 `INTERNAL_ERROR`，响应体不含堆栈文本

### TASK-035：实现记忆列表与详情端点

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-033、TASK-034
- **Description**：在 `capsa/web_api.py` 实现 `GET /api/memories` 与 `GET /api/memories/{id}`。
- **Details**：
  - `GET /api/memories`：查询参数 `status`（默认 `active`，只接受 `active / overdue / deleted`）、`group`、`query`、`offset`（默认 0）、`limit`（默认 20，上限 100）
    - `status` 非法、`limit` 不在 `1..100`、`offset` 为负 → 422 `VALIDATION_ERROR`
    - `query` 非空时：经 `dal.list_active_memories_for_search(conn, _grants(), group)` 取该授权范围内的轻量候选（无 `body`、无 `created_at`），交给 `retrieval.rank_memories(candidates, query)` 完成命中过滤与排序；`total` 取排序后的长度，`items` 取 `ranked[offset:offset+limit]` 并按 `WEB_LIST_FIELDS` 补齐字段（该分支只含活跃条目，`deleted_at` 与 `deleted_reason` 恒为 `None`），尺寸与类型都不需要额外查询
    - `query` 为空时走 `dal.list_memories_for_web` 分页，不取全量
    - `query` 非空且 `status != "active"` 时返回 422：`rank_memories` 只作用于活跃条目，与 MCP 的取值口径一致
    - 每项把 `tags` 由 JSON 字符串反序列化为列表，并补齐 `permission`（取 `_grants()[row["group_slug"]]`）与 `is_overdue`（`retrieval.is_expired(row["review_at"])`）
  - `GET /api/memories/{id}`：`dal.get_memory_for_web` 定位 → 条目不存在或已软删除或 `group_slug` 不在 scopes 内 → 404 `NOT_FOUND`「记忆 {id} 不存在或无权访问」 → 否则返回含完整 `body` 的单条信封，同样补齐 `tags`、`permission`、`is_overdue`
  - 详情响应不含 MCP L3 的 4000 字符截断与任何正文长度裁剪
  - 响应中的时间字段原样透传数据库字符串，不做格式转换
- **Acceptance Criteria**：
  - `GET /api/memories` 返回 `{"success": true, "data": {"items": [...], "total": N, "offset": 0, "limit": 20}}`，键名逐字一致
  - 两种分支（带 `query` 与不带 `query`）返回的列表项键集合都等于 `WEB_LIST_FIELDS`，另加 `permission` 与 `is_overdue`，且不含 `body` 与 `created_at`；`tags` 为 JSON 数组而非字符串
  - `status=overdue` 只返回已过期条目；`status=deleted` 返回的每项含非空 `deleted_reason`
  - 只读 Key 请求 `status=deleted` 时只看到自己 scopes 内的分组
  - `limit=0`、`limit=101`、`status=unknown` 三种输入均返回 422，信封 `error.code == "VALIDATION_ERROR"`
  - 分页：`limit=1&offset=1` 的 `items[0].id` 等于同一 `query` 下 `limit=100` 结果的第 2 条 id；`total` 等于命中条目数，不受分页影响
  - `query` 命中判据与 MCP 一致：`query="模型架构"` 能命中标题为「MCP 授权模型与设计架构」的条目（二字组命中而非整串子串匹配）；`query` 命中标签的条目同样返回
  - `query` 非空与 `status=deleted` 同传返回 422
  - `GET /api/memories/{id}` 返回的键集合等于 `WEB_ITEM_FIELDS` 加 `permission` 与 `is_overdue`；`body` 与落库正文逐字相等，6000 字正文不被截断
  - 用只读 Key 请求不属于自己的 id 与请求不存在的 id，两次响应体完全相等，且不含未授权分组的 slug、标题与正文
  - 软删除后 `GET /api/memories/{id}` 返回 404 `NOT_FOUND`

### TASK-036：实现新建、更新、软删除与恢复端点

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-033、TASK-034
- **Description**：在 `capsa/web_api.py` 实现 `POST /api/memories`、`PUT /api/memories/{id}`、`DELETE /api/memories/{id}` 与 `POST /api/memories/{id}/restore`。
- **Details**：
  - 校验函数复用：把 `capsa/mcp_service.py` 的 `_require_text` 重命名为公开的 `require_text`（同步更新该模块内三处调用），`web_api.py` 导入 `require_text` 与 `TITLE_MAX / SUMMARY_MAX / BODY_MAX`
  - `POST /api/memories`：入参 `{group, title, summary, body, tags?, review_at?}`
    - 分组判定：`_grants().get(group) != "rw"` 时 403 `FORBIDDEN`，文案固定为「对分组 {group} 没有写权限，拒绝写入」，「不在 scopes」与「只读」共用
    - 字段经 `require_text` 校验；`review_at` 经 `retrieval.normalize_review_at`，`ValueError` 转 422
    - 查重：`dal.list_active_memories_for_search` + `retrieval.find_similar_memories`，结果放进 `data.similar_items`（每项含 `id`、`title`、`similarity`），条照常落库
    - 落库经 `dal.insert_memory`；`sqlite3.IntegrityError` 转 422「分组 {group} 不存在，拒绝写入」；`dal.DuplicateMemoryId` 转 500 `INTERNAL_ERROR`
    - 返回 `{"id": ..., "similar_items": [...]}` 单条信封
  - `PUT /api/memories/{id}`：入参 `{title?, summary?, body?, tags?, review_at?, clear_review_at?, pinned?}`；定位与权限按 §2.3 的三分支；组装白名单字段字典（与 `memory_update` 同一套）；`clear_review_at` 与 `review_at` 同时给出、或字段字典为空 → 422；调用 `dal.update_memory`
  - `DELETE /api/memories/{id}`：入参 `{reason}`；`reason` 为空或纯空白 → 422「删除原因不能为空」；调用 `dal.soft_delete_memory(conn, id, reason.strip())`
  - `POST /api/memories/{id}/restore`：经 `dal.get_memory_for_web` 定位（该入口不过滤 `deleted_at`）；条目不存在或 `group_slug` 不在 scopes 内 → 404；权限为 `r` → 403；条目仍需删除态校验（`deleted_at` 为空时 404）；调用 `dal.restore_memory`
  - 资源归属变更不开放：`PUT` 不接受 `group` 字段，传入即被白名单忽略
  - 三个写端点的成功响应均含条目 id 与本次动作，不返回完整记录
- **Acceptance Criteria**：
  - `POST /api/memories` 成功返回 200，`data.id` 满足 `^mem_[a-z0-9]{6}$`，且该条目可经 `GET /api/memories/{id}` 读回
  - 只读 Key 对 `proj` 新建返回 403，错误文案与「`group` 完全不在 scopes 内」逐字相同；两种情形下 `memories` 行数均不变
  - 61 字标题返回 422，`error.message` 与 MCP `memory_save` 的 `isError` 文本逐字相等
  - 相似标题新建成功，`data.similar_items` 含既有条目 id，且条目已落库
  - `PUT` 只改传入字段：随后经 `GET` 读到的其余字段与 `created_at` 均未变
  - `PUT` 传 `clear_review_at=true` 后 `review_at` 为 `null`；同时传 `review_at` 时返回 422
  - `DELETE` 后条目不再出现在 `status=active` 列表，出现在 `status=deleted` 列表且 `deleted_reason` 等于传入原因；`reason` 为空串或纯空白时返回 422 且 `deleted_at` 仍为 `NULL`
  - `restore` 后条目重新出现在 `status=active` 列表；对未删除条目调用 `restore` 返回 404
  - 只读 Key 对属于 `proj` 的真实 id 调用 `PUT` 返回 403 且文案含「只读权限」；对未授权分组的 id 与不存在的 id 调用 `PUT`，两次响应体逐字相同

### TASK-037：编写 Web API 契约与授权用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-035、TASK-036
- **Description**：新增 `tests/test_web_api.py`，覆盖八个端点、统一信封、错误码映射与授权对称性。
- **Details**：
  - 复用既有夹具：`conn` / `seeded` / `client`，`client` 已是带 `TestClient` 的真实 HTTP 链路；另加一个 `web_headers(token)` 辅助，返回 `{"Authorization": f"Bearer {token}"}`
  - 八个端点各至少一条成功用例，各自断言 `success`、`data` 结构与关键字段
  - 信封用例分别断言成功与失败的三个顶层键，不使用「包含」式弱断言
  - 错误码用例逐条覆盖 §2.3 的映射矩阵：401、403、404、422 各至少一条；其中写操作的「越权 id」与「不存在 id」用字符串相等断言响应体
  - 字段超限用例断言 Web `error.message` 与直接调用 MCP 工具拿到的文本逐字相等（经 `open_session` 取 MCP 文本后比对）
  - `status=deleted` 的越权用例：断言只读 Key 看不到未授权分组的回收站条目
  - 413：经 `/api/memories` POST 1.1MB 请求体，断言 413；同时断言 `/api/memories` 返回 JSON 而非 HTML，防止静态托管劫持
- **Acceptance Criteria**：
  - `.venv/bin/python -m pytest tests/test_web_api.py -v` 退出码 0
  - 八个端点各有可指认的成功用例名，四类错误码各有可指认的失败用例名
  - 授权对称性用例使用响应体相等断言，不使用 `in` 断言
  - 无任何用例依赖执行顺序或共享可变状态

---

## Phase 3.2：Starlette 路由装配与 CLI 运维命令

### TASK-038：装配 /api 与静态根路径

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-034
- **Description**：改造 `capsa/server.py`，按固定顺序挂载完整路由，并保持既有 `/healthz` 与 `/mcp` 行为不变。
- **Details**：
  - `capsa/server.py` 增加 `from capsa.web_api import web_api_app`、`from starlette.routing import Mount`、`from starlette.staticfiles import StaticFiles`
  - 路由顺序固定：`Route("/healthz")` → `Route("/mcp")` → `Mount("/api", app=web_api_app)` → `Mount("/", app=StaticFiles(directory=static_dir, html=True))`
  - `static_dir = os.path.join(os.path.dirname(__file__), "static")`；仅当 `os.path.isdir(static_dir)` 为真时追加根路由
  - 根应用的 `lifespan` 仍为 `mcp_app.lifespan`，不改动
  - `app.add_middleware(RequestBodyLimitMiddleware, max_body_size=MAX_REQUEST_BYTES)` 保持在最后注册
  - `capsa/static/` 与 `web/node_modules/`、`web/dist/`、`web/test-results/`、`web/playwright-report/`、`.devtools/` 一并加入 `.gitignore`
  - 打包：确认 `capsa/static/**` 能进入 wheel。hatchling 默认按 VCS 规则剔除被忽略的路径，而 `capsa/static/` 正在 `.gitignore` 内，因此需在 `[tool.hatch.build.targets.wheel]` 声明 `artifacts = ["capsa/static/**"]` 或等价配置。执行时以实际构建结果为准：本机没有 hatchling 包，需在构建后核验产物清单
- **Acceptance Criteria**：
  - `GET /healthz` 仍返回 200 与 `{"status": "ok"}`；既有的 `/mcp` 握手与 401、413 用例无回归
  - `GET /api/memories` 在 `capsa/static/` 不存在时返回 JSON 信封而非 404 或 HTML
  - `capsa/static/` 不存在时应用可正常启动，`GET /` 返回 404
  - 临时创建 `capsa/static/index.html` 后，应用重启可经 `GET /` 返回该 HTML，且 `GET /api/memories` 仍返回 JSON
  - `git status --porcelain` 不出现 `web/node_modules/`、`capsa/static/`
  - 构建 wheel 后其文件清单包含 `capsa/static/index.html`（本机无 hatchling，此项如无法在本机验证，须在交付报告中列为云端 CI 验收项）
  - `.venv/bin/python -m pip install -e ".[test]"` 在静态目录不存在时退出码 0

### TASK-039：实现 capsa review 审阅子命令

- **Status**：DONE
- **Priority**：P1
- **Depends on**：无（`cli.py` 与 `retrieval.py` 已存在）
- **Description**：在 `capsa/cli.py` 增加 `review` 子命令，复用检索实现输出与 MCP 完全同序的纯文本列表。
- **Details**：
  - 签名 `capsa review [--group <slug>] [--query <text>] [--limit N]`；`--limit` 默认 20
  - 取数：`dal.list_active_memories_for_search(conn, {slug: "rw" for slug in groups}, group)`；分组集合取自 `dal.list_groups`，CLI 是管理员通道，不区分读写
  - 排序：`retrieval.rank_memories(memories, query or "")[:limit]`，与 `memory_search` 调用同一函数
  - 每行输出 `[n] {id} | {group_slug} | {updated_at 前 10 位} | {title}`；无结果时输出「没有符合条件的记忆」
  - 复用 `capsa/formatters.py` 的日期截取口径（`[:10]`）
  - 不新增服务端依赖，不引入渲染格式库
- **Acceptance Criteria**：
  - 同一分组、同一 query、同一 limit 下，`capsa review` 输出的 id 序列与 MCP `memory_search` 的 id 序列逐条相等
  - 置顶条目即使 `updated_at` 更早也排在前面
  - `--group study` 时输出不含 `proj` 条目
  - 无匹配时输出「没有符合条件的记忆」且返回码 0

### TASK-040：实现 capsa backup 与 capsa restore 子命令

- **Status**：DONE
- **Priority**：P1
- **Depends on**：无
- **Description**：在 `capsa/cli.py` 增加 `backup` 与 `restore` 子命令，交付幂等热备与快照回灌。
- **Details**：
  - `capsa backup [target_dir] [--keep-days N]`：`--keep-days` 默认 14
    - 目标目录优先取位置参数 `target_dir`，未传时取环境变量 `CAPSA_BACKUP_DIR`，再未传则用 `/backup`；目录不存在时创建。保留位置参数是因为规划文档 §4.2.5 的 Crontab 交付行 `capsa backup /backup` 正是这么调用的，只认环境变量会让该命令以 `unrecognized arguments` 直接失败
    - 快照文件名 `capsa-YYYY-MM-DD.db`（UTC 日期，取自 `db.utcnow()`）；已存在同名文件时覆盖，因此同日重复执行为幂等
    - 复制用 `sqlite3.Connection.backup(source_conn, target_conn)`：源连接 `db.connect()`（不建表，源库不存在时生成空快照），目标为 `sqlite3.connect(快照路径)`，完成后关闭目标再关闭源
    - 清理：遍历目录内匹配 `capsa-*.db` 的文件，解析文件名日期，早于「今天减去 `keep-days`」的删除；文件名不符合模式的文件不动
    - 输出「已生成快照：{path}」与「已清理 {n} 个过期快照」
  - `capsa restore <snapshot_path>`：校验文件存在，用 `Connection.backup` 反向写回 `db.db_path()`；成功后输出「已恢复：{path} 到 {db_path}，请重启服务」；文件不存在时 stderr 提示并返回 1
  - 命令不探测服务是否在运行；覆盖运行中的库由运维负责先停服务，测试仅覆盖服务未运行的情形
  - 两个命令都用 `argparse` 子命令组织，与既有口径一致；`main()` 仍返回退出码
  - 不做对象存储同步、不做隐式快照发现、不引入调度库
- **Acceptance Criteria**：
  - `capsa backup` 生成的文件可被 `sqlite3.connect` 独立打开，`SELECT COUNT(*) FROM memories` 与源库相等
  - 同一目标目录下连续执行两次，文件数不增加，第二次仍返回 0
  - 在目标目录预置 `capsa-2020-01-01.db` 与 `notes.txt`，执行后前者被删除、后者保留
  - `--keep-days 0` 时当日快照也被清理
  - `capsa restore` 到空库后，条目数与标题与快照一致
  - `capsa restore /nonexistent.db` 返回 1 且 stderr 含未找到提示
  - 备份过程中不关闭或重启服务，源库仍可被其他连接读写

### TASK-041：编写路由装配、review 同源与备份用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-038、TASK-039、TASK-040
- **Description**：新增 `tests/test_phase3_cli.py` 与 `tests/test_phase3_assembly.py`，覆盖路由装配、检索同源与备份链路。
- **Details**：
  - `tests/test_phase3_assembly.py`：断言 `/healthz` 200、`/api/memories` 返回 JSON、静态目录缺失时 `GET /` 404；用 `tmp_path` 伪造静态目录并 monkeypatch `capsa.server.static_dir` 后重载应用，断言 `GET /` 返回 HTML 且 `/api/memories` 仍为 JSON
  - `tests/test_phase3_cli.py`：
    - review 同源：三方都限定同一分组（MCP 传 `group="proj"`、review 传 `--group proj`、Web 传 `group=proj`）与同一 `query`，MCP 文本经正则抽 id 序列，与 `run_cli` 的 review 输出、`GET /api/memories` 的 `items[].id` 做列表相等断言
    - backup：用 `run_cli(db_path, "backup", str(target_dir))` 触发（`CAPSA_BACKUP_DIR` 不设，以覆盖位置参数路径），断言快照文件存在、可独立打开、`COUNT(*)` 相等；另用 `run_cli(db_path, "backup")` 覆盖环境变量回退路径
    - 清理：预置过期文件名与无关文件，断言只删前者
    - restore：备份后清空源库，再 `capsa restore`，断言条目回到源库
  - 断言指向具体字符串或具体行数/条数，不使用「包含任意内容」式弱断言
  - 用例结束不遗留临时文件（全部落在 `tmp_path`）
- **Acceptance Criteria**：
  - `pytest tests/test_phase3_assembly.py tests/test_phase3_cli.py -v` 退出码 0
  - 检索同源用例使用列表相等断言而非集合相等（顺序是契约的一部分）
  - 备份用例断言快照可独立打开，不依赖进程内的源连接
  - `.venv/bin/python -m pytest -q` 全绿，既有 101 个用例无回归

---

## Phase 3.3：Capsa Studio SPA 与前端工程

### TASK-042：搭建前端工程与构建契约

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-034（信封契约）
- **Description**：新建 `web/` 工程骨架，锁定依赖、配置 Vite 产出到 `capsa/static/`，并打通 `npm run build`。
- **Details**：
  - `web/package.json`：依赖与前端计划 §5.2 一致，另补 `@types/react@18.3.3`、`@types/react-dom@18.3.0`；脚本 `dev / build / preview / test:e2e`，其中 `build` 为 `tsc && vite build`
  - `web/.npmrc`：`cache=../.devtools/npm-cache`
  - `web/vite.config.ts`：`build.outDir` 取 `process.env.CAPSA_STATIC_DIR ?? "../capsa/static"`、`emptyOutDir: true`；`server.proxy` 把 `/api` 指向 `http://127.0.0.1:8000` 供本地开发
  - `web/tsconfig.json`：`strict: true`、`noEmit: true`、`jsx: react-jsx`、`moduleResolution: bundler`
  - `web/tailwind.config.js` 与 `web/postcss.config.js`：内容扫描 `index.html` 与 `src/**/*.{ts,tsx}`
  - `web/index.html`、`web/src/main.tsx`、`web/src/styles/index.css`（三条 tailwind 指令）
  - 目录结构按前端计划 §5.1 落地：`src/api.ts`、`src/types.ts`、`src/components/`、`src/App.tsx`
  - `.gitignore` 已含 `capsa/static/`（TASK-038），确认 `web/dist/` 不产生
  - 构建前先 `mkdir -p` 目标目录：Vite 只在 `outDir` 位于项目根目录内时才代为创建，`../capsa/static` 越出 `web/`，缺目录会直接报错。本地 `npm run build` 与 Dockerfile 的构建阶段都必须先建目录，顺序写死：`mkdir -p <dir> && tsc && vite build`
- **Acceptance Criteria**：
  - 在 `web/` 下执行 `npm ci`、`mkdir -p ../capsa/static`、`npm run build` 均退出码 0，产物落在 `capsa/static/`（含 `index.html` 与 `assets/`）
  - `npm run build` 先执行 `tsc` 并通过，无类型错误
  - `gzip -c capsa/static/assets/*.js` 与 CSS 合计大小小于 150 KB
  - `git status --porcelain` 不出现 `web/node_modules/`、`capsa/static/`、`.devtools/npm-cache/`
  - 产出被 `capsa/server.py` 的静态根路径直接服务，无需额外配置
  - `CAPSA_STATIC_DIR=/tmp/capsa-static-out` 时产物落在该目录，`capsa/static/` 不被创建

### TASK-043：实现凭据生命周期与 API 客户端

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-042
- **Description**：实现 `web/src/api.ts` 与 `web/src/types.ts`，建立凭据存储、统一信封解析、401 拦截与登录门。
- **Details**：
  - 凭据只存 `sessionStorage`，键名 `capsa_key`；提供 `getKey / setKey / clearKey`
  - `request<T>(path, init)`：注入 `Authorization: Bearer <key>`，解析统一信封；`success === false` 时抛出携带 `code` 与 `message` 的 `ApiError`
  - 任意响应 `401` 时清除 `sessionStorage` 凭据并切换到登录态
  - `types.ts` 定义 `Envelope<T>`、`MemoryListItem`、`MemoryDetail`、`GroupInfo`、`KeyInfo`、`SimilarItem`，字段与后端信封逐字对齐（时间字段为 `string`，`tags` 为 `string[]`）
  - `App.tsx` 顶层状态机：无凭据 → 登录卡片（输入 Key、连接按钮、失败提示）；有凭据 → 三视图外壳
  - 右上角常驻「退出」按钮，点击清空凭据并回到锁屏
  - 登录成功后调用 `GET /api/auth/me` 校验并缓存 `scopes`
- **Acceptance Criteria**：
  - 未登录时页面只显示登录卡片，不发起任何业务请求
  - 输入无效 Key 显示「凭据无效或已被吊销」，`sessionStorage` 中无残留
  - 输入有效 Key 后 `sessionStorage.getItem("capsa_key")` 有值，页面进入三视图外壳
  - 点击「退出」后 `sessionStorage` 中该键为 `null`，页面回到登录卡片
  - 任意请求返回 401 时自动清空凭据并回登录态

### TASK-044：实现记忆工作台视图

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-043
- **Description**：实现 `MemoryList.tsx`、`MemoryDetail.tsx`、`EditDrawer.tsx` 与工作台的筛选、检索、编辑、新建能力。
- **Details**：
  - 左侧列表：分组胶囊（来自 `GET /api/groups`）、关键词输入、置顶筛选；每项显示标题、摘要、标签、更新日期与读写标识（由 `permission` 决定）
  - 右侧详情：渲染 Markdown 正文、标签、复核时间与操作按钮（编辑、删除）
  - 编辑抽屉：`title / summary / body` 实时字数指示（0/60、0/200、0/64k），超限时输入框标红并禁用提交
  - 新建：抽屉复用同一表单；提交 `POST /api/memories`，响应含 `similar_items` 时在抽屉内展示相似条目列表，条已创建
  - 编辑：提交 `PUT /api/memories/{id}`，只发送发生变化的字段
  - 删除：弹出原因输入，提交 `DELETE /api/memories/{id}`
  - 只读分组（`permission === "r"`）时「新建」「编辑」「删除」按钮 `disabled`，并在界面标注「只读」
  - 抽屉有未保存改动时，点击遮罩层关闭需二次确认
  - 四类状态：加载骨架屏、空态「暂无匹配记忆」、错误告警条带「重试」、未授权态
- **Acceptance Criteria**：
  - 分组胶囊只显示 `GET /api/groups` 返回的分组，切换后列表随之过滤
  - 关键词检索结果与 `GET /api/memories?query=...` 的返回一致
  - 超过 60 字的标题在输入时标红且提交按钮 `disabled`
  - 新建成功后新条目出现在列表中，相似提示展示既有条目 id 与标题
  - 编辑只改一个字段时，其余字段在界面上保持不变
  - 只读 Key 登录后「新建」「编辑」「删除」按钮均不可点击
  - 抽屉有改动时点击遮罩层弹出二次确认；无改动时直接关闭

### TASK-045：实现时效复核中心与回收站视图

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-044
- **Description**：实现 `ReviewCenter.tsx` 与 `RecycleBin.tsx`，覆盖过期聚合、延期与回收站恢复。
- **Details**：
  - 复核中心：请求 `GET /api/memories?status=overdue`；每条显示标题、复核时间、过期标识与「延期 +30 天」「延期 +90 天」按钮
  - 延期按 `PUT /api/memories/{id}` 传 `review_at`（当前 UTC 时间加对应天数，ISO 8601 字符串）
  - 复核中心空态显示「所有追踪记忆均在有效期内」
  - 回收站：请求 `GET /api/memories?status=deleted`；每条显示标题、分组、删除时间与 `deleted_reason`
  - 恢复按钮：`POST /api/memories/{id}/restore`，成功后条目从回收站消失并出现在工作台
  - 回收站空态显示「回收站暂无条目」
  - 两个视图共用 TASK-043 的四类状态契约与错误重试
  - 只读分组条目不提供延期与恢复操作
- **Acceptance Criteria**：
  - 复核中心只显示 `is_overdue` 为真的条目
  - 点击「延期 +30 天」后该条目的 `review_at` 变为约 30 天后的 UTC 时间，且从复核中心列表消失
  - 回收站条目的删除原因与删除时间与数据库值一致
  - 点击恢复后条目出现在工作台列表，回收站不再显示
  - 两个视图的空态文案逐字匹配；错误态提供「重试」按钮

### TASK-046：实现 Markdown 安全渲染与 XSS 断言

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-044
- **Description**：在详情与预览处接入 `react-markdown` + `rehype-sanitize`，禁用原始 HTML 并限制链接协议。
- **Details**：
  - 渲染组件单独抽出，供工作台详情与复核/回收站预览共用
  - `skipHtml` 置真，禁止渲染任意内联 HTML 标签
  - `rehypePlugins={[rehypeSanitize]}`，使用默认 GitHub 白名单
  - `components.a` 覆写只做一件事：给所有链接附 `target="_blank"` 与 `rel="noopener noreferrer"`。协议白名单交给 `rehype-sanitize` 的默认规则集（该依赖是计划中锁定的直接依赖，它的行为不随 `skipHtml` 变化），不手写协议正则——手写黑名单只会与上游规则集漂移
  - 不引入语法高亮库（体积与收益不成比例），代码块用等宽字体与浅底呈现
  - 不引入 `dangerouslySetInnerHTML`
- **Acceptance Criteria**：
  - 正文含 `<script>window.xss_flag=true;</script>` 时页面不写入 `window.xss_flag`，DOM 中不存在该 `script` 节点
  - 正文含 `<img src=x onerror="window.xss_flag=true">` 时渲染结果的 DOM 中不存在任何 `onerror` 属性
  - 正文含 `[点击](javascript:window.xss_link=true)` 时渲染后不存在 `href` 以 `javascript:` 开头的锚点，且 `window.xss_link` 未被写入
  - 正文含 `data:text/html,...` 链接时同样不存在 `href` 以 `data:` 开头的锚点
  - 普通 `http` / `https` 链接保留且带 `target="_blank"` 与 `rel="noopener noreferrer"`；`mailto:` 链接的 `href` 原样保留
  - 源码中不出现 `dangerouslySetInnerHTML`

---

## Phase 3.4：容器编排、Playwright 套件与交付

### TASK-047：编写容器编排文件与静态校验用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-038、TASK-042
- **Description**：新增 `Dockerfile`、`docker-compose.yml`、`Caddyfile` 与 `docs` 级 Cron 说明，并新增静态校验用例。
- **Details**：
  - `Dockerfile`：两阶段，`node:20-alpine` 构建前端 → `python:3.12-slim` 运行时；运行时 `USER capsa`、`CAPSA_DB_PATH=/data/capsa.db`、`HEALTHCHECK` 指向 `/healthz`
  - 前端产物的路径在构建阶段与拷贝阶段必须一致：构建阶段设 `ENV CAPSA_STATIC_DIR=/build/static` 并 `mkdir -p $CAPSA_STATIC_DIR` 后再 `npm run build`，拷贝阶段 `COPY --from=web-builder --chown=capsa:capsa /build/static/ capsa/static/`。不使用规划文档 §4.2.6 片段里的 `/web/dist/`——按该片段执行时产物落在 `/capsa/static`，`/web/dist` 不存在，`COPY` 会直接失败
  - `docker-compose.yml`：`capsa` 服务带 `restart: unless-stopped`、`capsa-data` 与 `capsa-backup` 卷；`caddy` 服务 `depends_on.capsa.condition: service_healthy`、挂载 `Caddyfile` 只读
  - `Caddyfile`：`request_body max_size 1MB`、`reverse_proxy capsa:8000` 且 `flush_interval -1`
  - Cron 一行配置写入 `.docs/Project.md` §2 的「如何运行」，不新建独立文档
  - 新增 `tests/test_phase3_deploy.py`：
    - `yaml.safe_load` 解析 compose，断言服务名、卷名、健康依赖与端口
    - 读 `Dockerfile` 文本，断言含两个 `FROM`、`USER capsa`、`HEALTHCHECK`、`/healthz`，且 `COPY --from` 的源路径与构建阶段写入的 `CAPSA_STATIC_DIR` 逐字一致
    - 读 `Caddyfile` 文本，断言含 `max_size 1MB`、`flush_interval -1`、`capsa:8000`
    - 断言 `docs` 中的 Cron 行含 `docker compose` 与 `capsa backup`
  - `pyyaml` 已由 fastmcp 传递引入（实测 6.0.3），仅测试使用，不新增运行期依赖；若需显式声明则加入 `[project.optional-dependencies].test`
- **Acceptance Criteria**：
  - `pytest tests/test_phase3_deploy.py -v` 退出码 0
  - compose 经 `yaml.safe_load` 无异常，断言指向具体服务名与卷名
  - Dockerfile 用例断言 `USER capsa`，防止容器以 root 运行
  - 交付报告中显式列出「镜像构建、容器健康检查、Caddy TLS」三项由云端 CI 验收，本机未执行
  - 本机不执行任何 `docker` 命令

### TASK-048：编写 Playwright 端到端套件

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-043、TASK-044、TASK-045、TASK-046
- **Description**：新增 `web/playwright.config.ts` 与 `web/tests/e2e.spec.ts`，覆盖凭据、XSS、权限自适应、字数校验、CRUD 与移动端。
- **Details**：
  - `playwright.config.ts`：`testDir: "./tests"`、`use.channel: "chrome"`（驱动系统 Chrome，不下载自带 chromium）、`use.baseURL` 指向 webServer 地址
  - `webServer.command` 指向 `web/tests/serve.sh`：按序在临时目录建库（`CAPSA_DB_PATH`）、`capsa init`、签发一把 `rw` Key 与一把只读 Key 并把令牌写入 `keys.json`，最后 `exec` 起 `.venv/bin/python -m uvicorn capsa.server:app --port <高位端口>`；工作目录为仓库根目录，`reuseExistingServer: false`
  - 用例从 `keys.json` 读取令牌，不依赖环境变量传递；测完删除临时目录
  - 用例覆盖：
    1. 凭据存销：连接成功写入 `sessionStorage`、退出后清空
    2. 401 清理：伪造失效令牌后请求业务接口，凭据被清空并回登录态
    3. XSS：注入 `<script>`、`onerror` 与 `javascript:` 链接，断言 window 探针标志未写入
    4. 权限自适应：只读 Key 登录后「新建」「编辑」「删除」按钮不可点击
    5. 字数校验：标题 61 字时保存按钮置灰并标红
    6. CRUD 全流程：新建含 Markdown 列表的正文 → 检索 → 编辑并清空复核时间 → 软删除填原因 → 回收站看到原因 → 恢复 → 工作台重新可见
    7. 移动端 375px：单栏布局与抽屉全屏展开
  - 用例之间通过唯一标题隔离，不依赖执行顺序
- **Acceptance Criteria**：
  - 在 `web/` 下执行 `npm run test:e2e` 退出码 0，全部用例通过
  - 用例 3 的断言读取 `window` 上的探针标志，而不是仅断言文本出现
  - 用例 6 的每一步都在界面断言，不经 `page.evaluate` 直连 API 绕过界面
  - 测试结束后临时数据库目录与 `web/test-results/` 不留在仓库中（`git status --porcelain` 为空）
  - 端口被占用时用例失败，不静默连到既有进程

### TASK-049：按实际代码更新 Project.md 与设计文档

- **Status**：DONE
- **Priority**：P1
- **Depends on**：TASK-048
- **Description**：按 Phase 3 实际产出校正 `.docs/Project.md`，并回填设计文档与规划文档的事实漂移。
- **Details**：
  - `.docs/Project.md`：
    - §1 当前阶段改为「Phase 3 交付完成」；非目标中移除已交付项
    - §2 运行方式补 `capsa review` / `capsa backup` / `capsa restore`、前端 `npm ci && npm run build`、E2E 命令与 Cron 一行配置**
    - §3 目录结构补 `capsa/web_api.py`、`capsa/static/`、`web/` 与新增测试模块
    - §4 数据流补 Web 链路：浏览器 → Bearer 守卫 → 处理器 → DAL → JSON 信封
    - §5 补前端约定：凭据仅存 `sessionStorage`、Markdown 必须经 `rehype-sanitize`
    - §6 补两条坑：npm 默认缓存目录不可写（须用 `web/.npmrc`）、Playwright 用系统 Chrome 不下载 chromium
    - §8 补本阶段决策：单层 Bearer 守卫、404/403 映射矩阵、字段校验单源复用、备份按文件名日期清理
  - `Capsa_落地交付分期规划.md`：§4.2.1 的 `server.py` 片段改为与实现一致；§4.2.7 的「Error 码枚举」与 §4.3 的检查清单按本 Plan §6.1 标注验证位置
  - `Capsa_可视化前端管理计划.md`：错误码枚举去掉 `PERMISSION_DENIED` 别名、`.npmrc` 与 `channel: "chrome"` 的取舍回填、Playwright 示例改为真实用例形态
  - `AgentSpace 记忆服务设计方案.md`：§8 分期表中 P2/P3 的实际归属更新；§九「不做 Web 管理台」一行按规划文档 §零.8 的演进说明修订
  - 只回填与实现冲突的事实陈述，不重写文档风格
- **Acceptance Criteria**：
  - Project.md 中出现的每个文件路径与命令在仓库中实际存在或可直接执行
  - 设计文档不再存在「不做 Web 管理台」的未修订陈述
  - 两份规划文档中已证伪的代码片段（`RequestSizeLimitMiddleware`、错误码别名）不再出现
  - §8 每条决策与 Plan §4 一致，无相互矛盾

### TASK-050：归档与交付

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-047、TASK-048、TASK-049
- **Description**：完成清理、全量回归、归档与提交。
- **Details**：
  - 清理：删除 `.pytest_cache/`、`__pycache__/`、`web/test-results/`、`web/playwright-report/`；确认 `capsa/static/` 与 `.devtools/npm-cache/` 未入库
  - 回归：`.venv/bin/python -m pytest -q` 与 `cd web && npm run test:e2e` 均退出码 0
  - 归档：Plan.md 与 Tasks.md 标注 `状态：DONE`、完成日期与回归测试结论，移入 `.docs/09-13-v3/`
  - 提交：Conventional Commits 英文类型前缀 + 中文正文；不提交任何 `.db`、`node_modules/`、构建产物
- **Acceptance Criteria**：
  - `.docs/09-13-v3/` 同时含 `Plan.md` 与 `Tasks.md`，根目录无残留
  - `git status --porcelain` 中不出现 `.venv/`、`.devtools/`、`*.db`、`node_modules/`、`capsa/static/`
  - 提交信息以英文 Conventional Commits 前缀开头、正文为中文
  - 归档后两条测试命令仍全绿

---

## 交付链附加约定

以下为 Execute 之后各阶段的执行口径，不属于 Task 清单。

| 阶段 | 约定 |
|------|------|
| Test | Python 侧以 `.venv/bin/python -m pytest -q` 为准；前端侧以 `cd web && npm run test:e2e` 为准；两者全绿后方可进入归档 |
| 本机不可验证项 | 镜像构建、`docker compose up`、容器健康检查、Caddy 反代与 TLS、Crontab 实际调度；这五项由云端 CI 验收，须在交付报告中显式列出 |
| Document Maintenance | 完成 TASK-049；清理 `.pytest_cache/`、`__pycache__/`、`web/test-results/` 等一次性产物 |
| Archive | 归档目录 `.docs/09-13-v3/`；须先确认 Plan.md 与 Tasks.md 已标注 `状态：DONE` 并含完成日期与回归测试结论 |
| Git Commit | 沿用仓库既有提交风格；不提交 `.db` 产物、`node_modules/` 与 `capsa/static/` |
| 前端一次性产物 | `npm ci` 与 Playwright 的下载物均落在已被忽略的目录；如需重新构建可安全删除 `capsa/static/` 与 `.devtools/npm-cache/` |
