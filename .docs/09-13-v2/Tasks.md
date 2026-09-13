# Tasks：Capsa Phase 2 —— 写入生命周期、查重与软删除闭环

**状态**：DONE
**完成日期**：2026-09-13
**关联 Plan**：`Plan.md` —— Capsa Phase 2 v1.0
**回归测试结论**：`.venv/bin/python -m pytest -q` → 99 passed，0 failed，0 skipped（Phase 1 的 64 个用例无回归，新增 35 个）
**总计 Task**：12 个（TASK-021 ~ TASK-032，全部 DONE）

> **执行前置**：先读 Plan.md §2「契约收敛」，其中五条边界是本阶段所有实现的唯一基准。所有命令基于仓库根目录，虚拟环境解释器为 `.venv/bin/python`。

---

## Phase 2.1：写入契约校验与近似查重算法

### TASK-021：实现复核时间的 UTC 规范化与标题近似度函数

- **Status**：DONE
- **Priority**：P0
- **Depends on**：无（`retrieval.py` 已存在）
- **Description**：在 `capsa/retrieval.py` 增加 `normalize_review_at`、`title_similarity`、`find_similar_memories` 三个纯函数，供写入工具与后续的 Web 写入接口共用。
- **Details**：
  - `normalize_review_at(value: str) -> str`：用 `datetime.fromisoformat` 解析；无时区信息时按 UTC 处理；输出统一为 `astimezone(timezone.utc).isoformat()`。解析失败让 `ValueError` 自然冒出，由调用方转成中文工具错误
  - `title_similarity(left: str, right: str) -> float`：两侧各取 `tokenize` 结果作为集合，返回 Jaccard 系数 `|A ∩ B| / |A ∪ B|`；两侧并集为空时返回 `0.0`
  - `find_similar_memories(candidates: list[dict], title: str, threshold: float = 0.6) -> list[dict]`：对候选条目逐个计算 `title_similarity`，返回相似度不低于阈值的条目，每条附 `similarity` 键（可 `round(x, 2)`）；结果按相似度降序，便于响应里排在前面的最像
  - 阈值定义为模块级常量 `SIMILARITY_THRESHOLD = 0.6`
  - 三个函数都是纯函数，不接受连接、不读写数据库，便于单测
- **Acceptance Criteria**：
  - `normalize_review_at("2026-10-01T09:30:00+08:00")` 与 `normalize_review_at("2026-10-01T01:30:00+00:00")` 返回同一字符串
  - `normalize_review_at("2026-10-01")` 可被 `datetime.fromisoformat` 解析回同一日期
  - `normalize_review_at("下周三")` 抛 `ValueError`
  - `title_similarity("记忆分组", "记忆分组表") == pytest.approx(0.75)`
  - `title_similarity("授权模型", "授权模型定稿") == pytest.approx(SIMILARITY_THRESHOLD)`（恰好落在阈值上的边界）
  - `title_similarity("OAuth", "OAuth") == 1.0`，`title_similarity("!!!", "???") == 0.0`
  - `find_similar_memories` 只返回不低于阈值的条目，返回值带 `similarity`，且顺序为相似度降序

---

## Phase 2.2：写入与回收站的数据访问入口

### TASK-022：实现记忆条目的新建入口

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-021
- **Description**：在 `capsa/dal.py` 新增 `insert_memory`，并让重复键可被调用方识别。
- **Details**：
  - 模块级新增 `class DuplicateMemoryId(Exception)`，作为主键冲突的可识别信号
  - `insert_memory(conn, *, group_slug, title, summary, body, tags, review_at, memory_id=None) -> str`：
    - `tags` 收字符串列表，落库前 `json.dumps(..., ensure_ascii=False)`；`review_at` 由调用方规范化后传入
    - `created_at` 与 `updated_at` 都取 `utcnow()`；`pinned` 与 `deleted_at`、`deleted_reason` 走列默认值，不在 INSERT 语句里出现
    - 生成 ID 用 `ids.new_memory_id()`，重试至多 3 次；与既有 ID 冲突时捕获 `sqlite3.IntegrityError` 并检查 `"UNIQUE constraint failed" in str(error)`，是则重试，3 次用尽抛 `DuplicateMemoryId`
    - 非主键的 `IntegrityError`（如外键失败、CHECK 失败）不进重试分支，原样抛出
    - 成功即 `conn.commit()`，返回最终落库的 ID
  - 不修改既有的 `insert_memory` 测试辅助函数（`tests/conftest.py`）
