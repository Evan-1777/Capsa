# Tasks：按需正文检索与 Agent 提示词信噪比重构

**关联 Plan**：`Plan.md` —— 按需正文检索与 Agent 提示词信噪比重构 v1.1  
**总计 Task**：7 个

---

## Phase 1：数据访问层与检索打分层正文能力扩展

### TASK-001：改造 capsa/dal.py 的 list_active_memories_for_search 支持按需查询 body

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/dal.py` 的 `list_active_memories_for_search` 函数签名中增加 `include_body: bool = False` 参数，仅当其为 True 时在 SQL SELECT 中包含 `body` 字段，默认严格维持原字段不查 `body`，保护轻量环境内存。
- **Details**：
  - 在 `capsa/dal.py` 顶部定义常量 `_MEMORY_SEARCH_WITH_BODY_FIELDS = f"{_MEMORY_SEARCH_FIELDS}, body"`。
  - 修改函数签名：`def list_active_memories_for_search(conn: sqlite3.Connection, scopes: dict[str, str], group: str | None = None, include_body: bool = False) -> list[dict]:`。
  - 修改 SQL 生成逻辑：依据 `include_body` 为 True 或 False，分别选用 `_MEMORY_SEARCH_WITH_BODY_FIELDS` 或 `_MEMORY_SEARCH_FIELDS`。
- **Acceptance Criteria**：
  - 执行 `.venv/bin/pytest tests/test_units.py` 通过。
  - 调用 `dal.list_active_memories_for_search(conn, scopes, include_body=False)` 返回结果无 `body` 键；调用 `dal.list_active_memories_for_search(conn, scopes, include_body=True)` 返回结果包含 `body` 键。
- **Dependencies**：无
- **Priority**：High

### TASK-002：改造 capsa/retrieval.py 支持正文命中判断与非对称低权重打分

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/retrieval.py` 中为 `_hits`、`score` 与 `rank_memories` 增加入参 `include_body: bool = False`，实现正文词元命中支持与非对称低权重打分机制（正文命中每词元 +0.2 分，正文得分上限 0.8 分），并在同等修正条件下确保元数据命中（标题 4、摘要 1）基础分严格高于正文命中。
- **Details**：
  - 修改 `_hits(memory: dict, terms: set[str], include_body: bool = False) -> bool`：当 `include_body=True` 且 `"body" in memory` 时，将正文规范化文本追加至待匹配字段集合；默认维持仅匹配标题、摘要和标签。
  - 修改 `score(memory: dict, terms: set[str], now: datetime | None = None, include_body: bool = False) -> float`：原有打分规则（标题 4、标签 2、摘要 1、置顶 +3、过期 -2）不变；当 `include_body=True` 且 `"body" in memory` 时，计算正文命中文本词元数，每命中一个词元加 0.2 分，正文得分上限为 0.8 分（`min(0.2 * body_matches, 0.8)`）；统一返回数值（如未命中正文返回整数/等值浮点，开启命中时返回 `round(total, 2)`，无需区分类型分支）。
  - 修改 `rank_memories(memories: list[dict], query: str, now: datetime | None = None, include_body: bool = False) -> list[dict]`：透传 `include_body` 给 `_hits` 与 `score`；空 query 时的置顶与更新时间倒序排列逻辑保持不变。
- **Acceptance Criteria**：
  - 执行 `.venv/bin/pytest tests/test_units.py tests/test_acceptance.py` 通过。
  - 验证同等置顶与过期条件下：标题命中基础分（4.0分） > 摘要命中基础分（1.0分） > 正文命中基础分（≤0.8分）。
- **Dependencies**：TASK-001
- **Priority**：High

---

## Phase 2：MCP 工具层契约扩展与 Agent 提示词重构

### TASK-003：扩展 capsa/mcp_service.py 中 memory_search 入参并添加正文检索防护守卫

- **Status**：DONE（2026-09-17）
- **Description**：在 `capsa/mcp_service.py` 的 `memory_search` 工具中增加入参 `include_body: bool = False`；增加参数守卫仅在 query 非空且 include_body=True 时查正文，空 query 浏览绝不查询正文；明确此能力仅属于 MCP 工具层，CLI 与 Web API 保持仅检索元数据。
- **Details**：
  - 在 `memory_search` 签名中增加 `include_body: Annotated[bool, Field(description="是否检索正文（低权重兜底选项，仅在标题和摘要无法命中代码/配置细节时开启）")] = False`。
  - 在函数体内计算 `load_body = bool(include_body and query and query.strip())`，并将 `load_body` 传入 `dal.list_active_memories_for_search(conn, scopes, group, include_body=load_body)` 与 `retrieval.rank_memories(memories, query or "", include_body=load_body)`。
- **Acceptance Criteria**：
  - 启动 MCP 服务，通过 `tools/list` 检查 `memory_search` 的 inputSchema，验证 `include_body` 字段类型为 boolean、默认值为 false、包含明确的兜底用途说明。
  - 当 `query=None` 或 `query=""` 且 `include_body=True` 时，传递给 DAL 的 `include_body` 实参为 False，不加载正文字段。
- **Dependencies**：TASK-001, TASK-002
- **Priority**：High

### TASK-004：重构 capsa/mcp_service.py 工具描述与参数注解，保留中立渐进披露契约