- **Acceptance Criteria**：
  - 传入固定 `memory_id`（仅测试用）后关闭连接重开，条目仍在且 `tags` 可 `json.loads` 还原为列表
  - 不传 `memory_id` 时返回的 ID 满足 `^mem_[a-z0-9]{6}$`
  - monkeypatch `capsa.dal.new_memory_id` 首次返回已存在的 ID、第二次返回新 ID，断言一次调用即成功落库且不抛异常
  - monkeypatch 使生成函数恒定返回同一已存在 ID，断言第三次后抛 `DuplicateMemoryId`
  - `group_slug` 指向不存在的分组时抛 `sqlite3.IntegrityError`，且不进入重试分支

### TASK-023：实现局部更新、软删除、恢复与回收站列表

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-022
- **Description**：在 `capsa/dal.py` 新增四个记忆写读入口，覆盖完整生命周期。
- **Details**：
  - `update_memory(conn, memory_id: str, fields: dict) -> bool`：`fields` 为字段名到新值的白名单字典，键取自 `title` / `summary` / `body` / `tags` / `review_at` / `pinned`；`tags` 为列表时序列化，为 `None` 时写入 `"[]"`；`review_at` 为 `None` 时写入 SQL NULL；始终追加 `updated_at = ?` 取 `utcnow()`；`fields` 为空时直接返回 `False` 且不执行 SQL；返回 `cursor.rowcount > 0`
  - `soft_delete_memory(conn, memory_id: str, reason: str) -> bool`：`UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL`，返回是否命中一行；已删除条目重复删除返回 `False` 且不覆盖原因
  - `restore_memory(conn, memory_id: str) -> bool`：`UPDATE memories SET deleted_at = NULL, deleted_reason = NULL WHERE id = ? AND deleted_at IS NOT NULL`，返回是否命中一行
  - `list_deleted_memories(conn, group_slug: str | None = None) -> list[dict]`：只返回 `deleted_at IS NOT NULL` 的条目，字段为 `id, group_slug, title, deleted_at, deleted_reason`；`group_slug` 非空时参数化过滤；排序 `deleted_at DESC, id DESC`
  - 四个函数都在返回前 `conn.commit()`（沿用 Phase 1 的事务边界约定）
  - 全部经参数化占位符，禁止字符串拼接；不接收 `scopes`，作用域判定留在工具层
- **Acceptance Criteria**：
  - 只传 `{"summary": "新摘要"}` 时，标题、正文、标签、复核时间、置顶标记与 `created_at` 全部保持不变，`updated_at` 更新
  - `update_memory(conn, id, {})` 返回 `False`，且条目的 `updated_at` 不变
  - `update_memory` 传 `{"review_at": None}` 后该列为 SQL NULL
  - `soft_delete_memory` 后 `deleted_at` 与 `deleted_reason` 均已落库；对同一条目再次调用返回 `False` 且原因不被覆盖
  - `restore_memory` 后两列均为 NULL，且条目重新出现在 `get_memories_batch_for_access` 的 `authorized` 结果中
  - `list_deleted_memories` 不含未删除条目；带 `group_slug` 时只返回该分组
  - 上述每次写入后关闭连接重开，状态保持

---

## Phase 2.3：三个写入工具与读写权限分级

### TASK-024：注册 memory_save 工具

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-022
- **Description**：在 `capsa/mcp_service.py` 注册 `memory_save`，实现权限拦截、字段硬校验与查重提示。
- **Details**：
  - 签名为 `memory_save(group: str, title: str, summary: str, body: str, tags: list[str] | None = None, review_at: str | None = None) -> str`，注解为 `ToolAnnotations(destructiveHint=False)`
  - 执行顺序固定为权限 → 字段 → 时间 → 落库：先从 `_grants()` 取当前 Key 的授权映射，`group` 不在映射内或映射值不是 `"rw"` 时抛同一条拒绝文案（不得区分"无此分组"与"仅只读"），再校验字段
  - 字段校验抽成工具层私有函数 `_require_length(name: str, value: str | None, limit: int, label: str) -> str`，同一函数同时承担非空检查与长度检查：
    - 非空：`None`、空串、纯空白一律视为未提供，报 `{label}不能为空`
    - 长度：超过上限报 `{label}超长 (当前 X 字符，上限 Y 字符，拒绝写入)`，`X` 为实际字符数
  - 上限取自模块级常量 `TITLE_MAX = 60`、`SUMMARY_MAX = 200`、`BODY_MAX = 64000`，与 `capsa/db.py` 的 CHECK 约束对齐
  - 落库前查重：`dal.list_active_memories_for_search(conn, {group: "rw"}, group)` 取候选，`retrieval.find_similar_memories(candidates, title)` 求相似条目；相似条目不阻断写入
  - 成功响应包含新建条目的 id；存在相似条目时在响应中列出其 id、标题与相似度，并注明已照常创建
  - `review_at` 提供时经 `retrieval.normalize_review_at` 规范化；`ValueError` 转成中文工具错误
- **Acceptance Criteria**：
  - 正常输入返回文中含 `mem_` 开头的 id，且 `dal.get_memories_batch_for_access` 能查到该条目
  - 61 字符标题返回 `isError: true`，文本含 `当前 61 字符` 与 `上限 60 字符`；201 字符摘要与 64001 字符正文同理报各自上限与实际字数
  - 三个字段超限用例中，`memories` 表行数不变
  - 只读 Key（`{"proj": "r"}`）调用返回 `isError: true`，且未授权分组的调用返回的错误文本与"仅只读"场景逐字相同
  - 目标分组不存在于 `groups` 表但 Key 的 scopes 声明了 `rw` 时，返回 `isError: true` 且不是 500
  - 与既有条目标题相似度 1.0 的新建请求成功落库，响应同时含新条目 id 与既有条目 id
  - `review_at="下周三"` 返回 `isError: true`；`review_at="2026-10-01T09:30:00+08:00"` 落库后读出的值为 UTC 形式

### TASK-025：注册 memory_update 工具

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-023
- **Description**：在 `capsa/mcp_service.py` 注册 `memory_update`，实现三态定位、增量更新与清空语义。
- **Details**：
  - 签名为 `memory_update(id: str, title: str | None = None, summary: str | None = None, body: str | None = None, tags: list[str] | None = None, review_at: str | None = None, clear_review_at: bool = False, pinned: bool | None = None) -> str`，注解为 `ToolAnnotations(idempotentHint=True)`
  - 定位用 `dal.get_memories_batch_for_access(conn, [id], _grants())`，按 Plan §2.2 收敛判定：
    1. 判定为 `forbidden` 或 `not_found` → 同一条文案 `记忆 {id} 不存在或无权访问`
    2. 判定为 `authorized` 但该分组权限不是 `"rw"` → `Key {key_id} 对分组 {group_slug} 只有只读权限，拒绝修改`
  - 待更新字段白名单：`title` / `summary` / `body` 经 `_require_length` 校验后入字典；`tags` 非 `None` 时入字典（`[]` 表示清空）；`pinned` 非 `None` 时入字典；`review_at` 非 `None` 时经 `normalize_review_at` 后入字典
  - `clear_review_at=True` 时把 `review_at` 以 `None` 入字典，使 DAL 写入 SQL NULL
  - `clear_review_at` 为真且 `review_at` 非空时抛工具错误，不做静默取舍
  - 待更新字典为空时抛工具错误，提示至少提供一个待更新字段
  - 成功响应含条目 id 与本次实际更新的字段名列表