- **Status**：DONE（2026-09-17）
- **Description**：移除全局 `USAGE` 微操文本，重构所有 7 个 MCP 工具的描述文案与参数注解，采用客观、精准说明，保留清晰中立的渐进披露边界说明（检索返回元数据不含正文、peek 取摘要、read 取正文），消除对 Agent 的行为干预与格式噪音。
- **Details**：
  - 移除全局常量 `USAGE` 及其向 `memory_groups`、`memory_search`、`memory_peek`、`memory_read` 等工具的后缀拼接。
  - 工具描述与披露边界重构：
    - `memory_groups`：`"列出当前凭据可访问的分组列表、各分组条目数与读写权限。"`
    - `memory_search`：`"检索记忆条目（返回标题与元数据，不含正文）。仅在标题/摘要未命中特定代码/配置细节时，可开启 include_body=True 兜底召回。查看摘要请调用 memory_peek，获取正文请调用 memory_read。"`
    - `memory_peek`：`"批量查看指定记忆条目的标题与摘要（ids 最多 10 条）。获取完整正文请调用 memory_read。"`
    - `memory_read`：`"批量读取指定记忆条目的完整正文（ids 最多 5 条）。单条正文过长时支持通过 offset 分页读取。"`
    - `memory_save`：`"在指定分组新建记忆（需目标分组写权限）。标题 ≤ 60，摘要 ≤ 200，正文 ≤ 64000 字符。同分组存在相似标题时照常创建并提示。"`
    - `memory_update`：`"局部更新记忆条目（需目标分组写权限）。仅需传入待修改字段。"`
    - `memory_forget`：`"软删除记忆条目并记录原因（需目标分组写权限）。条目移入回收站，可通过 CLI 恢复。"`
  - 使用 `typing.Annotated` 与 `pydantic.Field` 为所有工具的参数（query, group, limit, include_body, ids, offset, title, summary, body, tags, review_at, clear_review_at, pinned, reason）补充中立、明确的参数说明。
  - 保持 `formatters.py` 核心输出结构与 `> 下一步:` 兼容正则，确保客户端生态与既有端到端测试无缝兼容。
- **Acceptance Criteria**：
  - 7 个工具均有非空、中立客观的 description，且不再包含“读取协议：先用...再用...最后才用...”等训诫词。
  - 所有工具参数均在 inputSchema 中具备规范的 description 说明。
  - 执行 `.venv/bin/pytest tests/test_e2e.py` 100% 通过。
- **Dependencies**：TASK-003
- **Priority**：High

---

## Phase 3：测试用例扩展与全量回归验证

### TASK-005：在 tests/ 中编写按需正文检索与打分排序测试用例

- **Status**：DONE（2026-09-17）
- **Description**：在测试套件中新增测试用例，覆盖默认正文不召回、空 query 开启不加载正文、开启后正文正确召回、同词下标题命中排序高于正文命中等核心场景。
- **Details**：
  - 在 `tests/test_units.py` 中新增单元测试：
    - `test_dal_list_active_memories_include_body`：验证 DAL 开启/关闭正文时的字段返回差异；
    - `test_retrieval_include_body_hits_and_scores`：验证 `_hits` 与 `score` 对正文关键词的命中、非对称打分（0.2/词，上限 0.8）及未开启时不命中；
  - 在 `tests/test_acceptance.py` 中新增工具层验收测试：
    - `test_memory_search_empty_query_include_body_guard`：验证 `query=""` 即使传入 `include_body=True` 也正常按时间倒序浏览，不会报错且 DAL 不投影正文；
    - `test_memory_search_include_body_fallback_and_ranking`：通过 MCP 客户端验证 `include_body=False` 无法查出正文独有词；验证 `include_body=True` 可成功查出正文独有词；验证当一条记忆标题包含该词、另一条仅正文包含该词时，标题条目排名在正文条目之前。
- **Acceptance Criteria**：
  - 执行 `.venv/bin/pytest tests/test_units.py tests/test_acceptance.py` 全部通过。
- **Dependencies**：TASK-004
- **Priority**：High

### TASK-006：执行全量自动化测试套件进行回归验证

- **Status**：DONE（2026-09-17）
- **Description**：执行整个测试套件，验证全部既有 184 个测试用例以及新增用例 100% 通过，无任何回归问题。
- **Details**：
  - 运行命令 `.venv/bin/pytest`。
  - 检查全部用例执行状态，确认退出码为 0，测试通过总数 ≥ 187。
- **Acceptance Criteria**：
  - 全部 pytest 测试用例通过，无失败、无错误。
- **Dependencies**：TASK-005
- **Priority**：High

---

## Phase 4：项目规范与决策记录文档维护

### TASK-007：更新 .docs/Project.md 架构数据流、关键约定与决策记录

- **Status**：DONE（2026-09-17）
- **Description**：在 `.docs/Project.md` 中同步最新的工具接口契约、检索打分机制、提示词信噪比原则与对应的架构决策记录。
- **Details**：
  - 在 §0 维护速查、§4 架构与数据流中记录 `memory_search` 的 `include_body` 条件投影机制与打分流程，注明正文兜底能力仅属于 MCP Agent 端点，CLI 与 Web 保持元数据检索。
  - 在 §5 关键约定中明确 MCP 工具提示词去微操化、保留渐进披露中立契约的高信噪比原则。
  - 在 §8 决策记录中追加记录：
    - 2026-09-17 `memory_search` 正文按需检索采用方案 A（DAL 条件投影 + 非空 query 守卫）+ 方案 C（非对称低权重打分）；
    - 2026-09-17 移除 MCP 工具层全局微操 USAGE，改为中立披露契约与字段级自解释注解。
- **Acceptance Criteria**：
  - `.docs/Project.md` 内容与最新代码实现严格一致。
- **Dependencies**：TASK-006
- **Priority**：Medium