- **Acceptance Criteria**：
  - 只传 `summary` 时，随后经 `memory_read` 读到的标题、正文与标签保持原值
  - `tags=[]` 执行后 `memory_peek` 输出的标签为 `-`
  - `clear_review_at=True` 后条目的 `review_at` 为 SQL NULL，且不再计入复核过期
  - `clear_review_at=True` 与 `review_at` 同时给出时返回 `isError: true`
  - 不传任何可写字段时返回 `isError: true`
  - 只读 Key 调用返回 `isError: true` 且文本含 `只读权限`
  - 用只读 Key 传一个属于未授权分组的真实 id，返回文本为 `记忆 {id} 不存在或无权访问`；传一个不存在的 id，两次调用的错误文本逐字相同
  - `pinned=True` 经 `memory_search` 空查询验证排在同分组未置顶条目之前

### TASK-026：注册 memory_forget 工具

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-023
- **Description**：在 `capsa/mcp_service.py` 注册 `memory_forget`，实现带原因的软删除。
- **Details**：
  - 签名为 `memory_forget(id: str, reason: str) -> str`，注解为 `ToolAnnotations(destructiveHint=True)`
  - 定位与权限判定复用 TASK-025 的三条分支（同一条不存在文案、同一条只读文案）
  - `reason` 为 `None`、空串或纯空白时抛工具错误，提示删除原因不能为空
  - 权限与 `reason` 均通过后调用 `dal.soft_delete_memory(conn, id, reason.strip())`，落库原因去首尾空白
  - 成功响应含条目 id 与删除原因，并提示可用 CLI 恢复
- **Acceptance Criteria**：
  - 软删除后 `memories` 行中 `deleted_at` 非空、`deleted_reason` 等于传入原因
  - `reason=""` 与 `reason="   "` 均返回 `isError: true`，且条目的 `deleted_at` 仍为 NULL
  - 只读 Key 调用返回 `isError: true`，条目的 `deleted_at` 仍为 NULL
  - 对同一条目连续调用两次，第二次返回 `isError: true`，且首次写入的原因不被覆盖

---

## Phase 2.4：回收站 CLI 与自动化验收

### TASK-027：实现回收站 CLI 子命令

- **Status**：DONE
- **Priority**：P1
- **Depends on**：TASK-023
- **Description**：在 `capsa/cli.py` 新增 `memory` 子命令组，提供回收站列出与恢复。
- **Details**：
  - `capsa memory list-deleted [--group <slug>]`：调用 `dal.list_deleted_memories`，每行输出 `{id} | {group_slug} | 删除于 {deleted_at} | 原因: {deleted_reason}`；无条目时输出 `回收站为空`；`--group` 为空则不限分组
  - `capsa memory restore <memory_id>`：调用 `dal.restore_memory`；未命中时向 stderr 打印未找到并返回退出码 1，命中则打印已恢复并返回 0
  - 用标准库 `argparse` 组织子命令，与既有 `group` / `key` 的口径一致；`main()` 仍返回进程退出码
  - CLI 是管理员通道，不做 Key 作用域校验（Plan §2.5）
- **Acceptance Criteria**：
  - 软删除一条记忆后运行 `list-deleted`，输出含该条目 id、分组与删除原因
  - 带 `--group` 指向另一分组时，输出不含该条目
  - 未软删除的条目不出现在 `list-deleted` 输出中
  - 对已删除条目执行 `restore` 返回 0，该条目随后可被 `memory_search` 检索到
  - 对不存在的 id 执行 `restore` 返回 1 且 stderr 含未找到提示

### TASK-028：编写字段硬契约与查重算法用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-021、TASK-024
- **Description**：新增 `tests/test_write.py`，覆盖字段非截断校验与查重行为。
- **Details**：
  - 用例覆盖标题 60/61、摘要 200/201、正文 64000/64001 三个边界：等于上限放行，超出一字符拒绝
  - 超限用例断言两部分：错误文本含实际字符数与上限值，且 `SELECT COUNT(*) FROM memories` 不变
  - 查重用例按 TASK-021 的样例文案直接断言计算出的相似度数值，不写"包含相似条目"式弱断言
  - 相似标题用例同时断言两件事：新条目已落库（行数加一），响应中同时出现新旧两个 id
  - 非空用例覆盖 `title=""` 与纯空白输入，断言返回 `isError: true`
  - 复用既有夹具（`conn` / `seeded` / `open_session`），不新建测试数据库机制
- **Acceptance Criteria**：
  - `pytest tests/test_write.py -v` 退出码 0
  - 每个超限用例都有对应的"等于上限放行"用例，避免只验证拒绝方向
  - 断言指向具体字符串或具体行数，不使用"包含任意内容"式弱断言

### TASK-029：编写增量更新、清空与软删除恢复用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-023、TASK-025、TASK-026、TASK-027
- **Description**：在 `tests/test_write.py` 补齐生命周期与权限分级用例。
- **Details**：
  - 增量更新：只传 `summary` 后逐字段断言标题、正文、标签、复核时间与 `created_at` 均未变
  - 清空语义：`clear_review_at=True` 后断言 `review_at` 为 NULL；`tags=[]` 后断言标签渲染为 `-`
  - 软删除与恢复：`memory_forget` 后断言 `deleted_reason` 落库；`memory_search` 与 `memory_read` 均不再命中；执行 CLI `restore` 后重新命中
  - `restore` 用例经 `subprocess` 调用真实 CLI（沿用 `tests/test_cli.py` 的 `run_cli` 方式），并在结束后关闭复用的连接
  - 权限分级：只读 Key 对三个写工具各调一次，断言均为 `isError: true` 且 `memories` 行数不变
  - 信息不泄露：用只读 Key 分别对"未授权分组的真实 id"与"不存在的 id"调用 `memory_update`，断言两次错误文本逐字相同，且不含未授权分组的 slug
  - `reason` 为空、`clear_review_at` 与 `review_at` 同时给出、不传任何字段三类错误各有一条用例
- **Acceptance Criteria**：
  - `pytest tests/test_write.py -v` 退出码 0
  - 增量更新用例的断言逐字段列出，不使用"其他字段未变"这类概括性断言
  - 两条错误文本对比用例使用字符串相等断言，不使用 `in` 断言
  - 五条 Phase 2 交付验收断言在报告中各有对应用例名可指认

### TASK-030：更新工具清单断言并回归全量套件

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-024、TASK-025、TASK-026
- **Description**：更新 `tests/test_e2e.py` 中既有的工具清单断言，并在扩到 7 个工具后重跑全量套件。
- **Details**：
  - `test_tools_list_exposes_four_read_only_tools` 重命名为 `test_tools_list_exposes_seven_tools`；期望列表按注册顺序改为 `memory_groups`、`memory_search`、`memory_peek`、`memory_read`、`memory_save`、`memory_update`、`memory_forget`
  - 按名逐条断言注解：四个读工具 `readOnlyHint is True`；`memory_save` 的 `destructiveHint is False`；`memory_update` 的 `idempotentHint is True`；`memory_forget` 的 `destructiveHint is True`
  - 不把清单断言放宽为"包含"式断言（Plan §5 风险条）
  - 重跑 `.venv/bin/python -m pytest -v` 确认既有 64 个用例无回归
- **Acceptance Criteria**：
  - 工具清单断言仍为列表相等，且逐名逐注解可读
  - `.venv/bin/python -m pytest -q` 退出码 0，失败数与跳过数均为 0
  - 无任何用例被删除或标记 `skip` 以规避失败

---

## Phase 2.5：文档回填与交付

### TASK-031：按实际代码更新 Project.md

- **Status**：DONE
- **Priority**：P1
- **Depends on**：TASK-030
- **Description**：按 Phase 2 的实际产出校正 `.docs/Project.md`，使文档与代码库一致。
- **Details**：
  - §1 概述的"当前阶段"改为 Phase 2 交付完成
  - §3 目录结构补上 `tests/test_write.py`；模块职责中为 `retrieval.py` 增加查重与时间规范化职责、为 `dal.py` 增加写入与回收站入口、为 `cli.py` 增加 `memory` 子命令
  - §4 数据流补写入链路：工具层校验权限与字段 → `dal.py` 写入 → 提交
  - §6 约束与已知坑补两条：写入错误一律走工具级 `isError`；`forbidden` 与 `not_found` 在写入路径共用同一文案
  - §8 决策记录补本阶段的四条决策：局部更新用白名单字典、ID 碰撞重试至多 3 次、查重只提示不拦截、回收站 CLI 不做作用域校验
  - 模板中无内容的可选章节维持删除状态，不新增空节
- **Acceptance Criteria**：
  - 文件中不存在 `<!-- 待填 -->` 残留
  - §3 列出的每个文件路径在仓库中实际存在
  - §8 的每条决策与 Plan.md §4 一致，无相互矛盾
  - 运行与测试命令在干净 shell 中可直接执行成功

### TASK-032：回填设计文档的事实漂移并交付

- **Status**：DONE
- **Priority**：P1
- **Depends on**：TASK-031
- **Description**：修正 `AgentSpace 记忆服务设计方案.md` 中与实现不一致的陈述，随后归档并提交。
- **Details**：
  - `memories` 表字段清单补上 `deleted_reason`（§五的表格当前只列到 `deleted_at`）
  - `memories.id` 的说明由"8 位随机串，形如 mem_7f3ka2"改为"`mem_` 前缀加 6 位随机字符，总长度 10，形如 `mem_7f3ka2`"，与 §零.7 及实现一致
  - 按实际实现回填本阶段的两处口径：字段超限与权限拒绝的错误分层、相似条目的提示不拦截
  - 归档：确认 Plan.md 与 Tasks.md 已标注 `状态：DONE` 并含完成日期与回归测试结论，移入 `.docs/09-13-v2/`
  - 提交：提交信息以 Conventional Commits 英文类型前缀开头、正文用中文
- **Acceptance Criteria**：
  - 设计文档 §五的 `memories` 字段清单包含 `deleted_reason`，id 说明为 6 位随机字符、总长 10
  - `.docs/09-13-v2/` 同时含 `Plan.md` 与 `Tasks.md`，根目录无残留
  - `git status --porcelain` 中不出现 `.venv/`、`.devtools/`、`*.db`
  - 归档后 `pytest -q` 仍为全绿

---

## 交付链附加约定

以下为 Execute 之后各阶段的执行口径，不属于 Task 清单。

| 阶段 | 约定 |
|------|------|
| Test | 以 `.venv/bin/python -m pytest -q` 为准；全绿后方可进入归档 |
| Document Maintenance | 完成 TASK-031 与 TASK-032；清理 `.pytest_cache/` 与 `__pycache__/` 等一次性产物 |
| Archive | 归档目录 `.docs/09-13-v2/`；须先确认 Plan.md 与 Tasks.md 已标注 `状态：DONE` 并含完成日期与回归测试结论 |
| Git Commit | 沿用仓库既有提交风格：Conventional Commits 英文类型前缀 + 中文正文；不提交任何 `.db` 产物 |
| 文档边界 | 规划文档 `Capsa_落地交付分期规划.md` 与本 Plan 的 Phase 2 契约已对齐，无需改动；本阶段只回填设计文档中与实现冲突的事实陈述 |
